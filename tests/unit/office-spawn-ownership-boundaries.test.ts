import { describe, expect, it } from 'vitest';
import {
  convertGroupChildProjectToStandalone,
  workflowForProject,
} from '@/lib/office-task-workflow';
import {
  spawnedWorkflowDirtyVsGroup,
  buildWorkflowFreezeSnapshot,
} from '@/lib/office-spawned-workflow-ownership';
import type { OfficeFixedGroup, OfficeTempProject, WorkflowDefinition } from '@/types/office';

const groupWorkflow: WorkflowDefinition = {
  mode: 'dag',
  nodes: [{ id: 'n1', title: '组步骤', agentIds: ['a1'] }],
  edges: [],
};

const group: OfficeFixedGroup = {
  id: 'g1',
  name: '研发',
  agentIds: ['a1', 'a2'],
  coordinatorAgentId: 'a1',
  workflow: groupWorkflow,
  workflowDescription: 'desc',
  workflowOrchestrationMode: 'heuristic',
  createdAt: 1,
  updatedAt: 1,
};

describe('Step6 boundaries + LangGraph dirty', () => {
  it('convertGroupChildProjectToStandalone materializes live group for no-own', () => {
    const project: OfficeTempProject = {
      id: 'p1',
      title: '派出',
      origin: 'fixed_group',
      parentGroupId: 'g1',
      inheritsGroupTemplate: true,
      workflow: { mode: 'dag', nodes: [], edges: [] },
      executionMode: 'workflow',
      status: 'pending',
      lifecycle: 'active',
      agentIds: ['a1'],
      coordinatorAgentId: 'a1',
      featureDescription: 'f',
      description: '',
      nodeRuns: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const standalone = convertGroupChildProjectToStandalone(project, group);
    expect(standalone.origin).toBe('standalone');
    expect(standalone.parentGroupId).toBeUndefined();
    expect(standalone.inheritsGroupTemplate).toBe(false);
    expect(standalone.workflow?.nodes[0]?.title).toBe('组步骤');
    expect(standalone.workflowFreezeSnapshot).toBeUndefined();
  });

  it('convertGroupChildProjectToStandalone uses freeze snapshot when completed', () => {
    const freeze = buildWorkflowFreezeSnapshot({
      group: {
        ...group,
        workflow: {
          mode: 'dag',
          nodes: [{ id: 'old', title: '冻结步', agentIds: ['a1'] }],
          edges: [],
        },
      },
    });
    const project: OfficeTempProject = {
      id: 'p1',
      title: '派出',
      origin: 'fixed_group',
      parentGroupId: 'g1',
      inheritsGroupTemplate: true,
      workflow: { mode: 'dag', nodes: [], edges: [] },
      executionMode: 'workflow',
      status: 'completed',
      lifecycle: 'active',
      agentIds: ['a1'],
      coordinatorAgentId: 'a1',
      featureDescription: 'f',
      description: '',
      nodeRuns: [],
      workflowFreezeSnapshot: freeze,
      createdAt: 1,
      updatedAt: 1,
    };
    const standalone = convertGroupChildProjectToStandalone(project, group);
    expect(standalone.workflow?.nodes[0]?.title).toBe('冻结步');
  });

  it('convertGroupChildProjectToStandalone ignores leftover freeze for aborted/failed', () => {
    const freeze = buildWorkflowFreezeSnapshot({
      group: {
        ...group,
        workflow: {
          mode: 'dag',
          nodes: [{ id: 'old', title: '冻结步', agentIds: ['a1'] }],
          edges: [],
        },
      },
    });
    for (const status of ['aborted', 'failed'] as const) {
      const project: OfficeTempProject = {
        id: 'p1',
        title: '派出',
        origin: 'fixed_group',
        parentGroupId: 'g1',
        inheritsGroupTemplate: true,
        workflow: { mode: 'dag', nodes: [], edges: [] },
        executionMode: 'workflow',
        status,
        lifecycle: 'active',
        agentIds: ['a1'],
        coordinatorAgentId: 'a1',
        featureDescription: 'f',
        description: '',
        nodeRuns: [],
        workflowFreezeSnapshot: freeze,
        createdAt: 1,
        updatedAt: 1,
      };
      const standalone = convertGroupChildProjectToStandalone(project, group);
      expect(standalone.workflow?.nodes[0]?.title).toBe('组步骤');
    }
  });

  it('LangGraph bundle equal to group is not dirty; divergent branch is', () => {
    expect(
      spawnedWorkflowDirtyVsGroup(group, {
        executionMode: 'workflow',
        workflowEngine: 'langgraph',
        workflow: { mode: 'dag', nodes: [], edges: [] },
        description: 'desc',
        workflowOrchestrationMode: 'heuristic',
        agentIds: ['a1', 'a2'],
        coordinatorAgentId: 'a1',
        langGraphWorkflowBundle: {
          activeSource: 'heuristic',
          heuristic: { workflow: groupWorkflow },
        },
      }),
    ).toBe(false);
    expect(
      spawnedWorkflowDirtyVsGroup(group, {
        executionMode: 'workflow',
        workflowEngine: 'langgraph',
        workflow: { mode: 'dag', nodes: [], edges: [] },
        description: 'desc',
        workflowOrchestrationMode: 'heuristic',
        agentIds: ['a1', 'a2'],
        coordinatorAgentId: 'a1',
        langGraphWorkflowBundle: {
          activeSource: 'custom',
          custom: {
            workflow: {
              mode: 'dag',
              nodes: [{ id: 'n1', title: '改过', agentIds: ['a1'] }],
              edges: [],
            },
          },
        },
      }),
    ).toBe(true);
  });

  it('smart mode is not dirty for workflow ownership compare', () => {
    expect(
      spawnedWorkflowDirtyVsGroup(group, {
        executionMode: 'smart',
        workflow: { mode: 'dag', nodes: [], edges: [] },
        description: '',
      }),
    ).toBe(false);
  });

  it('owned project workflowForProject ignores group', () => {
    const own: WorkflowDefinition = {
      mode: 'dag',
      nodes: [{ id: 'x', title: '自有', agentIds: ['a1'] }],
      edges: [],
    };
    expect(
      workflowForProject(
        {
          origin: 'fixed_group',
          parentGroupId: 'g1',
          inheritsGroupTemplate: false,
          workflow: own,
          executionMode: 'workflow',
          status: 'pending',
        },
        group,
      ).nodes[0]?.title,
    ).toBe('自有');
  });
});
