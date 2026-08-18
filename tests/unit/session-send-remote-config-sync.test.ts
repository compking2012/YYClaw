// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cleanupDanglingWeChatPluginState: vi.fn(),
  listConfiguredChannelsFromConfig: vi.fn(async () => []),
  readOpenClawConfig: vi.fn(),
  writeOpenClawConfig: vi.fn(),
  withConfigLock: vi.fn(async (fn: () => Promise<void>) => fn()),
}));

vi.mock('@electron/utils/channel-config', () => ({
  cleanupDanglingWeChatPluginState: mocks.cleanupDanglingWeChatPluginState,
  listConfiguredChannelsFromConfig: mocks.listConfiguredChannelsFromConfig,
  readOpenClawConfig: mocks.readOpenClawConfig,
  writeOpenClawConfig: mocks.writeOpenClawConfig,
}));

vi.mock('@electron/utils/config-mutex', () => ({
  withConfigLock: mocks.withConfigLock,
}));

describe('session_send_remote Gateway config sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('builds Host API environment for Gateway launch', async () => {
    const { buildClawXHostApiEnv } = await import('@electron/gateway/config-sync');

    expect(buildClawXHostApiEnv(13210, 'host-token')).toEqual({
      CLAWX_HOST_API_URL: 'http://127.0.0.1:13210',
      CLAWX_HOST_API_TOKEN: 'host-token',
    });
  });

  it('adds plugin registration idempotently without removing existing plugin config', async () => {
    const openclawConfig = {
      plugins: {
        enabled: false,
        allow: ['existing-plugin', 'session-send-remote'],
        entries: {
          'existing-plugin': { enabled: true },
          'session-send-remote': { enabled: true, custom: 'keep-me' },
        },
      },
    };
    mocks.readOpenClawConfig.mockResolvedValueOnce(openclawConfig);

    const { ensureSessionSendRemotePluginConfig } = await import('@electron/gateway/config-sync');
    await ensureSessionSendRemotePluginConfig();

    expect(mocks.writeOpenClawConfig).toHaveBeenCalledWith({
      plugins: {
        enabled: true,
        allow: ['existing-plugin', 'session-send-remote'],
        entries: {
          'existing-plugin': { enabled: true },
          'session-send-remote': { enabled: true, custom: 'keep-me' },
        },
      },
    });
  });

  it('enables tokenjuice when prompt optimization is enabled', async () => {
    const openclawConfig = {
      plugins: {
        allow: ['existing-plugin'],
        entries: {
          'existing-plugin': { enabled: true },
          tokenjuice: { enabled: false, custom: 'keep-me' },
        },
      },
    };
    mocks.readOpenClawConfig.mockResolvedValueOnce(openclawConfig);

    const { syncPromptOptimizationPluginConfig } = await import('@electron/gateway/config-sync');
    await syncPromptOptimizationPluginConfig(true, { pluginInstalled: true });

    expect(mocks.writeOpenClawConfig).toHaveBeenCalledWith({
      plugins: {
        enabled: true,
        allow: ['existing-plugin', 'tokenjuice'],
        entries: {
          'existing-plugin': { enabled: true },
          tokenjuice: { enabled: true, custom: 'keep-me' },
        },
      },
    });
  });

  // openclaw 2026.7.1 turned tokenjuice into an external official plugin whose
  // catalog entry prefers npm, so a configured-but-uninstalled tokenjuice makes
  // the kernel shell out to npm during startup migration and then refuse to
  // report the Gateway ready. Losing prompt optimization is acceptable; a dead
  // Gateway is not.
  it('does not register tokenjuice when the plugin is not installed', async () => {
    const openclawConfig = {
      plugins: {
        enabled: true,
        allow: ['existing-plugin', 'tokenjuice'],
        entries: {
          'existing-plugin': { enabled: true },
          tokenjuice: { enabled: true },
        },
      },
    };
    mocks.readOpenClawConfig.mockResolvedValueOnce(openclawConfig);

    const { syncPromptOptimizationPluginConfig } = await import('@electron/gateway/config-sync');
    await syncPromptOptimizationPluginConfig(true, { pluginInstalled: false });

    expect(mocks.writeOpenClawConfig).toHaveBeenCalledWith({
      plugins: {
        enabled: true,
        allow: ['existing-plugin'],
        entries: {
          'existing-plugin': { enabled: true },
        },
      },
    });
  });

  it('removes tokenjuice when prompt optimization is disabled', async () => {
    const openclawConfig = {
      plugins: {
        enabled: true,
        allow: ['existing-plugin', 'tokenjuice'],
        entries: {
          'existing-plugin': { enabled: true },
          tokenjuice: { enabled: true, custom: 'remove-me' },
        },
      },
    };
    mocks.readOpenClawConfig.mockResolvedValueOnce(openclawConfig);

    const { syncPromptOptimizationPluginConfig } = await import('@electron/gateway/config-sync');
    await syncPromptOptimizationPluginConfig(false, { pluginInstalled: false });

    expect(mocks.writeOpenClawConfig).toHaveBeenCalledWith({
      plugins: {
        enabled: true,
        allow: ['existing-plugin'],
        entries: {
          'existing-plugin': { enabled: true },
        },
      },
    });
  });
});
