import { sortOfficeProjectsBySequence } from '@/lib/office-task-order';
import {
  isOfficeProjectArchived,
  isOfficeProjectExecuting,
  preferredActiveRoomProjectIdOnOfficeEnter,
} from '@/lib/office-room-sidebar';
import { isSmartTask } from '@/lib/office-task-execution-mode';
import {
  getOfficeDisplayCache,
  getOfficeDisplayCacheGeneration,
  getOfficeDisplayCacheProjectCardPhase,
  getOfficeDisplayCacheRoomPhase,
  patchOfficeDisplayCacheData,
  setOfficeDisplayCacheArchivedPhase,
  setOfficeDisplayCacheAsyncQueueRunning,
  setOfficeDisplayCacheEditContextPhase,
  setOfficeDisplayCacheGatewayInitialPrefetchUiActive,
  setOfficeDisplayCacheProjectCardPhase,
  setOfficeDisplayCacheRoomPhase,
  subscribeOfficeDisplayCache,
} from '@/lib/office-display-cache';
import { useAgentsStore } from '@/stores/agents';
import { useOfficeStore } from '@/stores/office';
import type { OfficeTempProject } from '@/types/office';

export type PrefetchSlice = 'card' | 'room';
export type PrefetchPhase = 'idle' | 'loading' | 'ready';

export type ProjectPrefetchState = Record<PrefetchSlice, PrefetchPhase>;

const stablePrefetchStateByProject = new Map<string, ProjectPrefetchState>();

const inFlightByKey = new Map<string, Promise<void>>();
const pendingQueue: Array<{ projectId: string; slice: PrefetchSlice }> = [];
/** 卡片/群聊失效代数：拉取完成时若代数已变，则丢弃过期结果。 */
const cardFetchGenerationByProject = new Map<string, number>();
const roomFetchGenerationByProject = new Map<string, number>();

let queueRunning = false;
let queueToken = 0;

let gatewayInitialPassProjectIds: string[] | null = null;

function isProjectGatewayPrefetchPassComplete(project: OfficeTempProject): boolean {
  const state = getProjectPrefetchState(project.id);
  if (isOfficeProjectArchived(project)) {
    return state.room === 'ready';
  }
  return state.card === 'ready' && state.room === 'ready';
}

function isGatewayInitialPrefetchPassComplete(): boolean {
  if (!gatewayInitialPassProjectIds || gatewayInitialPassProjectIds.length === 0) return true;
  const projects = useOfficeStore.getState().tempProjects;
  for (const projectId of gatewayInitialPassProjectIds) {
    const project = projects.find((p) => p.id === projectId);
    if (!project) continue;
    if (!isProjectGatewayPrefetchPassComplete(project)) return false;
  }
  return true;
}

export function maybeFinishGatewayInitialPrefetchPass(): void {
  if (!gatewayInitialPassProjectIds) return;
  if (isOfficePrefetchWorkloadActive()) return;
  if (!isGatewayInitialPrefetchPassComplete()) return;
  gatewayInitialPassProjectIds = null;
  setOfficeDisplayCacheGatewayInitialPrefetchUiActive(false);
}

export function beginGatewayInitialPrefetchPass(projectIds: string[]): void {
  gatewayInitialPassProjectIds = [...projectIds];
  setOfficeDisplayCacheGatewayInitialPrefetchUiActive(true);
  maybeFinishGatewayInitialPrefetchPass();
}

/** @internal */
export function resetGatewayInitialPrefetchPassForTest(): void {
  gatewayInitialPassProjectIds = null;
  setOfficeDisplayCacheGatewayInitialPrefetchUiActive(false);
}

export function subscribeOfficeProjectPrefetch(listener: () => void): () => void {
  return subscribeOfficeDisplayCache(listener);
}

export function getProjectPrefetchState(projectId: string): ProjectPrefetchState {
  const card = getOfficeDisplayCacheProjectCardPhase(projectId);
  const room = getOfficeDisplayCacheRoomPhase(projectId);
  const existing = stablePrefetchStateByProject.get(projectId);
  if (existing && existing.card === card && existing.room === room) {
    return existing;
  }
  const next: ProjectPrefetchState = { card, room };
  stablePrefetchStateByProject.set(projectId, next);
  return next;
}

