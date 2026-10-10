import { app, safeStorage } from 'electron';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { LanguageCode } from '@shared/language';
import { openAuthWindow, closeAuthWindow } from './auth-window';

// Static imports to avoid runtime fs/i18next overhead in main process
import enCommon from '@shared/i18n/locales/en/common.json';
import zhCommon from '@shared/i18n/locales/zh/common.json';
import jaCommon from '@shared/i18n/locales/ja/common.json';

import enChannels from '@shared/i18n/locales/en/channels.json';
import zhChannels from '@shared/i18n/locales/zh/channels.json';
import jaChannels from '@shared/i18n/locales/ja/channels.json';
import ruChannels from '@shared/i18n/locales/ru/channels.json';

import { getValidFeishuAccessToken, getFeishuUserInfo, requireFeishuAppCredentials } from './feishu-oauth';
import { getSetting, setSetting } from './store';
import FEISHU_SCOPES from '../../resources/config/feishu-scopes.json';

class OAuthError extends Error {
  constructor(message: string, public readonly detail?: string) {
    super(message);
    this.name = 'OAuthError';
  }
}

async function loginFeishuOAuth(clientId: string, clientSecret: string): Promise<{ access_token: string; open_id: string }> {
  // Use a fixed port or fallback
  const port = 17653; // Use the port from redirect url: http://localhost:17653/oauth/callback as seen in feishu-auto-create.ts
  const redirectUri = `http://localhost:${port}/oauth/callback`;
  const state = randomBytes(16).toString('hex');
  
  // 1. Wait for local callback
  const codePromise = new Promise<string>((resolve, reject) => {
    let timeout: NodeJS.Timeout | null = null;
    const server = createServer((req, res) => {
      try {
        const url = new URL(req.url || '/', `http://localhost:${port}`);
        if (url.pathname === '/oauth/callback') {
          const code = url.searchParams.get('code');
          const reqState = url.searchParams.get('state');
          const error = url.searchParams.get('error');
          
          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<h2>授权失败</h2><p>错误信息：${error}</p>`);
            finish(new OAuthError(`OAuth authorization failed: ${error}`));
            return;
          }

          if (reqState !== state || !code) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<h2>授权失败</h2><p>无效的请求状态或授权码缺失</p>`);
            finish(new OAuthError('OAuth validation failed: invalid state or missing code'));
            return;
          }

          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h2>授权成功</h2><p>您可以关闭此窗口返回应用。</p>');
          finish(undefined, code);
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      } catch (err) {
        finish(err instanceof Error ? err : new Error('OAuth callback failed'));
      }
    });

    const finish = (err?: Error, code?: string) => {
      if (timeout) clearTimeout(timeout);
      try {
        server.close();
      } catch {
        // ignore
      }
      if (err) {
        reject(err);
      } else if (code) {
        resolve(code);
      }
    };

    server.once('error', (err) => {
      finish(err instanceof Error ? err : new Error('OAuth callback server error'));
    });

    server.listen(port, '127.0.0.1');

    // 5 minutes timeout
    timeout = setTimeout(() => {
      finish(new OAuthError('OAuth login timed out.'));
    }, 5 * 60 * 1000);
  });

  // 2. Open auth window
  const scopes = 'application:custom_app:create application:application:patch application:application.collaborators:write';
  const authUrl = `https://accounts.feishu.cn/open-apis/authen/v1/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${state}&scope=${encodeURIComponent(scopes)}`;
  openAuthWindow({ url: authUrl });

  // 3. Get code
  let code: string;
  try {
    code = await codePromise;
  } finally {
    closeAuthWindow();
  }

  // 4. Exchange for user_access_token
  const tokenRes = await fetch('https://open.feishu.cn/open-apis/authen/v2/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri
    })
  });
  
  const tokenData = await tokenRes.json();
  if (tokenData.code !== 0) {
    throw new OAuthError(`Failed to get access token: [${tokenData.code}] ${tokenData.error_description || tokenData.msg}`);
  }

  const access_token = tokenData.access_token || tokenData.data?.access_token;
  const refresh_token = tokenData.refresh_token || tokenData.data?.refresh_token;
  const expires_in = tokenData.expires_in || tokenData.data?.expires_in;

  // Cache the creator token so subsequent app create/edit reuses it without
  // re-opening the authorization window.
  await cacheCreatorTokens(access_token, refresh_token, expires_in);

  const userInfoRes = await fetch('https://open.feishu.cn/open-apis/authen/v1/user_info', {
    headers: { Authorization: `Bearer ${access_token}` }
  });
  const userInfoData = await userInfoRes.json();
  if (userInfoData.code !== 0) {
    throw new OAuthError(`Failed to get user info: [${userInfoData.code}] ${userInfoData.msg}`);
  }

  return { access_token, open_id: userInfoData.data.open_id };
}

interface FeishuAutoCreateStrings {
  productName: string;
  publishRemark: string;
  publishChangelog: string;
}

/** Deep-merge overlay onto base so missing keys in overlay fall back to base (e.g. zh/ja inherit from en). */
function mergeFallback<T extends Record<string, unknown>>(
    base: T,
    overlay: Partial<T> | Record<string, unknown>
): T {
    const result = { ...base } as Record<string, unknown>;
    for (const key of Object.keys(overlay)) {
        const baseVal = base[key as keyof T];
        const overlayVal = overlay[key];
        if (
            overlayVal != null &&
            typeof overlayVal === 'object' &&
            !Array.isArray(overlayVal) &&
            baseVal != null &&
            typeof baseVal === 'object' &&
            !Array.isArray(baseVal)
        ) {
            result[key] = mergeFallback(
                baseVal as Record<string, unknown>,
                overlayVal as Record<string, unknown>
            ) as T[keyof T];
        } else if (overlayVal !== undefined) {
            result[key] = overlayVal;
        }
    }
    return result as T;
}

const stringsCache: Record<string, FeishuAutoCreateStrings> = {};

// Global creator app credentials. These are secrets: configure them through the
// environment (FEISHU_APP_ID / FEISHU_APP_SECRET, see .env.example) — never hardcode
// them here, or GitHub push protection will (rightly) reject the commit.
// Resolved lazily via requireFeishuAppCredentials() at each call site.

