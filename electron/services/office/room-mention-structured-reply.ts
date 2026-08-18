import {
  extractPublicRoomMirrorText,
  finalizeCoordinatorDispatchReply,
  isIntermediateOnlyRoomMirrorText,
} from '../../../src/lib/office-room-mirror-public';
import {
  isFastAckOnlyReply,
  isEnglishInternalReasoning,
  isLikelyModelRuntimeError,
  isNonSubstantiveMentionSessionReply,
  isUnmirroredRoomSnippet,
} from './room-mention-reply-policy';
import { isWorkflowPromissoryDeliverable } from '../../../src/lib/office-workflow-promissory';
import type { OfficeTaskExecutionMode } from './types';
import {
  extractOfficeBracketSections,
  type SmartWorkflowMirrorValidationIssue,
} from '../../../src/lib/office-workflow-output-sections';
import { buildSmartCoordinatorJsonSchemaLines } from '../../../src/lib/office-smart-task-prompt-shared';
import {
  isSmartSubtaskDoneBracketTitle,
  resolveSmartMemberReadiness,
  smartMemberReplyMentionsCoordinator,
  type SmartCoordinatorRef,
  type SmartMemberExecutionReadiness,
  validateSmartMemberRoomReply,
} from '../../../src/lib/office-smart-member-reply';
import { isRoomFastAckText } from './room-fast-ack';
import { coordinatorDecidedNoReply } from './room-unmentioned-coordinator';
import {
  formatStructuredValidationFailureDetail,
  sanitizePriorRawForRetryDisplay,
} from '../../../src/lib/office-mention-validation-detail';
import { buildSmartCoordinatorRetryPreamble } from './room-prompts/smart/coordinator-retry-prompt';
import {
  buildSmartMentionFormatRetryPrompt,
  isSmartMissingMentionRetryIssue,
  resolveSmartMissingMentionRetryReasonDetail,
  SMART_MENTION_RETRY_TAIL,
} from '../../../src/lib/office-smart-retry-prompt';
import { buildSmartMemberRetryPreamble } from './room-prompts/smart/member-retry-prompt';
import {
  isSmartJsonShapeText,
  parseSmartMemberJsonOutput,
  SMART_MIN_ROOM_REPLY_CHARS,
} from '../../../src/lib/office-smart-json-schema';
import {
  buildSmartCoordinatorRoomPublishText,
  extractSmartRoomReplyAndDispatch,
} from '../../../src/lib/office-smart-room-fields';
import { validateSmartRoomMentionSync } from './room-mention-smart-validation';
import {
  coerceStructuredMentionRaw,
  normalizeSmartMentionRaw,
} from './room-mention-smart-normalize';

export { coerceStructuredMentionRaw, normalizeSmartMentionRaw } from './room-mention-smart-normalize';

const SECTION_RE = /【\s*([^】]+)\s*】/g;

/** Prompt 泄漏进模型输出，解析时忽略（非有效段落）。 */
const PROMPT_ECHO_SECTION_RE =
  /^(?:成员[·•\s]*可执行|可执行|硬性要求|汇报协调者|依赖未就绪)/u;

const UNDERSTANDING_KEYS = ['理解', '任务理解', '判定'];
const ROOM_REPLY_KEYS = ['群聊回复', '回复', '交付'];
const DISPATCH_KEYS = ['分工', '指派', '交接'];

export type ParsedRoomMentionReply = {
  understanding: string;
  judgment: string;
  roomReply: string;
  dispatch: string;
  raw: string;
};