function setPrefetchPhase(projectId: string, slice: PrefetchSlice, phase: PrefetchPhase): void {
  if (slice === 'card') {
    setOfficeDisplayCacheProjectCardPhase(projectId, phase);
  } else {
    setOfficeDisplayCacheRoomPhase(projectId, phase);
  }
}

function inFlightKey(projectId: string, slice: PrefetchSlice): string {
  return `${projectId}:${slice}`;
}

/** 项目开始执行时间（用于运行中项目预取排序）。 */
export function projectExecutionStartMs(
  project: Pick<OfficeTempProject, 'status' | 'nodeRuns' | 'updatedAt'>,
): number {
  const timestamps = (project.nodeRuns ?? [])
    .map((run) => run.startedAt)
    .filter((t): t is number => typeof t === 'number' && t > 0);
  if (timestamps.length > 0) return Math.min(...timestamps);
  if (project.status === 'running') return project.updatedAt ?? 0;
  return Number.MAX_SAFE_INTEGER;
}

/** 构建后台预取队列的项目顺序：先非归档后归档；非归档内 preferred → 运行中 → 其余。 */
export function buildOfficePrefetchProjectOrder(
  projects: OfficeTempProject[],
  preferredId: string | null,
): string[] {
  const nonArchived = sortOfficeProjectsBySequence(
    projects.filter((p) => !isOfficeProjectArchived(p)),
  );
  const archived = sortOfficeProjectsBySequence(
    projects.filter((p) => isOfficeProjectArchived(p)),
  );
  const result: string[] = [];
  const seen = new Set<string>();
  const add = (id: string) => {
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  };

  if (preferredId) add(preferredId);

  const running = nonArchived
    .filter((p) => isOfficeProjectExecuting(p) && p.id !== preferredId)
    .sort((a, b) => projectExecutionStartMs(a) - projectExecutionStartMs(b));
  for (const project of running) add(project.id);

  const idle = nonArchived.filter(
    (p) => !isOfficeProjectExecuting(p) && p.id !== preferredId,
  );
  for (const project of idle) add(project.id);

  for (const project of archived) add(project.id);

  return result;
}

/** 异步区项目预取顺序：非 preferred、非归档；运行中 → 其余。 */
export function buildOfficeAsyncPrefetchProjectOrder(
  projects: OfficeTempProject[],
  preferredId: string | null,
): string[] {
  const nonArchived = sortOfficeProjectsBySequence(
    projects.filter((p) => !isOfficeProjectArchived(p)),
  );
  const result: string[] = [];
  const seen = new Set<string>();
  const add = (id: string) => {
    if (!id || id === preferredId || seen.has(id)) return;
    seen.add(id);
    result.push(id);
  };

  const running = nonArchived
    .filter((p) => isOfficeProjectExecuting(p))
    .sort((a, b) => projectExecutionStartMs(a) - projectExecutionStartMs(b));
  for (const project of running) add(project.id);

  for (const project of nonArchived.filter((p) => !isOfficeProjectExecuting(p))) {
    add(project.id);
  }

  return result;
}

export function preferredPrefetchTargetId(projects: OfficeTempProject[]): string | null {
  return preferredActiveRoomProjectIdOnOfficeEnter(
    sortOfficeProjectsBySequence(projects.filter((p) => !isOfficeProjectArchived(p))),
  );
}

export function isProjectCardPrefetchReady(projectId: string): boolean {
  return getProjectPrefetchState(projectId).card === 'ready';
}

export function isProjectRoomPrefetchReady(projectId: string): boolean {
  return getProjectPrefetchState(projectId).room === 'ready';
}

/** store / 展示缓存中已有群聊条目（含空数组，表示已拉取过）。 */
export function projectHasWarmRoomCache(projectId: string): boolean {
  const office = useOfficeStore.getState();
  if (Object.prototype.hasOwnProperty.call(office.roomMessagesByProject, projectId)) {
    return true;
  }
  const cache = getOfficeDisplayCache();
  if (cache.sync.preferredProjectId === projectId && cache.sync.preferred) {
    return true;
  }
  return cache.async.rooms[projectId] !== undefined;
}

/** 未 invalidate 时，本地温缓存可立即用于展示（纯函数，无副作用）。 */
export function isRoomWarmCacheEligible(projectId: string): boolean {
  if ((roomFetchGenerationByProject.get(projectId) ?? 0) > 0) return false;
  return projectHasWarmRoomCache(projectId);
}

