// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listEnhancedLocalSkillsMock = vi.fn();
const executeMarketplaceSkillUninstallMock = vi.fn();

vi.mock('@electron/utils/agent-config', () => ({
  listEnhancedLocalSkills: () => listEnhancedLocalSkillsMock(),
  applyBatchSkillAgentsMapping: vi.fn(),
  purgeSkillFromAgentAllowlists: vi.fn(),
}));

vi.mock('@electron/services/skills/skill-uninstall', () => ({
  executeMarketplaceSkillUninstall: (...args: unknown[]) => executeMarketplaceSkillUninstallMock(...args),
}));

import { createSkillsApi } from '@electron/services/skills-api';

function createTestSkillsApi() {
  return createSkillsApi({
    clawHubService: {} as never,
    gatewayManager: {
      getStatus: () => ({ state: 'stopped' }),
      rpc: vi.fn(),
    } as never,
    mainWindow: {} as never,
  });
}

describe('skills-api local IPC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeMarketplaceSkillUninstallMock.mockResolvedValue({ success: true });
  });

  it('delegates marketplaceUninstall to shared skill uninstall orchestrator', async () => {
    const result = await createTestSkillsApi().marketplaceUninstall({ slug: 'find-skills', baseDir: '/tmp/skill' });

    expect(result).toEqual({ success: true });
    expect(executeMarketplaceSkillUninstallMock).toHaveBeenCalledWith(
      { slug: 'find-skills', name: undefined, baseDir: '/tmp/skill' },
      expect.objectContaining({
        gatewayManager: expect.anything(),
        clawHubService: expect.anything(),
      }),
    );
  });

  it('returns enhanced skills with agent assignments (parity with HTTP /api/skills/local)', async () => {
    listEnhancedLocalSkillsMock.mockResolvedValue([
      {
        id: 'pptx',
        name: 'pptx',
        description: 'Create presentations',
        enabled: true,
        agents: ['pm'],
        source: 'openclaw-managed',
      },
      {
        id: 'pdf',
        name: 'pdf',
        description: 'PDF tools',
        enabled: false,
        agents: [],
        source: 'openclaw-bundled',
      },
    ]);

    const result = await createTestSkillsApi().local();

    expect(listEnhancedLocalSkillsMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      success: true,
      skills: [
        expect.objectContaining({
          id: 'pptx',
          enabled: true,
          agents: ['pm'],
        }),
        expect.objectContaining({
          id: 'pdf',
          enabled: false,
          agents: [],
        }),
      ],
    });
  });

  it('propagates listEnhancedLocalSkills failures to the caller', async () => {
    listEnhancedLocalSkillsMock.mockRejectedValue(new Error('config lock timeout'));

    await expect(createTestSkillsApi().local()).rejects.toThrow('config lock timeout');
  });
});
