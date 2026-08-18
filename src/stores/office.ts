import { create } from 'zustand';
import { toast } from 'sonner';
import { notifyWorkflowReviewAttentionIfNeeded } from '@/lib/office-workflow-review-attention';
import i18n from '@/i18n';
import { hostApiFetch } from '@/lib/host-api';
import {
  settleWorkflowReviewBatch,
  submitWorkflowReviewDecision,
} from '@/lib/office-workflow-review-client';
import { waitForOfficeExecutionSyncActive } from '@/lib/office-execution-sync';
import {
  isOfficeTaskExecuting,
  ROOM_REPLY_POLL_INTERVAL_MS,
  ROOM_REPLY_POLL_MAX_TICKS,
  ROOM_REPLY_POLL_SLOW_INTERVAL_MS,
} from '@/lib/office-room-sidebar';
import { taskSnapshotAfterRunRequested } from '@/lib/office-task-run';
import { taskSnapshotAfterAbortRequested } from '@/lib/office-workflow-abort';
import {
  mergeProjectProgressIntoProject,
  type OfficeProjectProgress,
} from '@/lib/office-project-progress';
import {
  captureProjectRoomFetchGeneration,
  clearOfficeProjectPrefetchTracking,
  notifyProjectCardSynced,
  notifyProjectRoomFetched,
} from '@/lib/office-project-prefetch';
import {
  reconcileOfficeDisplayCacheForProject,
  reconcileOfficeDisplayCacheFromProjects,
} from '@/lib/office-display-cache-sync';
import { removeOfficeDisplayCacheProject } from '@/lib/office-display-cache';
import { applyOfficeDisplayCacheFromStore } from '@/lib/office-display-cache-data';
import type {
  AgentBindingRecord,
  LangGraphWorkflowBundle,
  OfficeFixedGroup,
  OfficeSnapshot,
  OfficeTempProject,
  RoomMessage,
  WorkflowDefinition,
} from '@/types/office';

type AgentWorkState = 'idle' | 'working';
type ProjectAgentStateMap = Record<string, AgentWorkState>;
export type ProjectAgentStateCache = Record<string, ProjectAgentStateMap>;

interface OfficeState {
  fixedGroups: OfficeFixedGroup[];
  tempProjects: OfficeTempProject[];
  poolAgentIds: string[];
  agentBindings: Record<string, AgentBindingRecord>;
  settings: OfficeSnapshot['settings'];
  loading: boolean;
  error: string | null;
  selectedGroupId: string | null;
  selectedAgentId: string | null;
  chatSessionKey: string | null;
  chatTitle: string;
  roomMessagesByProject: Record<string, RoomMessage[]>;
  /** @deprecated Alias keyed by projectId for legacy consumers. */
  roomMessagesByTask: Record<string, RoomMessage[]>;
  roomMessageWatchProjectIds: string[];
  /** @deprecated Alias for roomMessageWatchProjectIds. */
  roomMessageWatchTaskIds: string[];
  /** Active projects: projectId → agentId → idle | working. */
  projectAgentStateByProject: ProjectAgentStateCache;

