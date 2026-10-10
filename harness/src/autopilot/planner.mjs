import { readFile, readdir, access, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { planSchema, validatePlan, digest } from './contracts.mjs';
import { atomicJson } from './store.mjs';
import { assertClean, git, WorkspaceManager } from './workspaces.mjs';
import { RunStore } from './store.mjs';

export async function requirementContext(repo, featureId) {
  const featureList = await readFile(path.join(repo, 'docs/FEATURELIST.md'), 'utf8');
  const featureIds = [...featureList.matchAll(/^\| (F\d{2,}) \|/gm)].map((match) => match[1]);
  if (!featureIds.includes(featureId)) throw new Error(`Unknown feature ${featureId}`);
  const files = ['AGENTS.md', 'docs/PRODUCT.md', 'docs/FEATURELIST.md', 'docs/ARCHITECTURE.md', 'docs/DOCUMENTATION.md', 'harness/FEATURE-MAP.md', 'harness/README.md'];
  const context = [];
  for (const file of files) context.push({ file, content: await readFile(path.join(repo, file), 'utf8') });
  for (const directory of ['scenarios', 'rules']) {
    const base = path.join(repo, 'harness/specs', directory);
    for (const name of await readdir(base)) if (name.endsWith('.md')) context.push({ file: `harness/specs/${directory}/${name}`, content: await readFile(path.join(base, name), 'utf8') });
  }
  return { context, featureIds, defaultGoal: featureList.split('\n').find((line) => line.startsWith(`| ${featureId} |`))?.split('|').slice(2, -1).map((value) => value.trim()).join(' — ') };
}

export async function validateSources(repo, plan) {
  for (const task of plan.tasks) {
    for (const source of task.sources) {
      const file = source.split('#')[0];
      if (!file || path.isAbsolute(file) || file.split('/').includes('..') || file.includes('\\')) throw new Error('Unsafe requirement source');
      await access(path.join(repo, file));
    }
    for (const rule of task.requiredRules) await access(path.join(repo, 'harness/specs/rules', `${rule}.md`));
    if (!task.requiredRules.includes('docs-sync')) throw new Error(`Task ${task.id} must retain the docs-sync contract`);
    if (task.changeTags.includes('comms')) {
      for (const rule of ['renderer-main-boundary', 'backend-communication-boundary', 'comms-regression']) if (!task.requiredRules.includes(rule)) throw new Error(`Communication task ${task.id} lacks ${rule}`);
    }
    if (task.changeTags.includes('ui')) {
      for (const rule of ['ui-i18n-design-tokens', 'e2e-parallel-isolation']) if (!task.requiredRules.includes(rule)) throw new Error(`UI task ${task.id} lacks ${rule}`);
    }
  }
}

export function taskMarkdown(task, featureId) {
  const communication = task.changeTags.includes('comms');
  const profiles = ['fast', ...(communication ? ['comms'] : []), ...(task.changeTags.includes('ui') ? ['e2e'] : [])];
  return ['---', `id: ${task.id}`, `title: ${JSON.stringify(task.title)}`, `scenario: ${communication ? 'gateway-backend-communication' : 'autonomous-development'}`, `taskType: ${communication ? 'runtime-bridge' : 'development-tooling'}`, 'featureIds:', `  - ${featureId}`, `intent: ${JSON.stringify(task.intent)}`, 'touchedAreas:', ...task.writePaths.map((file) => `  - ${file}`), 'requiredProfiles:', ...profiles.map((profile) => `  - ${profile}`), 'expectedUserBehavior:', ...task.acceptance.map((entry) => `  - ${JSON.stringify(entry.description)}`), 'requiredRules:', ...task.requiredRules.map((rule) => `  - ${rule}`), 'requiredTests:', ...task.checks.map((entry) => `  - ${entry.test}`), 'acceptance:', ...task.acceptance.map((entry) => `  - ${JSON.stringify(entry.description)}`), 'docs:', '  required: true', '---', '', '## Frozen Acceptance', '', JSON.stringify(task.acceptance, null, 2), '', '## Requirement Sources', '', ...task.sources.map((source) => `- ${source}`), ''].join('\n');
}

export async function generatePlan({ repo, artifactRoot, featureId, goal, targetBranch = 'main', allowRisks = [], adapter, signal, timeoutMs }) {
  await assertClean(repo);
  const requirements = await requirementContext(repo, featureId);
  const baseSha = await git(repo, ['rev-parse', 'HEAD']);
  const store = new RunStore(artifactRoot, `plan-${randomUUID()}`);
  const manager = new WorkspaceManager(repo, store);
  const workspace = await manager.create('planning', baseSha);
  const planDir = path.join(store.dir, 'planning');
  await mkdir(planDir, { recursive: true });
  let plan;
  try {
    const response = await adapter.execute({
      workspace, artifactDir: planDir, schema: planSchema, readOnly: true, signal, timeoutMs,
      onSpawn: (child) => manager.registerProcess(workspace, child), onExit: (child) => manager.unregisterProcess(workspace, child),
      prompt: `Create a decision-complete bounded development task DAG for ${featureId}. Read code and relevant tests/specs in this repository before planning. Do not edit any files. Use EXACT writePaths (no globs), stable acceptance/check IDs, registered commands only (pnpm run lint:check/typecheck/build:vite/harness:ci/comms:replay/comms:compare/test:e2e or tests/unit/*.test.ts and tests/e2e/*.spec.ts paths). Each acceptance must map to real tests including negative paths. Mark UI/comms/external/docs tags. External checks need explicit dedicated sandbox env prerequisites. At most 8 tasks; exclude unfinished broader scope explicitly. Never silently claim complete feature delivery. Protected risk categories allowed: ${JSON.stringify(allowRisks)}. Other dependency/runtime/infrastructure/release changes are forbidden. Base SHA MUST be ${baseSha}; targetBranch MUST be ${targetBranch}. Goal: ${goal ?? requirements.defaultGoal}.\nRequirements:\n${JSON.stringify(requirements.context)}`,
    });
    plan = validatePlan(response.output, { featureIds: requirements.featureIds, allowRisks });
    if (plan.baseSha !== baseSha || plan.targetBranch !== targetBranch || plan.featureId !== featureId) throw new Error('Planner changed frozen input identity');
    await validateSources(repo, plan);
    await atomicJson(path.join(store.dir, 'plan.json'), plan);
    await atomicJson(path.join(store.dir, 'manifest.json'), { schemaVersion: 1, planHash: digest(plan), baseSha, allowRisks, sources: requirements.context.map((entry) => ({ file: entry.file, hash: digest(entry.content) })) });
    for (const task of plan.tasks) await writeFile(path.join(store.dir, `${task.id}.md`), taskMarkdown(task, featureId));
  } finally {
    const archive = await manager.archive(workspace, path.join(store.dir, 'archive'));
    await manager.cleanup(workspace, archive);
  }
  return { plan, planFile: path.join(store.dir, 'plan.json') };
}
