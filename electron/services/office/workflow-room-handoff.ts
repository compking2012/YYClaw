import { isAbsolute, join } from 'node:path';
import type { GatewayManager } from '../../gateway/manager';
import type {
  NodeRunRecord,
  OfficeExecutionMember,
  OfficeFixedGroup,
  OfficeTempProject,
  RoomMessage,
  RoomMessagePhase,
  WorkflowDefinition,
  WorkflowNode,
} from './types';
import { roleMentionToken } from '../../../src/lib/office-mention';
import { roomMessageFromAgentMatches } from '../../../src/lib/office-agent-id-resolve';
import {
  buildDeliverablePathsRoomContent,
  buildTaskDeliverRoomContents,
} from '../../../src/lib/office-room-deliver';
import {
  nextHandoffTargetsAfterNode,
  nextRoleIdsAfterNode,
} from '../../../src/lib/office-workflow-handoff';
import { isValidWorkflowHandoffRoomMessage } from '../../../src/lib/office-workflow-handoff-compliance';
import { isSubstantiveWorkflowProgressSnippet } from './room-mention-reply-policy';
import { WORKFLOW_UPSTREAM_REWORK_PROGRESS_TEXT } from '../../../src/lib/office-workflow-node-run-settled';
import { roleHasWorkflowNodeDeliverable } from '../../../src/lib/office-workflow-role-step';
import {
  loadProjectExecutionMembers,
  resolveRoomCoordinatorMember,
  executionMemberLabel,
} from './office-execution-members';
import { getRoomMessages, updateRoomMessage } from './store';
import { roomMessageAppliesToNode } from '../../../src/lib/task-room-progress-reconcile';
import { postRoomAnnouncement } from './orchestrator';
import { resolveWorkflowUpstreamMentionRoleIds } from '../../../src/lib/office-workflow-upstream-mention';
import { workflowForTask } from './workflow-graph';
import { isWorkflowTaskRunnerActive } from './workflow-run-registry';
import {
  declaredDeliverablePathsFromWorkflowJson,
  normalizeDeliverablePathForDisk,
} from '../../../src/lib/office-deliverable-disk-resolve';
import { resolveRecordedProjectRoot } from './project-context-paths';
import type { ParsedAgentTaskReply } from './workflow-agent-reply';

export { nextRoleIdsAfterNode };

function stepLabel(task: OfficeTempProject, node: WorkflowNode): string {
  return node.title?.trim() || task.title;
}

function memberPrefix(member: OfficeExecutionMember): string {
  return `${member.emoji ?? '🤖'} 【${executionMemberLabel(member)}】`;
}

export function buildTaskReceivedRoomContent(
  member: OfficeExecutionMember,
  task: OfficeTempProject,
  node: WorkflowNode,
): string {
  return `${memberPrefix(member)}📥 收到任务 · ${stepLabel(task, node)}`;
}

export function buildTaskUnderstandingRoomContent(
  member: OfficeExecutionMember,
  task: OfficeTempProject,
  node: WorkflowNode,
  understanding: string,
): string {
  const body = understanding.trim().slice(0, 600) || '（未提供理解复述）';
  return `${memberPrefix(member)}📝 任务理解 · ${stepLabel(task, node)}\n${body}`;
}

export function buildDependencyWaitRoomContent(
  member: OfficeExecutionMember,
  task: OfficeTempProject,
  node: WorkflowNode,
  blockingMembers: OfficeExecutionMember[],
): string {
  const mentions = blockingMembers.map((m) => `@${roleMentionToken(m)}`).join(' ');
  return [
    `${memberPrefix(member)}⏸️ 等待依赖`,
    `本步「${stepLabel(task, node)}」依赖 ${mentions || '上游成员'} 先完成并交付。`,
    `请 ${mentions} 完成对应步骤后，再执行本步。`,
  ].join('\n');
}

