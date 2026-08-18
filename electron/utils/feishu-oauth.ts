// @ts-nocheck
import { logger } from './logger';
import { getSetting, setSetting } from './store';

const FEISHU_REDIRECT_URI = 'http://localhost:17653/oauth/callback';

export interface FeishuUserInfo {
  name: string;
  en_name?: string;
  avatar_url: string;
  avatar_thumb: string;
  avatar_middle: string;
  avatar_big: string;
  open_id: string;
  union_id: string;
  tenant_key: string;
}

export interface FeishuLoginResult {
  success: boolean;
  userInfo?: FeishuUserInfo;
  error?: string;
}

/**
 * Feishu application credentials. These are secrets and must never be hardcoded:
 * supply them through the FEISHU_APP_ID / FEISHU_APP_SECRET environment variables
 * (see .env.example). Returns empty strings when unset so callers can surface a
 * configuration error instead of calling the API with bogus credentials.
 */
export function getFeishuAppCredentials(): { appId: string; appSecret: string } {
  return {
    appId: (process.env.FEISHU_APP_ID ?? '').trim(),
    appSecret: (process.env.FEISHU_APP_SECRET ?? '').trim(),
  };
}

/** Same as getFeishuAppCredentials, but throws a descriptive error when either value is missing. */
export function requireFeishuAppCredentials(): { appId: string; appSecret: string } {
  const { appId, appSecret } = getFeishuAppCredentials();
  const missing: string[] = [];
  if (!appId) missing.push('FEISHU_APP_ID');
  if (!appSecret) missing.push('FEISHU_APP_SECRET');
  if (missing.length > 0) {
    throw new Error(`FEISHU_CONFIG_MISSING: set ${missing.join(' and ')} in the environment (see .env.example)`);
  }
  return { appId, appSecret };
}

export async function getFeishuConfig() {
  return getFeishuAppCredentials();
}

