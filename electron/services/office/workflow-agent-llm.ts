import type { GatewayManager } from '../../gateway/manager';
import type { WorkflowHandoffTarget } from '../../../src/lib/office-workflow-handoff';
import type { ProjectAgentRef } from '../../../src/lib/office-workflow-node';
import { callAgentMessage, fetchGatewaySessionListRow } from './gateway-rpc';
import { unregisterOfficeInflightLlm } from './office-inflight-llm-registry';
import { fetchLatestWorkflowStructuredSessionReply, findLatestWorkflowReplyRaw, waitForSessionReply } from './run-completion';
import { enrichMessagesForRoomMirror } from '../../../src/lib/office-session-attachments';
import {
  appendGatewayTerminalErrorDetail,
  type GatewayRunTerminalErrorKind,
} from './gateway-run-error';
import { fetchWorkflowSettleChatHistory } from './office-session-transcript';
import {
  captureOfficeSettleBaseline,
  createOfficeRunTracker,
  fetchStableSessionReplyText,
  isOfficeRunProtocolDischarged,
  OfficeRuntimeToolTracker,
  reconcileOfficeRunSessionIdle,
  tryReconcileOfficeRunFromWorkflowHistory,
  verifyOfficeSessionAllowsSuccessSettle,
} from './session-run-settle';
import {
  isGatewayInterruptTransportError,
  waitForGatewayOfficeReady,
} from './gateway-office-resume';
import { resolveWorkflowSettleRunId } from '@/lib/office-workflow-dispatch-run';
import {
  buildOfficeSettleTrackerKey,
  getOrCreateOfficeSettleTracker,
  peekOfficeSettleTracker,
} from './office-settle-tracker-registry';
import {
  buildWorkflowAgentRetryPrompt,
  isModelTransportError,
  parseStructuredAgentReply,
  validateWorkflowAgentStructuredReply,
  type ParsedAgentTaskReply,
  type WorkflowAgentValidationIssue,
} from './workflow-agent-reply';
import {
  classifyWorkflowPostWaitFailure,
  normalizeRuntimePostWaitFailureIssues,
} from '@/lib/office-workflow-post-wait-failure';
import { shouldBlockOfficeLlmSend, OfficeLlmSendAbortedError } from './office-llm-send-guard';
function isFilenameOnlyWorkflowValidationFailure(
  result: Extract<
    Awaited<ReturnType<typeof validateWorkflowAgentStructuredReply>>,
    { ok: false }
  >,
): boolean {
  return (
    result.issues.length === 1
    && result.issues[0] === 'deliverable_filename_missing_role_suffix'
  );
}

export type WorkflowAgentLlmResult =
  | { ok: true; parsed: ParsedAgentTaskReply; raw: string; runId?: string; retried: boolean }
  | {
      ok: false;
      issues: WorkflowAgentValidationIssue[];
      detail: string;
      raw: string;
      transportReason: 'timeout' | 'error' | 'empty';
      retried: boolean;
    };

type WorkflowRunOnceParams = {
  sessionKey: string;
  message: string;
  idempotencyKey: string;
  agentId: string;
  nodeExecution: 'serial' | 'subagent';
  taskName?: string;
  timeoutMs: number;
  startedAtMs: number;
  signal?: AbortSignal;
  onPartialReply?: (text: string) => void;
  onRunId?: (runId: string | undefined) => void;
  settleRunId?: string;
  shouldAbortWait?: () => boolean;
  /** Anchor for settle tracker registry (defaults to startedAtMs). */
  settleTrackerStartedAtMs?: number;
  projectId?: string;
};

/** Shared runOnce params for all workflow LLM attempts (including retries). */
function buildWorkflowRunOnceParams(
  params: {
    sessionKey: string;
    agentId: string;
    nodeExecution: 'serial' | 'subagent';
    taskName?: string;
    timeoutMs: number;
    signal?: AbortSignal;
    onPartialReply?: (text: string) => void;
    onRunId?: (runId: string | undefined) => void;
    settleRunId?: string;
    shouldAbortWait?: () => boolean;
    settleTrackerStartedAtMs?: number;
    projectId?: string;
  },
  attempt: { message: string; idempotencyKey: string; startedAtMs: number },
): WorkflowRunOnceParams {
  return {
    sessionKey: params.sessionKey,
    message: attempt.message,
    idempotencyKey: attempt.idempotencyKey,
    agentId: params.agentId,
    nodeExecution: params.nodeExecution,
    taskName: params.taskName,
    timeoutMs: params.timeoutMs,
    startedAtMs: attempt.startedAtMs,
    signal: params.signal,
    onPartialReply: params.onPartialReply,
    onRunId: params.onRunId,
    settleRunId: params.settleRunId,
    shouldAbortWait: params.shouldAbortWait,
    settleTrackerStartedAtMs: params.settleTrackerStartedAtMs,
    projectId: params.projectId,
  };
}