export async function announceDependencyWait(
  gateway: GatewayManager,
  group: OfficeFixedGroup,
  task: OfficeTempProject,
  node: WorkflowNode,
  actor: OfficeExecutionMember,
  blockingMembers: OfficeExecutionMember[],
): Promise<void> {
  const team = await loadProjectExecutionMembers(task);
  const coord = resolveRoomCoordinatorMember(group, team, task, actor);
  if (!coord || blockingMembers.length === 0) return;
  await postRoomAnnouncement(gateway, {
    scenarioId: group.id,
    coordinatorAgentId: coord.agentId,
    fromRoleId: actor.agentId,
    content: buildDependencyWaitRoomContent(actor, task, node, blockingMembers),
    phase: 'task_clarification',
    taskId: task.id,
    nodeId: node.id,
    mentions: blockingMembers.map((m) => m.agentId),
    notifyMentionedRoles: !isWorkflowTaskRunnerActive(task.id),
    syncGateway: true,
  });
}

export function buildTaskClarificationRoomContent(
  member: OfficeExecutionMember,
  task: OfficeTempProject,
  node: WorkflowNode,
  body: string,
): string {
  const text = body.trim().slice(0, 800) || '（无具体疑问）';
  return `${memberPrefix(member)}❓ 协作询问 · ${stepLabel(task, node)}\n${text}`;
}

export function buildTaskRunningRoomContent(
  member: OfficeExecutionMember,
  task: OfficeTempProject,
  node: WorkflowNode,
): string {
  return `${memberPrefix(member)}⚙️ 执行中 · ${stepLabel(task, node)}`;
}

export { buildTaskDeliverRoomContent, buildTaskDeliverRoomContents } from '../../../src/lib/office-room-deliver';

export type TaskHandoffNextMember = {
  member: Pick<OfficeExecutionMember, 'agentId' | 'displayName' | 'emoji'>;
  stepTitle: string;
};

/** @deprecated Use TaskHandoffNextMember */
export type TaskHandoffNextRole = TaskHandoffNextMember;

export function buildTaskHandoffRoomContent(
  member: OfficeExecutionMember,
  task: OfficeTempProject,
  next: TaskHandoffNextMember[],
): string {
  if (next.length === 0) {
    return `${memberPrefix(member)}✅ 本步已完成 · ${task.title}`;
  }
  const parts = next.map(({ member: target, stepTitle }) => {
    const title = stepTitle.trim() || task.title?.trim() || '接续任务';
    return `请@${roleMentionToken(target)} ${title}`;
  });
  return `${memberPrefix(member)}👉 ${parts.join('，')}`;
}

export async function announceWorkflowHandoff(
  gateway: GatewayManager,
  group: OfficeFixedGroup,
  task: OfficeTempProject,
  node: WorkflowNode,
  fromMember: OfficeExecutionMember,
  workflow: Pick<WorkflowDefinition, 'nodes' | 'edges'>,
  runs: Map<string, NodeRunRecord>,
): Promise<void> {
  const targets = nextHandoffTargetsAfterNode(
    node.id,
    workflow.nodes,
    workflow.edges,
    runs,
    task.title,
  );
  if (targets.length === 0) return;
  const team = await loadProjectExecutionMembers(task);
  const history = await getRoomMessages(task.id);
  if (
    history.some(
      (m) =>
        m.nodeId === node.id
        && m.phase === 'task_handoff'
        && isValidWorkflowHandoffRoomMessage(m.content, targets, team),
    )
  ) {
    return;
  }
  const coord = resolveRoomCoordinatorMember(group, team, task, fromMember);
  if (!coord) return;
  const next = targets
    .map((t) => {
      const m = team.find((x) => x.agentId === t.roleId);
      return m ? { member: m, stepTitle: t.stepTitle } : null;
    })
    .filter((x): x is TaskHandoffNextMember => x != null);
  if (next.length === 0) return;
  await postRoomAnnouncement(gateway, {
    scenarioId: group.id,
    coordinatorAgentId: coord.agentId,
    fromRoleId: fromMember.agentId,
    content: buildTaskHandoffRoomContent(fromMember, task, next),
    phase: 'task_handoff',
    taskId: task.id,
    nodeId: node.id,
    mentions: targets.map((t) => t.roleId),
    notifyMentionedRoles: !isWorkflowTaskRunnerActive(task.id),
    syncGateway: true,
  });
}

