import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, openSettingsTab, test } from './fixtures/electron';

async function readNativeMenuLabels(app: ElectronApplication) {
  return await app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu();
    const fileMenu = menu?.items.find((item) => item.label === '文件' || item.label === 'File');
    return {
      topLevel: menu?.items.map((item) => item.label) ?? [],
      file: fileMenu?.label,
      newChat: fileMenu?.submenu?.items.find((item) => item.id === 'new-chat' || item.label === 'New Chat' || item.label === '新对话')?.label,
    };
  });
}

test.describe('ClawX main navigation without setup flow', () => {
  test('keeps reload menu commands without application accelerators', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const reloadItems = await app.evaluate(({ Menu }) => {
        const menu = Menu.getApplicationMenu();
        const findById = (items: Electron.MenuItem[], id: string): Electron.MenuItem | undefined => {
          for (const item of items) {
            if (item.id === id) return item;
            const child = item.submenu ? findById(item.submenu.items, id) : undefined;
            if (child) return child;
          }
          return undefined;
        };
        return ['reload', 'force-reload'].map((id) => {
          const item = menu ? findById(menu.items, id) : undefined;
          return { id: item?.id, label: item?.label, accelerator: item?.accelerator };
        });
      });

      expect(reloadItems).toEqual([
        { id: 'reload', label: expect.any(String), accelerator: null },
        { id: 'force-reload', label: expect.any(String), accelerator: null },
      ]);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('navigates between core pages with setup bypassed', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);

      await expect(page.getByTestId('main-layout')).toBeVisible();
      const originalUrl = page.url();

      await openSettingsTab(page, 'models');
      await expect(page.getByTestId('models-tab')).toBeVisible();
      await expect(page).toHaveURL(originalUrl);
      await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();

      await page.getByTestId('sidebar-nav-agents').click();
      await expect(page.getByTestId('agents-page')).toBeVisible();
      await expect(page).toHaveURL(/#\/agents$/);

      await openSettingsTab(page, 'channels');
      await expect(page.getByTestId('channels-tab')).toBeVisible();
      await expect(page).toHaveURL(/#\/agents$/);

      await openSettingsTab(page, 'skills');
      await expect(page.getByTestId('skills-tab')).toBeVisible();
      await expect(page).toHaveURL(/#\/agents$/);

      await openSettingsTab(page, 'general');
      await expect(page.getByTestId('settings-tab')).toBeVisible();
      await expect(page).toHaveURL(/#\/agents$/);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('native New Chat menu opens the same chat route as the sidebar action', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('chat-page')).toBeVisible();

      await openSettingsTab(page, 'models');
      await expect(page.getByTestId('models-tab')).toBeVisible();
      await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
      await page.getByTestId('sidebar-nav-agents').click();
      await expect(page.getByTestId('agents-page')).toBeVisible();

      await app.evaluate(({ BrowserWindow, Menu }) => {
        const menu = Menu.getApplicationMenu();
        const findMenuItem = (items: Electron.MenuItem[]): Electron.MenuItem | undefined => {
          for (const item of items) {
            if (item.id === 'new-chat') return item;
            const child = item.submenu ? findMenuItem(item.submenu.items) : undefined;
            if (child) return child;
          }
          return undefined;
        };
        const newChatItem = menu ? findMenuItem(menu.items) : undefined;
        newChatItem?.click(undefined, BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0], undefined);
      });

      await expect(page.getByTestId('chat-page')).toBeVisible();
      await expect(page).toHaveURL(/#\/$/);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('refreshes native menu labels after switching language', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);

      await page.getByTestId('sidebar-nav-settings').click();
      await page.getByRole('button', { name: 'English' }).click();
      await expect.poll(() => readNativeMenuLabels(app)).toMatchObject({
        file: 'File',
        newChat: 'New Chat',
      });
      await page.getByRole('button', { name: '中文' }).click();

      await expect(page.getByText('语言', { exact: true })).toBeVisible();
      await expect.poll(() => readNativeMenuLabels(app)).toMatchObject({
        file: '文件',
        newChat: '新对话',
      });
    } finally {
      await closeElectronApp(app);
    }
  });
});
