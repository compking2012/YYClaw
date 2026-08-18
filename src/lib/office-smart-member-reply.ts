import {
  officeDeliverableDeclaresFilePath,
  validateWorkflowRoleScopedDeliverablePaths,
} from '@/lib/office-deliverable-file-policy';
import { isSmartValidationSectionExempt } from '@/lib/office-smart-validation-scope';
import {
  isSmartMemberInputInvalidLazyReply,
  isSmartMemberInputValidationFailureReport,
  smartMemberRoomReplyMentionsPeer,
} from '@/lib/office-smart-input-validation';
import {
  isAllMentionToken,
  isGenericCoordinatorMentionToken,
  parseMentions,
  roleMatchesMentionToken,
} from '@/lib/office-mention-parse';
import { roleMentionToken } from '@/lib/office-mention';
import type { ProjectAgentRef } from '@/lib/office-workflow-node';
import type { OfficeRole } from '@/types/office';
import { normalizeTeamMember, type LegacyTeamMember } from '@/lib/office-agent-id-resolve';
import { isSmartJsonShapeText, parseSmartMemberJsonOutput, smartDispatchRoleTaskText } from '@/lib/office-smart-json-schema';
import { tryParseWorkflowJsonObject } from '@/lib/office-workflow-json-parse';
import {
  extractSmartCoordinatorDispatchOnlyText,
  parseStructuredSmartDispatch,
  smartDispatchAssignmentTextForRole,
} from '@/lib/office-smart-room-fields';
import {
  INPUT_FAILURE_REPORT_RE,
  smartInputSectionIndicatesFailure,
} from '@/lib/office-smart-input-validation';

function coordinatorDispatchTextForAssignment(raw: string): string {
  const text = raw.trim();
  if (!text || !isSmartJsonShapeText(text)) return '';
  const structured = parseStructuredSmartDispatch(text, { routingOnly: true });
  if (structured?.length) return smartDispatchRoleTaskText(structured);
  return extractSmartCoordinatorDispatchOnlyText(text);
}

/** 协调者显示名 / @token，用于校验成员是否点名协调者。 */
export type SmartCoordinatorRef = Pick<ProjectAgentRef, 'agentId' | 'displayName'> | LegacyTeamMember;

function coordinatorRef(coordinator: SmartCoordinatorRef): ProjectAgentRef {
  return normalizeTeamMember(coordinator);
}

/** Smart 成员被点名时：依赖/分工是否允许真正开工；acceptance=仅验收/结项通知。 */
export type SmartMemberExecutionReadiness = 'blocked' | 'ready' | 'acceptance';

const PROMISE_ONLY_RES: RegExp[] = [
  /^明白[了啦]?[，,、\s]{0,12}(?:我|咱|本角色)?(?:现在|马上|这就|立即)?(?:开始|开工|干活|执行|处理|办)/iu,
  /^(?:好的|收到|了解|知道了)[，,、\s]{0,12}(?:我|咱)?(?:现在|马上|这就|立即)?(?:开始|开工|干活|执行)/iu,
  /(?:现在|马上|这就|立即)(?:开始|开工|干活|执行|去办|处理)/iu,
  /开始(?:干活|执行|处理了)/iu,
  /这就(?:开始|去|办|干|处理)/iu,
  /(?:我会|我来|我去)(?:开始|处理|执行|跟进)/iu,
];

const DELIVERABLE_SIGNAL_RE =
  /(?:已完成|完成了|交付|产出|结果|阻塞|风险|联调|通过|失败|接口|模块|测试|文档|版本|清单|草案|用例|代码|实现|修复|提交|PRD|具体|验收|问题|方案|账号|环境|依赖|缺口|延期|定稿|提测|核对|排期)/iu;

/** 进行中/计划汇报（非完成交付）—— ready 成员禁止发群。 */
const SMART_IN_PROGRESS_ONLY_RE =
  /(?:撰写中|进行中|待完成|按计划推进|暂无阻塞|保持.{0,8}节奏|有变化及时同步|继续推进|流程确认|当前进度|进度[:：]|明日.{0,12}前(?:交付|完成)|周[一二三四五六日].{0,12}前(?:交付|完成)|\d{1,2}:\d{2}前(?:交付|完成)|预计.{0,16}前(?:交付|完成|发布))/iu;

/** 可核验的完成交付（含自测/验收通过）。 */
const SMART_COMPLETED_DELIVERABLE_RE =
  /(?:已完成.{0,24}(?:交付|编写|开发|测试|实现|定稿|联调)|已交付|交付物|自测.{0,8}通过|完成自测|测试通过|验收通过|联调通过|定稿完成|全文如下|见附件|见路径|\.(?:html?|md|pdf|docx?)\b)/iu;

