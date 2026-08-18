/**
 * Product requirement simulation: missing agents on fixed groups / projects.
 *
 * When catalog agents are truly deleted (or remap leftovers remain):
 * 1) Detect via roster + coordinator + workflow nodes + step drafts + LangGraph bundle
 * 2) List cards surface "missing agents"
 * 3) Edit shows red chips / dynamic labels; strip node/draft orphans on open only
 * 4) Save/preview allowed; spawn / run / archived-restart blocked
 * 5) Coordinator Option A: keep orphan in roster for unbind; select must not bind orphan
 * 6) Title-only save must not persist session strip
 * 7) Rename remap clears missing when id remaps successfully
 */
import { describe, expect, it } from 'vitest';
import {
  assertOfficeEntityAgentsExist,
  validateArchivedProjectRestart,
  rebuildAgentBindings,
} from '../../electron/services/office/agent-binding';
import type {
  OfficeDataStore,
  OfficeFixedGroup,
  OfficeTempProject,
} from '../../electron/services/office/types';
import { remapFixedGroupAgentIds, remapTempProjectAgentIds } from '@/lib/office-agent-id-remap';
import { canRestartArchivedProject } from '@/lib/office-archived-project-actions';
import {
  applySessionOnlyStripOnSave,
  buildSessionStripWorkflowSnapshot,
  ensureMissingCoordinatorInRoster,
  fixedGroupHasMissingAgents,
  formatMissingAgentsLabelForIds,
  hasMissingOfficeAgents,
  missingAgentsForOfficeEntity,
  missingRosterAndCoordinatorIds,
  preserveCoordinatorForSave,
  sanitizeOfficeWorkflowRefsOnEditOpen,
  stampAgentNameHints,
  tempProjectHasMissingAgents,
} from '@/lib/office-missing-agents';
import {
  buildTaskEditFormStateFromProject,
  computeTaskEditDirty,
  explainTaskEditDirty,
  taskEditDialogFlags,
  type TaskEditFormState,
} from '@/lib/office-task-edit-form';
import type { WorkflowDefinition, WorkflowStepDraftRow } from '@/types/office';

const CATALOG = ['pm', 'dev', 'qa'] as const;
const now = Date.now();

function workflow(nodes: WorkflowDefinition['nodes']): WorkflowDefinition {
  return { mode: 'dag', nodes, edges: [] };
}

function draftRow(agentIds: string[], task = 'step'): WorkflowStepDraftRow {
  return { input: '', agentIds, task, output: '', linkMode: 'serial' };
}

