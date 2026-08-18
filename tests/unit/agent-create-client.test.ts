import { beforeEach, describe, expect, it, vi } from 'vitest';

const createAgent = vi.fn();
const syncAllProviderAuthToRuntime = vi.fn();
const ensureClawXContext = vi.fn();

vi.mock('@electron/utils/agent-config', () => ({
  createAgent,
}));

vi.mock('@electron/services/providers/provider-runtime-sync', () => ({
  syncAllProviderAuthToRuntime,
}));

vi.mock('@electron/utils/openclaw-workspace', () => ({
  ensureClawXContext,
}));

describe('createClientAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createAgent.mockResolvedValue({ agents: [{ id: 'demo', name: 'Demo' }] });
    syncAllProviderAuthToRuntime.mockResolvedValue(undefined);
    ensureClawXContext.mockResolvedValue(undefined);
  });

  it('delegates to createAgent and runs post-provision hooks', async () => {
    const { createClientAgent } = await import('@electron/utils/agent-create-client');
    const snapshot = await createClientAgent('Demo Agent', { inheritWorkspace: false });
    expect(createAgent).toHaveBeenCalledWith('Demo Agent', { inheritWorkspace: false });
    expect(syncAllProviderAuthToRuntime).toHaveBeenCalled();
    expect(ensureClawXContext).toHaveBeenCalled();
    expect(snapshot.agents[0]?.id).toBe('demo');
  });
});
