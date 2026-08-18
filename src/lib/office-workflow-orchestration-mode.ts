import { applyWorkflowChange } from '@/lib/office-workflow-edges';
import { resolveDagWorkflowForSave } from '@/lib/office-workflow-preview';
import type { OrchestrationInputSnapshot } from '@/lib/office-workflow-preview-state';
import type { ProjectAgentRef } from '@/lib/office-workflow-node';
import {
  generateWorkflowFromStepDraftRows,
  hasWorkflowStepDraftContent,
  prepareWorkflowStepDraftsPayload,
  trimWorkflowStepDraftRows,
  workflowStepDraftsGenerationKey,
} from '@/lib/office-workflow-step-drafts';
import type {
  LangGraphWorkflowSource,
  OfficeFixedGroup,
  OfficeTaskExecutionMode,
  OfficeTempProject,
  OfficeWorkflowEngine,
  WorkflowDefinition,
  WorkflowStepDraftRow,
} from '@/types/office';

export type WorkflowOrchestrationMode = 'rule' | 'heuristic';

export const DEFAULT_WORKFLOW_ORCHESTRATION_MODE: WorkflowOrchestrationMode = 'rule';

export function resolveWorkflowOrchestrationMode(
  stored?: WorkflowOrchestrationMode | null,
  fallback?: {
    workflowStepDrafts?: WorkflowStepDraftRow[];
    workflowDescription?: string;
  },
): WorkflowOrchestrationMode {
  if (stored === 'rule' || stored === 'heuristic') return stored;
  if (fallback) {
    if (hasWorkflowStepDraftContent(fallback.workflowStepDrafts)) return 'rule';
    if (fallback.workflowDescription?.trim()) return 'heuristic';
  }
  return DEFAULT_WORKFLOW_ORCHESTRATION_MODE;
}

export function showWorkflowOrchestrationModeField(params: {
  executionMode: OfficeTaskExecutionMode;
  workflowEngine?: OfficeWorkflowEngine;
}): boolean {
  return params.executionMode === 'workflow' && params.workflowEngine !== 'langgraph';
}

export function showWorkflowStepDraftsField(params: {
  executionMode: OfficeTaskExecutionMode;
  workflowEngine: OfficeWorkflowEngine;
  langGraphTab?: LangGraphWorkflowSource;
  orchestrationMode: WorkflowOrchestrationMode;
}): boolean {
  if (params.executionMode !== 'workflow') return false;
  if (params.workflowEngine === 'langgraph') {
    return params.langGraphTab !== 'custom';
  }
  return params.orchestrationMode === 'rule';
}

export function showHeuristicWorkflowDescriptionField(params: {
  executionMode: OfficeTaskExecutionMode;
  workflowEngine: OfficeWorkflowEngine;
  langGraphTab?: LangGraphWorkflowSource;
  orchestrationMode: WorkflowOrchestrationMode;
}): boolean {
  if (params.executionMode !== 'workflow') return false;
  if (params.workflowEngine === 'langgraph') {
    return params.langGraphTab === 'custom';
  }
  return params.orchestrationMode === 'heuristic';
}

export function orchestrationTemplateKey(params: {
  workflowOrchestrationMode?: WorkflowOrchestrationMode;
  workflowDescription?: string;
  workflowStepDrafts?: WorkflowStepDraftRow[];
}): string {
  const mode = resolveWorkflowOrchestrationMode(params.workflowOrchestrationMode, params);
  if (mode === 'heuristic') {
    return `heuristic:${params.workflowDescription?.trim() ?? ''}`;
  }
  return `rule:${workflowStepDraftsGenerationKey(params.workflowStepDrafts ?? [])}`;
}

export function prepareDagOrchestrationPersistPayload(params: {
  mode: WorkflowOrchestrationMode;
  workflowStepDrafts: WorkflowStepDraftRow[];
  heuristicDescription: string;
  members: ProjectAgentRef[];
}): {
  workflowOrchestrationMode: WorkflowOrchestrationMode;
  workflowStepDrafts?: WorkflowStepDraftRow[];
  workflowDescription?: string;
  description: string;
} {
  if (params.mode === 'rule') {
    const prepared = prepareWorkflowStepDraftsPayload(params.workflowStepDrafts, params.members);
    return {
      workflowOrchestrationMode: 'rule',
      workflowStepDrafts: prepared.workflowStepDrafts,
      workflowDescription: undefined,
      description: '',
    };
  }
  const description = params.heuristicDescription.trim();
  return {
    workflowOrchestrationMode: 'heuristic',
    workflowStepDrafts: undefined,
    workflowDescription: description || undefined,
    description,
  };
}

