import { workflowNodeAgentIds } from '@/lib/office-workflow-node';
import { stripUnknownWorkflowStepDraftAgentIds } from '@/lib/office-agent-id-remap';
import {
  resolveActiveLangGraphWorkflow,
  resolveLangGraphBranchWorkflow,
} from '@/lib/office-langgraph-workflow-bundle';
import {
  displayAgentsForProject,
  workflowForProject,
  workflowStepDraftsForProject,
} from '@/lib/office-task-workflow';
import { ensureCoordinatorInTeam } from '@/lib/office-workflow-roles';
import { isWorkflowStepDraftRowEmpty } from '@/lib/office-workflow-step-drafts';
import type {
  LangGraphWorkflowBundle,
  LangGraphWorkflowSource,
  OfficeFixedGroup,
  OfficeTempProject,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowStepDraftRow,
} from '@/types/office';

export type OfficeAgentRefEntity = {
  agentIds?: string[];
  coordinatorAgentId?: string;
  workflow?: WorkflowDefinition;
  workflowStepDrafts?: WorkflowStepDraftRow[];
  langGraphWorkflowBundle?: LangGraphWorkflowBundle;
  /** Last-known display names for deleted/renamed agents. */
  agentNameHints?: Record<string, string>;
};

function pushWorkflowNodeRefs(
  workflow: WorkflowDefinition | undefined,
  push: (id: string | undefined) => void,
): void {
  for (const node of workflow?.nodes ?? []) {
    for (const id of workflowNodeAgentIds(node)) push(id);
  }
}

/** Collect unique agent ids referenced by roster + coordinator + workflow + drafts + LangGraph. */
export function collectOfficeAgentRefs(entity: OfficeAgentRefEntity): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (id: string | undefined) => {
    const trimmed = id?.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(trimmed);
  };
  for (const id of entity.agentIds ?? []) push(id);
  push(entity.coordinatorAgentId);
  pushWorkflowNodeRefs(entity.workflow, push);
  for (const row of entity.workflowStepDrafts ?? []) {
    for (const id of row.agentIds ?? []) push(id);
  }
  const bundle = entity.langGraphWorkflowBundle;
  if (bundle) {
    pushWorkflowNodeRefs(bundle.heuristic?.workflow, push);
    pushWorkflowNodeRefs(bundle.custom?.workflow, push);
  }
  return out;
}

/**
 * Effective refs for a temp project: merge inherited group roster/workflow/drafts
 * when `inheritsGroupTemplate` is active.
 */
export function resolveProjectAgentRefEntity(
  project: Pick<
    OfficeTempProject,
    | 'agentIds'
    | 'coordinatorAgentId'
    | 'origin'
    | 'parentGroupId'
    | 'inheritsGroupTemplate'
    | 'workflow'
    | 'workflowStepDrafts'
    | 'executionMode'
    | 'langGraphWorkflowBundle'
    | 'agentNameHints'
  >,
  group?: Pick<
    OfficeFixedGroup,
    | 'agentIds'
    | 'coordinatorAgentId'
    | 'workflow'
    | 'workflowDescription'
    | 'workflowStepDrafts'
    | 'workflowOrchestrationMode'
    | 'agentNameHints'
  > | null,
): OfficeAgentRefEntity {
  const agents = displayAgentsForProject(project, group);
  return {
    agentIds: agents.agentIds,
    coordinatorAgentId: agents.coordinatorAgentId,
    workflow: workflowForProject(project, group),
    workflowStepDrafts: workflowStepDraftsForProject(project, group),
    langGraphWorkflowBundle: project.langGraphWorkflowBundle,
    agentNameHints: {
      ...(group?.agentNameHints ?? {}),
      ...(project.agentNameHints ?? {}),
    },
  };
}

export function missingOfficeAgentIds(
  refs: string[],
  catalogAgentIds: Iterable<string>,
): string[] {
  const known = new Set(
    [...catalogAgentIds].map((id) => id.trim()).filter(Boolean),
  );
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const id of refs) {
    const trimmed = id.trim();
    if (!trimmed || known.has(trimmed) || seen.has(trimmed)) continue;
    seen.add(trimmed);
    missing.push(trimmed);
  }
  return missing;
}

export function missingAgentsForOfficeEntity(
  entity: OfficeAgentRefEntity,
  catalogAgentIds: Iterable<string>,
): string[] {
  return missingOfficeAgentIds(collectOfficeAgentRefs(entity), catalogAgentIds);
}

