import { isWorkflowReviewActive } from '@/lib/office-workflow-user-checkpoint';
import type { OfficeTempProject, RoomMessage } from '@/types/office';
import { roomMessageFromAgentId, roomMessageProjectId } from '@/lib/office-agent-id-resolve';
import { OFFICE_UNIFIED_POLL_MS } from '../../shared/office-unified-poll';
import {
  officeProjectStatusLight as resolveOfficeProjectStatusLight,
  officeFixedGroupStatusLight,
  officeProjectStatusLightCardRingClass,
  officeProjectStatusLightDotStyle,
} from '@/lib/office-project-status-light';

export type { OfficeProjectLight } from '@/lib/office-project-status-light';
export {
  officeFixedGroupStatusLight,
  officeProjectStatusLightCardRingClass,
  officeProjectStatusLightDotStyle,
};
export const officeProjectStatusLight = resolveOfficeProjectStatusLight;

/** Renderer poll interval while at least one project is executing (aligned with Main unified tick). */
export const ROOM_POLL_INTERVAL_ACTIVE_MS = OFFICE_UNIFIED_POLL_MS;

/** Lightweight project progress refresh while projects execute (same unified cadence). */
export const OFFICE_EXECUTION_PROGRESS_POLL_MS = OFFICE_UNIFIED_POLL_MS;

/** @deprecated Use OFFICE_EXECUTION_PROGRESS_POLL_MS */
export const OFFICE_EXECUTION_SNAPSHOT_POLL_MS = OFFICE_EXECUTION_PROGRESS_POLL_MS;

/** After posting a message that expects @ replies: 3s × 100, then 1/min. */
export const ROOM_REPLY_POLL_INTERVAL_MS = 3_000;
export const ROOM_REPLY_POLL_MAX_TICKS = 100;
/** Duration of the fast reply-poll phase (100 × 3s). */
export const ROOM_REPLY_POLL_FAST_PHASE_MS =
  ROOM_REPLY_POLL_INTERVAL_MS * ROOM_REPLY_POLL_MAX_TICKS;
export const ROOM_REPLY_POLL_SLOW_INTERVAL_MS = 60_000;

/** @deprecated Use OFFICE_UNIFIED_POLL_MS via office unified poll tick. */
export const TASK_RUN_POLL_INTERVAL_MS = OFFICE_UNIFIED_POLL_MS;

export function filterRoomMessagesForProject(
  messages: RoomMessage[],
  projectId: string,
): RoomMessage[] {
  return messages.filter((m) => roomMessageProjectId(m) === projectId);
}

/** @deprecated Use filterRoomMessagesForProject */
export function filterRoomMessagesForTask(
  messages: RoomMessage[],
  projectId: string,
): RoomMessage[] {
  return filterRoomMessagesForProject(messages, projectId);
}

/** 项目或任一步骤处于执行中（与 Main `projectNeedsAbort` 一致）。 */
export function isOfficeProjectExecuting(
  project: Pick<OfficeTempProject, 'status' | 'nodeRuns' | 'workflowReviewBatch'>,
): boolean {
  if (isWorkflowReviewActive(project)) return true;
  if (project.status === 'running') return true;
  return project.nodeRuns.some((nr) => nr.status === 'running');
}

/** 未归档且处于执行中的项目 id（Renderer 轮询唯一数据源）。 */
export function listActiveExecutingProjectIds(
  projects: Pick<
    OfficeTempProject,
    'id' | 'status' | 'nodeRuns' | 'lifecycle' | 'workflowReviewBatch'
  >[],
): string[] {
  return projects
    .filter((project) => !isOfficeProjectArchived(project) && isOfficeProjectExecuting(project))
    .map((project) => project.id);
}

/** 项目已归档（已完成 / 已解散 / 已升级等，lifecycle !== active）。 */
export function isOfficeProjectArchived(
  project: Pick<OfficeTempProject, 'lifecycle'>,
): boolean {
  return (project.lifecycle ?? 'active') !== 'active';
}

