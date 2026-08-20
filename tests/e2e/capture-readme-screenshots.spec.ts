import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import sharp from 'sharp';
import {
  completeSetup,
  emitAcpSessionUpdates,
  expect,
  installIpcMocks,
  test,
} from './fixtures/electron';
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

const MAIN_SESSION_KEY = 'agent:main:main';
const MAIN_WORKSPACE = '/Users/you/Workspace';

/**
 * Seeded chat conversation per locale.
 *
 * The chat surface is the first screenshot most readers look at, so it needs to
 * show what the product actually does rather than an empty session: a request, a
 * tool run, prose with Markdown, a produced file, and generated image media.
 */
const CHAT_CONTENT = {
  en: {
    request: 'Analyze data/q3-sales.csv, chart the monthly trend, and write a short summary report.',
    analysis: [
      'Read **data/q3-sales.csv** (92 rows). Revenue (USD) grew every month, mostly on enterprise accounts:',
      '',
      '- **July** 412K · **August** 486K (+18%) · **September** 571K (+17%)',
    ].join('\n'),
    closing: 'Done — the chart is above and the write-up is in `reports/q3-summary.md`.',
    chartTitle: 'Q3 revenue by month',
    months: ['Jul', 'Aug', 'Sep'],
    barLabels: ['$412K', '$486K', '$571K'],
    writeTool: 'Write: reports/q3-summary.md',
  },
  zh: {
    request: '分析 data/q3-sales.csv，画出月度趋势图，并写一份简短的总结报告。',
    analysis: [
      '已读取 **data/q3-sales.csv**（92 行），本季度营收逐月增长，主要来自企业客户：',
      '',
      '- **7 月** 41.2 万 · **8 月** 48.6 万（+18%）· **9 月** 57.1 万（+17%）',
    ].join('\n'),
    closing: '完成 —— 图表见上方，完整分析写入了 `reports/q3-summary.md`。',
    chartTitle: '第三季度月度营收',
    months: ['7 月', '8 月', '9 月'],
    barLabels: ['41.2 万', '48.6 万', '57.1 万'],
    writeTool: 'Write: reports/q3-summary.md',
  },
  jp: {
    request: 'data/q3-sales.csv を分析して、月次トレンドをグラフにし、短いサマリーレポートを書いてください。',
    analysis: [
      '**data/q3-sales.csv**（92 行）を読みました。売上は毎月伸びており、主にエンタープライズ顧客によるものです。',
      '',
      '- **7月** 41.2万ドル · **8月** 48.6万ドル（+18%）· **9月** 57.1万ドル（+17%）',
    ].join('\n'),
    closing: '完了しました。グラフは上のとおりで、詳細は `reports/q3-summary.md` に書き出しています。',
    chartTitle: '第3四半期の月次売上',
    months: ['7月', '8月', '9月'],
    barLabels: ['41.2万', '48.6万', '57.1万'],
    writeTool: 'Write: reports/q3-summary.md',
  },
  ru: {
    request: 'Проанализируй data/q3-sales.csv, построй график по месяцам и напиши сводку.',
    analysis: [
      'Прочитал **data/q3-sales.csv** (92 строки). Выручка (USD) росла каждый месяц:',
      '',
      '- **Июль** 412K · **Август** 486K (+18%) · **Сентябрь** 571K (+17%)',
    ].join('\n'),
    closing: 'Готово — график выше, а разбор записан в `reports/q3-summary.md`.',
    chartTitle: 'Выручка за 3-й квартал по месяцам',
    months: ['Июл', 'Авг', 'Сен'],
    barLabels: ['412K', '486K', '571K'],
    writeTool: 'Write: reports/q3-summary.md',
  },
} as const;

const REPORT_MARKDOWN = [
  '# Q3 revenue summary',
  '',
  '| Month | Revenue | Change |',
  '|-------|---------|--------|',
  '| July | $412,000 | — |',
  '| August | $486,000 | +18% |',
  '| September | $571,000 | +17% |',
  '',
  'Enterprise accounts contributed 63% of the quarter-over-quarter increase.',
].join('\n');

