import {
  buildMentionProgressContextBlock,
  buildSmartCoordinatorCompactProgressContext,
  buildSmartMentionProgressContextBlock,
} from '../../../src/lib/office-mention-progress-context';
import { buildOfficeProjectDirectoryPolicyLines } from '../../../src/lib/office-project-paths';
import { formatOfficeProjectRootDisplayPath } from '../../../src/lib/office-smart-task-prompt-common';
import type { ProjectAgentRef } from '../../../src/lib/office-workflow-node';
import { OPENCLAW_HOME } from '../../utils/openclaw-paths';
import { resolveCoordinatorPathContext } from './project-context-paths';
import { loadProjectNotebookPromptForViewer, loadAgentStatusLineMap } from './project-context-load';
import {
  readProjectManifest,
  readProjectProgress,
  syncCoordinatorProgressFromTask,
} from './coordinator-project-fs';
import { resolveCoordinatorAgentId } from './project-context-paths';
import { isSmartTask } from './task-execution-mode';
import { getTempProject, listProjectAgents } from './store';
import type { OfficeFixedGroup, OfficeTempProject, RoomMessage } from './types';
import { workflowForProject } from './workflow-graph';

export async function loadFocusProjectForGroup(
  groupId: string,
  focus: OfficeTempProject | null,
): Promise<OfficeTempProject | null> {
  if (!focus) return null;
  const latest = await getTempProject(focus.id);
  if (latest && latest.parentGroupId === groupId) return latest;
  return latest ?? focus;
}

/** @deprecated use loadFocusProjectForGroup */
export const loadFocusTaskForScenario = loadFocusProjectForGroup;

export type MentionTaskContext = {
  taskProgressContext: string | null;
  projectNotebookContext: string | null;
  projectRootDisplay: string | null;
};

export async function buildMentionTaskContextForViewer(params: {
  scenarioId: string;
  focus: OfficeTempProject;
  group: Pick<OfficeFixedGroup, 'workflow' | 'coordinatorAgentId' | 'agentIds'>;
  /** @deprecated use group */
  scenario?: Pick<OfficeFixedGroup, 'workflow' | 'coordinatorAgentId' | 'agentIds'>;
  roomMessages: RoomMessage[];
  members: ProjectAgentRef[];
  /** @deprecated use members */
  roles?: ProjectAgentRef[];
  viewerAgentId: string;
  /** @deprecated use viewerAgentId */
  viewerRoleId?: string;
  isCoordinator: boolean;
}): Promise<MentionTaskContext> {
  const group = params.group ?? params.scenario!;
  const members = params.members ?? params.roles ?? [];
  const viewerAgentId = (params.viewerAgentId ?? params.viewerRoleId ?? '').trim();
  const { focus, roomMessages, isCoordinator } = params;
  const coord = resolveCoordinatorAgentId(focus, group);
  const projectRootDisplay = formatOfficeProjectRootDisplayPath(focus.title, focus.id, OPENCLAW_HOME);
  const allMembers = await listProjectAgents();
  const pathCtx = coord ? await resolveCoordinatorPathContext(coord, members) : null;
  const manifest = pathCtx
    ? await readProjectManifest(pathCtx, focus.title, focus.id)
    : null;
  const epoch = manifest?.epoch ?? 1;
  const coordMember = coord
    ? members.find((m) => m.agentId === coord.coordinatorAgentId)
    : null;

  if (isSmartTask(focus)) {
    const projectDirBlock = coord && coordMember
      ? buildOfficeProjectDirectoryPolicyLines(
          { agentId: coordMember.agentId, name: coordMember.displayName },
          allMembers.map((m) => ({ agentId: m.agentId, name: m.displayName })),
          focus.title,
          focus.id,
          OPENCLAW_HOME,
        ).join('\n')
      : null;
    const savedRoleSections = await loadAgentStatusLineMap({
      project: focus,
      group,
      members,
      epoch,
      coordinatorOnlyAll: isCoordinator,
      viewerAgentId,
    });
    let baseProgress: string | null;
    if (isCoordinator) {
      const notebookRow = pathCtx
        ? await readProjectProgress(pathCtx, focus.title, focus.id)
        : null;
      baseProgress = buildSmartCoordinatorCompactProgressContext({
        task: focus,
        roles: members,
        savedRoleSections,
        coordinatorSummary: notebookRow?.coordinatorSummary ?? null,
        roomMessages,
      });
    } else {
      baseProgress = buildSmartMentionProgressContextBlock({
        task: focus,
        roomMessages,
        roles: members,
        viewerAgentId,
        isCoordinator: false,
        savedRoleSections,
      });
    }
    const taskProgressContext = [projectDirBlock, baseProgress]
      .filter(Boolean)
      .join('\n\n');
    return { taskProgressContext, projectNotebookContext: null, projectRootDisplay };
  }

  const wf = workflowForProject(focus, group);
  const projectDirBlock = coord && coordMember
    ? buildOfficeProjectDirectoryPolicyLines(
        { agentId: coordMember.agentId, name: coordMember.displayName },
        allMembers.map((m) => ({ agentId: m.agentId, name: m.displayName })),
        focus.title,
        focus.id,
        OPENCLAW_HOME,
      ).join('\n')
    : null;
  const roleList = members.map((m) => ({ id: m.agentId, name: m.displayName }));
  const taskProgressContext =
    wf.nodes.length > 0
      ? [
          projectDirBlock,
          buildMentionProgressContextBlock({
            task: focus,
            workflowNodes: wf.nodes,
            workflowEdges: wf.edges,
            roomMessages,
            roles: roleList,
            viewerRoleId: viewerAgentId,
            isCoordinator,
          }),
        ]
          .filter(Boolean)
          .join('\n\n')
      : projectDirBlock;

  const projectNotebookContext =
    isCoordinator && wf.nodes.length > 0
      ? await loadProjectNotebookPromptForViewer({
          groupId: params.scenarioId,
          project: focus,
          group,
          workflowNodes: wf.nodes,
          members,
          viewerAgentId,
          isCoordinator,
          roomMessages,
        })
      : null;

  return { taskProgressContext, projectNotebookContext, projectRootDisplay };
}

