import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';
import { E2E_SCREENSHOT_TAG } from './parallel-policy';

/**
 * README screenshot capture.
 *
 * Writes the six README surfaces for each of the four locales into
 * `resources/screenshot/<dir>/`. Run via `pnpm run screenshots`; excluded from
 * every ordinary E2E lane by the `@screenshots` tag.
 *
 * Output is the raw renderer viewport (flat, no window chrome). The rounded
 * corners / drop shadow that the committed images have are applied afterwards by
 * `scripts/decorate-screenshots.mjs`.
 */

// The committed screenshots are a 2560x1600 window (1280x800 logical at DPR 2)
// inset into a 2784x1824 canvas. Capture at the window size; the surrounding
// margin, rounded corners and drop shadow are added by
// `scripts/decorate-screenshots.mjs`.
const CONTENT_WIDTH = 1280;
const CONTENT_HEIGHT = 800;

const LOCALES = [
  { dir: 'en', label: 'English' },
  { dir: 'zh', label: '中文' },
  { dir: 'jp', label: '日本語' },
  { dir: 'ru', label: 'Русский' },
] as const;

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const legacy = (json: unknown) => ({ ok: true, data: { status: 200, ok: true, json } });

const GATEWAY_STATUS = { state: 'running', port: 18789, pid: 4821, gatewayReady: true };

const AGENTS = [
  {
    id: 'main',
    name: 'Main',
    isDefault: true,
    modelDisplay: 'GPT-5.5',
    modelRef: 'openai/gpt-5.5',
    overrideModelRef: null,
    inheritedModel: true,
    workspace: '/Users/you/Workspace',
    agentDir: '/Users/you/Workspace/agent',
    mainSessionKey: 'main/default',
    channelTypes: ['feishu'],
  },
  {
    id: 'research',
    name: 'Research',
    isDefault: false,
    modelDisplay: 'Claude Opus 4.8',
    modelRef: 'anthropic/claude-opus-4-8',
    overrideModelRef: 'anthropic/claude-opus-4-8',
    inheritedModel: false,
    workspace: '/Users/you/Research',
    agentDir: '/Users/you/Research/agent',
    mainSessionKey: 'research/default',
    channelTypes: [],
  },
];

/**
 * Seeded task content per locale. The UI chrome localizes itself, but mock data
 * does not — leaving English task names in the zh/ja/ru screenshots would make
 * them look half-translated.
 */
const CRON_CONTENT = {
  en: [
    { name: 'Morning briefing', message: 'Summarize overnight news and my calendar for today.' },
    { name: 'Price watch', message: 'Check the tracked product prices and report any change over 5%.' },
    { name: 'Weekly report', message: 'Draft the weekly progress report from this week’s notes.' },
  ],
  zh: [
    { name: '每日早报', message: '汇总隔夜要闻和我今天的日程安排。' },
    { name: '价格监控', message: '检查在追踪的商品价格，波动超过 5% 时提醒我。' },
    { name: '周报草稿', message: '根据本周的笔记起草一份周报。' },
  ],
  jp: [
    { name: '朝のブリーフィング', message: '夜間のニュースと本日の予定をまとめてください。' },
    { name: '価格ウォッチ', message: '追跡中の商品価格を確認し、5% を超える変動を報告してください。' },
    { name: '週次レポート', message: '今週のメモから週次の進捗レポートを作成してください。' },
  ],
  ru: [
    { name: 'Утренняя сводка', message: 'Собери ночные новости и мой календарь на сегодня.' },
    { name: 'Отслеживание цен', message: 'Проверь цены отслеживаемых товаров и сообщи об изменении более 5%.' },
    { name: 'Недельный отчёт', message: 'Подготовь недельный отчёт о прогрессе по заметкам этой недели.' },
  ],
} as const;

