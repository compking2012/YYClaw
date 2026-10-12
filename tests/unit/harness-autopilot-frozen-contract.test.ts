import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { digest, validatePlan } from '../../harness/src/autopilot/contracts.mjs';
import { completePlanRules, validateSources } from '../../harness/src/autopilot/planner.mjs';
import { AutopilotEngine, DEFAULT_CI_CHECKS, validateInitializationReceipt } from '../../harness/src/autopilot/engine.mjs';
import { acceptanceSteps, auditChanges, runAcceptance } from '../../harness/src/autopilot/acceptance.mjs';
import { RunStore, atomicJson } from '../../harness/src/autopilot/store.mjs';
import { GitHubPublisher } from '../../harness/src/autopilot/adapters.mjs';
import { git, WorkspaceManager } from '../../harness/src/autopilot/workspaces.mjs';
import { requiredTestStep } from '../../harness/src/validation.mjs';

const testFile = 'tests/unit/frozen.test.ts';
const baselineTest = "it('retains its assertion', () => { expect(true).toBe(true); });\n";
const stages = ['dependency install', 'extension bridge', 'startup typecheck'];
const rules = ['autonomous-development-safety', 'docs-sync', 'renderer-main-boundary',
  'backend-communication-boundary', 'comms-regression', 'ui-i18n-design-tokens', 'e2e-parallel-isolation'];
const tokenName = 'AUTOPILOT_SANDBOX_F33_FIXTURE_TOKEN';
const docsImpact = 'docs-sync impact: tests only; no changed behavior, flow or interface; no documentation writes or locale promotion. F33 remains PARTIAL. Synthetic fixtures and passing controller tests are not deployment certification.';

function task() {
  return { id: 'frozen', title: 'Regress frozen contracts', intent: 'Test existing controller behavior',
    sources: ['docs/PRODUCT.md#f33'], dependencies: [] as string[], writePaths: [testFile],
    changeTags: [] as string[], requiredRules: ['autonomous-development-safety', 'docs-sync'],
    checks: [{ id: 'unit-check', kind: 'unit', test: testFile, prerequisites: [] as string[] }],
    acceptance: [{ id: 'frozen-behavior', description: 'Frozen contracts fail closed', checks: ['unit-check'] }],
    exclusions: ['No production, documentation, locale or deployment changes'] };
}

function plan(baseSha = 'a'.repeat(40)) {
  return { schemaVersion: 1, featureId: 'F33', goal: 'Regress the frozen controller', baseSha,
    targetBranch: 'main', tasks: [task()], exclusions: ['No publication or real external services'] };
}

type Workspace = { taskId: string; resourceId: string; baseSha: string; path: string; home: string; container: string };
type OwnedFixture = { manager: InstanceType<typeof WorkspaceManager>; workspace: Workspace; artifactDir: string; repo: string };
type Step = { id: string; command: string; args: string[]; prerequisites: string[] };
type StepOptions = { env: Record<string, string>; cwd: string; logPath: string };
type Verdict = { id: string; status: string; evidence: string };
let root: string;
let fixtures: OwnedFixture[];

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'yyclaw-f33-frozen-'));
  fixtures = [];
  const home = path.join(root, 'home');
  await mkdir(path.join(home, 'tmp'), { recursive: true });
  for (const [name, value] of Object.entries({ HOME: home, USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, '.config'), TMPDIR: path.join(home, 'tmp'),
    TMP: path.join(home, 'tmp'), TEMP: path.join(home, 'tmp'),
    GIT_CONFIG_GLOBAL: path.join(home, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: '0',
  })) vi.stubEnv(name, value);
  vi.stubEnv(tokenName, undefined);
});

afterEach(async () => {
  try {
    for (const { manager, workspace, artifactDir, repo } of fixtures) {
      const archive = await manager.archive(workspace, path.join(artifactDir, 'archive'));
      expect(await manager.cleanup(workspace, archive)).toMatchObject({ status: 'pass', resourceId: workspace.resourceId });
      await expect(access(workspace.container)).rejects.toThrow();
      expect(await git(repo, ['worktree', 'list', '--porcelain'])).not.toContain(`worktree ${workspace.path}`);
    }
    await rm(root, { recursive: true, force: true });
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  }
});

