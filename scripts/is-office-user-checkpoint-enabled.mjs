import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const OFFICE_USER_CHECKPOINT_FLAG = 'OFFICE_USER_CHECKPOINT';
export const OFFICE_CONFIG_FILE = 'office.env';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function readOfficeConfigFile() {
  const path = join(ROOT, OFFICE_CONFIG_FILE);
  if (!existsSync(path)) return {};

  const config = {};
  const text = readFileSync(path, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const raw = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    config[key] = raw;
  }
  return config;
}

/** Load user-checkpoint flag from office.env (CLI env still overrides). */
export function loadOfficeUserCheckpointEnv(_mode = 'development') {
  const fromFile = readOfficeConfigFile();
  const preset = process.env[OFFICE_USER_CHECKPOINT_FLAG];
  process.env[OFFICE_USER_CHECKPOINT_FLAG] = preset ?? fromFile[OFFICE_USER_CHECKPOINT_FLAG] ?? 'false';
}

export function isOfficeUserCheckpointEnabled() {
  return process.env[OFFICE_USER_CHECKPOINT_FLAG] === 'true'
    || process.env[OFFICE_USER_CHECKPOINT_FLAG] === '1';
}