export type RoomMentionValidationIssue =
  | 'empty'
  | 'transport_timeout'
  | 'transport_error'
  | 'model_error'
  | 'missing_room_reply_section'
  | 'room_reply_too_short'
  | 'fast_ack_only'
  | 'intermediate_only'
  | 'coordinator_missing_dispatch'
  | 'missing_mention_targets'
  | 'smart_member_missing_coordinator'
  | 'smart_member_mentions_peer'
  | 'smart_member_input_invalid_lazy'
  | 'smart_member_promise_only'
  | 'smart_member_missing_dependency_report'
  | 'smart_member_missing_deliverable'
  | 'smart_member_missing_acceptance_ack'
  | 'smart_member_in_progress_only'
  | 'smart_member_missing_action_end'
  | 'smart_member_missing_file_deliverable'
  | 'smart_member_deliverable_inline_too_long'
  | 'smart_coordinator_missing_mention'
  | 'smart_coordinator_unknown_team_role'
  | 'smart_coordinator_wrong_dispatch_target'
  | 'smart_coordinator_acceptance_has_mention'
  | 'smart_coordinator_review_has_dispatch'
  | 'smart_coordinator_dispatch_names_reporter'
  | 'smart_coordinator_dispatch_duplicate_role'
  | 'smart_coordinator_premature_peer_acceptance'
  | 'smart_coordinator_kickoff_action_not_assign'
  | 'smart_coordinator_action_end_mismatch'
  | 'smart_coordinator_missing_project_end'
  | 'smart_coordinator_project_end_has_mention'
  | 'smart_coordinator_project_end_not_at_end'
  | 'smart_coordinator_legacy_closure_section'
  | 'smart_coordinator_invalid_closure_mark'
  | 'smart_coordinator_premature_project_end'
  | 'smart_deliverable_paths_missing_on_disk'
  | 'invalid_json_syntax'
  | 'invalid_json_missing_fields'
  | 'invalid_json_value'
  | 'invalid_json_schema'
  | 'smart_deliverable_output_validation_ls_invalid'
  | 'workflow_member_promise_only'
  | 'english_internal_reasoning'
  | SmartWorkflowMirrorValidationIssue;

export type RoomMentionValidationResult =
  | { ok: true; parsed: ParsedRoomMentionReply; roomText: string }
  | { ok: false; issues: RoomMentionValidationIssue[]; detail: string; raw: string };

/** Smart：校验失败但 session/history 仍可能补齐（可再等 10s 重拉一次）。 */
const SMART_HISTORY_NOT_READY_ISSUES = new Set<RoomMentionValidationIssue>([
  'empty',
  'transport_timeout',
  'missing_room_reply_section',
  'intermediate_only',
  'missing_task_understanding',
  'missing_workflow_mirror_section',
  'missing_deliverable_section',
  'missing_member_mirror_section',
]);

/**
 * Smart 点名：区分「history 未就绪」（空正文、缺镜像段等）与「格式/字段明确不合格」。
 * 后者应立刻走格式纠正重试，不应干等。
 */
export function isSmartMentionHistoryNotReadyFailure(
  issues: RoomMentionValidationIssue[],
  raw: string,
): boolean {
  if (!raw.trim()) return true;
  if (issues.length === 0) return false;
  return issues.every((i) => SMART_HISTORY_NOT_READY_ISSUES.has(i));
}

function pickSection(sections: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const hit = Object.entries(sections).find(
      ([k]) => k.includes(key) || key.includes(k),
    );
    if (hit?.[1]?.trim()) return hit[1].trim();
  }
  return '';
}

/** 从【群聊回复】到【分工】/文末，保留正文内【…已完成】子任务标记。 */
function extractRoomReplySectionBody(raw: string): string {
  const fromSmart = extractSmartRoomReplyAndDispatch(raw).roomReply.trim();
  if (fromSmart) return fromSmart;
  const m = raw.match(
    /【\s*群聊回复\s*】\s*([\s\S]*?)(?=【\s*(?:分工|指派|交接)\s*】\s*|$)/iu,
  );
  return m?.[1]?.trim() ?? '';
}

function memberImplicitRoomReply(roomBody: string, minLen: number): boolean {
  if (roomBody.length < minLen) return false;
  if (isRoomFastAckText(roomBody) || isFastAckOnlyReply(roomBody)) return false;
  if (isIntermediateOnlyRoomMirrorText(roomBody)) return false;
  return true;
}

/**
 * @deprecated dispatch 不再调用。语义失败禁止 salvage 重发；传输恢复见 room-mention-llm `resolveMentionSalvageSessionRaw`（完整三层校验）。
 * 保留供单测与历史对照。
 */
