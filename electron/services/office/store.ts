import { readdir, readFile, rename, rm, unlink, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  OfficeDataStore,
  OfficeFixedGroup,
  OfficeSnapshot,
  OfficeTempProject,
  LangGraphWorkflowBundle,
  RoomMessage,
  WorkflowDefinition,
} from './types';
import {
  migrateLangGraphBundleFromWorkflow,
  normalizeLangGraphWorkflowBundle,
} from '../../../src/lib/office-langgraph-workflow-bundle';
import { resolveWorkflowEngineInput } from '@/lib/feature-langgraph';
import { mergeCompletionFollowUpFields, normalizeCompletionTimestamp, completionFollowUpDismissStamp } from '../../../src/lib/office-project-completion-follow-up';
import {
  childInheritsGroupTemplate,
  convertGroupChildProjectToStandalone,
  groupChildWorkflowFieldsAfterGroupUpdate,
  promoteOrphanGroupChildToStandalone,
} from '../../../src/lib/office-task-workflow';
import {
  materializeOwnedWorkflowPayload,
  noOwnWorkflowPersistFields,
  projectOwnsWorkflow,
  spawnedWorkflowDirtyVsGroup,
  shouldReapplyTerminalWorkflowFreezeOnUpsert,
  withTerminalWorkflowFreeze,
} from '../../../src/lib/office-spawned-workflow-ownership';
import { orchestrationModeFromGroup, orchestrationModeFromProject } from '../../../src/lib/office-workflow-orchestration-mode';
import {
  projectProgressFromTempProject,
  type OfficeProjectProgress,
} from '../../../src/lib/office-project-progress';
import { spawnedProjectOrchestrationModeLocked } from '../../../src/lib/office-fixed-group';
import {
  buildSpawnedProjectAgentSyncNotice,
  type SpawnedProjectAgentSyncNotice,
} from '../../../src/lib/office-spawned-project-agent-sync';
import { trimWorkflowStepDraftRows } from '../../../src/lib/office-workflow-step-drafts';
import {
  remapFixedGroupAgentIds,
  remapTempProjectAgentIds,
} from '../../../src/lib/office-agent-id-remap';
import { stampAgentNameHints } from '../../../src/lib/office-missing-agents';
import { isOfficeProjectExecuting } from '../../../src/lib/office-room-sidebar';
import { settleWorkflowNodeRunsAfterStop } from '../../../src/lib/office-workflow-abort';
import { ensureOfficeDirs, getOfficeDataDir, getOfficeDataPath } from './paths';
import { taskRoomSessionKey } from './session-keys';
import {
  assertAgentsIdle,
  assertAgentsSubsetOfGroup,
  assertAgentsAvailableForProjectRerun,
  assertCoordinatorInTeam,
  assertGroupCanDelete,
  assertGroupCanEdit,
  assertGroupCanSpawnProject,
  assertProjectCanDissolve,
  assertProjectNotArchived,
  isTempProjectArchived,
  prepareArchivedProjectForRestart,
  reactivateArchivedProjectRecord,
  rebuildAgentBindings,
  validateArchivedProjectRestart,
  assertOfficeEntityAgentsExist,
  AgentBindingError,
} from './agent-binding';
import { isOfficeStandaloneUpgradeEligible } from '../../../src/lib/office-project-lifecycle';
import { linkStandaloneProjectToFixedGroupSpawn } from '../../../src/lib/office-standalone-group-link';
import { shouldPreserveChildProjectNodeRunsOnGroupSync } from '../../../src/lib/office-project-archive';
import { ensureCoordinatorInTeam } from '../../../src/lib/office-workflow-roles';
import { officeGroupManifestPath, officeGroupRoot } from './office-group-paths';
import { resetProjectContextForProject } from './project-context-reset';
import {
  defaultWorkflowForRoles,
  fixedGroupToScenario,
  migrateLegacyStoreToV2,
  rolesFromStore,
  taskToTempProject,
  tempProjectToTask,
} from './store-legacy';
import { membersForAgentIds } from './office-member-resolve';
import type { ProjectAgentRef } from '../../../src/lib/office-workflow-node';

const DEFAULT_STORE: OfficeDataStore = {
  version: 2,
  fixedGroups: [],
  tempProjects: [],
  agentBindings: {},
  roomMessages: {},
  settings: {
    agentToAgentEnabled: false,
    agentToAgentAllow: [],
  },
};

let cache: OfficeDataStore | null = null;
let storeOpChain: Promise<unknown> = Promise.resolve();
/** 磁盘写入与 withOfficeStoreOp 队列独立：op 在 await 外部 I/O 时会释放队列，须串行化 persist。 */
let persistStoreChain: Promise<void> = Promise.resolve();
/** 避免 archive→abort→upsert 等同链嵌套 withOfficeStoreOp 时死锁。 */
let storeOpDepth = 0;

function withOfficeStoreOp<T>(fn: () => Promise<T>): Promise<T> {
  if (storeOpDepth > 0) {
    return fn();
  }
  const run = async (): Promise<T> => {
    storeOpDepth += 1;
    try {
      return await fn();
    } catch (err) {
      cache = null;
      throw err;
    } finally {
      storeOpDepth -= 1;
    }
  };
  const next = storeOpChain.then(run, run);
  storeOpChain = next.then(
    () => undefined,
    (err) => {
      console.warn('[office] store operation failed:', err);
      return undefined;
    },
  );
  return next;
}

function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function emptyWorkflow(): WorkflowDefinition {
  return { mode: 'dag', nodes: [], edges: [] };
}

export function normalizeTempProjectRecord(project: OfficeTempProject): OfficeTempProject {
  const executionMode = project.executionMode === 'smart' ? 'smart' : 'workflow';
  const workflowEngine = resolveWorkflowEngineInput(executionMode, project.workflowEngine);
  const smartRevivedAt =
    executionMode === 'smart'
      && typeof project.smartRevivedAt === 'number'
      && Number.isFinite(project.smartRevivedAt)
      && project.smartRevivedAt > 0
      ? project.smartRevivedAt
      : undefined;
  const archivedRestartedAt =
    typeof project.archivedRestartedAt === 'number'
      && Number.isFinite(project.archivedRestartedAt)
      && project.archivedRestartedAt > 0
      ? project.archivedRestartedAt
      : undefined;
  let langGraphWorkflowBundle =
    workflowEngine === 'langgraph'
      ? normalizeLangGraphWorkflowBundle(project.langGraphWorkflowBundle)
      : undefined;
  const executionWorkflow =
    executionMode === 'smart'
      ? emptyWorkflow()
      : project.workflow
        ? { ...project.workflow, mode: 'dag' as const }
        : emptyWorkflow();
  if (
    executionMode === 'workflow'
    && workflowEngine === 'langgraph'
    && !langGraphWorkflowBundle
    && executionWorkflow.nodes.length > 0
  ) {
    langGraphWorkflowBundle = migrateLangGraphBundleFromWorkflow(
      executionWorkflow,
      project.description ?? '',
    );
  }
  return {
    ...project,
    title: typeof project.title === 'string' ? project.title.trim() : '',
    origin: project.origin === 'fixed_group' ? 'fixed_group' : 'standalone',
    lifecycle: project.lifecycle ?? 'active',
    executionMode,
    workflowEngine,
    smartRevivedAt,
    archivedRestartedAt,
    lastRunCompletedAt: normalizeCompletionTimestamp(project.lastRunCompletedAt),
    completionFollowUpHandledAt: normalizeCompletionTimestamp(project.completionFollowUpHandledAt),
    featureDescription: typeof project.featureDescription === 'string' ? project.featureDescription : '',
    description: typeof project.description === 'string' ? project.description : '',
    workflowStepDrafts: trimWorkflowStepDraftRows(project.workflowStepDrafts ?? []).length > 0
      ? trimWorkflowStepDraftRows(project.workflowStepDrafts ?? [])
      : undefined,
    agentIds: Array.isArray(project.agentIds) ? project.agentIds : [],
    coordinatorAgentId: project.coordinatorAgentId?.trim() ?? '',
    nodeRuns: Array.isArray(project.nodeRuns) ? project.nodeRuns : [],
    langGraphWorkflowBundle,
    workflow: executionWorkflow,
    inheritsGroupTemplate: project.inheritsGroupTemplate,
    workflowFreezeSnapshot: project.workflowFreezeSnapshot,
  };
}

function attachProjectRoomSessionKey(
  project: OfficeTempProject,
): OfficeTempProject {
  if (project.roomSessionKey?.trim()) return project;
  const coord = project.coordinatorAgentId?.trim();
  if (!coord) return project;
  return { ...project, roomSessionKey: taskRoomSessionKey(coord, project.id) };
}

function syncAgentBindings(store: OfficeDataStore): void {
  store.agentBindings = rebuildAgentBindings(store);
}

