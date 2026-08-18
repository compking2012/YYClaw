/**
 * clawhubUninstall matches 2026-07-25: purge → stop/restart guard → clawhub.uninstall → sync.
 *
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const purgeMock = vi.fn();
const syncMock = vi.fn();

vi.mock('../../electron/gateway/config-refresh-scheduler', () => ({
  noteConfigWatcherRefresh: vi.fn(),
}));

vi.mock('@electron/utils/agent-config', () => ({
  listEnhancedLocalSkills: vi.fn(),
  applyBatchSkillAgentsMapping: vi.fn(),
  purgeSkillFromAgentAllowlists: (...args: unknown[]) => purgeMock(...args),
}));

vi.mock('@electron/utils/skill-entries-sync', () => ({
  syncSkillsEntriesEnabledFromAgents: (...args: unknown[]) => syncMock(...args),
}));

describe('skills-api clawhubUninstall 2026-07-25 path', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    purgeMock.mockResolvedValue(undefined);
    syncMock.mockResolvedValue(false);
  });

  it('purges, stops/restarts around clawhub uninstall, then syncs entries', async () => {
    const callOrder: string[] = [];
    purgeMock.mockImplementation(async () => {
      callOrder.push('purge');
    });
    syncMock.mockImplementation(async () => {
      callOrder.push('sync-entries');
      return false;
    });
    const uninstallMock = vi.fn(async () => {
      callOrder.push('clawhub');
    });
    const stop = vi.fn(async () => {
      callOrder.push('stop');
    });
    const restart = vi.fn(async () => {
      callOrder.push('restart');
    });
    const start = vi.fn(async () => {
      callOrder.push('start');
    });
    const getStatus = vi.fn().mockReturnValue({ state: 'running' });

    const { createSkillsApi } = await import('@electron/services/skills-api');
    const api = createSkillsApi({
      clawHubService: { uninstall: uninstallMock } as never,
      gatewayManager: { stop, restart, start, getStatus } as never,
      mainWindow: {} as never,
    });

    await expect(api.clawhubUninstall({ slug: 'find-skills' })).resolves.toEqual({ success: true });
    expect(start).not.toHaveBeenCalled();
    expect(callOrder).toEqual(['purge', 'stop', 'clawhub', 'restart', 'sync-entries']);
  });
});
