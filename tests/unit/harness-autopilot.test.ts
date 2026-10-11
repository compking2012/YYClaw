import { mkdtemp, mkdir, writeFile, readFile, rm, access, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import tar from 'tar';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validatePlan, digest, scopesConflict, topologicalTasks, DEFAULT_BUDGET } from '../../harness/src/autopilot/contracts.mjs';
import { RunStore } from '../../harness/src/autopilot/store.mjs';
import { git, WorkspaceManager } from '../../harness/src/autopilot/workspaces.mjs';
import { AutopilotEngine } from '../../harness/src/autopilot/engine.mjs';
import { auditChanges, runAcceptance } from '../../harness/src/autopilot/acceptance.mjs';
import { CodexAdapter, isolatedEnvironment, GitHubPublisher } from '../../harness/src/autopilot/adapters.mjs';
import { loadCodexConnection, prepareCodexConnection } from '../../harness/src/autopilot/codex-config.mjs';
import { dependencyEnvironment, dependencyInstallStep, validateDependencyCache, resolveDependencyCache, initializationError } from '../../harness/src/autopilot/dependencies.mjs';
import { autopilotCommand } from '../../harness/src/autopilot/cli.mjs';
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
      const dependencyCache = sharedCache(root);
      const request = { prompt: 'Return structured output', schema: z.object({ ok: z.boolean() }), workspace, artifactDir, readOnly: true, timeoutMs: 10000, dependencyCache };
      expect(await coding.execute(request)).toEqual({ output: { ok: true }, sessionId: 'controlled-session' });
      expect(observed.mock.calls[0][1].env.npm_config_store_dir).toBe(dependencyCache.storeDir);
      expect(observed.mock.calls[0][1].env.electron_config_cache).toBe(dependencyCache.electronCacheDir);
      expect(observed.mock.calls[0][1].env.npm_config_userconfig).toBe(path.join(workspace.home, '.npmrc'));
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

function sharedCache(root: string) {
  return { schemaVersion: 1, storeDir: path.join(root, 'shared/store'), releaseCacheDir: path.join(root, 'shared/releases'), electronCacheDir: path.join(root, 'shared/electron'), lockRoot: path.join(root, 'shared/locks') };
}