/** 成员向协调者汇报子任务完成时须带的完成标记，推荐 **五子棋需求文档已完成**。 */
export const SMART_SUBTASK_DONE_MARKER_RE = /(?:\*\*[^*\n]{1,48}已完成\*\*|【[^】\n]{1,48}已完成】)/u;

const SMART_MENTION_STRUCTURAL_SECTION_TITLES =
  /^(?:理解|任务理解|判定|输入校验|输入检查|输出校验|输出检查|交付产物|产物|群聊回复|回复|交付|分工|指派|交接)$/u;

/** 【群聊回复】正文内的【子任务名已完成】标记，不是独立段落标题。 */
export function isSmartSubtaskDoneBracketTitle(title: string): boolean {
  const t = title.trim();
  if (!t || SMART_MENTION_STRUCTURAL_SECTION_TITLES.test(t)) return false;
  if (!t.endsWith('已完成')) return false;
  return SMART_SUBTASK_DONE_MARKER_RE.test(`【${t}】`);
}

/** 成员侧误报的项目级收尾措辞（协调者结项须在【群聊回复】末尾 **项目结项**）。 */
export const SMART_PROJECT_COMPLETE_MARKERS =
  /【任务完成】|任务已全部完成|全部子任务已完成|(?<![\u4e00-\u9fff])任务完成[。.!！]?$/iu;

/** 成员 @ 协调者 时发言类型（供协调者 prompt 分支）。 */
export type SmartMemberReportToCoordinatorKind =
  | 'subtask_done'
  | 'project_complete'
  | 'consultation'
  | 'feedback'
  | 'blocked_report'
  /** 成员【输入校验】不合格，须由协调者在【分工】@ 上游补交付 */
  | 'input_validation_failed'
  /** 成员说明此前已交付、请协调者确认验收（非新完成汇报） */
  | 'prior_delivery_ack'
  | 'other';

const SMART_CONSULTATION_RE =
  /(?:请问|请教|咨询|是否|能否|可否|怎么|如何|建议先|优先级|确认一下|帮忙看|麻烦|疑问|请\s*[@＠])/iu;

const SMART_FEEDBACK_RE = /(?:意见|反馈|认为|希望调整|建议改为|不如|可否改为)/iu;

/** 进展/分工/点名人指令中含未满足依赖时视为 blocked。 */
const SMART_BLOCKED_CONTEXT_RE =
  /阻塞|依赖未|前置未|等待(?!我思考)|待协调|待确认|待交付|待\w+完成|待[\u4e00-\u9fff\w]{1,32}(?:提供|交付|就绪|完成后|提测)|(?:提供|交付|就绪|提测|产物)后(?:立即|再)|待(?:开发|产品|测试|设计|PM|pm)|尚未(?:就绪|开展|收到)?|未就绪|未满足|无法开展|不可开展|依赖解除前|需要先|缺少|缺口|仍待|还待|未分配|无分工|尚无分工/u;

const DEPENDENCY_REPORT_RE =
  /依赖|阻塞|前置|待\w*(?:完成|就绪|确认|交付|协调|提供|提测)|尚未|无法开展|不可开展|需要先|缺少|缺口|未就绪|未满足|请.*协调|等待.{0,12}(?:产物|交付|HTML|链接)/u;

/** 项目级收尾/闸门（非「该成员个人前置未满足」）。 */
const PROJECT_GATE_CLAUSE_RE =
  /[，,；;]?[^。！？\n]*(?:待[\u4e00-\u9fff\w]{1,32}完成后(?:即可)?(?:结项|收尾|结束|交付)|即可结项|全部子任务已完成|项目(?:可|已)?结项)[。！？]?/gu;

const DIRECT_ASSIGNMENT_ACTION_RE =
  /(?:完成|交付|优化|实现|编写|修复|提交|上线|切换|联调|验收|负责|承担|输出|撰写|整理|汇总|分析|设计|开发|按计划|今日|明日|\d{1,2}:\d{2}|\d+[点时]前完成|截止)/iu;

/** @角色 后仅为验收/结项通知（非新派活）。 */
const MENTION_ACCEPTANCE_CLAUSE_RE =
  /(?:验收通过|已通过验收|交付物.{0,16}符合|符合需求|验收结论|确认.{0,8}通过|已无新(?:任务|分工|派活))/u;

/** @角色 片段内仍含时限/交付类新派活。 */
const NEW_ASSIGNMENT_IN_CLAUSE_RE =
  /(?:完成|交付|实现|编写|修复|提交|优化|联调).{0,24}(?:前|截止|\d{1,2}:\d{2})|(?:今日|明日).{0,12}(?:完成|交付)/iu;

const MENTION_TOKEN_IN_TEXT_RE = /[@＠]([\w\u4e00-\u9fa5][\w\u4e00-\u9fa5.-]*)/gu;

