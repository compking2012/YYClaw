import {
  extractPublicRoomMirrorText,
  finalizeCoordinatorDispatchReply,
  isIntermediateOnlyRoomMirrorText,
} from '../../../src/lib/office-room-mirror-public';
import { formatStructuredValidationFailureDetail } from '../../../src/lib/office-mention-validation-detail';
import { isSmartProjectEngineComplete } from '../../../src/lib/office-smart-coordinator-dispatch';
import {
  appendSmartProjectEndRoomMarker,
  coordinatorReplyMayCloseProject,
  extractSmartProjectClosureRoomPublishText,
  parseSmartCoordinatorEndFlag,
} from '../../../src/lib/office-smart-project-end';
import {
  buildSmartCoordinatorRoomPublishText,
  extractSmartRoomReplyAndDispatch,
  hasSmartCoordinatorStructuredDispatch,
} from '../../../src/lib/office-smart-room-fields';
import {
  resolveSmartMemberHelpAction,
  runSmartStructuredLayers123,
  shouldSkipSmartStructuredDiskLayer,
  type SmartStructuredLayerIssue,
  type SmartStructuredValidationStage,
} from '../../../src/lib/office-smart-structured-validation';
import { SMART_MIN_ROOM_REPLY_CHARS } from '../../../src/lib/office-smart-json-schema';
import { extractOfficeBracketSections } from '../../../src/lib/office-workflow-output-sections';
import { isRoomFastAckText } from './room-fast-ack';
import { coordinatorDecidedNoReply } from './room-unmentioned-coordinator';
import type { SmartMentionDiskVerifyFn } from './room-mention-llm';
import {
  isFastAckOnlyReply,
  isEnglishInternalReasoning,
  isLikelyModelRuntimeError,
  isNonSubstantiveMentionSessionReply,
  isUnmirroredRoomSnippet,
} from './room-mention-reply-policy';
import type {
  ParsedRoomMentionReply,
  RoomMentionValidationIssue,
  RoomMentionValidationResult,
} from './room-mention-structured-reply';

const SECTION_RE = /【\s*([^】]+)\s*】/g;
const ROOM_REPLY_KEYS = ['群聊回复', '回复', '交付'];

function memberImplicitRoomReply(roomBody: string, minLen: number): boolean {
  if (roomBody.length < minLen) return false;
  if (isRoomFastAckText(roomBody) || isFastAckOnlyReply(roomBody)) return false;
  if (isIntermediateOnlyRoomMirrorText(roomBody)) return false;
  return true;
}

function parseMinimalRoomMention(raw: string): ParsedRoomMentionReply {
  const smart = extractSmartRoomReplyAndDispatch(raw);
  const sections = extractOfficeBracketSections(raw);
  return {
    understanding: sections['任务理解'] ?? sections['理解'] ?? '',
    judgment: sections['判定']?.trim() ?? '',
    roomReply: smart.roomReply,
    dispatch: smart.dispatch,
    raw,
  };
}

export type SmartMentionValidationParams = {
  raw: string;
  transportReason: 'timeout' | 'error' | 'empty';
  isCoordinator: boolean;
  needsDecomposition?: boolean;
  minRoomReplyChars?: number;
  allowCoordinatorSilentNoReply?: boolean;
  requireMentionsInPublish?: boolean;
  coordinatorRole?: { id: string; name: string };
  smartMemberReadiness?: import('../../../src/lib/office-smart-member-reply').SmartMemberExecutionReadiness;
  promptVariant?: string;
  triggerFromMemberAgent?: boolean;
  coordinatorAgentId?: string;
  coordinatorRoleId?: string;
  smartNextExecutorRoleIds?: string[];
  smartNextExecutorRoleId?: string | null;
  teamRoles?: Array<Pick<import('./types').OfficeRole, 'id' | 'name' | 'agentId'>>;
  smartAllowReporterFixRoleId?: string | null;
  smartAllowUpstreamProducerRoleId?: string | null;
  smartInputValidationFailed?: boolean;
  viewerRoleId?: string;
  taskId?: string;
  projectId?: string;
  smartWorkSteps?: import('../../../src/lib/office-smart-work-order').SmartWorkOrderStep[];
  roomMessages?: import('./types').RoomMessage[];
  memberReportRaw?: string;
  reporterRoleId?: string;
  actorRoleName?: string;
  /** 结项冲突强制结项：仅跳过 premature 工作顺序闸门。 */
  forceCoordinatorProjectEnd?: boolean;
};

function mapStructuredIssue(issue: SmartStructuredLayerIssue): RoomMentionValidationIssue {
  return issue as RoomMentionValidationIssue;
}

