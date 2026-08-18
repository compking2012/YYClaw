import { beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const getOpenClawConfigDirMock = vi.fn();
const listAgentsSnapshotReadOnlyMock = vi.fn();
const removeServerMarketplaceSkillLocalInstallMock = vi.fn();
const purgeSkillFromAgentAllowlistsMock = vi.fn();
const syncSkillsEntriesEnabledFromAgentsMock = vi.fn();
const clawHubUninstallMock = vi.fn();
const withGatewayRestartMock = vi.fn();

vi.mock('@electron/utils/paths', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@electron/utils/paths')>();
  return {
    ...actual,
    getOpenClawConfigDir: () => getOpenClawConfigDirMock(),
  };
});

vi.mock('@electron/utils/agent-config', () => ({
  listAgentsSnapshotReadOnly: () => listAgentsSnapshotReadOnlyMock(),
  purgeSkillFromAgentAllowlists: (...args: unknown[]) => purgeSkillFromAgentAllowlistsMock(...args),
}));

vi.mock('@electron/utils/skill-entries-sync', () => ({
  syncSkillsEntriesEnabledFromAgents: (...args: unknown[]) => syncSkillsEntriesEnabledFromAgentsMock(...args),
}));

vi.mock('@electron/services/skills-marketplace-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@electron/services/skills-marketplace-client')>();
  return {
    ...actual,
    removeServerMarketplaceSkillLocalInstall: (...args: unknown[]) => removeServerMarketplaceSkillLocalInstallMock(...args),
  };
});

vi.mock('@electron/services/skills/skill-gateway-fs-guard', () => ({
  withGatewayRestartForSkillFilesystem: (_gm: unknown, fn: () => Promise<void>) => {
    withGatewayRestartMock();
    return fn();
  },
}));

function writeWorkspaceSkill(skillDir: string, name: string): void {
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), `---\nname: ${name}\n---\n`, 'utf8');
}

describe('skill-uninstall (2026-07-25 semantics)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    purgeSkillFromAgentAllowlistsMock.mockResolvedValue(undefined);
    syncSkillsEntriesEnabledFromAgentsMock.mockResolvedValue(false);
    removeServerMarketplaceSkillLocalInstallMock.mockResolvedValue({ removed: [], failed: [] });
    clawHubUninstallMock.mockResolvedValue(undefined);
    listAgentsSnapshotReadOnlyMock.mockResolvedValue({ agents: [] });
  });

  it('removes workspace skill directories under agent workspaces', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'skill-uninstall-workspace-'));
    const openclawDir = join(homeDir, '.openclaw');
    const workspaceDir = join(openclawDir, 'workspace');
    const skillDir = join(workspaceDir, 'skills', 'official-yyclaw-ppt');
    writeWorkspaceSkill(skillDir, 'official-yyclaw-ppt');
    getOpenClawConfigDirMock.mockReturnValue(openclawDir);
    listAgentsSnapshotReadOnlyMock.mockResolvedValue({
      agents: [{ id: 'main', workspace: workspaceDir, skills: ['official-yyclaw-ppt'] }],
    });

    const { removeLocalSkillInstallFromDisk } = await import('@electron/services/skills/skill-uninstall');
    const result = await removeLocalSkillInstallFromDisk({
      skillId: 'official-yyclaw-ppt',
      displayName: 'official-yyclaw-ppt',
    });

    expect(result.failed).toEqual([]);
    expect(result.removed).toEqual(expect.arrayContaining([skillDir]));
    expect(existsSync(skillDir)).toBe(false);
  });

  it('purges allowlists before filesystem removal, then syncs entries after restart guard', async () => {
    const callOrder: string[] = [];
    purgeSkillFromAgentAllowlistsMock.mockImplementation(async () => {
      callOrder.push('purge');
    });
    withGatewayRestartMock.mockImplementation(() => {
      callOrder.push('filesystem');
    });
    clawHubUninstallMock.mockImplementation(async () => {
      callOrder.push('clawhub');
    });
    syncSkillsEntriesEnabledFromAgentsMock.mockImplementation(async () => {
      callOrder.push('sync-entries');
      return false;
    });

    const { executeMarketplaceSkillUninstall } = await import('@electron/services/skills/skill-uninstall');
    const result = await executeMarketplaceSkillUninstall(
      { slug: 'find-skills' },
      {
        gatewayManager: {} as never,
        clawHubService: { uninstall: clawHubUninstallMock } as never,
      },
    );

    expect(result).toEqual({ success: true });
    expect(purgeSkillFromAgentAllowlistsMock).toHaveBeenCalledWith('find-skills');
    expect(clawHubUninstallMock).toHaveBeenCalledWith({ slug: 'find-skills', baseDir: undefined });
    expect(syncSkillsEntriesEnabledFromAgentsMock).toHaveBeenCalledTimes(1);
    // 7/25: sync is outside the restart guard (after filesystem+clawhub).
    expect(callOrder).toEqual(['purge', 'filesystem', 'clawhub', 'sync-entries']);
  });

  it('name-only uninstall still runs clawhub cleanup after server marketplace removal', async () => {
    removeServerMarketplaceSkillLocalInstallMock.mockResolvedValue({
      removed: [join('/tmp/.openclaw/skills', 'server-skill')],
      failed: [],
    });

    const { executeMarketplaceSkillUninstall } = await import('@electron/services/skills/skill-uninstall');
    const result = await executeMarketplaceSkillUninstall(
      { name: 'server-skill' },
      {
        gatewayManager: {} as never,
        clawHubService: { uninstall: clawHubUninstallMock } as never,
      },
    );

    expect(result).toEqual({ success: true });
    expect(purgeSkillFromAgentAllowlistsMock).toHaveBeenCalledWith('server-skill');
    expect(clawHubUninstallMock).toHaveBeenCalledWith({ slug: 'server-skill', baseDir: undefined });
  });
});