async function postPhase(
  gateway: GatewayManager,
  group: OfficeFixedGroup,
  fromMember: OfficeExecutionMember,
  coord: OfficeExecutionMember,
  task: OfficeTempProject,
  node: WorkflowNode | null,
  phase: RoomMessagePhase,
  content: string,
  extras?: {
    progressText?: string;
    mentions?: string[];
    notifyMentionedRoles?: boolean;
    syncGateway?: boolean;
  },
): Promise<RoomMessage> {
  const notify = extras?.notifyMentionedRoles ?? false;
  return postRoomAnnouncement(gateway, {
    scenarioId: group.id,
    coordinatorAgentId: coord.agentId,
    fromRoleId: fromMember.agentId,
    content,
    phase,
    progressText: extras?.progressText,
    taskId: task.id,
    nodeId: node?.id,
    mentions: extras?.mentions,
    notifyMentionedRoles: notify,
    syncGateway: extras?.syncGateway ?? notify,
  });
}

export type TaskNodeRoomProgress = {
  runningMessageId: string;
  /** Same room line as runningMessageId: task_received → task_running (one bubble, content updates). */
  promoteToRunning: () => Promise<void>;
  updateProgress: (text: string) => Promise<void>;
  announceUnderstanding: (understanding: string) => Promise<void>;
  announceClarification: (body: string) => Promise<boolean>;
  announceDeliver: (deliverable: string, usage: string) => Promise<void>;
  /** Post the agent's current deliverable COMPLETE (absolute) paths after the deliver/report. */
  announceDeliverablePaths: (absolutePaths: string[]) => Promise<void>;
  announceHandoff: (next: TaskHandoffNextMember[]) => Promise<void>;
  announceFailed: (error: string) => Promise<void>;
  announceOutputRetry: (error: string) => Promise<void>;
  /** Neutral progress-card terminal after upstream rework (no「执行失败」). */
  announceUpstreamReworkProgress: () => Promise<void>;
};

