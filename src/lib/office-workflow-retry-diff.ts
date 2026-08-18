import type { WorkflowAgentValidationIssue } from '@/lib/office-workflow-agent-validation-issues';
import { tryParseWorkflowJsonObject } from '@/lib/office-workflow-json-parse';
import { WORKFLOW_LS_RESULT_VALIDATION_RULE } from '@/lib/office-workflow-output-ls-result';
import {
  WORKFLOW_ROLLBACK_NONE_VALUE,
  WORKFLOW_ROLLBACK_TRIGGER_SENTENCE,
  workflowProjectRelativeLsLine,
} from '@/lib/office-workflow-task-prompt-shared';

const RETRY_PRIOR_RAW_MAX = 12_000;

/** 重试对照时截断过长 JSON / 正文。 */
export function sanitizeWorkflowPriorRawForRetryDisplay(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  const body = (fence?.[1] ?? t).trim();
  if (body.length <= RETRY_PRIOR_RAW_MAX) return body;
  return `${body.slice(0, RETRY_PRIOR_RAW_MAX)}\n…（上次输出过长，已截断；重试请输出完整 JSON 对象）`;
}

export type WorkflowValidationFieldIssue = {
  field: string;
  reason: string;
  fixHint?: string;
};

/** 将工作流校验问题码映射为 JSON 字段路径 + 修正提示。 */
export function mapWorkflowValidationIssueToFieldReason(
  issue: WorkflowAgentValidationIssue,
  ctx?: { roleName?: string; stepTitle?: string },
): WorkflowValidationFieldIssue {
  const role = ctx?.roleName?.trim() ?? '{角色名}';
  const step = ctx?.stepTitle?.trim() ?? '{步骤名}';
  const rollbackExample = `【回滚】：${role}在「${step}」的交付物存在关键缺陷（具体原因说明）`;
  const map: Partial<Record<WorkflowAgentValidationIssue, WorkflowValidationFieldIssue>> = {
    empty: {
      field: '（全文）',
      reason: '未收到模型正文',
      fixHint: '仅输出 1 个 JSON 对象，禁止 markdown 代码块与解释。',
    },
    transport_timeout: { field: '（传输）', reason: '等待模型回复超时' },
    transport_error: { field: '（传输）', reason: '模型会话调用异常' },
    invalid_json_syntax: {
      field: '（JSON 语法）',
      reason: '不是合法 JSON（如字符串内部双引号未转义、缺少逗号/引号）；系统已尝试轻量修复但失败',
      fixHint: '仅输出 1 个合法 JSON 对象；字符串中的双引号必须转义为 \\"，例如 {"title":"撰写\\"报告\\""}。',
    },
    invalid_json_missing_fields: {
      field: '（JSON required）',
      reason: '缺少必填字段',
      fixHint: '补齐 role、step(index/total/title)、inputValidation(targets/lsResult)、execution、outputValidation(targets/lsResult)、deliverable(path/summary/conclusion)、rollback。',
    },
    invalid_json_value: {
      field: '（JSON value）',
      reason: '字段值类型、枚举或格式不符合预期',
      fixHint:
        'index/total 为 number；execution ≤100 字；deliverable.summary ≤150 字；targets/lsResult 为等长字符串数组；conclusion 只能为 通过/不通过/已交付（评审类仅 通过/不通过）。',
    },
    invalid_json_schema: {
      field: '（JSON schema）',
      reason: '字段缺失/类型错误/role 不匹配，或评审步 conclusion 使用了「已交付」',
      fixHint:
        '对照【输出规范与严格校验】与【输出示例】；role 须等于当前角色；deliverable.path 须与 outputValidation.targets 中某项完全一致。',
    },
    model_error: { field: '（全文）', reason: '模型返回运行时错误' },
    deliverable_promissory_only: {
      field: 'deliverable.summary',
      reason: '禁止仅「已发布/已完成/已交付」等空话',
      fixHint: 'summary 须写可核验的关键结论，例如：「识别 3 项可测性缺口，已记录风险清单」。',
    },
    deliverable_conclusion_inconsistent: {
      field: 'deliverable.summary / deliverable.conclusion',
      reason: 'summary 与 conclusion 语义矛盾',
      fixHint: 'conclusion=不通过 时 summary 勿写「有条件通过」；遗留项写在 summary，conclusion 仍可为「通过」。',
    },
    rollback_required: {
      field: 'rollback',
      reason: '输入校验失败或评审结论不通过时不能填「无」',
      fixHint: `应填写：${rollbackExample}`,
    },
    invalid_rollback_format: {
      field: 'rollback',
      reason: '格式不符合要求',
      fixHint: `无需回滚填「${WORKFLOW_ROLLBACK_NONE_VALUE}」；需回滚须严格匹配：${WORKFLOW_ROLLBACK_TRIGGER_SENTENCE}`,
    },
    input_validation_ls_result_invalid: {
      field: 'inputValidation.lsResult',
      reason: WORKFLOW_LS_RESULT_VALIDATION_RULE,
      fixHint: `示例：targets:["交付物-上游角色/上游文件-上游角色.md"]，lsResult:["${workflowProjectRelativeLsLine('上游文件-上游角色.md')}"]（ls 行末须为相对路径且与 target 同一文件，不可为绝对路径）`,
    },
    input_validation_targets_not_direct_predecessors: {
      field: 'inputValidation.targets',
      reason: '建议仅列 DAG 直接前驱交付物',
      fixHint: '优先列出上一任务产物；入口节点须为 []；更上游项系统不强制拒绝，但勿臆测未读产物。',
    },
    input_validation_names_role: {
      field: 'inputValidation',
      reason: '禁止 @ 或点名角色',
      fixHint: '仅写 targets 与 lsResult，勿出现 @ 或成员名。',
    },
    output_validation_deliverable_ls_mismatch: {
      field: 'outputValidation.lsResult',
      reason: WORKFLOW_LS_RESULT_VALIDATION_RULE,
      fixHint: `示例：targets:["交付物-${role}/xxx-${role}.md"]，lsResult:["${workflowProjectRelativeLsLine(`交付物-${role}/xxx-${role}.md`)}"]（ls 行末须为相对路径且与 target 同一文件，不可为绝对路径）`,
    },
    deliverable_filename_missing_role_suffix: {
      field: 'deliverable.path / outputValidation.targets',
      reason:
        '交付物须落在 交付物-角色名/ 目录下（与 Smart 一致），禁止 target/ 或项目根散落文件',
      fixHint: `例如：deliverable.path:"交付物-${role}/${step}-${role}.md"`,
    },
    deliverable_paths_missing_on_disk: {
      field: 'deliverable.path',
      reason: '声明的路径未在项目目录中找到',
      fixHint: '须先落盘再输出 JSON；outputValidation.lsResult 须能对应磁盘上的文件/文件夹。',
    },
    interim_narration_only: {
      field: '（全文）',
      reason: '仅为过程说明，缺少结构化 JSON',
      fixHint: '完成落盘后输出完整 JSON，勿只写「让我先看看…」。',
    },
    fast_ack_only: {
      field: 'deliverable.summary',
      reason: '仅为占位 ack，无实质交付',
      fixHint: 'execution 与 deliverable.summary 须描述已完成的具体工作与结论。',
    },
  };
  return map[issue] ?? { field: '（格式）', reason: issue };
}

