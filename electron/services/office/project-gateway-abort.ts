import type { GatewayManager } from '../../gateway/manager';
import type { OfficeTempProject } from './types';
import { roleTaskRoomDmSuffix } from './session-keys';
import {
  clearAbortQuiesceLock,
  getAbortQuiesceLock,
  setAbortQuiesceLock,
} from './project-abort-quiesce';
import { takeOfficeInflightLlmSessionKeys } from './office-inflight-llm-registry';

export const CHAT_ABORT_RPC_MS = 5_000;
export const ABORT_CONFIRM_DELAY_MS = 500;
export const ABORT_CONFIRM_MAX = 2;
/** Outer drain delay between abort+list rounds while abortQuiescing stays true. */
export const ABORT_QUIESCE_RETRY_DELAY_MS = 1_000;

export type ProjectGatewayAbortResult = {
  sessionKeys: string[];
  abortedCount: number;
  confirmedIdle: boolean;
  listSucceeded: boolean;
};

/** Snapshot fields needed for Gateway abort before nodeRuns are settled. */
export function cloneProjectForGatewayAbort(project: OfficeTempProject): OfficeTempProject {
  return {
    ...project,
    agentIds: [...(project.agentIds ?? [])],
    nodeRuns: project.nodeRuns.map((nr) => ({ ...nr })),
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Match Office session keys for a project without prefix false positives. */
export function sessionKeyMatchesProject(sessionKey: string, projectId: string): boolean {
  const id = projectId.trim();
  if (!id) return false;
  const dmSuffix = roleTaskRoomDmSuffix(id);
  const esc = escapeRegExp(id);
  const escDm = escapeRegExp(dmSuffix);
  const patterns = [
    new RegExp(`[/:]task-room:${esc}(?:[:/]|$)`),
    new RegExp(`[/:]task:${esc}:role:`),
    new RegExp(`[/:]task:${esc}(?:[:/]|$)`),
    new RegExp(`[/:]dm:${escDm}(?:[:/]|$)`),
  ];
  return patterns.some((re) => re.test(sessionKey));
}

/** Sync-phase keys only: inflight take + running/pending nodeRuns with sessionKey. */
export function collectSyncAbortSessionKeys(
  project: Pick<OfficeTempProject, 'id' | 'nodeRuns'>,
  options?: { takeInflight?: boolean },
): { inflightSessionKeys: string[]; staticSessionKeys: string[] } {
  const projectId = project.id.trim();
  const inflightSessionKeys =
    options?.takeInflight === false
      ? []
      : takeOfficeInflightLlmSessionKeys(projectId);

  const staticSessionKeys: string[] = [];
  for (const nr of project.nodeRuns) {
    if (nr.status !== 'running' && nr.status !== 'pending') continue;
    const sessionKey = nr.sessionKey?.trim();
    if (sessionKey) staticSessionKeys.push(sessionKey);
  }

  return {
    inflightSessionKeys: [...new Set(inflightSessionKeys)],
    staticSessionKeys: [...new Set(staticSessionKeys)],
  };
}

export async function listActiveGatewaySessionKeysForProject(
  gateway: GatewayManager,
  projectId: string,
): Promise<{ keys: string[]; listSucceeded: boolean }> {
  if (!gateway.isConnected()) {
    return { keys: [], listSucceeded: false };
  }
  try {
    const data = await gateway.rpc<{ sessions?: unknown[] }>('sessions.list', {
      includeDerivedTitles: false,
      includeLastMessage: false,
    });
    const sessions = Array.isArray(data?.sessions) ? data.sessions : [];
    const keys: string[] = [];
    for (const raw of sessions) {
      if (!raw || typeof raw !== 'object') continue;
      const row = raw as Record<string, unknown>;
      const key = typeof row.key === 'string' ? row.key.trim() : '';
      if (!key || !sessionKeyMatchesProject(key, projectId)) continue;
      // Align with session-run-settle: only hasActiveRun=true means an in-flight LLM.
      // Stale status==="running" after chat.abort must not keep abortQuiescing forever.
      if (row.hasActiveRun === true) {
        keys.push(key);
      }
    }
    return { keys: [...new Set(keys)], listSucceeded: true };
  } catch {
    return { keys: [], listSucceeded: false };
  }
}

async function abortGatewaySessions(
  gateway: GatewayManager,
  sessionKeys: Iterable<string>,
): Promise<number> {
  const unique = [...new Set([...sessionKeys].map((k) => k.trim()).filter(Boolean))];
  if (unique.length === 0) return 0;

  const results = await Promise.allSettled(
    unique.map((sessionKey) =>
      gateway.rpc('chat.abort', { sessionKey }, CHAT_ABORT_RPC_MS),
    ),
  );
  return results.filter((r) => r.status === 'fulfilled').length;
}

export async function abortProjectGatewaySessions(
  gateway: GatewayManager,
  projectId: string,
  keysHint: string[],
): Promise<ProjectGatewayAbortResult> {
  if (!gateway.isConnected()) {
    return { sessionKeys: [...keysHint], abortedCount: 0, confirmedIdle: false, listSucceeded: false };
  }

  let abortedCount = await abortGatewaySessions(gateway, keysHint);
  let allKeys = [...new Set(keysHint.map((k) => k.trim()).filter(Boolean))];

  for (let attempt = 0; attempt < ABORT_CONFIRM_MAX; attempt++) {
    const listed = await listActiveGatewaySessionKeysForProject(gateway, projectId);
    if (!listed.listSucceeded) {
      return {
        sessionKeys: allKeys,
        abortedCount,
        confirmedIdle: false,
        listSucceeded: false,
      };
    }
    if (listed.keys.length === 0) {
      return {
        sessionKeys: allKeys,
        abortedCount,
        confirmedIdle: true,
        listSucceeded: true,
      };
    }
    allKeys = [...new Set([...allKeys, ...listed.keys])];
    abortedCount += await abortGatewaySessions(gateway, listed.keys);
    if (attempt + 1 < ABORT_CONFIRM_MAX) {
      await new Promise((resolve) => setTimeout(resolve, ABORT_CONFIRM_DELAY_MS));
    }
  }

  const finalList = await listActiveGatewaySessionKeysForProject(gateway, projectId);
  return {
    sessionKeys: [...new Set([...allKeys, ...finalList.keys])],
    abortedCount,
    confirmedIdle: finalList.listSucceeded && finalList.keys.length === 0,
    listSucceeded: finalList.listSucceeded,
  };
}

async function persistClearAbortQuiescing(
  projectId: string,
  generation: number,
): Promise<boolean> {
  const { getTempProject, upsertTempProject, notifyRendererProjectProgressUpdate } = await import(
    './store'
  );
  const project = await getTempProject(projectId);
  if (!project) return false;
  if (project.abortGeneration !== undefined && project.abortGeneration !== generation) return false;
  if (!project.abortQuiescing) return false;
  const cleared = await upsertTempProject({
    ...project,
    abortQuiescing: false,
    updatedAt: Date.now(),
  });
  // Push to renderer immediately — abort quiesce poll may have been stopped when
  // the project left "executing" (runningProjectIds → empty).
  try {
    notifyRendererProjectProgressUpdate(cleared);
  } catch (err) {
    console.warn('[office] notify abort quiesce clear failed:', projectId, err);
  }
  return true;
}

async function releaseSpawnDenyAfterQuiesce(projectId: string): Promise<void> {
  try {
    const { releaseOfficeSpawnDenyForOrphanedProjectAbort } = await import(
      './office-spawn-policy-reconcile'
    );
    await releaseOfficeSpawnDenyForOrphanedProjectAbort(projectId);
  } catch (err) {
    console.warn('[office] release spawn deny after abort quiesce failed:', projectId, err);
  }
}

export async function clearProjectAbortQuiesce(
  projectId: string,
  generation: number,
): Promise<void> {
  const lock = getAbortQuiesceLock(projectId);
  // Stale generation must not clear a newer quiesce (with or without in-memory lock).
  if (lock && lock.generation !== generation) return;

  // Persist disk clear BEFORE dropping the memory lock so shouldBlockOfficeLlmSend
  // cannot go false while abortQuiescing is still true on disk.
  const cleared = await persistClearAbortQuiescing(projectId, generation);
  clearAbortQuiesceLock(projectId, generation);
  // Only release spawn deny when this generation actually cleared store quiescing.
  if (cleared) {
    // Gateway idle — drop userAborted so edits / room flows / re-run LLM are not
    // stuck. Lagging runner demotion is blocked by sticky aborted→failed guard +
    // persistTaskProgress demotion check + finalizeAborted renderer notify.
    const { clearTaskUserAborted } = await import('./task-run-abort-registry');
    clearTaskUserAborted(projectId);
    await releaseSpawnDenyAfterQuiesce(projectId);
  }
}

/**
 * Background Gateway abort + clear quiesce only when sessions.list confirms idle.
 * Never auto-clears on timeout alone — but keeps draining (abort+list) until idle
 * or the quiesce generation is superseded / Gateway disconnects (reconcile on ready).
 */
export function scheduleAbortProjectGatewaySessions(params: {
  gateway: GatewayManager | undefined;
  projectId: string;
  generation: number;
  keysHint: string[];
}): Promise<void> {
  const { gateway, projectId, generation } = params;
  let keysHint = [...params.keysHint];
  const work = (async () => {
    for (;;) {
      const lock = getAbortQuiesceLock(projectId);
      if (!lock || lock.generation !== generation) return;

      if (!gateway?.isConnected()) {
        console.warn('[office] skip gateway abort (disconnected):', projectId);
        return;
      }

      const result = await abortProjectGatewaySessions(gateway, projectId, keysHint);
      keysHint = result.sessionKeys.length > 0 ? result.sessionKeys : keysHint;
      console.info(
        `[office] project gateway abort projectId=${projectId} gen=${generation} keys=${result.sessionKeys.length} rpcOk=${result.abortedCount} idle=${result.confirmedIdle} listOk=${result.listSucceeded}`,
      );
      if (!result.confirmedIdle) {
        console.warn(
          `[office] project gateway abort still active projectId=${projectId} gen=${generation} keys=${result.sessionKeys.join(',') || '(none)'} listOk=${result.listSucceeded}`,
        );
      }

      const still = getAbortQuiesceLock(projectId);
      if (!still || still.generation !== generation) return;

      if (result.confirmedIdle && result.listSucceeded) {
        await clearProjectAbortQuiesce(projectId, generation);
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, ABORT_QUIESCE_RETRY_DELAY_MS));
    }
  })().catch((err) => {
    console.warn('[office] schedule gateway abort failed:', projectId, err);
  });

  return work;
}

export function installAbortQuiesceLock(params: {
  projectId: string;
  generation: number;
  startedAt: number;
  staticSessionKeys: string[];
  inflightSessionKeys: string[];
}): void {
  setAbortQuiesceLock({
    projectId: params.projectId,
    generation: params.generation,
    startedAt: params.startedAt,
    staticSessionKeys: params.staticSessionKeys,
    inflightSessionKeys: params.inflightSessionKeys,
    abortWork: Promise.resolve(),
  });
}

/** Schedule gateway abort for an already-installed quiesce lock generation. */
export function scheduleAbortForInstalledQuiesceLock(params: {
  gateway: GatewayManager | undefined;
  projectId: string;
  generation: number;
  keysHint: string[];
}): void {
  const lock = getAbortQuiesceLock(params.projectId);
  if (!lock || lock.generation !== params.generation) return;
  const abortWork = scheduleAbortProjectGatewaySessions({
    gateway: params.gateway,
    projectId: params.projectId,
    generation: params.generation,
    keysHint: params.keysHint,
  });
  setAbortQuiesceLock({ ...lock, abortWork });
}

export function beginAbortQuiesceAndScheduleGateway(params: {
  gateway: GatewayManager | undefined;
  projectId: string;
  generation: number;
  keysHint: string[];
  startedAt: number;
  staticSessionKeys: string[];
  inflightSessionKeys: string[];
}): void {
  // Install lock before scheduling so the async abort body can see this generation.
  installAbortQuiesceLock(params);
  scheduleAbortForInstalledQuiesceLock({
    gateway: params.gateway,
    projectId: params.projectId,
    generation: params.generation,
    keysHint: params.keysHint,
  });
}

/** Re-kick gateway abort for an existing quiesce generation (idempotent abort click). */
export function rekickAbortProjectGatewaySessions(params: {
  gateway: GatewayManager | undefined;
  projectId: string;
}): void {
  const lock = getAbortQuiesceLock(params.projectId);
  if (!lock) return;
  const keysHint = [...new Set([...lock.inflightSessionKeys, ...lock.staticSessionKeys])];
  const abortWork = scheduleAbortProjectGatewaySessions({
    gateway: params.gateway,
    projectId: params.projectId,
    generation: lock.generation,
    keysHint,
  });
  setAbortQuiesceLock({ ...lock, abortWork });
}

/** Gateway ready: clear idle quiescing projects or re-kick abort for still-active ones. */
export async function reconcileAbortQuiescingProjectsOnGatewayReady(
  gateway: GatewayManager,
): Promise<void> {
  const { listTempProjects } = await import('./store');
  const projects = await listTempProjects();
  for (const project of projects) {
    if (!project.abortQuiescing) continue;
    const generation = project.abortGeneration ?? 0;
    const listed = await listActiveGatewaySessionKeysForProject(gateway, project.id);
    if (listed.listSucceeded && listed.keys.length === 0) {
      await clearProjectAbortQuiesce(project.id, generation);
      continue;
    }
    const lock = getAbortQuiesceLock(project.id);
    const keysHint = lock
      ? [...lock.inflightSessionKeys, ...lock.staticSessionKeys]
      : collectSyncAbortSessionKeys(project, { takeInflight: false }).staticSessionKeys;
    if (!lock) {
      beginAbortQuiesceAndScheduleGateway({
        gateway,
        projectId: project.id,
        generation,
        keysHint: [...keysHint, ...listed.keys],
        startedAt: project.abortQuiesceStartedAt ?? Date.now(),
        staticSessionKeys: keysHint,
        inflightSessionKeys: [],
      });
    } else {
      rekickAbortProjectGatewaySessions({ gateway, projectId: project.id });
    }
  }
}