export async function beginTaskNodeRoomPhases(
  gateway: GatewayManager,
  group: OfficeFixedGroup,
  task: OfficeTempProject,
  node: WorkflowNode,
  member: OfficeExecutionMember,
): Promise<TaskNodeRoomProgress | null> {
  const team = await loadProjectExecutionMembers(task);
  const coord = resolveRoomCoordinatorMember(group, team, task, member);
  if (!coord) return null;

  let lastClarificationBody = '';
  let runningPromoted = false;

  const progressMsg = await postPhase(
    gateway,
    group,
    member,
    coord,
    task,
    node,
    'task_received',
    buildTaskReceivedRoomContent(member, task, node),
  );

  const promoteToRunning = async () => {
    if (runningPromoted) return;
    runningPromoted = true;
    await updateRoomMessage(task.id, progressMsg.id, {
      phase: 'task_running',
      content: buildTaskRunningRoomContent(member, task, node),
    });
  };

  const teamForMentions = team.filter((m) => task.agentIds.includes(m.agentId));

  return {
    runningMessageId: progressMsg.id,
    promoteToRunning,
    updateProgress: async (text: string) => {
      const snippet = text.trim().slice(0, 4000);
      if (!isSubstantiveWorkflowProgressSnippet(snippet)) return;
      await promoteToRunning();
      await updateRoomMessage(task.id, progressMsg.id, {
        progressText: snippet,
      });
      if (/协作询问/u.test(snippet) && /[@＠]/u.test(snippet)) {
        const wf = workflowForTask(task, group);
        const upstreamIds = resolveWorkflowUpstreamMentionRoleIds({
          message: {
            from: member.agentId,
            fromRoleId: member.agentId,
            content: snippet,
            phase: 'task_clarification',
            nodeId: node.id,
          },
          speakerRoleId: member.agentId,
          nodes: wf.nodes,
          edges: wf.edges,
          nodeRuns: task.nodeRuns,
          teamRoles: teamForMentions.map((m) => ({
            agentId: m.agentId,
            displayName: m.displayName,
          })),
        });
        if (upstreamIds.length > 0) {
          const trimmed = snippet;
          if (trimmed && trimmed !== lastClarificationBody) {
            lastClarificationBody = trimmed;
            await postPhase(
              gateway,
              group,
              member,
              coord,
              task,
              node,
              'task_clarification',
              buildTaskClarificationRoomContent(member, task, node, trimmed),
              {
                mentions: upstreamIds,
                notifyMentionedRoles: true,
                syncGateway: true,
              },
            );
          }
        }
      }
    },
    announceUnderstanding: async (understanding: string) => {
      await postPhase(
        gateway,
        group,
        member,
        coord,
        task,
        node,
        'task_understanding',
        buildTaskUnderstandingRoomContent(member, task, node, understanding),
        { syncGateway: true },
      );
    },
    announceClarification: async (body: string) => {
      const trimmed = body.trim();
      if (!trimmed || trimmed === lastClarificationBody) return false;
      lastClarificationBody = trimmed;
      const wf = workflowForTask(task, group);
      const mentionIds = resolveWorkflowUpstreamMentionRoleIds({
        message: {
          from: member.agentId,
          fromRoleId: member.agentId,
          content: trimmed,
          phase: 'task_clarification',
          nodeId: node.id,
        },
        speakerRoleId: member.agentId,
        nodes: wf.nodes,
        edges: wf.edges,
        nodeRuns: task.nodeRuns,
        teamRoles: teamForMentions.map((m) => ({
          agentId: m.agentId,
          displayName: m.displayName,
        })),
      });
      await postPhase(
        gateway,
        group,
        member,
        coord,
        task,
        node,
        'task_clarification',
        buildTaskClarificationRoomContent(member, task, node, trimmed),
        {
          mentions: mentionIds.length > 0 ? mentionIds : undefined,
          notifyMentionedRoles: mentionIds.length > 0,
          syncGateway: true,
        },
      );
      return true;
    },
    announceDeliver: async (deliverable: string, usage: string) => {
      await promoteToRunning();
      await updateRoomMessage(task.id, progressMsg.id, {
        progressText: '执行完成',
      });
      const agentRef = { agentId: member.agentId, displayName: member.displayName };
      const contents = buildTaskDeliverRoomContents(agentRef, task, node, deliverable, usage);
      for (const content of contents) {
        await postPhase(gateway, group, member, coord, task, node, 'task_deliver', content, {
          syncGateway: true,
        });
      }
    },
    announceDeliverablePaths: async (absolutePaths: string[]) => {
      const content = buildDeliverablePathsRoomContent(
        { displayName: member.displayName },
        absolutePaths,
      );
      if (!content) return;
      await postPhase(gateway, group, member, coord, task, node, 'task_deliver', content, {
        syncGateway: true,
      });
    },
    announceHandoff: async (next: TaskHandoffNextMember[]) => {
      if (next.length === 0) return;
      await postPhase(
        gateway,
        group,
        member,
        coord,
        task,
        node,
        'task_handoff',
        buildTaskHandoffRoomContent(member, task, next),
        {
          mentions: next.map((n) => n.member.agentId),
          notifyMentionedRoles: false,
          syncGateway: true,
        },
      );
    },
    announceFailed: async (error: string) => {
      await promoteToRunning();
      const { isTaskUserAborted } = await import('./task-run-abort-registry');
      const { isAbortQuiescing } = await import('./project-abort-quiesce');
      const { getTempProject } = await import('./store');
      const { isUserAbortFailureDetail, WORKFLOW_USER_ABORT_NODE_PROGRESS_TEXT } = await import(
        '../../../src/lib/office-workflow-abort'
      );
      // User abort already posts a single system terminal; do not duplicate that copy
      // on every in-flight node progress card. Also treat disk aborted / quiesce —
      // userAborted may already be cleared when gateway idle wins the race.
      const live = await getTempProject(task.id);
      const abortQuiet =
        isTaskUserAborted(task.id)
        || isAbortQuiescing(task.id)
        || live?.abortQuiescing === true
        || live?.status === 'aborted'
        || isUserAbortFailureDetail(error);
      if (abortQuiet) {
        await updateRoomMessage(task.id, progressMsg.id, {
          progressText: WORKFLOW_USER_ABORT_NODE_PROGRESS_TEXT,
        });
        return;
      }
      await updateRoomMessage(task.id, progressMsg.id, {
        progressText: `执行失败：${error.slice(0, 500)}`,
      });
    },
    announceOutputRetry: async (error: string) => {
      await promoteToRunning();
      await updateRoomMessage(task.id, progressMsg.id, {
        progressText: error.slice(0, 500),
      });
    },
    announceUpstreamReworkProgress: async () => {
      await promoteToRunning();
      await updateRoomMessage(task.id, progressMsg.id, {
        progressText: WORKFLOW_UPSTREAM_REWORK_PROGRESS_TEXT,
      });
    },
  };
}

