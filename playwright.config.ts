import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
import {
  DEFAULT_E2E_WORKERS,
  E2E_EXCLUSIVE_TAG,
  E2E_PERFORMANCE_TAG,
} from './tests/e2e/parallel-policy';

function e2eWorkers(): number {
  const configured = process.env.CLAWX_E2E_WORKERS?.trim();
  if (!configured) return DEFAULT_E2E_WORKERS;

  const workers = Number(configured);
  if (!Number.isInteger(workers) || workers < 1) {
    throw new Error('CLAWX_E2E_WORKERS must be a positive integer');
  }
  return workers;
}

const exclusivePattern = new RegExp(E2E_EXCLUSIVE_TAG);
const performancePattern = new RegExp(E2E_PERFORMANCE_TAG);
const nonParallelPattern = new RegExp(`${E2E_EXCLUSIVE_TAG}|${E2E_PERFORMANCE_TAG}`);

/** Inline office.env LangGraph flag load (avoid importing .mjs via Playwright's CJS transform). */
function loadLangGraphEnvFromOfficeFile() {
  const flag = 'VITE_ENABLE_LANGGRAPH';
  if (process.env[flag] != null && process.env[flag] !== '') return;
  try {
    const path = join(process.cwd(), 'office.env');
    if (!existsSync(path)) {
      process.env[flag] = 'false';
      return;
    }
    const text = readFileSync(path, 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      if (key !== flag) continue;
      const raw = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      process.env[flag] = raw || 'false';
      return;
    }
  } catch {
    // fall through
  }
  process.env[flag] = process.env[flag] ?? 'false';
}

loadLangGraphEnvFromOfficeFile();

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: e2eWorkers(),
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
  ],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'exclusive',
      grep: exclusivePattern,
      workers: 1,
    },
    {
      name: 'parallel',
      grepInvert: nonParallelPattern,
      dependencies: ['exclusive'],
    },
    {
      name: 'performance',
      grep: performancePattern,
      dependencies: ['parallel'],
      workers: 1,
    },
  ],
});
