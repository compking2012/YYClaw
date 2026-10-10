import { readFile, access, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { requiredTestStep } from '../validation.mjs';
import { runStep } from '../runner.mjs';
import { scanBackendCommunicationBoundary, touchesCommunicationPath } from '../rules.mjs';
import { dirtyFiles, git } from './workspaces.mjs';
import { isolatedEnvironment } from './adapters.mjs';
import { RISK_PATHS, reviewSchema, digest } from './contracts.mjs';
import { atomicJson } from './store.mjs';

export async function auditChanges(workspace, task, allowRisks = []) {
  const files = await dirtyFiles(workspace.path);
  const preserved = ['AGENTS.md', 'CLAUDE.md', 'harness/specs/'];
  const failures = files.filter((file) => !task.writePaths.includes(file)).map((file) => `Out-of-scope write: ${file}`);
  const canonicalRoot = await realpath(workspace.path);
  for (const file of files) {
    const absolute = path.join(workspace.path, file);
    const info = await lstat(absolute).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
    if (info && (info.isSymbolicLink() || path.relative(canonicalRoot, await realpath(absolute)).split(path.sep).includes('..'))) failures.push(`Symlinked or escaped write: ${file}`);
  }
  if (failures.some((failure) => failure.startsWith('Symlinked'))) return { files, failures };
  for (const file of files) {
    if (preserved.some((prefix) => file === prefix || file.startsWith(prefix))) failures.push(`Frozen instruction/spec modification requires separate review: ${file}`);
    for (const [risk, prefixes] of Object.entries(RISK_PATHS)) if (prefixes.some((prefix) => file.startsWith(prefix)) && !allowRisks.includes(risk)) failures.push(`Protected ${risk} modification: ${file}`);
  }
  const testDiff = await git(workspace.path, ['diff', '--unified=0', workspace.baseSha, '--', 'tests', '*test*', '*spec*']);
  if (testDiff.split('\n').some((line) => /^-(?!-{2})/.test(line) && /expect\(|assert\.|\.to[A-Z]|\bit\(|\btest\(|\bdescribe\(/.test(line))) failures.push('Existing test assertions or scenarios were removed; gate changes require separate human review');
  if (testDiff.split('\n').some((line) => /^\+(?!\+{2})/.test(line) && /(\.(skip|todo|only)\s*\(|@ts-(ignore|nocheck)|istanbul ignore|v8 ignore)/.test(line))) failures.push('Test skipping, exclusivity or ignored coverage is forbidden');
  for (const file of files.filter((entry) => /^tests\//.test(entry))) {
    const content = await readFile(path.join(workspace.path, file), 'utf8').catch(() => '');
    if (/\.(skip|todo|only)\s*\(|@ts-(ignore|nocheck)|istanbul ignore|v8 ignore/.test(content)) failures.push(`Test weakening directive in ${file}`);
  }
  if (touchesCommunicationPath(files) && !task.changeTags.includes('comms')) failures.push('Communication writes require a frozen comms gate');
  if (files.some((file) => /^src\/(pages|components)\//.test(file)) && !task.changeTags.includes('ui')) failures.push('UI writes require a frozen UI gate');
  if (task.changeTags.includes('ui') && !files.some((file) => /^tests\/e2e\/.+\.spec\.[jt]s$/.test(file))) failures.push('Visible UI changes require an added or updated Electron E2E spec');
  if (task.changeTags.includes('docs')) {
    const readmes = ['README.md', 'README.zh-CN.md', 'README.ja-JP.md', 'README.ru-RU.md'];
    if (readmes.some((file) => files.includes(file)) && !readmes.every((file) => files.includes(file))) failures.push('README changes require all four locales');
    for (const guide of ['features', 'architecture', 'development', 'proxy-settings']) {
      const guides = ['en-US', 'zh-CN', 'ja-JP', 'ru-RU'].map((locale) => `docs/${locale}/${guide}.md`);
      if (guides.some((file) => files.includes(file)) && !guides.every((file) => files.includes(file))) failures.push(`Localized ${guide} changes require all four locales`);
    }
  }
  const localeFiles = files.filter((file) => /^shared\/i18n\/locales\/(en|zh|ja|ru)\//.test(file));
  for (const file of localeFiles) {
    const suffix = file.replace(/^shared\/i18n\/locales\/(en|zh|ja|ru)\//, '');
    if (!['en', 'zh', 'ja', 'ru'].every((locale) => files.includes(`shared/i18n/locales/${locale}/${suffix}`))) failures.push(`Locale coverage is incomplete for ${suffix}`);
  }
  failures.push(...await scanBackendCommunicationBoundary(files, workspace.path));
  return { files, failures };
}

export function acceptanceSteps(task) {
  const steps = task.checks.map((entry) => ({ ...requiredTestStep(entry.test), id: entry.id, kind: entry.kind, prerequisites: entry.prerequisites }));
  const baseline = ['pnpm run lint:check', 'pnpm run typecheck', 'pnpm test', 'pnpm run build:vite', 'pnpm run harness:ci'];
  if (task.changeTags.includes('comms')) baseline.push('pnpm run comms:replay', 'pnpm run comms:compare');
  if (task.changeTags.includes('ui')) baseline.push('pnpm run test:e2e');
  if (task.changeTags.includes('performance')) baseline.push('pnpm run perf:chat');
  if (task.changeTags.includes('ui') && task.writePaths.some((file) => /src\/pages\/(Chat|Cron)|src\/components\/settings\//.test(file))) baseline.push('pnpm run screenshots');
  const build = task.changeTags.includes('ui') ? [{ ...requiredTestStep('pnpm run build:vite'), id: 'ui-build', kind: 'quality', prerequisites: [] }] : [];
  return [...build, ...steps, ...baseline.map((test, index) => ({ ...requiredTestStep(test), id: `baseline-${index}`, kind: 'quality', prerequisites: [] }))];
}

export async function runAcceptance({ task, workspace, artifactDir, signal, timeoutMs, allowRisks, adapter, executeStep = runStep, externalEnv = {}, onProgress, processHooks = {} }) {
  const audit = await auditChanges(workspace, task, allowRisks);
  await mkdirArtifact(artifactDir);
  const steps = [];
  const env = isolatedEnvironment(workspace.home);
  for (const step of acceptanceSteps(task)) {
    if (audit.failures.length) break;
    const missing = step.prerequisites.filter((name) => !externalEnv[name]);
    if (missing.length) {
      steps.push({ ...step, status: 'blocked', error: `Missing authorized sandbox prerequisites: ${missing.join(', ')}` });
      continue;
    }
    for (const file of step.args.filter((arg) => arg.startsWith('tests/'))) await access(path.join(workspace.path, file));
    const args = [...step.args];
    let report;
    if (args[0] === 'exec' && args[1] === 'vitest') {
      report = path.join(artifactDir, `${step.id}.vitest.json`);
      args.push('--reporter=json', `--outputFile=${report}`);
    }
    if (step.kind === 'ui' && args[0] === 'exec' && args[1] === 'playwright') args.push('--reporter=json');
    const result = await executeStep({ ...step, args }, {
      cwd: workspace.path, signal, timeoutMs, logPath: path.join(artifactDir, `${step.id}.log`),
      env: { ...env, ...Object.fromEntries(step.prerequisites.map((name) => [name, externalEnv[name]])),
        ...(step.kind === 'ui' ? { PLAYWRIGHT_JSON_OUTPUT_NAME: path.join(artifactDir, `${step.id}.playwright.json`) } : {}),
      },
      ...processHooks,
    });
    if (report && result.status === 'pass') {
      const json = JSON.parse(await readFile(report, 'utf8'));
      if (!json.numTotalTests || json.numFailedTests || json.numPendingTests || json.numTodoTests) result.status = 'fail';
      result.report = report;
    }
    if (step.kind === 'ui' && result.status === 'pass') {
      const json = JSON.parse(await readFile(path.join(artifactDir, `${step.id}.playwright.json`), 'utf8'));
      if (!json.stats?.expected || json.stats.unexpected || json.stats.skipped || json.stats.flaky) result.status = 'fail';
      result.report = path.join(artifactDir, `${step.id}.playwright.json`);
    }
    steps.push({ ...result, id: step.id, kind: step.kind });
    await onProgress?.(steps);
    if (result.status !== 'pass') break;
  }
  const acceptance = task.acceptance.map((entry) => ({
    id: entry.id, description: entry.description,
    status: entry.checks.every((id) => steps.some((step) => step.id === id && step.status === 'pass')) ? 'pass' : steps.some((step) => entry.checks.includes(step.id) && step.status === 'blocked') ? 'blocked' : 'fail',
    checks: entry.checks,
  }));
  let review = { status: 'blocked', findings: ['Local acceptance has not passed'] };
  const reviewedPatch = digest(await git(workspace.path, ['diff', '--binary', 'HEAD']));
  const reviewedFiles = await Promise.all(audit.files.map(async (file) => ({ file, hash: await readFile(path.join(workspace.path, file)).then(digest, () => 'deleted') })));
  if (!audit.failures.length && steps.length === acceptanceSteps(task).length && steps.every((step) => step.status === 'pass')) {
    const response = await adapter.execute({
      workspace, artifactDir: path.join(artifactDir, 'review'), signal, timeoutMs, readOnly: true, schema: reviewSchema, ...processHooks,
      prompt: `Independently review the diff against ${workspace.baseSha}, immutable task and ACTUAL test evidence below. Do not edit files or run publishing commands. Detect test weakening, missing positive/negative paths, docs/i18n gaps and acceptance omissions. Return one verdict for every acceptance ID. Never infer external behavior from mocks.\n${JSON.stringify({ task, steps, acceptance })}`,
    });
    review = response.output;
    if (new Set(review.acceptance.map((entry) => entry.id)).size !== acceptance.length || !acceptance.every((entry) => review.acceptance.some((verdict) => verdict.id === entry.id && verdict.status === 'pass'))) review.status = 'fail';
  }
  const after = await auditChanges(workspace, task, allowRisks);
  if (reviewedPatch !== digest(await git(workspace.path, ['diff', '--binary', 'HEAD']))) after.failures.push('Files changed during independent read-only review');
  const afterFiles = await Promise.all(after.files.map(async (file) => ({ file, hash: await readFile(path.join(workspace.path, file)).then(digest, () => 'deleted') })));
  if (digest(reviewedFiles) !== digest(afterFiles)) after.failures.push('Untracked evidence changed during independent review');
  const status = audit.failures.length || after.failures.length || steps.some((step) => step.status === 'fail') || review.status === 'fail' ? 'fail' : steps.some((step) => step.status === 'blocked') || review.status === 'blocked' ? 'blocked' : 'pass';
  const evidence = { status, baseSha: workspace.baseSha, files: after.files, failures: [...audit.failures, ...after.failures], steps, acceptance, review, at: new Date().toISOString() };
  await atomicJson(path.join(artifactDir, 'acceptance.json'), evidence);
  return evidence;
}

async function mkdirArtifact(directory) {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(directory, { recursive: true });
}