function cronJobs(localeDir: keyof typeof CRON_CONTENT) {
  const content = CRON_CONTENT[localeDir];
  return [
    {
      id: 'morning-briefing',
      name: content[0].name,
      enabled: true,
      schedule: '0 9 * * 1-5',
      scheduleKind: 'recurring',
      agentId: 'main',
      message: content[0].message,
      lastRunAt: Date.now() - 3_600_000,
      nextRunAt: Date.now() + 68_400_000,
      lastStatus: 'success',
    },
    {
      id: 'price-watch',
      name: content[1].name,
      enabled: true,
      schedule: '0 * * * *',
      scheduleKind: 'recurring',
      agentId: 'research',
      message: content[1].message,
      lastRunAt: Date.now() - 900_000,
      nextRunAt: Date.now() + 2_700_000,
      lastStatus: 'success',
    },
    {
      id: 'weekly-report',
      name: content[2].name,
      enabled: false,
      schedule: '0 17 * * 5',
      scheduleKind: 'recurring',
      agentId: 'main',
      message: content[2].message,
      lastRunAt: null,
      nextRunAt: null,
      lastStatus: null,
    },
  ];
}

const CHANNEL_ACCOUNTS = {
  success: true,
  channels: [
    {
      channelType: 'feishu',
      accounts: [
        { accountId: 'feishu-work', label: 'Work tenant', enabled: true, connected: true, isDefault: true, agentId: 'main' },
      ],
    },
    {
      channelType: 'wechat',
      accounts: [
        { accountId: 'wechat-personal', label: 'Personal', enabled: true, connected: true, isDefault: true, agentId: 'main' },
      ],
    },
  ],
};

const NOW_ISO = '2026-08-01T09:00:00.000Z';

const PROVIDER_ACCOUNTS = [
  {
    id: 'openai-main',
    vendorId: 'openai',
    label: 'OpenAI',
    authMode: 'apiKey',
    model: ['gpt-5.5', 'gpt-5.5-mini'],
    modelType: ['chat'],
    enabled: true,
    isDefault: true,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  },
  {
    id: 'anthropic-main',
    vendorId: 'anthropic',
    label: 'Anthropic',
    authMode: 'apiKey',
    model: ['claude-opus-4-8', 'claude-sonnet-5'],
    modelType: ['chat'],
    enabled: true,
    isDefault: false,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  },
  {
    id: 'zai-global',
    vendorId: 'zai',
    label: 'Z.AI (Global)',
    authMode: 'apiKey',
    model: ['glm-5.2'],
    modelType: ['chat'],
    enabled: true,
    isDefault: false,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  },
];

const PROVIDER_KEY_INFO = PROVIDER_ACCOUNTS.map((account) => ({
  accountId: account.id,
  hasKey: true,
  keyMasked: 'sk-••••••••••••7f2a',
}));

const SKILLS = {
  success: true,
  skills: [
    { id: 'pdf', name: 'pdf', description: 'Read, extract, merge, split and create PDF files.', enabled: true, isBundled: true, version: '1.4.0', source: 'bundled', baseDir: '~/.openclaw/skills/pdf' },
    { id: 'xlsx', name: 'xlsx', description: 'Create and edit spreadsheets, formulas and charts.', enabled: true, isBundled: true, version: '1.4.0', source: 'bundled', baseDir: '~/.openclaw/skills/xlsx' },
    { id: 'docx', name: 'docx', description: 'Create and edit Word documents with tracked changes.', enabled: true, isBundled: true, version: '1.4.0', source: 'bundled', baseDir: '~/.openclaw/skills/docx' },
    { id: 'pptx', name: 'pptx', description: 'Build and edit slide decks and speaker notes.', enabled: true, isBundled: true, version: '1.4.0', source: 'bundled', baseDir: '~/.openclaw/skills/pptx' },
    { id: 'github', name: 'github', description: 'Work with repositories, issues and pull requests.', enabled: true, version: '0.9.2', source: 'managed', baseDir: '~/.openclaw/skills/github' },
    { id: 'obsidian', name: 'obsidian', description: 'Read and write notes in an Obsidian vault.', enabled: false, version: '0.6.0', source: 'managed', baseDir: '~/.openclaw/skills/obsidian' },
  ],
};

