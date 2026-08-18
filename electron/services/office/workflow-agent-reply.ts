const WORKFLOW_SECTION_TITLE_PATTERN =
  '项目目录|任务理解|理解|输入校验|协作询问|疑问|待确认|需要澄清|执行说明|执行过程|执行|输出校验|交付产物|产物|用法说明|用法|回滚说明|交接|交接说明';

/** 仅识别工作流已知段落标题（行首）；忽略正文中的角色名【PM】等。 */
export const WORKFLOW_SECTION_HEADING_RE = new RegExp(
  `(?:^|\\n)【\\s*(${WORKFLOW_SECTION_TITLE_PATTERN})\\s*】`,
  'gu',
);

const PROJECT_DIRECTORY_KEYS = ['项目目录'];
const UNDERSTANDING_KEYS = ['任务理解', '理解'];
const INPUT_VALIDATION_KEYS = ['输入校验', '输入检查'];
const CLARIFICATION_KEYS = ['协作询问', '疑问', '待确认', '需要澄清'];
const DELIVERABLE_KEYS = ['交付产物', '产物'];
const USAGE_KEYS = ['用法说明', '用法'];
const EXEC_KEYS = ['执行说明', '执行过程', '执行'];

import type { WorkflowHandoffTarget } from '../../../src/lib/office-workflow-handoff';
import { memberHandoffCoversExpected } from '../../../src/lib/office-workflow-handoff-compliance';
import {
  isWorkflowInterimAgentNarration,
} from '../../../src/lib/office-workflow-agent-structured';
import {
  validateWorkflowJsonExplicitDeliverablePaths,
} from '../../../src/lib/office-deliverable-file-policy';
import { isWorkflowPromissoryDeliverable } from '../../../src/lib/office-workflow-promissory';
import {
  isWorkflowDeliverableConclusionSummaryMismatch,
  isWorkflowReviewStepConclusionAllowed,
} from '../../../src/lib/office-workflow-deliverable-conclusion';
import {
  parseWorkflowJsonOutputDetailed,
  parseWorkflowJsonOutput,
  type WorkflowJsonOutput,
} from '../../../src/lib/office-workflow-json-schema';
import {
  isValidWorkflowRollbackExplanationBody,
  parseWorkflowRollbackTrigger,
} from '../../../src/lib/office-workflow-rollback';
import {
  isInputValidationLsResultInvalid,
  isWorkflowInputValidationFailure,
  workflowInputValidationNamesRole,
} from '../../../src/lib/office-workflow-input-validation';
import {
  isWorkflowLsTargetPathInvalid,
  WORKFLOW_LS_RESULT_VALIDATION_RULE,
} from '../../../src/lib/office-workflow-output-ls-result';
import {
  buildWorkflowAgentOutputFormatLines,
  buildWorkflowAgentTaskPrompt,
  WORKFLOW_AGENT_REQUIRED_OUTPUT_SECTIONS,
  workflowProjectDirectoryDeclaresRoot,
} from '../../../src/lib/office-workflow-task-prompt';
import {
  buildWorkflowRetryDiffBlock,
  formatWorkflowStructuredValidationFailureDetail,
} from '../../../src/lib/office-workflow-retry-diff';
export { isWorkflowPromissoryDeliverable } from '../../../src/lib/office-workflow-promissory';
import type { ProjectAgentRef } from '../../../src/lib/office-workflow-node';
import { isFastAckOnlyReply } from './room-mention-reply-policy';
import { isLikelyModelRuntimeError } from './room-mention-structured-reply';

const EMPTY_CLARIFICATION = /^(无|暂无|没有|none|n\/a)[。.!]?$/iu;

/** JSON 节点输出校验失败文案（Session / 重试 / UI 共用）。 */
const WORKFLOW_JSON_VALIDATION_ISSUE_MESSAGES: Record<
  WorkflowAgentValidationIssue,
  string