export type SmartMentionTargetRole = Pick<ProjectAgentRef, 'agentId' | 'displayName'>;

function roleRefForMatch(
  role: SmartMentionTargetRole & { id?: string; name?: string },
): Pick<ProjectAgentRef, 'agentId' | 'displayName'> {
  const agentId = (role.agentId ?? role.id ?? '').trim();
  return {
    agentId,
    displayName: (role.displayName ?? role.name ?? agentId).trim(),
  };
}

function mentionTargetAsDispatchRole(
  role: SmartMentionTargetRole,
): Pick<OfficeRole, 'id' | 'name'> {
  const ref = roleRefForMatch(role);
  return { id: ref.agentId, name: ref.displayName };
}

/** 去掉项目级「待X完成后结项」类表述，避免误伤被点名的执行者。 */
export function stripProjectGateClauses(text: string): string {
  return text.replace(PROJECT_GATE_CLAUSE_RE, '').replace(/\s+/g, ' ').trim();
}

export function mentionClauseForRole(text: string, role: SmartMentionTargetRole): string | null {
  const roleRef = roleRefForMatch(role);
  let m: RegExpExecArray | null;
  const re = new RegExp(MENTION_TOKEN_IN_TEXT_RE.source, 'gu');
  while ((m = re.exec(text)) !== null) {
    const token = m[1]!;
    if (!roleMatchesMentionToken(roleRef as ProjectAgentRef, token)) continue;
    return text.slice(m.index!, m.index! + 160);
  }
  return null;
}

/** Smart 成员点名：仅把与本角色相关的 @ 片段交给模型，避免复述整条协调者广播。 */
export function smartMemberMentionRoomLine(
  fullTrigger: string,
  role: SmartMentionTargetRole,
  triggerPreview: string,
): string {
  const clause = mentionClauseForRole(fullTrigger, role);
  if (clause) return clause;
  const trimmed = fullTrigger.trim();
  if (trimmed.length <= 280) return trimmed;
  const preview = triggerPreview.trim();
  return preview || `${trimmed.slice(0, 279)}…`;
}

/** 点名人 dispatch[] 中该角色是否为验收/结项通知（非新派活）。 */
export function isSmartMemberAcceptanceNoticeFromDispatch(
  jsonRaw: string,
  role: SmartMentionTargetRole,
): boolean {
  const dispatch = parseStructuredSmartDispatch(jsonRaw.trim(), { routingOnly: true }) ?? [];
  const assignment = smartDispatchAssignmentTextForRole(dispatch, mentionTargetAsDispatchRole(role));
  if (!assignment) return false;
  if (DIRECT_ASSIGNMENT_ACTION_RE.test(assignment)) return false;
  if (!MENTION_ACCEPTANCE_CLAUSE_RE.test(assignment)) return false;
  return !NEW_ASSIGNMENT_IN_CLAUSE_RE.test(assignment);
}

/** @deprecated 群聊正文不参与路由；请用 {@link isSmartMemberAcceptanceNoticeFromDispatch}。 */
export function isSmartMemberAcceptanceNotice(
  roomLine: string,
  role: SmartMentionTargetRole,
): boolean {
  const text = roomLine.trim();
  if (isSmartJsonShapeText(text)) {
    return isSmartMemberAcceptanceNoticeFromDispatch(text, role);
  }
  return false;
}

