/**
 * Regression: LangGraph task open snapshot must not leak the legacy/stale DAG
 * mirror field (`project.workflow`) into the missing-agents edit gate.
 *
 * Root cause: `buildTaskEditFormStateFromProject` substituted the persisted
 * legacy DAG field (`projectWorkflowForForm`) for `openAgentRefSnapshot.workflow`
 * to "avoid double counting" the LangGraph branch. That field is a separate,
 * potentially stale copy (only resynced on save) and can still reference a
 * deleted agent that has nothing to do with the currently active LangGraph
 * branch shown to the user — producing a spurious `confirm` save gate with a
 * misleading missing-agent label the user cannot see or fix anywhere in the
 * LangGraph editor.
 */
import { describe, expect, it } from 'vitest';
import { buildTaskEditFormStateFromProject } from '@/lib/office-task-edit-form';
import { buildOfficeMissingAgentsModel } from '@/lib/office-missing-agents';
import type { OfficeTempProject, WorkflowDefinition } from '@/types/office';

const CATALOG = ['pm', 'dev'];
const now = Date.now();

function wf(nodes: WorkflowDefinition['nodes']): WorkflowDefinition {
  return { mode: 'dag', nodes, edges: [] };
}

function langGraphProjectWithStaleDagMirror(): OfficeTempProject {
  return {
    id: 'p-lg',
    title: 'LangGraph 任务',
    origin: 'standalone',
    agentIds: ['pm', 'dev'],
    coordinatorAgentId: 'pm',
    lifecycle: 'active',
    featureDescription: 'feat',
    description: 'desc',
    status: 'pending',
    nodeRuns: [],
    executionMode: 'workflow',
    workflowEngine: 'langgraph',
    // Stale legacy DAG mirror: references a deleted agent unrelated to the
    // currently active LangGraph branch below.
    workflow: wf([{ id: 'legacy-n1', agentId: 'ghost-legacy', execution: 'serial' }]),
    workflowStepDrafts: [],
    langGraphWorkflowBundle: {
      activeSource: 'custom',
      activeSavedAt: now,
      custom: {
        savedAt: now,
        // Currently visible/active branch has no missing agents.
        workflow: wf([{ id: 'c1', agentId: 'dev', execution: 'serial' }]),
      },
    },
    createdAt: now,
    updatedAt: now,
  };
}

// LangGraph engine resolution is gated by the __ENABLE_LANGGRAPH__ compile flag
// (VITE_ENABLE_LANGGRAPH). Skip when the build has it off, matching the pattern
// used by other LangGraph-dependent unit tests in this repo.
const itLangGraph = process.env.VITE_ENABLE_LANGGRAPH === 'true' ? it : it.skip;

describe('LangGraph edit-open snapshot must not leak legacy DAG mirror into missing gate', () => {
  itLangGraph('openAgentRefSnapshot.workflow is empty for LangGraph tasks (no legacy leak)', () => {
    const project = langGraphProjectWithStaleDagMirror();
    const form = buildTaskEditFormStateFromProject(project, null, undefined, CATALOG);
    expect(form.openAgentRefSnapshot?.workflow?.nodes ?? []).toHaveLength(0);
  });

  itLangGraph('healthy active LangGraph branch + stale legacy DAG ghost → saveGate must stay allow', () => {
    const project = langGraphProjectWithStaleDagMirror();
    const form = buildTaskEditFormStateFromProject(project, null, undefined, CATALOG);
    const openSnap = form.openAgentRefSnapshot!;
    const model = buildOfficeMissingAgentsModel({
      entity: openSnap,
      currentEntity: {
        agentIds: project.agentIds,
        coordinatorAgentId: project.coordinatorAgentId,
        // LangGraph current entity mirrors TaskEditDialog's own gate computation:
        // workflow must be empty to avoid double counting the active branch.
        workflow: wf([]),
        workflowStepDrafts: [],
        langGraphWorkflowBundle: form.langGraphWorkflowBundle,
      },
      catalogAgentIds: CATALOG,
      langGraphActiveSource: 'custom',
    });
    expect(model.saveGate).toBe('allow');
    expect(model.confirmMissingIds).toEqual([]);
  });
});
