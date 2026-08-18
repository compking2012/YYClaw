/**
 * Integration: resume 个税计算器开发 workflow via live Gateway (port 18789).
 * Run: pnpm exec vitest run tests/integration/office-workflow-resume.integration.test.ts
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue(join(homedir(), 'Library', 'Application Support', 'YYClaw')),
    getVersion: vi.fn().mockReturnValue('0.0.0-test'),
    getName: vi.fn().mockReturnValue('YYClaw'),
    isPackaged: false,
    whenReady: vi.fn().mockResolvedValue(undefined),
  },
  utilityProcess: {},
}));

vi.mock('@electron/gateway/supervisor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@electron/gateway/supervisor')>();
  return {
    ...actual,
    findExistingGatewayProcess: vi.fn().mockResolvedValue({ port: 18789 }),
    runOpenClawDoctorRepair: vi.fn().mockResolvedValue(false),
  };
});

vi.mock('@electron/utils/store', () => ({
  getAllSettings: vi.fn().mockResolvedValue({
    gatewayPort: 18789,
    gatewayToken: 'clawx-dfe35f556a31e352211f6766e3aea7ca',
    gatewayAutoStart: true,
  }),
}));

const TASK_ID = process.env.OFFICE_TASK_ID ?? 'task-1779442564630-de77bj';

describe('office workflow resume (integration)', () => {
  it(
    'continues 个税计算器开发 until completed or failed',
    { timeout: 3_600_000 },
    async () => {
      const { GatewayManager } = await import('@electron/gateway/manager');
      const { listScenarios, listTasks } = await import('@electron/services/office/store');
      const { runTaskWorkflow } = await import('@electron/services/office/workflow-runner');

      const gateway = new GatewayManager();
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('Gateway not ready in 120s')), 120_000);
        gateway.on('status', (s: { gatewayReady?: boolean; state?: string }) => {
          if (s.gatewayReady && s.state === 'running') {
            clearTimeout(t);
            resolve();
          }
        });
        void gateway.start().catch(reject);
      });

      const tasks = await listTasks();
      const task = tasks.find((t) => t.id === TASK_ID);
      expect(task, `task ${TASK_ID}`).toBeDefined();
      const scenarios = await listScenarios();
      const scenario = scenarios.find((s) => s.id === task!.scenarioId);
      expect(scenario).toBeDefined();

      const final = await runTaskWorkflow(gateway, scenario!, task!, {
        mode: 'continue',
        onUpdate: (t) => {
          const summary = t.nodeRuns.map((n) => `${n.nodeId}:${n.status}`).join(' ');
          console.log(`[wf] task=${t.status} ${summary}`);
        },
      });

      console.log('[wf] final status', final.status);
      for (const nr of final.nodeRuns) {
        console.log(`  ${nr.nodeId} ${nr.status} ${nr.error?.slice(0, 80) ?? ''}`);
      }

      expect(['completed', 'failed']).toContain(final.status);
      if (final.status === 'failed') {
        const dataPath = join(homedir(), '.openclaw', 'office', 'data.json');
        const raw = await readFile(dataPath, 'utf8');
        console.log('[wf] data.json snapshot written to stderr for debug');
        console.error(raw.slice(0, 4000));
      }
      expect(final.status).toBe('completed');
    },
  );
});
