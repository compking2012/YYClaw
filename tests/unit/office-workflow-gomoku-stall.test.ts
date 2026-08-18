import { describe, expect, it } from 'vitest';
import { generateWorkflowFromDescriptionHeuristic } from '@/lib/office-workflow-generate';
import { nextRunnableNodes } from '@/lib/office-workflow-schedule';
import { tryResolveWorkflowFailureDeadlock } from '@/lib/office-workflow-failure-rollback';
import type { NodeRunRecord, OfficeRole } from '@/types/office';

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

describe('gomoku stall sim', () => {
  it('step 7 failure rolls back to parallel predecessor layer', () => {
    const gen = generateWorkflowFromDescriptionHeuristic(gomokuDesc, roles);
    expect(gen).not.toBeNull();
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

    expect(nextRunnableNodes(wf.nodes, wf.edges, runs)).toEqual([]);
    expect(
      tryResolveWorkflowFailureDeadlock({ runs, nodes: wf.nodes, edges: wf.edges })?.nodeId,
    ).toBe('gen-6');
    expect(runs.get('gen-4')?.status).toBe('pending');
    expect(runs.get('gen-5')?.status).toBe('pending');
    expect(runs.get('gen-6')?.status).toBe('pending');
    expect(nextRunnableNodes(wf.nodes, wf.edges, runs).map((n) => n.id).sort()).toEqual([
      'gen-4',
      'gen-5',
    ]);
  });

  it('runs gen-7 when step 7 completes with success', () => {
    const gen = generateWorkflowFromDescriptionHeuristic(gomokuDesc, roles);
    const wf = gen!.workflow;
    const runs = new Map<string, NodeRunRecord>();
    for (const n of wf.nodes) {
      const idx = Number.parseInt(n.id.replace('gen-', ''), 10);
      runs.set(n.id, {
        nodeId: n.id,
        agentId: n.agentId ?? 'a',
        status: idx <= 6 ? 'completed' : 'pending',
        edgeOutcome: idx <= 6 ? 'success' : undefined,
      });
    }
    expect(nextRunnableNodes(wf.nodes, wf.edges, runs).map((n) => n.id)).toEqual(['gen-7']);
  });
});