> = {
  empty: '未收到模型正文',
  transport_timeout: '回复超时',
  transport_error: '调用异常',
  invalid_json_syntax: 'JSON 语法错误（字符串内双引号须转义为 \\"；已尝试自动修复但失败）',
  invalid_json_missing_fields:
    'JSON 缺少必填字段（role/step/inputValidation/execution/outputValidation/deliverable/rollback 等）',
  invalid_json_value:
    'JSON 字段值不符合预期（execution ≤100 字、deliverable.summary ≤150 字；targets/lsResult 等长；conclusion 枚举正确）',
  invalid_json_schema:
    'JSON 不符合 schema（role 须等于当前角色；deliverable.path 须落在 交付物-角色名/ 下；评审步 conclusion 仅 通过/不通过）',
  model_error: '模型运行时错误',
  missing_task_understanding: '缺少 deliverable / execution 等 JSON 必填内容（Workflow 仅接受 JSON，勿用【】段落）',
  missing_workflow_output_section: 'JSON 缺少必填字段（对照【输出规范与严格校验】补齐 required 字段）',
  missing_project_directory: '须在项目目录落盘后再输出 JSON（路径写在 deliverable.path / outputValidation）',
  missing_deliverable_section: 'deliverable.path 不能为空',
  deliverable_too_short: 'deliverable.summary 过短（至少 8 字）',
  fast_ack_only: '仅为占位 ack，无实质交付',
  deliverable_promissory_only:
    'deliverable.summary 须写可核验的关键结论，禁止仅「已发布/已完成/已交付」等空话',
  missing_handoff: '有下一跳时须在群聊交接（节点 JSON 不含 handoff 字段）',
  interim_narration_only: '仅为过程说明，须输出完整 JSON',
  deliverable_paths_missing_on_disk: 'deliverable.path 声明的路径未在项目目录中找到，须先落盘',
  deliverable_missing_file_path: 'deliverable.path 不能为空，且须落在 交付物-角色名/ 下',
  deliverable_section_too_long: 'deliverable.summary 不得超过 100 字',
  deliverable_inline_too_long: '回复中与交付相关的信息正文过长',
  deliverable_filename_missing_role_suffix:
    '交付物须落在 交付物-角色名/ 目录下（与 Smart 一致），禁止 target/ 或项目根散落文件',
  invalid_rollback_format:
    'rollback 须为「无」，或整段严格匹配：【回滚】：{角色}在「{步骤}」的交付物存在{异常}（{原因}）',
  rollback_required:
    '输入校验失败，或验收/审计/评审结论不通过时，rollback 须按回滚格式填写，不能写「无」',
  deliverable_conclusion_inconsistent:
    'deliverable.summary 与 deliverable.conclusion 语义须一致（遗留项写 summary；须返工写「不通过」并填 rollback）',
  input_validation_names_role: 'inputValidation 仅写 targets 与 lsResult，禁止 @ 或点名角色',
  input_validation_targets_not_direct_predecessors:
    '建议 inputValidation.targets 仅列 DAG 直接前驱交付物（更上游项系统不强制拒绝，但勿臆测未读产物）',
  input_validation_ls_result_invalid: `inputValidation.lsResult：${WORKFLOW_LS_RESULT_VALIDATION_RULE}；禁止 ok/只列文件名`,
  output_validation_deliverable_ls_mismatch: `outputValidation.lsResult：${WORKFLOW_LS_RESULT_VALIDATION_RULE}；禁止 ok/只列文件名`,
};

export type { WorkflowAgentValidationIssue } from '../../../src/lib/office-workflow-agent-validation-issues';
import type { WorkflowAgentValidationIssue } from '../../../src/lib/office-workflow-agent-validation-issues';

export function listMissingWorkflowOutputSections(raw: string): string[] {
  const titles = [...raw.matchAll(WORKFLOW_SECTION_HEADING_RE)].map((m) => m[1]!.trim());
  return WORKFLOW_AGENT_REQUIRED_OUTPUT_SECTIONS.filter(
    (required) =>
      !titles.some((t) => t === required || t.includes(required) || required.includes(t)),
  );
}

