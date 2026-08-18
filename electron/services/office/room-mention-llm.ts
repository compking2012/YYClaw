import type { GatewayManager } from '../../gateway/manager';
import { sessionsSend } from './gateway-rpc';
import { unregisterOfficeInflightLlm } from './office-inflight-llm-registry';
import { mentionDispatchLog } from './mention-dispatch-log';
import {
  resolveMentionPickBestRaw,
  resolveMentionSalvageSessionRaw,
  waitForSmartMentionValidated,
} from './mention-run-settled';
import {
  buildRoomMentionRetryPrompt,
  isModelTransportError,
  validateRoomMentionStructuredReply,
  type RoomMentionValidationIssue,
  type RoomMentionValidationResult,
} from './room-mention-structured-reply';
import { validateSmartMentionReply } from './room-mention-smart-validation';
import { isNonSubstantiveMentionSessionReply } from './room-mention-reply-policy';
import {
  resolveMentionSessionAssistantReply,
  shouldArmSessionReplyTimeout,
  waitForSessionFreshUserTurn,
  waitForSessionReply,
} from './run-completion';
import type { OfficeTaskExecutionMode } from './types';
import { isSmartJsonShapeText } from '../../../src/lib/office-smart-json-schema';
import {
  buildSmartCoordinatorClosureConflictRetryPrompt,
  coordinatorDeclaresClosureConflictAction,
  isClosureConflictOnlyFailure,
} from '../../../src/lib/office-smart-retry-prompt';
import { shouldBlockOfficeLlmSend } from './office-llm-send-guard';

/** Stop mention LLM / format-retry when the project was user-aborted or is still quiescing. */
export function shouldStopRoomMentionLlmForProjectAbort(projectId?: string): boolean {
  return shouldBlockOfficeLlmSend(projectId);
}

export type RoomMentionLlmFetchResult =
  | {
      ok: true;
      roomText: string;
      raw: string;
      runId?: string;
      retried: boolean;
      /** 结项冲突第 2 轮坚持 end：已窄豁免 premature 闸门（发布/finalize 须同步识别）。 */
      forcedCoordinatorProjectEnd?: boolean;
    }
  | {
      ok: false;
      issues: RoomMentionValidationIssue[];
      detail: string;
      raw: string;
      transportReason: 'timeout' | 'error' | 'empty';
      retried: boolean;
    };

/**
 * 校验通过后返回机器侧原始 JSON（inputRaw）。
 * Smart 的 parsed.raw 为【】镜像（smartJsonToBracketText），不可用于派活/落盘 smartJsonRaw。
 */
export function resolveValidatedMentionJsonRaw(
  validation: RoomMentionValidationResult & { raw?: string },
): string {
  if (!validation.ok) return validation.raw?.trim() ?? '';
  const top = validation.raw?.trim() ?? '';
  if (top && isSmartJsonShapeText(top)) return top;
  const parsed = validation.parsed.raw?.trim() ?? '';
  if (parsed && isSmartJsonShapeText(parsed)) return parsed;
  return top || parsed;
}

type MentionValidationBase = Omit<
  Parameters<typeof validateRoomMentionStructuredReply>[0],
  'raw' | 'transportReason'
>;

export type SmartMentionDiskVerifyFn = (raw: string) => Promise<{
  ok: boolean;
  detail: string;
  inputValidationFailed?: boolean;
}>;

type FetchOnceParams = {
  roomKey: string;
  targetKey: string;
  targetAgentId: string;
  message: string;
  idempotencyKey: string;
  mentionTurnId: string;
  timeoutMs: number;
  startedAtMs: number;
  executionMode: OfficeTaskExecutionMode;
  validationBase: MentionValidationBase;
  verifySmartPathsOnDisk?: SmartMentionDiskVerifyFn;
  onModelActivity?: () => void | Promise<void>;
  /** 首轮 sessionsSend + 开轮成功后回调（不含格式 retry send）。 */
  onSessionSendOk?: () => void | Promise<void>;
  onSessionRunId?: (runId: string | undefined) => void;
  projectId?: string;
};

/** chat.send 后若 session 未开新 user turn，换 idempotency key 重试次数（不含首次）。 */
export const MENTION_SESSION_SEND_TURN_OPEN_RETRIES = 2;

type SessionSendTurnGateResult =
  | {
      ok: true;
      runId?: string;
      sendStartedAtMs: number;
      idempotencyKey: string;
      sendAttempts: number;
      /** chat.send 已开 run，但 history 未及时写入 user turn（Gateway 延迟） */
      turnGateRelaxed?: boolean;
    }
  | { ok: false; transportError: string; sendAttempts: number };

