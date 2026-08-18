import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agent } from '../helpers/office-agents';
import { projectDirSegment } from '../../src/lib/office-project-context';
import { PROJECT_MANIFEST_FILE } from '../../src/lib/office-project-context';

describe('office project title rename workspace', () => {
  let testRoot = '';
  let previousOpenClawHome = '';

  beforeEach(async () => {
    vi.resetModules();
    previousOpenClawHome = process.env.OPENCLAW_HOME ?? '';
    testRoot = await mkdtemp(join(tmpdir(), 'office-project-rename-'));
    process.env.OPENCLAW_HOME = testRoot;
  });

  afterEach(async () => {
    process.env.OPENCLAW_HOME = previousOpenClawHome;
    await rm(testRoot, { recursive: true, force: true });
  });

  it('keeps id-only project dir and updates manifest taskTitle on title rename', async () => {
    const { renameProjectWorkspaceOnTitleChange } = await import(
      '../../electron/services/office/project-workspace-rename'
    );
    const { coordinatorProjectRoot } = await import(
      '../../electron/services/office/project-context-paths'
    );

    const members = [agent('a-coord', '协调者')];
    const scenarios = [
      { id: 'sc1', coordinatorAgentId: 'a-coord', agentIds: ['a-coord'] },
    ];
    const taskId = 'task-1';
    const previous = {
      id: taskId,
      title: '旧项目名',
      scenarioId: 'sc1',
      coordinatorAgentId: 'a-coord',
    };
    const next = { ...previous, title: '新项目名' };

    const root = coordinatorProjectRoot(previous.title, taskId);
    expect(root).toBe(coordinatorProjectRoot(next.title, taskId));
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'artifact.txt'), 'data', 'utf8');
    await writeFile(
      join(root, PROJECT_MANIFEST_FILE),
      `${JSON.stringify({ taskId, taskTitle: previous.title }, null, 2)}\n`,
      'utf8',
    );

    await renameProjectWorkspaceOnTitleChange({
      previous,
      next,
      roles: members.map((m) => ({ id: m.agentId, agentId: m.agentId, name: m.displayName })),
      scenarios,
    });

    await access(root, constants.F_OK);
    expect(await readFile(join(root, 'artifact.txt'), 'utf8')).toBe('data');
    const manifest = JSON.parse(
      await readFile(join(root, PROJECT_MANIFEST_FILE), 'utf8'),
    ) as { taskTitle: string };
    expect(manifest.taskTitle).toBe('新项目名');
    expect(root).toContain(projectDirSegment('新项目名', taskId));
  });

  it('does not rename project dir when only description changes', async () => {
    const { renameProjectWorkspaceOnTitleChange } = await import(
      '../../electron/services/office/project-workspace-rename'
    );
    const { coordinatorProjectRoot } = await import(
      '../../electron/services/office/project-context-paths'
    );

    const members = [agent('a-coord', '协调者')];
    const scenarios = [
      { id: 'sc1', coordinatorAgentId: 'a-coord', agentIds: ['a-coord'] },
    ];
    const taskId = 'task-2';
    const title = '固定标题';
    const previous = {
      id: taskId,
      title,
      scenarioId: 'sc1',
      coordinatorAgentId: 'a-coord',
    };
    const next = { ...previous, description: '新描述' };

    const root = coordinatorProjectRoot(title, taskId);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'artifact.txt'), 'data', 'utf8');

    await renameProjectWorkspaceOnTitleChange({
      previous,
      next,
      roles: members.map((m) => ({ id: m.agentId, agentId: m.agentId, name: m.displayName })),
      scenarios,
    });

    await access(root, constants.F_OK);
    expect(await readFile(join(root, 'artifact.txt'), 'utf8')).toBe('data');
  });
});