  /** @param opts.withLoading — when true, sets `loading` for the Office header refresh spinner only */
  fetchSnapshot: (opts?: { withLoading?: boolean; notifyReview?: boolean }) => Promise<void>;
  applyProjectProgress: (
    progress: OfficeProjectProgress,
    opts?: { notifyReview?: boolean },
  ) => void;
  fetchProjectProgress: (
    projectId: string,
    opts?: { notifyReview?: boolean; silent?: boolean },
  ) => Promise<void>;
  fetchExecutingProjectsProgress: (
    projectIds: string[],
    opts?: { notifyReview?: boolean; silent?: boolean },
  ) => Promise<void>;
  fetchAgentPool: () => Promise<void>;
  enableCollab: () => Promise<void>;
  setAgentCollabEnabled: (enabled: boolean) => Promise<void>;
  createFixedGroup: (body: {
    name: string;
    description?: string;
    agentIds: string[];
    coordinatorAgentId: string;
    executionMode?: OfficeFixedGroup['executionMode'];
    workflow?: WorkflowDefinition;
    workflowDescription?: string;
    workflowStepDrafts?: import('@/types/office').WorkflowStepDraftRow[];
    workflowOrchestrationMode?: import('@/types/office').WorkflowOrchestrationMode;
    upgradeFromProjectId?: string;
  }) => Promise<OfficeFixedGroup>;
  updateFixedGroup: (groupId: string, patch: Partial<OfficeFixedGroup>) => Promise<void>;
  deleteFixedGroup: (groupId: string) => Promise<void>;
  reorderFixedGroups: (orderedIds: string[]) => Promise<void>;
  createTempProject: (body: {
    title: string;
    agentIds: string[];
    coordinatorAgentId?: string;
    featureDescription: string;
    description?: string;
    workflowStepDrafts?: import('@/types/office').WorkflowStepDraftRow[];
    workflowOrchestrationMode?: import('@/types/office').WorkflowOrchestrationMode;
    executionMode?: 'workflow' | 'smart';
    workflowEngine?: 'dag' | 'langgraph';
    workflow?: WorkflowDefinition;
    langGraphWorkflowBundle?: LangGraphWorkflowBundle;
  }) => Promise<OfficeTempProject>;
  updateTempProject: (
    projectId: string,
    patch: {
      title?: string;
      featureDescription?: string;
      description?: string;
      workflowStepDrafts?: import('@/types/office').WorkflowStepDraftRow[];
      workflowOrchestrationMode?: import('@/types/office').WorkflowOrchestrationMode;
      coordinatorAgentId?: string;
      agentIds?: string[];
      executionMode?: 'workflow' | 'smart';
      workflowEngine?: 'dag' | 'langgraph';
      workflow?: WorkflowDefinition;
      langGraphWorkflowBundle?: LangGraphWorkflowBundle;
      inheritsGroupTemplate?: boolean;
      workflowFreezeSnapshot?: import('@/types/office').OfficeTempProject['workflowFreezeSnapshot'] | null;
    },
  ) => Promise<OfficeTempProject>;
  spawnProjectFromGroup: (
    groupId: string,
    body: {
      title: string;
      featureDescription: string;
      description?: string;
      workflowStepDrafts?: import('@/types/office').WorkflowStepDraftRow[];
      workflowOrchestrationMode?: import('@/types/office').WorkflowOrchestrationMode;
      coordinatorAgentId?: string;
      agentIds?: string[];
      executionMode?: 'workflow' | 'smart';
      workflowEngine?: 'dag' | 'langgraph';
      workflow?: WorkflowDefinition;
      langGraphWorkflowBundle?: LangGraphWorkflowBundle;
    },
  ) => Promise<OfficeTempProject>;
  upgradeProject: (projectId: string) => Promise<{ group: OfficeFixedGroup; project: OfficeTempProject }>;
  archiveProject: (projectId: string) => Promise<OfficeTempProject>;
  dismissCompletionFollowUp: (projectId: string) => Promise<OfficeTempProject>;
  restartProject: (projectId: string) => Promise<{
    project: OfficeTempProject;
    agentSync: import('@/lib/office-spawned-project-agent-sync').SpawnedProjectAgentSyncNotice | null;
  }>;
  markProjectUpgraded: (projectId: string, groupId: string) => Promise<OfficeTempProject>;
  dissolveProject: (projectId: string) => Promise<OfficeTempProject | undefined>;
  runProject: (
    projectId: string,
    options?: {
      mode?: 'fresh' | 'continue' | 'single';
      nodeId?: string;
      clearProjectRoom?: boolean;
    },
  ) => Promise<void>;
  abortProject: (projectId: string) => Promise<void>;
  submitWorkflowReview: (
    projectId: string,
    nodeId: string,
    decision: import('@/types/office').WorkflowReviewAction,
    batchUpdatedAt: number,
  ) => Promise<OfficeTempProject>;
  settleWorkflowReview: (projectId: string, settleGeneration: number) => Promise<OfficeTempProject>;
  deleteTempProject: (projectId: string) => Promise<void>;
  /** Delete an ARCHIVED project: its directory + all artifacts on disk, and unbind its agents. */
  deleteArchivedProject: (projectId: string) => Promise<void>;
  fetchRoomMessages: (
    projectId: string,
    options?: { urgent?: boolean; roomFetchGeneration?: number },
  ) => Promise<void>;
  reconcileActiveProjectAgentStates: (groupId: string, activeProjectIds: string[]) => void;
  postRoomMessage: (
    projectId: string,
    content: string,
    opts?: { fromAgentId?: string; replyToId?: string },
  ) => Promise<void>;
  setSelectedGroup: (id: string | null) => void;
  setSelectedAgent: (id: string | null) => void;
  openChat: (sessionKey: string, title: string) => void;
  closeChat: () => void;

  /** @deprecated Use createFixedGroup */
  createScenario: (body: {
    name: string;
    description?: string;
    roleIds: string[];
    coordinatorRoleId: string;
    workflow?: WorkflowDefinition;
  }) => Promise<OfficeFixedGroup>;
  /** @deprecated Use updateFixedGroup */
  updateScenario: (groupId: string, patch: Partial<OfficeFixedGroup>) => Promise<void>;
  /** @deprecated Use deleteFixedGroup */
  deleteScenario: (groupId: string) => Promise<{ deletedRoleCount: number; deletedTaskCount: number }>;
  /** @deprecated Use reorderFixedGroups */
  reorderScenarios: (orderedIds: string[]) => Promise<void>;
  /** @deprecated Use spawnProjectFromGroup or createTempProject */
  createTask: (body: {
    scenarioId: string;
    title: string;
    featureDescription: string;
    description?: string;
    coordinatorRoleId?: string;
    assignedRoleIds?: string[];
    executionMode?: 'workflow' | 'smart';
    workflowEngine?: 'dag' | 'langgraph';
    workflow?: WorkflowDefinition;
    langGraphWorkflowBundle?: LangGraphWorkflowBundle;
  }) => Promise<OfficeTempProject>;
  /** @deprecated Use updateTempProject */
  updateTask: (
    projectId: string,
    patch: Parameters<OfficeState['updateTempProject']>[1],
  ) => Promise<OfficeTempProject>;
  /** @deprecated Use runProject */
  runTask: (
    projectId: string,
    options?: Parameters<OfficeState['runProject']>[1],
  ) => Promise<void>;
  /** @deprecated Use abortProject */
  abortTask: (projectId: string) => Promise<void>;
  /** @deprecated Use deleteTempProject */
  deleteTask: (projectId: string) => Promise<void>;
  /** @deprecated Use setSelectedGroup */
  setSelectedScenario: (id: string | null) => void;
  /** @deprecated Use setSelectedAgent */
  setSelectedRole: (id: string | null) => void;
}