export function trySalvageMemberMentionRoomReply(params: {
  raw: string;
  coordinator: SmartCoordinatorRef;
  smartMemberReadiness?: SmartMemberExecutionReadiness;
  actorRoleName?: string;
}): string | null {
  const trimmed = params.raw.trim();
  const normalized = isSmartJsonShapeText(trimmed)
    ? normalizeSmartMentionRaw(trimmed, {
      isCoordinator: false,
      actorRoleName: params.actorRoleName,
    }).raw
    : coerceStructuredMentionRaw(trimmed, false);
  const coerced = normalized.trim() || coerceStructuredMentionRaw(trimmed, false);
  const parsed = parseRoomMentionStructuredReply(coerced);
  const readiness = resolveSmartMemberReadiness(
    params.smartMemberReadiness,
    parsed.understanding,
  );
  const memberEnd = parseSmartMemberJsonOutput(trimmed)?.action === 'end';
  const mirrorSections = extractOfficeBracketSections(coerced);
  const deliverableSection =
    mirrorSections['交付产物'] ?? mirrorSections['产物'] ?? '';
  const deliverablePathText = [
    deliverableSection,
    mirrorSections['输出校验'],
    mirrorSections['输出检查'],
  ]
    .filter(Boolean)
    .join('\n');
  const memberValidateOpts = {
    deliverableSection,
    deliverablePathText,
    actorRoleName: params.actorRoleName,
    dispatchText: parsed.dispatch,
    memberEnd,
  };
  let body = parsed.roomReply.trim();
  if (
    !body
    || validateSmartMemberRoomReply(body, params.coordinator, readiness, memberValidateOpts).length
    > 0
  ) {
    const fromUnderstanding = parsed.understanding.trim();
    if (
      fromUnderstanding
      && validateSmartMemberRoomReply(fromUnderstanding, params.coordinator, readiness, memberValidateOpts)
        .length === 0
    ) {
      body = fromUnderstanding;
    }
  }
  const coordinatorReachable = smartMemberReplyMentionsCoordinator(
    parsed.dispatch,
    params.coordinator,
  );
  if (!body || !coordinatorReachable) return null;
  if (validateSmartMemberRoomReply(body, params.coordinator, readiness, memberValidateOpts).length > 0) {
    return null;
  }
  return body;
}

/**
 * @deprecated 成员语义校验失败不再发群；仅 blocked 合成兜底保留。
 */
export function extractSmartMemberFallbackRoomPublishText(
  raw: string,
  minLen = 12,
): string | null {
  const coerced = coerceStructuredMentionRaw(raw.trim(), false);
  const parsed = parseRoomMentionStructuredReply(coerced);
  let body = parsed.roomReply.trim();
  if (!body || body.length < minLen) {
    body = extractPublicRoomMirrorText(coerced) || coerced;
  }
  body = body.trim();
  if (body.length < minLen) return null;
  if (isRoomFastAckText(body) || isFastAckOnlyReply(body)) return null;
  if (isIntermediateOnlyRoomMirrorText(body)) return null;
  return body;
}

/**
 * @deprecated dispatch 不再调用。协调者结项/派活语义失败禁止 salvage 重发；传输恢复见 room-mention-llm session salvage。
 */
export function trySalvageCoordinatorMentionRoomReply(params: {
  raw: string;
  coordinatorRoleId: string;
  nextExecutorRoleIds?: string[];
  /** @deprecated 使用 nextExecutorRoleIds */
  nextExecutorRoleId?: string | null;
  allowReporterFixRoleId?: string | null;
  allowUpstreamProducerRoleId?: string | null;
  teamRoles: Array<Pick<import('./types').OfficeRole, 'id' | 'name' | 'agentId'>>;
  actorRoleName?: string;
}): string | null {
  const actorName =
    params.actorRoleName?.trim()
    || params.teamRoles.find((r) => r.id === params.coordinatorRoleId)?.name?.trim()
    || '';
  const norm = normalizeSmartMentionRaw(params.raw.trim(), {
    isCoordinator: true,
    actorRoleName: actorName,
  });
  const coerced = norm.jsonInvalid
    ? coerceStructuredMentionRaw(params.raw.trim(), true)
    : norm.raw;
  const parsed = parseRoomMentionStructuredReply(coerced);
  let body = buildSmartCoordinatorRoomPublishText(parsed.roomReply, parsed.dispatch);
  if (!body || body.length < 12) {
    body = extractPublicRoomMirrorText(coerced) || coerced;
  }
  if (!/[@＠]/u.test(body) || body.length < 12) return null;
  if (isRoomFastAckText(body) || isFastAckOnlyReply(body)) return null;
  const publish = finalizeCoordinatorDispatchReply(body);
  if (!publish.trim()) return null;
  return publish.trim();
}