/**
 * Render the "generated" chart as a real PNG so the inline image part has
 * content. Kept deliberately short (620x198) so the whole exchange — request,
 * tool runs, prose, chart and produced file — fits the 1280x800 viewport without
 * scrolling the earlier turns out of frame.
 */
async function chartPngBase64(content: (typeof CHAT_CONTENT)[keyof typeof CHAT_CONTENT]): Promise<string> {
  const values = [412, 486, 571];
  const max = 620;
  const width = 620;
  const height = 198;
  const plotTop = 52;
  const plotBottom = 144;
  const barWidth = 72;
  const gap = 56;
  const startX = (width - (values.length * barWidth + (values.length - 1) * gap)) / 2;

  const bars = values.map((value, index) => {
    const barHeight = Math.round((value / max) * (plotBottom - plotTop));
    const x = Math.round(startX + index * (barWidth + gap));
    const y = plotBottom - barHeight;
    return [
      `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="5" fill="#e2622f" opacity="${0.72 + index * 0.14}"/>`,
      `<text x="${x + barWidth / 2}" y="${y - 9}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="16" font-weight="600" fill="#3f3a35">${content.barLabels[index]}</text>`,
      `<text x="${x + barWidth / 2}" y="${plotBottom + 24}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="15" fill="#7a736c">${content.months[index]}</text>`,
    ].join('');
  }).join('');

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`
    + `<rect width="${width}" height="${height}" rx="10" fill="#fdfcfa"/>`
    + `<text x="32" y="34" font-family="Helvetica, Arial, sans-serif" font-size="19" font-weight="600" fill="#2f2b27">${content.chartTitle}</text>`
    + `<line x1="32" y1="${plotBottom}" x2="${width - 32}" y2="${plotBottom}" stroke="#e4ded6" stroke-width="2"/>`
    + bars
    + '</svg>';

  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return png.toString('base64');
}

async function seedConversation(
  app: ElectronApplication,
  localeDir: keyof typeof CHAT_CONTENT,
): Promise<void> {
  const content = CHAT_CONTENT[localeDir];
  const chart = await chartPngBase64(content);

  await emitAcpSessionUpdates(app, {
    sessionKey: MAIN_SESSION_KEY,
    generation: 1,
    updates: [
      {
        sessionUpdate: 'user_message',
        messageId: 'shot-user',
        content: [{ type: 'text', text: content.request }],
      },
      {
        sessionUpdate: 'agent_message',
        messageId: 'shot-analysis',
        content: [{ type: 'text', text: content.analysis }],
      },
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'shot-write',
        title: content.writeTool,
        status: 'in_progress',
        rawInput: { path: 'reports/q3-summary.md', content: REPORT_MARKDOWN },
        content: [],
      },
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'shot-write',
        status: 'completed',
        rawInput: { path: 'reports/q3-summary.md', content: REPORT_MARKDOWN },
        content: [],
      },
      {
        sessionUpdate: 'agent_message',
        messageId: 'shot-chart',
        content: [{ type: 'image', mimeType: 'image/png', data: chart }],
      },
      {
        sessionUpdate: 'agent_message',
        messageId: 'shot-closing',
        content: [{ type: 'text', text: content.closing }],
      },
    ],
  });
}

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
    // Accept the ACP session load for whichever workspace the renderer resolves,
    // so the seeded conversation has a live generation to attach to.
    ...Object.fromEntries([MAIN_WORKSPACE, '/', '~/.openclaw/workspace'].map((root) => [
      stableStringify(['chat', 'loadAcpSession', {
        sessionKey: MAIN_SESSION_KEY,
        workspaceRoot: root,
        cwd: root,
      }]),
      { success: true, generation: 1 },
    ])),
    [stableStringify(['sessions', 'summaries', { sessionKeys: [MAIN_SESSION_KEY] }])]: { summaries: [] },
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

    // 1. Chat (default landing surface) with a seeded conversation
    await seedConversation(electronApp, locale.dir);
    await expect(page.getByTestId('acp-chat-timeline')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('acp-image-part').locator('img')).toBeVisible();
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
