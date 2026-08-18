import { beforeEach, describe, expect, it, vi } from 'vitest';

const { writeOpenClawConfig, readOpenClawConfig } = vi.hoisted(() => ({
  writeOpenClawConfig: vi.fn(),
  readOpenClawConfig: vi.fn(),
}));

vi.mock('@electron/utils/config-mutex', () => ({
  withConfigLock: async (fn: () => Promise<unknown>) => fn(),
}));

vi.mock('@electron/utils/channel-config', () => ({
  readOpenClawConfig,
  writeOpenClawConfig,
}));

vi.mock('@electron/utils/openclaw-paths', () => ({
  OPENCLAW_HOME: '/tmp/openclaw-establish-test-home',
}));

vi.mock('@electron/services/office/agent-setup', () => ({
  OFFICE_SESSION_TOOLS: ['sessions_list', 'read', 'exec'],
}));

vi.mock('@electron/services/office/project-context-paths', () => ({
  agentWorkspaceConfigPath: (id: string) => `~/.openclaw/workspace-${id}`,
  ensureRoleWorkspaceProjectsDir: vi.fn(),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    mkdir: vi.fn(),
  };
});

import { establishOfficeAgentsInOpenClaw } from '@electron/services/office/office-openclaw-establish';

describe('establishOfficeAgentsInOpenClaw', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not write openclaw.json for listed agents', async () => {
    readOpenClawConfig.mockResolvedValue({
      agents: {
        list: [
          { id: 'agent-a', tools: { allow: ['read', 'sessions_spawn'] } },
          { id: 'agent-b', tools: {} },
        ],
      },
    });

    await establishOfficeAgentsInOpenClaw(['agent-a']);

    expect(readOpenClawConfig).not.toHaveBeenCalled();
    expect(writeOpenClawConfig).not.toHaveBeenCalled();
  });

  it('skips write when agent id is absent from openclaw.json', async () => {
    readOpenClawConfig.mockResolvedValue({
      agents: {
        list: [{ id: 'other-agent', tools: {} }],
      },
    });

    await establishOfficeAgentsInOpenClaw(['missing-agent']);

    expect(writeOpenClawConfig).not.toHaveBeenCalled();
  });
});
