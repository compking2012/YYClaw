import { describe, expect, it, vi, beforeEach } from 'vitest';

const { hostApiFetch } = vi.hoisted(() => ({
  hostApiFetch: vi.fn(),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch,
}));

import { ensureWorkflowForTaskSave } from '@/lib/office-workflow-generate-client';

describe('ensureWorkflowForTaskSave', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps existing workflow when description is unchanged', async () => {
    const existing = {
      mode: 'dag' as const,
      nodes: [{ id: 'n1', title: 'Old step', agentIds: ['a1'] }],
      edges: [],
    };

    const result = await ensureWorkflowForTaskSave({
      title: 'Task',
      featureDescription: 'Feature',
      description: 'Same description',
      previousDescription: 'Same description',
      workflow: existing,
      agentIds: ['a1'],
    });

    expect(result).toEqual({ ok: true, workflow: { ...existing, mode: 'dag' } });
    expect(hostApiFetch).not.toHaveBeenCalled();
  });

  it('regenerates workflow when description changed', async () => {
    hostApiFetch.mockResolvedValue({
      success: true,
      workflow: {
        mode: 'dag',
        nodes: [{ id: 'n2', title: 'New step', agentIds: ['a1'] }],
        edges: [],
      },
      source: 'heuristic',
    });

    const result = await ensureWorkflowForTaskSave({
      title: 'Task',
      featureDescription: 'Feature',
      description: 'Updated workflow description',
      previousDescription: 'Original workflow description',
      workflow: {
        mode: 'dag',
        nodes: [{ id: 'n1', title: 'Old step', agentIds: ['a1'] }],
        edges: [],
      },
      agentIds: ['a1'],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workflow.nodes[0]?.title).toBe('New step');
    }
    expect(hostApiFetch).toHaveBeenCalledOnce();
  });
});
