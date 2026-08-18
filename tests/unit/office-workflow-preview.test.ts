import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestWorkflowGeneration = vi.fn();
vi.mock('@/lib/office-workflow-generate-client', () => ({
  requestWorkflowGeneration: (...args: unknown[]) => requestWorkflowGeneration(...args),
}));

import { previewDagWorkflow, resolveDagWorkflowForSave } from '@/lib/office-workflow-preview';
import { emptyWorkflowStepDraftRow } from '@/lib/office-workflow-step-drafts';

const members = [{ agentId: 'a1', name: 'Alice' }];
const workflow = {
  mode: 'dag' as const,
  nodes: [{ id: 'n1', title: 'Step', agentIds: ['a1'] }],
  edges: [],
};

beforeEach(() => {
  requestWorkflowGeneration.mockReset();
});

describe('office-workflow-preview', () => {
  it('previewDagWorkflow uses structured rule path without API', async () => {
    const row = { ...emptyWorkflowStepDraftRow(), task: 'Do work', agentIds: ['a1'] };
    const result = await previewDagWorkflow({
      orchestrationMode: 'rule',
      workflowStepDrafts: [row],
      heuristicDescription: '',
      workflow: { mode: 'dag', nodes: [], edges: [] },
      members,
      agentIds: ['a1'],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source).toBe('structured_rule');
      expect(result.workflow.nodes.length).toBeGreaterThan(0);
    }
    expect(requestWorkflowGeneration).not.toHaveBeenCalled();
  });

  it('previewDagWorkflow uses gateway-then-direct for heuristic mode', async () => {
    requestWorkflowGeneration.mockResolvedValue({
      ok: true,
      workflow: { mode: 'dag', nodes: [{ id: 'n1', title: 'LLM step', agentIds: ['a1'] }], edges: [] },
      mode: 'dag',
      source: 'ai',
    });
    const result = await previewDagWorkflow({
      orchestrationMode: 'heuristic',
      workflowStepDrafts: [],
      heuristicDescription: 'Build a feature',
      workflow: { mode: 'dag', nodes: [], edges: [] },
      members,
      agentIds: ['a1'],
    });
    expect(result.ok).toBe(true);
    expect(requestWorkflowGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ strategy: 'gateway-then-direct' }),
    );
  });

  it('resolveDagWorkflowForSave keeps empty DAG for spawned project without orchestration (inherit)', async () => {
    const groupWorkflow = {
      mode: 'dag' as const,
      nodes: [{ id: 'g1', title: 'Group step', agentIds: ['a1'] }],
      edges: [],
    };
    const result = await resolveDagWorkflowForSave({
      executionMode: 'workflow',
      spawnFromGroup: true,
      groupWorkflow,
      group: {
        workflow: groupWorkflow,
        workflowDescription: '',
        workflowStepDrafts: [],
        workflowOrchestrationMode: 'heuristic',
        agentIds: ['a1'],
        coordinatorAgentId: 'a1',
      },
      orchestration: {
        orchestrationMode: 'heuristic',
        workflowStepDrafts: [],
        heuristicDescription: '',
      },
      orchestrationBaseline: {
        orchestrationMode: 'heuristic',
        workflowStepDrafts: [],
        heuristicDescription: '',
      },
      previewSyncedKey: null,
      workflow: { mode: 'dag', nodes: [], edges: [] },
      members,
      agentIds: ['a1'],
      coordinatorAgentId: 'a1',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workflow.nodes).toEqual([]);
    }
    expect(requestWorkflowGeneration).not.toHaveBeenCalled();
  });

  it('resolveDagWorkflowForSave keeps empty DAG when spawn baseline unchanged (inherit, no materialize)', async () => {
    const groupWorkflow = {
      mode: 'dag' as const,
      nodes: [{ id: 'g1', title: 'Inherited', agentIds: ['a1'] }],
      edges: [],
    };
    const orchestration = {
      orchestrationMode: 'heuristic' as const,
      workflowStepDrafts: [],
      heuristicDescription: 'Group template',
    };
    const result = await resolveDagWorkflowForSave({
      executionMode: 'workflow',
      spawnFromGroup: true,
      groupWorkflow,
      group: {
        workflow: groupWorkflow,
        workflowDescription: 'Group template',
        workflowStepDrafts: [],
        workflowOrchestrationMode: 'heuristic',
        agentIds: ['a1'],
        coordinatorAgentId: 'a1',
      },
      orchestration,
      orchestrationBaseline: orchestration,
      previewSyncedKey: null,
      workflow: { mode: 'dag', nodes: [], edges: [] },
      members,
      agentIds: ['a1'],
      coordinatorAgentId: 'a1',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workflow.nodes).toEqual([]);
    }
    expect(requestWorkflowGeneration).not.toHaveBeenCalled();
  });

  it('resolveDagWorkflowForSave skips generation when preview is in sync', async () => {
    const result = await resolveDagWorkflowForSave({
      executionMode: 'workflow',
      spawnFromGroup: false,
      orchestration: {
        orchestrationMode: 'heuristic',
        workflowStepDrafts: [],
        heuristicDescription: 'Same flow',
      },
      orchestrationBaseline: {
        orchestrationMode: 'heuristic',
        workflowStepDrafts: [],
        heuristicDescription: 'Same flow',
      },
      previewSyncedKey: 'Same flow',
      workflow,
      members,
      agentIds: ['a1'],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workflow.nodes[0]?.title).toBe('Step');
    }
    expect(requestWorkflowGeneration).not.toHaveBeenCalled();
  });

  it('resolveDagWorkflowForSave generates when preview is stale', async () => {
    requestWorkflowGeneration.mockResolvedValue({
      ok: true,
      workflow: {
        mode: 'dag',
        nodes: [{ id: 'n2', title: 'Regenerated', agentIds: ['a1'] }],
        edges: [],
      },
      mode: 'dag',
      source: 'ai',
    });
    const result = await resolveDagWorkflowForSave({
      executionMode: 'workflow',
      spawnFromGroup: false,
      orchestration: {
        orchestrationMode: 'heuristic',
        workflowStepDrafts: [],
        heuristicDescription: 'New flow',
      },
      orchestrationBaseline: {
        orchestrationMode: 'heuristic',
        workflowStepDrafts: [],
        heuristicDescription: 'Old flow',
      },
      previewSyncedKey: 'Old flow',
      workflow,
      members,
      agentIds: ['a1'],
      taskTitle: 'Task',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workflow.nodes[0]?.title).toBe('Regenerated');
    }
    expect(requestWorkflowGeneration).toHaveBeenCalledTimes(1);
  });
});
