import {
  isAllMentionToken,
  mentionsIncludeAll,
  parseMentions,
  resolveMentionTargets,
  roleMatchesMentionToken,
} from '@/lib/office-mention-parse';
import {
  agentIdsMatch,
  asTeamMemberArray,
  resolveTeamAgentId,
  resolveTeamAgentIds,
  roomMessageFromAgentMatches,
  roomMessageProjectId,
  type LegacyTeamMember,
} from '@/lib/office-agent-id-resolve';
import { resolveSmartCoordinatorDispatchTargets } from '@/lib/office-smart-dispatch-targets';
import {
  parseSmartCoordinatorEndFlag,
} from '@/lib/office-smart-project-end';
import type { SmartDispatch } from '@/lib/office-smart-json-schema';
import { extractOfficeBracketSections } from '@/lib/office-workflow-output-sections';
import { isSmartJsonShapeText, parseSmartCoordinatorJsonOutput } from '@/lib/office-smart-json-schema';
import { tryParseWorkflowJsonObject } from '@/lib/office-workflow-json-parse';
import { roleMentionToken } from '@/lib/office-mention';
import {
  resolveSmartNextExecutorRoleIds,
  roleReportedSubtaskDoneInRoom,
  smartReadyForProjectClosure,
  type SmartWorkOrderStep,
} from '@/lib/office-smart-work-order';
import type { ProjectAgentRef } from '@/lib/office-workflow-node';
import type { RoomMessage } from '@/types/office';

const MENTION_TOKEN_IN_TEXT_RE = /[@＠]([\w\u4e00-\u9fa5][\w\u4e00-\u9fa5.-]*)/gu;

export type SmartCoordinatorDispatchCheck =
  | 'ok'
  | 'missing_mention'
  | 'mentions_unknown_team_role'
  | 'mentions_non_next_executor'
  | 'end_has_dispatch'
  | 'dispatch_names_reporter'
  | 'dispatch_duplicate_role'
  | 'action_end_mismatch'
  | 'premature_project_end'
  | 'broadcast_before_project_complete';

/** @deprecated use end_has_dispatch */
export type SmartCoordinatorDispatchCheckLegacy = SmartCoordinatorDispatchCheck | 'review_has_dispatch' | 'acceptance_review_has_mention';

export type SmartCoordinatorAction = 'assign' | 'end';

export type SmartCoordinatorProjectEndCheck =
  | 'ok'
  | 'missing_project_end'
  | 'project_end_has_mention'
  | 'premature_project_end';

/**
 * Standalone Smart 兜底：协调者历次 action=assign 的 dispatch 目标并集（不含从未派活成员）。
 */
