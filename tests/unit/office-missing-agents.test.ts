import { describe, expect, it } from 'vitest';
import {
  applySessionOnlyStripOnSave,
  buildSessionStripWorkflowSnapshot,
  collectOfficeAgentRefs,
  ensureMissingCoordinatorInRoster,
  editGateMissingKeyForWorkflowNode,
  fixedGroupCardBorderClass,
  formatMissingAgentsLabel,
  formatMissingAgentsLabelForIds,
  hasMissingOfficeAgents,
  mergeAgentNameMaps,
  missingAgentsForOfficeEntity,
  missingRosterAgentIds,
  missingRosterAndCoordinatorIds,
  nodeMissingBadgeByKey,
  officeMissingNodeFrameClass,
  preserveCoordinatorForSave,
  resolveProjectAgentRefEntity,
  sanitizeOfficeWorkflowRefsOnEditOpen,
  spliceStepMissingAgentIds,
  stampAgentNameHints,
  stepDraftRowShowMissingBadge,
  stripUnknownWorkflowNodeAgentIds,
  stripAgentIdsFromOfficeWorkflowRefs,
  tempProjectHasMissingAgents,
  workflowHasUnassignedAgentNodes,
} from '@/lib/office-missing-agents';
import type { WorkflowDefinition, WorkflowStepDraftRow } from '@/types/office';