export function hasMissingOfficeAgents(
  entity: OfficeAgentRefEntity,
  catalogAgentIds: Iterable<string>,
): boolean {
  if (missingAgentsForOfficeEntity(entity, catalogAgentIds).length > 0) return true;
  return entityHasUnassignedWorkflowAgents(entity);
}

/** True when a persisted/materialized workflow node has no assigned agent. */
export function workflowHasUnassignedAgentNodes(
  workflow: WorkflowDefinition | undefined,
): boolean {
  for (const node of workflow?.nodes ?? []) {
    if (workflowNodeAgentIds(node).length === 0) return true;
  }
  return false;
}

export function entityHasUnassignedWorkflowAgents(entity: OfficeAgentRefEntity): boolean {
  if (workflowHasUnassignedAgentNodes(entity.workflow)) return true;
  const bundle = entity.langGraphWorkflowBundle;
  if (!bundle) return false;
  return (
    workflowHasUnassignedAgentNodes(bundle.heuristic?.workflow)
    || workflowHasUnassignedAgentNodes(bundle.custom?.workflow)
  );
}

/**
 * Empty-node check scoped to the branch that will actually execute.
 *
 * At runtime only the LangGraph active branch runs
 * (`resolveActiveLangGraphWorkflow`; runner falls back to the DAG mirror only
 * when the active branch has no nodes). The inactive branch may retain empty
 * nodes after an unbind cascade strip, but it is neither executed nor editable
 * in the current tab — blocking on it would be a false positive with no way to
 * fix it. Use this (not `entityHasUnassignedWorkflowAgents`) for run/spawn/insert
 * asserts; keep the two-branch scan for list badges that merely prompt cleanup.
 */
export function entityHasUnassignedActiveWorkflowAgents(entity: OfficeAgentRefEntity): boolean {
  const bundle = entity.langGraphWorkflowBundle;
  if (bundle) {
    const active = resolveActiveLangGraphWorkflow(bundle);
    if (active && active.nodes.length > 0) {
      return workflowHasUnassignedAgentNodes(active);
    }
    // Active branch empty → runner materializes from the DAG mirror; check that.
  }
  return workflowHasUnassignedAgentNodes(entity.workflow);
}

export function missingRosterAgentIds(
  agentIds: string[] | undefined,
  catalogAgentIds: Iterable<string>,
): string[] {
  return missingOfficeAgentIds(agentIds ?? [], catalogAgentIds);
}

export function missingDraftRowAgentIds(
  agentIds: string[] | undefined,
  catalogAgentIds: Iterable<string>,
): string[] {
  return missingOfficeAgentIds(agentIds ?? [], catalogAgentIds);
}

/** Roster missing + coordinator missing (even if coordinator is not in agentIds). */
export function missingRosterAndCoordinatorIds(
  agentIds: string[] | undefined,
  coordinatorAgentId: string | undefined,
  catalogAgentIds: Iterable<string>,
): string[] {
  const roster = missingRosterAgentIds(agentIds, catalogAgentIds);
  const coord = coordinatorAgentId?.trim();
  if (!coord) return roster;
  const known = new Set(
    [...catalogAgentIds].map((id) => id.trim()).filter(Boolean),
  );
  if (known.has(coord) || roster.includes(coord)) return roster;
  return [...roster, coord];
}

/** Keep orphan coordinator in roster so edit UI can show a red chip (no silent rewrite). */
export function ensureMissingCoordinatorInRoster(
  agentIds: string[],
  coordinatorAgentId: string | undefined,
): string[] {
  const next = [...agentIds];
  const coord = coordinatorAgentId?.trim();
  if (coord && !next.includes(coord)) next.push(coord);
  return next;
}

/**
 * Save-time coordinator policy:
 * - If coordinator is still listed in agentIds (including missing), keep it.
 * - Otherwise fall back among catalog-known roster members only.
 * - Never re-bind an unbound orphan when no known members remain.
 */
