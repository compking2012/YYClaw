import { isUnderRoleScopedDeliverableDir } from '@/lib/office-project-file-naming';
import {
  reopenWorkflowNodeAndDownstream,
} from '@/lib/office-workflow-upstream-rework';
import {
  forwardIncomingEdges,
  hasDirectedPath,
  incomingReady,
  nextRunnableNodes,
  workflowEdgeList,
  workflowNodeScheduleDepth,
} from '@/lib/office-workflow-schedule';
import type {
  NodeRunRecord,
  OfficeTempProject,
  WorkflowEdge,
  WorkflowNode,
  WorkflowReviewAction,
  WorkflowReviewBatch,
  WorkflowReviewBatchPhase,
  WorkflowReviewItem,
  WorkflowReviewItemState,
} from '@/types/office';

export const SERIAL_REVIEW_GROUP = '__serial__';

export function isUserCheckpointEnabled(): boolean {
  return typeof __OFFICE_USER_CHECKPOINT__ !== 'undefined' && __OFFICE_USER_CHECKPOINT__ === true;
}

export function resolveUserCheckpoint(
  project: Pick<OfficeTempProject, 'workflowCheckpointOverrides'>,
  node: WorkflowNode,
): boolean {
  const override = project.workflowCheckpointOverrides?.[node.id]?.userCheckpoint;
  if (override !== undefined) return override;
  return node.userCheckpoint === true;
}

export function reviewParallelGroupKey(node: WorkflowNode): string {
  const g = node.parallelGroup?.trim();
  if (g) return g;
  return `serial:${node.id}`;
}

/** @deprecated Legacy persisted batches used `__serial__` for all serial checkpoints. */
export function isLegacySerialReviewGroup(parallelGroup: string): boolean {
  return parallelGroup === SERIAL_REVIEW_GROUP;
}

export function shouldAutoSettleReviewBatch(batch: WorkflowReviewBatch): boolean {
  if (batch.phase !== 'ready_to_settle') return false;
  if (batch.expectedNodeIds.length === 1) return true;
  return isLegacySerialReviewGroup(batch.parallelGroup);
}

export function expectedCheckpointNodeIds(
  nodes: WorkflowNode[],
  parallelGroup: string,
  isCheckpoint: (node: WorkflowNode) => boolean,
): string[] {
  return nodes
    .filter((n) => reviewParallelGroupKey(n) === parallelGroup && isCheckpoint(n))
    .map((n) => n.id);
}

export function isWorkflowReviewActive(
  task: Pick<OfficeTempProject, 'workflowReviewBatch'>,
): boolean {
  const batch = task.workflowReviewBatch;
  if (!batch) return false;
  return batch.phase !== 'closed';
}

export function reviewHoldNodeIds(
  task: Pick<OfficeTempProject, 'workflowReviewBatch'>,
): ReadonlySet<string> {
  const batch = task.workflowReviewBatch;
  const held = new Set<string>();
  if (!batch || batch.phase === 'closed') return held;

  for (const nodeId of batch.expectedNodeIds) {
    const item = batch.items[nodeId];
    if (!item) continue;
    if (item.state === 'awaiting_decision' || item.state === 'submitted') {
      if (batch.phase === 'deferred' && batch.carriedDecisions?.[nodeId]) {
        continue;
      }
      held.add(nodeId);
    }
  }

  return held;
}

export type WorkflowExecutionPhase =
  | 'running'
  | 'collecting'
  | 'awaiting_review'
  | 'deferred_review'
  | 'review_idle';

export function deriveWorkflowExecutionPhase(
  task: Pick<OfficeTempProject, 'workflowReviewBatch' | 'status' | 'nodeRuns'>,
): WorkflowExecutionPhase {
  const batch = task.workflowReviewBatch;
  if (!batch || batch.phase === 'closed') return 'running';
  if (batch.phase === 'deferred') return 'deferred_review';
  if (batch.phase === 'ready_to_settle') return 'awaiting_review';
  return 'collecting';
}

