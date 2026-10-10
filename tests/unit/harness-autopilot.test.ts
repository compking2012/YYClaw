import { mkdtemp, mkdir, writeFile, readFile, rm, access, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validatePlan, digest, scopesConflict, topologicalTasks } from '../../harness/src/autopilot/contracts.mjs';
import { RunStore } from '../../harness/src/autopilot/store.mjs';
import { git, WorkspaceManager } from '../../harness/src/autopilot/workspaces.mjs';
import { AutopilotEngine } from '../../harness/src/autopilot/engine.mjs';
import { auditChanges, runAcceptance } from '../../harness/src/autopilot/acceptance.mjs';
import { CodexAdapter, isolatedEnvironment, GitHubPublisher } from '../../harness/src/autopilot/adapters.mjs';
import { loadCodexConnection, prepareCodexConnection } from '../../harness/src/autopilot/codex-config.mjs';
import { requiredTestStep, validationSteps } from '../../harness/src/validation.mjs';
import { runStep } from '../../harness/src/runner.mjs';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function codexConfiguration(config: string, auth?: string) {
  const root = await mkdtemp(path.join(tmpdir(), 'yyclaw-codex-config-'));
  roots.push(root);
  const authHome = path.join(root, 'source');
  await mkdir(authHome);
  await writeFile(path.join(authHome, 'config.toml'), config);
  if (auth !== undefined) await writeFile(path.join(authHome, 'auth.json'), auth);
  return { root, authHome };
}

