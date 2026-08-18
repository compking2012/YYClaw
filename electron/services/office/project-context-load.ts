import { formatRoleStatusForPrompt } from '../../../src/lib/office-project-context';
import {
  formatProjectNotebookPromptBlock,
  buildSmartCoordinatorSummaryFromRoom,
} from '../../../src/lib/office-project-notebook';
import type { ProjectAgentRef } from '../../../src/lib/office-workflow-node';
import {
  ensureProjectManifest,
  readProjectManifest,
  readProjectProgress,
  syncCoordinatorProgressFromTask,
} from './coordinator-project-fs';
import {
  resolveCoordinatorAgentId,
  resolveCoordinatorPathContext,
} from './project-context-paths';
import { readLastRoleWorkStatus } from './role-work-status-fs';
import type { OfficeFixedGroup, OfficeTempProject, RoomMessage, WorkflowNode } from './types';

type LoadProjectEpochInput = {
  project?: Pick<OfficeTempProject, 'id' | 'title' | 'coordinatorAgentId' | 'agentIds'>;
  group?: Pick<OfficeFixedGroup, 'coordinatorAgentId' | 'agentIds'> | null;
  members?: ProjectAgentRef[];
  /** @deprecated use project */
  task?: Pick<OfficeTempProject, 'id' | 'title' | 'coordinatorAgentId' | 'agentIds'>;
  /** @deprecated use group */
  scenario?: {
    coordinatorAgentId?: string;
    coordinatorRoleId?: string;
    agentIds?: string[];
    roleIds?: string[];
  } | null;
  /** @deprecated use members */
  roles?: Array<{ id: string; name: string; agentId?: string; displayName?: string }>;
};

function normalizeLoadProjectEpochInput(params: LoadProjectEpochInput): {
  project: Pick<OfficeTempProject, 'id' | 'title' | 'coordinatorAgentId' | 'agentIds'>;
  group: Pick<OfficeFixedGroup, 'coordinatorAgentId' | 'agentIds'> | null;
  members: ProjectAgentRef[];
} | null {
  const project = params.project ?? params.task;
  if (!project) return null;
  const members =
    params.members
    ?? (params.roles ?? []).map((r) => ({
    agentId: (r.agentId ?? r.id ?? '').trim(),
    displayName: (r.displayName ?? r.name ?? r.agentId ?? r.id ?? '').trim() || 'member',
    }));
  const rawGroup: {
    coordinatorAgentId?: string;
    coordinatorRoleId?: string;
    agentIds?: string[];
    roleIds?: string[];
  } | null = params.group ?? params.scenario ?? null;
  const group = rawGroup
    ? {
        coordinatorAgentId: (
          rawGroup.coordinatorAgentId
          ?? rawGroup.coordinatorRoleId
          ?? ''
        ).trim(),
        agentIds: rawGroup.agentIds ?? rawGroup.roleIds ?? [],
      }
    : null;
  return { project, group, members };
}

export async function loadProjectEpoch(
  params: LoadProjectEpochInput,
): Promise<{ epoch: number; coordinatorAgentId: string } | null> {
  const normalized = normalizeLoadProjectEpochInput(params);
  if (!normalized) return null;
  const { project, group, members } = normalized;
  const coord = resolveCoordinatorAgentId(project, group);
  if (!coord) return null;
  const pathCtx = await resolveCoordinatorPathContext(coord, members);
  const manifest = await readProjectManifest(pathCtx, project.title, project.id);
  if (!manifest) return { epoch: 1, coordinatorAgentId: coord.coordinatorAgentId };
  return { epoch: manifest.epoch, coordinatorAgentId: coord.coordinatorAgentId };
}

export async function loadAgentStatusLineMap(params: {
  project: Pick<OfficeTempProject, 'id' | 'title' | 'coordinatorAgentId' | 'agentIds'>;
  group?: Pick<OfficeFixedGroup, 'coordinatorAgentId' | 'agentIds'> | null;
  members: ProjectAgentRef[];
  epoch: number;
  viewerAgentId?: string;
  coordinatorOnlyAll?: boolean;
}): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const members =
    params.coordinatorOnlyAll || !params.viewerAgentId
      ? params.members
      : params.members.filter((m) => m.agentId === params.viewerAgentId);

  const coord = resolveCoordinatorAgentId(params.project, params.group);
  if (!coord) return out;

  for (const member of members) {
    const last = await readLastRoleWorkStatus({
      coordinatorAgentId: coord.coordinatorAgentId,
      coordinatorRoleId: coord.coordinatorAgentId,
      teamRoles: params.members,
      taskTitle: params.project.title,
      taskId: params.project.id,
      roleId: member.agentId,
      roleName: member.displayName,
      epoch: params.epoch,
    });
    if (last) out[member.agentId] = formatRoleStatusForPrompt(last);
  }
  return out;
}

/** @deprecated use loadAgentStatusLineMap */
export const loadRoleStatusLineMap = loadAgentStatusLineMap;

export async function loadProjectNotebookPromptForViewer(params: {
  groupId: string;
  project: OfficeTempProject;
  group: Pick<OfficeFixedGroup, 'coordinatorAgentId' | 'agentIds' | 'workflow'>;
  workflowNodes: WorkflowNode[];
  members: ProjectAgentRef[];
  viewerAgentId: string;
  isCoordinator: boolean;
  roomMessages: RoomMessage[];
}): Promise<string | null> {
  if (!params.isCoordinator) return null;

  const coord = resolveCoordinatorAgentId(params.project, params.group);
  if (!coord) return null;

  const pathCtx = await resolveCoordinatorPathContext(coord, params.members);
  await ensureProjectManifest({
    task: params.project,
    coordinatorAgentId: coord.coordinatorAgentId,
    coordinatorRoleId: coord.coordinatorAgentId,
    teamRoles: params.members,
  });
  const manifest = await readProjectManifest(pathCtx, params.project.title, params.project.id);
  const epoch = manifest?.epoch ?? 1;

  const notebook =
    params.workflowNodes.length > 0
      ? await syncCoordinatorProgressFromTask({
          coordinatorAgentId: coord.coordinatorAgentId,
          coordinatorRoleId: coord.coordinatorAgentId,
          teamRoles: params.members,
          task: params.project,
          workflowNodes: params.workflowNodes,
          roles: params.members.map((m) => ({ id: m.agentId, name: m.displayName })),
        })
      : (await readProjectProgress(pathCtx, params.project.title, params.project.id)) ?? {
          taskId: params.project.id,
          taskTitle: params.project.title,
          coordinatorSummary: buildSmartCoordinatorSummaryFromRoom({
            task: params.project,
            roomMessages: params.roomMessages,
            roles: params.members,
          }),
          updatedAt: Date.now(),
          roles: {},
        };

  const roleStatusLines = await loadAgentStatusLineMap({
    project: params.project,
    group: params.group,
    members: params.members,
    epoch,
    viewerAgentId: params.viewerAgentId,
    coordinatorOnlyAll: params.isCoordinator,
  });

  return formatProjectNotebookPromptBlock(notebook, {
    isCoordinator: params.isCoordinator,
    viewerRoleId: params.viewerAgentId,
    roleStatusLines,
  });
}