export function parseRoomMentionStructuredReply(text: string): ParsedRoomMentionReply {
  const raw = text.trim();
  const sections: Record<string, string> = {};
  const matches = [...raw.matchAll(SECTION_RE)];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const title = m[1]!.trim();
    if (PROMPT_ECHO_SECTION_RE.test(title)) continue;
    if (isSmartSubtaskDoneBracketTitle(title)) continue;
    const start = m.index! + m[0].length;
    const end = matches[i + 1]?.index ?? raw.length;
    sections[title] = raw.slice(start, end).trim();
  }

  const smartFields = extractSmartRoomReplyAndDispatch(raw);
  let roomReply = smartFields.roomReply || extractRoomReplySectionBody(raw);
  if (!roomReply) {
    roomReply = pickSection(sections, ROOM_REPLY_KEYS);
  }
  const understanding = pickSection(sections, UNDERSTANDING_KEYS);
  const judgment = sections['判定']?.trim() ?? '';
  const dispatch = smartFields.dispatch || pickSection(sections, DISPATCH_KEYS);

  if (!roomReply) {
    const stripped = extractPublicRoomMirrorText(raw);
    roomReply = stripped || raw;
  }

  return { understanding, judgment, roomReply, dispatch: dispatch ?? '', raw };
}

export function isModelTransportError(reason: 'timeout' | 'error' | 'empty'): boolean {
  return reason === 'timeout' || reason === 'error';
}

/** 群聊发布 salvage 仅允许的 issue（传输/空回复）；语义校验 issue 禁止走 salvage 重发正文。 */
export const MENTION_PUBLISH_SALVAGE_TRANSPORT_ISSUES = new Set<RoomMentionValidationIssue>([
  'empty',
  'transport_timeout',
  'transport_error',
  'model_error',
]);

/**
 * dispatch 层是否允许 salvage 发布：仅传输类失败。
 * 语义校验失败（含三层校验任一不通过）一律不重发正文；传输恢复由 room-mention-llm session salvage 走完整校验。
 */
export function shouldAttemptMentionPublishSalvage(params: {
  transportReason: 'timeout' | 'error' | 'empty';
  issues: RoomMentionValidationIssue[];
}): boolean {
  if (!isModelTransportError(params.transportReason)) return false;
  if (params.issues.length === 0) return true;
  return params.issues.every((i) => MENTION_PUBLISH_SALVAGE_TRANSPORT_ISSUES.has(i));
}

export { isLikelyModelRuntimeError } from './room-mention-reply-policy';