function baseHostApi(localeDir: keyof typeof CRON_CONTENT) {
  return {
    [stableStringify(['/api/gateway/status', 'GET'])]: legacy(GATEWAY_STATUS),
    [stableStringify(['/api/cron/jobs', 'GET'])]: legacy(cronJobs(localeDir)),
    [stableStringify(['/api/channels/accounts', 'GET'])]: legacy(CHANNEL_ACCOUNTS),
    [stableStringify(['/api/agents', 'GET'])]: legacy({
      agents: AGENTS,
      defaultAgentId: 'main',
      defaultModelRef: 'openai/gpt-5.5',
      configuredChannelTypes: ['feishu', 'wechat'],
      channelOwners: { feishu: 'main', wechat: 'main' },
      channelAccountOwners: { 'feishu:feishu-work': 'main', 'wechat:wechat-personal': 'main' },
    }),
    // Typed keys: these actions have no legacy REST mapping in the fixture.
    [stableStringify(['providers', 'accounts', null])]: PROVIDER_ACCOUNTS,
    [stableStringify(['providers', 'accountKeyInfo', null])]: PROVIDER_KEY_INFO,
    [stableStringify(['providers', 'getDefaultAccount', null])]: { accountId: 'openai-main' },
    [stableStringify(['skills', 'local', null])]: SKILLS,
  };
}

async function sizeWindow(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ app: _app }, size) => {
    const { BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
    const [win] = BrowserWindow.getAllWindows();
    if (!win) throw new Error('No Electron window to resize for screenshot capture');
    win.setContentSize(size.width, size.height);
    win.center();
  }, { width: CONTENT_WIDTH, height: CONTENT_HEIGHT });
  // Let the renderer settle after the resize before capturing.
  await new Promise((r) => setTimeout(r, 400));
}

async function chooseLocale(page: Page, label: string): Promise<void> {
  if (label === 'English') return; // already the seeded default
  await page.locator('button', { hasText: label }).first().click();
}

async function shoot(page: Page, dir: string, name: string): Promise<void> {
  const outDir = join('resources', 'screenshot', dir);
  await mkdir(outDir, { recursive: true });
  // Settle animations (Framer Motion transitions on route/tab change).
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(outDir, `${name}.png`), animations: 'disabled' });
}

for (const locale of LOCALES) {
  test(`${E2E_SCREENSHOT_TAG} capture README screenshots (${locale.dir})`, async ({
    electronApp,
    page,
  }) => {
    test.setTimeout(180_000);

    await installIpcMocks(electronApp, {
      gatewayStatus: GATEWAY_STATUS,
      gatewayRpc: {},
      hostApi: baseHostApi(locale.dir),
    });

    await expect(page.getByTestId('setup-page')).toBeVisible();
    await chooseLocale(page, locale.label);
    await completeSetup(page);
    await sizeWindow(electronApp);

    // 1. Chat (default landing surface)
    await shoot(page, locale.dir, 'chat');

    // 2. Cron
    await page.getByTestId('sidebar-nav-cron').click();
    await expect(page.getByTestId('cron-new-task-button')).toBeVisible();
    await shoot(page, locale.dir, 'cron');

    // 3-6. System Settings modal tabs. Models / Channels / Skills used to be
    // top-level sidebar pages and are now tabs in this modal. Triggers are
    // `settings-tab-<value>`; the rendered panels are `<value>-tab`.
    await page.getByTestId('sidebar-nav-settings').click();

    await page.getByTestId('settings-tab-general').click();
    await expect(page.getByTestId('settings-tab')).toBeVisible();
    await shoot(page, locale.dir, 'settings');

    await page.getByTestId('settings-tab-models').click();
    await expect(page.getByTestId('models-tab')).toBeVisible();
    await shoot(page, locale.dir, 'models');

    await page.getByTestId('settings-tab-channels').click();
    await expect(page.getByTestId('channels-tab')).toBeVisible();
    await shoot(page, locale.dir, 'channels');

    await page.getByTestId('settings-tab-skills').click();
    await expect(page.getByTestId('skills-tab')).toBeVisible();
    await shoot(page, locale.dir, 'skills');
  });
}
