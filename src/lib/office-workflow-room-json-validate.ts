import type { WorkflowAgentValidationIssue } from '@/lib/office-workflow-agent-validation-issues';
import {
  isWorkflowDeliverableConclusionSummaryMismatch,
  isWorkflowReviewStepConclusionAllowed,
} from '@/lib/office-workflow-deliverable-conclusion';
import {
  isInputValidationLsResultInvalid,
  isWorkflowInputValidationFailure,
} from '@/lib/office-workflow-input-validation';
import { isWorkflowReviewLikeStepTitle } from '@/lib/office-workflow-deliverable-conclusion';
import { isValidWorkflowRollbackExplanationBody, parseWorkflowRollbackTrigger } from '@/lib/office-workflow-rollback';
import {
  isWorkflowLsTargetPathInvalid,
  WORKFLOW_LS_RESULT_VALIDATION_RULE,
} from '@/lib/office-workflow-output-ls-result';
import { validateWorkflowJsonExplicitDeliverablePaths } from '@/lib/office-deliverable-file-policy';
import {
  canonicalWorkflowJsonFingerprint,
  parseWorkflowJsonOutputDetailed,
  type WorkflowJsonOutput,
} from '@/lib/office-workflow-json-schema';

export type WorkflowRoomJsonValidationResult =
  | {
      ok: true;
      json: WorkflowJsonOutput;
      raw: string;
      fingerprint: string;
    }
  | {
      ok: false;
      issues: WorkflowAgentValidationIssue[];
      detail: string;
      raw: string;
    };

const ISSUE_MESSAGES: Partial<Record<WorkflowAgentValidationIssue, string>> = {
  empty: '未收到模型正文',
  invalid_json_syntax: 'JSON 语法错误（已尝试自动修复，仍无法解析）',
  invalid_json_missing_fields: 'JSON 缺少必填字段',
  invalid_json_value: 'JSON 字段值不符合预期',
  invalid_json_schema: 'JSON 输出不符合 schema',
  deliverable_too_short: '交付摘要过短',
  deliverable_paths_missing_on_disk: '声明的交付路径未在项目目录中找到',
  invalid_rollback_format:
    '【回滚说明】须为「无」，或整段严格匹配：【回滚】{角色}在「{步骤}」的交付物存在{异常}（{原因}）',
  rollback_required:
    '输入校验失败或验收/评审不通过时，rollback 须按回滚格式填写，不能写「无」',
  deliverable_conclusion_inconsistent: 'deliverable.summary 与 conclusion 语义不一致',
  deliverable_filename_missing_role_suffix:
    '交付物须落在 交付物-角色名/ 目录下（与 Smart 一致），禁止 target/ 或项目根散落文件',
  input_validation_targets_not_direct_predecessors:
    '建议 inputValidation.targets 仅列 DAG 直接前驱交付物',
  input_validation_ls_result_invalid: `inputValidation.lsResult：${WORKFLOW_LS_RESULT_VALIDATION_RULE}`,
};

function formatInputValidation(json: WorkflowJsonOutput): string {
  const { targets, lsResult } = json.inputValidation;
  const lsBody =
    targets.length > 0
      ? targets.map((t, i) => `${t}：${lsResult[i] ?? ''}`).join('\n')
      : '无';
  return [
    targets.length > 0 ? `目标：${targets.join('、')}` : '目标：无',
    `ls：${lsBody}`,
  ].join('\n');
}

/** 收稿后的结构化校验（与 Session 业务规则对齐；磁盘校验由主进程另做）。 */
export function validateWorkflowRoomJsonForRunner(
  progressText: string,
  params: { actorRoleName: string; directPredecessorDeliverables?: string },
): WorkflowRoomJsonValidationResult {
  const raw = progressText.trim();
  if (!raw) {
    return { ok: false, issues: ['empty'], detail: ISSUE_MESSAGES.empty!, raw };
  }

  const parsedJson = parseWorkflowJsonOutputDetailed(raw);
  if (!parsedJson.ok) {
    return {
      ok: false,
      issues: parsedJson.issues,
      detail: parsedJson.detail,
      raw,
    };
  }
  const json = parsedJson.json;

  const issues: WorkflowAgentValidationIssue[] = [];
  const actor = params.actorRoleName.trim();
  if (actor && json.role.trim() !== actor) {
    issues.push('invalid_json_schema');
  }
  if (!json.deliverable.path.trim()) {
    issues.push('deliverable_missing_file_path');
  }
  if (
    actor
    && json.deliverable.path.trim()
    && !validateWorkflowJsonExplicitDeliverablePaths(
      actor,
      json.deliverable.path,
    )
  ) {
    issues.push('deliverable_filename_missing_role_suffix');
  }
  const deliverableBody = [
    `路径：${json.deliverable.path}`,
    `摘要：${json.deliverable.summary}`,
    `结论：${json.deliverable.conclusion}`,
  ].join('\n');
  if (deliverableBody.trim().length < 8) {
    issues.push('deliverable_too_short');
  }
  if (!isWorkflowReviewStepConclusionAllowed(json.deliverable.conclusion, json.step.title)) {
    issues.push('invalid_json_schema');
  }
  if (
    isWorkflowDeliverableConclusionSummaryMismatch(
      json.deliverable.summary,
      json.deliverable.conclusion,
    )
  ) {
    issues.push('deliverable_conclusion_inconsistent');
  }
  if (!isValidWorkflowRollbackExplanationBody(json.rollback)) {
    issues.push('invalid_rollback_format');
  }

  if (
    json.inputValidation.targets.some((t) => isWorkflowLsTargetPathInvalid(t))
  ) {
    issues.push('invalid_json_schema');
  }
  if (
    isInputValidationLsResultInvalid(
      json.inputValidation.targets,
      json.inputValidation.lsResult,
    )
  ) {
    issues.push('input_validation_ls_result_invalid');
  }

  const inputFail = isWorkflowInputValidationFailure(formatInputValidation(json));
  const acceptanceFail =
    isWorkflowReviewLikeStepTitle(json.step.title) && json.deliverable.conclusion === '不通过';
  if ((inputFail || acceptanceFail) && !parseWorkflowRollbackTrigger(json.rollback)) {
    issues.push('rollback_required');
  }

  if (issues.length > 0) {
    const detail = [...new Set(issues)]
      .map((i) => ISSUE_MESSAGES[i] ?? i)
      .join('；');
    return { ok: false, issues, detail, raw };
  }

  return {
    ok: true,
    json,
    raw,
    fingerprint: canonicalWorkflowJsonFingerprint(json),
  };
}