type FetchOnceResult = {
  raw: string;
  reason: 'timeout' | 'error' | 'empty';
  runId?: string;
  transportError?: string;
  smartValidation?: RoomMentionValidationResult & { raw: string };
};

export type FetchRoomMentionLlmReplyParams = MentionValidationBase & {
  roomKey: string;
  targetKey: string;
  targetAgentId: string;
  roleName: string;
  agentBody: string;
  idempotencyKey: string;
  retryIdempotencyKey: string;
  timeoutMs: number;
  verifySmartPathsOnDisk?: SmartMentionDiskVerifyFn;
  /** Smart：首轮 sessionsSend + 开轮成功后回调（成员 fast ack / 协调者 receipt ack；不含格式 retry）。 */
  onPrimarySessionSendOk?: () => void | Promise<void>;
  /** sessionsSend 开轮成功后回调（含 retry send；用于 session md runId 跟踪）。 */
  onSessionRunId?: (runId: string | undefined) => void;
};

function transportReasonForValidation(
  reason: FetchOnceResult['reason'],
  raw: string,
): 'timeout' | 'error' | 'empty' {
  if (raw.trim()) return 'empty';
  return reason;
}

function buildValidationBase(params: FetchRoomMentionLlmReplyParams): MentionValidationBase {
  return {
    executionMode: params.executionMode,
    isCoordinator: params.isCoordinator,
    needsDecomposition: params.needsDecomposition,
    allowCoordinatorSilentNoReply: params.allowCoordinatorSilentNoReply,
    requireMentionsInPublish: params.requireMentionsInPublish,
    coordinatorRole: params.coordinatorRole,
    smartMemberReadiness: params.smartMemberReadiness,
    promptVariant: params.promptVariant,
    triggerFromMemberAgent: params.triggerFromMemberAgent,
    coordinatorRoleId: params.coordinatorRoleId,
    smartNextExecutorRoleIds: params.smartNextExecutorRoleIds,
    smartNextExecutorRoleId: params.smartNextExecutorRoleId,
    teamRoles: params.teamRoles,
    smartAllowReporterFixRoleId: params.smartAllowReporterFixRoleId,
    smartAllowUpstreamProducerRoleId: params.smartAllowUpstreamProducerRoleId,
    viewerRoleId: params.viewerRoleId,
    taskId: params.taskId,
    smartWorkSteps: params.smartWorkSteps,
    roomMessages: params.roomMessages,
    memberReportRaw: params.memberReportRaw,
    reporterRoleId: params.reporterRoleId,
    smartInputValidationFailed: params.smartInputValidationFailed,
    actorRoleName: params.actorRoleName ?? params.roleName,
  };
}

async function runStructuredValidation(params: {
  raw: string;
  transportReason: 'timeout' | 'error' | 'empty';
  validationBase: MentionValidationBase;
  verifySmartPathsOnDisk?: SmartMentionDiskVerifyFn;
  forceCoordinatorProjectEnd?: boolean;
}): Promise<RoomMentionValidationResult & { raw: string }> {
  if (params.validationBase.executionMode === 'smart') {
    return validateSmartMentionReply({
      raw: params.raw,
      transportReason: params.transportReason,
      ...params.validationBase,
      verifyDisk: params.verifySmartPathsOnDisk,
      forceCoordinatorProjectEnd: params.forceCoordinatorProjectEnd,
    });
  }
  const validation = validateRoomMentionStructuredReply({
    raw: params.raw,
    transportReason: params.transportReason,
    ...params.validationBase,
  });
  return { ...validation, raw: params.raw };
}

