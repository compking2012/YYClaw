import type { WorkflowAgentValidationIssue } from '@/lib/office-workflow-agent-validation-issues';

/** 本步输出可补全后重试（不应立即将整个项目标失败）。 */
export const RECOVERABLE_WORKFLOW_OUTPUT_ISSUES: ReadonlySet<WorkflowAgentValidationIssue> =
  new Set([
    'deliverable_paths_missing_on_disk',
    'deliverable_too_short',
    'deliverable_promissory_only',
    'missing_deliverable_section',
    'missing_workflow_output_section',
    'missing_task_understanding',
    'fast_ack_only',
    'interim_narration_only',
    'missing_handoff',
    'deliverable_missing_file_path',
    'deliverable_section_too_long',
    'deliverable_inline_too_long',
    'deliverable_filename_missing_role_suffix',
    'invalid_rollback_format',
    'rollback_required',
    'deliverable_conclusion_inconsistent',
    'output_validation_deliverable_ls_mismatch',
    'input_validation_targets_not_direct_predecessors',
    'input_validation_ls_result_invalid',
    'empty',
  ]);

export const WORKFLOW_NODE_OUTPUT_RETRY_MAX = 3;

export function isRecoverableWorkflowOutputFailure(
  issues: WorkflowAgentValidationIssue[],
): boolean {
  if (issues.length === 0) return false;
  return issues.every((i) => RECOVERABLE_WORKFLOW_OUTPUT_ISSUES.has(i));
}

export function isFatalWorkflowTransportFailure(
  transportReason?: 'timeout' | 'error' | 'empty',
): boolean {
  return transportReason === 'timeout' || transportReason === 'error';
}

export function buildWorkflowOutputRetryError(
  detail: string,
  attempt: number,
  maxAttempts: number,
): string {
  return `【输出补全】${detail.slice(0, 400)}（自动重试 ${attempt}/${maxAttempts}）`;
}