export function validateRoomMentionStructuredReply(params: {
  raw: string;
  transportReason: 'timeout' | 'error' | 'empty';
  executionMode: OfficeTaskExecutionMode;
  isCoordinator: boolean;
  needsDecomposition?: boolean;
  minRoomReplyChars?: number;
  /** 协调者广播介入：允许仅【判定】无需回应、不发群 */
  allowCoordinatorSilentNoReply?: boolean;
  /** 补指派等场景：发布正文须含 @ */
  requireMentionsInPublish?: boolean;
  /** Smart 成员回复须 @ 协调者 */
  coordinatorRole?: { id: string; name: string };
  smartMemberReadiness?: SmartMemberExecutionReadiness;
  /** 成员格式失败后的协调者介入：不要求【分工】拆解 */
  promptVariant?: string;
  /** Smart 协调者回复成员汇报：不要求【须拆解】式 @指派 */
  triggerFromMemberAgent?: boolean;
  coordinatorAgentId?: string;
  coordinatorRoleId?: string;
  smartNextExecutorRoleIds?: string[];
  /** @deprecated 使用 smartNextExecutorRoleIds */
  smartNextExecutorRoleId?: string | null;
  teamRoles?: Array<Pick<import('./types').OfficeRole, 'id' | 'name' | 'agentId'>>;
  smartAllowReporterFixRoleId?: string | null;
  smartAllowUpstreamProducerRoleId?: string | null;
  /** 引擎磁盘核验判定成员【输入校验】不合格 */
  smartInputValidationFailed?: boolean;
  viewerRoleId?: string;
  taskId?: string;
  projectId?: string;
  smartWorkSteps?: import('../../../src/lib/office-smart-work-order').SmartWorkOrderStep[];
  roomMessages?: import('./types').RoomMessage[];
  memberReportRaw?: string;
  /** Smart 协调者回复成员汇报：dispatch 不得点名汇报者 */
  reporterRoleId?: string;
  actorRoleName?: string;
  /** 结项冲突强制结项：仅跳过 premature 工作顺序闸门。 */
  forceCoordinatorProjectEnd?: boolean;
}): RoomMentionValidationResult {
  if (params.executionMode === 'smart') {
    return validateSmartRoomMentionSync({
      raw: params.raw,
      transportReason: params.transportReason,
      isCoordinator: params.isCoordinator,
      needsDecomposition: params.needsDecomposition,
      minRoomReplyChars: params.minRoomReplyChars,
      allowCoordinatorSilentNoReply: params.allowCoordinatorSilentNoReply,
      requireMentionsInPublish: params.requireMentionsInPublish,
      coordinatorRole: params.coordinatorRole,
      smartMemberReadiness: params.smartMemberReadiness,
      promptVariant: params.promptVariant,
      triggerFromMemberAgent: params.triggerFromMemberAgent,
      coordinatorAgentId: params.coordinatorAgentId ?? params.coordinatorRoleId,
      coordinatorRoleId: params.coordinatorAgentId ?? params.coordinatorRoleId,
      smartNextExecutorRoleIds: params.smartNextExecutorRoleIds,
      smartNextExecutorRoleId: params.smartNextExecutorRoleId,
      teamRoles: params.teamRoles,
      smartAllowReporterFixRoleId: params.smartAllowReporterFixRoleId,
      smartAllowUpstreamProducerRoleId: params.smartAllowUpstreamProducerRoleId,
      smartInputValidationFailed: params.smartInputValidationFailed,
      viewerRoleId: params.viewerRoleId,
      projectId: params.projectId ?? params.taskId,
      taskId: params.taskId ?? params.projectId,
      smartWorkSteps: params.smartWorkSteps,
      roomMessages: params.roomMessages,
      memberReportRaw: params.memberReportRaw,
      reporterRoleId: params.reporterRoleId,
      actorRoleName: params.actorRoleName,
      forceCoordinatorProjectEnd: params.forceCoordinatorProjectEnd,
    });
  }

  /** Workflow-only：Smart 已在函数首部委托 validateSmartRoomMentionSync 并提前返回。
   * 群聊可发布正文在 finalize 之后不再做 @ 目标校验与 clamp 裁剪。 */
  const raw = coerceStructuredMentionRaw(params.raw.trim(), params.isCoordinator);
  const minLen = params.minRoomReplyChars ?? SMART_MIN_ROOM_REPLY_CHARS;

  if (
    params.allowCoordinatorSilentNoReply
    && params.isCoordinator
    && coordinatorDecidedNoReply(raw)
  ) {
    const parsed = parseRoomMentionStructuredReply(raw);
    return { ok: true, parsed, roomText: '' };
  }

  if (params.transportReason === 'timeout') {
    return {
      ok: false,
      issues: ['transport_timeout'],
      detail: '等待模型回复超时',
      raw,
    };
  }
  if (params.transportReason === 'error') {
    return {
      ok: false,
      issues: ['transport_error'],
      detail: '模型会话调用异常',
      raw,
    };
  }
  if (!raw) {
    return {
      ok: false,
      issues: ['empty'],
      detail: '未收到模型正文',
      raw,
    };
  }
  if (isEnglishInternalReasoning(raw)) {
    return {
      ok: false,
      issues: ['english_internal_reasoning'],
      detail: formatStructuredValidationFailureDetail(['english_internal_reasoning']),
      raw,
    };
  }
  if (isNonSubstantiveMentionSessionReply(raw)) {
    return {
      ok: false,
      issues: ['fast_ack_only'],
      detail: formatStructuredValidationFailureDetail(['fast_ack_only']),
      raw,
    };
  }
  if (isLikelyModelRuntimeError(raw)) {
    return {
      ok: false,
      issues: ['model_error'],
      detail: formatStructuredValidationFailureDetail(['model_error']),
      raw,
    };
  }

  const parsed = parseRoomMentionStructuredReply(raw);
  const sectionTitles = [...raw.matchAll(SECTION_RE)].map((m) => m[1]!.trim());
  const hasRoomSection =
    ROOM_REPLY_KEYS.some((k) =>
      sectionTitles.some((title) => title.includes(k) || k.includes(title)),
    ) || ROOM_REPLY_KEYS.some((k) => new RegExp(`【\\s*[^】]*${k}`, 'u').test(raw));
  const roomBody = parsed.roomReply.trim();

  const effectiveHasRoomSection =
    hasRoomSection
    || (!params.isCoordinator && memberImplicitRoomReply(roomBody, minLen));

  const issues: RoomMentionValidationIssue[] = [];
  if (!effectiveHasRoomSection) {
    issues.push('missing_room_reply_section');
  }
  if (roomBody.length < minLen) {
    issues.push('room_reply_too_short');
  }
  if (isRoomFastAckText(roomBody) || isFastAckOnlyReply(roomBody)) {
    issues.push('fast_ack_only');
  }
  if (!effectiveHasRoomSection && isIntermediateOnlyRoomMirrorText(roomBody)) {
    issues.push('intermediate_only');
  }

  if (
    !params.isCoordinator
    && roomBody.length >= minLen
    && isWorkflowPromissoryDeliverable(roomBody)
  ) {
    issues.push('workflow_member_promise_only');
  }

  if (issues.length > 0) {
    return {
      ok: false,
      issues,
      detail: formatStructuredValidationFailureDetail(issues, {
        smartNextExecutorRoleIds: [
          ...(params.smartNextExecutorRoleIds ?? []),
          ...(params.smartNextExecutorRoleId ? [params.smartNextExecutorRoleId] : []),
        ].filter(Boolean),
        teamRoles: params.teamRoles?.map((r) => {
          const ref = r as { agentId?: string; id?: string; displayName?: string; name?: string };
          return {
            agentId: (ref.agentId ?? ref.id ?? '').trim(),
            displayName: (ref.displayName ?? ref.name ?? '').trim(),
          };
        }),
        smartWorkSteps: params.smartWorkSteps,
      }),
      raw,
    };
  }

  const withDispatch =
    buildSmartCoordinatorRoomPublishText(roomBody, parsed.dispatch)
    || [roomBody, parsed.dispatch].filter(Boolean).join('\n\n').trim()
    || roomBody;
  const roomText = parsed.dispatch.trim()
    ? finalizeCoordinatorDispatchReply(withDispatch)
    : effectiveHasRoomSection
      ? roomBody.trim()
      : extractPublicRoomMirrorText(roomBody) || roomBody;

  if (!roomText.trim() || isUnmirroredRoomSnippet(roomText)) {
    return {
      ok: false,
      issues: ['intermediate_only'],
      detail: '群聊可发布内容为空或仅为中间叙述',
      raw,
    };
  }

  if (params.requireMentionsInPublish && !/[@＠]/u.test(roomText)) {
    return {
      ok: false,
      issues: ['missing_mention_targets'],
      detail: '补指派须包含 @ 执行者',
      raw,
    };
  }

  return { ok: true, parsed, roomText: roomText.trim() };
}

