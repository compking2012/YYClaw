import type { ElectronApplication } from '@playwright/test';
import { completeSetup, expect, test } from './fixtures/electron';

type AgentSeed = { id: string; name: string; isDefault?: boolean };

const initialAgents: AgentSeed[] = [{ id: 'main', name: 'Main', isDefault: true }];

type SessionSeed = {
  key: string;
  lastChannel?: string;
  lastMessagePreview?: string;
  updatedAt?: number;
};

// Seed a feishu channel group so channel-row-feishu renders in the channels tab.
const seededChannelGroups = [
  {
    channelType: 'feishu',
    defaultAccountId: 'default',
    status: { state: 'disconnected' },
    accounts: [{ accountId: 'default', name: 'Feishu Acct' }],
  },
];

// Seed an openai provider account so provider-card-acct-openai renders in the models
// tab and resolveRuntimeProviderKey(account) === 'openai' matches defaultModelRef
// 'openai/gpt-4o'. Mocks the 4 endpoints fetchProviderSnapshot calls in parallel.
const seededProviderAccounts = [
  {
    id: 'acct-openai',
    vendorId: 'openai',
    label: 'OpenAI',
    authMode: 'apikey',
    enabled: true,
    isDefault: true,
    createdAt: '',
    updatedAt: '',
    model: ['gpt-4o'],
  },
];

// Install host:invoke + hostapi:fetch mocks returning a deterministic agents
// snapshot (with a default text model so a model badge renders), a seeded sidebar
// session list, a feishu channel group, and an openai provider account. Mirrors
// agents-skill-selection.spec.ts.
async function installTagNavMocks(
  app: ElectronApplication,
  sessions: SessionSeed[],
): Promise<void> {
  await app.evaluate(({ ipcMain }, payload) => {
    const originalHostInvoke = (ipcMain as unknown as {
      _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
    })._invokeHandlers?.get('host:invoke');
    const respond = (id: unknown, data: unknown) => ({
      id: typeof id === 'string' ? id : undefined,
      ok: true,
      data,
    });
    const snapshot = (agents: AgentSeed[]) => ({
      success: true,
      agents,
      defaultAgentId: agents.find((agent) => agent.isDefault)?.id ?? agents[0]?.id ?? '',
      defaultModelRef: 'openai/gpt-4o',
      configuredChannelTypes: [],
      channelOwners: {},
      channelAccountOwners: {},
    });

    ipcMain.removeHandler('host:invoke');
    ipcMain.handle(
      'host:invoke',
      async (event: unknown, request: { id?: string; module?: string; action?: string; payload?: Record<string, unknown> }) => {
        if (request?.module === 'agents' && request.action === 'list') {
          return respond(request.id, snapshot(payload.agents));
        }
        if (request?.module === 'channels' && request.action === 'accounts') {
          return respond(request.id, { success: true, channels: payload.channels });
        }
        if (request?.module === 'voice' && request.action === 'selections') {
          return respond(request.id, { success: true, selections: {} });
        }
        if (request?.module === 'providers') {
          if (request.action === 'accounts') return respond(request.id, payload.providers);
          if (request.action === 'accountKeyInfo') return respond(request.id, []);
          if (request.action === 'vendors') return respond(request.id, []);
          if (request.action === 'getDefaultAccount') return respond(request.id, { accountId: 'acct-openai' });
        }
        if (request?.module === 'gateway' && request.action === 'rpc') {
          const method = typeof request.payload?.method === 'string' ? request.payload.method : '';
          if (method === 'sessions.list') {
            return respond(request.id, { sessions: payload.sessions });
          }
          return respond(request.id, { sessions: [] });
        }
        return originalHostInvoke?.(event, request) ?? respond(request?.id, { success: true });
      },
    );

    ipcMain.removeHandler('hostapi:fetch');
    ipcMain.handle('hostapi:fetch', async () => ({
      ok: true,
      data: { status: 200, ok: true, json: { success: true } },
    }));
  }, { agents: initialAgents, sessions, channels: seededChannelGroups, providers: seededProviderAccounts });
}

