import { describe, expect, it } from 'vitest';
import { resolveDagWorkflowForSave } from '@/lib/office-workflow-preview';
import { shouldReuseGroupWorkflowOnSave } from '@/lib/office-workflow-preview-state';
import { shouldInheritGroupWorkflowOnSpawn } from '@/lib/office-task-workflow';
import {
  spawnedWorkflowDirtyVsGroup,
  noOwnWorkflowPersistFields,
} from '@/lib/office-spawned-workflow-ownership';
import type { OfficeFixedGroup, WorkflowDefinition } from '@/types/office';

const groupWorkflow: WorkflowDefinition = {
  mode: 'dag',
  nodes: [
    { id: 'gen-0', title: '计划', agentIds: ['pm'] },
    { id: 'gen-1', title: '总结', agentIds: ['pm'] },
  ],
  edges: [{ from: 'gen-0', to: 'gen-1' }],
};

const groupDrafts = [
  { input: '', agentIds: ['pm'], task: '计划', output: '', linkMode: 'serial' as const },
  { input: '', agentIds: ['pm'], task: '总结', output: '', linkMode: 'serial' as const },
];

const group: OfficeFixedGroup = {
  id: 'g1',
  name: '软件开发小组',
  agentIds: ['pm'],
  coordinatorAgentId: 'pm',
  workflow: groupWorkflow,
  workflowDescription: '',
  workflowStepDrafts: groupDrafts,
  workflowOrchestrationMode: 'rule',
  createdAt: 1,
  updatedAt: 1,
};

describe('Step2 spawn create inherit', () => {
  it('shouldReuseGroupWorkflowOnSave true when prefilled drafts match group', () => {
    expect(
      shouldReuseGroupWorkflowOnSave({
        spawnFromGroup: true,
        orchestration: {
          orchestrationMode: 'rule',
          workflowStepDrafts: groupDrafts,
          heuristicDescription: '',
        },
        group,
        agentIds: ['pm'],
        coordinatorAgentId: 'pm',
        workflow: { mode: 'dag', nodes: [], edges: [] },
      }),
    ).toBe(true);
  });

  it('resolveDagWorkflowForSave returns empty DAG for untouched spawn (no materialize)', async () => {
    const resolved = await resolveDagWorkflowForSave({
      executionMode: 'workflow',
      spawnFromGroup: true,
      groupWorkflow,
      group,
      orchestration: {
        orchestrationMode: 'rule',
        workflowStepDrafts: groupDrafts,
        heuristicDescription: '',
      },
      orchestrationBaseline: {
        orchestrationMode: 'rule',
        workflowStepDrafts: groupDrafts,
        heuristicDescription: '',
      },
      previewSyncedKey: null,
      workflow: { mode: 'dag', nodes: [], edges: [] },
      members: [{ agentId: 'pm', displayName: 'PM' }],
      agentIds: ['pm'],
      coordinatorAgentId: 'pm',
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.workflow.nodes).toEqual([]);
  });

  it('resolveDagWorkflowForSave still returns empty when form already has equal group DAG', async () => {
    const resolved = await resolveDagWorkflowForSave({
      executionMode: 'workflow',
      spawnFromGroup: true,
      groupWorkflow,
      group,
      orchestration: {
        orchestrationMode: 'rule',
        workflowStepDrafts: groupDrafts,
        heuristicDescription: '',
      },
      orchestrationBaseline: {
        orchestrationMode: 'rule',
        workflowStepDrafts: groupDrafts,
        heuristicDescription: '',
      },
      previewSyncedKey: null,
      workflow: structuredClone(groupWorkflow),
      members: [{ agentId: 'pm', displayName: 'PM' }],
      agentIds: ['pm'],
      coordinatorAgentId: 'pm',
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.workflow.nodes).toEqual([]);
  });

  it('chess-regression: equal materialize + matching drafts ⇒ inherit / not dirty', () => {
    expect(
      spawnedWorkflowDirtyVsGroup(group, {
        executionMode: 'workflow',
        workflow: structuredClone(groupWorkflow),
        description: '',
        workflowStepDrafts: groupDrafts,
        workflowOrchestrationMode: 'rule',
        agentIds: ['pm'],
        coordinatorAgentId: 'pm',
      }),
    ).toBe(false);
    expect(
      shouldInheritGroupWorkflowOnSpawn(
        {
          executionMode: 'workflow',
          workflowEngine: 'dag',
          workflow: structuredClone(groupWorkflow),
          description: '',
          workflowStepDrafts: groupDrafts,
          workflowOrchestrationMode: 'rule',
          agentIds: ['pm'],
          coordinatorAgentId: 'pm',
        },
        group,
      ),
    ).toBe(true);
    const persisted = noOwnWorkflowPersistFields();
    expect(persisted.inheritsGroupTemplate).toBe(true);
    expect(persisted.workflow?.nodes.length).toBe(0);
  });

  it('custom draft on spawn is dirty and not reused', () => {
    expect(
      shouldReuseGroupWorkflowOnSave({
        spawnFromGroup: true,
        orchestration: {
          orchestrationMode: 'rule',
          workflowStepDrafts: [
            { input: '', agentIds: ['pm'], task: '自定义', output: '', linkMode: 'serial' },
          ],
          heuristicDescription: '',
        },
        group,
        agentIds: ['pm'],
        coordinatorAgentId: 'pm',
      }),
    ).toBe(false);
  });
});