async function runOnce(
  gateway: GatewayManager,
  params: WorkflowRunOnceParams,
): Promise<{
  raw: string;
  reason: 'timeout' | 'error' | 'empty';
  runId?: string;
  transportError?: string;
  terminalErrorEnded?: boolean;
  terminalError?: string;
  gatewayTerminalErrorKind?: GatewayRunTerminalErrorKind;
  peerClaimed?: boolean;
}> {
  if (params.signal?.aborted || shouldBlockOfficeLlmSend(params.projectId)) {
    return {
      raw: '',
      reason: 'error',
      transportError: 'aborted',
    };
  }
  let runId: string | undefined;
  try {
    const result = await callAgentMessage(
      gateway,
      params.sessionKey,
      params.message,
      params.idempotencyKey,
      { agentId: params.agentId, projectId: params.projectId },
    );
    runId = result.runId;
    params.onRunId?.(runId);
  } catch (e) {
    if (e instanceof OfficeLlmSendAbortedError) {
      return {
        raw: '',
        reason: 'error',
        transportError: 'aborted',
      };
    }
    const message = e instanceof Error ? e.message : String(e);
    // Do not gateway-ready-retry after user abort / quiesce — that would re-send.
    if (
      isGatewayInterruptTransportError(message)
      && !params.signal?.aborted
      && !shouldBlockOfficeLlmSend(params.projectId)
    ) {
      const ready = await waitForGatewayOfficeReady(gateway, params.signal, params.timeoutMs);
      if (ready) {
        if (params.signal?.aborted || shouldBlockOfficeLlmSend(params.projectId)) {
          return {
            raw: '',
            reason: 'error',
            transportError: 'aborted',
          };
        }
        try {
          const retry = await callAgentMessage(
            gateway,
            params.sessionKey,
            params.message,
            `${params.idempotencyKey}-gw-ready`,
            { agentId: params.agentId, projectId: params.projectId },
          );
          runId = retry.runId;
          params.onRunId?.(runId);
        } catch (retryErr) {
          if (retryErr instanceof OfficeLlmSendAbortedError) {
            return {
              raw: '',
              reason: 'error',
              transportError: 'aborted',
            };
          }
          return {
            raw: '',
            reason: 'error',
            transportError: retryErr instanceof Error ? retryErr.message : String(retryErr),
          };
        }
      } else {
        return {
          raw: '',
          reason: 'error',
          transportError: message,
        };
      }
    } else {
      return {
        raw: '',
        reason: 'error',
        transportError: message,
      };
    }
  }

  let waitResult: Awaited<ReturnType<typeof waitForSessionReply>>;
  const settleRunId = resolveWorkflowSettleRunId(runId, params.settleRunId);
  const trackerAnchorMs = params.settleTrackerStartedAtMs ?? params.startedAtMs;
  const settleTrackerKey = settleRunId
    ? buildOfficeSettleTrackerKey(params.sessionKey, settleRunId, trackerAnchorMs)
    : undefined;
  try {
    waitResult = await waitForSessionReply(gateway, {
      sessionKey: params.sessionKey,
      startedAtMs: params.startedAtMs,
      timeoutMs: params.timeoutMs,
      runId: settleRunId,
      allowUndatedFallback: true,
      requireWorkflowStructuredReply: true,
      requireFreshUserTurn: true,
      signal: params.signal,
      onPartialReply: params.onPartialReply,
      shouldAbortWait: params.shouldAbortWait,
      settleTrackerKey,
    });
  } catch (e) {
    return {
      raw: '',
      reason: 'error',
      runId: settleRunId ?? runId,
      transportError: e instanceof Error ? e.message : String(e),
    };
  } finally {
    const projectId = params.projectId?.trim();
    const sessionKey = params.sessionKey?.trim();
    if (projectId && sessionKey) {
      unregisterOfficeInflightLlm(projectId, sessionKey);
    }
  }

  if (waitResult.peerClaimed) {
    return {
      raw: '',
      reason: 'empty',
      runId: settleRunId ?? runId,
      peerClaimed: true,
    };
  }

  // Belt: abort from room_heal may still surface as error:'aborted' on older paths.
  if (waitResult.error === 'aborted' && params.shouldAbortWait?.()) {
    return {
      raw: '',
      reason: 'empty',
      runId: settleRunId ?? runId,
      peerClaimed: true,
    };
  }

  const reason = waitResult.timedOut ? 'timeout' : waitResult.error ? 'error' : 'empty';
  const raw = waitResult.completed ? (waitResult.assistantText ?? '').trim() : '';
  // Soft wait failures (completed:false + error, no terminalErrorEnded) previously left
  // transportError unset → bare「调用异常」. Fold waitResult.error into transportError so
  // validateWorkflowAttemptAfterWait can enrich the same way as call/wait throws.
  const softWaitError =
    !waitResult.terminalErrorEnded
    && !waitResult.terminalError?.trim()
    && typeof waitResult.error === 'string'
    && waitResult.error.trim()
      ? waitResult.error.trim()
      : undefined;
  return {
    raw,
    reason,
    runId: settleRunId ?? runId,
    terminalErrorEnded: waitResult.terminalErrorEnded,
    terminalError: waitResult.terminalError,
    gatewayTerminalErrorKind: waitResult.gatewayTerminalErrorKind,
    transportError: softWaitError,
  };
}

