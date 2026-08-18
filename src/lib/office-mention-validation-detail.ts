import { extractOfficeBracketSections } from '@/lib/office-workflow-output-sections';
import {
  formatSmartPrematureProjectEndReason,
  type SmartWorkOrderStep,
} from '@/lib/office-smart-work-order';
/** 重试对照时【交付产物】内联正文上限（路径行保留）。 */
const RETRY_DELIVERABLE_INLINE_MAX = 480;

/**
 * 重试 Prompt 用：保留结构化全文，省略【交付产物】中大段文件正文（不含磁盘文件本身）。
 */
export function sanitizePriorRawForRetryDisplay(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  const compacted = t.replace(
    /(【\s*(?:交付产物|产物)\s*】)([\s\S]*?)(?=\n【[^】\n]+】|$)/gu,
    (_match, heading: string, body: string) => {
      const b = body.trim();
      if (b.length <= RETRY_DELIVERABLE_INLINE_MAX) return `${heading}${body}`;
      const firstLine = b.split('\n').find((line) => line.trim()) ?? '';
      return `${heading}\n${firstLine}\n…（完整交付正文已在磁盘文件中，重试时勿粘贴全文）\n`;
    },
  );
  const maxTotal = 32_000;
  if (compacted.length <= maxTotal) return compacted;
  return `${compacted.slice(0, maxTotal)}\n…（上次输出过长，已截断；重试请按各【】段格式完整输出）`;
}

export type ValidationFieldIssue = {
  field: string;
  reason: string;
};

/** 已废弃 issue 码 → 现行码（日志/旧 Session 兼容）。 */
const LEGACY_VALIDATION_ISSUE_ALIASES: Record<string, string> = {
  smart_member_missing_subtask_done_marker: 'smart_member_missing_action_end',
};

function normalizeValidationIssueCode(issue: string): string {
  return LEGACY_VALIDATION_ISSUE_ALIASES[issue] ?? issue;
}

/**
 * Smart JSON 协议：校验 issue → 字段说明（单一文案源，重试/detail 均引用此处）。
 * 完成闸门仅认 action="end"（落盘 smartMemberEnd），勿再要求 roomReply 或 **…已完成**。
 */