/**
 * teamRoles 兼容两种形状：新 ProjectAgentRef（agentId/displayName）与 legacy OfficeRole（id/name）。
 * 归一为 { agentId, displayName }，避免映射时丢失 displayName（否则名称匹配失败）。
 */
function toAgentDisplayRef(
  role: { agentId?: string; id?: string; displayName?: string; name?: string },
): { agentId: string; displayName: string } {
  return {
    agentId: (role.agentId ?? role.id ?? '').trim(),
    displayName: (role.displayName ?? role.name ?? '').trim(),
  };
}

function failureFromStructured(
  result: Extract<ReturnType<typeof runSmartStructuredLayers123>, { ok: false }>,
  params: SmartMentionValidationParams,
): { ok: false; issues: RoomMentionValidationIssue[]; detail: string; raw: string } {
  const issues = result.issues.map(mapStructuredIssue);
  return {
    ok: false,
    issues,
    detail: formatStructuredValidationFailureDetail(issues, {
      smartNextExecutorRoleIds: [
        ...(params.smartNextExecutorRoleIds ?? []),
        ...(params.smartNextExecutorRoleId ? [params.smartNextExecutorRoleId] : []),
      ].filter(Boolean),
      teamRoles: params.teamRoles?.map(toAgentDisplayRef),
      smartWorkSteps: params.smartWorkSteps,
    }),
    raw: result.raw,
  };
}

function resolveProjectEngineComplete(params: SmartMentionValidationParams): boolean {
  const steps = params.smartWorkSteps ?? [];
  if (!params.isCoordinator) return false;
  const scopeId = (params.projectId ?? params.taskId ?? '').trim();
  if (!scopeId || !params.roomMessages) return false;
  return isSmartProjectEngineComplete({
    steps,
    roomMessages: params.roomMessages,
    projectId: scopeId,
    coordinatorAgentId: params.coordinatorAgentId ?? params.coordinatorRoleId,
    teamRoles: params.teamRoles?.map(toAgentDisplayRef),
  });
}

/** Smart 薄发布校验（第 5 段）：群聊可发布形态与正文组装。 */
export function validateSmartPrePublish(params: {
  normalizedRaw: string;
  isCoordinator: boolean;
  minRoomReplyChars?: number;
  allowCoordinatorSilentNoReply?: boolean;
  requireMentionsInPublish?: boolean;
  projectEngineComplete: boolean;
  smartWorkSteps?: import('../../../src/lib/office-smart-work-order').SmartWorkOrderStep[];
}): RoomMentionValidationResult {
  const raw = params.normalizedRaw.trim();
  const minLen = params.minRoomReplyChars ?? SMART_MIN_ROOM_REPLY_CHARS;

  if (
    params.allowCoordinatorSilentNoReply
    && params.isCoordinator
    && coordinatorDecidedNoReply(raw)
  ) {
    return { ok: true, parsed: parseMinimalRoomMention(raw), roomText: '' };
  }

  const parsed = parseMinimalRoomMention(raw);
  const sectionTitles = [...raw.matchAll(SECTION_RE)].map((m) => m[1]!.trim());
  const hasRoomSection =
    ROOM_REPLY_KEYS.some((k) =>
      sectionTitles.some((title) => title.includes(k) || k.includes(title)),
    ) || ROOM_REPLY_KEYS.some((k) => new RegExp(`【\\s*[^】]*${k}`, 'u').test(raw));
  const roomBody = parsed.roomReply.trim();
  const smartMemberRequiresExplicitRoomReply = !params.isCoordinator;
  const projectEngineComplete = params.projectEngineComplete;

  const closingWithProjectEnd =
    params.isCoordinator
    && coordinatorReplyMayCloseProject(raw, projectEngineComplete, minLen);

  const coordinatorPublishBody = params.isCoordinator
    ? buildSmartCoordinatorRoomPublishText(roomBody, parsed.dispatch)
    || [roomBody, parsed.dispatch, extractPublicRoomMirrorText(raw)].filter(Boolean).join('\n\n').trim()
    : roomBody;

  const effectiveHasRoomSection = closingWithProjectEnd
    ? true
    : smartMemberRequiresExplicitRoomReply
      ? hasRoomSection
      : hasRoomSection
      || memberImplicitRoomReply(roomBody, minLen)
      || (params.isCoordinator && memberImplicitRoomReply(coordinatorPublishBody, minLen));

  const issues: RoomMentionValidationIssue[] = [];
  if (!effectiveHasRoomSection) {
    issues.push('missing_room_reply_section');
  }
  if (!closingWithProjectEnd && roomBody.length < minLen) {
    issues.push('room_reply_too_short');
  }
  if (isRoomFastAckText(roomBody) || isFastAckOnlyReply(roomBody)) {
    issues.push('fast_ack_only');
  }
  if (!effectiveHasRoomSection && isIntermediateOnlyRoomMirrorText(roomBody)) {
    issues.push('intermediate_only');
  }

  if (issues.length > 0) {
    return {
      ok: false,
      issues,
      detail: formatStructuredValidationFailureDetail(issues, {
        smartNextExecutorRoleIds: [],
        teamRoles: undefined,
        smartWorkSteps: params.smartWorkSteps,
      }),
      raw,
    };
  }

  const withDispatch =
    buildSmartCoordinatorRoomPublishText(roomBody, parsed.dispatch)
    || [roomBody, parsed.dispatch].filter(Boolean).join('\n\n').trim()
    || roomBody;
  let roomText = closingWithProjectEnd
    ? extractSmartProjectClosureRoomPublishText(raw).trim()
    : finalizeCoordinatorDispatchReply(withDispatch)
    || (effectiveHasRoomSection
      ? roomBody.trim()
      : extractPublicRoomMirrorText(roomBody) || roomBody);

  if (!roomText.trim() || isUnmirroredRoomSnippet(roomText)) {
    return {
      ok: false,
      issues: ['intermediate_only'],
      detail: '群聊可发布内容为空或仅为中间叙述',
      raw,
    };
  }

  if (
    params.requireMentionsInPublish
    && params.isCoordinator
    && !hasSmartCoordinatorStructuredDispatch(raw)
  ) {
    return {
      ok: false,
      issues: ['missing_mention_targets'],
      detail: '补指派须在 dispatch 数组中点名执行者（roomReply @ 不计）',
      raw,
    };
  }

  const declaresProjectEnd = parseSmartCoordinatorEndFlag(raw);
  if (declaresProjectEnd && params.isCoordinator) {
    roomText = appendSmartProjectEndRoomMarker(roomText);
  }

  return { ok: true, parsed, roomText: roomText.trim() };
}

