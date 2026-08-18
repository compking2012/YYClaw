import { taskExecutionMode } from '@/lib/office-task-execution-mode';
import { workflowNodeLlmDispatched } from '@/lib/office-workflow-visual-progress';
import {
  mergeTaskStepDisplayStatus,
  resolveNodeRoomProgress,
  roomMessageAppliesToNode,
} from '@/lib/task-room-progress-reconcile';
import type { OfficeTempProject, RoomMessage, RoomMessagePhase, WorkflowNode } from '@/types/office';
import { roomMessageProjectId } from '@/lib/office-agent-id-resolve';

export type TaskStepSyncStatus = 'pending' | 'running' | 'completed' | 'failed';

export type TaskStepSyncEntry = {
  nodeId: string;
  status: TaskStepSyncStatus;
  phase: RoomMessagePhase | null;
  progressSnippet: string | null;
};

export type TaskProgressSync = {
  totalSteps: number;
  completedSteps: number;
  /** 1-based active step index while task is in progress; null when idle. */
  currentStep: number | null;
  steps: TaskStepSyncEntry[];
  /** Latest in-flight log from room `task_running` for this task. */
  runningLog: string | null;
};

/** Collapsed task cards only need the status dot — skip room/node sync until expanded. */
export const EMPTY_TASK_PROGRESS_SYNC: TaskProgressSync = {
  totalSteps: 0,
  completedSteps: 0,
  currentStep: null,
  steps: [],
  runningLog: null,
};

function nodeRunStatus(
  project: OfficeTempProject,
  nodeId: string,
): TaskStepSyncStatus {
  const st = project.nodeRuns.find((r) => r.nodeId === nodeId)?.status;
  if (!st || st === 'pending') return 'pending';
  if (st === 'skipped') return 'completed';
  return st;
}

/** 工作流模式：步骤状态仅来自 task.nodeRuns（runner 内存/持久化），群聊只补充进度文案。 */
function workflowStepFromNodeRuns(
  project: OfficeTempProject,
  node: WorkflowNode,
  workflowNodes: WorkflowNode[],
  taskRoom: RoomMessage[],
  room: { phase: RoomMessagePhase; progressSnippet: string | null } | null,
): TaskStepSyncEntry {
  const status = nodeRunStatus(project, node.id);
  const run = project.nodeRuns.find((r) => r.nodeId === node.id);

  if (status === 'failed') {
    return {
      nodeId: node.id,
      status,
      phase: room?.phase ?? null,
      progressSnippet: run?.error?.trim() || room?.progressSnippet || null,
    };
  }

  if (status === 'completed') {
    const phase =
      room?.phase === 'task_handoff' || room?.phase === 'task_deliver'
        ? room.phase
        : 'task_deliver';
    return {
      nodeId: node.id,
      status,
      phase,
      progressSnippet: room?.progressSnippet ?? null,
    };
  }

  if (status === 'running') {
    const runStartedAt = run?.startedAt ?? 0;
    const liveRunning = taskRoom
      .filter(
        (m) =>
          roomMessageAppliesToNode(m, node, workflowNodes)
          && m.phase === 'task_running'
          && (!runStartedAt || m.timestamp >= runStartedAt - 2_000),
      )
      .sort((a, b) => b.timestamp - a.timestamp)[0];
    const phase: RoomMessagePhase = 'task_running';
    const snippet =
      (liveRunning?.progressText ?? liveRunning?.content ?? '').trim()
      || room?.progressSnippet
      || (workflowNodeLlmDispatched(run) ? '执行中…' : '启动中…');
    return {
      nodeId: node.id,
      status,
      phase,
      progressSnippet: snippet.slice(0, 300) || '启动中…',
    };
  }

  const err = run?.error?.trim();
  return {
    nodeId: node.id,
    status: 'pending',
    phase: err ? 'task_clarification' : null,
    progressSnippet: err || null,
  };
}

/** Align task-panel step state with team-room phased messages for the same task. */
export function deriveTaskProgressSync(
  project: OfficeTempProject,
  workflowNodes: WorkflowNode[],
  roomMessages: RoomMessage[],
): TaskProgressSync {
  const totalSteps = workflowNodes.length;
  const taskRoom = roomMessages.filter(
    (m) => roomMessageProjectId(m) === project.id && m.phase !== 'project_closure',
  );
  const workflowMode = taskExecutionMode(project) === 'workflow';

  const steps: TaskStepSyncEntry[] = workflowNodes.map((node) => {
    const room = resolveNodeRoomProgress(taskRoom, node, workflowNodes);
    if (workflowMode) {
      return workflowStepFromNodeRuns(project, node, workflowNodes, taskRoom, room);
    }
    const merged = mergeTaskStepDisplayStatus(nodeRunStatus(project, node.id), room);
    return {
      nodeId: node.id,
      status: merged.status,
      phase: merged.phase,
      progressSnippet: merged.progressSnippet,
    };
  });

  const completedSteps = steps.filter((s) => s.status === 'completed').length;

  const active =
    project.status === 'running' ||
    project.nodeRuns.some((r) => r.status === 'running') ||
    steps.some((s) => s.status === 'running');

  let currentStep: number | null = null;
  if (active && totalSteps > 0) {
    const idx = steps.findIndex(
      (s) => s.status !== 'completed' && s.status !== 'failed',
    );
    if (idx >= 0) {
      currentStep = idx + 1;
    } else {
      const retryIdx = steps.findIndex((s) => s.status === 'failed');
      currentStep = retryIdx >= 0 ? retryIdx + 1 : totalSteps;
    }
  }

  const runningMsg = [...taskRoom]
    .filter((m) => m.phase === 'task_running')
    .sort((a, b) => {
      const ta = a.timestamp + (a.progressText ? 1 : 0);
      const tb = b.timestamp + (b.progressText ? 1 : 0);
      return tb - ta;
    })[0];
  const runningLog = runningMsg
    ? (runningMsg.progressText ?? runningMsg.content ?? '').trim().slice(0, 300) || null
    : null;

  return {
    totalSteps,
    completedSteps,
    currentStep,
    steps,
    runningLog,
  };
}

export function taskStepPhaseI18nKey(
  phase: RoomMessagePhase | null,
): string | null {
  if (!phase) return null;
  return `taskPhase.${phase}`;
}
