import { access, mkdir, writeFile, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('migrateDirToDestination', () => {
  let testRoot = '';

  beforeEach(async () => {
    vi.resetModules();
    testRoot = await mkdtemp(join(tmpdir(), 'ws-rename-'));
  });

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true });
  });

  it('replaces empty destination scaffold and moves source data', async () => {
    const { migrateDirToDestination } = await import(
      '../../electron/services/office/workspace-dir-rename'
    );
    const src = join(testRoot, 'workspace-a-old');
    const dest = join(testRoot, 'workspace-a-new');
    await mkdir(src, { recursive: true });
    await writeFile(join(src, 'data.txt'), 'payload', 'utf8');
    await mkdir(join(dest, 'office', 'projects'), { recursive: true });

    expect(await migrateDirToDestination(src, dest)).toBe(true);
    await expect(access(src, constants.F_OK)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(dest, 'data.txt'), 'utf8')).toBe('payload');
  });

  it('merges when both directories have data, leaving only dest', async () => {
    const { migrateDirToDestination, removeStaleRenamePaths } = await import(
      '../../electron/services/office/workspace-dir-rename'
    );
    const src = join(testRoot, 'old-proj');
    const dest = join(testRoot, 'new-proj');
    await mkdir(join(src, 'office', 'projects', 'alpha'), { recursive: true });
    await writeFile(join(src, 'office', 'projects', 'alpha', 'from-old.txt'), 'old', 'utf8');
    await mkdir(join(dest, 'office', 'projects', 'beta'), { recursive: true });
    await writeFile(join(dest, 'office', 'projects', 'beta', 'from-new.txt'), 'new', 'utf8');

    expect(await migrateDirToDestination(src, dest)).toBe(true);
    await expect(access(src, constants.F_OK)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(dest, 'office', 'projects', 'alpha', 'from-old.txt'), 'utf8')).toBe(
      'old',
    );
    expect(await readFile(join(dest, 'office', 'projects', 'beta', 'from-new.txt'), 'utf8')).toBe(
      'new',
    );

    await mkdir(src, { recursive: true });
    await writeFile(join(src, 'stale.txt'), 'x', 'utf8');
    await removeStaleRenamePaths([src], dest);
    await expect(access(src, constants.F_OK)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
