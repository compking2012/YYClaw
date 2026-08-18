import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginOfficeStoreTestIsolation,
  endOfficeStoreTestIsolation,
} from '../helpers/office-store-test-env.mocks';

const openClawConfigState = {
  agents: { list: [{ id: 'agent-a', workspace: '~/.openclaw/workspace-agent-a' }] },
};

vi.mock('../../electron/utils/channel-config', () => ({
  readOpenClawConfig: async () => openClawConfigState,
  writeOpenClawConfig: async (config: typeof openClawConfigState) => {
    openClawConfigState.agents = config.agents;
  },
}));

vi.mock('../../electron/services/providers/provider-runtime-sync', () => ({
  syncAgentModelOverrideToRuntime: vi.fn(),
}));

vi.mock('../../electron/services/office/office-spawn-policy', () => ({
  refreshOfficeSpawnToolPolicy: vi.fn(),
}));

vi.mock('../../electron/services/office/office-openclaw-establish', () => ({
  establishOfficeAgentsInOpenClaw: vi.fn(),
}));

vi.mock('../../electron/services/office/audit', () => ({
  auditLog: vi.fn(),
}));

describe('openclaw workspace config (1 agent = 1 role)', () => {
  let testRoot = '';

  beforeEach(async () => {
    vi.resetModules();
    testRoot = await beginOfficeStoreTestIsolation();
    openClawConfigState.agents = {
      list: [{ id: 'agent-a', workspace: '~/.openclaw/workspace-agent-a' }],
    };
  });

  afterEach(async () => {
    await endOfficeStoreTestIsolation(testRoot);
    vi.clearAllMocks();
  });

  it('syncOpenClawAgentWorkspaceForRole only ensures disk dirs without writing openclaw.json', async () => {
    const { syncOpenClawAgentWorkspaceForRole } = await import(
      '../../electron/services/office/agent-setup'
    );
    const roles = [{ id: 'r1', agentId: 'agent-a', name: '角色A' }];
    const before = openClawConfigState.agents.list[0]?.workspace;

    await syncOpenClawAgentWorkspaceForRole(
      { agentId: 'agent-a', name: '角色A' },
      roles,
    );

    expect(openClawConfigState.agents.list[0]?.workspace).toBe(before);
  });
});
