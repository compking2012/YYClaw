import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import {
  canonicalSkillKeyFromRecord,
  directoryContainsSkillManifest,
  listLocalSkills,
  type LocalSkillRecord,
} from '../services/skills/local-skill-service';
import { extractAgentWorkspacesForSkillScan } from './agent-workspaces';
import {
  applyBatchSkillAgentsMapping,
  applyPerAgentWorkspaceSkillAllowlistPatches,
  listAgentsSnapshotReadOnly,
  type AgentSummary,
  type AgentWorkspaceSkillAllowlistPatch,
} from './agent-config';
import { expandPath } from './paths';
import { readDefaultAgentSkillsFromConfig } from './global-agent-skills';
import { readOpenClawConfig } from './channel-config';
import {
  buildGlobalCanonicalSkillIdSet,
  resolveCanonicalSkillId,
} from './skill-agent-mapping';
import { buildSkillAliasToCanonicalIdMap } from './skill-entries-sync';
import { logger } from './logger';
import { WORKSPACE_DISK_SKILL_RECONCILE_ENABLED } from '../services/skills/skill-scan-policy';

type AgentWorkspaceEntry = Pick<AgentSummary, 'id' | 'workspace' | 'skills'>;

const MAIN_AGENT_ID = 'main';
const DEFAULT_MAIN_WORKSPACE_PATH = '~/.openclaw/workspace';

let reconcileDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingReconcileReason = '';

export function findWorkspaceSkillDirBySlug(
  agent: Pick<AgentWorkspaceEntry, 'id' | 'workspace'>,
  slug: string,
  exists: (path: string) => boolean = existsSync,
): string | null {
  const trimmed = slug.trim();
  if (!trimmed) return null;

  for (const skillsRoot of getAgentWorkspaceSkillScanRoots(agent)) {
    const candidate = normalizeSkillFilesystemPath(join(skillsRoot, trimmed));
    if (!candidate || !exists(candidate)) continue;
    return candidate;
  }
  return null;
}

export type WorkspaceSkillInstallSyncHints = {
  baseDir?: string;
  workspace?: string;
  sessionAgentId?: string;
  slug?: string;
  name?: string;
};

export function normalizeSkillFilesystemPath(value?: string): string {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  return resolve(expandPath(trimmed));
}

export function getAgentWorkspaceSkillsRoot(workspace?: string): string {
  return join(expandPath(workspace || ''), 'skills');
}

/**
 * Workspace skill scan roots for an agent. Main agent may install to legacy
 * `~/.openclaw/workspace-main/skills` while config still points at `~/.openclaw/workspace`.
 */
export function getAgentWorkspaceSkillScanRoots(
  entry: Pick<AgentWorkspaceEntry, 'id' | 'workspace'>,
): string[] {
  const primary = normalizeSkillFilesystemPath(getAgentWorkspaceSkillsRoot(entry.workspace));
  const roots: string[] = [];
  if (primary) roots.push(primary);

  if (entry.id !== MAIN_AGENT_ID) return roots;

  const configured = normalizeSkillFilesystemPath(entry.workspace || DEFAULT_MAIN_WORKSPACE_PATH);
  const defaultMain = normalizeSkillFilesystemPath(DEFAULT_MAIN_WORKSPACE_PATH);
  const legacyRoot = normalizeSkillFilesystemPath(
    getAgentWorkspaceSkillsRoot(`~/.openclaw/workspace-${MAIN_AGENT_ID}`),
  );
  if (configured === defaultMain && legacyRoot && !roots.includes(legacyRoot)) {
    roots.push(legacyRoot);
  }
  return roots;
}

export function isPathUnderWorkspaceSkills(skillPath: string, workspace?: string): boolean {
  const normalizedSkill = normalizeSkillFilesystemPath(skillPath);
  const skillsRoot = normalizeSkillFilesystemPath(getAgentWorkspaceSkillsRoot(workspace));
  if (!normalizedSkill || !skillsRoot) return false;
  if (normalizedSkill === skillsRoot) return true;
  const rel = relative(skillsRoot, normalizedSkill);
  return rel !== '' && !rel.startsWith('..') && !rel.split(/[\\/]/).includes('..');
}

