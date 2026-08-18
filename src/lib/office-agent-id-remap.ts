import type {
  LangGraphWorkflowBundle,
  NodeRunRecord,
  OfficeFixedGroup,
  OfficeTempProject,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowStepDraftRow,
} from '@/types/office';

function remapId(id: string, oldId: string, newId: string): string {
  return id === oldId ? newId : id;
}

function remapIdList(ids: string[] | undefined, oldId: string, newId: string): string[] | undefined {
  if (!ids) return ids;
  const next: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const mapped = remapId(id, oldId, newId);
    if (seen.has(mapped)) continue;
    seen.add(mapped);
    next.push(mapped);
  }
  return next;
}

export function remapWorkflowNodeAgentIds(
  node: WorkflowNode,
  oldId: string,
  newId: string,
): WorkflowNode {
  const agentIds = remapIdList(node.agentIds, oldId, newId);
  const remappedPrimary = remapId(node.agentId, oldId, newId);
  const agentId =
    agentIds && agentIds.length > 0
      ? (agentIds.includes(remappedPrimary) ? remappedPrimary : agentIds[0]!)
      : remappedPrimary;
  return {
    ...node,
    agentId,
    ...(agentIds ? { agentIds } : {}),
  };
}

export function remapWorkflowDefinitionAgentIds(
  workflow: WorkflowDefinition | undefined,
  oldId: string,
  newId: string,
): WorkflowDefinition | undefined {
  if (!workflow) return workflow;
  return {
    ...workflow,
    nodes: workflow.nodes.map((n) => remapWorkflowNodeAgentIds(n, oldId, newId)),
  };
}

export function remapWorkflowStepDraftAgentIds(
  rows: WorkflowStepDraftRow[] | undefined,
  oldId: string,
  newId: string,
): WorkflowStepDraftRow[] | undefined {
  if (!rows) return rows;
  return rows.map((row) => ({
    ...row,
    agentIds: remapIdList(row.agentIds, oldId, newId) ?? [],
  }));
}

export function remapNodeRunAgentIds(
  run: NodeRunRecord,
  oldId: string,
  newId: string,
): NodeRunRecord {
  return {
    ...run,
    agentId: remapId(run.agentId, oldId, newId),
    completedAgentIds: remapIdList(run.completedAgentIds, oldId, newId),
  };
}

export function remapAgentNameHints(
  hints: Record<string, string> | undefined,
  oldId: string,
  newId: string,
): Record<string, string> | undefined {
  if (!hints) return hints;
  const next: Record<string, string> = {};
  for (const [id, name] of Object.entries(hints)) {
    const mapped = remapId(id, oldId, newId);
    const trimmed = name?.trim();
    if (!trimmed) continue;
    // Prefer keeping an existing name already keyed by newId.
    if (next[mapped] && mapped !== id) continue;
    next[mapped] = trimmed;
  }
  return next;
}

export function remapLangGraphWorkflowBundleAgentIds(
  bundle: LangGraphWorkflowBundle | undefined,
  oldId: string,
  newId: string,
): LangGraphWorkflowBundle | undefined {
  if (!bundle) return bundle;
  return {
    ...bundle,
    heuristic: bundle.heuristic
      ? {
        ...bundle.heuristic,
        workflow:
          remapWorkflowDefinitionAgentIds(bundle.heuristic.workflow, oldId, newId)
          ?? bundle.heuristic.workflow,
      }
      : bundle.heuristic,
    custom: bundle.custom
      ? {
        ...bundle.custom,
        workflow:
          remapWorkflowDefinitionAgentIds(bundle.custom.workflow, oldId, newId)
          ?? bundle.custom.workflow,
      }
      : bundle.custom,
  };
}

export function remapFixedGroupAgentIds(
  group: OfficeFixedGroup,
  oldId: string,
  newId: string,
): OfficeFixedGroup {
  return {
    ...group,
    agentIds: remapIdList(group.agentIds, oldId, newId) ?? [],
    coordinatorAgentId: remapId(group.coordinatorAgentId, oldId, newId),
    workflow: remapWorkflowDefinitionAgentIds(group.workflow, oldId, newId) ?? group.workflow,
    workflowStepDrafts: remapWorkflowStepDraftAgentIds(group.workflowStepDrafts, oldId, newId),
    agentNameHints: remapAgentNameHints(group.agentNameHints, oldId, newId),
  };
}

export function remapTempProjectAgentIds(
  project: OfficeTempProject,
  oldId: string,
  newId: string,
): OfficeTempProject {
  return {
    ...project,
    agentIds: remapIdList(project.agentIds, oldId, newId) ?? [],
    coordinatorAgentId: remapId(project.coordinatorAgentId, oldId, newId),
    workflow: remapWorkflowDefinitionAgentIds(project.workflow, oldId, newId),
    workflowStepDrafts: remapWorkflowStepDraftAgentIds(project.workflowStepDrafts, oldId, newId),
    langGraphWorkflowBundle: remapLangGraphWorkflowBundleAgentIds(
      project.langGraphWorkflowBundle,
      oldId,
      newId,
    ),
    agentNameHints: remapAgentNameHints(project.agentNameHints, oldId, newId),
    nodeRuns: project.nodeRuns.map((r) => remapNodeRunAgentIds(r, oldId, newId)),
  };
}

/** Keep only agent ids present in the member set (drops renamed/deleted orphans). */
export function stripUnknownWorkflowStepDraftAgentIds(
  rows: WorkflowStepDraftRow[],
  memberAgentIds: string[],
): WorkflowStepDraftRow[] {
  const memberSet = new Set(memberAgentIds);
  return rows.map((row) => ({
    ...row,
    agentIds: row.agentIds.filter((id) => memberSet.has(id)),
  }));
}

export function orphanWorkflowStepDraftAgentIds(
  agentIds: string[],
  memberAgentIds: string[],
  catalogAgentIds?: string[],
): string[] {
  const members = new Set(memberAgentIds);
  const catalog = catalogAgentIds ? new Set(catalogAgentIds) : null;
  return agentIds.filter((id) => {
    if (!members.has(id)) return true;
    if (catalog && !catalog.has(id)) return true;
    return false;
  });
}