/**
 * room_heal / session rollback: patch the node's running progress card to a neutral
 * short terminal (no「执行失败」) so bubble tint stays non-red.
 */
export async function announceWorkflowNodeUpstreamReworkProgress(
  task: OfficeTempProject,
  node: WorkflowNode,
  member: OfficeExecutionMember,
  group: OfficeFixedGroup,
): Promise<void> {
  const wf = workflowForTask(task, group);
  const room = await getRoomMessages(task.id);
  const running = [...room]
    .filter(
      (m) =>
        (m.phase === 'task_running' || m.phase === 'task_received')
        && roomMessageFromAgentMatches(m, member.agentId)
        && roomMessageAppliesToNode(m, node, wf.nodes),
    )
    .sort((a, b) => b.timestamp - a.timestamp)[0];
  if (!running) return;
  if (running.phase === 'task_received') {
    await updateRoomMessage(task.id, running.id, {
      phase: 'task_running',
      content: buildTaskRunningRoomContent(member, task, node),
    });
  }
  await updateRoomMessage(task.id, running.id, {
    progressText: WORKFLOW_UPSTREAM_REWORK_PROGRESS_TEXT,
  });
}

/** 仅补发交付帖（不新建「收到任务」）；供群聊自愈与 Session 共用交付仪式。 */
export async function deliverWorkflowNodeRoomDeliver(
  gateway: GatewayManager,
  group: OfficeFixedGroup,
  task: OfficeTempProject,
  node: WorkflowNode,
  member: OfficeExecutionMember,
  deliverable: string,
  usage: string,
): Promise<void> {
  const wf = workflowForTask(task, group);
  const room = await getRoomMessages(task.id);
  const running = [...room]
    .filter(
      (m) =>
        (m.phase === 'task_running' || m.phase === 'task_received')
        && roomMessageFromAgentMatches(m, member.agentId)
        && roomMessageAppliesToNode(m, node, wf.nodes),
    )
    .sort((a, b) => b.timestamp - a.timestamp)[0];
  const team = await loadProjectExecutionMembers(task);
  const coord = resolveRoomCoordinatorMember(group, team, task, member);
  if (!coord) return;
  if (roleHasWorkflowNodeDeliverable(room, node, member.agentId, wf.nodes)) return;
  if (running) {
    if (running.phase === 'task_received') {
      await updateRoomMessage(task.id, running.id, {
        phase: 'task_running',
        content: buildTaskRunningRoomContent(member, task, node),
      });
    }
    await updateRoomMessage(task.id, running.id, { progressText: '执行完成' });
  }
  const agentRef = { agentId: member.agentId, displayName: member.displayName };
  const contents = buildTaskDeliverRoomContents(agentRef, task, node, deliverable, usage);
  for (const content of contents) {
    await postPhase(gateway, group, member, coord, task, node, 'task_deliver', content, {
      syncGateway: true,
    });
  }
}

