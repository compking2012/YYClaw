import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, toNamespacedPath } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { safeRmSync } from '@electron/utils/safe-fs';

// Windows `lstat` cannot be trusted to report a junction as a link; that is the
// whole reason safeRmSync also checks realpath containment. `pretendPlainDir`
// reproduces that mis-report on any platform so both guards can be exercised
// here and on the Windows CI job.
const { pretendPlainDir } = vi.hoisted(() => ({
  pretendPlainDir: { suffix: null as string | null },
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  const lstatSync = ((...args: Parameters<typeof actual.lstatSync>) => {
    const stats = actual.lstatSync(...args);
    const suffix = pretendPlainDir.suffix;
    if (!suffix || !String(args[0]).endsWith(suffix) || !stats) return stats;
    return Object.assign(Object.create(Object.getPrototypeOf(stats)), stats, {
      isSymbolicLink: () => false,
      isDirectory: () => true,
    });
  }) as typeof actual.lstatSync;
  return { ...actual, default: { ...actual, lstatSync }, lstatSync };
});

const SYMLINK_TYPE: 'dir' | 'junction' = process.platform === 'win32' ? 'junction' : 'dir';

describe('safeRmSync', () => {
  let root: string;

  afterEach(() => {
    pretendPlainDir.suffix = null;
    if (root && existsSync(root)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('removes a directory tree without deleting outbound symlink/junction targets', () => {
    root = mkdtempSync(join(tmpdir(), 'clawx-safe-rm-'));
    const bundledRuntime = join(root, 'bundled-openclaw');
    const pluginDir = join(root, 'extensions', 'openclaw-weixin');
    const peerLink = join(pluginDir, 'node_modules', 'openclaw');

    mkdirSync(bundledRuntime, { recursive: true });
    writeFileSync(join(bundledRuntime, 'openclaw.mjs'), 'export {}');
    writeFileSync(join(bundledRuntime, 'package.json'), '{"name":"openclaw"}');

    mkdirSync(join(pluginDir, 'node_modules'), { recursive: true });
    writeFileSync(join(pluginDir, 'openclaw.plugin.json'), '{"id":"openclaw-weixin"}');
    symlinkSync(bundledRuntime, peerLink, SYMLINK_TYPE);

    safeRmSync(pluginDir);

    expect(existsSync(pluginDir)).toBe(false);
    expect(existsSync(join(bundledRuntime, 'openclaw.mjs'))).toBe(true);
    expect(existsSync(join(bundledRuntime, 'package.json'))).toBe(true);
  });

  it('removes a top-level outbound directory link without deleting its target', () => {
    root = mkdtempSync(join(tmpdir(), 'clawx-safe-rm-link-'));
    const target = join(root, 'runtime');
    const link = join(root, 'plugin-link');

    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'marker.txt'), 'keep');
    symlinkSync(target, link, SYMLINK_TYPE);

    safeRmSync(link);

    expect(existsSync(link)).toBe(false);
    expect(existsSync(join(target, 'marker.txt'))).toBe(true);
  });

  it('is a no-op when the path is already missing', () => {
    root = mkdtempSync(join(tmpdir(), 'clawx-safe-rm-missing-'));
    const missing = join(root, 'does-not-exist');

    expect(() => safeRmSync(missing)).not.toThrow();
  });

  it.runIf(process.platform === 'win32')('removes a directory tree through a Windows namespaced path', () => {
    root = mkdtempSync(join(tmpdir(), 'clawx-safe-rm-namespaced-'));
    const pluginDir = join(root, 'extensions', 'wecom');
    const namespacedPluginDir = toNamespacedPath(pluginDir);

    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'openclaw.plugin.json'), '{"id":"wecom"}');

    expect(namespacedPluginDir).toMatch(/^\\\\\?\\/);
    expect(() => safeRmSync(namespacedPluginDir)).not.toThrow();
    expect(existsSync(pluginDir)).toBe(false);
  });

  it('refuses to traverse an outbound junction that lstat mis-reports as a plain directory', () => {
    root = mkdtempSync(join(tmpdir(), 'clawx-safe-rm-misreport-'));
    const bundledRuntime = join(root, 'bundled-openclaw');
    const pluginDir = join(root, 'extensions', 'openclaw-lark');
    const peerLink = join(pluginDir, 'node_modules', 'openclaw');

    mkdirSync(bundledRuntime, { recursive: true });
    writeFileSync(join(bundledRuntime, 'openclaw.mjs'), 'export {}');
    mkdirSync(join(pluginDir, 'node_modules'), { recursive: true });
    symlinkSync(bundledRuntime, peerLink, SYMLINK_TYPE);
    pretendPlainDir.suffix = join('node_modules', 'openclaw');

    // Fails closed: the realpath containment check rejects the entry instead of
    // deleting the bundled runtime it points at.
    expect(() => safeRmSync(pluginDir)).toThrow(/outside root/);
    expect(existsSync(join(bundledRuntime, 'openclaw.mjs'))).toBe(true);
  });

  it('does not recurse forever on an inbound link that lstat mis-reports as a plain directory', () => {
    root = mkdtempSync(join(tmpdir(), 'clawx-safe-rm-cycle-'));
    const pluginDir = join(root, 'extensions', 'openclaw-lark');
    const selfLink = join(pluginDir, 'node_modules', 'openclaw-lark');

    mkdirSync(join(pluginDir, 'node_modules'), { recursive: true });
    writeFileSync(join(pluginDir, 'openclaw.plugin.json'), '{"id":"openclaw-lark"}');
    // `openclaw doctor --fix` satisfies a package self-reference exactly this way.
    symlinkSync(pluginDir, selfLink, SYMLINK_TYPE);
    pretendPlainDir.suffix = join('node_modules', 'openclaw-lark');

    // The link resolves *inside* the deletion root, so containment cannot catch
    // it; only the visited-realpath guard stops the walk.
    safeRmSync(pluginDir);

    expect(existsSync(pluginDir)).toBe(false);
  });

  it('runs the junction regression test in the Windows CI job', () => {
    const projectRoot = join(import.meta.dirname, '..', '..');
    const workflow = readFileSync(join(projectRoot, '.github', 'workflows', 'check.yml'), 'utf8');
    const windowsJob = workflow.slice(workflow.indexOf('  build:'));

    expect(windowsJob).toContain('tests/unit/safe-fs.test.ts');
  });
});
