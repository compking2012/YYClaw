import { AppError } from './error-model';
import { presentError } from './error-present';

export { AppError } from './error-model';

/**
 * Backwards-compatible helper: return a single user-facing line for an error.
 * Now delegates to the localized presentation layer instead of hardcoded English.
 */
export function toUserMessage(error: unknown): string {
  const fe = presentError(error);
  return fe.message || fe.detail || (error instanceof AppError ? error.message : String(error));
}
