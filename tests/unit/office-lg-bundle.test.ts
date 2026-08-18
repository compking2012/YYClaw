import { describe, expect, it } from 'vitest';
import type {
  LangGraphWorkflowBundle,
  WorkflowDefinition,
} from '@/types/office';
import type { LangGraphOrchestrationPlan } from '@/lib/office-langgraph-plan-types';
import {
  applyLangGraphWorkflowSave,
  cloneLangGraphWorkflow,
  emptyLangGraphWorkflowBundle,
  langGraphActiveSourceLabelKey,
  langGraphWorkflowDescriptionRequired,
  migrateLangGraphBundleFromWorkflow,
  normalizeLangGraphWorkflowBundle,
  prepareLangGraphTaskSave,
  resolveActiveLangGraphWorkflow,
  resolveLangGraphBranchWorkflow,
  stashLangGraphTabDraft,
  tryApplyLangGraphCustomJson,
  validateCustomLangGraphWorkflow,
} from '@/lib/office-langgraph-workflow-bundle';

function nativePlan(nodeId = 'lg-1'): LangGraphOrchestrationPlan {
  return {
    kind: 'langgraph_native',
    version: 2,
    checkpointer: 'langgraph_memory',
    entry: nodeId,
    nodes: [{ id: nodeId, kind: 'execute', label: 'E', officeNodeId: nodeId }],
    edges: [],
    conditionalRoutes: [],
    subgraphs: [],
    visualLayers: [],
  };
}

function validWorkflow(): WorkflowDefinition {
  return {
    mode: 'dag',
    nodes: [{ id: 'lg-1', agentId: 'a1', title: 'Task 1', execution: 'serial' }],
    edges: [],
    orchestrationEngine: 'langgraph',
    orchestrationPlan: nativePlan('lg-1'),
  };
}

describe('office-langgraph-workflow-bundle clone/normalize', () => {
  it('cloneLangGraphWorkflow forces dag + langgraph flags', () => {
    const wf = cloneLangGraphWorkflow({ mode: 'simple', nodes: [], edges: [] });
    expect(wf.mode).toBe('dag');
    expect(wf.orchestrationEngine).toBe('langgraph');
    expect(wf.edgesCustomized).toBe(true);
  });

  it('emptyLangGraphWorkflowBundle defaults', () => {
    expect(emptyLangGraphWorkflowBundle()).toEqual({ activeSource: 'heuristic', activeSavedAt: 0 });
  });

  it('normalizeLangGraphWorkflowBundle handles undefined and coerces fields', () => {
    expect(normalizeLangGraphWorkflowBundle(undefined)).toBeUndefined();
    const norm = normalizeLangGraphWorkflowBundle({
      activeSource: 'custom',
      activeSavedAt: Number.NaN,
      heuristic: { description: 'd', workflow: validWorkflow(), source: 's', savedAt: 5 },
      custom: { workflow: validWorkflow(), savedAt: 7 },
    });
    expect(norm?.activeSource).toBe('custom');
    expect(norm?.activeSavedAt).toBe(0);
    expect(norm?.heuristic?.description).toBe('d');
    expect(norm?.custom?.savedAt).toBe(7);
  });

  it('normalize coerces bogus activeSource to heuristic and missing description', () => {
    const norm = normalizeLangGraphWorkflowBundle({
      activeSource: 'bogus' as never,
      activeSavedAt: 42,
      heuristic: { description: 123 as never, workflow: validWorkflow(), savedAt: 0 },
    });
    expect(norm?.activeSource).toBe('heuristic');
    expect(norm?.activeSavedAt).toBe(42);
    expect(norm?.heuristic?.description).toBe('');
  });
});

