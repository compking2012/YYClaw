export const DEFAULT_E2E_WORKERS = 2;
export const E2E_EXCLUSIVE_TAG = '@exclusive';
export const E2E_PERFORMANCE_TAG = '@performance';
/**
 * README screenshot capture. Opt-in only: these specs write image artifacts
 * instead of asserting behavior, so they are excluded from every ordinary run
 * and are reached through `pnpm run screenshots`.
 */
export const E2E_SCREENSHOT_TAG = '@screenshots';
