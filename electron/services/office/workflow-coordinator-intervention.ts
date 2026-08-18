import type { GatewayManager } from '../../gateway/manager';
import {
  parseWorkflowCoordinatorInterventionJson,
  validateWorkflowCoordinatorInterventionDecision,
} from '../../../src/lib/office-workflow-coordinator-intervention';
import {
  isWorkflowUserInterventionActive,
  planWorkflowUserInterventionFromCoordinator,
} from '../../../src/lib/office-workflow-user-intervention';
import { isWorkflowReviewActive, isUserCheckpointEnabled } from '../../../src/lib/office-workflow-user-checkpoint';
import { workflowNodeRoleIds } from '../../../src/lib/office-workflow-node';
import { buildWorkflowCoordinatorUserInterventionPrompt } from './room-prompts/workflow/user-intervention-judgment-prompt';
import { callAgentMessage } from './gateway-rpc';
import { buildMentionTaskContextForViewer } from './mention-task-context';
import { appendRoomMessage, getRoomMessages, upsertTempProject } from './store';
import { postRoomAnnouncement } from './orchestrator';
import { taskRoomSessionKey } from './session-keys';
import { waitForSessionReply } from './run-completion';
import { workflowForProject } from './workflow-graph';
import { resolveProjectCoordinatorAgentId } from './task-coordinator';
import {
  applyWorkflowUserInterventionPlan,
  type WorkflowUserInterventionResult,
} from './workflow-user-intervention';
import { loadProjectExecutionMembers } from './office-execution-members';
import { membersForFixedGroup } from './office-member-resolve';
import type { OfficeExecutionMember, OfficeFixedGroup, OfficeTempProject, RoomMessage } from './types';

const COORDINATOR_INTERVENTION_TIMEOUT_MS = 90_000;

export type WorkflowCoordinatorUserMessageResult =
  | { kind: 'no_intervention'; reply: string }
  | { kind: 'intervention_applied'; result: WorkflowUserInterventionResult & { applied: true } }
  | { kind: 'failed'; reason: string };

async function fetchCoordinatorInterventionJson(
  gateway: GatewayManager,
  coordinator: Pick<OfficeExecutionMember, 'agentId'>,
  project: OfficeTempProject,
  prompt: string,
  idempotencyKey: string,
): Promise<{ raw: string; reason: 'timeout' | 'error' | 'empty' }> {
  const sessionKey = taskRoomSessionKey(coordinator.agentId, project.id);
  const startedAtMs = Date.now();
  try {
    const sent = await callAgentMessage(gateway, sessionKey, prompt, idempotencyKey);
    const wait = await waitForSessionReply(gateway, {
      sessionKey,
      startedAtMs,
      timeoutMs: COORDINATOR_INTERVENTION_TIMEOUT_MS,
      runId: sent.runId,
      allowUndatedFallback: true,
      requireFreshUserTurn: true,
    });
    const raw = (wait.completed && wait.assistantText?.trim()) || '';
    if (raw) return { raw, reason: 'empty' };
    return {
      raw: '',
      reason: wait.timedOut ? 'timeout' : wait.error ? 'error' : 'empty',
    };
  } catch {
    return { raw: '', reason: 'error' };
  }
}

async function postCoordinatorInterventionReply(
  gateway: GatewayManager,
  group: OfficeFixedGroup,
  project: OfficeTempProject,
  coordinator: OfficeExecutionMember,
  reply: string,
): Promise<void> {
  const body = reply.trim().slice(0, 2_000);
  if (!body) return;
  await postRoomAnnouncement(gateway, {
    scenarioId: group.id,
    groupId: group.id,
    coordinatorAgentId: coordinator.agentId,
    fromAgentId: coordinator.agentId,
    content: `${coordinator.emoji ?? '🤖'} 【${coordinator.displayName}】\n${body}`,
    projectId: project.id,
    taskId: project.id,
    mentions: [],
    notifyMentionedRoles: false,
    syncGateway: true,
  });
}

