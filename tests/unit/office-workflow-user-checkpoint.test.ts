/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import {
  allExpectedReviewCompleted,
  allExpectedReviewSubmitted,
  buildReviewHealGuard,
  captureReviewSnapshotOnRun,
  applySettlementPlanToRuns,
  coalesceReviewBatchForPersist,
  computeUnifiedReworkRoot,
  defaultEditedPathsExist,
  deriveWorkflowExecutionPhase,
  expectedCheckpointNodeIds,
  finalizeDeferredBatchIfReady,
  incomingReadyForExecution,
  isAncestorOf,
  isReviewHealGuardedNode,
  isWorkflowReviewActive,
  nextRunnableNodesForExecution,
  mergeReviewStateFromStored,
  onDeferredNodeCompletedReview,
  openReviewItemForCompletedNode,
  planReviewSettlement,
  resolveSettlementIntervention,
  resolveUserCheckpoint,
  reviewHoldNodeIds,
  reviewParallelGroupKey,
  shouldAutoSettleReviewBatch,
  SERIAL_REVIEW_GROUP,
  settleReviewBatch,
  shouldWorkflowRunnerSleepForReview,
  shouldApplyStoredReviewBatch,
  shouldSyncNodeRunsFromStoredReview,
  submitReviewDecision,
  syncReviewBatchExecutionStates,
  validateCheckpointParallelGroups,
  validateReviewDecision,
} from '@/lib/office-workflow-user-checkpoint';
import type { NodeRunRecord, OfficeTempProject, WorkflowEdge, WorkflowNode } from '@/types/office';

function node(id: string, opts: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id,
    agentId: 'a1',
    execution: 'serial',
    ...opts,
  };
}

function run(nodeId: string, status: NodeRunRecord['status'], extra: Partial<NodeRunRecord> = {}): NodeRunRecord {
  return { nodeId, agentId: 'a1', status, ...extra };
}