/** 群聊 groupId：固定组派出用 parentGroupId，自建/智能项目用 project.id（与 Main 写入一致）。 */
export function roomGroupIdForProject(
  project: Pick<OfficeTempProject, 'id' | 'parentGroupId'>,
): string {
  const parent = project.parentGroupId?.trim();
  return parent || project.id;
}

/** @deprecated Use isOfficeProjectExecuting */
export function isOfficeTempProjectExecuting(
  project: Pick<OfficeTempProject, 'status' | 'nodeRuns'>,
): boolean {
  return isOfficeProjectExecuting(project);
}

/** @deprecated Use isOfficeProjectExecuting */
export const isOfficeTaskExecuting = isOfficeProjectExecuting;

/** @deprecated Use OfficeProjectLight from office-project-status-light */
export type OfficeTempProjectLight = import('@/lib/office-project-status-light').OfficeProjectLight;

/** @deprecated Use officeProjectStatusLight */
export function officeTaskStatusLight(
  project: Pick<OfficeTempProject, 'status' | 'nodeRuns'>,
): import('@/lib/office-project-status-light').OfficeProjectLight {
  return resolveOfficeProjectStatusLight(project);
}

/** `projects` 须已按项目顺序排好，取第一个执行中项。 */
export function primaryExecutingProjectId(
  projects: Pick<OfficeTempProject, 'id' | 'status' | 'nodeRuns'>[],
): string | null {
  return projects.find((p) => isOfficeProjectExecuting(p))?.id ?? null;
}

/** @deprecated Use primaryExecutingProjectId */
export function primaryExecutingTaskId(
  projects: Pick<OfficeTempProject, 'id' | 'status' | 'nodeRuns'>[],
): string | null {
  return primaryExecutingProjectId(projects);
}

/**
 * 进入办公协作页时的默认展开项目：
 * - 仅 1 个项目 → 展开该项目（卡片 + 群聊）；
 * - 多个项目且有执行中 → 展开第一个执行中项目，其余折叠；
 * - 多个项目且无执行中 → 全部折叠。
 */
export function preferredActiveRoomProjectIdOnOfficeEnter(
  projects: Pick<OfficeTempProject, 'id' | 'status' | 'nodeRuns'>[],
): string | null {
  if (projects.length === 1) return projects[0]!.id;
  return primaryExecutingProjectId(projects);
}

/** @deprecated Use preferredActiveRoomProjectIdOnOfficeEnter */
export function preferredActiveRoomTaskIdOnOfficeEnter(
  projects: Pick<OfficeTempProject, 'id' | 'status' | 'nodeRuns'>[],
): string | null {
  return preferredActiveRoomProjectIdOnOfficeEnter(projects);
}

/**
 * 进入办公协作页时默认选中的固定组：
 * - 仅 1 个固定组 → 选中该组；
 * - 多个固定组且有「项目执行中」的组 → 选中第一个有项目执行的组；
 * - 多个固定组且无项目执行中 → 返回 null。
 */
export function preferredGroupIdOnOfficeEnter(
  groups: { id: string }[],
  projects: Pick<OfficeTempProject, 'id' | 'parentGroupId' | 'status' | 'nodeRuns'>[],
): string | null {
  if (groups.length === 0) return null;
  if (groups.length === 1) return groups[0]!.id;
  const projectGroupId = (p: { parentGroupId?: string; scenarioId?: string }) =>
    p.parentGroupId ?? p.scenarioId;
  const firstRunning = groups.find((g) =>
    projects.some((p) => projectGroupId(p) === g.id && isOfficeProjectExecuting(p)),
  );
  return firstRunning?.id ?? null;
}