function repairOrphanGroupChildProjects(store: OfficeDataStore): boolean {
  const groupIds = new Set(store.fixedGroups.map((g) => g.id));
  let changed = false;
  for (let i = 0; i < store.tempProjects.length; i++) {
    const project = store.tempProjects[i]!;
    const parentId = project.parentGroupId?.trim();
    if (!parentId || groupIds.has(parentId)) continue;
    const converted = promoteOrphanGroupChildToStandalone(project, parentId);
    store.tempProjects[i] = attachProjectRoomSessionKey(normalizeTempProjectRecord(converted));
    changed = true;
  }
  return changed;
}

function normalizeLoadedStore(parsed: Partial<OfficeDataStore>): OfficeDataStore {
  if (parsed.version !== 2) {
    const legacy = parsed as Partial<OfficeDataStore> & LegacyStoreExtra;
    if (
      parsed.version === 1
      || Array.isArray(legacy.roles)
      || Array.isArray(legacy.scenarios)
      || Array.isArray(legacy.tasks)
    ) {
      return normalizeLoadedStore(migrateLegacyStoreToV2(legacy as never));
    }
    return structuredClone(DEFAULT_STORE);
  }
  const store: OfficeDataStore = {
    ...DEFAULT_STORE,
    ...parsed,
    version: 2,
    fixedGroups: Array.isArray(parsed.fixedGroups) ? parsed.fixedGroups : [],
    tempProjects: Array.isArray(parsed.tempProjects)
      ? parsed.tempProjects.map((p) => attachProjectRoomSessionKey(normalizeTempProjectRecord(p)))
      : [],
    roomMessages: parsed.roomMessages && typeof parsed.roomMessages === 'object' ? parsed.roomMessages : {},
    settings: { ...DEFAULT_STORE.settings, ...(parsed.settings ?? {}) },
    agentBindings: {},
  };
  repairOrphanGroupChildProjects(store);
  syncAgentBindings(store);
  return store;
}

async function parseStoreFile(path: string): Promise<OfficeDataStore | null> {
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, 'utf8');
    if (!raw.trim()) return null;
    return normalizeLoadedStore(JSON.parse(raw) as Partial<OfficeDataStore>);
  } catch {
    return null;
  }
}

function isStoreContentEmpty(store: OfficeDataStore): boolean {
  return store.fixedGroups.length === 0 && store.tempProjects.length === 0;
}

/** Declares which entity ids this write intentionally removed (for empty-overwrite checks). */
type PersistStoreOptions = {
  removedProjectIds?: string[];
  removedGroupIds?: string[];
};

/**
 * Allow writing an empty store over a non-empty disk snapshot only when every
 * previous group/project id is explicitly listed in the removal sets for this write.
 * Prevents coarse "allowEmpty" deletes from wiping unrelated entities when cache is stale.
 */
function isIntentionalEmptyOverwrite(
  previous: OfficeDataStore,
  removed: { projectIds: string[]; groupIds: string[] },
): boolean {
  const removedProjects = new Set(removed.projectIds);
  const removedGroups = new Set(removed.groupIds);
  return (
    previous.tempProjects.every((p) => removedProjects.has(p.id))
    && previous.fixedGroups.every((g) => removedGroups.has(g.id))
  );
}

const DATA_JSON_TMP_STALE_MS = 120_000;

async function cleanupStaleDataJsonTempFiles(): Promise<void> {
  const dir = getOfficeDataDir();
  if (!existsSync(dir)) return;
  const entries = await readdir(dir);
  const now = Date.now();
  const currentPid = String(process.pid);
  await Promise.all(
    entries
      .filter((name) => name.startsWith('data.json.') && name.endsWith('.tmp'))
      .map(async (name) => {
        const match = /^data\.json\.(\d+)\.(\d+)\.tmp$/.exec(name);
        if (match) {
          const filePid = match[1]!;
          const writtenAt = Number(match[2]!);
          // 勿删除本进程正在 rename 的临时文件（load 与 persist 并发时曾导致 ENOENT）。
          if (filePid === currentPid) return;
          if (Number.isFinite(writtenAt) && now - writtenAt < DATA_JSON_TMP_STALE_MS) return;
        }
        await unlink(join(dir, name)).catch(() => { });
      }),
  );
}

async function loadStoreFromDisk(): Promise<OfficeDataStore> {
  await ensureOfficeDirs();
  await cleanupStaleDataJsonTempFiles();
  const mainPath = getOfficeDataPath();
  if (!existsSync(mainPath)) {
    cache = structuredClone(DEFAULT_STORE);
    await persistStoreToDisk(cache);
    return cache;
  }
  const loaded = await parseStoreFile(mainPath);
  if (loaded) {
    cache = loaded;
    try {
      const raw = await readFile(mainPath, 'utf8');
      const parsed = JSON.parse(raw) as { version?: number };
      if (parsed.version !== 2) {
        await persistStoreToDisk(loaded);
      }
    } catch {
      // ignore migration persist errors in tests
    }
    return cache;
  }
  console.warn('[office] data.json corrupt; using empty v2 store');
  cache = structuredClone(DEFAULT_STORE);
  return cache;
}

export async function loadStore(): Promise<OfficeDataStore> {
  if (cache) return cache;
  return withOfficeStoreOp(async () => {
    if (cache) return cache;
    cache = await loadStoreFromDisk();
    return cache;
  });
}

function storePayloadForDisk(data: OfficeDataStore): OfficeDataStore {
  return { ...data, roomMessages: {} };
}

function coerceStoreData(data: LegacyStoreInput): OfficeDataStore {
  const migrated = migrateLegacyStoreToV2(data as never);
  return normalizeLoadedStore(migrated);
}

type LegacyStoreExtra = {
  roles?: import('./types').OfficeRole[];
  scenarios?: import('./types').OfficeScenario[];
  tasks?: import('./types').OfficeTask[];
};

type LegacyStoreInput = OfficeDataStore | (Partial<OfficeDataStore> & LegacyStoreExtra);