describe('office-langgraph-workflow-bundle migrate/resolve', () => {
  it('migrate returns undefined without nodes or plan', () => {
    expect(migrateLangGraphBundleFromWorkflow(undefined, 'd')).toBeUndefined();
    expect(
      migrateLangGraphBundleFromWorkflow({ mode: 'dag', nodes: [], edges: [] }, 'd'),
    ).toBeUndefined();
    expect(
      migrateLangGraphBundleFromWorkflow(
        { mode: 'dag', nodes: [{ id: 'x', agentId: 'a', execution: 'serial' }], edges: [] },
        'd',
      ),
    ).toBeUndefined();
  });

  it('migrate builds heuristic branch from native workflow', () => {
    const bundle = migrateLangGraphBundleFromWorkflow(validWorkflow(), 'desc');
    expect(bundle?.activeSource).toBe('heuristic');
    expect(bundle?.heuristic?.description).toBe('desc');
    expect(bundle?.heuristic?.source).toBe('langgraph_heuristic');
  });

  it('resolveActive / resolveBranch', () => {
    expect(resolveActiveLangGraphWorkflow(undefined)).toBeUndefined();
    const bundle: LangGraphWorkflowBundle = {
      activeSource: 'custom',
      activeSavedAt: 1,
      heuristic: { description: '', workflow: validWorkflow(), savedAt: 1 },
      custom: { workflow: validWorkflow(), savedAt: 2 },
    };
    expect(resolveActiveLangGraphWorkflow(bundle)?.mode).toBe('dag');
    expect(resolveLangGraphBranchWorkflow(bundle, 'heuristic')?.mode).toBe('dag');
    expect(resolveLangGraphBranchWorkflow(bundle, 'custom')?.mode).toBe('dag');
    expect(resolveLangGraphBranchWorkflow(undefined, 'custom')).toBeUndefined();
  });
});

describe('office-langgraph-workflow-bundle stash/save', () => {
  it('stashLangGraphTabDraft to heuristic and custom', () => {
    const h = stashLangGraphTabDraft(undefined, 'heuristic', validWorkflow(), { description: 'hi' });
    expect(h.heuristic?.description).toBe('hi');
    const c = stashLangGraphTabDraft(h, 'custom', validWorkflow());
    expect(c.custom?.workflow.mode).toBe('dag');
    expect(c.heuristic?.description).toBe('hi');
  });

  it('applyLangGraphWorkflowSave heuristic sets active + savedAt', () => {
    const { bundle, activeWorkflow } = applyLangGraphWorkflowSave(undefined, 'heuristic', validWorkflow(), {
      description: 'd',
      savedAt: 123,
    });
    expect(bundle.activeSource).toBe('heuristic');
    expect(bundle.activeSavedAt).toBe(123);
    expect(bundle.heuristic?.savedAt).toBe(123);
    expect(activeWorkflow.mode).toBe('dag');
  });

  it('applyLangGraphWorkflowSave custom sets active custom', () => {
    const { bundle } = applyLangGraphWorkflowSave(undefined, 'custom', validWorkflow(), { savedAt: 9 });
    expect(bundle.activeSource).toBe('custom');
    expect(bundle.custom?.savedAt).toBe(9);
  });
});

describe('validateCustomLangGraphWorkflow', () => {
  it('ok for a valid native workflow', () => {
    const res = validateCustomLangGraphWorkflow(validWorkflow(), [{ agentId: 'a1', displayName: 'A' }]);
    expect(res.ok).toBe(true);
  });

  it('needs nodes', () => {
    const res = validateCustomLangGraphWorkflow({ mode: 'dag', nodes: [], edges: [] });
    expect(res).toEqual({ ok: false, errorKey: 'langGraphWorkflow.customValidationNeedNodes' });
  });

  it('needs role when node has no agent', () => {
    const wf = validWorkflow();
    wf.nodes = [{ id: 'lg-1', agentId: '', title: 'T', execution: 'serial' }];
    const res = validateCustomLangGraphWorkflow(wf);
    expect(res.ok).toBe(false);
  });

  it('needs plan when orchestrationPlan is not native', () => {
    const wf = validWorkflow();
    wf.orchestrationPlan = { kind: 'dag_edges' };
    const res = validateCustomLangGraphWorkflow(wf);
    expect(res).toEqual({ ok: false, errorKey: 'langGraphWorkflow.customValidationNeedPlan' });
  });

  it('needs task names', () => {
    const wf = validWorkflow();
    wf.nodes = [{ id: 'lg-1', agentId: 'a1', title: '', execution: 'serial' }];
    const res = validateCustomLangGraphWorkflow(wf);
    expect(res).toEqual({ ok: false, errorKey: 'workflow.validationNeedTaskNames' });
  });

  it('detects office node mismatch', () => {
    const wf = validWorkflow();
    wf.orchestrationPlan = nativePlan('lg-other');
    const res = validateCustomLangGraphWorkflow(wf);
    expect(res).toEqual({ ok: false, errorKey: 'langGraphWorkflow.customValidationOfficeNodeMismatch' });
  });
});