/** 已完成交付的分工摘要压缩为一行（避免 prompt 重复粘贴全文）。 */
export function compactSmartMemberAssignmentSummary(
  summary: string | null | undefined,
): string | null {
  const t = summary?.trim();
  if (!t) return null;
  if (!SMART_COMPLETED_DELIVERABLE_RE.test(t)) return t;
  const pathMatch = t.match(/[`'"]?([^\s`'"]+\.(?:py|ts|tsx|js|md|html?))[`'"]?/i);
  const pathHint = pathMatch?.[1] ? `（${pathMatch[1]}）` : '';
  if (/请\s*[@＠]?\s*PM\s*验收|已交付|现交付如下/u.test(t)) {
    return `已交付${pathHint}；详见上文已保存进展，当前无新子任务`.slice(0, 140);
  }
  const oneLine = t.split('\n')[0]?.trim() ?? t;
  return oneLine.length > 140 ? `${oneLine.slice(0, 139)}…` : oneLine;
}

/** 协调者 dispatch[] 是否向该角色派活（禁止从群聊展示正文解析）。 */
export function hasCoordinatorDirectAssignmentToRole(
  jsonRaw: string,
  role: SmartMentionTargetRole,
): boolean {
  const text = jsonRaw.trim();
  if (!text || !isSmartJsonShapeText(text)) return false;
  const dispatchLine = coordinatorDispatchTextForAssignment(text);
  if (!dispatchLine || /^无$/iu.test(dispatchLine)) return false;
  const assignment = smartDispatchAssignmentTextForRole(
    parseStructuredSmartDispatch(text, { routingOnly: true }) ?? [],
    mentionTargetAsDispatchRole(role),
  );
  if (!assignment) return false;
  if (/等待.{0,24}(?:交付|就绪|产品|需求|上游)/u.test(assignment)) return false;
  if (DIRECT_ASSIGNMENT_ACTION_RE.test(assignment)) return true;
  if (isSmartMemberAcceptanceNoticeFromDispatch(text, role)) return false;
  return false;
}

function mentionTokenMatchesRole(token: string, role: SmartMentionTargetRole): boolean {
  return roleMatchesMentionToken(roleRefForMatch(role) as ProjectAgentRef, token);
}

/** 兜底文案中「等待的对象」：跳过被点名角色自身与其它 @。 */
export function pickPeerMentionTokenForWaiting(
  roomLine: string,
  mentionTargetRole?: SmartMentionTargetRole,
): string | null {
  const tokens = parseMentions(roomLine);
  for (const token of tokens) {
    if (mentionTargetRole && mentionTokenMatchesRole(token, mentionTargetRole)) continue;
    return token;
  }
  return null;
}

/**
 * Smart 成员点名就绪：仅据本条协调者群聊触发正文推断，不读磁盘分工。
 */
export function resolveSmartMemberReadinessForMentionDispatch(params: {
  coordinatorRoomLine: string;
  mentionTargetRole: SmartMentionTargetRole;
}): SmartMemberExecutionReadiness {
  return inferSmartMemberReadinessForMention({
    coordinatorRoomLine: params.coordinatorRoomLine,
    mentionTargetRole: params.mentionTargetRole,
  });
}

/**
 * 从协调者触发 JSON 推断成员是否可开工（**仅 Smart**；禁止读群聊展示正文）。
 */
export function inferSmartMemberReadinessForMention(params: {
  coordinatorRoomLine: string;
  mentionTargetRole?: SmartMentionTargetRole;
}): SmartMemberExecutionReadiness {
  const jsonRaw = params.coordinatorRoomLine.trim();
  if (!jsonRaw || !isSmartJsonShapeText(jsonRaw)) return 'blocked';

  const dispatch = parseStructuredSmartDispatch(jsonRaw, { routingOnly: true });
  if (!dispatch?.length) return 'blocked';

  if (!params.mentionTargetRole) return 'ready';

  const role = params.mentionTargetRole;
  if (hasCoordinatorDirectAssignmentToRole(jsonRaw, role)) {
    return 'ready';
  }
  if (isSmartMemberAcceptanceNoticeFromDispatch(jsonRaw, role)) {
    return 'acceptance';
  }

  const assignment = smartDispatchAssignmentTextForRole(dispatch, mentionTargetAsDispatchRole(role));
  if (!assignment) return 'blocked';

  const scoped = stripProjectGateClauses(assignment);
  if (
    SMART_BLOCKED_CONTEXT_RE.test(scoped)
    && !DIRECT_ASSIGNMENT_ACTION_RE.test(scoped)
  ) {
    return 'blocked';
  }
  return 'ready';
}

/** blocked 路径：@协调者 且说明等待他角色/上游产物。 */
export function isSmartMemberWaitingForPeerReply(text: string): boolean {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t || isSmartMemberPromiseOnlyReply(t)) return false;
  if (!/[@＠][\w\u4e00-\u9fa5]/u.test(t)) return false;
  return /待|尚未|等待|收到.{0,12}(?:产物|交付|HTML|链接|仓库)|无法(?:开展|执行)|阻塞|前置|依赖|就绪后/u.test(
    t,
  );
}

/** LLM 两次格式失败后，blocked 成员可发布的兜底依赖说明；被直接派活时不生成。 */
export function synthesizeBlockedMemberDependencyReply(
  coordinator: SmartCoordinatorRef,
  coordinatorLine: string,
  mentionTargetRole?: SmartMentionTargetRole,
): string | null {
  const json = synthesizeBlockedMemberDependencyJson(
    mentionTargetRole?.displayName?.trim() || '成员',
    coordinator,
    coordinatorLine,
    mentionTargetRole,
  );
  return json;
}

/** blocked 成员兜底：action=help JSON + dispatch 点名协调者（可过校验并触发 follow-up）。 */
export function synthesizeBlockedMemberDependencyJson(
  memberRoleName: string,
  coordinator: SmartCoordinatorRef,
  coordinatorLine: string,
  mentionTargetRole?: SmartMentionTargetRole,
): string | null {
  if (
    mentionTargetRole
    && hasCoordinatorDirectAssignmentToRole(coordinatorLine, mentionTargetRole)
  ) {
    return null;
  }
  const role = memberRoleName.trim() || '成员';
  const coordName = coordinatorRef(coordinator).displayName;
  const line = coordinatorLine.replace(/\s+/g, ' ').trim();
  const excerpt = line.length > 120 ? `${line.slice(0, 119)}…` : line;
  return JSON.stringify(
    {
      role,
      taskUnderstanding: '上游依赖未就绪，无法开展本回合任务，向协调者说明阻塞。',
      action: 'help',
      deliverable: { items: [], outputValidation: [] },
      roomReply:
        `【依赖阻塞】上游交付物未就绪或路径不存在，本角色无法开工。（摘录：${excerpt}）`,
      dispatch: [
        {
          role: coordName,
          task: '请协调上游在项目目录补交付后再派工本角色。',
        },
      ],
    },
    null,
    2,
  );
}

/**
 * 从分工摘要、已保存进展、协调者交办原文推断成员是否可开工。
 * 无有效分工或文本表明前置未满足 → blocked；否则 ready。
 */
/** 结合分工预判与模型正文，优先识别阻塞（避免误判 ready 后要求交付）。 */
export function resolveSmartMemberReadiness(
  hinted: SmartMemberExecutionReadiness | undefined,
  ...texts: (string | null | undefined)[]
): SmartMemberExecutionReadiness {
  const nonEmpty = texts.map((t) => t?.trim()).filter(Boolean);
  const inferred =
    nonEmpty.length > 0 ? inferSmartMemberReadiness(nonEmpty) : undefined;
  if (hinted === 'acceptance') return 'acceptance';
  if (inferred === 'blocked') return 'blocked';
  if (hinted === 'ready') {
    return 'ready';
  }
  if (hinted === 'blocked') return 'blocked';
  if (inferred === 'ready') return 'ready';
  return 'blocked';
}

export function inferSmartMemberReadiness(
  texts: (string | null | undefined)[],
): SmartMemberExecutionReadiness {
  const blob = texts
    .map((t) => t?.trim())
    .filter(Boolean)
    .join('\n');
  if (!blob) return 'blocked';
  const compact = blob.replace(/\s+/g, '');
  if (
    /^(?:OK[，,]?(?:待我思考下|待我在思考下|我在思考中)|收到[，,]?待我思考下)[。.!！]?$/u.test(compact)
    && !DELIVERABLE_SIGNAL_RE.test(blob)
  ) {
    return 'blocked';
  }
  if (SMART_BLOCKED_CONTEXT_RE.test(blob)) return 'blocked';
  return 'ready';
}

/** 群聊正文是否包含对协调者的 @（显示名 / id token）。 */
export function smartMemberReplyMentionsCoordinator(
  text: string,
  coordinator: SmartCoordinatorRef,
): boolean {
  const coord = coordinatorRef(coordinator);
  const mentions = parseMentions(text);
  if (mentions.length === 0) return false;
  const id = coord.agentId.toLowerCase();
  const name = coord.displayName.toLowerCase();
  const token = roleMentionToken(coord).toLowerCase();
  return mentions.some((raw) => {
    if (isGenericCoordinatorMentionToken(raw)) return true;
    const t = raw.toLowerCase().trim();
    if (!t) return false;
    if (t === id || t === name || t === token) return true;
    if (t.length >= 2 && (name.startsWith(t) || t.startsWith(name))) return true;
    return false;
  });
}

/** 协调者 token，供 prompt 明示。 */
export function smartCoordinatorMentionRef(coordinator: SmartCoordinatorRef): string {
  return roleMentionToken(coordinatorRef(coordinator));
}

/** Smart 成员「只承诺开工、无实质交付」话术（如「明白了，我现在开始干活」）。 */
export function isSmartMemberPromiseOnlyReply(text: string): boolean {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t || t.length < 6) return true;
  if (isSmartMemberInProgressOnlyReply(t)) return true;
  if (DELIVERABLE_SIGNAL_RE.test(t) && SMART_COMPLETED_DELIVERABLE_RE.test(t)) return false;
  if (DELIVERABLE_SIGNAL_RE.test(t) && !SMART_IN_PROGRESS_ONLY_RE.test(t)) return false;
  const sentenceCount = (t.match(/[。.!！?？]/g) ?? []).length;
  if (t.length >= 100 && sentenceCount >= 2 && SMART_COMPLETED_DELIVERABLE_RE.test(t)) {
    return false;
  }
  return PROMISE_ONLY_RES.some((re) => re.test(t));
}