async function repository() {
  const repo = path.join(root, `repo-${fixtures.length}`);
  await mkdir(repo);
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.name', 'Frozen Fixture']);
  await git(repo, ['config', 'user.email', 'frozen@example.invalid']);
  const files = { [testFile]: baselineTest, 'tests/e2e/frozen.spec.ts': 'export {};\n',
    'docs/PRODUCT.md': '# F33 fixture\n', 'docs/FEATURELIST.md': '| F33 | Automation | PARTIAL | fixture | not certification |\n',
    'AGENTS.md': '# Owned disposable fixture\n', 'package.json': '{"name":"f33-fixture","private":true}\n',
    'pnpm-workspace.yaml': 'packages:\n  - .\n', '.npmrc': 'registry=https://registry.npmjs.org/\n',
    ...Object.fromEntries(rules.map((rule) => [`harness/specs/rules/${rule}.md`, `# ${rule}\n`])) };
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(repo, file)), { recursive: true });
    await writeFile(path.join(repo, file), content);
  }
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'Create disposable frozen-contract fixture']);
  const baseSha = await git(repo, ['rev-parse', 'HEAD']);
  const store = new RunStore(path.join(root, 'artifacts'), `fixture-${fixtures.length}`);
  const manager = new WorkspaceManager(repo, store);
  const workspace = await manager.create('frozen', baseSha);
  const artifactDir = path.join(store.dir, 'evidence');
  const fixture = { repo, manager, workspace, artifactDir };
  fixtures.push(fixture);
  await mkdir(path.join(workspace.home, 'tmp'), { recursive: true });
  await mkdir(artifactDir, { recursive: true });
  return fixture;
}

function receipt(workspace: Pick<Workspace, 'taskId' | 'resourceId' | 'baseSha'>) {
  return { schemaVersion: 1, taskId: workspace.taskId, resourceId: workspace.resourceId,
    baseSha: workspace.baseSha, status: 'pass',
    steps: stages.map((stage) => ({ stage, status: 'pass', exitCode: 0 })) };
}

function rejectPlan(input: ReturnType<typeof plan>, message?: string) {
  const before = structuredClone(input);
  const hash = digest(input);
  if (message) expect(() => validatePlan(input, { allowRisks: [] })).toThrow(message);
  else expect(() => validatePlan(input, { allowRisks: [] })).toThrow();
  expect(input).toEqual(before);
  expect(digest(input)).toBe(hash);
}

describe('F33 initialization receipts', () => {
  const identity = { taskId: 'frozen', resourceId: 'owned-resource', baseSha: 'a'.repeat(40) };

  it('accepts only the unchanged ordered schema-1 startup evidence', () => {
    const report = receipt(identity);
    const before = structuredClone(report);
    expect(validateInitializationReceipt(identity, report)).toBe(report);
    expect(report).toEqual(before);
    expect(report).not.toHaveProperty('acceptance');
    expect(report).not.toHaveProperty('bundledUv');
  });

  it.each(['schemaVersion', 'taskId', 'resourceId', 'baseSha', 'status'])('rejects wrong %s without rewriting it', (field) => {
    const report = { ...receipt(identity), [field]: 'foreign' };
    const before = structuredClone(report);
    expect(() => validateInitializationReceipt(identity, report)).toThrow('identity/status');
    expect(report).toEqual(before);
  });

  it('rejects absent receipts and omitted, reordered, duplicate or extra stages', () => {
    expect(() => validateInitializationReceipt(identity, undefined)).toThrow('identity/status');
    const report = receipt(identity);
    const invalidSteps = [undefined, [], ...stages.map((_, omitted) => report.steps.filter((_, index) => index !== omitted)),
      [...report.steps].reverse(), [report.steps[0], report.steps[0], report.steps[2]],
      [...report.steps, report.steps[0]]];
    for (const steps of invalidSteps) {
      const invalid = { ...report, steps };
      const before = structuredClone(invalid);
      expect(() => validateInitializationReceipt(identity, invalid)).toThrow('lacks successful');
      expect(invalid).toEqual(before);
    }
  });

  it.each(stages.flatMap((stage, index) => ['fail', 'blocked', 'not-run', 'nonzero'].map((result) => ({ stage, index, result }))))('rejects $stage with $result', ({ index, result }) => {
    const report = receipt(identity);
    report.steps[index] = { ...report.steps[index], ...(result === 'nonzero' ? { exitCode: 1 } : { status: result }) };
    const before = structuredClone(report);
    expect(() => validateInitializationReceipt(identity, report)).toThrow('lacks successful');
    expect(report).toEqual(before);
  });

  it('checks durable JSON against the controller digest without workers, commands or publishers', async () => {
    const { workspace, artifactDir, repo } = await repository();
    const execute = vi.fn();
    const publish = vi.fn();
    const executeStep = vi.fn();
    const engine = new AutopilotEngine({ repo, artifactRoot: path.join(root, 'engine-artifacts'),
      adapter: { execute }, publisher: { publish }, executeStep });
    const report = receipt(workspace);
    engine.record = { tasks: { frozen: { initialization: structuredClone(report) } } };
    const receiptPath = path.join(artifactDir, 'initialization.json');
    await expect(engine.startupContext(workspace, artifactDir)).rejects.toThrow('ENOENT');
    await writeFile(receiptPath, '{malformed');
    await expect(engine.startupContext(workspace, artifactDir)).rejects.toThrow(SyntaxError);
    await atomicJson(receiptPath, report);
    const context = await engine.startupContext(workspace, artifactDir);
    expect(context).toContain(receiptPath);
    expect(context).toContain('required lifecycle scripts');
    expect(context).toContain('NOT task acceptance or certification of optional bundled tools');
    expect(context).toContain('missing prerequisites remain blocked');
    await atomicJson(receiptPath, { ...report, durationMs: 1 });
    await expect(engine.startupContext(workspace, artifactDir)).rejects.toThrow('differs from the controller record');
    expect(engine.record.tasks.frozen.initialization).toEqual(report);
    engine.prepareOverride = vi.fn();
    await rm(receiptPath);
    expect(await engine.startupContext(workspace, artifactDir)).toBe('Preparation is supplied by a test-only controller override; no real initialization certification is claimed.');
    for (const mock of [execute, publish, executeStep, engine.prepareOverride]) expect(mock).not.toHaveBeenCalled();
  });
});