describe('shared dependency initialization', () => {
  it('keeps one persistent store, private dependency trees and a credential-free network environment', async () => {
    const { root, repo, artifactRoot } = await repository();
    const cache = sharedCache(root);
    expect(validateDependencyCache(cache, repo, artifactRoot)).toBe(cache);
    const first = dependencyEnvironment(path.join(root, 'first-home'), cache, { HTTPS_PROXY: 'http://proxy.invalid', SSL_CERT_FILE: '/cert.pem', ELECTRON_MIRROR: 'https://mirror.invalid', GH_TOKEN: 'private', GITHUB_TOKEN: 'private', SSH_AUTH_SOCK: '/ssh', OPENAI_API_KEY: 'private', NODE_OPTIONS: 'private', NPM_TOKEN: 'private' });
    const second = dependencyEnvironment(path.join(root, 'second-home'), cache, {});
    expect(first.npm_config_store_dir).toBe(second.npm_config_store_dir);
    expect(first.electron_config_cache).toBe(cache.electronCacheDir);
    expect(first.YYCLAW_RELEASE_CACHE_DIR).toBe(cache.releaseCacheDir);
    expect(first.HOME).not.toBe(second.HOME);
    expect(first.HTTPS_PROXY).toBe('http://proxy.invalid');
    expect(first.SSL_CERT_FILE).toBe('/cert.pem');
    for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'SSH_AUTH_SOCK', 'OPENAI_API_KEY', 'NODE_OPTIONS', 'NPM_TOKEN']) expect(first[name]).toBeUndefined();
    const install = dependencyInstallStep(cache);
    expect(install.args).toEqual(expect.arrayContaining(['--frozen-lockfile', '--prefer-offline', '--store-dir', cache.storeDir, '--package-import-method=copy', '--no-side-effects-cache']));
    expect(install.args).not.toContain('--ignore-scripts');
    expect(() => validateDependencyCache({ ...cache, storeDir: path.join(artifactRoot, 'workspaces/cache') }, repo, artifactRoot)).toThrow('run artifacts');
    expect(() => validateDependencyCache({ ...cache, storeDir: 'relative' }, repo, artifactRoot)).toThrow('absolute');
    const resolved = await resolveDependencyCache(repo, artifactRoot);
    expect(path.isAbsolute(resolved.storeDir)).toBe(true);
    expect(resolved.storeDir).not.toContain(artifactRoot);
    const cacheRoot = path.join(repo, 'node_modules/.autopilot-cache');
    expect(resolved.storeDir.startsWith(path.join(cacheRoot, 'pnpm-store') + path.sep)).toBe(true);
    expect(resolved.releaseCacheDir).toBe(path.join(cacheRoot, 'releases'));
    expect(resolved.electronCacheDir).toBe(path.join(cacheRoot, 'electron'));
    expect(resolved.lockRoot).toBe(path.join(cacheRoot, 'locks'));
    expect(() => validateDependencyCache({ ...resolved, storeDir: path.join(repo, 'node_modules/.pnpm') }, repo, artifactRoot)).toThrow('dedicated project cache');
    expect(() => validateDependencyCache({ ...resolved, storeDir: path.join(repo, 'node_modules') }, repo, artifactRoot)).toThrow('dedicated project cache');
    await mkdir(path.join(repo, 'node_modules'), { recursive: true });
    await mkdir(path.join(root, 'foreign-cache'));
    await symlink(path.join(root, 'foreign-cache'), cacheRoot, 'dir');
    await expect(resolveDependencyCache(repo, artifactRoot)).rejects.toThrow('symlinks');
    expect(DEFAULT_BUDGET.initTimeoutMs).toBe(30 * 60000);
    for (const value of ['0', '-1', 'NaN', true]) await expect(autopilotCommand({ _: ['autopilot', 'run'], 'init-timeout-minutes': value })).rejects.toThrow('positive number');
  });

  it('serializes initialization without serializing coding, and records bounded stages and heartbeats', async () => {
    const { root, repo, artifactRoot, sha } = await repository();
    const store = new RunStore(artifactRoot, 'run-shared-prepare');
    const manager = new WorkspaceManager(repo, store);
    const cache = sharedCache(root);
    const progress: string[] = [];
    let active = 0;
    let maximum = 0;
    const executeStep = vi.fn(async (step, options) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 35));
      active--;
      expect(options.env.npm_config_store_dir).toBe(cache.storeDir);
      expect(options.timeoutMs).toBeGreaterThan(500);
      return { ...step, status: 'pass', exitCode: 0, durationMs: 35 };
    });
    const engine = new AutopilotEngine({ repo, artifactRoot, adapter: adapter(), publisher: publisher(repo), budget: { initTimeoutMs: 1000, commandTimeoutMs: 100 }, executeStep, onProgress: (message) => progress.push(message), progressIntervalMs: 10 });
    engine.store = store;
    engine.manager = manager;
    engine.controller = new AbortController();
    engine.record = { deadline: Date.now() + 10000, dependencyCache: cache, tasks: { first: {}, second: {} } };
    const first = await manager.create('first', sha);
    const second = await manager.create('second', sha);
    const firstDir = path.join(store.dir, 'first-evidence');
    const secondDir = path.join(store.dir, 'second-evidence');
    await Promise.all([engine.prepare(first, firstDir), engine.prepare(second, secondDir)]);
    expect(maximum).toBe(1);
    expect(executeStep.mock.calls).toHaveLength(4);
    expect(progress.filter((entry) => entry.includes('dependency install')).length).toBeGreaterThan(2);
    for (const [workspace, dir] of [[first, firstDir], [second, secondDir]] as const) {
      const report = JSON.parse(await readFile(path.join(dir, 'initialization.json'), 'utf8'));
      expect(report.status).toBe('pass');
      expect(report.storeDir).toBe(cache.storeDir);
      expect(report.steps.map((step: { stage: string }) => step.stage)).toEqual(['dependency install', 'extension bridge']);
      expect(report.steps[0].timeoutMs).toBeLessThanOrEqual(1000);
      const archive = await manager.archive(workspace, path.join(dir, 'archive'));
      await manager.cleanup(workspace, archive);
    }
    await expect(access(cache.lockRoot)).resolves.toBeUndefined();
  });

  it('retains timeout and lifecycle errors, cleans failed workspaces and upgrades legacy runs without resetting deadlines', async () => {
    const { root, repo, artifactRoot, sha } = await repository();
    const cache = sharedCache(root);
    const resolveCache = vi.fn(async () => cache);
    const coding = adapter();
    const executeStep = vi.fn(async (step, options) => {
      await writeFile(options.logPath, 'Progress: downloaded 1\n.../sharp install$ node install/check.js\n');
      return { ...step, status: 'fail', exitCode: null, durationMs: 20, error: 'Command timed out' };
    });
    const engine = new AutopilotEngine({ repo, artifactRoot, adapter: coding, publisher: publisher(repo), executeStep, resolveCache, onProgress: () => {} });
    const failed = await engine.start(plan(sha));
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('baseline dependency install timed out');
    expect(failed.error).toContain('dependency lifecycle scripts');
    expect(failed.baseline.initialization.steps[0].timeoutMs).toBeGreaterThan(20 * 60000);
    expect(failed.tasks.sample.attempts).toBe(0);
    expect(failed.tasks.sample.repairs).toBe(0);
    expect(coding.execute).not.toHaveBeenCalled();
    expect(failed.baseline.cleanup.status).toBe('pass');
    expect(failed.dependencyCache).toEqual(cache);
    await expect(access(cache.storeDir)).resolves.toBeUndefined();
    const store = new RunStore(artifactRoot, failed.runId);
    const legacy = await store.read();
    const deadline = legacy.deadline;
    const planHash = legacy.planHash;
    delete legacy.dependencyCache;
    delete legacy.budget.initTimeoutMs;
    await store.save(legacy);
    const resumed = await engine.resume(failed.runId);
    expect(resumed.deadline).toBe(deadline);
    expect(resumed.planHash).toBe(planHash);
    expect(resumed.dependencyCache).toEqual(cache);
    expect(resumed.budget.initTimeoutMs).toBe(DEFAULT_BUDGET.initTimeoutMs);
    expect(resolveCache).toHaveBeenCalledTimes(2);
    const oldCache = sharedCache(path.join(root, 'legacy-external-cache'));
    await mkdir(oldCache.storeDir, { recursive: true });
    const cachedLegacy = await store.read();
    cachedLegacy.dependencyCache = oldCache;
    await store.save(cachedLegacy);
    const migrated = await engine.resume(failed.runId);
    expect(migrated.dependencyCache).toEqual(cache);
    expect(migrated.deadline).toBe(deadline);
    expect(migrated.planHash).toBe(planHash);
    await expect(access(oldCache.storeDir)).resolves.toBeUndefined();
    expect(await readFile(path.join(store.dir, 'events.jsonl'), 'utf8')).toContain('dependency-cache-relocated');
    const lifecycle = initializationError('sample', 'dependency install', { status: 'fail', exitCode: 7, durationMs: 100, timeoutMs: 1000, logPath: '/log', failureKind: 'dependency lifecycle scripts' });
    expect(lifecycle).toContain('exit 7');
    expect(initializationError('sample', 'extension bridge', { error: 'Command cancelled', exitCode: null, durationMs: 100, timeoutMs: 1000, logPath: '/log' })).toContain('was cancelled');
  });

  it('reuses one real pnpm store offline, incrementally caches versions and preserves copied dependency isolation', async () => {
    const { root, repo, artifactRoot } = await repository();
    const cache = await resolveDependencyCache(repo, artifactRoot);
    const archives = new Map<string, Buffer>();
    for (const version of ['1.0.0', '2.0.0']) {
      const source = path.join(root, `fixture-${version}`);
      await mkdir(path.join(source, 'package'), { recursive: true });
      await writeFile(path.join(source, 'package/package.json'), JSON.stringify({ name: 'yyclaw-cache-fixture', version, main: 'index.js' }));
      await writeFile(path.join(source, 'package/index.js'), `module.exports = ${JSON.stringify(version)};\n`);
      const archive = path.join(source, 'fixture.tgz');
      await tar.create({ gzip: true, file: archive, cwd: source }, ['package']);
      archives.set(`/fixture-${version}.tgz`, await readFile(archive));
      archives.set(`/yyclaw-cache-fixture/-/yyclaw-cache-fixture-${version}.tgz`, await readFile(archive));
    }
    const downloads: string[] = [];
    const server = createServer((request, response) => {
      const archive = archives.get(request.url ?? '');
      if (!archive) { response.writeHead(404); response.end(); return; }
      downloads.push(request.url!);
      response.end(archive);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    let closed = false;
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test registry is unavailable');
      await writeFile(path.join(repo, '.npmrc'), `registry=http://127.0.0.1:${address.port}/\npackage-import-method=copy\n`);
      const env = dependencyEnvironment(path.join(root, 'controller-home'), cache, {});
      await mkdir(env.TMPDIR, { recursive: true });
      const revisions: string[] = [];
      for (const version of ['1.0.0', '2.0.0']) {
        await writeFile(path.join(repo, 'package.json'), JSON.stringify({ name: 'cache-fixture-consumer', private: true, dependencies: { 'yyclaw-cache-fixture': `http://127.0.0.1:${address.port}/fixture-${version}.tgz` }, scripts: { postinstall: 'node -e "require(\'fs\').writeFileSync(\'lifecycle.txt\', \'ran\')"' } }));
        const result = await runStep({ name: 'Freeze controlled fixture', command: 'pnpm', args: ['install', '--lockfile-only', '--store-dir', cache.storeDir, '--ignore-scripts'] }, { cwd: repo, env, timeoutMs: 20000, logPath: path.join(root, `freeze-${version}.log`) });
        expect(result.status).toBe('pass');
        await git(repo, ['add', 'package.json', 'pnpm-lock.yaml', '.npmrc']);
        await git(repo, ['commit', '-m', `Freeze fixture ${version}`]);
        revisions.push(await git(repo, ['rev-parse', 'HEAD']));
      }
      const store = new RunStore(artifactRoot, 'run-real-cache');
      const manager = new WorkspaceManager(repo, store);
      const warm = await manager.create('warm-v1', revisions[0]);
      const warmEnv = dependencyEnvironment(warm.home, cache, {});
      await mkdir(warmEnv.TMPDIR, { recursive: true });
      const warmResult = await runStep(dependencyInstallStep(cache), { cwd: warm.path, env: warmEnv, timeoutMs: 20000, logPath: path.join(store.dir, 'warm.log') });
      expect(warmResult.status, await readFile(path.join(store.dir, 'warm.log'), 'utf8')).toBe('pass');
      expect(await readFile(path.join(warm.path, 'lifecycle.txt'), 'utf8')).toBe('ran');
      const beforeSecond = downloads.length;
      const second = await manager.create('warm-v2', revisions[1]);
      const secondEnv = dependencyEnvironment(second.home, cache, {});
      await mkdir(secondEnv.TMPDIR, { recursive: true });
      expect((await runStep(dependencyInstallStep(cache), { cwd: second.path, env: secondEnv, timeoutMs: 20000, logPath: path.join(store.dir, 'v2.log') })).status).toBe('pass');
      expect(downloads.slice(beforeSecond)).toEqual(['/yyclaw-cache-fixture/-/yyclaw-cache-fixture-2.0.0.tgz']);
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      closed = true;
      const count = downloads.length;
      const offline = await manager.create('offline-v1', revisions[0]);
      const offlineEnv = dependencyEnvironment(offline.home, cache, {});
      await mkdir(offlineEnv.TMPDIR, { recursive: true });
      expect((await runStep({ ...dependencyInstallStep(cache), args: [...dependencyInstallStep(cache).args, '--offline'] }, { cwd: offline.path, env: offlineEnv, timeoutMs: 20000, logPath: path.join(store.dir, 'offline.log') })).status).toBe('pass');
      expect(downloads).toHaveLength(count);
      const firstModule = path.join(warm.path, 'node_modules/yyclaw-cache-fixture/index.js');
      const offlineModule = path.join(offline.path, 'node_modules/yyclaw-cache-fixture/index.js');
      await writeFile(firstModule, 'modified locally');
      expect(await readFile(offlineModule, 'utf8')).toContain('1.0.0');
      expect(await readFile(path.join(second.path, 'node_modules/yyclaw-cache-fixture/index.js'), 'utf8')).toContain('2.0.0');
      const emptyEnv = dependencyEnvironment(offline.home, { ...cache, storeDir: path.join(root, 'empty-store') }, {});
      const missing = await manager.create('offline-missing', revisions[1]);
      const missingResult = await runStep({ ...dependencyInstallStep({ ...cache, storeDir: emptyEnv.npm_config_store_dir }), args: [...dependencyInstallStep({ ...cache, storeDir: emptyEnv.npm_config_store_dir }).args, '--offline'] }, { cwd: missing.path, env: emptyEnv, timeoutMs: 20000, logPath: path.join(store.dir, 'missing.log') });
      expect(missingResult.status).toBe('fail');
      for (const workspace of [warm, second, offline, missing]) {
        const archive = await manager.archive(workspace, path.join(store.dir, workspace.taskId, 'archive'));
        await manager.cleanup(workspace, archive);
      }
      await expect(access(cache.storeDir)).resolves.toBeUndefined();
      await expect(access(path.join(repo, 'node_modules/yyclaw-cache-fixture'))).rejects.toThrow();
    } finally {
      if (!closed) await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 90000);

  it('cancels real initialization processes, keeps recovery evidence and leaves persistent caches intact', async () => {
    const { root, repo, artifactRoot, sha } = await repository();
    const cache = sharedCache(root);
    let engine: AutopilotEngine;
    const executeStep = async (step, options) => {
      setTimeout(() => engine.controller.abort(), 75);
      return await runStep({ ...step, command: process.execPath, args: ['-e', 'setTimeout(() => {}, 60000)'] }, options);
    };
    engine = new AutopilotEngine({ repo, artifactRoot, adapter: adapter(), publisher: publisher(repo), executeStep, resolveCache: async () => cache, onProgress: () => {} });
    const failed = await engine.start(plan(sha));
    expect(failed.error).toContain('baseline dependency install was cancelled');
    expect(failed.baseline.initialization.steps[0].error).toBe('Command cancelled');
    expect(failed.baseline.cleanup.status).toBe('pass');
    expect(failed.baseline.workspace).toBeNull();
    expect(failed.tasks.sample.repairs).toBe(0);
    await expect(access(cache.storeDir)).resolves.toBeUndefined();
    const listing = await git(repo, ['worktree', 'list', '--porcelain']);
    expect(listing.split('\n').filter((line: string) => line.startsWith('worktree '))).toHaveLength(1);
    const summary = JSON.parse(await readFile(path.join(artifactRoot, failed.runId, 'summary.json'), 'utf8'));
    expect(summary.baseline.initialization.status).toBe('fail');
    expect(summary.dependencyCache).toEqual(cache);
    await expect(access(failed.baseline.archive.artifactDir)).resolves.toBeUndefined();
  });

  it('blocks missing private registry authentication without borrowing user or publisher credentials', async () => {
    const { root, repo, artifactRoot, sha } = await repository();
    const coding = adapter();
    const cache = sharedCache(root);
    const executeStep = async (step, options) => {
      expect(options.env.GITHUB_TOKEN).toBeUndefined();
      expect(options.env.NPM_TOKEN).toBeUndefined();
      await writeFile(options.logPath, 'ERR_PNPM_FETCH_401 Unauthorized; No authorization header was set\n');
      return { ...step, status: 'fail', exitCode: 1, durationMs: 1 };
    };
    const engine = new AutopilotEngine({ repo, artifactRoot, adapter: coding, publisher: publisher(repo), executeStep, resolveCache: async () => cache, onProgress: () => {} });
    const blocked = await engine.start(plan(sha));
    expect(blocked.status).toBe('blocked');
    expect(blocked.error).toContain('private registry authentication unavailable');
    expect(blocked.baseline.initialization.status).toBe('blocked');
    expect(blocked.baseline.cleanup.status).toBe('pass');
    expect(coding.execute).not.toHaveBeenCalled();
  });
});

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
