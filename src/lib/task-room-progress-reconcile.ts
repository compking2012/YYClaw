import { taskExecutionMode } from '@/lib/office-task-execution-mode';
import type {
  NodeRunRecord,
  NodeRunStatus,
  OfficeTempProject,
  RoomMessage,
  RoomMessagePhase,
  WorkflowNode,
} from '@/types/office';
import { inferPhaseFromRoleReplyContent, progressSnippetFromRoleReply } from '@/lib/office-mention-task-sync';
import {
  countWorkflowNodesWithAgent,
  workflowNodeHasAgent,
  workflowNodePrimaryAgentId,
} from '@/lib/office-workflow-node';
import { roomMessageFromAgentId, roomMessageProjectId } from '@/lib/office-agent-id-resolve';
import { resolveEffectiveTaskStatus } from '@/lib/office-task-status';

const PHASE_RANK: Record<RoomMessagePhase, number> = {
  task_received: 1,
  task_understanding: 2,
  task_team_review: 2,
  task_clarification: 3,
  task_running: 4,
  task_deliver: 5,
  task_handoff: 6,
  project_closure: 7,
  deliverable_bundle: 8,
};

const STATUS_RANK: Record<TaskStepRankStatus, number> = {
  pending: 0,
  running: 4,
  completed: 6,
  failed: 7,
};

type TaskStepRankStatus = 'pending' | 'running' | 'completed' | 'failed';

export function nodeRunStatusFromRoomPhase(phase: RoomMessagePhase): NodeRunStatus {
  switch (phase) {
    case 'task_deliver':
    case 'task_handoff':
    case 'project_closure':
    case 'deliverable_bundle':
      return 'completed';
    case 'task_running':
    case 'task_understanding':
    case 'task_received':
    case 'task_clarification':
    case 'task_team_review':
      return 'running';
    default:
      return 'pending';
  }
}

/** Avoid attributing one PM/角色 line to every workflow step that shares the same roleId. */
export function roomMessageAppliesToNode(
  message: RoomMessage,
  node: WorkflowNode,
  workflowNodes: WorkflowNode[],
): boolean {
  if (message.nodeId) return message.nodeId === node.id;
  const fromAgentId = roomMessageFromAgentId(message);
  if (!fromAgentId || !workflowNodeHasAgent(node, fromAgentId)) return false;
  return countWorkflowNodesWithAgent(workflowNodes, fromAgentId) === 1;
}

export function effectivePhaseFromMessage(message: RoomMessage): RoomMessagePhase | null {
  const body = (message.progressText ?? message.content ?? '').trim();
  if (!body) return message.phase ?? null;

  let phase = message.phase ?? null;
  const fromAgentId = roomMessageFromAgentId(message);
  if (!phase && fromAgentId && message.from !== 'system' && message.from !== 'user') {
    phase = inferPhaseFromRoleReplyContent(body);
  }
  if (phase) {
    const inferred = inferPhaseFromRoleReplyContent(body);
    const canUpgradeFrom =
      phase === 'task_running' ||
      phase === 'task_understanding' ||
      phase === 'task_clarification' ||
      phase === 'task_team_review';
    if (
      canUpgradeFrom
      && inferred !== 'project_closure'
      && (PHASE_RANK[inferred] ?? 0) > (PHASE_RANK[phase] ?? 0)
    ) {
      phase = inferred;
    }
  }
  return phase;
}

export function progressSnippetForPhase(
  phase: RoomMessagePhase,
  message: RoomMessage,
): string | null {
  const body = (message.progressText ?? message.content ?? '').trim();
  if (!body) return null;
  if (phase === 'task_running') {
    return body.slice(0, 200);
  }
  if (phase === 'task_deliver' || phase === 'task_handoff' || phase === 'task_understanding') {
    return progressSnippetFromRoleReply(body);
  }
  return null;
}

export function resolveNodeRoomProgress(
  taskRoom: RoomMessage[],
  node: WorkflowNode,
  workflowNodes: WorkflowNode[],
): { phase: RoomMessagePhase; progressSnippet: string | null } | null {
  let best: {
    phase: RoomMessagePhase;
    rank: number;
    progressSnippet: string | null;
    timestamp: number;
  } | null = null;

  for (const m of taskRoom) {
    if (!roomMessageAppliesToNode(m, node, workflowNodes)) continue;

    const phase = effectivePhaseFromMessage(m);
    if (!phase) continue;

    const rank = PHASE_RANK[phase] ?? 0;
    const snippet = progressSnippetForPhase(phase, m);
    if (
      !best ||
      rank > best.rank ||
      (rank === best.rank && m.timestamp >= best.timestamp)
    ) {
      best = { phase, rank, progressSnippet: snippet, timestamp: m.timestamp };
    }
  }

  return best ? { phase: best.phase, progressSnippet: best.progressSnippet } : null;
}

function phaseForNodeFromMessages(
  taskRoom: RoomMessage[],
  node: WorkflowNode,
  workflowNodes: WorkflowNode[],
): { phase: RoomMessagePhase; progressSnippet: string | null } | null {
  return resolveNodeRoomProgress(taskRoom, node, workflowNodes);
}

/**
 * Rebuild task.nodeRuns from phased team-room lines for this task (single source of truth).
 */
export function taskLooksUserAborted(task: Pick<OfficeTempProject, 'status' | 'nodeRuns'>): boolean {
  if (task.status !== 'failed' && task.status !== 'aborted') return false;
  return task.nodeRuns.some(
    (nr) => nr.error === 'Aborted' || nr.error === 'Cancelled',
  );
}

