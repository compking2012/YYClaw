import { describe, expect, it } from 'vitest';
import {
  fixedGroupHasWorkflowOrchestration,
  spawnedProjectOrchestrationModeLocked,
} from '@/lib/office-fixed-group';
import { emptyWorkflowStepDraftRow } from '@/lib/office-workflow-step-drafts';
import type { OfficeFixedGroup } from '@/types/office';

const baseGroup = (): Pick<
  OfficeFixedGroup,
  'executionMode' | 'workflowDescription' | 'workflowStepDrafts' | 'workflow'
> => ({
  executionMode: 'workflow',
  workflowDescription: '',
  workflowStepDrafts: undefined,
  workflow: { mode: 'dag', nodes: [], edges: [] },
});

describe('fixedGroupHasWorkflowOrchestration', () => {
  it('is false for smart mode groups', () => {
    expect(
      fixedGroupHasWorkflowOrchestration({
        ...baseGroup(),
        executionMode: 'smart',
        workflowDescription: 'Has description',
      }),
    ).toBe(false);
  });

  it('is false for workflow mode without orchestration content', () => {
    expect(fixedGroupHasWorkflowOrchestration(baseGroup())).toBe(false);
  });

  it('is true when group has step drafts', () => {
    expect(
      fixedGroupHasWorkflowOrchestration({
        ...baseGroup(),
        workflowStepDrafts: [{ ...emptyWorkflowStepDraftRow(), task: 'Step', agentIds: ['a1'] }],
      }),
    ).toBe(true);
  });

  it('is true when group has workflow description', () => {
    expect(
      fixedGroupHasWorkflowOrchestration({
        ...baseGroup(),
        workflowDescription: 'Group flow',
      }),
    ).toBe(true);
  });

  it('is true when group has workflow nodes', () => {
    expect(
      fixedGroupHasWorkflowOrchestration({
        ...baseGroup(),
        workflow: {
          mode: 'dag',
          nodes: [{ id: 'n1', title: 'Task', agentIds: ['a1'] }],
          edges: [],
        },
      }),
    ).toBe(true);
  });
});

describe('spawnedProjectOrchestrationModeLocked', () => {
  it('is false when group is null', () => {
    expect(spawnedProjectOrchestrationModeLocked(null)).toBe(false);
  });

  it('mirrors fixedGroupHasWorkflowOrchestration', () => {
    const group = {
      ...baseGroup(),
      workflowDescription: 'Flow',
    };
    expect(spawnedProjectOrchestrationModeLocked(group)).toBe(true);
    expect(spawnedProjectOrchestrationModeLocked({ ...baseGroup() })).toBe(false);
  });
});