export function incomingReadyForExecution(params: {
  nodeId: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  runs: Map<string, NodeRunRecord>;
  reviewHoldNodeIds: ReadonlySet<string>;
}): boolean {
  if (params.reviewHoldNodeIds.has(params.nodeId)) return false;
  for (const e of forwardIncomingEdges(params.edges, params.nodeId)) {
    if (params.reviewHoldNodeIds.has(e.from)) return false;
  }
  const edgeList = workflowEdgeList(params.nodes, params.edges);
  return incomingReady(params.nodeId, edgeList, params.runs);
}

export function nextRunnableNodesForExecution(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  runs: Map<string, NodeRunRecord>,
  holdNodeIds: ReadonlySet<string>,
): WorkflowNode[] {
  const base = nextRunnableNodes(nodes, edges, runs);
  return base.filter((node) =>
    incomingReadyForExecution({
      nodeId: node.id,
      nodes,
      edges,
      runs,
      reviewHoldNodeIds: holdNodeIds,
    }),
  );
}

function planningEdges(edgeList: WorkflowEdge[]): WorkflowEdge[] {
  return edgeList.filter((e) => (e.when ?? 'on_success') !== 'on_failure');
}

export function isAncestorOf(
  ancestorId: string,
  nodeId: string,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): boolean {
  if (ancestorId === nodeId) return true;
  const edgeList = workflowEdgeList(nodes, edges);
  return hasDirectedPath(ancestorId, nodeId, planningEdges(edgeList));
}

function collectAncestorsIncludingSelf(
  nodeId: string,
  edgeList: WorkflowEdge[],
): Set<string> {
  const forward = planningEdges(edgeList);
  const out = new Set<string>([nodeId]);
  const stack = [nodeId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const e of forward) {
      if (e.to !== cur || out.has(e.from)) continue;
      out.add(e.from);
      stack.push(e.from);
    }
  }
  return out;
}

export function computeUnifiedReworkRoot(
  startNodeIds: string[],
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): string | null {
  const unique = [...new Set(startNodeIds.filter(Boolean))];
  if (unique.length === 0) return null;
  if (unique.length === 1) return unique[0]!;

  const edgeList = workflowEdgeList(nodes, edges);
  const schedulingEdges = planningEdges(edgeList);
  let common = collectAncestorsIncludingSelf(unique[0]!, edgeList);
  for (let i = 1; i < unique.length; i++) {
    const anc = collectAncestorsIncludingSelf(unique[i]!, edgeList);
    common = new Set([...common].filter((id) => anc.has(id)));
  }
  if (common.size === 0) return unique[0]!;

  let best = [...common][0]!;
  let bestDepth = workflowNodeScheduleDepth(best, nodes, schedulingEdges);
  for (const id of common) {
    const depth = workflowNodeScheduleDepth(id, nodes, schedulingEdges);
    if (depth < bestDepth) {
      bestDepth = depth;
      best = id;
    }
  }
  return best;
}

export function buildHumanReviewPromptPrefix(comment: string): string {
  const body = comment.trim().slice(0, 4_000);
  if (!body) return '';
  return ['【人工审查意见】', body].join('\n');
}

export function validateReviewDecision(
  decision: WorkflowReviewAction,
  node: WorkflowNode,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  snapshot?: NodeRunRecord['reviewSnapshot'],
): { ok: true } | { ok: false; detail: string } {
  if (decision.kind === 'redo') {
    if (!decision.comment.trim()) return { ok: false, detail: 'redo_comment_required' };
    return { ok: true };
  }
  if (decision.kind === 'rollback') {
    if (!decision.comment.trim()) return { ok: false, detail: 'rollback_comment_required' };
    if (!nodes.some((n) => n.id === decision.targetNodeId)) {
      return { ok: false, detail: 'rollback_target_invalid' };
    }
    if (!isAncestorOf(decision.targetNodeId, node.id, nodes, edges)) {
      return { ok: false, detail: 'rollback_target_not_ancestor' };
    }
    return { ok: true };
  }
  if (decision.kind === 'edited_continue') {
    if (!snapshot?.paths?.length) return { ok: false, detail: 'edited_continue_no_snapshot' };
    return { ok: true };
  }
  return { ok: true };
}

export type ValidateEditedPathsFn = (paths: string[], roleNames: string[]) => boolean;

export function validateEditedDeliverablePaths(
  snapshot: NodeRunRecord['reviewSnapshot'],
  pathsExist: ValidateEditedPathsFn,
): boolean {
  if (!snapshot?.paths?.length) return false;
  return pathsExist(snapshot.paths, snapshot.roleNames ?? []);
}

