/**
 * Office 展示缓存数据镜像：将 store 中界面所需数据写入 OfficeDisplayCache，与持久化保持一致。
 */

import {
  getOfficeDisplayCache,
  getOfficeDisplayCacheGeneration,
  isOfficeDisplayCacheSyncReady,
  patchOfficeDisplayCacheData,
} from '@/lib/office-display-cache';
import { isOfficeProjectArchived, isOfficeProjectExecuting } from '@/lib/office-room-sidebar';
import { useAgentsStore } from '@/stores/agents';
import { useOfficeStore } from '@/stores/office';
import type { AgentSummary } from '@/types/agent';
import type {
  OfficeFixedGroup,
  OfficeTempProject,
  RoomMessage,
} from '@/types/office';

const APPLY_DEBOUNCE_MS = 32;

type CachedRoomEntry = {
  phase: 'idle' | 'loading' | 'ready';
  revision?: string;
  messages: RoomMessage[];
};

let applyDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function roomMessagesRevision(messages: RoomMessage[]): string {
  if (messages.length === 0) return '0';
  const last = messages[messages.length - 1]!;
  return `${messages.length}:${last.id}:${last.timestamp ?? ''}`;
}

function projectsRevision(projects: OfficeTempProject[]): string {
  return projects
    .map((project) => `${project.id}:${project.updatedAt ?? ''}:${project.status}:${project.lifecycle ?? 'active'}`)
    .join('|');
}

/** Shallow-copy room rows; avoid structuredClone on large chat transcripts. */
function cloneRoomMessages(messages: RoomMessage[]): RoomMessage[] {
  return messages.map((message) => ({ ...message }));
}

function cloneProjectSnapshot(project: OfficeTempProject): OfficeTempProject {
  return { ...project, nodeRuns: project.nodeRuns.map((run) => ({ ...run })) };
}

function cloneFixedGroups(groups: OfficeFixedGroup[]): OfficeFixedGroup[] {
  return groups.map((group) => ({ ...group, agentIds: [...group.agentIds] }));
}

function cloneAgents(agents: AgentSummary[]): AgentSummary[] {
  return agents.map((agent) => ({ ...agent }));
}

function countArchivedProjects(projects: OfficeTempProject[]): number {
  return projects.filter((p) => isOfficeProjectArchived(p)).length;
}

function applyOfficeDisplayCacheFromStoreCore(): void {
  const cache = getOfficeDisplayCache();
  if (cache.sync.phase === 'idle') return;

  const office = useOfficeStore.getState();
  const agents = useAgentsStore.getState();
  const allProjects = office.tempProjects;
  const activeProjects = allProjects.filter((p) => !isOfficeProjectArchived(p));
  const activeIds = new Set(activeProjects.map((p) => p.id));
  const preferredId = cache.sync.preferredProjectId;

  const projectCards = { ...cache.sync.projectCards };
  for (const project of activeProjects) {
    const prev = projectCards[project.id];
    const prevProject = prev?.project;
    const projectChanged =
      !prevProject
      || prevProject.updatedAt !== project.updatedAt
      || prevProject.status !== project.status
      || prevProject.lifecycle !== project.lifecycle;
    projectCards[project.id] = {
      phase: prev?.phase ?? 'idle',
      project: projectChanged ? cloneProjectSnapshot(project) : prevProject!,
    };
  }
  for (const projectId of Object.keys(projectCards)) {
    if (!activeIds.has(projectId) && projectId !== preferredId) {
      delete projectCards[projectId];
    }
  }

  const storeRoomIds = new Set(Object.keys(office.roomMessagesByProject));
  const rooms: Record<string, CachedRoomEntry> = { ...cache.async.rooms };
  for (const [projectId, messages] of Object.entries(office.roomMessagesByProject)) {
    if (projectId === preferredId) continue;
    const prev = rooms[projectId];
    const revision = roomMessagesRevision(messages);
    if (prev?.revision === revision) {
      continue;
    }
    rooms[projectId] = {
      phase: prev?.phase ?? 'idle',
      revision,
      messages: cloneRoomMessages(messages),
    };
  }
  for (const projectId of Object.keys(rooms)) {
    if (!storeRoomIds.has(projectId)) {
      delete rooms[projectId];
    }
  }

  const archivedProjects = allProjects.filter((p) => isOfficeProjectArchived(p));
  const archivedRevision = projectsRevision(archivedProjects);
  const archived =
    cache.async.archived.phase === 'idle'
    && cache.async.archived.projects.length === 0
    && archivedProjects.length === 0
      ? cache.async.archived
      : (cache.async.archived as { revision?: string }).revision === archivedRevision
        && cache.async.archived.projects.length === archivedProjects.length
        ? cache.async.archived
        : {
            ...cache.async.archived,
            revision: archivedRevision,
            projects: archivedProjects.map((p) => cloneProjectSnapshot(p)),
          };

  let preferred = cache.sync.preferred;
  if (preferredId) {
    const livePreferred = allProjects.find((p) => p.id === preferredId) ?? null;
    if (livePreferred) {
      const preferredMessages = office.roomMessagesByProject[preferredId] ?? preferred?.roomMessages ?? [];
      const preferredRevision = roomMessagesRevision(preferredMessages);
      const preferredUnchanged =
        preferred?.project.updatedAt === livePreferred.updatedAt
        && preferred?.project.status === livePreferred.status
        && preferred?.roomMessages
        && roomMessagesRevision(preferred.roomMessages) === preferredRevision;
      preferred = preferredUnchanged
        ? preferred
        : {
            project: cloneProjectSnapshot(livePreferred),
            roomMessages: cloneRoomMessages(preferredMessages),
          };
      const card = projectCards[preferredId];
      projectCards[preferredId] = {
        phase: card?.phase ?? 'ready',
        project: card?.project?.updatedAt === livePreferred.updatedAt
          ? card.project
          : cloneProjectSnapshot(livePreferred),
      };
    } else {
      preferred = null;
    }
  }

  const nextTempProjects = activeProjects.map(
    (project) => projectCards[project.id]?.project ?? cloneProjectSnapshot(project),
  );

  patchOfficeDisplayCacheData({
    sync: {
      fixedGroups:
        cache.sync.fixedGroups === office.fixedGroups
          ? cache.sync.fixedGroups
          : cloneFixedGroups(office.fixedGroups),
      tempProjects: nextTempProjects,
      archivedCount: countArchivedProjects(allProjects),
      agentBindings:
        cache.sync.agentBindings === office.agentBindings
          ? cache.sync.agentBindings
          : { ...office.agentBindings },
      agents:
        cache.sync.agents === agents.agents ? cache.sync.agents : cloneAgents(agents.agents),
      preferred,
      projectCards,
    },
    async: { rooms, archived },
  });
}

