/**
 * Resume a workflow office task from ~/.openclaw/office/data.json (continue mode).
 * 仅修改 Office 协作数据（data.json），不修改 openclaw.json / Agent / Provider 等 YYClaw 全局配置。
 * Requires Gateway already running (e.g. pnpm dev) on port 18789.
 *
 * Usage: pnpm exec tsx scripts/office-resume-workflow.mts [taskId]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const TASK_ID = process.argv[2] ?? 'task-1779442564630-de77bj';
const DATA_PATH = join(homedir(), '.openclaw', 'office', 'data.json');

async function prepareTaskForContinue(): Promise<void> {
  const raw = await readFile(DATA_PATH, 'utf8');
  const store = JSON.parse(raw) as {
    tasks: Array<{
      id: string;
      title?: string;
      status: string;
      nodeRuns: Array<{ nodeId: string; status: string; error?: string }>;
      workflowUserIntervention?: unknown;
    }>;
  };
  const task = store.tasks.find((t) => t.id === TASK_ID);
  if (!task) throw new Error(`Task not found: ${TASK_ID}`);

  for (const nr of task.nodeRuns) {
    if (nr.status === 'failed' || nr.status === 'running') {
      nr.status = 'pending';
      delete nr.error;
    }
  }
  task.workflowUserIntervention = undefined;
  task.status = 'pending';
  await writeFile(DATA_PATH, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  console.log(`[office-resume] Reset failed/running nodes to pending for ${task.title ?? TASK_ID}`);
}

async function main(): Promise<void> {
  await prepareTaskForContinue();

  const { app } = await import('electron');
  await app.whenReady();

  const { GatewayManager } = await import('../electron/gateway/manager.js');
  const { listScenarios, listTasks } = await import('../electron/services/office/store.js');
  const { runTaskWorkflow } = await import('../electron/services/office/workflow-runner.js');

  const gateway = new GatewayManager();
  const waitReady = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Gateway not ready within 120s')), 120_000);
    gateway.on('status', (s: { gatewayReady?: boolean; state?: string }) => {
      if (s.gatewayReady && s.state === 'running') {
        clearTimeout(timeout);
        resolve();
      }
    });
  });

  console.log('[office-resume] Connecting to Gateway...');
  await gateway.start();
  await waitReady;

  const tasks = await listTasks();
  const task = tasks.find((t) => t.id === TASK_ID);
  if (!task) throw new Error(`Task not in store after prepare: ${TASK_ID}`);
  const scenarios = await listScenarios();
  const scenario = scenarios.find((s) => s.id === task.scenarioId);
  if (!scenario) throw new Error(`Scenario not found: ${task.scenarioId}`);

  console.log(`[office-resume] Running workflow continue for "${task.title}"...`);
  const final = await runTaskWorkflow(gateway, scenario, task, {
    mode: 'continue',
    onUpdate: (t) => {
      const running = t.nodeRuns.filter((n) => n.status === 'running').map((n) => n.nodeId);
      const pending = t.nodeRuns.filter((n) => n.status === 'pending').length;
      console.log(`[office-resume] status=${t.status} running=${running.join(',') || '-'} pending=${pending}`);
    },
  });

  console.log(`[office-resume] Done: status=${final.status}`);
  for (const nr of final.nodeRuns) {
    console.log(`  ${nr.nodeId}: ${nr.status}${nr.error ? ` (${nr.error.slice(0, 60)})` : ''}`);
  }
  process.exit(final.status === 'completed' ? 0 : 1);
}

main().catch((err) => {
  console.error('[office-resume] Fatal:', err);
  process.exit(1);
});
