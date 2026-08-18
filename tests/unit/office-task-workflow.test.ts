import { describe, expect, it } from 'vitest';
import {
  childInheritsGroupTemplate,
  convertGroupChildProjectToStandalone,
  detachGroupChildProjectToStandalone,
  displayAgentsForProject,
  fixedGroupContextForProjectRecord,
  groupChildWorkflowFieldsAfterGroupUpdate,
  materializeWorkflowForProjectRun,
  promoteOrphanGroupChildToStandalone,
  isWorkflowDescriptionSatisfied,
  projectInheritsGroupTemplate,
  projectInheritsGroupTemplateOnSave,
  shouldInheritGroupWorkflowOnSpawn,
  shouldPersistResolvedWorkflowToProject,
  spawnedProjectHasOwnWorkflow,
  workflowDescriptionForProject,
  workflowForProject,
} from '../../src/lib/office-task-workflow';

describe('office-task-workflow', () => {
  it('shouldInheritGroupWorkflowOnSpawn when spawn DAG has no custom workflow', () => {
    expect(
      shouldInheritGroupWorkflowOnSpawn({
        executionMode: 'workflow',
        workflowEngine: 'dag',
        workflow: { mode: 'dag', nodes: [], edges: [] },
        description: '',
      }),
    ).toBe(true);
  });

  it('shouldInheritGroupWorkflowOnSpawn when spawn form matches fixed-group heuristic template', () => {
    expect(
      shouldInheritGroupWorkflowOnSpawn(
        {
          executionMode: 'workflow',
          workflowEngine: 'dag',
          workflow: { mode: 'dag', nodes: [], edges: [] },
          description: '组内工作流描述',
          heuristicWorkflowDescription: '组内工作流描述',
          workflowOrchestrationMode: 'heuristic',
        },
        {
          workflowOrchestrationMode: 'heuristic',
          workflowDescription: '组内工作流描述',
          workflowStepDrafts: undefined,
        },
      ),
    ).toBe(true);
  });

  it('shouldInheritGroupWorkflowOnSpawn is false when workflow description diverges from group', () => {
    expect(
      shouldInheritGroupWorkflowOnSpawn(
        {
          executionMode: 'workflow',
          workflowEngine: 'dag',
          workflow: { mode: 'dag', nodes: [], edges: [] },
          description: '自定义工作流描述',
          heuristicWorkflowDescription: '自定义工作流描述',
          workflowOrchestrationMode: 'heuristic',
        },
        {
          workflowOrchestrationMode: 'heuristic',
          workflowDescription: '组内工作流描述',
        },
      ),
    ).toBe(false);
  });

  it('shouldInheritGroupWorkflowOnSpawn is false when workflow description is provided without group', () => {
    expect(
      shouldInheritGroupWorkflowOnSpawn({
        executionMode: 'workflow',
        workflowEngine: 'dag',
        workflow: { mode: 'dag', nodes: [], edges: [] },
        description: '自定义工作流描述',
      }),
    ).toBe(false);
  });

  it('shouldInheritGroupWorkflowOnSpawn is false when workflow nodes exist', () => {
    expect(
      shouldInheritGroupWorkflowOnSpawn({
        executionMode: 'workflow',
        workflowEngine: 'dag',
        workflow: {
          mode: 'dag',
          nodes: [{ id: 'n1', title: 'Step', agentIds: ['a1'] }],
          edges: [],
        },
        description: '',
      }),
    ).toBe(false);
  });

  it('shouldInheritGroupWorkflowOnSpawn inherits when locked group has orchestration and form is untouched', () => {
    const groupDrafts = [
      {
        input: '',
        agentIds: ['a1'],
        task: '组内步骤',
        output: '',
        linkMode: 'serial' as const,
      },
    ];
    expect(
      shouldInheritGroupWorkflowOnSpawn(
        {
          executionMode: 'workflow',
          workflowEngine: 'dag',
          workflow: { mode: 'dag', nodes: [], edges: [] },
          description: '',
          // Untouched spawn prefills group drafts (empty drafts would be dirty).
          workflowStepDrafts: groupDrafts,
          workflowOrchestrationMode: 'rule',
        },
        {
          executionMode: 'workflow',
          workflowOrchestrationMode: 'rule',
          workflowDescription: '',
          workflowStepDrafts: groupDrafts,
          workflow: { mode: 'dag', nodes: [], edges: [] },
          agentIds: ['a1'],
          coordinatorAgentId: 'a1',
        },
      ),
    ).toBe(true);
  });

  it('shouldInheritGroupWorkflowOnSpawn ignores mismatched form mode when group orchestration is locked', () => {
    const groupDrafts = [
      {
        input: '',
        agentIds: ['a1'],
        task: '组内步骤',
        output: '',
        linkMode: 'serial' as const,
      },
    ];
    expect(
      shouldInheritGroupWorkflowOnSpawn(
        {
          executionMode: 'workflow',
          workflowEngine: 'dag',
          workflow: { mode: 'dag', nodes: [], edges: [] },
          description: '',
          workflowOrchestrationMode: 'heuristic',
          workflowStepDrafts: groupDrafts,
        },
        {
          executionMode: 'workflow',
          workflowOrchestrationMode: 'rule',
          workflowDescription: '',
          workflowStepDrafts: groupDrafts,
        },
      ),
    ).toBe(true);
  });

  it('workflowForProject uses empty workflow for standalone project without inherit flag', () => {
    const groupWorkflow = {
      mode: 'dag' as const,
      nodes: [{ id: 'g1', title: 'Group step', agentIds: ['a1'] }],
      edges: [],
    };
    expect(
      workflowForProject(
        {
          executionMode: 'workflow',
          workflow: { mode: 'dag', nodes: [], edges: [] },
        },
        { workflow: groupWorkflow },
      ),
    ).toEqual({ mode: 'dag', nodes: [], edges: [] });
  });

  it('workflowForProject still reads group template when project inherits', () => {
    const groupWorkflow = {
      mode: 'dag' as const,
      nodes: [{ id: 'g1', title: 'Group step', agentIds: ['a1'] }],
      edges: [],
    };
    expect(
      workflowForProject(
        {
          executionMode: 'workflow',
          origin: 'fixed_group',
          parentGroupId: 'g1',
          inheritsGroupTemplate: true,
          workflow: { mode: 'dag', nodes: [], edges: [] },
        },
        { workflow: groupWorkflow },
      ),
    ).toEqual(groupWorkflow);
  });

  it('workflowForProject does not fall back to group after customization without nodes', () => {
    const groupWorkflow = {
      mode: 'dag' as const,
      nodes: [{ id: 'g1', title: 'Group step', agentIds: ['a1'] }],
      edges: [],
    };
    expect(
      workflowForProject(
        {
          executionMode: 'workflow',
          origin: 'fixed_group',
          parentGroupId: 'g1',
          inheritsGroupTemplate: false,
          workflow: { mode: 'dag', nodes: [], edges: [] },
        },
        { workflow: groupWorkflow },
      ),
    ).toEqual({ mode: 'dag', nodes: [], edges: [] });
  });

  it('workflowForProject uses group for no-own even if stale nodes remain on disk', () => {
    const groupWorkflow = {
      mode: 'dag' as const,
      nodes: [{ id: 'g1', title: 'Group step', agentIds: ['a1'] }],
      edges: [],
    };
    const projectWorkflow = {
      mode: 'dag' as const,
      nodes: [{ id: 'p1', title: 'Project step', agentIds: ['a1'] }],
      edges: [],
    };
    expect(
      workflowForProject(
        {
          executionMode: 'workflow',
          origin: 'fixed_group',
          parentGroupId: 'g1',
          inheritsGroupTemplate: true,
          status: 'pending',
          workflow: projectWorkflow,
        },
        { workflow: groupWorkflow },
      ),
    ).toEqual(groupWorkflow);
    expect(spawnedProjectHasOwnWorkflow({ workflow: projectWorkflow })).toBe(true);
  });

  it('workflowForProject prefers owned project workflow over group template', () => {
    const groupWorkflow = {
      mode: 'dag' as const,
      nodes: [{ id: 'g1', title: 'Group step', agentIds: ['a1'] }],
      edges: [],
    };
    const projectWorkflow = {
      mode: 'dag' as const,
      nodes: [{ id: 'p1', title: 'Project step', agentIds: ['a1'] }],
      edges: [],
    };
    expect(
      workflowForProject(
        {
          executionMode: 'workflow',
          origin: 'fixed_group',
          parentGroupId: 'g1',
          inheritsGroupTemplate: false,
          status: 'pending',
          workflow: projectWorkflow,
        },
        { workflow: groupWorkflow },
      ),
    ).toEqual(projectWorkflow);
  });

  it('groupChildWorkflowFieldsAfterGroupUpdate keeps own workflow when already owned', () => {
    const projectWorkflow = {
      mode: 'dag' as const,
      nodes: [{ id: 'p1', title: 'Custom', agentIds: ['a1'] }],
      edges: [],
    };
    expect(
      groupChildWorkflowFieldsAfterGroupUpdate(
        {
          inheritsGroupTemplate: false,
          workflow: projectWorkflow,
          description: '项目描述',
          workflowOrchestrationMode: 'heuristic',
        },
        { workflowOrchestrationMode: 'rule' },
      ),
    ).toEqual({
      inheritsGroupTemplate: false,
      workflow: projectWorkflow,
      description: '项目描述',
      workflowStepDrafts: undefined,
      workflowOrchestrationMode: 'heuristic',
    });
  });

  it('groupChildWorkflowFieldsAfterGroupUpdate clears no-own payload (does not copy group drafts/desc)', () => {
    expect(
      groupChildWorkflowFieldsAfterGroupUpdate(
        {
          inheritsGroupTemplate: true,
          workflow: { mode: 'dag', nodes: [], edges: [] },
          description: 'stale',
          workflowOrchestrationMode: 'heuristic',
        },
        {
          workflowOrchestrationMode: 'heuristic',
          workflowDescription: '组启发式描述',
        },
      ),
    ).toEqual({
      inheritsGroupTemplate: true,
      workflow: { mode: 'dag', nodes: [], edges: [] },
      description: '',
      workflowStepDrafts: undefined,
      workflowOrchestrationMode: undefined,
    });
  });

  it('groupChildWorkflowFieldsAfterGroupUpdate clears fields when project has no workflow nodes', () => {
    expect(
      groupChildWorkflowFieldsAfterGroupUpdate(
        {
          inheritsGroupTemplate: true,
          workflow: { mode: 'dag', nodes: [], edges: [] },
          description: 'stale',
          workflowOrchestrationMode: 'heuristic',
        },
        { workflowOrchestrationMode: 'rule' },
      ),
    ).toEqual({
      inheritsGroupTemplate: true,
      workflow: { mode: 'dag', nodes: [], edges: [] },
      description: '',
      workflowStepDrafts: undefined,
      workflowOrchestrationMode: undefined,
    });
  });

  it('groupChildWorkflowFieldsAfterGroupUpdate does not persist rule drafts onto no-own children', () => {
    const drafts = [
      {
        input: '',
        agentIds: ['a1'],
        task: '组步骤',
        output: '',
        linkMode: 'serial' as const,
      },
    ];
    expect(
      groupChildWorkflowFieldsAfterGroupUpdate(
        {
          inheritsGroupTemplate: true,
          workflow: { mode: 'dag', nodes: [], edges: [] },
          description: '',
          workflowOrchestrationMode: 'rule',
        },
        { workflowOrchestrationMode: 'rule', workflowStepDrafts: drafts },
      ),
    ).toEqual({
      inheritsGroupTemplate: true,
      workflow: { mode: 'dag', nodes: [], edges: [] },
      description: '',
      workflowStepDrafts: undefined,
      workflowOrchestrationMode: undefined,
    });
  });

  it('workflowDescriptionForProject inherits fixed-group template', () => {
    expect(
      workflowDescriptionForProject(
        { description: '', origin: 'fixed_group', parentGroupId: 'g1' },
        { workflowDescription: '组内工作流描述' },
      ),
    ).toBe('组内工作流描述');
  });

  it('workflowDescriptionForProject falls back to project description when inheriting without group record', () => {
    expect(
      workflowDescriptionForProject(
        {
          description: '已复制的启发式描述',
          origin: 'fixed_group',
          parentGroupId: 'g1',
          inheritsGroupTemplate: true,
        },
        null,
      ),
    ).toBe('已复制的启发式描述');
  });

  it('materializeWorkflowForProjectRun builds DAG from rule step drafts when nodes are empty', () => {
    const drafts = [
      {
        input: '',
        agentIds: ['a1'],
        task: '步骤一',
        output: '',
        linkMode: 'serial' as const,
      },
    ];
    const workflow = materializeWorkflowForProjectRun(
      {
        executionMode: 'workflow',
        origin: 'standalone',
        inheritsGroupTemplate: false,
        workflow: { mode: 'dag', nodes: [], edges: [] },
        workflowOrchestrationMode: 'rule',
        workflowStepDrafts: drafts,
        description: '',
      },
      null,
      [{ agentId: 'a1', displayName: 'PM' }],
    );
    expect(workflow.nodes).toHaveLength(1);
    expect(workflow.nodes[0]?.title).toBe('步骤一');
  });

  it('fixedGroupContextForProjectRecord synthesizes context for detached standalone project', () => {
    const ctx = fixedGroupContextForProjectRecord(
      {
        id: 'p1',
        title: '自建',
        origin: 'standalone',
        agentIds: ['a1'],
        coordinatorAgentId: 'a1',
        lifecycle: 'active',
        featureDescription: 'feat',
        description: '启发式流程',
        status: 'pending',
        executionMode: 'workflow',
        workflowOrchestrationMode: 'heuristic',
        workflow: { mode: 'dag', nodes: [], edges: [] },
        nodeRuns: [],
        createdAt: 1,
        updatedAt: 1,
      },
      [],
    );
    expect(ctx.workflowDescription).toBe('启发式流程');
    expect(ctx.workflowOrchestrationMode).toBe('heuristic');
  });

  it('isWorkflowDescriptionSatisfied for spawned project with inherited workflow', () => {
    expect(
      isWorkflowDescriptionSatisfied(
        {
          description: '',
          origin: 'fixed_group',
          parentGroupId: 'g1',
          executionMode: 'workflow',
          workflow: { mode: 'dag', nodes: [], edges: [] },
        },
        {
          workflowDescription: '',
          workflow: {
            mode: 'dag',
            nodes: [{ id: 'n1', title: 'Step', agentIds: ['a1'] }],
            edges: [],
          },
        },
        '',
      ),
    ).toBe(true);
  });

  it('displayAgentsForProject uses group agents when inheriting template', () => {
    expect(
      displayAgentsForProject(
        {
          agentIds: ['old'],
          coordinatorAgentId: 'old',
          origin: 'fixed_group',
          parentGroupId: 'g1',
          inheritsGroupTemplate: true,
          executionMode: 'workflow',
          workflow: { mode: 'dag', nodes: [], edges: [] },
        },
        { agentIds: ['a1', 'a2'], coordinatorAgentId: 'a1' },
      ),
    ).toEqual({ agentIds: ['a1', 'a2'], coordinatorAgentId: 'a1' });
  });

  it('displayAgentsForProject uses project roster after inheritance is forked', () => {
    expect(
      displayAgentsForProject(
        {
          agentIds: ['a1'],
          coordinatorAgentId: 'a1',
          origin: 'fixed_group',
          parentGroupId: 'g1',
          inheritsGroupTemplate: false,
          executionMode: 'workflow',
          workflow: { mode: 'dag', nodes: [], edges: [] },
        },
        { agentIds: ['a1', 'ghost'], coordinatorAgentId: 'a1' },
      ),
    ).toEqual({ agentIds: ['a1'], coordinatorAgentId: 'a1' });
  });

  it('childInheritsGroupTemplate is false when project has materialized workflow nodes', () => {
    const workflow = {
      mode: 'dag' as const,
      nodes: [{ id: 'n1', title: 'Step', agentIds: ['a1'] }],
      edges: [],
    };
    expect(
      childInheritsGroupTemplate(
        {
          origin: 'fixed_group',
          parentGroupId: 'g1',
          executionMode: 'workflow',
          workflow,
        },
        { workflow, workflowDescription: '', workflowStepDrafts: undefined },
      ),
    ).toBe(false);
  });

  it('projectInheritsGroupTemplate is false after customization flag', () => {
    expect(
      projectInheritsGroupTemplate({
        origin: 'fixed_group',
        parentGroupId: 'g1',
        executionMode: 'workflow',
        inheritsGroupTemplate: false,
        workflow: {
          mode: 'dag',
          nodes: [{ id: 'n1', title: 'Custom', agentIds: ['a1'] }],
          edges: [],
        },
      }),
    ).toBe(false);
  });

  it('projectInheritsGroupTemplateOnSave requires both description and workflow to match group', () => {
    const groupWorkflow = {
      mode: 'dag' as const,
      nodes: [{ id: 'g1', title: 'Group step', agentIds: ['a1'] }],
      edges: [],
    };
    const group = {
      workflowDescription: '组模板描述',
      workflow: groupWorkflow,
      workflowStepDrafts: undefined,
    };

    expect(
      projectInheritsGroupTemplateOnSave(group, {
        parentGroupId: 'g1',
        executionMode: 'workflow',
        description: '组模板描述',
        workflow: groupWorkflow,
      }),
    ).toBe(true);

    expect(
      projectInheritsGroupTemplateOnSave(group, {
        parentGroupId: 'g1',
        executionMode: 'workflow',
        description: '项目自定义描述',
        workflow: groupWorkflow,
      }),
    ).toBe(false);

    expect(
      projectInheritsGroupTemplateOnSave(group, {
        parentGroupId: 'g1',
        executionMode: 'workflow',
        description: '组模板描述',
        workflow: {
          mode: 'dag',
          nodes: [{ id: 'p1', title: 'Custom step', agentIds: ['a1'] }],
          edges: [],
        },
      }),
    ).toBe(false);
  });

  it('projectInheritsGroupTemplateOnSave is false when roster diverges from group', () => {
    const groupWorkflow = {
      mode: 'dag' as const,
      nodes: [{ id: 'g1', title: 'Group step', agentIds: ['a1'] }],
      edges: [],
    };
    const group = {
      workflowDescription: '组模板描述',
      workflow: groupWorkflow,
      workflowStepDrafts: undefined,
      agentIds: ['a1', 'ghost'],
      coordinatorAgentId: 'a1',
    };

    expect(
      projectInheritsGroupTemplateOnSave(group, {
        parentGroupId: 'g1',
        executionMode: 'workflow',
        description: '组模板描述',
        workflow: groupWorkflow,
        agentIds: ['a1', 'ghost'],
        coordinatorAgentId: 'a1',
      }),
    ).toBe(true);

    expect(
      projectInheritsGroupTemplateOnSave(group, {
        parentGroupId: 'g1',
        executionMode: 'workflow',
        description: '组模板描述',
        workflow: groupWorkflow,
        agentIds: ['a1'],
        coordinatorAgentId: 'a1',
      }),
    ).toBe(false);
  });

  it('projectInheritsGroupTemplateOnSave compares structured workflow step drafts', () => {
    const groupWorkflow = { mode: 'dag' as const, nodes: [], edges: [] };
    const groupDrafts = [
      {
        input: '',
        agentIds: ['a1'],
        task: '组内步骤',
        output: '',
        linkMode: 'serial' as const,
      },
    ];
    const group = {
      workflowDescription: 'PM负责组内步骤',
      workflow: groupWorkflow,
      workflowStepDrafts: groupDrafts,
    };

    expect(
      projectInheritsGroupTemplateOnSave(group, {
        parentGroupId: 'g1',
        executionMode: 'workflow',
        description: 'PM负责组内步骤',
        workflowStepDrafts: groupDrafts,
        workflow: groupWorkflow,
      }),
    ).toBe(true);

    expect(
      projectInheritsGroupTemplateOnSave(group, {
        parentGroupId: 'g1',
        executionMode: 'workflow',
        description: 'PM负责自定义步骤',
        workflowStepDrafts: [
          {
            input: '',
            agentIds: ['a1'],
            task: '自定义步骤',
            output: '',
            linkMode: 'serial' as const,
          },
        ],
        workflow: groupWorkflow,
      }),
    ).toBe(false);
  });

  it('projectInheritsGroupTemplateOnSave ignores mismatched save mode when group orchestration is locked', () => {
    const groupWorkflow = { mode: 'dag' as const, nodes: [], edges: [] };
    const groupDrafts = [
      {
        input: '',
        agentIds: ['a1'],
        task: '组内步骤',
        output: '',
        linkMode: 'serial' as const,
      },
    ];
    const group = {
      executionMode: 'workflow' as const,
      workflowOrchestrationMode: 'rule' as const,
      workflowDescription: 'PM负责组内步骤',
      workflow: groupWorkflow,
      workflowStepDrafts: groupDrafts,
    };

    expect(
      projectInheritsGroupTemplateOnSave(group, {
        parentGroupId: 'g1',
        executionMode: 'workflow',
        description: 'PM负责组内步骤',
        workflowStepDrafts: groupDrafts,
        workflow: groupWorkflow,
        workflowOrchestrationMode: 'heuristic',
      }),
    ).toBe(true);
  });

  it('childInheritsGroupTemplate is true for no-own pending even when stale drafts remain on disk', () => {
    // Ownership is flag-based; stale drafts on a no-own project do not block group sync.
    const groupDrafts = [
      {
        input: '',
        agentIds: ['a1'],
        task: '组内步骤',
        output: '',
        linkMode: 'serial' as const,
      },
    ];
    expect(
      childInheritsGroupTemplate(
        {
          origin: 'fixed_group',
          parentGroupId: 'g1',
          executionMode: 'workflow',
          inheritsGroupTemplate: true,
          status: 'pending',
          lifecycle: 'active',
          description: 'PM负责自定义',
          workflowStepDrafts: [
            {
              input: '',
              agentIds: ['a1'],
              task: '自定义步骤',
              output: '',
              linkMode: 'serial',
            },
          ],
          workflow: { mode: 'dag', nodes: [], edges: [] },
        },
        {
          workflow: { mode: 'dag', nodes: [], edges: [] },
          workflowDescription: 'PM负责组内步骤',
          workflowStepDrafts: groupDrafts,
        },
      ),
    ).toBe(true);
  });

  it('convertGroupChildProjectToStandalone materializes inheriting template fields', () => {
    const groupWorkflow = {
      mode: 'dag' as const,
      nodes: [{ id: 'n1', title: '组步骤', agentIds: ['a1'] }],
      edges: [],
    };
    const group = {
      id: 'g1',
      name: '研发团队',
      agentIds: ['a1', 'a2'],
      coordinatorAgentId: 'a1',
      workflowDescription: '组模板描述',
      workflow: groupWorkflow,
      workflowStepDrafts: [
        {
          input: '',
          agentIds: ['a1'],
          task: '组步骤',
          output: '',
          linkMode: 'serial' as const,
        },
      ],
      workflowOrchestrationMode: 'rule' as const,
      createdAt: 1,
      updatedAt: 1,
    };
    const converted = convertGroupChildProjectToStandalone(
      {
        id: 'p1',
        title: '派出项目',
        origin: 'fixed_group',
        parentGroupId: 'g1',
        inheritsGroupTemplate: true,
        agentIds: ['old'],
        coordinatorAgentId: 'old',
        lifecycle: 'active',
        featureDescription: 'feat',
        description: '',
        status: 'failed',
        executionMode: 'workflow',
        workflow: { mode: 'dag', nodes: [], edges: [] },
        nodeRuns: [],
        createdAt: 1,
        updatedAt: 1,
      },
      group,
    );
    expect(converted.origin).toBe('standalone');
    expect(converted.parentGroupId).toBeUndefined();
    expect(converted.inheritsGroupTemplate).toBe(false);
    expect(converted.agentIds).toEqual(['a1', 'a2']);
    expect(converted.coordinatorAgentId).toBe('a1');
    expect(converted.description).toBe('组模板描述');
    expect(converted.workflow).toEqual(groupWorkflow);
    expect(converted.workflowStepDrafts?.[0]?.task).toBe('组步骤');
  });

  it('convertGroupChildProjectToStandalone keeps customized project data', () => {
    const customWorkflow = {
      mode: 'dag' as const,
      nodes: [{ id: 'n1', title: '自定义', agentIds: ['a3'] }],
      edges: [],
    };
    const converted = convertGroupChildProjectToStandalone(
      {
        id: 'p1',
        title: '派出项目',
        origin: 'fixed_group',
        parentGroupId: 'g1',
        inheritsGroupTemplate: false,
        agentIds: ['a3'],
        coordinatorAgentId: 'a3',
        lifecycle: 'archived',
        featureDescription: 'feat',
        description: '自定义描述',
        status: 'completed',
        executionMode: 'workflow',
        workflow: customWorkflow,
        nodeRuns: [],
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'g1',
        name: '研发团队',
        agentIds: ['a1'],
        coordinatorAgentId: 'a1',
        workflowDescription: '组模板描述',
        workflow: { mode: 'dag', nodes: [], edges: [] },
        createdAt: 1,
        updatedAt: 1,
      },
    );
    expect(converted.origin).toBe('standalone');
    expect(converted.parentGroupId).toBeUndefined();
    expect(converted.description).toBe('自定义描述');
    expect(converted.workflow).toEqual(customWorkflow);
    expect(converted.agentIds).toEqual(['a3']);
  });

  it('detachGroupChildProjectToStandalone clears linkage only', () => {
    const detached = detachGroupChildProjectToStandalone({
      id: 'p1',
      title: '派出项目',
      origin: 'fixed_group',
      parentGroupId: 'g1',
      inheritsGroupTemplate: true,
      agentIds: ['a1'],
      coordinatorAgentId: 'a1',
      lifecycle: 'archived',
      featureDescription: 'feat',
      description: '',
      status: 'completed',
      executionMode: 'workflow',
      workflow: { mode: 'dag', nodes: [], edges: [] },
      nodeRuns: [],
      createdAt: 1,
      updatedAt: 1,
    });
    expect(detached.origin).toBe('standalone');
    expect(detached.parentGroupId).toBeUndefined();
    expect(detached.inheritsGroupTemplate).toBe(false);
    expect(detached.agentIds).toEqual(['a1']);
  });

  it('convertGroupChildProjectToStandalone keeps smart execution mode', () => {
    const converted = convertGroupChildProjectToStandalone(
      {
        id: 'p1',
        title: 'Smart 派出',
        origin: 'fixed_group',
        parentGroupId: 'g1',
        agentIds: ['a1'],
        coordinatorAgentId: 'a1',
        lifecycle: 'archived',
        featureDescription: 'feat',
        description: '',
        status: 'completed',
        executionMode: 'smart',
        workflow: { mode: 'dag', nodes: [], edges: [] },
        nodeRuns: [],
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'g1',
        name: '组',
        agentIds: ['a1', 'a2'],
        coordinatorAgentId: 'a1',
        workflow: { mode: 'dag', nodes: [{ id: 'n1', title: 'x', agentIds: ['a1'] }], edges: [] },
        createdAt: 1,
        updatedAt: 1,
      },
    );
    expect(converted.origin).toBe('standalone');
    expect(converted.executionMode).toBe('smart');
    expect(converted.workflow.nodes).toHaveLength(0);
  });

  it('promoteOrphanGroupChildToStandalone preserves spawn-copied workflowStepDrafts', () => {
    const drafts = [
      {
        input: '',
        agentIds: ['a1'],
        task: '步骤一',
        output: '',
        linkMode: 'serial' as const,
      },
    ];
    const promoted = promoteOrphanGroupChildToStandalone(
      {
        id: 'p1',
        title: '派出项目',
        origin: 'fixed_group',
        parentGroupId: 'g1',
        inheritsGroupTemplate: true,
        agentIds: ['a1'],
        coordinatorAgentId: 'a1',
        lifecycle: 'archived',
        featureDescription: 'feat',
        description: '',
        status: 'completed',
        executionMode: 'workflow',
        workflow: { mode: 'dag', nodes: [], edges: [] },
        workflowStepDrafts: drafts,
        nodeRuns: [],
        createdAt: 1,
        updatedAt: 1,
      },
      'g1',
    );
    expect(promoted.origin).toBe('standalone');
    expect(promoted.parentGroupId).toBeUndefined();
    expect(promoted.workflowStepDrafts).toEqual(drafts);
  });

  it('promoteOrphanGroupChildToStandalone preserves heuristic description copied at spawn', () => {
    const promoted = promoteOrphanGroupChildToStandalone(
      {
        id: 'p1',
        title: '派出项目',
        origin: 'fixed_group',
        parentGroupId: 'g1',
        inheritsGroupTemplate: true,
        agentIds: ['a1'],
        coordinatorAgentId: 'a1',
        lifecycle: 'archived',
        featureDescription: 'feat',
        description: '启发式自然语言流程',
        status: 'completed',
        executionMode: 'workflow',
        workflowOrchestrationMode: 'heuristic',
        workflow: { mode: 'dag', nodes: [], edges: [] },
        nodeRuns: [],
        createdAt: 1,
        updatedAt: 1,
      },
      'g1',
    );
    expect(promoted.origin).toBe('standalone');
    expect(promoted.description).toBe('启发式自然语言流程');
    expect(promoted.workflowOrchestrationMode).toBe('heuristic');
  });

  it('shouldPersistResolvedWorkflowToProject is false while inheriting group template', () => {
    expect(
      shouldPersistResolvedWorkflowToProject({
        origin: 'fixed_group',
        parentGroupId: 'g1',
        executionMode: 'workflow',
        inheritsGroupTemplate: true,
        workflow: { mode: 'dag', nodes: [], edges: [] },
      }),
    ).toBe(false);
    expect(
      shouldPersistResolvedWorkflowToProject({
        origin: 'fixed_group',
        parentGroupId: 'g1',
        executionMode: 'workflow',
        inheritsGroupTemplate: false,
        workflow: {
          mode: 'dag',
          nodes: [{ id: 'n1', title: 'x', agentIds: ['a1'] }],
          edges: [],
        },
      }),
    ).toBe(true);
  });
});