describe('F33 permission and command boundaries with no risk authorization', () => {
  it('accepts one exact test write and the registered targeted unit command', () => {
    const input = plan();
    expect(validatePlan(input, { allowRisks: [] })).toEqual(input);
    expect(requiredTestStep(testFile)).toMatchObject({ command: 'pnpm', args: ['exec', 'vitest', 'run', testFile] });
  });

  it.each(['../escape.test.ts', '/tmp/absolute.test.ts', 'tests/unit/*.test.ts', 'tests/unit/[ab].test.ts',
    'tests\\unit\\frozen.test.ts', '.env', 'config/.env.local', 'auth.json', 'keys/id_rsa', 'keys/id_ed25519',
    'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'patches/runtime.patch', 'resources/openclaw/config.json',
    'harness/src/policy.mjs', '.github/workflows/ci.yml', 'scripts/gate.mjs', 'AGENTS.md', 'CLAUDE.md',
    'eslint.config.mjs', 'vitest.config.ts', 'playwright.config.ts', 'tsconfig.json', 'electron-builder.yml', 'build/release.json'])('rejects write scope %s unchanged', (file) => {
    const input = plan();
    input.tasks[0].writePaths = [file];
    rejectPlan(input);
  });

  it('rejects duplicate write paths unchanged', () => {
    const input = plan();
    input.tasks[0].writePaths.push(testFile);
    rejectPlan(input, 'Duplicate write scope');
  });

  it.each(['node arbitrary.mjs', 'pnpm run init', 'pnpm exec vitest run tests/unit/frozen.test.ts; echo unsafe',
    'pnpm exec vitest run tests/unit/frozen.test.ts && echo unsafe', 'pnpm exec vitest run $(echo unsafe)',
    'pnpm exec vitest run tests/unit/frozen.test.ts --update', 'pnpm exec vitest run tests/unit/frozen.test.ts -u',
    'pnpm exec playwright test tests/e2e/frozen.spec.ts --update-snapshots'])('rejects %s without executing it', (command) => {
    const input = plan();
    input.tasks[0].checks[0].test = command;
    expect(() => requiredTestStep(command)).toThrow();
    rejectPlan(input);
  });

  it('audits an additive assertion and rejects an undeclared write without altering either file', async () => {
    const { workspace, repo } = await repository();
    const addition = baselineTest + "it('adds a negative assertion', () => { expect(false).toBe(false); });\n";
    await writeFile(path.join(workspace.path, testFile), addition);
    expect(await auditChanges(workspace, task(), [])).toEqual({ files: [testFile], failures: [] });
    await writeFile(path.join(workspace.path, 'undeclared.txt'), 'owned negative fixture\n');
    expect((await auditChanges(workspace, task(), [])).failures).toContain('Out-of-scope write: undeclared.txt');
    expect(await readFile(path.join(workspace.path, testFile), 'utf8')).toBe(addition);
    expect(await readFile(path.join(repo, testFile), 'utf8')).toBe(baselineTest);
  });

  it('rejects a symlinked declared file without following it for acceptance', async () => {
    const { workspace } = await repository();
    const target = path.join(workspace.home, 'owned-target.ts');
    await writeFile(target, baselineTest);
    await rm(path.join(workspace.path, testFile));
    await symlink(target, path.join(workspace.path, testFile));
    expect((await auditChanges(workspace, task(), [])).failures).toContain(`Symlinked or escaped write: ${testFile}`);
    expect(await readFile(target, 'utf8')).toBe(baselineTest);
  });

  it('rejects assertion removal rather than repairing the test', async () => {
    const { workspace } = await repository();
    const removed = 'export {};\n';
    await writeFile(path.join(workspace.path, testFile), removed);
    expect((await auditChanges(workspace, task(), [])).failures).toContain('Existing test assertions or scenarios were removed; gate changes require separate human review');
    expect(await readFile(path.join(workspace.path, testFile), 'utf8')).toBe(removed);
  });

  it.each(['skip', 'todo', 'only', 'type-ignore', 'type-nocheck', 'coverage-istanbul', 'coverage-v8'])('rejects constructed %s weakening directives', async (directive) => {
    const { workspace } = await repository();
    const forbidden = directive.startsWith('type-') ? ['@ts', directive.slice(5)].join('-')
      : directive.startsWith('coverage-') ? [directive.slice(9), 'ignore'].join(' ')
        : ['it', directive].join('.') + "('forbidden', () => {});";
    const content = baselineTest + (directive.includes('-') ? `// ${forbidden}\n` : `${forbidden}\n`);
    await writeFile(path.join(workspace.path, testFile), content);
    const audit = await auditChanges(workspace, task(), []);
    expect(audit.failures).toContain('Test skipping, exclusivity or ignored coverage is forbidden');
    expect(audit.failures).toContain(`Test weakening directive in ${testFile}`);
    expect(await readFile(path.join(workspace.path, testFile), 'utf8')).toBe(content);
  });
});

