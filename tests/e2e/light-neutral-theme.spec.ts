import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

type ThemeSnapshot = {
  raw: Record<string, string>;
  computed: Record<string, string>;
};

async function readThemeSnapshot(page: import('@playwright/test').Page, mode: 'light' | 'dark'): Promise<ThemeSnapshot> {
  return await page.evaluate((themeMode) => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(themeMode);

    const variables = ['--background', '--surface-modal', '--surface-input', '--surface-sidebar', '--primary', '--accent', '--ring', '--accent-lavender'];
    const rootStyle = window.getComputedStyle(root);

    const raw: Record<string, string> = {};
    const computed: Record<string, string> = {};

    for (const variable of variables) {
      raw[variable] = rootStyle.getPropertyValue(variable).trim();

      const probe = document.createElement('div');
      probe.style.color = `hsl(var(${variable}))`;
      document.body.appendChild(probe);
      computed[variable] = window.getComputedStyle(probe).color;
      probe.remove();
    }

    return { raw, computed };
  }, mode);
}

test.describe('ClawX light neutral theme tokens', () => {
  test('uses lavender accents in both themes while preserving neutral main surfaces', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const light = await readThemeSnapshot(page, 'light');
      expect(light.raw).toEqual({
        '--background': '0 0% 100%',
        '--surface-modal': '0 0% 100%',
        '--surface-input': '260 22% 96%',
        '--surface-sidebar': '0 0% 94.9%',
        '--primary': '260 100% 80%',
        '--accent': '260 70% 95%',
        '--ring': '260 64% 58%',
        '--accent-lavender': '260 100% 85%',
      });
      expect(light.computed).toEqual({
        '--background': 'rgb(255, 255, 255)',
        '--surface-modal': 'rgb(255, 255, 255)',
        '--surface-input': 'rgb(244, 243, 247)',
        '--surface-sidebar': 'rgb(242, 242, 242)',
        '--primary': 'rgb(187, 153, 255)',
        '--accent': 'rgb(239, 233, 251)',
        '--ring': 'rgb(125, 79, 216)',
        '--accent-lavender': 'rgb(204, 179, 255)',
      });

      const dark = await readThemeSnapshot(page, 'dark');
      expect(dark.raw).toEqual({
        '--background': '240 4% 11%',
        '--surface-modal': '240 3% 14%',
        '--surface-input': '240 3% 18%',
        '--surface-sidebar': '240 4% 11%',
        '--primary': '260 100% 80%',
        '--accent': '260 24% 22%',
        '--ring': '260 100% 80%',
        '--accent-lavender': '260 100% 85%',
      });
    } finally {
      await closeElectronApp(app);
    }
  });
});
