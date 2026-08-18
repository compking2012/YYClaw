import type { OfficeTaskExecutionMode, OfficeTempProject, WorkflowDefinition } from '@/types/office';
import { filterKnownAgentIds } from '@/lib/office-group-agents';
import {
  missingDraftRowAgentIds,
  sanitizeOfficeWorkflowRefsOnEditOpen,
  buildSessionStripWorkflowSnapshot,
  type OfficeAgentRefEntity,
} from '@/lib/office-missing-agents';
import { emptyWorkflow } from '@/lib/office-workflow-roles';
import { emptyWorkflowStepDraftRows, resolveWorkflowStepDraftRows } from '@/lib/office-workflow-step-drafts';
import {
  heuristicDescriptionForForm,
  orchestrationModeFromProject,
} from '@/lib/office-workflow-orchestration-mode';
import { projectMembersFromIds } from '@/lib/office-project-members';
import type { WorkflowOrchestrationMode, WorkflowStepDraftRow } from '@/types/office';

export type StandaloneUpgradeGroupSeed = {
  name: string;
  description: string;
  agentIds: string[];
  coordinatorAgentId: string;
  executionMode: Extract<OfficeTaskExecutionMode, 'smart' | 'workflow'>;
  workflowOrchestrationMode: WorkflowOrchestrationMode;
  heuristicWorkflowDescription: string;
  workflowDescription: string;
  workflowStepDrafts: WorkflowStepDraftRow[];
  workflow: WorkflowDefinition;
  stepMissingAgentIds?: string[][];
  agentNameHints?: Record<string, string>;
  sessionStripSnapshot?: import('@/lib/office-missing-agents').SessionStripWorkflowSnapshot;
  openAgentRefSnapshot?: OfficeAgentRefEntity;
};

/** 自建项目升级为固定组时，预填新建固定组向导的草稿。 */
export function groupDraftSeedFromStandaloneProject(
  project: OfficeTempProject,
  agents: Array<{ id: string; name?: string }>,
): StandaloneUpgradeGroupSeed {
  const catalogIds = agents.map((a) => a.id);
  // Keep missing roster ids so upgrade wizard can surface warnings.
  // Preserve orphan coordinator in roster (do not silently rewrite to another member).
  const agentIds = [...project.agentIds];
  const coordinatorAgentId = project.coordinatorAgentId;
  if (coordinatorAgentId && !agentIds.includes(coordinatorAgentId)) {
    agentIds.push(coordinatorAgentId);
  }
  const executionMode = project.executionMode === 'smart' ? 'smart' : 'workflow';
  const workflowOrchestrationMode = orchestrationModeFromProject(project);
  const knownMembers = projectMembersFromIds(
    filterKnownAgentIds(agentIds, agents),
    (id) => agents.find((a) => a.id === id)?.name,
  );
  const draftsBefore =
    workflowOrchestrationMode === 'rule'
      ? resolveWorkflowStepDraftRows(project.workflowStepDrafts, undefined, knownMembers)
      : emptyWorkflowStepDraftRows();
  const stepMissingAgentIds = draftsBefore.map((row) =>
    missingDraftRowAgentIds(row.agentIds, catalogIds),
  );
  const bundle = project.langGraphWorkflowBundle;
  const bundleSnapshot = bundle ? structuredClone(bundle) : undefined;
  const langGraphTab = bundle?.activeSource ?? 'heuristic';
  const workflowSnapshot = structuredClone(project.workflow ?? emptyWorkflow('dag'));
  const draftsSnapshot = structuredClone(draftsBefore);
  const openAgentRefSnapshot: OfficeAgentRefEntity = {
    agentIds: [...agentIds],
    coordinatorAgentId,
    workflow: workflowSnapshot,
    workflowStepDrafts: draftsSnapshot,
    langGraphWorkflowBundle: bundleSnapshot,
    agentNameHints: project.agentNameHints ? { ...project.agentNameHints } : undefined,
  };
  const sanitized = sanitizeOfficeWorkflowRefsOnEditOpen(
    {
      workflow: workflowSnapshot,
      workflowStepDrafts: draftsSnapshot,
      langGraphWorkflowBundle: bundleSnapshot,
      langGraphTab,
    },
    catalogIds,
  );
  const openWorkflow =
    executionMode === 'smart'
      ? emptyWorkflow('dag')
      : (sanitized.workflow ?? emptyWorkflow('dag'));
  const openDrafts =
    workflowOrchestrationMode === 'rule'
      ? (sanitized.workflowStepDrafts ?? emptyWorkflowStepDraftRows())
      : emptyWorkflowStepDraftRows();
  return {
    name: '',
    description: '',
    agentIds,
    coordinatorAgentId,
    executionMode,
    workflowOrchestrationMode,
    heuristicWorkflowDescription: heuristicDescriptionForForm({
      orchestrationMode: workflowOrchestrationMode,
      storedDescription: project.description,
    }),
    workflowDescription: project.description?.trim() ?? '',
    workflowStepDrafts: openDrafts,
    workflow: openWorkflow,
    stepMissingAgentIds,
    agentNameHints: project.agentNameHints ? { ...project.agentNameHints } : undefined,
    openAgentRefSnapshot,
    sessionStripSnapshot: buildSessionStripWorkflowSnapshot({
      persistedWorkflow: workflowSnapshot,
      persistedWorkflowStepDrafts: draftsSnapshot,
      openWorkflow,
      openWorkflowStepDrafts: openDrafts,
    }),
  };
}
