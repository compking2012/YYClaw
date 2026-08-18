import { describe, expect, it } from 'vitest';
import {
  buildWorkflowFreezeSnapshot,
  clearWorkflowFreezeForRerun,
  shouldPersistResolvedWorkflowToOwnedProject,
  withTerminalWorkflowFreeze,
  resolveEffectiveWorkflow,
} from '@/lib/office-spawned-workflow-ownership';
import type { OfficeFixedGroup, OfficeTempProject, WorkflowDefinition } from '@/types/office';

const groupWorkflow: WorkflowDefinition = {
  mode: 'dag',
  nodes: [
    { id: 'a', title: 'A', agentIds: ['pm'] },
    { id: 'b', title: 'B', agentIds: ['pm'] },
  ],
  edges: [{ from: 'a', to: 'b' }],
};

const group: OfficeFixedGroup = {
  id: 'g1',
  name: 'g',
  agentIds: ['pm'],
  coordinatorAgentId: 'pm',
  workflow: groupWorkflow,
  workflowDescription: '',
  workflowOrchestrationMode: 'rule',
  createdAt: 1,
  updatedAt: 10,
};

function baseProject(overrides: Partial<OfficeTempProject> = {}): OfficeTempProject {
  return {
    id: 'p1',
    title: 't',
    origin: 'fixed_group',
    parentGroupId: 'g1',
    inheritsGroupTemplate: true,
    workflow: { mode: 'dag', nodes: [], edges: [] },
    executionMode: 'workflow',
    status: 'running',
    lifecycle: 'active',
    agentIds: ['pm'],
    coordinatorAgentId: 'pm',
    featureDescription: 'f',
    description: '',
    nodeRuns: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('Step5 terminal freeze + runner persist gate', () => {
  it('withTerminalWorkflowFreeze does not snapshot for aborted/failed no-own', () => {
    expect(
      withTerminalWorkflowFreeze(baseProject({ status: 'aborted' }), group).workflowFreezeSnapshot,
    ).toBeUndefined();
    expect(
      withTerminalWorkflowFreeze(baseProject({ status: 'failed' }), group).workflowFreezeSnapshot,
    ).toBeUndefined();
  });

  it('withTerminalWorkflowFreeze snapshots group for completed no-own', () => {
    const frozen = withTerminalWorkflowFreeze(baseProject({ status: 'completed' }), group);
    expect(frozen.workflowFreezeSnapshot?.workflow.nodes).toHaveLength(2);
    expect(frozen.inheritsGroupTemplate).toBe(true);
    expect(frozen.workflow?.nodes).toEqual([]);
  });

  it('does not freeze owned projects', () => {
    const frozen = withTerminalWorkflowFreeze(
      baseProject({ status: 'completed', inheritsGroupTemplate: false, workflow: groupWorkflow }),
      group,
    );
    expect(frozen.workflowFreezeSnapshot).toBeUndefined();
  });

  it('clearWorkflowFreezeForRerun then resolveEffectiveWorkflow reads live group', () => {
    const frozen = withTerminalWorkflowFreeze(baseProject({ status: 'completed' }), group);
    const cleared = clearWorkflowFreezeForRerun({ ...frozen, status: 'pending' });
    const liveGroup = {
      ...group,
      workflow: {
        mode: 'dag' as const,
        nodes: [{ id: 'a', title: 'A', agentIds: ['pm'] }],
        edges: [],
      },
    };
    expect(resolveEffectiveWorkflow(cleared, liveGroup).nodes).toHaveLength(1);
  });

  it('shouldPersistResolvedWorkflowToOwnedProject blocks no-own writeback', () => {
    expect(shouldPersistResolvedWorkflowToOwnedProject(baseProject())).toBe(false);
    expect(
      shouldPersistResolvedWorkflowToOwnedProject(
        baseProject({ inheritsGroupTemplate: false }),
      ),
    ).toBe(true);
  });

  it('buildWorkflowFreezeSnapshot captures roster', () => {
    const snap = buildWorkflowFreezeSnapshot({ group });
    expect(snap.agentIds).toEqual(['pm']);
    expect(snap.frozenAt).toBeGreaterThan(0);
  });
});
