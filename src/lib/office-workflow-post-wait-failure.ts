import type { AppErrorCode } from '@/lib/error-model';
import { normalizeAppError } from '@/lib/error-model';
import type { WorkflowAgentValidationIssue } from '@/lib/office-workflow-agent-validation-issues';
import { RECOVERABLE_WORKFLOW_OUTPUT_ISSUES } from '@/lib/office-workflow-agent-recovery';

/**
 * Post-wait failure routing for Workflow LLM:
 * - format → same-session format-retry
 * - runtime → skip format-retry; node-level outputRetry
 * - fatal → skip all retries; node failed
 */
export type WorkflowPostWaitFailureKind = 'format' | 'runtime' | 'fatal';

/** True format/schema problems — eligible for format-retry even after terminalErrorEnded. */
export const WORKFLOW_FORMAT_VALIDATION_ISSUES: ReadonlySet<WorkflowAgentValidationIssue> = new Set([
  'invalid_json_syntax',
  'invalid_json_missing_fields',
  'invalid_json_value',
  'invalid_json_schema',
  'invalid_rollback_format',
]);

/** Hard-fail: do not format-retry and do not output-retry. */
const FATAL_POST_WAIT_APP_ERROR_CODES: ReadonlySet<AppErrorCode> = new Set([
  'AUTH_INVALID',
  'QUOTA',
  'RATE_LIMIT',
  'PERMISSION',
]);

export function isWorkflowFormatValidationFailure(
  issues: readonly WorkflowAgentValidationIssue[],
): boolean {
  return issues.length > 0 && issues.every((i) => WORKFLOW_FORMAT_VALIDATION_ISSUES.has(i));
}

export function classifyWorkflowPostWaitFailure(params: {
  terminalErrorEnded?: boolean;
  terminalError?: string;
  issues: readonly WorkflowAgentValidationIssue[];
  raw: string;
  transportReason?: 'timeout' | 'error' | 'empty';
}): WorkflowPostWaitFailureKind {
  const issues = params.issues;
  if (
    issues.includes('transport_timeout')
    || issues.includes('transport_error')
  ) {
    return 'fatal';
  }

  const appCode = params.terminalError?.trim()
    ? normalizeAppError(params.terminalError).code
    : undefined;
  if (appCode && FATAL_POST_WAIT_APP_ERROR_CODES.has(appCode)) {
    return 'fatal';
  }

  const raw = params.raw.trim();
  // Q1=A: terminal (or not) + real format issues + body → format-retry.
  if (raw && isWorkflowFormatValidationFailure(issues)) {
    return 'format';
  }

  // Q2: runtime terminal (empty / non-format) → output-retry at node layer.
  if (params.terminalErrorEnded) {
    return 'runtime';
  }

  // Non-terminal validation failures keep today's format-retry path.
  return 'format';
}

/**
 * Normalize a runtime post-wait failure so node outcome can grant outputRetry
 * (`empty` / other recoverable issues + non-fatal transportReason).
 */
export function normalizeRuntimePostWaitFailureIssues(
  issues: readonly WorkflowAgentValidationIssue[],
): WorkflowAgentValidationIssue[] {
  const recoverable = issues.filter((i) => RECOVERABLE_WORKFLOW_OUTPUT_ISSUES.has(i));
  return recoverable.length > 0 ? [...recoverable] : ['empty'];
}