/** Tenant-level IT admin user_id (not open_id) used to approve app versions. */
function getGlobalItUserId(): string {
  const userId = (process.env.FEISHU_IT_USER_ID ?? '').trim();
  if (!userId) {
    throw new Error('FEISHU_CONFIG_MISSING: set FEISHU_IT_USER_ID in the environment (see .env.example)');
  }
  return userId;
}

export function getFeishuAutoCreateStrings(lang: LanguageCode): FeishuAutoCreateStrings {
  if (stringsCache[lang]) {
    return stringsCache[lang];
  }

  let common: typeof enCommon = enCommon;
  let channels: typeof enChannels = enChannels;

  if (lang === 'zh') {
    common = mergeFallback(enCommon, zhCommon) as typeof enCommon;
    channels = mergeFallback(enChannels, zhChannels) as typeof enChannels;
  } else if (lang === 'ja') {
    common = mergeFallback(enCommon, jaCommon) as typeof enCommon;
    channels = mergeFallback(enChannels, jaChannels) as typeof enChannels;
  }

  const result: FeishuAutoCreateStrings = {
    productName: common.appName,
    publishRemark: channels.autoCreateFeishu.publishRemark,
    publishChangelog: channels.autoCreateFeishu.publishChangelog,
  };

  stringsCache[lang] = result;
  return result;
}

/** Simple interpolation for {{key}} */
function formatTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, key) => String(vars[key] ?? `{{${key}}}`));
}

const FEISHU_OPEN_BASE = 'https://open.feishu.cn';
/** Refresh the creator token this many ms before its real expiry. */
const TOKEN_EXPIRY_MARGIN_MS = 5 * 60 * 1000;

/**
 * Error thrown by app create/edit flows. Carries cleanup info so the API layer
 * can tell the user the app was disabled (and where to delete it) or restored.
 */
export class FeishuAppError extends Error {
  readonly disabledAppId?: string;
  readonly manageUrl?: string;
  readonly recovered?: boolean;
  constructor(
    message: string,
    info?: { disabledAppId?: string; manageUrl?: string; recovered?: boolean },
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'FeishuAppError';
    this.disabledAppId = info?.disabledAppId;
    this.manageUrl = info?.manageUrl;
    this.recovered = info?.recovered;
  }
}

/** Persist creator-app OAuth tokens (open.feishu.cn user_access_token w/ create scope). */
async function cacheCreatorTokens(accessToken?: string, refreshToken?: string, expiresInSec?: number): Promise<void> {
  if (!accessToken) return;
  try {
    await setSetting('feishuCreatorAccessToken', accessToken);
    if (refreshToken) await setSetting('feishuCreatorRefreshToken', refreshToken);
    if (typeof expiresInSec === 'number' && expiresInSec > 0) {
      await setSetting('feishuCreatorTokenExpiry', Date.now() + expiresInSec * 1000 - TOKEN_EXPIRY_MARGIN_MS);
    }
  } catch (err) {
    console.warn('[Feishu Auto Create] Failed to cache creator tokens:', err);
  }
}

/** Try to refresh the cached creator token via the open authen refresh grant. Returns new access token or null. */
async function refreshCreatorToken(): Promise<string | null> {
  try {
    const refreshToken = await getSetting('feishuCreatorRefreshToken');
    if (!refreshToken) return null;
    const { appId, appSecret } = requireFeishuAppCredentials();
    const res = await fetch(`${FEISHU_OPEN_BASE}/open-apis/authen/v2/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: appId,
        client_secret: appSecret,
        refresh_token: refreshToken
      })
    });
    const data = await res.json();
    const accessToken = data.access_token || data.data?.access_token;
    if (!accessToken) return null;
    await cacheCreatorTokens(accessToken, data.refresh_token || data.data?.refresh_token, data.expires_in || data.data?.expires_in);
    return accessToken;
  } catch (err) {
    console.warn('[Feishu Auto Create] Failed to refresh creator token:', err);
    return null;
  }
}

/**
 * Get a creator user_access_token carrying the application:custom_app:create scope.
 * Order: valid cached token -> refresh -> interactive OAuth (opens the window once).
 * After the first authorization, subsequent app create/edit reuse/refresh it silently
 * so no authorization window pops up again.
 */
async function getCreatorUserToken(): Promise<string> {
  const cached = await getSetting('feishuCreatorAccessToken');
  const expiry = await getSetting('feishuCreatorTokenExpiry');
  if (cached && typeof expiry === 'number' && expiry > Date.now()) {
    return cached;
  }
  const refreshed = await refreshCreatorToken();
  if (refreshed) return refreshed;
  const { appId, appSecret } = requireFeishuAppCredentials();
  const authRes = await loginFeishuOAuth(appId, appSecret);
  return authRes.access_token;
}

/** Get a tenant_access_token using the global creator-app credentials (for approve/list/disable). */
async function getCreatorTenantToken(): Promise<string> {
  const { appId, appSecret } = requireFeishuAppCredentials();
  const res = await fetch(`${FEISHU_OPEN_BASE}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret })
  });
  const data = await res.json();
  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`Failed to get tenant access token: [${data.code}] ${data.msg}`);
  }
  return data.tenant_access_token;
}

/**
 * Resolve the current logged-in user's `open_id`, using the same mechanism as
 * listFeishuUserApps: the stored user identity (feishuAccessToken / feishuUserInfo),
 * falling back to interactive OAuth. This binds the bot menu to the current user,
 * not the creator/admin account. Returns null if no open_id can be resolved.
 */
async function getCreatorUserOpenId(): Promise<string | null> {
  let open_id: string | undefined;

  const token = await getValidFeishuAccessToken();
  if (token) {
    const userInfo = await getFeishuUserInfo();
    if (userInfo) {
      open_id = userInfo.open_id;
    }
  }

  if (!open_id) {
    console.log('[Feishu Auto Create] No valid stored token/user found, falling back to loginFeishuOAuth');
    const { appId, appSecret } = requireFeishuAppCredentials();
    const authRes = await loginFeishuOAuth(appId, appSecret);
    open_id = authRes.open_id;
  }

  return open_id ?? null;
}