/** phase 已 ready，或温缓存可立即展示（不触发 cache 写入）。 */
export function isRoomPrefetchSatisfied(projectId: string): boolean {
  return isProjectRoomPrefetchReady(projectId) || isRoomWarmCacheEligible(projectId);
}

/**
 * 温缓存命中时把 room phase 升为 ready，避免重复网络与 loading 门禁。
 * 已 invalidate（generation>0）时不提升；运行中项目仍可用温缓存先展示，后台再刷新。
 */
export function promoteRoomPrefetchReadyIfCached(projectId: string): boolean {
  const state = getProjectPrefetchState(projectId);
  if (state.room === 'ready') return true;
  if (state.room === 'loading') return false;

  if ((roomFetchGenerationByProject.get(projectId) ?? 0) > 0) return false;

  if (!projectHasWarmRoomCache(projectId)) return false;

  notifyProjectRoomFetched(projectId);
  return true;
}

/** store / 展示缓存中已有项目快照时，卡片可先展示（运行中项目后台再刷新 progress）。 */
export function promoteCardPrefetchReadyIfCached(projectId: string): boolean {
  const state = getProjectPrefetchState(projectId);
  if (state.card === 'ready') return true;
  if (state.card === 'loading') return false;
  if ((cardFetchGenerationByProject.get(projectId) ?? 0) > 0) return false;

  const project = useOfficeStore.getState().tempProjects.find((p) => p.id === projectId);
  if (!project || isOfficeProjectArchived(project)) return false;

  notifyProjectCardSynced(projectId);
  return true;
}

function scheduleExecutingProjectPrefetchRefresh(
  projectId: string,
  slice: PrefetchSlice,
): void {
  const office = useOfficeStore.getState();
  const project = office.tempProjects.find((p) => p.id === projectId);
  if (!project || isOfficeProjectArchived(project) || !isOfficeProjectExecuting(project)) {
    return;
  }
  if (slice === 'card') {
    void office.fetchProjectProgress(projectId, { notifyReview: false, silent: true });
    return;
  }
  void office.fetchRoomMessages(projectId, { urgent: true });
}

export type OfficeDraftFormBootstrapPlan = {
  fetchAgentPool: boolean;
  fetchAgents: boolean;
};

/** 打开固定组/项目草稿表单时：editContext 与 agents 已温则跳过对应拉取。 */
export function resolveOfficeDraftFormBootstrap(): OfficeDraftFormBootstrapPlan {
  const cache = getOfficeDisplayCache();
  const agents = useAgentsStore.getState();
  return {
    fetchAgentPool: cache.async.editContext.phase !== 'ready',
    fetchAgents: agents.loading || agents.agents.length === 0,
  };
}

function resolvePrefetchProject(
  projectId: string,
  project?: Pick<OfficeTempProject, 'executionMode'> | null,
): Pick<OfficeTempProject, 'executionMode'> | null {
  if (project) return project;
  return useOfficeStore.getState().tempProjects.find((p) => p.id === projectId) ?? null;
}

/**
 * 左侧办公区可展示：
 * - Workflow：card 就绪即可
 * - Smart：card 就绪即可（群聊异步加载，不阻塞详情）
 */
export function isProjectLeftPanelReady(
  projectId: string,
  project?: Pick<OfficeTempProject, 'executionMode'> | null,
): boolean {
  const cache = getOfficeDisplayCache();
  if (cache.sync.preferredProjectId === projectId && cache.sync.preferred) {
    const live = resolvePrefetchProject(projectId, project);
    if (live && isSmartTask(live)) {
      return cache.sync.preferred.roomMessages.length >= 0;
    }
    return true;
  }
  if (!isProjectCardPrefetchReady(projectId)) return false;
  const live = resolvePrefetchProject(projectId, project);
  if (!live) {
    // 无法判定执行模式时保守处理，避免 Smart 在群聊未就绪时被误判为可展示。
    return isRoomPrefetchSatisfied(projectId);
  }
  if (isSmartTask(live)) {
    return isProjectCardPrefetchReady(projectId);
  }
  return true;
}

/** card 与 room 均已就绪（用于后台预取完成判断等）。 */
export function isProjectFullyPrefetched(projectId: string): boolean {
  const state = getProjectPrefetchState(projectId);
  return state.card === 'ready' && state.room === 'ready';
}