/** 将 office/agents store 的展示数据同步到 OfficeDisplayCache（短 debounce 合并 burst）。 */
export function applyOfficeDisplayCacheFromStore(options?: { flush?: boolean }): void {
  if (options?.flush) {
    if (applyDebounceTimer) {
      clearTimeout(applyDebounceTimer);
      applyDebounceTimer = null;
    }
    applyOfficeDisplayCacheFromStoreCore();
    return;
  }
  if (applyDebounceTimer) return;
  applyDebounceTimer = setTimeout(() => {
    applyDebounceTimer = null;
    applyOfficeDisplayCacheFromStoreCore();
  }, APPLY_DEBOUNCE_MS);
}

/** @internal test helper */
export function flushOfficeDisplayCacheFromStoreForTest(): void {
  applyOfficeDisplayCacheFromStore({ flush: true });
}

export function mirrorPreferredFromStore(preferredId: string | null): void {
  if (!preferredId) {
    patchOfficeDisplayCacheData({ sync: { preferred: null } });
    return;
  }
  const office = useOfficeStore.getState();
  const project = office.tempProjects.find((p) => p.id === preferredId);
  if (!project) {
    patchOfficeDisplayCacheData({ sync: { preferred: null } });
    return;
  }
  const roomMessages = office.roomMessagesByProject[preferredId] ?? [];
  const revision = roomMessagesRevision(roomMessages);
  const cache = getOfficeDisplayCache();
  const existing = cache.sync.preferred;
  const unchanged =
    existing?.project.id === project.id
    && existing.project.updatedAt === project.updatedAt
    && existing.project.status === project.status
    && roomMessagesRevision(existing.roomMessages) === revision;
  const projectCards = { ...cache.sync.projectCards };
  projectCards[preferredId] = {
    phase: 'ready',
    project: unchanged ? existing!.project : cloneProjectSnapshot(project),
  };
  patchOfficeDisplayCacheData({
    sync: {
      preferred: unchanged
        ? existing
        : {
            project: cloneProjectSnapshot(project),
            roomMessages: cloneRoomMessages(roomMessages),
          },
      projectCards,
    },
  });
}

/**
 * preferred 目标切换：先镜像 store，complete 档再后台拉取展开/群聊。
 */
export function schedulePreferredSyncRefresh(preferredId: string | null): void {
  if (!isOfficeDisplayCacheSyncReady()) return;
  mirrorPreferredFromStore(preferredId);
  applyOfficeDisplayCacheFromStore({ flush: true });
  if (!preferredId) return;

  const hydrationLevel = getOfficeDisplayCache().sync.hydrationLevel;
  const urgent = hydrationLevel === 'complete';
  const workGeneration = getOfficeDisplayCacheGeneration();
  void (async () => {
    const office = useOfficeStore.getState();
    const project = office.tempProjects.find((p) => p.id === preferredId);
    if (!project || isOfficeProjectArchived(project)) return;
    if (urgent && isOfficeProjectExecuting(project)) {
      await office.fetchProjectProgress(preferredId, { notifyReview: false, silent: true });
    }
    await office.fetchRoomMessages(preferredId, urgent ? { urgent: true } : {});
    if (workGeneration !== getOfficeDisplayCacheGeneration()) return;
    if (getOfficeDisplayCache().sync.preferredProjectId !== preferredId) return;
    mirrorPreferredFromStore(preferredId);
    applyOfficeDisplayCacheFromStore({ flush: true });
  })();
}

export function getOfficeDisplayCacheRoomMessagesMap(): Record<string, RoomMessage[]> {
  const cache = getOfficeDisplayCache();
  const result: Record<string, RoomMessage[]> = {};
  for (const [projectId, entry] of Object.entries(cache.async.rooms)) {
    result[projectId] = entry.messages;
  }
  if (cache.sync.preferred) {
    result[cache.sync.preferred.project.id] = cache.sync.preferred.roomMessages;
  }
  return result;
}
