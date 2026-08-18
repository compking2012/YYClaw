import { withConfigLock } from '../../utils/config-mutex';
import { readOpenClawConfig, writeOpenClawConfig } from '../../utils/channel-config';
import { isOfficeProjectExecuting } from '../../../src/lib/office-room-sidebar';
import type { OfficeTempProject } from './types';
import { mergeOfficeSpawnToolDeny, stripOfficeSpawnToolDeny } from './office-spawn-policy';
import { officeWorkflowLog } from './office-workflow-log';

const agentDenyRef = new Map<string, number>();
const activeSpawnProjects = new Set<string>();
const projectAgentIds = new Map<string, string[]>();

function normalizeAgentIds(agentIds: string[]): string[] {
  return [...new Set(agentIds.map((id) => id.trim()).filter(Boolean))];
}

function incrementAgentRefs(agentIds: string[]): void {
  for (const agentId of agentIds) {
    agentDenyRef.set(agentId, (agentDenyRef.get(agentId) ?? 0) + 1);
  }
}

function decrementAgentRefs(agentIds: string[]): void {
  for (const agentId of agentIds) {
    const next = (agentDenyRef.get(agentId) ?? 0) - 1;
    if (next <= 0) {
      agentDenyRef.delete(agentId);
    } else {
      agentDenyRef.set(agentId, next);
    }
  }
}

function agentNeedsSpawnDeny(agentId: string): boolean {
  return (agentDenyRef.get(agentId) ?? 0) > 0;
}

/** @internal test helper */
export function getOfficeSpawnPolicyAgentDenyRefForTest(): ReadonlyMap<string, number> {
  return agentDenyRef;
}

/** @internal test helper */
export function getOfficeSpawnPolicyActiveProjectsForTest(): ReadonlySet<string> {
  return activeSpawnProjects;
}

/** @internal test helper */
export function resetOfficeSpawnPolicyReconcileForTest(): void {
  agentDenyRef.clear();
  activeSpawnProjects.clear();
  projectAgentIds.clear();
}

/**
 * Persist agents.list[].tools deny/strip from in-memory refs.
 * Does not call Gateway debouncedReload — Gateway watches openclaw.json.
 */
export async function reconcileOfficeSpawnToolPolicy(reason?: string): Promise<boolean> {
  return withConfigLock(async () => {
    const config = (await readOpenClawConfig()) as Record<string, unknown>;
    const agents = (config.agents ?? {}) as Record<string, unknown>;
    const list = Array.isArray(agents.list) ? [...(agents.list as Record<string, unknown>[])] : [];
    let changed = false;

    for (let i = 0; i < list.length; i += 1) {
      const entry = list[i];
      const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
      if (!id) continue;

      const tools = (entry.tools ?? {}) as Record<string, unknown>;
      const nextTools = agentNeedsSpawnDeny(id)
        ? mergeOfficeSpawnToolDeny(tools)
        : stripOfficeSpawnToolDeny(tools);

      if (JSON.stringify(nextTools) !== JSON.stringify(tools)) {
        list[i] = { ...entry, tools: nextTools };
        changed = true;
      }
    }

    if (!changed) return false;

    config.agents = { ...agents, list };
    await writeOpenClawConfig(config as Parameters<typeof writeOpenClawConfig>[0]);
    officeWorkflowLog('info', '[office][spawn-policy] reconciled openclaw tools deny', {
      reason: reason ?? 'unspecified',
      activeProjects: activeSpawnProjects.size,
      agentRefs: agentDenyRef.size,
    });
    return true;
  });
}

/** Rebuild in-memory refs from persisted executing projects (app/gateway recovery). */
export async function rebuildOfficeSpawnPolicyRefsFromStore(): Promise<void> {
  const { listTempProjects } = await import('./store');
  const projects = await listTempProjects();
  const executingFromStore = projects.filter(
    (p) => (p.lifecycle ?? 'active') === 'active' && isOfficeProjectExecuting(p),
  );

  // Preserve in-flight prepare() refs that are ahead of persisted store status.
  const memoryProjects = new Map<string, string[]>();
  for (const projectId of activeSpawnProjects) {
    memoryProjects.set(projectId, normalizeAgentIds(projectAgentIds.get(projectId) ?? []));
  }

  agentDenyRef.clear();
  activeSpawnProjects.clear();
  projectAgentIds.clear();

  const merged = new Map<string, string[]>();
  for (const project of executingFromStore) {
    merged.set(project.id, normalizeAgentIds(project.agentIds));
  }
  for (const [projectId, agentIds] of memoryProjects) {
    const existing = merged.get(projectId);
    merged.set(
      projectId,
      existing ? normalizeAgentIds([...existing, ...agentIds]) : agentIds,
    );
  }

  for (const [projectId, agentIds] of merged) {
    if (agentIds.length === 0) continue;
    activeSpawnProjects.add(projectId);
    projectAgentIds.set(projectId, agentIds);
    incrementAgentRefs(agentIds);
  }

  await reconcileOfficeSpawnToolPolicy('store-rebuild');
}

/**
 * Apply spawn deny before the first session/RPC of a project run.
 * Must be awaited before notifyOfficeProjectRunStarted / workflow dispatch.
 */
export async function prepareOfficeSpawnDenyBeforeRun(
  project: Pick<OfficeTempProject, 'id' | 'agentIds'>,
): Promise<void> {
  const projectId = project.id.trim();
  if (!projectId) return;

  if (activeSpawnProjects.has(projectId)) {
    await reconcileOfficeSpawnToolPolicy(`run-start:idempotent:${projectId}`);
    return;
  }

  const agentIds = normalizeAgentIds(project.agentIds);
  activeSpawnProjects.add(projectId);
  projectAgentIds.set(projectId, agentIds);
  incrementAgentRefs(agentIds);
  await reconcileOfficeSpawnToolPolicy(`run-start:${projectId}`);
}

/** Remove spawn deny bookkeeping when a project run ends (manual, abort, or completion). */
export async function releaseOfficeSpawnDenyAfterRun(
  projectId: string,
  agentIds?: string[],
): Promise<void> {
  const id = projectId.trim();
  if (!id || !activeSpawnProjects.has(id)) return;

  const ids = normalizeAgentIds(
    projectAgentIds.get(id) ?? agentIds ?? [],
  );

  activeSpawnProjects.delete(id);
  projectAgentIds.delete(id);
  decrementAgentRefs(ids);
  await reconcileOfficeSpawnToolPolicy(`run-stop:${id}`);
}

/** Release spawn deny when aborting a persisted orphan run (no live runOfficeProject lifecycle). */
export async function releaseOfficeSpawnDenyForOrphanedProjectAbort(
  projectId: string,
): Promise<void> {
  const { isOfficeProjectRunLifecycleActive, notifyOfficeProjectRunStopped } = await import(
    './office-sync-runtime'
  );
  if (isOfficeProjectRunLifecycleActive(projectId)) return;
  await releaseOfficeSpawnDenyAfterRun(projectId);
  notifyOfficeProjectRunStopped(projectId);
}

export function registerOfficeSpawnPolicyQuiescedHook(): void {
  void import('./office-sync-runtime')
    .then(({ onOfficeExecutionQuiesced }) => {
      onOfficeExecutionQuiesced(() => {
        void reconcileOfficeSpawnToolPolicy('execution:quiesced');
      });
    })
    .catch(() => undefined);
}
