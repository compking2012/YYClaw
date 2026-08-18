/**
 * P0 regression: DAG technical-failure terminal state + LangGraph/Session alignment,
 * and multi-role room-skip / long-summary truncation (false-success) fixes.
 */
import { describe, expect, it } from 'vitest';
import {
  compactOfficeDeliverableForRoomMirror,
  OFFICE_DELIVERABLE_SECTION_MAX_CHARS,
} from '@/lib/office-deliverable-file-policy';
import {
  isWorkflowRunFullyCompleted,
  resolveTaskStatusFromRuns,
} from '@/lib/office-task-status';
import {
  isWorkflowDeliverableConclusionFailure,
  langGraphNodeRunRoute,
  nodeRunHasFailureConclusion,
  nodeRunTriggersFailureEdge,
  readWorkflowDeliverableConclusionFromMirrorText,
} from '@/lib/office-workflow-edge-outcome';
import {
  applyWorkflowAutoRollbackForNode,
  resolveWorkflowAutoRollback,
} from '@/lib/office-workflow-failure-rollback';
import { nextRunnableNodes, nodeRunsForWorkflowContinue } from '@/lib/office-workflow-schedule';
import type { NodeRunRecord, WorkflowEdge, WorkflowNode } from '@/types/office';
import { describeLangGraph } from '../helpers/langgraph-flag';

const nodes: WorkflowNode[] = [
  { id: 'n-test', roleId: 'qa', title: '软件测试', execution: 'serial' },
  { id: 'n-next', roleId: 'pm', title: '发布', execution: 'serial' },
  { id: 'n-fix', roleId: 'dev', title: '返工开发', execution: 'serial' },
];

const edges: WorkflowEdge[] = [
  { from: 'n-test', to: 'n-next', when: 'on_success' },
  { from: 'n-test', to: 'n-fix', when: 'on_failure' },
];

function runMap(
  entries: Array<[string, Partial<NodeRunRecord> & Pick<NodeRunRecord, 'status'>]>,
): Map<string, NodeRunRecord> {
  return new Map(
    entries.map(([id, partial]) => [
      id,
      {
        nodeId: id,
        agentId: id,
        ...partial,
      },
    ]),
  );
}

describe('P0 — DAG technical failure terminal + Session/LangGraph alignment', () => {
  it('Session: technical failed is not workflow-complete and task status is failed', () => {
    const runs = runMap([
      ['n-test', { status: 'failed', error: 'LLM idle timeout' }],
      ['n-next', { status: 'pending' }],
      ['n-fix', { status: 'pending' }],
    ]);

    expect(isWorkflowRunFullyCompleted(runs, nodes)).toBe(false);
    expect(resolveTaskStatusFromRuns(runs, nodes)).toBe('failed');
    expect(
      nodes.every((n) => {
        const s = runs.get(n.id)?.status;
        return s === 'completed' || s === 'skipped';
      }),
    ).toBe(false);
  });

  it('Session: technical failed does not auto-rollback and does not open on_failure', () => {
    const runs = runMap([
      ['n-test', { status: 'failed', error: 'No API key' }],
      ['n-next', { status: 'pending' }],
      ['n-fix', { status: 'pending' }],
    ]);
    const testRun = runs.get('n-test')!;

    expect(nodeRunHasFailureConclusion(testRun)).toBe(false);
    expect(nodeRunTriggersFailureEdge(testRun)).toBe(false);
    expect(
      resolveWorkflowAutoRollback({
        nodeId: 'n-test',
        nodes,
        edges,
        run: testRun,
      }).shouldRollback,
    ).toBe(false);
    expect(
      applyWorkflowAutoRollbackForNode({ nodeId: 'n-test', nodes, edges, runs }),
    ).toBeNull();

    const runnable = nextRunnableNodes(nodes, edges, runs).map((n) => n.id);
    expect(runnable).not.toContain('n-fix');
    expect(runnable).not.toContain('n-next');
  });

  it('Session: stale edgeOutcome=failure on technical failed still must not open on_failure', () => {
    const runs = runMap([
      ['n-test', { status: 'failed', edgeOutcome: 'failure', error: 'timeout' }],
      ['n-next', { status: 'pending' }],
      ['n-fix', { status: 'pending' }],
    ]);
    expect(nodeRunTriggersFailureEdge(runs.get('n-test')!)).toBe(false);
    expect(nextRunnableNodes(nodes, edges, runs).map((n) => n.id)).toEqual([]);
  });

  it('Session: business completed+failure auto-rollbacks and schedules on_failure', () => {
    const runs = runMap([
      [
        'n-test',
        {
          status: 'completed',
          edgeOutcome: 'failure',
          summary: '路径：a.md\n结论：不通过',
        },
      ],
      ['n-next', { status: 'pending' }],
      ['n-fix', { status: 'pending' }],
    ]);
    const testRun = runs.get('n-test')!;

    expect(nodeRunHasFailureConclusion(testRun)).toBe(true);
    expect(
      resolveWorkflowAutoRollback({
        nodeId: 'n-test',
        nodes,
        edges,
        run: testRun,
      }),
    ).toMatchObject({
      shouldRollback: true,
      source: 'on_failure_edge',
      targetNodeIds: ['n-fix'],
    });

    expect(nextRunnableNodes(nodes, edges, runs).map((n) => n.id)).toContain('n-fix');

    const applied = applyWorkflowAutoRollbackForNode({
      nodeId: 'n-test',
      nodes,
      edges,
      runs,
    });
    expect(applied).not.toBeNull();
    expect(runs.get('n-test')?.status).toBe('pending');
    expect(runs.get('n-fix')?.status).toBe('pending');
    expect((runs.get('n-fix')?.reworkGeneration ?? 0) > 0).toBe(true);
  });

  it('Session continue: failed nodes can be reopened to pending', () => {
    const runs = [
      {
        nodeId: 'n-test',
        agentId: 'qa',
        status: 'failed' as const,
        error: 'timeout',
      },
      { nodeId: 'n-next', agentId: 'pm', status: 'pending' as const },
      { nodeId: 'n-fix', agentId: 'dev', status: 'pending' as const },
    ];
    const continued = nodeRunsForWorkflowContinue(runs, nodes);
    expect(continued.find((r) => r.nodeId === 'n-test')?.status).toBe('pending');
  });

  it('aligns Session schedule with LangGraph halt for technical failed', () => {
    const technical = {
      status: 'failed' as const,
      error: 'transport',
    };
    expect(langGraphNodeRunRoute(technical)).toBe('halt');
    expect(nodeRunTriggersFailureEdge(technical)).toBe(false);
    expect(nodeRunHasFailureConclusion(technical)).toBe(false);

    const business = {
      status: 'completed' as const,
      edgeOutcome: 'failure' as const,
    };
    expect(langGraphNodeRunRoute(business)).toBe('failure');
    expect(nodeRunTriggersFailureEdge(business)).toBe(true);
    expect(nodeRunHasFailureConclusion(business)).toBe(true);
  });
});

