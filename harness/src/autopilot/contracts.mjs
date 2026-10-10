import { z } from 'zod';
import { createHash } from 'node:crypto';
import { requiredTestStep } from '../validation.mjs';

const identifier = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const relativeFile = z.string().min(1).refine((value) => !value.startsWith('/') && !/[\\:*?\[\]\0]/.test(value) && !value.split('/').includes('..') && !value.startsWith('.git'), 'Expected an exact repository-relative path');
const check = z.object({
  id: identifier,
  kind: z.enum(['unit', 'ui', 'quality', 'comms', 'external']),
  test: z.string().min(1),
  prerequisites: z.array(z.string().regex(/^[A-Z][A-Z0-9_]+$/)),
}).strict();
const criterion = z.object({ id: identifier, description: z.string().min(1), checks: z.array(identifier).min(1) }).strict();
export const taskSchema = z.object({
  id: identifier,
  title: z.string().min(1),
  intent: z.string().min(1),
  sources: z.array(z.string().min(1)).min(1),
  dependencies: z.array(identifier),
  writePaths: z.array(relativeFile).min(1),
  changeTags: z.array(z.enum(['ui', 'comms', 'performance', 'docs', 'external'])),
  requiredRules: z.array(identifier).min(1),
  checks: z.array(check).min(1),
  acceptance: z.array(criterion).min(1),
  exclusions: z.array(z.string()),
}).strict();
export const planSchema = z.object({
  schemaVersion: z.literal(1),
  featureId: z.string().regex(/^F\d{2,}$/),
  goal: z.string().min(1),
  baseSha: z.string().regex(/^[a-f0-9]{40,64}$/),
  targetBranch: z.string().regex(/^[\w/-]+$/).refine((value) => !value.includes('..')),
  tasks: z.array(taskSchema).min(1).max(8),
  exclusions: z.array(z.string()),
}).strict();
export const workerResultSchema = z.object({
  status: z.enum(['implemented', 'blocked']),
  summary: z.string(),
  blockers: z.array(z.string()),
}).strict();
export const reviewSchema = z.object({
  status: z.enum(['pass', 'fail', 'blocked']),
  acceptance: z.array(z.object({ id: identifier, status: z.enum(['pass', 'fail', 'blocked']), evidence: z.string().min(1) }).strict()),
  findings: z.array(z.string()),
}).strict();

export const DEFAULT_BUDGET = Object.freeze({ maxTasks: 8, concurrency: 2, maxRepairs: 3, durationMs: 6 * 60 * 60 * 1000, commandTimeoutMs: 20 * 60 * 1000 });
export const RISK_PATHS = Object.freeze({
  dependencies: ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'],
  runtime: ['patches/', 'resources/openclaw'],
  infrastructure: ['harness/', '.github/', 'scripts/', 'AGENTS.md', 'CLAUDE.md', 'eslint.config.', 'vitest.config.', 'playwright.config.', 'tsconfig'],
  release: ['electron-builder', 'build/'],
});

export function digest(value) {
  return createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
}

export function validatePlan(input, options = {}) {
  const plan = planSchema.parse(input);
  if (options.featureIds && !options.featureIds.includes(plan.featureId)) throw new Error(`Unknown feature ${plan.featureId}`);
  const taskIds = new Set(plan.tasks.map((task) => task.id));
  if (taskIds.size !== plan.tasks.length) throw new Error('Duplicate task IDs');
  for (const task of plan.tasks) {
    if (new Set(task.writePaths).size !== task.writePaths.length) throw new Error(`Duplicate write scope in ${task.id}`);
    for (const dependency of task.dependencies) if (!taskIds.has(dependency) || dependency === task.id) throw new Error(`Invalid dependency ${dependency}`);
    const ids = new Set(task.checks.map((entry) => entry.id));
    if (ids.size !== task.checks.length || new Set(task.acceptance.map((entry) => entry.id)).size !== task.acceptance.length) throw new Error(`Duplicate acceptance/check ID in ${task.id}`);
    for (const entry of task.checks) {
      requiredTestStep(entry.test);
      if (entry.prerequisites.some((name) => !name.startsWith('AUTOPILOT_SANDBOX_'))) throw new Error('Sandbox prerequisite names must use AUTOPILOT_SANDBOX_*');
    }
    if (!task.checks.some((entry) => ['unit', 'ui', 'external'].includes(entry.kind) && (entry.test.startsWith('tests/') || /^pnpm exec (vitest|playwright)/.test(entry.test)))) throw new Error(`Task ${task.id} needs a behavior test, not only quality commands`);
    for (const entry of task.acceptance) for (const checkId of entry.checks) if (!ids.has(checkId)) throw new Error(`Missing check ${checkId}`);
    for (const checkId of ids) if (!task.acceptance.some((entry) => entry.checks.includes(checkId))) throw new Error(`Unmapped check ${checkId}`);
    if (task.changeTags.includes('ui') && !task.checks.some((entry) => entry.kind === 'ui' && (entry.test.startsWith('tests/e2e/') || entry.test.startsWith('pnpm exec playwright test tests/e2e/')))) throw new Error(`UI task ${task.id} lacks UI acceptance`);
    if (task.changeTags.includes('external') && !task.checks.some((entry) => entry.kind === 'external' && entry.prerequisites.length)) throw new Error(`External task ${task.id} lacks real sandbox prerequisites`);
    for (const file of task.writePaths) {
      for (const [risk, paths] of Object.entries(RISK_PATHS)) if (paths.some((prefix) => file.startsWith(prefix)) && !options.allowRisks?.includes(risk)) throw new Error(`Protected ${risk} path: ${file}`);
      if (/(^|\/)(\.env|auth\.json|id_rsa|id_ed25519)(\.|$)/.test(file)) throw new Error(`Credential path is forbidden: ${file}`);
    }
  }
  topologicalTasks(plan);
  return plan;
}

export function topologicalTasks(plan) {
  const ordered = [];
  const visiting = new Set();
  const visited = new Set();
  const visit = (task) => {
    if (visiting.has(task.id)) throw new Error('Task dependency cycle');
    if (visited.has(task.id)) return;
    visiting.add(task.id);
    for (const dependency of task.dependencies) visit(plan.tasks.find((candidate) => candidate.id === dependency));
    visiting.delete(task.id);
    visited.add(task.id);
    ordered.push(task);
  };
  for (const task of plan.tasks) visit(task);
  return ordered;
}

export function scopesConflict(first, second) {
  return first.writePaths.some((file) => second.writePaths.some((other) => file === other || file.startsWith(`${other}/`) || other.startsWith(`${file}/`)));
}