/** Upload an app avatar; returns the avatar URL, or '' when no icon could be uploaded (best-effort). */
async function uploadAppIcon(userAccessToken: string, iconBase64?: string, iconMimeType?: string): Promise<string> {
  let fileData: Buffer | null = null;
  let filename = 'feishu.svg';

  if (iconBase64) {
    fileData = Buffer.from(iconBase64, 'base64');
    const extension = iconMimeType === 'image/jpeg' ? 'jpg' : iconMimeType === 'image/png' ? 'png' : iconMimeType === 'image/bmp' ? 'bmp' : 'svg';
    filename = `icon.${extension}`;
  } else {
    const iconPaths = [
      app.isPackaged ? join(process.resourcesPath, 'app.asar.unpacked', 'src', 'assets', 'channels', 'feishu.svg') : join(app.getAppPath(), 'src', 'assets', 'channels', 'feishu.svg'),
      join(__dirname, '../../src/assets/channels/feishu.svg')
    ];
    for (const p of iconPaths) {
      if (existsSync(p)) {
        fileData = readFileSync(p);
        break;
      }
    }
  }

  if (!fileData) return '';

  const boundary = '---7MA4YWxkTrZu0gW';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="avatar"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    fileData,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);

  const uploadRes = await fetch(`${FEISHU_OPEN_BASE}/open-apis/application/v7/app_avatar/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${userAccessToken}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`
    },
    body
  });
  const uploadJson = await uploadRes.json();
  if (uploadJson.code === 0 && uploadJson.data?.url) {
    return uploadJson.data.url;
  }
  return '';
}

/** Encrypt and persist app credentials to the provider store (best-effort). */
async function persistFeishuCredentials(appId: string, appSecret: string): Promise<void> {
  try {
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      const { getClawXProviderStore } = await import('../services/providers/store-instance');
      const store = await getClawXProviderStore();
      const credentials = (store.get('credentials') as Record<string, string>) || {};
      credentials['feishuAppId'] = safeStorage.encryptString(appId).toString('hex');
      credentials['feishuAppSecret'] = safeStorage.encryptString(appSecret).toString('hex');
      store.set('credentials', credentials);
    }
  } catch (err) {
    console.warn('Failed to encrypt and store feishu credentials:', err);
  }
}

/** Apply the standard scope/event/callback/security config to an app (shared by create + edit). */
async function applyFeishuAppConfig(appId: string, headers: Record<string, string>): Promise<void> {
  const addScopes = [
    ...FEISHU_SCOPES.tenant.map(scope => ({ scope_name: scope, token_type: 'tenant' })),
    ...FEISHU_SCOPES.user.map(scope => ({ scope_name: scope, token_type: 'user' }))
  ];
  const res = await fetch(`${FEISHU_OPEN_BASE}/open-apis/application/v7/applications/${appId}/config`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      scope: { add_scopes: addScopes },
      event: {
        subscription_type: 'websocket',
        add_events: ['im.message.reaction.created_v1', 'im.message.reaction.deleted_v1', 'im.message.receive_v1']
      },
      callback: { callback_type: 'websocket', add_callbacks: ['card.action.trigger'] },
      security: {
        add: { redirect_urls: ['https://open.feishu.cn/api-explorer/loading', 'http://localhost:17653/oauth/callback'] }
      }
    })
  });
  const json = await res.json();
  if (json.code !== 0) {
    throw new Error(`Failed to update configuration: [${json.code}] ${json.msg}`);
  }
}

/**
 * Feishu bot quick-command menu configuration.
 *
 * The Feishu `send_message` menu action posts the menu item's name verbatim as a
 * user message, and OpenClaw parses a standalone `/command` message as a slash
 * command — so each command item's name IS the command it sends. Commands are
 * locale-invariant literals, so they carry no `i18n_name`; only the grouping
 * parent item is localized, and its labels come from the shared i18n locale
 * files (`autoCreateFeishu.botMenu.menuLabel`) so translations stay in one place.
 */
export const FEISHU_BOT_MENU_COMMANDS = ['/new', '/stop', '/reset', '/status', '/compact'] as const;

/**
 * Localized parent-menu label keyed by Feishu multi-language locale codes. The
 * app's en/zh/ja/ru locales each map to a supported Feishu code. `zh_cn` also
 * doubles as the required default `name`.
 */
export const FEISHU_BOT_MENU_PARENT_I18N = {
  zh_cn: zhChannels.autoCreateFeishu.botMenu.menuLabel,
  en_us: enChannels.autoCreateFeishu.botMenu.menuLabel,
  ja_jp: jaChannels.autoCreateFeishu.botMenu.menuLabel,
  ru_ru: ruChannels.autoCreateFeishu.botMenu.menuLabel
};

/**
 * Build the `POST /open-apis/bot/v3/bot_menu` request body. Each menu item carries
 * `name` (2–60 chars) and `i18n_name` (per the API examples, every item — parent and
 * children — sets `i18n_name`). A leaf item must set exactly one of `behaviors` /
 * `children`. Children each send their own `name` (the slash command) as a message;
 * commands are locale-invariant, so their `i18n_name` repeats the command per locale.
 *
 * NOTE ON FIELD NAME: the Feishu doc's parameter table labels this `default_name`,
 * but both its request and response JSON examples use `name`. Sending `default_name`
 * gets rejected at the gateway with a generic `9499 Bad Request` (unknown field),
 * so we send `name` to match the API's actual (de)serialization.
 *
 * NOTE: this endpoint is the per-user (千人千面) menu API and REQUIRES `user_id`
 * in the body — it cannot set the *global default* menu (that is console-only).
 * Pass `userId` for the per-user variant.
 */
export function buildFeishuBotMenuPayload(userId?: string) {
  const children = FEISHU_BOT_MENU_COMMANDS.map((command) => ({
    name: command,
    // Commands are locale-invariant literals; repeat them across every supported locale.
    i18n_name: Object.fromEntries(
      Object.keys(FEISHU_BOT_MENU_PARENT_I18N).map((locale) => [locale, command])
    ),
    behaviors: [{ type: 'send_message', is_primary: true }]
  }));

  const payload: { bot_menu: { bot_menu_items: unknown[] }; user_id?: string } = {
    bot_menu: {
      bot_menu_items: [
        {
          name: FEISHU_BOT_MENU_PARENT_I18N.zh_cn,
          i18n_name: { ...FEISHU_BOT_MENU_PARENT_I18N },
          children
        }
      ]
    }
  };
  if (userId) payload.user_id = userId;
  return payload;
}

