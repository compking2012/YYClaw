import { completeSetup, expect, test } from './fixtures/electron';

type AgentSummary = {
  id: string;
  name: string;
  isDefault?: boolean;
  skills?: string[];
  modelDisplay?: string;
  modelRef?: string;
  overrideModelRef?: string | null;
  inheritedModel?: boolean;
  workspace?: string;
  agentDir?: string;
  mainSessionKey?: string;
  channelTypes?: string[];
};

const initialAgents: AgentSummary[] = [
  { id: 'main', name: 'Main', skills: [] },
  { id: 'bot-a', name: 'Bot A', skills: ['skill-beta'] },
];

const localSkills = [
  {
    id: 'skill-alpha',
    name: 'Alpha Skill',
    description: 'Alpha description',
    baseDir: '/tmp/skills/skill-alpha',
    source: 'local',
    installed: true,
    isEnabled: true,
    isCore: false,
  },
  {
    id: 'skill-beta',
    name: 'Beta Skill',
    description: 'Beta description',
    baseDir: '/tmp/skills/skill-beta',
    source: 'local',
    installed: true,
    isEnabled: true,
    isCore: false,
  },
  {
    id: 'skill-gamma',
    name: 'Gamma Skill',
    description: 'Gamma description',
    baseDir: '/tmp/skills/skill-gamma',
    source: 'local',
    installed: true,
    isEnabled: true,
    isCore: false,
  },
  {
    id: 'skill-delta',
    name: 'Delta Skill',
    description: 'Delta description',
    baseDir: '/tmp/skills/skill-delta',
    source: 'local',
    installed: true,
    isEnabled: true,
    isCore: false,
  },
  {
    id: 'skill-epsilon',
    name: 'Epsilon Skill',
    description: 'Epsilon description',
    baseDir: '/tmp/skills/skill-epsilon',
    source: 'local',
    installed: true,
    isEnabled: true,
    isCore: false,
  },
  {
    id: 'skill-core',
    name: 'Core Skill',
    description: 'Core description',
    baseDir: '/tmp/skills/skill-core',
    source: 'local',
    installed: true,
    isEnabled: true,
    isCore: true,
  },
];