test.describe('Tag hover+click navigation with focus', () => {
  test('sidebar agent tag navigates to the agents page and highlights the card', async ({ electronApp, page }) => {
    const sessions: SessionSeed[] = [
      { key: 'agent:main:main', lastChannel: 'webchat', updatedAt: Date.now(), lastMessagePreview: 'hi' },
    ];
    await installTagNavMocks(electronApp, sessions);
    await completeSetup(page);

    const agentTag = page.getByTestId(/^sidebar-session-agent-tag-/).first();
    await expect(agentTag).toBeVisible({ timeout: 10_000 });
    await agentTag.click();

    await expect(page.getByTestId('agents-page')).toBeVisible();
    const agentCard = page.getByTestId('agent-card-main');
    await expect(agentCard).toBeVisible();
    await expect(agentCard).toBeInViewport();
    await expect(agentCard).toHaveAttribute('data-highlighted', 'true');
  });

  test('sidebar agent tag focuses + scrolls to the card on keyboard Enter', async ({ electronApp, page }) => {
    const sessions: SessionSeed[] = [
      { key: 'agent:main:main', lastChannel: 'webchat', updatedAt: Date.now(), lastMessagePreview: 'hi' },
    ];
    await installTagNavMocks(electronApp, sessions);
    await completeSetup(page);

    const agentTag = page.getByTestId(/^sidebar-session-agent-tag-/).first();
    await expect(agentTag).toBeVisible({ timeout: 10_000 });
    await agentTag.press('Enter');

    await expect(page.getByTestId('agents-page')).toBeVisible();
    const agentCard = page.getByTestId('agent-card-main');
    await expect(agentCard).toBeVisible();
    await expect(agentCard).toBeInViewport();
    await expect(agentCard).toHaveAttribute('data-highlighted', 'true');
  });

  test('sidebar session row click opens chat without focusing the agent card', async ({ electronApp, page }) => {
    const sessions: SessionSeed[] = [
      { key: 'agent:main:main', lastChannel: 'webchat', updatedAt: Date.now(), lastMessagePreview: 'hi' },
    ];
    await installTagNavMocks(electronApp, sessions);
    await completeSetup(page);

    await page.getByTestId('sidebar-nav-agents').click();
    await expect(page.getByTestId('agents-page')).toBeVisible();

    const sessionRow = page.getByTestId('sidebar-session-agent:main:main');
    await expect(sessionRow).toBeVisible({ timeout: 10_000 });
    // Click the session title area (right side), not the agent tag pill on the left.
    await sessionRow.click({ position: { x: 180, y: 10 } });

    await expect(page.getByTestId('agents-page')).not.toBeVisible();
    const agentCard = page.getByTestId('agent-card-main');
    await page.getByTestId('sidebar-nav-agents').click();
    await expect(page.getByTestId('agents-page')).toBeVisible();
    await expect(agentCard).toBeVisible();
    await expect(agentCard).not.toHaveAttribute('data-highlighted', 'true');
  });

  test('sidebar main session shows the agent name, not the raw session key', async ({ electronApp, page }) => {
    const sessions: SessionSeed[] = [
      { key: 'agent:main:main', lastChannel: 'webchat', updatedAt: Date.now(), lastMessagePreview: 'hi' },
    ];
    await installTagNavMocks(electronApp, sessions);
    await completeSetup(page);

    const sessionRow = page.getByTestId('sidebar-session-agent:main:main');
    await expect(sessionRow).toBeVisible({ timeout: 10_000 });
    // The title falls back to the agent name ("Main") for :main sessions instead
    // of the raw self-injected placeholder key "agent:main:main".
    await expect(sessionRow).toContainText('Main');
    await expect(sessionRow).not.toContainText('agent:main:main');
  });

  test('sidebar channel tag opens settings on the channels tab and highlights the channel', async ({ electronApp, page }) => {
    const sessions: SessionSeed[] = [
      { key: 'agent:main:feishu:acct1', lastChannel: 'feishu', updatedAt: Date.now(), lastMessagePreview: 'hello' },
    ];
    await installTagNavMocks(electronApp, sessions);
    await completeSetup(page);

    const channelTag = page.getByTestId(/^sidebar-session-channel-tag-/).first();
    await expect(channelTag).toBeVisible({ timeout: 10_000 });
    await channelTag.click();

    await expect(page.getByTestId('channels-tab')).toBeVisible();
    const channelRow = page.getByTestId('channel-row-feishu');
    await expect(channelRow).toBeVisible();
    await expect(channelRow).toBeInViewport();
    await expect(channelRow).toHaveAttribute('data-highlighted', 'true');
  });

  test('agents page model tag opens settings on the models tab and highlights the provider card', async ({ electronApp, page }) => {
    await installTagNavMocks(electronApp, []);
    await completeSetup(page);

    await page.getByTestId('sidebar-nav-agents').click();
    await expect(page.getByTestId('agents-page')).toBeVisible();

    const modelTag = page.getByTestId(/^agent-card-model-tag-/).first();
    await expect(modelTag).toBeVisible();
    await modelTag.click();

    await expect(page.getByTestId('models-tab')).toBeVisible();
    const providerCard = page.getByTestId('provider-card-acct-openai');
    await expect(providerCard).toBeVisible();
    await expect(providerCard).toBeInViewport();
    await expect(providerCard).toHaveAttribute('data-highlighted', 'true');
  });
});