export function isPathUnderAnyAgentWorkspaceSkills(
  skillPath: string,
  entries: AgentWorkspaceEntry[],
): boolean {
  return entries.some((entry) =>
    getAgentWorkspaceSkillScanRoots(entry).some((skillsRoot) => {
      const normalizedSkill = normalizeSkillFilesystemPath(skillPath);
      if (!normalizedSkill || !skillsRoot) return false;
      if (normalizedSkill === skillsRoot) return true;
      const rel = relative(skillsRoot, normalizedSkill);
      return rel !== '' && !rel.startsWith('..') && !rel.split(/[\\/]/).includes('..');
    }),
  );
}

/** Resolve agent id when `pathValue` points at `<workspace>/skills` or a skill dir beneath it. */
export function resolveAgentIdFromWorkspaceSkillsPath(
  pathValue: string,
  entries: AgentWorkspaceEntry[],
): string | null {
  const normalized = normalizeSkillFilesystemPath(pathValue);
  if (!normalized) return null;

  for (const entry of entries) {
    for (const skillsRoot of getAgentWorkspaceSkillScanRoots(entry)) {
      if (normalized === skillsRoot) return entry.id;
      const rel = relative(skillsRoot, normalized);
      if (rel && !rel.startsWith('..') && !rel.split(/[\\/]/).includes('..')) {
        return entry.id;
      }
    }
  }
  return null;
}

export function inferAgentIdForSkillInstall(
  entries: AgentWorkspaceEntry[],
  hints: WorkspaceSkillInstallSyncHints,
): string | null {
  const pathHint = (hints.baseDir || hints.workspace || '').trim();
  if (pathHint) {
    const fromSkillsPath = resolveAgentIdFromWorkspaceSkillsPath(pathHint, entries);
    if (fromSkillsPath) return fromSkillsPath;

    const normalizedHint = normalizeSkillFilesystemPath(pathHint);
    for (const entry of entries) {
      const workspace = normalizeSkillFilesystemPath(entry.workspace);
      if (workspace && workspace === normalizedHint) {
        return entry.id;
      }
    }
  }

  const sessionAgentId = (hints.sessionAgentId || '').trim();
  if (sessionAgentId && entries.some((entry) => entry.id === sessionAgentId)) {
    return sessionAgentId;
  }
  return null;
}

export function verifyWorkspaceSkillInstallConsistency(
  actualBaseDir: string,
  inferredAgentId: string,
  entries: AgentWorkspaceEntry[],
): boolean {
  const agentFromPath = resolveAgentIdFromWorkspaceSkillsPath(actualBaseDir, entries);
  return agentFromPath === inferredAgentId;
}

async function listWorkspaceSkillDirs(skillsRoot: string): Promise<string[]> {
  const resolved = normalizeSkillFilesystemPath(skillsRoot);
  if (!resolved || !existsSync(resolved)) return [];

  const entries = await readdir(resolved, { withFileTypes: true });
  const dirs: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    if (!entry.isDirectory()) continue;
    const dir = join(resolved, entry.name);
    if (await directoryContainsSkillManifest(dir)) {
      dirs.push(dir);
    }
  }
  return dirs;
}

function buildBaseDirToCanonicalMap(localSkills: LocalSkillRecord[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const skill of localSkills) {
    if (!skill.baseDir) continue;
    map.set(normalizeSkillFilesystemPath(skill.baseDir), canonicalSkillKeyFromRecord(skill));
  }
  return map;
}

function buildGlobalManagedSkillCanonicalIds(localSkills: LocalSkillRecord[]): Set<string> {
  const global = new Set<string>();
  for (const skill of localSkills) {
    if (skill.source === 'openclaw-workspace') continue;
    global.add(canonicalSkillKeyFromRecord(skill));
  }
  return global;
}

