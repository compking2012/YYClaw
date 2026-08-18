import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getSetting } from '../utils/store';
import { decryptJson } from '../utils/crypto-helper';

export type GatewayReloadMode = 'hybrid' | 'reload' | 'restart' | 'off';

export type GatewayReloadPolicy = {
  mode: GatewayReloadMode;
  debounceMs: number;
};

export const DEFAULT_GATEWAY_RELOAD_POLICY: GatewayReloadPolicy = {
  mode: 'hybrid',
  debounceMs: 1200,
};

const OPENCLAW_CONFIG_PATH = join(homedir(), '.openclaw', 'openclaw.json');
const MAX_DEBOUNCE_MS = 60_000;

function normalizeMode(value: unknown): GatewayReloadMode {
  if (value === 'off' || value === 'reload' || value === 'restart' || value === 'hybrid') {
    return value;
  }
  return DEFAULT_GATEWAY_RELOAD_POLICY.mode;
}

function normalizeDebounceMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_GATEWAY_RELOAD_POLICY.debounceMs;
  }
  const rounded = Math.round(value);
  if (rounded < 0) return 0;
  if (rounded > MAX_DEBOUNCE_MS) return MAX_DEBOUNCE_MS;
  return rounded;
}

export function parseGatewayReloadPolicy(config: unknown): GatewayReloadPolicy {
  if (!config || typeof config !== 'object') {
    return { ...DEFAULT_GATEWAY_RELOAD_POLICY };
  }
  const root = config as Record<string, unknown>;
  const gateway = (root.gateway && typeof root.gateway === 'object'
    ? root.gateway
    : {}) as Record<string, unknown>;
  const reload = (gateway.reload && typeof gateway.reload === 'object'
    ? gateway.reload
    : {}) as Record<string, unknown>;

  return {
    mode: normalizeMode(reload.mode),
    debounceMs: normalizeDebounceMs(reload.debounceMs),
  };
}

export async function loadGatewayReloadPolicy(): Promise<GatewayReloadPolicy> {
  try {
    const raw = await readFile(OPENCLAW_CONFIG_PATH, 'utf-8');
    
    // Support decrypting legacy encrypted openclaw.json if needed
    if (raw.startsWith('CLAWX_ENCRYPTED_v1:')) {
      try {
        const configKey = await getSetting('configKey');
        if (configKey) {
          const parsed = decryptJson(raw, configKey);
          return parseGatewayReloadPolicy(parsed);
        }
      } catch (err) {
        // Fall back to JSON.parse or default policy if decryption fails
      }
    }
    
    return parseGatewayReloadPolicy(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_GATEWAY_RELOAD_POLICY };
  }
}

