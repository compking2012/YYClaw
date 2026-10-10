import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../specs.mjs';
import { CodexAdapter, GitHubPublisher } from './adapters.mjs';
import { AutopilotEngine } from './engine.mjs';
import { generatePlan } from './planner.mjs';
import { RunStore } from './store.mjs';
import { validatePlan } from './contracts.mjs';
import { validateSources } from './planner.mjs';

export async function autopilotCommand(args) {
  const command = args._[1];
  const artifactRoot = path.join(ROOT, 'artifacts', 'autopilot');
  const adapter = new CodexAdapter({ model: args.model });
  const publisher = new GitHubPublisher(ROOT);
  const allowRisks = String(args['allow-risk'] ?? '').split(',').filter(Boolean);
  if (allowRisks.some((risk) => !['dependencies', 'runtime', 'infrastructure', 'release'].includes(risk))) throw new Error('Unknown risk authorization');
  const externalNames = String(args['sandbox-env'] ?? '').split(',').filter(Boolean);
  if (externalNames.some((name) => !/^AUTOPILOT_SANDBOX_[A-Z0-9_]+$/.test(name))) throw new Error('Only explicitly named AUTOPILOT_SANDBOX_* variables may enter external acceptance');
  const engine = new AutopilotEngine({ repo: ROOT, artifactRoot, adapter, publisher, allowRisks,
    externalEnv: Object.fromEntries(externalNames.filter((name) => process.env[name]).map((name) => [name, process.env[name]])), budget: {
    ...(args.concurrency ? { concurrency: Number(args.concurrency) } : {}),
    ...(args['max-repairs'] ? { maxRepairs: Number(args['max-repairs']) } : {}),
    ...(args['max-hours'] ? { durationMs: Number(args['max-hours']) * 3600000 } : {}),
  } });
  if (['status', 'cancel', 'resume'].includes(command)) {
    if (!args.run) throw new Error('--run <run-id> is required');
    const store = new RunStore(artifactRoot, args.run);
    if (command === 'cancel') {
      await store.read();
      await writeFile(path.join(store.dir, 'cancel'), new Date().toISOString());
      console.log(`Cancellation requested: ${args.run}`);
      return 0;
    }
    const record = command === 'resume' ? await engine.resume(args.run) : await store.read();
    console.log(JSON.stringify({ runId: record.runId, status: record.status, error: record.error, tasks: record.tasks }, null, 2));
    return command === 'status' || record.status === 'complete' ? 0 : 1;
  }
  if (!['plan', 'run'].includes(command)) throw new Error('Usage: pnpm harness autopilot plan|run|status|resume|cancel --feature Fxx --goal <goal> | --plan <file> | --run <run-id>');
  let plan;
  if (args.plan) {
    plan = validatePlan(JSON.parse(await readFile(path.resolve(ROOT, args.plan), 'utf8')), { allowRisks });
    await validateSources(ROOT, plan);
    if (command === 'plan') {
      console.log(`Plan is valid: ${path.resolve(ROOT, args.plan)}`);
      return 0;
    }
  }
  else {
    if (!args.feature) throw new Error('--feature <feature-id> or --plan <file> is required');
    await adapter.preflight();
    const generated = await generatePlan({ repo: ROOT, artifactRoot, featureId: args.feature, goal: args.goal, targetBranch: args.target ?? 'main', allowRisks, adapter, timeoutMs: 20 * 60 * 1000 });
    plan = generated.plan;
    console.log(`Frozen plan: ${generated.planFile}`);
    if (command === 'plan') return 0;
  }
  const record = await engine.start(plan);
  console.log(`Run: ${record.runId}; result: ${record.status}; evidence: ${path.join(artifactRoot, record.runId)}`);
  if (record.error) console.error(record.error);
  return record.status === 'complete' ? 0 : 1;
}