describe('F33 immutable acceptance/check mapping and DAG', () => {
  it('accepts a stable behavior ID with an explicitly mapped additional quality check', () => {
    const input = plan();
    input.tasks[0].checks.push({ id: 'quality-check', kind: 'quality', test: 'pnpm run typecheck', prerequisites: [] });
    input.tasks[0].acceptance[0].checks.push('quality-check');
    const before = structuredClone(input);
    expect(validatePlan(input, { allowRisks: [] })).toEqual(before);
    expect(input).toEqual(before);
  });

  it.each(['missing-check', 'unmapped-check', 'duplicate-check', 'duplicate-acceptance', 'empty-mapping', 'quality-only', 'missing-dependency', 'self-dependency', 'cycle'])('rejects %s without changing frozen fields or identity', (fault) => {
    const input = plan();
    const entry = input.tasks[0];
    if (fault === 'missing-check') entry.acceptance[0].checks.push('missing');
    if (fault === 'unmapped-check') entry.checks.push({ id: 'unmapped', kind: 'quality', test: 'pnpm run typecheck', prerequisites: [] });
    if (fault === 'duplicate-check') entry.checks.push(structuredClone(entry.checks[0]));
    if (fault === 'duplicate-acceptance') entry.acceptance.push(structuredClone(entry.acceptance[0]));
    if (fault === 'empty-mapping') entry.acceptance[0].checks = [];
    if (fault === 'quality-only') entry.checks[0] = { id: 'unit-check', kind: 'quality', test: 'pnpm run typecheck', prerequisites: [] };
    if (fault === 'missing-dependency') entry.dependencies = ['missing'];
    if (fault === 'self-dependency') entry.dependencies = [entry.id];
    if (fault === 'cycle') {
      entry.dependencies = ['second'];
      input.tasks.push({ ...task(), id: 'second', dependencies: [entry.id] });
    }
    rejectPlan(input);
  });
});