function membersForNode(
  nodeAgentIds: string[],
  teamMembers: OfficeExecutionMember[],
): OfficeExecutionMember[] {
  const out: OfficeExecutionMember[] = [];
  for (const agentId of nodeAgentIds) {
    const hit = teamMembers.find((m) => m.agentId === agentId);
    if (hit) out.push(hit);
  }
  return out;
}

/**
 * Workflow 项目群：用户发言统一由协调者判定是否介入工作流。
 */
export async function handleWorkflowUserRoomCoordinatorIntervention(
  gateway: GatewayManager,
  params: {
    group: OfficeFixedGroup;
    /** @deprecated use group */
    scenario?: OfficeFixedGroup;
    project: OfficeTempProject;
    /** @deprecated use project */
    task?: OfficeTempProject;
    userContent: string;
    userMsg: RoomMessage;
    roomContext: string | null;
  },
): Promise<WorkflowCoordinatorUserMessageResult> {
  const group = params.group ?? params.scenario!;
  const project = params.project ?? params.task!;
  const { userContent, userMsg } = params;

  const coordinatorAgentId = resolveProjectCoordinatorAgentId(project, group);
  const teamMembers = await loadProjectExecutionMembers(project);
  const coordinator = teamMembers.find((m) => m.agentId === coordinatorAgentId);
  if (!coordinator) {
    await appendRoomMessage({
      id: `room-${Date.now()}-wf-intervention-no-coord`,
      groupId: group.id,
      projectId: project.id,
      from: 'system',
      content: '用户介入失败：未找到项目协调者 Agent，请检查项目组配置。',
      mentions: [],
      timestamp: Date.now(),
    });
    return { kind: 'failed', reason: 'coordinator_not_found' };
  }

  if (isWorkflowUserInterventionActive(project)) {
    await appendRoomMessage({
      id: `room-${Date.now()}-wf-intervention-busy`,
      groupId: group.id,
      projectId: project.id,
      from: 'system',
      content: '已有用户介入正在执行中，请待当前子任务完成后再发起新的介入。',
      mentions: [],
      timestamp: Date.now(),
    });
    return { kind: 'failed', reason: 'intervention_in_progress' };
  }

  if (isUserCheckpointEnabled() && isWorkflowReviewActive(project)) {
    await appendRoomMessage({
      id: `room-${Date.now()}-wf-review-busy`,
      groupId: group.id,
      projectId: project.id,
      from: 'system',
      content: '工作流正在等待人工审查，请先在审查面板完成审查后再通过群聊介入。',
      mentions: [],
      timestamp: Date.now(),
    });
    return { kind: 'failed', reason: 'review_in_progress' };
  }

  const workflow = workflowForProject(project, group);
  const roster = await membersForFixedGroup(group);
  const roomMessages = await getRoomMessages(project.id);
  const { taskProgressContext, projectNotebookContext } =
    await buildMentionTaskContextForViewer({
      scenarioId: group.id,
      focus: project,
      group,
      roomMessages,
      members: roster,
      viewerAgentId: coordinator.agentId,
      isCoordinator: true,
    });

  const prompt = buildWorkflowCoordinatorUserInterventionPrompt({
    coordinator: {
      id: coordinator.agentId,
      agentId: coordinator.agentId,
      name: coordinator.displayName,
      displayName: coordinator.displayName,
      emoji: coordinator.emoji,
    },
    scenario: group as never,
    task: project as never,
    workflowNodes: workflow.nodes,
    teammateNames: roster.map((m) => m.displayName),
    userContent,
    roomContext: params.roomContext,
    taskProgressContext,
    projectNotebookContext,
  });

  const idempotencyKey = `office-wf-user-intv-${project.id}-${userMsg.id}`;
  const fetched = await fetchCoordinatorInterventionJson(
    gateway,
    coordinator,
    project,
    prompt,
    idempotencyKey,
  );
  if (!fetched.raw.trim()) {
    const detail =
      fetched.reason === 'timeout' ? '协调者判定超时' : '协调者未返回有效 JSON';
    await postCoordinatorInterventionReply(
      gateway,
      group,
      project,
      coordinator,
      `【判定】无需干预（${detail}，暂不调整工作流）。`,
    );
    return { kind: 'failed', reason: detail };
  }

  const json = parseWorkflowCoordinatorInterventionJson(fetched.raw);
  if (!json) {
    await postCoordinatorInterventionReply(
      gateway,
      group,
      project,
      coordinator,
      '【判定】无需干预（介入判定 JSON 解析失败，暂不调整工作流）。',
    );
    return { kind: 'failed', reason: 'invalid_json' };
  }

  const valid = validateWorkflowCoordinatorInterventionDecision(json, workflow.nodes);
  if (!valid.ok) {
    await postCoordinatorInterventionReply(
      gateway,
      group,
      project,
      coordinator,
      `【判定】无需干预（${valid.detail}）。`,
    );
    return { kind: 'failed', reason: valid.detail };
  }

  await postCoordinatorInterventionReply(
    gateway,
    group,
    project,
    coordinator,
    json.reply,
  );

  if (!json.needIntervention) {
    return { kind: 'no_intervention', reply: json.reply };
  }

  const runs = new Map((project.nodeRuns ?? []).map((r) => [r.nodeId, { ...r }]));
  const plan = planWorkflowUserInterventionFromCoordinator({
    nodes: workflow.nodes,
    edges: workflow.edges,
    runs,
    userContent,
    activeNodeId: json.activeNodeId!,
    kind: json.kind,
    skippedNodeId: json.skippedNodeId,
  });
  if (!plan) {
    await postCoordinatorInterventionReply(
      gateway,
      group,
      project,
      coordinator,
      '【判定】介入计划生成失败，未能调整工作流；请重试或 @协调者 说明具体子任务。',
    );
    return { kind: 'failed', reason: 'plan_failed' };
  }

  const activeNode = workflow.nodes.find((n) => n.id === plan.activeNodeId);
  const nodeAgentIds = workflowNodeRoleIds(activeNode!);
  const targetMembers = membersForNode(nodeAgentIds, teamMembers);
  if (targetMembers.length === 0) {
    return { kind: 'failed', reason: 'no_agents_for_node' };
  }

  const nodeRuns = workflow.nodes.map((n) => {
    const r = runs.get(n.id);
    return (
      r ?? {
        nodeId: n.id,
        agentId: workflowNodeRoleIds(n)[0] ?? n.agentId ?? '',
        status: 'pending' as const,
      }
    );
  });

  const updated: OfficeTempProject = {
    ...project,
    nodeRuns,
    updatedAt: Date.now(),
  };
  await upsertTempProject(updated);

  const applied = await applyWorkflowUserInterventionPlan(gateway, {
    group,
    project: updated,
    plan,
    targetMembers,
    userContent,
    coordinatorReply: json.reply,
  });

  if (!applied.applied) {
    return { kind: 'failed', reason: applied.reason };
  }

  const activeTitle = activeNode?.title ?? plan.activeNodeId;
  const skipNote =
    plan.kind === 'skip_to' && plan.skippedNodeId
      ? `已跳过「${workflow.nodes.find((n) => n.id === plan.skippedNodeId)?.title ?? plan.skippedNodeId}」，`
      : '';
  await appendRoomMessage({
    id: `room-${Date.now()}-user-wf-intervention`,
    groupId: group.id,
    projectId: project.id,
    from: 'system',
    content: `${skipNote}用户介入已生效：当前须完成子任务「${activeTitle}」；完成后清除介入标记并继续工作流。`,
    mentions: targetMembers.map((m) => m.agentId),
    timestamp: Date.now(),
  });

  return { kind: 'intervention_applied', result: applied };
}