/** 非运行中项目：snapshot + agents 即可视为卡片数据就绪。 */
export function syncIdleProjectCardPrefetch(projects: OfficeTempProject[]): void {
  const agentsState = useAgentsStore.getState();
  if (agentsState.loading) return;
  for (const project of projects) {
    if (isOfficeProjectArchived(project) || isOfficeProjectExecuting(project)) continue;
    notifyProjectCardSynced(project.id);
  }
}

/** 卡片数据变更后标记失效，等待重新拉取。 */
export function invalidateProjectCardPrefetch(projectId: string): void {
  cardFetchGenerationByProject.set(
    projectId,
    (cardFetchGenerationByProject.get(projectId) ?? 0) + 1,
  );
  if (getProjectPrefetchState(projectId).card === 'idle') return;
  setOfficeDisplayCacheProjectCardPhase(projectId, 'idle');
}

/** 群聊数据变更后标记失效，等待重新拉取。 */
export function invalidateProjectRoomPrefetch(projectId: string): void {
  const prev = getProjectPrefetchState(projectId);
  roomFetchGenerationByProject.set(
    projectId,
    (roomFetchGenerationByProject.get(projectId) ?? 0) + 1,
  );
  if (prev.room === 'idle') return;
  setOfficeDisplayCacheRoomPhase(projectId, 'idle');
}

export function notifyProjectRoomFetched(projectId: string, fetchGeneration?: number): void {
  if (fetchGeneration !== undefined) {
    const current = roomFetchGenerationByProject.get(projectId) ?? 0;
    if (fetchGeneration !== current) return;
  }
  setPrefetchPhase(projectId, 'room', 'ready');
}

export function notifyProjectCardSynced(projectId: string, fetchGeneration?: number): void {
  if (fetchGeneration !== undefined) {
    const current = cardFetchGenerationByProject.get(projectId) ?? 0;
    if (fetchGeneration !== current) return;
  }
  setPrefetchPhase(projectId, 'card', 'ready');
}

export function captureProjectRoomFetchGeneration(projectId: string): number {
  return roomFetchGenerationByProject.get(projectId) ?? 0;
}

/** 项目从缓存移除时清理失效代数与进行中的去重键。 */
export function clearOfficeProjectPrefetchTracking(projectId: string): void {
  cardFetchGenerationByProject.delete(projectId);
  roomFetchGenerationByProject.delete(projectId);
  stablePrefetchStateByProject.delete(projectId);
  inFlightByKey.delete(inFlightKey(projectId, 'card'));
  inFlightByKey.delete(inFlightKey(projectId, 'room'));
}

function isPrefetchSliceResultCurrent(
  projectId: string,
  slice: PrefetchSlice,
  cacheGeneration: number,
  sliceGeneration: number,
): boolean {
  if (getOfficeDisplayCacheGeneration() !== cacheGeneration) return false;
  const currentSliceGeneration = (
    slice === 'card' ? cardFetchGenerationByProject : roomFetchGenerationByProject
  ).get(projectId) ?? 0;
  return currentSliceGeneration === sliceGeneration;
}

/** 再次进入 Office：用 store/展示缓存温数据提升 phase，运行中项目后台静默刷新。 */
export function syncWarmProjectPrefetchFromStore(projects: OfficeTempProject[]): void {
  for (const project of projects) {
    if (isOfficeProjectArchived(project)) continue;
    promoteCardPrefetchReadyIfCached(project.id);
    promoteRoomPrefetchReadyIfCached(project.id);
    if (isOfficeProjectExecuting(project)) {
      scheduleExecutingProjectPrefetchRefresh(project.id, 'card');
      scheduleExecutingProjectPrefetchRefresh(project.id, 'room');
    }
  }
}

/** @deprecated 使用 syncWarmProjectPrefetchFromStore */
export function refreshPrefetchOnOfficeEnter(projects: OfficeTempProject[]): void {
  syncWarmProjectPrefetchFromStore(projects);
}

export function isProjectCardPrefetchLoading(projectId: string): boolean {
  return getProjectPrefetchState(projectId).card === 'loading';
}