async function writeStorePayloadToDisk(
  data: LegacyStoreInput,
  opts?: PersistStoreOptions,
): Promise<void> {
  const normalized = coerceStoreData(data);
  await ensureOfficeDirs();
  syncAgentBindings(normalized);
  const mainPath = getOfficeDataPath();
  const payload = JSON.stringify(storePayloadForDisk(normalized), null, 2);
  if (!payload || payload.length < 20) {
    throw new Error('[office] Refusing to save invalid/empty office store payload');
  }
  const previous = await parseStoreFile(mainPath);
  if (previous && !isStoreContentEmpty(previous) && isStoreContentEmpty(normalized)) {
    const intentional = isIntentionalEmptyOverwrite(previous, {
      projectIds: opts?.removedProjectIds ?? [],
      groupIds: opts?.removedGroupIds ?? [],
    });
    if (!intentional) {
      throw new Error('[office] Refusing to overwrite non-empty office data with an empty store');
    }
  }
  const tempPath = `${mainPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, payload, 'utf8');
  await rename(tempPath, mainPath);
}

async function persistStoreToDisk(
  data: LegacyStoreInput,
  opts?: PersistStoreOptions,
): Promise<void> {
  const run = async (): Promise<void> => {
    await writeStorePayloadToDisk(data, opts);
  };
  const next = persistStoreChain.then(run, run);
  persistStoreChain = next.then(
    () => undefined,
    () => undefined,
  );
  await next;
}

export async function saveStore(data: LegacyStoreInput): Promise<void> {
  return withOfficeStoreOp(async () => {
    const normalized = coerceStoreData(data);
    await persistStoreToDisk(normalized);
    cache = normalized;
  });
}

export async function drainOfficeStoreOpsForTests(): Promise<void> {
  await storeOpChain;
  await persistStoreChain;
}

export function clearOfficeStoreCacheForTests(): void {
  cache = null;
}

async function ensureStoreCache(): Promise<OfficeDataStore> {
  if (!cache) cache = await loadStoreFromDisk();
  return cache;
}

export async function getSnapshot(): Promise<OfficeSnapshot> {
  const s = cache ?? (await loadStore());
  syncAgentBindings(s);
  return {
    fixedGroups: await listFixedGroups(),
    tempProjects: s.tempProjects.map((p) => normalizeTempProjectRecord(p)),
    agentBindings: s.agentBindings,
    settings: s.settings,
  };
}

function compareGroupsBySequence(a: OfficeFixedGroup, b: OfficeFixedGroup): number {
  const sa = a.sequence ?? Number.MAX_SAFE_INTEGER;
  const sb = b.sequence ?? Number.MAX_SAFE_INTEGER;
  if (sa !== sb) return sa - sb;
  return a.createdAt - b.createdAt;
}

export async function listFixedGroups(): Promise<OfficeFixedGroup[]> {
  const s = await loadStore();
  return [...s.fixedGroups].sort(compareGroupsBySequence);
}

export async function getFixedGroup(groupId: string): Promise<OfficeFixedGroup | undefined> {
  const s = await loadStore();
  return s.fixedGroups.find((g) => g.id === groupId);
}

/**
 * After OpenClaw agent id rename (slugify on display-name change), rewrite all Office
 * references so fixed groups / projects / workflow drafts stay selectable.
 */
export async function remapOfficeAgentIdReferences(
  oldIdInput: string,
  newIdInput: string,
): Promise<{ groups: number; projects: number }> {
  const oldId = oldIdInput.trim();
  const newId = newIdInput.trim();
  if (!oldId || !newId || oldId === newId) {
    return { groups: 0, projects: 0 };
  }
  return withOfficeStoreOp(async () => {
    const s = await ensureStoreCache();
    let groups = 0;
    let projects = 0;
    s.fixedGroups = s.fixedGroups.map((g) => {
      const next = remapFixedGroupAgentIds(g, oldId, newId);
      if (JSON.stringify(next) !== JSON.stringify(g)) groups += 1;
      return next;
    });
    s.tempProjects = s.tempProjects.map((p) => {
      const next = remapTempProjectAgentIds(p, oldId, newId);
      if (JSON.stringify(next) !== JSON.stringify(p)) projects += 1;
      return next;
    });
    syncAgentBindings(s);
    await persistStoreToDisk(s);
    for (const group of s.fixedGroups) {
      try {
        await persistGroupManifest(group);
      } catch (err) {
        console.warn('[office] persist group manifest after agent id remap failed:', group.id, err);
      }
    }
    if (groups > 0 || projects > 0) {
      console.info(
        `[office] remapped agent id ${oldId} → ${newId} (groups=${groups}, projects=${projects})`,
      );
    }
    return { groups, projects };
  });
}

async function persistGroupManifest(group: OfficeFixedGroup): Promise<void> {
  const root = officeGroupRoot(group.name, group.id);
  await mkdir(root, { recursive: true });
  const manifest = {
    id: group.id,
    name: group.name,
    description: group.description ?? '',
    agentIds: group.agentIds,
    coordinatorAgentId: group.coordinatorAgentId,
    executionMode: group.executionMode === 'smart' ? 'smart' : 'workflow',
    workflow: group.workflow,
    workflowDescription: group.workflowDescription,
    workflowStepDrafts: group.workflowStepDrafts,
    workflowOrchestrationMode: group.workflowOrchestrationMode,
    updatedAt: group.updatedAt,
  };
  await writeFile(officeGroupManifestPath(group.name, group.id), JSON.stringify(manifest, null, 2), 'utf8');
}

function syncInheritingGroupChildProjects(
  group: OfficeFixedGroup,
  prevGroup: OfficeFixedGroup,
  store: OfficeDataStore,
): void {
  for (let i = 0; i < store.tempProjects.length; i++) {
    const project = store.tempProjects[i]!;
    if (project.parentGroupId !== group.id) continue;
    if (!childInheritsGroupTemplate(project, prevGroup)) continue;
    const workflowFields = groupChildWorkflowFieldsAfterGroupUpdate(project, group);
    const runningActive =
      project.status === 'running'
      && (project.lifecycle ?? 'active') === 'active';
    store.tempProjects[i] = attachProjectRoomSessionKey(
      normalizeTempProjectRecord(
        runningActive
          ? {
              ...project,
              ...workflowFields,
              nodeRuns: shouldPreserveChildProjectNodeRunsOnGroupSync(project)
                ? project.nodeRuns
                : [],
              updatedAt: Date.now(),
            }
          : {
              ...project,
              ...workflowFields,
              agentIds: [...group.agentIds],
              coordinatorAgentId: ensureCoordinatorInTeam(
                group.coordinatorAgentId,
                group.agentIds,
              ),
              nodeRuns: shouldPreserveChildProjectNodeRunsOnGroupSync(project)
                ? project.nodeRuns
                : [],
              updatedAt: Date.now(),
            },
      ),
    );
  }
}

function resolveUpgradeBindingExcludeProjectId(
  store: OfficeDataStore,
  upgradeFromProjectId: string | undefined,
  agentIds: string[],
): string | undefined {
  const trimmed = upgradeFromProjectId?.trim();
  if (!trimmed) return undefined;
  const source = store.tempProjects.find((p) => p.id === trimmed);
  if (!source) throw new Error('项目不存在');
  if (!isOfficeStandaloneUpgradeEligible(source)) {
    throw new AgentBindingError(
      'INVALID_ORIGIN',
      `项目「${source.title}」当前不可升级为固定组`,
    );
  }
  const unknownAgents = agentIds.filter((id) => !source.agentIds.includes(id));
  if (unknownAgents.length > 0) {
    throw new AgentBindingError(
      'AGENT_NOT_IN_GROUP',
      `以下 Agent 不属于源项目「${source.title}」：${unknownAgents.join('、')}`,
    );
  }
  return source.id;
}

function bindUpgradeProjectToGroupInStore(
  s: OfficeDataStore,
  projectId: string,
  group: OfficeFixedGroup,
): OfficeTempProject {
  const idx = s.tempProjects.findIndex((p) => p.id === projectId);
  if (idx < 0) throw new Error('项目不存在');
  const project = s.tempProjects[idx]!;
  if (
    project.origin === 'fixed_group'
    && project.parentGroupId?.trim() === group.id.trim()
  ) {
    return project;
  }
  if (!isOfficeStandaloneUpgradeEligible(project)) {
    if (project.origin !== 'standalone') {
      throw new AgentBindingError('INVALID_ORIGIN', '仅自主创建的项目可升级为固定组');
    }
    if ((project.lifecycle ?? 'active') === 'upgraded') {
      throw new AgentBindingError('PROJECT_ARCHIVED', `项目「${project.title}」已升级为固定组`);
    }
    throw new AgentBindingError('PROJECT_ARCHIVED', `项目「${project.title}」当前状态不可升级`);
  }
  s.tempProjects[idx] = attachProjectRoomSessionKey(
    normalizeTempProjectRecord(linkStandaloneProjectToFixedGroupSpawn(project, group)),
  );
  return s.tempProjects[idx]!;
}

async function withStampedAgentNameHints<T extends {
  agentIds: string[];
  coordinatorAgentId: string;
  workflow?: WorkflowDefinition;
  workflowStepDrafts?: OfficeTempProject['workflowStepDrafts'];
  langGraphWorkflowBundle?: LangGraphWorkflowBundle;
  agentNameHints?: Record<string, string>;
}>(entity: T): Promise<T> {
  try {
    const { readAgentDisplayNamesFromConfig } = await import('../../utils/agent-config');
    const names = await readAgentDisplayNamesFromConfig();
    const agents = [...names.entries()].map(([id, name]) => ({ id, name }));
    return {
      ...entity,
      agentNameHints: stampAgentNameHints(entity, agents, entity.agentNameHints),
    };
  } catch {
    return entity;
  }
}

async function finalizeUpgradeProjectSessionCleanup(project: OfficeTempProject): Promise<void> {
  const { removeOfficeProjectSessionDir } = await import('./office-project-session-dir');
  await removeOfficeProjectSessionDir(project);
}

export async function upsertFixedGroup(
  group: OfficeFixedGroup,
  opts?: { upgradeFromProjectId?: string },
): Promise<OfficeFixedGroup> {
  return withOfficeStoreOp(async () => {
    const s = await ensureStoreCache();
    syncAgentBindings(s);
    const bindingExcludeEntityId = resolveUpgradeBindingExcludeProjectId(
      s,
      opts?.upgradeFromProjectId,
      group.agentIds,
    );
    const bindingAssertOpts = bindingExcludeEntityId
      ? { excludeEntityId: bindingExcludeEntityId }
      : undefined;
    const stamped = await withStampedAgentNameHints(group);
    const idx = s.fixedGroups.findIndex((g) => g.id === stamped.id);
    const isCreate = idx < 0;
    if (isCreate) {
      assertAgentsIdle(stamped.agentIds, s.agentBindings, bindingAssertOpts);
    } else {
      const prev = s.fixedGroups[idx]!;
      assertGroupCanEdit(stamped.id, s.tempProjects);
      const addedAgentIds = stamped.agentIds.filter((id) => !prev.agentIds.includes(id));
      if (addedAgentIds.length > 0) assertAgentsIdle(addedAgentIds, s.agentBindings, bindingAssertOpts);
    }
    assertCoordinatorInTeam(stamped.coordinatorAgentId, stamped.agentIds);
    stamped.updatedAt = Date.now();
    if (idx >= 0) {
      const prev = s.fixedGroups[idx]!;
      s.fixedGroups[idx] = stamped;
      syncInheritingGroupChildProjects(stamped, prev, s);
    } else {
      stamped.createdAt = stamped.createdAt || Date.now();
      if (!stamped.id) stamped.id = nextId('group');
      const maxSeq = s.fixedGroups.reduce((m, g) => Math.max(m, g.sequence ?? 0), 0);
      stamped.sequence = maxSeq + 1;
      s.fixedGroups.push(stamped);
    }
    let upgradedProject: OfficeTempProject | undefined;
    if (isCreate && opts?.upgradeFromProjectId?.trim()) {
      upgradedProject = bindUpgradeProjectToGroupInStore(
        s,
        opts.upgradeFromProjectId.trim(),
        stamped,
      );
      syncAgentBindings(s);
    }
    await persistStoreToDisk(s);
    await persistGroupManifest(stamped);
    if (upgradedProject) {
      await finalizeUpgradeProjectSessionCleanup(upgradedProject);
    }
    return stamped;
  });
}

export async function deleteFixedGroup(groupId: string): Promise<void> {
  return withOfficeStoreOp(async () => {
    const s = await ensureStoreCache();
    assertGroupCanDelete(groupId, s.tempProjects);
    const group = s.fixedGroups.find((g) => g.id === groupId);
    const trimmedGroupId = groupId.trim();
    for (let i = 0; i < s.tempProjects.length; i++) {
      const project = s.tempProjects[i]!;
      if (project.parentGroupId?.trim() !== trimmedGroupId) continue;
      const converted = group
        ? convertGroupChildProjectToStandalone(project, group)
        : promoteOrphanGroupChildToStandalone(project, trimmedGroupId);
      s.tempProjects[i] = attachProjectRoomSessionKey(
        normalizeTempProjectRecord(converted),
      );
    }
    s.fixedGroups = s.fixedGroups.filter((g) => g.id !== groupId);
    syncAgentBindings(s);
    await persistStoreToDisk(s, { removedGroupIds: [groupId] });
  });
}

export async function reorderFixedGroups(orderedIds: string[]): Promise<OfficeFixedGroup[]> {
  return withOfficeStoreOp(async () => {
    const s = await ensureStoreCache();
    if (orderedIds.length !== s.fixedGroups.length) throw new Error('orderedIds length mismatch');
    const idSet = new Set(s.fixedGroups.map((g) => g.id));
    if (!orderedIds.every((id) => idSet.has(id))) throw new Error('unknown group id');
    const now = Date.now();
    for (let i = 0; i < orderedIds.length; i++) {
      const idx = s.fixedGroups.findIndex((g) => g.id === orderedIds[i]);
      if (idx >= 0) s.fixedGroups[idx] = { ...s.fixedGroups[idx]!, sequence: i + 1, updatedAt: now };
    }
    await persistStoreToDisk(s);
    return [...s.fixedGroups].sort(compareGroupsBySequence);
  });
}

function compareProjectsBySequence(a: OfficeTempProject, b: OfficeTempProject): number {
  const sa = a.sequence ?? Number.MAX_SAFE_INTEGER;
  const sb = b.sequence ?? Number.MAX_SAFE_INTEGER;
  if (sa !== sb) return sa - sb;
  return a.createdAt - b.createdAt;
}

export async function listTempProjects(opts?: {
  parentGroupId?: string;
  standaloneOnly?: boolean;
}): Promise<OfficeTempProject[]> {
  const s = await loadStore();
  let list = s.tempProjects.map((p) => normalizeTempProjectRecord(p));
  if (opts?.parentGroupId) {
    list = list.filter((p) => p.parentGroupId === opts.parentGroupId);
  }
  if (opts?.standaloneOnly) {
    list = list.filter((p) => p.origin === 'standalone');
  }
  return list.sort(compareProjectsBySequence);
}

export async function getTempProject(projectId: string): Promise<OfficeTempProject | undefined> {
  const s = await loadStore();
  const p = s.tempProjects.find((t) => t.id === projectId);
  return p ? normalizeTempProjectRecord(p) : undefined;
}

async function ensureProjectDir(project: OfficeTempProject): Promise<OfficeTempProject> {
  const { recordProjectRootAtStart } = await import('./project-context-paths');
  const root = await recordProjectRootAtStart(project);
  return { ...project, projectRootPath: root };
}

function notifyRendererProjectProgress(project: OfficeTempProject): void {
  void import('../../utils/broadcast-renderer').then(({ broadcastToRenderer }) => {
    broadcastToRenderer('office:project-progress', projectProgressFromTempProject(project));
  });
}

/** Push full progress slice to renderer (e.g. abortQuiescing cleared). */
export function notifyRendererProjectProgressUpdate(project: OfficeTempProject): void {
  notifyRendererProjectProgress(project);
}

export async function getProjectProgress(projectId: string): Promise<OfficeProjectProgress | null> {
  const project = await getTempProject(projectId);
  if (!project) return null;
  return projectProgressFromTempProject(project);
}

/** Runner / reconcile progress writes — skip silently when the project is already archived. */
export async function persistTempProjectProgress(
  project: OfficeTempProject,
): Promise<OfficeTempProject> {
  const before = await getTempProject(project.id);
  if (before) {
    const { isTaskUserAborted } = await import('./task-run-abort-registry');
    const { isAbortQuiescing } = await import('./project-abort-quiesce');
    const { shouldBlockOfficeProgressWriteDuringAbort } = await import(
      '../../../src/lib/office-workflow-abort'
    );
    if (
      shouldBlockOfficeProgressWriteDuringAbort({
        before,
        next: project,
        userAborted: isTaskUserAborted(project.id),
        memoryQuiescing: isAbortQuiescing(project.id),
      })
    ) {
      return before;
    }
  }
  // Runner in-memory task often omits abortQuiescing; never wipe Main abort metadata.
  const merged: OfficeTempProject = {
    ...project,
    abortQuiescing: project.abortQuiescing ?? before?.abortQuiescing,
    abortGeneration: project.abortGeneration ?? before?.abortGeneration,
    abortQuiesceStartedAt: project.abortQuiesceStartedAt ?? before?.abortQuiesceStartedAt,
  };
  const saved = await upsertTempProject(merged, { ifArchived: 'ignore' });
  const beforeSig = before
    ? JSON.stringify(projectProgressFromTempProject(before))
    : null;
  const savedSig = JSON.stringify(projectProgressFromTempProject(saved));
  if (beforeSig !== savedSig) {
    notifyRendererProjectProgress(saved);
  }
  return saved;
}

export async function upsertTempProject(
  project: OfficeTempProject,
  options?: { ifArchived?: 'reject' | 'ignore' },
): Promise<OfficeTempProject> {
  return withOfficeStoreOp(async () => {
    const s = await ensureStoreCache();
    const stamped = await withStampedAgentNameHints(project);
    const normalized = attachProjectRoomSessionKey(normalizeTempProjectRecord(stamped));
    const idx = s.tempProjects.findIndex((p) => p.id === stamped.id);
    const previous = idx >= 0 ? s.tempProjects[idx] : null;

    // Never let a stale runner snapshot wipe abort-quiesce metadata or revive to running.
    try {
      const { isTaskUserAborted } = await import('./task-run-abort-registry');
      const { isAbortQuiescing } = await import('./project-abort-quiesce');
      const { shouldBlockOfficeProgressWriteDuringAbort } = await import(
        '../../../src/lib/office-workflow-abort'
      );
      if (
        previous
        && shouldBlockOfficeProgressWriteDuringAbort({
          before: previous,
          next: normalized,
          userAborted: isTaskUserAborted(normalized.id),
          memoryQuiescing: isAbortQuiescing(normalized.id),
        })
      ) {
        return previous;
      }
    } catch {
      // keep writing if guard modules fail to load
    }

    const withAbortMeta: OfficeTempProject = {
      ...normalized,
      abortQuiescing: normalized.abortQuiescing ?? previous?.abortQuiescing,
      abortGeneration: normalized.abortGeneration ?? previous?.abortGeneration,
      abortQuiesceStartedAt: normalized.abortQuiesceStartedAt ?? previous?.abortQuiesceStartedAt,
    };
    // Global terminal freeze: no-own completed snapshots the group.
    // failed/aborted follow live group — drop leftover freeze so disk matches.
    // Rerun align may clear freeze while status is still completed — do not rebuild
    // from live group (that would replace the completion-time snapshot).
    let withTerminalFreeze = withAbortMeta;
    if (
      (withAbortMeta.status === 'aborted' || withAbortMeta.status === 'failed')
      && withAbortMeta.workflowFreezeSnapshot
      && !projectOwnsWorkflow(withAbortMeta)
    ) {
      withTerminalFreeze = { ...withAbortMeta, workflowFreezeSnapshot: undefined };
    } else if (
      shouldReapplyTerminalWorkflowFreezeOnUpsert(withAbortMeta, previous)
      && withAbortMeta.parentGroupId
    ) {
      const group = s.fixedGroups.find((g) => g.id === withAbortMeta.parentGroupId);
      withTerminalFreeze = withTerminalWorkflowFreeze(withAbortMeta, group);
    }
    const withCompletion = {
      ...withTerminalFreeze,
      ...mergeCompletionFollowUpFields(previous, withTerminalFreeze),
    };
    if (previous && isTempProjectArchived(previous)) {
      if (options?.ifArchived === 'ignore') {
        return previous;
      }
      throw new AgentBindingError('PROJECT_ARCHIVED', `项目「${previous.title}」已归档，不可编辑`);
    }
    const wasActive = previous?.lifecycle === 'active';
    const nowArchived = isTempProjectArchived(withCompletion);
    withCompletion.updatedAt = Date.now();
    const withRoot = await ensureProjectDir(withCompletion);
    if (idx >= 0) s.tempProjects[idx] = withRoot;
    else {
      withRoot.createdAt = withRoot.createdAt || Date.now();
      if (!withRoot.id) withRoot.id = nextId('project');
      s.tempProjects.push(withRoot);
    }
    if (wasActive && nowArchived) {
      syncAgentBindings(s);
    }
    await persistStoreToDisk(s);
    return withRoot;
  });
}

export function createScenarioDraft(params: {
  name: string;
  roleIds: string[];
  coordinatorRoleId: string;
  description?: string;
  workflow?: WorkflowDefinition;
}): import('./types').OfficeScenario {
  const now = Date.now();
  return {
    id: nextId('group'),
    name: params.name.trim(),
    agentIds: params.roleIds,
    coordinatorAgentId: params.coordinatorRoleId,
    roleIds: params.roleIds,
    coordinatorRoleId: params.coordinatorRoleId,
    workflow: params.workflow ?? emptyWorkflow(),
    createdAt: now,
    updatedAt: now,
  };
}

export function createFixedGroupDraft(params: {
  name: string;
  description?: string;
  agentIds: string[];
  coordinatorAgentId: string;
  executionMode?: OfficeFixedGroup['executionMode'];
  workflow?: WorkflowDefinition;
  workflowDescription?: string;
  workflowStepDrafts?: OfficeFixedGroup['workflowStepDrafts'];
  workflowOrchestrationMode?: OfficeFixedGroup['workflowOrchestrationMode'];
}): OfficeFixedGroup {
  const now = Date.now();
  const executionMode = params.executionMode === 'smart' ? 'smart' : 'workflow';
  return {
    id: nextId('group'),
    name: params.name.trim(),
    description: params.description,
    agentIds: params.agentIds,
    coordinatorAgentId: params.coordinatorAgentId,
    executionMode,
    workflow: executionMode === 'smart' ? emptyWorkflow() : params.workflow ?? emptyWorkflow(),
    workflowDescription:
      executionMode === 'smart' ? undefined : params.workflowDescription?.trim() || undefined,
    workflowStepDrafts:
      executionMode === 'smart' ? undefined : params.workflowStepDrafts,
    workflowOrchestrationMode:
      executionMode === 'smart' ? undefined : params.workflowOrchestrationMode,
    createdAt: now,
    updatedAt: now,
  };
}

export function createTempProjectDraft(params: {
  title: string;
  origin: OfficeTempProject['origin'];
  parentGroupId?: string;
  agentIds: string[];
  coordinatorAgentId: string;
  featureDescription?: string;
  description?: string;
  workflowStepDrafts?: OfficeTempProject['workflowStepDrafts'];
  workflowOrchestrationMode?: OfficeTempProject['workflowOrchestrationMode'];
  executionMode?: OfficeTempProject['executionMode'];
  workflowEngine?: OfficeTempProject['workflowEngine'];
  workflow?: WorkflowDefinition;
  langGraphWorkflowBundle?: LangGraphWorkflowBundle;
  inheritsGroupTemplate?: boolean;
  sequence?: number;
}): OfficeTempProject {
  const now = Date.now();
  const executionMode = params.executionMode === 'smart' ? 'smart' : 'workflow';
  const workflowEngine = resolveWorkflowEngineInput(executionMode, params.workflowEngine);
  return normalizeTempProjectRecord({
    id: nextId('project'),
    title: params.title.trim(),
    origin: params.origin,
    parentGroupId: params.parentGroupId,
    agentIds: params.agentIds,
    coordinatorAgentId: params.coordinatorAgentId,
    lifecycle: 'active',
    featureDescription: params.featureDescription ?? '',
    description: params.description ?? '',
    workflowStepDrafts: params.workflowStepDrafts,
    workflowOrchestrationMode: params.workflowOrchestrationMode,
    status: 'pending',
    executionMode,
    workflowEngine,
    workflow: executionMode === 'smart' ? emptyWorkflow() : { ...emptyWorkflow(), ...(params.workflow ?? {}) },
    langGraphWorkflowBundle:
      executionMode === 'workflow' && workflowEngine === 'langgraph'
        ? normalizeLangGraphWorkflowBundle(params.langGraphWorkflowBundle)
        : undefined,
    inheritsGroupTemplate: params.inheritsGroupTemplate,
    nodeRuns: [],
    sequence: params.sequence,
    createdAt: now,
    updatedAt: now,
  });
}

export async function insertStandaloneTempProject(
  params: Omit<Parameters<typeof createTempProjectDraft>[0], 'origin' | 'parentGroupId'>,
): Promise<OfficeTempProject> {
  return withOfficeStoreOp(async () => {
    const s = await ensureStoreCache();
    syncAgentBindings(s);
    const { readAgentIdsFromOpenClawConfig } = await import('../../utils/agent-config');
    const knownAgentIds = await readAgentIdsFromOpenClawConfig();
    assertOfficeEntityAgentsExist(params, knownAgentIds);
    assertAgentsIdle(params.agentIds, s.agentBindings);
    assertCoordinatorInTeam(params.coordinatorAgentId, params.agentIds);
    const project = await ensureProjectDir(
      attachProjectRoomSessionKey(
        createTempProjectDraft({ ...params, origin: 'standalone' }),
      ),
    );
    s.tempProjects.push(project);
    await persistStoreToDisk(s);
    return project;
  });
}

export async function spawnProjectFromGroup(params: {
  groupId: string;
  title: string;
  agentIds?: string[];
  coordinatorAgentId?: string;
  featureDescription: string;
  description?: string;
  workflowStepDrafts?: OfficeTempProject['workflowStepDrafts'];
  workflowOrchestrationMode?: OfficeTempProject['workflowOrchestrationMode'];
  executionMode?: OfficeTempProject['executionMode'];
  workflowEngine?: OfficeTempProject['workflowEngine'];
  workflow?: WorkflowDefinition;
  langGraphWorkflowBundle?: LangGraphWorkflowBundle;
}): Promise<OfficeTempProject> {
  return withOfficeStoreOp(async () => {
    const s = await ensureStoreCache();
    const group = s.fixedGroups.find((g) => g.id === params.groupId);
    if (!group) throw new AgentBindingError('AGENT_NOT_IN_GROUP', '固定组不存在');
    const { readAgentIdsFromOpenClawConfig } = await import('../../utils/agent-config');
    const knownAgentIds = await readAgentIdsFromOpenClawConfig();
    assertOfficeEntityAgentsExist(group, knownAgentIds);
    assertGroupCanSpawnProject(params.groupId, s.tempProjects);
    const agentIds = params.agentIds?.length ? params.agentIds : [...group.agentIds];
    assertAgentsSubsetOfGroup(agentIds, group);
    const coordinatorAgentId = ensureCoordinatorInTeam(
      params.coordinatorAgentId ?? group.coordinatorAgentId,
      agentIds,
    );
    const siblingCount = s.tempProjects.filter((p) => p.parentGroupId === group.id).length;
    const orchestrationLocked = spawnedProjectOrchestrationModeLocked(group);
    const lockedOrchestrationMode = orchestrationLocked
      ? orchestrationModeFromGroup(group)
      : undefined;
    const spawnWorkflow = params.workflow ?? emptyWorkflow();
    // Omitted description / orchestration on spawn means "follow group", not "blank custom".
    const compareDescription = params.description?.trim()
      ? params.description
      : (group.workflowDescription ?? '');
    const compareOrchestrationMode = lockedOrchestrationMode
      ?? params.workflowOrchestrationMode
      ?? group.workflowOrchestrationMode;
    const inheritsGroupTemplate =
      (params.executionMode === 'smart' || group.executionMode === 'smart')
        ? false
        : !spawnedWorkflowDirtyVsGroup(group, {
            executionMode: 'workflow',
            workflowEngine: params.workflowEngine,
            workflow: spawnWorkflow,
            description: compareDescription,
            workflowStepDrafts: params.workflowStepDrafts,
            workflowOrchestrationMode: compareOrchestrationMode,
            agentIds,
            coordinatorAgentId,
            langGraphWorkflowBundle: params.langGraphWorkflowBundle,
          });
    const groupExecutionMode = group.executionMode === 'smart' ? 'smart' : 'workflow';
    const ownedPayload = inheritsGroupTemplate
      ? null
      : materializeOwnedWorkflowPayload({
          workflow: spawnWorkflow,
          description: params.description?.trim()
            ? params.description
            : (group.workflowDescription ?? ''),
          workflowStepDrafts: params.workflowStepDrafts,
          workflowOrchestrationMode: compareOrchestrationMode,
          langGraphWorkflowBundle: params.langGraphWorkflowBundle,
          agentIds,
          coordinatorAgentId,
          group,
        });
    const noOwn = noOwnWorkflowPersistFields();
    const project = await ensureProjectDir(
      attachProjectRoomSessionKey(
        createTempProjectDraft({
          title: params.title,
          origin: 'fixed_group',
          parentGroupId: group.id,
          agentIds: ownedPayload?.agentIds ?? agentIds,
          coordinatorAgentId: ownedPayload?.coordinatorAgentId ?? coordinatorAgentId,
          featureDescription: params.featureDescription,
          description: inheritsGroupTemplate ? (noOwn.description ?? '') : (ownedPayload?.description ?? ''),
          workflowStepDrafts: inheritsGroupTemplate ? undefined : ownedPayload?.workflowStepDrafts,
          workflowOrchestrationMode: inheritsGroupTemplate
            ? undefined
            : ownedPayload?.workflowOrchestrationMode,
          executionMode:
            params.executionMode === 'smart'
              ? 'smart'
              : params.executionMode === 'workflow'
                ? 'workflow'
                : groupExecutionMode,
          workflowEngine: params.workflowEngine,
          workflow: inheritsGroupTemplate ? emptyWorkflow() : ownedPayload?.workflow,
          langGraphWorkflowBundle: inheritsGroupTemplate
            ? undefined
            : ownedPayload?.langGraphWorkflowBundle,
          inheritsGroupTemplate,
          sequence: siblingCount + 1,
        }),
      ),
    );
    s.tempProjects.push(project);
    await persistStoreToDisk(s);
    return project;
  });
}

export async function markProjectRunCompleted(projectId: string): Promise<OfficeTempProject | undefined> {
  const project = await getTempProject(projectId);
  if (!project) return undefined;
  let next: OfficeTempProject = {
    ...project,
    status: 'completed',
    updatedAt: Date.now(),
  };
  const {
    shouldApplyTerminalWorkflowFreeze,
    buildWorkflowFreezeSnapshot,
    noOwnWorkflowPersistFields,
  } = await import('../../../src/lib/office-spawned-workflow-ownership');
  if (shouldApplyTerminalWorkflowFreeze(next)) {
    const s = await ensureStoreCache();
    const group = next.parentGroupId
      ? s.fixedGroups.find((g) => g.id === next.parentGroupId)
      : undefined;
    if (group) {
      next = {
        ...next,
        ...noOwnWorkflowPersistFields(),
        workflowFreezeSnapshot: buildWorkflowFreezeSnapshot({ group }),
      };
    }
  }
  const saved = await upsertTempProject(next);
  const { removeOfficeProjectSessionDir } = await import('./office-project-session-dir');
  await removeOfficeProjectSessionDir(saved);
  return saved;
}

export async function dismissCompletionFollowUp(projectId: string): Promise<OfficeTempProject> {
  return withOfficeStoreOp(async () => {
    const s = await ensureStoreCache();
    const idx = s.tempProjects.findIndex((p) => p.id === projectId);
    if (idx < 0) throw new Error('项目不存在');
    const project = s.tempProjects[idx]!;
    const stamped = attachProjectRoomSessionKey(
      normalizeTempProjectRecord({
        ...project,
        completionFollowUpHandledAt: completionFollowUpDismissStamp(project),
        updatedAt: Date.now(),
      }),
    );
    s.tempProjects[idx] = stamped;
    await persistStoreToDisk(s);
    return stamped;
  });
}

export async function archiveTempProject(projectId: string): Promise<OfficeTempProject> {
  return withOfficeStoreOp(async () => {
    const s = await ensureStoreCache();
    const idx = s.tempProjects.findIndex((p) => p.id === projectId);
    if (idx < 0) throw new Error('项目不存在');
    const project = s.tempProjects[idx]!;
    if (isTempProjectArchived(project)) {
      throw new AgentBindingError('PROJECT_ARCHIVED', `项目「${project.title}」已归档，不可编辑`);
    }
    if (isOfficeProjectExecuting(project)) {
      throw new AgentBindingError(
        'PROJECT_STILL_RUNNING',
        `项目「${project.title}」仍在执行中，请先停止执行再归档`,
      );
    }
    const { resolveProjectArchiveTransition } = await import(
      '../../../src/lib/office-project-archive'
    );
    const transition = resolveProjectArchiveTransition(project);
    const { resolveOfficeTaskAbortMessage } = await import('./task-run-abort-registry');
    const settleReason = resolveOfficeTaskAbortMessage(projectId);
    const settledNodeRuns = project.nodeRuns.some(
      (nr) => nr.status === 'running' || nr.status === 'pending',
    )
      ? settleWorkflowNodeRunsAfterStop(project, settleReason)
      : project.nodeRuns;
    const writeStore = await ensureStoreCache();
    const writeIdx = writeStore.tempProjects.findIndex((p) => p.id === projectId);
    if (writeIdx < 0) throw new Error('项目不存在');
    writeStore.tempProjects[writeIdx] = {
      ...writeStore.tempProjects[writeIdx]!,
      lifecycle: transition.lifecycle,
      status: transition.status,
      nodeRuns: settledNodeRuns,
      updatedAt: Date.now(),
    };
    syncAgentBindings(writeStore);
    await persistStoreToDisk(writeStore);
    const archived = writeStore.tempProjects[writeIdx]!;
    const { removeOfficeProjectSessionDir } = await import('./office-project-session-dir');
    await removeOfficeProjectSessionDir(archived);
    return archived;
  });
}

export type ArchivedProjectRestartResult = {
  project: OfficeTempProject;
  agentSync: SpawnedProjectAgentSyncNotice | null;
};

export async function restartArchivedTempProject(
  projectId: string,
): Promise<ArchivedProjectRestartResult> {
  const preflight = await loadStore();
  syncAgentBindings(preflight);
  const preflightProject = preflight.tempProjects.find((p) => p.id === projectId);
  if (!preflightProject) throw new Error('项目不存在');
  const { readAgentIdsFromOpenClawConfig } = await import('../../utils/agent-config');
  const knownAgentIds = await readAgentIdsFromOpenClawConfig();
  const preparedPreflight = prepareArchivedProjectForRestart(preflightProject, preflight);
  validateArchivedProjectRestart(preparedPreflight, preflight, knownAgentIds);

  return withOfficeStoreOp(async () => {
    const s = await ensureStoreCache();
    syncAgentBindings(s);
    const idx = s.tempProjects.findIndex((p) => p.id === projectId);
    if (idx < 0) throw new Error('项目不存在');
    const beforeRestart = s.tempProjects[idx]!;
    const parentGroup = beforeRestart.parentGroupId
      ? s.fixedGroups.find((g) => g.id === beforeRestart.parentGroupId)
      : undefined;
    const agentSync = buildSpawnedProjectAgentSyncNotice(beforeRestart, parentGroup);
    const project = prepareArchivedProjectForRestart(beforeRestart, s);
    validateArchivedProjectRestart(project, s, knownAgentIds);
    const { clearTaskUserAborted } = await import('./task-run-abort-registry');
    clearTaskUserAborted(projectId);
    s.tempProjects[idx] = attachProjectRoomSessionKey(
      normalizeTempProjectRecord(reactivateArchivedProjectRecord(project)),
    );
    syncAgentBindings(s);
    await persistStoreToDisk(s);
    return { project: s.tempProjects[idx]!, agentSync };
  });
}

export async function markTempProjectUpgraded(
  projectId: string,
  groupId: string,
): Promise<OfficeTempProject> {
  return withOfficeStoreOp(async () => {
    const s = await ensureStoreCache();
    if (!s.fixedGroups.some((g) => g.id === groupId)) {
      throw new Error('固定组不存在');
    }
    const group = s.fixedGroups.find((g) => g.id === groupId)!;
    const upgraded = bindUpgradeProjectToGroupInStore(s, projectId, group);
    syncAgentBindings(s);
    await persistStoreToDisk(s);
    await finalizeUpgradeProjectSessionCleanup(upgraded);
    return upgraded;
  });
}

/** @deprecated Use markProjectRunCompleted; smart completion should not auto-archive. */
export async function markTempProjectCompleted(projectId: string): Promise<OfficeTempProject | undefined> {
  return markProjectRunCompleted(projectId);
}

export async function dissolveTempProject(projectId: string): Promise<OfficeTempProject | undefined> {
  return withOfficeStoreOp(async () => {
    const s = await ensureStoreCache();
    const idx = s.tempProjects.findIndex((p) => p.id === projectId);
    if (idx < 0) return undefined;
    const p = s.tempProjects[idx]!;
    assertProjectCanDissolve(p);
    s.tempProjects[idx] = {
      ...p,
      lifecycle: 'dissolved',
      updatedAt: Date.now(),
    };
    syncAgentBindings(s);
    await persistStoreToDisk(s);
    return s.tempProjects[idx];
  });
}

export async function upgradeTempProjectToGroup(projectId: string): Promise<{
  group: OfficeFixedGroup;
  project: OfficeTempProject;
}> {
  return withOfficeStoreOp(async () => {
    const s = await ensureStoreCache();
    const idx = s.tempProjects.findIndex((p) => p.id === projectId);
    if (idx < 0) throw new Error('项目不存在');
    const project = s.tempProjects[idx]!;
    syncAgentBindings(s);
    assertAgentsIdle(project.agentIds, s.agentBindings, { excludeEntityId: project.id });
    const executionMode = project.executionMode === 'smart' ? 'smart' : 'workflow';
    const orchestrationMode = orchestrationModeFromProject(project);
    const group = createFixedGroupDraft({
      name: '',
      agentIds: [...project.agentIds],
      coordinatorAgentId: project.coordinatorAgentId,
      executionMode,
      workflow: executionMode === 'smart' ? emptyWorkflow() : (project.workflow ?? emptyWorkflow()),
      workflowDescription:
        executionMode === 'workflow' ? (project.description?.trim() || undefined) : undefined,
      workflowStepDrafts:
        executionMode === 'workflow' && orchestrationMode === 'rule'
          ? project.workflowStepDrafts
          : undefined,
      workflowOrchestrationMode:
        executionMode === 'workflow' ? orchestrationMode : undefined,
    });
    const maxSeq = s.fixedGroups.reduce((m, g) => Math.max(m, g.sequence ?? 0), 0);
    group.sequence = maxSeq + 1;
    s.fixedGroups.push(group);
    const upgraded = bindUpgradeProjectToGroupInStore(s, projectId, group);
    syncAgentBindings(s);
    await persistStoreToDisk(s);
    await persistGroupManifest(group);
    await finalizeUpgradeProjectSessionCleanup(upgraded);
    return { group, project: upgraded };
  });
}

export async function deleteTempProject(projectId: string): Promise<void> {
  return withOfficeStoreOp(async () => {
    const s = await ensureStoreCache();
    const project = s.tempProjects.find((p) => p.id === projectId);
    if (!project) return;
    assertProjectNotArchived(project);
    const { removeOfficeProjectSessionDir } = await import('./office-project-session-dir');
    await removeOfficeProjectSessionDir(project);
    s.tempProjects = s.tempProjects.filter((p) => p.id !== projectId);
    delete s.roomMessages[projectId];
    try {
      const { clearProjectRoomMessages } = await import('./project-room-fs');
      await clearProjectRoomMessages(projectId, { wipeAllEpochs: true });
    } catch (err) {
      console.warn('[office] clear project room failed:', projectId, err);
    }
    await persistStoreToDisk(s, { removedProjectIds: [projectId] });
  });
}

/**
 * Delete an ARCHIVED project: remove its on-disk project directory and all generated artifacts
 * (deliverables bundle included), wipe room chat, drop the record, and rebuild agent bindings so
 * the project no longer binds any agent (mainly relevant for standalone/self-built projects).
 */
export async function deleteArchivedTempProject(projectId: string): Promise<void> {
  return withOfficeStoreOp(async () => {
    const s = await ensureStoreCache();
    const project = s.tempProjects.find((p) => p.id === projectId);
    if (!project) return;
    if (!isTempProjectArchived(project)) {
      throw new Error('仅已归档项目可通过此操作删除');
    }

    // 1) 删除项目目录及目录下所有生成物。
    try {
      const { resolveRecordedProjectRoot } = await import('./project-context-paths');
      const { withOfficeProjectDirLock } = await import('./office-project-dir-lock');
      const root = await resolveRecordedProjectRoot(project);
      if (root) {
        await withOfficeProjectDirLock(projectId, async () => {
          await rm(root, { recursive: true, force: true });
        });
      }
    } catch (err) {
      console.warn('[office] delete archived project workspace failed:', projectId, err);
    }
    try {
      const { removeProjectDeliverablesBundle } = await import('./project-deliverables-bundle');
      await removeProjectDeliverablesBundle(project.title, project.id);
    } catch {
      // 交付物打包可能不存在，忽略。
    }

    // 2) 清群聊记录（内存 + 磁盘全 epoch）。
    delete s.roomMessages[projectId];
    try {
      const { clearProjectRoomMessages } = await import('./project-room-fs');
      await clearProjectRoomMessages(projectId, { wipeAllEpochs: true });
    } catch (err) {
      console.warn('[office] clear project room failed:', projectId, err);
    }

    // 3) 删记录并重建 agent 绑定（解除该项目与 agent 的绑定关系）。
    s.tempProjects = s.tempProjects.filter((p) => p.id !== projectId);
    syncAgentBindings(s);
    await persistStoreToDisk(s, { removedProjectIds: [projectId] });
  });
}

export async function clearProjectRoomChat(projectId: string): Promise<void> {
  const s = await loadStore();
  const project = s.tempProjects.find((p) => p.id === projectId);
  if (project) {
    assertProjectNotArchived(project);
  }
  delete s.roomMessages[projectId];
  const { clearProjectRoomMessages } = await import('./project-room-fs');
  await clearProjectRoomMessages(projectId, { wipeAllEpochs: true });
  await saveStore(s);
}

export async function prepareTempProjectForRun(projectId: string): Promise<OfficeTempProject> {
  return withOfficeStoreOp(async () => {
    const s = await ensureStoreCache();
    syncAgentBindings(s);
    const idx = s.tempProjects.findIndex((p) => p.id === projectId);
    if (idx < 0) throw new Error('项目不存在');
    const project = s.tempProjects[idx]!;
    const parentGroup = project.parentGroupId
      ? s.fixedGroups.find((g) => g.id === project.parentGroupId)
      : undefined;
    if (isTempProjectArchived(project)) {
      assertAgentsAvailableForProjectRerun(project, s.agentBindings, parentGroup);
      const { clearTaskUserAborted } = await import('./task-run-abort-registry');
      clearTaskUserAborted(projectId);
      s.tempProjects[idx] = {
        ...project,
        lifecycle: 'active',
        status: 'pending',
        updatedAt: Date.now(),
      };
      syncAgentBindings(s);
      await persistStoreToDisk(s);
      return s.tempProjects[idx]!;
    }
    return project;
  });
}

export async function resetProjectRunState(projectId: string): Promise<void> {
  const { clearProjectAgentNewLedger } = await import('./office-session-new-ledger');
  clearProjectAgentNewLedger(projectId);
  const s = await loadStore();
  const project = s.tempProjects.find((p) => p.id === projectId);
  if (project) {
    if (isTempProjectArchived(project)) {
      throw new AgentBindingError('PROJECT_ARCHIVED', `项目「${project.title}」已归档`);
    }
    project.nodeRuns = [];
    project.workflowRunId = undefined;
    project.smartRevivedAt = undefined;
    project.status = 'pending';
    project.updatedAt = Date.now();
    try {
      await resetProjectContextForProject(project);
    } catch (err) {
      console.warn('[office] reset project context failed:', projectId, err);
    }
  }
  await saveStore(s);
}

export async function clearProjectRunArtifacts(projectId: string): Promise<void> {
  await clearProjectRoomChat(projectId);
  await resetProjectRunState(projectId);
}

/** @deprecated 使用 clearProjectRunArtifacts */
export async function clearTaskRunArtifacts(taskId: string, _scenarioId?: string): Promise<void> {
  await clearProjectRunArtifacts(taskId);
}

/** @deprecated 使用 resetProjectRunState */
export async function resetTaskRunState(taskId: string, _scenarioId?: string): Promise<void> {
  await resetProjectRunState(taskId);
}

export async function getRoomMessages(projectId: string): Promise<RoomMessage[]> {
  const { getProjectRoomMessages } = await import('./project-room-fs');
  return getProjectRoomMessages(projectId);
}

function roomMessageBucketId(
  msg: RoomMessage & { taskId?: string },
): string {
  const pid = (msg.projectId ?? msg.taskId ?? '').trim();
  if (!pid) throw new Error('Room message requires projectId');
  return pid;
}

function coerceRoomMessageForStorage(
  msg: RoomMessage & {
    taskId?: string;
    scenarioId?: string;
    fromRoleId?: string;
  },
): RoomMessage {
  const projectId = roomMessageBucketId(msg);
  const fromAgentId =
    msg.fromAgentId?.trim()
    || msg.fromRoleId?.trim()
    || (typeof msg.from === 'string' && msg.from !== 'user' && msg.from !== 'system'
      ? msg.from.trim()
      : undefined);
  return {
    ...msg,
    projectId,
    groupId: msg.groupId ?? msg.scenarioId,
    fromAgentId: fromAgentId || msg.fromAgentId,
  };
}

async function reconcileProjectProgressAfterRoomWrite(
  groupId: string | undefined,
  projectId: string,
): Promise<void> {
  try {
    const { persistProjectProgressReconciled } = await import('./task-room-progress-reconcile');
    await persistProjectProgressReconciled(groupId, projectId);
  } catch (err) {
    console.warn('[office] project progress reconcile failed:', projectId, err);
  }
}

export type AppendRoomMessageOptions = {
  deferSideEffects?: boolean;
  notifyRenderer?: boolean;
};

function notifyRendererRoomMessageAppended(projectId: string): void {
  void import('../../utils/broadcast-renderer').then(({ broadcastToRenderer }) => {
    broadcastToRenderer('office:room-message-appended', { taskId: projectId, projectId });
  });
}

async function runAppendRoomMessageSideEffects(msg: RoomMessage, bucketId: string): Promise<void> {
  await reconcileProjectProgressAfterRoomWrite(msg.groupId, bucketId);
  try {
    const { tryCompleteSmartProjectAfterRoomMessage } = await import('./smart-task-completion');
    await tryCompleteSmartProjectAfterRoomMessage(msg);
  } catch (err) {
    console.warn('[office] smart project closure after room write failed:', err);
  }
  try {
    const { onRoomMessageWrittenForUnmentionedWatch } = await import('./room-unmentioned-coordinator');
    const { loadProjectExecutionMembers } = await import('./office-execution-members');
    const project = await getTempProject(bucketId);
    if (project) {
      const members = await loadProjectExecutionMembers(project);
      const teamIds = new Set(members.map((m) => m.agentId).filter(Boolean));
      onRoomMessageWrittenForUnmentionedWatch(msg, teamIds);
    }
  } catch (err) {
    console.warn('[office] unmentioned watch cancel after room write failed:', err);
  }
  if (msg.nodeId?.trim() && msg.phase === 'task_handoff') {
    try {
      const { onRoomMessageWrittenForHandoffWatch } = await import('./room-workflow-handoff-watch');
      const { loadProjectExecutionMembers } = await import('./office-execution-members');
      const project = await getTempProject(bucketId);
      if (project) {
        const members = await loadProjectExecutionMembers(project);
        onRoomMessageWrittenForHandoffWatch(msg, members);
      }
    } catch (err) {
      console.warn('[office] handoff watch cancel after room write failed:', err);
    }
  }
}

export async function appendRoomMessage(
  msg: RoomMessage,
  opts?: AppendRoomMessageOptions,
): Promise<RoomMessage> {
  const normalized = coerceRoomMessageForStorage(msg);
  const bucketId = normalized.projectId;
  const { appendProjectRoomMessage } = await import('./project-room-fs');
  const saved = await appendProjectRoomMessage(normalized);
  const notifyRenderer = opts?.notifyRenderer ?? opts?.deferSideEffects === true;
  if (opts?.deferSideEffects) {
    if (notifyRenderer) notifyRendererRoomMessageAppended(bucketId);
    void runAppendRoomMessageSideEffects(saved, bucketId).catch((err) => {
      console.warn('[office] deferred room side effects failed:', bucketId, err);
    });
    return saved;
  }
  await runAppendRoomMessageSideEffects(saved, bucketId);
  if (notifyRenderer) notifyRendererRoomMessageAppended(bucketId);
  return saved;
}

export async function updateRoomMessage(
  projectId: string,
  messageId: string,
  patch: Partial<
    Pick<
      RoomMessage,
      'content' | 'progressText' | 'timestamp' | 'mentions' | 'phase' | 'projectId' | 'nodeId'
      | 'smartCoordinatorEnd' | 'smartMemberEnd' | 'replyToId' | 'replyPreview' | 'smartJsonRaw'
    >
  >,
): Promise<RoomMessage | null> {
  const { updateProjectRoomMessage } = await import('./project-room-fs');
  const updated = await updateProjectRoomMessage(projectId, messageId, patch);
  if (updated) {
    await reconcileProjectProgressAfterRoomWrite(updated.groupId, projectId);
    try {
      const { tryCompleteSmartProjectAfterRoomMessage } = await import('./smart-task-completion');
      await tryCompleteSmartProjectAfterRoomMessage(updated);
    } catch (err) {
      console.warn('[office] smart project closure after room update failed:', err);
    }
    try {
      const { isUserAbortRoomMessage } = await import('../../../src/lib/office-workflow-abort');
      if (isUserAbortRoomMessage(updated)) {
        notifyRendererRoomMessageAppended(projectId);
      }
    } catch {
      // ignore notify failures
    }
  }
  return updated;
}

export async function updateSettings(
  patch: Partial<OfficeDataStore['settings']>,
): Promise<OfficeDataStore['settings']> {
  const s = await loadStore();
  s.settings = { ...s.settings, ...patch };
  await saveStore(s);
  return s.settings;
}

export function defaultWorkflowForAgents(agentIds: string[]): WorkflowDefinition {
  return defaultWorkflowForRoles(agentIds);
}

// --- Legacy v1 API (tests + gradual migration) ---

export async function listProjectAgents(): Promise<ProjectAgentRef[]> {
  const s = await loadStore();
  const ids = new Set<string>();
  for (const g of s.fixedGroups) {
    for (const id of g.agentIds) ids.add(id.trim());
  }
  for (const p of s.tempProjects) {
    for (const id of p.agentIds) ids.add(id.trim());
  }
  return membersForAgentIds([...ids].filter(Boolean));
}

/** @deprecated 使用 listProjectAgents；仅为尚未迁移的调用方保留。 */
export async function listRoles(): Promise<import('./types').OfficeRole[]> {
  const members = await listProjectAgents();
  const now = Date.now();
  return members.map((m) => ({
    id: m.agentId,
    agentId: m.agentId,
    name: m.displayName,
    displayName: m.displayName,
    createdAt: now,
    updatedAt: now,
  }));
}

export async function listScenarios(): Promise<import('./types').OfficeScenario[]> {
  const groups = await listFixedGroups();
  const s = await loadStore();
  const roles = rolesFromStore(s);
  return groups.map((g) => fixedGroupToScenario(g, roles));
}

export async function listTasks(scenarioId?: string): Promise<import('./types').OfficeTask[]> {
  const s = await loadStore();
  const roles = rolesFromStore(s);
  let projects = s.tempProjects;
  if (scenarioId) {
    projects = projects.filter((p) => p.parentGroupId === scenarioId);
  }
  return projects.map((p) => tempProjectToTask(p, roles));
}

export async function upsertTask(task: import('./types').OfficeTask): Promise<import('./types').OfficeTask> {
  const s = await loadStore();
  const roles = rolesFromStore(s);
  const project = taskToTempProject(task, roles);
  const saved = await upsertTempProject(project);
  return tempProjectToTask(saved, roles);
}

export function createTaskDraft(
  params: Partial<import('./types').OfficeTask> & Pick<import('./types').OfficeTask, 'title' | 'scenarioId'>,
): import('./types').OfficeTask {
  const now = Date.now();
  return {
    id: `task-${now}`,
    featureDescription: params.featureDescription ?? '',
    description: params.description ?? '',
    status: params.status ?? 'pending',
    assignedRoleIds: params.assignedRoleIds ?? [],
    executionMode: params.executionMode ?? 'workflow',
    workflowEngine: params.workflowEngine,
    workflow: params.workflow ?? emptyWorkflow(),
    nodeRuns: params.nodeRuns ?? [],
    createdAt: now,
    updatedAt: now,
    ...params,
  } as import('./types').OfficeTask;
}

export async function insertScenarioTask(
  scenarioId: string,
  params: Omit<Parameters<typeof createTempProjectDraft>[0], 'origin' | 'parentGroupId'>,
): Promise<import('./types').OfficeTask> {
  const project = await spawnProjectFromGroup({
    groupId: scenarioId,
    title: params.title,
    agentIds: params.agentIds,
    coordinatorAgentId: params.coordinatorAgentId,
    featureDescription: params.featureDescription ?? '',
    description: params.description,
    executionMode: params.executionMode,
    workflowEngine: params.workflowEngine,
    workflow: params.workflow,
    langGraphWorkflowBundle: params.langGraphWorkflowBundle,
  });
  const roles = await listRoles();
  return tempProjectToTask(project, roles);
}

export async function reorderScenarios(orderedIds: string[]): Promise<import('./types').OfficeScenario[]> {
  await reorderFixedGroups(orderedIds);
  return listScenarios();
}

export async function listScenarioRoomMessages(scenarioId: string): Promise<RoomMessage[]> {
  const tasks = await listTasks(scenarioId);
  const out: RoomMessage[] = [];
  for (const task of tasks) {
    out.push(...(await getRoomMessages(task.id)));
  }
  return out;
}

export { defaultWorkflowForRoles } from './store-legacy';