describe('local Codex connection parity', () => {
  it('preserves the selected provider, model and authentication but excludes user tools and unsafe policies', async () => {
    const source = `
model_provider = "custom"
model = "local-model"
model_reasoning_effort = "high"
notify = ["untrusted-hook"]
sandbox_mode = "danger-full-access"
approval_policy = "never"
[model_providers.custom]
name = "Local cc-switch"
base_url = "http://127.0.0.1:15721/v1"
wire_api = "responses"
requires_openai_auth = true
experimental_bearer_token = "test-secret"
stream_idle_timeout_ms = 45000
http_headers = { "X-Test" = "test-header-secret" }
query_params = { version = "test" }
[model_providers.unselected]
base_url = "https://unused.invalid"
[mcp_servers.private]
command = "private-tool"
[plugins.private]
enabled = true
[projects."/private"]
trust_level = "trusted"
`;
    const auth = JSON.stringify({ OPENAI_API_KEY: 'test-auth-secret' });
    const { root, authHome } = await codexConfiguration(source, auth);
    const codexHome = path.join(root, 'task/.codex');
    await prepareCodexConnection(authHome, codexHome);
    const copied = await loadCodexConnection(codexHome, {});
    expect(copied.config).toEqual({
      model_provider: 'custom', model: 'local-model', model_reasoning_effort: 'high',
      model_providers: { custom: {
        name: 'Local cc-switch', base_url: 'http://127.0.0.1:15721/v1', wire_api: 'responses',
        requires_openai_auth: true, experimental_bearer_token: 'test-secret', stream_idle_timeout_ms: 45000,
        http_headers: { 'X-Test': 'test-header-secret' }, query_params: { version: 'test' },
      } },
    });
    const serialized = await readFile(path.join(codexHome, 'config.toml'), 'utf8');
    for (const forbidden of ['notify', 'sandbox_mode', 'approval_policy', 'mcp_servers', 'plugins', 'projects', 'unselected']) expect(serialized).not.toContain(forbidden);
    expect(await readFile(path.join(codexHome, 'auth.json'), 'utf8')).toBe(auth);
    expect(await readFile(path.join(authHome, 'config.toml'), 'utf8')).toBe(source);
    if (process.platform !== 'win32') {
      expect((await stat(codexHome)).mode & 0o777).toBe(0o700);
      for (const file of ['config.toml', 'auth.json']) expect((await stat(path.join(codexHome, file))).mode & 0o777).toBe(0o600);
    }
    await rm(path.join(authHome, 'auth.json'));
    await prepareCodexConnection(authHome, codexHome);
    await expect(access(path.join(codexHome, 'auth.json'))).rejects.toThrow();
  });

  it('inherits only model and proxy/certificate variables, not publisher or execution-control credentials', async () => {
    const { authHome } = await codexConfiguration(`
model_provider = "custom"
[model_providers.custom]
env_key = "LOCAL_MODEL_KEY"
env_http_headers = { "X-Account" = "LOCAL_ACCOUNT" }
`);
    const connection = await loadCodexConnection(authHome, {
      LOCAL_MODEL_KEY: 'test-key', LOCAL_ACCOUNT: 'test-account', HTTPS_PROXY: 'http://proxy.invalid',
      no_proxy: '127.0.0.1', SSL_CERT_FILE: '/cert.pem', GITHUB_TOKEN: 'private', GH_TOKEN: 'private',
      SSH_AUTH_SOCK: '/ssh', NODE_OPTIONS: '--require private', OPENAI_API_KEY: 'unrelated',
    });
    expect(connection.env).toEqual({ LOCAL_MODEL_KEY: 'test-key', LOCAL_ACCOUNT: 'test-account', HTTPS_PROXY: 'http://proxy.invalid', no_proxy: '127.0.0.1', SSL_CERT_FILE: '/cert.pem' });
    await expect(loadCodexConnection(authHome, {})).rejects.toThrow('LOCAL_MODEL_KEY');
    for (const variable of ['GH_TOKEN', 'GITHUB_TOKEN', 'SSH_AUTH_SOCK', 'NODE_OPTIONS', 'HOME', 'CODEX_HOME', 'XDG_CONFIG_HOME', 'TMPDIR']) {
      await writeFile(path.join(authHome, 'config.toml'), `model_provider = "custom"\n[model_providers.custom]\nenv_key = "${variable}"\n`);
      await expect(loadCodexConnection(authHome, { [variable]: 'private' })).rejects.toThrow('unsafe environment variable');
    }
  });

  it('supports configured profiles, environment-only authentication and default Codex configuration', async () => {
    const { authHome } = await codexConfiguration(`
profile = "local"
model = "base-model"
[profiles.local]
model = "profile-model"
model_provider = "custom"
[model_providers.custom]
base_url = "http://127.0.0.1:15721/v1"
requires_openai_auth = true
`);
    const profiled = await loadCodexConnection(authHome, { OPENAI_API_KEY: 'test-key' });
    expect(profiled.config.model).toBe('profile-model');
    expect(profiled.config.model_provider).toBe('custom');
    expect(profiled.env.OPENAI_API_KEY).toBe('test-key');
    await rm(path.join(authHome, 'config.toml'));
    const defaultConnection = await loadCodexConnection(authHome, { OPENAI_API_KEY: 'test-key', OPENAI_BASE_URL: 'http://localhost/v1' });
    expect(defaultConnection.config).toEqual({});
    expect(defaultConnection.env.OPENAI_BASE_URL).toBe('http://localhost/v1');
    await expect(loadCodexConnection(authHome, {})).rejects.toThrow('authentication is unavailable');
  });

  it('fails malformed configuration and missing providers without exposing secrets or falling back', async () => {
    const { authHome } = await codexConfiguration('model = "secret-invalid');
    await expect(loadCodexConnection(authHome, {})).rejects.toThrow('Invalid local Codex config.toml');
    await expect(loadCodexConnection(authHome, {})).rejects.not.toThrow('secret-invalid');
    await writeFile(path.join(authHome, 'config.toml'), 'model_provider = "missing"\n');
    await expect(loadCodexConnection(authHome, {})).rejects.toThrow('model provider is missing');
    await writeFile(path.join(authHome, 'config.toml'), 'profile = "missing"\n');
    await expect(loadCodexConnection(authHome, {})).rejects.toThrow('profile is missing');
  });

  it('routes a real child process to the configured local provider, preserves override and cleans temporary auth', async () => {
    const received: unknown[] = [];
    const server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        received.push({ url: request.url, authorization: request.headers.authorization, body: JSON.parse(body) });
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Local test server has no port');
      const { root, authHome } = await codexConfiguration(`model_provider = "custom"\nmodel = "configured-model"\n[model_providers.custom]\nbase_url = "http://127.0.0.1:${address.port}/v1"\nwire_api = "responses"\nenv_key = "LOCAL_MODEL_KEY"\n`);
      vi.stubEnv('LOCAL_MODEL_KEY', 'test-key');
      vi.stubEnv('GITHUB_TOKEN', 'publisher-secret');
      const { repo, artifactRoot, sha } = await repository();
      const manager = new WorkspaceManager(repo, new RunStore(artifactRoot, 'run-codex-config'));
      const workspace = await manager.create('sample', sha);
      const script = path.join(root, 'controlled-codex.mjs');
      const configModule = pathToFileURL(path.resolve('harness/src/autopilot/codex-config.mjs')).href;
      await writeFile(script, `
import { readFile, writeFile } from 'node:fs/promises';
const args = process.argv.slice(2);
if (args.includes('--ignore-user-config') || !args.includes('--ignore-rules')) throw new Error('Unsafe config flags');
if (process.env.GITHUB_TOKEN || process.env.SSH_AUTH_SOCK) throw new Error('Publisher credentials leaked');
const { loadCodexConnection } = await import(${JSON.stringify(configModule)});
const { config } = await loadCodexConnection(process.env.CODEX_HOME);
const provider = config.model_providers[config.model_provider];
let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;
const schema = JSON.parse(await readFile(args[args.indexOf('--output-schema') + 1], 'utf8'));
const response = await fetch(provider.base_url + '/responses', {
  method: 'POST', headers: { Authorization: 'Bearer ' + process.env[provider.env_key] },
  body: JSON.stringify({ model: args.includes('--model') ? args[args.indexOf('--model') + 1] : config.model, prompt, sandbox: args[args.indexOf('--sandbox') + 1], schema: schema.type }),
});
await writeFile(args[args.indexOf('--output-last-message') + 1], await response.text());
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'controlled-session' }));
`);
      const observed = vi.fn((step, options) => runStep({ ...step, args: [script, ...step.args] }, options));
      const coding = new CodexAdapter({ executable: process.execPath, authHome, runStep: observed });
      vi.stubEnv('CODEX_HOME', authHome);
      expect(new CodexAdapter().authHome).toBe(authHome);
      const artifactDir = path.join(artifactRoot, 'evidence');
      const request = { prompt: 'Return structured output', schema: z.object({ ok: z.boolean() }), workspace, artifactDir, readOnly: true, timeoutMs: 10000 };
      expect(await coding.execute(request)).toEqual({ output: { ok: true }, sessionId: 'controlled-session' });
      coding.model = 'override-model';
      await coding.execute({ ...request, readOnly: false });
      expect(received).toEqual([
        { url: '/v1/responses', authorization: 'Bearer test-key', body: { model: 'configured-model', prompt: request.prompt, sandbox: 'read-only', schema: 'object' } },
        { url: '/v1/responses', authorization: 'Bearer test-key', body: { model: 'override-model', prompt: request.prompt, sandbox: 'workspace-write', schema: 'object' } },
      ]);
      expect(await readFile(path.join(artifactDir, 'events.jsonl'), 'utf8')).not.toContain('test-key');
      const archive = await manager.archive(workspace, path.join(artifactDir, 'archive'));
      await manager.cleanup(workspace, archive);
      await expect(access(workspace.home)).rejects.toThrow();
      expect(await readFile(path.join(authHome, 'config.toml'), 'utf8')).toContain('custom');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }, 20000);
});

