import { access, mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('office project dir reset + lock', () => {
  let testRoot = '';
  let previousHome = '';

  beforeEach(async () => {
    vi.resetModules();
    previousHome = process.env.OPENCLAW_HOME ?? '';
    testRoot = await mkdtemp(join(tmpdir(), 'office-project-dir-lock-'));
    process.env.OPENCLAW_HOME = testRoot;
  });

  afterEach(async () => {
    process.env.OPENCLAW_HOME = previousHome;
    await rm(testRoot, { recursive: true, force: true });
  });

  it('emptyOfficeProjectDirectory keeps root inode and clears children', async () => {
    const { emptyOfficeProjectDirectory } = await import(
      '../../electron/services/office/office-project-dir-reset'
    );
    const root = join(testRoot, 'office', 'project', 'task-1');
    await mkdir(join(root, 'nested'), { recursive: true });
    await writeFile(join(root, 'room.jsonl'), 'x\n', 'utf8');
    await writeFile(join(root, 'nested', 'a.txt'), 'y', 'utf8');

    await emptyOfficeProjectDirectory(root);

    await access(root, constants.F_OK);
    expect(await readdir(root)).toEqual([]);
  });

  it('concurrent reinitialize + ensure does not throw ENOENT mkdir', async () => {
    const { buildCoordinatorPathContext, ensureOfficeProjectDirectory } = await import(
      '../../electron/services/office/project-context-paths'
    );
    const { reinitializeCoordinatorProjectWorkspace } = await import(
      '../../electron/services/office/project-artifacts-fs'
    );

    const taskId = 'project-race-1';
    const taskTitle = '漫画PPT';
    const teamRoles = [{ agentId: 'coord', displayName: '协调者' }];
    const ctx = buildCoordinatorPathContext({ coordinatorAgentId: 'coord' }, teamRoles);

    await ensureOfficeProjectDirectory(ctx, taskTitle, taskId);
    await writeFile(
      join(testRoot, 'office', 'project', taskId, 'stale.txt'),
      'old',
      'utf8',
    );

    const task = {
      id: taskId,
      title: taskTitle,
      description: '',
      status: 'pending' as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      agentIds: ['coord'],
      coordinatorAgentId: 'coord',
      executionMode: 'smart' as const,
      origin: 'standalone' as const,
      lifecycle: 'active' as const,
      nodeRuns: [],
    };

    const results = await Promise.allSettled(
      Array.from({ length: 40 }, (_, i) =>
        i % 2 === 0
          ? reinitializeCoordinatorProjectWorkspace({
              coordinatorAgentId: 'coord',
              coordinatorRoleId: 'coord',
              teamRoles,
              task: task as never,
            })
          : ensureOfficeProjectDirectory({ id: taskId, title: taskTitle }),
      ),
    );

    const failures = results.filter((r) => r.status === 'rejected');
    expect(failures).toEqual([]);
    await access(join(testRoot, 'office', 'project', taskId), constants.F_OK);
  });

  it('withOfficeProjectDirLock serializes and allows re-entry', async () => {
    const { withOfficeProjectDirLock } = await import(
      '../../electron/services/office/office-project-dir-lock'
    );
    const order: string[] = [];
    let nested = '';

    const a = withOfficeProjectDirLock('p1', async () => {
      order.push('a-start');
      nested = await withOfficeProjectDirLock('p1', async () => 'nested-ok');
      await new Promise((r) => setTimeout(r, 20));
      order.push('a-end');
      return nested;
    });
    const b = withOfficeProjectDirLock('p1', async () => {
      order.push('b');
      return 'b';
    });

    const [aResult, bResult] = await Promise.all([a, b]);
    expect(aResult).toBe('nested-ok');
    expect(bResult).toBe('b');
    expect(order).toEqual(['a-start', 'a-end', 'b']);
  });
});
