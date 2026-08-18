import {
  mapValidationIssueFixHint,
  mapValidationIssueToFieldReason,
  sanitizePriorRawForRetryDisplay,
} from '@/lib/office-mention-validation-detail';

export function buildSmartRetryDiffBlock(params: {
  issues: string[];
  priorRaw: string;
}): string {
  if (params.issues.length === 0) return '';
  const prior = sanitizePriorRawForRetryDisplay(params.priorRaw);
  const lines = params.issues.map((issue) => {
    const mapped = mapValidationIssueToFieldReason(issue);
    const hint = mapValidationIssueFixHint(issue);
    return hint
      ? `- ${mapped.field}：${mapped.reason}\n  修正：${hint}`
      : `- ${mapped.field}：${mapped.reason}`;
  });
  return ['【字段级修正清单】', ...lines, '', '【上次输出摘录】', prior || '（空）'].join('\n');
}
