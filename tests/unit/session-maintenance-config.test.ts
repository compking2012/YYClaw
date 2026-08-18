import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome, testUserData } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testHome: `/tmp/clawx-session-maintenance-${suffix}`,
    testUserData: `/tmp/clawx-session-maintenance-user-data-${suffix}`,
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const mocked = { ...actual, homedir: () => testHome };
  return { ...mocked, default: mocked };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => testUserData,
    getVersion: () => '0.0.0-test',
    getAppPath: () => '/tmp',
  },
}));

vi.mock('@electron/utils/logger', () => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('electron-store', () => ({
  default: class MockStore {
    store: Record<string, unknown> = {};
    get(key: string) { return this.store[key]; }
    set(key: string, value: unknown) { this.store[key] = value; }
    delete(key: string) { delete this.store[key]; }
    clear() { this.store = {}; }
  },
}));

const CONFIG_PATH = join(testHome, '.openclaw', 'openclaw.json');

async function readConfig(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(CONFIG_PATH, 'utf8')) as Record<string, unknown>;
}

describe('session maintenance config', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(testHome, { recursive: true, force: true });
    await mkdir(join(testHome, '.openclaw'), { recursive: true });
    await writeFile(CONFIG_PATH, JSON.stringify({ agents: { list: [{ id: 'main' }] } }), 'utf8');
  });

  it('writes session.maintenance and reads it back', async () => {
    const { saveSessionMaintenance, readSessionMaintenance } = await import('@electron/utils/channel-config');

    await saveSessionMaintenance({ mode: 'enforce', pruneAfter: '30d', maxEntries: 500, maxDiskBytes: '500mb' });

    const onDisk = await readConfig();
    expect((onDisk.session as Record<string, unknown>).maintenance).toMatchObject({
      mode: 'enforce',
      pruneAfter: '30d',
      maxEntries: 500,
      maxDiskBytes: '500mb',
    });

    const read = await readSessionMaintenance();
    expect(read.mode).toBe('enforce');
    expect(read.maxEntries).toBe(500);
  });

  it('clears a field when the patch value is empty and preserves unmanaged keys', async () => {
    const { saveSessionMaintenance } = await import('@electron/utils/channel-config');

    await saveSessionMaintenance({ mode: 'enforce', maxDiskBytes: '500mb', resetArchiveRetention: '14d' });
    // Clear maxDiskBytes; leave resetArchiveRetention untouched (not in the patch).
    await saveSessionMaintenance({ maxDiskBytes: '' });

    const maintenance = (await readConfig()).session as { maintenance: Record<string, unknown> };
    expect(maintenance.maintenance).not.toHaveProperty('maxDiskBytes');
    expect(maintenance.maintenance.mode).toBe('enforce');
    expect(maintenance.maintenance.resetArchiveRetention).toBe('14d');
  });

  it('ensures a default enforce mode when none is set and is a no-op otherwise', async () => {
    const { ensureSessionMaintenanceDefaults } = await import('@electron/utils/channel-config');

    const wroteDefault = await ensureSessionMaintenanceDefaults();
    expect(wroteDefault).toBe(true);
    const afterFirst = (await readConfig()).session as { maintenance: Record<string, unknown> };
    expect(afterFirst.maintenance.mode).toBe('enforce');

    // Second call must not overwrite an existing mode.
    const wroteAgain = await ensureSessionMaintenanceDefaults();
    expect(wroteAgain).toBe(false);
  });

  it('does not override an explicit warn mode', async () => {
    const { saveSessionMaintenance, ensureSessionMaintenanceDefaults } = await import('@electron/utils/channel-config');
    await saveSessionMaintenance({ mode: 'warn' });
    const wrote = await ensureSessionMaintenanceDefaults();
    expect(wrote).toBe(false);
    const cfg = (await readConfig()).session as { maintenance: Record<string, unknown> };
    expect(cfg.maintenance.mode).toBe('warn');
  });
});
