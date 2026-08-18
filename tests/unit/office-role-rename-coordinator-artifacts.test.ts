import { access, mkdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { roleStatusFileName } from '../../src/lib/office-project-file-naming';

describe('shared-agent member role rename updates coordinator project artifacts', () => {
  let testRoot = '';
  let previousOpenClawHome = '';

  beforeEach(async () => {
    vi.resetModules();
    previousOpenClawHome = process.env.OPENCLAW_HOME ?? '';
    testRoot = await mkdtemp(join(tmpdir(), 'office-member-artifact-'));
    process.env.OPENCLAW_HOME = testRoot;
  });

  afterEach(async () => {
    process.env.OPENCLAW_HOME = previousOpenClawHome;
    await rm(testRoot, { recursive: true, force: true });
  });

  it('renames status file under coordinator project when member role display name changes', async () => {
    const { renameRoleScopedArtifactsInCoordinatorProjects } = await import(
      '../../electron/services/office/role-project-artifact-rename'
    );
    const { coordinatorProjectRoot } = await import(
      '../../electron/services/office/project-context-paths'
    );

    const roles = [
      { id: 'coord', agentId: 'shared', name: '协调者' },
      { id: 'member', agentId: 'shared', name: '成员' },
    ];
    const scenarios = [
      { id: 'sc1', coordinatorRoleId: 'coord', roleIds: ['coord', 'member'] },
    ];
    const tasks = [
      {
        id: 'task-1',
        title: '演示项目',
        scenarioId: 'sc1',
        coordinatorRoleId: undefined as string | undefined,
      },
    ];

    const projectRoot = coordinatorProjectRoot(tasks[0]!.title, tasks[0]!.id);
    await mkdir(projectRoot, { recursive: true });
    const oldStatus = join(projectRoot, roleStatusFileName('成员'));
    await writeFile(oldStatus, '{"工作进展":"ok"}\n', 'utf8');

    await renameRoleScopedArtifactsInCoordinatorProjects({
      roleId: 'member',
      previousName: '成员',
      nextName: '成员B',
      roles: roles.map((r) => (r.id === 'member' ? { ...r, name: '成员B' } : r)),
      scenarios,
      tasks,
    });

    await expect(access(oldStatus, constants.F_OK)).rejects.toMatchObject({ code: 'ENOENT' });
    await access(join(projectRoot, roleStatusFileName('成员B')), constants.F_OK);
  });
});