export function preserveCoordinatorForSave(params: {
  coordinatorId: string | undefined;
  agentIds: string[];
  catalogAgentIds: Iterable<string>;
}): string {
  const coord = params.coordinatorId?.trim() ?? '';
  const roster = params.agentIds.map((id) => id.trim()).filter(Boolean);
  // Explicit clear (unbind coordinator chip) must stay empty until the user re-picks.
  if (!coord) return '';
  if (roster.includes(coord)) return coord;
  const known = new Set(
    [...params.catalogAgentIds].map((id) => id.trim()).filter(Boolean),
  );
  const knownRoster = roster.filter((id) => known.has(id));
  if (knownRoster.length === 0) return '';
  return ensureCoordinatorInTeam(
    known.has(coord) ? coord : '',
    knownRoster,
    knownRoster[0] ?? '',
  );
}

/** Resolve display labels: prefer catalog/history name map, else raw id. */
export function resolveMissingAgentLabels(
  missingIds: string[],
  nameById?: ReadonlyMap<string, string> | Record<string, string | undefined>,
): string[] {
  const lookup = (id: string): string => {
    if (!nameById) return id;
    if (nameById instanceof Map) {
      const name = nameById.get(id)?.trim();
      return name || id;
    }
    const record = nameById as Record<string, string | undefined>;
    const name = record[id]?.trim();
    return name || id;
  };
  return missingIds.map(lookup);
}

/**
 * Dynamic missing-agent copy (i18n keys under office:missingAgents.label*).
 * - 1: `{A}缺失`
 * - 2: `{A}、{B}缺失`
 * - ≥3: `{A}等{n}个智能体缺失`
 */
export type MissingAgentsLabelTranslator = (
  key: 'missingAgents.labelOne' | 'missingAgents.labelTwo' | 'missingAgents.labelMany',
  options: Record<string, string | number>,
) => string;

export function formatMissingAgentsLabel(
  labels: string[],
  t?: MissingAgentsLabelTranslator,
): string {
  const names = labels.map((s) => s.trim()).filter(Boolean);
  if (names.length === 0) return '';
  if (t) {
    if (names.length === 1) return t('missingAgents.labelOne', { name: names[0]! });
    if (names.length === 2) {
      return t('missingAgents.labelTwo', { a: names[0]!, b: names[1]! });
    }
    return t('missingAgents.labelMany', { name: names[0]!, count: names.length });
  }
  // Fallback for non-UI callers / unit tests without i18n.
  if (names.length === 1) return `${names[0]}缺失`;
  if (names.length === 2) return `${names[0]}、${names[1]}缺失`;
  return `${names[0]}等${names.length}个智能体缺失`;
}

export function formatMissingAgentsLabelForIds(
  missingIds: string[],
  nameById?: ReadonlyMap<string, string> | Record<string, string | undefined>,
  t?: MissingAgentsLabelTranslator,
): string {
  return formatMissingAgentsLabel(resolveMissingAgentLabels(missingIds, nameById), t);
}

/** Snapshot so edit-open strip stays session-only unless orchestration is edited. */
export type SessionStripWorkflowSnapshot = {
  persistedWorkflow: WorkflowDefinition;
  persistedWorkflowStepDrafts: WorkflowStepDraftRow[];
  openWorkflow: WorkflowDefinition;
  openWorkflowStepDrafts: WorkflowStepDraftRow[];
};

export function buildSessionStripWorkflowSnapshot(params: {
  persistedWorkflow: WorkflowDefinition;
  persistedWorkflowStepDrafts: WorkflowStepDraftRow[];
  openWorkflow: WorkflowDefinition;
  openWorkflowStepDrafts: WorkflowStepDraftRow[];
}): SessionStripWorkflowSnapshot {
  return {
    persistedWorkflow: structuredClone(params.persistedWorkflow),
    persistedWorkflowStepDrafts: structuredClone(params.persistedWorkflowStepDrafts),
    openWorkflow: structuredClone(params.openWorkflow),
    openWorkflowStepDrafts: structuredClone(params.openWorkflowStepDrafts),
  };
}

/**
 * Persist edit-time workflow/drafts on save.
 * Ghost agent ids stripped at edit-open must NOT be restored on title-only save.
 */
export function applySessionOnlyStripOnSave<T extends {
  workflow: WorkflowDefinition;
  workflowStepDrafts: WorkflowStepDraftRow[];
}>(
  current: T,
  _snapshot?: SessionStripWorkflowSnapshot,
  _options?: { forcePersistCurrent?: boolean },
): T {
  return current;
}