/** 逐字段列出失败原因（用于重试「原因」段）。 */
export function formatWorkflowStructuredValidationFailureDetail(
  issues: WorkflowAgentValidationIssue[],
  ctx?: { roleName?: string; stepTitle?: string },
): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const issue of issues) {
    const { field, reason } = mapWorkflowValidationIssueToFieldReason(issue, ctx);
    const line = `${field}：${reason}`;
    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  return lines.join('\n');
}

function extractJsonFieldLines(priorRaw: string): string[] {
  const obj = tryParseWorkflowJsonObject(priorRaw);
  if (!obj) return [];
  const lines: string[] = [];
  if (typeof obj.role === 'string') lines.push(`role: ${JSON.stringify(obj.role)}`);
  const step = obj.step && typeof obj.step === 'object' ? (obj.step as Record<string, unknown>) : null;
  if (step && typeof step.title === 'string') {
    lines.push(`step.title: ${JSON.stringify(step.title)}`);
  }
  const deliver = obj.deliverable && typeof obj.deliverable === 'object'
    ? (obj.deliverable as Record<string, unknown>)
    : null;
  if (deliver) {
    if (typeof deliver.path === 'string') lines.push(`deliverable.path: ${JSON.stringify(deliver.path)}`);
    if (typeof deliver.summary === 'string') {
      const s = deliver.summary.length > 120 ? `${deliver.summary.slice(0, 120)}…` : deliver.summary;
      lines.push(`deliverable.summary: ${JSON.stringify(s)}`);
    }
    if (typeof deliver.conclusion === 'string') {
      lines.push(`deliverable.conclusion: ${JSON.stringify(deliver.conclusion)}`);
    }
  }
  const input = obj.inputValidation && typeof obj.inputValidation === 'object'
    ? (obj.inputValidation as Record<string, unknown>)
    : null;
  if (input && Array.isArray(input.targets)) {
    lines.push(`inputValidation.targets: ${JSON.stringify(input.targets)}`);
  }
  if (input && Array.isArray(input.lsResult)) {
    lines.push(`inputValidation.lsResult: ${JSON.stringify(input.lsResult)}`);
  }
  const output = obj.outputValidation && typeof obj.outputValidation === 'object'
    ? (obj.outputValidation as Record<string, unknown>)
    : null;
  if (output && Array.isArray(output.targets)) {
    lines.push(`outputValidation.targets: ${JSON.stringify(output.targets)}`);
  }
  if (output && Array.isArray(output.lsResult)) {
    lines.push(`outputValidation.lsResult: ${JSON.stringify(output.lsResult)}`);
  }
  if (typeof obj.rollback === 'string') {
    lines.push(`rollback: ${JSON.stringify(obj.rollback)}`);
  }
  return lines;
}

