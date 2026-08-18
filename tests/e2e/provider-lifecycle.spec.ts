import { completeSetup, expect, test } from './fixtures/electron';

const TEST_PROVIDER_ID = 'moonshot-e2e';
const TEST_PROVIDER_LABEL = 'Moonshot E2E';

async function seedTestProvider(page: Parameters<typeof completeSetup>[0]): Promise<void> {
  await page.evaluate(async ({ providerId, providerLabel }) => {
    const now = new Date().toISOString();
    await window.electron.ipcRenderer.invoke('provider:save', {
      id: providerId,
      name: providerLabel,
      type: 'moonshot',
      baseUrl: 'https://api.moonshot.cn/v1',
      model: 'kimi-k2.6',
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
  }, { providerId: TEST_PROVIDER_ID, providerLabel: TEST_PROVIDER_LABEL });
}

test.describe('ClawX provider lifecycle', () => {
  test('promotes a remaining provider after deleting the default provider', async ({ page }) => {
    await completeSetup(page);

    await page.evaluate(async () => {
      const now = new Date().toISOString();
      const providers = [
        {
          id: 'moonshot-default-e2e',
          name: 'Moonshot Default E2E',
          type: 'moonshot',
          baseUrl: 'https://api.moonshot.cn/v1',
          model: 'kimi-k2.6',
          enabled: true,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'deepseek-replacement-e2e',
          name: 'DeepSeek Replacement E2E',
          type: 'deepseek',
          baseUrl: 'https://api.deepseek.com/v1',
          model: 'deepseek-v4-pro',
          enabled: true,
          createdAt: now,
          updatedAt: new Date(Date.now() + 1_000).toISOString(),
        },
      ];

      for (const provider of providers) {
        await window.electron.ipcRenderer.invoke('provider:save', provider);
      }
      await window.electron.ipcRenderer.invoke('provider:setDefault', providers[0].id);
    });

    await page.getByTestId('sidebar-nav-settings').click();

    await page.getByTestId('settings-tab-models').click();
    await expect(page.getByTestId('provider-card-moonshot-default-e2e')).toContainText('Default');
    await expect(page.getByTestId('provider-card-deepseek-replacement-e2e')).toBeVisible();

    await page.getByTestId('provider-card-moonshot-default-e2e').hover();
    await page.getByTestId('provider-delete-moonshot-default-e2e').click();

    await expect(page.getByTestId('provider-card-moonshot-default-e2e')).toHaveCount(0);
    await expect(page.getByTestId('provider-card-deepseek-replacement-e2e')).toContainText('Default');
    await expect(page.getByTestId('provider-set-default-deepseek-replacement-e2e')).toHaveCount(0);
  });

  test('orders providers by add order and hides the set-default button', async ({ page }) => {
    await completeSetup(page);

    await page.evaluate(async () => {
      const base = Date.now();
      const providers = [
        {
          id: 'first-added-e2e',
          name: 'First Added E2E',
          type: 'moonshot',
          baseUrl: 'https://api.moonshot.cn/v1',
          model: 'kimi-k2.6',
          enabled: true,
          createdAt: new Date(base).toISOString(),
          updatedAt: new Date(base).toISOString(),
        },
        {
          id: 'second-added-e2e',
          name: 'Second Added E2E',
          type: 'deepseek',
          baseUrl: 'https://api.deepseek.com/v1',
          model: 'deepseek-v4-pro',
          enabled: true,
          createdAt: new Date(base + 1_000).toISOString(),
          updatedAt: new Date(base + 1_000).toISOString(),
        },
      ];
      for (const provider of providers) {
        await window.electron.ipcRenderer.invoke('provider:save', provider);
      }
      // Make the LATER-added provider the default; the list order must NOT follow it.
      await window.electron.ipcRenderer.invoke('provider:setDefault', 'second-added-e2e');
    });

    await page.getByTestId('sidebar-nav-settings').click();
    await page.getByTestId('settings-tab-models').click();
    await expect(page.getByTestId('providers-settings')).toBeVisible();

    // Order is add order (createdAt asc): first-added stays before second-added
    // even though second-added is the default.
    const cards = page.locator('[data-testid^="provider-card-"]');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toHaveAttribute('data-testid', 'provider-card-first-added-e2e');
    await expect(cards.nth(1)).toHaveAttribute('data-testid', 'provider-card-second-added-e2e');

    // The default badge still marks the default provider...
    await expect(page.getByTestId('provider-card-second-added-e2e')).toContainText('Default');
    // ...but the "set as default" button is hidden on every card (default and non-default).
    await expect(page.getByTestId('provider-set-default-first-added-e2e')).toHaveCount(0);
    await expect(page.getByTestId('provider-set-default-second-added-e2e')).toHaveCount(0);
  });

  test('shows a saved provider and removes it cleanly after deletion', async ({ page }) => {
    await completeSetup(page);
    await seedTestProvider(page);

    await page.getByTestId('sidebar-nav-settings').click();

    await page.getByTestId('settings-tab-models').click();
    await expect(page.getByTestId('providers-settings')).toBeVisible();
    await expect(page.getByTestId(`provider-card-${TEST_PROVIDER_ID}`)).toContainText(TEST_PROVIDER_LABEL);

    await page.getByTestId(`provider-card-${TEST_PROVIDER_ID}`).hover();
    await page.getByTestId(`provider-delete-${TEST_PROVIDER_ID}`).click();

    await expect(page.getByTestId(`provider-card-${TEST_PROVIDER_ID}`)).toHaveCount(0);
    await expect(page.getByText(TEST_PROVIDER_LABEL)).toHaveCount(0);
  });

  test('does not redisplay a deleted provider after relaunch', async ({ electronApp, launchElectronApp, page }) => {
    await completeSetup(page);
    await seedTestProvider(page);

    await page.getByTestId('sidebar-nav-settings').click();

    await page.getByTestId('settings-tab-models').click();
    await expect(page.getByTestId(`provider-card-${TEST_PROVIDER_ID}`)).toContainText(TEST_PROVIDER_LABEL);

    await page.getByTestId(`provider-card-${TEST_PROVIDER_ID}`).hover();
    await page.getByTestId(`provider-delete-${TEST_PROVIDER_ID}`).click();
    await expect(page.getByTestId(`provider-card-${TEST_PROVIDER_ID}`)).toHaveCount(0);

    await electronApp.close();

    const relaunchedApp = await launchElectronApp();
    try {
      const relaunchedPage = await relaunchedApp.firstWindow();
      await relaunchedPage.waitForLoadState('domcontentloaded');
      await expect(relaunchedPage.getByTestId('main-layout')).toBeVisible();

      await relaunchedPage.getByTestId('sidebar-nav-settings').click();

      await relaunchedPage.getByTestId('settings-tab-models').click();
      await expect(relaunchedPage.getByTestId('providers-settings')).toBeVisible();
      await expect(relaunchedPage.getByTestId(`provider-card-${TEST_PROVIDER_ID}`)).toHaveCount(0);
      await expect(relaunchedPage.getByText(TEST_PROVIDER_LABEL)).toHaveCount(0);
    } finally {
      await relaunchedApp.close();
    }
  });

  test('shows OpenAI OAuth and API key auth mode toggle in add-provider dialog', async ({ page }) => {
    await completeSetup(page);

    await page.getByTestId('sidebar-nav-settings').click();

    await page.getByTestId('settings-tab-models').click();
    await expect(page.getByTestId('providers-settings')).toBeVisible();

    await page.getByTestId('providers-add-button').click();
    await expect(page.getByTestId('add-provider-dialog')).toBeVisible();

    await page.getByTestId('add-provider-type-openai').click();
    await expect(page.getByTestId('add-provider-auth-oauth-tab')).toBeVisible();
    await expect(page.getByTestId('add-provider-auth-apikey-tab')).toBeVisible();

    await page.getByTestId('add-provider-auth-oauth-tab').click();
    await expect(page.getByTestId('add-provider-oauth-login-button')).toBeVisible();
    await expect(page.getByTestId('add-provider-api-key-input')).toHaveCount(0);
  });

  test('trims whitespace before validating and saving a custom provider key', async ({ electronApp, page }) => {
    await completeSetup(page);

    await electronApp.evaluate(async ({ app: _app }) => {
      const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');

      let accounts: Array<Record<string, unknown>> = [];
      let keyInfo: Array<{ accountId: string; hasKey: boolean; keyMasked: string | null }> = [];
      let statuses: Array<Record<string, unknown>> = [];
      let defaultAccountId: string | null = null;
      const originalHostInvoke = (ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      })._invokeHandlers?.get('host:invoke');

      const respond = (id: unknown, data: unknown) => ({
        id: typeof id === 'string' ? id : undefined,
        ok: true,
        data,
      });

      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event: unknown, request: {
        id?: string;
        module?: string;
        action?: string;
        payload?: Record<string, unknown>;
      }) => {
        if (request?.module !== 'providers') {
          return originalHostInvoke?.(event, request) ?? respond(request?.id, undefined);
        }

        const body = request.payload ?? {};
        if (request.action === 'accounts') return respond(request.id, accounts);
        if (request.action === 'accountKeyInfo') return respond(request.id, keyInfo);
        if (request.action === 'vendors') return respond(request.id, []);
        if (request.action === 'getDefaultAccount') return respond(request.id, { accountId: defaultAccountId });
        if (request.action === 'list') return respond(request.id, statuses);

        if (request.action === 'validateKey') {
          if (body.apiKey !== 'sk-lm-test') {
            return respond(request.id, { valid: false, error: `unexpected key: ${String(body.apiKey)}` });
          }
          const options = body.options as Record<string, unknown> | undefined;
          if (options?.modelId !== 'local-model') {
            return respond(request.id, {
              valid: false,
              error: `unexpected validation model: ${String(options?.modelId)}`,
            });
          }
          return respond(request.id, { valid: true });
        }

        if (request.action === 'createAccount') {
          const account = body.account as Record<string, unknown>;
          accounts = [account];
          keyInfo = [{
            accountId: String(account.id),
            hasKey: Boolean(body.apiKey),
            keyMasked: body.apiKey ? 'sk-***' : null,
          }];
          statuses = [{
            id: account.id,
            name: account.label,
            type: account.vendorId,
            baseUrl: account.baseUrl,
            model: account.model,
            enabled: account.enabled,
            createdAt: account.createdAt,
            updatedAt: account.updatedAt,
            hasKey: Boolean(body.apiKey),
            keyMasked: body.apiKey ? 'sk-***' : null,
          }];
          return respond(request.id, { success: true, account });
        }

        if (request.action === 'setDefaultAccount') {
          defaultAccountId = typeof body.accountId === 'string' ? body.accountId : null;
          return respond(request.id, { success: true });
        }

        return respond(request.id, {});
      });
    });

    await page.getByTestId('sidebar-nav-settings').click();

    await page.getByTestId('settings-tab-models').click();
    await expect(page.getByTestId('providers-settings')).toBeVisible();

    await page.getByTestId('providers-add-button').click();
    await expect(page.getByTestId('add-provider-dialog')).toBeVisible();

    await page.getByTestId('add-provider-type-custom').click();
    await page.getByTestId('add-provider-name-input').fill('LM Studio Local');
    await page.getByTestId('add-provider-api-key-input').fill('  sk-lm-test \n');
    await page.getByTestId('add-provider-base-url-input').fill('http://127.0.0.1:1234/v1');
    await page.getByTestId('add-provider-model-id-input').fill('local-model');
    await page.getByTestId('add-provider-submit-button').click();

    await expect(page.getByTestId('provider-card-custom')).toContainText('LM Studio Local');
  });

  test('edit form validates the new API key inline before saving (single button)', async ({ electronApp, page }) => {
    await completeSetup(page);

    await electronApp.evaluate(async ({ app: _app }) => {
      const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');

      let provider = {
        id: 'moonshot-edit',
        vendorId: 'moonshot',
        label: 'Moonshot Edit',
        authMode: 'api_key',
        baseUrl: 'https://api.moonshot.cn/v1',
        model: 'kimi-k2.6',
        enabled: true,
        isDefault: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      let storedKey = 'sk-existing';
      let keyInfo = [{ accountId: provider.id, hasKey: true, keyMasked: 'sk-***' }];
      const originalHostInvoke = (ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      })._invokeHandlers?.get('host:invoke');

      const respond = (id: unknown, data: unknown) => ({
        id: typeof id === 'string' ? id : undefined,
        ok: true,
        data,
      });

      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event: unknown, request: {
        id?: string;
        module?: string;
        action?: string;
        payload?: Record<string, unknown>;
      }) => {
        if (request?.module !== 'providers') {
          return originalHostInvoke?.(event, request) ?? respond(request?.id, undefined);
        }

        const body = request.payload ?? {};
        if (request.action === 'accounts') return respond(request.id, [provider]);
        if (request.action === 'accountKeyInfo') return respond(request.id, keyInfo);
        if (request.action === 'vendors') return respond(request.id, []);
        if (request.action === 'getDefaultAccount') return respond(request.id, { accountId: provider.id });
        if (request.action === 'list') return respond(request.id, [provider]);

        if (request.action === 'validateKey') {
          if (body.apiKey === 'sk-good') {
            const options = body.options as Record<string, unknown> | undefined;
            if (options?.modelId !== 'kimi-k2.6') {
              return respond(request.id, {
                valid: false,
                error: `unexpected validation model: ${String(options?.modelId)}`,
              });
            }
            return respond(request.id, { valid: true });
          }
          return respond(request.id, { valid: false, error: 'Invalid API key' });
        }

        if (request.action === 'updateAccount') {
          provider = {
            ...provider,
            ...(body.updates as Record<string, unknown> | undefined),
            updatedAt: new Date().toISOString(),
          };
          if (body.apiKey) storedKey = String(body.apiKey);
          keyInfo = [{ accountId: provider.id, hasKey: Boolean(storedKey), keyMasked: 'sk-***' }];
          return respond(request.id, { success: true, account: provider });
        }

        return respond(request.id, {});
      });
    });

    await page.getByTestId('sidebar-nav-settings').click();

    await page.getByTestId('settings-tab-models').click();
    await expect(page.getByTestId('providers-settings')).toBeVisible();
    await expect(page.getByTestId('provider-card-moonshot-edit')).toBeVisible();

    await page.getByTestId('provider-card-moonshot-edit').hover();
    await page.getByTestId('provider-edit-moonshot-edit').click();

    await expect(page.getByTestId('provider-edit-model-id-moonshot-edit')).toBeDisabled();
    await expect(page.getByTestId('provider-edit-model-id-moonshot-edit')).toHaveValue('kimi-k2.6');
    await expect(page.getByTestId('provider-edit-model-id-help-moonshot-edit')).toContainText(
      'The model ID cannot be changed after creation.',
    );

    await page.getByTestId('provider-edit-key-input-moonshot-edit').fill('sk-bad');
    await page.getByTestId('provider-edit-save-moonshot-edit').click();
    await expect(page.getByTestId('provider-edit-validation-error-moonshot-edit')).toContainText('Invalid API key');

    await page.getByTestId('provider-edit-key-input-moonshot-edit').fill('sk-good');
    await expect(page.getByTestId('provider-edit-validation-error-moonshot-edit')).toHaveCount(0);
    await page.getByTestId('provider-edit-save-moonshot-edit').click();

    await expect(page.getByTestId('provider-edit-save-moonshot-edit')).toHaveCount(0);
  });

  test('renames a provider via the edit form and reflects the new label on the card', async ({ page }) => {
    await completeSetup(page);
    await seedTestProvider(page);

    await page.getByTestId('sidebar-nav-settings').click();
    await page.getByTestId('settings-tab-models').click();
    await expect(page.getByTestId('providers-settings')).toBeVisible();

    const card = page.getByTestId(`provider-card-${TEST_PROVIDER_ID}`);
    await expect(card).toContainText(TEST_PROVIDER_LABEL);

    await card.hover();
    await page.getByTestId(`provider-edit-${TEST_PROVIDER_ID}`).click();

    const nameInput = page.getByTestId(`provider-name-input-${TEST_PROVIDER_ID}`);
    await expect(nameInput).toHaveValue(TEST_PROVIDER_LABEL);

    const RENAMED_LABEL = 'Moonshot Renamed E2E';
    await nameInput.fill(RENAMED_LABEL);
    await page.getByTestId(`provider-edit-save-${TEST_PROVIDER_ID}`).click();

    // The edit form closes and the card header shows the new label; the old one is gone.
    await expect(page.getByTestId(`provider-name-input-${TEST_PROVIDER_ID}`)).toHaveCount(0);
    await expect(card).toContainText(RENAMED_LABEL);
    await expect(page.getByText(TEST_PROVIDER_LABEL, { exact: true })).toHaveCount(0);
  });

  test('keeps the title and add button fixed while only the model list scrolls', async ({ page }) => {
    await completeSetup(page);

    // Seed enough providers that the list overflows the modal height and scrolls.
    await page.evaluate(async () => {
      const base = Date.now();
      for (let i = 0; i < 15; i += 1) {
        const now = new Date(base + i * 1_000).toISOString();
        await window.electron.ipcRenderer.invoke('provider:save', {
          id: `scroll-provider-${i}-e2e`,
          name: `Scroll Provider ${i} E2E`,
          type: 'moonshot',
          baseUrl: 'https://api.moonshot.cn/v1',
          model: 'kimi-k2.6',
          enabled: true,
          createdAt: now,
          updatedAt: now,
        });
      }
    });

    await page.getByTestId('sidebar-nav-settings').click();
    await page.getByTestId('settings-tab-models').click();
    await expect(page.getByTestId('providers-settings')).toBeVisible();

    const title = page.getByTestId('providers-settings-title');
    const addButton = page.getByTestId('providers-add-button');
    await expect(title).toBeVisible();
    await expect(addButton).toBeVisible();

    const titleBoxBefore = await title.boundingBox();
    expect(titleBoxBefore).not.toBeNull();

    // Scrolling the last card into view forces the (only) scrollable region — the
    // model list — to scroll. The pinned header must not move.
    await page.getByTestId('provider-card-scroll-provider-14-e2e').scrollIntoViewIfNeeded();

    const titleBoxAfter = await title.boundingBox();
    expect(titleBoxAfter).not.toBeNull();
    expect(titleBoxAfter!.y).toBeCloseTo(titleBoxBefore!.y, 0);
    await expect(title).toBeVisible();
    await expect(addButton).toBeVisible();
  });
});
