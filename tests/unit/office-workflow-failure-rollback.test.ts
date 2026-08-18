import { describe, expect, it } from 'vitest';
import { generateWorkflowFromDescriptionHeuristic } from '@/lib/office-workflow-generate';
import {
  applyWorkflowAutoRollbackForNode,
  forwardDirectPredecessorNodeIds,
  nodeRunHasFailureConclusion,
  resolveWorkflowAutoRollback,
  tryResolveWorkflowFailureDeadlock,
  recoverStaleCompletedFailureRollbacks,
} from '@/lib/office-workflow-failure-rollback';
import { nextRunnableNodes, workflowEdgeList } from '@/lib/office-workflow-schedule';
import type { NodeRunRecord, OfficeRole, WorkflowDefinition } from '@/types/office';

const roles: Pick<OfficeRole, 'id' | 'name' | 'agentId'>[] = [
  { id: 'r-pm', name: 'PM', agentId: 'a-pm' },
  { id: 'r-pd', name: '产品经理', agentId: 'a-pd' },
  { id: 'r-dev', name: '软件开发', agentId: 'a-dev' },
  { id: 'r-test', name: '软件测试', agentId: 'a-test' },
  { id: 'r-audit', name: '安全审计', agentId: 'a-audit' },
];

const gomokuDesc = [
  '1.PM完成项目启动kickoff，输出项目计划书',
  '2.产品经理编写需求设计，输出需求初稿',
  '3.软件开发+软件测试+安全审计 对需求初稿进行评审，输出评审意见',
  '4.产品经理根据需求评审意见修订需求设计稿，输出需求终稿',
  '5.软件开发根据需求终稿进行需求实现，输出源码',
  '6.软件测试根据需求终稿进行测试用例编写，输出测试用例，与5并行',
  '7.软件测试根据测试用例对源码进行功能和性能测试，输出验收结果',
  '8.安全审计对源码进行安全审计，输出审计意见，如果不通过则返回5重新开发',
  '9.PM做项目总结',
].join('\n');