/** 依赖已就绪时：仅为进行中/计划汇报，未完成交付且未自测。 */
export function isSmartMemberInProgressOnlyReply(text: string): boolean {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t) return true;
  if (SMART_COMPLETED_DELIVERABLE_RE.test(t) && !/(?:撰写中|进行中|待完成|明日|前交付|继续推进)/u.test(t)) {
    return false;
  }
  if (SMART_IN_PROGRESS_ONLY_RE.test(t)) return true;
  if (/已完成/u.test(t) && /(?:进行中|撰写中|待完成)/u.test(t)) return true;
  return false;
}

/** 依赖未就绪：向协调者说明阻塞/前置/待协调事项（非开工承诺）。 */
export function isSmartMemberDependencyReportReply(text: string): boolean {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t || isSmartMemberPromiseOnlyReply(t)) return false;
  return DEPENDENCY_REPORT_RE.test(t);
}

/** 验收/结项通知路径：简短确认收到即可。 */
export function isSmartMemberAcceptanceAckReply(text: string): boolean {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t || t.length < 10 || isSmartMemberPromiseOnlyReply(t)) return false;
  if (isSmartMemberInProgressOnlyReply(t)) return false;
  return /(?:收到|确认|已知悉|无新(?:任务|分工|派活)|验收|谢谢)/u.test(t);
}