/** Default path policy: every path exists and lies under a role deliverable dir when roleNames provided. */
export function defaultEditedPathsExist(
  paths: string[],
  roleNames: string[],
): boolean {
  if (paths.length === 0) return false;
  for (const p of paths) {
    if (!p.trim()) return false;
    if (roleNames.length > 0) {
      const underRole = roleNames.some((role) => isUnderRoleScopedDeliverableDir(p, role));
      if (!underRole) return false;
    }
  }
  return true;
}

function newBatchId(): string {
  return `review-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function upsertBatchItem(
  batch: WorkflowReviewBatch,
  nodeId: string,
  patch: Partial<WorkflowReviewItem>,
): WorkflowReviewBatch {
  const prev = batch.items[nodeId];
  const nextItem: WorkflowReviewItem = {
    nodeId,
    state: patch.state ?? prev?.state ?? 'awaiting_decision',
    decision: patch.decision ?? prev?.decision,
    submittedAt: patch.submittedAt ?? prev?.submittedAt,
  };
  return {
    ...batch,
    items: { ...batch.items, [nodeId]: nextItem },
    updatedAt: Date.now(),
  };
}

export function openReviewItemForCompletedNode(params: {
  task: OfficeTempProject;
  node: WorkflowNode;
  nodes: WorkflowNode[];
  isCheckpoint: (node: WorkflowNode) => boolean;
  nowMs?: number;
}): OfficeTempProject {
  const now = params.nowMs ?? Date.now();
  const parallelGroup = reviewParallelGroupKey(params.node);
  const expected = expectedCheckpointNodeIds(params.nodes, parallelGroup, params.isCheckpoint);

  let batch = params.task.workflowReviewBatch;
  if (!batch || batch.parallelGroup !== parallelGroup || batch.phase === 'closed') {
    const items: Record<string, WorkflowReviewItem> = {};
    for (const id of expected) {
      items[id] = {
        nodeId: id,
        state: id === params.node.id ? 'awaiting_decision' : 'awaiting_execution',
      };
    }
    batch = {
      id: newBatchId(),
      settleGeneration: 0,
      parallelGroup,
      expectedNodeIds: expected,
      phase: 'collecting',
      items,
      createdAt: now,
      updatedAt: now,
    };
  } else {
    batch = upsertBatchItem(batch, params.node.id, { state: 'awaiting_decision' });
    for (const id of expected) {
      if (!batch.items[id]) {
        batch = upsertBatchItem(batch, id, {
          state: id === params.node.id ? 'awaiting_decision' : 'awaiting_execution',
        });
      }
    }
    batch = { ...batch, expectedNodeIds: expected, updatedAt: now };
  }

  return { ...params.task, workflowReviewBatch: batch, updatedAt: now };
}

export function syncReviewBatchExecutionStates(
  batch: WorkflowReviewBatch,
  runs: Map<string, NodeRunRecord>,
): WorkflowReviewBatch {
  let next = batch;
  for (const nodeId of batch.expectedNodeIds) {
    const item = next.items[nodeId];
    if (!item || item.state === 'submitted') continue;
    const run = runs.get(nodeId);
    if (run?.status === 'completed' && item.state !== 'awaiting_decision') {
      next = upsertBatchItem(next, nodeId, { state: 'awaiting_decision' });
    }
  }
  return next;
}

export function allExpectedReviewSubmitted(batch: WorkflowReviewBatch): boolean {
  return batch.expectedNodeIds.every((id) => batch.items[id]?.state === 'submitted');
}

export function allExpectedReviewCompleted(
  batch: WorkflowReviewBatch,
  runs: Map<string, NodeRunRecord>,
): boolean {
  return batch.expectedNodeIds.every((id) => runs.get(id)?.status === 'completed');
}

export function submitReviewDecision(params: {
  task: OfficeTempProject;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  nodeId: string;
  decision: WorkflowReviewAction;
  runs: Map<string, NodeRunRecord>;
  pathsExist?: ValidateEditedPathsFn;
  expectedBatchUpdatedAt?: number;
  nowMs?: number;
}): { task: OfficeTempProject; error?: string; settled?: boolean } {
  const batch = params.task.workflowReviewBatch;
  if (!batch || batch.phase === 'closed') {
    return { task: params.task, error: 'review_batch_missing' };
  }

  if (
    params.expectedBatchUpdatedAt !== undefined
    && params.expectedBatchUpdatedAt !== batch.updatedAt
  ) {
    return { task: params.task, error: 'review_batch_stale' };
  }

  const node = params.nodes.find((n) => n.id === params.nodeId);
  if (!node) return { task: params.task, error: 'node_not_found' };

  if (batch.phase !== 'collecting') {
    return { task: params.task, error: 'review_batch_not_collecting' };
  }

  const item = batch.items[params.nodeId];
  if (!item || item.state !== 'awaiting_decision') {
    return { task: params.task, error: 'review_item_locked' };
  }

  const run = params.runs.get(params.nodeId);
  const validation = validateReviewDecision(
    params.decision,
    node,
    params.nodes,
    params.edges,
    run?.reviewSnapshot,
  );
  if (!validation.ok) return { task: params.task, error: validation.detail };

  if (params.decision.kind === 'edited_continue') {
    const exists = params.pathsExist ?? defaultEditedPathsExist;
    if (!validateEditedDeliverablePaths(run?.reviewSnapshot, exists)) {
      return { task: params.task, error: 'edited_continue_validation_failed' };
    }
  }

  const now = params.nowMs ?? Date.now();
  let nextBatch = upsertBatchItem(batch, params.nodeId, {
    state: 'submitted',
    decision: params.decision,
    submittedAt: now,
  });

  if (allExpectedReviewSubmitted(nextBatch) && allExpectedReviewCompleted(nextBatch, params.runs)) {
    nextBatch = { ...nextBatch, phase: 'ready_to_settle', updatedAt: now };
  }

  let task: OfficeTempProject = {
    ...params.task,
    workflowReviewBatch: nextBatch,
    updatedAt: now,
  };

  if (shouldAutoSettleReviewBatch(nextBatch)) {
    const settled = settleReviewBatch({
      task,
      nodes: params.nodes,
      edges: params.edges,
      runs: params.runs,
      expectedSettleGeneration: nextBatch.settleGeneration,
    });
    if (settled.error) {
      return { task: params.task, error: settled.error };
    }
    return { task: settled.task, settled: true };
  }

  return { task };
}

export type ReviewInterventionPlan = {
  activeNodeId: string;
  request: string;
  kind: 'redo' | 'rollback';
};

export type SettlementPlan = {
  phase: WorkflowReviewBatchPhase;
  continueNodeIds: string[];
  voidedContinueNodeIds: string[];
  reworkRoots: string[];
  unifiedReworkRoot: string | null;
  deferred: boolean;
  carriedDecisions?: Record<string, WorkflowReviewAction>;
  deferredReason?: WorkflowReviewBatch['deferredReason'];
  interventions: ReviewInterventionPlan[];
  settleWarnings: string[];
};

/** Combine settlement interventions onto the unified resume root for prompt injection. */
export function resolveSettlementIntervention(
  plan: Pick<SettlementPlan, 'interventions' | 'unifiedReworkRoot'>,
): ReviewInterventionPlan | undefined {
  if (plan.interventions.length === 0) return undefined;
  const combined = plan.interventions
    .map((iv) => iv.request.trim())
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 4_000);
  if (!combined) return undefined;
  const activeNodeId = plan.unifiedReworkRoot ?? plan.interventions[0]!.activeNodeId;
  const kind = plan.interventions.some((iv) => iv.kind === 'rollback') ? 'rollback' : 'redo';
  return { activeNodeId, request: combined, kind };
}

export function planReviewSettlement(params: {
  batch: WorkflowReviewBatch;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}): SettlementPlan {
  const { batch, nodes, edges } = params;
  const continueNodeIds: string[] = [];
  const reworkStarts: string[] = [];
  const interventions: ReviewInterventionPlan[] = [];
  const settleWarnings: string[] = [];
  const voidedContinueNodeIds: string[] = [];

  for (const nodeId of batch.expectedNodeIds) {
    const item = batch.items[nodeId];
    if (!item?.decision) continue;
    const d = item.decision;
    if (d.kind === 'approve' || d.kind === 'edited_continue') {
      continueNodeIds.push(nodeId);
    } else if (d.kind === 'redo') {
      reworkStarts.push(nodeId);
      interventions.push({
        activeNodeId: nodeId,
        request: buildHumanReviewPromptPrefix(d.comment),
        kind: 'redo',
      });
    } else if (d.kind === 'rollback') {
      reworkStarts.push(d.targetNodeId);
      interventions.push({
        activeNodeId: d.targetNodeId,
        request: buildHumanReviewPromptPrefix(d.comment),
        kind: 'rollback',
      });
    }
  }

  let deferred = false;
  let carriedDecisions: Record<string, WorkflowReviewAction> | undefined;
  let deferredReason: WorkflowReviewBatch['deferredReason'] | undefined;

  for (const rollbackNodeId of batch.expectedNodeIds) {
    const item = batch.items[rollbackNodeId];
    if (item?.decision?.kind !== 'rollback') continue;
    const targetId = item.decision.targetNodeId;
    for (const continueId of continueNodeIds) {
      if (continueId === rollbackNodeId) continue;
      if (!isAncestorOf(targetId, continueId, nodes, edges)) {
        deferred = true;
        deferredReason = 'rollback_without_common_ancestor';
        carriedDecisions = carriedDecisions ?? {};
        const cont = batch.items[continueId]?.decision;
        if (cont) carriedDecisions[continueId] = cont;
        settleWarnings.push(
          `rollback_${rollbackNodeId}_does_not_void_${continueId}_until_deferred_close`,
        );
      } else {
        voidedContinueNodeIds.push(continueId);
        settleWarnings.push(`rollback_voids_continue_${continueId}`);
      }
    }
  }

  const effectiveContinues = continueNodeIds.filter((id) => !voidedContinueNodeIds.includes(id));

  let unifiedReworkRoot: string | null = null;
  if (reworkStarts.length > 0) {
    if (deferred) {
      unifiedReworkRoot = null;
      for (const nodeId of batch.expectedNodeIds) {
        const item = batch.items[nodeId];
        if (item?.decision?.kind === 'rollback') {
          unifiedReworkRoot = item.decision.targetNodeId;
          break;
        }
        if (item?.decision?.kind === 'redo') {
          unifiedReworkRoot = nodeId;
        }
      }
    } else {
      unifiedReworkRoot = computeUnifiedReworkRoot(reworkStarts, nodes, edges);
    }
  }

  const phase: WorkflowReviewBatchPhase = deferred
    ? 'deferred'
    : 'closed';

  return {
    phase,
    continueNodeIds: effectiveContinues,
    voidedContinueNodeIds,
    reworkRoots: reworkStarts,
    unifiedReworkRoot,
    deferred,
    carriedDecisions,
    deferredReason,
    interventions,
    settleWarnings,
  };
}

export function applySettlementPlanToRuns(params: {
  plan: SettlementPlan;
  batch: WorkflowReviewBatch;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  runs: Map<string, NodeRunRecord>;
}): Map<string, NodeRunRecord> {
  const runs = new Map(params.runs);
  const { plan, nodes, edges } = params;

  if (plan.unifiedReworkRoot) {
    reopenWorkflowNodeAndDownstream({
      runs,
      nodes,
      edges,
      nodeId: plan.unifiedReworkRoot,
    });
    for (const iv of plan.interventions) {
      const run = runs.get(iv.activeNodeId);
      if (run) {
        runs.set(iv.activeNodeId, {
          ...run,
          reworkReason: iv.request.slice(0, 2_000),
        });
      }
    }
    // Parallel redo/rollback may unify to a common ancestor that is not itself an
    // intervention target. That ancestor is often the first runnable node and must
    // carry the review text or the LLM prompt loses it.
    const settlementIv = resolveSettlementIntervention(plan);
    if (settlementIv) {
      const root = runs.get(settlementIv.activeNodeId);
      if (root) {
        runs.set(settlementIv.activeNodeId, {
          ...root,
          reworkReason: settlementIv.request.slice(0, 2_000),
        });
      }
    }
  }

  return runs;
}

export function settleReviewBatch(params: {
  task: OfficeTempProject;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  runs: Map<string, NodeRunRecord>;
  expectedSettleGeneration: number;
}): {
  task: OfficeTempProject;
  runs: Map<string, NodeRunRecord>;
  needsContinue: boolean;
  intervention?: ReviewInterventionPlan;
  error?: string;
} {
  const batch = params.task.workflowReviewBatch;
  if (!batch) {
    return { task: params.task, runs: params.runs, needsContinue: false, error: 'review_batch_missing' };
  }

  if (params.expectedSettleGeneration !== batch.settleGeneration) {
    return { task: params.task, runs: params.runs, needsContinue: false, error: 'review_batch_stale' };
  }

  if (batch.phase !== 'ready_to_settle') {
    return { task: params.task, runs: params.runs, needsContinue: false, error: 'review_not_ready_to_settle' };
  }

  const plan = planReviewSettlement({
    batch,
    nodes: params.nodes,
    edges: params.edges,
  });

  const runs = applySettlementPlanToRuns({
    plan,
    batch,
    nodes: params.nodes,
    edges: params.edges,
    runs: params.runs,
  });

  const primaryIntervention = resolveSettlementIntervention(plan);
  let nextBatch: WorkflowReviewBatch | undefined;

  if (plan.deferred) {
    nextBatch = {
      ...batch,
      phase: 'deferred',
      carriedDecisions: plan.carriedDecisions,
      deferredReason: plan.deferredReason,
      settleGeneration: batch.settleGeneration + 1,
      updatedAt: Date.now(),
      items: Object.fromEntries(
        batch.expectedNodeIds.map((id) => {
          const prev = batch.items[id]!;
          if (plan.carriedDecisions?.[id]) {
            return [id, { ...prev, state: 'submitted' as WorkflowReviewItemState }];
          }
          return [id, prev];
        }),
      ),
    };
  } else {
    nextBatch = undefined;
  }

  const task: OfficeTempProject = {
    ...params.task,
    workflowReviewBatch: nextBatch,
    nodeRuns: params.nodes.map((n) => runs.get(n.id) ?? params.runs.get(n.id)!),
    workflowUserIntervention: primaryIntervention
      ? {
          activeNodeId: primaryIntervention.activeNodeId,
          request: primaryIntervention.request,
          startedAt: Date.now(),
          // Checkpoint rollback/redo both resume a target node; reuse `redo` for
          // clear-on-complete semantics (kind union has no `rollback`).
          kind: 'redo' as const,
        }
      : plan.deferred
        ? params.task.workflowUserIntervention
        : undefined,
    updatedAt: Date.now(),
  };

  return {
    task,
    runs,
    needsContinue: true,
    intervention: primaryIntervention,
  };
}

export function onDeferredNodeCompletedReview(params: {
  task: OfficeTempProject;
  node: WorkflowNode;
  nodes: WorkflowNode[];
  isCheckpoint: (n: WorkflowNode) => boolean;
}): OfficeTempProject {
  const batch = params.task.workflowReviewBatch;
  if (!batch || batch.phase !== 'deferred') return params.task;

  let next = openReviewItemForCompletedNode({
    task: params.task,
    node: params.node,
    nodes: params.nodes,
    isCheckpoint: params.isCheckpoint,
  });

  next = {
    ...next,
    workflowReviewBatch: {
      ...next.workflowReviewBatch!,
      phase: 'collecting',
      carriedDecisions: batch.carriedDecisions,
      deferredReason: batch.deferredReason,
    },
  };

  if (batch.carriedDecisions) {
    for (const [nodeId, decision] of Object.entries(batch.carriedDecisions)) {
      next = {
        ...next,
        workflowReviewBatch: upsertBatchItem(next.workflowReviewBatch!, nodeId, {
          state: 'submitted',
          decision,
          submittedAt: batch.items[nodeId]?.submittedAt,
        }),
      };
    }
  }

  return next;
}

export function finalizeDeferredBatchIfReady(params: {
  task: OfficeTempProject;
  runs: Map<string, NodeRunRecord>;
}): OfficeTempProject {
  const batch = params.task.workflowReviewBatch;
  if (!batch || batch.phase !== 'collecting' || !batch.carriedDecisions) {
    return params.task;
  }

  const pendingRework = batch.expectedNodeIds.some((id) => {
    if (batch.carriedDecisions?.[id]) return false;
    const run = params.runs.get(id);
    return run?.status !== 'completed' || batch.items[id]?.state !== 'submitted';
  });

  if (pendingRework) return params.task;

  return {
    ...params.task,
    workflowReviewBatch: undefined,
    updatedAt: Date.now(),
  };
}

export function shouldWorkflowRunnerSleepForReview(params: {
  task: OfficeTempProject;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  runs: Map<string, NodeRunRecord>;
}): boolean {
  if (!isWorkflowReviewActive(params.task)) return false;

  const batch = params.task.workflowReviewBatch!;
  const hold = reviewHoldNodeIds(params.task);

  const hasRunning = [...params.runs.values()].some((r) => r.status === 'running');
  if (hasRunning) return false;

  const hasRunnable = params.nodes.some((node) => {
    const run = params.runs.get(node.id);
    if (run?.status !== 'pending') return false;
    return incomingReadyForExecution({
      nodeId: node.id,
      nodes: params.nodes,
      edges: params.edges,
      runs: params.runs,
      reviewHoldNodeIds: hold,
    });
  });
  if (hasRunnable) return false;

  return batch.phase === 'collecting'
    || batch.phase === 'ready_to_settle'
    || batch.phase === 'deferred';
}

export function teardownReviewBatch(
  task: OfficeTempProject,
): OfficeTempProject {
  if (!task.workflowReviewBatch) return task;
  return {
    ...task,
    workflowReviewBatch: undefined,
    updatedAt: Date.now(),
  };
}

export function validateCheckpointParallelGroups(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  isCheckpoint: (node: WorkflowNode) => boolean,
): string[] {
  const warnings: string[] = [];
  const checkpointNodes = nodes.filter(isCheckpoint);
  const edgeList = workflowEdgeList(nodes, edges);

  function forwardPredKey(nodeId: string): string {
    return forwardIncomingEdges(edgeList, nodeId)
      .map((e) => e.from)
      .sort()
      .join('|');
  }

  const forkLayers = new Map<string, WorkflowNode[]>();
  for (const node of checkpointNodes) {
    const key = forwardPredKey(node.id);
    const list = forkLayers.get(key) ?? [];
    list.push(node);
    forkLayers.set(key, list);
  }

  for (const layer of forkLayers.values()) {
    if (layer.length < 2) continue;
    const groups = new Set(layer.map((n) => reviewParallelGroupKey(n)));
    if (groups.size > 1) {
      warnings.push(
        `checkpoint_nodes_same_fork_different_parallelGroup:${layer.map((n) => n.id).join(',')}`,
      );
    }
    const missing = layer.filter((n) => !n.parallelGroup?.trim());
    if (missing.length > 0) {
      warnings.push(
        `checkpoint_nodes_missing_parallelGroup:${missing.map((n) => n.id).join(',')}`,
      );
    }
  }

  return warnings;
}

export function buildReviewHealGuard(
  task: Pick<OfficeTempProject, 'workflowReviewBatch'>,
): {
  reviewHoldNodeIds: ReadonlySet<string>;
  expectedNodeIds: ReadonlySet<string>;
} | undefined {
  const batch = task.workflowReviewBatch;
  if (!batch || batch.phase === 'closed') return undefined;
  const guarded = new Set<string>();
  for (const nodeId of batch.expectedNodeIds) {
    const item = batch.items[nodeId];
    if (!item) continue;
    if (item.state === 'awaiting_decision' || item.state === 'submitted') {
      guarded.add(nodeId);
    }
  }
  return {
    reviewHoldNodeIds: reviewHoldNodeIds(task),
    expectedNodeIds: guarded,
  };
}

export function shouldApplyStoredReviewBatch(
  stored: Pick<OfficeTempProject, 'workflowReviewBatch' | 'updatedAt'>,
  task: Pick<OfficeTempProject, 'workflowReviewBatch' | 'updatedAt'>,
): boolean {
  const sb = stored.workflowReviewBatch;
  if (!sb) return false;
  const tb = task.workflowReviewBatch;
  if (!tb) {
    return stored.updatedAt > (task.updatedAt ?? 0);
  }
  if (sb.settleGeneration > tb.settleGeneration) return true;
  if (sb.settleGeneration < tb.settleGeneration) return false;
  if (sb.updatedAt > tb.updatedAt) return true;
  return stored.updatedAt > (task.updatedAt ?? 0) && sb.updatedAt >= tb.updatedAt;
}

export function mergeReviewStateFromStored(
  stored: OfficeTempProject,
  task: OfficeTempProject,
  runs: Map<string, NodeRunRecord>,
): OfficeTempProject {
  let next: OfficeTempProject = {
    ...task,
    workflowCheckpointOverrides: stored.workflowCheckpointOverrides ?? task.workflowCheckpointOverrides,
  };

  const sb = stored.workflowReviewBatch;
  const tb = task.workflowReviewBatch;

  if (!tb && sb) {
    const closed = finalizeDeferredBatchIfReady({
      task: { ...task, workflowReviewBatch: sb },
      runs,
    });
    if (!closed.workflowReviewBatch) {
      return { ...next, workflowReviewBatch: undefined };
    }
  }

  // Review API settled and cleared the batch on disk while the runner still holds a stale batch.
  if (!sb && tb && stored.updatedAt >= (task.updatedAt ?? 0)) {
    return {
      ...next,
      workflowReviewBatch: undefined,
      // Settle may also reopen nodeRuns + stamp intervention; runner syncs runs via
      // shouldSyncNodeRunsFromStoredReview (must be evaluated before this merge clears tb).
      workflowUserIntervention: stored.workflowUserIntervention,
      updatedAt: Math.max(stored.updatedAt, task.updatedAt ?? 0),
    };
  }

  if (shouldApplyStoredReviewBatch(stored, task)) {
    return {
      ...next,
      workflowReviewBatch: sb,
      updatedAt: Math.max(stored.updatedAt, task.updatedAt ?? 0),
    };
  }

  return next;
}

/** Recover review batch on persist when memory task lost it after a nested write. */
export function coalesceReviewBatchForPersist(
  task: Pick<OfficeTempProject, 'workflowReviewBatch' | 'updatedAt'>,
  stored: Pick<OfficeTempProject, 'workflowReviewBatch' | 'updatedAt'> | null | undefined,
): WorkflowReviewBatch | undefined {
  const sb = stored?.workflowReviewBatch;
  const tb = task.workflowReviewBatch;

  if (!sb && tb && stored && stored.updatedAt >= (task.updatedAt ?? 0)) {
    return undefined;
  }

  if (tb) return tb;
  if (!sb) return undefined;
  if (sb.updatedAt >= (task.updatedAt ?? 0)) return sb;
  return undefined;
}

export function shouldSyncNodeRunsFromStoredReview(
  stored: Pick<OfficeTempProject, 'workflowReviewBatch' | 'updatedAt'>,
  task: Pick<OfficeTempProject, 'workflowReviewBatch' | 'updatedAt'>,
): boolean {
  const sb = stored.workflowReviewBatch;
  const tb = task.workflowReviewBatch;
  // Important: evaluate against the *pre-merge* memory task. After
  // mergeReviewStateFromStored clears a settled batch, both sides are empty and
  // this would incorrectly return false — dropping reopen/rework nodeRuns.
  if (!sb && !tb) return false;
  if (!sb || !tb) return true;
  if (sb.settleGeneration !== tb.settleGeneration) return true;
  if (sb.phase !== tb.phase) return true;
  return stored.updatedAt > (task.updatedAt ?? 0);
}

export function captureReviewSnapshotOnRun(
  run: NodeRunRecord,
  roleNames: string[],
  nowMs: number = Date.now(),
): NodeRunRecord {
  if (run.reviewSnapshot?.paths?.length) return run;
  const path = run.deliverablePath?.trim();
  if (!path) return run;
  return {
    ...run,
    reviewSnapshot: {
      paths: [path],
      roleNames,
      capturedAt: nowMs,
    },
  };
}

export function isReviewHealGuardedNode(
  nodeId: string,
  guard: {
    reviewHoldNodeIds: ReadonlySet<string>;
    expectedNodeIds: ReadonlySet<string>;
  },
): boolean {
  return guard.reviewHoldNodeIds.has(nodeId) || guard.expectedNodeIds.has(nodeId);
}