export function ensureRuleWorkflowFromStepDrafts(params: {
  workflowStepDrafts: WorkflowStepDraftRow[];
  members: ProjectAgentRef[];
  workflow: WorkflowDefinition;
}):
  | { ok: true; workflow: WorkflowDefinition }
  | { ok: false; errorKey: string } {
  const trimmed = trimWorkflowStepDraftRows(params.workflowStepDrafts);
  if (trimmed.length === 0) {
    if (params.workflow.nodes.length > 0) {
      return { ok: true, workflow: { ...params.workflow, mode: 'dag' } };
    }
    return { ok: false, errorKey: 'workflow.validationNeedTasks' };
  }
  const generated = generateWorkflowFromStepDraftRows(trimmed, params.members, 'dag');
  if (!generated) {
    return { ok: false, errorKey: 'workflow.validationNeedTasks' };
  }
  return {
    ok: true,
    workflow: applyWorkflowChange({ ...generated.workflow, mode: 'dag' }, false),
  };
}

export function orchestrationModeFromGroup(
  group: Pick<
    OfficeFixedGroup,
    'workflowOrchestrationMode' | 'workflowDescription' | 'workflowStepDrafts'
  >,
): WorkflowOrchestrationMode {
  return resolveWorkflowOrchestrationMode(group.workflowOrchestrationMode, {
    workflowStepDrafts: group.workflowStepDrafts,
    workflowDescription: group.workflowDescription,
  });
}

export function orchestrationModeFromProject(
  project: Pick<
    OfficeTempProject,
    'workflowOrchestrationMode' | 'description' | 'workflowStepDrafts'
  >,
  group?: Pick<
    OfficeFixedGroup,
    'workflowOrchestrationMode' | 'workflowDescription' | 'workflowStepDrafts'
  > | null,
): WorkflowOrchestrationMode {
  if (project.workflowOrchestrationMode) return project.workflowOrchestrationMode;
  if (group) return orchestrationModeFromGroup(group);
  return resolveWorkflowOrchestrationMode(undefined, {
    workflowStepDrafts: project.workflowStepDrafts,
    workflowDescription: project.description,
  });
}

export function heuristicDescriptionForForm(params: {
  orchestrationMode: WorkflowOrchestrationMode;
  storedDescription?: string;
  storedHeuristicDraft?: string;
}): string {
  if (params.storedHeuristicDraft?.trim()) return params.storedHeuristicDraft;
  if (params.orchestrationMode === 'heuristic') return params.storedDescription?.trim() ?? '';
  return '';
}

export function orchestrationContentKey(params: {
  orchestrationMode: WorkflowOrchestrationMode;
  workflowStepDrafts: WorkflowStepDraftRow[];
  heuristicDescription: string;
}): string {
  if (params.orchestrationMode === 'rule') {
    return workflowStepDraftsGenerationKey(params.workflowStepDrafts);
  }
  return params.heuristicDescription.trim();
}

export function orchestrationContentChanged(params: {
  orchestrationMode: WorkflowOrchestrationMode;
  workflowStepDrafts: WorkflowStepDraftRow[];
  heuristicDescription: string;
  previousOrchestrationMode?: WorkflowOrchestrationMode;
  previousDescription?: string;
  previousWorkflowStepDrafts?: WorkflowStepDraftRow[];
}): boolean {
  if (
    params.previousOrchestrationMode
    && params.previousOrchestrationMode !== params.orchestrationMode
  ) {
    return true;
  }
  const previousMode = params.previousOrchestrationMode ?? params.orchestrationMode;
  const currentKey = orchestrationContentKey({
    orchestrationMode: params.orchestrationMode,
    workflowStepDrafts: params.workflowStepDrafts,
    heuristicDescription: params.heuristicDescription,
  });
  const previousKey = orchestrationContentKey({
    orchestrationMode: previousMode,
    workflowStepDrafts: params.previousWorkflowStepDrafts ?? [],
    heuristicDescription: params.previousDescription ?? '',
  });
  return currentKey !== previousKey;
}