/** 子任务完成汇报是否含规定的【…已完成】标记。 */
export function isSmartMemberSubtaskDoneMarker(text: string): boolean {
  return SMART_SUBTASK_DONE_MARKER_RE.test(text.trim());
}

/** 成员本轮任务是否由结构化 action=end 声明完成（仅认 JSON）。 */
export function smartMemberReplyDeclaresEnd(text: string): boolean {
  const t = text.trim();
  if (!t || !isSmartJsonShapeText(t)) return false;
  if (parseSmartMemberJsonOutput(t)?.action === 'end') return true;
  const obj = tryParseWorkflowJsonObject(t);
  const action = obj?.action;
  return typeof action === 'string' && action.trim() === 'end';
}

/** 成员本轮是否为 action=help 求助（仅认原始 JSON 的 action 字段）。 */
export function isSmartMemberHelpAction(text: string): boolean {
  const t = text.trim();
  if (!t || !isSmartJsonShapeText(t)) return false;
  if (parseSmartMemberJsonOutput(t)?.action === 'help') return true;
  const obj = tryParseWorkflowJsonObject(t);
  const action = obj?.action;
  return typeof action === 'string' && action.trim() === 'help';
}

/** 成员 @ 协调者 的正文类型：子任务完成 / 咨询 / 阻塞等。 */
const SMART_PRIOR_DELIVERY_ACK_RE =
  /已于之前完成|先前已.{0,12}(?:交付|完成)|已经交付|无需重复|请\s*[@＠]?\s*(?:PM|协调者|pm)\s*确认验收/u;

/** 成员 @ 协调者 的正文类型：仅从结构化 JSON 推断（群聊展示正文不参与路由）。 */
export function classifySmartMemberReportToCoordinator(
  jsonRaw: string,
): SmartMemberReportToCoordinatorKind {
  const t = jsonRaw.trim();
  if (!t || !isSmartJsonShapeText(t)) return 'other';
  const member = parseSmartMemberJsonOutput(t);
  if (!member) return 'other';
  if (member.action === 'end') return 'subtask_done';
  if (member.action === 'help') {
    const understanding = member.taskUnderstanding.trim();
    if (SMART_PRIOR_DELIVERY_ACK_RE.test(understanding)) {
      return 'prior_delivery_ack';
    }
    if (
      INPUT_FAILURE_REPORT_RE.test(understanding)
      || smartInputSectionIndicatesFailure(understanding)
    ) {
      return 'input_validation_failed';
    }
    return 'blocked_report';
  }
  if (SMART_PRIOR_DELIVERY_ACK_RE.test(member.taskUnderstanding.trim())) {
    return 'prior_delivery_ack';
  }
  if (SMART_FEEDBACK_RE.test(member.taskUnderstanding)) return 'feedback';
  if (SMART_CONSULTATION_RE.test(member.taskUnderstanding)) return 'consultation';
  return 'other';
}

export function smartMemberReportKindLabel(
  kind: SmartMemberReportToCoordinatorKind,
): string {
  const map: Record<SmartMemberReportToCoordinatorKind, string> = {
    subtask_done: '子任务完成汇报（含 **…已完成**）',
    project_complete: '项目级任务完成',
    consultation: '咨询/确认类（非完成汇报）',
    feedback: '意见/反馈类（非完成汇报）',
    blocked_report: '依赖/阻塞说明',
    input_validation_failed: '【输入校验】不合格（须协调者【分工】@ 上游补交付）',
    prior_delivery_ack: '此前已交付、请协调者确认验收',
    other: '其它发言',
  };
  return map[kind];
}