function buildFlowContext(params: SmartMentionValidationParams, memberHelpAction: boolean) {
  return {
    needsDecomposition: params.needsDecomposition,
    minRoomReplyChars: params.minRoomReplyChars,
    allowCoordinatorSilentNoReply: params.allowCoordinatorSilentNoReply,
    coordinatorRole: params.coordinatorRole
      ? toAgentDisplayRef(params.coordinatorRole)
      : undefined,
    smartMemberReadiness: params.smartMemberReadiness,
    promptVariant: params.promptVariant,
    triggerFromMemberAgent: params.triggerFromMemberAgent,
    coordinatorAgentId: params.coordinatorAgentId ?? params.coordinatorRoleId,
    smartNextExecutorRoleIds: params.smartNextExecutorRoleIds,
    smartNextExecutorRoleId: params.smartNextExecutorRoleId,
    teamRoles: params.teamRoles?.map(toAgentDisplayRef),
    smartAllowReporterFixRoleId: params.smartAllowReporterFixRoleId,
    smartAllowUpstreamProducerRoleId: params.smartAllowUpstreamProducerRoleId,
    smartInputValidationFailed: params.smartInputValidationFailed,
    viewerRoleId: params.viewerRoleId,
    projectId: params.projectId ?? params.taskId,
    taskId: params.taskId,
    smartWorkSteps: params.smartWorkSteps,
    roomMessages: params.roomMessages,
    memberReportRaw: params.memberReportRaw,
    reporterRoleId: params.reporterRoleId,
    memberHelpAction,
    actorRoleName: params.actorRoleName,
    forceCoordinatorProjectEnd: params.forceCoordinatorProjectEnd,
  };
}

function preTransportChecks(
  params: SmartMentionValidationParams,
): RoomMentionValidationResult | null {
  if (params.transportReason === 'timeout') {
    return { ok: false, issues: ['transport_timeout'], detail: '等待模型回复超时', raw: params.raw };
  }
  if (params.transportReason === 'error') {
    return { ok: false, issues: ['transport_error'], detail: '模型会话调用异常', raw: params.raw };
  }
  if (!params.raw.trim()) {
    return { ok: false, issues: ['empty'], detail: '未收到模型正文', raw: params.raw };
  }
  const inputRaw = params.raw.trim();
  if (isEnglishInternalReasoning(inputRaw)) {
    return {
      ok: false,
      issues: ['english_internal_reasoning'],
      detail: formatStructuredValidationFailureDetail(['english_internal_reasoning']),
      raw: inputRaw,
    };
  }
  if (isNonSubstantiveMentionSessionReply(inputRaw)) {
    return {
      ok: false,
      issues: ['fast_ack_only'],
      detail: formatStructuredValidationFailureDetail(['fast_ack_only']),
      raw: inputRaw,
    };
  }
  if (isLikelyModelRuntimeError(inputRaw)) {
    return {
      ok: false,
      issues: ['model_error'],
      detail: formatStructuredValidationFailureDetail(['model_error']),
      raw: inputRaw,
    };
  }
  return null;
}