export function stripUnknownWorkflowNodeAgentIds(
  node: WorkflowNode,
  catalogAgentIds: Iterable<string>,
): WorkflowNode {
  const known = new Set(
    [...catalogAgentIds].map((id) => id.trim()).filter(Boolean),
  );
  const kept = workflowNodeAgentIds(node).filter((id) => known.has(id));
  if (kept.length === 0) {
    return { ...node, agentId: '', agentIds: undefined };
  }
  return {
    ...node,
    agentId: kept[0]!,
    agentIds: kept.length > 1 ? kept : undefined,
  };
}

export function stripUnknownWorkflowDefinitionAgentIds(
  workflow: WorkflowDefinition | undefined,
  catalogAgentIds: Iterable<string>,
): WorkflowDefinition | undefined {
  if (!workflow) return workflow;
  return {
    ...workflow,
    nodes: workflow.nodes.map((n) => stripUnknownWorkflowNodeAgentIds(n, catalogAgentIds)),
  };
}

/** Remove specific agent id(s) from a workflow node (empty agentId when none remain). */
export function stripAgentIdsFromWorkflowNode(
  node: WorkflowNode,
  removeAgentIds: Iterable<string>,
): WorkflowNode {
  const remove = new Set([...removeAgentIds].map((id) => id.trim()).filter(Boolean));
  if (remove.size === 0) return node;
  const kept = workflowNodeAgentIds(node).filter((id) => !remove.has(id));
  if (kept.length === 0) {
    return { ...node, agentId: '', agentIds: undefined };
  }
  return {
    ...node,
    agentId: kept[0]!,
    agentIds: kept.length > 1 ? kept : undefined,
  };
}

export function stripAgentIdsFromWorkflowDefinition(
  workflow: WorkflowDefinition | undefined,
  removeAgentIds: Iterable<string>,
): WorkflowDefinition | undefined {
  if (!workflow) return workflow;
  const remove = [...removeAgentIds].map((id) => id.trim()).filter(Boolean);
  if (remove.length === 0) return workflow;
  return {
    ...workflow,
    nodes: workflow.nodes.map((n) => stripAgentIdsFromWorkflowNode(n, remove)),
  };
}

export function stripAgentIdsFromWorkflowStepDrafts(
  rows: WorkflowStepDraftRow[] | undefined,
  removeAgentIds: Iterable<string>,
): WorkflowStepDraftRow[] | undefined {
  if (!rows) return rows;
  const remove = new Set([...removeAgentIds].map((id) => id.trim()).filter(Boolean));
  if (remove.size === 0) return rows;
  return rows.map((row) => ({
    ...row,
    agentIds: row.agentIds.filter((id) => !remove.has(id)),
  }));
}

/**
 * Immediately clear unbound agent refs from DAG workflow, step drafts, and every
 * LangGraph bundle branch (heuristic + custom). Nodes/steps become unassigned when
 * no agents remain.
 */
export function stripAgentIdsFromOfficeWorkflowRefs<T extends {
  workflow?: WorkflowDefinition;
  workflowStepDrafts?: WorkflowStepDraftRow[];
  langGraphWorkflowBundle?: LangGraphWorkflowBundle;
}>(draft: T, removeAgentIds: Iterable<string>): T {
  const remove = [...removeAgentIds].map((id) => id.trim()).filter(Boolean);
  if (remove.length === 0) return draft;

  const workflow = stripAgentIdsFromWorkflowDefinition(draft.workflow, remove);
  const workflowStepDrafts = stripAgentIdsFromWorkflowStepDrafts(draft.workflowStepDrafts, remove);

  let langGraphWorkflowBundle = draft.langGraphWorkflowBundle;
  if (langGraphWorkflowBundle) {
    const next = { ...langGraphWorkflowBundle };
    let changed = false;
    if (next.heuristic?.workflow) {
      const stripped = stripAgentIdsFromWorkflowDefinition(next.heuristic.workflow, remove);
      if (stripped) {
        next.heuristic = { ...next.heuristic, workflow: stripped };
        changed = true;
      }
    }
    if (next.custom?.workflow) {
      const stripped = stripAgentIdsFromWorkflowDefinition(next.custom.workflow, remove);
      if (stripped) {
        next.custom = { ...next.custom, workflow: stripped };
        changed = true;
      }
    }
    if (changed) langGraphWorkflowBundle = next;
  }

  return {
    ...draft,
    ...(workflow ? { workflow } : {}),
    ...(workflowStepDrafts ? { workflowStepDrafts } : {}),
    ...(langGraphWorkflowBundle ? { langGraphWorkflowBundle } : {}),
  };
}

