import { expect, it } from 'vitest';
import { generateLangGraphWorkflowFromDescriptionHeuristic } from '@/lib/office-workflow-generate';
import {
  applyLangGraphWorkflowSave,
  emptyLangGraphWorkflowBundle,
  langGraphWorkflowDescriptionRequired,
  migrateLangGraphBundleFromWorkflow,
  prepareLangGraphTaskSave,
  resolveActiveLangGraphWorkflow,
  resolveLangGraphBranchWorkflow,
  stashLangGraphTabDraft,
  validateCustomLangGraphWorkflow,
} from '@/lib/office-langgraph-workflow-bundle';
import type { OfficeRole } from '@/types/office';
import { emptyWorkflow } from '@/lib/office-workflow-roles';
import { describeLangGraph } from '../helpers/langgraph-flag';

const roles: OfficeRole[] = [
  { id: 'pm', name: 'PM', agentId: 'pm', createdAt: 1, updatedAt: 1 },
  { id: 'dev', name: 'Dev', agentId: 'dev', createdAt: 1, updatedAt: 1 },
];

describeLangGraph('office-langgraph-workflow-bundle', () => {
  it('langGraphWorkflowDescriptionRequired follows mode rules', () => {
    expect(langGraphWorkflowDescriptionRequired('dag', 'heuristic')).toBe(true);
    expect(langGraphWorkflowDescriptionRequired('langgraph', 'heuristic')).toBe(true);
    expect(langGraphWorkflowDescriptionRequired('langgraph', 'custom')).toBe(false);
  });

  it('validateCustomLangGraphWorkflow accepts role/roles aliases without rewriting fields', () => {
    const wf =
      generateLangGraphWorkflowFromDescriptionHeuristic('1.PM 写计划', roles)?.workflow;
    expect(wf).toBeDefined();
    const aliased = structuredClone(wf!);
    for (const node of aliased.nodes) {
      if (node.roleIds?.length) {
        (node as { roles?: string[]; roleIds?: string[] }).roles = [...node.roleIds];
        delete (node as { roleIds?: string[] }).roleIds;
      }
      (node as { role?: string }).role = node.roleId;
      delete (node as { roleId?: string }).roleId;
    }
    const validated = validateCustomLangGraphWorkflow(aliased);
    expect(validated.ok).toBe(true);
    if (validated.ok) {
      expect(validated.workflow.nodes.every((n) => (n as { role?: string }).role?.trim())).toBe(true);
      expect(validated.workflow.nodes.every((n) => !n.roleId?.trim())).toBe(true);
    }
  });

  it('validateCustomLangGraphWorkflow validates multi-role nodes without rewriting fields', () => {
    const validated = validateCustomLangGraphWorkflow({
      mode: 'dag',
      nodes: [
        {
          id: 'lg-1',
          role: 'PM',
          roles: ['PM', 'Dev'],
          title: 'Joint step',
          execution: 'serial',
        },
      ],
      edges: [],
      orchestrationEngine: 'langgraph',
      orchestrationPlan: {
        kind: 'langgraph_native',
        version: 3,
        nativeRuntime: 'subgraph_store',
        checkpointer: 'office_store',
        entry: 'custom-exec-1',
        nodes: [{ id: 'custom-exec-1', kind: 'execute', label: 'Joint', officeNodeId: 'lg-1' }],
        edges: [],
        conditionalRoutes: [],
        subgraphs: [],
        visualLayers: [{ kind: 'sequential', nodeIds: ['custom-exec-1'] }],
      },
    }, roles);
    expect(validated.ok).toBe(true);
    if (validated.ok) {
      expect(validated.workflow.nodes[0]?.role).toBe('PM');
      expect((validated.workflow.nodes[0] as { roles?: string[] }).roles).toEqual(['PM', 'Dev']);
      expect(validated.workflow.nodes[0]?.roleId).toBeUndefined();
    }
  });

  it('validateCustomLangGraphWorkflow resolves team role names without rewriting fields', () => {
    const validated = validateCustomLangGraphWorkflow({
      mode: 'dag',
      nodes: [{ id: 'lg-1', role: 'Dev', title: 'Step', execution: 'serial' }],
      edges: [],
      orchestrationEngine: 'langgraph',
      orchestrationPlan: {
        kind: 'langgraph_native',
        version: 3,
        nativeRuntime: 'subgraph_store',
        checkpointer: 'office_store',
        entry: 'custom-exec-1',
        nodes: [{ id: 'custom-exec-1', kind: 'execute', label: 'Step', officeNodeId: 'lg-1' }],
        edges: [],
        conditionalRoutes: [],
        subgraphs: [],
        visualLayers: [{ kind: 'sequential', nodeIds: ['custom-exec-1'] }],
      },
    }, roles);
    expect(validated.ok).toBe(true);
    if (validated.ok) {
      expect(validated.workflow.nodes[0]?.role).toBe('Dev');
      expect(validated.workflow.nodes[0]?.roleId).toBeUndefined();
    }
  });

  it('validateCustomLangGraphWorkflow rejects OpenClaw agentId as role reference', () => {
    const result = validateCustomLangGraphWorkflow({
      mode: 'dag',
      nodes: [{ id: 'lg-1', role: 'chan-pin', title: 'Step', execution: 'serial' }],
      edges: [],
      orchestrationEngine: 'langgraph',
      orchestrationPlan: {
        kind: 'langgraph_native',
        version: 3,
        nativeRuntime: 'subgraph_store',
        checkpointer: 'office_store',
        entry: 'custom-exec-1',
        nodes: [{ id: 'custom-exec-1', kind: 'execute', label: 'Step', officeNodeId: 'lg-1' }],
        edges: [],
        conditionalRoutes: [],
        subgraphs: [],
        visualLayers: [{ kind: 'sequential', nodeIds: ['custom-exec-1'] }],
      },
    }, [{ id: 'product', name: 'Product', agentId: 'dev', createdAt: 1, updatedAt: 1 }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorKey).toBe('langGraphWorkflow.customValidationUnknownRole');
    }
  });

  it('applyLangGraphWorkflowSave sets active workflow from last saved branch', () => {
    const heuristicWf =
      generateLangGraphWorkflowFromDescriptionHeuristic('1.PM 写计划', roles)?.workflow;
    expect(heuristicWf).toBeDefined();

    const customWf = structuredClone(heuristicWf!);
    customWf.nodes[0]!.title = 'Custom step title';

    let bundle = emptyLangGraphWorkflowBundle();
    const h = applyLangGraphWorkflowSave(bundle, 'heuristic', heuristicWf!, {
      description: '1.PM 写计划',
      generateSource: 'langgraph_heuristic',
    });
    bundle = h.bundle;
    expect(bundle.activeSource).toBe('heuristic');
    expect(resolveActiveLangGraphWorkflow(bundle)?.nodes[0]?.title).not.toBe('Custom step title');

    const c = applyLangGraphWorkflowSave(bundle, 'custom', customWf);
    bundle = c.bundle;
    expect(bundle.activeSource).toBe('custom');
    expect(resolveActiveLangGraphWorkflow(bundle)?.nodes[0]?.title).toBe('Custom step title');
    expect(bundle.heuristic?.workflow.nodes[0]?.title).not.toBe('Custom step title');
  });

  it('stashLangGraphTabDraft preserves both branches without changing active source', () => {
    const wf =
      generateLangGraphWorkflowFromDescriptionHeuristic('1.PM 写计划', roles)?.workflow;
    expect(wf).toBeDefined();
    const saved = applyLangGraphWorkflowSave(undefined, 'heuristic', wf!, {
      description: 'desc',
    });
    const customDraft = structuredClone(wf!);
    customDraft.nodes[0]!.title = 'Draft custom';
    const stashed = stashLangGraphTabDraft(saved.bundle, 'custom', customDraft);
    expect(stashed.activeSource).toBe('heuristic');
    expect(resolveLangGraphBranchWorkflow(stashed, 'custom')?.nodes[0]?.title).toBe('Draft custom');
  });

  it('migrateLangGraphBundleFromWorkflow backfills legacy tasks', () => {
    const wf =
      generateLangGraphWorkflowFromDescriptionHeuristic('1.PM 写计划', roles)?.workflow;
    expect(wf).toBeDefined();
    const bundle = migrateLangGraphBundleFromWorkflow(wf, 'legacy desc');
    expect(bundle?.activeSource).toBe('heuristic');
    expect(bundle?.heuristic?.workflow.nodes.length).toBeGreaterThan(0);
  });

  it('validateCustomLangGraphWorkflow rejects missing native plan', () => {
    const result = validateCustomLangGraphWorkflow({
      mode: 'dag',
      nodes: [{ id: 'lg-1', roleId: 'pm', title: 'Step', execution: 'serial' }],
      edges: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorKey).toBe('langGraphWorkflow.customValidationNeedPlan');
    }
  });

  it('prepareLangGraphTaskSave applies customJsonDraft on save without prior validate click', () => {
    const wf =
      generateLangGraphWorkflowFromDescriptionHeuristic('1.PM 写计划', roles)?.workflow;
    expect(wf).toBeDefined();
    const draftJson = JSON.stringify(wf, null, 2);
    const prepared = prepareLangGraphTaskSave({
      activeTab: 'custom',
      workflow: emptyWorkflow('dag'),
      description: '',
      customJsonDraft: draftJson,
      teamRoles: roles,
    });
    expect(prepared.ok).toBe(true);
    if (prepared.ok) {
      expect(prepared.bundle.activeSource).toBe('custom');
      expect(prepared.workflow.nodes.length).toBeGreaterThan(0);
    }
  });
});
