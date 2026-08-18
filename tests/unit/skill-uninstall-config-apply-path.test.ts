/**
 * Uninstall uses 2026-07-25 stop → delete → restart semantics (not hot config.apply).
 *
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const getOpenClawConfigDirMock = vi.fn();
const listAgentsSnapshotReadOnlyMock = vi.fn();
const purgeSkillFromAgentAllowlistsMock = vi.fn();
const syncSkillsEntriesEnabledFromAgentsMock = vi.fn();
const removeServerMarketplaceSkillLocalInstallMock = vi.fn();
const clawHubUninstallMock = vi.fn();

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
    removeServerMarketplaceSkillLocalInstall: (...args: unknown[]) =>
      removeServerMarketplaceSkillLocalInstallMock(...args),
  };
});

function writeWorkspaceSkill(skillDir: string, name: string): void {
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), `---\nname: ${name}\n---\n`, 'utf8');
}

describe('skill uninstall 2026-07-25 gateway restart path', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    purgeSkillFromAgentAllowlistsMock.mockResolvedValue(undefined);
    syncSkillsEntriesEnabledFromAgentsMock.mockResolvedValue(false);
    removeServerMarketplaceSkillLocalInstallMock.mockResolvedValue({ removed: [], failed: [] });
    clawHubUninstallMock.mockResolvedValue(undefined);
    listAgentsSnapshotReadOnlyMock.mockResolvedValue({ agents: [] });
  });

  it('stops Gateway before disk/clawhub cleanup and restarts after; sync runs outside guard', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'skill-uninstall-725-'));
    const openclawDir = join(homeDir, '.openclaw');
    const workspaceDir = join(openclawDir, 'workspace');
    const skillDir = join(workspaceDir, 'skills', 'weekly-report-generator');
    writeWorkspaceSkill(skillDir, 'weekly-report-generator');
    getOpenClawConfigDirMock.mockReturnValue(openclawDir);
    listAgentsSnapshotReadOnlyMock.mockResolvedValue({
      agents: [{ id: 'main', workspace: workspaceDir, skills: ['weekly-report-generator'] }],
    });

    const callOrder: string[] = [];
    const stop = vi.fn(async () => {
      callOrder.push('stop');
    });
    const restart = vi.fn(async () => {
      callOrder.push('restart');
    });
    const start = vi.fn(async () => {
      callOrder.push('start');
    });
    const applyConfigHotOnly = vi.fn(async () => {
      callOrder.push('config.apply');
      return true;
    });
    const getStatus = vi.fn().mockReturnValue({ state: 'running' });
    const gatewayManager = { stop, restart, start, applyConfigHotOnly, getStatus };

    purgeSkillFromAgentAllowlistsMock.mockImplementation(async () => {
      callOrder.push('purge');
    });
    syncSkillsEntriesEnabledFromAgentsMock.mockImplementation(async () => {
      callOrder.push('sync-entries');
      return false;
    });
    clawHubUninstallMock.mockImplementation(async () => {
      callOrder.push('clawhub');
    });

    const { executeMarketplaceSkillUninstall } = await import(
      '@electron/services/skills/skill-uninstall'
    );
    const result = await executeMarketplaceSkillUninstall(
      { slug: 'weekly-report-generator' },
      {
        gatewayManager: gatewayManager as never,
        clawHubService: { uninstall: clawHubUninstallMock } as never,
      },
    );

    expect(result).toEqual({ success: true });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(restart).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
    expect(applyConfigHotOnly).not.toHaveBeenCalled();
    expect(callOrder).toEqual(['purge', 'stop', 'clawhub', 'restart', 'sync-entries']);
  });
});