function countAgentsWithCanonicalSkill(
  entries: AgentWorkspaceEntry[],
  localSkills: LocalSkillRecord[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    for (const skillKey of entry.skills || []) {
      const canonical = resolveCanonicalSkillId(skillKey, localSkills);
      if (!canonical) continue;
      counts.set(canonical, (counts.get(canonical) || 0) + 1);
    }
  }
  return counts;
}

async function buildWorkspaceSkillsByAgent(
  entries: AgentWorkspaceEntry[],
  localSkills: LocalSkillRecord[],
): Promise<Map<string, Set<string>>> {
  const baseDirToCanonical = buildBaseDirToCanonicalMap(localSkills);
  const byAgent = new Map<string, Set<string>>();

  for (const entry of entries) {
    const canonicalIds = new Set<string>();
    for (const skillsRoot of getAgentWorkspaceSkillScanRoots(entry)) {
      const dirs = await listWorkspaceSkillDirs(skillsRoot);
      for (const dir of dirs) {
        const normalized = normalizeSkillFilesystemPath(dir);
        const canonical = baseDirToCanonical.get(normalized)
          || resolveCanonicalSkillId(basename(dir), localSkills);
        if (canonical) canonicalIds.add(canonical);
      }
    }
    byAgent.set(entry.id, canonicalIds);
  }

  return byAgent;
}

export function computePerAgentWorkspaceSkillPatches(
  entries: AgentWorkspaceEntry[],
  diskByAgent: Map<string, Set<string>>,
  localSkills: LocalSkillRecord[],
  globalManagedSkillIds: Set<string>,
  defaultCanonicalIds: Set<string>,
): AgentWorkspaceSkillAllowlistPatch[] {
  // P5 disabled: workspace skill dirs must not drive allowlist add/remove.
  if (!WORKSPACE_DISK_SKILL_RECONCILE_ENABLED) {
    return [];
  }

  const agentsWithSkillCount = countAgentsWithCanonicalSkill(entries, localSkills);
  const patchByAgent = new Map<string, { add: Set<string>; remove: Set<string> }>();

  const ensurePatch = (agentId: string) => {
    if (!patchByAgent.has(agentId)) {
      patchByAgent.set(agentId, { add: new Set(), remove: new Set() });
    }
    return patchByAgent.get(agentId)!;
  };

  for (const entry of entries) {
    const agentId = entry.id;
    const diskIds = diskByAgent.get(agentId) || new Set<string>();
    const currentCanonical = new Set(
      (entry.skills || [])
        .map((skillKey) => resolveCanonicalSkillId(skillKey, localSkills))
        .filter(Boolean),
    );

    for (const canonical of diskIds) {
      if (!currentCanonical.has(canonical)) {
        ensurePatch(agentId).add.add(canonical);
      }
    }

    for (const skillKey of entry.skills || []) {
      const canonical = resolveCanonicalSkillId(skillKey, localSkills);
      if (!canonical) continue;
      if (diskIds.has(canonical)) continue;
      if (globalManagedSkillIds.has(canonical)) continue;
      if (defaultCanonicalIds.has(canonical)) continue;
      if ((agentsWithSkillCount.get(canonical) || 0) > 1) continue;
      ensurePatch(agentId).remove.add(canonical);
    }
  }

  return [...patchByAgent.entries()]
    .map(([agentId, { add, remove }]) => ({
      agentId,
      add: [...add],
      remove: [...remove],
    }))
    .filter((patch) => patch.add.length > 0 || patch.remove.length > 0);
}

async function buildDefaultCanonicalSkillIds(
  localSkills: LocalSkillRecord[],
): Promise<Set<string>> {
  const config = await readOpenClawConfig();
  const aliasToId = buildSkillAliasToCanonicalIdMap(localSkills);
  return buildGlobalCanonicalSkillIdSet(
    readDefaultAgentSkillsFromConfig(config),
    aliasToId,
  );
}

type WorkspaceAgentSkillsReconcileOptions = {
  /** Debounce delay; gateway-ready hooks use 0, chat/install paths coalesce bursts. */
  delayMs?: number;
};