function legacyMentionMemberRef(
  member?: (ProjectAgentRef & { id?: string; name?: string }) | null,
): ProjectAgentRef | null {
  if (!member) return null;
  const agentId = (member.agentId ?? member.id ?? '').trim();
  const displayName =
    (member.displayName ?? member.name ?? agentId).trim() || agentId;
  if (!agentId && !displayName) return null;
  return { agentId: agentId || displayName, displayName };
}

function legacyMentionGroupFromParams(params: {
  group?: Pick<OfficeFixedGroup, 'workflow' | 'coordinatorAgentId' | 'agentIds'>;
  scenario?: Pick<OfficeFixedGroup, 'workflow' | 'coordinatorAgentId' | 'agentIds'>;
  project?: OfficeTempProject;
  task?: OfficeTempProject;
}): Pick<OfficeFixedGroup, 'workflow' | 'coordinatorAgentId' | 'agentIds'> | null {
  if (params.group) return params.group;
  if (params.scenario) return params.scenario;
  const project = params.project ?? params.task;
  if (!project) return null;
  return {
    workflow: project.workflow ?? { mode: 'dag', nodes: [], edges: [] },
    coordinatorAgentId: project.coordinatorAgentId,
    agentIds: [...project.agentIds],
  };
}

function legacyMentionMembersFromParams(
  members: Array<ProjectAgentRef & { id?: string; name?: string }>,
): ProjectAgentRef[] {
  return members
    .map((m) => legacyMentionMemberRef(m))
    .filter((m): m is ProjectAgentRef => m != null);
}

export async function persistAgentWorkStatusAfterMentionReply(params: {
  groupId?: string;
  project?: OfficeTempProject;
  group?: Pick<OfficeFixedGroup, 'workflow' | 'coordinatorAgentId' | 'agentIds'>;
  member?: ProjectAgentRef;
  latestReplySnippet: string;
  /** @deprecated */
  scenarioId?: string;
  task?: OfficeTempProject;
  scenario?: Pick<OfficeFixedGroup, 'workflow' | 'coordinatorAgentId' | 'agentIds'>;
  role?: ProjectAgentRef & { id?: string; name?: string };
}): Promise<void> {
  const project = params.project ?? params.task;
  const group = legacyMentionGroupFromParams(params);
  const member = legacyMentionMemberRef(params.member ?? params.role);
  if (!project || !group || !member) return;

  const { persistAgentWorkStatusAfterExpression } = await import('./role-work-status-fs');
  const { membersForAgentIds } = await import('./office-member-resolve');
  const agentIds = group.agentIds ?? project.agentIds ?? [];
  const teamMembers = await membersForAgentIds(agentIds);
  await persistAgentWorkStatusAfterExpression({
    project,
    group,
    member,
    progress: params.latestReplySnippet,
    members: teamMembers,
  });
}

/** @deprecated */
export const persistRoleWorkStatusAfterMentionReply = persistAgentWorkStatusAfterMentionReply;
export const persistRoleNotebookAfterMentionReply = persistAgentWorkStatusAfterMentionReply;

export async function syncCoordinatorNotebookAfterMention(params: {
  scenarioId: string;
  focus: OfficeTempProject;
  group?: Pick<OfficeFixedGroup, 'workflow' | 'coordinatorAgentId' | 'agentIds'>;
  /** @deprecated use group */
  scenario?: Pick<OfficeFixedGroup, 'workflow' | 'coordinatorAgentId' | 'agentIds'>;
  members?: ProjectAgentRef[];
  /** @deprecated use members */
  roles?: ProjectAgentRef[];
  coordinatorReplyText?: string;
}): Promise<void> {
  const group = params.group ?? params.scenario!;
  const members = params.members ?? params.roles ?? [];
  const { focus } = params;
  if (isSmartTask(focus)) {
    if (!params.coordinatorReplyText?.trim()) return;
    const coord = resolveCoordinatorAgentId(focus, group);
    if (!coord) return;
    const { syncSmartCoordinatorNotebookFromRoomReply } = await import(
      './coordinator-project-fs'
    );
    await syncSmartCoordinatorNotebookFromRoomReply({
      coordinatorAgentId: coord.coordinatorAgentId,
      coordinatorRoleId: coord.coordinatorAgentId,
      teamRoles: legacyMentionMembersFromParams(members),
      task: focus,
      replyText: params.coordinatorReplyText,
    });
    return;
  }
  const wf = workflowForProject(focus, group);
  if (wf.nodes.length === 0) return;
  const coord = resolveCoordinatorAgentId(focus, group);
  if (!coord) return;
  await syncCoordinatorProgressFromTask({
    coordinatorAgentId: coord.coordinatorAgentId,
    coordinatorRoleId: coord.coordinatorAgentId,
    teamRoles: members,
    task: focus,
    workflowNodes: wf.nodes,
    roles: members.map((m) => ({ id: m.agentId, name: m.displayName })),
  });
}