describeLangGraph('P0 — LangGraph routeAfterExecute vs Session schedule', () => {
  it('technical failed does not route to on_failure on either engine', async () => {
    const { routeAfterExecute } = await import(
      '../../electron/services/office/workflow-langgraph-native-routes'
    );
    const plan = {
      kind: 'langgraph_native' as const,
      version: 2 as const,
      checkpointer: 'langgraph_memory' as const,
      entry: 'exec-test',
      nodes: [
        { id: 'exec-test', kind: 'execute' as const, label: 'Test', officeNodeId: 'n-test' },
        { id: 'exec-fix', kind: 'execute' as const, label: 'Fix', officeNodeId: 'n-fix' },
        { id: 'exec-next', kind: 'execute' as const, label: 'Next', officeNodeId: 'n-next' },
      ],
      edges: [],
      conditionalRoutes: [
        {
          from: 'exec-test',
          branches: [
            { key: 'failure', when: 'failure' as const, targets: ['exec-fix'] },
            { key: 'success', when: 'success' as const, targets: ['exec-next'] },
          ],
        },
      ],
      subgraphs: [],
      visualLayers: [],
    };

    const lgRoute = routeAfterExecute(
      plan,
      'exec-test',
      { runs: [{ nodeId: 'n-test', status: 'failed' }] },
      'n-test',
      false,
    );
    expect(lgRoute).not.toBe('exec-fix');
    expect(lgRoute).not.toBe('exec-next');

    const sessionRuns = runMap([
      ['n-test', { status: 'failed' }],
      ['n-next', { status: 'pending' }],
      ['n-fix', { status: 'pending' }],
    ]);
    expect(nextRunnableNodes(nodes, edges, sessionRuns).map((n) => n.id)).toEqual([]);
  });
});

describe('多角色 room skip + 长摘要截断（假成功修复）', () => {
  it('compactOfficeDeliverableForRoomMirror preserves 结论 after long summary', () => {
    const longSummary = '测'.repeat(OFFICE_DELIVERABLE_SECTION_MAX_CHARS);
    const deliverable = [
      '路径：交付物-软件测试/功能性能测试-软件测试.md',
      `摘要：${longSummary}`,
      '结论：不通过',
      '目标：交付物-软件测试/功能性能测试-软件测试.md',
      'ls：ok',
    ].join('\n');

    const compact = compactOfficeDeliverableForRoomMirror({
      deliverable,
      maxChars: 500,
    });

    expect(readWorkflowDeliverableConclusionFromMirrorText(compact)).toBe('不通过');
    expect(compact).toContain('结论：不通过');
  });

  it('room-skip judgment keeps failure when long summary is compacted', () => {
    const longSummary = '测'.repeat(OFFICE_DELIVERABLE_SECTION_MAX_CHARS);
    const deliverable = [
      '路径：交付物-软件测试/报告-软件测试.md',
      `摘要：${longSummary}`,
      '结论：不通过',
    ].join('\n');
    const roomMirror = compactOfficeDeliverableForRoomMirror({ deliverable });
    const skipSummary = roomMirror.slice(0, 800);
    const mirrored = readWorkflowDeliverableConclusionFromMirrorText(skipSummary);
    expect(mirrored).toBe('不通过');
    expect(isWorkflowDeliverableConclusionFailure(mirrored)).toBe(true);
    expect(
      nodeRunHasFailureConclusion({ status: 'completed', summary: skipSummary }),
    ).toBe(true);
  });

  it('room-skip without structured 结论 must not be treated as success', () => {
    const skipSummary = '（本角色本步已交付，跳过重复执行）';
    expect(readWorkflowDeliverableConclusionFromMirrorText(skipSummary)).toBeUndefined();
    // Runner must re-execute rather than stamp edgeOutcome=success from this summary.
    expect(
      nodeRunHasFailureConclusion({ status: 'completed', summary: skipSummary }),
    ).toBe(false);
  });
});