export async function handleFeishuLogin(tmpCode: string): Promise<FeishuLoginResult> {
  try {
    const { appId, appSecret } = await getFeishuConfig();
    
    if (!appId || !appSecret) {
      logger.error('[Feishu OAuth] Missing App ID or App Secret');
      throw new Error('CONFIG_MISSING');
    }

    // 1. 拦截 302 重定向获取 code
    // 注意：飞书扫码登录，tmp_code 必须作为 GET 参数拼接在 authorize URL 上，不能放 body
    const authorizeUrl = `https://passport.feishu.cn/suite/passport/oauth/authorize?client_id=${appId}&redirect_uri=${encodeURIComponent(FEISHU_REDIRECT_URI)}&response_type=code&state=RANDOMSTATE&tmp_code=${tmpCode}`;
    
    // We must manually handle the redirect to extract the code
    const authRes = await fetch(authorizeUrl, {
      method: 'GET',
      redirect: 'manual', // 阻止自动重定向
    });

    // Node 18+ Fetch API will sometimes follow redirects even with 'manual' depending on the implementation
    // Let's check the final URL as well as the headers
    let code: string | null = null;
    let errorDesc: string | null = null;

    if (authRes.status === 302 || authRes.status === 301) {
      const location = authRes.headers.get('location');
      if (location) {
        const url = new URL(location);
        code = url.searchParams.get('code');
        errorDesc = url.searchParams.get('error_description') || url.searchParams.get('error');
      }
    } else {
      // If redirect was followed or handled differently
      const url = new URL(authRes.url);
      code = url.searchParams.get('code');
      errorDesc = url.searchParams.get('error_description') || url.searchParams.get('error');
    }

    if (errorDesc) {
      logger.error(`[Feishu OAuth] Auth validation failed: ${errorDesc}`);
      throw new Error(`AUTH_FAILED: ${errorDesc}`);
    }

    if (!code) {
      // Some versions of fetch + redirect manual will put the response in the location header,
      // but others might follow it if the host is the same, or expose it in response.headers.get('location')
      logger.error('[Feishu OAuth] Cannot extract code. Status:', authRes.status, 'URL:', authRes.url);
      try {
        const text = await authRes.text();
        logger.error('[Feishu OAuth] Response body (first 500 chars):', text.substring(0, 500));
        
        // Sometimes the code is embedded in the HTML response if it's a 200 OK
        const codeMatch = text.match(/code=([a-zA-Z0-9]+)/);
        if (codeMatch && codeMatch[1]) {
          code = codeMatch[1];
          logger.info('[Feishu OAuth] Extracted code from HTML body');
        }
      } catch (e) {
        // Ignore read errors
      }

      if (!code) {
        logger.error('[Feishu OAuth] Failed to extract authorization code (tmp_code may be expired or invalid)');
        throw new Error('AUTH_CODE_MISSING');
      }
    }

    // 2. 用 code 换取 access_token
    const tokenUrl = 'https://passport.feishu.cn/suite/passport/oauth/token';
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: appId,
      client_secret: appSecret,
      code,
      redirect_uri: FEISHU_REDIRECT_URI,
    });

    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      logger.error(`[Feishu OAuth] Failed to fetch Token (HTTP ${tokenRes.status}): ${errText}`);
      throw new Error(`TOKEN_FETCH_FAILED: ${errText}`);
    }

    const tokenData = await tokenRes.json();
    if (tokenData.code !== 0 && !tokenData.access_token) {
      logger.error(`[Feishu OAuth] Failed to fetch Token (API Error): ${JSON.stringify(tokenData)}`);
      throw new Error(`TOKEN_FETCH_FAILED: ${JSON.stringify(tokenData)}`);
    }

    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;

    // 3. 用 access_token 获取用户信息
    const userUrl = 'https://passport.feishu.cn/suite/passport/oauth/userinfo';
    const userRes = await fetch(userUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!userRes.ok) {
      const errText = await userRes.text();
      logger.error(`[Feishu OAuth] Failed to fetch user info (HTTP ${userRes.status}): ${errText}`);
      throw new Error(`USER_INFO_FAILED: ${errText}`);
    }

    const userData = await userRes.json();
    
    // Save to settings or secure storage
    await setSetting('feishuAccessToken', accessToken);
    await setSetting('feishuRefreshToken', refreshToken);
    await setSetting('feishuUserInfo', userData);

    return {
      success: true,
      userInfo: userData,
    };
  } catch (error) {
    logger.error('[Feishu OAuth] Login failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function refreshFeishuToken(): Promise<string | null> {
  try {
    const { appId, appSecret } = await getFeishuConfig();
    const refreshToken = await getSetting('feishuRefreshToken');

    if (!appId || !appSecret || !refreshToken) {
      return null;
    }

    const tokenUrl = 'https://passport.feishu.cn/suite/passport/oauth/token';
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: appId,
      client_secret: appSecret,
      refresh_token: refreshToken,
    });

    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!tokenRes.ok) {
      logger.error('[Feishu OAuth] Failed to refresh token, status:', tokenRes.status);
      return null;
    }

    const tokenData = await tokenRes.json();
    if (tokenData.code !== 0 && !tokenData.access_token) {
      logger.error('[Feishu OAuth] Failed to refresh token:', tokenData);
      return null;
    }

    const newAccessToken = tokenData.access_token;
    const newRefreshToken = tokenData.refresh_token;

    await setSetting('feishuAccessToken', newAccessToken);
    await setSetting('feishuRefreshToken', newRefreshToken);

    return newAccessToken;
  } catch (err) {
    logger.error('[Feishu OAuth] Error refreshing token:', err);
    return null;
  }
}

export async function getFeishuUserInfo(): Promise<FeishuUserInfo | null> {
  const userInfo = await getSetting('feishuUserInfo');
  return userInfo ? (userInfo as FeishuUserInfo) : null;
}

export async function getValidFeishuAccessToken(): Promise<string | null> {
  let accessToken = await getSetting('feishuAccessToken');
  
  if (!accessToken) {
    return null;
  }

  // 验证当前 token 是否还有效
  try {
    const userUrl = 'https://passport.feishu.cn/suite/passport/oauth/userinfo';
    const userRes = await fetch(userUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (userRes.ok) {
      return accessToken as string;
    }
  } catch (err) {
    logger.warn('[Feishu OAuth] Error validating token, trying to refresh', err);
  }

  // Token 失效或请求失败，尝试刷新
  logger.info('[Feishu OAuth] Token might be expired, refreshing...');
  accessToken = await refreshFeishuToken();
  return accessToken;
}