/** Get a tenant_access_token for a specific app using its own app_id/app_secret. */
async function getAppTenantToken(appId: string, appSecret: string): Promise<string> {
  const res = await fetch(`${FEISHU_OPEN_BASE}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret })
  });
  const data = await res.json();
  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`Failed to get tenant access token: [${data.code}] ${data.msg}`);
  }
  return data.tenant_access_token as string;
}

/**
 * Configure the bot's quick-command menu on a created/updated app.
 * Requires the app's `application:bot.menu:write` scope (granted + published).
 * This is the per-user (千人千面) menu API — it needs a `user_id` in the body and
 * a matching `user_id_type` query param. We send the user's `open_id` with
 * `user_id_type=open_id`. Logs the full HTTP response on failure so the real cause
 * is visible; throws so the caller can treat a menu failure as an overall
 * create/update failure.
 */
async function applyFeishuBotMenu(appId: string, appSecret: string, openId: string): Promise<void> {
  const tenantToken = await getAppTenantToken(appId, appSecret);
  // user_id_type must match the id we send in the body (missing/mismatched → 9499 / 40000016).
  const menuQuery = new URLSearchParams({ user_id_type: 'open_id' });
  const url = `${FEISHU_OPEN_BASE}/open-apis/bot/v3/bot_menu?${menuQuery.toString()}`;
  const payload = buildFeishuBotMenuPayload(openId);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tenantToken}`,
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify(payload)
  });
  const rawBody = await res.text();
  let json: { code?: number; msg?: string } | null;
  try {
    json = JSON.parse(rawBody);
  } catch {
    json = null;
  }
  if (!json || json.code !== 0) {
    // Dump everything needed to diagnose: endpoint, HTTP status, request payload, raw body.
    console.error(
      `[feishu] applyFeishuBotMenu failed — POST ${url} => HTTP ${res.status} ${res.statusText}\n` +
        `  request: ${JSON.stringify(payload)}\n` +
        `  response: ${rawBody}`
    );
    throw new Error(`Failed to configure bot menu: [${json?.code ?? 'no-json'}] ${json?.msg ?? rawBody}`);
  }
}

/** Increment the trailing numeric segment of a semver-ish version string. */
function bumpVersion(version: string): string {
  const parts = version.split('.');
  const last = parseInt(parts[parts.length - 1], 10);
  if (!isNaN(last)) {
    parts[parts.length - 1] = String(last + 1);
    return parts.join('.');
  }
  return `${version}.1`;
}

