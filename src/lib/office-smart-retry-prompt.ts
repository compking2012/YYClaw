import { sanitizePriorRawForRetryDisplay } from '@/lib/office-mention-validation-detail';
import { parseSmartCoordinatorAction } from '@/lib/office-smart-coordinator-dispatch';
import { parseSmartCoordinatorEndFlag } from '@/lib/office-smart-project-end';

/** Smart 协调者 premature 结项闸门 issue（结项冲突专用分支唯一 blocker）。 */
export const SMART_COORDINATOR_PREMATURE_PROJECT_END_ISSUE =
  'smart_coordinator_premature_project_end' as const;

/**
 * Smart 协调者结项冲突协商阶段（与通用 3 轮格式重试正交）。
 * - none：未进入冲突分支
 * - review：第 2 轮 LLM 复核（结项冲突 Prompt）
 * - force：第 2 轮仍坚持 end，本地窄豁免 premature 后再验
 */
export type SmartCoordinatorClosureConflictPhase = 'none' | 'review' | 'force';

/** C1 + A：协调者声明 action=end 且 issues 唯一为 premature 时走结项冲突分支。 */
export function isClosureConflictOnlyFailure(params: {
  isCoordinator: boolean;
  raw: string;
  issues: string[];
}): boolean {
  if (!params.isCoordinator) return false;
  if (params.issues.length !== 1) return false;
  if (params.issues[0] !== SMART_COORDINATOR_PREMATURE_PROJECT_END_ISSUE) return false;
  return coordinatorDeclaresClosureConflictAction(params.raw);
}

/**
 * 协调者是否仍声明结项（JSON action=end）。
 * raw 为空时：若校验层已给出唯一 premature issue，则视为 end（避免 bracket 镜像丢失 JSON 形导致漏进冲突分支）。
 */
export function coordinatorDeclaresClosureConflictAction(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return true;
  if (parseSmartCoordinatorEndFlag(trimmed)) return true;
  return parseSmartCoordinatorAction(trimmed) === 'end';
}

/** Smart 结项冲突重试首行（与 `【XX-格式错误】` 互斥）。 */
export function buildSmartCoordinatorClosureConflictRetryHeader(params: {
  roleName: string;
  priorRaw: string;
}): string {
  const role = params.roleName.trim() || '协调者';
  const prior =
    sanitizePriorRawForRetryDisplay(params.priorRaw).trim() || '（无上轮有效正文）';
  return (
    `【agent ${role}-结项冲突】，原因：本地逻辑怀疑工作顺序尚有步骤未完成，`
    + '请你重新审查项目进度，如果确认项目任务已完成则 action="end" 结项处理，'
    + `否则继续指派任务直到项目任务全部完成--上一轮输出：${prior}`
  );
}

/** Smart 结项冲突完整 Prompt：冲突首行 + 首轮正文 + 末尾指令。 */
export function buildSmartCoordinatorClosureConflictRetryPrompt(params: {
  roleName: string;
  priorRaw: string;
  baseAgentPrompt: string;
}): string {
  const base = params.baseAgentPrompt.trim();
  return [
    buildSmartCoordinatorClosureConflictRetryHeader(params),
    base,
    SMART_MENTION_RETRY_TAIL,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Smart 重试 Prompt 末尾固定指令。 */
export const SMART_MENTION_RETRY_TAIL =
  '不要解释，按照要求重新生成符合格式要求的输出';

/** 缺少 @ 点名时的结构化校验 issue（重试首行使用定制原因文案）。 */
export const SMART_MISSING_MENTION_RETRY_ISSUES = new Set([
  'smart_coordinator_missing_mention',
  'coordinator_missing_dispatch',
  'missing_mention_targets',
  'smart_member_missing_coordinator',
]);

export function isSmartMissingMentionRetryIssue(issues: string[] | undefined): boolean {
  return Boolean(issues?.some((issue) => SMART_MISSING_MENTION_RETRY_ISSUES.has(issue)));
}

export function resolveSmartMissingMentionRetryReasonDetail(isCoordinator: boolean): string {
  return isCoordinator
    ? '有新指派时，dispatch 必须包含本阶段执行者；无新指派、咨询、阻塞或结项时 dispatch 写 []'
    : 'dispatch 必须 @协调者汇报';
}

/** Smart 重试首行：原因 + 上一轮输出摘录。 */
export function buildSmartMentionFormatRetryHeader(params: {
  roleName: string;
  reasonDetail: string;
  priorRaw: string;
}): string {
  const role = params.roleName.trim() || '角色';
  const reason = params.reasonDetail.trim() || '输出不符合格式要求';
  const prior =
    sanitizePriorRawForRetryDisplay(params.priorRaw).trim() || '（无上轮有效正文）';
  return `【${role}-格式错误】，原因：${reason}，--上一轮输出：${prior}--`;
}

/** Smart 重试完整 Prompt：首行纠正 + 首轮正文 + 末尾指令。 */
export function buildSmartMentionFormatRetryPrompt(params: {
  roleName: string;
  reasonDetail: string;
  priorRaw: string;
  baseAgentPrompt: string;
}): string {
  const base = params.baseAgentPrompt.trim();
  return [
    buildSmartMentionFormatRetryHeader(params),
    base,
    SMART_MENTION_RETRY_TAIL,
  ]
    .filter(Boolean)
    .join('\n\n');
}