/**
 * Edit-open sanitize: strip deleted agents from workflow nodes + step drafts +
 * visible LangGraph branch. Roster agentIds are intentionally left untouched.
 */
export function sanitizeOfficeWorkflowRefsOnEditOpen<T extends {
  workflow?: WorkflowDefinition;
  workflowStepDrafts?: WorkflowStepDraftRow[];
  langGraphWorkflowBundle?: LangGraphWorkflowBundle;
  langGraphTab?: LangGraphWorkflowSource;
}>(
  draft: T,
  catalogAgentIds: Iterable<string>,
): T {
  const catalog = [...catalogAgentIds].map((id) => id.trim()).filter(Boolean);
  const workflow = stripUnknownWorkflowDefinitionAgentIds(draft.workflow, catalog);
  const workflowStepDrafts = draft.workflowStepDrafts
    ? stripUnknownWorkflowStepDraftAgentIds(draft.workflowStepDrafts, catalog)
    : draft.workflowStepDrafts;
  let langGraphWorkflowBundle = draft.langGraphWorkflowBundle;
  if (langGraphWorkflowBundle) {
    const source = draft.langGraphTab
      ?? langGraphWorkflowBundle.activeSource
      ?? 'heuristic';
    const branch = resolveLangGraphBranchWorkflow(langGraphWorkflowBundle, source);
    if (branch) {
      const stripped = stripUnknownWorkflowDefinitionAgentIds(branch, catalog);
      if (stripped) {
        langGraphWorkflowBundle = {
          ...langGraphWorkflowBundle,
          ...(source === 'custom'
            ? {
              custom: {
                ...(langGraphWorkflowBundle.custom ?? { savedAt: 0, workflow: stripped }),
                workflow: stripped,
              },
            }
            : {
              heuristic: {
                ...(langGraphWorkflowBundle.heuristic ?? {
                  savedAt: 0,
                  description: '',
                  workflow: stripped,
                }),
                workflow: stripped,
              },
            }),
        };
      }
    }
  }
  return {
    ...draft,
    ...(workflow ? { workflow } : {}),
    ...(workflowStepDrafts ? { workflowStepDrafts } : {}),
    ...(langGraphWorkflowBundle ? { langGraphWorkflowBundle } : {}),
  };
}

export function catalogIdSetFromAgents(
  agents: Array<{ id: string }>,
): Set<string> {
  return new Set(agents.map((a) => a.id.trim()).filter(Boolean));
}

export function nameMapFromAgents(
  agents: Array<{ id: string; name?: string }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const agent of agents) {
    const id = agent.id.trim();
    if (!id) continue;
    const name = agent.name?.trim();
    if (name) map.set(id, name);
  }
  return map;
}

/** Merge catalog names over historical hints (catalog wins for live agents). */
export function mergeAgentNameMaps(
  ...sources: Array<ReadonlyMap<string, string> | Record<string, string | undefined> | undefined>
): Map<string, string> {
  const map = new Map<string, string>();
  for (const source of sources) {
    if (!source) continue;
    if (source instanceof Map) {
      for (const [id, name] of source) {
        const trimmed = name?.trim();
        if (id.trim() && trimmed) map.set(id.trim(), trimmed);
      }
      continue;
    }
    for (const [id, name] of Object.entries(source)) {
      const trimmed = name?.trim();
      if (id.trim() && trimmed) map.set(id.trim(), trimmed);
    }
  }
  return map;
}

/** Stamp/refresh name hints for all refs that currently have a catalog display name. */
export function stampAgentNameHints(
  entity: OfficeAgentRefEntity,
  agents: Array<{ id: string; name?: string }>,
  previous?: Record<string, string>,
): Record<string, string> {
  const next: Record<string, string> = { ...(previous ?? entity.agentNameHints ?? {}) };
  const catalogNames = nameMapFromAgents(agents);
  for (const id of collectOfficeAgentRefs(entity)) {
    const name = catalogNames.get(id);
    if (name) next[id] = name;
  }
  return next;
}

export function spliceStepMissingAgentIds(
  stepMissingAgentIds: string[][] | undefined,
  index: number,
): string[][] | undefined {
  if (!stepMissingAgentIds) return stepMissingAgentIds;
  if (index < 0 || index >= stepMissingAgentIds.length) return stepMissingAgentIds;
  return stepMissingAgentIds.filter((_, i) => i !== index);
}