type WorkflowValidationFailure = Extract<
  Awaited<ReturnType<typeof validateWorkflowAgentStructuredReply>>,
  { ok: false }
>;

type ValidateWithDiskFn = (
  raw: string,
  reason: 'timeout' | 'error' | 'empty',
) => Promise<Awaited<ReturnType<typeof validateWorkflowAgentStructuredReply>>>;

function enrichWorkflowValidationFailure<
  T extends { ok: false; detail: string },
>(validation: T, terminalError?: string): T {
  if (!terminalError?.trim()) return validation;
  return {
    ...validation,
    detail: appendGatewayTerminalErrorDetail(validation.detail, terminalError),
  };
}

type FailedValidation = Extract<
  Awaited<ReturnType<typeof validateWorkflowAgentStructuredReply>>,
  { ok: false }
>;

/** Format → continue format-retry; runtime/fatal → return node-level outcome (no format-retry). */
function resolvePostWaitFailureWithoutFormatRetry(params: {
  validation: FailedValidation;
  raw: string;
  terminalErrorEnded?: boolean;
  terminalError?: string;
  transportReason?: 'timeout' | 'error' | 'empty';
  retried: boolean;
}): Extract<WorkflowAgentLlmResult, { ok: false }> | null {
  const kind = classifyWorkflowPostWaitFailure({
    terminalErrorEnded: params.terminalErrorEnded,
    terminalError: params.terminalError,
    issues: params.validation.issues,
    raw: params.raw,
    transportReason: params.transportReason,
  });
  if (kind === 'format') return null;

  if (kind === 'runtime') {
    return {
      ok: false,
      issues: normalizeRuntimePostWaitFailureIssues(params.validation.issues),
      detail: params.validation.detail,
      raw: params.raw,
      // Non-fatal transport so buildWorkflowRoleStepFromValidationFailure can outputRetry.
      transportReason: 'empty',
      retried: params.retried,
    };
  }

  return {
    ok: false,
    issues: (params.validation.issues.includes('transport_timeout')
      || params.validation.issues.includes('transport_error')
      || params.validation.issues.includes('model_error'))
      ? [...params.validation.issues]
      : (['model_error'] as WorkflowAgentValidationIssue[]),
    detail: params.validation.detail,
    raw: params.raw,
    transportReason: 'error',
    retried: params.retried,
  };
}

function workflowRecoveryEmptyFailure(
  detail: string,
  raw = '',
): { ok: false; validation: WorkflowValidationFailure; raw: string } {
  return {
    ok: false,
    validation: {
      ok: false,
      issues: ['empty'],
      detail,
      raw,
    },
    raw,
  };
}

/**
 * Session 收稿恢复：与主路径相同的 sessions.list idle + 5s hash 闸门，再结构化校验。
 * 用于 wait 超时/空稿等旁路，不得绕过 Gateway 终态判断。
 */