function task(overrides: Partial<OfficeTempProject> = {}): OfficeTempProject {
  return {
    id: 't1',
    title: 'T',
    origin: 'standalone',
    agentIds: ['a1'],
    coordinatorAgentId: 'a1',
    lifecycle: 'active',
    featureDescription: '',
    description: '',
    status: 'running',
    nodeRuns: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function runsMap(records: NodeRunRecord[]): Map<string, NodeRunRecord> {
  return new Map(records.map((r) => [r.nodeId, r]));
}

describe('office-workflow-user-checkpoint', () => {
  it('resolveUserCheckpoint respects override and node flag', () => {
    const n = node('n1', { userCheckpoint: false });
    expect(resolveUserCheckpoint({}, n)).toBe(false);
    expect(resolveUserCheckpoint({ workflowCheckpointOverrides: { n1: { userCheckpoint: true } } }, n)).toBe(true);
    expect(resolveUserCheckpoint({}, node('n2', { userCheckpoint: true }))).toBe(true);
  });

  it('reviewParallelGroupKey uses per-node serial group when parallelGroup missing', () => {
    expect(reviewParallelGroupKey(node('n1'))).toBe('serial:n1');
    expect(reviewParallelGroupKey(node('n2'))).toBe('serial:n2');
    expect(reviewParallelGroupKey(node('n1', { parallelGroup: 'g1' }))).toBe('g1');
  });

  it('shouldAutoSettleReviewBatch for single-node and legacy serial', () => {
    expect(
      shouldAutoSettleReviewBatch({
        id: 'b',
        settleGeneration: 0,
        parallelGroup: 'serial:n1',
        expectedNodeIds: ['n1'],
        phase: 'ready_to_settle',
        items: {},
        createdAt: 1,
        updatedAt: 1,
      }),
    ).toBe(true);
    expect(
      shouldAutoSettleReviewBatch({
        id: 'b',
        settleGeneration: 0,
        parallelGroup: SERIAL_REVIEW_GROUP,
        expectedNodeIds: ['n1'],
        phase: 'ready_to_settle',
        items: {},
        createdAt: 1,
        updatedAt: 1,
      }),
    ).toBe(true);
    expect(
      shouldAutoSettleReviewBatch({
        id: 'b',
        settleGeneration: 0,
        parallelGroup: 'pg-1',
        expectedNodeIds: ['n1', 'n2'],
        phase: 'ready_to_settle',
        items: {},
        createdAt: 1,
        updatedAt: 1,
      }),
    ).toBe(false);
  });

  it('serial checkpoints in different nodes form separate review groups', () => {
    const nodes = [
      node('n1', { userCheckpoint: true }),
      node('n2'),
      node('n3', { userCheckpoint: true }),
    ];
    expect(expectedCheckpointNodeIds(nodes, 'serial:n1', (n) => Boolean(n.userCheckpoint))).toEqual([
      'n1',
    ]);
    expect(expectedCheckpointNodeIds(nodes, 'serial:n3', (n) => Boolean(n.userCheckpoint))).toEqual([
      'n3',
    ]);
  });

  it('incomingReadyForExecution blocks downstream of held completed node', () => {
    const nodes = [node('n1'), node('n2')];
    const edges: WorkflowEdge[] = [{ from: 'n1', to: 'n2', when: 'on_success' }];
    const runs = runsMap([
      run('n1', 'completed'),
      run('n2', 'pending'),
    ]);
    expect(
      incomingReadyForExecution({
        nodeId: 'n2',
        nodes,
        edges,
        runs,
        reviewHoldNodeIds: new Set(['n1']),
      }),
    ).toBe(false);
    expect(
      incomingReadyForExecution({
        nodeId: 'n2',
        nodes,
        edges,
        runs,
        reviewHoldNodeIds: new Set(),
      }),
    ).toBe(true);
  });

  it('serial approve submits and settles immediately', () => {
    const nodes = [node('n1', { userCheckpoint: true })];
    const edges: WorkflowEdge[] = [];
    const runs = runsMap([run('n1', 'completed', { reviewSnapshot: { paths: ['/p'], roleNames: ['PM'], capturedAt: 1 } })]);
    let t = openReviewItemForCompletedNode({
      task: task(),
      node: nodes[0]!,
      nodes,
      isCheckpoint: (n) => n.userCheckpoint === true,
    });
    expect(isWorkflowReviewActive(t)).toBe(true);

    const result = submitReviewDecision({
      task: t,
      nodes,
      edges,
      nodeId: 'n1',
      decision: { kind: 'approve' },
      runs,
    });
    expect(result.settled).toBe(true);
    expect(result.task.workflowReviewBatch).toBeUndefined();
  });

  it('edited_continue requires snapshot and validation', () => {
    const nodes = [node('n1', { userCheckpoint: true })];
    const n = nodes[0]!;
    const edges: WorkflowEdge[] = [];
    const runs = runsMap([run('n1', 'completed')]);
    let t = openReviewItemForCompletedNode({
      task: task(),
      node: n,
      nodes,
      isCheckpoint: (x) => x.userCheckpoint === true,
    });
    const fail = submitReviewDecision({
      task: t,
      nodes,
      edges,
      nodeId: 'n1',
      decision: { kind: 'edited_continue' },
      runs,
    });
    expect(fail.error).toBe('edited_continue_no_snapshot');

    const runs2 = runsMap([
      run('n1', 'completed', {
        reviewSnapshot: { paths: ['交付物-PM/out.md'], roleNames: ['PM'], capturedAt: 1 },
      }),
    ]);
    const ok = submitReviewDecision({
      task: t,
      nodes,
      edges,
      nodeId: 'n1',
      decision: { kind: 'edited_continue', note: 'fixed typo' },
      runs: runs2,
      pathsExist: () => true,
    });
    expect(ok.error).toBeUndefined();
    expect(ok.settled).toBe(true);
  });

  it('parallel batch waits for all submissions before ready_to_settle', () => {
    const nodes = [
      node('nA', { userCheckpoint: true, parallelGroup: 'g' }),
      node('nB', { userCheckpoint: true, parallelGroup: 'g' }),
    ];
    const edges: WorkflowEdge[] = [
      { from: 'nA', to: 'nJ', when: 'on_success' },
      { from: 'nB', to: 'nJ', when: 'on_success' },
    ];
    const runs = runsMap([
      run('nA', 'completed'),
      run('nB', 'pending'),
    ]);
    let t = openReviewItemForCompletedNode({
      task: task(),
      node: nodes[0]!,
      nodes,
      isCheckpoint: (n) => Boolean(n.userCheckpoint),
    });
    expect(expectedCheckpointNodeIds(nodes, 'g', (n) => Boolean(n.userCheckpoint))).toEqual(['nA', 'nB']);

    const partial = submitReviewDecision({
      task: t,
      nodes,
      edges,
      nodeId: 'nA',
      decision: { kind: 'approve' },
      runs,
    });
    expect(partial.settled).toBeFalsy();
    expect(partial.task.workflowReviewBatch?.phase).toBe('collecting');
    expect(partial.task.workflowReviewBatch?.items.nA?.state).toBe('submitted');

    const runs2 = runsMap([
      run('nA', 'completed'),
      run('nB', 'completed'),
    ]);
    let batch = syncReviewBatchExecutionStates(partial.task.workflowReviewBatch!, runs2);
    expect(batch.items.nB?.state).toBe('awaiting_decision');

    const second = submitReviewDecision({
      task: { ...partial.task, workflowReviewBatch: batch },
      nodes,
      edges,
      nodeId: 'nB',
      decision: { kind: 'approve' },
      runs: runs2,
    });
    expect(second.task.workflowReviewBatch?.phase).toBe('ready_to_settle');
    expect(second.settled).toBeFalsy();
  });

  it('computeUnifiedReworkRoot picks common fork for parallel redo', () => {
    const nodes = [
      node('start'),
      node('nA', { parallelGroup: 'g' }),
      node('nB', { parallelGroup: 'g' }),
    ];
    const edges: WorkflowEdge[] = [
      { from: 'start', to: 'nA', when: 'on_success' },
      { from: 'start', to: 'nB', when: 'on_success' },
    ];
    const root = computeUnifiedReworkRoot(['nA', 'nB'], nodes, edges);
    expect(root).toBe('start');
  });

  it('applySettlementPlanToRuns writes combined review text onto unifiedReworkRoot', () => {
    const nodes = [
      node('start'),
      node('nA', { parallelGroup: 'g', userCheckpoint: true }),
      node('nB', { parallelGroup: 'g', userCheckpoint: true }),
    ];
    const edges: WorkflowEdge[] = [
      { from: 'start', to: 'nA', when: 'on_success' },
      { from: 'start', to: 'nB', when: 'on_success' },
    ];
    const plan = planReviewSettlement({
      batch: {
        id: 'b1',
        settleGeneration: 0,
        parallelGroup: 'g',
        expectedNodeIds: ['nA', 'nB'],
        phase: 'ready_to_settle',
        items: {
          nA: {
            nodeId: 'nA',
            state: 'submitted',
            decision: { kind: 'redo', comment: 'fix A' },
          },
          nB: {
            nodeId: 'nB',
            state: 'submitted',
            decision: { kind: 'redo', comment: 'fix B' },
          },
        },
        createdAt: 1,
        updatedAt: 1,
      },
      nodes,
      edges,
    });
    expect(plan.unifiedReworkRoot).toBe('start');
    const settlementIv = resolveSettlementIntervention(plan);
    expect(settlementIv?.activeNodeId).toBe('start');
    expect(settlementIv?.request).toContain('fix A');
    expect(settlementIv?.request).toContain('fix B');

    const runs = applySettlementPlanToRuns({
      plan,
      batch: plan as never,
      nodes,
      edges,
      runs: new Map([
        ['start', run('start', 'completed')],
        ['nA', run('nA', 'completed')],
        ['nB', run('nB', 'completed')],
      ]),
    });
    expect(runs.get('start')?.status).toBe('pending');
    expect(runs.get('start')?.reworkReason).toContain('【人工审查意见】');
    expect(runs.get('start')?.reworkReason).toContain('fix A');
    expect(runs.get('start')?.reworkReason).toContain('fix B');
    expect(runs.get('nA')?.reworkReason).toContain('fix A');
    expect(runs.get('nB')?.reworkReason).toContain('fix B');
  });

  it('settleReviewBatch persists workflowUserIntervention on the unified resume root', () => {
    const nodes = [node('n1', { userCheckpoint: true }), node('n2')];
    const edges: WorkflowEdge[] = [{ from: 'n1', to: 'n2', when: 'on_success' }];
    const task = {
      id: 't1',
      title: 'T',
      origin: 'standalone',
      agentIds: ['a1'],
      coordinatorAgentId: 'a1',
      lifecycle: 'active',
      featureDescription: '',
      description: '',
      status: 'running',
      executionMode: 'workflow',
      nodeRuns: [run('n1', 'completed'), run('n2', 'pending')],
      createdAt: 1,
      updatedAt: 1,
      workflowReviewBatch: {
        id: 'b1',
        settleGeneration: 0,
        parallelGroup: SERIAL_REVIEW_GROUP,
        expectedNodeIds: ['n1'],
        phase: 'ready_to_settle' as const,
        items: {
          n1: {
            nodeId: 'n1',
            state: 'submitted' as const,
            decision: { kind: 'redo' as const, comment: 'please revise' },
          },
        },
        createdAt: 1,
        updatedAt: 1,
      },
    } as OfficeTempProject;
    const settled = settleReviewBatch({
      task,
      nodes,
      edges,
      runs: new Map([
        ['n1', run('n1', 'completed')],
        ['n2', run('n2', 'pending')],
      ]),
      expectedSettleGeneration: 0,
    });
    expect(settled.error).toBeUndefined();
    expect(settled.intervention?.request).toContain('please revise');
    expect(settled.task.workflowUserIntervention?.activeNodeId).toBe('n1');
    expect(settled.task.workflowUserIntervention?.request).toContain('【人工审查意见】');
    expect(settled.runs.get('n1')?.reworkReason).toContain('please revise');
  });

  it('planReviewSettlement voids continue when rollback ancestor covers peer', () => {
    const nodes = [
      node('start'),
      node('nA', { parallelGroup: 'g' }),
      node('nB', { parallelGroup: 'g' }),
    ];
    const edges: WorkflowEdge[] = [
      { from: 'start', to: 'nA', when: 'on_success' },
      { from: 'start', to: 'nB', when: 'on_success' },
    ];
    const batch = {
      id: 'b1',
      settleGeneration: 0,
      parallelGroup: 'g',
      expectedNodeIds: ['nA', 'nB'],
      phase: 'ready_to_settle' as const,
      items: {
        nA: {
          nodeId: 'nA',
          state: 'submitted' as const,
          decision: { kind: 'approve' as const },
        },
        nB: {
          nodeId: 'nB',
          state: 'submitted' as const,
          decision: {
            kind: 'rollback' as const,
            targetNodeId: 'start',
            comment: 'redo all',
          },
        },
      },
      createdAt: 1,
      updatedAt: 1,
    };
    const plan = planReviewSettlement({ batch, nodes, edges });
    expect(plan.deferred).toBe(false);
    expect(plan.voidedContinueNodeIds).toContain('nA');
    expect(plan.unifiedReworkRoot).toBe('start');
  });

  it('planReviewSettlement defers when rollback does not ancestor peer continue', () => {
    const nodes = [
      node('start'),
      node('x'),
      node('y'),
      node('nA', { parallelGroup: 'g' }),
      node('nB', { parallelGroup: 'g' }),
    ];
    const edges: WorkflowEdge[] = [
      { from: 'start', to: 'x', when: 'on_success' },
      { from: 'start', to: 'y', when: 'on_success' },
      { from: 'x', to: 'nA', when: 'on_success' },
      { from: 'y', to: 'nB', when: 'on_success' },
    ];
    const batch = {
      id: 'b1',
      settleGeneration: 0,
      parallelGroup: 'g',
      expectedNodeIds: ['nA', 'nB'],
      phase: 'ready_to_settle' as const,
      items: {
        nA: {
          nodeId: 'nA',
          state: 'submitted' as const,
          decision: { kind: 'approve' as const },
        },
        nB: {
          nodeId: 'nB',
          state: 'submitted' as const,
          decision: {
            kind: 'rollback' as const,
            targetNodeId: 'y',
            comment: 'fix B branch',
          },
        },
      },
      createdAt: 1,
      updatedAt: 1,
    };
    const plan = planReviewSettlement({ batch, nodes, edges });
    expect(plan.deferred).toBe(true);
    expect(plan.carriedDecisions?.nA?.kind).toBe('approve');
    expect(isAncestorOf('y', 'nA', nodes, edges)).toBe(false);
  });

  it('settleReviewBatch applies rework pending on non-deferred', () => {
    const nodes = [node('n1', { userCheckpoint: true }), node('n2')];
    const edges: WorkflowEdge[] = [{ from: 'n1', to: 'n2', when: 'on_success' }];
    const runs = runsMap([
      run('n1', 'completed'),
      run('n2', 'pending'),
    ]);
    const batch = {
      id: 'b1',
      settleGeneration: 0,
      parallelGroup: SERIAL_REVIEW_GROUP,
      expectedNodeIds: ['n1'],
      phase: 'ready_to_settle' as const,
      items: {
        n1: {
          nodeId: 'n1',
          state: 'submitted' as const,
          decision: { kind: 'redo' as const, comment: 'fix it' },
        },
      },
      createdAt: 1,
      updatedAt: 1,
    };
    const settled = settleReviewBatch({
      task: task({ workflowReviewBatch: batch }),
      nodes,
      edges,
      runs,
      expectedSettleGeneration: 0,
    });
    expect(settled.runs.get('n1')?.status).toBe('pending');
    expect(settled.runs.get('n2')?.status).toBe('pending');
    expect(settled.needsContinue).toBe(true);
    expect(settled.task.workflowReviewBatch).toBeUndefined();
  });

  it('shouldWorkflowRunnerSleepForReview is false while parallel peer still runnable', () => {
    const nodes = [
      node('nA', { userCheckpoint: true, parallelGroup: 'g' }),
      node('nC'),
    ];
    const edges: WorkflowEdge[] = [
      { from: 'nA', to: 'nJ', when: 'on_success' },
      { from: 'nC', to: 'nJ', when: 'on_success' },
    ];
    const runs = runsMap([
      run('nA', 'completed'),
      run('nC', 'pending'),
      run('nJ', 'pending'),
    ]);
    const t = openReviewItemForCompletedNode({
      task: task(),
      node: nodes[0]!,
      nodes,
      isCheckpoint: (n) => Boolean(n.userCheckpoint),
    });
    expect(
      shouldWorkflowRunnerSleepForReview({ task: t, nodes, edges, runs }),
    ).toBe(false);
  });

  it('shouldWorkflowRunnerSleepForReview true when idle and awaiting decision', () => {
    const nodes = [node('n1', { userCheckpoint: true })];
    const edges: WorkflowEdge[] = [];
    const runs = runsMap([run('n1', 'completed')]);
    const t = openReviewItemForCompletedNode({
      task: task(),
      node: nodes[0]!,
      nodes,
      isCheckpoint: (n) => Boolean(n.userCheckpoint),
    });
    expect(
      shouldWorkflowRunnerSleepForReview({ task: t, nodes, edges, runs }),
    ).toBe(true);
  });

  it('reviewHoldNodeIds includes submitted rework nodes but not carried approve in deferred', () => {
    const batch = {
      id: 'b',
      settleGeneration: 1,
      parallelGroup: 'g',
      expectedNodeIds: ['nA', 'nB'],
      phase: 'deferred' as const,
      items: {
        nA: { nodeId: 'nA', state: 'submitted' as const },
        nB: { nodeId: 'nB', state: 'submitted' as const },
      },
      carriedDecisions: {
        nA: { kind: 'approve' as const },
      },
      createdAt: 1,
      updatedAt: 1,
    };
    const held = reviewHoldNodeIds({ workflowReviewBatch: batch });
    expect(held.has('nA')).toBe(false);
    expect(held.has('nB')).toBe(true);
  });

  it('submitReviewDecision rejects awaiting_execution and ready_to_settle phases', () => {
    const nodes = [node('n1', { userCheckpoint: true, parallelGroup: 'g' })];
    const edges: WorkflowEdge[] = [];
    const runs = runsMap([run('n1', 'running')]);
    const collecting = task({
      workflowReviewBatch: {
        id: 'b',
        settleGeneration: 0,
        parallelGroup: 'g',
        expectedNodeIds: ['n1'],
        phase: 'collecting',
        items: { n1: { nodeId: 'n1', state: 'awaiting_execution' } },
        createdAt: 1,
        updatedAt: 1,
      },
    });
    const early = submitReviewDecision({
      task: collecting,
      nodes,
      edges,
      nodeId: 'n1',
      decision: { kind: 'approve' },
      runs,
    });
    expect(early.error).toBe('review_item_locked');

    const ready = submitReviewDecision({
      task: task({
        workflowReviewBatch: {
          id: 'b',
          settleGeneration: 0,
          parallelGroup: 'g',
          expectedNodeIds: ['n1'],
          phase: 'ready_to_settle',
          items: { n1: { nodeId: 'n1', state: 'submitted' } },
          createdAt: 1,
          updatedAt: 1,
        },
      }),
      nodes,
      edges,
      nodeId: 'n1',
      decision: { kind: 'approve' },
      runs: runsMap([run('n1', 'completed')]),
    });
    expect(ready.error).toBe('review_batch_not_collecting');
  });

  it('shouldSyncNodeRunsFromStoredReview detects settle generation changes', () => {
    const base = task({
      workflowReviewBatch: {
        id: 'b',
        settleGeneration: 1,
        parallelGroup: 'g',
        expectedNodeIds: ['n1'],
        phase: 'collecting',
        items: { n1: { nodeId: 'n1', state: 'awaiting_decision' } },
        createdAt: 1,
        updatedAt: 100,
      },
      updatedAt: 100,
    });
    const stored = {
      ...base,
      updatedAt: 200,
      workflowReviewBatch: {
        ...base.workflowReviewBatch!,
        settleGeneration: 2,
        phase: 'deferred' as const,
      },
    };
    expect(shouldSyncNodeRunsFromStoredReview(stored, base)).toBe(true);
    expect(shouldSyncNodeRunsFromStoredReview(base, base)).toBe(false);
  });

  it('shouldSyncNodeRunsFromStoredReview must be evaluated before merge clears memory batch', () => {
    // Disk settle clears batch + reopens nodes; memory still holds pre-settle batch.
    // Callers that merge first then sync lose the !sb||!tb signal and never pull nodeRuns.
    const memory = task({
      updatedAt: 100,
      workflowReviewBatch: {
        id: 'b',
        settleGeneration: 0,
        parallelGroup: 'serial:n1',
        expectedNodeIds: ['n1'],
        phase: 'ready_to_settle',
        items: { n1: { nodeId: 'n1', state: 'submitted' } },
        createdAt: 1,
        updatedAt: 100,
      },
    });
    const stored = task({
      updatedAt: 500,
      workflowReviewBatch: undefined,
      workflowUserIntervention: {
        activeNodeId: 'n1',
        request: '【人工审查意见】\n请修正',
        startedAt: 500,
        kind: 'redo',
      },
      nodeRuns: [run('n1', 'pending', { reworkReason: '【人工审查意见】\n请修正' })],
    });
    expect(shouldSyncNodeRunsFromStoredReview(stored, memory)).toBe(true);
    const merged = mergeReviewStateFromStored(stored, memory, new Map());
    expect(merged.workflowReviewBatch).toBeUndefined();
    // Post-merge both batches empty — sync predicate alone is insufficient.
    expect(shouldSyncNodeRunsFromStoredReview(stored, merged)).toBe(false);
    expect(merged.workflowUserIntervention?.request).toContain('请修正');
  });

  it('carried approve unlocks downstream during deferred', () => {
    const nodes = [
      node('nA', { userCheckpoint: true, parallelGroup: 'g' }),
      node('nJ'),
    ];
    const edges: WorkflowEdge[] = [
      { from: 'nA', to: 'nJ', when: 'on_success' },
    ];
    const runs = runsMap([
      run('nA', 'completed'),
      run('nJ', 'pending'),
    ]);
    const deferred = task({
      workflowReviewBatch: {
        id: 'b',
        settleGeneration: 2,
        parallelGroup: 'g',
        expectedNodeIds: ['nA'],
        phase: 'deferred',
        carriedDecisions: { nA: { kind: 'approve' } },
        items: { nA: { nodeId: 'nA', state: 'submitted' } },
        createdAt: 1,
        updatedAt: 1,
      },
    });
    const hold = reviewHoldNodeIds(deferred);
    expect(
      incomingReadyForExecution({
        nodeId: 'nJ',
        nodes,
        edges,
        runs,
        reviewHoldNodeIds: hold,
      }),
    ).toBe(true);
  });

  it('validateCheckpointParallelGroups warns on missing parallelGroup', () => {
    const nodes = [
      node('s'),
      node('a', { userCheckpoint: true }),
      node('b', { userCheckpoint: true }),
    ];
    const edges: WorkflowEdge[] = [
      { from: 's', to: 'a', when: 'on_success' },
      { from: 's', to: 'b', when: 'on_success' },
    ];
    const warnings = validateCheckpointParallelGroups(
      nodes,
      edges,
      (n) => Boolean(n.userCheckpoint),
    );
    expect(warnings.some((w) => w.includes('missing_parallelGroup'))).toBe(true);
  });

  it('validateReviewDecision rejects rollback to non-ancestor', () => {
    const nodes = [node('n1'), node('n2')];
    const edges: WorkflowEdge[] = [{ from: 'n1', to: 'n2', when: 'on_success' }];
    const v = validateReviewDecision(
      { kind: 'rollback', targetNodeId: 'n2', comment: 'x' },
      nodes[0]!,
      nodes,
      edges,
    );
    expect(v.ok).toBe(false);
  });

  it('allExpectedReviewSubmitted and completed helpers', () => {
    const batch = {
      id: 'b',
      settleGeneration: 0,
      parallelGroup: 'g',
      expectedNodeIds: ['a', 'b'],
      phase: 'collecting' as const,
      items: {
        a: { nodeId: 'a', state: 'submitted' as const },
        b: { nodeId: 'b', state: 'awaiting_decision' as const },
      },
      createdAt: 1,
      updatedAt: 1,
    };
    expect(allExpectedReviewSubmitted(batch)).toBe(false);
    const runs = runsMap([run('a', 'completed'), run('b', 'completed')]);
    expect(allExpectedReviewCompleted(batch, runs)).toBe(true);
  });

  it('defaultEditedPathsExist checks role scoped paths', () => {
    expect(
      defaultEditedPathsExist(['交付物-PM/a.md'], ['PM']),
    ).toBe(true);
    expect(
      defaultEditedPathsExist(['loose.md'], ['PM']),
    ).toBe(false);
  });

  it('deriveWorkflowExecutionPhase maps batch phases', () => {
    const collecting = task({
      workflowReviewBatch: {
        id: 'b',
        settleGeneration: 0,
        parallelGroup: SERIAL_REVIEW_GROUP,
        expectedNodeIds: ['n1'],
        phase: 'collecting',
        items: { n1: { nodeId: 'n1', state: 'awaiting_decision' } },
        createdAt: 1,
        updatedAt: 1,
      },
    });
    expect(deriveWorkflowExecutionPhase(collecting)).toBe('collecting');
    expect(
      deriveWorkflowExecutionPhase({
        ...collecting,
        workflowReviewBatch: {
          ...collecting.workflowReviewBatch!,
          phase: 'ready_to_settle',
        },
      }),
    ).toBe('awaiting_review');
    expect(
      deriveWorkflowExecutionPhase({
        ...collecting,
        workflowReviewBatch: {
          ...collecting.workflowReviewBatch!,
          phase: 'deferred',
        },
      }),
    ).toBe('deferred_review');
  });

  it('buildReviewHealGuard only guards completed review nodes', () => {
    const t = openReviewItemForCompletedNode({
      task: task(),
      node: node('n1', { userCheckpoint: true, parallelGroup: 'g' }),
      nodes: [
        node('n1', { userCheckpoint: true, parallelGroup: 'g' }),
        node('n2', { userCheckpoint: true, parallelGroup: 'g' }),
      ],
      isCheckpoint: (n) => Boolean(n.userCheckpoint),
    });
    const guard = buildReviewHealGuard(t);
    expect(guard).toBeDefined();
    expect(guard?.expectedNodeIds.has('n1')).toBe(true);
    expect(guard?.expectedNodeIds.has('n2')).toBe(false);
    expect(isReviewHealGuardedNode('n1', guard!)).toBe(true);
    expect(isReviewHealGuardedNode('n2', guard!)).toBe(false);
    expect(buildReviewHealGuard(task())).toBeUndefined();
  });

  it('captureReviewSnapshotOnRun stores deliverable path once', () => {
    const first = captureReviewSnapshotOnRun(
      run('n1', 'completed', { deliverablePath: '交付物-PM/a.md' }),
      ['PM'],
      100,
    );
    expect(first.reviewSnapshot?.paths).toEqual(['交付物-PM/a.md']);
    const second = captureReviewSnapshotOnRun(first, ['PM'], 200);
    expect(second.reviewSnapshot?.capturedAt).toBe(100);
  });

  it('nextRunnableNodesForExecution excludes held downstream', () => {
    const nodes = [node('n1', { userCheckpoint: true }), node('n2')];
    const edges: WorkflowEdge[] = [{ from: 'n1', to: 'n2', when: 'on_success' }];
    const runs = runsMap([run('n1', 'completed'), run('n2', 'pending')]);
    const hold = reviewHoldNodeIds(
      openReviewItemForCompletedNode({
        task: task(),
        node: nodes[0]!,
        nodes,
        isCheckpoint: (n) => Boolean(n.userCheckpoint),
      }),
    );
    expect(nextRunnableNodesForExecution(nodes, edges, runs, hold)).toHaveLength(0);
    expect(nextRunnableNodesForExecution(nodes, edges, runs, new Set())).toHaveLength(1);
  });

  it('onDeferredNodeCompletedReview reopens collecting with carried decisions', () => {
    const nodes = [
      node('nA', { userCheckpoint: true, parallelGroup: 'g' }),
      node('nB', { userCheckpoint: true, parallelGroup: 'g' }),
    ];
    const deferred = task({
      workflowReviewBatch: {
        id: 'b',
        settleGeneration: 2,
        parallelGroup: 'g',
        expectedNodeIds: ['nA', 'nB'],
        phase: 'deferred',
        carriedDecisions: { nA: { kind: 'approve' } },
        items: {
          nA: { nodeId: 'nA', state: 'submitted' },
          nB: { nodeId: 'nB', state: 'awaiting_decision' },
        },
        createdAt: 1,
        updatedAt: 1,
      },
    });
    const next = onDeferredNodeCompletedReview({
      task: deferred,
      node: nodes[1]!,
      nodes,
      isCheckpoint: (n) => Boolean(n.userCheckpoint),
    });
    expect(next.workflowReviewBatch?.phase).toBe('collecting');
    expect(next.workflowReviewBatch?.carriedDecisions?.nA).toEqual({ kind: 'approve' });
    expect(next.workflowReviewBatch?.items.nB?.state).toBe('awaiting_decision');
  });

  it('finalizeDeferredBatchIfReady clears batch when rework done', () => {
    const deferred = task({
      workflowReviewBatch: {
        id: 'b',
        settleGeneration: 2,
        parallelGroup: 'g',
        expectedNodeIds: ['nA', 'nB'],
        phase: 'collecting',
        carriedDecisions: { nA: { kind: 'approve' } },
        items: {
          nA: { nodeId: 'nA', state: 'submitted' },
          nB: { nodeId: 'nB', state: 'submitted' },
        },
        createdAt: 1,
        updatedAt: 1,
      },
    });
    const runs = runsMap([run('nA', 'completed'), run('nB', 'completed')]);
    const cleared = finalizeDeferredBatchIfReady({ task: deferred, runs });
    expect(cleared.workflowReviewBatch).toBeUndefined();
  });

  it('shouldWorkflowRunnerSleepForReview false during deferred rework', () => {
    const nodes = [node('nB', { userCheckpoint: true, parallelGroup: 'g' })];
    const edges: WorkflowEdge[] = [];
    const runs = runsMap([run('nB', 'pending')]);
    const deferred = task({
      workflowReviewBatch: {
        id: 'b',
        settleGeneration: 2,
        parallelGroup: 'g',
        expectedNodeIds: ['nB'],
        phase: 'deferred',
        items: { nB: { nodeId: 'nB', state: 'awaiting_execution' } },
        createdAt: 1,
        updatedAt: 1,
      },
    });
    expect(
      shouldWorkflowRunnerSleepForReview({ task: deferred, nodes, edges, runs }),
    ).toBe(false);
  });

  it('shouldWorkflowRunnerSleepForReview true when deferred batch is idle', () => {
    const nodes = [node('nB', { userCheckpoint: true, parallelGroup: 'g' })];
    const edges: WorkflowEdge[] = [];
    const runs = runsMap([run('nB', 'completed')]);
    const deferred = task({
      workflowReviewBatch: {
        id: 'b',
        settleGeneration: 2,
        parallelGroup: 'g',
        expectedNodeIds: ['nB'],
        phase: 'deferred',
        carriedDecisions: { nA: { kind: 'approve' } },
        items: {
          nB: { nodeId: 'nB', state: 'submitted', decision: { kind: 'rollback', targetNodeId: 'n0', comment: 'x' } },
        },
        createdAt: 1,
        updatedAt: 1,
      },
    });
    expect(
      shouldWorkflowRunnerSleepForReview({ task: deferred, nodes, edges, runs }),
    ).toBe(true);
  });

  it('settleReviewBatch is idempotent on settleGeneration mismatch', () => {
    const nodes = [
      node('n1', { userCheckpoint: true, parallelGroup: 'g' }),
      node('n2', { userCheckpoint: true, parallelGroup: 'g' }),
    ];
    const edges: WorkflowEdge[] = [];
    const runs = runsMap([run('n1', 'completed'), run('n2', 'completed')]);
    const batchTask = task({
      workflowReviewBatch: {
        id: 'b',
        settleGeneration: 3,
        parallelGroup: 'g',
        expectedNodeIds: ['n1', 'n2'],
        phase: 'ready_to_settle',
        items: {
          n1: { nodeId: 'n1', state: 'submitted', decision: { kind: 'approve' } },
          n2: { nodeId: 'n2', state: 'submitted', decision: { kind: 'approve' } },
        },
        createdAt: 1,
        updatedAt: 1,
      },
    });
    const first = settleReviewBatch({
      task: batchTask,
      nodes,
      edges,
      runs,
      expectedSettleGeneration: 3,
    });
    const second = settleReviewBatch({
      task: first.task,
      nodes,
      edges,
      runs: first.runs,
      expectedSettleGeneration: 3,
    });
    expect(second.needsContinue).toBe(false);
    expect(second.error).toBe('review_batch_missing');
  });

  it('submitReviewDecision rejects stale batchUpdatedAt', () => {
    const nodes = [node('n1', { userCheckpoint: true })];
    const edges: WorkflowEdge[] = [];
    const runs = runsMap([
      run('n1', 'completed', { reviewSnapshot: { paths: ['p'], roleNames: ['PM'], capturedAt: 1 } }),
    ]);
    const t = openReviewItemForCompletedNode({
      task: task(),
      node: nodes[0]!,
      nodes,
      isCheckpoint: (n) => Boolean(n.userCheckpoint),
    });
    const stale = submitReviewDecision({
      task: t,
      nodes,
      edges,
      nodeId: 'n1',
      decision: { kind: 'approve' },
      runs,
      expectedBatchUpdatedAt: (t.workflowReviewBatch?.updatedAt ?? 0) - 1,
    });
    expect(stale.error).toBe('review_batch_stale');
  });

  it('mergeReviewStateFromStored clears stale memory batch when stored settled', () => {
    const stored = task({
      updatedAt: 500,
      workflowReviewBatch: undefined,
      workflowUserIntervention: {
        activeNodeId: 'n1',
        request: '【人工审查意见】\n请修正',
        startedAt: 500,
        kind: 'redo',
      },
    });
    const memory = task({
      updatedAt: 100,
      workflowReviewBatch: {
        id: 'b',
        settleGeneration: 0,
        parallelGroup: 'serial:n1',
        expectedNodeIds: ['n1'],
        phase: 'collecting',
        items: { n1: { nodeId: 'n1', state: 'awaiting_decision' } },
        createdAt: 1,
        updatedAt: 100,
      },
    });
    const merged = mergeReviewStateFromStored(stored, memory, new Map());
    expect(merged.workflowReviewBatch).toBeUndefined();
    expect(merged.workflowUserIntervention?.activeNodeId).toBe('n1');
    expect(merged.workflowUserIntervention?.request).toContain('请修正');
  });

  it('coalesceReviewBatchForPersist honors stored cleared batch over stale memory', () => {
    const batch = {
      id: 'b',
      settleGeneration: 0,
      parallelGroup: 'serial:n1',
      expectedNodeIds: ['n1'],
      phase: 'collecting' as const,
      items: { n1: { nodeId: 'n1', state: 'awaiting_decision' as const } },
      createdAt: 1,
      updatedAt: 100,
    };
    expect(
      coalesceReviewBatchForPersist(
        { workflowReviewBatch: batch, updatedAt: 100 },
        { workflowReviewBatch: undefined, updatedAt: 500 },
      ),
    ).toBeUndefined();
  });

  it('mergeReviewStateFromStored does not restore completed deferred batch', () => {
    const runs = runsMap([run('nA', 'completed'), run('nB', 'completed')]);
    const stored = task({
      updatedAt: 500,
      workflowReviewBatch: {
        id: 'b',
        settleGeneration: 2,
        parallelGroup: 'g',
        expectedNodeIds: ['nA', 'nB'],
        phase: 'collecting',
        carriedDecisions: { nA: { kind: 'approve' } },
        items: {
          nA: { nodeId: 'nA', state: 'submitted' },
          nB: { nodeId: 'nB', state: 'submitted' },
        },
        createdAt: 1,
        updatedAt: 400,
      },
    });
    const memory = task({ updatedAt: 100 });
    const merged = mergeReviewStateFromStored(stored, memory, runs);
    expect(merged.workflowReviewBatch).toBeUndefined();
  });

  it('shouldApplyStoredReviewBatch prefers newer settleGeneration', () => {
    const stored = {
      updatedAt: 200,
      workflowReviewBatch: {
        id: 'b',
        settleGeneration: 2,
        parallelGroup: 'g',
        expectedNodeIds: ['n1'],
        phase: 'deferred' as const,
        items: { n1: { nodeId: 'n1', state: 'submitted' } },
        createdAt: 1,
        updatedAt: 200,
      },
    };
    const memory = {
      updatedAt: 150,
      workflowReviewBatch: {
        id: 'b',
        settleGeneration: 1,
        parallelGroup: 'g',
        expectedNodeIds: ['n1'],
        phase: 'ready_to_settle' as const,
        items: { n1: { nodeId: 'n1', state: 'submitted' } },
        createdAt: 1,
        updatedAt: 150,
      },
    };
    expect(shouldApplyStoredReviewBatch(stored, memory)).toBe(true);
  });
});