const VALIDATION_ISSUE_MESSAGES: Record<string, ValidationFieldIssue> = {
    empty: { field: '【全文】', reason: '未收到模型正文' },
    transport_timeout: { field: '【传输】', reason: '等待模型回复超时' },
    transport_error: { field: '【传输】', reason: '模型会话调用异常' },
    model_error: { field: '【传输】', reason: '模型运行时错误（非格式问题，请检查 Provider/Gateway 日志）' },
    missing_room_reply_section: {
      field: '【群聊回复】',
      reason: '缺少该段或标题不完整',
    },
    room_reply_too_short: { field: '【群聊回复】', reason: '正文缺少实质内容' },
    fast_ack_only: {
      field: '【群聊回复】',
      reason: '仅为「收到/待我思考」等占位，无实质内容',
    },
    intermediate_only: {
      field: '【群聊回复】',
      reason: '仅有中间叙述，无群聊可发布正文',
    },
    coordinator_missing_dispatch: {
      field: 'dispatch',
      reason: '须拆解场景下 action=assign 且 dispatch 须指派本轮执行者',
    },
    missing_mention_targets: {
      field: 'dispatch',
      reason: '补指派须在 dispatch 数组指派执行者',
    },
    smart_member_missing_coordinator: {
      field: 'dispatch',
      reason: '成员须在 dispatch 数组指派协调者（引擎仅校验 dispatch[].role，不解析群聊正文里的 @）',
    },
    smart_member_mentions_peer: {
      field: 'dispatch',
      reason: '禁止在 dispatch 中指派其他成员，仅可 dispatch 协调者',
    },
    smart_member_input_invalid_lazy: {
      field: 'taskUnderstanding',
      reason: '上游未就绪时须在 taskUnderstanding 说明路径/依赖问题，禁止谎称已完成',
    },
    smart_member_promise_only: {
      field: 'taskUnderstanding',
      reason: '禁止仅承诺「开始干活」，须实质进展或交付后再汇报',
    },
    smart_member_missing_dependency_report: {
      field: 'taskUnderstanding / action',
      reason: '依赖未就绪须 action="help" 并在 taskUnderstanding 说明阻塞；勿声称已开工或 action="end"',
    },
    smart_member_missing_deliverable: {
      field: '【交付产物】/【群聊回复】',
      reason: '依赖已就绪须完成交付后再汇报',
    },
    smart_member_missing_acceptance_ack: {
      field: 'taskUnderstanding / dispatch',
      reason: '验收/结项通知回合：taskUnderstanding 简短确认，dispatch 指派协调者；禁止 action="end"',
    },
    smart_member_acceptance_action_help: {
      field: 'action',
      reason: '验收确认回合禁止 action="help"，须 dispatch 派给协调者简短确认',
    },
    smart_member_in_progress_only: {
      field: 'taskUnderstanding',
      reason: '禁止仅报进度，须完成落盘与自测后再 action="end" 汇报',
    },
    smart_member_missing_action_end: {
      field: 'action',
      reason:
        '本轮任务完成须设 action="end"（引擎据此标记 smartMemberEnd）；勿用 **…已完成** 或 roomReply 代替',
    },
    smart_member_missing_file_deliverable: {
      field: 'deliverable',
      reason: '须写入项目目录，deliverable.items 填交付物名称，deliverable.outputValidation 贴 ls -l 结果',
    },
    smart_member_deliverable_inline_too_long: {
      field: '【交付产物】/【群聊回复】',
      reason: '除路径外正文超过 500 字，完整内容须在文件中',
    },
    smart_coordinator_missing_mention: {
      field: 'dispatch',
      reason: '有新指派时 dispatch 数组须指派本阶段执行者（禁止空 dispatch）',
    },
    smart_coordinator_unknown_team_role: {
      field: 'dispatch',
      reason: 'dispatch[].role 只能填写团队现有成员显示名',
    },
    smart_coordinator_wrong_dispatch_target: {
      field: 'dispatch',
      reason: 'dispatch 数组须指派本阶段执行者（打回汇报者/上游补交付除外）',
    },
    smart_dispatch_targets_unresolvable: {
      field: 'dispatch',
      reason: 'dispatch 中的 role 无法匹配任何团队成员，无法派发成员 Session',
    },
    smart_coordinator_acceptance_has_mention: {
      field: 'dispatch',
      reason: '纯验收/点评无新指派时 dispatch 须为 []，禁止 dispatch 点名成员',
    },
    smart_coordinator_review_has_dispatch: {
      field: 'action/dispatch',
      reason: 'action=end 时 dispatch 必须为 []',
    },
    smart_coordinator_dispatch_names_reporter: {
      field: 'dispatch',
      reason:
        '成员汇报验收结论写在 taskUnderstanding；续派仅写在 dispatch，禁止 dispatch 点名刚完成汇报的成员（返工除外）',
    },
    smart_coordinator_dispatch_duplicate_role: {
      field: 'dispatch',
      reason: 'dispatch 数组每名成员每轮最多 1 项，禁止同一 role 重复出现',
    },
    smart_coordinator_premature_peer_acceptance: {
      field: 'taskUnderstanding',
      reason:
        '仅能对已在群内 action=end（smartMemberEnd）汇报完成的成员在 taskUnderstanding 写验收/完成结论；并行同伴未汇报前不得宣称其已完成（dispatch 任务说明中的上游材料引用不计）',
    },
    smart_coordinator_kickoff_action_not_assign: {
      field: 'action',
      reason: '项目 kickoff 后协调者首轮须拆解并派活，action 必须为 "assign"（禁止 end）',
    },
    smart_coordinator_action_end_mismatch: {
      field: 'action/end',
      reason: '旧协议 action/end 不一致；新协议请仅使用顶层 action 表示结项',
    },
    smart_coordinator_missing_project_end: {
      field: 'action',
      reason: '全部步骤完成后须将 action 设为 "end"，dispatch 写 []',
    },
    smart_coordinator_project_end_has_mention: {
      field: 'dispatch',
      reason: 'action="end" 结项时 dispatch 须为 []，禁止 dispatch 点名成员',
    },
    smart_coordinator_project_end_not_at_end: {
      field: 'action',
      reason: '结项须将 action 设为 "end"',
    },
    smart_coordinator_legacy_closure_section: {
      field: 'action',
      reason: '结项唯一标识为 JSON action=end',
    },
    smart_coordinator_premature_project_end: {
      field: 'action',
      reason: '工作顺序尚有步骤未完成时禁止 action:"end"；须指派下一执行者',
    },
    smart_coordinator_invalid_closure_mark: {
      field: 'action',
      reason: 'action 须为 "assign" 或 "end"',
    },
    smart_deliverable_paths_missing_on_disk: {
      field: '【输入校验】/【输出校验】/【交付产物】',
      reason: '声明路径在磁盘不存在或未附 ls -l 结果行',
    },
    deliverable_filename_missing_role_suffix: {
      field: 'deliverable.items / 【交付产物】',
      reason: '交付物须落在 交付物-角色名/ 目录下（与 Workflow 一致），禁止 target/ 或项目根散落文件',
    },
    smart_deliverable_output_validation_ls_invalid: {
      field: 'deliverable.outputValidation',
      reason: '须为与 deliverable.items 等长的 ls -l 原始结果行',
    },
    invalid_json_syntax: {
      field: '【JSON】',
      reason: 'JSON 语法错误（如字符串内双引号未转义、缺少逗号/引号）；系统会尝试轻量修复，失败则需重试',
    },
    invalid_json_missing_fields: {
      field: '【JSON】',
      reason: '缺少必填字段',
    },
    invalid_json_value: {
      field: '【JSON】',
      reason: '字段值类型、role、空值或格式不符合预期',
    },
    invalid_json_schema: {
      field: '【JSON】',
      reason:
        '输出须为符合 Smart schema 的 JSON（role/action/taskUnderstanding/deliverable/dispatch 等必填；勿输出 roomReply 字段）',
    },
    workflow_member_promise_only: {
      field: '【群聊回复】',
      reason: '禁止仅口头承诺，须可核验交付摘要',
    },
    english_internal_reasoning: {
      field: '【全文】',
      reason: '禁止英文思考/NO_REPLY，群聊须中文实质内容',
    },
    missing_task_understanding: {
      field: '【任务理解】',
      reason: '缺少行首完整标题或有效正文',
    },
    missing_workflow_mirror_section: {
      field: '【任务理解】/【输入校验】/【输出校验】/【交付产物】',
      reason: '缺少必选【】段落或标题残缺',
    },
    missing_member_mirror_section: {
      field: '【任务理解】/【输出校验】/【交付产物】',
      reason: '缺少必选【】段落或标题残缺（成员不写【输入校验】）',
    },
    missing_deliverable_section: {
      field: '【交付产物】',
      reason: '缺少该段',
    },
    deliverable_too_short: {
      field: '【交付产物】',
      reason: '关键摘要过短',
    },
    deliverable_missing_file_path: {
      field: '【交付产物】',
      reason: '未声明可核验的绝对路径',
    },
    deliverable_section_too_long: {
      field: '【交付产物】',
      reason: '本段超过 200 字上限',
    },
    deliverable_promissory_only: {
      field: '【交付产物】',
      reason: '禁止仅「已完成/已发布」空话',
    },
    deliverable_inline_too_long: {
      field: '【交付产物】等',
      reason: '去路径后信息正文超过 500 字',
    },
    input_validation_section_required: {
      field: '【输入校验】',
      reason: '须写明上一跳交付物路径或写「无」；系统会校验文件/文件夹是否存在',
    },
    output_validation_section_required: {
      field: '【输出校验】',
      reason: '须写明本轮【交付产物】路径或写「无」；系统会校验文件/文件夹是否存在',
    },
};