describe('tryApplyLangGraphCustomJson + prepareLangGraphTaskSave', () => {
  it('parse error path', () => {
    const res = tryApplyLangGraphCustomJson('{ not json');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errorKey).toBe('langGraphWorkflow.customValidationParseError');
  });

  it('valid json path', () => {
    const res = tryApplyLangGraphCustomJson(JSON.stringify(validWorkflow()), [
      { agentId: 'a1', displayName: 'A' },
    ]);
    expect(res.ok).toBe(true);
  });

  it('prepare custom from json draft', () => {
    const res = prepareLangGraphTaskSave({
      activeTab: 'custom',
      workflow: validWorkflow(),
      description: 'd',
      customJsonDraft: JSON.stringify(validWorkflow()),
      teamRoles: [{ agentId: 'a1', displayName: 'A' }],
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.bundle.activeSource).toBe('custom');
  });

  it('prepare custom fails validation', () => {
    const wf = validWorkflow();
    wf.nodes = [];
    const res = prepareLangGraphTaskSave({ activeTab: 'custom', workflow: wf, description: 'd' });
    expect(res.ok).toBe(false);
  });

  it('prepare heuristic requires nodes and titles', () => {
    const empty = prepareLangGraphTaskSave({
      activeTab: 'heuristic',
      workflow: { mode: 'dag', nodes: [], edges: [] },
      description: 'd',
    });
    expect(empty).toEqual({ ok: false, errorKey: 'workflow.validationNeedTasks' });

    const noTitle = prepareLangGraphTaskSave({
      activeTab: 'heuristic',
      workflow: { mode: 'dag', nodes: [{ id: 'n', agentId: 'a', title: '', execution: 'serial' }], edges: [] },
      description: 'd',
    });
    expect(noTitle).toEqual({ ok: false, errorKey: 'workflow.validationNeedTaskNames' });
  });

  it('prepare heuristic ok', () => {
    const res = prepareLangGraphTaskSave({
      activeTab: 'heuristic',
      workflow: validWorkflow(),
      description: 'd',
      generateSource: 'gen',
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.bundle.activeSource).toBe('heuristic');
  });
});

describe('office-langgraph-workflow-bundle labels', () => {
  it('langGraphActiveSourceLabelKey', () => {
    expect(langGraphActiveSourceLabelKey(undefined)).toBeNull();
    expect(langGraphActiveSourceLabelKey({ activeSource: 'heuristic', activeSavedAt: 0 })).toBeNull();
    expect(langGraphActiveSourceLabelKey({ activeSource: 'heuristic', activeSavedAt: 1 })).toBe(
      'langGraphWorkflow.activeHeuristic',
    );
    expect(langGraphActiveSourceLabelKey({ activeSource: 'custom', activeSavedAt: 1 })).toBeNull();
  });

  it('langGraphWorkflowDescriptionRequired', () => {
    expect(langGraphWorkflowDescriptionRequired('dag', 'heuristic')).toBe(true);
    expect(langGraphWorkflowDescriptionRequired('langgraph', 'heuristic')).toBe(true);
    expect(langGraphWorkflowDescriptionRequired('langgraph', 'custom')).toBe(false);
  });
});