/** Fixed-group / project list entity helpers. */
export function fixedGroupHasMissingAgents(
  group: Pick<
    OfficeFixedGroup,
    'agentIds' | 'coordinatorAgentId' | 'workflow' | 'workflowStepDrafts' | 'agentNameHints'
  >,
  catalogAgentIds: Iterable<string>,
): boolean {
  return hasMissingOfficeAgents(group, catalogAgentIds);
}

export function tempProjectHasMissingAgents(
  project: Pick<
    OfficeTempProject,
    | 'agentIds'
    | 'coordinatorAgentId'
    | 'origin'
    | 'parentGroupId'
    | 'inheritsGroupTemplate'
    | 'workflow'
    | 'workflowStepDrafts'
    | 'executionMode'
    | 'langGraphWorkflowBundle'
    | 'agentNameHints'
  >,
  catalogAgentIds: Iterable<string>,
  group?: Pick<
    OfficeFixedGroup,
    | 'agentIds'
    | 'coordinatorAgentId'
    | 'workflow'
    | 'workflowDescription'
    | 'workflowStepDrafts'
    | 'workflowOrchestrationMode'
    | 'agentNameHints'
  > | null,
): boolean {
  return hasMissingOfficeAgents(resolveProjectAgentRefEntity(project, group), catalogAgentIds);
}

// ── Shared edit/list missing-agents model (phase-1 core) ─────────────────────

export type OfficeMissingNodeKind = 'step_draft' | 'workflow' | 'langgraph';

export type OfficeMissingNodeView = {
  key: string;
  kind: OfficeMissingNodeKind;
  agentIdsBeforeStrip: string[];
  missingIds: string[];
  remainingIds: string[];
  /** remainingIds.length === 0 (includes originally empty nodes). */
  isEmpty: boolean;
  /** Node had missing agents before strip — show fixed「智能体缺失」badge + red frame. */
  showMissingBadge: boolean;
};

export type OfficeEditSaveGate = 'allow' | 'confirm' | 'block';
export type OfficeEditSaveBlockReason = 'coordinator_missing' | 'empty_node';

export type OfficeMissingAgentsModel = {
  hasMissing: boolean;
  missingIds: string[];
  coordinatorMissing: boolean;
  nodes: OfficeMissingNodeView[];
  saveGate: OfficeEditSaveGate;
  saveBlockReasons: OfficeEditSaveBlockReason[];
  /**
   * Still-missing set for confirm dialogs:
   * open node-snapshot missing ∪ current entity missing.
   */
  confirmMissingIds: string[];
};

export type ArchivedRestartMissingAction = 'direct' | 'confirm';

function catalogSet(catalogAgentIds: Iterable<string>): Set<string> {
  return new Set([...catalogAgentIds].map((id) => id.trim()).filter(Boolean));
}

function partitionNodeAgentIds(
  agentIds: string[],
  known: Set<string>,
): { missingIds: string[]; remainingIds: string[] } {
  const missingIds: string[] = [];
  const remainingIds: string[] = [];
  const seenMissing = new Set<string>();
  const seenRemaining = new Set<string>();
  for (const raw of agentIds) {
    const id = raw.trim();
    if (!id) continue;
    if (known.has(id)) {
      if (!seenRemaining.has(id)) {
        seenRemaining.add(id);
        remainingIds.push(id);
      }
    } else if (!seenMissing.has(id)) {
      seenMissing.add(id);
      missingIds.push(id);
    }
  }
  return { missingIds, remainingIds };
}

function buildNodeView(
  key: string,
  kind: OfficeMissingNodeKind,
  agentIds: string[],
  known: Set<string>,
): OfficeMissingNodeView {
  const agentIdsBeforeStrip = agentIds.map((id) => id.trim()).filter(Boolean);
  const { missingIds, remainingIds } = partitionNodeAgentIds(agentIdsBeforeStrip, known);
  return {
    key,
    kind,
    agentIdsBeforeStrip,
    missingIds,
    remainingIds,
    isEmpty: remainingIds.length === 0,
    showMissingBadge: missingIds.length > 0,
  };
}