describe('F33 proposal completion versus frozen rule policy', () => {
  it.each([[], ['ui'], ['comms'], ['ui', 'comms']])('completes only rules for synthetic tags %j and rejects every frozen omission', async (...tags) => {
    const { repo, workspace } = await repository();
    const proposal = plan(workspace.baseSha);
    proposal.tasks[0].changeTags = tags;
    proposal.tasks[0].requiredRules = ['autonomous-development-safety'];
    if (tags.includes('ui')) {
      proposal.tasks[0].checks.push({ id: 'ui-check', kind: 'ui', test: 'tests/e2e/frozen.spec.ts', prerequisites: [] });
      proposal.tasks[0].acceptance[0].checks.push('ui-check');
    }
    const before = structuredClone(proposal);
    const mandatory = ['docs-sync', ...(tags.includes('ui') ? ['ui-i18n-design-tokens', 'e2e-parallel-isolation'] : []),
      ...(tags.includes('comms') ? ['renderer-main-boundary', 'backend-communication-boundary', 'comms-regression'] : [])];
    const completed = completePlanRules(proposal);
    expect(new Set(completed.tasks[0].requiredRules)).toEqual(new Set(['autonomous-development-safety', ...mandatory]));
    expect({ ...completed, tasks: completed.tasks.map((entry: ReturnType<typeof task>) => ({ ...entry, requiredRules: before.tasks[0].requiredRules })) }).toEqual(before);
    expect(proposal).toEqual(before);
    expect(completePlanRules(completed)).toEqual(completed);
    expect(validatePlan(completed, { allowRisks: [] })).toEqual(completed);
    await expect(validateSources(repo, completed)).resolves.toBeUndefined();
    for (const missing of mandatory) {
      const frozen = structuredClone(completed);
      frozen.tasks[0].requiredRules = frozen.tasks[0].requiredRules.filter((rule: string) => rule !== missing);
      const unchanged = structuredClone(frozen);
      await expect(validateSources(repo, frozen)).rejects.toThrow(`${missing} contract`);
      expect(frozen).toEqual(unchanged);
    }
  });

  it('rejects unknown rules and unsafe sources without completing or repairing frozen input', async () => {
    const { repo } = await repository();
    for (const source of ['/tmp/private.md', '../private.md', 'docs\\PRODUCT.md', '#empty']) {
      const frozen = plan();
      frozen.tasks[0].sources = [source];
      const before = structuredClone(frozen);
      await expect(validateSources(repo, frozen)).rejects.toThrow('Unsafe requirement source');
      expect(frozen).toEqual(before);
    }
    const frozen = plan();
    frozen.tasks[0].requiredRules.push('unknown-rule');
    const before = structuredClone(frozen);
    await expect(validateSources(repo, frozen)).rejects.toThrow('ENOENT');
    expect(frozen).toEqual(before);
  });
});

async function evidenceFixture(options: { report?: Record<string, number>; failedCheck?: string; verdicts?: Verdict[]; external?: boolean; authorized?: boolean } = {}) {
  const fixture = await repository();
  const entry = task();
  entry.checks.push({ id: 'mapped-quality', kind: 'quality', test: 'pnpm run typecheck', prerequisites: [] });
  entry.acceptance[0].checks.push('mapped-quality');
  entry.acceptance.push({ id: 'additional-behavior', description: 'All mapped evidence is complete', checks: ['unit-check'] });
  if (options.external) {
    entry.checks.push({ id: 'external-check', kind: 'external', test: testFile, prerequisites: [tokenName] });
    entry.acceptance.push({ id: 'external-behavior', description: 'Dedicated fake sandbox authorization', checks: ['external-check'] });
  }
  validatePlan({ ...plan(fixture.workspace.baseSha), tasks: [entry] }, { allowRisks: [] });
  const report = options.report ?? { numTotalTests: 2, numPassedTests: 2, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0 };
  const executeStep = vi.fn(async (step: Step, stepOptions: StepOptions) => {
    expect(stepOptions.cwd).toBe(fixture.workspace.path);
    expect(stepOptions.env.HOME).toBe(fixture.workspace.home);
    expect(stepOptions.env.TMPDIR).toBe(path.join(fixture.workspace.home, 'tmp'));
    expect(stepOptions.env[tokenName]).toBe(step.id === 'external-check' && options.authorized ? 'fake-f33-token' : undefined);
    const output = step.args.find((arg) => arg.startsWith('--outputFile='));
    if (output) await atomicJson(output.slice('--outputFile='.length), report);
    return { status: step.id === options.failedCheck ? 'fail' : 'pass', exitCode: step.id === options.failedCheck ? 1 : 0, logPath: stepOptions.logPath };
  });
  const verdicts = options.verdicts ?? entry.acceptance.map(({ id }) => ({ id, status: 'pass', evidence: `Controlled actual unit JSON and mapped command results. ${docsImpact}` }));
  const adapter = { execute: vi.fn(async (request: { readOnly: boolean; workspace: Workspace; prompt: string }) => {
    expect(request.readOnly).toBe(true);
    expect(request.workspace).toBe(fixture.workspace);
    expect(request.prompt).toContain('ACTUAL controller test evidence');
    expect(request.prompt).toContain('Do not rerun');
    return { output: { status: 'pass', acceptance: verdicts, findings: [docsImpact] } };
  }) };
  const before = structuredClone(entry);
  const evidence = await runAcceptance({ task: entry, workspace: fixture.workspace, artifactDir: fixture.artifactDir,
    adapter, executeStep, allowRisks: [], externalEnv: options.authorized ? { [tokenName]: 'fake-f33-token' } : {} });
  expect(entry).toEqual(before);
  expect(JSON.parse(await readFile(path.join(fixture.artifactDir, 'acceptance.json'), 'utf8'))).toEqual(evidence);
  expect(await readFile(path.join(fixture.repo, testFile), 'utf8')).toBe(baselineTest);
  return { ...fixture, entry, evidence, executeStep, adapter };
}

