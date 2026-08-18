import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const OFFICE_COLLABORATION_FLAG = 'VITE_SHOW_OFFICE_COLLABORATION';
export const OFFICE_SESSIONS_VISIBLE_FLAG = 'VITE_SHOW_OFFICE_SESSIONS';
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

function resolveFlag(name, fromFile, defaultValue = 'false') {
  const preset = process.env[name];
  process.env[name] = preset ?? fromFile[name] ?? defaultValue;
}

/** Load Office compile-time flags from office.env (CLI env still overrides). */
import { loadOfficeUserCheckpointEnv } from './is-office-user-checkpoint-enabled.mjs';

export function loadOfficeEnvFiles(_mode = 'development') {
  const fromFile = readOfficeConfigFile();
  resolveFlag(OFFICE_COLLABORATION_FLAG, fromFile, 'true');
  resolveFlag(OFFICE_SESSIONS_VISIBLE_FLAG, fromFile);
  loadOfficeUserCheckpointEnv(_mode);
}

export function isOfficeCollaborationConfigurable() {
  return process.env[OFFICE_COLLABORATION_FLAG] !== 'false';
}

export function isOfficeSessionsVisible() {
  return process.env[OFFICE_SESSIONS_VISIBLE_FLAG] === 'true';
}

function cliMode() {
  const arg = process.argv.find((a) => a.startsWith('--mode='));
  return arg?.slice('--mode='.length) ?? 'production';
}

if (process.argv.includes('--export-shell')) {
  loadOfficeEnvFiles(cliMode());
  for (const flag of [OFFICE_COLLABORATION_FLAG, OFFICE_SESSIONS_VISIBLE_FLAG]) {
    const value = process.env[flag] ?? (flag === OFFICE_COLLABORATION_FLAG ? 'true' : 'false');
    process.stdout.write(`export ${flag}=${JSON.stringify(value)}\n`);
  }
}