describe('office-missing-agents', () => {
  const catalog = ['pm', 'ui-gong-cheng-shi', 'ruan-jian-kai-fa'];

  it('collects roster + coordinator + workflow + draft refs', () => {
    const refs = collectOfficeAgentRefs({
      agentIds: ['pm', 'ux-gong-cheng-shi'],
      coordinatorAgentId: 'pm',
      workflow: {
        mode: 'dag',
        nodes: [
          {
            id: 'n1',
            agentId: 'ruan-jian-kai-fa',
            agentIds: ['ruan-jian-kai-fa', 'deleted-agent'],
            execution: 'serial',
          },
        ],
        edges: [],
      },
      workflowStepDrafts: [
        {
          input: '',
          agentIds: ['ui-gong-cheng-shi', 'ghost'],
          task: '评审',
          output: '',
          linkMode: 'serial',
        },
      ],
    });
    expect(refs).toEqual([
      'pm',
      'ux-gong-cheng-shi',
      'ruan-jian-kai-fa',
      'deleted-agent',
      'ui-gong-cheng-shi',
      'ghost',
    ]);
  });

  it('collects LangGraph bundle workflow refs', () => {
    const refs = collectOfficeAgentRefs({
      agentIds: ['pm'],
      langGraphWorkflowBundle: {
        activeSource: 'custom',
        activeSavedAt: 1,
        custom: {
          savedAt: 1,
          workflow: {
            mode: 'dag',
            nodes: [{ id: 'n', agentId: 'lg-ghost', execution: 'serial' }],
            edges: [],
          },
        },
      },
    });
    expect(refs).toContain('lg-ghost');
  });

  it('detects missing agents against catalog', () => {
    const missing = missingAgentsForOfficeEntity(
      {
        agentIds: ['pm', 'ux-gong-cheng-shi'],
        coordinatorAgentId: 'pm',
        workflowStepDrafts: [
          {
            input: '',
            agentIds: ['ghost'],
            task: 'x',
            output: '',
            linkMode: 'serial',
          },
        ],
      },
      catalog,
    );
    expect(missing).toEqual(['ux-gong-cheng-shi', 'ghost']);
    expect(hasMissingOfficeAgents({ agentIds: ['pm'] }, catalog)).toBe(false);
  });

  it('treats empty workflow agentId as unresolved missing', () => {
    const workflow: WorkflowDefinition = {
      mode: 'dag',
      nodes: [{ id: 'n1', agentId: '', execution: 'serial' }],
      edges: [],
    };
    expect(workflowHasUnassignedAgentNodes(workflow)).toBe(true);
    expect(hasMissingOfficeAgents({ agentIds: ['pm'], workflow }, catalog)).toBe(true);
  });

  it('formats dynamic missing labels by remaining count', () => {
    expect(formatMissingAgentsLabel(['UX工程师'])).toBe('UX工程师缺失');
    expect(formatMissingAgentsLabel(['A', 'B'])).toBe('A、B缺失');
    expect(formatMissingAgentsLabel(['A', 'B', 'C', 'D'])).toBe('A等4个智能体缺失');
    expect(
      formatMissingAgentsLabelForIds(['ux-gong-cheng-shi', 'ghost'], {
        'ux-gong-cheng-shi': 'UX工程师',
      }),
    ).toBe('UX工程师、ghost缺失');
  });

  it('formats missing labels via i18n translator', () => {
    const t = (
      key: 'missingAgents.labelOne' | 'missingAgents.labelTwo' | 'missingAgents.labelMany',
      options: Record<string, string | number>,
    ) => {
      if (key === 'missingAgents.labelOne') return `${options.name} missing`;
      if (key === 'missingAgents.labelTwo') return `${options.a}, ${options.b} missing`;
      return `${options.name} and ${options.count} agents missing`;
    };
    expect(formatMissingAgentsLabel(['A'], t)).toBe('A missing');
    expect(formatMissingAgentsLabel(['A', 'B'], t)).toBe('A, B missing');
    expect(formatMissingAgentsLabel(['A', 'B', 'C'], t)).toBe('A and 3 agents missing');
  });

  it('prefers historical name hints over raw id', () => {
    const map = mergeAgentNameMaps(
      { 'ux-gong-cheng-shi': 'UX工程师' },
      nameMapLike(),
    );
    expect(formatMissingAgentsLabelForIds(['ux-gong-cheng-shi'], map)).toBe('UX工程师缺失');
  });

  it('strips deleted agents from nodes and drafts on edit open (roster untouched)', () => {
    const drafts: WorkflowStepDraftRow[] = [
      {
        input: '',
        agentIds: ['ui-gong-cheng-shi', 'ux-gong-cheng-shi'],
        task: '评审',
        output: '',
        linkMode: 'serial',
      },
    ];
    const workflow: WorkflowDefinition = {
      mode: 'dag',
      nodes: [
        {
          id: 'n1',
          agentId: 'ux-gong-cheng-shi',
          agentIds: ['ux-gong-cheng-shi', 'pm'],
          execution: 'serial',
        },
      ],
      edges: [],
    };
    const sanitized = sanitizeOfficeWorkflowRefsOnEditOpen(
      {
        agentIds: ['pm', 'ux-gong-cheng-shi'],
        workflow,
        workflowStepDrafts: drafts,
      },
      catalog,
    );
    expect(sanitized.agentIds).toEqual(['pm', 'ux-gong-cheng-shi']);
    expect(sanitized.workflowStepDrafts?.[0]?.agentIds).toEqual(['ui-gong-cheng-shi']);
    expect(sanitized.workflow?.nodes[0]?.agentId).toBe('pm');
    expect(sanitized.workflow?.nodes[0]?.agentIds).toBeUndefined();
  });

  it('session strip on save always persists edit state (never restores ghosts)', () => {
    const persistedWorkflow: WorkflowDefinition = {
      mode: 'dag',
      nodes: [{ id: 'n1', agentId: 'ux-gong-cheng-shi', execution: 'serial' }],
      edges: [],
    };
    const openWorkflow: WorkflowDefinition = {
      mode: 'dag',
      nodes: [{ id: 'n1', agentId: '', execution: 'serial' }],
      edges: [],
    };
    const persistedDrafts: WorkflowStepDraftRow[] = [
      { input: '', agentIds: ['ux-gong-cheng-shi'], task: 't', output: '', linkMode: 'serial' },
    ];
    const openDrafts: WorkflowStepDraftRow[] = [
      { input: '', agentIds: [], task: 't', output: '', linkMode: 'serial' },
    ];
    const snapshot = buildSessionStripWorkflowSnapshot({
      persistedWorkflow,
      persistedWorkflowStepDrafts: persistedDrafts,
      openWorkflow,
      openWorkflowStepDrafts: openDrafts,
    });
    const titleOnly = applySessionOnlyStripOnSave(
      { workflow: openWorkflow, workflowStepDrafts: openDrafts },
      snapshot,
    );
    expect(titleOnly.workflow.nodes[0]?.agentId).toBe('');
    expect(titleOnly.workflowStepDrafts[0]?.agentIds).toEqual([]);
  });

  it('stripUnknownWorkflowNodeAgentIds clears node when all agents missing', () => {
    const next = stripUnknownWorkflowNodeAgentIds(
      {
        id: 'n',
        agentId: 'gone',
        agentIds: ['gone'],
        execution: 'serial',
      },
      catalog,
    );
    expect(next.agentId).toBe('');
    expect(next.agentIds).toBeUndefined();
  });

  it('missingRosterAgentIds lists only catalog-absent roster members', () => {
    expect(missingRosterAgentIds(['pm', 'ux-gong-cheng-shi', 'pm'], catalog)).toEqual([
      'ux-gong-cheng-shi',
    ]);
  });

  it('missingRosterAndCoordinatorIds includes orphan coordinator not in roster', () => {
    expect(
      missingRosterAndCoordinatorIds(['pm'], 'ghost-coord', catalog),
    ).toEqual(['ghost-coord']);
  });

  it('resolves inheriting project refs from group workflow', () => {
    const project = {
      agentIds: ['pm'],
      coordinatorAgentId: 'pm',
      origin: 'fixed_group' as const,
      parentGroupId: 'g1',
      inheritsGroupTemplate: true,
      executionMode: 'workflow' as const,
      workflow: { mode: 'dag' as const, nodes: [], edges: [] },
    };
    const group = {
      agentIds: ['pm', 'ux-gong-cheng-shi'],
      coordinatorAgentId: 'pm',
      workflow: {
        mode: 'dag' as const,
        nodes: [{ id: 'n1', agentId: 'ux-gong-cheng-shi', execution: 'serial' as const }],
        edges: [],
      },
      workflowDescription: '',
      workflowStepDrafts: undefined,
      workflowOrchestrationMode: 'rule' as const,
    };
    const entity = resolveProjectAgentRefEntity(project, group);
    expect(entity.agentIds).toEqual(['pm', 'ux-gong-cheng-shi']);
    expect(entity.workflow?.nodes[0]?.agentId).toBe('ux-gong-cheng-shi');
    expect(tempProjectHasMissingAgents(project, catalog, group)).toBe(true);
    expect(tempProjectHasMissingAgents(project, catalog, null)).toBe(false);
  });

  it('splices stepMissingAgentIds when a row is removed', () => {
    expect(spliceStepMissingAgentIds([['a'], ['b'], ['c']], 1)).toEqual([['a'], ['c']]);
  });

  it('stampAgentNameHints keeps previous names for deleted agents', () => {
    const stamped = stampAgentNameHints(
      { agentIds: ['pm', 'ux-gong-cheng-shi'] },
      [{ id: 'pm', name: '产品经理' }],
      { 'ux-gong-cheng-shi': 'UX工程师' },
    );
    expect(stamped.pm).toBe('产品经理');
    expect(stamped['ux-gong-cheng-shi']).toBe('UX工程师');
  });

  it('ensureMissingCoordinatorInRoster pushes orphan coordinator into agentIds', () => {
    expect(ensureMissingCoordinatorInRoster(['pm'], 'ghost-coord')).toEqual([
      'pm',
      'ghost-coord',
    ]);
    expect(ensureMissingCoordinatorInRoster(['pm', 'ghost-coord'], 'ghost-coord')).toEqual([
      'pm',
      'ghost-coord',
    ]);
    expect(ensureMissingCoordinatorInRoster(['pm'], undefined)).toEqual(['pm']);
  });

  it('preserveCoordinatorForSave keeps orphan coordinator while still in roster', () => {
    expect(
      preserveCoordinatorForSave({
        coordinatorId: 'ghost-coord',
        agentIds: ['pm', 'ghost-coord'],
        catalogAgentIds: catalog,
      }),
    ).toBe('ghost-coord');
  });

  it('preserveCoordinatorForSave falls back to catalog-known roster after unbind', () => {
    expect(
      preserveCoordinatorForSave({
        coordinatorId: 'ghost-coord',
        agentIds: ['pm', 'ruan-jian-kai-fa'],
        catalogAgentIds: catalog,
      }),
    ).toBe('pm');
    expect(
      preserveCoordinatorForSave({
        coordinatorId: 'ghost-coord',
        agentIds: ['ghost-other'],
        catalogAgentIds: catalog,
      }),
    ).toBe('');
  });

  it('preserveCoordinatorForSave does not auto-pick when coordinator was explicitly cleared', () => {
    // Regression: after X on missing coordinator, form coord is '' and must stay ''
    // until the user picks a known member — silent ensureCoordinatorInTeam would
    // bypass "协调者清空，需用户再选".
    expect(
      preserveCoordinatorForSave({
        coordinatorId: '',
        agentIds: ['pm', 'ruan-jian-kai-fa'],
        catalogAgentIds: catalog,
      }),
    ).toBe('');
  });

  it('nodeMissingBadgeByKey maps only showMissingBadge nodes', () => {
    const map = nodeMissingBadgeByKey([
      { key: 'step:0', showMissingBadge: true },
      { key: 'workflow:n1', showMissingBadge: false },
      { key: 'langgraph:custom:c', showMissingBadge: true },
    ]);
    expect(map.size).toBe(2);
    expect(map.get('step:0')).toBe(true);
    expect(map.get('workflow:n1')).toBeUndefined();
    expect(map.get('langgraph:custom:c')).toBe(true);
    expect(editGateMissingKeyForWorkflowNode('n1')).toBe('workflow:n1');
  });

  it('officeMissingNodeFrameClass and fixedGroupCardBorderClass', () => {
    expect(officeMissingNodeFrameClass(false)).toBe('');
    expect(officeMissingNodeFrameClass(true)).toContain('destructive');
    expect(fixedGroupCardBorderClass(true)).toBe(officeMissingNodeFrameClass(true));
  });

  it('stepDraftRowShowMissingBadge follows open stepMissingAgentIds row', () => {
    expect(stepDraftRowShowMissingBadge([['ghost'], []], 0)).toBe(true);
    expect(stepDraftRowShowMissingBadge([['ghost'], []], 1)).toBe(false);
    expect(stepDraftRowShowMissingBadge(undefined, 0)).toBe(false);
  });

  it('stripAgentIdsFromOfficeWorkflowRefs clears node/draft/all LangGraph branches immediately', () => {
    const stripped = stripAgentIdsFromOfficeWorkflowRefs(
      {
        workflow: {
          mode: 'dag',
          nodes: [
            { id: 'n1', agentId: 'ghost', title: 'A' },
            { id: 'n2', agentIds: ['a1', 'ghost'], title: 'B' },
          ],
          edges: [],
        },
        workflowStepDrafts: [
          { task: 's1', agentIds: ['ghost'], linkMode: 'serial' },
          { task: 's2', agentIds: ['a1'], linkMode: 'serial' },
        ] as WorkflowStepDraftRow[],
        langGraphWorkflowBundle: {
          activeSource: 'heuristic',
          activeSavedAt: 1,
          heuristic: {
            description: 'h',
            workflow: {
              mode: 'dag',
              nodes: [{ id: 'h1', agentId: 'ghost', title: 'H' }],
              edges: [],
            },
            source: 'langgraph_heuristic',
            savedAt: 1,
          },
          custom: {
            workflow: {
              mode: 'dag',
              nodes: [{ id: 'c1', agentId: 'ghost', title: 'C' }],
              edges: [],
            },
            savedAt: 1,
          },
        },
      },
      ['ghost'],
    );

    expect(stripped.workflow?.nodes[0]?.agentId).toBe('');
    expect(stripped.workflow?.nodes[1]?.agentId).toBe('a1');
    expect(stripped.workflowStepDrafts?.[0]?.agentIds).toEqual([]);
    expect(stripped.workflowStepDrafts?.[1]?.agentIds).toEqual(['a1']);
    expect(stripped.langGraphWorkflowBundle?.heuristic?.workflow.nodes[0]?.agentId).toBe('');
    expect(stripped.langGraphWorkflowBundle?.custom?.workflow.nodes[0]?.agentId).toBe('');
  });
});

function nameMapLike(): Map<string, string> {
  return new Map([['pm', '产品经理']]);
}