async function sessionsSendForMention(
  gateway: GatewayManager,
  params: Omit<
    FetchOnceParams,
    'timeoutMs' | 'startedAtMs' | 'executionMode' | 'mentionTurnId' | 'validationBase' | 'verifySmartPathsOnDisk'
  > & { idempotencyKey: string },
): Promise<{ runId?: string; transportError?: string }> {
  try {
    const result = await sessionsSend(gateway, {
      sessionKey: params.roomKey,
      message: params.message,
      targetSessionKey: params.targetKey,
      targetAgentId: params.targetAgentId,
      idempotencyKey: params.idempotencyKey,
      projectId: params.projectId,
    });
    mentionDispatchLog('gateway-send-ok', {
      idempotencyKey: params.idempotencyKey,
      targetSession: params.targetKey,
      runId: result.runId,
    });
    return { runId: result.runId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    mentionDispatchLog('gateway-send-failed', {
      idempotencyKey: params.idempotencyKey,
      targetSession: params.targetKey,
      error: msg,
    });
    return {
      transportError: msg,
    };
  }
}

/** sessionsSend 必须伴随 session 中新 user turn；否则换 key 重试，避免「RPC ok 但未开 LLM 轮次」。 */
async function sessionsSendForMentionWithTurnGate(
  gateway: GatewayManager,
  params: Omit<
    FetchOnceParams,
    'timeoutMs' | 'startedAtMs' | 'executionMode' | 'mentionTurnId' | 'validationBase' | 'verifySmartPathsOnDisk'
  >,
): Promise<SessionSendTurnGateResult> {
  const maxAttempts = 1 + MENTION_SESSION_SEND_TURN_OPEN_RETRIES;
  let lastTransportError = 'session user turn not opened after chat.send';
  const firstSendStartedAtMs = Date.now();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const idempotencyKey =
      attempt === 0 ? params.idempotencyKey : `${params.idempotencyKey}:turn-open-${attempt}`;
    const sendStartedAtMs = Date.now();

    mentionDispatchLog('turn-gate-attempt', {
      attempt: attempt + 1,
      maxAttempts,
      idempotencyKey,
      targetSession: params.targetKey,
      sendStartedAtMs,
      firstSendStartedAtMs,
    });

    const sent = await sessionsSendForMention(gateway, {
      roomKey: params.roomKey,
      targetKey: params.targetKey,
      targetAgentId: params.targetAgentId,
      message: params.message,
      idempotencyKey,
    });

    if (sent.transportError) {
      lastTransportError = sent.transportError;
      mentionDispatchLog('turn-gate-send-transport-error', {
        attempt: attempt + 1,
        maxAttempts,
        idempotencyKey,
        targetSession: params.targetKey,
        error: sent.transportError,
      });
      continue;
    }

    const turnOpened = await waitForSessionFreshUserTurn(
      gateway,
      params.targetKey,
      sendStartedAtMs,
      {
        expectedMessage: params.message,
        earliestAcceptedUserTurnAtMs: firstSendStartedAtMs,
      },
    );

    if (turnOpened.opened) {
      const acceptedStartedAtMs =
        turnOpened.userTurnTs && turnOpened.userTurnTs > 0
          ? Math.max(firstSendStartedAtMs, turnOpened.userTurnTs - 1)
          : firstSendStartedAtMs;
      mentionDispatchLog(attempt > 0 ? 'turn-gate-opened-after-retry' : 'turn-gate-opened', {
        attempt: attempt + 1,
        maxAttempts,
        idempotencyKey,
        targetSession: params.targetKey,
        runId: sent.runId,
        sendStartedAtMs,
        acceptedStartedAtMs,
        acceptedBy: turnOpened.acceptedBy,
        userTurnTs: turnOpened.userTurnTs,
        elapsedMs: Date.now() - sendStartedAtMs,
      });
      return {
        ok: true,
        runId: sent.runId,
        sendStartedAtMs: acceptedStartedAtMs,
        idempotencyKey,
        sendAttempts: attempt + 1,
      };
    }

    if (sent.runId) {
      mentionDispatchLog('turn-gate-proceed-after-send', {
        attempt: attempt + 1,
        maxAttempts,
        idempotencyKey,
        targetSession: params.targetKey,
        runId: sent.runId,
        sendStartedAtMs: firstSendStartedAtMs,
        elapsedMs: Date.now() - sendStartedAtMs,
      });
      return {
        ok: true,
        runId: sent.runId,
        sendStartedAtMs: firstSendStartedAtMs,
        idempotencyKey,
        sendAttempts: attempt + 1,
        turnGateRelaxed: true,
      };
    }

    lastTransportError = 'chat.send 成功但 session 未出现新的 user turn';
    mentionDispatchLog('turn-gate-not-opened', {
      attempt: attempt + 1,
      maxAttempts,
      idempotencyKey,
      targetSession: params.targetKey,
      runId: sent.runId,
      sendStartedAtMs,
      elapsedMs: Date.now() - sendStartedAtMs,
      willRetry: attempt + 1 < maxAttempts,
    });
  }

  mentionDispatchLog('turn-gate-failed', {
    maxAttempts,
    idempotencyKey: params.idempotencyKey,
    targetSession: params.targetKey,
    error: lastTransportError,
  });

  return {
    ok: false,
    transportError: lastTransportError,
    sendAttempts: maxAttempts,
  };
}