/** 重试 Prompt 补充修正句（可选；与 {@link mapValidationIssueToFieldReason} 配套）。 */
export const VALIDATION_ISSUE_FIX_HINTS: Record<string, string> = {
  smart_member_missing_coordinator:
    'dispatch 至少 1 项：role=协调者显示名，task=请验收/请处理。',
  smart_member_missing_action_end:
    '设置 action="end"；deliverable.items 填 交付物-角色/ 路径，outputValidation 贴等长 ls -l；dispatch 指派协调者验收。完成标识只看 action，勿写 roomReply 或 **…已完成**。',
  smart_member_acceptance_action_help:
    '验收确认回合：taskUnderstanding 简短确认，dispatch 指派协调者，action 勿用 help/end。',
  smart_coordinator_missing_mention:
    '有新指派：action="assign" 且 dispatch≥1；结项：action="end" 且 dispatch=[]。',
  smart_coordinator_wrong_dispatch_target:
    'dispatch[].role 须为本阶段执行者显示名（打回汇报者/上游补交付除外）。',
  smart_coordinator_dispatch_names_reporter:
    '验收写在 taskUnderstanding；续派写在 dispatch，勿 dispatch 点名刚汇报完成的成员。',
  invalid_json_syntax: '输出必须是合法 JSON；字符串内双引号须写成 \\".',
  invalid_json_missing_fields: '补齐 Smart JSON 必填字段（见 Schema）。',
  invalid_json_value: '修正 action/deliverable/dispatch 类型与枚举值。',
  invalid_json_schema:
    '仅输出 Schema 定义字段：role、action、taskUnderstanding、deliverable、dispatch（协调者另含 inputValidation）；禁止 roomReply。',
  deliverable_filename_missing_role_suffix:
    'deliverable.items 路径须为 交付物-角色名/文件名，禁止项目根散落文件。',
  smart_deliverable_output_validation_ls_invalid:
    'deliverable.outputValidation 须与 items 等长的 ls -l 原始行，禁止 ok/占位符。',
};

