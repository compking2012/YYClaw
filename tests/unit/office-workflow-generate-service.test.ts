import { afterEach, describe, expect, it, vi } from 'vitest';

const callModelOnce = vi.fn();
vi.mock('@electron/workflow/model-client', () => ({
  callModelOnce: (...args: unknown[]) => callModelOnce(...args),
}));

import { generateWorkflowFromDescription } from '@electron/services/office/workflow-generate';

const teamMembers = [
  { id: 'pm', name: 'PM', agentId: 'a0', displayName: 'PM' },
  { id: 'product', name: '产品', agentId: 'a1', displayName: '产品' },
  { id: 'dev', name: '软件开发', agentId: 'a2', displayName: '软件开发' },
  { id: 'qa', name: '测试', agentId: 'a3', displayName: '测试' },
];

vi.mock('../../electron/utils/agent-config', () => ({
  listAgentsSnapshot: vi.fn(async () => ({
    agents: teamMembers.map((m) => ({ id: m.agentId, name: m.name })),
  })),
  readAgentDisplayNamesFromConfig: vi.fn(
    async () => new Map(teamMembers.map((m) => [m.agentId, m.displayName])),
  ),
}));

afterEach(() => {
  callModelOnce.mockReset();
});

describe('generateWorkflowFromDescription · model split', () => {
  it('uses model JSON with who/action/output for auto strategy', async () => {
    callModelOnce.mockResolvedValue({
      text: JSON.stringify({
        mode: 'dag',
        steps: [
          {
            who: 'PM',
            action: '编写项目计划并组织kickoff',
            output: '项目计划书',
            parallelWithPrevious: false,
          },
          {
            who: '产品',
            action: '撰写需求说明书初稿',
            output: '需求说明书初稿',
            parallelWithPrevious: false,
          },
        ],
      }),
    });

    const result = await generateWorkflowFromDescription(null, {
      description: '1.PM编写计划 2.产品写需求初稿',
      agentIds: teamMembers.map((m) => m.agentId),
      strategy: 'auto',
    });

    expect(callModelOnce).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
    expect(result!.source).toBe('ai');
    expect(result!.workflow.nodes).toHaveLength(2);
    expect(result!.workflow.nodes[0]!.description).toContain('输出：项目计划书');
  });

  it('returns null for ai strategy when model fails', async () => {
    callModelOnce.mockRejectedValue(new Error('no provider'));
    const result = await generateWorkflowFromDescription(null, {
      description: '1.PM编写计划',
      agentIds: teamMembers.map((m) => m.agentId),
      strategy: 'ai',
    });
    expect(result).toBeNull();
  });

  it('falls back to heuristic for auto when model returns unparseable text', async () => {
    callModelOnce.mockResolvedValue({ text: 'not json' });
    const result = await generateWorkflowFromDescription(null, {
      description: '产品写需求 → 开发实现 → 测试验收',
      agentIds: teamMembers.map((m) => m.agentId),
      strategy: 'auto',
    });
    expect(result).not.toBeNull();
    expect(result!.source).toBe('heuristic');
  });

  it('uses model first for heuristic strategy before regex fallback', async () => {
    callModelOnce.mockResolvedValue({
      text: JSON.stringify({
        mode: 'dag',
        steps: [{ who: 'PM', action: '编写计划', output: '计划书', parallelWithPrevious: false }],
      }),
    });
    const result = await generateWorkflowFromDescription(null, {
      description: 'PM 编写计划',
      agentIds: teamMembers.map((m) => m.agentId),
      strategy: 'heuristic',
    });
    expect(callModelOnce).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
    expect(result!.source).toBe('ai');
  });

  it('gateway-then-direct returns null when gateway and model both fail', async () => {
    callModelOnce.mockRejectedValue(new Error('no provider'));
    const result = await generateWorkflowFromDescription(null, {
      description: '产品写需求 → 开发实现 → 测试验收',
      agentIds: teamMembers.map((m) => m.agentId),
      strategy: 'gateway-then-direct',
    });
    expect(callModelOnce).toHaveBeenCalledTimes(2);
    expect(result).toBeNull();
  });

  it('gateway-first skips direct model when gateway is unavailable and falls back to heuristic', async () => {
    callModelOnce.mockRejectedValue(new Error('no provider'));
    const result = await generateWorkflowFromDescription(null, {
      description: '产品写需求 → 开发实现 → 测试验收',
      agentIds: teamMembers.map((m) => m.agentId),
      strategy: 'gateway-first',
    });
    expect(callModelOnce).toHaveBeenCalledTimes(2);
    expect(result).not.toBeNull();
    expect(result!.source).toBe('heuristic');
  });
});