async function repository() {
  const root = await mkdtemp(path.join(tmpdir(), 'yyclaw-autopilot-'));
  roots.push(root);
  const repo = path.join(root, 'repo');
  await mkdir(repo);
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.name', 'Test']);
  await git(repo, ['config', 'user.email', 'test@example.com']);
  await mkdir(path.join(repo, 'docs'), { recursive: true });
  await mkdir(path.join(repo, 'harness/specs/rules'), { recursive: true });
  await mkdir(path.join(repo, 'harness/specs/scenarios'), { recursive: true });
  await mkdir(path.join(repo, 'tests/unit'), { recursive: true });
  await writeFile(path.join(repo, 'tests/unit/example.test.ts'), "it('works', () => { expect(true).toBe(true); });\n");
  await writeFile(path.join(repo, 'docs/FEATURELIST.md'), '| F33 | Automation | PARTIAL | code | acceptance |\n');
  for (const file of ['AGENTS.md', 'docs/PRODUCT.md', 'docs/ARCHITECTURE.md', 'docs/DOCUMENTATION.md', 'harness/FEATURE-MAP.md', 'harness/README.md', 'harness/specs/rules/docs-sync.md']) await writeFile(path.join(repo, file), '# Test\n');
  await writeFile(path.join(repo, 'sample.txt'), 'baseline\n');
  await writeFile(path.join(repo, 'other.txt'), 'baseline\n');
  await writeFile(path.join(repo, '.gitignore'), 'node_modules/\nartifacts/\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'baseline']);
  const remote = path.join(root, 'remote.git');
  await git(root, ['init', '--bare', remote]);
  await git(repo, ['remote', 'add', 'origin', remote]);
  await git(repo, ['push', '-u', 'origin', 'main']);
  return { root, repo, remote, artifactRoot: path.join(root, 'artifacts'), sha: await git(repo, ['rev-parse', 'HEAD']) };
}

function task(id = 'sample', file = 'sample.txt', dependencies: string[] = []) {
  return { id, title: `Implement ${id}`, intent: 'Improve the example', sources: ['docs/PRODUCT.md'], dependencies, writePaths: [file], changeTags: [], requiredRules: ['docs-sync'], checks: [{ id: 'unit-check', kind: 'unit', test: 'tests/unit/example.test.ts', prerequisites: [] }], acceptance: [{ id: 'behavior', description: 'The example changes correctly', checks: ['unit-check'] }], exclusions: [] };
}

function plan(sha: string, tasks = [task()]) {
  return { schemaVersion: 1, featureId: 'F33', goal: 'Improve example', baseSha: sha, targetBranch: 'main', tasks, exclusions: ['No product runtime changes'] };
}

function adapter() {
  return { preflight: vi.fn(), execute: vi.fn(async ({ workspace, prompt, readOnly }: { workspace: { path: string }; prompt: string; readOnly?: boolean }) => {
    if (readOnly) return { output: { status: 'pass', acceptance: [{ id: 'behavior', status: 'pass', evidence: 'actual deterministic checks' }], findings: [] } };
    const parsed = JSON.parse(prompt.split('Frozen task: ')[1].split('\nPrevious actual')[0]);
    await writeFile(path.join(workspace.path, parsed.writePaths[0]), `implemented ${parsed.id}\n`);
    return { output: { status: 'implemented', summary: 'Implemented', blockers: [] }, sessionId: 'test-session' };
  }) };
}

function publisher(repo: string, failOnce = false) {
  let number = 0;
  let failed = false;
  const publications = new Map<string, { number: number; sha: string; branch: string; base: string; url: string }>();
  return { preflight: vi.fn(), ready: vi.fn(), publish: vi.fn(async ({ branch, base, sha }: { branch: string; base: string; sha: string }) => {
    await git(repo, ['push', '--force', 'origin', `${sha}:refs/heads/${branch}`]);
    const prior = publications.get(branch);
    const publication = { number: prior?.number ?? ++number, sha, branch, base, url: `test-pr-${number}` };
    publications.set(branch, publication);
    return publication;
  }), checks: vi.fn(async () => {
    const listing = await git(repo, ['worktree', 'list', '--porcelain']);
    expect(listing.split('\n').filter((line: string) => line.startsWith('worktree '))).toHaveLength(1);
    if (failOnce && !failed) { failed = true; return { status: 'fail', reason: 'Simulated CI failure' }; }
    return { status: 'pass' };
  }) };
}

const acceptance = async () => ({ status: 'pass', acceptance: [{ id: 'behavior', status: 'pass' }], steps: [] });

describe('autopilot contracts and gates', () => {
  it('freezes valid DAGs and rejects cycles, missing evidence and protected writes', () => {
    const input = plan('a'.repeat(40), [task(), task('other', 'other.txt', ['sample'])]);
    expect(topologicalTasks(validatePlan(input)).map((entry: { id: string }) => entry.id)).toEqual(['sample', 'other']);
    expect(digest(input)).toBe(digest(structuredClone(input)));
    expect(scopesConflict(input.tasks[0], input.tasks[1])).toBe(false);
    expect(() => validatePlan({ ...input, tasks: [task('sample', 'sample.txt', ['other']), task('other', 'other.txt', ['sample'])] })).toThrow('cycle');
    expect(() => validatePlan({ ...input, tasks: [{ ...task(), writePaths: ['package.json'] }] })).toThrow('Protected');
    expect(() => validatePlan({ ...input, tasks: [{ ...task(), changeTags: ['ui'] }] })).toThrow('UI');
    expect(() => validatePlan({ ...input, tasks: [{ ...task(), writePaths: ['../outside'] }] })).toThrow();
  });

  it('executes declared tests and derives mandatory UI/comms gates without shell injection', async () => {
    expect(requiredTestStep('tests/unit/example.test.ts').args).toEqual(['exec', 'vitest', 'run', 'tests/unit/example.test.ts']);
    expect(() => requiredTestStep('pnpm test; rm -rf /')).toThrow('Unsafe');
    expect(() => requiredTestStep('node arbitrary-script.js')).toThrow('Unregistered');
    expect(requiredTestStep('pnpm exec playwright test tests/e2e/example.spec.ts --grep "specific case" --workers=1').args).toContain('specific case');
    expect(() => requiredTestStep('pnpm exec vitest run tests/unit/example.test.ts --update')).toThrow('Unregistered');
    const steps = await validationSteps({ data: { requiredTests: ['pnpm run typecheck'], changeTags: ['ui'] } }, null, ['electron/services/example.ts']);
    expect(steps.map((entry: { args: string[] }) => entry.args.join(' '))).toEqual(expect.arrayContaining(['run typecheck', 'run comms:replay', 'run comms:compare', 'run test:e2e']));
  });

  it('does not pass missing sandbox prerequisites or removed assertions', async () => {
    const { repo, artifactRoot, sha } = await repository();
    const store = new RunStore(artifactRoot, 'run-test');
    const manager = new WorkspaceManager(repo, store);
    const workspace = await manager.create('sample', sha);
    await writeFile(path.join(workspace.path, 'sample.txt'), 'implemented\n');
    const externalTask = { ...task(), checks: [{ id: 'unit-check', kind: 'external', test: 'pnpm run typecheck', prerequisites: ['AUTOPILOT_SANDBOX_KEY'] }] };
    const executeStep = vi.fn(async () => ({ status: 'pass', exitCode: 0 }));
    const evidence = await runAcceptance({ task: externalTask, workspace, artifactDir: path.join(store.dir, 'acceptance'), adapter: adapter(), executeStep });
    expect(evidence.status).toBe('blocked');
    expect(evidence.acceptance[0].status).toBe('blocked');
    const archive = await manager.archive(workspace, path.join(store.dir, 'archive'));
    await manager.cleanup(workspace, archive);
    const codingEnv = isolatedEnvironment(workspace.home);
    expect(codingEnv.GITHUB_TOKEN).toBeUndefined();
    expect(codingEnv.SSH_AUTH_SOCK).toBeUndefined();
  });

  it('detects removed assertions, skipped tests and undeclared writes', async () => {
    const { repo, artifactRoot, sha } = await repository();
    const manager = new WorkspaceManager(repo, new RunStore(artifactRoot, 'run-audit'));
    const workspace = await manager.create('sample', sha);
    await mkdir(path.join(workspace.path, 'tests/unit'), { recursive: true });
    await writeFile(path.join(workspace.path, 'tests/unit/example.test.ts'), "it.skip('disabled', () => {});\n");
    const audit = await auditChanges(workspace, task());
    expect(audit.failures).toContain('Out-of-scope write: tests/unit/example.test.ts');
    const archive = await manager.archive(workspace, path.join(artifactRoot, 'archive'));
    await manager.cleanup(workspace, archive);
  });

  it('archives cancellation evidence and recreates a new workspace on resume', async () => {
    const { repo, artifactRoot, sha } = await repository();
    const publishing = publisher(repo);
    const coding = adapter();
    coding.execute.mockImplementationOnce(async ({ workspace }) => {
      await writeFile(path.join(workspace.path, 'sample.txt'), 'partial implementation\n');
      throw new Error('Simulated process interruption');
    });
    const engine = new AutopilotEngine({ repo, artifactRoot, adapter: coding, publisher: publishing, prepare: async () => {}, baseline: async () => ({ status: 'pass' }), acceptance, requiredCiChecks: ['test'] });
    const failed = await engine.start(plan(sha));
    expect(failed.status).toBe('failed');
    expect(failed.tasks.sample.workspace).toBeNull();
    expect(failed.tasks.sample.recovery.archive).toBeDefined();
    const resumed = await engine.resume(failed.runId);
    expect(resumed.status, resumed.error).toBe('complete');
    expect(resumed.tasks.sample.workspaces).toHaveLength(2);
    expect(publishing.publish).toHaveBeenCalledTimes(1);
  });

  it('keeps cleanup failures non-successful and allocates no dependent workspace', async () => {
    const { repo, artifactRoot, sha } = await repository();
    const cleanup = vi.spyOn(WorkspaceManager.prototype, 'cleanup').mockRejectedValue(new Error('Simulated locked directory'));
    try {
      const publishing = publisher(repo);
      const engine = new AutopilotEngine({ repo, artifactRoot, adapter: adapter(), publisher: publishing, prepare: async () => {}, baseline: async () => ({ status: 'pass' }), acceptance, requiredCiChecks: ['test'] });
      const failed = await engine.start(plan(sha, [task(), task('other', 'other.txt', ['sample'])]));
      expect(failed.status).toBe('cleanup-failed');
      expect(failed.tasks.sample.workspace).not.toBeNull();
      expect(failed.tasks.other.workspaces).toHaveLength(0);
      expect(publishing.checks).not.toHaveBeenCalled();
      expect(cleanup).toHaveBeenCalledTimes(3);
    } finally { cleanup.mockRestore(); }
  });

  it('terminates owned child processes before removing a workspace', async () => {
    const { repo, artifactRoot, sha } = await repository();
    const store = new RunStore(artifactRoot, 'run-process');
    const manager = new WorkspaceManager(repo, store);
    const workspace = await manager.create('sample', sha);
    const result = await runStep({ name: 'owned timeout', command: process.execPath, args: ['-e', 'setTimeout(() => {}, 60000)'] }, {
      cwd: workspace.path, timeoutMs: 100, logPath: path.join(store.dir, 'process.log'),
      onSpawn: (child: { pid: number }) => manager.registerProcess(workspace, child),
      onExit: (child: { pid: number }) => manager.unregisterProcess(workspace, child),
    });
    expect(result.status).toBe('fail');
    const archive = await manager.archive(workspace, path.join(store.dir, 'archive'));
    await manager.cleanup(workspace, archive);
    await expect(access(workspace.container)).rejects.toThrow();
  });

  it('handles spawn errors, timeout and cancellation without hanging', async () => {
    expect((await runStep({ name: 'missing', command: '/not-a-command', args: [] })).status).toBe('fail');
    const slow = { name: 'slow', command: process.execPath, args: ['-e', 'setTimeout(() => {}, 60000)'] };
    expect((await runStep(slow, { timeoutMs: 50 })).error).toContain('timed out');
    const controller = new AbortController();
    const result = runStep(slow, { signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    expect((await result).error).toContain('cancelled');
  });
});

describe('owned workspace lifecycle', () => {
  it('archives recoverable changes and removes only owned worktrees idempotently', async () => {
    const { repo, artifactRoot, sha } = await repository();
    const store = new RunStore(artifactRoot, 'run-cleanup');
    const manager = new WorkspaceManager(repo, store);
    const workspace = await manager.create('sample', sha);
    await writeFile(path.join(workspace.path, 'sample.txt'), 'uncommitted changes\n');
    await writeFile(path.join(workspace.path, 'new.txt'), 'new untracked file\n');
    const archive = await manager.archive(workspace, path.join(store.dir, 'archive'));
    expect(await readFile(path.join(archive.artifactDir, 'untracked/new.txt'), 'utf8')).toContain('untracked');
    await expect(manager.cleanup({ ...workspace, token: 'foreign' }, archive)).rejects.toThrow('ownership');
    await writeFile(path.join(workspace.path, 'new.txt'), 'changed after archival\n');
    await expect(manager.cleanup(workspace, archive)).rejects.toThrow('stale');
    const fresh = await manager.archive(workspace, path.join(store.dir, 'archive'));
    await manager.cleanup(workspace, fresh);
    await manager.cleanup(workspace, fresh);
    expect(await readFile(path.join(repo, 'sample.txt'), 'utf8')).toBe('baseline\n');
    await expect(access(workspace.container)).rejects.toThrow();
    expect(await git(repo, ['worktree', 'list', '--porcelain'])).not.toContain(workspace.path);
  });

  it('refuses unpublished SHA and symlinked containers', async () => {
    const { repo, root, artifactRoot, sha } = await repository();
    const store = new RunStore(artifactRoot, 'run-safety');
    const manager = new WorkspaceManager(repo, store);
    const workspace = await manager.create('sample', sha);
    const archive = await manager.archive(workspace, path.join(store.dir, 'archive'));
    await expect(manager.cleanup(workspace, archive, { sha, branch: 'missing', number: 1 })).rejects.toThrow('durable');
    const foreign = path.join(root, 'foreign');
    await mkdir(foreign);
    const fake = { ...workspace, container: path.join(manager.root, 'foreign'), resourceId: 'foreign', path: path.join(manager.root, 'foreign/repo'), home: path.join(manager.root, 'foreign/home') };
    await symlink(foreign, fake.container, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(manager.verify(fake)).rejects.toThrow('Symlinked');
    await manager.cleanup(workspace, archive);
  });
});

describe('autonomous development integration', () => {
  it('publishes a per-task stack and cleans each worktree before any CI poll', async () => {
    const { repo, artifactRoot, sha } = await repository();
    const publishing = publisher(repo);
    const engine = new AutopilotEngine({ repo, artifactRoot, adapter: adapter(), publisher: publishing, prepare: async () => {}, baseline: async () => ({ status: 'pass' }), acceptance, pollMs: 1, requiredCiChecks: ['test'] });
    const result = await engine.start(plan(sha, [task(), task('other', 'other.txt')]));
    expect(result.status, result.error).toBe('complete');
    expect(publishing.publish).toHaveBeenCalledTimes(2);
    expect(result.tasks.other.publication.base).toBe(result.tasks.sample.publication.branch);
    expect(result.tasks.sample.workspace).toBeNull();
    expect(result.tasks.other.cleanup.status).toBe('pass');
    expect(await git(repo, ['status', '--porcelain'])).toBe('');
    expect(await readFile(path.join(repo, 'sample.txt'), 'utf8')).toBe('baseline\n');
    expect(publishing.ready).toHaveBeenCalledTimes(2);
  });

  it('rebuilds CI repair worktrees and updates the same PR and dependent stack', async () => {
    const { repo, artifactRoot, sha } = await repository();
    const publishing = publisher(repo, true);
    const engine = new AutopilotEngine({ repo, artifactRoot, adapter: adapter(), publisher: publishing, prepare: async () => {}, baseline: async () => ({ status: 'pass' }), acceptance, pollMs: 1, requiredCiChecks: ['test'] });
    const result = await engine.start(plan(sha, [task(), task('other', 'other.txt', ['sample'])]));
    expect(result.status, result.error).toBe('complete');
    expect(publishing.publish).toHaveBeenCalledTimes(4);
    expect(result.tasks.sample.publication.number).toBe(1);
    expect(result.tasks.sample.workspaces.length).toBeGreaterThan(1);
    expect(result.tasks.other.evidence.sha).toBe(result.tasks.other.publication.sha);
    expect(await engine.resume(result.runId)).toMatchObject({ status: 'complete' });
  });

  it('blocks absent external acceptance and refuses dirty input without publishing', async () => {
    const { repo, artifactRoot, sha } = await repository();
    const publishing = publisher(repo);
    const engine = new AutopilotEngine({ repo, artifactRoot, adapter: adapter(), publisher: publishing, prepare: async () => {}, baseline: async () => ({ status: 'pass' }), acceptance: async () => ({ status: 'blocked' }), pollMs: 1, requiredCiChecks: ['test'] });
    const result = await engine.start(plan(sha));
    expect(result.status).toBe('blocked');
    expect(result.tasks.sample.workspace).toBeNull();
    expect(publishing.publish).not.toHaveBeenCalled();
    await writeFile(path.join(repo, 'sample.txt'), 'user changes\n');
    await expect(engine.start(plan(sha))).rejects.toThrow('clean inputs');
    expect(await readFile(path.join(repo, 'sample.txt'), 'utf8')).toBe('user changes\n');
  });

  it('does not count missing, skipped or stale CI checks as a pass', async () => {
    const github = new GitHubPublisher('/tmp');
    github.gh = vi.fn(async () => JSON.stringify({ headRefOid: 'a', statusCheckRollup: [{ name: 'test', conclusion: 'SKIPPED' }] }));
    expect((await github.checks({ sha: 'a', number: 1 }, ['test'])).status).toBe('pending');
    expect((await github.checks({ sha: 'b', number: 1 }, ['test'])).status).toBe('blocked');
  });

  it('never starts coding when the committed baseline fails', async () => {
    const { repo, artifactRoot, sha } = await repository();
    const coding = adapter();
    const publishing = publisher(repo);
    const engine = new AutopilotEngine({ repo, artifactRoot, adapter: coding, publisher: publishing, baseline: async () => ({ status: 'fail' }), requiredCiChecks: ['test'] });
    const result = await engine.start(plan(sha));
    expect(result.status).toBe('failed');
    expect(result.error).toContain('baseline');
    expect(coding.execute).not.toHaveBeenCalled();
    expect(publishing.publish).not.toHaveBeenCalled();
  });

  it('requires non-skipped structured behavior results, not command exit alone', async () => {
    const { repo, artifactRoot, sha } = await repository();
    const store = new RunStore(artifactRoot, 'run-empty-tests');
    const manager = new WorkspaceManager(repo, store);
    const workspace = await manager.create('sample', sha);
    await writeFile(path.join(workspace.path, 'sample.txt'), 'implemented\n');
    const executeStep = vi.fn(async (step: { args: string[] }) => {
      const output = step.args.find((arg) => arg.startsWith('--outputFile='));
      if (output) await writeFile(output.slice('--outputFile='.length), JSON.stringify({ numTotalTests: 1, numFailedTests: 0, numPendingTests: 1, numTodoTests: 0 }));
      return { status: 'pass', exitCode: 0 };
    });
    const evidence = await runAcceptance({ task: task(), workspace, artifactDir: path.join(store.dir, 'tests'), adapter: adapter(), executeStep });
    expect(evidence.status).toBe('fail');
    const archive = await manager.archive(workspace, path.join(store.dir, 'archive'));
    await manager.cleanup(workspace, archive);
  });
});