/** Smart 协调者点名输出格式（无【理解】段；无成员【交付·文件】细则）。 */
export const ROOM_MENTION_OUTPUT_FORMAT_SMART_COORDINATOR = [
  '【输出格式·必须严格遵守】',
  '仅输出纯 JSON，禁止文字、注释、Markdown 或额外内容。字段不可增删改、不可缺省。',
  '有新指派时 dispatch 须包含本阶段执行者；无新指派、咨询、阻塞或结项时 dispatch 写 []。',
  'json',
  ...buildSmartCoordinatorJsonSchemaLines('协调者'),
].join('\n');

export function roomMentionOutputFormatSmartMember(
  readiness: SmartMemberExecutionReadiness = 'ready',
): string {
  const branch =
    readiness === 'blocked'
      ? [
        '【成员·依赖未就绪】action="help"；deliverable.items 与 outputValidation 均为 []；',
        'taskUnderstanding 说明具体依赖/阻塞；dispatch 指派协调者；禁止 action="end"。',
      ].join('')
      : readiness === 'acceptance'
        ? [
          '【成员·验收通知】协调者确认你侧已验收：',
          'taskUnderstanding 简短确认收到；dispatch 指派协调者；禁止 action="end" 或 action="help"。',
        ].join('')
        : [
          '【成员·可执行】依赖已满足：产出落盘后 action="end" 汇报；',
          'deliverable.items 填 交付物-角色/ 路径，outputValidation 贴 ls -l；dispatch 指派协调者验收。',
          '完成标识仅看 action="end"（引擎 smartMemberEnd），勿写 roomReply 或 **…已完成** 加粗。',
        ].join('');
  return [ROOM_MENTION_OUTPUT_FORMAT_SMART_COORDINATOR_MEMBER_FALLBACK, branch].join('\n');
}