export function shouldShowProjectCardPrefetchLoading(
  projectId: string,
  expanded: boolean,
  isArchived: boolean,
  project?: Pick<OfficeTempProject, 'executionMode'> | null,
): boolean {
  if (!expanded || isArchived) return false;
  const phase = getProjectPrefetchState(projectId).card;
  if (phase === 'ready') return false;
  if (phase === 'loading') return true;
  const live =
    project && 'id' in project && (project as OfficeTempProject).id === projectId
      ? (project as OfficeTempProject)
      : useOfficeStore.getState().tempProjects.find((p) => p.id === projectId);
  return !live;
}

export function shouldShowProjectRoomPrefetchLoading(
  projectId: string,
  isArchived: boolean,
  project?: Pick<OfficeTempProject, 'executionMode'> | null,
): boolean {
  if (isRoomPrefetchSatisfied(projectId)) return false;
  if (isArchived) return true;
  const live = resolvePrefetchProject(projectId, project);
  if (live && isSmartTask(live)) {
    return isProjectCardPrefetchReady(projectId);
  }
  // Workflow：群聊纯展示，不必等 card 完成即可在右侧显示 loading。
  return true;
}

async function ensureAgentsLoaded(reconcile = false): Promise<void> {
  const agentsState = useAgentsStore.getState();
  if (agentsState.loading) {
    await agentsState.fetchAgents({ silent: true, reconcile });
    return;
  }
  if (agentsState.agents.length > 0) return;
  await agentsState.fetchAgents({ silent: true, reconcile });
}

async function prefetchCardSlice(projectId: string, cacheGeneration: number): Promise<void> {
  const sliceGeneration = cardFetchGenerationByProject.get(projectId) ?? 0;
  const office = useOfficeStore.getState();
  const project = office.tempProjects.find((p) => p.id === projectId);
  if (!project || isOfficeProjectArchived(project)) {
    if (!isPrefetchSliceResultCurrent(projectId, 'card', cacheGeneration, sliceGeneration)) return;
    notifyProjectCardSynced(projectId);
    return;
  }

  await ensureAgentsLoaded();
  if (!isPrefetchSliceResultCurrent(projectId, 'card', cacheGeneration, sliceGeneration)) return;

  if (isOfficeProjectExecuting(project)) {
    await office.fetchProjectProgress(projectId, { notifyReview: false, silent: true });
    if (!isPrefetchSliceResultCurrent(projectId, 'card', cacheGeneration, sliceGeneration)) return;
  }

  notifyProjectCardSynced(projectId, sliceGeneration);
}

async function prefetchRoomSlice(projectId: string, cacheGeneration: number): Promise<void> {
  const sliceGeneration = roomFetchGenerationByProject.get(projectId) ?? 0;
  const office = useOfficeStore.getState();
  const project = office.tempProjects.find((p) => p.id === projectId);
  if (!project) {
    if (!isPrefetchSliceResultCurrent(projectId, 'room', cacheGeneration, sliceGeneration)) return;
    notifyProjectRoomFetched(projectId);
    return;
  }

  const urgent =
    isOfficeProjectExecuting(project)
    && office.tempProjects.some(isOfficeProjectExecuting);
  await office.fetchRoomMessages(
    projectId,
    {
      ...(urgent ? { urgent: true } : {}),
      roomFetchGeneration: sliceGeneration,
    },
  );
  if (!isPrefetchSliceResultCurrent(projectId, 'room', cacheGeneration, sliceGeneration)) {
    setPrefetchPhase(projectId, 'room', 'idle');
    // 仅项目级群聊失效时重入队；全局 generation bump 由 hydration 重新调度。
    if (getOfficeDisplayCacheGeneration() === cacheGeneration) {
      enqueuePrefetch(projectId, 'room');
    }
    return;
  }
  notifyProjectRoomFetched(projectId, sliceGeneration);
}

/** 将单项目预取切片入队（与展开/后台队列共享去重逻辑）。 */
export function enqueueOfficeProjectPrefetchSlice(projectId: string, slice: PrefetchSlice): void {
  enqueuePrefetch(projectId, slice);
}

function enqueuePrefetch(projectId: string, slice: PrefetchSlice): void {
  const state = getProjectPrefetchState(projectId);
  if (state[slice] === 'ready') return;
  const exists = pendingQueue.some((item) => item.projectId === projectId && item.slice === slice);
  if (!exists) pendingQueue.push({ projectId, slice });
  void drainPrefetchQueue();
}