function fixedGroup(overrides: Partial<OfficeFixedGroup> = {}): OfficeFixedGroup {
  return {
    id: 'g-missing',
    name: '软件开发组',
    agentIds: ['pm', 'ghost-ux'],
    coordinatorAgentId: 'pm',
    workflow: workflow([
      { id: 'n1', agentId: 'pm', execution: 'serial' },
      { id: 'n2', agentId: 'ghost-ux', execution: 'serial' },
    ]),
    workflowStepDrafts: [draftRow(['pm']), draftRow(['ghost-ux', 'qa'])],
    workflowOrchestrationMode: 'rule',
    executionMode: 'workflow',
    agentNameHints: { 'ghost-ux': 'UX工程师' },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function tempProject(overrides: Partial<OfficeTempProject> = {}): OfficeTempProject {
  return {
    id: 'p-missing',
    title: '需求分析',
    origin: 'standalone',
    agentIds: ['pm', 'ghost-ux'],
    coordinatorAgentId: 'pm',
    lifecycle: 'active',
    featureDescription: 'feat',
    description: 'desc',
    status: 'pending',
    nodeRuns: [],
    executionMode: 'workflow',
    workflow: workflow([{ id: 'n1', agentId: 'ghost-ux', execution: 'serial' }]),
    workflowStepDrafts: [draftRow(['ghost-ux'])],
    agentNameHints: { 'ghost-ux': 'UX工程师' },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function store(overrides: Partial<OfficeDataStore> = {}): OfficeDataStore {
  const base: OfficeDataStore = {
    version: 2,
    fixedGroups: [],
    tempProjects: [],
    agentBindings: {},
    roomMessages: {},
    settings: { agentToAgentEnabled: false, agentToAgentAllow: [] },
  };
  const merged = { ...base, ...overrides };
  merged.agentBindings = rebuildAgentBindings(merged);
  return merged;
}

function dirtyParams(project: OfficeTempProject, form: TaskEditFormState, memberAgentIds: string[], memberCoordinatorId: string) {
  const flags = taskEditDialogFlags(project, null);
  return {
    form,
    project,
    group: null as null,
    memberAgentIds,
    memberCoordinatorId,
    lookup: () => undefined,
    catalogAgentIds: [...CATALOG],
    ...flags,
  };
}

describe('missing-agents requirement simulation', () => {
  it('1) detects missing refs across roster, coordinator, workflow, drafts, LangGraph', () => {
    const entity = {
      agentIds: ['pm', 'ghost-roster'],
      coordinatorAgentId: 'ghost-coord',
      workflow: workflow([{ id: 'n', agentId: 'ghost-node', execution: 'serial' as const }]),
      workflowStepDrafts: [draftRow(['ghost-draft'])],
      langGraphWorkflowBundle: {
        activeSource: 'custom' as const,
        activeSavedAt: 1,
        custom: {
          savedAt: 1,
          workflow: workflow([{ id: 'lg', agentId: 'ghost-lg', execution: 'serial' }]),
        },
      },
    };
    expect(missingAgentsForOfficeEntity(entity, CATALOG).sort()).toEqual([
      'ghost-coord',
      'ghost-draft',
      'ghost-lg',
      'ghost-node',
      'ghost-roster',
    ].sort());
    expect(hasMissingOfficeAgents(entity, CATALOG)).toBe(true);
    // Coordinator not in roster still counts for list/edit red state.
    expect(missingRosterAndCoordinatorIds(['pm'], 'ghost-coord', CATALOG)).toEqual([
      'ghost-coord',
    ]);
  });

  it('2) list cards: fixed group / project / inheriting spawn flag missing agents', () => {
    const group = fixedGroup();
    expect(fixedGroupHasMissingAgents(group, CATALOG)).toBe(true);
    expect(fixedGroupHasMissingAgents(fixedGroup({ agentIds: ['pm', 'dev'], workflow: workflow([{ id: 'n', agentId: 'pm', execution: 'serial' }]), workflowStepDrafts: [draftRow(['pm'])], agentNameHints: undefined }), CATALOG)).toBe(false);

    const standalone = tempProject();
    expect(tempProjectHasMissingAgents(standalone, CATALOG)).toBe(true);

    const spawn = tempProject({
      origin: 'fixed_group',
      parentGroupId: group.id,
      inheritsGroupTemplate: true,
      agentIds: ['pm'],
      coordinatorAgentId: 'pm',
      workflow: workflow([]),
      workflowStepDrafts: undefined,
      agentNameHints: undefined,
    });
    expect(tempProjectHasMissingAgents(spawn, CATALOG, group)).toBe(true);
    expect(tempProjectHasMissingAgents(spawn, CATALOG, null)).toBe(false);
  });

  it('3) edit labels prefer historical names; count rules 1 / 2 / ≥3', () => {
    const hints = { 'ghost-ux': 'UX工程师', 'ghost-b': '测试B' };
    expect(formatMissingAgentsLabelForIds(['ghost-ux'], hints)).toBe('UX工程师缺失');
    expect(formatMissingAgentsLabelForIds(['ghost-ux', 'ghost-b'], hints)).toBe(
      'UX工程师、测试B缺失',
    );
    expect(
      formatMissingAgentsLabelForIds(['ghost-ux', 'ghost-b', 'ghost-c'], hints),
    ).toBe('UX工程师等3个智能体缺失');
  });

  it('4) edit open strips node/draft orphans but keeps roster missing for user unbind', () => {
    const group = fixedGroup();
    const sanitized = sanitizeOfficeWorkflowRefsOnEditOpen(
      {
        agentIds: group.agentIds,
        workflow: structuredClone(group.workflow),
        workflowStepDrafts: structuredClone(group.workflowStepDrafts),
      },
      CATALOG,
    );
    expect(sanitized.agentIds).toEqual(['pm', 'ghost-ux']);
    expect(sanitized.workflowStepDrafts?.[1]?.agentIds).toEqual(['qa']);
    expect(sanitized.workflow?.nodes[1]?.agentId).toBe('');
  });

  it('5) save persists stripped edit state (never restores ghost node refs)', () => {
    const persistedWorkflow = workflow([
      { id: 'n1', agentId: 'ghost-ux', execution: 'serial' },
    ]);
    const openWorkflow = workflow([{ id: 'n1', agentId: '', execution: 'serial' }]);
    const persistedDrafts = [draftRow(['ghost-ux'])];
    const openDrafts = [draftRow([])];
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

    const orchestrationEdited = applySessionOnlyStripOnSave(
      {
        workflow: openWorkflow,
        workflowStepDrafts: [draftRow(['pm'], 'rewritten')],
      },
      snapshot,
    );
    expect(orchestrationEdited.workflowStepDrafts[0]?.agentIds).toEqual(['pm']);
  });

  it('6) spawn / run / restart blocked while missing; save path keeps orphan coordinator until unbind', () => {
    const known = new Set<string>(CATALOG);
    const project = tempProject();
    expect(() => assertOfficeEntityAgentsExist(project, known)).toThrow(/ghost-ux/);

    // After user unbinds missing roster/node refs, run becomes allowed.
    const fixed = {
      agentIds: ['pm', 'dev'],
      coordinatorAgentId: 'pm',
      workflow: workflow([{ id: 'n1', agentId: 'dev', execution: 'serial' as const }]),
      workflowStepDrafts: [draftRow(['dev'])],
    };
    expect(() => assertOfficeEntityAgentsExist(fixed, known)).not.toThrow();

    // Coordinator Option A: keep orphan in roster for red chip; select must not silently bind it.
    const openRoster = ensureMissingCoordinatorInRoster(['pm'], 'ghost-coord');
    expect(openRoster).toEqual(['pm', 'ghost-coord']);
    expect(
      preserveCoordinatorForSave({
        coordinatorId: 'ghost-coord',
        agentIds: openRoster,
        catalogAgentIds: CATALOG,
      }),
    ).toBe('ghost-coord');
    expect(
      preserveCoordinatorForSave({
        coordinatorId: 'ghost-coord',
        agentIds: ['pm', 'dev'],
        catalogAgentIds: CATALOG,
      }),
    ).toBe('pm');

    // Archived restart: UI confirms when missing; backend allows restart.
    const archived = tempProject({
      lifecycle: 'completed',
      status: 'completed',
      agentIds: ['ghost-ux'],
      coordinatorAgentId: 'ghost-ux',
      workflow: workflow([]),
      workflowStepDrafts: undefined,
    });
    expect(canRestartArchivedProject(archived, true)).toBe(true);
    expect(tempProjectHasMissingAgents(archived, CATALOG)).toBe(true);
    expect(() =>
      validateArchivedProjectRestart(archived, store({ tempProjects: [archived] }), known),
    ).not.toThrow();
  });

  it('7) opening edit with orphan coordinator alone is not dirty; title change is', () => {
    const project = tempProject({
      agentIds: ['pm'],
      coordinatorAgentId: 'ghost-coord',
      // Keep description empty so build/dirty step-draft baselines both resolve to empty rows.
      description: '',
      workflowOrchestrationMode: 'heuristic',
      executionMode: 'smart',
      workflow: workflow([]),
      workflowStepDrafts: [],
      agentNameHints: { 'ghost-coord': '旧协调者' },
    });
    const form = buildTaskEditFormStateFromProject(project, null, undefined, [...CATALOG]);
    const openRoster = ensureMissingCoordinatorInRoster(
      project.agentIds,
      project.coordinatorAgentId,
    );
    expect(openRoster).toEqual(['pm', 'ghost-coord']);
    const params = dirtyParams(project, form, openRoster, project.coordinatorAgentId);
    expect(explainTaskEditDirty(params).members).toBe(false);
    expect(computeTaskEditDirty(params)).toBe(false);

    const titled = { ...form, title: `${form.title}-edited` };
    expect(
      computeTaskEditDirty(
        dirtyParams(project, titled, openRoster, project.coordinatorAgentId),
      ),
    ).toBe(true);
  });

  it('8) LangGraph missing refs block run without requiring bundle strip', () => {
    const project = tempProject({
      agentIds: ['pm', 'dev'],
      coordinatorAgentId: 'pm',
      workflow: workflow([]),
      workflowStepDrafts: undefined,
      agentNameHints: undefined,
      langGraphWorkflowBundle: {
        activeSource: 'custom',
        activeSavedAt: 1,
        custom: {
          savedAt: 1,
          workflow: workflow([{ id: 'lg', agentId: 'ghost-lg', execution: 'serial' }]),
        },
      },
    });
    expect(tempProjectHasMissingAgents(project, CATALOG)).toBe(true);
    expect(() =>
      assertOfficeEntityAgentsExist(project, new Set(CATALOG)),
    ).toThrow(/ghost-lg/);
  });

  it('9) rename remap clears missing; residual unknown ids still flagged', () => {
    const group = fixedGroup();
    const remapped = remapFixedGroupAgentIds(group, 'ghost-ux', 'dev');
    expect(fixedGroupHasMissingAgents(remapped, CATALOG)).toBe(false);
    expect(remapped.agentIds).toEqual(['pm', 'dev']);
    expect(remapped.workflow.nodes[1]?.agentId).toBe('dev');

    const project = tempProject();
    const remappedProject = remapTempProjectAgentIds(project, 'ghost-ux', 'qa');
    expect(tempProjectHasMissingAgents(remappedProject, CATALOG)).toBe(false);

    // Remap leftover (old id still referenced elsewhere) stays missing.
    const leftover = fixedGroup({
      agentIds: ['pm', 'dev'],
      workflow: workflow([
        { id: 'n1', agentId: 'pm', execution: 'serial' },
        { id: 'n2', agentId: 'ghost-ux', execution: 'serial' },
      ]),
      workflowStepDrafts: [draftRow(['pm'])],
    });
    expect(fixedGroupHasMissingAgents(leftover, CATALOG)).toBe(true);
  });

  it('10) name hints stamped for deleted agents survive catalog shrink', () => {
    const stamped = stampAgentNameHints(
      { agentIds: ['pm', 'ghost-ux'], coordinatorAgentId: 'ghost-coord' },
      [{ id: 'pm', name: '产品经理' }],
      { 'ghost-ux': 'UX工程师', 'ghost-coord': '旧协调者' },
    );
    expect(stamped['ghost-ux']).toBe('UX工程师');
    expect(stamped['ghost-coord']).toBe('旧协调者');
    expect(stamped.pm).toBe('产品经理');
    expect(
      formatMissingAgentsLabelForIds(['ghost-ux', 'ghost-coord'], stamped),
    ).toBe('UX工程师、旧协调者缺失');
  });
});
