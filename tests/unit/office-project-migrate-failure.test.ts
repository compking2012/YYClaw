import { access, mkdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROJECT_MANIFEST_FILE } from '../../src/lib/office-project-context';

vi.mock('../../electron/services/office/project-deliverables-bundle', () => ({
  removeProjectDeliverablesBundle: vi.fn(async () => {
    throw new Error('EACCES mock');
  }),
}));

describe('office project migrate failure', () => {
  let testRoot = '';
  let previousOpenClawHome = '';

  beforeEach(async () => {
    vi.resetModules();
    previousOpenClawHome = process.env.OPENCLAW_HOME ?? '';
    testRoot = await mkdtemp(join(tmpdir(), 'office-migrate-fail-'));
    process.env.OPENCLAW_HOME = testRoot;
  });

  afterEach(async () => {
    process.env.OPENCLAW_HOME = previousOpenClawHome;
    await rm(testRoot, { recursive: true, force: true });
  });

  it('throws OfficeProjectWorkspaceMigrateError when deliverable bundle cleanup fails', async () => {
    const {
      OfficeProjectWorkspaceMigrateError,
      migrateProjectWorkspaceOnTaskPathChange,
    } = await import('../../electron/services/office/project-workspace-migrate');
    const { coordinatorProjectRoot } = await import(
      '../../electron/services/office/project-context-paths'
    );

    const previous = {
      id: 't1',
      title: '旧名',
      scenarioId: 'sc1',
      coordinatorAgentId: 'a-coord',
    };
    const next = { ...previous, title: '新名' };

    const root = coordinatorProjectRoot(previous.title, previous.id);
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, PROJECT_MANIFEST_FILE),
      `${JSON.stringify({ taskId: previous.id, taskTitle: previous.title }, null, 2)}\n`,
      'utf8',
    );
    await writeFile(join(root, 'keep.txt'), 'x', 'utf8');

    await expect(
      migrateProjectWorkspaceOnTaskPathChange({
        previousTask: previous,
        nextTask: next,
      }),
    ).rejects.toBeInstanceOf(OfficeProjectWorkspaceMigrateError);

    await access(root, constants.F_OK);
    await access(join(root, 'keep.txt'), constants.F_OK);
  });
});