/** Workflow / 非 Smart：沿用 waitForSessionReply + history 合并。 */
async function fetchOnceWithSessionWait(
  gateway: GatewayManager,
  params: FetchOnceParams,
  runId?: string,
): Promise<FetchOnceResult> {
  const waitOpts = {
    sessionKey: params.targetKey,
    startedAtMs: params.startedAtMs,
    timeoutMs: params.timeoutMs,
    runId,
    allowUndatedFallback: false,
    requireFreshUserTurn: true,
  } as const;

  let initial: Awaited<ReturnType<typeof waitForSessionReply>>;
  try {
    initial = await waitForSessionReply(gateway, waitOpts);
  } catch (e) {
    mentionDispatchLog('smart-fetch-wait-error', {
      targetSession: params.targetKey,
      runId,
      idempotencyKey: params.idempotencyKey,
      elapsedMs: Date.now() - params.startedAtMs,
      error: e instanceof Error ? e.message : String(e),
    });
    return {
      raw: '',
      reason: 'error',
      runId,
      transportError: e instanceof Error ? e.message : String(e),
    };
  } finally {
    const projectId = params.projectId?.trim();
    const sessionKey = params.targetKey?.trim();
    if (projectId && sessionKey) {
      unregisterOfficeInflightLlm(projectId, sessionKey);
    }
  }

  const historyFinal = await resolveMentionSessionAssistantReply(
    gateway,
    params.targetKey,
    params.startedAtMs,
    { requireFreshUserTurn: true },
  );
  const initialRaw = initial.completed ? initial.assistantText?.trim() || '' : '';
  const historyRaw = historyFinal?.trim() || '';
  const structuredMark = /【\s*群聊回复\s*】/u;
  let raw: string;
  if (structuredMark.test(historyRaw)) raw = historyRaw;
  else if (structuredMark.test(initialRaw)) raw = initialRaw;
  else raw = historyRaw || initialRaw;
  if (
    waitOpts.requireFreshUserTurn
    && !initial.completed
    && shouldArmSessionReplyTimeout(params.timeoutMs)
  ) {
    raw = '';
  }
  if (isNonSubstantiveMentionSessionReply(raw)) {
    raw = '';
  }

  return {
    raw,
    reason: initial.timedOut ? 'timeout' : initial.error ? 'error' : 'empty',
    runId,
  };
}

/** Smart：监听本轮 session，按分支做结构化校验（见 mention-run-settled.ts）。 */
async function fetchOnceSmartValidated(
  gateway: GatewayManager,
  params: FetchOnceParams,
  runId?: string,
): Promise<FetchOnceResult> {
  try {
    const transportReason: FetchOnceResult['reason'] = 'empty';
    const validate = async (candidateRaw: string) => {
      const raw =
        (await resolveMentionPickBestRaw(gateway, params.targetKey, params.startedAtMs, undefined, [
          candidateRaw,
        ])) || candidateRaw.trim();
      return runStructuredValidation({
        raw,
        transportReason: transportReasonForValidation(transportReason, raw),
        validationBase: params.validationBase,
        verifySmartPathsOnDisk: params.verifySmartPathsOnDisk,
      });
    };

    const outcome = await waitForSmartMentionValidated(gateway, {
      sessionKey: params.targetKey,
      startedAtMs: params.startedAtMs,
      mentionTurnId: params.mentionTurnId,
      timeoutMs: params.timeoutMs,
      runId,
      validate,
      onModelActivity: params.onModelActivity,
    });

    return {
      raw: outcome.validation.raw,
      reason: outcome.timedOut && !outcome.validation.raw.trim() ? 'timeout' : 'empty',
      runId,
      transportError: outcome.error,
      smartValidation: outcome.validation,
    };
  } catch (e) {
    return {
      raw: '',
      reason: 'error',
      runId,
      transportError: e instanceof Error ? e.message : String(e),
    };
  } finally {
    const projectId = params.projectId?.trim();
    const sessionKey = params.targetKey?.trim();
    if (projectId && sessionKey) {
      unregisterOfficeInflightLlm(projectId, sessionKey);
    }
  }
}

