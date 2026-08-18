import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('office project-context-paths', () => {
  let testRoot = '';
  let previousHome = '';

  beforeEach(async () => {
    vi.resetModules();
    previousHome = process.env.OPENCLAW_HOME ?? '';
    testRoot = await mkdtemp(join(tmpdir(), 'office-project-paths-'));
    process.env.OPENCLAW_HOME = testRoot;
  });

  afterEach(async () => {
    process.env.OPENCLAW_HOME = previousHome;
    await rm(testRoot, { recursive: true, force: true });
  });

  it('resolveCoordinatorPathContext uses workspace-<agentId>', async () => {
    const { projectDirSegment } = await import('../../src/lib/office-project-context');
    const { coordinatorProjectRoot, resolveCoordinatorPathContext, agentWorkspaceConfigPath } =
      await import('../../electron/services/office/project-context-paths');

    const teamRoles = [{ agentId: 'pm', displayName: '产品' }];
    const ctx = await resolveCoordinatorPathContext({ coordinatorAgentId: 'pm' }, teamRoles);
    const root = coordinatorProjectRoot(ctx, '需求', 'task-1');
    expect(root).toBe(
      join(testRoot, 'office', 'project', projectDirSegment('需求', 'task-1')),
    );
    expect(agentWorkspaceConfigPath('pm')).toMatch(/\/workspace-pm$/);
  });

  it('creates coordinator project dir under office project root', async () => {
    const { roleWorkspaceDirName } = await import('../../src/lib/office-agent-workspace');
    const {
      buildCoordinatorPathContext,
      coordinatorProjectRoot,
      ensureOfficeProjectDirectory,
    } = await import('../../electron/services/office/project-context-paths');

    const teamRoles = [{ agentId: 'shang-di', displayName: '上帝' }];
    const ctx = buildCoordinatorPathContext({ coordinatorAgentId: 'shang-di' }, teamRoles);
    const taskTitle = '股市分析与预测';
    const taskId = 'task-1780459688436-2bhasd';

    const root = await ensureOfficeProjectDirectory(ctx, taskTitle, taskId);
    expect(root).toBe(coordinatorProjectRoot(ctx, taskTitle, taskId));
    expect(
      roleWorkspaceDirName(
        teamRoles.map((r) => ({ agentId: r.agentId, name: r.displayName })),
        { agentId: 'shang-di', name: '上帝' },
      ),
    ).toBe('workspace-shang-di');

    await access(join(testRoot, 'office', 'project'), constants.F_OK);
    await access(root, constants.F_OK);
  });

  it('prompt project path and disk root agree for coordinator', async () => {
    const { buildCoordinatorPathContext, coordinatorProjectRoot } = await import(
      '../../electron/services/office/project-context-paths'
    );
    const { officeProjectRootRelative } = await import('../../src/lib/office-project-paths');

    const teamRoles = [{ agentId: 'shang-di', displayName: '上帝' }];
    const ctx = buildCoordinatorPathContext({ coordinatorAgentId: 'shang-di' }, teamRoles);
    const diskRoot = coordinatorProjectRoot(ctx, '股市', 'task-1');
    const promptRoot = officeProjectRootRelative(
      { agentId: 'shang-di', name: '上帝' },
      teamRoles.map((r) => ({ agentId: r.agentId, name: r.displayName })),
      '股市',
      'task-1',
      testRoot,
    );
    expect(diskRoot).toContain('office/project/task-1');
    expect(promptRoot).toBe(diskRoot);
  });

  it('throws when office project parent path exists as a file', async () => {
    const { ensureOfficeProjectDirectory, buildCoordinatorPathContext } = await import(
      '../../electron/services/office/project-context-paths'
    );
    const teamRoles = [{ agentId: 'shang-di', displayName: '上帝' }];
    const projectParent = join(testRoot, 'office', 'project');
    await mkdir(join(testRoot, 'office'), { recursive: true });
    await writeFile(projectParent, 'not-a-directory', 'utf8');
    const ctx = buildCoordinatorPathContext({ coordinatorAgentId: 'shang-di' }, teamRoles);

    await expect(ensureOfficeProjectDirectory(ctx, 'demo', 'task-1')).rejects.toThrow();
  });

  it('memberProjectRoot resolves legacy member workspace project path', async () => {
    const { memberProjectRoot, projectDirSegment } = await import(
      '../../electron/services/office/project-context-paths'
    );
    const refs = [{ agentId: 'pm', displayName: '产品' }];
    const root = memberProjectRoot({ agentId: 'pm', name: '产品' }, refs, '五子棋', 'task-1');
    expect(root).toContain(join('workspace-pm', 'office', 'projects', projectDirSegment('五子棋', 'task-1')));
  });
});