const AGENT_COLORS = [
  '#667eea', '#764ba2', '#4facfe', '#43e97b', '#fa709a', '#fee140', '#f5576c', '#38f9d7',
];

const projectRunPollers = new Map<string, number>();
const projectAbortQuiescePollers = new Map<string, number>();
const projectRunStartVerifyTokens = new Map<string, number>();
const ABORT_QUIESCE_POLL_MS = 1_000;

const TASK_RUN_START_VERIFY_MS = 4_000;

function bumpProjectRunStartVerifyToken(projectId: string): number {
  const next = (projectRunStartVerifyTokens.get(projectId) ?? 0) + 1;
  projectRunStartVerifyTokens.set(projectId, next);
  return next;
}

function cancelProjectRunStartVerify(projectId: string): void {
  bumpProjectRunStartVerifyToken(projectId);
}

function taskRunStartFailedMessage(): string {
  return i18n.t('taskRun.startFailed', { ns: 'office' });
}
const roomReplyPollers = new Map<string, number>();

function sortFixedGroupsBySequence(groups: OfficeFixedGroup[]): OfficeFixedGroup[] {
  return [...groups].sort((a, b) => {
    const sa = a.sequence ?? Number.MAX_SAFE_INTEGER;
    const sb = b.sequence ?? Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sa - sb;
    return a.createdAt - b.createdAt;
  });
}

function withRoomMessageAliases(
  roomMessagesByProject: Record<string, RoomMessage[]>,
): Pick<OfficeState, 'roomMessagesByProject' | 'roomMessagesByTask'> {
  return { roomMessagesByProject, roomMessagesByTask: roomMessagesByProject };
}

function withWatchIdAliases(
  roomMessageWatchProjectIds: string[],
): Pick<OfficeState, 'roomMessageWatchProjectIds' | 'roomMessageWatchTaskIds'> {
  return { roomMessageWatchProjectIds, roomMessageWatchTaskIds: roomMessageWatchProjectIds };
}

function groupIdForProject(
  project: OfficeTempProject,
  groups: OfficeFixedGroup[],
): string | null {
  if (project.parentGroupId) return project.parentGroupId;
  if (project.origin === 'fixed_group') {
    return groups.find((g) => g.agentIds.some((id) => project.agentIds.includes(id)))?.id ?? null;
  }
  return project.id;
}

function stopProjectRunPoll(projectId: string): void {
  const id = projectRunPollers.get(projectId);
  if (id !== undefined) {
    window.clearInterval(id);
    projectRunPollers.delete(projectId);
  }
}

function stopAbortQuiescePoll(projectId: string): void {
  const id = projectAbortQuiescePollers.get(projectId);
  if (id !== undefined) {
    window.clearInterval(id);
    projectAbortQuiescePollers.delete(projectId);
  }
}

function startAbortQuiescePoll(projectId: string): void {
  stopAbortQuiescePoll(projectId);
  const tick = async () => {
    await useOfficeStore.getState().fetchSnapshot();
    const live = useOfficeStore.getState().tempProjects.find((p) => p.id === projectId);
    if (!live?.abortQuiescing) {
      stopAbortQuiescePoll(projectId);
    }
  };
  void tick();
  const id = window.setInterval(() => {
    void tick();
  }, ABORT_QUIESCE_POLL_MS);
  projectAbortQuiescePollers.set(projectId, id);
}

/** Stop any per-project run pollers (Office page owns the unified executing-room poll).
 * Does NOT stop abort-quiesce pollers — those must survive after status leaves executing.
 */
export function stopAllProjectRunPolls(): void {
  for (const projectId of [...projectRunPollers.keys()]) {
    stopProjectRunPoll(projectId);
  }
}

/** @visibleForTesting */
export function stopAllAbortQuiescePollsForTests(): void {
  for (const projectId of [...projectAbortQuiescePollers.keys()]) {
    stopAbortQuiescePoll(projectId);
  }
}

function removeRoomMessageWatch(projectId: string): void {
  useOfficeStore.setState((state) =>
    withWatchIdAliases(state.roomMessageWatchProjectIds.filter((id) => id !== projectId)),
  );
}