export type WorkflowAgentValidationResult =
  | { ok: true; parsed: ParsedAgentTaskReply }
  | { ok: false; issues: WorkflowAgentValidationIssue[]; detail: string; raw: string };

export function isModelTransportError(reason: 'timeout' | 'error' | 'empty'): boolean {
  return reason === 'timeout' || reason === 'error';
}

export type ParsedAgentTaskReply = {
  projectDirectory: string;
  understanding: string;
  inputValidation: string;
  clarifications: string;
  execution: string;
  deliverable: string;
  usage: string;
  rollbackExplanation: string;
  handoffNote: string;
  raw: string;
  jsonOutput?: WorkflowJsonOutput;
};

function inferProjectDirectoryFromLsResult(lsResult: string | string[]): string {
  const t = (Array.isArray(lsResult) ? lsResult.join('\n') : lsResult).trim();
  if (!t) return '';
  const m = t.match(/((?:~\/|\/Users\/|\/tmp\/|\/var\/)[^\s\n]*\/office\/projects\/[^\s\n/]+)(?:\/[^\s\n]*)?/iu);
  return m?.[1]?.trim() ?? '';
}

export function hasSubstantiveClarification(text: string): boolean {
  const t = text.trim();
  if (!t || EMPTY_CLARIFICATION.test(t)) return false;
  return t.length >= 2;
}

export function extractPartialClarification(text: string): string {
  const re = /【\s*(?:协作询问|疑问|待确认|需要澄清)\s*】\s*([\s\S]*?)(?=【|$)/iu;
  const m = text.match(re);
  return m?.[1]?.trim() ?? '';
}

function pickSection(sections: Record<string, string>, keys: string[]): string {
  for (const alias of keys) {
    const direct = sections[alias]?.trim();
    if (direct) return direct;
    const hit = Object.entries(sections).find(
      ([k]) => k === alias || (alias.length >= 3 && k.includes(alias)),
    );
    if (hit?.[1]?.trim()) return hit[1].trim();
  }
  return '';
}

function extractWorkflowSections(raw: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const matches = [...raw.matchAll(WORKFLOW_SECTION_HEADING_RE)];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const key = m[1]!.trim();
    const start = m.index! + m[0].length;
    const end = matches[i + 1]?.index ?? raw.length;
    const chunk = raw.slice(start, end).trim();
    if (chunk) sections[key] = chunk;
  }
  return sections;
}

