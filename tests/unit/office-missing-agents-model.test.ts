/**
 * Phase 1: shared OfficeMissingAgentsModel + saveGate / archived restart action.
 */
import { describe, expect, it } from 'vitest';
import {
  archivedRestartMissingAction,
  buildOfficeMissingAgentsModel,
  collectOfficeEditGateNodes,
  explainOfficeEditSaveGate,
  formatOfficeSaveBlockedMessage,
  persistStrippedWorkflowOnSave,
  sanitizeOfficeWorkflowRefsOnEditOpen,
} from '@/lib/office-missing-agents';
import type { WorkflowDefinition, WorkflowStepDraftRow } from '@/types/office';

const CATALOG = ['pm', 'dev', 'qa'];

function draft(
  agentIds: string[],
  task = '评审',
): WorkflowStepDraftRow {
  return { input: '', agentIds, task, output: '', linkMode: 'serial' };
}

function emptyDraft(): WorkflowStepDraftRow {
  return { input: '', agentIds: [], task: '', output: '', linkMode: 'serial' };
}

function wf(nodes: WorkflowDefinition['nodes']): WorkflowDefinition {
  return { mode: 'dag', nodes, edges: [] };
}

describe('office missing-agents model (phase 1)', () => {
  it('ignores blank placeholder step rows in edit-gate nodes', () => {
    const nodes = collectOfficeEditGateNodes(
      {
        agentIds: ['pm'],
        workflowStepDrafts: [draft(['pm']), emptyDraft(), emptyDraft()],
        workflow: wf([]),
      },
      CATALOG,
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.key).toBe('step:0');
  });

  it('marks contentful empty-agent step as isEmpty (always blocks save)', () => {
    const model = buildOfficeMissingAgentsModel({
      entity: {
        agentIds: ['pm'],
        coordinatorAgentId: 'pm',
        workflowStepDrafts: [draft([], '未指定负责人')],
        workflow: wf([]),
      },
      catalogAgentIds: CATALOG,
    });
    expect(model.nodes[0]?.isEmpty).toBe(true);
    expect(model.nodes[0]?.showMissingBadge).toBe(false);
    expect(model.saveGate).toBe('block');
    expect(model.saveBlockReasons).toContain('empty_node');
  });

  it('all-missing node: badge + isEmpty → block save', () => {
    const model = buildOfficeMissingAgentsModel({
      entity: {
        agentIds: ['pm', 'ghost'],
        coordinatorAgentId: 'pm',
        workflow: wf([{ id: 'n1', agentId: 'ghost', execution: 'serial' }]),
        workflowStepDrafts: [],
      },
      catalogAgentIds: CATALOG,
    });
    expect(model.nodes[0]?.showMissingBadge).toBe(true);
    expect(model.nodes[0]?.isEmpty).toBe(true);
    expect(model.saveGate).toBe('block');
  });

  it('open-time all-missing does not permanently block after user assigns an agent', () => {
    const openEntity = {
      agentIds: ['pm', 'ghost'],
      coordinatorAgentId: 'pm',
      workflow: wf([{ id: 'n1', agentId: 'ghost', execution: 'serial' as const }]),
      workflowStepDrafts: [] as WorkflowStepDraftRow[],
    };
    const currentEntity = {
      ...openEntity,
      workflow: wf([{ id: 'n1', agentId: 'pm', execution: 'serial' as const }]),
    };
    const model = buildOfficeMissingAgentsModel({
      entity: openEntity,
      currentEntity,
      catalogAgentIds: CATALOG,
    });
    expect(model.nodes[0]?.isEmpty).toBe(true); // open snapshot still empty
    expect(model.saveGate).toBe('confirm'); // current node has remaining agent
    expect(model.saveBlockReasons).not.toContain('empty_node');
    expect(model.confirmMissingIds).toContain('ghost');
  });

  it('partial-missing node with remaining >= 1 → confirm (not block)', () => {
    const entity = {
      agentIds: ['pm', 'ghost'],
      coordinatorAgentId: 'pm',
      workflow: wf([
        {
          id: 'n1',
          agentId: 'pm',
          agentIds: ['pm', 'ghost'],
          execution: 'serial' as const,
        },
      ]),
      workflowStepDrafts: [draft(['pm', 'ghost'])],
    };
    const stripped = sanitizeOfficeWorkflowRefsOnEditOpen(
      {
        workflow: structuredClone(entity.workflow),
        workflowStepDrafts: structuredClone(entity.workflowStepDrafts),
      },
      CATALOG,
    );
    const model = buildOfficeMissingAgentsModel({
      entity,
      catalogAgentIds: CATALOG,
      currentEntity: {
        ...entity,
        workflow: stripped.workflow,
        workflowStepDrafts: stripped.workflowStepDrafts,
      },
    });
    expect(model.nodes.every((n) => !n.isEmpty)).toBe(true);
    expect(model.nodes.some((n) => n.showMissingBadge)).toBe(true);
    expect(model.saveGate).toBe('confirm');
    expect(model.confirmMissingIds).toContain('ghost');
    expect(explainOfficeEditSaveGate(model).needsConfirm).toBe(true);
  });

  it('coordinator missing → block even when nodes are healthy', () => {
    const model = buildOfficeMissingAgentsModel({
      entity: {
        agentIds: ['pm', 'ghost-coord'],
        coordinatorAgentId: 'ghost-coord',
        workflow: wf([{ id: 'n1', agentId: 'pm', execution: 'serial' }]),
        workflowStepDrafts: [draft(['pm'])],
      },
      catalogAgentIds: CATALOG,
    });
    expect(model.saveGate).toBe('block');
    expect(model.saveBlockReasons).toContain('coordinator_missing');
  });

  it('explicitly cleared coordinator with known roster → block (must re-pick)', () => {
    const model = buildOfficeMissingAgentsModel({
      entity: {
        agentIds: ['pm', 'dev'],
        coordinatorAgentId: '',
        workflow: wf([{ id: 'n1', agentId: 'dev', execution: 'serial' }]),
        workflowStepDrafts: [draft(['dev'])],
      },
      catalogAgentIds: CATALOG,
    });
    expect(model.saveGate).toBe('block');
    expect(model.saveBlockReasons).toContain('coordinator_missing');
  });

  it('roster member missing with zero gate nodes → confirm (vacuous node check)', () => {
    const model = buildOfficeMissingAgentsModel({
      entity: {
        agentIds: ['pm', 'ghost'],
        coordinatorAgentId: 'pm',
        workflow: wf([]),
        workflowStepDrafts: [emptyDraft()],
      },
      catalogAgentIds: CATALOG,
    });
    expect(model.nodes).toHaveLength(0);
    expect(model.saveGate).toBe('confirm');
    expect(model.confirmMissingIds).toContain('ghost');
  });

  it('healthy entity → allow', () => {
    const model = buildOfficeMissingAgentsModel({
      entity: {
        agentIds: ['pm', 'dev'],
        coordinatorAgentId: 'pm',
        workflow: wf([{ id: 'n1', agentId: 'dev', execution: 'serial' }]),
        workflowStepDrafts: [draft(['dev'])],
      },
      catalogAgentIds: CATALOG,
    });
    expect(model.hasMissing).toBe(false);
    expect(model.saveGate).toBe('allow');
    expect(model.confirmMissingIds).toEqual([]);
  });

  it('LangGraph active source nodes participate in edit gate', () => {
    const model = buildOfficeMissingAgentsModel({
      entity: {
        agentIds: ['pm'],
        coordinatorAgentId: 'pm',
        workflow: wf([]),
        langGraphWorkflowBundle: {
          activeSource: 'custom',
          activeSavedAt: 1,
          heuristic: {
            savedAt: 1,
            workflow: wf([{ id: 'h', agentId: 'ghost-h', execution: 'serial' }]),
          },
          custom: {
            savedAt: 1,
            workflow: wf([{ id: 'c', agentId: 'ghost-c', execution: 'serial' }]),
          },
        },
      },
      catalogAgentIds: CATALOG,
      langGraphActiveSource: 'custom',
    });
    expect(model.nodes.some((n) => n.key === 'langgraph:custom:c')).toBe(true);
    expect(model.nodes.some((n) => n.key.includes('ghost-h') || n.key.includes(':h'))).toBe(false);
    expect(model.nodes.find((n) => n.key === 'langgraph:custom:c')?.showMissingBadge).toBe(true);
    expect(model.saveGate).toBe('block'); // all-missing → empty remaining
  });

  it('archived restart: confirm when missing, else direct', () => {
    expect(archivedRestartMissingAction(true)).toBe('confirm');
    expect(archivedRestartMissingAction(false)).toBe('direct');
  });

  it('persistStrippedWorkflowOnSave keeps edit state (no ghost restore)', () => {
    const current = {
      workflow: wf([{ id: 'n1', agentId: 'pm', execution: 'serial' as const }]),
      workflowStepDrafts: [draft(['pm'])],
    };
    expect(persistStrippedWorkflowOnSave(current)).toEqual(current);
  });

  it('sanitize strips LangGraph active branch missing agents', () => {
    const sanitized = sanitizeOfficeWorkflowRefsOnEditOpen(
      {
        workflow: wf([]),
        workflowStepDrafts: [],
        langGraphTab: 'custom' as const,
        langGraphWorkflowBundle: {
          activeSource: 'custom' as const,
          activeSavedAt: 1,
          custom: {
            savedAt: 1,
            workflow: wf([{ id: 'c', agentId: 'ghost-c', execution: 'serial' }]),
          },
        },
      },
      CATALOG,
    );
    expect(sanitized.langGraphWorkflowBundle?.custom?.workflow.nodes[0]?.agentId).toBe('');
  });
});