export function collectSmartEverDelegatedAgentIds(params: {
  roomMessages: RoomMessage[];
  projectId: string;
  coordinatorAgentId: string;
  teamRoles: Pick<ProjectAgentRef, 'agentId' | 'displayName'>[];
}): string[] {
  const scopeId = params.projectId.trim();
  const coordinatorId = params.coordinatorAgentId.trim();
  if (!scopeId || !coordinatorId || params.teamRoles.length === 0) return [];
  const team = asTeamMemberArray(params.teamRoles);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const message of params.roomMessages) {
    const msgProjectId = roomMessageProjectId(message);
    if (msgProjectId && msgProjectId !== scopeId) continue;
    if (!roomMessageFromAgentMatches(message, coordinatorId, team)) continue;
    const raw = (message.smartJsonRaw ?? '').trim();
    if (!raw) continue;
    const action = parseSmartCoordinatorAction(raw) ?? parseSmartCoordinatorJsonOutput(raw)?.action;
    if (action !== 'assign') continue;
    const targets = resolveSmartCoordinatorDispatchTargets(raw, params.teamRoles, coordinatorId);
    for (const target of targets) {
      const id = target.agentId?.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * smartWorkSteps 未物化时：至少一次 assign，且曾派活成员均 smartMemberEnd。
 * 从未被 dispatch 的 roster 成员不要求完成。
 */
export function isSmartStandaloneDelegatedClosureReady(params: {
  roomMessages: RoomMessage[];
  projectId: string;
  coordinatorAgentId: string;
  teamRoles: Pick<ProjectAgentRef, 'agentId' | 'displayName'>[];
}): boolean {
  const delegated = collectSmartEverDelegatedAgentIds(params);
  if (delegated.length === 0) return false;
  const team = asTeamMemberArray(params.teamRoles);
  return delegated.every((roleId) =>
    roleReportedSubtaskDoneInRoom(params.roomMessages, params.projectId, roleId, team),
  );
}

/**
 * 引擎判定：成员步骤均已 smartMemberEnd，且下一跳仅剩协调者或已全部完成。
 * steps 为空时走 standalone「曾派活成员并集」兜底。
 */
export function isSmartProjectEngineComplete(params: {
  steps: SmartWorkOrderStep[];
  roomMessages: RoomMessage[];
  taskId?: string;
  projectId?: string;
  coordinatorAgentId?: string;
  coordinatorRoleId?: string;
  teamRoles?: Pick<ProjectAgentRef, 'agentId' | 'displayName'>[];
}): boolean {
  const scopeId = (params.projectId ?? params.taskId ?? '').trim();
  const coordinatorId = (params.coordinatorAgentId ?? params.coordinatorRoleId)?.trim();
  if (params.steps.length === 0) {
    if (!scopeId || !coordinatorId || !params.teamRoles?.length) return false;
    return isSmartStandaloneDelegatedClosureReady({
      roomMessages: params.roomMessages,
      projectId: scopeId,
      coordinatorAgentId: coordinatorId,
      teamRoles: params.teamRoles,
    });
  }
  if (coordinatorId) {
    return smartReadyForProjectClosure(
      params.steps,
      params.roomMessages,
      scopeId,
      coordinatorId,
    );
  }
  return (
    resolveSmartNextExecutorRoleIds({
      steps: params.steps,
      roomMessages: params.roomMessages,
      projectId: scopeId,
      taskId: scopeId,
    }).length === 0
  );
}

/** 协调者本轮是否在派活（非结项）：仅以 dispatch 为准（roomReply 内 @ 不参与判定）。 */
export function smartCoordinatorReplyIsDispatching(params: {
  roomBody: string;
  dispatch: string;
}): boolean {
  const dispatch = params.dispatch.trim();
  if (dispatch && dispatch !== '无') return true;
  return /[@＠]/u.test(dispatch);
}

function isNoDispatchText(text: string): boolean {
  const t = text.trim();
  return !t || /^无$/iu.test(t);
}

/** Smart 协调者：是否须校验 dispatch @（assign 必点名；end 不校验）。 */
export function smartCoordinatorShouldValidateAssignMentions(params: {
  publishText: string;
  dispatchText: string;
  raw?: string;
  projectComplete?: boolean;
}): boolean {
  if (params.projectComplete) return false;

  const raw = params.raw?.trim() ?? `${params.dispatchText.trim()}\n${params.publishText.trim()}`.trim();
  if (parseSmartCoordinatorEndFlag(raw)) return false;

  const action = parseSmartCoordinatorAction(raw);
  if (action === 'end') return false;

  return action === 'assign' || action === null;
}

export function parseSmartCoordinatorAction(raw: string): SmartCoordinatorAction | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (isSmartJsonShapeText(trimmed)) {
    const obj = tryParseWorkflowJsonObject(trimmed);
    const action = typeof obj?.action === 'string' ? obj.action.trim() : '';
    if (action === 'assign' || action === 'end') return action;
    return null;
  }
  const sections = extractOfficeBracketSections(trimmed);
  const action = sections['动作']?.trim();
  if (action === 'assign' || action === 'end') return action;
  return null;
}

/** Smart 协调者 kickoff 首轮（任务拆解）：action 必须为 assign。 */
export function smartCoordinatorKickoffActionMustBeAssign(
  action: SmartCoordinatorAction | null,
): boolean {
  return action === 'assign';
}

function roleRefForMatch(role: Pick<ProjectAgentRef, 'agentId' | 'displayName'>): Pick<ProjectAgentRef, 'agentId' | 'displayName'> {
  return { agentId: role.agentId, displayName: role.displayName };
}

/** 成员汇报完成后：dispatch 不得点名汇报者本人。 */
export function smartCoordinatorDispatchNamesReporter(params: {
  dispatch: SmartDispatch;
  dispatchText: string;
  reporterRoleId: string;
  coordinatorRoleId: string;
  teamRoles: Pick<ProjectAgentRef, 'agentId' | 'displayName'>[];
}): boolean {
  const reporter = params.teamRoles.find((r) => r.agentId === params.reporterRoleId);
  if (!reporter) return false;
  const reporterRef = roleRefForMatch(reporter) as ProjectAgentRef;
  for (const item of params.dispatch) {
    const roleName = item.role.trim();
    if (!roleName || /^无$/iu.test(roleName)) continue;
    if (roleMatchesMentionToken(reporterRef, roleName)) return true;
    if (roleName === reporter.displayName.trim()) return true;
  }
  const tokens = parseMentions(params.dispatchText).filter((t) => !isAllMentionToken(t));
  for (const token of tokens) {
    if (roleMatchesMentionToken(reporterRef, token)) return true;
  }
  return false;
}

/** dispatch 数组中同一成员（按 role 显示名解析）不得出现超过 1 项。 */
export function smartCoordinatorDispatchHasDuplicateRoles(params: {
  dispatch: SmartDispatch;
  coordinatorRoleId: string;
  teamRoles: Pick<ProjectAgentRef, 'agentId' | 'displayName'>[];
}): boolean {
  const team = params.teamRoles as LegacyTeamMember[];
  const coordId = resolveTeamAgentId(team, params.coordinatorRoleId);
  const seen = new Set<string>();
  for (const item of params.dispatch) {
    const roleName = item.role.trim();
    if (!roleName || /^无$/iu.test(roleName)) continue;
    const resolved = resolveMentionTargets([roleName], team, { coordinatorAgentId: coordId });
    const agentId = resolved[0]?.agentId?.trim();
    const key = agentId || roleName.toLowerCase();
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

export function collectSmartCoordinatorMentionedRoleIds(params: {
  text: string;
  coordinatorRoleId: string;
  teamRoles: Pick<ProjectAgentRef, 'agentId' | 'displayName'>[];
}): string[] {
  const tokens = parseMentions(params.text.trim()).filter((t) => !isAllMentionToken(t));
  const roles = resolveMentionTargets(tokens, params.teamRoles as ProjectAgentRef[], {
    coordinatorRoleId: params.coordinatorRoleId,
  });
  return [...new Set(roles.map((r) => r.agentId))];
}

/**
 * 项目未结束前：校验 dispatch 须 @ 本阶段执行者（可并行多人）或打回/上游补交付例外。
 */
export function validateSmartCoordinatorRoomMentions(params: {
  publishText: string;
  dispatchText: string;
  coordinatorAgentId?: string;
  coordinatorRoleId?: string;
  nextExecutorRoleIds?: string[];
  /** @deprecated 使用 nextExecutorRoleIds */
  nextExecutorRoleId?: string | null;
  teamRoles: Pick<ProjectAgentRef, 'agentId' | 'displayName'>[];
  projectComplete?: boolean;
  /** kickoff 工作单未物化：跳过 missing_mention，仍校验 end/@all/unknown。 */
  kickoffMentionRelaxed?: boolean;
  allowReporterFixRoleId?: string | null;
  allowUpstreamProducerRoleId?: string | null;
  raw?: string;
  reporterRoleId?: string | null;
}): SmartCoordinatorDispatchCheck {
  if (params.projectComplete && !params.kickoffMentionRelaxed) return 'ok';

  const team = params.teamRoles as LegacyTeamMember[];
  const coordinatorId = resolveTeamAgentId(
    team,
    params.coordinatorAgentId ?? params.coordinatorRoleId,
  );
  const stageIds = [
    ...(params.nextExecutorRoleIds ?? []),
    ...(params.nextExecutorRoleId ? [params.nextExecutorRoleId] : []),
  ].filter(Boolean);
  const uniqueStageIds = resolveTeamAgentIds(team, stageIds);

  const publish = params.publishText.trim();
  const dispatch = params.dispatchText.trim();
  const raw = params.raw?.trim() ?? `${dispatch}\n${publish}`.trim();
  /** Smart 派活 @ 仅以 dispatch 为准；roomReply 内 @ 不参与 mention 校验。 */
  const mentionScope = dispatch;

  const action = parseSmartCoordinatorAction(raw);
  if (action === 'end') {
    if (!isNoDispatchText(dispatch)) return 'end_has_dispatch';
    return 'premature_project_end';
  }

  if (parseSmartCoordinatorEndFlag(raw)) {
    return 'premature_project_end';
  }

  if (!smartCoordinatorShouldValidateAssignMentions({
    publishText: publish,
    dispatchText: dispatch,
    raw,
    projectComplete: params.projectComplete,
  })) {
    return 'ok';
  }

  const jsonDispatch = parseSmartCoordinatorJsonOutput(raw)?.dispatch ?? [];
  if (
    jsonDispatch.length > 0
    && smartCoordinatorDispatchHasDuplicateRoles({
      dispatch: jsonDispatch,
      coordinatorRoleId: coordinatorId,
      teamRoles: params.teamRoles,
    })
  ) {
    return 'dispatch_duplicate_role';
  }
  if (
    params.reporterRoleId
    && smartCoordinatorDispatchNamesReporter({
      dispatch: jsonDispatch,
      dispatchText: dispatch,
      reporterRoleId: params.reporterRoleId,
      coordinatorRoleId: coordinatorId,
      teamRoles: params.teamRoles,
    })
  ) {
    const fixId = params.allowReporterFixRoleId?.trim();
    const reporterAllowed =
      fixId
      && agentIdsMatch(team, params.reporterRoleId, fixId);
    if (!reporterAllowed) {
      return 'dispatch_names_reporter';
    }
  }

  const mentionTokens = parseMentions(mentionScope).filter((t) => !isAllMentionToken(t));
  for (const token of mentionTokens) {
    const hit = resolveMentionTargets([token], team, {
      coordinatorAgentId: coordinatorId,
    });
    if (hit.length === 0) return 'mentions_unknown_team_role';
  }

  if (mentionsIncludeAll(parseMentions(mentionScope))) {
    return 'broadcast_before_project_complete';
  }

  if (params.kickoffMentionRelaxed) {
    return 'ok';
  }

  const allowedRoleIds = resolveTeamAgentIds(team, smartCoordinatorAllowedDispatchRoleIds({
    nextExecutorRoleIds: uniqueStageIds,
    allowReporterFixRoleId: params.allowReporterFixRoleId,
    allowUpstreamProducerRoleId: params.allowUpstreamProducerRoleId,
  }));
  if (allowedRoleIds.length === 0) {
    return /[@＠]/u.test(mentionScope) ? 'ok' : 'missing_mention';
  }

  if (mentionTokens.length === 0) return 'missing_mention';

  const mentionRoles = resolveMentionTargets(mentionTokens, team, {
    coordinatorAgentId: coordinatorId,
  });
  const exceptionIds = new Set(
    resolveTeamAgentIds(team, [
      params.allowReporterFixRoleId,
      params.allowUpstreamProducerRoleId,
    ]),
  );
  const hitsAllowed = mentionRoles.some((r) =>
    allowedRoleIds.some((id) => agentIdsMatch(team, r.agentId, id)),
  );
  if (!hitsAllowed) return 'mentions_non_next_executor';
  if (uniqueStageIds.length > 1) {
    for (const r of mentionRoles) {
      if (agentIdsMatch(team, r.agentId, coordinatorId)) continue;
      const inStage = uniqueStageIds.some((id) => agentIdsMatch(team, r.agentId, id));
      const inException = [...exceptionIds].some((id) => agentIdsMatch(team, r.agentId, id));
      if (inStage || inException) continue;
      return 'mentions_non_next_executor';
    }
  }
  return 'ok';
}

/** 协调者声明结项：JSON `action==="end"` 为唯一标识；引擎判定全部步骤已完成。 */
export function validateSmartCoordinatorProjectEnd(params: {
  raw: string;
  minChars?: number;
  allStepsComplete: boolean;
}): SmartCoordinatorProjectEndCheck {
  const raw = params.raw.trim();
  const declaresEnd = parseSmartCoordinatorEndFlag(raw);

  if (!params.allStepsComplete) {
    if (declaresEnd) return 'premature_project_end';
    return 'ok';
  }

  if (!declaresEnd) {
    return 'missing_project_end';
  }

  return 'ok';
}

export function smartNextExecutorMentionToken(
  role: Pick<ProjectAgentRef, 'agentId' | 'displayName'>,
): string {
  return `@${roleMentionToken(role)}`;
}

export function smartCoordinatorAllowedDispatchRoleIds(params: {
  nextExecutorRoleIds?: string[];
  /** @deprecated 使用 nextExecutorRoleIds */
  nextExecutorRoleId?: string | null;
  allowReporterFixRoleId?: string | null;
  allowUpstreamProducerRoleId?: string | null;
  mentionedRoleIds?: string[];
}): string[] {
  const ids = [
    ...(params.nextExecutorRoleIds ?? []),
    ...(params.nextExecutorRoleId ? [params.nextExecutorRoleId] : []),
    params.allowReporterFixRoleId,
    params.allowUpstreamProducerRoleId,
    ...(params.mentionedRoleIds ?? []),
  ]
    .map((id) => id?.trim())
    .filter(Boolean) as string[];
  return [...new Set(ids)];
}

export function clampSmartCoordinatorDispatchText(
  text: string,
  params: {
    coordinatorRoleId: string;
    allowedRoleIds: string[];
    teamRoles: Pick<ProjectAgentRef, 'agentId' | 'displayName'>[];
    projectComplete?: boolean;
  },
): string {
  const raw = text.trim();
  if (!raw || params.projectComplete) return raw;
  const allowed = new Set(params.allowedRoleIds.filter(Boolean));
  if (allowed.size === 0) return raw;

  const spans: Array<{ start: number; end: number; replacement: string }> = [];
  const re = new RegExp(MENTION_TOKEN_IN_TEXT_RE.source, 'gu');
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const full = m[0]!;
    const token = m[1]!;
    if (isAllMentionToken(token)) continue;
    const resolved = resolveMentionTargets([token], params.teamRoles as ProjectAgentRef[], {
      coordinatorRoleId: params.coordinatorRoleId,
    }).filter((r) => r.agentId !== params.coordinatorRoleId);
    if (resolved.length === 0) {
      spans.push({ start: m.index!, end: m.index! + full.length, replacement: token });
      continue;
    }
    const disallowed = resolved.some((r) => !allowed.has(r.agentId));
    if (!disallowed) continue;
    spans.push({ start: m.index!, end: m.index! + full.length, replacement: token });
  }

  if (spans.length === 0) return raw;
  spans.sort((a, b) => b.start - a.start);
  let out = raw;
  for (const s of spans) {
    out = `${out.slice(0, s.start)}${s.replacement}${out.slice(s.end)}`;
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}

function escapeRegExpLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const COORDINATOR_PEER_COMPLETE_NEGATION_RE =
  /(?:尚未|未收到|还未|还没|缺少|等待|待[^。；\n]{0,8}汇报|请[^。；\n]{0,8}(?:汇报|完成|提交))/u;

/**
 * 协调者 roomReply 是否将某成员子任务表述为已完成/验收通过（不含催办、否定语境）。
 */
export function coordinatorRoomReplyClaimsRoleSubtaskComplete(
  text: string,
  roleName: string | undefined,
): boolean {
  const name = (roleName ?? '').trim();
  if (!name || name.length < 2) return false;
  const body = text.trim();
  if (!body) return false;
  const escaped = escapeRegExpLiteral(name);

  const markerPatterns = [
    new RegExp(`\\*\\*[^*\\n]*${escaped}[^*\\n]*已完成\\*\\*`, 'giu'),
    new RegExp(`【[^】\\n]*${escaped}[^】\\n]*已完成】`, 'giu'),
  ];
  for (const re of markerPatterns) {
    re.lastIndex = 0;
    let markerMatch: RegExpExecArray | null;
    while ((markerMatch = re.exec(body)) !== null) {
      const start = Math.max(0, markerMatch.index - 32);
      const window = body.slice(start, markerMatch.index + markerMatch[0].length);
      if (COORDINATOR_PEER_COMPLETE_NEGATION_RE.test(window)) continue;
      if (/请[^。；\n]{0,16}(?:汇报|发送|回复|写明)/u.test(window)) continue;
      return true;
    }
  }

  const completionPatterns = [
    new RegExp(`${escaped}[^\\n。；]{0,24}(?:已完成|验收通过|交付合格|子任务完成)`, 'iu'),
    new RegExp(`${escaped}[^\\n。；]{0,12}(?:和|与|、)[^\\n。；]{0,32}(?:均|都)已完成`, 'iu'),
    new RegExp(`(?:均|都)已完成[^\\n。；]{0,32}(?:和|与|、)[^\\n。；]{0,12}${escaped}`, 'iu'),
    new RegExp(`(?:${escaped}[^\\n。；]{0,8})+(?:均|都)已完成`, 'iu'),
  ];

  for (const re of completionPatterns) {
    const match = re.exec(body);
    if (!match) continue;
    const start = Math.max(0, match.index - 24);
    const window = body.slice(start, match.index + match[0].length);
    if (COORDINATOR_PEER_COMPLETE_NEGATION_RE.test(window)) continue;
    return true;
  }
  return false;
}

/**
 * 协调者「提前验收同伴」扫描正文：仅 JSON taskUnderstanding（不含 dispatch.task / roomReply）。
 */
export function resolveCoordinatorPeerAcceptanceScanText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || !isSmartJsonShapeText(trimmed)) return '';
  const json = parseSmartCoordinatorJsonOutput(trimmed);
  return json?.taskUnderstanding?.trim() ?? '';
}

/** 协调者验收结论中宣称已完成、但尚未 smartMemberEnd 汇报的成员角色 id。 */
export function findSmartCoordinatorPrematurePeerAcceptanceRoleIds(params: {
  /** taskUnderstanding / 遗留 roomReply；勿传入含 dispatch 的合成群聊正文 */
  roomReplyText: string;
  coordinatorAgentId?: string;
  /** @deprecated use coordinatorAgentId */
  coordinatorRoleId?: string;
  teamRoles: Pick<ProjectAgentRef, 'agentId' | 'displayName'>[];
  roomMessages: RoomMessage[];
  projectId?: string;
  /** @deprecated use projectId */
  taskId?: string;
}): string[] {
  const publish = params.roomReplyText.trim();
  if (!publish) return [];
  const team = asTeamMemberArray(params.teamRoles as LegacyTeamMember[]);
  const coordId = resolveTeamAgentId(team, params.coordinatorAgentId ?? params.coordinatorRoleId ?? '');
  const projectId = (params.projectId ?? params.taskId ?? '').trim();
  const premature: string[] = [];
  for (const role of team) {
    if (!role.agentId || agentIdsMatch(team, role.agentId, coordId)) continue;
    if (roleReportedSubtaskDoneInRoom(params.roomMessages, projectId, role.agentId, team)) continue;
    if (coordinatorRoomReplyClaimsRoleSubtaskComplete(
      publish,
      (role.displayName ?? (role as { name?: string }).name ?? '').trim(),
    )) {
      premature.push(role.agentId);
    }
  }
  return premature;
}