async function runPrefetchSlice(projectId: string, slice: PrefetchSlice): Promise<void> {
  const key = inFlightKey(projectId, slice);
  const existing = inFlightByKey.get(key);
  if (existing) {
    await existing;
    return;
  }

  const state = getProjectPrefetchState(projectId);
  if (state[slice] === 'ready') return;

  const cacheGeneration = getOfficeDisplayCacheGeneration();
  const work = (async () => {
    setPrefetchPhase(projectId, slice, 'loading');
    try {
      if (slice === 'card') {
        await prefetchCardSlice(projectId, cacheGeneration);
      } else {
        await prefetchRoomSlice(projectId, cacheGeneration);
      }
    } catch {
      const office = useOfficeStore.getState();
      const live = office.tempProjects.find((p) => p.id === projectId);
      if (slice === 'room') {
        const hasRoomCache = office.roomMessagesByProject[projectId] !== undefined;
        if (hasRoomCache) {
          notifyProjectRoomFetched(projectId);
        } else {
          setPrefetchPhase(projectId, slice, 'idle');
        }
        return;
      }
      if (live && !isOfficeProjectExecuting(live) && !isOfficeProjectArchived(live)) {
        notifyProjectCardSynced(projectId);
      } else {
        setPrefetchPhase(projectId, slice, 'idle');
      }
    }
  })();

  inFlightByKey.set(key, work);
  try {
    await work;
  } finally {
    if (inFlightByKey.get(key) === work) {
      inFlightByKey.delete(key);
    }
    maybeFinishGatewayInitialPrefetchPass();
  }
}

async function drainPrefetchQueue(): Promise<void> {
  if (queueRunning) return;
  queueRunning = true;
  setOfficeDisplayCacheAsyncQueueRunning(true);
  const myToken = ++queueToken;

  while (pendingQueue.length > 0) {
    if (myToken !== queueToken) break;
    const item = pendingQueue.shift()!;
    await runPrefetchSlice(item.projectId, item.slice);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }

  queueRunning = false;
  setOfficeDisplayCacheAsyncQueueRunning(false);
  maybeFinishGatewayInitialPrefetchPass();
}

/** 启动/续跑后台预取（离开 Office 后仍继续）。 */
export function scheduleOfficeProjectPrefetch(
  projects: OfficeTempProject[],
  preferredId: string | null,
): void {
  scheduleOfficeAsyncPrefetch(projects, preferredId);
}

/** 异步区：非 preferred 项目 expand + room。 */
export function scheduleOfficeAsyncPrefetch(
  projects: OfficeTempProject[],
  preferredId: string | null,
): void {
  syncIdleProjectCardPrefetch(projects.filter((p) => !isOfficeProjectArchived(p)));
  const order = buildOfficeAsyncPrefetchProjectOrder(projects, preferredId);
  for (const projectId of order) {
    enqueuePrefetch(projectId, 'card');
    enqueuePrefetch(projectId, 'room');
  }
}

export async function prefetchArchivedBlock(projects: OfficeTempProject[]): Promise<void> {
  setOfficeDisplayCacheArchivedPhase('loading');
  try {
    const archived = sortOfficeProjectsBySequence(
      projects.filter((p) => isOfficeProjectArchived(p)),
    );
    patchOfficeDisplayCacheData({
      async: {
        archived: {
          phase: 'ready',
          projects: archived.map((p) => structuredClone(p)),
        },
      },
    });
    for (const project of archived) {
      enqueuePrefetch(project.id, 'room');
    }
  } catch {
    setOfficeDisplayCacheArchivedPhase('idle');
  }
}

export async function prefetchEditContext(): Promise<void> {
  setOfficeDisplayCacheEditContextPhase('loading');
  try {
    const office = useOfficeStore.getState();
    await office.fetchAgentPool();
    patchOfficeDisplayCacheData({
      async: {
        editContext: {
          phase: 'ready',
          agentPool: [...useOfficeStore.getState().poolAgentIds],
        },
      },
    });
  } catch {
    setOfficeDisplayCacheEditContextPhase('idle');
  }
}

export function resetOfficePrefetchState(): void {
  resetOfficeProjectPrefetchForTest();
}