/** 将校验问题码映射为「字段 + 原因」（供失败说明与重试原因）。 */
export function mapValidationIssueToFieldReason(issue: string): ValidationFieldIssue {
  const key = normalizeValidationIssueCode(issue);
  return VALIDATION_ISSUE_MESSAGES[key] ?? { field: '【格式】', reason: issue };
}

/** 重试修正补充句（无则 undefined）。 */
export function mapValidationIssueFixHint(issue: string): string | undefined {
  const key = normalizeValidationIssueCode(issue);
  return VALIDATION_ISSUE_FIX_HINTS[key];
}

export type SmartValidationDetailContext = {
  smartNextExecutorRoleIds?: string[];
  /** @deprecated 使用 smartNextExecutorRoleIds */
  smartNextExecutorRoleId?: string | null;
  teamRoles?: { agentId: string; displayName: string }[];
  smartWorkSteps?: SmartWorkOrderStep[];
};

/** 结构化失败说明：逐字段列出原因（用于校验 detail 与重试「原因」）。 */
export function formatStructuredValidationFailureDetail(
  issues: string[],
  smartContext?: SmartValidationDetailContext,
): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const issue of issues) {
    if (
      issue === 'smart_coordinator_premature_project_end'
      && smartContext?.teamRoles
      && smartContext.smartWorkSteps
    ) {
      const nextIds = [
        ...(smartContext.smartNextExecutorRoleIds ?? []),
        ...(smartContext.smartNextExecutorRoleId
          ? [smartContext.smartNextExecutorRoleId]
          : []),
      ].filter(Boolean);
      const reason = formatSmartPrematureProjectEndReason({
        nextExecutorRoleIds: [...new Set(nextIds)],
        teamRoles: smartContext.teamRoles,
        steps: smartContext.smartWorkSteps,
      });
      const line = `【群聊回复】：${reason}`;
      if (!seen.has(line)) {
        seen.add(line);
        lines.push(line);
      }
      continue;
    }
    const { field, reason } = mapValidationIssueToFieldReason(issue);
    const line = `${field}：${reason}`;
    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  return lines.join('\n');
}

/** 从上次输出提取各【】段标题，辅助原因说明（可选调试）。 */
export function listStructuredSectionTitlesInRaw(raw: string): string[] {
  return Object.keys(extractOfficeBracketSections(raw));
}
