import type { AppErrorCode } from '../../../src/lib/error-model';
import { normalizeAppError } from '../../../src/lib/error-model';
import { isLikelyModelRuntimeError } from './room-mention-reply-policy';
import type { OfficeRunTracker } from './session-run-settle';

/** Gateway run 终态错误：Gateway 内部重试仍可能解决 vs 不可解决（不确定一律不可解决）。 */
export type GatewayRunTerminalErrorKind = 'retryable' | 'non_retryable';

export type ClassifiedGatewayRunTerminalError = {
  kind: GatewayRunTerminalErrorKind;
  appErrorCode: AppErrorCode;
  terminalError?: string;
};

/** 有明确文档/测试依据的终态可重试 `terminalError` 码。 */
const RETRYABLE_TERMINAL_ERROR_CODES = new Set(['non_deliverable_terminal_turn']);

const NON_RETRYABLE_APP_ERROR_CODES = new Set<AppErrorCode>([
  'AUTH_INVALID',
  'TIMEOUT',
  'RATE_LIMIT',
  'QUOTA',
  'UPSTREAM',
  'PERMISSION',
  'CHANNEL_UNAVAILABLE',
  'NETWORK',
  'CONFIG',
  'WORKSPACE',
  'PROCESS_FAILED',
  'GATEWAY',
  'UNKNOWN',
]);

export function joinOfficeRunTerminalAssistantTexts(texts: readonly string[]): string {
  return texts.join('\n\n').trim();
}

export function appendGatewayTerminalErrorDetail(
  detail: string,
  terminalError: string | undefined,
): string {
  const code = terminalError?.trim();
  if (!code) return detail;
  const trimmed = detail.trim();
  const prefix = '模型运行结束但未产出可校验回复：';
  const suffix = `${prefix}${code}`;
  if (!trimmed) return suffix;
  // Exact suffix already present.
  if (trimmed.includes(suffix)) return trimmed;
  // Primary detail already is the cause (model_error stub path) — do not re-wrap.
  if (trimmed === code) return trimmed;
  // Already have a gateway cause suffix (even if whitespace differs around code).
  const idx = trimmed.lastIndexOf(prefix);
  if (idx >= 0 && trimmed.slice(idx + prefix.length).trim() === code) return trimmed;
  return `${trimmed}\n${suffix}`;
}

export function classifyGatewayRunTerminalError(input: {
  terminalError?: string;
  runError?: string;
  assistantTexts?: readonly string[];
}): ClassifiedGatewayRunTerminalError {
  const terminalError = input.terminalError?.trim() || input.runError?.trim() || undefined;
  const assistantText = joinOfficeRunTerminalAssistantTexts(input.assistantTexts ?? []);

  if (terminalError && RETRYABLE_TERMINAL_ERROR_CODES.has(terminalError)) {
    return {
      kind: 'retryable',
      appErrorCode: 'UNKNOWN',
      terminalError,
    };
  }

  const messageForClassification = terminalError || assistantText;
  if (assistantText && isLikelyModelRuntimeError(assistantText)) {
    return {
      kind: 'non_retryable',
      appErrorCode: normalizeAppError(assistantText).code,
      terminalError,
    };
  }

  const appErrorCode = messageForClassification
    ? normalizeAppError(messageForClassification).code
    : 'UNKNOWN';
  if (NON_RETRYABLE_APP_ERROR_CODES.has(appErrorCode)) {
    return {
      kind: 'non_retryable',
      appErrorCode,
      terminalError,
    };
  }

  return {
    kind: 'non_retryable',
    appErrorCode: appErrorCode || 'UNKNOWN',
    terminalError,
  };
}

export function classifyOfficeRunTrackerTerminalError(
  tracker: Pick<OfficeRunTracker, 'terminalError' | 'terminalAssistantTexts'>,
): ClassifiedGatewayRunTerminalError {
  return classifyGatewayRunTerminalError({
    terminalError: tracker.terminalError,
    assistantTexts: tracker.terminalAssistantTexts,
  });
}