/** Edit-gate nodes: contentful step rows + DAG nodes + visible LangGraph branch nodes. */
export function collectOfficeEditGateNodes(
  entity: OfficeAgentRefEntity,
  catalogAgentIds: Iterable<string>,
  options?: { langGraphActiveSource?: LangGraphWorkflowSource },
): OfficeMissingNodeView[] {
  const known = catalogSet(catalogAgentIds);
  const nodes: OfficeMissingNodeView[] = [];

  (entity.workflowStepDrafts ?? []).forEach((row, index) => {
    if (isWorkflowStepDraftRowEmpty(row)) return;
    nodes.push(buildNodeView(`step:${index}`, 'step_draft', row.agentIds ?? [], known));
  });

  for (const node of entity.workflow?.nodes ?? []) {
    nodes.push(
      buildNodeView(`workflow:${node.id}`, 'workflow', workflowNodeAgentIds(node), known),
    );
  }

  const bundle = entity.langGraphWorkflowBundle;
  if (bundle) {
    const source = options?.langGraphActiveSource ?? bundle.activeSource ?? 'heuristic';
    const branch = resolveLangGraphBranchWorkflow(bundle, source);
    for (const node of branch?.nodes ?? []) {
      nodes.push(
        buildNodeView(
          `langgraph:${source}:${node.id}`,
          'langgraph',
          workflowNodeAgentIds(node),
          known,
        ),
      );
    }
  }

  return nodes;
}