/** @deprecated Use preferredGroupIdOnOfficeEnter */
export function preferredScenarioIdOnOfficeEnter(
  groups: { id: string }[],
  projects: Pick<OfficeTempProject, 'id' | 'parentGroupId' | 'status' | 'nodeRuns'>[],
): string | null {
  return preferredGroupIdOnOfficeEnter(groups, projects);
}

/** 点击项目卡片/群聊行：已展开则折叠，否则展开并选中该项目群聊。 */
export function nextActiveRoomProjectIdOnProjectClick(
  currentActiveId: string | null,
  clickedProjectId: string,
): string | null {
  return currentActiveId === clickedProjectId ? null : clickedProjectId;
}

/** @deprecated Use nextActiveRoomProjectIdOnProjectClick */
export function nextActiveRoomTaskIdOnProjectClick(
  currentActiveId: string | null,
  clickedProjectId: string,
): string | null {
  return nextActiveRoomProjectIdOnProjectClick(currentActiveId, clickedProjectId);
}

/** 项目卡片是否展开（与群聊侧栏可异步解耦）。 */
export function isOfficeProjectCardExpanded(params: {
  projectId: string;
  expandedProjectId?: string | null;
  /** @deprecated 使用 expandedProjectId */
  activeRoomProjectId?: string | null;
}): boolean {
  if (params.expandedProjectId !== undefined) {
    return params.expandedProjectId === params.projectId;
  }
  return (params.activeRoomProjectId ?? null) === params.projectId;
}

/** 群聊侧栏异步调度代数：新操作 bump 后，过期的 microtask / rAF 不得再改 state。 */
export type OfficeRoomPanelScheduleToken = number;

export function bumpOfficeRoomPanelScheduleToken(
  tokenRef: { current: OfficeRoomPanelScheduleToken },
): OfficeRoomPanelScheduleToken {
  tokenRef.current += 1;
  return tokenRef.current;
}

export function scheduleOfficeRoomPanelActivation(opts: {
  projectId: string;
  token: OfficeRoomPanelScheduleToken;
  tokenRef: { current: OfficeRoomPanelScheduleToken };
  getExpandedProjectId: () => string | null;
  activate: (id: string) => void;
}): void {
  const { projectId, token, tokenRef, getExpandedProjectId, activate } = opts;
  queueMicrotask(() => {
    if (tokenRef.current !== token) return;
    if (getExpandedProjectId() !== projectId) return;
    activate(projectId);
  });
}

export function scheduleOfficeRoomPanelDeactivation(opts: {
  token: OfficeRoomPanelScheduleToken;
  tokenRef: { current: OfficeRoomPanelScheduleToken };
  getExpandedProjectId: () => string | null;
  deactivate: () => void;
}): void {
  const { token, tokenRef, getExpandedProjectId, deactivate } = opts;
  requestAnimationFrame(() => {
    if (tokenRef.current !== token) return;
    if (getExpandedProjectId() !== null) return;
    deactivate();
  });
}

/** @deprecated 使用 scheduleOfficeRoomPanelActivation */
export function deferOfficeRoomPanelActivation(
  projectId: string,
  activate: (id: string) => void,
): void {
  queueMicrotask(() => activate(projectId));
}

/** @deprecated 使用 scheduleOfficeRoomPanelDeactivation */
export function deferOfficeRoomPanelDeactivation(deactivate: () => void): void {
  requestAnimationFrame(() => deactivate());
}

/** 项目群侧栏始终占位（无展开项目时为空白面板）。 */
export function shouldShowOfficeProjectRoomsPanel(
  _activeProjects?: Pick<OfficeTempProject, 'id'>[],
  _activeRoomProject?: Pick<OfficeTempProject, 'id'> | null,
): boolean {
  return true;
}

/** 项目群侧栏折叠列表：仅活跃项目；已归档项目不在列表中，展开后单独显示群聊。 */
export function officeRoomSidebarListProjects(
  activeProjects: OfficeTempProject[],
): OfficeTempProject[] {
  return activeProjects;
}