/** 重试 Prompt 中的对照 + 字段级修正提示块。 */
export function buildWorkflowRetryDiffBlock(params: {
  priorRaw?: string;
  issues?: WorkflowAgentValidationIssue[];
  roleName: string;
  stepTitle?: string;
}): string {
  const prior = sanitizeWorkflowPriorRawForRetryDisplay(params.priorRaw?.trim() ?? '');
  const issues = params.issues ?? [];
  const ctx = { roleName: params.roleName, stepTitle: params.stepTitle };

  const correctionLines: string[] = [];
  const seenHints = new Set<string>();
  for (const issue of issues) {
    const { field, fixHint } = mapWorkflowValidationIssueToFieldReason(issue, ctx);
    if (!fixHint) continue;
    const line = `- ${field} → ${fixHint}`;
    if (seenHints.has(line)) continue;
    seenHints.add(line);
    correctionLines.push(line);
  }

  const fieldSnapshot = prior ? extractJsonFieldLines(prior) : [];
  const parts: string[] = [];
  if (prior) {
    parts.push('上次输出（供对照，勿照抄占位内容）：', '---', prior, '---');
    if (fieldSnapshot.length > 0) {
      parts.push('上次 JSON 关键字段摘录：', ...fieldSnapshot.map((l) => `- ${l}`));
    }
  }
  if (correctionLines.length > 0) {
    parts.push('字段修正指引（按问题逐项改）：', ...correctionLines);
  }
  return parts.join('\n');
}