/**
 * Smart 同步校验：结构化 1–3 层 + 薄发布（不含落盘）。
 * 供单测与无磁盘上下文的调用方使用。
 */
export function validateSmartRoomMentionSync(
  params: SmartMentionValidationParams,
): RoomMentionValidationResult {
  try {
    return validateSmartRoomMentionSyncInner(params);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      issues: ['transport_error'],
      detail,
      raw: params.raw,
    };
  }
}

function validateSmartRoomMentionSyncInner(
  params: SmartMentionValidationParams,
): RoomMentionValidationResult {
  const transport = preTransportChecks(params);
  if (transport) return transport;

  const inputRaw = params.raw.trim();
  const memberHelpAction = resolveSmartMemberHelpAction(
    inputRaw,
    undefined,
    params.isCoordinator,
  );

  const structured = runSmartStructuredLayers123({
    raw: inputRaw,
    isCoordinator: params.isCoordinator,
    actorRoleName: params.actorRoleName,
    flow: buildFlowContext(params, memberHelpAction),
  });

  if (!structured.ok) {
    return failureFromStructured(structured, params);
  }

  const prePublish = validateSmartPrePublish({
    normalizedRaw: structured.normalizedRaw,
    isCoordinator: params.isCoordinator,
    minRoomReplyChars: params.minRoomReplyChars,
    allowCoordinatorSilentNoReply: params.allowCoordinatorSilentNoReply,
    requireMentionsInPublish: params.requireMentionsInPublish,
    projectEngineComplete: resolveProjectEngineComplete(params),
    smartWorkSteps: params.smartWorkSteps,
  });

  if (!prePublish.ok) {
    return { ...prePublish, raw: inputRaw };
  }

  return {
    ok: true,
    parsed: { ...prePublish.parsed, raw: structured.normalizedRaw },
    roomText: prePublish.roomText,
  };
}

/**
 * Smart 完整校验：结构化 1–4 层（含落盘）+ 薄发布。
 */
export async function validateSmartMentionReply(
  params: SmartMentionValidationParams & { verifyDisk?: SmartMentionDiskVerifyFn },
): Promise<RoomMentionValidationResult & { raw: string; structuredStage?: SmartStructuredValidationStage }> {
  try {
    return await validateSmartMentionReplyInner(params);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      issues: ['transport_error'],
      detail,
      raw: params.raw,
    };
  }
}

async function validateSmartMentionReplyInner(
  params: SmartMentionValidationParams & { verifyDisk?: SmartMentionDiskVerifyFn },
): Promise<RoomMentionValidationResult & { raw: string; structuredStage?: SmartStructuredValidationStage }> {
  const transport = preTransportChecks(params);
  if (transport) return { ...transport, raw: params.raw };

  const inputRaw = params.raw.trim();
  const memberHelpAction = resolveSmartMemberHelpAction(
    inputRaw,
    undefined,
    params.isCoordinator,
  );

  const structured = runSmartStructuredLayers123({
    raw: inputRaw,
    isCoordinator: params.isCoordinator,
    actorRoleName: params.actorRoleName,
    flow: buildFlowContext(params, memberHelpAction),
  });

  if (!structured.ok) {
    return { ...failureFromStructured(structured, params), structuredStage: structured.stage };
  }

  const skipDisk = shouldSkipSmartStructuredDiskLayer({
    isCoordinator: params.isCoordinator,
    inputRaw,
    normalizedRaw: structured.normalizedRaw,
  });
  const diskRan = Boolean(params.verifyDisk && !skipDisk);

  if (diskRan) {
    const disk = await params.verifyDisk!(inputRaw);
    if (!disk.ok) {
      return {
        ok: false,
        issues: ['smart_deliverable_paths_missing_on_disk'],
        detail: disk.detail,
        raw: inputRaw,
        structuredStage: 'disk',
      };
    }
  }

  const prePublish = validateSmartPrePublish({
    normalizedRaw: structured.normalizedRaw,
    isCoordinator: params.isCoordinator,
    minRoomReplyChars: params.minRoomReplyChars,
    allowCoordinatorSilentNoReply: params.allowCoordinatorSilentNoReply,
    requireMentionsInPublish: params.requireMentionsInPublish,
    projectEngineComplete: resolveProjectEngineComplete(params),
    smartWorkSteps: params.smartWorkSteps,
  });

  if (!prePublish.ok) {
    return { ...prePublish, raw: inputRaw };
  }

  return {
    ok: true,
    parsed: { ...prePublish.parsed, raw: structured.normalizedRaw },
    roomText: prePublish.roomText,
    raw: inputRaw,
    structuredStage: diskRan ? 'disk' : structured.stage,
  };
}