/** Sleep helper for short polling. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Approve a specific app version (audit status -> approved) using the creator tenant token. */
async function approveVersion(appId: string, versionId: string, tenantToken: string): Promise<void> {
  const approveQuery = new URLSearchParams({ operator_id: getGlobalItUserId(), user_id_type: 'user_id' });
  const approveRes = await fetch(
    `${FEISHU_OPEN_BASE}/open-apis/application/v6/applications/${appId}/app_versions/${versionId}?${approveQuery.toString()}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tenantToken}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ status: 1 })
    }
  );
  const approveJson = await approveRes.json();
  if (approveJson.code !== 0) {
    throw new Error(`Failed to approve app: [${approveJson.code}] ${approveJson.msg}`);
  }
}

/** Look up the under-audit (pending approval) version id for a specific app, or null. */
async function findPendingVersionId(appId: string, tenantToken: string): Promise<string | null> {
  let pageToken = '';
  let hasMore = true;
  while (hasMore) {
    const url = new URL(`${FEISHU_OPEN_BASE}/open-apis/application/v6/applications/underauditlist`);
    url.searchParams.append('page_size', '50');
    url.searchParams.append('lang', 'zh_cn');
    if (pageToken) url.searchParams.append('page_token', pageToken);
    const res = await fetch(url.toString(), { method: 'GET', headers: { Authorization: `Bearer ${tenantToken}` } });
    const data = await res.json();
    if (data.code !== 0) return null;
    const items: { app_id?: string; unaudit_version_id?: string }[] = data.data?.items || [];
    const match = items.find((it) => it.app_id === appId);
    if (match?.unaudit_version_id) return match.unaudit_version_id;
    hasMore = data.data?.has_more || false;
    pageToken = data.data?.page_token || '';
  }
  return null;
}

/**
 * Review status of an app version, from GET app_versions/{version_id}. The enum is fixed
 * by Feishu: 0=unknown, 1=审核通过(approved), 2=审核拒绝(rejected), 3=审核中(under audit),
 * 4=未提交审核. "Online" is not a status — it is tracked by the app's online_version_id.
 * Only the two states we branch on are named below; the others are documented for reference.
 */
const VERSION_STATUS_APPROVED = 1;
const VERSION_STATUS_REJECTED = 2;

/** True when the version already passed review, so an approve call would fail with [211006]. */
function isPastAudit(status: number): boolean {
  return status === VERSION_STATUS_APPROVED;
}

/** True when the version is in a terminal failure state where retrying the approve won't help. */
function isTerminalFailure(status: number): boolean {
  return status === VERSION_STATUS_REJECTED;
}

/**
 * Fetch the review status of a specific app version, or null on error. Used to decide
 * whether a freshly-published version still needs approving.
 */
async function getAppVersionStatus(appId: string, versionId: string, tenantToken: string): Promise<number | null> {
  try {
    const res = await fetch(
      `${FEISHU_OPEN_BASE}/open-apis/application/v6/applications/${appId}/app_versions/${versionId}?lang=zh_cn`,
      { method: 'GET', headers: { Authorization: `Bearer ${tenantToken}` } }
    );
    const data = (await res.json()) as { code?: number; data?: { app_version?: { status?: number } } };
    if (data.code !== 0) return null;
    const status = data.data?.app_version?.status;
    return typeof status === 'number' ? status : null;
  } catch {
    return null;
  }
}

/**
 * Best-effort sweep: find any under-audit (pending) version of the app and approve it.
 * The lark-cli setup step can publish a second version (e.g. 1.0.1) that bypasses the
 * publish-time approval; this catches it so the user never needs manual review.
 * Polls a few times because the CLI publish may land slightly after its command returns.
 * Never throws.
 */
async function approvePendingVersions(appId: string, attempts = 3, delayMs = 3000): Promise<void> {
  try {
    const tenantToken = await getCreatorTenantToken();
    for (let i = 0; i < attempts; i++) {
      const pendingId = await findPendingVersionId(appId, tenantToken);
      if (pendingId) {
        await approveVersion(appId, pendingId, tenantToken);
        const { logger } = await import('./logger');
        logger.info(`[Feishu Auto Create] Approved pending version ${pendingId} for ${appId}`);
        return;
      }
      if (i < attempts - 1) await sleep(delayMs);
    }
  } catch (err) {
    const { logger } = await import('./logger');
    logger.warn(`[Feishu Auto Create] approvePendingVersions error for ${appId}: ${err}`);
  }
}

/**
 * Approve the version just created by a publish call. Two scenarios:
 * 1. Race — a freshly-published version does not enter the "under audit" state
 *    instantly, and its audit version id can differ from the publish-returned
 *    version_id. Poll underauditlist for the real audit id (falling back to the
 *    published id) and retry.
 * 2. Auto-approval — for an already-online app the tenant may auto-approve the new
 *    version, putting it straight into 审核通过(1). Approving that fails with
 *    [211006] "no available audit of desired version", so check the version status
 *    first and skip when it is already approved.
 *
 * Only throw once retries are exhausted so genuine failures still surface (and
 * trigger the caller's revert).
 */
async function approvePublishedVersion(
  appId: string,
  publishedVersionId: string,
  tenantToken: string,
  attempts = 5,
  delayMs = 2000
): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    // 1. underauditlist has a pending version — approve it (covers the publish-time race).
    const pendingId = await findPendingVersionId(appId, tenantToken);
    if (pendingId) {
      try {
        await approveVersion(appId, pendingId, tenantToken);
        return;
      } catch (err) {
        lastErr = err;
        if (i < attempts - 1) await sleep(delayMs);
        continue;
      }
    }

    // 2. No pending audit version — check the published version's status before approving.
    const status = await getAppVersionStatus(appId, publishedVersionId, tenantToken);
    if (status !== null) {
      if (isPastAudit(status)) return;
      if (isTerminalFailure(status)) {
        throw new Error(`App version ${publishedVersionId} rejected (status=${status}); cannot approve`);
      }
      // status === UNDER_AUDIT / NOT_SUBMITTED / UNKNOWN → fall through and try approving.
    }

    // 3. Still in-flight (under audit but not yet in underauditlist, or not yet submitted)
    //    — try approving the publish-returned id, then retry.
    try {
      await approveVersion(appId, publishedVersionId, tenantToken);
      return;
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await sleep(delayMs);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Publish a new app version and auto-approve it. Retries with an incremented
 * version when the publish fails due to a version conflict. Returns the version_id.
 */
async function publishAndApprove(
  appId: string,
  userAccessToken: string,
  strings: FeishuAutoCreateStrings,
  initialVersion: string
): Promise<string | undefined> {
  const headers = {
    Authorization: `Bearer ${userAccessToken}`,
    'Content-Type': 'application/json; charset=utf-8'
  };
  const MAX_ATTEMPTS = 5;
  let version = initialVersion;
  let publishJson: { code: number; msg?: string; data?: { version_id?: string } } | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const publishRes = await fetch(`${FEISHU_OPEN_BASE}/open-apis/application/v7/applications/${appId}/publish`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        mobile_default_ability: 'bot',
        pc_default_ability: 'bot',
        remark: formatTemplate(strings.publishRemark, { productName: strings.productName }),
        changelog: formatTemplate(strings.publishChangelog, { productName: strings.productName }),
        version
      })
    });
    publishJson = await publishRes.json();
    if (publishJson && publishJson.code === 0) break;

    const msg = String(publishJson?.msg || '');
    const looksLikeVersionConflict = /version|版本/i.test(msg);
    if (attempt < MAX_ATTEMPTS - 1 && looksLikeVersionConflict) {
      version = bumpVersion(version);
      continue;
    }
    throw new Error(`Failed to publish app: [${publishJson?.code}] ${publishJson?.msg}`);
  }

  const versionId = publishJson?.data?.version_id;
  if (versionId) {
    const tenantToken = await getCreatorTenantToken();
    await approvePublishedVersion(appId, versionId, tenantToken);
  }
  return versionId;
}

/**
 * Best-effort disable a Feishu app. Feishu has no hard-delete API, so disabling
 * is the strongest programmatic cleanup; the user finishes deletion in the console.
 * Never throws.
 */
export async function disableFeishuApp(appId: string): Promise<{ disabled: boolean; manageUrl: string }> {
  const manageUrl = `${FEISHU_OPEN_BASE}/app/${appId}/baseinfo?lang=zh_cn`;
  try {
    const tenantToken = await getCreatorTenantToken();
    const res = await fetch(`${FEISHU_OPEN_BASE}/open-apis/application/v6/applications/${appId}/management`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tenantToken}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ enable: false })
    });
    const data = await res.json();
    if (data.code !== 0) {
      const { logger } = await import('./logger');
      logger.warn(`[Feishu Auto Create] disableFeishuApp failed for ${appId}: [${data.code}] ${data.msg}`);
      return { disabled: false, manageUrl };
    }
    return { disabled: true, manageUrl };
  } catch (err) {
    const { logger } = await import('./logger');
    logger.warn(`[Feishu Auto Create] disableFeishuApp error for ${appId}: ${err}`);
    return { disabled: false, manageUrl };
  }
}

/** Best-effort restore of an app's name/avatar to a previous snapshot. Never throws. */
async function restoreBaseInfo(appId: string, userAccessToken: string, appName: string, avatarUrl: string): Promise<void> {
  try {
    const patchBody: { i18ns: { i18n_key: string; name: string }[]; avatar_url?: string } = {
      i18ns: [{ i18n_key: 'zh_cn', name: appName }]
    };
    if (avatarUrl) patchBody.avatar_url = avatarUrl;
    await fetch(`${FEISHU_OPEN_BASE}/open-apis/application/v7/applications/${appId}/base`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${userAccessToken}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(patchBody)
    });
  } catch (err) {
    const { logger } = await import('./logger');
    logger.warn(`[Feishu Auto Create] restoreBaseInfo error for ${appId}: ${err}`);
  }
}

export interface FeishuCreateResult {
  appId: string;
  appSecret: string;
  larkCliReady: boolean;
  larkCliError?: string;
}

export async function autoCreateFeishuApp(
  appName: string,
  strings: FeishuAutoCreateStrings,
  iconBase64?: string,
  iconMimeType?: string
): Promise<FeishuCreateResult> {
  const userAccessToken = await getCreatorUserToken();
  const headers = {
    Authorization: `Bearer ${userAccessToken}`,
    'Content-Type': 'application/json; charset=utf-8'
  };

  // Step 1: Upload icon (before the app exists; best-effort).
  const avatarUrl = await uploadAppIcon(userAccessToken, iconBase64, iconMimeType);

  // Step 2: Create app.
  const createRes = await fetch(`${FEISHU_OPEN_BASE}/open-apis/application/v7/applications`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      i18n: [{ i18n_key: 'zh_cn', name: appName }],
      ...(avatarUrl ? { avatar: avatarUrl } : {})
    })
  });
  const createJson = await createRes.json();
  if (createJson.code !== 0) {
    throw new FeishuAppError(`Failed to create app: [${createJson.code}] ${createJson.msg}`);
  }
  const appId = createJson.data.app_id as string;
  const appSecret = createJson.data.app_secret as string;

  // From here the app EXISTS. Any failure disables it so no enabled orphan is left behind.
  try {
    await persistFeishuCredentials(appId, appSecret);

    // Step 3: Enable bot ability.
    const enableBotRes = await fetch(`${FEISHU_OPEN_BASE}/open-apis/application/v7/applications/${appId}/ability`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        bot: { enable: true, i18ns: [{ i18n_key: 'zh_cn', get_started_desc: '欢迎使用该机器人' }] }
      })
    });
    const enableBotJson = await enableBotRes.json();
    if (enableBotJson.code !== 0) {
      throw new Error(`Failed to enable bot ability: [${enableBotJson.code}] ${enableBotJson.msg}`);
    }

    // Step 4: Apply scope/event/callback/security config.
    await applyFeishuAppConfig(appId, headers);

    // Step 5: Publish + auto-approve.
    await publishAndApprove(appId, userAccessToken, strings, '1.0.0');

    // Step 6: Configure Lark CLI (non-blocking — the app is already created and published).
    const larkCliRes = await configureLarkCli(appId, appSecret);

    // Step 7: lark-cli setup can publish a second version (e.g. 1.0.1) that bypasses
    // the publish-time approval. Sweep & approve any pending version so the user never
    // needs manual review. Runs regardless of CLI success (it may have published before failing).
    await approvePendingVersions(appId);

    // Step 8: Configure the bot quick-command menu (best-effort, non-blocking).
    // Keyed by the user's open_id. A failure must NOT fail/disable the whole app;
    // the full API response is logged inside applyFeishuBotMenu.
    try {
      const menuOpenId = await getCreatorUserOpenId();
      if (menuOpenId) {
        await applyFeishuBotMenu(appId, appSecret, menuOpenId);
      } else {
        console.warn('[feishu] bot menu skipped: could not resolve the current user open_id');
      }
    } catch (menuErr) {
      console.error('[feishu] bot menu setup skipped (non-fatal):', menuErr);
    }

    return {
      appId,
      appSecret,
      larkCliReady: larkCliRes.success,
      larkCliError: larkCliRes.success ? undefined : larkCliRes.error
    };
  } catch (err) {
    const cleanup = await disableFeishuApp(appId);
    throw new FeishuAppError(
      err instanceof Error ? err.message : String(err),
      { disabledAppId: appId, manageUrl: cleanup.manageUrl },
      { cause: err }
    );
  }
}

export async function getFeishuAppInfo(appId: string, appSecret: string) {
  const tokenRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret })
  });
  const tokenData: any = await tokenRes.json();
  if (tokenData.code !== 0 || !tokenData.tenant_access_token) {
    throw new Error(`Failed to get tenant access token: [${tokenData.code}] ${tokenData.msg}`);
  }

  const infoRes = await fetch(`https://open.feishu.cn/open-apis/application/v6/applications/${appId}?lang=zh_cn`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${tokenData.tenant_access_token}`,
    }
  });
  const infoData: any = await infoRes.json();
  if (infoData.code !== 0) {
    throw new Error(`Failed to get app info: [${infoData.code}] ${infoData.msg}`);
  }
  let version = '1.0.0';
  let online_version_id = infoData.data?.app?.online_version_id;

  if (online_version_id) {
    const verRes = await fetch(`https://open.feishu.cn/open-apis/application/v6/applications/${appId}/app_versions/${online_version_id}?lang=zh_cn`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${tokenData.tenant_access_token}`,
      }
    });
    const verData: any = await verRes.json();
    if (verData.code === 0 && verData.data?.app_version?.version) {
      version = verData.data.app_version.version;
    } else {
      console.warn(`Failed to get app version info: [${verData.code}] ${verData.msg}`);
    }
  }

  return {
    appName: infoData.data?.app?.app_name || '',
    avatarUrl: infoData.data?.app?.avatar_url || '',
    version,
  };
}

export interface FeishuUpdateResult {
  success: true;
  larkCliReady: boolean;
  larkCliError?: string;
}

export async function updateFeishuAppInfo(
  appId: string,
  appSecret: string,
  strings: FeishuAutoCreateStrings,
  appName: string,
  iconBase64?: string,
  iconMimeType?: string
): Promise<FeishuUpdateResult> {
  const userAccessToken = await getCreatorUserToken();
  const headers = {
    Authorization: `Bearer ${userAccessToken}`,
    'Content-Type': 'application/json; charset=utf-8'
  };

  // Snapshot the current name/avatar/version so we can atomically restore on failure.
  const snapshot = await getFeishuAppInfo(appId, appSecret);

  try {
    // Step 1: Upload icon (best-effort; keeps old icon if the new one can't be uploaded).
    const avatarUrl = await uploadAppIcon(userAccessToken, iconBase64, iconMimeType);

    // Step 2: Update base info (name + avatar).
    const patchBody: { i18ns: { i18n_key: string; name: string }[]; avatar_url?: string } = {
      i18ns: [{ i18n_key: 'zh_cn', name: appName }]
    };
    if (avatarUrl) patchBody.avatar_url = avatarUrl;
    const patchRes = await fetch(`${FEISHU_OPEN_BASE}/open-apis/application/v7/applications/${appId}/base`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(patchBody)
    });
    const patchJson = await patchRes.json();
    if (patchJson.code !== 0) {
      throw new Error(`Failed to update app info: [${patchJson.code}] ${patchJson.msg}`);
    }

    // Step 3: Apply scope/event/callback/security config.
    await applyFeishuAppConfig(appId, headers);

    // Step 4: Publish + auto-approve, starting from the next version after the snapshot.
    await publishAndApprove(appId, userAccessToken, strings, bumpVersion(snapshot.version || '1.0.0'));

    // Step 5: Configure Lark CLI (non-blocking).
    const larkCliRes = await configureLarkCli(appId, appSecret);

    // Step 6: Approve any pending version the CLI setup may have published (see autoCreate).
    await approvePendingVersions(appId);

    // Step 7: Re-apply the bot quick-command menu (best-effort, non-blocking).
    // Keyed by the user's open_id. A failure must NOT roll back the update; the
    // full API response is logged inside applyFeishuBotMenu.
    try {
      const menuOpenId = await getCreatorUserOpenId();
      if (menuOpenId) {
        await applyFeishuBotMenu(appId, appSecret, menuOpenId);
      } else {
        console.warn('[feishu] bot menu skipped: could not resolve the current user open_id');
      }
    } catch (menuErr) {
      console.error('[feishu] bot menu setup skipped (non-fatal):', menuErr);
    }

    return {
      success: true,
      larkCliReady: larkCliRes.success,
      larkCliError: larkCliRes.success ? undefined : larkCliRes.error
    };
  } catch (err) {
    // Log the real failure before it gets wrapped in the user-facing "recovered" error.
    console.error('[feishu] updateFeishuAppInfo failed:', err);
    // Atomically restore the user-visible name/avatar to the pre-edit snapshot.
    await restoreBaseInfo(appId, userAccessToken, snapshot.appName, snapshot.avatarUrl);
    throw new FeishuAppError(
      err instanceof Error ? err.message : String(err),
      { disabledAppId: appId, manageUrl: `${FEISHU_OPEN_BASE}/app/${appId}/baseinfo?lang=zh_cn`, recovered: true },
      { cause: err }
    );
  }
}

export async function configureLarkCli(appId: string, appSecret: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { spawn } = await import('node:child_process');
    const { logger } = await import('./logger');

    const isWindows = process.platform === 'win32';
    let larkBinPath = '';
    const binName = isWindows ? 'lark-cli.exe' : 'lark-cli';

    if (app.isPackaged) {
      larkBinPath = join(process.resourcesPath, 'bin', binName);
    } else {
      const platform = process.platform;
      const arch = process.arch;
      const target = `${platform}-${arch}`;
      larkBinPath = join(process.cwd(), 'resources', 'bin', target, binName);
    }
    
    const { existsSync } = await import('fs');
    if (!existsSync(larkBinPath)) {
      throw new Error(`lark-cli binary not found at ${larkBinPath}.`);
    }

    // Helper function to run a command, capture URL, and open browser
    const runAuthCommand = (args: string[], stepName: string, stdinData?: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        logger.info(`[lark:auth] ${stepName}: Running lark ${args.join(' ')}`);
        const child = spawn(larkBinPath, args);
        
        if (stdinData) {
          child.stdin.write(stdinData);
          child.stdin.end();
        }
        
      let urlOpened = false;
      let outputLog = ''; // Accumulate output

      const handleOutput = (data: Buffer) => {
        const text = data.toString();
        outputLog += text; // Save output
        
        // Extract URL from stdout/stderr. The new CLI outputs to stderr,
        // and the URL format is https://accounts.feishu.cn/...
        // eslint-disable-next-line no-control-regex -- \x1b strips trailing ANSI from the matched URL
        const urlMatch = text.match(/https:\/\/(?:accounts\.feishu\.cn|passport\.feishu\.cn|open\.feishu\.cn|open\.larksuite\.com)\/[^\s\x1b]+/);
        if (urlMatch && !urlOpened) {
          urlOpened = true;
          logger.info(`[lark:auth] ${stepName}: Opening URL in auth window: ${urlMatch[0]}`);
          openAuthWindow({ url: urlMatch[0] });
        }
      };

      child.stdout.on('data', handleOutput);
      child.stderr.on('data', handleOutput);

      child.on('close', (code) => {
        logger.info(`[lark:auth] ${stepName} exited with code ${code}`);
        closeAuthWindow();
        if (code === 0) {
          resolve();
        } else {
          // Include the accumulated output in the error message
          // eslint-disable-next-line no-control-regex -- strip ANSI color escape codes from CLI output
          const cleanOutput = outputLog.trim().replace(/\x1b\[[0-9;]*m/g, ''); // Remove ANSI escape codes
          const errorMsg = `${stepName} failed with exit code ${code}.\nOutput:\n${cleanOutput || 'No output'}`;
          reject(new Error(errorMsg));
        }
      });
      });
    };

    // Step 1: Initialize App Credentials silently via stdin
    await runAuthCommand(['config', 'init', '--app-id', appId, '--app-secret-stdin'], 'Step 1 (Config Init)', appSecret);

    // Step 2: Strict Mode to off
    await runAuthCommand(['config', 'strict-mode', 'off'], 'Step 2 (Strict Mode)');

    // Step 3: User Login
    await runAuthCommand(['auth', 'login', '--domain', 'all'], 'Step 3 (Auth Login)');

    // // Step 4: Auto-approve (PATCH app version audit status to approved)
    // const { appId: creatorAppId, appSecret: creatorAppSecret } = requireFeishuAppCredentials();
    // const tokenRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json; charset=utf-8' },
    //   body: JSON.stringify({
    //     app_id: creatorAppId,
    //     app_secret: creatorAppSecret
    //     })
    //   });
    //   const tokenData: any = await tokenRes.json();
    //   if (tokenData.code !== 0 || !tokenData.tenant_access_token) {
    //     throw new Error(`Failed to get tenant access token: [${tokenData.code}] ${tokenData.msg}`);
    //   }

    //   const approveQuery = new URLSearchParams({
    //     operator_id: getGlobalItUserId(),
    //     user_id_type: 'user_id'
    //   });
    //   const approveRes = await fetch(
    //     `https://open.feishu.cn/open-apis/application/v6/applications/${appId}/app_versions/${versionId}?${approveQuery.toString()}`,
    //     {
    //       method: 'PATCH',
    //       headers: {
    //         Authorization: `Bearer ${tokenData.tenant_access_token}`,
    //         'Content-Type': 'application/json; charset=utf-8'
    //       },
    //       body: JSON.stringify({ status: 1 })
    //     }
    //   );
    //   const approveJson: any = await approveRes.json();
    //   if (approveJson.code !== 0) {
    //     throw new Error(`Failed to approve app: [${approveJson.code}] ${approveJson.msg}`);
    //   }

    return { success: true };
  } catch (error) {
    const { logger } = await import('./logger');
    logger.error(`[lark:auth] Error: ${error}`);
    return { success: false, error: String(error) };
  }
}

