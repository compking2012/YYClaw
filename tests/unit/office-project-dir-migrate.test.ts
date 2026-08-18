import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  legacyProjectDirSegment,
  PROJECT_MANIFEST_FILE,
  projectDirSegment,
} from '../../src/lib/office-project-context';

describe('office project dir id-only + legacy migrate', () => {
  let testRoot = '';
  let previousOpenClawHome = '';

  beforeEach(async () => {
    vi.resetModules();
    previousOpenClawHome = process.env.OPENCLAW_HOME ?? '';
    testRoot = await mkdtemp(join(tmpdir(), 'office-project-dir-migrate-'));
    process.env.OPENCLAW_HOME = testRoot;
  });

  afterEach(async () => {
    process.env.OPENCLAW_HOME = previousOpenClawHome;
    await rm(testRoot, { recursive: true, force: true });
  });

  it('projectDirSegment uses projectId only', async () => {
    expect(projectDirSegment('漫画PPT', 'project-1783043764903-jpjgz3')).toBe(
      'project-1783043764903-jpjgz3',
    );
    expect(legacyProjectDirSegment('漫画PPT', 'project-1783043764903-jpjgz3')).toBe(
      '漫画PPT-project-1783043764903-jpjgz3',
    );
  });

  it('migrates legacy title-id directory to id-only and updates manifest path', async () => {
    const taskId = 'project-1783043764903-jpjgz3';
    const title = '漫画PPT';
    const parent = join(testRoot, 'office', 'project');
    const legacyRoot = join(parent, legacyProjectDirSegment(title, taskId));
    const canonicalRoot = join(parent, projectDirSegment(title, taskId));

    await mkdir(legacyRoot, { recursive: true });
    await writeFile(join(legacyRoot, 'deliverable.md'), 'x'.repeat(32), 'utf8');
    await writeFile(
      join(legacyRoot, PROJECT_MANIFEST_FILE),
      `${JSON.stringify(
        {
          taskId,
          taskTitle: title,
          projectRootPath: legacyRoot,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const { migrateLegacyProjectDirToIdOnly } = await import(
      '../../electron/services/office/project-dir-migrate'
    );
    const root = await migrateLegacyProjectDirToIdOnly(title, taskId);
    expect(root).toBe(canonicalRoot);
    expect(await readFile(join(canonicalRoot, 'deliverable.md'), 'utf8')).toHaveLength(32);

    const manifest = JSON.parse(
      await readFile(join(canonicalRoot, PROJECT_MANIFEST_FILE), 'utf8'),
    ) as { projectRootPath: string };
    expect(manifest.projectRootPath).toBe(canonicalRoot);
  });

  it('does not migrate another project legacy dir when ids share a suffix', async () => {
    const victimId = 'long-task-1';
    const victimTitle = '受害者项目';
    const aggressorId = 'task-1';
    const aggressorTitle = '五子棋';
    const parent = join(testRoot, 'office', 'project');
    const victimLegacy = join(parent, legacyProjectDirSegment(victimTitle, victimId));
    const victimMarker = join(victimLegacy, 'victim-only.txt');

    await mkdir(victimLegacy, { recursive: true });
    await writeFile(victimMarker, 'keep-me', 'utf8');
    await writeFile(
      join(victimLegacy, PROJECT_MANIFEST_FILE),
      `${JSON.stringify({ taskId: victimId, taskTitle: victimTitle }, null, 2)}\n`,
      'utf8',
    );

    const { migrateLegacyProjectDirToIdOnly } = await import(
      '../../electron/services/office/project-dir-migrate'
    );
    await migrateLegacyProjectDirToIdOnly(aggressorTitle, aggressorId);

    await expect(readFile(victimMarker, 'utf8')).resolves.toBe('keep-me');
  });

  it('migrates renamed-title legacy dir when manifest taskId matches', async () => {
    const taskId = 'task-1';
    const oldTitle = '旧项目名';
    const newTitle = '新项目名';
    const parent = join(testRoot, 'office', 'project');
    const legacyRoot = join(parent, legacyProjectDirSegment(oldTitle, taskId));
    const canonicalRoot = join(parent, taskId);

    await mkdir(legacyRoot, { recursive: true });
    await writeFile(join(legacyRoot, 'artifact.txt'), 'data', 'utf8');
    await writeFile(
      join(legacyRoot, PROJECT_MANIFEST_FILE),
      `${JSON.stringify({ taskId, taskTitle: oldTitle }, null, 2)}\n`,
      'utf8',
    );

    const { migrateLegacyProjectDirToIdOnly } = await import(
      '../../electron/services/office/project-dir-migrate'
    );
    const root = await migrateLegacyProjectDirToIdOnly(newTitle, taskId);
    expect(root).toBe(canonicalRoot);
    await expect(readFile(join(canonicalRoot, 'artifact.txt'), 'utf8')).resolves.toBe('data');
  });

  it('does not rewrite manifest when projectRootPath already id-only', async () => {
    const taskId = 'task-1';
    const title = '五子棋';
    const parent = join(testRoot, 'office', 'project');
    const canonicalRoot = join(parent, taskId);
    const manifestPath = join(canonicalRoot, PROJECT_MANIFEST_FILE);

    await mkdir(canonicalRoot, { recursive: true });
    const originalManifest = {
      taskId,
      taskTitle: title,
      projectRootPath: canonicalRoot,
    };
    await writeFile(manifestPath, `${JSON.stringify(originalManifest, null, 2)}\n`, 'utf8');

    const { migrateLegacyProjectDirToIdOnly } = await import(
      '../../electron/services/office/project-dir-migrate'
    );
    await migrateLegacyProjectDirToIdOnly(title, taskId);

    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as typeof originalManifest;
    expect(manifest.projectRootPath).toBe(canonicalRoot);
  });
});

describe('resolveOfficeProjectRootForSessionMd legacy path', () => {
  let testRoot = '';
  let previousOpenClawHome = '';

  beforeEach(async () => {
    vi.resetModules();
    previousOpenClawHome = process.env.OPENCLAW_HOME ?? '';
    testRoot = await mkdtemp(join(tmpdir(), 'office-project-dir-migrate-'));
    process.env.OPENCLAW_HOME = testRoot;
  });

  afterEach(async () => {
    process.env.OPENCLAW_HOME = previousOpenClawHome;
    await rm(testRoot, { recursive: true, force: true });
  });

  it('migrates legacy projectRootPath from store instead of returning stale path', async () => {
    const taskId = 'project-abc';
    const title = '漫画PPT';
    const parent = join(testRoot, 'office', 'project');
    const legacyRoot = join(parent, legacyProjectDirSegment(title, taskId));
    const canonicalRoot = join(parent, taskId);

    await mkdir(legacyRoot, { recursive: true });
    await writeFile(join(legacyRoot, 'data.txt'), 'ok', 'utf8');

    const { resolveOfficeProjectRootForSessionMd } = await import(
      '../../electron/services/office/project-context-paths'
    );
    const resolved = await resolveOfficeProjectRootForSessionMd({
      id: taskId,
      title,
      projectRootPath: legacyRoot,
    } as never);
    expect(resolved).toBe(canonicalRoot);
    await expect(readFile(join(canonicalRoot, 'data.txt'), 'utf8')).resolves.toBe('ok');
  });
});
