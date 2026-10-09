import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { runStep } from '../../harness/src/runner.mjs';
import { ROOT } from '../../harness/src/specs.mjs';
import { getChangedFiles } from '../../harness/src/git.mjs';

const execFileAsync = promisify(execFile);

async function runGit(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd });
}

describe('harness runner', () => {
  it('runs profile commands from the repository root', async () => {
    const originalCwd = process.cwd();

    try {
      process.chdir(path.join(ROOT, 'harness'));

      const result = await runStep({
        name: 'Check child cwd',
        command: process.execPath,
        args: ['-e', `process.exit(process.cwd() === ${JSON.stringify(ROOT)} ? 0 : 1)`],
      });

      expect(result.status).toBe('pass');
      expect(result.exitCode).toBe(0);
    } finally {
      process.chdir(originalCwd);
    }
  });
});

describe('harness git changed files', () => {
  it('includes staged tracked files when collecting changed paths', async () => {
    const repo = await mkdtemp(path.join(tmpdir(), 'clawx-harness-git-'));
    const harnessDir = path.join(repo, 'harness', 'src');

    try {
      await mkdir(harnessDir, { recursive: true });
      await writeFile(path.join(repo, 'tracked.txt'), 'before\n');
      await runGit(repo, ['init']);
      await runGit(repo, ['config', 'user.email', 'test@example.com']);
      await runGit(repo, ['config', 'user.name', 'Test']);
      await runGit(repo, ['add', 'tracked.txt']);
      await runGit(repo, ['commit', '-m', 'init']);

      await writeFile(path.join(repo, 'tracked.txt'), 'after\n');
      await runGit(repo, ['add', 'tracked.txt']);

      const changed = await getChangedFiles('HEAD', repo);

      expect(changed).toContain('tracked.txt');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('does not treat untracked implementation plans as task changes', async () => {
    const repo = await mkdtemp(path.join(tmpdir(), 'clawx-harness-git-'));

    try {
      await mkdir(path.join(repo, 'docs', 'plans'), { recursive: true });
      await writeFile(path.join(repo, 'tracked.txt'), 'tracked\n');
      await writeFile(path.join(repo, 'docs', 'plans', 'user-plan.md'), '# User plan\n');
      await runGit(repo, ['init']);
      await runGit(repo, ['config', 'user.email', 'test@example.com']);
      await runGit(repo, ['config', 'user.name', 'Test']);
      await runGit(repo, ['add', 'tracked.txt']);
      await runGit(repo, ['commit', '-m', 'init']);

      expect(await getChangedFiles('HEAD', repo)).not.toContain('docs/plans/user-plan.md');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