const WORKFLOW_DELIVERABLE_PATHS_ROOM_MARKER = '📎 交付物完整路径';

/** 与 Session 主路径 {@link announceDeliverableAbsolutePaths} 同源：解析 JSON 声明的交付物相对路径。 */
export async function resolveWorkflowDeliverableAbsolutePaths(
  project: Pick<OfficeTempProject, 'id' | 'title' | 'projectRootPath'>,
  parsed: Pick<ParsedAgentTaskReply, 'jsonOutput'>,
): Promise<string[]> {
  const declared = declaredDeliverablePathsFromWorkflowJson(parsed.jsonOutput);
  if (declared.length === 0) return [];
  const root = await resolveRecordedProjectRoot(project);
  if (!root) return [];
  return declared.map((p) => {
    const rel = normalizeDeliverablePathForDisk(p) || p;
    return isAbsolute(rel) ? rel : join(root, rel);
  });
}

async function workflowNodeDeliverablePathsAlreadyAnnounced(
  task: OfficeTempProject,
  node: WorkflowNode,
  memberAgentId: string,
  group: OfficeFixedGroup,
): Promise<boolean> {
  const wf = workflowForTask(task, group);
  const room = await getRoomMessages(task.id);
  return room.some((m) => {
    if (m.phase !== 'task_deliver') return false;
    if (!roomMessageFromAgentMatches(m, memberAgentId)) return false;
    if (!roomMessageAppliesToNode(m, node, wf.nodes)) return false;
    return (m.content ?? '').includes(WORKFLOW_DELIVERABLE_PATHS_ROOM_MARKER);
  });
}

/** 辅助路径 / deliver-only：补发「📎 交付物完整路径」帖（与 roomPhases.announceDeliverablePaths 对齐）。 */
export async function announceWorkflowNodeDeliverableAbsolutePaths(
  gateway: GatewayManager,
  group: OfficeFixedGroup,
  task: OfficeTempProject,
  node: WorkflowNode,
  member: OfficeExecutionMember,
  parsed: Pick<ParsedAgentTaskReply, 'jsonOutput'>,
): Promise<void> {
  if (await workflowNodeDeliverablePathsAlreadyAnnounced(task, node, member.agentId, group)) {
    return;
  }
  const absolute = await resolveWorkflowDeliverableAbsolutePaths(task, parsed);
  const content = buildDeliverablePathsRoomContent({ displayName: member.displayName }, absolute);
  if (!content) return;
  const team = await loadProjectExecutionMembers(task);
  const coord = resolveRoomCoordinatorMember(group, team, task, member);
  if (!coord) return;
  await postPhase(gateway, group, member, coord, task, node, 'task_deliver', content, {
    syncGateway: true,
  });
}

/** @deprecated 使用 {@link deliverWorkflowNodeRoomDeliver} */
export async function finalizeWorkflowNodeDeliverFromRoomHeal(
  gateway: GatewayManager,
  group: OfficeFixedGroup,
  task: OfficeTempProject,
  node: WorkflowNode,
  member: OfficeExecutionMember,
  deliverable: string,
  usage: string,
): Promise<void> {
  await deliverWorkflowNodeRoomDeliver(gateway, group, task, node, member, deliverable, usage);
}