const CHAT_INSTALL_RETRY_DELAYS_MS = [1500];
const CHAT_UNINSTALL_RETRY_DELAYS_MS = [1500, 3000, 4500];

/** Retry delays after the first reconcile pass finds no changes (chat-run only). */
export function getChatReconcileRetryDelaysMs(reason: string): number[] {
  if (!reason.startsWith('chat-run:')) return [];
  if (/uninstall|filesystem/.test(reason)) {
    return CHAT_UNINSTALL_RETRY_DELAYS_MS;
  }
  return CHAT_INSTALL_RETRY_DELAYS_MS;
}

export async function reconcileWithOptionalChatRetryForReason(
  reason: string,
  reconcile: () => Promise<boolean> = reconcileWorkspaceAgentSkillsOnGatewayReady,
): Promise<boolean> {
  let changed = await reconcile();
  if (changed || !reason.startsWith('chat-run:')) {
    return changed;
  }
  for (const delayMs of getChatReconcileRetryDelaysMs(reason)) {
    await new Promise((resolveDelay) => {
      setTimeout(resolveDelay, delayMs);
    });
    changed = await reconcile();
    if (changed) return true;
  }
  return false;
}

function runWorkspaceAgentSkillsReconcile(reason: string): void {
  void reconcileWithOptionalChatRetryForReason(reason)
    .then((changed) => {
      if (changed) {
        // Gateway watches openclaw.json; no debouncedReload (avoids Windows/full restart).
        logger.info('Workspace agent skills reconcile completed', { reason });
      }
    })
    .catch((error) => {
      logger.warn('Failed to reconcile workspace agent skills', { reason, error });
    });
}

/** Test helper */
export function resetWorkspaceAgentSkillsReconcileScheduleForTests(): void {
  if (reconcileDebounceTimer) {
    clearTimeout(reconcileDebounceTimer);
    reconcileDebounceTimer = null;
  }
  pendingReconcileReason = '';
}

/** Idempotent hook when Gateway becomes ready or after chat skill installs. */
export function scheduleWorkspaceAgentSkillsReconcile(
  reason: string,
  options?: WorkspaceAgentSkillsReconcileOptions,
): void {
  const delayMs = options?.delayMs ?? (reason.startsWith('gateway:') ? 0 : 800);
  pendingReconcileReason = reason;

  if (reconcileDebounceTimer) {
    clearTimeout(reconcileDebounceTimer);
    reconcileDebounceTimer = null;
  }
  if (delayMs <= 0) {
    const runReason = pendingReconcileReason;
    pendingReconcileReason = '';
    runWorkspaceAgentSkillsReconcile(runReason);
    return;
  }
  reconcileDebounceTimer = setTimeout(() => {
    reconcileDebounceTimer = null;
    const runReason = pendingReconcileReason;
    pendingReconcileReason = '';
    runWorkspaceAgentSkillsReconcile(runReason);
  }, delayMs);
}

export async function reconcileWorkspaceAgentSkillsOnGatewayReady(): Promise<boolean> {
  // P5–P7 are no longer skill sources. Do not scan workspace skill dirs or patch
  // agent allowlists from those paths (would reintroduce multi-version coupling).
  if (!WORKSPACE_DISK_SKILL_RECONCILE_ENABLED) {
    return false;
  }

  const snapshot = await listAgentsSnapshotReadOnly();
  const entries = snapshot.agents;
  if (entries.length === 0) return false;

  const agentWorkspaces = extractAgentWorkspacesForSkillScan(entries);
  const localSkills = await listLocalSkills({ agentWorkspaces });
  const diskByAgent = await buildWorkspaceSkillsByAgent(entries, localSkills);
  const globalManagedSkillIds = buildGlobalManagedSkillCanonicalIds(localSkills);
  const defaultCanonicalIds = await buildDefaultCanonicalSkillIds(localSkills);
  const patches = computePerAgentWorkspaceSkillPatches(
    entries,
    diskByAgent,
    localSkills,
    globalManagedSkillIds,
    defaultCanonicalIds,
  );

  if (patches.length === 0) {
    return false;
  }

  await applyPerAgentWorkspaceSkillAllowlistPatches(patches);
  logger.info('Reconciled workspace agent skills after gateway ready', { patches: patches.length });
  return true;
}

