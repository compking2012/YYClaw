import { beforeEach, describe, expect, it, vi } from 'vitest';

const collectors = vi.hoisted(() => ({
  collectSystemSnapshot: vi.fn(),
  collectConfigSnapshot: vi.fn(),
  collectAgentActivity: vi.fn(),
  collectStatsAll: vi.fn(),
}));

const agentConfig = vi.hoisted(() => ({
  listAgentsSnapshot: vi.fn(),
}));

vi.mock('@electron/services/admin-console/collectors', () => ({
  collectSystemSnapshot: collectors.collectSystemSnapshot,
  collectConfigSnapshot: collectors.collectConfigSnapshot,
  collectAgentActivity: collectors.collectAgentActivity,
  collectStatsAll: collectors.collectStatsAll,
}));

vi.mock('@electron/utils/agent-config', () => ({
  listAgentsSnapshot: agentConfig.listAgentsSnapshot,
}));

describe('admin console heartbeat roster', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    collectors.collectSystemSnapshot.mockResolvedValue({
      timestamp: 1_772_000_000,
      status: 'online',
    });
    collectors.collectConfigSnapshot.mockResolvedValue({
      agents: {
        list: [{ id: 'raw-main', name: 'Raw Main' }],
      },
      crontab: { jobs: [] },
    });
    collectors.collectAgentActivity.mockResolvedValue({ agents: [] });
    collectors.collectStatsAll.mockResolvedValue({ daily: [] });
    agentConfig.listAgentsSnapshot.mockResolvedValue({
      defaultAgentId: 'main',
      defaultModelRef: 'openai/gpt-5.4',
      agents: [
        {
          id: 'main',
          name: 'Main Agent',
          isDefault: true,
          modelRef: 'openai/gpt-5.4',
          overrideModelRef: null,
          workspace: '~/.openclaw/workspace',
          agentDir: '~/.openclaw/agents/main/agent',
          channelTypes: ['lark'],
        },
      ],
    });
  });

  it('includes normalized agentRoster alongside legacy raw agents', async () => {
    const { buildHeartbeatPayload } = await import('@electron/services/admin-console/protocol/publishers');

    const payload = await buildHeartbeatPayload('client-1', null);

    expect(payload.agents).toEqual({
      list: [{ id: 'raw-main', name: 'Raw Main' }],
    });
    expect(payload.crontabs).toEqual({ jobs: [] });
    expect(payload.agentRoster).toEqual({
      client_id: 'client-1',
      schema_version: 1,
      reported_at: '2026-02-25T06:13:20.000Z',
      defaultAgentId: 'main',
      defaultModelRef: 'openai/gpt-5.4',
      agents: [
        {
          id: 'main',
          name: 'Main Agent',
          isDefault: true,
          modelRef: 'openai/gpt-5.4',
          overrideModelRef: null,
          workspace: '~/.openclaw/workspace',
          agentDir: '~/.openclaw/agents/main/agent',
          channelTypes: ['lark'],
        },
      ],
    });
  });

  it('keeps agentRoster on gateway reconfiguring heartbeats when raw config snapshot is skipped', async () => {
    const { buildHeartbeatPayload } = await import('@electron/services/admin-console/protocol/publishers');

    const payload = await buildHeartbeatPayload('client-1', {
      state: 'starting',
      gatewayReady: false,
    } as never);

    expect(collectors.collectConfigSnapshot).not.toHaveBeenCalled();
    expect(payload.agents).toBeUndefined();
    expect(payload.agentRoster).toMatchObject({
      client_id: 'client-1',
      schema_version: 1,
      defaultAgentId: 'main',
      agents: [expect.objectContaining({ id: 'main', isDefault: true })],
    });
  });
});