export async function tryRecoverWorkflowSessionStructuredReply(
  gateway: GatewayManager,
  params: {
    sessionKey: string;
    startedAtMs: number;
    runId?: string;
    signal?: AbortSignal;
    validateWithDisk: ValidateWithDiskFn;
  },
): Promise<
  | { ok: true; parsed: ParsedAgentTaskReply; raw: string }
  | { ok: false; validation: WorkflowValidationFailure; raw: string }
> {
  const tracker = params.runId
    ? (
      peekOfficeSettleTracker(buildOfficeSettleTrackerKey(params.sessionKey, params.runId, params.startedAtMs))
      ?? getOrCreateOfficeSettleTracker(
        buildOfficeSettleTrackerKey(params.sessionKey, params.runId, params.startedAtMs),
        params.runId,
      )
    )
    : createOfficeRunTracker(params.runId);
  const runtimeToolTracker = new OfficeRuntimeToolTracker();

  // Model B: gateway terminal (`run.ended` → runComplete, or `sessions.list` idle)
  // must open the gate first; history-JSON only promotes workflowHistoryReconciled.
  if (!isOfficeRunProtocolDischarged(tracker)) {
    const sessionRow = await fetchGatewaySessionListRow(gateway, params.sessionKey);
    if (!reconcileOfficeRunSessionIdle(tracker, sessionRow, params.startedAtMs)) {
      return workflowRecoveryEmptyFailure('收稿恢复失败：session 未处于 idle 状态');
    }
  }

  try {
    const history = await fetchWorkflowSettleChatHistory(gateway, params.sessionKey, {
      urgent: true,
      startedAtMs: params.startedAtMs,
    });
    tryReconcileOfficeRunFromWorkflowHistory(tracker, history.messages as Array<Record<string, unknown>>, params.startedAtMs, {
      runtimeToolSnapshot: runtimeToolTracker.snapshot(),
    });
  } catch {
    // history fetch optional; gate already opened via sessions.list idle above.
  }

  const pollWorkflowText = async (historyMessages?: Array<Record<string, unknown>>): Promise<string | null> => {
    if (historyMessages?.length) {
      const enriched = enrichMessagesForRoomMirror(historyMessages);
      const text = findLatestWorkflowReplyRaw(enriched, params.startedAtMs);
      return text?.trim() ? text.trim() : null;
    }
    const latest = await fetchLatestWorkflowStructuredSessionReply(gateway, {
      sessionKey: params.sessionKey,
      startedAtMs: params.startedAtMs,
      requireFreshUserTurn: true,
      minWaitBeforeAcceptMs: 0,
    });
    return latest.acceptable && latest.raw.trim() ? latest.raw.trim() : null;
  };

  try {
    if (!(await verifyOfficeSessionAllowsSuccessSettle(gateway, params.sessionKey, params.startedAtMs, tracker))) {
      return workflowRecoveryEmptyFailure('收稿恢复失败：session 未处于 idle 状态');
    }

    const captured = await captureOfficeSettleBaseline(gateway, {
      sessionKey: params.sessionKey,
      startedAtMs: params.startedAtMs,
      tracker,
      pollText: pollWorkflowText,
      runtimeToolSnapshot: runtimeToolTracker.snapshot(),
    });
    if (!captured) {
      return workflowRecoveryEmptyFailure('收稿后未在 session 中找到工作流结构化正文');
    }

    const settled = await fetchStableSessionReplyText(gateway, {
      sessionKey: params.sessionKey,
      startedAtMs: params.startedAtMs,
      signal: params.signal,
      tracker,
      pollText: pollWorkflowText,
    });

    const raw = settled?.text?.trim() ?? '';
    if (!raw) {
      return workflowRecoveryEmptyFailure(
        '收稿一致性校验失败：session 正文在稳定窗口内发生变化或未通过 idle 复检',
      );
    }

    const validation = await params.validateWithDisk(raw, 'empty');
    if (validation.ok) {
      tracker.settleConsistencyAttempted = true;
      return { ok: true, parsed: validation.parsed, raw: validation.parsed.raw };
    }
    return { ok: false, validation, raw };
  } catch (e) {
    if (params.signal?.aborted || (e instanceof Error && e.message === 'aborted')) {
      throw e;
    }
    return workflowRecoveryEmptyFailure(e instanceof Error ? e.message : String(e));
  }
}