/** @deprecated Use isOfficeProjectCardExpanded */
export function isOfficeTempProjectCardExpanded(params: {
  taskId: string;
  activeRoomTaskId: string | null;
}): boolean {
  return params.activeRoomTaskId === params.taskId;
}

/** @deprecated Use isOfficeProjectCardExpanded */
export const isOfficeTaskCardExpanded = isOfficeTempProjectCardExpanded;

/** 项目群聊是否处于活跃态（执行中或成员正在 task_running 发言）。 */
export function isProjectRoomActive(
  project: Pick<OfficeTempProject, 'status' | 'nodeRuns'>,
  messages: RoomMessage[],
  speakingRoleIds: Set<string>,
): boolean {
  if (isOfficeProjectExecuting(project)) return true;
  return messages.some((m) => {
    const fromId = roomMessageFromAgentId(m);
    return Boolean(fromId && speakingRoleIds.has(fromId) && m.phase === 'task_running');
  });
}

export function buildProjectExpandStateForExecutingFocus(
  projects: Pick<OfficeTempProject, 'id' | 'status' | 'nodeRuns'>[],
): Record<string, boolean> {
  const focusId = primaryExecutingProjectId(projects);
  if (!focusId) return {};
  const next: Record<string, boolean> = {};
  for (const project of projects) {
    next[project.id] = project.id === focusId;
  }
  return next;
}

/** @deprecated Use buildProjectExpandStateForExecutingFocus */
export function buildTaskExpandStateForExecutingFocus(
  projects: Pick<OfficeTempProject, 'id' | 'status' | 'nodeRuns'>[],
): Record<string, boolean> {
  return buildProjectExpandStateForExecutingFocus(projects);
}

export function shouldAutoExpandRoomOnMessageCount(
  prevCount: number | undefined,
  nextCount: number,
): boolean {
  return prevCount !== undefined && nextCount > prevCount;
}

export function shouldAutoExpandRoomOnTaskStatus(
  prevStatus: string | undefined,
  status: string,
): boolean {
  return prevStatus !== undefined && prevStatus !== 'running' && status === 'running';
}

/** True when renderer should poll room messages (at least one project executing). */
export function shouldPollOfficeRoomsWhileExecuting(runningProjectIds: string[]): boolean {
  return runningProjectIds.length > 0;
}

/** Gate for the Office page room poll loop (executing projects only; optional draft-form pause). */
export function shouldPollOfficeRoomMessages(options: {
  runningProjectIds: string[];
  draftFormOpen?: boolean;
}): boolean {
  if (options.draftFormOpen) return false;
  return shouldPollOfficeRoomsWhileExecuting(options.runningProjectIds);
}

/** Re-read executing ids from latest snapshot (avoid stale closure in poll ticks). */
export function readExecutingProjectIdsFromStore(
  tempProjects: Pick<OfficeTempProject, 'id' | 'status' | 'nodeRuns' | 'lifecycle'>[],
): string[] {
  return officeRoomPollProjectIds(listActiveExecutingProjectIds(tempProjects));
}

/** Project ids to fetch in the renderer poll loop (executing projects only). */
export function officeRoomPollProjectIds(runningProjectIds: string[]): string[] {
  return runningProjectIds.map((id) => id.trim()).filter((id) => id.length > 0);
}

/** @deprecated Use officeRoomPollProjectIds */
export function officeRoomPollTaskIds(runningProjectIds: string[]): string[] {
  return officeRoomPollProjectIds(runningProjectIds);
}

export function officeRoomPollIntervalMs(): number {
  return ROOM_POLL_INTERVAL_ACTIVE_MS;
}

export function officeExecutionProgressPollIntervalMs(): number {
  return OFFICE_EXECUTION_PROGRESS_POLL_MS;
}

/** @deprecated Use officeExecutionProgressPollIntervalMs */
export function officeExecutionSnapshotPollIntervalMs(): number {
  return officeExecutionProgressPollIntervalMs();
}
