import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, cp, lstat, mkdir, readFile, realpath, rm, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicJson, safeChild } from './store.mjs';
import { digest } from './contracts.mjs';

const execute = promisify(execFile);
export async function git(root, args) {
  const result = await execute('git', ['-c', 'core.hooksPath=', ...args], { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
  return args.includes('diff') ? result.stdout : result.stdout.trimEnd();
}

export async function dirtyFiles(root) {
  const tracked = await git(root, ['diff', '--name-only', '-z', 'HEAD']);
  const untracked = await git(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  return [...new Set([...tracked.split('\0'), ...untracked.split('\0')].filter(Boolean))];
}

export async function assertClean(root) {
  if ((await git(root, ['status', '--porcelain', '--untracked-files=all'])).trim()) throw new Error('Autopilot requires committed, clean inputs; user changes are never stashed or committed');
}

async function present(file) {
  return await access(file).then(() => true, (error) => {
    if (error.code !== 'ENOENT') throw error;
    return false;
  });
}

export class WorkspaceManager {
  constructor(repo, store) {
    this.repo = path.resolve(repo);
    this.store = store;
    this.root = path.join(store.dir, 'workspaces');
  }

  async create(taskId, baseSha) {
    const resourceId = `${taskId}-${randomUUID()}`;
    const container = safeChild(this.root, resourceId);
    const workspace = {
      schemaVersion: 1, runId: this.store.runId, taskId, resourceId,
      token: randomUUID(), container, path: path.join(container, 'repo'),
      home: path.join(container, 'home'), baseSha,
    };
    await mkdir(workspace.home, { recursive: true, mode: 0o700 });
    await atomicJson(path.join(container, 'owner.json'), workspace);
    try { await git(this.repo, ['worktree', 'add', '--detach', workspace.path, baseSha]); }
    catch (error) {
      if (!await present(workspace.path)) await rm(container, { recursive: true, force: false });
      throw error;
    }
    await this.store.event('workspace-created', { taskId, resourceId });
    return workspace;
  }

  async verify(workspace) {
    if (workspace.runId !== this.store.runId || workspace.container !== safeChild(this.root, workspace.resourceId) || workspace.path !== path.join(workspace.container, 'repo') || workspace.home !== path.join(workspace.container, 'home')) throw new Error('Workspace ownership/path mismatch');
    if (!(await present(workspace.container))) return false;
    if ((await lstat(workspace.container)).isSymbolicLink() || (await realpath(workspace.container)) !== path.join(await realpath(this.root), workspace.resourceId)) throw new Error('Symlinked workspace container is forbidden');
    const owner = JSON.parse(await readFile(path.join(workspace.container, 'owner.json'), 'utf8'));
    if (JSON.stringify(owner) !== JSON.stringify(workspace)) throw new Error('Workspace ownership token mismatch');
    if (await present(workspace.path)) {
      if ((await lstat(workspace.path)).isSymbolicLink()) throw new Error('Symlinked worktree is forbidden');
      const primaryCommon = await git(this.repo, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
      const workspaceCommon = await git(workspace.path, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
      if (primaryCommon !== workspaceCommon || await realpath(workspace.path) === await realpath(this.repo)) throw new Error('Foreign or primary worktree cannot be removed');
    }
    return true;
  }

  async discover() {
    if (!await present(this.root)) return [];
    const owned = [];
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('Unknown resource in owned workspace root');
      const workspace = JSON.parse(await readFile(path.join(this.root, entry.name, 'owner.json'), 'utf8'));
      await this.verify(workspace);
      owned.push(workspace);
    }
    return owned;
  }

  async archive(workspace, artifactDir) {
    await this.verify(workspace);
    await mkdir(artifactDir, { recursive: true });
    if (!(await present(workspace.path))) throw new Error('Cannot archive missing worktree');
    const patch = await git(workspace.path, ['diff', '--binary', 'HEAD']);
    const basePatch = await git(workspace.path, ['diff', '--binary', workspace.baseSha]);
    const files = await git(workspace.path, ['ls-files', '--others', '--exclude-standard', '-z']);
    await writeFile(path.join(artifactDir, 'recovery.patch'), patch);
    await writeFile(path.join(artifactDir, 'recovery-from-base.patch'), basePatch);
    const inventory = [];
    for (const file of files.split('\0').filter(Boolean)) {
      if (path.isAbsolute(file) || file.split('/').includes('..')) throw new Error('Unsafe untracked recovery path');
      const source = path.join(workspace.path, file);
      const target = path.join(artifactDir, 'untracked', file);
      if ((await lstat(source)).isSymbolicLink()) throw new Error('Untracked symlink needs manual recovery');
      if (!path.relative(await realpath(workspace.path), await realpath(source)).split(path.sep).every((segment) => segment !== '..')) throw new Error('Recovery file escapes owned workspace');
      await mkdir(path.dirname(target), { recursive: true });
      await cp(source, target, { recursive: false, dereference: false, errorOnExist: false });
      inventory.push({ file, hash: digest(await readFile(target)) });
    }
    for (const directory of ['playwright-report', 'test-results', 'artifacts/comms', 'artifacts/harness']) {
      const source = path.join(workspace.path, directory);
      if (await present(source)) {
        if ((await lstat(source)).isSymbolicLink()) throw new Error('Symlinked evidence directory is forbidden');
        await cp(source, path.join(artifactDir, 'reports', directory), { recursive: true, dereference: false });
      }
    }
    const receipt = { schemaVersion: 1, resourceId: workspace.resourceId, token: workspace.token, head: await git(workspace.path, ['rev-parse', 'HEAD']), baseSha: workspace.baseSha, patchHash: digest(patch), basePatchHash: digest(basePatch), inventory, archivedAt: new Date().toISOString() };
    await atomicJson(path.join(artifactDir, 'archive.json'), receipt);
    return { artifactDir, receiptHash: digest(receipt) };
  }

  async registerProcess(workspace, child) {
    if (!child.pid) return;
    await this.verify(workspace);
    const identity = await processIdentity(child.pid);
    if (!identity) return;
    const directory = path.join(workspace.container, 'processes');
    await mkdir(directory, { recursive: true });
    await atomicJson(path.join(directory, `${child.pid}.json`), { runId: workspace.runId, resourceId: workspace.resourceId, token: workspace.token, pid: child.pid, identity });
  }

  async unregisterProcess(workspace, child) {
    if (!child.pid) return;
    const file = path.join(workspace.container, 'processes', `${child.pid}.json`);
    if (await processIdentity(child.pid)) return;
    if (process.platform !== 'win32') {
      try { process.kill(-child.pid, 0); return; } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    await rm(file, { force: true });
  }

  async stopProcesses(workspace) {
    if (!await this.verify(workspace)) return;
    const directory = path.join(workspace.container, 'processes');
    if (!await present(directory)) return;
    for (const file of await readdir(directory)) {
      const owned = JSON.parse(await readFile(path.join(directory, file), 'utf8'));
      if (owned.resourceId !== workspace.resourceId || owned.token !== workspace.token || owned.runId !== workspace.runId) throw new Error('Process ownership mismatch');
      const current = await processIdentity(owned.pid);
      if (current && current !== owned.identity) throw new Error('Process PID was reused; refusing to kill foreign process');
      if (!current && process.platform !== 'win32') {
        try { process.kill(-owned.pid, 0); throw new Error('Orphan process group identity cannot be verified'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
      if (current) {
        if (process.platform === 'win32') await execute('taskkill', ['/PID', String(owned.pid), '/T', '/F']);
        else process.kill(-owned.pid, 'SIGKILL');
        for (let attempt = 0; attempt < 40 && await processIdentity(owned.pid); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
        if (await processIdentity(owned.pid)) throw new Error('Owned process failed to exit');
      }
      await rm(path.join(directory, file));
    }
  }

  async cleanup(workspace, archive, publication) {
    const exists = await this.verify(workspace);
    const receipt = JSON.parse(await readFile(path.join(archive.artifactDir, 'archive.json'), 'utf8'));
    if (digest(receipt) !== archive.receiptHash || receipt.resourceId !== workspace.resourceId || receipt.token !== workspace.token) throw new Error('Missing or mismatched durable archive');
    if (exists) await this.stopProcesses(workspace);
    if (exists && await present(workspace.path)) {
      const currentPatch = await git(workspace.path, ['diff', '--binary', 'HEAD']);
      if (digest(currentPatch) !== receipt.patchHash || await git(workspace.path, ['rev-parse', 'HEAD']) !== receipt.head) throw new Error('Workspace changed after evidence archival');
      const files = (await git(workspace.path, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean);
      if (files.length !== receipt.inventory.length) throw new Error('Unbacked untracked work prevents cleanup');
      for (const entry of receipt.inventory) if (!files.includes(entry.file) || digest(await readFile(path.join(workspace.path, entry.file))) !== entry.hash) throw new Error('Untracked recovery archive is stale');
      if (publication) {
        if (receipt.head !== publication.sha || (await dirtyFiles(workspace.path)).length) throw new Error('Published workspace is not clean at the confirmed SHA');
        const remote = await git(this.repo, ['ls-remote', '--heads', 'origin', `refs/heads/${publication.branch}`]);
        if (remote.split(/\s+/)[0] !== publication.sha || !publication.number) throw new Error('Remote publication is not durable');
      }
      await git(this.repo, ['worktree', 'remove', '--force', workspace.path]);
    }
    if (exists) await rm(workspace.container, { recursive: true, force: false });
    const listing = await git(this.repo, ['worktree', 'list', '--porcelain']);
    if (await present(workspace.container) || listing.split('\n').includes(`worktree ${workspace.path}`)) throw new Error('Workspace cleanup is incomplete');
    await this.store.event('workspace-cleaned', { taskId: workspace.taskId, resourceId: workspace.resourceId });
    return { status: 'pass', resourceId: workspace.resourceId, at: new Date().toISOString() };
  }
}

async function processIdentity(pid) {
  try {
    if (process.platform === 'win32') {
      const result = await execute('powershell', ['-NoProfile', '-Command', `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${Number(pid)}'; if ($p) { "$($p.CreationDate.Ticks)|$($p.CommandLine)" }`], { timeout: 10000 });
      return result.stdout.trim() || null;
    }
    const result = await execute('ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'args='], { timeout: 10000 });
    return result.stdout.trim() || null;
  } catch (error) {
    if (error.code === 1) return null;
    throw error;
  }
}