/** Smart 成员 fallback 格式块（仅无 baseAgentPrompt 的重试路径；正常点名用 buildSmartMemberAgentTaskPrompt）。 */
export const ROOM_MENTION_OUTPUT_FORMAT_SMART_COORDINATOR_MEMBER_FALLBACK = [
  '【输出格式·必须严格遵守】',
  '仅输出纯 JSON，禁止 Markdown、注释或额外文字。字段不可增删改、不可缺省。',
  '群聊可见正文由 taskUnderstanding + deliverable 摘要 + dispatch 合成；勿输出 roomReply 字段。',
].join('\n');

export const ROOM_MENTION_OUTPUT_FORMAT_SMART_MEMBER =
  roomMentionOutputFormatSmartMember('ready');

/** Workflow 群聊点名输出格式（成员可向其他角色交接，【分工】可选）。 */
export function roomMentionOutputFormatBlock(
  executionMode: OfficeTaskExecutionMode,
  isCoordinator: boolean,
  smartMemberReadiness?: SmartMemberExecutionReadiness,
): string {
  if (executionMode === 'smart') {
    return isCoordinator
      ? ROOM_MENTION_OUTPUT_FORMAT_SMART_COORDINATOR
      : roomMentionOutputFormatSmartMember(smartMemberReadiness ?? 'ready');
  }
  const dispatchLine = isCoordinator
    ? '【分工】可选：监督性说明或答疑；节点指派由 runner 负责，勿替代 DAG 派活。'
    : '';
  const workflowMemberRules =
    executionMode === 'workflow' && !isCoordinator
      ? [
        '【Workflow·成员·引擎校验】发群正文禁止「预计…前完成」等口头承诺，须含可核验交付摘要；完整【输出校验】在节点执行阶段完成，群聊不要求写出该段落标题。',
        '【中文】群聊正文须中文，禁止英文思考/NO_REPLY/optional 泄漏。',
        '【禁止】勿写【分工】、勿在群聊 @ 指派下一节点；阻塞仅 @协调者。',
      ].join('\n')
      : '';
  return [
    '【输出格式·必须严格遵守】',
    '仅输出以下【】段落（禁止输出思考过程、工具日志）：',
    '【理解】1–3 句：对点名人发言与当前步骤/依赖的理解（不会单独发到群）。',
    '【群聊回复】必须：将发到项目群的正文（≥2 句实质内容）；禁止「收到/待我思考」类占位。',
    dispatchLine,
    workflowMemberRules,
  ]
    .filter(Boolean)
    .join('\n');
}
/** 结构化校验失败后重试时的固定指令（追加在纠正 Prompt 中）。 */
export const ROOM_MENTION_STRUCTURED_RETRY_INSTRUCTION =
  '你上次的返回结果不符合预期，请排查原因，然后输出正确的结果；不要解释、不要道歉，直接输出正确结果。';

