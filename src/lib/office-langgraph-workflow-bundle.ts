import {
  isLangGraphNativePlan,
  normalizeLangGraphNativePlan,
} from '@/lib/office-langgraph-plan-types';
import {
  customWorkflowNodeAgentUnresolved,
  normalizeCustomWorkflowNodes,
  type TeamRoleRef,
} from '@/lib/office-workflow-node';
import type {
  LangGraphWorkflowBundle,
  LangGraphWorkflowSource,
  WorkflowDefinition,
} from '@/types/office';

export function cloneLangGraphWorkflow(workflow: WorkflowDefinition): WorkflowDefinition {
  return structuredClone({
    ...workflow,
    mode: 'dag',
    orchestrationEngine: 'langgraph',
    edgesCustomized: true,
  });
}

export function emptyLangGraphWorkflowBundle(): LangGraphWorkflowBundle {
  return {
    activeSource: 'heuristic',
    activeSavedAt: 0,
  };
}

export function normalizeLangGraphWorkflowBundle(
  bundle: LangGraphWorkflowBundle | undefined,
): LangGraphWorkflowBundle | undefined {
  if (!bundle) return undefined;
  const activeSource: LangGraphWorkflowSource =
    bundle.activeSource === 'custom' ? 'custom' : 'heuristic';
  const activeSavedAt =
    typeof bundle.activeSavedAt === 'number' && Number.isFinite(bundle.activeSavedAt)
      ? bundle.activeSavedAt
      : 0;
  const heuristic = bundle.heuristic
    ? {
        description:
          typeof bundle.heuristic.description === 'string' ? bundle.heuristic.description : '',
        workflow: cloneLangGraphWorkflow(bundle.heuristic.workflow),
        source: bundle.heuristic.source,
        savedAt: bundle.heuristic.savedAt || 0,
      }
    : undefined;
  const custom = bundle.custom
    ? {
        workflow: cloneLangGraphWorkflow(bundle.custom.workflow),
        savedAt: bundle.custom.savedAt || 0,
      }
    : undefined;
  return { heuristic, custom, activeSource, activeSavedAt };
}

export function migrateLangGraphBundleFromWorkflow(
  workflow: WorkflowDefinition | undefined,
  description: string,
): LangGraphWorkflowBundle | undefined {
  if (!workflow?.nodes?.length) return undefined;
  if (!workflow.orchestrationPlan || !isLangGraphNativePlan(workflow.orchestrationPlan)) {
    return undefined;
  }
  const now = Date.now();
  return {
    heuristic: {
      description,
      workflow: cloneLangGraphWorkflow(workflow),
      source: 'langgraph_heuristic',
      savedAt: now,
    },
    activeSource: 'heuristic',
    activeSavedAt: now,
  };
}

export function resolveActiveLangGraphWorkflow(
  bundle: LangGraphWorkflowBundle | undefined,
): WorkflowDefinition | undefined {
  if (!bundle) return undefined;
  const branch = bundle.activeSource === 'custom' ? bundle.custom : bundle.heuristic;
  return branch?.workflow;
}

export function resolveLangGraphBranchWorkflow(
  bundle: LangGraphWorkflowBundle | undefined,
  source: LangGraphWorkflowSource,
): WorkflowDefinition | undefined {
  if (!bundle) return undefined;
  return source === 'custom' ? bundle.custom?.workflow : bundle.heuristic?.workflow;
}

/** Stash the current tab draft into the bundle without changing the active source. */
export function stashLangGraphTabDraft(
  bundle: LangGraphWorkflowBundle | undefined,
  tab: LangGraphWorkflowSource,
  workflow: WorkflowDefinition,
  meta?: { description?: string; generateSource?: string },
): LangGraphWorkflowBundle {
  const base = normalizeLangGraphWorkflowBundle(bundle) ?? emptyLangGraphWorkflowBundle();
  const wf = cloneLangGraphWorkflow(workflow);
  if (tab === 'heuristic') {
    return {
      ...base,
      heuristic: {
        description: meta?.description ?? base.heuristic?.description ?? '',
        workflow: wf,
        source: meta?.generateSource ?? base.heuristic?.source,
        savedAt: base.heuristic?.savedAt ?? 0,
      },
    };
  }
  return {
    ...base,
    custom: {
      workflow: wf,
      savedAt: base.custom?.savedAt ?? 0,
    },
  };
}

export function applyLangGraphWorkflowSave(
  bundle: LangGraphWorkflowBundle | undefined,
  source: LangGraphWorkflowSource,
  workflow: WorkflowDefinition,
  meta?: { description?: string; generateSource?: string; savedAt?: number },
): { bundle: LangGraphWorkflowBundle; activeWorkflow: WorkflowDefinition } {
  const now = meta?.savedAt ?? Date.now();
  const normalizedWf = cloneLangGraphWorkflow(workflow);
  const stashed = stashLangGraphTabDraft(bundle, source, normalizedWf, meta);
  if (source === 'heuristic') {
    const next: LangGraphWorkflowBundle = {
      ...stashed,
      heuristic: {
        description: meta?.description ?? stashed.heuristic?.description ?? '',
        workflow: normalizedWf,
        source: meta?.generateSource ?? stashed.heuristic?.source,
        savedAt: now,
      },
      activeSource: 'heuristic',
      activeSavedAt: now,
    };
    return { bundle: next, activeWorkflow: normalizedWf };
  }
  const next: LangGraphWorkflowBundle = {
    ...stashed,
    custom: {
      workflow: normalizedWf,
      savedAt: now,
    },
    activeSource: 'custom',
    activeSavedAt: now,
  };
  return { bundle: next, activeWorkflow: normalizedWf };
}

