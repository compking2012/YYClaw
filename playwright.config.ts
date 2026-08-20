import { defineConfig } from '@playwright/test';
import {
  DEFAULT_E2E_WORKERS,
  E2E_EXCLUSIVE_TAG,
  E2E_PERFORMANCE_TAG,
  E2E_SCREENSHOT_TAG,
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
const screenshotPattern = new RegExp(E2E_SCREENSHOT_TAG);
// Screenshot capture is excluded from the default lanes as well: it produces
// image artifacts, not assertions, and is run on demand via `pnpm run screenshots`.
const nonParallelPattern = new RegExp(
  `${E2E_EXCLUSIVE_TAG}|${E2E_PERFORMANCE_TAG}|${E2E_SCREENSHOT_TAG}`,
);

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
    // README screenshot capture is opt-in: `playwright test` with no --project
    // runs every configured project, so gating on the env var (set by
    // `pnpm run screenshots`) is what actually keeps it out of ordinary runs.
    ...(process.env.CLAWX_CAPTURE_SCREENSHOTS === '1'
      ? [{
          name: 'screenshots' as const,
          grep: screenshotPattern,
          workers: 1,
          // Deliberately no `dependencies`: capturing README images must not
          // drag the whole functional suite along.
        }]
      : []),
  ],
});