async function fetchOnce(
  gateway: GatewayManager,
  params: FetchOnceParams,
): Promise<FetchOnceResult> {
  const sent = await sessionsSendForMentionWithTurnGate(gateway, params);
  if (!sent.ok) {
    mentionDispatchLog('fetch-once-turn-gate-failed', {
      targetSession: params.targetKey,
      idempotencyKey: params.idempotencyKey,
      sendAttempts: sent.sendAttempts,
      error: sent.transportError,
    });
    return {
      raw: '',
      reason: 'error',
      transportError: sent.transportError,
    };
  }

  params.onSessionRunId?.(sent.runId);

  if (params.onSessionSendOk) {
    try {
      await Promise.resolve(params.onSessionSendOk());
    } catch (e) {
      mentionDispatchLog('session-send-ok-callback-failed', {
        targetSession: params.targetKey,
        idempotencyKey: params.idempotencyKey,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const waitParams: FetchOnceParams = {
    ...params,
    startedAtMs: sent.sendStartedAtMs,
  };

  const smartFetchParams = {
    ...waitParams,
    onModelActivity: params.onModelActivity,
  };

  if (params.executionMode === 'smart') {
    return fetchOnceSmartValidated(gateway, smartFetchParams, sent.runId);
  }
  return fetchOnceWithSessionWait(gateway, waitParams, sent.runId);
}

function resolveValidationAfterFetch(
  executionMode: OfficeTaskExecutionMode,
  validationBase: MentionValidationBase,
  fetchResult: FetchOnceResult,
  verifySmartPathsOnDisk?: SmartMentionDiskVerifyFn,
): Promise<RoomMentionValidationResult & { raw: string }> | (RoomMentionValidationResult & { raw: string }) {
  if (executionMode === 'smart' && fetchResult.smartValidation) {
    return fetchResult.smartValidation;
  }

  const raw = fetchResult.raw.trim();
  return runStructuredValidation({
    raw,
    transportReason: transportReasonForValidation(fetchResult.reason, raw),
    validationBase,
    verifySmartPathsOnDisk,
  });
}

/**
 * Smart 协调者结项冲突专用 2 轮分支（A/A1/B1/C1）：
 * 第 1 轮仅 premature → 结项冲突 Prompt；第 2 轮仍坚持则窄豁免 premature 再验。
 * 返回 null 表示不进入此分支，由调用方走通用 3 轮格式重试。
 */
async function trySmartCoordinatorClosureConflictResolution(
  gateway: GatewayManager,
  params: FetchRoomMentionLlmReplyParams,
  ctx: {
    firstFetch: FetchOnceResult;
    firstValidation: Extract<RoomMentionValidationResult, { ok: false }> & { raw: string };
    priorRaw: string;
    fetchParams: {
      roomKey: string;
      targetKey: string;
      targetAgentId: string;
      executionMode: OfficeTaskExecutionMode;
      validationBase: MentionValidationBase;
      verifySmartPathsOnDisk?: SmartMentionDiskVerifyFn;
      onSessionRunId?: (runId: string | undefined) => void;
    };
    validationBase: MentionValidationBase;
    verifySmartPathsOnDisk?: SmartMentionDiskVerifyFn;
  },
): Promise<RoomMentionLlmFetchResult | null> {
  if (
    params.executionMode !== 'smart'
    || !params.isCoordinator
    || !isClosureConflictOnlyFailure({
      isCoordinator: true,
      raw: ctx.firstValidation.raw || ctx.firstFetch.raw,
      issues: ctx.firstValidation.issues,
    })
  ) {
    return null;
  }

  const abortProjectId = params.taskId?.trim() || params.projectId?.trim();
  if (shouldStopRoomMentionLlmForProjectAbort(abortProjectId)) {
    return {
      ok: false,
      issues: ['transport_error'],
      detail: '项目已中止，已停止模型调用',
      raw: ctx.firstValidation.raw || ctx.firstFetch.raw || '',
      transportReason: 'error',
      retried: false,
    };
  }

  mentionDispatchLog('smart-coordinator-closure-conflict-enter', {
    targetSession: params.targetKey,
    idempotencyKey: params.idempotencyKey,
    phase: 'review',
  });

  const conflictRetryStartedAt = Date.now();
  const conflictBody = buildSmartCoordinatorClosureConflictRetryPrompt({
    roleName: params.roleName,
    priorRaw: ctx.priorRaw,
    baseAgentPrompt: params.agentBody,
  });

  if (shouldStopRoomMentionLlmForProjectAbort(abortProjectId)) {
    return {
      ok: false,
      issues: ['transport_error'],
      detail: '项目已中止，已停止模型调用',
      raw: ctx.firstValidation.raw || ctx.firstFetch.raw || '',
      transportReason: 'error',
      retried: false,
    };
  }

  const conflictFetch = await fetchOnce(gateway, {
    ...ctx.fetchParams,
    message: conflictBody,
    idempotencyKey: `${params.retryIdempotencyKey}-closure-conflict`,
    mentionTurnId: `${params.retryIdempotencyKey}-closure-conflict`,
    timeoutMs: params.timeoutMs,
    startedAtMs: conflictRetryStartedAt,
    onSessionRunId: params.onSessionRunId,
  });

  const conflictValidation = await Promise.resolve(
    resolveValidationAfterFetch(
      params.executionMode,
      ctx.validationBase,
      conflictFetch,
      params.verifySmartPathsOnDisk,
    ),
  );

  if (conflictValidation.ok) {
    mentionDispatchLog('smart-coordinator-closure-conflict-resolved', {
      targetSession: params.targetKey,
      phase: 'review',
      outcome: 'pass',
    });
    return {
      ok: true,
      roomText: conflictValidation.roomText,
      raw: resolveValidatedMentionJsonRaw(conflictValidation),
      runId: conflictFetch.runId,
      retried: true,
    };
  }

  const conflictFailed = conflictValidation as Extract<RoomMentionValidationResult, { ok: false }> & {
    raw: string;
  };
  const conflictRaw = conflictFailed.raw || conflictFetch.raw;
  const conflictIssues = conflictFailed.issues;

  if (
    isClosureConflictOnlyFailure({
      isCoordinator: true,
      raw: conflictRaw,
      issues: conflictIssues,
    })
  ) {
    mentionDispatchLog('smart-coordinator-forced-closure-attempt', {
      targetSession: params.targetKey,
      phase: 'force',
      runId: conflictFetch.runId,
    });

    const forcedValidation = await runStructuredValidation({
      raw: conflictRaw,
      transportReason: 'empty',
      validationBase: ctx.validationBase,
      verifySmartPathsOnDisk: params.verifySmartPathsOnDisk,
      forceCoordinatorProjectEnd: true,
    });

    if (forcedValidation.ok) {
      mentionDispatchLog('smart-coordinator-forced-closure', {
        targetSession: params.targetKey,
        phase: 'force',
        outcome: 'accepted',
        runId: conflictFetch.runId,
      });
      return {
        ok: true,
        roomText: forcedValidation.roomText,
        raw: resolveValidatedMentionJsonRaw(forcedValidation),
        runId: conflictFetch.runId,
        retried: true,
        forcedCoordinatorProjectEnd: true,
      };
    }

    return {
      ok: false,
      issues: forcedValidation.issues,
      detail: `结项冲突强制结项后校验仍失败：${forcedValidation.detail}`,
      raw: forcedValidation.raw,
      transportReason: isModelTransportError(conflictFetch.reason)
        ? conflictFetch.reason
        : 'empty',
      retried: true,
    };
  }

  if (!coordinatorDeclaresClosureConflictAction(conflictRaw)) {
    mentionDispatchLog('smart-coordinator-closure-conflict-escalate-format-retry', {
      targetSession: params.targetKey,
      phase: 'review',
      issues: conflictIssues.join(','),
    });
    return null;
  }

  mentionDispatchLog('smart-coordinator-closure-conflict-resolved', {
    targetSession: params.targetKey,
    phase: 'review',
    outcome: 'fail',
    issues: conflictIssues.join(','),
  });

  return {
    ok: false,
    issues: conflictIssues,
    detail: `结项冲突复核后：${conflictFailed.detail}`,
    raw: conflictFailed.raw || ctx.firstValidation.raw,
    transportReason: isModelTransportError(conflictFetch.reason)
      ? conflictFetch.reason
      : 'empty',
    retried: true,
  };
}

/** 群聊点名：首次 LLM → 结构化校验 → 不合格则带原文最多重试 2 次 → 仍失败则如实返回。 */
export async function fetchRoomMentionLlmReplyWithRetry(
  gateway: GatewayManager,
  params: FetchRoomMentionLlmReplyParams,
): Promise<RoomMentionLlmFetchResult> {
  const startedAt = Date.now();
  const mentionTurnId = params.idempotencyKey;
  const validationBase = buildValidationBase(params);
  const verifySmartPathsOnDisk = params.verifySmartPathsOnDisk;
  const projectId = params.taskId?.trim() || params.projectId?.trim();

  if (shouldStopRoomMentionLlmForProjectAbort(projectId)) {
    mentionDispatchLog('session-aborted-before-fetch', {
      targetSession: params.targetKey,
      idempotencyKey: params.idempotencyKey,
      projectId,
    });
    return {
      ok: false,
      issues: ['transport_error'],
      detail: '项目已中止，已停止模型调用',
      raw: '',
      transportReason: 'error',
      retried: false,
    };
  }

  const fetchParams = {
    roomKey: params.roomKey,
    targetKey: params.targetKey,
    targetAgentId: params.targetAgentId,
    executionMode: params.executionMode,
    validationBase,
    verifySmartPathsOnDisk,
    projectId: params.taskId,
  } as const;

  const firstFetch = await fetchOnce(gateway, {
    ...fetchParams,
    message: params.agentBody,
    idempotencyKey: params.idempotencyKey,
    mentionTurnId,
    timeoutMs: params.timeoutMs,
    startedAtMs: startedAt,
    onSessionSendOk: params.onPrimarySessionSendOk,
    onSessionRunId: params.onSessionRunId,
  });

  if (shouldStopRoomMentionLlmForProjectAbort(projectId)) {
    mentionDispatchLog('session-aborted-after-fetch', {
      targetSession: params.targetKey,
      idempotencyKey: params.idempotencyKey,
      projectId,
      runId: firstFetch.runId,
    });
    if (projectId && firstFetch.runId) {
      unregisterOfficeInflightLlm(projectId, params.targetKey);
    }
    return {
      ok: false,
      issues: ['transport_error'],
      detail: '项目已中止，已停止模型调用',
      raw: firstFetch.raw || '',
      transportReason: 'error',
      retried: false,
    };
  }

  const firstValidation = await Promise.resolve(
    resolveValidationAfterFetch(
      params.executionMode,
      validationBase,
      firstFetch,
      verifySmartPathsOnDisk,
    ),
  );

  if (firstValidation.ok) {
    return {
      ok: true,
      roomText: firstValidation.roomText,
      raw: resolveValidatedMentionJsonRaw(firstValidation),
      runId: firstFetch.runId,
      retried: false,
    };
  }

  if (shouldStopRoomMentionLlmForProjectAbort(projectId)) {
    return {
      ok: false,
      issues: firstValidation.issues.length > 0 ? firstValidation.issues : ['transport_error'],
      detail: '项目已中止，已停止模型调用',
      raw: firstValidation.raw || firstFetch.raw || '',
      transportReason: 'error',
      retried: false,
    };
  }

  if (isModelTransportError(firstFetch.reason) && !firstValidation.raw.trim()) {
    mentionDispatchLog('session-transport-validation-fail', {
      targetSession: params.targetKey,
      idempotencyKey: params.idempotencyKey,
      runId: firstFetch.runId,
      reason: firstFetch.reason,
      issues: firstValidation.issues.join(','),
      detail: firstValidation.detail,
    });
    const sessionRaw = await resolveMentionSalvageSessionRaw(
      gateway,
      params.targetKey,
      startedAt,
      [firstFetch.raw, firstFetch.transportError],
    );
    let sessionValidation: (RoomMentionValidationResult & { raw: string }) | null = null;
    if (sessionRaw.trim()) {
      mentionDispatchLog('session-transport-salvage-raw', {
        targetSession: params.targetKey,
        idempotencyKey: params.idempotencyKey,
        runId: firstFetch.runId,
        rawLen: sessionRaw.length,
      });
      sessionValidation = await runStructuredValidation({
        raw: sessionRaw,
        transportReason: 'empty',
        validationBase,
        verifySmartPathsOnDisk,
      });
      if (sessionValidation.ok) {
        mentionDispatchLog('session-transport-salvage-ok', {
          targetSession: params.targetKey,
          idempotencyKey: params.idempotencyKey,
          runId: firstFetch.runId,
        });
        return {
          ok: true,
          roomText: sessionValidation.roomText,
          raw: resolveValidatedMentionJsonRaw(sessionValidation),
          runId: firstFetch.runId,
          retried: false,
        };
      }
      mentionDispatchLog('session-transport-salvage-fail', {
        targetSession: params.targetKey,
        idempotencyKey: params.idempotencyKey,
        runId: firstFetch.runId,
        issues: sessionValidation.issues.join(','),
        detail: sessionValidation.detail,
      });
    }
    const failFromSession = sessionValidation && sessionRaw.trim();
    return {
      ok: false,
      issues: failFromSession ? sessionValidation!.issues : firstValidation.issues,
      detail: failFromSession ? sessionValidation!.detail : firstValidation.detail,
      raw: failFromSession ? sessionRaw : firstValidation.raw,
      transportReason: firstFetch.reason,
      retried: false,
    };
  }

  const priorRaw =
    params.executionMode === 'smart'
      ? firstValidation.raw ||
        (await resolveMentionPickBestRaw(gateway, params.targetKey, startedAt, undefined, [
          firstFetch.raw,
          firstFetch.transportError,
        ])) ||
        firstFetch.transportError ||
        ''
      : firstValidation.raw || firstFetch.transportError || firstFetch.raw || '';

  const closureConflictResult = await trySmartCoordinatorClosureConflictResolution(
    gateway,
    params,
    {
      firstFetch,
      firstValidation: { ...firstValidation, raw: firstValidation.raw } as Extract<
        RoomMentionValidationResult,
        { ok: false }
      > & { raw: string },
      priorRaw,
      fetchParams: {
        ...fetchParams,
        onSessionRunId: params.onSessionRunId,
      },
      validationBase,
      verifySmartPathsOnDisk,
    },
  );
  if (closureConflictResult) {
    return closureConflictResult;
  }

  if (shouldStopRoomMentionLlmForProjectAbort(projectId)) {
    return {
      ok: false,
      issues: firstValidation.issues,
      detail: '项目已中止，已停止模型调用',
      raw: priorRaw || firstValidation.raw || firstFetch.raw || '',
      transportReason: 'error',
      retried: false,
    };
  }

  const retryStartedAt = Date.now();
  const retryBody = buildRoomMentionRetryPrompt({
    roleName: params.roleName,
    priorRaw,
    executionMode: params.executionMode,
    isCoordinator: params.isCoordinator,
    transportReason: isModelTransportError(firstFetch.reason) ? firstFetch.reason : undefined,
    validationDetail: firstValidation.detail,
    issues: firstValidation.issues,
    smartMemberReadiness: params.smartMemberReadiness,
    baseAgentPrompt: params.executionMode === 'smart' ? params.agentBody : undefined,
  });

  const secondFetch = await fetchOnce(gateway, {
    ...fetchParams,
    message: retryBody,
    idempotencyKey: params.retryIdempotencyKey,
    mentionTurnId: params.retryIdempotencyKey,
    timeoutMs: params.timeoutMs,
    startedAtMs: retryStartedAt,
  });

  if (shouldStopRoomMentionLlmForProjectAbort(projectId)) {
    return {
      ok: false,
      issues: firstValidation.issues,
      detail: '项目已中止，已停止模型调用',
      raw: secondFetch.raw || priorRaw || '',
      transportReason: 'error',
      retried: true,
    };
  }

  const secondValidation = await Promise.resolve(
    resolveValidationAfterFetch(
      params.executionMode,
      validationBase,
      secondFetch,
      verifySmartPathsOnDisk,
    ),
  );

  if (secondValidation.ok) {
    return {
      ok: true,
      roomText: secondValidation.roomText,
      raw: resolveValidatedMentionJsonRaw(secondValidation),
      runId: secondFetch.runId,
      retried: true,
    };
  }

  if (shouldStopRoomMentionLlmForProjectAbort(projectId)) {
    return {
      ok: false,
      issues: secondValidation.issues,
      detail: '项目已中止，已停止模型调用',
      raw: secondValidation.raw || secondFetch.raw || priorRaw || '',
      transportReason: 'error',
      retried: true,
    };
  }

  const retry2PriorRaw =
    params.executionMode === 'smart'
      ? secondValidation.raw ||
        (await resolveMentionPickBestRaw(gateway, params.targetKey, retryStartedAt, undefined, [
          secondFetch.raw,
          secondFetch.transportError,
        ])) ||
        secondFetch.transportError ||
        priorRaw
      : secondValidation.raw || secondFetch.transportError || secondFetch.raw || priorRaw;

  if (shouldStopRoomMentionLlmForProjectAbort(projectId)) {
    return {
      ok: false,
      issues: secondValidation.issues,
      detail: '项目已中止，已停止模型调用',
      raw: retry2PriorRaw || '',
      transportReason: 'error',
      retried: true,
    };
  }

  const retry2StartedAt = Date.now();
  const retry2Body = buildRoomMentionRetryPrompt({
    roleName: params.roleName,
    priorRaw: retry2PriorRaw,
    executionMode: params.executionMode,
    isCoordinator: params.isCoordinator,
    transportReason: isModelTransportError(secondFetch.reason) ? secondFetch.reason : undefined,
    validationDetail: secondValidation.detail,
    issues: secondValidation.issues,
    smartMemberReadiness: params.smartMemberReadiness,
    baseAgentPrompt: params.executionMode === 'smart' ? params.agentBody : undefined,
  });

  const thirdFetch = await fetchOnce(gateway, {
    ...fetchParams,
    message: retry2Body,
    idempotencyKey: `${params.retryIdempotencyKey}:2`,
    mentionTurnId: `${params.retryIdempotencyKey}:2`,
    timeoutMs: params.timeoutMs,
    startedAtMs: retry2StartedAt,
  });

  const thirdValidation = await Promise.resolve(
    resolveValidationAfterFetch(
      params.executionMode,
      validationBase,
      thirdFetch,
      verifySmartPathsOnDisk,
    ),
  );

  if (thirdValidation.ok) {
    return {
      ok: true,
      roomText: thirdValidation.roomText,
      raw: resolveValidatedMentionJsonRaw(thirdValidation),
      runId: thirdFetch.runId,
      retried: true,
    };
  }

  const detail = [
    firstValidation.detail,
    `第1次重试后：${secondValidation.detail}`,
    `第2次重试后：${thirdValidation.detail}`,
  ]
    .filter(Boolean)
    .join('；');

  return {
    ok: false,
    issues: [...new Set([...firstValidation.issues, ...secondValidation.issues, ...thirdValidation.issues])],
    detail,
    raw: thirdValidation.raw || secondValidation.raw || firstValidation.raw,
    transportReason: isModelTransportError(thirdFetch.reason)
      ? thirdFetch.reason
      : isModelTransportError(secondFetch.reason)
        ? secondFetch.reason
        : isModelTransportError(firstFetch.reason)
          ? firstFetch.reason
          : 'empty',
    retried: true,
  };
}
