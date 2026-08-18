/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { diagnoseWorkflowStall } from '../../electron/services/office/workflow-graph';
import type { NodeRunRecord, OfficeTempProject, WorkflowEdge, WorkflowNode } from '@/types/office';

function node(id: string): WorkflowNode {
  return { id, agentId: 'a1', execution: 'serial' };
}

function run(nodeId: string, status: NodeRunRecord['status']): NodeRunRecord {
  return { nodeId, agentId: 'a1', status };
}

describe('diagnoseWorkflowStall', () => {
  it('returns null when user review batch is collecting', () => {
    const nodes = [node('n1'), node('n2')];
    const edges: WorkflowEdge[] = [{ from: 'n1', to: 'n2', when: 'on_success' }];
    const runs = new Map([
      ['n1', run('n1', 'completed')],
      ['n2', run('n2', 'pending')],
    ]);
    const task: Pick<OfficeTempProject, 'workflowReviewBatch'> = {
      workflowReviewBatch: {
        id: 'b',
        settleGeneration: 0,
        parallelGroup: '__serial__',
        expectedNodeIds: ['n1'],
        phase: 'collecting',
        items: { n1: { nodeId: 'n1', state: 'awaiting_decision' } },
        createdAt: 1,
        updatedAt: 1,
      },
    };
    expect(diagnoseWorkflowStall(nodes, edges, runs, task)).toBeNull();
  });

  it('returns stall message when not in review', () => {
    const nodes = [node('n1'), node('n2')];
    const edges: WorkflowEdge[] = [{ from: 'n1', to: 'n2', when: 'on_success' }];
    const runs = new Map([
      ['n1', run('n1', 'completed')],
      ['n2', run('n2', 'pending')],
    ]);
    expect(diagnoseWorkflowStall(nodes, edges, runs)).toMatch(/stalled|blocked/i);
  });
});
