import pkg from '../../package.json';

export function getFarmApiBaseUrl(): string | null {
  const raw = String((pkg as { farmApiBaseUrl?: string }).farmApiBaseUrl ?? '').trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, '');
}

export function farmHttpBaseToWsBase(baseUrl: string): string {
  return baseUrl.replace(/^http/i, 'ws');
}
