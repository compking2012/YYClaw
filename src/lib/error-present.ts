import i18n from '@/i18n';
import { AppError, AppErrorCode, normalizeAppError, mapBackendErrorCode } from './error-model';
import { isBenignGatewayLifecycleError } from './gateway-lifecycle-errors';

/**
 * A presentation-ready, classified, localized view of any error.
 * The original error text is always preserved in `detail` for the
 * collapsible "view details" affordance and copy-to-clipboard.
 */
export interface FriendlyError {
  code: AppErrorCode | 'BENIGN';
  title: string;
  message: string;
  hint?: string;
  detail: string;
  benign: boolean;
}

const NS = 'errors';

function rawText(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message || error.stack || String(error);
  if (error && typeof error === 'object') {
    const maybe = error as { message?: unknown };
    if (typeof maybe.message === 'string' && maybe.message) return maybe.message;
  }
  return String(error);
}

/**
 * Convert any raw error into a friendly, i18n'd, classified message.
 *
 * @param error  The raw error (string / Error / AppError / unknown).
 * @param opts.code  Optional backend error code preserved from the main process
 *                   (openclaw / gateway). When it maps to a non-UNKNOWN code it
 *                   takes precedence over keyword classification.
 */
export function presentError(error: unknown, opts?: { code?: string }): FriendlyError {
  const detail = rawText(error);

  if (isBenignGatewayLifecycleError(error)) {
    return { code: 'BENIGN', title: '', message: '', detail, benign: true };
  }

  let code: AppErrorCode;
  const fromBackend = opts?.code ? mapBackendErrorCode(opts.code) : 'UNKNOWN';
  if (fromBackend !== 'UNKNOWN') {
    code = fromBackend;
  } else {
    const app: AppError = error instanceof AppError ? error : normalizeAppError(error);
    code = app.code;
  }

  const title = i18n.t(`${NS}:${code}.title`, {
    defaultValue: i18n.t(`${NS}:UNKNOWN.title`),
  });
  const message = i18n.t(`${NS}:${code}.message`, {
    defaultValue: detail || i18n.t(`${NS}:UNKNOWN.message`),
  });
  const hint = i18n.t(`${NS}:${code}.hint`, { defaultValue: '' });

  return {
    code,
    title,
    message,
    hint: hint || undefined,
    detail,
    benign: false,
  };
}