/** Workflow：nodeRuns.status 仅由 runner 写入；群聊只补充摘要，避免回流/重试后 UI 被旧交付帖拉回 completed。 */
function reconcileWorkflowTaskNodeRunsFromRoom(
  task: OfficeTempProject,
  workflowNodes: WorkflowNode[],
  roomMessages: RoomMessage[],
): OfficeTempProject {
  const taskRoom = roomMessages.filter(
    (m) => roomMessageProjectId(m) === task.id && m.phase !== 'project_closure',
  );

  const nodeRuns: NodeRunRecord[] = workflowNodes.map((node) => {
    const existing = task.nodeRuns.find((r) => r.nodeId === node.id);
    const base: NodeRunRecord = existing ?? {
      nodeId: node.id,
      agentId: workflowNodePrimaryAgentId(node),
      status: 'pending',
    };
    const room = phaseForNodeFromMessages(taskRoom, node, workflowNodes);
    if (!room) return { ...base };

    const canRefreshSummary =
      base.status === 'running' || base.status === 'completed';
    return {
      ...base,
      summary: canRefreshSummary
        ? (room.progressSnippet ?? base.summary)
        : base.summary,
    };
  });

  let status = resolveEffectiveTaskStatus(task, nodeRuns, workflowNodes);
  if (status === 'pending' && task.status === 'running') {
    status = 'running';
  }

  return {
    ...task,
    status,
    nodeRuns,
    updatedAt: Date.now(),
  };
}

export function reconcileTaskNodeRunsFromRoom(
  task: OfficeTempProject,
  workflowNodes: WorkflowNode[],
  roomMessages: RoomMessage[],
): OfficeTempProject {
  if (task.status === 'aborted') {
    return task;
  }
  if (taskLooksUserAborted(task)) {
    return task;
  }

  if (taskExecutionMode(task) === 'workflow') {
    return reconcileWorkflowTaskNodeRunsFromRoom(task, workflowNodes, roomMessages);
  }

  const taskRoom = roomMessages.filter(
    (m) => roomMessageProjectId(m) === task.id && m.phase !== 'project_closure',
  );

  const nodeRuns: NodeRunRecord[] = workflowNodes.map((node) => {
    const existing = task.nodeRuns.find((r) => r.nodeId === node.id);
    const room = phaseForNodeFromMessages(taskRoom, node, workflowNodes);

    if (room) {
      const status = nodeRunStatusFromRoomPhase(room.phase);
      return {
        nodeId: node.id,
        agentId: workflowNodePrimaryAgentId(node),
        status,
        summary: room.progressSnippet ?? existing?.summary,
        sessionKey: existing?.sessionKey,
        runId: existing?.runId,
        startedAt: existing?.startedAt ?? (status !== 'pending' ? Date.now() : undefined),
        completedAt: status === 'completed' ? (existing?.completedAt ?? Date.now()) : undefined,
        error: status === 'failed' ? existing?.error : undefined,
      };
    }

    if (existing && existing.status !== 'pending') {
      return { ...existing };
    }

    return {
      nodeId: node.id,
      agentId: workflowNodePrimaryAgentId(node),
      status: 'pending' as const,
    };
  });

  let status = resolveEffectiveTaskStatus(task, nodeRuns, workflowNodes);
  if (status === 'pending' && task.status === 'running') {
    status = 'running';
  }

  return {
    ...task,
    status,
    nodeRuns,
    updatedAt: Date.now(),
  };
}

/** UI merge: show the further-along of persisted nodeRuns vs room (until next snapshot). */
export function mergeTaskStepDisplayStatus(
  runStatus: TaskStepRankStatus,
  room: { phase: RoomMessagePhase; progressSnippet: string | null } | null,
): {
  status: TaskStepRankStatus;
  phase: RoomMessagePhase | null;
  progressSnippet: string | null;
} {
  if (runStatus === 'failed') {
    return { status: 'failed', phase: room?.phase ?? null, progressSnippet: room?.progressSnippet ?? null };
  }

  const runRank = STATUS_RANK[runStatus];
  const roomRank = room ? PHASE_RANK[room.phase] ?? 0 : 0;

  if (room && roomRank > runRank) {
    const fromRoom = nodeRunStatusFromRoomPhase(room.phase);
    const status: TaskStepRankStatus =
      fromRoom === 'completed'
        ? 'completed'
        : fromRoom === 'running'
          ? 'running'
          : 'pending';
    return { status, phase: room.phase, progressSnippet: room.progressSnippet };
  }

  if (runStatus === 'completed') {
    return { status: 'completed', phase: room?.phase ?? 'task_handoff', progressSnippet: null };
  }
  if (runStatus === 'running') {
    const roomWouldComplete =
      room && nodeRunStatusFromRoomPhase(room.phase) === 'completed';
    if (roomWouldComplete) {
      return {
        status: 'completed',
        phase: room.phase,
        progressSnippet: room.progressSnippet,
      };
    }
    return {
      status: 'running',
      phase: room?.phase ?? 'task_running',
      progressSnippet: room?.progressSnippet ?? '启动中…',
    };
  }
  if (room) {
    const status: TaskStepRankStatus =
      nodeRunStatusFromRoomPhase(room.phase) === 'completed'
        ? 'completed'
        : nodeRunStatusFromRoomPhase(room.phase) === 'running'
          ? 'running'
          : 'pending';
    return { status, phase: room.phase, progressSnippet: room.progressSnippet };
  }
  return { status: runStatus, phase: null, progressSnippet: null };
}
