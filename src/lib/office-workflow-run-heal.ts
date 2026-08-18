import { workflowNodeIsMultiRole, workflowNodeRoleIds } from '@/lib/office-workflow-node';
import { nodeMaxRuntimeMinutes } from '@/lib/office-workflow-roles';
import type { WorkflowRollbackDecision } from '@/lib/office-workflow-rollback';
import {
  extractWorkflowRoomJsonReceipt,
  isWorkflowJsonCompletionEvidence,
  isWorkflowRoomJsonReceiptReady,
  tickWorkflowRoomJsonReceipt,
  workflowRoomJsonHealRoleForNode,
  WORKFLOW_ROOM_JSON_HEAL_STABLE_MS,
  type WorkflowRoomJsonReceipt,
} from '@/lib/office-workflow-room-json-heal';
import {
  progressSnippetForPhase,
  roomMessageAppliesToNode,
} from '@/lib/task-room-progress-reconcile';
import { roomMessageProjectId } from '@/lib/office-agent-id-resolve';
import type { ProjectAgentRef } from '@/lib/office-workflow-node';
import { isReviewHealGuardedNode } from '@/lib/office-workflow-user-checkpoint';
import type { NodeRunRecord, RoomMessage, WorkflowEdge, WorkflowNode } from '@/types/office';

export { WORKFLOW_ROOM_JSON_HEAL_STABLE_MS } from '@/lib/office-workflow-room-json-heal';

/** 执行中消息已标「执行完成」且同步骤有正式交付帖，视为本步可解锁下游。 */
export function nodeHasRoomExecutionFinishedMarker(
  taskRoom: RoomMessage[],
  node: WorkflowNode,
  workflowNodes: WorkflowNode[],
): boolean {
  return taskRoom.some(
    (m) =>
      m.phase === 'task_running'
      && roomMessageAppliesToNode(m, node, workflowNodes)
      && /执行完成/u.test((m.progressText ?? m.content ?? '').trim()),
  );
}

/** 仅认群聊中显式 phase=task_deliver/task_handoff 的消息。 */
export function nodeHasExplicitRoomDeliver(
  taskRoom: RoomMessage[],
  node: WorkflowNode,
  workflowNodes: WorkflowNode[],
): { progressSnippet: string | null } | null {
  let best: { progressSnippet: string | null; timestamp: number } | null = null;

  for (const m of taskRoom) {
    if (!roomMessageAppliesToNode(m, node, workflowNodes)) continue;
    const phase = m.phase;
    if (phase !== 'task_deliver' && phase !== 'task_handoff') continue;
    const snippet = progressSnippetForPhase(phase, m);
    if (!best || m.timestamp >= best.timestamp) {
      best = { progressSnippet: snippet, timestamp: m.timestamp };
    }
  }

  return best;
}

export type WorkflowRoomHealRollbackIntent = {
  nodeId: string;
  roleId: string;
  summary: string;
  decision: WorkflowRollbackDecision;
};

export type WorkflowRoomHealPassOptions = {
  nowMs?: number;
  roles: Pick<ProjectAgentRef, 'agentId' | 'displayName'>[];
  edges: WorkflowEdge[];
  teamRoles: Pick<ProjectAgentRef, 'agentId' | 'displayName'>[];
  /** 测试可缩短稳定窗口 */
  jsonStableMs?: number;
  /** 仅处理指定节点（Session 等待并行自愈 scoped 到当前节点）。 */
  onlyNodeId?: string;
  /**
   * Optional extra attempt floor (e.g. auxiliary `sessionStartedAtMs`).
   * Combined with `run.startedAt` via Math.min — see resolveRoomHealMinTimestampMs.
   */
  minRoomMessageTimestampMs?: number;
  /** Skip heal on user-review guarded nodes. */
  reviewHealGuard?: {
    reviewHoldNodeIds: ReadonlySet<string>;
    expectedNodeIds: ReadonlySet<string>;
  };
};