function resolveInstalledWorkspaceSkillBaseDir(
  hints: WorkspaceSkillInstallSyncHints,
  agent: AgentWorkspaceEntry,
  entries: AgentWorkspaceEntry[],
): string | null {
  const explicit = (hints.baseDir || '').trim();
  if (explicit) {
    const normalized = normalizeSkillFilesystemPath(explicit);
    if (!existsSync(normalized)) return null;
    if (!isPathUnderAnyAgentWorkspaceSkills(normalized, entries)) return null;
    return normalized;
  }

  const slug = (hints.slug || hints.name || '').trim();
  if (!slug) return null;

  const fromScanRoots = findWorkspaceSkillDirBySlug(agent, slug);
  if (!fromScanRoots) return null;
  if (!isPathUnderAnyAgentWorkspaceSkills(fromScanRoots, entries)) return null;
  return fromScanRoots;
}

export async function tryPostInstallWorkspaceAgentSkillSync(
  hints: WorkspaceSkillInstallSyncHints,
): Promise<boolean> {
  const snapshot = await listAgentsSnapshotReadOnly();
  const entries = snapshot.agents;
  const inferredAgentId = inferAgentIdForSkillInstall(entries, hints);
  if (!inferredAgentId) return false;

  const agent = entries.find((entry) => entry.id === inferredAgentId);
  if (!agent) return false;

  const actualBaseDir = resolveInstalledWorkspaceSkillBaseDir(hints, agent, entries);
  if (!actualBaseDir) return false;

  if (!verifyWorkspaceSkillInstallConsistency(actualBaseDir, inferredAgentId, entries)) {
    logger.info('Skipped workspace skill post-install sync: inferred agent does not match install path', {
      inferredAgentId,
      actualBaseDir,
    });
    return false;
  }

  const localSkills = await listLocalSkills({
    agentWorkspaces: extractAgentWorkspacesForSkillScan(entries),
  });
  const normalizedActual = normalizeSkillFilesystemPath(actualBaseDir);
  const skillRecord = localSkills.find(
    (skill) => normalizeSkillFilesystemPath(skill.baseDir || '') === normalizedActual,
  );
  if (!skillRecord) return false;

  const canonicalId = canonicalSkillKeyFromRecord(skillRecord);
  const assignedAgentIds = entries
    .filter((entry) => (entry.skills || []).some(
      (skillKey) => resolveCanonicalSkillId(skillKey, localSkills) === canonicalId,
    ))
    .map((entry) => entry.id);

  if (assignedAgentIds.includes(inferredAgentId)) {
    return false;
  }

  await applyBatchSkillAgentsMapping([{
    skillId: canonicalId,
    agentIds: [...assignedAgentIds, inferredAgentId],
  }]);
  logger.info('Post-install workspace skill sync wrote agent allowlist', {
    agentId: inferredAgentId,
    skillId: canonicalId,
    baseDir: actualBaseDir,
  });
  return true;
}

export function extractWorkspaceSkillInstallSyncHints(
  payload: Record<string, unknown>,
): WorkspaceSkillInstallSyncHints {
  const readString = (key: string) => (typeof payload[key] === 'string' ? payload[key].trim() : '');
  return {
    baseDir: readString('baseDir') || undefined,
    workspace: readString('workspace') || undefined,
    sessionAgentId: readString('sessionAgentId') || undefined,
    slug: readString('slug') || undefined,
    name: readString('name') || undefined,
  };
}

/**
 * Post-install sync into `<workspace>/skills` / `.agents/skills` is disabled.
 * User installs must land only under `~/.openclaw/skills` (scan policy P1);
 * copying into P5–P7 recreated multi-version duplicates.
 */
export async function runPostInstallWorkspaceAgentSkillSyncFromPayload(
  _payload: unknown,
): Promise<boolean> {
  void _payload;
  return false;
}