async function validateWorkflowRunSessionReply(
  gateway: GatewayManager,
  params: {
    raw: string;
    reason: 'timeout' | 'error' | 'empty';
    sessionKey: string;
    startedAtMs: number;
    runId?: string;
    signal?: AbortSignal;
    validateWithDisk: ValidateWithDiskFn;
  },
): Promise<
  | { ok: true; parsed: ParsedAgentTaskReply; raw: string }
  | { ok: false; validation: WorkflowValidationFailure; raw: string }
> {
  if (params.raw.trim()) {
    const validation = await params.validateWithDisk(params.raw, 'empty');
    if (validation.ok) {
      return { ok: true, parsed: validation.parsed, raw: validation.parsed.raw };
    }
    return { ok: false, validation, raw: params.raw };
  }

  if (params.reason === 'error') {
    const validation = await params.validateWithDisk(params.raw, params.reason);
    if (validation.ok) {
      return { ok: true, parsed: validation.parsed, raw: validation.parsed.raw };
    }
    return { ok: false, validation, raw: params.raw };
  }

  return tryRecoverWorkflowSessionStructuredReply(gateway, {
    sessionKey: params.sessionKey,
    startedAtMs: params.startedAtMs,
    runId: params.runId,
    signal: params.signal,
    validateWithDisk: params.validateWithDisk,
  });
}

/**
 * After wait: runtime terminal must NOT enter session recovery (which can false-succeed
 * on stale success-idle list + leftover JSON). Align all attempts with attempt-1 behavior.
 */
async function validateWorkflowAttemptAfterWait(
  gateway: GatewayManager,
  params: {
    raw: string;
    reason: 'timeout' | 'error' | 'empty';
    terminalErrorEnded?: boolean;
    terminalError?: string;
    /** callAgentMessage / wait throw text — enrich when settle has no terminalError. */
    transportError?: string;
    sessionKey: string;
    startedAtMs: number;
    runId?: string;
    signal?: AbortSignal;
    validateWithDisk: ValidateWithDiskFn;
  },
): Promise<
  | { ok: true; parsed: ParsedAgentTaskReply; raw: string }
  | { ok: false; validation: WorkflowValidationFailure; raw: string }
> {
  const causeHint = params.terminalError?.trim() || params.transportError?.trim() || undefined;
  if (params.terminalErrorEnded) {
    const validation = await params.validateWithDisk(
      params.raw,
      params.raw.trim() ? 'empty' : params.reason,
    );
    if (validation.ok) {
      return { ok: true, parsed: validation.parsed, raw: validation.parsed.raw };
    }
    return {
      ok: false,
      validation: enrichWorkflowValidationFailure(validation, causeHint),
      raw: params.raw,
    };
  }
  const result = await validateWorkflowRunSessionReply(gateway, {
    raw: params.raw,
    reason: params.reason,
    sessionKey: params.sessionKey,
    startedAtMs: params.startedAtMs,
    runId: params.runId,
    signal: params.signal,
    validateWithDisk: params.validateWithDisk,
  });
  // RPC / wait-throw / soft-wait-error: enrich only transport failures so a future
  // contract change cannot attach provider noise onto format/schema issues.
  if (
    !result.ok
    && causeHint
    && (result.validation.issues.includes('transport_error')
      || result.validation.issues.includes('transport_timeout'))
  ) {
    return {
      ok: false,
      validation: enrichWorkflowValidationFailure(result.validation, causeHint),
      raw: result.raw,
    };
  }
  return result;
}