export type CustomLangGraphWorkflowValidation =
  | { ok: true; workflow: WorkflowDefinition }
  | { ok: false; errorKey: string };

export function validateCustomLangGraphWorkflow(
  workflow: WorkflowDefinition,
  teamRoles?: TeamRoleRef[],
): CustomLangGraphWorkflowValidation {
  const normalizedNodes = normalizeCustomWorkflowNodes(workflow, teamRoles);
  if (!normalizedNodes.nodes?.length) {
    return { ok: false, errorKey: 'langGraphWorkflow.customValidationNeedNodes' };
  }
  for (const original of workflow.nodes) {
    const normalized = normalizedNodes.nodes.find((n) => n.id === original.id);
    if (customWorkflowNodeAgentUnresolved(original, normalized)) {
      return { ok: false, errorKey: 'langGraphWorkflow.customValidationUnknownRole' };
    }
  }
  if (normalizedNodes.nodes.some((n) => !n.agentId?.trim())) {
    return { ok: false, errorKey: 'langGraphWorkflow.customValidationNeedRole' };
  }
  if (!workflow.orchestrationPlan || !isLangGraphNativePlan(workflow.orchestrationPlan)) {
    return { ok: false, errorKey: 'langGraphWorkflow.customValidationNeedPlan' };
  }
  if (workflow.nodes.some((n) => !n.title?.trim())) {
    return { ok: false, errorKey: 'workflow.validationNeedTaskNames' };
  }

  const plan = normalizeLangGraphNativePlan(workflow.orchestrationPlan);
  const nodeIds = new Set(workflow.nodes.map((n) => n.id));
  for (const planNode of plan.nodes) {
    if (planNode.kind === 'execute' && planNode.officeNodeId) {
      if (!nodeIds.has(planNode.officeNodeId)) {
        return { ok: false, errorKey: 'langGraphWorkflow.customValidationOfficeNodeMismatch' };
      }
    }
  }

  return {
    ok: true,
    workflow: structuredClone(workflow),
  };
}

export type CustomLangGraphJsonApplyResult =
  | { ok: true; workflow: WorkflowDefinition }
  | { ok: false; errorKey: string; parseError?: string };

export function tryApplyLangGraphCustomJson(
  jsonText: string,
  teamRoles?: TeamRoleRef[],
): CustomLangGraphJsonApplyResult {
  try {
    const parsed = JSON.parse(jsonText) as WorkflowDefinition;
    const validated = validateCustomLangGraphWorkflow(parsed, teamRoles);
    if (!validated.ok) {
      return { ok: false, errorKey: validated.errorKey };
    }
    return { ok: true, workflow: parsed };
  } catch (e) {
    return {
      ok: false,
      errorKey: 'langGraphWorkflow.customValidationParseError',
      parseError: e instanceof Error ? e.message : String(e),
    };
  }
}

export function prepareLangGraphTaskSave(params: {
  bundle?: LangGraphWorkflowBundle;
  activeTab: LangGraphWorkflowSource;
  workflow: WorkflowDefinition;
  description: string;
  generateSource?: string;
  customJsonDraft?: string;
  teamRoles?: TeamRoleRef[];
}):
  | { ok: true; bundle: LangGraphWorkflowBundle; workflow: WorkflowDefinition }
  | { ok: false; errorKey: string; parseError?: string } {
  if (params.activeTab === 'custom') {
    let workflow = params.workflow;
    if (params.customJsonDraft?.trim()) {
      const applied = tryApplyLangGraphCustomJson(params.customJsonDraft, params.teamRoles);
      if (!applied.ok) return applied;
      workflow = applied.workflow;
    }
    const validated = validateCustomLangGraphWorkflow(workflow, params.teamRoles);
    if (!validated.ok) return validated;
    const applied = applyLangGraphWorkflowSave(
      params.bundle,
      'custom',
      validated.workflow,
    );
    return { ok: true, bundle: applied.bundle, workflow: applied.activeWorkflow };
  }

  if (params.workflow.nodes.length === 0) {
    return { ok: false, errorKey: 'workflow.validationNeedTasks' };
  }
  if (params.workflow.nodes.some((n) => !n.title?.trim())) {
    return { ok: false, errorKey: 'workflow.validationNeedTaskNames' };
  }

  const applied = applyLangGraphWorkflowSave(params.bundle, 'heuristic', params.workflow, {
    description: params.description,
    generateSource: params.generateSource,
  });
  return { ok: true, bundle: applied.bundle, workflow: applied.activeWorkflow };
}

export function langGraphActiveSourceLabelKey(
  bundle: LangGraphWorkflowBundle | undefined,
): 'langGraphWorkflow.activeHeuristic' | null {
  if (!bundle?.activeSavedAt) return null;
  return bundle.activeSource === 'heuristic'
    ? 'langGraphWorkflow.activeHeuristic'
    : null;
}

/** DAG 与 LangGraph 启发式模式需要填写工作流描述；编排模式不需要。 */
export function langGraphWorkflowDescriptionRequired(
  workflowEngine: 'dag' | 'langgraph' | undefined,
  langGraphMode: LangGraphWorkflowSource,
): boolean {
  return workflowEngine !== 'langgraph' || langGraphMode === 'heuristic';
}