describe('F33 actual evidence gates and documentation impact review', () => {
  it('passes nonempty actual unit JSON, all mapped commands and complete read-only verdicts', async () => {
    const { evidence, executeStep, adapter, entry } = await evidenceFixture();
    expect(evidence.status).toBe('pass');
    expect(evidence.acceptance.map((criterion: { id: string; status: string }) => [criterion.id, criterion.status])).toEqual([
      ['frozen-behavior', 'pass'], ['additional-behavior', 'pass']]);
    expect(evidence.review.findings).toContain(docsImpact);
    expect(evidence.review.acceptance.every((verdict: Verdict) => verdict.evidence.includes(docsImpact))).toBe(true);
    expect(adapter.execute).toHaveBeenCalledTimes(1);
    expect(executeStep).toHaveBeenCalledTimes(acceptanceSteps(entry).length);
    expect(evidence.steps.filter((step: Step) => step.id.startsWith('baseline-')).map((step: Step) => step.id)).toEqual([
      'baseline-0', 'baseline-1', 'baseline-2', 'baseline-3', 'baseline-4']);
    expect(acceptanceSteps(entry).slice(-5).map((step: Step) => [step.command, ...step.args].join(' '))).toEqual([
      'pnpm run lint:check', 'pnpm run typecheck', 'pnpm test', 'pnpm run build:vite', 'pnpm run harness:ci']);
  });

  it.each(['empty', 'failed', 'pending', 'todo'])('never passes a %s unit JSON report despite process success', async (fault) => {
    const report = { numTotalTests: 2, numPassedTests: 2, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0 };
    if (fault === 'empty') report.numTotalTests = 0;
    if (fault === 'failed') report.numFailedTests = 1;
    if (fault === 'pending') report.numPendingTests = 1;
    if (fault === 'todo') report.numTodoTests = 1;
    const { evidence, adapter, executeStep } = await evidenceFixture({ report });
    expect(evidence.status).toBe('fail');
    expect(evidence.acceptance.every((criterion: { status: string }) => criterion.status !== 'pass')).toBe(true);
    expect(evidence.steps[0]).toMatchObject({ id: 'unit-check', status: 'fail', exitCode: 0 });
    expect(executeStep).toHaveBeenCalledTimes(1);
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it('does not pass a failed mapped quality command', async () => {
    const { evidence, adapter } = await evidenceFixture({ failedCheck: 'mapped-quality' });
    expect(evidence.status).toBe('fail');
    expect(evidence.acceptance.find((criterion: { id: string }) => criterion.id === 'frozen-behavior').status).toBe('fail');
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it.each(['missing', 'duplicate', 'extra-duplicate', 'failing', 'blocked'])('rejects %s review verdicts even when local checks pass', async (fault) => {
    const verdicts = [{ id: 'frozen-behavior', status: 'pass', evidence: 'Controlled actual evidence' },
      { id: 'additional-behavior', status: 'pass', evidence: 'Controlled actual evidence' }];
    if (fault === 'missing') verdicts.pop();
    if (fault === 'duplicate') verdicts[1] = { ...verdicts[0] };
    if (fault === 'extra-duplicate') verdicts.push({ ...verdicts[0] });
    if (fault === 'failing') verdicts[1].status = 'fail';
    if (fault === 'blocked') verdicts[1].status = 'blocked';
    const { evidence, adapter } = await evidenceFixture({ verdicts });
    expect(evidence.steps.every((step: { status: string }) => step.status === 'pass')).toBe(true);
    expect(adapter.execute).toHaveBeenCalledTimes(1);
    expect(evidence.status).not.toBe('pass');
    expect(evidence.review.status).not.toBe('pass');
  });

  it('blocks absent explicit external authorization without executing or inheriting the environment value', async () => {
    vi.stubEnv(tokenName, 'fake-ambient-value-not-authorized');
    const { evidence, executeStep, adapter } = await evidenceFixture({ external: true });
    expect(evidence.status).toBe('blocked');
    expect(evidence.acceptance.find((criterion: { id: string }) => criterion.id === 'external-behavior').status).toBe('blocked');
    expect(evidence.steps.find((step: Step) => step.id === 'external-check')).toMatchObject({
      status: 'blocked', error: `Missing authorized sandbox prerequisites: ${tokenName}` });
    expect(executeStep.mock.calls.some(([step]) => step.id === 'external-check')).toBe(false);
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it('passes controlled external evidence with a fake value scoped only to its declared check', async () => {
    const { evidence, executeStep } = await evidenceFixture({ external: true, authorized: true });
    expect(evidence.status).toBe('pass');
    expect(evidence.acceptance.find((criterion: { id: string }) => criterion.id === 'external-behavior').status).toBe('pass');
    expect(executeStep.mock.calls.filter(([, options]) => options.env[tokenName] === 'fake-f33-token').map(([step]) => step.id)).toEqual(['external-check']);
  });

  it('retains default current-SHA CI requirements without querying or publishing', () => {
    const publish = vi.fn();
    const checks = vi.fn();
    const engine = new AutopilotEngine({ repo: path.join(root, 'unused-repo'), artifactRoot: path.join(root, 'unused-artifacts'),
      adapter: { execute: vi.fn() }, publisher: { publish, checks } });
    expect(engine.requiredCiChecks).toBe(DEFAULT_CI_CHECKS);
    expect(engine.requiredCiChecks).toEqual(['check', 'build', 'harness', 'comms-regression',
      'Electron E2E (ubuntu-latest)', 'Electron E2E (macos-latest)', 'Electron E2E (windows-latest)']);
    expect(publish).not.toHaveBeenCalled();
    expect(checks).not.toHaveBeenCalled();
  });

  it('requires every CI result at the exact publication SHA using read-only controlled responses', async () => {
    const publisher = new GitHubPublisher(path.join(root, 'unused-repo'));
    const publication = { number: 33, sha: 'a'.repeat(40) };
    const gh = vi.spyOn(publisher, 'gh');
    const rollup = DEFAULT_CI_CHECKS.map((name: string) => ({ name, conclusion: 'SUCCESS' }));
    gh.mockResolvedValue(JSON.stringify({ headRefOid: publication.sha, statusCheckRollup: rollup }));
    expect((await publisher.checks(publication, DEFAULT_CI_CHECKS)).status).toBe('pass');
    gh.mockResolvedValue(JSON.stringify({ headRefOid: 'b'.repeat(40), statusCheckRollup: rollup }));
    expect((await publisher.checks(publication, DEFAULT_CI_CHECKS)).status).toBe('blocked');
    gh.mockResolvedValue(JSON.stringify({ headRefOid: publication.sha, statusCheckRollup: rollup.slice(1) }));
    expect((await publisher.checks(publication, DEFAULT_CI_CHECKS)).status).toBe('pending');
    gh.mockResolvedValue(JSON.stringify({ headRefOid: publication.sha,
      statusCheckRollup: rollup.map((entry: { name: string; conclusion: string }, index: number) => index === 0 ? { ...entry, conclusion: 'FAILURE' } : entry) }));
    expect((await publisher.checks(publication, DEFAULT_CI_CHECKS)).status).toBe('fail');
    for (const [args] of gh.mock.calls) expect(args).toEqual(['pr', 'view', '33', '--json', 'headRefOid,statusCheckRollup']);
  });
});