test.describe('Agents skill selection', () => {
  test('supports search, selected-first ordering, and per-agent updates', async ({ electronApp, page }) => {
    await electronApp.evaluate(({ ipcMain }, payload) => {
      const originalHostInvoke = (ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      })._invokeHandlers?.get('host:invoke');
      const respond = (id: unknown, data: unknown) => ({ id: typeof id === 'string' ? id : undefined, ok: true, data });
      const snapshot = (agents: AgentSummary[]) => ({
        success: true,
        agents,
        defaultAgentId: agents.find((agent) => agent.isDefault)?.id ?? '',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).__clawxE2eAgents = structuredClone(payload.agents);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).__clawxE2eLastSkillsUpdate = null;

      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event: unknown, request: { id?: string; module?: string; action?: string; payload?: Record<string, unknown> }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const currentAgents = ((globalThis as any).__clawxE2eAgents || []) as AgentSummary[];

        if (request?.module === 'agents' && request.action === 'list') {
          return respond(request.id, snapshot(currentAgents));
        }
        if (request?.module === 'agents' && request.action === 'create') {
          const body = request.payload as { id?: string; name?: string; skills?: string[] };
          const id = body.id || 'new-agent';
          const nextAgents = [
            ...currentAgents,
            { id, name: body.name || 'New Agent', skills: body.skills || [], isDefault: currentAgents.length === 0 },
          ];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (globalThis as any).__clawxE2eAgents = nextAgents;
          return respond(request.id, snapshot(nextAgents));
        }
        if (request?.module === 'agents' && request.action === 'update') {
          const body = request.payload as { id?: string; skills?: string[] };
          const nextAgents = currentAgents.map((agent) => (agent.id === body.id
            ? { ...agent, skills: body.skills || [] }
            : agent));
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (globalThis as any).__clawxE2eAgents = nextAgents;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (globalThis as any).__clawxE2eLastSkillsUpdate = body.skills || [];
          return respond(request.id, snapshot(nextAgents));
        }
        if (request?.module === 'agents' && request.action === 'delete') {
          const body = request.payload as { id?: string };
          const nextAgents = currentAgents.filter((agent) => agent.id !== body.id);
          if (currentAgents.find((agent) => agent.id === body.id)?.isDefault && nextAgents[0]) {
            nextAgents[0] = { ...nextAgents[0], isDefault: true };
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (globalThis as any).__clawxE2eAgents = nextAgents;
          return respond(request.id, snapshot(nextAgents));
        }
        if (request?.module === 'channels' && request.action === 'accounts') {
          return respond(request.id, { success: true, channels: [] });
        }
        if (request?.module === 'voice' && request.action === 'selections') {
          return respond(request.id, { success: true, selections: {} });
        }

        return originalHostInvoke?.(event, request) ?? respond(request?.id, { success: true });
      });

      ipcMain.removeHandler('hostapi:fetch');
      ipcMain.handle('hostapi:fetch', async (_event, request: { path?: string; method?: string; body?: string }) => {
        const method = request?.method ?? 'GET';
        const path = request?.path ?? '';

        if (path === '/api/skills/local' && method === 'GET') {
          return { ok: true, data: { status: 200, ok: true, json: { success: true, skills: payload.skills } } };
        }
        if (path === '/api/agents/slugify' && method === 'POST') {
          return { ok: true, data: { status: 200, ok: true, json: { success: true, id: 'new-agent' } } };
        }

        return { ok: true, data: { status: 200, ok: true, json: { success: true } } };
      });
    }, { agents: initialAgents, skills: localSkills });

    await completeSetup(page);
    await page.getByTestId('sidebar-nav-agents').click();
    await expect(page.getByTestId('agents-page')).toBeVisible();

    await page.getByTestId('agent-card-settings-bot-a').click();
    await expect(page.getByTestId('agent-settings-skills-other-search')).toBeVisible();
    await expect(page.getByTestId('agent-settings-skills-other-toggle-skill-core')).toBeVisible();

    const firstToggleBeforeFilter = page.locator('[data-testid^="agent-settings-skills-other-toggle-"]').first();
    await expect(firstToggleBeforeFilter).toHaveAttribute('data-testid', 'agent-settings-skills-other-toggle-skill-beta');

    const alphaToggle = page.getByTestId('agent-settings-skills-other-toggle-skill-alpha');
    const betaToggle = page.getByTestId('agent-settings-skills-other-toggle-skill-beta');
    await alphaToggle.click();
    await expect(alphaToggle).toHaveAttribute('data-state', 'checked');
    await expect(page.locator('[data-testid^="agent-settings-skills-other-toggle-"]').first()).toHaveAttribute(
      'data-testid',
      'agent-settings-skills-other-toggle-skill-beta',
    );

    await betaToggle.click();
    await expect(betaToggle).toHaveAttribute('data-state', 'unchecked');
    await expect(page.locator('[data-testid^="agent-settings-skills-other-toggle-"]').first()).toHaveAttribute(
      'data-testid',
      'agent-settings-skills-other-toggle-skill-beta',
    );

    await page.getByTestId('agent-settings-skills-other-search').fill('alpha');
    await expect(page.getByTestId('agent-settings-skills-other-toggle-skill-alpha')).toBeVisible();
    await expect(page.getByTestId('agent-settings-skills-other-toggle-skill-beta')).toHaveCount(0);
    await page.getByTestId('agent-settings-skills-other-bulk-enter').click();
    await page.getByTestId('agent-settings-skills-other-bulk-select-all').click();
    await page.getByTestId('agent-settings-skills-other-bulk-enable').click();

    await page.getByTestId('agent-settings-skills-other-search').fill('beta');
    await page.getByTestId('agent-settings-skills-other-bulk-enter').click();
    await page.getByTestId('agent-settings-skills-other-bulk-select-all').click();
    await page.getByTestId('agent-settings-skills-other-bulk-disable').click();
    await page.getByTestId('agent-settings-skills-other-search').fill('');
    await page.getByRole('button', { name: /save skills|保存技能/i }).click();

    const saved = await electronApp.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (globalThis as any).__clawxE2eLastSkillsUpdate as string[] | null;
    });
    expect(saved).toEqual(['skill-alpha']);
  });

  test('allows deleting the last agent and creating a new first default agent', async ({ electronApp, page }) => {
    await electronApp.evaluate(({ ipcMain }) => {
      const originalHostInvoke = (ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      })._invokeHandlers?.get('host:invoke');
      const respond = (id: unknown, data: unknown) => ({ id: typeof id === 'string' ? id : undefined, ok: true, data });
      const snapshot = (agents: AgentSummary[]) => ({
        success: true,
        agents,
        defaultAgentId: agents.find((agent) => agent.isDefault)?.id ?? '',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).__clawxE2eAgents = [{ id: 'main', name: 'Main', isDefault: true, skills: [] }];

      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event: unknown, request: { id?: string; module?: string; action?: string; payload?: Record<string, unknown> }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const currentAgents = ((globalThis as any).__clawxE2eAgents || []) as AgentSummary[];

        if (request?.module === 'agents' && request.action === 'list') {
          return respond(request.id, snapshot(currentAgents));
        }
        if (request?.module === 'agents' && request.action === 'delete') {
          const body = request.payload as { id?: string };
          const nextAgents = currentAgents.filter((agent) => agent.id !== body.id);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (globalThis as any).__clawxE2eAgents = nextAgents;
          return respond(request.id, snapshot(nextAgents));
        }
        if (request?.module === 'agents' && request.action === 'create') {
          const body = request.payload as { id?: string; name?: string; skills?: string[] };
          const nextAgents = [
            ...currentAgents,
            { id: body.id || 'new-agent', name: body.name || 'New Agent', isDefault: currentAgents.length === 0, skills: body.skills || [] },
          ];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (globalThis as any).__clawxE2eAgents = nextAgents;
          return respond(request.id, snapshot(nextAgents));
        }
        if (request?.module === 'channels' && request.action === 'accounts') {
          return respond(request.id, { success: true, channels: [] });
        }
        if (request?.module === 'voice' && request.action === 'selections') {
          return respond(request.id, { success: true, selections: {} });
        }

        return originalHostInvoke?.(event, request) ?? respond(request?.id, { success: true });
      });

      ipcMain.removeHandler('hostapi:fetch');
      ipcMain.handle('hostapi:fetch', async (_event, request: { path?: string; method?: string }) => {
        const method = request?.method ?? 'GET';
        const path = request?.path ?? '';
        if (path === '/api/skills/local' && method === 'GET') {
          return { ok: true, data: { status: 200, ok: true, json: { success: true, skills: [] } } };
        }
        if (path === '/api/agents/slugify' && method === 'POST') {
          return { ok: true, data: { status: 200, ok: true, json: { success: true, id: 'new-agent' } } };
        }
        return { ok: true, data: { status: 200, ok: true, json: { success: true } } };
      });
    });

    await completeSetup(page);
    await page.getByTestId('sidebar-nav-agents').click();
    await expect(page.getByText('Main')).toBeVisible();

    await page.getByTestId('agent-card-delete-main').click();
    await page.getByRole('button', { name: /delete|删除|削除|удалить/i }).last().click();
    await expect(page.getByTestId('agents-empty-state')).toBeVisible();

    await page.getByTestId('agents-empty-add-button').click();
    await page.locator('#agent-name').fill('New Agent');
    await page.getByTestId('agent-create-save').click();

    await expect(page.getByText('New Agent')).toBeVisible();
    await expect(page.getByText(/default|默认|по умолчанию/i)).toBeVisible();
  });

  test('enables model save after selecting a different agent override', async ({ electronApp, page }) => {
    await electronApp.evaluate(({ ipcMain }) => {
      const originalHostInvoke = (ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      })._invokeHandlers?.get('host:invoke');
      const respond = (id: unknown, data: unknown) => ({ id: typeof id === 'string' ? id : undefined, ok: true, data });
      const agent = {
        id: 'main',
        name: 'Main',
        isDefault: true,
        skills: [],
        modelDisplay: 'claude-opus-4.6',
        modelRef: 'openrouter/anthropic/claude-opus-4.6',
        overrideModelRef: 'openrouter/anthropic/claude-opus-4.6',
        inheritedModel: false,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:desk',
        channelTypes: [],
      };
      const snapshot = () => ({
        success: true,
        agents: [agent],
        defaultAgentId: 'main',
        defaultModelRef: 'openrouter/anthropic/claude-opus-4.6',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).__clawxE2eLastModelUpdate = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).__clawxE2eModelUpdates = [];

      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event: unknown, request: { id?: string; module?: string; action?: string; payload?: Record<string, unknown> }) => {
        if (request.module === 'agents' && request.action === 'list') {
          return respond(request.id, snapshot());
        }
        if (request.module === 'agents' && request.action === 'updateModel') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (globalThis as any).__clawxE2eLastModelUpdate = request.payload;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (globalThis as any).__clawxE2eModelUpdates.push(request.payload);
          agent.overrideModelRef = request.payload?.modelRef as string;
          agent.modelRef = agent.overrideModelRef;
          return respond(request.id, snapshot());
        }
        if (request.module === 'providers' && request.action === 'accounts') {
          return respond(request.id, [{
            id: 'openrouter-default',
            vendorId: 'openrouter',
            label: 'OpenRouter',
            authMode: 'api_key',
            model: 'openrouter/anthropic/claude-opus-4.6',
            enabled: true,
            isDefault: true,
            createdAt: '2026-07-15T00:00:00.000Z',
            updatedAt: '2026-07-15T00:00:00.000Z',
          }]);
        }
        if (request.module === 'providers' && request.action === 'accountKeyInfo') {
          return respond(request.id, [{ accountId: 'openrouter-default', hasKey: true, keyMasked: 'sk-***' }]);
        }
        if (request.module === 'providers' && request.action === 'vendors') {
          return respond(request.id, [{
            id: 'openrouter',
            name: 'OpenRouter',
            modelType: ['text'],
            modelIdPlaceholder: ['anthropic/claude-opus-4.6', 'openai/gpt-5'],
          }]);
        }
        if (request.module === 'providers' && request.action === 'getDefaultAccount') {
          return respond(request.id, { accountId: 'openrouter-default' });
        }
        if (request.module === 'channels' && request.action === 'accounts') {
          return respond(request.id, { success: true, channels: [] });
        }
        if (request.module === 'voice' && request.action === 'selections') {
          return respond(request.id, { success: true, selections: {} });
        }
        if (request.module === 'usage' && request.action === 'recentTokenHistory') {
          return respond(request.id, []);
        }
        return originalHostInvoke?.(event, request) ?? respond(request.id, { success: true });
      });

      ipcMain.removeHandler('hostapi:fetch');
      ipcMain.handle('hostapi:fetch', async (_event, request: { path?: string; method?: string }) => {
        if (request.path === '/api/skills/local' && (request.method ?? 'GET') === 'GET') {
          return { ok: true, data: { status: 200, ok: true, json: { success: true, skills: [] } } };
        }
        return { ok: true, data: { status: 200, ok: true, json: { success: true } } };
      });
    });

    await completeSetup(page);
    await page.getByTestId('sidebar-nav-agents').click();
    await page.getByTestId('agent-card-settings-main').click();
    await page.getByTestId('agent-settings-model').click();

    const saveButton = page.getByTestId('agent-model-save');
    await expect(saveButton).toBeDisabled();

    await page.locator('#agent-model-id').fill('openai/gpt-5');
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    const saveAllButton = page.getByTestId('agent-settings-save-all');
    await expect(saveAllButton).toBeEnabled();
    await saveAllButton.click();

    const saved = await electronApp.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (globalThis as any).__clawxE2eLastModelUpdate as Record<string, unknown> | null;
    });
    expect(saved).toMatchObject({
      id: 'main',
      modelRef: 'openrouter/openai/gpt-5',
      targetSlot: 'model',
    });

    await page.getByTestId('sidebar-new-chat').click();
    await expect(page.getByTestId('chat-composer-input')).toBeVisible();
    await page.waitForTimeout(500);

    const updatesAfterOpeningChat = await electronApp.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (globalThis as any).__clawxE2eModelUpdates as Array<Record<string, unknown>>;
    });
    expect(updatesAfterOpeningChat).toHaveLength(1);
    expect(updatesAfterOpeningChat[0]).toMatchObject({
      id: 'main',
      modelRef: 'openrouter/openai/gpt-5',
      targetSlot: 'model',
    });
  });
});