function looksLikeJsonPayload(raw: string): boolean {
  const t = raw.trim();
  return t.startsWith('{') || /```(?:json)?/iu.test(t);
}

export function parseStructuredAgentReply(text: string): ParsedAgentTaskReply {
  const raw = text.trim();
  const jsonOutput = parseWorkflowJsonOutput(raw);
  if (jsonOutput) {
    const inputValidation = [
      jsonOutput.inputValidation.targets.length > 0
        ? `目标：${jsonOutput.inputValidation.targets.join('、')}`
        : '目标：无',
      `ls：${jsonOutput.inputValidation.targets
        .map((t, i) => `${t}：${jsonOutput.inputValidation.lsResult[i] ?? ''}`)
        .join('\n')}`,
    ].join('\n');
    const execution = jsonOutput.execution.trim();
    const outputValidation = [
      `目标：${jsonOutput.outputValidation.targets.join('、')}`,
      `ls：${jsonOutput.outputValidation.targets
        .map((t, i) => `${t}：${jsonOutput.outputValidation.lsResult[i] ?? ''}`)
        .join('\n')}`,
    ].join('\n');
    const deliverable = [
      `路径：${jsonOutput.deliverable.path}`,
      `摘要：${jsonOutput.deliverable.summary}`,
      `结论：${jsonOutput.deliverable.conclusion}`,
      outputValidation,
    ].join('\n');
    return {
      projectDirectory: inferProjectDirectoryFromLsResult(jsonOutput.outputValidation.lsResult),
      understanding: '',
      inputValidation,
      clarifications: '',
      execution,
      deliverable,
      usage: '',
      rollbackExplanation: jsonOutput.rollback.trim(),
      handoffNote: '',
      raw,
      jsonOutput,
    };
  }

  const sections = extractWorkflowSections(raw);

  const projectDirectory = pickSection(sections, PROJECT_DIRECTORY_KEYS);
  let understanding = pickSection(sections, UNDERSTANDING_KEYS);
  const inputValidation = pickSection(sections, INPUT_VALIDATION_KEYS);
  const clarifications = pickSection(sections, CLARIFICATION_KEYS);
  let deliverable = pickSection(sections, DELIVERABLE_KEYS);
  const usage = pickSection(sections, USAGE_KEYS);
  const execution = pickSection(sections, EXEC_KEYS);
  const rollbackExplanation = pickSection(sections, ['回滚说明', '回滚']);
  const handoffNote = pickSection(sections, ['交接', '交接说明']);

  if (!deliverable) {
    deliverable = raw;
  }

  return {
    projectDirectory,
    understanding,
    inputValidation,
    clarifications,
    execution,
    deliverable,
    usage,
    rollbackExplanation,
    handoffNote,
    raw,
    jsonOutput: undefined,
  };
}

export const WORKFLOW_AGENT_OUTPUT_FORMAT_BLOCK = [
  '【输出格式·必须严格遵守】',
  '仅输出 1 个 JSON 对象（UTF-8）；禁止 markdown 代码块、解释、工具日志与思考过程。',
  ...buildWorkflowAgentOutputFormatLines(),
].join('\n');

export function validateWorkflowAgentStructuredReply(params: {
  raw: string;
  transportReason: 'timeout' | 'error' | 'empty';
  minDeliverableChars?: number;
  minUnderstandingChars?: number;
  requireMemberHandoff?: boolean;
  expectedHandoff?: WorkflowHandoffTarget[];
  teamRoles?: ProjectAgentRef[];
  /** 本步执行角色显示名（校验交付物文件名须含 `-角色名`）。 */
  actorRoleName?: string;
  /** 直接前驱交付上下文（校验 inputValidation.targets 仅含上一任务产物）。 */
  directPredecessorDeliverables?: string;
}): WorkflowAgentValidationResult {
  const raw = params.raw.trim();
  const minDeliverable = params.minDeliverableChars ?? 8;

  if (params.transportReason === 'timeout') {
    return { ok: false, issues: ['transport_timeout'], detail: '等待模型回复超时', raw };
  }
  if (params.transportReason === 'error') {
    return { ok: false, issues: ['transport_error'], detail: '模型会话调用异常', raw };
  }
  if (!raw) {
    return { ok: false, issues: ['empty'], detail: '未收到模型正文', raw };
  }
  const parsed = parseStructuredAgentReply(raw);
  const hasJsonOutput = !!parsed.jsonOutput;
  if (!hasJsonOutput) {
    if (isLikelyModelRuntimeError(raw) && !looksLikeJsonPayload(raw)) {
      return {
        ok: false,
        issues: ['model_error'],
        detail: raw.slice(0, 240),
        raw,
      };
    }
    if (looksLikeJsonPayload(raw)) {
      const jsonDetail = parseWorkflowJsonOutputDetailed(raw);
      if (!jsonDetail.ok) {
        return {
          ok: false,
          issues: jsonDetail.issues,
          detail: jsonDetail.detail,
          raw,
        };
      }
    }
    return {
      ok: false,
      issues: ['invalid_json_schema'],
      detail: looksLikeJsonPayload(raw) ? 'JSON 解析失败或字段不符合 schema' : 'Workflow 仅接受 JSON 输出',
      raw,
    };
  }
  const json = parsed.jsonOutput!;
  const deliverableBody = parsed.deliverable.trim();

  const issues: WorkflowAgentValidationIssue[] = [];
  if (!json.deliverable.path.trim()) issues.push('deliverable_missing_file_path');
  if (deliverableBody.length < minDeliverable) issues.push('deliverable_too_short');
  if (isFastAckOnlyReply(deliverableBody) || isFastAckOnlyReply(raw)) {
    issues.push('fast_ack_only');
  }
  if (isWorkflowInterimAgentNarration(raw) && !json.deliverable.path.trim()) {
    issues.push('interim_narration_only');
  }
  if (
    deliverableBody.length >= minDeliverable
    && isWorkflowPromissoryDeliverable(deliverableBody)
  ) {
    issues.push('deliverable_promissory_only');
  }
  if (
    params.requireMemberHandoff
    && params.expectedHandoff
    && params.expectedHandoff.length > 0
    && params.teamRoles
    && params.teamRoles.length > 0
    && !memberHandoffCoversExpected(parsed.handoffNote, params.expectedHandoff, params.teamRoles)
  ) {
    issues.push('missing_handoff');
  }

  if (
    params.actorRoleName?.trim()
    && json.role !== params.actorRoleName.trim()
  ) {
    issues.push('invalid_json_schema');
  }
  const projectDirBody = parsed.projectDirectory.trim();
  if (
    !parsed.jsonOutput
    && (!projectDirBody || !workflowProjectDirectoryDeclaresRoot(projectDirBody))
  ) {
    issues.push('missing_project_directory');
  }
  if (isWorkflowPromissoryDeliverable(json.deliverable.summary)) {
    issues.push('deliverable_promissory_only');
  }
  if (
    isWorkflowDeliverableConclusionSummaryMismatch(
      json.deliverable.summary,
      json.deliverable.conclusion,
    )
  ) {
    issues.push('deliverable_conclusion_inconsistent');
  }
  if (!isWorkflowReviewStepConclusionAllowed(json.deliverable.conclusion, json.step.title)) {
    issues.push('invalid_json_schema');
  }
  if (
    params.actorRoleName?.trim()
    && json.deliverable.path.trim()
    && !validateWorkflowJsonExplicitDeliverablePaths(
      params.actorRoleName,
      json.deliverable.path,
    )
  ) {
    issues.push('deliverable_filename_missing_role_suffix');
  }

  if (workflowInputValidationNamesRole(parsed.inputValidation)) {
    issues.push('input_validation_names_role');
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

  const rollbackBody = parsed.rollbackExplanation.trim();
  if (!isValidWorkflowRollbackExplanationBody(rollbackBody)) {
    issues.push('invalid_rollback_format');
  } else {
    const inputFail = isWorkflowInputValidationFailure(parsed.inputValidation);
    const rollbackTrigger = parseWorkflowRollbackTrigger(rollbackBody);
    if (inputFail && !rollbackTrigger) {
      issues.push('rollback_required');
    }
  }

  if (issues.length > 0) {
    return {
      ok: false,
      issues,
      detail: issues.map((i) => WORKFLOW_JSON_VALIDATION_ISSUE_MESSAGES[i] ?? i).join('；'),
      raw,
    };
  }

  return { ok: true, parsed };
}

export function formatWorkflowAgentFailureDetail(result: {
  issues: WorkflowAgentValidationIssue[];
  detail: string;
}): string {
  const fromIssues = result.issues
    .map((i) => WORKFLOW_JSON_VALIDATION_ISSUE_MESSAGES[i] ?? i)
    .filter(Boolean);
  const label =
    fromIssues.length > 0
      ? fromIssues.join('；')
      : (() => {
          const detail = result.detail.trim();
          if (detail && !detail.startsWith('【')) {
            const existing = parseExistingLabelReason(detail);
            if (existing) return existing.label;
            // Prefer a single friendly line when detail was enriched with a gateway terminal suffix.
            const stripped = stripGatewayTerminalDetailSuffix(detail);
            if (stripped && stripped !== detail.trim()) return stripped;
            return detail;
          }
          return '结构化回复未通过校验';
        })();

  // Idempotent: detail already `label(reason)`.
  const already = parseExistingLabelReason(result.detail.trim());
  if (already && already.label === label) {
    return `${label}(${already.reason})`;
  }

  const reason = extractWorkflowFailureReasonHint(result.detail, label);
  if (!reason) return label;
  // Do not use label.includes(reason): short causes (「异常」) are substrings of「调用异常」.
  if (reason === label) return label;
  return `${label}(${reason})`;
}

const GATEWAY_TERMINAL_DETAIL_PREFIX = '模型运行结束但未产出可校验回复：';

/** Primary Chinese UI strings that are labels — never parenthetical "causes". */
const WORKFLOW_FAILURE_PRIMARY_DETAIL_STRINGS: ReadonlySet<string> = new Set([
  ...Object.values(WORKFLOW_JSON_VALIDATION_ISSUE_MESSAGES),
  '等待模型回复超时',
  '模型会话调用异常',
  '结构化回复未通过校验',
]);

/** Drop the gateway terminal enrich suffix, leaving the primary validation detail. */
function stripGatewayTerminalDetailSuffix(detail: string): string {
  const idx = detail.lastIndexOf(GATEWAY_TERMINAL_DETAIL_PREFIX);
  if (idx < 0) return detail.trim();
  return detail.slice(0, idx).trim();
}

/** Parse `label(reason)` produced by a prior formatWorkflowAgentFailureDetail call. */
function parseExistingLabelReason(
  detail: string,
): { label: string; reason: string } | undefined {
  const t = detail.trim();
  if (!t.endsWith(')')) return undefined;
  const open = t.indexOf('(');
  if (open <= 0) return undefined;
  // Require balanced outer parens: label(reason) with no nested requirement beyond last ')'.
  const label = t.slice(0, open);
  const reason = t.slice(open + 1, -1);
  if (!label || !reason) return undefined;
  // Only treat as our format when label is a known primary / issue message.
  if (
    !WORKFLOW_FAILURE_PRIMARY_DETAIL_STRINGS.has(label)
    && !Object.values(WORKFLOW_JSON_VALIDATION_ISSUE_MESSAGES).includes(label)
  ) {
    // Multi-issue labels join with ； — allow those too.
    if (!label.includes('；')) return undefined;
  }
  return { label, reason };
}

/**
 * Compact underlying cause for room「执行失败」bubbles, e.g. rate-limit text.
 * Skips user-abort copy and non-causal label synonyms / abort sentinels.
 */
export function extractWorkflowFailureReasonHint(
  detail: string,
  friendlyLabel?: string,
): string | undefined {
  const t = detail.trim();
  if (!t) return undefined;
  // User-initiated abort — keep announceFailed copy unchanged (no extra reason).
  if (/用户已手动中止|用户.*中止本项目/u.test(t)) return undefined;

  // Already formatted — reason is inside label(...).
  if (friendlyLabel) {
    const existing = parseExistingLabelReason(t);
    if (existing && existing.label === friendlyLabel) return existing.reason;
  }

  let reason: string | undefined;
  const suffixIdx = t.lastIndexOf(GATEWAY_TERMINAL_DETAIL_PREFIX);
  if (suffixIdx >= 0) {
    reason = t.slice(suffixIdx + GATEWAY_TERMINAL_DETAIL_PREFIX.length).trim();
  } else {
    const lines = t.split(/\n+/u).map((l) => l.trim()).filter(Boolean);
    const candidates = lines.filter((l) => !isNonCausalFailureDetailLine(l, friendlyLabel));
    reason = candidates[candidates.length - 1];
  }

  if (!reason) return undefined;
  // RPC throw often prefixes FailoverError:; strip so room copy matches settle terminalError.
  reason = reason
    .replace(/^FailoverError:\s*/iu, '')
    .replace(/^⚠️\s*/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!reason) return undefined;
  if (isAbortSentinelReason(reason)) return undefined;
  if (isNonCausalFailureDetailLine(reason, friendlyLabel)) return undefined;
  // Equality / multi-issue segment match only — do NOT use label.includes(reason):
  // short causes like「异常」are substrings of「调用异常」and would be wrongly dropped.
  if (friendlyLabel && reason === friendlyLabel) return undefined;
  if (reason.length > 120) return `${reason.slice(0, 117)}…`;
  return reason;
}

function isAbortSentinelReason(reason: string): boolean {
  return /^(?:aborted|abort)$/iu.test(reason.trim());
}

function isNonCausalFailureDetailLine(line: string, friendlyLabel?: string): boolean {
  if (!line) return true;
  if (WORKFLOW_FAILURE_PRIMARY_DETAIL_STRINGS.has(line)) return true;
  if (friendlyLabel) {
    for (const part of friendlyLabel.split('；')) {
      const p = part.trim();
      if (p && (line === p || p === line)) return true;
    }
  }
  return false;
}

export function buildWorkflowAgentRetryPrompt(params: {
  roleName: string;
  /** 首轮完整 Workflow 任务提示词（【Workflow模式】～【输出示例】）。 */
  agentTaskBody: string;
  /** 上次模型输出（供对照与字段 diff）。 */
  priorRaw?: string;
  transportReason?: 'timeout' | 'error' | 'empty';
  validationDetail?: string;
  issues?: WorkflowAgentValidationIssue[];
  /** 本步标题（修正指引中的 rollback 占位）。 */
  stepTitle?: string;
  /** @deprecated 保留参数兼容调用方 */
  isCoordinatorRole?: boolean;
  /** @deprecated 保留参数兼容调用方 */
  expectedHandoffLines?: string[];
}): string {
  const ctx = { roleName: params.roleName, stepTitle: params.stepTitle };
  const transportReasons: string[] = [];
  if (params.transportReason === 'timeout') transportReasons.push('上次等待超时');
  if (params.transportReason === 'error') transportReasons.push('上次调用异常');

  const structuredReason = params.issues?.length
    ? formatWorkflowStructuredValidationFailureDetail(params.issues, ctx)
    : params.validationDetail?.trim() ?? '';

  const reasonParts = [
    ...transportReasons,
    structuredReason ? `结构校验：${structuredReason}` : '',
    params.issues?.length ? `问题码：${params.issues.join(',')}` : '',
  ].filter(Boolean);

  const correctionBlock = [
    `【${params.roleName}·步骤格式纠正】`,
    '你上一次的输出不符合工作流节点格式。',
    reasonParts.length ? `原因：${reasonParts.join('；')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const diffBlock = buildWorkflowRetryDiffBlock({
    priorRaw: params.priorRaw,
    issues: params.issues,
    roleName: params.roleName,
    stepTitle: params.stepTitle,
  });

  const taskBody = params.agentTaskBody.trim();
  return [
    correctionBlock,
    diffBlock,
    taskBody,
    '请直接按 JSON schema 格式输出，不要道歉或解释原因。',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildAgentTaskPrompt(params: {
  roleName: string;
  taskTitle: string;
  taskDescription: string;
  featureDescription?: string;
  stepTitle: string;
  stepDescription: string;
  /** @deprecated 不再写入提示词；保留参数兼容 workflow-runner 调用 */
  scenarioName: string;
  teammateNames?: string[];
  priorDeliverables?: string;
  /** 直接前驱节点交付摘要（供 inputValidation 示例 targets）。 */
  directPredecessorDeliverables?: string;
  /** 非协调者：工作流安排的下一跳（用于推进说明，非【交接】@指派） */
  expectedHandoffLines?: string[];
  isCoordinatorRole?: boolean;
  stepIndex?: number;
  totalSteps?: number;
  projectDirectoryLines?: string[];
}): string {
  return buildWorkflowAgentTaskPrompt({
    roleName: params.roleName,
    taskTitle: params.taskTitle,
    taskDescription: params.taskDescription,
    featureDescription: params.featureDescription,
    stepTitle: params.stepTitle,
    stepDescription: params.stepDescription,
    teammateNames: params.teammateNames,
    priorDeliverables: params.priorDeliverables,
    directPredecessorDeliverables: params.directPredecessorDeliverables,
    stepIndex: params.stepIndex,
    totalSteps: params.totalSteps,
    projectDirectoryLines: params.projectDirectoryLines,
    isCoordinatorRole: params.isCoordinatorRole,
    expectedHandoffLines: params.expectedHandoffLines,
  });
}
