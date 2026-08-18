/**
 * Observed workflow restart resilience: a previously-aborted Travel Planner
 * card stuck at `running` in localStorage must heal to failed on session load,
 * must not be resurrected by historical ACP Read+plan replay, and must show
 * the persisted k/N progress (not 0/N forever).
 */
import type { ElectronApplication, Page } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const MAIN_SESSION_KEY = 'agent:main:main';
const MAIN_WORKSPACE = '/workspace';
const DEFAULT_WORKSPACE = '~/.openclaw/workspace';
const TRAVEL_SKILL_PATH = '/Users/me/.openclaw/skills/travel-planner/SKILL.md';
const USER_MESSAGE_ID = 'travel-user';
const USER_SEGMENT_ID = `${USER_MESSAGE_ID}:0`;
const OBSERVED_RUN_ID = 'obs-e2e-travel-stale';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const travelTodos = [
  { content: '首先：理解需求', status: 'completed' },
  { content: '其次：制定计划', status: 'completed' },
  { content: '然后：执行搜索与收集证据', status: 'in_progress' },
  { content: '接着：整理行程', status: 'pending' },
  { content: '再者：预算与风险', status: 'pending' },
  { content: '最后：交付总结', status: 'pending' },
];

const travelSteps = travelTodos.map((todo, index) => ({
  id: `todo-${index}`,
  title: todo.content,
  kind: 'agent' as const,
}));

function historicalSessionUpdates() {
  return [
    {
      sessionUpdate: 'user_message_chunk',
      messageId: USER_MESSAGE_ID,
      content: { type: 'text', text: '杭州到西藏七日游' },
    },
    {
      sessionUpdate: 'tool_call',
      toolCallId: 'read-travel-skill',
      title: `Read: ${TRAVEL_SKILL_PATH}`,
      kind: 'read',
      status: 'completed',
      rawInput: { path: TRAVEL_SKILL_PATH },
    },
    {
      sessionUpdate: 'tool_call',
      toolCallId: 'plan-travel',
      title: 'update_plan',
      status: 'completed',
      rawInput: { todos: travelTodos },
    },
  ];
}

function loadAcpResult() {
  return {
    success: true,
    generation: 1,
    sessionUpdates: historicalSessionUpdates().map((update) => ({
      sessionKey: MAIN_SESSION_KEY,
      generation: 1,
      historical: true,
      notification: {
        sessionId: MAIN_SESSION_KEY,
        update,
      },
    })),
  };
}

function baseHostApi() {
  const load = loadAcpResult();
  return {
    [stableStringify(['chat', 'loadAcpSession', { sessionKey: MAIN_SESSION_KEY, workspaceRoot: MAIN_WORKSPACE, cwd: MAIN_WORKSPACE }])]: load,
    [stableStringify(['chat', 'loadAcpSession', { sessionKey: MAIN_SESSION_KEY, workspaceRoot: MAIN_WORKSPACE, cwd: MAIN_WORKSPACE, createIfMissing: true }])]: load,
    [stableStringify(['chat', 'loadAcpSession', { sessionKey: MAIN_SESSION_KEY, workspaceRoot: DEFAULT_WORKSPACE, cwd: DEFAULT_WORKSPACE }])]: load,
    [stableStringify(['chat', 'loadAcpSession', { sessionKey: MAIN_SESSION_KEY, workspaceRoot: DEFAULT_WORKSPACE, cwd: DEFAULT_WORKSPACE, createIfMissing: true }])]: load,
    [stableStringify(['chat', 'loadAcpSession', { sessionKey: MAIN_SESSION_KEY, workspaceRoot: '/', cwd: '/' }])]: load,
    [stableStringify(['chat', 'loadAcpSession', { sessionKey: MAIN_SESSION_KEY, workspaceRoot: '/', cwd: '/', createIfMissing: true }])]: load,
    [stableStringify(['/api/gateway/status', 'GET'])]: {
      ok: true,
      data: { status: 200, ok: true, json: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 } },
    },
    [stableStringify(['/api/chat/sessions', 'GET'])]: {
      ok: true,
      data: {
        status: 200,
        ok: true,
        json: {
          success: true,
          result: {
            sessions: [{ key: MAIN_SESSION_KEY, displayName: 'main', workspacePath: MAIN_WORKSPACE }],
          },
        },
      },
    },
    [stableStringify(['/api/agents', 'GET'])]: {
      ok: true,
      data: {
        status: 200,
        ok: true,
        json: {
          success: true,
          agents: [{
            id: 'main',
            name: 'main',
            workspace: MAIN_WORKSPACE,
            mainSessionKey: MAIN_SESSION_KEY,
          }],
        },
      },
    },
    [stableStringify(['/api/settings', 'GET'])]: {
      ok: true,
      data: {
        status: 200,
        ok: true,
        json: {
          language: 'en',
          setupComplete: true,
          autoWorkflowEnabled: true,
        },
      },
    },
    [stableStringify(['/api/skills/quick-access', 'POST'])]: {
      ok: true,
      data: {
        status: 200,
        ok: true,
        json: {
          success: true,
          skills: [{
            name: 'travel-planner',
            description: 'Plan trips',
            workflow: true,
            workflowTitle: 'Travel Planner',
            manifestPath: TRAVEL_SKILL_PATH,
            workflowSteps: travelTodos.map((todo) => ({ title: todo.content })),
          }],
        },
      },
    },
  };
}