function addRoomMessageWatch(projectId: string): void {
  useOfficeStore.setState((state) => {
    if (state.roomMessageWatchProjectIds.includes(projectId)) return state;
    return withWatchIdAliases([...state.roomMessageWatchProjectIds, projectId]);
  });
}

export function pauseRoomReplyPoll(projectId: string): void {
  const id = roomReplyPollers.get(projectId);
  if (id !== undefined) {
    window.clearInterval(id);
    roomReplyPollers.delete(projectId);
  }
}

/** @deprecated Use pauseRoomReplyPoll(projectId) */
export const pauseRoomReplyPollForTask = pauseRoomReplyPoll;

export function stopRoomReplyPoll(projectId: string): void {
  pauseRoomReplyPoll(projectId);
  removeRoomMessageWatch(projectId);
}

/** @deprecated Use stopRoomReplyPoll(projectId) */
export const stopRoomReplyPollForTask = stopRoomReplyPoll;

export function roleColor(index: number): string {
  return AGENT_COLORS[index % AGENT_COLORS.length]!;
}

export const useOfficeStore = create<OfficeState>((set, get) => ({
  fixedGroups: [],
  tempProjects: [],
  poolAgentIds: [],
  agentBindings: {},
  settings: { agentToAgentEnabled: false, agentToAgentAllow: [] },
  loading: false,
  error: null,
  selectedGroupId: null,
  selectedAgentId: null,
  chatSessionKey: null,
  chatTitle: '',
  roomMessagesByProject: {},
  roomMessagesByTask: {},
  roomMessageWatchProjectIds: [],
  roomMessageWatchTaskIds: [],
  projectAgentStateByProject: {},

  fetchSnapshot: async (opts) => {
    const withLoading = opts?.withLoading === true;
    const notifyReview = opts?.notifyReview !== false;
    const prevProjects = get().tempProjects;
    if (withLoading) {
      set({ loading: true, error: null });
    } else {
      set({ error: null });
    }
    try {
      const data = await hostApiFetch<OfficeSnapshot & { success?: boolean }>('/api/office/snapshot');
      set((state) => {
        const nextProjects = data.tempProjects ?? [];
        if (notifyReview) {
          notifyWorkflowReviewAttentionIfNeeded(prevProjects, nextProjects);
        }
        return {
          fixedGroups: sortFixedGroupsBySequence(data.fixedGroups ?? []),
          tempProjects: nextProjects,
          agentBindings: data.agentBindings ?? {},
          settings: data.settings ?? { agentToAgentEnabled: false, agentToAgentAllow: [] },
          loading: withLoading ? false : state.loading,
        };
      });
      reconcileOfficeDisplayCacheFromProjects(prevProjects, get().tempProjects);
      applyOfficeDisplayCacheFromStore();
    } catch (e) {
      set((state) => ({
        loading: withLoading ? false : state.loading,
        error: e instanceof Error ? e.message : String(e),
      }));
    }
  },

  applyProjectProgress: (progress, opts) => {
    const notifyReview = opts?.notifyReview !== false;
    const state = get();
    const idx = state.tempProjects.findIndex((p) => p.id === progress.id);
    if (idx < 0) return;
    const prev = state.tempProjects[idx]!;
    const next = mergeProjectProgressIntoProject(prev, progress);
    if (
      prev.status === next.status
      && prev.updatedAt === next.updatedAt
      && prev.abortQuiescing === next.abortQuiescing
      && prev.abortGeneration === next.abortGeneration
      && JSON.stringify(prev.nodeRuns) === JSON.stringify(next.nodeRuns)
      && JSON.stringify(prev.workflowReviewBatch ?? null)
        === JSON.stringify(next.workflowReviewBatch ?? null)
      && JSON.stringify(prev.workflowStall ?? null) === JSON.stringify(next.workflowStall ?? null)
      && JSON.stringify(prev.workflowUserIntervention ?? null)
        === JSON.stringify(next.workflowUserIntervention ?? null)
    ) {
      return;
    }
    const tempProjects = [...state.tempProjects];
    tempProjects[idx] = next;
    set({ tempProjects });
    const wasExecuting = isOfficeTaskExecuting(prev);
    const nowExecuting = isOfficeTaskExecuting(next);
    if (wasExecuting !== nowExecuting) {
      reconcileOfficeDisplayCacheForProject(prev, next);
    } else {
      notifyProjectCardSynced(progress.id);
    }
    if (notifyReview) {
      notifyWorkflowReviewAttentionIfNeeded([prev], [next]);
    }
    applyOfficeDisplayCacheFromStore();
  },

  fetchProjectProgress: async (projectId, opts) => {
    const id = projectId.trim();
    if (!id) return;
    if (opts?.silent) {
      const live = get().tempProjects.find((p) => p.id === id);
      if (!live || !isOfficeTaskExecuting(live)) return;
    }
    try {
      const res = await hostApiFetch<{
        success: boolean;
        progress?: OfficeProjectProgress;
      }>(`/api/office/projects/${encodeURIComponent(id)}/progress`);
      if (res.progress) {
        get().applyProjectProgress(res.progress, opts);
      }
    } catch (e) {
      if (opts?.silent) return;
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  fetchExecutingProjectsProgress: async (projectIds, opts) => {
    const ids = projectIds.map((id) => id.trim()).filter((id) => id.length > 0);
    if (ids.length === 0) return;
    await Promise.all(ids.map((id) => get().fetchProjectProgress(id, opts)));
  },

  fetchAgentPool: async () => {
    const res = await hostApiFetch<{ success: boolean; agentIds?: string[] }>('/api/office/agents/pool');
    set({ poolAgentIds: res.agentIds ?? [] });
  },

  enableCollab: async () => {
    await get().setAgentCollabEnabled(true);
  },

  setAgentCollabEnabled: async (enabled) => {
    if (enabled) {
      await hostApiFetch('/api/office/settings/enable-collab', { method: 'POST' });
    } else {
      await hostApiFetch('/api/office/settings', {
        method: 'PUT',
        body: JSON.stringify({ agentToAgentEnabled: false }),
      });
    }
    await get().fetchSnapshot();
  },

  createFixedGroup: async (body) => {
    const res = await hostApiFetch<{ success: boolean; group?: OfficeFixedGroup; error?: string }>(
      '/api/office/groups',
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    );
    if (res.success === false || !res.group) {
      throw new Error(res.error || 'Failed to create group');
    }
    const group = res.group;
    set((state) => ({
      fixedGroups: sortFixedGroupsBySequence([
        ...state.fixedGroups.filter((g) => g.id !== group.id),
        group,
      ]),
    }));
    applyOfficeDisplayCacheFromStore();
    await get().fetchSnapshot();
    return group;
  },

  updateFixedGroup: async (groupId, patch) => {
    await hostApiFetch(`/api/office/groups/${encodeURIComponent(groupId)}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
    await get().fetchSnapshot();
  },

  deleteFixedGroup: async (groupId) => {
    await hostApiFetch(`/api/office/groups/${encodeURIComponent(groupId)}`, { method: 'DELETE' });
    await get().fetchSnapshot();
  },

  reorderFixedGroups: async (orderedIds) => {
    const prev = get().fixedGroups;
    const byId = new Map(prev.map((g) => [g.id, g]));
    const optimistic: OfficeFixedGroup[] = [];
    for (let index = 0; index < orderedIds.length; index++) {
      const group = byId.get(orderedIds[index]!);
      if (!group) throw new Error('unknown group id in orderedIds');
      optimistic.push({ ...group, sequence: index + 1 });
    }
    set({ fixedGroups: sortFixedGroupsBySequence(optimistic) });
    applyOfficeDisplayCacheFromStore();
    try {
      await hostApiFetch('/api/office/groups/reorder', {
        method: 'POST',
        body: JSON.stringify({ orderedIds }),
      });
    } catch (e) {
      set({ fixedGroups: prev });
      applyOfficeDisplayCacheFromStore();
      throw e;
    }
    await get().fetchSnapshot();
  },

  createTempProject: async (body) => {
    const res = await hostApiFetch<{ success: boolean; project?: OfficeTempProject; error?: string }>(
      '/api/office/projects',
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    );
    if (res.success === false || !res.project?.id) {
      throw new Error(res.error ?? 'Failed to create project');
    }
    set((state) => ({
      tempProjects: [...state.tempProjects.filter((p) => p.id !== res.project!.id), res.project!],
    }));
    applyOfficeDisplayCacheFromStore();
    await get().fetchSnapshot();
    return res.project;
  },

  updateTempProject: async (projectId, patch) => {
    const res = await hostApiFetch<{ success: boolean; project?: OfficeTempProject; error?: string }>(
      `/api/office/projects/${encodeURIComponent(projectId)}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    );
    if (res.success === false || !res.project) {
      throw new Error(res.error ?? 'Failed to update project');
    }
    set((state) => ({
      tempProjects: state.tempProjects.map((p) => (p.id === res.project!.id ? res.project! : p)),
    }));
    applyOfficeDisplayCacheFromStore();
    await get().fetchSnapshot();
    return res.project;
  },

  spawnProjectFromGroup: async (groupId, body) => {
    const res = await hostApiFetch<{ success: boolean; project?: OfficeTempProject; error?: string }>(
      `/api/office/groups/${encodeURIComponent(groupId)}/spawn-project`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    );
    if (res.success === false || !res.project?.id) {
      throw new Error(res.error ?? 'Failed to spawn project');
    }
    set((state) => ({
      tempProjects: [...state.tempProjects.filter((p) => p.id !== res.project!.id), res.project!],
    }));
    applyOfficeDisplayCacheFromStore();
    await get().fetchSnapshot();
    return res.project;
  },

  upgradeProject: async (projectId) => {
    const res = await hostApiFetch<{
      success: boolean;
      error?: string;
      group?: OfficeFixedGroup;
      project?: OfficeTempProject;
    }>(`/api/office/projects/${encodeURIComponent(projectId)}/upgrade`, { method: 'POST' });
    if (res.success === false || !res.group || !res.project) {
      throw new Error(res.error ?? 'Failed to upgrade project');
    }
    await get().fetchSnapshot();
    return { group: res.group, project: res.project };
  },

  archiveProject: async (projectId) => {
    const res = await hostApiFetch<{ success: boolean; project?: OfficeTempProject; error?: string }>(
      `/api/office/projects/${encodeURIComponent(projectId)}/archive`,
      { method: 'POST' },
    );
    if (res.success === false || !res.project) {
      throw new Error(res.error ?? 'Failed to archive project');
    }
    stopProjectRunPoll(projectId);
    await get().fetchSnapshot();
    return res.project;
  },

  dismissCompletionFollowUp: async (projectId) => {
    const res = await hostApiFetch<{ success: boolean; project?: OfficeTempProject; error?: string }>(
      `/api/office/projects/${encodeURIComponent(projectId)}/completion-follow-up/dismiss`,
      { method: 'POST' },
    );
    if (res.success === false || !res.project) {
      throw new Error(res.error ?? 'Failed to dismiss completion follow-up');
    }
    set((state) => ({
      tempProjects: state.tempProjects.map((p) => (p.id === res.project!.id ? res.project! : p)),
    }));
    await get().fetchSnapshot();
    return res.project;
  },

  restartProject: async (projectId) => {
    const res = await hostApiFetch<{
      success: boolean;
      project?: OfficeTempProject;
      agentSync?: import('@/lib/office-spawned-project-agent-sync').SpawnedProjectAgentSyncNotice | null;
      error?: string;
    }>(
      `/api/office/projects/${encodeURIComponent(projectId)}/restart`,
      { method: 'POST' },
    );
    if (res.success === false || !res.project) {
      throw new Error(res.error ?? 'Failed to restart project');
    }
    await get().fetchSnapshot();
    return { project: res.project, agentSync: res.agentSync ?? null };
  },

  markProjectUpgraded: async (projectId, groupId) => {
    const res = await hostApiFetch<{ success: boolean; project?: OfficeTempProject; error?: string }>(
      `/api/office/projects/${encodeURIComponent(projectId)}/mark-upgraded`,
      {
        method: 'POST',
        body: JSON.stringify({ groupId }),
      },
    );
    if (res.success === false || !res.project) {
      throw new Error(res.error ?? 'Failed to mark project upgraded');
    }
    await get().fetchSnapshot();
    return res.project;
  },

  dissolveProject: async (projectId) => {
    const res = await hostApiFetch<{ success: boolean; project?: OfficeTempProject; error?: string }>(
      `/api/office/projects/${encodeURIComponent(projectId)}/dissolve`,
      { method: 'POST' },
    );
    if (res.success === false) {
      throw new Error(res.error ?? 'Failed to dissolve project');
    }
    await get().fetchSnapshot();
    return res.project;
  },

  runProject: async (projectId, options) => {
    const res = await hostApiFetch<{ success: boolean; error?: string }>(
      `/api/office/projects/${encodeURIComponent(projectId)}/run`,
      {
        method: 'POST',
        body: JSON.stringify(options ?? { mode: 'fresh' }),
      },
    );
    if (res.success === false) {
      if (res.error === 'PROJECT_ABORT_QUIESCING') {
        throw new Error(i18n.t('projectAbortQuiescing', { ns: 'office' }));
      }
      throw new Error(res.error ?? 'Failed to start project');
    }
    const beforeRun = get().tempProjects.find((p) => p.id === projectId);
    await get().fetchSnapshot();
    set((state) => ({
      tempProjects: state.tempProjects.map((p) =>
        p.id === projectId ? taskSnapshotAfterRunRequested(p, options) : p,
      ),
    }));
    const afterRun = get().tempProjects.find((p) => p.id === projectId);
    if (beforeRun && afterRun) {
      reconcileOfficeDisplayCacheForProject(beforeRun, afterRun);
    }
    applyOfficeDisplayCacheFromStore();
    await get().fetchRoomMessages(projectId, { urgent: true });
    const started = get().tempProjects.find((p) => p.id === projectId);
    const groupId = started ? groupIdForProject(started, get().fixedGroups) : null;
    if (groupId) {
      get().reconcileActiveProjectAgentStates(groupId, [projectId]);
    }
    stopProjectRunPoll(projectId);
    const startVerifyToken = bumpProjectRunStartVerifyToken(projectId);
    void (async () => {
      const verifyRunStarted = async (): Promise<boolean> => {
        await get().fetchSnapshot();
        const live = get().tempProjects.find((p) => p.id === projectId);
        return Boolean(live && isOfficeTaskExecuting(live));
      };

      void waitForOfficeExecutionSyncActive();

      await new Promise((resolve) => window.setTimeout(resolve, TASK_RUN_START_VERIFY_MS));
      if (projectRunStartVerifyTokens.get(projectId) !== startVerifyToken) return;
      if (await verifyRunStarted()) return;
      if (projectRunStartVerifyTokens.get(projectId) !== startVerifyToken) return;

      toast.error(taskRunStartFailedMessage());
    })();
  },

  abortProject: async (projectId) => {
    cancelProjectRunStartVerify(projectId);
    stopProjectRunPoll(projectId);
    const before = get().tempProjects.find((p) => p.id === projectId);
    if (before) {
      const optimistic = taskSnapshotAfterAbortRequested(before, '用户已手动中止本项目');
      set((state) => ({
        tempProjects: state.tempProjects.map((p) => (p.id === projectId ? optimistic : p)),
      }));
      applyOfficeDisplayCacheFromStore();
    }
    try {
      await hostApiFetch(`/api/office/projects/${encodeURIComponent(projectId)}/abort`, {
        method: 'POST',
      });
    } catch (error) {
      if (before) {
        set((state) => ({
          tempProjects: state.tempProjects.map((p) => (p.id === projectId ? before : p)),
        }));
        applyOfficeDisplayCacheFromStore();
      }
      throw error;
    }
    await get().fetchSnapshot();
    const after = get().tempProjects.find((p) => p.id === projectId);
    if (after?.abortQuiescing) {
      startAbortQuiescePoll(projectId);
    } else {
      stopAbortQuiescePoll(projectId);
    }
    // Abort terminal is written after local persist; executing-room poll already stopped.
    await get().fetchRoomMessages(projectId, { urgent: true });
  },

  submitWorkflowReview: async (projectId, nodeId, decision, batchUpdatedAt) => {
    const res = await submitWorkflowReviewDecision(projectId, {
      nodeId,
      decision,
      batchUpdatedAt,
    });
    if (!res.success || !res.project) {
      throw new Error(res.error ?? 'workflow_review_submit_failed');
    }
    set((state) => ({
      tempProjects: state.tempProjects.map((p) => (p.id === res.project!.id ? res.project! : p)),
    }));
    applyOfficeDisplayCacheFromStore();
    await get().fetchSnapshot({ notifyReview: false });
    return res.project;
  },

  settleWorkflowReview: async (projectId, settleGeneration) => {
    const res = await settleWorkflowReviewBatch(projectId, settleGeneration);
    if (!res.success || !res.project) {
      throw new Error(res.error ?? 'workflow_review_settle_failed');
    }
    set((state) => ({
      tempProjects: state.tempProjects.map((p) => (p.id === res.project!.id ? res.project! : p)),
    }));
    applyOfficeDisplayCacheFromStore();
    await get().fetchSnapshot({ notifyReview: false });
    return res.project;
  },

  deleteTempProject: async (projectId) => {
    await hostApiFetch(`/api/office/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
    stopRoomReplyPoll(projectId);
    stopProjectRunPoll(projectId);
    removeOfficeDisplayCacheProject(projectId);
    clearOfficeProjectPrefetchTracking(projectId);
    set((s) => {
      const { [projectId]: _removed, ...projectAgentStateByProject } = s.projectAgentStateByProject;
      const roomMessagesByProject = Object.fromEntries(
        Object.entries(s.roomMessagesByProject).filter(([id]) => id !== projectId),
      );
      return {
        ...withRoomMessageAliases(roomMessagesByProject),
        ...withWatchIdAliases(s.roomMessageWatchProjectIds.filter((id) => id !== projectId)),
        projectAgentStateByProject,
      };
    });
    applyOfficeDisplayCacheFromStore();
    await get().fetchSnapshot();
  },

  deleteArchivedProject: async (projectId) => {
    await hostApiFetch(`/api/office/projects/${encodeURIComponent(projectId)}/delete-archived`, {
      method: 'POST',
    });
    stopRoomReplyPoll(projectId);
    stopProjectRunPoll(projectId);
    removeOfficeDisplayCacheProject(projectId);
    clearOfficeProjectPrefetchTracking(projectId);
    set((s) => {
      const { [projectId]: _removed, ...projectAgentStateByProject } = s.projectAgentStateByProject;
      const roomMessagesByProject = Object.fromEntries(
        Object.entries(s.roomMessagesByProject).filter(([id]) => id !== projectId),
      );
      return {
        ...withRoomMessageAliases(roomMessagesByProject),
        ...withWatchIdAliases(s.roomMessageWatchProjectIds.filter((id) => id !== projectId)),
        projectAgentStateByProject,
      };
    });
    applyOfficeDisplayCacheFromStore();
    await get().fetchSnapshot();
  },

  fetchRoomMessages: async (projectId, options) => {
    const fetchGeneration =
      options?.roomFetchGeneration ?? captureProjectRoomFetchGeneration(projectId);
    const urgentQs = options?.urgent ? '?urgent=1' : '';
    const res = await hostApiFetch<{ success: boolean; messages: RoomMessage[] }>(
      `/api/office/projects/${encodeURIComponent(projectId)}/room/messages${urgentQs}`,
    );
    const messages = res.messages ?? [];
    set((state) =>
      withRoomMessageAliases({ ...state.roomMessagesByProject, [projectId]: messages }),
    );
    notifyProjectRoomFetched(projectId, fetchGeneration);
    applyOfficeDisplayCacheFromStore();
  },

  reconcileActiveProjectAgentStates: (groupId, activeProjectIds) => {
    const group = get().fixedGroups.find((g) => g.id === groupId);
    if (!group || activeProjectIds.length === 0) return;
    set((state) => {
      const next: ProjectAgentStateCache = { ...state.projectAgentStateByProject };
      for (const projectId of activeProjectIds) {
        const project = state.tempProjects.find((p) => p.id === projectId);
        if (!project) continue;
        const executing = isOfficeTaskExecuting(project);
        const map: ProjectAgentStateMap = {};
        for (const agentId of group.agentIds) {
          map[agentId] = executing ? 'working' : 'idle';
        }
        next[projectId] = map;
      }
      return { projectAgentStateByProject: next };
    });
  },

  postRoomMessage: async (projectId, content, opts) => {
    const res = await hostApiFetch<{
      success: boolean;
      pendingReplies?: boolean;
    }>(`/api/office/projects/${encodeURIComponent(projectId)}/room/messages`, {
      method: 'POST',
      body: JSON.stringify({
        content,
        replyToId: opts?.replyToId,
      }),
    });
    await get().fetchRoomMessages(projectId, { urgent: true });
    if (res.pendingReplies !== false) {
      stopRoomReplyPoll(projectId);
      addRoomMessageWatch(projectId);
      let ticks = 0;
      const runReplyPollTick = () => {
        void (async () => {
          const syncReady = await waitForOfficeExecutionSyncActive(2_000);
          if (!syncReady) return;
          const live = get().tempProjects.find((p) => p.id === projectId);
          if (!live || !isOfficeTaskExecuting(live)) {
            stopRoomReplyPoll(projectId);
            return;
          }
          await get().fetchRoomMessages(projectId);
          await get().fetchProjectProgress(projectId, { notifyReview: false, silent: true });
          const gid = groupIdForProject(live, get().fixedGroups);
          if (gid) {
            get().reconcileActiveProjectAgentStates(gid, [projectId]);
          }
        })();
      };
      void (async () => {
        const syncReady = await waitForOfficeExecutionSyncActive();
        if (!syncReady) return;
        runReplyPollTick();
        const fastPoll = window.setInterval(() => {
          runReplyPollTick();
          ticks += 1;
          if (ticks >= ROOM_REPLY_POLL_MAX_TICKS) {
            window.clearInterval(fastPoll);
            const slowPoll = window.setInterval(runReplyPollTick, ROOM_REPLY_POLL_SLOW_INTERVAL_MS);
            roomReplyPollers.set(projectId, slowPoll);
          }
        }, ROOM_REPLY_POLL_INTERVAL_MS);
        roomReplyPollers.set(projectId, fastPoll);
      })();
    }
  },

  setSelectedGroup: (id) =>
    set({
      selectedGroupId: id,
      ...withWatchIdAliases([]),
      projectAgentStateByProject: {},
    }),
  setSelectedAgent: (id) => set({ selectedAgentId: id }),
  openChat: (sessionKey, title) => set({ chatSessionKey: sessionKey, chatTitle: title }),
  closeChat: () => set({ chatSessionKey: null, chatTitle: '' }),

  createScenario: async (body) =>
    get().createFixedGroup({
      name: body.name,
      description: body.description,
      agentIds: body.roleIds,
      coordinatorAgentId: body.coordinatorRoleId,
      workflow: body.workflow ?? { mode: 'dag', nodes: [], edges: [] },
    }),

  updateScenario: async (groupId, patch) => get().updateFixedGroup(groupId, patch),

  deleteScenario: async (groupId) => {
    const childCount = get().tempProjects.filter((p) => p.parentGroupId === groupId).length;
    await get().deleteFixedGroup(groupId);
    return { deletedRoleCount: 0, deletedTaskCount: childCount };
  },

  reorderScenarios: async (orderedIds) => get().reorderFixedGroups(orderedIds),

  createTask: async (body) =>
    get().spawnProjectFromGroup(body.scenarioId, {
      title: body.title,
      featureDescription: body.featureDescription,
      description: body.description,
      coordinatorAgentId: body.coordinatorRoleId,
      agentIds: body.assignedRoleIds,
      executionMode: body.executionMode,
      workflowEngine: body.workflowEngine,
      workflow: body.workflow,
      langGraphWorkflowBundle: body.langGraphWorkflowBundle,
    }),

  updateTask: async (projectId, patch) => get().updateTempProject(projectId, patch),

  runTask: async (projectId, options) => get().runProject(projectId, options),

  abortTask: async (projectId) => get().abortProject(projectId),

  deleteTask: async (projectId) => get().deleteTempProject(projectId),

  setSelectedScenario: (id) => get().setSelectedGroup(id),

  setSelectedRole: (id) => get().setSelectedAgent(id),
}));