function uniqueIds(ids: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Build the shared missing-agents model from a pre-strip (persisted) entity.
 * Pass `currentEntity` (post-strip form) when re-evaluating confirmMissingIds after edits.
 */
export function buildOfficeMissingAgentsModel(params: {
  entity: OfficeAgentRefEntity;
  catalogAgentIds: Iterable<string>;
  langGraphActiveSource?: LangGraphWorkflowSource;
  /** Post-strip / current form entity for confirm union; defaults to `entity`. */
  currentEntity?: OfficeAgentRefEntity;
  /**
   * Open-time node missing ids (from pre-strip snapshot). Defaults to missing on
   * `collectOfficeEditGateNodes(entity)`.
   */
  openNodeMissingIds?: string[];
}): OfficeMissingAgentsModel {
  const {
    entity,
    catalogAgentIds,
    langGraphActiveSource,
    currentEntity = entity,
  } = params;
  const known = catalogSet(catalogAgentIds);
  const nodes = collectOfficeEditGateNodes(entity, catalogAgentIds, { langGraphActiveSource });
  const missingIds = missingAgentsForOfficeEntity(entity, catalogAgentIds);
  const hasMissing =
    missingIds.length > 0 || entityHasUnassignedWorkflowAgents(entity);
  const coord = entity.coordinatorAgentId?.trim() ?? '';
  const coordinatorMissing = Boolean(coord) && !known.has(coord);

  const openNodeMissingIds = params.openNodeMissingIds
    ?? uniqueIds(nodes.flatMap((n) => n.missingIds));
  const currentMissingIds = missingAgentsForOfficeEntity(currentEntity, catalogAgentIds);
  const confirmMissingIds = uniqueIds([...openNodeMissingIds, ...currentMissingIds]);

  // Coordinator for gate follows current form when provided.
  const currentCoord = currentEntity.coordinatorAgentId?.trim() ?? '';
  const currentCoordinatorMissing = Boolean(currentCoord) && !known.has(currentCoord);
  const currentKnownRoster = (currentEntity.agentIds ?? [])
    .map((id) => id.trim())
    .filter((id) => id && known.has(id));
  // After unbinding a missing coordinator the field is '' — still block save until
  // the user explicitly picks a known member (do not silently auto-assign).
  const currentCoordinatorUnset = !currentCoord && currentKnownRoster.length > 0;

  // Empty-node save gate follows the current edit form (after strip / user fixes).
  // Open-time emptiness alone must not permanently block save once the user assigns agents.
  const currentNodes = collectOfficeEditGateNodes(currentEntity, catalogAgentIds, {
    langGraphActiveSource,
  });
  const hasEmptyNode = currentNodes.some((n) => n.isEmpty);

  const saveBlockReasons: OfficeEditSaveBlockReason[] = [];
  if (currentCoordinatorMissing || currentCoordinatorUnset) {
    saveBlockReasons.push('coordinator_missing');
  }
  if (hasEmptyNode) saveBlockReasons.push('empty_node');

  let saveGate: OfficeEditSaveGate = 'allow';
  if (saveBlockReasons.length > 0) saveGate = 'block';
  else if (confirmMissingIds.length > 0) saveGate = 'confirm';

  return {
    hasMissing,
    missingIds,
    coordinatorMissing: currentCoordinatorMissing || currentCoordinatorUnset || coordinatorMissing,
    nodes,
    saveGate,
    saveBlockReasons,
    confirmMissingIds,
  };
}

export function explainOfficeEditSaveGate(
  model: Pick<OfficeMissingAgentsModel, 'saveGate' | 'saveBlockReasons' | 'confirmMissingIds'>,
): {
  saveGate: OfficeEditSaveGate;
  saveBlockReasons: OfficeEditSaveBlockReason[];
  confirmMissingIds: string[];
  blocked: boolean;
  needsConfirm: boolean;
} {
  return {
    saveGate: model.saveGate,
    saveBlockReasons: model.saveBlockReasons,
    confirmMissingIds: model.confirmMissingIds,
    blocked: model.saveGate === 'block',
    needsConfirm: model.saveGate === 'confirm',
  };
}

/** Archived restart: never gray the button; confirm only when missing. */
export function archivedRestartMissingAction(hasMissing: boolean): ArchivedRestartMissingAction {
  return hasMissing ? 'confirm' : 'direct';
}

const OFFICE_SAVE_BLOCK_REASON_I18N_KEY: Record<OfficeEditSaveBlockReason, string> = {
  coordinator_missing: 'missingAgents.saveBlockedCoordinator',
  empty_node: 'missingAgents.saveBlockedEmptyNode',
};

/**
 * Translate all active save-block reasons and join them, so a save blocked by
 * both a missing coordinator AND an empty node surfaces both causes (previously
 * only the coordinator reason was shown).
 */
export function formatOfficeSaveBlockedMessage(
  reasons: ReadonlyArray<OfficeEditSaveBlockReason>,
  t: (key: string) => string,
  separator = '；',
): string {
  const ordered: OfficeEditSaveBlockReason[] = ['coordinator_missing', 'empty_node'];
  const seen = new Set<OfficeEditSaveBlockReason>();
  const parts: string[] = [];
  for (const reason of ordered) {
    if (reasons.includes(reason) && !seen.has(reason)) {
      seen.add(reason);
      parts.push(t(OFFICE_SAVE_BLOCK_REASON_I18N_KEY[reason]));
    }
  }
  return parts.join(separator);
}

const OFFICE_MISSING_NODE_FRAME =
  'border-destructive/60 ring-1 ring-destructive/25';

/** Red frame for edit nodes with open-time missing agents (step / DAG / LangGraph). */
export function officeMissingNodeFrameClass(showMissingBadge: boolean): string {
  return showMissingBadge ? OFFICE_MISSING_NODE_FRAME : '';
}

/** Whole fixed-group card border when roster/workflow refs are missing. */
export function fixedGroupCardBorderClass(hasMissingAgents: boolean): string {
  return hasMissingAgents ? OFFICE_MISSING_NODE_FRAME : '';
}

export function editGateMissingKeyForStepRow(index: number): string {
  return `step:${index}`;
}

export function editGateMissingKeyForWorkflowNode(nodeId: string): string {
  return `workflow:${nodeId.trim()}`;
}

export function editGateMissingKeyForLangGraphNode(
  source: LangGraphWorkflowSource,
  nodeId: string,
): string {
  return `langgraph:${source}:${nodeId.trim()}`;
}

/** Map edit-gate node keys → showMissingBadge (open snapshot). */
export function nodeMissingBadgeByKey(
  nodes: ReadonlyArray<Pick<OfficeMissingNodeView, 'key' | 'showMissingBadge'>>,
): Map<string, boolean> {
  const map = new Map<string, boolean>();
  for (const node of nodes) {
    if (node.showMissingBadge) map.set(node.key, true);
  }
  return map;
}

export function stepDraftRowShowMissingBadge(
  stepMissingAgentIds: string[][] | undefined,
  index: number,
): boolean {
  return (stepMissingAgentIds?.[index]?.length ?? 0) > 0;
}

/**
 * Successful edit save must persist stripped edit state — never restore ghost refs
 * from the open-time session strip snapshot.
 */
export function persistStrippedWorkflowOnSave<T extends {
  workflow: WorkflowDefinition;
  workflowStepDrafts: WorkflowStepDraftRow[];
}>(current: T): T {
  return current;
}