export function buildRoomMentionRetryPrompt(params: {
  roleName: string;
  priorRaw: string;
  executionMode?: OfficeTaskExecutionMode;
  isCoordinator?: boolean;
  transportReason?: 'timeout' | 'error' | 'empty';
  validationDetail?: string;
  issues?: RoomMentionValidationIssue[];
  smartMemberReadiness?: SmartMemberExecutionReadiness;
  /** 首次点名完整 Prompt；重试时在其前加格式纠正前缀 */
  baseAgentPrompt?: string;
}): string {
  const transportReasons: string[] = [];
  if (params.transportReason === 'timeout') {
    transportReasons.push('【传输】：上次等待超时，未拿到完整回复');
  }
  if (params.transportReason === 'error') {
    transportReasons.push('【传输】：上次调用异常');
  }
  const structuredReason =
    params.validationDetail?.trim()
    || (params.issues?.length
      ? (
        params.executionMode === 'smart'
          && isSmartMissingMentionRetryIssue(params.issues.map(String))
          ? resolveSmartMissingMentionRetryReasonDetail(params.isCoordinator === true)
          : formatStructuredValidationFailureDetail(params.issues.map(String))
      )
      : '');
  const reasonDetail = [...transportReasons, structuredReason].filter(Boolean).join('\n');

  const preambleParams = {
    roleName: params.roleName,
    reasonDetail: reasonDetail || '输出不符合群聊点名结构化格式',
    priorRaw: params.priorRaw,
    issues: params.issues?.map(String),
  };

  const preamble =
    params.executionMode === 'smart'
      ? params.isCoordinator
        ? buildSmartCoordinatorRetryPreamble(preambleParams)
        : buildSmartMemberRetryPreamble(preambleParams)
      : buildWorkflowMentionRetryPreamble(preambleParams);

  const base = params.baseAgentPrompt?.trim();
  if (params.executionMode === 'smart' && base) {
    return buildSmartMentionFormatRetryPrompt({
      roleName: params.roleName,
      reasonDetail: reasonDetail || '输出不符合群聊点名结构化格式',
      priorRaw: params.priorRaw,
      baseAgentPrompt: base,
    });
  }

  if (base) {
    return `${preamble}\n\n${base}\n\n${SMART_MENTION_RETRY_TAIL}`;
  }

  if (params.executionMode === 'smart') {
    return `${preamble}\n\n${SMART_MENTION_RETRY_TAIL}`;
  }

  const prior = sanitizePriorRawForRetryDisplay(params.priorRaw);
  return [
    preamble,
    roomMentionOutputFormatBlock(
      params.executionMode ?? 'workflow',
      params.isCoordinator ?? false,
      params.smartMemberReadiness,
    ),
    prior ? `（上次输出节选）\n---\n${prior}\n---` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Workflow 模式重试前缀（无 Smart 四段时沿用通用表述）。 */
function buildWorkflowMentionRetryPreamble(params: {
  roleName: string;
  reasonDetail: string;
  priorRaw: string;
}): string {
  const prior = sanitizePriorRawForRetryDisplay(params.priorRaw);
  return [
    `【${params.roleName}·格式纠正】`,
    ROOM_MENTION_STRUCTURED_RETRY_INSTRUCTION,
    '你上一次的输出不符合群聊点名回复格式，请仅重输出一次。',
    `原因：${params.reasonDetail}`,
    '上次输出（供对照，勿照抄占位内容）：',
    '---',
    prior || '（上次无有效正文）',
    '---',
  ].join('\n');
}