/**
 * Resolve the earliest room message timestamp heal may consume for this attempt.
 *
 * Must use Math.min (not Math.max): production order is
 * `run.startedAt` → beginTaskNodeRoomPhases (room.timestamp fixed) → `sessionStartedAt`.
 * progressText is later patched onto that same card without bumping timestamp, so raising
 * the floor to sessionStartedAt would hide the current attempt's completion JSON and let
 * heal fall back to (or miss) prior-run receipts.
 */
export function resolveRoomHealMinTimestampMs(
  opts: Pick<WorkflowRoomHealPassOptions, 'minRoomMessageTimestampMs'>,
  run?: Pick<NodeRunRecord, 'startedAt'>,
): number | undefined {
  const candidates = [opts.minRoomMessageTimestampMs, run?.startedAt].filter(
    (n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0,
  );
  if (candidates.length === 0) return undefined;
  return Math.min(...candidates);
}

function roomHealPassIncludesNode(
  nodeId: string,
  opts: Pick<WorkflowRoomHealPassOptions, 'onlyNodeId'>,
): boolean {
  return !opts.onlyNodeId || opts.onlyNodeId === nodeId;
}

export type WorkflowRoomHealPendingValidation = {
  nodeId: string;
  roleId: string;
  receipt: WorkflowRoomJsonReceipt;
};

export type WorkflowRoomHealPassResult = {
  changed: boolean;
  stabilityTicked: boolean;
  /** 第 3 步 runner 触发的回滚（校验已通过）。 */
  rollbacks: WorkflowRoomHealRollbackIntent[];
  /** 收稿已满稳定窗口，待主进程做结构化+磁盘校验（第 2 步）。 */
  pendingValidation: WorkflowRoomHealPendingValidation[];
};

/** 第 1 步：刷新各 running 节点上的 JSON 收稿/稳定计时。 */
export function tickWorkflowRoomJsonHealStabilityOnRuns(
  workflowNodes: WorkflowNode[],
  runs: Map<string, NodeRunRecord>,
  roomMessages: RoomMessage[],
  taskId: string,
  roles: Pick<ProjectAgentRef, 'agentId' | 'displayName'>[],
  nowMs: number = Date.now(),
  reviewHealGuard?: WorkflowRoomHealPassOptions['reviewHealGuard'],
  onlyNodeId?: string,
  minRoomMessageTimestampMs?: number,
): boolean {
  const taskRoom = roomMessages.filter(
    (m) => roomMessageProjectId(m) === taskId && m.phase !== 'project_closure',
  );
  let changed = false;

  for (const node of workflowNodes) {
    if (!roomHealPassIncludesNode(node.id, { onlyNodeId })) continue;
    if (
      reviewHealGuard
      && isReviewHealGuardedNode(node.id, reviewHealGuard)
    ) {
      continue;
    }
    const run = runs.get(node.id);
    if (!run || run.status !== 'running' || workflowNodeIsMultiRole(node)) continue;
    const role = workflowRoomJsonHealRoleForNode(node, run, roles);
    if (!role) continue;
    const receipt = extractWorkflowRoomJsonReceipt(taskRoom, node, workflowNodes, role, {
      minTimestampMs: resolveRoomHealMinTimestampMs({ minRoomMessageTimestampMs }, run),
    });
    const next = tickWorkflowRoomJsonReceipt(run, receipt, nowMs);
    if (
      next.roomHealJsonFingerprint !== run.roomHealJsonFingerprint
      || next.roomHealJsonStableSinceMs !== run.roomHealJsonStableSinceMs
    ) {
      runs.set(node.id, next);
      changed = true;
    }
  }

  return changed;
}

/** 收稿已满稳定窗口、尚未通过 Session 同级校验的节点 → 待主进程校验。 */
export function collectWorkflowRoomJsonHealPendingValidation(
  workflowNodes: WorkflowNode[],
  runs: Map<string, NodeRunRecord>,
  roomMessages: RoomMessage[],
  taskId: string,
  opts: WorkflowRoomHealPassOptions,
): WorkflowRoomHealPendingValidation[] {
  const taskRoom = roomMessages.filter(
    (m) => roomMessageProjectId(m) === taskId && m.phase !== 'project_closure',
  );
  const nowMs = opts.nowMs ?? Date.now();
  const stableMs = opts.jsonStableMs ?? WORKFLOW_ROOM_JSON_HEAL_STABLE_MS;
  const pendingValidation: WorkflowRoomHealPendingValidation[] = [];

  for (const node of workflowNodes) {
    if (!roomHealPassIncludesNode(node.id, opts)) continue;
    if (
      opts.reviewHealGuard
      && isReviewHealGuardedNode(node.id, opts.reviewHealGuard)
    ) {
      continue;
    }
    const run = runs.get(node.id);
    if (!run || run.status !== 'running') continue;
    if (run.error?.includes('回流')) continue;
    if (workflowNodeIsMultiRole(node)) continue;

    const role = workflowRoomJsonHealRoleForNode(node, run, opts.roles);
    if (!role) continue;
    if (!isWorkflowRoomJsonReceiptReady(run, nowMs, stableMs)) continue;

    const receipt = extractWorkflowRoomJsonReceipt(taskRoom, node, workflowNodes, role, {
      minTimestampMs: resolveRoomHealMinTimestampMs(opts, run),
    });
    if (!receipt || receipt.fingerprint !== run.roomHealJsonFingerprint) continue;
    if (run.roomHealValidatedFingerprint === receipt.fingerprint) continue;

    pendingValidation.push({ nodeId: node.id, roleId: role.agentId, receipt });
  }

  return pendingValidation;
}

/**
 * 辅助路径待校验收集：有完成语义 JSON 且尚未对当前指纹完成校验即可进入校验，
 * 不要求先满稳定窗；同指纹失败也不跳过（由约 20s 轮询重试）。
 * 稳定窗在「校验通过并标记 validated」之后才开始计时。
 */
export function collectAuxiliaryRoomHealPendingValidation(
  workflowNodes: WorkflowNode[],
  runs: Map<string, NodeRunRecord>,
  roomMessages: RoomMessage[],
  taskId: string,
  opts: WorkflowRoomHealPassOptions,
): WorkflowRoomHealPendingValidation[] {
  const taskRoom = roomMessages.filter(
    (m) => roomMessageProjectId(m) === taskId && m.phase !== 'project_closure',
  );
  const pendingValidation: WorkflowRoomHealPendingValidation[] = [];

  for (const node of workflowNodes) {
    if (!roomHealPassIncludesNode(node.id, opts)) continue;
    if (
      opts.reviewHealGuard
      && isReviewHealGuardedNode(node.id, opts.reviewHealGuard)
    ) {
      continue;
    }
    const run = runs.get(node.id);
    if (!run || run.status !== 'running') continue;
    if (run.error?.includes('回流')) continue;
    if (workflowNodeIsMultiRole(node)) continue;

    const role = workflowRoomJsonHealRoleForNode(node, run, opts.roles);
    if (!role) continue;

    const receipt = extractWorkflowRoomJsonReceipt(taskRoom, node, workflowNodes, role, {
      minTimestampMs: resolveRoomHealMinTimestampMs(opts, run),
    });
    if (!receipt) continue;
    if (!isWorkflowJsonCompletionEvidence(receipt.json)) continue;
    if (run.roomHealValidatedFingerprint === receipt.fingerprint) continue;

    pendingValidation.push({ nodeId: node.id, roleId: role.agentId, receipt });
  }

  return pendingValidation;
}

/** @deprecated 使用 {@link collectWorkflowRoomJsonHealPendingValidation} */
export function advanceWorkflowRoomJsonHealPipeline(
  workflowNodes: WorkflowNode[],
  runs: Map<string, NodeRunRecord>,
  roomMessages: RoomMessage[],
  taskId: string,
  opts: WorkflowRoomHealPassOptions,
): { changed: boolean; rollbacks: WorkflowRoomHealRollbackIntent[]; pendingValidation: WorkflowRoomHealPendingValidation[] } {
  const pendingValidation = collectWorkflowRoomJsonHealPendingValidation(
    workflowNodes,
    runs,
    roomMessages,
    taskId,
    opts,
  );
  return { changed: false, rollbacks: [], pendingValidation };
}

/** @deprecated 使用 {@link advanceWorkflowRoomJsonHealPipeline} */
export function healRunningNodesWithStableRoomJson(
  workflowNodes: WorkflowNode[],
  runs: Map<string, NodeRunRecord>,
  roomMessages: RoomMessage[],
  taskId: string,
  opts: WorkflowRoomHealPassOptions,
): { changed: boolean; rollbacks: WorkflowRoomHealRollbackIntent[] } {
  const r = advanceWorkflowRoomJsonHealPipeline(workflowNodes, runs, roomMessages, taskId, opts);
  return { changed: r.changed, rollbacks: r.rollbacks };
}

/** 主进程校验通过后标记指纹，供下一轮 runner 处理。 */
export function markWorkflowRoomJsonHealValidated(
  run: NodeRunRecord,
  fingerprint: string,
): NodeRunRecord {
  return { ...run, roomHealValidatedFingerprint: fingerprint };
}

export function clearWorkflowRoomJsonHealTracking(run: NodeRunRecord): NodeRunRecord {
  return {
    ...run,
    roomHealJsonFingerprint: undefined,
    roomHealJsonStableSinceMs: undefined,
    roomHealValidatedFingerprint: undefined,
    roomHealValidationFailFingerprint: undefined,
  };
}

export function healWorkflowRunningNodesFromRoom(
  workflowNodes: WorkflowNode[],
  runs: Map<string, NodeRunRecord>,
  roomMessages: RoomMessage[],
  taskId: string,
  opts: WorkflowRoomHealPassOptions,
): WorkflowRoomHealPassResult {
  const nowMs = opts.nowMs ?? Date.now();
  const stabilityTicked = tickWorkflowRoomJsonHealStabilityOnRuns(
    workflowNodes,
    runs,
    roomMessages,
    taskId,
    opts.roles,
    nowMs,
    opts.reviewHealGuard,
    opts.onlyNodeId,
    opts.minRoomMessageTimestampMs,
  );

  const pendingValidation = collectWorkflowRoomJsonHealPendingValidation(
    workflowNodes,
    runs,
    roomMessages,
    taskId,
    opts,
  );

  return {
    changed: stabilityTicked,
    stabilityTicked,
    rollbacks: [],
    pendingValidation,
  };
}

/** @deprecated 仅保留测试/兼容导出；请使用 {@link healRunningNodesWithStableRoomJson}。 */
export function healRunningNodesWithStructuredRoomProgress(
  workflowNodes: WorkflowNode[],
  runs: Map<string, NodeRunRecord>,
  roomMessages: RoomMessage[],
  taskId: string,
  opts?: WorkflowRoomHealPassOptions,
): boolean {
  if (!opts?.roles?.length) return false;
  tickWorkflowRoomJsonHealStabilityOnRuns(
    workflowNodes,
    runs,
    roomMessages,
    taskId,
    opts.roles,
    opts.nowMs ?? Date.now(),
    opts.reviewHealGuard,
  );
  return advanceWorkflowRoomJsonHealPipeline(
    workflowNodes,
    runs,
    roomMessages,
    taskId,
    opts,
  ).changed;
}

/** @deprecated 快路径已移除；仅保留测试兼容，恒为 false。 */
export function runningNodeCanCompleteFromExplicitRoomDeliver(
  _taskRoom: RoomMessage[],
  _node: WorkflowNode,
  _workflowNodes: WorkflowNode[],
): boolean {
  return false;
}

/** @deprecated */
export function runningNodeCanCompleteFromRoomHeal(
  taskRoom: RoomMessage[],
  node: WorkflowNode,
  workflowNodes: WorkflowNode[],
): boolean {
  return runningNodeCanCompleteFromExplicitRoomDeliver(taskRoom, node, workflowNodes);
}

/** @deprecated 快路径已移除 */
export function healRunningNodesWithExplicitRoomDeliver(
  _workflowNodes: WorkflowNode[],
  _runs: Map<string, NodeRunRecord>,
  _roomMessages: RoomMessage[],
  _taskId: string,
): boolean {
  return false;
}

/** @deprecated 多角色 JSON 自愈已禁用 */
export function multiRoleNodeReadyForStructuredHeal(
  _taskRoom: RoomMessage[],
  node: WorkflowNode,
  _workflowNodes: WorkflowNode[],
): boolean {
  return !workflowNodeIsMultiRole(node);
}

/** @deprecated */
export function bestStructuredWorkflowSnippetFromRoom(
  taskRoom: RoomMessage[],
  node: WorkflowNode,
  workflowNodes: WorkflowNode[],
  roles?: Pick<ProjectAgentRef, 'agentId' | 'displayName'>[],
): string | null {
  if (!roles?.length || workflowNodeIsMultiRole(node)) return null;
  const runAgentId = workflowNodeRoleIds(node)[0];
  const role = roles.find((r) => r.agentId === runAgentId);
  if (!role) return null;
  const receipt = extractWorkflowRoomJsonReceipt(taskRoom, node, workflowNodes, role);
  return receipt ? receipt.raw.slice(0, 2000) : null;
}

/** @deprecated */
export function combinedStructuredHealSummary(
  taskRoom: RoomMessage[],
  node: WorkflowNode,
  workflowNodes: WorkflowNode[],
  roles?: Pick<ProjectAgentRef, 'agentId' | 'displayName'>[],
): string | null {
  return bestStructuredWorkflowSnippetFromRoom(taskRoom, node, workflowNodes, roles);
}

/** 执行超时仍卡在 running 且无 heal 证据 → 回到 pending。 */
export function unstuckStaleRunningNodeRuns(
  workflowNodes: WorkflowNode[],
  runs: Map<string, NodeRunRecord>,
  _roomMessages: RoomMessage[],
  _taskId: string,
  nowMs: number = Date.now(),
): boolean {
  let changed = false;

  for (const node of workflowNodes) {
    const run = runs.get(node.id);
    if (!run || run.status !== 'running' || !run.startedAt) continue;
    if (isWorkflowRoomJsonReceiptReady(run, nowMs)) continue;

    const maxMs = nodeMaxRuntimeMinutes(node) * 60_000;
    if (nowMs - run.startedAt < maxMs) continue;

    runs.set(node.id, {
      ...run,
      status: 'pending',
      error: '步骤执行超时，已重新排队（请检查 Gateway/模型或续跑）',
      completedAt: undefined,
      summary: undefined,
      roomHealJsonFingerprint: undefined,
      roomHealJsonStableSinceMs: undefined,
    });
    changed = true;
  }

  return changed;
}

const WORKFLOW_STALL_POLL_MS = 1_000;

export function workflowStallIdleRoundLimit(
  nodes: WorkflowNode[],
  runs: Map<string, NodeRunRecord>,
  pollIntervalMs: number = WORKFLOW_STALL_POLL_MS,
): number {
  const pending = nodes.filter((n) => runs.get(n.id)?.status === 'pending');
  const maxMin =
    pending.length > 0
      ? Math.max(...pending.map((n) => nodeMaxRuntimeMinutes(n)))
      : 30;
  const floorRounds = Math.ceil((5 * 60_000) / pollIntervalMs);
  return Math.max(floorRounds, Math.ceil((maxMin * 60_000) / pollIntervalMs));
}