/** 用户展开：仅入队 card；群聊由 scheduleProjectRoomOnExpand 异步处理。 */
export function requestProjectPrefetchOnExpand(projectId: string, isArchived: boolean): void {
  if (isArchived) {
    enqueuePrefetch(projectId, 'room');
    return;
  }
  const state = getProjectPrefetchState(projectId);
  if (state.card !== 'ready') enqueuePrefetch(projectId, 'card');
}

/**
 * 展开项目详情：缓存优先，card 未就绪时同步拉取（仅阻塞详情区）。
 */
export async function ensureProjectCardOnExpand(
  projectId: string,
  isArchived: boolean,
): Promise<void> {
  if (isArchived) return;
  promoteCardPrefetchReadyIfCached(projectId);
  if (isProjectCardPrefetchReady(projectId)) {
    scheduleExecutingProjectPrefetchRefresh(projectId, 'card');
    return;
  }
  await runPrefetchSlice(projectId, 'card');
}

/**
 * 异步加载项目群聊：温缓存命中则直接 ready，否则后台拉取 room 切片。
 */
export function scheduleProjectRoomOnExpand(
  projectId: string,
  isArchived: boolean,
): void {
  if (isArchived) {
    void runPrefetchSlice(projectId, 'room');
    return;
  }
  promoteRoomPrefetchReadyIfCached(projectId);
  if (isRoomPrefetchSatisfied(projectId)) {
    scheduleExecutingProjectPrefetchRefresh(projectId, 'room');
    return;
  }
  void runPrefetchSlice(projectId, 'room');
}

/** @deprecated 使用 ensureProjectCardOnExpand + scheduleProjectRoomOnExpand */
export function ensureProjectExpandDataImmediate(projectId: string, isArchived: boolean): void {
  void (async () => {
    if (isArchived) {
      await runPrefetchSlice(projectId, 'room');
      return;
    }
    await ensureProjectCardOnExpand(projectId, false);
    scheduleProjectRoomOnExpand(projectId, false);
  })();
}

/**
 * 用户点击展开前同步调用：提升温缓存 phase，运行中项目后台刷新，避免首帧 loading/网络阻塞。
 */
export function prepareProjectExpandPrefetch(projectId: string, isArchived: boolean): void {
  if (isArchived) {
    promoteRoomPrefetchReadyIfCached(projectId);
    scheduleProjectRoomOnExpand(projectId, true);
    return;
  }
  promoteCardPrefetchReadyIfCached(projectId);
  promoteRoomPrefetchReadyIfCached(projectId);
  const project = useOfficeStore.getState().tempProjects.find((p) => p.id === projectId);
  if (project && isOfficeProjectExecuting(project)) {
    scheduleExecutingProjectPrefetchRefresh(projectId, 'card');
  }
  scheduleProjectRoomOnExpand(projectId, false);
}

/** 进页后应用 snapshot：温缓存提升 + 运行中后台刷新。 */
export async function applyOfficePrefetchAfterSnapshot(
  projects: OfficeTempProject[],
): Promise<string | null> {
  await ensureAgentsLoaded();
  syncWarmProjectPrefetchFromStore(projects);
  return preferredPrefetchTargetId(projects);
}

/** @internal test helper */
export function resetOfficeProjectPrefetchForTest(): void {
  queueToken += 1;
  inFlightByKey.clear();
  cardFetchGenerationByProject.clear();
  roomFetchGenerationByProject.clear();
  stablePrefetchStateByProject.clear();
  pendingQueue.length = 0;
  queueRunning = false;
  setOfficeDisplayCacheAsyncQueueRunning(false);
  resetGatewayInitialPrefetchPassForTest();
}

/** @internal 等待后台预取队列与进行中的请求结束。 */
export async function waitForOfficePrefetchIdleForTest(timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!queueRunning && pendingQueue.length === 0 && inFlightByKey.size === 0) return;
    if (!queueRunning && pendingQueue.length > 0) {
      await drainPrefetchQueue();
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 5);
    });
  }
  throw new Error('office prefetch idle wait timeout');
}

/** 预取队列或进行中的切片请求未结束。 */
export function isOfficePrefetchWorkloadActive(): boolean {
  return pendingQueue.length > 0 || queueRunning || inFlightByKey.size > 0;
}

/** @internal */
export function getOfficePrefetchQueueLengthForTest(): number {
  return pendingQueue.length;
}
