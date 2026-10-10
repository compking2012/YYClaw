import { readFile, writeFile, mkdir, cp, access } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runStep } from '../runner.mjs';
import { git } from './workspaces.mjs';

const execute = promisify(execFile);

export function isolatedEnvironment(home, extra = {}) {
  const allowed = ['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'LANG', 'LC_ALL', 'DISPLAY', 'WAYLAND_DISPLAY'];
  const env = Object.fromEntries(allowed.filter((name) => process.env[name]).map((name) => [name, process.env[name]]));
  return { ...env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, '.config'), APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'), TMPDIR: path.join(home, 'tmp'), TEMP: path.join(home, 'tmp'), TMP: path.join(home, 'tmp'), GIT_CONFIG_GLOBAL: path.join(home, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', CI: '1', ...extra };
}

export class CodexAdapter {
  constructor(options = {}) {
    this.executable = options.executable ?? 'codex';
    this.model = options.model;
    this.authHome = options.authHome ?? process.env.CODEX_HOME ?? path.join(homedir(), '.codex');
  }

  async preflight() {
    const help = await execute(this.executable, ['exec', '--help'], { timeout: 15000 });
    for (const flag of ['--json', '--output-schema', '--sandbox', '--ignore-user-config', '--ignore-rules']) if (!help.stdout.includes(flag)) throw new Error(`Codex version lacks required capability ${flag}`);
    await access(path.join(this.authHome, 'auth.json'));
  }

  async execute({ prompt, schema, workspace, artifactDir, readOnly = false, signal, timeoutMs, onSpawn, onExit }) {
    await mkdir(artifactDir, { recursive: true });
    const codexHome = path.join(workspace.home, '.codex');
    await mkdir(codexHome, { recursive: true, mode: 0o700 });
    await mkdir(path.join(workspace.home, 'tmp'), { recursive: true });
    await cp(path.join(this.authHome, 'auth.json'), path.join(codexHome, 'auth.json'));
    const schemaPath = path.join(artifactDir, 'output-schema.json');
    const outputPath = path.join(artifactDir, 'output.json');
    await writeFile(schemaPath, JSON.stringify(z.toJSONSchema(schema)));
    const args = ['exec', '--ignore-user-config', '--ignore-rules', '--sandbox', readOnly ? 'read-only' : 'workspace-write', '--json', '--output-schema', schemaPath, '--output-last-message', outputPath, '-C', workspace.path];
    if (this.model) args.push('--model', this.model);
    args.push('-');
    const result = await runStep({ name: readOnly ? 'Independent Codex review' : 'Codex implementation', command: this.executable, args }, {
      cwd: workspace.path, env: isolatedEnvironment(workspace.home, { CODEX_HOME: codexHome }), signal, timeoutMs,
      logPath: path.join(artifactDir, 'events.jsonl'),
      input: prompt, onSpawn, onExit,
    });
    if (result.status !== 'pass') throw new Error(result.error ?? `Codex exited ${result.exitCode}`);
    const output = schema.parse(JSON.parse(await readFile(outputPath, 'utf8')));
    const events = (await readFile(path.join(artifactDir, 'events.jsonl'), 'utf8')).split('\n').flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
    return { output, sessionId: events.find((event) => event.type === 'thread.started')?.thread_id ?? null };
  }
}

export class ClaudeAdapter {
  async preflight() {
    throw new Error('Claude Code adapter is reserved; configure Codex for this release');
  }
}

export class GitHubPublisher {
  constructor(repo, options = {}) {
    this.repo = repo;
    this.executable = options.executable ?? 'gh';
  }

  async gh(args) {
    const result = await execute(this.executable, args, { cwd: this.repo, timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
    return result.stdout.trim();
  }

  async preflight() {
    await this.gh(['auth', 'status']);
    await git(this.repo, ['remote', 'get-url', 'origin']);
  }

  async lookup({ branch, base, sha }) {
    const matches = JSON.parse(await this.gh(['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number,url,headRefOid,baseRefName,isDraft']));
    const publication = matches.find((entry) => entry.headRefOid === sha && entry.baseRefName === base);
    return publication ? { ...publication, branch, base, sha } : null;
  }

  async publish({ branch, base, sha, title, body, artifactDir }) {
    const before = await git(this.repo, ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`]);
    const remoteSha = before.split(/\s+/)[0];
    await git(this.repo, ['push', `--force-with-lease=refs/heads/${branch}:${remoteSha || ''}`, 'origin', `${sha}:refs/heads/${branch}`]);
    const existing = JSON.parse(await this.gh(['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number,url,headRefOid,baseRefName,isDraft']));
    const bodyPath = path.join(artifactDir, 'pr-body.md');
    await writeFile(bodyPath, body);
    if (existing.length) {
      await this.gh(['pr', 'edit', String(existing[0].number), '--base', base, '--title', title, '--body-file', bodyPath]);
      if (!existing[0].isDraft) await this.gh(['pr', 'ready', String(existing[0].number), '--undo']);
    } else {
      await this.gh(['pr', 'create', '--draft', '--head', branch, '--base', base, '--title', title, '--body-file', bodyPath]);
    }
    const matches = JSON.parse(await this.gh(['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number,url,headRefOid,baseRefName,isDraft']));
    const publication = matches.find((entry) => entry.headRefOid === sha && entry.baseRefName === base);
    if (!publication) throw new Error('PR is not queryable at the pushed SHA');
    return { ...publication, branch, base, sha };
  }

  async checks(publication, requiredNames) {
    const current = JSON.parse(await this.gh(['pr', 'view', String(publication.number), '--json', 'headRefOid,statusCheckRollup']));
    if (current.headRefOid !== publication.sha) return { status: 'blocked', reason: 'PR changed outside this run' };
    const rollup = current.statusCheckRollup ?? [];
    const checks = requiredNames.map((name) => rollup.find((check) => (check.name ?? check.context) === name));
    if (checks.some((check) => !check)) return { status: 'pending', reason: 'Required CI checks have not appeared' };
    const failed = checks.some((check) => ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE'].includes(check.conclusion ?? check.state));
    if (failed) {
      const logs = [];
      for (const check of checks.filter((entry) => ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT'].includes(entry.conclusion ?? entry.state))) {
        const runId = (check.detailsUrl ?? check.targetUrl ?? '').match(/\/actions\/runs\/(\d+)/)?.[1];
        if (runId) logs.push(await this.gh(['run', 'view', runId, '--log-failed']).catch((error) => `CI logs unavailable: ${error.message}`));
      }
      return { status: 'fail', checks, logs: logs.map((log) => log.slice(-80000)) };
    }
    if (checks.every((check) => ['SUCCESS', 'success'].includes(check.conclusion ?? check.state))) return { status: 'pass', checks };
    return { status: 'pending', checks };
  }

  async ready(publication) {
    const current = JSON.parse(await this.gh(['pr', 'view', String(publication.number), '--json', 'isDraft,headRefOid']));
    if (current.headRefOid !== publication.sha) throw new Error('Cannot mark a stale PR ready');
    if (!current.isDraft) return;
    await this.gh(['pr', 'ready', String(publication.number)]);
  }
}