/** Whether saving should regenerate workflow nodes from orchestration inputs. */
export function orchestrationWillRegenerateOnSave(params: {
  executionMode: 'smart' | 'workflow';
  orchestrationMode: WorkflowOrchestrationMode;
  workflowStepDrafts: WorkflowStepDraftRow[];
  heuristicDescription: string;
  workflow: WorkflowDefinition;
  previousOrchestrationMode?: WorkflowOrchestrationMode;
  previousDescription?: string;
  previousWorkflowStepDrafts?: WorkflowStepDraftRow[];
}): boolean {
  if (params.executionMode !== 'workflow') return false;
  const contentChanged = orchestrationContentChanged({
    orchestrationMode: params.orchestrationMode,
    workflowStepDrafts: params.workflowStepDrafts,
    heuristicDescription: params.heuristicDescription,
    previousOrchestrationMode: params.previousOrchestrationMode,
    previousDescription: params.previousDescription,
    previousWorkflowStepDrafts: params.previousWorkflowStepDrafts,
  });
  if (!contentChanged) return false;
  if (params.orchestrationMode === 'rule') return true;
  const description = params.heuristicDescription.trim();
  return Boolean(description) || params.workflow.nodes.length === 0;
}

export async function prepareDagOrchestrationForSave(params: {
  orchestrationMode: WorkflowOrchestrationMode;
  workflowStepDrafts: WorkflowStepDraftRow[];
  heuristicDescription: string;
  members: ProjectAgentRef[];
  workflow: WorkflowDefinition;
  title: string;
  featureDescription: string;
  agentIds: string[];
  coordinatorAgentId: string;
  orchestrationBaseline: OrchestrationInputSnapshot;
  previewSyncedKey: string | null;
  spawnFromGroup?: boolean;
  groupWorkflow?: WorkflowDefinition;
  executionMode?: Extract<OfficeTaskExecutionMode, 'smart' | 'workflow'>;
  /** @deprecated use orchestrationBaseline */
  previousDescription?: string;
  /** @deprecated use orchestrationBaseline */
  previousWorkflowStepDrafts?: WorkflowStepDraftRow[];
  /** @deprecated use orchestrationBaseline */
  previousOrchestrationMode?: WorkflowOrchestrationMode;
}): Promise<
  | {
      ok: true;
      workflowOrchestrationMode: WorkflowOrchestrationMode;
      description: string;
      workflowStepDrafts?: WorkflowStepDraftRow[];
      workflow: WorkflowDefinition;
    }
  | { ok: false; errorKey: string }
> {
  const persisted = prepareDagOrchestrationPersistPayload({
    mode: params.orchestrationMode,
    workflowStepDrafts: params.workflowStepDrafts,
    heuristicDescription: params.heuristicDescription,
    members: params.members,
  });

  const orchestrationBaseline = params.orchestrationBaseline;
  const orchestration: OrchestrationInputSnapshot = {
    orchestrationMode: params.orchestrationMode,
    workflowStepDrafts: params.workflowStepDrafts,
    heuristicDescription: params.heuristicDescription,
  };

  const resolved = await resolveDagWorkflowForSave({
    executionMode: params.executionMode ?? 'workflow',
    spawnFromGroup: params.spawnFromGroup ?? false,
    groupWorkflow: params.groupWorkflow,
    orchestration,
    orchestrationBaseline,
    previewSyncedKey: params.previewSyncedKey,
    workflow: params.workflow,
    members: params.members,
    agentIds: params.agentIds,
    coordinatorAgentId: params.coordinatorAgentId,
    taskTitle: params.title,
    featureDescription: params.featureDescription,
  });
  if (!resolved.ok) return resolved;

  return {
    ok: true,
    workflowOrchestrationMode: persisted.workflowOrchestrationMode,
    description: persisted.description,
    workflowStepDrafts: persisted.workflowStepDrafts,
    workflow: resolved.workflow,
  };
}