describe('formatOfficeSaveBlockedMessage', () => {
  const t = (key: string) => key;

  it('joins all active block reasons (coordinator + empty node)', () => {
    expect(
      formatOfficeSaveBlockedMessage(['empty_node', 'coordinator_missing'], t),
    ).toBe('missingAgents.saveBlockedCoordinator；missingAgents.saveBlockedEmptyNode');
  });

  it('shows a single reason when only one applies', () => {
    expect(formatOfficeSaveBlockedMessage(['empty_node'], t)).toBe(
      'missingAgents.saveBlockedEmptyNode',
    );
    expect(formatOfficeSaveBlockedMessage(['coordinator_missing'], t)).toBe(
      'missingAgents.saveBlockedCoordinator',
    );
  });

  it('dedupes and keeps a stable coordinator→empty order regardless of input order', () => {
    expect(
      formatOfficeSaveBlockedMessage(
        ['empty_node', 'empty_node', 'coordinator_missing'],
        t,
      ),
    ).toBe('missingAgents.saveBlockedCoordinator；missingAgents.saveBlockedEmptyNode');
  });

  it('supports a custom separator', () => {
    expect(
      formatOfficeSaveBlockedMessage(['coordinator_missing', 'empty_node'], t, ' / '),
    ).toBe('missingAgents.saveBlockedCoordinator / missingAgents.saveBlockedEmptyNode');
  });
});