export async function listFeishuUserApps() {
  let open_id: string | undefined;

  const { appId: creatorAppId, appSecret: creatorAppSecret } = requireFeishuAppCredentials();

  const token = await getValidFeishuAccessToken();
  if (token) {
    const userInfo = await getFeishuUserInfo();
    if (userInfo) {
      open_id = userInfo.open_id;
    }
  }

  if (!open_id) {
    console.log('[Feishu Auto Create] No valid stored token/user found, falling back to loginFeishuOAuth');
    const authRes = await loginFeishuOAuth(creatorAppId, creatorAppSecret);
    open_id = authRes.open_id;
  }

  const tokenRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: creatorAppId, app_secret: creatorAppSecret })
  });
  const tokenData: any = await tokenRes.json();
  if (tokenData.code !== 0 || !tokenData.tenant_access_token) {
    throw new Error(`Failed to get tenant access token: [${tokenData.code}] ${tokenData.msg}`);
  }

  let allApps: any[] = [];
  let hasMore = true;
  let pageToken = '';

  while (hasMore) {
    const url = new URL('https://open.feishu.cn/open-apis/application/v6/applications');
    url.searchParams.append('page_size', '50');
    url.searchParams.append('lang', 'zh_cn');
    if (pageToken) {
      url.searchParams.append('page_token', pageToken);
    }

    const listRes = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${tokenData.tenant_access_token}`,
      }
    });
    const listData: any = await listRes.json();
    if (listData.code !== 0) {
      throw new Error(`Failed to get applications: [${listData.code}] ${listData.msg}`);
    }

    const items = listData.data?.app_list || [];
    allApps = allApps.concat(items);

    hasMore = listData.data?.has_more || false;
    pageToken = listData.data?.page_token || '';
  }

  // Fetch underaudit (pending approval) applications
  let underauditApps: any[] = [];
  let underauditHasMore = true;
  let underauditPageToken = '';

  while (underauditHasMore) {
    const url = new URL('https://open.feishu.cn/open-apis/application/v6/applications/underauditlist');
    url.searchParams.append('page_size', '50');
    url.searchParams.append('lang', 'zh_cn');
    if (underauditPageToken) {
      url.searchParams.append('page_token', underauditPageToken);
    }

    const underauditRes = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${tokenData.tenant_access_token}`,
      }
    });
    const underauditData: any = await underauditRes.json();
    if (underauditData.code !== 0) {
      console.warn(`Failed to get underaudit applications: [${underauditData.code}] ${underauditData.msg}`);
      break;
    }

    const items = underauditData.data?.items || [];
    underauditApps = underauditApps.concat(items);

    underauditHasMore = underauditData.data?.has_more || false;
    underauditPageToken = underauditData.data?.page_token || '';
  }

  // Build a map of underaudit apps by app_id for quick lookup
  const underauditMap = new Map<string, any>();
  for (const app of underauditApps) {
    underauditMap.set(app.app_id, app);
  }

  const userApps = allApps
    .filter((app: any) => app.creator_id === open_id)
    .map((app: any) => {
      const underauditApp = underauditMap.get(app.app_id);
      // If app is in underaudit list, pending_approval status takes priority
      if (underauditApp) {
        return {
          appId: app.app_id,
          appName: app.app_name,
          avatarUrl: app.avatar_url,
          status: 'pending_approval',
          unauditVersionId: underauditApp.unaudit_version_id || null,
        };
      }
      return {
        appId: app.app_id,
        appName: app.app_name,
        avatarUrl: app.avatar_url,
        status: app.status === 1 ? 'enabled' : app.status === 0 ? 'disabled' : 'other',
      };
    });

  return userApps;
}

export async function deleteFeishuUserApp(appId: string) {
  const { appId: creatorAppId, appSecret: creatorAppSecret } = requireFeishuAppCredentials();
  const tokenRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: creatorAppId, app_secret: creatorAppSecret })
  });
  const tokenData: any = await tokenRes.json();
  if (tokenData.code !== 0 || !tokenData.tenant_access_token) {
    throw new Error(`Failed to get tenant access token: [${tokenData.code}] ${tokenData.msg}`);
  }

  const disableRes = await fetch(`https://open.feishu.cn/open-apis/application/v6/applications/${appId}/management`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${tokenData.tenant_access_token}`,
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify({ enable: false })
  });
  
  const disableData: any = await disableRes.json();
  if (disableData.code !== 0) {
    throw new Error(`Failed to disable application: [${disableData.code}] ${disableData.msg}`);
  }

  return {
    success: true,
    url: `https://open.feishu.cn/app/${appId}/baseinfo?lang=zh_cn`
  };
}
