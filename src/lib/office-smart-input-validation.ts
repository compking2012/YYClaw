import { collectValidationPathsFromSections } from '@/lib/office-deliverable-ls-verify';
import { declaredDeliverablePathsFromSmartMemberJson } from '@/lib/office-deliverable-disk-resolve';
import { normalizeTeamMember, type LegacyTeamMember } from '@/lib/office-agent-id-resolve';
import {
  agentMatchesMentionToken,
  isGenericCoordinatorMentionToken,
  parseMentions,
  resolveMentionTargets,
} from '@/lib/office-mention-parse';
import { parseSmartMemberJsonOutput } from '@/lib/office-smart-json-schema';
import { resolveSmartStructuredRawFromRoomMessage } from '@/lib/office-smart-room-fields';
import {
  findSmartWorkOrderStepIndexForRole,
  type SmartWorkOrderStep,
} from '@/lib/office-smart-work-order';
import type { RoomMessage } from '@/types/office';

const INPUT_SECTION_FAILURE_RE =
  /不存在|未找到|缺失|无法\s*stat|No such file|not found|输入(?:校验)?.*不(?:合格|通过)|路径无效|无法读取|尚无.*文件/iu;

export const INPUT_FAILURE_REPORT_RE =
  /输入(?:校验)?.*(?:不(?:合格|通过)|失败)|上游.{0,24}(?:不存在|未就绪|缺失)|路径不存在|无法\s*stat|磁盘.*不存在|ls:\s*cannot\s*access/iu;

/** 【输入校验】段落是否表明上游输入不合格。 */
export function smartInputSectionIndicatesFailure(inputCheck: string): boolean {
  const t = inputCheck.trim();
  if (!t) return false;
  if (/^(?:无|暂无|不涉及)/iu.test(t)) return false;
  const paths = collectValidationPathsFromSections(t);
  if (paths.length === 0) return INPUT_FAILURE_REPORT_RE.test(t);
  return INPUT_SECTION_FAILURE_RE.test(t);
}

/** 引擎 ls 结果是否表明【输入校验】中的路径在磁盘不存在。 */
export function smartInputPathsMissingOnDisk(
  inputPaths: string[],
  lsLines: string[],
): boolean {
  if (inputPaths.length === 0) return false;
  return inputPaths.some((p) => {
    const norm = p.trim();
    const base = norm.split('/').pop() ?? norm;
    return lsLines.some(
      (line) =>
        /cannot access|No such file|not found/iu.test(line)
        && (line.includes(norm) || (base.length > 3 && line.includes(base))),
    );
  });
}

export function inferSmartMemberInputValidationFailed(params: {
  inputCheck: string;
  inputPathsMissingOnDisk?: boolean;
}): boolean {
  if (params.inputPathsMissingOnDisk) return true;
  return smartInputSectionIndicatesFailure(params.inputCheck);
}

/** 成员向协调者汇报：输入不合格（仅 JSON taskUnderstanding / action=help，勿读群聊正文）。 */
export function isSmartMemberInputValidationFailureReport(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const member = parseSmartMemberJsonOutput(t);
  if (member?.action === 'help') {
    const blob = member.taskUnderstanding.trim();
    return blob.length >= 12 && INPUT_FAILURE_REPORT_RE.test(blob);
  }
  return false;
}

/** dispatch 是否 @ 了除协调者外的团队成员（不看 roomReply）。 */
export function smartMemberRoomReplyMentionsPeer(
  publishText: string,
  coordinator: LegacyTeamMember,
  teamRoles: LegacyTeamMember[],
): boolean {
  const coord = normalizeTeamMember(coordinator);
  const coordAgentId = coord.agentId.toLowerCase();
  const tokens = parseMentions(publishText);
  for (const token of tokens) {
    if (isGenericCoordinatorMentionToken(token)) continue;
    if (agentMatchesMentionToken(coord, token)) continue;
    const hits = resolveMentionTargets([token], teamRoles);
    if (hits.some((r) => r.agentId.toLowerCase() !== coordAgentId)) return true;
  }
  return false;
}

/** 输入已不合格时，成员仅用 @协调者 敷衍（未说明输入不合格、或谎称已完成）。 */
export function isSmartMemberInputInvalidLazyReply(
  publishText: string,
  options: { inputValidationFailed: boolean; deliverablePathText?: string; memberEnd?: boolean },
): boolean {
  if (!options.inputValidationFailed) return false;
  if (isSmartMemberInputValidationFailureReport(publishText)) return false;
  if (options.memberEnd === true) return true;
  const member = parseSmartMemberJsonOutput(publishText.trim());
  if (member?.action === 'end') return true;
  return false;
}

