/**
 * Vendor-endpoint configuration — the single place that resolves where (and
 * whether) the app talks to the YYClaw "Farm" server.
 *
 * Precedence: process env override > package.json default.
 *
 * Resolution lives in the Main process on purpose: Main can read `process.env`
 * at runtime, so an operator can point a build at their own server without a
 * rebuild. The renderer must not read these directly — it receives the resolved
 * values over host-api (see `providers.catalogSource`).
 */
import pkg from '../../package.json';

type VendorConfig = {
  farmEnabled?: boolean;
  farmApiBaseUrl?: string;
  providerCatalogSource?: string;
};

const config = pkg as VendorConfig;

function envString(name: string): string | null {
  const raw = process.env[name];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

/**
 * Farm API base (scheme + host + port, no trailing slash), or null when the app
 * is not pointed at any server.
 *
 * Override: `YYCLAW_FARM_API_BASE_URL`.
 */
export function resolveFarmApiBaseUrl(): string | null {
  const fromEnv = envString('YYCLAW_FARM_API_BASE_URL');
  if (fromEnv) return stripTrailingSlashes(fromEnv);

  const raw = String(config.farmApiBaseUrl ?? '').trim();
  if (!raw) return null;
  return stripTrailingSlashes(raw);
}

/** @deprecated Use {@link resolveFarmApiBaseUrl}. Kept so existing imports keep compiling. */
export const getFarmApiBaseUrl = resolveFarmApiBaseUrl;

/**
 * Whether Farm-backed features (realtime control channel, server skill
 * marketplace) may run at all. Requires both an explicit opt-in and a base URL.
 *
 * Override: `YYCLAW_FARM_ENABLED` ("true"/"1" to enable, anything else to disable).
 */
export function isFarmEnabled(): boolean {
  if (!resolveFarmApiBaseUrl()) return false;

  const fromEnv = envString('YYCLAW_FARM_ENABLED');
  if (fromEnv) return fromEnv === 'true' || fromEnv === '1';

  return config.farmEnabled === true;
}

export type ProviderCatalogSource = 'local' | 'remote';

/**
 * Where the AI provider catalog comes from:
 * - `local`  — bundled `resources/config/providers.json` only, no network call.
 * - `remote` — fetch `<farmBase>/api/v1/provider-catalog`, falling back to local.
 *
 * `remote` requires a Farm base URL; without one this degrades to `local`.
 *
 * Override: `YYCLAW_PROVIDER_CATALOG_SOURCE`.
 */
export function resolveProviderCatalogSource(): ProviderCatalogSource {
  const requested = (
    envString('YYCLAW_PROVIDER_CATALOG_SOURCE')
    ?? String(config.providerCatalogSource ?? '').trim()
  ).toLowerCase();

  if (requested !== 'remote') return 'local';
  return resolveFarmApiBaseUrl() ? 'remote' : 'local';
}

export function farmHttpBaseToWsBase(baseUrl: string): string {
  return baseUrl.replace(/^http/i, 'ws');
}
