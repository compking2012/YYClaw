import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LANGGRAPH_COMPILE_FLAG = 'VITE_ENABLE_LANGGRAPH';
export const OFFICE_CONFIG_FILE = 'office.env';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function readOfficeConfigFile() {
  const path = join(ROOT, OFFICE_CONFIG_FILE);
  if (!existsSync(path)) return undefined;

  const text = readFileSync(path, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key !== LANGGRAPH_COMPILE_FLAG) continue;
    const raw = trimmed.slice(eq + 1).trim();
    return raw.replace(/^['"]|['"]$/g, '');
  }
  return undefined;
}

/** Load LangGraph compile flag from office.env (CLI env still overrides). */
export function loadLangGraphEnvFiles(_mode = 'development') {
  const preset = process.env[LANGGRAPH_COMPILE_FLAG];
  const fromFile = readOfficeConfigFile();
  // Default to 'false' if office.env doesn't exist or flag is missing
  process.env[LANGGRAPH_COMPILE_FLAG] = preset ?? fromFile ?? 'false';
}

export function isLangGraphCompileEnabled() {
  return process.env[LANGGRAPH_COMPILE_FLAG] === 'true';
}

function cliMode() {
  const arg = process.argv.find((a) => a.startsWith('--mode='));
  return arg?.slice('--mode='.length) ?? 'production';
}

if (process.argv.includes('--export-shell')) {
  loadLangGraphEnvFiles(cliMode());
  const value = process.env[LANGGRAPH_COMPILE_FLAG] ?? 'false';
  process.stdout.write(`export ${LANGGRAPH_COMPILE_FLAG}=${JSON.stringify(value)}\n`);
}