/** 群聊消息发送者是否匹配角色 id（兼容 fromRoleId / fromAgentId）。 */
function roomMessageMatchesRoleId(
  message: Pick<RoomMessage, 'fromRoleId' | 'fromAgentId' | 'from'>,
  roleId: string,
): boolean {
  const id = roleId.trim();
  if (!id) return false;
  const legacy = (message as { fromRoleId?: string }).fromRoleId?.trim();
  if (legacy && legacy === id) return true;
  const agentId = message.fromAgentId?.trim() || message.from?.trim();
  return agentId === id;
}

function roomMessageReportsSubtaskDone(
  message: Pick<RoomMessage, 'content' | 'progressText' | 'smartMemberEnd' | 'smartJsonRaw'>,
): boolean {
  if (message.smartMemberEnd === true) return true;
  const raw = resolveSmartStructuredRawFromRoomMessage(message);
  return parseSmartMemberJsonOutput(raw)?.action === 'end';
}

function deliverablePathsFromCompletedRoomMessage(
  message: Pick<RoomMessage, 'content' | 'progressText' | 'smartJsonRaw'>,
): string[] {
  const raw = resolveSmartStructuredRawFromRoomMessage(message);
  return declaredDeliverablePathsFromSmartMemberJson(raw);
}

/** 各工作顺序步骤在群聊【…已完成】汇报中的交付路径（结项验盘用）。 */
export function collectSmartCompletedStepDeliverablePaths(params: {
  roomMessages: RoomMessage[];
  taskId: string;
  steps: SmartWorkOrderStep[];
}): string[] {
  const hints = new Set<string>();
  for (const step of params.steps) {
    for (const owner of step.roleIds) {
      const roleId = owner?.trim();
      if (!roleId) continue;
      for (const m of params.roomMessages) {
        if (m.taskId && m.taskId !== params.taskId) continue;
        if (!roomMessageMatchesRoleId(m, roleId)) continue;
        if (!roomMessageReportsSubtaskDone(m)) continue;
        for (const p of deliverablePathsFromCompletedRoomMessage(m)) {
          hints.add(p);
        }
      }
    }
  }
  return [...hints];
}

/** 从指定角色【…已完成】汇报中收集交付路径（仅该角色，供「上一跳」校验）。 */
export function collectSmartRoleDoneDeliverablePathHints(params: {
  roomMessages: RoomMessage[];
  taskId: string;
  roleId: string;
}): string[] {
  const hints = new Set<string>();
  for (const m of params.roomMessages) {
    if (m.taskId && m.taskId !== params.taskId) continue;
    if (!roomMessageMatchesRoleId(m, params.roleId)) continue;
    if (!roomMessageReportsSubtaskDone(m)) continue;
    for (const p of deliverablePathsFromCompletedRoomMessage(m)) {
      hints.add(p);
    }
  }
  return [...hints];
}

/** 从已完成子任务汇报的群聊中收集上游交付路径（供协调者验收 @）。 */
export function collectSmartUpstreamDeliverablePathHints(params: {
  roomMessages: RoomMessage[];
  taskId: string;
  steps: SmartWorkOrderStep[];
  beforeRoleId: string;
}): string[] {
  const allowedRoles = new Set<string>();
  const stepIdx = findSmartWorkOrderStepIndexForRole(params.steps, params.beforeRoleId);
  if (stepIdx <= 0) return [];
  for (let i = 0; i < stepIdx; i++) {
    for (const id of params.steps[i]!.roleIds) {
      const roleId = id?.trim();
      if (roleId) allowedRoles.add(roleId);
    }
  }
  const hints = new Set<string>();
  for (const m of params.roomMessages) {
    if (m.taskId && m.taskId !== params.taskId) continue;
    const senderId = m.fromAgentId?.trim() || m.from?.trim() || (m as { fromRoleId?: string }).fromRoleId?.trim();
    if (!senderId || !allowedRoles.has(senderId)) continue;
    if (!roomMessageReportsSubtaskDone(m)) continue;
    for (const p of deliverablePathsFromCompletedRoomMessage(m)) {
      hints.add(p);
    }
  }
  return [...hints];
}
