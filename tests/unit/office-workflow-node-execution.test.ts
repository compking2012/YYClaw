import { describe, expect, it } from 'vitest';
import {
  resolveWorkflowForExecution,
  workflowNodePrimaryRoleId,
  workflowNodeRoleIds,
  type ProjectAgentRef,
} from '@/lib/office-workflow-node';
import type { WorkflowDefinition } from '@/types/office';

const teamMembers: ProjectAgentRef[] = [
  { agentId: 'pm', displayName: 'PM' },
  { agentId: 'chan-pin', displayName: '产品' },
  { agentId: 'ce-shi', displayName: '测试' },
];

const namedWorkflow: WorkflowDefinition = {
  mode: 'dag',
  nodes: [
    { id: 'lg-1', agentId: '', role: '产品', title: '需求', execution: 'serial' } as WorkflowDefinition['nodes'][number] & { role: string },
    {
      id: 'lg-2',
      agentId: '',
      role: 'PM',
      roles: ['PM', '测试'],
      title: '评审',
      execution: 'serial',
    } as WorkflowDefinition['nodes'][number] & { role: string; roles: string[] },
  ],
  edges: [],
};

describe('resolveWorkflowForExecution', () => {
  it('resolves role names to agent ids in-memory without mutating source', () => {
    const resolved = resolveWorkflowForExecution(namedWorkflow, teamMembers);
    expect((namedWorkflow.nodes[0] as { role?: string })?.role).toBe('产品');
    expect(resolved.nodes[0]?.agentId).toBe('chan-pin');
    expect(workflowNodeRoleIds(resolved.nodes[0]!)).toEqual(['chan-pin']);
    expect(workflowNodePrimaryRoleId(resolved.nodes[1]!)).toBe('pm');
    expect(resolved.nodes[1]?.agentIds).toEqual(['pm', 'ce-shi']);
  });
});