/** 依赖已就绪：须含完成交付 + 自测/验收可核验说明（非进行中进度）。 */
export function isSmartMemberDeliverableReply(text: string): boolean {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t || isSmartMemberPromiseOnlyReply(t)) return false;
  if (isSmartMemberInProgressOnlyReply(t)) return false;
  if (SMART_COMPLETED_DELIVERABLE_RE.test(t)) return true;
  if (isSmartMemberDependencyReportReply(t)) return true;
  const sentenceCount = (t.match(/[。.!！?？]/g) ?? []).length;
  return t.length >= 72 && sentenceCount >= 2 && DELIVERABLE_SIGNAL_RE.test(t);
}

/**
 * Smart JSON 结构化校验专用：roomReply 有完成标记（加粗或【】）+ 摘要即可，不强制 72 字与显式交付动词。
 * 仅由 validateSmartMemberRoomReply 使用，不影响提示词与其它分类逻辑。
 */
export function isSmartMemberJsonRoomReplyDeliverableComplete(text: string): boolean {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t || isSmartMemberPromiseOnlyReply(t)) return false;
  if (isSmartMemberInProgressOnlyReply(t)) return false;
  if (isSmartMemberSubtaskDoneMarker(t)) {
    const rest = t
      .replace(SMART_SUBTASK_DONE_MARKER_RE, '')
      .replace(/[@＠][\w\u4e00-\u9fa5][\w\u4e00-\u9fa5.-]*/gu, '')
      .trim();
    if (rest.length >= 8) return true;
  }
  if (SMART_COMPLETED_DELIVERABLE_RE.test(t)) return true;
  if (isSmartMemberDependencyReportReply(t)) return true;
  return DELIVERABLE_SIGNAL_RE.test(t) && t.length >= 24;
}

export function validateSmartMemberRoomReply(
  publishText: string,
  coordinator: SmartCoordinatorRef,
  readiness: SmartMemberExecutionReadiness,
  options?: {
    /** 【交付产物】正文；为「无」等豁免写法时走依赖汇报规则而非完成交付规则。 */
    deliverableSection?: string;
    /** 【交付产物】名称 /【输出校验】路径，用于群聊正文未重复写交付物名称时的核验。 */
    deliverablePathText?: string;
    teamRoles?: Pick<ProjectAgentRef, 'agentId' | 'displayName'>[];
    /** 引擎判定【输入校验】路径不存在或段落声明不合格 */
    inputValidationFailed?: boolean;
    /** dispatch 段正文；Smart 路由仅看 dispatch，不看 roomReply 中的 @ */
    dispatchText?: string;
    /** 成员 action=end；true 表示本轮任务已完成，是结构化完成依据。 */
    memberEnd?: boolean;
    /** action=help：依赖未就绪/咨询/求助，允许无本轮交付物。 */
    memberHelp?: boolean;
    /** 当前成员显示名，用于校验交付物须落在 交付物-角色/ 下。 */
    actorRoleName?: string;
  },
): Array<
  | 'smart_member_missing_coordinator'
  | 'smart_member_mentions_peer'
  | 'smart_member_input_invalid_lazy'
  | 'smart_member_promise_only'
  | 'smart_member_in_progress_only'
  | 'smart_member_missing_dependency_report'
  | 'smart_member_missing_deliverable'
  | 'smart_member_missing_action_end'
  | 'smart_member_missing_file_deliverable'
  | 'smart_member_deliverable_inline_too_long'
  | 'deliverable_filename_missing_role_suffix'
  | 'smart_member_missing_acceptance_ack'
  | 'smart_member_acceptance_action_help'
