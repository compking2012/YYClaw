import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agent } from '../helpers/office-agents';

describe('office project coordinator change workspace', () => {
  let testRoot = '';
  let previousOpenClawHome = '';

  beforeEach(async () => {
    vi.resetModules();
    previousOpenClawHome = process.env.OPENCLAW_HOME ?? '';
    testRoot = await mkdtemp(join(tmpdir(), 'office-coord-migrate-'));
    process.env.OPENCLAW_HOME = testRoot;
  });

  afterEach(async () => {
    process.env.OPENCLAW_HOME = previousOpenClawHome;
    await rm(testRoot, { recursive: true, force: true });
  });

  it('keeps project dir when task coordinatorAgentId changes (v2 path is title+id only)', async () => {
    const { migrateProjectWorkspaceOnTaskPathChange } = await import(
      '../../electron/services/office/project-workspace-migrate'
    );
    const { coordinatorProjectRoot } = await import(
      '../../electron/services/office/project-context-paths'
    );

    const taskId = 'task-coord';
    const task = {
      id: taskId,
      title: '共享标题',
      scenarioId: 'sc1',
      coordinatorAgentId: 'a-coord',
    };
    const nextTask = { ...task, coordinatorAgentId: 'a-dev' };

    const projectRoot = coordinatorProjectRoot(task.title, taskId);
    await mkdir(projectRoot, { recursive: true });
    await writeFile(join(projectRoot, 'data.txt'), 'coord-move', 'utf8');

    await migrateProjectWorkspaceOnTaskPathChange({
      previousTask: task,
      nextTask,
    });

    await access(projectRoot, constants.F_OK);
    expect(await readFile(join(projectRoot, 'data.txt'), 'utf8')).toBe('coord-move');
  });

  it('does not move project when scenario default coordinator changes', async () => {
    const { migrateScenarioTasksOnCoordinatorChange } = await import(
      '../../electron/services/office/project-workspace-migrate'
    );
    const { coordinatorProjectRoot } = await import(
      '../../electron/services/office/project-context-paths'
    );

    const previousScenario = {
      id: 'sc1',
      coordinatorAgentId: 'a-coord',
      agentIds: ['a-coord', 'a-dev'],
    };
    const nextScenario = { ...previousScenario, coordinatorAgentId: 'a-dev' };
    const task = {
      id: 'task-sc',
      title: '场景协调者',
      scenarioId: 'sc1',
    };

    const projectRoot = coordinatorProjectRoot(task.title, task.id);
    await mkdir(projectRoot, { recursive: true });
    await writeFile(join(projectRoot, 'x.txt'), '1', 'utf8');

    await migrateScenarioTasksOnCoordinatorChange({
      previousScenario,
      nextScenario,
      roles: [agent('a-coord', '协调者A'), agent('a-dev', '协调者B')],
      tasks: [task],
    });

    await access(projectRoot, constants.F_OK);
    expect(await readFile(join(projectRoot, 'x.txt'), 'utf8')).toBe('1');
  });
});