/** 工作流节点：首次执行 → 结构化校验 → 不合格带原文重试一次。 */
export async function fetchWorkflowAgentReplyWithRetry(
  gateway: GatewayManager,
  params: {
    sessionKey: string;
    agentId: string;
    roleName: string;
    agentBody: string;
    idempotencyKey: string;
    retryIdempotencyKey: string;
    nodeExecution: 'serial' | 'subagent';
    taskName?: string;
    stepTitle?: string;
    timeoutMs: number;
    signal?: AbortSignal;
    /** 与 Session 轮询恢复共用，须为 dispatch 前同一时刻。 */
    startedAtMs?: number;
    onPartialReply?: (text: string) => void;
    onRunId?: (runId: string | undefined) => void;
    settleRunId?: string;
    shouldAbortWait?: () => boolean;
    requireMemberHandoff?: boolean;
    expectedHandoff?: WorkflowHandoffTarget[];
    teamRoles?: ProjectAgentRef[];
    verifyDeliverableOnDisk?: (
      parsed: ParsedAgentTaskReply,
    ) => Promise<{ ok: boolean; detail: string }>;
    isCoordinatorRole?: boolean;
    expectedHandoffLines?: string[];
    directPredecessorDeliverables?: string;
    projectId?: string;
  },
): Promise<WorkflowAgentLlmResult> {
  const validationOpts = {
    requireMemberHandoff: params.requireMemberHandoff,
    expectedHandoff: params.expectedHandoff,
    teamRoles: params.teamRoles,
    actorRoleName: params.roleName,
    directPredecessorDeliverables: params.directPredecessorDeliverables,
  };

  const validateWithDisk = async (
    raw: string,
    reason: 'timeout' | 'error' | 'empty',
  ): Promise<ReturnType<typeof validateWorkflowAgentStructuredReply>> => {
    const structural = validateWorkflowAgentStructuredReply({
      raw,
      transportReason: reason,
      ...validationOpts,
    });
    if (structural.ok) {
      if (!params.verifyDeliverableOnDisk) return structural;
      const disk = await params.verifyDeliverableOnDisk(structural.parsed);
      if (disk.ok) return structural;
      return {
        ok: false,
        issues: ['deliverable_paths_missing_on_disk' as WorkflowAgentValidationIssue],
        detail: disk.detail,
        raw,
      };
    }
    if (
      params.verifyDeliverableOnDisk
      && raw.trim()
      && isFilenameOnlyWorkflowValidationFailure(structural)
    ) {
      const parsed = parseStructuredAgentReply(raw);
      const disk = await params.verifyDeliverableOnDisk(parsed);
      if (disk.ok) {
        return { ok: true, parsed };
      }
    }
    return structural;
  };
  const startedAt = params.startedAtMs ?? Date.now();
  const runOnceShared = {
    sessionKey: params.sessionKey,
    agentId: params.agentId,
    nodeExecution: params.nodeExecution,
    taskName: params.taskName,
    timeoutMs: params.timeoutMs,
    signal: params.signal,
    onPartialReply: params.onPartialReply,
    onRunId: params.onRunId,
    settleRunId: params.settleRunId,
    shouldAbortWait: params.shouldAbortWait,
    settleTrackerStartedAtMs: startedAt,
    projectId: params.projectId,
  };
  const first = await runOnce(
    gateway,
    buildWorkflowRunOnceParams(runOnceShared, {
      message: params.agentBody,
      idempotencyKey: params.idempotencyKey,
      startedAtMs: startedAt,
    }),
  );

  if (first.peerClaimed) {
    return {
      ok: false,
      issues: ['transport_error'],
      detail: 'peer_claimed',
      raw: '',
      transportReason: 'empty',
      retried: false,
    };
  }

  if (
    first.transportError === 'aborted'
    || params.signal?.aborted
    || shouldBlockOfficeLlmSend(params.projectId)
  ) {
    return {
      ok: false,
      issues: ['transport_error'],
      detail: 'aborted',
      raw: '',
      transportReason: 'empty',
      retried: false,
    };
  }

  let firstValidation: WorkflowValidationFailure;
  let firstValidatedRaw: string;

  try {
    const validated = await validateWorkflowAttemptAfterWait(gateway, {
      raw: first.raw,
      reason: first.reason,
      terminalErrorEnded: first.terminalErrorEnded,
      terminalError: first.terminalError,
      transportError: first.transportError,
      sessionKey: params.sessionKey,
      startedAtMs: startedAt,
      runId: first.runId,
      signal: params.signal,
      validateWithDisk,
    });
    if (validated.ok) {
      return {
        ok: true,
        parsed: validated.parsed,
        raw: validated.raw,
        runId: first.runId,
        retried: false,
      };
    }
    firstValidation = validated.validation;
    firstValidatedRaw = validated.raw || first.raw;
  } catch (e) {
    if (params.signal?.aborted || (e instanceof Error && e.message === 'aborted')) {
      if (params.shouldAbortWait?.()) {
        return {
          ok: false,
          issues: ['transport_error'],
          detail: 'peer_claimed',
          raw: '',
          transportReason: 'empty',
          retried: false,
        };
      }
      return {
        ok: false,
        issues: ['transport_error'],
        detail: 'Aborted',
        raw: first.raw,
        transportReason: 'error',
        retried: false,
      };
    }
    throw e;
  }

  if (isModelTransportError(first.reason) && !firstValidatedRaw.trim()) {
    return {
      ok: false,
      issues: firstValidation.issues,
      detail: firstValidation.detail,
      raw: firstValidatedRaw,
      transportReason: first.reason,
      retried: false,
    };
  }

  // Runtime/fatal terminal → node outputRetry or hard fail; only true format errors format-retry.
  const firstNoFormat = resolvePostWaitFailureWithoutFormatRetry({
    validation: firstValidation,
    raw: firstValidatedRaw,
    terminalErrorEnded: first.terminalErrorEnded,
    terminalError: first.terminalError,
    transportReason: first.reason,
    retried: false,
  });
  if (firstNoFormat) return firstNoFormat;

  // room_heal may claim the node while validation failed; do not start format-retry.
  // Also stop when the user aborted / abort-quiesce is active (peer claim alone is not enough).
  if (
    params.shouldAbortWait?.()
    || params.signal?.aborted
    || shouldBlockOfficeLlmSend(params.projectId)
  ) {
    return {
      ok: false,
      issues: ['transport_error'],
      detail:
        params.signal?.aborted || shouldBlockOfficeLlmSend(params.projectId)
          ? 'aborted'
          : 'peer_claimed',
      raw: '',
      transportReason: 'empty',
      retried: false,
    };
  }

  const retryStartedAt = Date.now();
  const retryBody = buildWorkflowAgentRetryPrompt({
    roleName: params.roleName,
    agentTaskBody: params.agentBody,
    priorRaw: firstValidatedRaw || first.transportError || '',
    transportReason: isModelTransportError(first.reason) ? first.reason : undefined,
    validationDetail: firstValidation.detail,
    issues: firstValidation.issues,
    stepTitle: params.stepTitle,
    isCoordinatorRole: params.isCoordinatorRole,
    expectedHandoffLines: params.expectedHandoffLines,
  });

  const second = await runOnce(
    gateway,
    buildWorkflowRunOnceParams(runOnceShared, {
      message: retryBody,
      idempotencyKey: params.retryIdempotencyKey,
      startedAtMs: retryStartedAt,
    }),
  );

  if (second.peerClaimed) {
    return {
      ok: false,
      issues: ['transport_error'],
      detail: 'peer_claimed',
      raw: '',
      transportReason: 'empty',
      retried: true,
    };
  }

  let secondValidation: WorkflowValidationFailure;
  let secondValidatedRaw: string;

  try {
    const validated = await validateWorkflowAttemptAfterWait(gateway, {
      raw: second.raw,
      reason: second.reason,
      terminalErrorEnded: second.terminalErrorEnded,
      terminalError: second.terminalError,
      transportError: second.transportError,
      sessionKey: params.sessionKey,
      startedAtMs: retryStartedAt,
      runId: second.runId,
      signal: params.signal,
      validateWithDisk,
    });
    if (validated.ok) {
      return {
        ok: true,
        parsed: validated.parsed,
        raw: validated.raw,
        runId: second.runId,
        retried: true,
      };
    }
    secondValidation = validated.validation;
    secondValidatedRaw = validated.raw || second.raw;
  } catch (e) {
    if (params.signal?.aborted || (e instanceof Error && e.message === 'aborted')) {
      if (params.shouldAbortWait?.()) {
        return {
          ok: false,
          issues: ['transport_error'],
          detail: 'peer_claimed',
          raw: '',
          transportReason: 'empty',
          retried: true,
        };
      }
      return {
        ok: false,
        issues: ['transport_error'],
        detail: 'Aborted',
        raw: second.raw || firstValidatedRaw,
        transportReason: 'error',
        retried: true,
      };
    }
    throw e;
  }

  if (isModelTransportError(second.reason) && !secondValidatedRaw.trim()) {
    return {
      ok: false,
      issues: secondValidation.issues,
      detail: secondValidation.detail,
      raw: secondValidatedRaw,
      transportReason: second.reason,
      retried: true,
    };
  }

  const secondNoFormat = resolvePostWaitFailureWithoutFormatRetry({
    validation: secondValidation,
    raw: secondValidatedRaw,
    terminalErrorEnded: second.terminalErrorEnded,
    terminalError: second.terminalError,
    transportReason: second.reason,
    retried: true,
  });
  if (secondNoFormat) return secondNoFormat;

  // A successful 2nd attempt already returned inside the try above; here
  // `secondValidation` is always a validation failure — fall through to retry #2.
  if (
    params.shouldAbortWait?.()
    || params.signal?.aborted
    || shouldBlockOfficeLlmSend(params.projectId)
  ) {
    return {
      ok: false,
      issues: ['transport_error'],
      detail:
        params.signal?.aborted || shouldBlockOfficeLlmSend(params.projectId)
          ? 'aborted'
          : 'peer_claimed',
      raw: '',
      transportReason: 'empty',
      retried: true,
    };
  }

  const retry2StartedAt = Date.now();
  const retry2Body = buildWorkflowAgentRetryPrompt({
    roleName: params.roleName,
    agentTaskBody: params.agentBody,
    priorRaw: secondValidatedRaw || second.transportError || firstValidatedRaw || '',
    transportReason: isModelTransportError(second.reason) ? second.reason : undefined,
    validationDetail: secondValidation.detail,
    issues: secondValidation.issues,
    stepTitle: params.stepTitle,
    isCoordinatorRole: params.isCoordinatorRole,
    expectedHandoffLines: params.expectedHandoffLines,
  });

  const third = await runOnce(
    gateway,
    buildWorkflowRunOnceParams(runOnceShared, {
      message: retry2Body,
      idempotencyKey: `${params.retryIdempotencyKey}:2`,
      startedAtMs: retry2StartedAt,
    }),
  );

  if (third.peerClaimed) {
    return {
      ok: false,
      issues: ['transport_error'],
      detail: 'peer_claimed',
      raw: '',
      transportReason: 'empty',
      retried: true,
    };
  }

  let thirdValidation: WorkflowValidationFailure;
  let thirdValidatedRaw: string;

  try {
    const validated = await validateWorkflowAttemptAfterWait(gateway, {
      raw: third.raw,
      reason: third.reason,
      terminalErrorEnded: third.terminalErrorEnded,
      terminalError: third.terminalError,
      transportError: third.transportError,
      sessionKey: params.sessionKey,
      startedAtMs: retry2StartedAt,
      runId: third.runId,
      signal: params.signal,
      validateWithDisk,
    });
    if (validated.ok) {
      return {
        ok: true,
        parsed: validated.parsed,
        raw: validated.raw,
        runId: third.runId,
        retried: true,
      };
    }
    thirdValidation = validated.validation;
    thirdValidatedRaw = validated.raw || third.raw;
  } catch (e) {
    if (params.signal?.aborted || (e instanceof Error && e.message === 'aborted')) {
      if (params.shouldAbortWait?.()) {
        return {
          ok: false,
          issues: ['transport_error'],
          detail: 'peer_claimed',
          raw: '',
          transportReason: 'empty',
          retried: true,
        };
      }
      return {
        ok: false,
        issues: ['transport_error'],
        detail: 'Aborted',
        raw: third.raw || secondValidatedRaw || firstValidatedRaw,
        transportReason: 'error',
        retried: true,
      };
    }
    throw e;
  }

  // A successful 3rd attempt already returned inside the try above; here
  // `thirdValidation` is always a validation failure — build the aggregate failure.
  const thirdNoFormat = resolvePostWaitFailureWithoutFormatRetry({
    validation: thirdValidation,
    raw: thirdValidatedRaw || secondValidatedRaw || firstValidatedRaw,
    terminalErrorEnded: third.terminalErrorEnded,
    terminalError: third.terminalError,
    transportReason: third.reason,
    retried: true,
  });
  if (thirdNoFormat) {
    return {
      ...thirdNoFormat,
      detail: [firstValidation.detail, `第1次重试后：${secondValidation.detail}`, `第2次重试后：${thirdNoFormat.detail}`]
        .filter(Boolean)
        .join('；'),
    };
  }

  const detail = [firstValidation.detail, `第1次重试后：${secondValidation.detail}`, `第2次重试后：${thirdValidation.detail}`]
    .filter(Boolean)
    .join('；');

  return {
    ok: false,
    issues: [...new Set([...firstValidation.issues, ...secondValidation.issues, ...thirdValidation.issues])],
    detail,
    raw: thirdValidatedRaw || secondValidatedRaw || firstValidatedRaw,
    transportReason: isModelTransportError(third.reason)
      ? third.reason
      : isModelTransportError(second.reason)
        ? second.reason
        : isModelTransportError(first.reason)
          ? first.reason
          : 'empty',
    retried: true,
  };
}