> {
  const issues: Array<
    | 'smart_member_missing_coordinator'
    | 'smart_member_mentions_peer'
    | 'smart_member_input_invalid_lazy'
    | 'smart_member_promise_only'
    | 'smart_member_in_progress_only'
    | 'smart_member_missing_dependency_report'
    | 'smart_member_missing_deliverable'
    | 'smart_member_missing_action_end'
    | 'smart_member_missing_file_deliverable'
    | 'smart_member_deliverable_inline_too_long'
    | 'deliverable_filename_missing_role_suffix'
    | 'smart_member_missing_acceptance_ack'
    | 'smart_member_acceptance_action_help'
  > = [];
  const mentionText = options?.dispatchText?.trim() ?? '';
  if (!smartMemberReplyMentionsCoordinator(mentionText, coordinator)) {
    issues.push('smart_member_missing_coordinator');
  }
  if (
    options?.teamRoles?.length
    && smartMemberRoomReplyMentionsPeer(mentionText, coordinator, options.teamRoles)
  ) {
    issues.push('smart_member_mentions_peer');
  }
  if (isSmartMemberPromiseOnlyReply(publishText)) {
    issues.push('smart_member_promise_only');
  }

  const inputFailed = options?.inputValidationFailed === true;
  const memberHelp = options?.memberHelp === true;

  if (readiness === 'acceptance') {
    if (memberHelp) {
      issues.push('smart_member_acceptance_action_help');
    }
    if (!isSmartMemberAcceptanceAckReply(publishText)) {
      issues.push('smart_member_missing_acceptance_ack');
    }
    return [...new Set(issues)];
  }

  if (inputFailed) {
    if (
      isSmartMemberInputInvalidLazyReply(publishText, {
        inputValidationFailed: true,
        deliverablePathText: options?.deliverablePathText,
        memberEnd: options?.memberEnd,
      })
    ) {
      issues.push('smart_member_input_invalid_lazy');
    }
    if (
      !isSmartMemberInputValidationFailureReport(publishText)
      && !isSmartMemberDependencyReportReply(publishText)
    ) {
      issues.push('smart_member_missing_dependency_report');
    }
    return [...new Set(issues)];
  }

  if (memberHelp) {
    return [...new Set(issues)];
  }

  if (readiness === 'blocked') {
    const dependencyOk =
      isSmartMemberDependencyReportReply(publishText)
      || isSmartMemberInputValidationFailureReport(publishText);
    if (!dependencyOk) {
      issues.push('smart_member_missing_dependency_report');
    }
  } else {
    const noDeliverableThisRound = isSmartValidationSectionExempt(
      options?.deliverableSection ?? '',
    );
    if (isSmartMemberInProgressOnlyReply(publishText)) {
      issues.push('smart_member_in_progress_only');
    } else if (noDeliverableThisRound) {
      if (
        !isSmartMemberDependencyReportReply(publishText)
        && !isSmartMemberInputValidationFailureReport(publishText)
        && !isSmartMemberWaitingForPeerReply(publishText)
      ) {
        issues.push('smart_member_missing_dependency_report');
      }
    } else if (options?.memberEnd !== true) {
      issues.push('smart_member_missing_action_end');
    } else if (
      !officeDeliverableDeclaresFilePath(
        publishText,
        options?.deliverablePathText,
      )
    ) {
      issues.push('smart_member_missing_file_deliverable');
    } else if (
      options?.actorRoleName?.trim()
      && !validateWorkflowRoleScopedDeliverablePaths(
        options.actorRoleName,
        options.deliverablePathText,
        options.deliverableSection,
      )
    ) {
      issues.push('deliverable_filename_missing_role_suffix');
    }
  }
  return issues;
}

/** 协调者 dispatch 中是否存在对某角色的明确派活（须触发成员 Session，不能当纯进度同步）。 */
export function smartCoordinatorReplyHasDirectMemberAssignment(text: string): boolean {
  const dispatchText = coordinatorDispatchTextForAssignment(text);
  const t = dispatchText.trim();
  if (!t || !/[@＠]/u.test(t)) return false;
  for (const token of parseMentions(t)) {
    if (isAllMentionToken(token) || isGenericCoordinatorMentionToken(token)) continue;
    const role: SmartMentionTargetRole = { agentId: token, displayName: token };
    if (hasCoordinatorDirectAssignmentToRole(text, role)) return true;
  }
  return false;
}

const IMMEDIATE_MENTION_ASSIGNMENT_RE =
  /[@＠][^\n@]{0,120}?(?:实现|编写|写入|修复|提交|代码工程|交付物[-/])/u;

/** 协调者进度同步/确认类群聊（不应再触发成员 LLM 点名循环）。 */
export function isSmartCoordinatorProgressSyncReply(text: string): boolean {
  const dispatchText = coordinatorDispatchTextForAssignment(text);
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t) return false;
  if (dispatchText.trim() && /[@＠]/u.test(dispatchText)) return false;
  if (/【分工】/u.test(dispatchText) && /[@＠]/u.test(dispatchText)) return false;
  if (IMMEDIATE_MENTION_ASSIGNMENT_RE.test(dispatchText)) return false;
  if (
    /(?:今日|明日).{0,16}(?:完成|交付|实现)/u.test(dispatchText)
    && /[@＠]/u.test(dispatchText)
    && !/(?:验收通过|进入测试阶段|进入开发阶段)/u.test(t)
  ) {
    return false;
  }
  return /(?:当前进度|确认同步|保持.{0,8}节奏|进度清晰|有变化及时同步|好的[，,]?保持|确认交付后|待.*确认后介入|收到.{0,24}反馈|非实际阻塞|预期流程|当前项目状态|进入测试阶段|进入开发阶段|验收通过|等待.{0,12}(?:交付|就绪|产品|需求)|⏳|⏸)/u.test(
    t,
  );
}