describe('office-workflow-failure-rollback', () => {
  it('nodeRunHasFailureConclusion uses edgeOutcome or mirrored 结论 field only', () => {
    expect(
      nodeRunHasFailureConclusion({
        nodeId: 'n1',
        agentId: 'a1',
        status: 'completed',
        edgeOutcome: 'failure',
      }),
    ).toBe(true);
    expect(
      nodeRunHasFailureConclusion({
        nodeId: 'n1',
        agentId: 'a1',
        status: 'completed',
        summary: '路径：a.md\n结论：不通过',
      }),
    ).toBe(true);
    expect(
      nodeRunHasFailureConclusion({
        nodeId: 'n1',
        agentId: 'a1',
        status: 'completed',
        summary: '摘要：0失败，建议验收通过\n结论：通过',
      }),
    ).toBe(false);
    expect(
      nodeRunHasFailureConclusion({
        nodeId: 'n1',
        agentId: 'a1',
        status: 'completed',
        edgeOutcome: 'success',
        summary: '结论：通过',
      }),
    ).toBe(false);
    expect(
      nodeRunHasFailureConclusion({
        nodeId: 'n1',
        agentId: 'a1',
        status: 'failed',
        edgeOutcome: 'failure',
        error: 'No API key',
      }),
    ).toBe(false);
  });

  it('resolveWorkflowAutoRollback prefers on_failure edge over direct predecessor', () => {
    const gen = generateWorkflowFromDescriptionHeuristic(gomokuDesc, roles);
    const wf = gen!.workflow;
    const run: NodeRunRecord = {
      nodeId: 'gen-7',
      agentId: 'a-audit',
      status: 'completed',
      edgeOutcome: 'failure',
      summary: '结论：不通过',
    };
    const decision = resolveWorkflowAutoRollback({
      nodeId: 'gen-7',
      nodes: wf.nodes,
      edges: wf.edges,
      run,
    });
    expect(decision.shouldRollback).toBe(true);
    expect(decision.source).toBe('on_failure_edge');
    expect(decision.targetNodeIds).toEqual(['gen-4']);
  });

  it('resolveWorkflowAutoRollback falls back to parallel direct predecessors', () => {
    const gen = generateWorkflowFromDescriptionHeuristic(gomokuDesc, roles);
    const wf = gen!.workflow;
    const edgeList = workflowEdgeList(wf.nodes, wf.edges);
    expect(forwardDirectPredecessorNodeIds('gen-6', edgeList).sort()).toEqual(['gen-4', 'gen-5']);

    const decision = resolveWorkflowAutoRollback({
      nodeId: 'gen-6',
      nodes: wf.nodes,
      edges: wf.edges,
      run: {
        nodeId: 'gen-6',
        agentId: 'a-test',
        status: 'completed',
        edgeOutcome: 'failure',
        summary: '结论：不通过',
      },
    });
    expect(decision.shouldRollback).toBe(true);
    expect(decision.source).toBe('direct_predecessor');
    expect(decision.targetNodeIds.sort()).toEqual(['gen-4', 'gen-5']);
  });

  it('apply auto rollback unblocks gomoku step 7 failure via predecessor layer', () => {
    const gen = generateWorkflowFromDescriptionHeuristic(gomokuDesc, roles);
    const wf = gen!.workflow;
    const runs = new Map<string, NodeRunRecord>();
    for (const n of wf.nodes) {
      const idx = Number.parseInt(n.id.replace('gen-', ''), 10);
      runs.set(n.id, {
        nodeId: n.id,
        agentId: n.agentId ?? 'a',
        status: idx <= 5 ? 'completed' : idx === 6 ? 'completed' : 'pending',
        edgeOutcome: idx <= 5 ? 'success' : idx === 6 ? 'failure' : undefined,
        summary: idx === 6 ? '结论：不通过' : undefined,
      });
    }

    expect(nextRunnableNodes(wf.nodes, wf.edges, runs)).toEqual([]);
    expect(
      applyWorkflowAutoRollbackForNode({
        nodeId: 'gen-6',
        nodes: wf.nodes,
        edges: wf.edges,
        runs,
      })?.nodeId,
    ).toBe('gen-6');
    expect(runs.get('gen-4')?.status).toBe('pending');
    expect(runs.get('gen-5')?.status).toBe('pending');
    expect(runs.get('gen-6')?.status).toBe('pending');
    expect(runs.get('gen-6')?.reworkGeneration).toBe(1);
    expect(runs.get('gen-7')?.status).toBe('pending');
    expect(runs.get('gen-7')?.reworkGeneration).toBe(1);
    expect(nextRunnableNodes(wf.nodes, wf.edges, runs).map((n) => n.id).sort()).toEqual([
      'gen-4',
      'gen-5',
    ]);
  });

  it('after rollback upstream rework, gen-6 cannot skip stale room deliverable to unblock gen-7', () => {
    const gen = generateWorkflowFromDescriptionHeuristic(gomokuDesc, roles);
    const wf = gen!.workflow;
    const runs = new Map<string, NodeRunRecord>();
    for (const n of wf.nodes) {
      const idx = Number.parseInt(n.id.replace('gen-', ''), 10);
      runs.set(n.id, {
        nodeId: n.id,
        agentId: n.agentId ?? 'a',
        status: idx <= 5 ? 'completed' : 'pending',
        edgeOutcome: idx <= 5 ? 'success' : undefined,
      });
    }
    runs.set('gen-6', {
      nodeId: 'gen-6',
      agentId: 'a-test',
      status: 'completed',
      edgeOutcome: 'failure',
      summary: '路径：交付物-软件测试/功能性能测试-软件测试.md\n结论：不通过',
    });

    applyWorkflowAutoRollbackForNode({
      nodeId: 'gen-6',
      nodes: wf.nodes,
      edges: wf.edges,
      runs,
    });

    for (const predId of ['gen-4', 'gen-5'] as const) {
      runs.set(predId, {
        ...runs.get(predId)!,
        status: 'completed',
        edgeOutcome: 'success',
      });
    }

    expect(runs.get('gen-6')?.reworkGeneration).toBe(1);
    expect(nextRunnableNodes(wf.nodes, wf.edges, runs).map((n) => n.id)).toEqual(['gen-6']);
    expect(nextRunnableNodes(wf.nodes, wf.edges, runs).map((n) => n.id)).not.toContain('gen-7');
  });

  it('tryResolveWorkflowFailureDeadlock recovers blocked audit failure', () => {
    const gen = generateWorkflowFromDescriptionHeuristic(gomokuDesc, roles);
    const wf = gen!.workflow;
    const runs = new Map<string, NodeRunRecord>();
    for (const n of wf.nodes) {
      const idx = Number.parseInt(n.id.replace('gen-', ''), 10);
      runs.set(n.id, {
        nodeId: n.id,
        agentId: n.agentId ?? 'a',
        status: idx <= 6 ? 'completed' : idx === 7 ? 'completed' : 'pending',
        edgeOutcome: idx <= 6 ? 'success' : idx === 7 ? 'failure' : undefined,
      });
    }
    expect(tryResolveWorkflowFailureDeadlock({ runs, nodes: wf.nodes, edges: wf.edges })?.nodeId).toBe(
      'gen-7',
    );
    expect(runs.get('gen-4')?.status).toBe('pending');
    expect(nextRunnableNodes(wf.nodes, wf.edges, runs).map((n) => n.id)).toEqual(['gen-4']);
  });

  it('tryResolve rolls back when some pending peers are already runnable', () => {
    const gen = generateWorkflowFromDescriptionHeuristic(gomokuDesc, roles);
    const wf = gen!.workflow;
    const runs = new Map<string, NodeRunRecord>();
    for (const n of wf.nodes) {
      const idx = Number.parseInt(n.id.replace('gen-', ''), 10);
      runs.set(n.id, {
        nodeId: n.id,
        agentId: n.agentId ?? 'a',
        status:
          idx <= 5
            ? idx === 4
              ? 'pending'
              : 'completed'
            : idx === 6
              ? 'completed'
              : 'pending',
        edgeOutcome:
          idx <= 3 || idx === 5
            ? 'success'
            : idx === 6
              ? 'failure'
              : undefined,
        reworkGeneration: idx === 4 ? 1 : undefined,
      });
    }

    expect(nextRunnableNodes(wf.nodes, wf.edges, runs).map((n) => n.id)).toContain('gen-4');
    expect(
      tryResolveWorkflowFailureDeadlock({ runs, nodes: wf.nodes, edges: wf.edges })?.nodeId,
    ).toBe('gen-6');
    expect(runs.get('gen-6')?.status).toBe('pending');
    expect(runs.get('gen-4')?.status).toBe('pending');
  });

  it('recoverStaleCompletedFailureRollbacks handles continue startup residue', () => {
    const gen = generateWorkflowFromDescriptionHeuristic(gomokuDesc, roles);
    const wf = gen!.workflow;
    const runs = new Map<string, NodeRunRecord>();
    for (const n of wf.nodes) {
      const idx = Number.parseInt(n.id.replace('gen-', ''), 10);
      runs.set(n.id, {
        nodeId: n.id,
        agentId: n.agentId ?? 'a',
        status: idx <= 5 ? 'completed' : idx === 6 ? 'completed' : 'pending',
        edgeOutcome: idx <= 5 ? 'success' : idx === 6 ? 'failure' : undefined,
      });
    }
    const recovered = recoverStaleCompletedFailureRollbacks({
      runs,
      nodes: wf.nodes,
      edges: wf.edges,
    });
    expect(recovered.map((r) => r.nodeId)).toEqual(['gen-6']);
    expect(runs.get('gen-4')?.status).toBe('pending');
    expect(runs.get('gen-5')?.status).toBe('pending');
  });

  it('does not auto rollback on technical failed status', () => {
    const gen = generateWorkflowFromDescriptionHeuristic(gomokuDesc, roles);
    const wf = gen!.workflow;
    const runs = new Map<string, NodeRunRecord>();
    for (const n of wf.nodes) {
      const idx = Number.parseInt(n.id.replace('gen-', ''), 10);
      runs.set(n.id, {
        nodeId: n.id,
        agentId: n.agentId ?? 'a',
        status: idx <= 5 ? 'completed' : idx === 6 ? 'failed' : 'pending',
        edgeOutcome: idx === 6 ? 'failure' : idx <= 5 ? 'success' : undefined,
        error: idx === 6 ? 'Unknown model: foo' : undefined,
      });
    }
    expect(
      applyWorkflowAutoRollbackForNode({
        nodeId: 'gen-6',
        nodes: wf.nodes,
        edges: wf.edges,
        runs,
      }),
    ).toBeNull();
    expect(runs.get('gen-4')?.status).toBe('completed');
    expect(runs.get('gen-6')?.status).toBe('failed');
  });

  it('rollback cycle uses on_failure edge to reopen dev', () => {
    const workflow: WorkflowDefinition = {
      mode: 'dag',
      nodes: [
        { id: 'n0', roleId: 'r-pm', title: '项目总结', execution: 'serial' },
        { id: 'n1', roleId: 'r-dev', title: '开发实现', execution: 'serial' },
        { id: 'n2', roleId: 'r-test', title: '测试验收', execution: 'serial' },
      ],
      edges: [
        { from: 'n2', to: 'n0', when: 'on_success' },
        { from: 'n1', to: 'n2', when: 'on_success' },
        { from: 'n2', to: 'n1', when: 'on_failure' },
      ],
      edgesCustomized: true,
    };
    const runs = new Map<string, NodeRunRecord>([
      ['n0', { nodeId: 'n0', agentId: 'a-pm', status: 'pending' }],
      ['n1', { nodeId: 'n1', agentId: 'a-dev', status: 'pending' }],
      [
        'n2',
        {
          nodeId: 'n2',
          agentId: 'a-test',
          status: 'completed',
          edgeOutcome: 'failure',
          summary: '结论：不通过',
        },
      ],
    ]);

    expect(
      applyWorkflowAutoRollbackForNode({
        nodeId: 'n2',
        nodes: workflow.nodes,
        edges: workflow.edges,
        runs,
      })?.nodeId,
    ).toBe('n2');
    expect(runs.get('n1')?.status).toBe('pending');
    expect(runs.get('n2')?.status).toBe('pending');
    expect(nextRunnableNodes(workflow.nodes, workflow.edges, runs).map((n) => n.id)).toEqual([
      'n1',
    ]);
  });
});