async function openChat(app: ElectronApplication): Promise<Page> {
  const page = await getStableWindow(app);
  try {
    await page.reload();
  } catch (error) {
    if (!String(error).includes('ERR_FILE_NOT_FOUND')) throw error;
  }
  await expect(page.getByTestId('main-layout')).toBeVisible();
  return page;
}

async function seedStaleObservedCard(page: Page): Promise<void> {
  await page.evaluate((payload) => {
    localStorage.setItem('clawx:workflow-cards', JSON.stringify({
      [payload.sessionKey]: [{
        runId: payload.runId,
        messageId: `wf-card-${payload.runId}`,
        userMessageId: payload.userSegmentId,
        userText: '杭州到西藏七日游',
        title: 'Travel Planner',
        steps: payload.steps,
        status: 'running',
        createdAt: 1_710_000_000_000,
        source: 'observed',
        skillName: 'travel-planner',
      }],
    }));
  }, {
    sessionKey: MAIN_SESSION_KEY,
    runId: OBSERVED_RUN_ID,
    userSegmentId: USER_SEGMENT_ID,
    steps: travelSteps,
  });
}

test.describe('Observed workflow restart heal', () => {
  test('heals a stale running Travel Planner card and does not resurrect from historical plan', async ({
    launchElectronApp,
  }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [{ key: MAIN_SESSION_KEY, displayName: 'main', workspacePath: MAIN_WORKSPACE }],
            },
          },
        },
        hostApi: baseHostApi(),
      });

      // Seed before first renderer bootstrap so `loadWorkflowCards()` picks it up.
      const boot = await getStableWindow(app);
      await boot.addInitScript((payload) => {
        localStorage.setItem('clawx:workflow-cards', JSON.stringify({
          [payload.sessionKey]: [{
            runId: payload.runId,
            messageId: `wf-card-${payload.runId}`,
            userMessageId: payload.userSegmentId,
            userText: '杭州到西藏七日游',
            title: 'Travel Planner',
            steps: payload.steps,
            status: 'running',
            createdAt: 1_710_000_000_000,
            source: 'observed',
            skillName: 'travel-planner',
          }],
        }));
      }, {
        sessionKey: MAIN_SESSION_KEY,
        runId: OBSERVED_RUN_ID,
        userSegmentId: USER_SEGMENT_ID,
        steps: travelSteps,
      });

      const page = await openChat(app);
      // Belt-and-suspenders: some Electron profiles apply init scripts late.
      await seedStaleObservedCard(page);
      await page.reload();
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await expect
        .poll(async () =>
          page.evaluate((sessionKey) => {
            const raw = window.localStorage.getItem('clawx:workflow-cards') ?? '{}';
            const cards = (JSON.parse(raw) as Record<string, unknown[]>)[sessionKey] ?? [];
            return cards.length;
          }, MAIN_SESSION_KEY),
        )
        .toBeGreaterThan(0);

      const card = page.getByTestId('workflow-inline-card');
      await expect(card).toBeVisible({ timeout: 30_000 });
      await expect(card).toContainText('Travel Planner');
      await expect(card).toHaveAttribute('data-status', 'failed');
      await expect(card).toContainText('2/6');
      await expect(page.getByTestId('workflow-inline-card')).toHaveCount(1);

      await expect
        .poll(async () =>
          page.evaluate((sessionKey) => {
            const raw = window.localStorage.getItem('clawx:workflow-cards') ?? '{}';
            const cards = (JSON.parse(raw) as Record<string, Array<{
              runId: string;
              status: string;
              stepProgress?: Array<{ status: string }>;
            }>>)[sessionKey] ?? [];
            return {
              count: cards.length,
              status: cards[0]?.status ?? null,
              runId: cards[0]?.runId ?? null,
              completed: cards[0]?.stepProgress?.filter((s) => s.status === 'completed').length ?? 0,
            };
          }, MAIN_SESSION_KEY),
        )
        .toEqual({
          count: 1,
          status: 'failed',
          runId: OBSERVED_RUN_ID,
          completed: 2,
        });
    } finally {
      await closeElectronApp(app);
    }
  });
});
