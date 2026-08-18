import type { GatewayManager } from '../../gateway/manager';
import { roomMessageProjectId } from '../../../src/lib/office-agent-id-resolve';
import { shouldSkipSmartMemberDispatchAfterCompletedReport } from '../../../src/lib/office-smart-member-dispatch-guard';
import { readProjectProgress } from './coordinator-project-fs';
import {
  isSubstantiveRoomMentionReply,
} from './room-mention-reply-policy';
import { mentionDispatchLog } from './mention-dispatch-log';
import { fetchRoomMentionLlmReplyWithRetry } from './room-mention-llm';
import { publishMentionRoleReply } from './room-mention-publish';
import {
  buildRoomCoordinatorMissingMentionPrompt,
  buildRoomCoordinatorUnmentionedPrompt,
  buildRoomCoordinatorUserMentionMemberPrompt,
  buildRoomMentionAgentPrompt,
} from './room-mention-prompt';
import { coordinatorDecidedNoReply } from './room-unmentioned-coordinator';
import { buildStructuredRoomContextForMention } from './room-structured-context';
import { buildFastAckRoomContent, shouldSkipRoomMentionFastAck, ROOM_COORDINATOR_RECEIPT_ACK_TEXT } from './room-fast-ack';
import {
  resolveRoleAssignment,
  shouldSkipStaleSmartKickoffMemberDispatch,
  smartCoordinatorNeedsDecomposition,
} from './role-assignment-lookup';
import { roleDmSessionKey, roleTaskRoomDmSuffix, taskRoomSessionKey } from './session-keys';
import {
  hasSmartCoordinatorStructuredDispatch,
} from '../../../src/lib/office-smart-room-fields';
import { parseSmartCoordinatorAction } from '../../../src/lib/office-smart-coordinator-dispatch';
import { ensureSmartTaskRunningAfterCoordinatorDispatch } from './smart-task-runner';
import { taskExecutionMode } from './task-execution-mode';
import {
  persistRoleWorkStatusAfterMentionReply,
  syncCoordinatorNotebookAfterMention,
} from './mention-task-context';
import { parseMentions, resolveMentionTargets } from './room-mentions';
import {
  classifySmartMemberReportToCoordinator,
  resolveSmartMemberReadinessForMentionDispatch,
  isSmartMemberHelpAction,
  smartMemberReplyMentionsCoordinator,
  synthesizeBlockedMemberDependencyReply,
} from '../../../src/lib/office-smart-member-reply';
import { buildSmartMemberDispatchAssignment, resolveSmartJsonRawFromMentionTrigger } from '../../../src/lib/office-smart-room-fields';
import { parseSmartCoordinatorEndFlag } from '../../../src/lib/office-smart-project-end';
import {
  normalizeSmartMentionRaw,
  parseRoomMentionStructuredReply,
} from './room-mention-structured-reply';
import { joinInlineQuotedReply } from '../../../src/lib/office-room-reply-format';
import {
  roomMessageReplyPreview,
  roomMessageSpeakerLabel,
} from '../../../src/lib/office-room-reply';
import type { ProjectAgentRef } from '../../../src/lib/office-workflow-node';
import type { OfficeFixedGroup, OfficeTempProject, RoomMessage } from './types';
import { getRoomMessages } from './store';
import { isWorkflowTaskRunnerActive } from './workflow-run-registry';
import {
  isWorkflowUpstreamClarificationMessage,
  isWorkflowUpstreamClarificationTarget,
} from '../../../src/lib/office-workflow-upstream-mention';
import { workflowForTask } from './workflow-graph';
import { resolveWorkflowMentionSpeakerRoleId } from './room-dispatch-policy';
import {
  collectSmartUpstreamDeliverablePathHints,
} from '../../../src/lib/office-smart-input-validation';
import { isSmartJsonShapeText, parseSmartMemberJsonOutput } from '../../../src/lib/office-smart-json-schema';
import {
  resolveSmartNextExecutorRoleIds,
  resolveSmartPriorProducerRoleId,
  resolveSmartWorkOrderSteps,
} from '../../../src/lib/office-smart-work-order';
import {
  verifySmartMentionStructuredPathsOnDisk,
  verifySmartUpstreamDeliverablePathsOnDisk,
} from './room-mention-disk-verify';
import {
  clearSmartMemberReportInboundDedupForTask,
  evaluateSmartMemberReportInboundDedup,
  coordinatorReceiptAckExistsForMemberReport,
  registerSmartMemberReportsHandledByCoordinatorInbound,
} from '../../../src/lib/office-smart-member-report-inbound-dedup';
import {
  isSmartMemberInboundCoordinatorDispatch,
  mergeSmartMentionTriggerContent,
  resolveMergedSmartCoordinatorPromptVariant,
  resolveSmartMentionDispatchRoundId,
  SMART_MEMBER_INBOUND_COORDINATOR_INFLIGHT_SUFFIX,
  smartMentionSessionIdempotencyKey,
} from '../../../src/lib/office-smart-mention-normalize';

export type MentionPromptVariant =
  | 'direct_mention'
  | 'workflow_upstream_clarification'
  | 'coordinator_broadcast_unmentioned'
  | 'coordinator_user_mention_member'
  | 'coordinator_missing_mention'
  | 'coordinator_member_failure'
  | 'coordinator_member_supervision'
  | 'coordinator_member_report'
  | 'coordinator_kickoff_decompose';

export type MissingMentionDispatchContext = {
  speakerRoleName: string;
  missingRoleNames: string[];
  speakerExcerpt: string;
};

/** 同一条触发消息对同一角色只跑一次点名 LLM，避免并行重复落群。 */
const mentionDispatchInflight = new Map<string, Promise<void>>();

/** Smart：abort/fresh 时递增；旧 generation 的派发/coalesce 须立即放弃，避免僵尸 Session 污染新轮次。 */
const smartMentionDispatchGenerationByTask = new Map<string, number>();

function smartMentionDispatchGeneration(taskId: string): number {
  return smartMentionDispatchGenerationByTask.get(taskId.trim()) ?? 0;
}

function isStaleSmartMentionDispatch(taskId: string, capturedGeneration: number): boolean {
  const trimmed = taskId.trim();
  if (!trimmed) return false;
  return smartMentionDispatchGeneration(trimmed) !== capturedGeneration;
}

/** @visibleForTesting Smart 派发 generation 是否已过期 */
export function isStaleSmartMentionDispatchForTesting(
  taskId: string,
  capturedGeneration: number,
): boolean {
  return isStaleSmartMentionDispatch(taskId, capturedGeneration);
}

export { mentionDispatchLog } from './mention-dispatch-log';

/** Project agent with orchestrator-compatible id/name aliases (id === agentId). */
export type ProjectMember = ProjectAgentRef & { id: string; name: string };

/** Stable role id for Smart mention dispatch keys (id may be absent on delegated picks). */
export function memberRoleDispatchId(
  member: Pick<ProjectMember, 'id' | 'agentId'> & { displayName?: string },
): string {
  return (member.id ?? member.agentId ?? '').trim();
}

export function normalizeProjectMember(
  member: Partial<ProjectMember> & { displayName?: string },
  roster?: ProjectMember[],
): ProjectMember {
  const hintedAgentId = (member.agentId ?? member.id ?? '').trim();
  const fromRoster = roster?.find(
    (r) =>
      (hintedAgentId && (r.agentId === hintedAgentId || r.id === hintedAgentId))
      || (member.id && r.id === member.id),
  );
  const agentId = (hintedAgentId || fromRoster?.agentId || fromRoster?.id || '').trim();
  const id = (member.id ?? fromRoster?.id ?? agentId).trim() || agentId;
  const name =
    (member.name ?? member.displayName ?? fromRoster?.name ?? agentId).trim()
    || id
    || 'member';
  return {
    agentId: agentId || id,
    displayName: name,
    id: id || agentId,
    name,
  };
}

function memberIsCoordinator(
  member: Pick<ProjectMember, 'id' | 'agentId'>,
  coordinatorRoleId: string,
): boolean {
  const coord = coordinatorRoleId.trim();
  if (!coord) return false;
  return member.id === coord || member.agentId === coord;
}

function scenarioDispatchCompat(
  scenario: Pick<OfficeFixedGroup, 'workflow' | 'coordinatorAgentId' | 'agentIds'> | null,
): { workflow: OfficeFixedGroup['workflow']; coordinatorRoleId: string; roleIds: string[] } | null {
  if (!scenario) return null;
  const legacy = scenario as Pick<OfficeFixedGroup, 'workflow' | 'coordinatorAgentId' | 'agentIds'> & {
    coordinatorRoleId?: string;
    roleIds?: string[];
  };
  return {
    workflow: legacy.workflow,
    coordinatorRoleId: legacy.coordinatorAgentId ?? legacy.coordinatorRoleId ?? '',
    roleIds: legacy.agentIds ?? legacy.roleIds ?? [],
  };
}

function dispatchMemberAsProjectAgent(m: ProjectMember): ProjectAgentRef {
  const agentId = (m.agentId ?? m.id ?? '').trim();
  const displayName = (m.name ?? m.agentId ?? m.id ?? '').trim() || agentId || 'member';
  return { agentId: agentId || displayName, displayName };
}

function mentionGroupContext(
  scenario: Pick<OfficeFixedGroup, 'workflow' | 'coordinatorAgentId' | 'agentIds'> | null,
  focus: OfficeTempProject | null,
): Pick<OfficeFixedGroup, 'workflow' | 'coordinatorAgentId' | 'agentIds'> | null {
  if (scenario) {
    const compat = scenarioDispatchCompat(scenario);
    if (compat) {
      return {
        workflow: compat.workflow,
        coordinatorAgentId: compat.coordinatorRoleId,
        agentIds: compat.roleIds,
      };
    }
  }
  if (focus) {
    return {
      workflow: focus.workflow ?? { mode: 'dag', nodes: [], edges: [] },
      coordinatorAgentId: focus.coordinatorAgentId,
      agentIds: [...focus.agentIds],
    };
  }
  return null;
}

type SmartMentionDispatchWork = {
  gateway: GatewayManager;
  params: Parameters<typeof dispatchSingleRoleMentionReplyInner>[1];
  userMsg: RoomMessage;
  members: ProjectMember[];
  member: ProjectMember;
  options: Parameters<typeof dispatchSingleRoleMentionReplyInner>[5];
  hooks: MentionDispatchHooks;
  coalescedFromUserMsgIds: string[];
};

/** Smart：同 task+角色点名进行中时，后续触发合并为一次 Session 发送（非 member-inbound）。 */
const smartMentionPendingByKey = new Map<string, SmartMentionDispatchWork>();

const SMART_MEMBER_INBOUND_MAX_DRAIN_PASS = 32;
const SMART_MEMBER_INBOUND_WATCHDOG_MS = 2000;

type SmartMemberInboundQueueState = {
  fifoQueue: SmartMentionDispatchWork[];
  mutex: Promise<void>;
  runningFlag: boolean;
  drainPromise: Promise<void> | null;
  needsReschedule: boolean;
  smartTaskId: string;
  watchdogTimer: ReturnType<typeof setInterval> | null;
};

/** Smart 协调者 member-inbound：FIFO + running_flag + 单 consumer drain。 */
const smartMemberInboundQueues = new Map<string, SmartMemberInboundQueueState>();

function runSmartMemberInboundExclusive<T>(
  state: SmartMemberInboundQueueState,
  fn: () => Promise<T>,
): Promise<T> {
  const run = state.mutex.then(() => fn());
  state.mutex = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function mergeAllSmartMemberInboundWork(
  queue: SmartMentionDispatchWork[],
): SmartMentionDispatchWork | null {
  if (queue.length === 0) return null;
  const sorted = [...queue].sort((a, b) => a.userMsg.timestamp - b.userMsg.timestamp);
  let batch = sorted[0]!;
  for (let i = 1; i < sorted.length; i++) {
    batch = mergeSmartMentionDispatchWork(batch, sorted[i]!);
  }
  return batch;
}

function mergeSmartPendingDispatchForPass(
  current: SmartMentionDispatchWork,
  pending: SmartMentionDispatchWork,
  dispatchedOnce: boolean,
): SmartMentionDispatchWork {
  return dispatchedOnce ? pending : mergeSmartMentionDispatchWork(current, pending);
}

function getOrCreateSmartMemberInboundQueue(
  queueKey: string,
  smartTaskId: string,
): SmartMemberInboundQueueState {
  const existing = smartMemberInboundQueues.get(queueKey);
  if (existing) return existing;
  const state: SmartMemberInboundQueueState = {
    fifoQueue: [],
    mutex: Promise.resolve(),
    runningFlag: false,
    drainPromise: null,
    needsReschedule: false,
    smartTaskId,
    watchdogTimer: null,
  };
  smartMemberInboundQueues.set(queueKey, state);
  state.watchdogTimer = setInterval(() => {
    void smartMemberInboundWatchdogTick(queueKey);
  }, SMART_MEMBER_INBOUND_WATCHDOG_MS);
  return state;
}

function clearSmartMemberInboundQueuesForTask(taskId: string): void {
  const prefix = `smart:${taskId.trim()}:`;
  const suffix = SMART_MEMBER_INBOUND_COORDINATOR_INFLIGHT_SUFFIX;
  for (const [queueKey, state] of [...smartMemberInboundQueues.entries()]) {
    if (!queueKey.startsWith(prefix) || !queueKey.endsWith(suffix)) continue;
    state.fifoQueue = [];
    state.needsReschedule = false;
    // 不强制清 runningFlag：在途 inner 仍依赖 finally 释放；generation bump 丢弃后续批次。
    // 不 delete state：避免在途 drain 与新建 queue 并行调两次协调者 LLM。
    mentionDispatchLog('member-inbound-queue-cleared', {
      key: queueKey,
      taskId,
      running: state.runningFlag,
      draining: !!state.drainPromise,
    });
  }
}

async function smartMemberInboundWatchdogTick(queueKey: string): Promise<void> {
  const state = smartMemberInboundQueues.get(queueKey);
  if (!state) return;
  if (state.runningFlag && !state.drainPromise) {
    state.runningFlag = false;
    mentionDispatchLog('member-inbound-running-zombie-recovery', { key: queueKey });
  }
  if (state.runningFlag || state.drainPromise) return;
  const depth = await runSmartMemberInboundExclusive(state, async () => state.fifoQueue.length);
  if (depth > 0) {
    mentionDispatchLog('member-inbound-watchdog-tick', { key: queueKey, depth });
    signalSmartMemberInboundDrain(queueKey);
  }
}

function abortSmartMemberInboundDequeueAttempt(state: SmartMemberInboundQueueState, queueKey: string): void {
  if (!state.runningFlag) return;
  state.runningFlag = false;
  mentionDispatchLog('member-inbound-dequeue-abort-running', { key: queueKey });
}

async function enqueueSmartMemberInboundWork(
  queueKey: string,
  smartTaskId: string,
  work: SmartMentionDispatchWork,
): Promise<void> {
  const state = getOrCreateSmartMemberInboundQueue(queueKey, smartTaskId);
  await runSmartMemberInboundExclusive(state, async () => {
    state.fifoQueue.push(work);
    mentionDispatchLog('member-inbound-enqueue', {
      key: queueKey,
      taskId: smartTaskId,
      depth: state.fifoQueue.length,
      runningFlag: state.runningFlag,
      triggerMsgId: work.userMsg.id,
      coalescedCount: work.coalescedFromUserMsgIds.length,
    });
  });
  signalSmartMemberInboundDrain(queueKey);
}

function signalSmartMemberInboundDrain(queueKey: string): void {
  const state = smartMemberInboundQueues.get(queueKey);
  if (!state) return;
  if (state.drainPromise) {
    state.needsReschedule = true;
    return;
  }
  const drain = drainSmartMemberInboundQueue(queueKey);
  state.drainPromise = drain;
  void drain
    .finally(() => {
      if (state.drainPromise === drain) {
        state.drainPromise = null;
      }
      const reschedule = state.needsReschedule;
      state.needsReschedule = false;
      void runSmartMemberInboundExclusive(state, async () => {
        if (smartMemberInboundQueues.get(queueKey) !== state) return;
        const hasQueued = state.fifoQueue.length > 0;
        if ((reschedule || hasQueued) && !state.runningFlag) {
          signalSmartMemberInboundDrain(queueKey);
        }
      }).catch((err) => {
        console.warn('[office] smart member-inbound reschedule failed:', queueKey, err);
      });
    })
    .catch((err) => {
      console.warn('[office] smart member-inbound drain failed:', queueKey, err);
    });
}

async function drainSmartMemberInboundQueue(queueKey: string): Promise<void> {
  const state = smartMemberInboundQueues.get(queueKey);
  if (!state) return;
  const smartTaskId = state.smartTaskId;

  try {
    for (let pass = 0; pass < SMART_MEMBER_INBOUND_MAX_DRAIN_PASS; pass++) {
      let batch: SmartMentionDispatchWork | null = null;
      const capturedGen = smartMentionDispatchGeneration(smartTaskId);

      let dequeued: SmartMentionDispatchWork | null = null;
      await runSmartMemberInboundExclusive(state, async () => {
        if (state.runningFlag || state.fifoQueue.length === 0) return;
        state.runningFlag = true;
        dequeued = mergeAllSmartMemberInboundWork(state.fifoQueue);
        state.fifoQueue = [];
      });
      batch = dequeued;

      if (!batch) {
        abortSmartMemberInboundDequeueAttempt(state, queueKey);
        return;
      }

      const work = batch as SmartMentionDispatchWork;
      mentionDispatchLog('member-inbound-dequeue', {
        key: queueKey,
        taskId: smartTaskId,
        pass,
        batchSize: work.coalescedFromUserMsgIds.length,
        triggers: work.coalescedFromUserMsgIds.join(','),
        generation: capturedGen,
      });

      try {
        if (isStaleSmartMentionDispatch(smartTaskId, capturedGen)) {
          mentionDispatchLog('member-inbound-stale-drop', {
            key: queueKey,
            taskId: smartTaskId,
            batchSize: work.coalescedFromUserMsgIds.length,
            triggers: work.coalescedFromUserMsgIds.join(','),
            generation: capturedGen,
          });
        } else {
          const filteredWork = await filterSmartMemberInboundWorkForDedup(work);
          if (!filteredWork) {
            mentionDispatchLog('member-inbound-dedup-skip-batch', {
              key: queueKey,
              taskId: smartTaskId,
              batchSize: work.coalescedFromUserMsgIds.length,
              triggers: work.coalescedFromUserMsgIds.join(','),
              generation: capturedGen,
            });
          } else {
          mentionDispatchLog('member-inbound-running-start', {
            key: queueKey,
            pass,
            generation: capturedGen,
          });
          try {
            await dispatchSingleRoleMentionReplyInner(
              filteredWork.gateway,
              filteredWork.params,
              filteredWork.userMsg,
              filteredWork.members,
              filteredWork.member,
              {
                ...filteredWork.options,
                coalescedFromUserMsgIds: filteredWork.coalescedFromUserMsgIds,
                smartDispatchGeneration: capturedGen,
              },
              filteredWork.hooks,
            );
          } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            mentionDispatchLog('member-inbound-inner-crash', { key: queueKey, error });
            console.warn('[office] smart member-inbound inner crashed:', queueKey, err);
          }
          }
        }
      } finally {
        state.runningFlag = false;
        mentionDispatchLog('member-inbound-running-cleared', { key: queueKey, pass });
      }

      const hasMore = await runSmartMemberInboundExclusive(
        state,
        async () => state.fifoQueue.length > 0,
      );
      if (!hasMore) return;
    }

    await runSmartMemberInboundExclusive(state, async () => {
      if (state.fifoQueue.length > 0) {
        state.needsReschedule = true;
      }
    });
    mentionDispatchLog('member-inbound-drain-pass-limit', {
      key: queueKey,
      taskId: smartTaskId,
      passLimit: SMART_MEMBER_INBOUND_MAX_DRAIN_PASS,
    });
  } catch (err) {
    state.runningFlag = false;
    const error = err instanceof Error ? err.message : String(err);
    mentionDispatchLog('member-inbound-drain-crash', { key: queueKey, error });
    console.warn('[office] smart member-inbound drain crashed:', queueKey, err);
    throw err;
  }
}

/** @visibleForTesting Smart member-inbound 队列深度 */
export function smartMemberInboundQueueDepthForTesting(queueKey: string): number {
  return smartMemberInboundQueues.get(queueKey)?.fifoQueue.length ?? 0;
}

/** @visibleForTesting Smart member-inbound running_flag */
export function smartMemberInboundRunningForTesting(queueKey: string): boolean {
  const state = smartMemberInboundQueues.get(queueKey);
  return !!state?.runningFlag;
}

/** @visibleForTesting Smart 项目 agent 合并队列内全部 Work */
export function mergeAllSmartMemberInboundWorkForTesting(
  queue: SmartMentionDispatchWork[],
): SmartMentionDispatchWork | null {
  return mergeAllSmartMemberInboundWork(queue);
}

/** @visibleForTesting Smart 普通 coalesce：首轮后 pending 不得再与已发送 batch 合并。 */
export function mergeSmartPendingDispatchForPassForTesting(
  current: SmartMentionDispatchWork,
  pending: SmartMentionDispatchWork,
  dispatchedOnce: boolean,
): SmartMentionDispatchWork {
  return mergeSmartPendingDispatchForPass(current, pending, dispatchedOnce);
}

/** @visibleForTesting 仅入队、不触发 drain（单测隔离） */
export function pushSmartMemberInboundWorkForTesting(
  queueKey: string,
  smartTaskId: string,
  work: SmartMentionDispatchWork,
): void {
  const state = getOrCreateSmartMemberInboundQueue(queueKey, smartTaskId);
  state.fifoQueue.push(work);
}

/** @visibleForTesting 清空 member-inbound 队列状态（单测隔离） */
export function resetSmartMemberInboundQueuesForTesting(): void {
  for (const state of smartMemberInboundQueues.values()) {
    if (state.watchdogTimer) {
      clearInterval(state.watchdogTimer);
      state.watchdogTimer = null;
    }
  }
  smartMemberInboundQueues.clear();
}

function mentionDispatchKey(
  userMsg: Pick<RoomMessage, 'id' | 'projectId'> & { taskId?: string },
  agentId: string,
  executionMode: 'smart' | 'workflow',
  projectIdOverride?: string,
): string {
  const projectId = projectIdOverride?.trim() || roomMessageProjectId(userMsg as RoomMessage);
  if (executionMode === 'smart' && projectId) {
    return `smart:${projectId}:${agentId}`;
  }
  return `${userMsg.id}:${agentId}`;
}

function resolveSmartMentionCoalesceTaskId(
  userMsg: Pick<RoomMessage, 'projectId'> & { taskId?: string },
  focusTask: Pick<OfficeTempProject, 'id'> | null | undefined,
): string {
  return focusTask?.id?.trim() || roomMessageProjectId(userMsg as RoomMessage) || '';
}

/** @visibleForTesting Smart 同 task 协调者/成员点名串行键 */
export function smartMentionDispatchKey(
  userMsg: Pick<RoomMessage, 'id' | 'projectId'>,
  agentId: string,
  projectIdOverride?: string,
): string {
  return mentionDispatchKey(userMsg, agentId, 'smart', projectIdOverride);
}

/** Smart：协调者/成员点名 LLM 是否仍在进行（同 task+role 串行，禁止并行占同一会话）。 */
export function isSmartMentionDispatchInflight(taskId: string, roleId: string): boolean {
  const prefix = `smart:${taskId}:${roleId}`;
  for (const key of mentionDispatchInflight.keys()) {
    if (key === prefix || key.startsWith(`${prefix}:`)) return true;
  }
  const memberInboundKey = `${prefix}${SMART_MEMBER_INBOUND_COORDINATOR_INFLIGHT_SUFFIX}`;
  const inboundState = smartMemberInboundQueues.get(memberInboundKey);
  if (inboundState) {
    if (inboundState.runningFlag || inboundState.drainPromise) return true;
    if (inboundState.fifoQueue.length > 0) return true;
  }
  return false;
}

/** Drop in-flight Smart mention dispatch locks for a task (abort/restart must not reuse stale waits). */
export function clearSmartMentionDispatchInflightForTask(taskId: string): void {
  const trimmed = taskId.trim();
  if (!trimmed) return;
  const nextGen = smartMentionDispatchGeneration(trimmed) + 1;
  smartMentionDispatchGenerationByTask.set(trimmed, nextGen);
  mentionDispatchLog('dispatch-generation-bump', { taskId: trimmed, generation: nextGen });
  const prefix = `smart:${trimmed}:`;
  for (const key of [...mentionDispatchInflight.keys()]) {
    if (key.startsWith(prefix)) {
      mentionDispatchInflight.delete(key);
    }
  }
  for (const key of [...smartMentionPendingByKey.keys()]) {
    if (key.startsWith(prefix)) {
      smartMentionPendingByKey.delete(key);
    }
  }
  clearSmartMemberInboundQueuesForTask(trimmed);
  clearSmartMemberReportInboundDedupForTask(trimmed);
}

function isSmartMemberAgentTriggerWork(work: SmartMentionDispatchWork): boolean {
  const msg = work.userMsg;
  return (
    msg.from === 'agent'
    && !!msg.fromAgentId
    && msg.fromAgentId !== work.params.coordinatorRoleId
  );
}

async function filterSmartMemberInboundWorkForDedup(
  work: SmartMentionDispatchWork,
): Promise<SmartMentionDispatchWork | null> {
  const taskId = work.params.focusTask?.id ?? work.userMsg.projectId ?? '';
  if (!taskId.trim()) return work;

  const roomMessages = await getRoomMessages(taskId);
  const coordinatorRoleId = work.params.coordinatorRoleId;
  const unhandledIds: string[] = [];

  for (const triggerId of work.coalescedFromUserMsgIds) {
    const memberReport =
      roomMessages.find((m) => m.id === triggerId)
      ?? (work.userMsg.id === triggerId ? work.userMsg : undefined);
    if (!memberReport) {
      unhandledIds.push(triggerId);
      continue;
    }
    const memberRoleName = work.members.find((r) => r.id === memberReport.fromAgentId)?.name;
    const dedup = evaluateSmartMemberReportInboundDedup({
      taskId,
      triggerMsgId: triggerId,
      memberReport,
      roomMessages,
      coordinatorRoleId,
      memberRoleName,
    });
    mentionDispatchLog('member-report-dedup-eval', {
      taskId,
      triggerMsgId: triggerId,
      memberRoleId: memberReport.fromAgentId,
      memberRoleName,
      skip: dedup.skip,
      reason: dedup.reason,
      matchedBy: dedup.matchedBy,
      matchedCoordinatorMsgId: dedup.matchedCoordinatorMsgId,
      memberReportTs: dedup.memberReportTs,
      latestCoordinatorSubstantiveTs: dedup.latestCoordinatorSubstantiveTs,
    });
    if (dedup.skip) {
      mentionDispatchLog('member-inbound-dedup-skip-trigger', {
        taskId,
        triggerMsgId: triggerId,
        reason: dedup.reason,
        memberRoleId: memberReport.fromAgentId,
        matchedBy: dedup.matchedBy,
        matchedCoordinatorMsgId: dedup.matchedCoordinatorMsgId,
      });
      continue;
    }
    unhandledIds.push(triggerId);
  }

  if (unhandledIds.length === 0) return null;
  if (unhandledIds.length === work.coalescedFromUserMsgIds.length) return work;

  const primaryId = unhandledIds[unhandledIds.length - 1]!;
  const primaryMsg = roomMessages.find((m) => m.id === primaryId) ?? work.userMsg;
  const mergedContent = unhandledIds
    .map((id) => {
      const message = roomMessages.find((m) => m.id === id);
      return (message?.progressText ?? message?.content ?? '').trim();
    })
    .filter(Boolean)
    .reduce((prev, next) => mergeSmartMentionTriggerContent(prev, next), '');

  return {
    ...work,
    userMsg: primaryMsg,
    params: {
      ...work.params,
      content: mergedContent || work.params.content,
    },
    coalescedFromUserMsgIds: unhandledIds,
  };
}

function mergeSmartMentionDispatchWork(
  base: SmartMentionDispatchWork,
  incoming: SmartMentionDispatchWork,
): SmartMentionDispatchWork {
  const mergedIds = [...base.coalescedFromUserMsgIds];
  for (const id of incoming.coalescedFromUserMsgIds) {
    if (!mergedIds.includes(id)) mergedIds.push(id);
  }
  const mergedContent = mergeSmartMentionTriggerContent(
    base.params.content,
    incoming.params.content,
  );
  return {
    ...incoming,
    params: {
      ...incoming.params,
      content: mergedContent,
      promptVariant: resolveMergedSmartCoordinatorPromptVariant(
        base.params.promptVariant,
        incoming.params.promptVariant,
        isSmartMemberAgentTriggerWork(base),
        isSmartMemberAgentTriggerWork(incoming),
      ) as MentionPromptVariant | undefined,
    },
    coalescedFromUserMsgIds: mergedIds,
  };
}

function smartMentionInflightKey(
  userMsg: RoomMessage,
  member: ProjectMember,
  executionMode: 'smart' | 'workflow',
  focusTask: OfficeTempProject | null | undefined,
  params?: Pick<
    Parameters<typeof dispatchSingleRoleMentionReplyInner>[1],
    'coordinatorRoleId' | 'promptVariant'
  >,
): string {
  const smartTaskId = resolveSmartMentionCoalesceTaskId(userMsg, focusTask);
  const roleDispatchId = memberRoleDispatchId(member);
  let key = mentionDispatchKey(userMsg, roleDispatchId, executionMode, smartTaskId || undefined);
  if (
    executionMode === 'smart'
    && params
    && isSmartMemberInboundCoordinatorDispatch({
      coordinatorRoleId: params.coordinatorRoleId,
      targetRoleId: roleDispatchId,
      promptVariant: params.promptVariant,
      userMsg: userMsg as never,
    })
  ) {
    key = `${key}${SMART_MEMBER_INBOUND_COORDINATOR_INFLIGHT_SUFFIX}`;
  }
  return key;
}

function resolveMentionDispatchRoundId(
  userMsg: RoomMessage,
  coalescedFromUserMsgIds: string[] | undefined,
  input: {
    executionMode: 'smart' | 'workflow';
    isCoordinator: boolean;
    triggerFromMemberAgent: boolean;
  },
): string {
  if (input.executionMode !== 'smart') return userMsg.id;
  return resolveSmartMentionDispatchRoundId(userMsg, coalescedFromUserMsgIds, {
    memberInboundCoordinator: input.isCoordinator && input.triggerFromMemberAgent,
  });
}

/** Smart / Workflow：sessionsSend 开轮成功后发群聊极速 ack（dispatch 入口不再提前发）。 */
export async function publishSmartMentionFastAck(input: {
  params: Parameters<typeof dispatchSingleRoleMentionReplyInner>[1];
  userMsg: RoomMessage;
  members: ProjectMember[];
  member: ProjectMember;
  coalescedFromUserMsgIds?: string[];
}): Promise<void> {
  const { params, userMsg, members, member, coalescedFromUserMsgIds } = input;
  const roles = members.map((m) => normalizeProjectMember(m));
  const role = normalizeProjectMember(member, roles);
  const focus = params.focusTask
    ? await loadFocusTaskForScenario(params.scenarioId, params.focusTask as never)
    : null;
  const executionMode = focus ? taskExecutionMode(focus) : 'workflow';
  const isCoordinator = memberIsCoordinator(role, params.coordinatorRoleId);
  const triggerFromMemberAgent =
    userMsg.from === 'agent'
    && !!userMsg.fromAgentId
    && userMsg.fromAgentId !== params.coordinatorRoleId;
  const skipFastAck = shouldSkipRoomMentionFastAck({
    isCoordinator,
    promptVariant: params.promptVariant,
    executionMode,
    triggerFromSystem: userMsg.from === 'system',
  });
  if (skipFastAck) {
    mentionDispatchLog('fast-ack-skipped', {
      role: role.name,
      roleId: role.id,
      taskId: focus?.id ?? userMsg.projectId,
      reason: isCoordinator
        ? 'coordinator'
        : userMsg.from === 'system'
          ? 'system-trigger'
          : (params.promptVariant ?? 'policy'),
    });
    return;
  }

  const mentionRoundId = resolveMentionDispatchRoundId(userMsg, coalescedFromUserMsgIds, {
    executionMode,
    isCoordinator,
    triggerFromMemberAgent,
  });
  const ackId = `room-ack-${mentionRoundId}-${role.id}`;
  const quoteForPrompt = params.replyQuote ?? {
    fromLabel: roomMessageSpeakerLabel(userMsg, roles, { user: '用户', system: '系统' }),
    preview: roomMessageReplyPreview(userMsg),
  };
  const fastAck = buildFastAckRoomContent(quoteForPrompt.preview);
  const publishResult = await publishMentionRoleReply(
    {
      scenarioId: params.scenarioId,
      scenario: params.scenario as never,
      focusTask: params.focusTask,
    },
    role,
    userMsg,
    fastAck,
    {
      messageId: ackId,
      supplementary: true,
      forceAppend: true,
    },
  );
  mentionDispatchLog(
    publishResult === 'appended'
      ? 'fast-ack-published'
      : publishResult === 'deduped'
        ? 'fast-ack-deduped'
        : 'fast-ack-skipped',
    {
      role: role.name,
      roleId: role.id,
      taskId: focus?.id ?? userMsg.projectId,
      ackId,
      roundId: mentionRoundId,
      result: publishResult,
    },
  );
}

/** Smart 协调者 member-inbound：sessionsSend 开轮成功后发 receipt ack（正文仅 ack；引用走 replyToId）。 */
async function publishSmartCoordinatorPostSendAck(input: {
  publishParams: {
    scenarioId: string;
    scenario: Parameters<typeof publishMentionRoleReply>[0]['scenario'];
    focusTask: OfficeTempProject | null;
  };
  coordinator: ProjectMember;
  roomHistory: RoomMessage[];
  coalescedFromUserMsgIds: string[];
  mentionRoundId: string;
  projectId: string;
}): Promise<void> {
  const uniqueTriggerIds = [
    ...new Set(input.coalescedFromUserMsgIds.map((id) => id.trim()).filter(Boolean)),
  ];
  if (uniqueTriggerIds.length === 0) return;

  const historyById = new Map(input.roomHistory.map((m) => [m.id, m]));
  const ackBody = ROOM_COORDINATOR_RECEIPT_ACK_TEXT;

  for (const triggerId of uniqueTriggerIds) {
    if (
      coordinatorReceiptAckExistsForMemberReport({
        roomMessages: input.roomHistory,
        coordinatorAgentId: input.coordinator.agentId,
        triggerMsgId: triggerId,
      })
    ) {
      mentionDispatchLog('post-send-ack-skipped', {
        taskId: input.projectId,
        triggerMsgId: triggerId,
        reason: 'already-published',
      });
      continue;
    }

    let triggerMsg = historyById.get(triggerId);
    if (!triggerMsg) {
      const recent = await getRoomMessages(input.projectId);
      triggerMsg = recent.find((m) => m.id === triggerId);
    }
    if (!triggerMsg) {
      mentionDispatchLog('post-send-ack-skipped', {
        taskId: input.projectId,
        triggerMsgId: triggerId,
        reason: 'trigger-not-found',
      });
      continue;
    }

    const ackId = `room-ack-postsend-${triggerId}-${input.coordinator.id}`;
    const publishResult = await publishMentionRoleReply(
      input.publishParams,
      input.coordinator,
      triggerMsg,
      ackBody,
      {
        messageId: ackId,
        supplementary: true,
        forceAppend: true,
      },
    );
    mentionDispatchLog(
      publishResult === 'appended'
        ? 'post-send-ack-published'
        : publishResult === 'deduped'
          ? 'post-send-ack-deduped'
          : 'post-send-ack-skipped',
      {
        role: input.coordinator.name,
        roleId: input.coordinator.id,
        taskId: input.projectId,
        ackId,
        roundId: input.mentionRoundId,
        triggerMsgId: triggerId,
        reporterRoleId: triggerMsg.fromAgentId,
        result: publishResult,
      },
    );
  }
}

function coalesceSmartMentionDispatch(
  key: string,
  work: SmartMentionDispatchWork,
): string {
  const prev = smartMentionPendingByKey.get(key);
  const prevRoleId = memberRoleDispatchId(prev?.member ?? { id: '', agentId: '' });
  const incomingRoleId = memberRoleDispatchId(work.member);
  if (prev && prevRoleId && incomingRoleId && prevRoleId !== incomingRoleId) {
    const splitKey = `${key}@${incomingRoleId}`;
    mentionDispatchLog('coalesce-split-role', {
      key,
      splitKey,
      prevMember: prev.member.name,
      prevMemberId: prevRoleId,
      incomingMember: work.member.name,
      incomingMemberId: incomingRoleId,
    });
    return coalesceSmartMentionDispatch(splitKey, work);
  }
  smartMentionPendingByKey.set(
    key,
    prev ? mergeSmartMentionDispatchWork(prev, work) : work,
  );
  const merged = smartMentionPendingByKey.get(key);
  mentionDispatchLog('coalesce-merged', {
    key,
    role: work.member.name,
    roleId: work.member.id,
    batchSize: merged?.coalescedFromUserMsgIds.length,
    triggers: merged?.coalescedFromUserMsgIds.join(','),
    promptVariant: merged?.params.promptVariant,
  });
  return key;
}

export type MentionDispatchHooks = {
  /** Smart 规则 7：成员无分工时点名协调者继续处理。 */
  escalateToCoordinator?: (
    coordinator: ProjectMember,
    ctx?: { failedRoleName: string; failDetail: string; supervision?: boolean },
  ) => Promise<void>;
  dispatchFollowUpMentions?: (
    fromRole: ProjectMember,
    replyText: string,
    sourceMessageId: string,
  ) => Promise<void>;
  auditMissingMentions?: (posted: RoomMessage) => void;
};

import {
  buildMentionTaskContextForViewer,
  loadFocusTaskForScenario,
} from './mention-task-context';

function resolveRoomTaskId(
  focusTask: Pick<OfficeTempProject, 'id'> | null | undefined,
  userMsg?: Pick<RoomMessage, 'projectId'>,
): string {
  const id = focusTask?.id ?? userMsg?.projectId?.trim();
  if (!id) throw new Error('Office room requires a project (projectId)');
  return id;
}

export function buildUnassignedMemberEscalationReply(
  coordinatorName: string,
  triggerPreview: string,
  mode: 'smart' | 'workflow',
): string {
  const quote = triggerPreview.trim() || '（见上条群聊）';
  const excerpt = quote.length > 160 ? `${quote.slice(0, 159)}…` : quote;
  const ask =
    mode === 'smart'
      ? '我这边尚未收到协调者分工'
      : '我这边尚未查到本步骤分工或分工未初始化';
  return joinInlineQuotedReply(excerpt, `${ask}，@${coordinatorName} 请指派或补充分工。`);
}

export function buildLlmFailureCoordinatorReply(
  coordinatorName: string,
  roleName: string,
  detail: string,
): string {
  const reason = detail.trim() || '模型调用失败';
  return joinInlineQuotedReply(
    `【${roleName}】处理请求`,
    `@${coordinatorName} 处理请求时失败：${reason.slice(0, 200)}，请协调者介入。`,
    { tag: 'quoteCoord' },
  );
}

export function buildRoomMentionFailureReport(
  roleName: string,
  detail: string,
  retried: boolean,
  opts?: { validation?: boolean },
): string {
  const suffix = retried ? '（已自动重试 1 次仍不合格）' : '';
  const kind = opts?.validation === false ? '处理失败' : '模型回复未通过格式校验';
  return `【${roleName}】${kind}${suffix}：${detail.slice(0, 280)}`;
}

function activateSmartTaskOnCoordinatorDispatch(
  gateway: GatewayManager,
  ctx: {
    scenarioId: string;
    scenario: Pick<OfficeFixedGroup, 'workflow' | 'agentIds' | 'coordinatorAgentId'>;
    focus: OfficeTempProject;
    coordinator: ProjectMember;
    teamRoles: ProjectMember[];
    replyText: string;
    userMsg: RoomMessage;
    source: 'final_publish';
  },
): Promise<void> {
  const roster = ctx.teamRoles.map((m) => normalizeProjectMember(m, ctx.teamRoles));
  const coordinator = normalizeProjectMember(ctx.coordinator, roster);
  const group = mentionGroupContext(ctx.scenario, ctx.focus);
  if (!group) return Promise.resolve();

  void ensureSmartTaskRunningAfterCoordinatorDispatch(gateway, {
    groupId: ctx.scenarioId,
    group: {
      id: ctx.scenarioId,
      workflow: group.workflow,
      agentIds: group.agentIds,
    },
    project: ctx.focus,
    coordinator: {
      agentId: coordinator.agentId,
      displayName: coordinator.name,
    },
    coordinatorReplyText: ctx.replyText,
    teamMembers: roster.map((m) => ({
      agentId: m.agentId,
      displayName: m.name,
    })),
    kickoffTimestamp: ctx.userMsg.timestamp,
    userInitiated: ctx.userMsg.from === 'user',
  }).catch((err) => {
      console.warn(
        '[office] smart task activate on coordinator dispatch failed:',
        ctx.focus.id,
        err,
      );
    });
  return Promise.resolve();
}

export async function dispatchSmartMemberFollowUpIfNeeded(
  finalText: string,
  ctx: {
    executionMode: ReturnType<typeof taskExecutionMode>;
    isCoordinator: boolean;
    coordinator: ProjectMember | undefined;
    member: ProjectMember;
    hooks: MentionDispatchHooks;
    primaryId: string;
    projectId?: string;
    groupId?: string;
  },
): Promise<void> {
  const { executionMode, isCoordinator, coordinator, member, hooks, primaryId } = ctx;
  const role = member;
  const parsed = executionMode === 'smart' ? parseRoomMentionStructuredReply(finalText) : null;
  const dispatchText = parsed?.dispatch?.trim() ?? '';
  const coordinatorAction =
    executionMode === 'smart' && isCoordinator
      ? parseSmartCoordinatorAction(finalText.trim())
      : null;
  const followUpText =
    executionMode === 'smart'
      ? dispatchText
      : finalText;
  const coordinatorDispatchFollowUp =
    executionMode === 'smart'
    && isCoordinator
    && coordinatorAction === 'assign'
    && hasSmartCoordinatorStructuredDispatch(finalText.trim());
  const shouldFollowUp =
    Boolean(followUpText.trim())
    && (
    isSubstantiveRoomMentionReply(followUpText, {
      smartMember: executionMode === 'smart' && !isCoordinator,
    })
    || (
      executionMode === 'smart'
      && !isCoordinator
      && coordinator
      && smartMemberReplyMentionsCoordinator(dispatchText, coordinator)
    )
    || coordinatorDispatchFollowUp
    );
  if (!shouldFollowUp) return;
  mentionDispatchLog('member-follow-up', {
    fromRole: role.name,
    fromAgentId: role.agentId,
    primaryId,
    mentionsCoordinator:
      !!coordinator && smartMemberReplyMentionsCoordinator(dispatchText, coordinator),
    isCoordinator,
  });
  try {
    // 跟进派发须传完整 JSON/括号文（含 dispatch 数组），勿只传 dispatch 段纯文本，否则 pickRoles 可能解析失败。
    await hooks.dispatchFollowUpMentions?.(role, finalText.trim(), primaryId);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn('[office] role follow-up dispatch failed:', role.id, err);
    if (ctx.projectId?.trim()) {
      const { recordSmartAssignFollowUpError } = await import('./smart-assign-ledger');
      const { appendRoomMessage } = await import('./store');
      await recordSmartAssignFollowUpError(ctx.projectId, primaryId, detail);
      await appendRoomMessage({
        id: `room-${Date.now()}-smart-followup-err`,
        groupId: ctx.groupId,
        projectId: ctx.projectId,
        from: 'system',
        content: `【系统】成员派活跟进失败：${detail.slice(0, 400)}。请协调者检查 dispatch 后重新 assign。`,
        mentions: [],
        timestamp: Date.now(),
      }).catch(() => undefined);
    }
  }
}

/** Smart：follow-up 只启动后续派发，不能 await 子 Session，否则协调者↔成员 waitForReplies 互等会死锁。 */
async function settleMentionFollowUp(
  executionMode: ReturnType<typeof taskExecutionMode>,
  followUpPromise: Promise<void>,
  roleId: string,
): Promise<void> {
  if (executionMode === 'smart') {
    void followUpPromise.catch((err) => {
      console.warn('[office] smart follow-up failed:', roleId, err);
    });
    return;
  }
  await followUpPromise;
}

async function dispatchSingleRoleMentionReplyInner(
  gateway: GatewayManager,
  params: {
    scenarioId: string;
    coordinatorAgentId: string;
    content: string;
    scenarioName: string;
    focusTask: OfficeTempProject | null;
    scenario: Pick<OfficeFixedGroup, 'workflow' | 'coordinatorAgentId' | 'agentIds'> | null;
    /** @deprecated v2 alias — same as coordinatorAgentId */
    coordinatorRoleId: string;
    replyQuote: { fromLabel: string; preview: string } | null;
    roomContext: string | null;
    promptVariant?: MentionPromptVariant;
    missingMention?: MissingMentionDispatchContext;
    /** Smart：用户 @ 的成员显示名（成员不响应，协调者兜底） */
    smartUserMentionedMemberNames?: string[];
    /** Smart：上游模型原始 JSON（派活/校验用，群聊 content 仅展示） */
    smartJsonRaw?: string;
  },
  userMsg: RoomMessage,
  members: ProjectMember[],
  member: ProjectMember,
  options: {
    initialTimeoutMs: number;
    allowSupplementary: boolean;
    /** Smart 同 task+role 合并点名时的全部 trigger 消息 id（用于 Session 幂等键）。 */
    coalescedFromUserMsgIds?: string[];
    /** Smart abort/fresh 捕获的 generation；不匹配则放弃派发。 */
    smartDispatchGeneration?: number;
  },
  hooks: MentionDispatchHooks = {},
): Promise<void> {
  const roles = members.map((m) => normalizeProjectMember(m));
  const role = normalizeProjectMember(member, roles);
  const roomTaskId = resolveRoomTaskId(params.focusTask, userMsg);
  const smartTaskIdForStale = resolveSmartMentionCoalesceTaskId(userMsg, params.focusTask);
  if (
    smartTaskIdForStale
    && options.smartDispatchGeneration !== undefined
    && isStaleSmartMentionDispatch(smartTaskIdForStale, options.smartDispatchGeneration)
  ) {
    mentionDispatchLog('dispatch-stale-inner-abort', {
      role: role.name,
      taskId: smartTaskIdForStale,
      triggerMsgId: userMsg.id,
      generation: options.smartDispatchGeneration,
    });
    return;
  }
  const ensureCurrentGeneration = (stage: string): boolean => {
    if (
      !smartTaskIdForStale
      || options.smartDispatchGeneration === undefined
      || !isStaleSmartMentionDispatch(smartTaskIdForStale, options.smartDispatchGeneration)
    ) {
      return true;
    }
    mentionDispatchLog('dispatch-stale-publish-abort', {
      role: role.name,
      roleId: role.id,
      taskId: smartTaskIdForStale,
      triggerMsgId: userMsg.id,
      generation: options.smartDispatchGeneration,
      stage,
    });
    return false;
  };
  const roomKey = taskRoomSessionKey(params.coordinatorAgentId, roomTaskId);
  const targetKey = roleDmSessionKey(role.agentId, role.id, roleTaskRoomDmSuffix(roomTaskId));
  const focus = params.focusTask
    ? await loadFocusTaskForScenario(params.scenarioId, params.focusTask as never)
    : null;
  const executionModeEarly = focus ? taskExecutionMode(focus) : 'workflow';
  const isCoordinator = memberIsCoordinator(role, params.coordinatorRoleId);
  const triggerFromMemberAgent =
    userMsg.from === 'agent'
    && !!userMsg.fromAgentId
    && userMsg.fromAgentId !== params.coordinatorRoleId;
  const mentionRoundId = resolveMentionDispatchRoundId(
    userMsg,
    options.coalescedFromUserMsgIds,
    {
      executionMode: executionModeEarly,
      isCoordinator,
      triggerFromMemberAgent,
    },
  );
  const primaryId = `room-mention-${mentionRoundId}-${role.id}`;
  const teammateNames = roles.map((r) => r.name);

  const speakerLabel = roomMessageSpeakerLabel(userMsg, roles, {
    user: '用户',
    system: '系统',
  });
  const quoteForPrompt = params.replyQuote ?? {
    fromLabel: speakerLabel,
    preview: roomMessageReplyPreview(userMsg),
  };

  const publishParams = {
    scenarioId: params.scenarioId,
    scenario: scenarioDispatchCompat(params.scenario) as never,
    focusTask: params.focusTask as never,
  };

  const skipFastAck = shouldSkipRoomMentionFastAck({
    isCoordinator,
    promptVariant: params.promptVariant,
    executionMode: params.focusTask ? taskExecutionMode(params.focusTask) : 'workflow',
    triggerFromSystem: userMsg.from === 'system',
  });

  // fast ack / receipt ack 在 sessionsSend 开轮成功后发送；此处 skip 标记供 prompt。

  try {
    const executionMode = executionModeEarly;
    const roomHistory = await getRoomMessages(roomTaskId);
    if (
      executionMode === 'smart'
      && !isCoordinator
      && shouldSkipSmartMemberDispatchAfterCompletedReport({
        memberAgentId: role.agentId,
        roomMessages: roomHistory,
        projectId: roomTaskId,
        triggerMsg: userMsg,
      })
    ) {
      mentionDispatchLog('dispatch-member-end-redispatch-skip-inner', {
        taskId: roomTaskId,
        triggerMsgId: userMsg.id,
        memberRoleId: role.id,
        memberRoleName: role.name,
      });
      return;
    }
    const coordinator = roles.find((r) => r.id === params.coordinatorRoleId);

    let assignment = focus
      ? await resolveRoleAssignment({
          task: focus as never,
          scenario: scenarioDispatchCompat(params.scenario) as never,
          role,
          teamRoles: roles,
          executionMode,
          isCoordinator,
        })
      : { state: 'unassigned' as const, summary: null, source: 'none' as const };

    const mentionGroup = mentionGroupContext(params.scenario, focus);
    const { taskProgressContext, projectNotebookContext, projectRootDisplay } = focus && mentionGroup
      ? await buildMentionTaskContextForViewer({
          scenarioId: params.scenarioId,
          focus,
          group: mentionGroup,
          roomMessages: roomHistory,
          members: roles.map(dispatchMemberAsProjectAgent),
          viewerAgentId: (role.agentId ?? role.id ?? '').trim(),
          isCoordinator,
        })
      : { taskProgressContext: null, projectNotebookContext: null, projectRootDisplay: null };

    let needsDecomposition =
      executionMode === 'smart'
      && isCoordinator
      && params.promptVariant === 'coordinator_kickoff_decompose';
    if (
      focus
      && isCoordinator
      && executionMode === 'smart'
      && params.promptVariant !== 'coordinator_member_failure'
      && params.promptVariant !== 'coordinator_member_supervision'
      && params.promptVariant !== 'coordinator_member_report'
      && params.promptVariant !== 'coordinator_kickoff_decompose'
      && !triggerFromMemberAgent
    ) {
      const coordAgent = roles.find((r) => r.id === params.coordinatorRoleId);
      if (coordAgent) {
        const { resolveCoordinatorPathContext } = await import('./project-context-paths');
        const notebook = await readProjectProgress(
          await resolveCoordinatorPathContext(
            { coordinatorAgentId: coordAgent.agentId },
            roles.map((m) => ({ agentId: m.agentId, displayName: m.name })),
          ),
          focus.title,
          focus.id,
        );
        needsDecomposition = smartCoordinatorNeedsDecomposition(notebook, {
          roomMessages: roomHistory,
          coordinatorRoleId: params.coordinatorRoleId,
          taskId: focus.id,
        });
      }
    }

    const roomContext = buildStructuredRoomContextForMention(roomHistory, roles, {
      upToMessageId: userMsg.id,
      triggerMessageId: userMsg.id,
      coordinatorRoleId: params.coordinatorRoleId,
      executionMode,
      isCoordinator,
    });

    const broadcastUnmentioned =
      params.promptVariant === 'coordinator_broadcast_unmentioned' && isCoordinator;
    const userMentionMemberRedirect =
      params.promptVariant === 'coordinator_user_mention_member' && isCoordinator;
    const missingMentionCorrection =
      params.promptVariant === 'coordinator_missing_mention'
      && isCoordinator
      && params.missingMention;

    let effectivePromptVariant = params.promptVariant;
    if (
      !effectivePromptVariant
      && executionMode === 'workflow'
      && focus
      && params.scenario
      && isWorkflowUpstreamClarificationMessage(userMsg)
    ) {
      const speakerRoleId = resolveWorkflowMentionSpeakerRoleId({
        teamRoles: roles as never,
        message: userMsg as never,
      });
      const wf = workflowForTask(focus, params.scenario);
      if (
        speakerRoleId
        && isWorkflowUpstreamClarificationTarget({
          message: userMsg as never,
          speakerRoleId,
          targetRoleId: role.id,
          coordinatorRoleId: params.coordinatorRoleId,
          nodes: wf.nodes,
          edges: wf.edges,
          nodeRuns: focus.nodeRuns,
          teamRoles: roles as never,
        })
      ) {
        effectivePromptVariant = 'workflow_upstream_clarification';
      }
    }

    const coordinatorRoomLine =
      (userMsg.progressText ?? userMsg.content ?? params.content ?? '').trim()
      || (quoteForPrompt.preview ?? '').trim()
      || '（见本次点名）';
    const coordinatorJsonRaw = resolveSmartJsonRawFromMentionTrigger(
      userMsg,
      params.content,
      params.smartJsonRaw,
    );
    const promptRoomLine =
      executionMode === 'smart' && isCoordinator
        ? coordinatorRoomLine
        : (params.content ?? '').trim() || coordinatorRoomLine;
    const smartMemberReadiness =
      executionMode === 'smart' && !isCoordinator
        ? resolveSmartMemberReadinessForMentionDispatch({
            coordinatorRoomLine: coordinatorJsonRaw,
            mentionTargetRole: {
              agentId: role.agentId,
              displayName: role.name,
            },
          })
        : undefined;

    const memberReportJsonRaw = resolveSmartJsonRawFromMentionTrigger(
      userMsg,
      params.content,
      params.smartJsonRaw,
    );
    const smartMemberReportKind =
      executionMode === 'smart' && isCoordinator && triggerFromMemberAgent
        ? classifySmartMemberReportToCoordinator(memberReportJsonRaw)
        : undefined;

    if (
      !effectivePromptVariant
      && executionMode === 'smart'
      && isCoordinator
      && triggerFromMemberAgent
    ) {
      effectivePromptVariant = 'coordinator_member_report';
    }

    if (
      executionMode === 'smart'
      && isCoordinator
      && (triggerFromMemberAgent || effectivePromptVariant === 'coordinator_member_report')
    ) {
      needsDecomposition = false;
    }

    const smartWorkSteps =
      executionMode === 'smart' && focus && params.scenario
        ? resolveSmartWorkOrderSteps(
            params.scenario,
            focus.description,
            roles.map(dispatchMemberAsProjectAgent),
          )
        : [];
    const smartNextExecutorRoleIds =
      executionMode === 'smart' && focus
        ? resolveSmartNextExecutorRoleIds({
            steps: smartWorkSteps,
            roomMessages: roomHistory,
            taskId: focus.id,
          })
        : [];
    const smartNextExecutorRoleId = smartNextExecutorRoleIds[0] ?? null;
    const smartNextExecutorNames =
      executionMode === 'smart' && isCoordinator && smartNextExecutorRoleIds.length > 0
        ? smartNextExecutorRoleIds
            .map((id) => roles.find((r) => r.id === id)?.name ?? id)
            .join('、')
        : undefined;

    let memberReportDiskHint = '';
    let smartAllowReporterFixRoleId: string | null = null;
    let smartAllowUpstreamProducerRoleId: string | null = null;
    if (
      executionMode === 'smart'
      && isCoordinator
      && effectivePromptVariant === 'coordinator_member_failure'
      && userMsg.fromAgentId
    ) {
      smartAllowReporterFixRoleId = userMsg.fromAgentId;
    }
    if (
      executionMode === 'smart'
      && isCoordinator
      && smartMemberReportKind === 'input_validation_failed'
      && focus
    ) {
      const speakerId = userMsg.fromAgentId;
      if (speakerId && smartWorkSteps.length > 0) {
        smartAllowUpstreamProducerRoleId = resolveSmartPriorProducerRoleId(
          speakerId,
          smartWorkSteps,
        );
      }
    }
    if (
      executionMode === 'smart'
      && isCoordinator
      && smartMemberReportKind === 'subtask_done'
      && focus
      && params.scenario
    ) {
      const speakerId = userMsg.fromAgentId;
      const speaker = speakerId ? roles.find((r) => r.id === speakerId) : undefined;
      if (speaker) {
        const triggerRaw = memberReportJsonRaw;
        const disk = await verifySmartMentionStructuredPathsOnDisk({
          raw: triggerRaw,
          task: focus as never,
          scenario: params.scenario as never,
          role: speaker,
          teamRoles: roles,
          requireDeliverableFile: true,
          roomMessages: roomHistory,
          steps: smartWorkSteps,
          isCoordinator: true,
          memberReportRaw: triggerRaw,
        });
        if (!disk.ok) {
          memberReportDiskHint = `【引擎·交付核验未通过】${disk.detail}`;
          smartAllowReporterFixRoleId = speaker.id;
        } else if (disk.lsLines.length > 0) {
          const rootLine = disk.projectRoot
            ? `【引擎·项目目录】${disk.projectRoot}\n`
            : '';
          memberReportDiskHint = `${rootLine}【引擎·路径 ls -l】\n${disk.lsLines.join('\n')}`;
        }
      }
    }

    if (
      executionMode === 'smart'
      && isCoordinator
      && !triggerFromMemberAgent
      && focus
      && smartWorkSteps.length > 0
      && smartNextExecutorRoleIds.length > 0
    ) {
      const upstreamPaths = collectSmartUpstreamDeliverablePathHints({
        roomMessages: roomHistory,
        taskId: focus.id,
        steps: smartWorkSteps,
        beforeRoleId: smartNextExecutorRoleIds[0]!,
      });
      if (upstreamPaths.length > 0) {
        const upstreamDisk = await verifySmartUpstreamDeliverablePathsOnDisk(upstreamPaths, {
          task: focus as never,
          scenario: params.scenario! as never,
          role,
          teamRoles: roles,
        });
        if (!upstreamDisk.ok) {
          memberReportDiskHint = `【引擎·上一跳交付核验】${upstreamDisk.detail}`;
        } else if (upstreamDisk.lsLines.length > 0) {
          const rootLine = upstreamDisk.projectRoot
            ? `【引擎·项目目录】${upstreamDisk.projectRoot}\n`
            : '';
          memberReportDiskHint = `${rootLine}【引擎·上一跳交付 ls -l】\n${upstreamDisk.lsLines.join('\n')}`;
        }
      }
    }

    let agentBody = userMentionMemberRedirect
      ? (buildRoomCoordinatorUserMentionMemberPrompt({
          coordinator: role,
          roomLine: promptRoomLine,
          scenario: { name: params.scenarioName },
          task: focus as never,
          teammateNames,
          teamRoles: executionMode === 'smart' ? (roles as never) : undefined,
          coordinatorRoleId: params.coordinatorRoleId,
          replyQuote: quoteForPrompt,
          roomContext,
          taskProgressContext,
          projectNotebookContext,
          currentAssignableRoleNames: smartNextExecutorNames,
          speakerLabel,
          executionMode: executionMode === 'smart' ? 'smart' : undefined,
          triggerFromUser: true,
          mentionedMemberNames: params.smartUserMentionedMemberNames ?? [],
        }) as never)
      : broadcastUnmentioned
      ? buildRoomCoordinatorUnmentionedPrompt({
          coordinator: role,
          roomLine: promptRoomLine,
          scenario: { name: params.scenarioName },
          task: focus as never,
          teammateNames,
          teamRoles: executionMode === 'smart' ? (roles as never) : undefined,
          coordinatorRoleId: params.coordinatorRoleId,
          replyQuote: quoteForPrompt,
          roomContext,
          taskProgressContext,
          projectNotebookContext,
          currentAssignableRoleNames: smartNextExecutorNames,
          speakerLabel,
          executionMode,
          triggerFromUser: executionMode === 'smart' && userMsg.from === 'user',
        } as never)
      : missingMentionCorrection
        ? buildRoomCoordinatorMissingMentionPrompt({
            coordinator: role,
            speakerRoleName: params.missingMention!.speakerRoleName,
            speakerExcerpt: params.missingMention!.speakerExcerpt,
            missingRoleNames: params.missingMention!.missingRoleNames,
            scenario: { name: params.scenarioName },
            task: focus as never,
            executionMode,
            teamRoles: executionMode === 'smart' ? (roles as never) : undefined,
            coordinatorRoleId: params.coordinatorRoleId,
            roomContext,
            taskProgressContext,
            projectNotebookContext,
            currentAssignableRoleNames: smartNextExecutorNames,
          } as never)
        : buildRoomMentionAgentPrompt({
            role,
            roomLine:
              executionMode === 'smart' && !isCoordinator
                ? buildSmartMemberDispatchAssignment(
                    resolveSmartJsonRawFromMentionTrigger(
                      userMsg,
                      params.content,
                      params.smartJsonRaw,
                    ),
                    { id: role.id, name: role.name },
                    (params.content ?? userMsg.content ?? quoteForPrompt.preview ?? '').trim(),
                  )
                : executionMode === 'smart' && isCoordinator && triggerFromMemberAgent && memberReportJsonRaw
                  ? memberReportJsonRaw
                  : promptRoomLine,
            scenario: { name: params.scenarioName },
            task: focus as never,
            teammateNames,
            replyQuote: quoteForPrompt,
            roomContext,
            taskProgressContext,
            projectNotebookContext,
            projectRootDisplay,
            speakerLabel,
            isCoordinator,
            executionMode,
            coordinatorRoleId: params.coordinatorRoleId,
            coordinatorName: coordinator?.name,
            smartMemberReadiness,
            memberReportKind: smartMemberReportKind,
            fastAckAlreadyPosted: !skipFastAck,
            needsDecomposition,
            assignmentSummary:
              executionMode === 'workflow' && !isCoordinator
                ? null
                : assignment.summary,
            promptVariant: effectivePromptVariant,
            smartNextExecutorRoleIds:
              executionMode === 'smart' && isCoordinator ? smartNextExecutorRoleIds : undefined,
            smartNextExecutorRoleId:
              executionMode === 'smart' && isCoordinator ? smartNextExecutorRoleId : undefined,
            smartNextExecutorNames,
            teamRoles:
              executionMode === 'smart' && isCoordinator
                ? roles.map((r) => ({ id: r.id, name: r.name }))
                : undefined,
            triggerFromUser:
              executionMode === 'smart' && isCoordinator && userMsg.from === 'user',
            smartUserMentionedMemberNames: params.smartUserMentionedMemberNames,
          } as never);

    // Smart 协调者：成员汇报/引擎核验提示追加至 prompt，便于合并批次决策。
    if (memberReportDiskHint) {
      agentBody = `${agentBody}\n\n${memberReportDiskHint}`;
    }

    const sessionIdempotencyKey =
      executionMode === 'smart'
        ? smartMentionSessionIdempotencyKey(mentionRoundId, role.id, false)
        : `room-mention-${userMsg.id}-${role.id}`;
    const sessionRetryIdempotencyKey =
      executionMode === 'smart'
        ? smartMentionSessionIdempotencyKey(mentionRoundId, role.id, true)
        : `room-mention-retry-${userMsg.id}-${role.id}`;

    const memberInboundCoordinator =
      isCoordinator
      && isSmartMemberInboundCoordinatorDispatch({
        coordinatorRoleId: params.coordinatorRoleId,
        targetRoleId: role.id,
        promptVariant: effectivePromptVariant,
        userMsg: userMsg as never,
      });
    mentionDispatchLog('session-send', {
      role: role.name,
      roleId: role.id,
      projectId: focus?.id ?? roomTaskId,
      roundId: mentionRoundId,
      idempotencyKey: sessionIdempotencyKey,
      promptVariant: effectivePromptVariant,
      memberInbound: memberInboundCoordinator,
      triggerFromMember: triggerFromMemberAgent,
      coalescedCount: options.coalescedFromUserMsgIds?.length ?? 1,
      triggerMsgId: userMsg.id,
      replyToId: userMsg.replyToId,
    });

    const { runWithOfficeRoleWorkspacePrepared } = await import('./agent-setup');

    const sessionStartedAt = Date.now();
    let sessionMdSync: import('./office-agent-session-md-export').OfficeAgentSessionMdSyncHandle | null =
      null;
    let sessionRunIdCaptured = false;
    if (executionMode === 'smart' && focus) {
      const { resolveOfficeProjectRootForSessionMd } = await import('./project-context-paths');
      const { startOfficeAgentSessionMdSync } = await import('./office-agent-session-md-export');
      const { mkdir } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const { expandPath } = await import('../../utils/paths');
      const projectRoot = await resolveOfficeProjectRootForSessionMd(focus as never);
      const { OFFICE_PROJECT_SESSION_DIR } = await import('./office-project-session-dir');
      await mkdir(join(expandPath(projectRoot), OFFICE_PROJECT_SESSION_DIR), { recursive: true });
      sessionMdSync = startOfficeAgentSessionMdSync({
        gateway,
        sessionKey: targetKey,
        projectRoot,
        roleDisplayName: role.displayName.trim() || role.name.trim() || role.agentId,
        startedAtMs: sessionStartedAt,
      });
    }

    let llm: Awaited<ReturnType<typeof fetchRoomMentionLlmReplyWithRetry>> | undefined;
    let mentionFetchError: unknown;
    try {
      llm = await runWithOfficeRoleWorkspacePrepared(role, members, () =>
        fetchRoomMentionLlmReplyWithRetry(gateway, {
      roomKey,
      targetKey,
      targetAgentId: role.agentId,
      roleName: role.name,
      agentBody,
      idempotencyKey: sessionIdempotencyKey,
      retryIdempotencyKey: sessionRetryIdempotencyKey,
      timeoutMs: options.initialTimeoutMs,
      executionMode,
      isCoordinator,
      needsDecomposition,
      allowCoordinatorSilentNoReply: broadcastUnmentioned,
      requireMentionsInPublish: !!missingMentionCorrection,
      coordinatorRole:
        executionMode === 'smart' && coordinator && !isCoordinator
          ? { id: coordinator.id, name: coordinator.name }
          : undefined,
      smartMemberReadiness,
      promptVariant: effectivePromptVariant,
      triggerFromMemberAgent: isCoordinator ? triggerFromMemberAgent : undefined,
      coordinatorRoleId: params.coordinatorRoleId,
      smartNextExecutorRoleIds,
      smartNextExecutorRoleId,
      smartAllowReporterFixRoleId,
      smartAllowUpstreamProducerRoleId,
      viewerRoleId: role.id,
      taskId: focus?.id,
      smartWorkSteps,
      roomMessages: roomHistory,
      memberReportRaw:
        isCoordinator && triggerFromMemberAgent
          ? memberReportJsonRaw
          : undefined,
      reporterRoleId:
        isCoordinator && triggerFromMemberAgent && userMsg.fromAgentId
          ? userMsg.fromAgentId
          : undefined,
      teamRoles: members.map((r) => ({
        id: r.id,
        name: r.name,
        agentId: r.agentId,
      })),
      verifySmartPathsOnDisk:
        executionMode === 'smart' && focus && params.scenario
          ? async (raw) => {
              const reporterRole =
                isCoordinator && triggerFromMemberAgent && userMsg.fromAgentId
                  ? roles.find((r) => r.id === userMsg.fromAgentId) ?? role
                  : undefined;
              const disk = await verifySmartMentionStructuredPathsOnDisk({
                raw,
                task: focus as never,
                scenario: params.scenario! as never,
                role,
                teamRoles: roles,
                requireDeliverableFile:
                  !isCoordinator
                  && smartMemberReadiness === 'ready'
                  && !isSmartMemberHelpAction(raw),
                roomMessages: roomHistory,
                steps: smartWorkSteps,
                isCoordinator,
                memberReportRaw:
                  isCoordinator && triggerFromMemberAgent
                    ? memberReportJsonRaw
                    : undefined,
                inputPathRole: reporterRole,
              });
              return {
                ok: disk.ok,
                detail: disk.detail,
                inputValidationFailed: disk.inputValidationFailed,
              };
            }
          : undefined,
      onSessionRunId: (runId) => {
        if (sessionRunIdCaptured || !runId?.trim()) return;
        sessionRunIdCaptured = true;
        sessionMdSync?.setRunId(runId);
      },
      onPrimarySessionSendOk:
        memberInboundCoordinator && coordinator
          ? async () => {
              await publishSmartCoordinatorPostSendAck({
                publishParams,
                coordinator,
                roomHistory,
                coalescedFromUserMsgIds:
                  options.coalescedFromUserMsgIds?.length
                    ? options.coalescedFromUserMsgIds
                    : [userMsg.id],
                mentionRoundId,
                projectId: focus?.id ?? roomTaskId,
              });
            }
          : !skipFastAck
            ? async () => {
                await publishSmartMentionFastAck({
                  params,
                  userMsg,
                  members: roles,
                  member: role,
                  coalescedFromUserMsgIds: options.coalescedFromUserMsgIds,
                });
              }
            : undefined,
      }),
    );
    } catch (e) {
      mentionFetchError = e;
    } finally {
      try {
        await sessionMdSync?.finish();
      } finally {
        sessionMdSync?.stop();
        sessionMdSync = null;
      }
    }
    if (mentionFetchError) throw mentionFetchError;
    if (!llm) {
      throw new Error('mention LLM fetch returned no result');
    }

    mentionDispatchLog(llm.ok ? 'session-reply-ok' : 'session-reply-fail', {
      role: role.name,
      roleId: role.id,
      projectId: focus?.id ?? roomTaskId,
      roundId: mentionRoundId,
      idempotencyKey: sessionIdempotencyKey,
      memberInbound: memberInboundCoordinator,
      retried: llm.retried,
      issues: !llm.ok ? llm.issues?.join(',') : undefined,
    });

    if (!llm.ok) {
      const failDetail = llm.detail;
      // 语义校验失败不重发模型正文；传输恢复见 room-mention-llm session salvage（完整三层校验）。
      // 例外：blocked 成员仅发引擎合成 action=help JSON（非模型正文）。
      if (
        coordinator
        && !isCoordinator
        && executionMode === 'smart'
        && smartMemberReadiness === 'blocked'
      ) {
        const fallback = synthesizeBlockedMemberDependencyReply(
          { agentId: coordinator.agentId, displayName: coordinator.name },
          params.content,
          { agentId: role.agentId, displayName: role.name },
        );
        if (fallback) {
          if (!ensureCurrentGeneration('blocked-fallback-publish')) return;
          await publishMentionRoleReply(publishParams, role, userMsg, fallback, {
            messageId: primaryId,
            supplementary: true,
            forceAppend: true,
          });
          await dispatchSmartMemberFollowUpIfNeeded(fallback, {
            executionMode,
            isCoordinator,
            coordinator,
            member: role,
            hooks,
            primaryId,
          });
          return;
        }
      }
      if (coordinator && !isCoordinator) {
        if (!ensureCurrentGeneration('member-fail-report')) return;
        const supervision =
          executionMode === 'smart'
          && (llm.issues?.includes('smart_member_in_progress_only')
            || llm.issues?.includes('smart_member_promise_only')
            || llm.issues?.includes('smart_member_missing_deliverable'))
          && !llm.issues?.includes('smart_member_missing_acceptance_ack');
        const failBody = buildLlmFailureCoordinatorReply(
          coordinator.name,
          role.name,
          failDetail,
        );
        await publishMentionRoleReply(publishParams, role, userMsg, failBody, {
          messageId: primaryId,
          supplementary: true,
          forceAppend: true,
        });
        await hooks.escalateToCoordinator?.(coordinator, {
          failedRoleName: role.name,
          failDetail,
          supervision,
        });
        return;
      }

      const { appendRoomMessage } = await import('./store');
      const report = buildRoomMentionFailureReport(role.name, failDetail, llm.retried);
      if (!ensureCurrentGeneration('llm-fail-report')) return;
      await publishMentionRoleReply(publishParams, role, userMsg, report, {
        messageId: primaryId,
        supplementary: true,
        forceAppend: true,
      }).catch(() => undefined);
      await appendRoomMessage({
        id: `room-${Date.now()}-mention-llm-fail`,
        groupId: params.scenarioId,
        projectId: roomTaskId,
        from: 'system',
        content: `【系统】${report}`,
        mentions: [role.agentId],
        timestamp: Date.now(),
      }).catch(() => undefined);
      return;
    }

    const finalText = llm.roomText;
    const silentNoReply =
      executionMode === 'smart' && isCoordinator && llm.raw.trim()
        ? coordinatorDecidedNoReply(
            normalizeSmartMentionRaw(llm.raw, {
              isCoordinator: true,
              actorRoleName: role.name,
            }).raw,
          )
        : coordinatorDecidedNoReply(llm.raw);
    if (!finalText.trim() && silentNoReply) {
      return;
    }

    if (!ensureCurrentGeneration('pre-final-publish')) return;

    const smartCoordinator =
      !!focus && executionMode === 'smart' && isCoordinator;
    const smartCoordinatorEnd =
      smartCoordinator && parseSmartCoordinatorEndFlag((llm.raw ?? finalText).trim());
    const smartMemberEnd =
      !!focus
      && executionMode === 'smart'
      && !isCoordinator
      && parseSmartMemberJsonOutput((llm.raw ?? finalText).trim())?.action === 'end';

    const publishResult = await publishMentionRoleReply(publishParams, role, userMsg, finalText, {
      messageId: primaryId,
      supplementary: false,
      runId: llm.runId,
      forceAppend: smartCoordinator || (executionMode === 'smart' && !isCoordinator),
      smartCoordinatorEnd,
      smartMemberEnd,
      smartJsonRaw:
        executionMode === 'smart' && isSmartJsonShapeText((llm.raw ?? '').trim())
          ? llm.raw.trim()
          : undefined,
    });

    if (
      smartMemberEnd
      && publishResult === 'appended'
      && focus
      && params.scenario
      && ensureCurrentGeneration('smart-member-deliverable-paths')
    ) {
      const { announceSmartMemberDeliverablePaths } = await import('./smart-room-deliverable-paths');
      try {
        await announceSmartMemberDeliverablePaths({
          gateway,
          group: {
            id: params.scenarioId,
            coordinatorAgentId: params.coordinatorAgentId,
          },
          project: focus,
          memberAgentId: role.agentId,
          memberDisplayName: role.name,
          raw: (llm.raw ?? '').trim(),
          afterMemberMessageId: primaryId,
        });
      } catch (err) {
        console.warn('[office] smart member deliverable paths announce failed:', role.id, err);
      }
    }

    // Smart 结项：store 副作用（deferSideEffects）与显式 finalize 共用 mutex，dedup 时副作用不会重跑。
    if (
      smartCoordinatorEnd
      && publishResult !== 'skipped'
      && focus
      && params.scenario
      && ensureCurrentGeneration('smart-coordinator-closure-finalize')
    ) {
      const { finalizeSmartTaskClosure } = await import('./smart-task-completion');
      void finalizeSmartTaskClosure({
        projectId: focus.id,
        coordinatorReply: (llm.raw ?? finalText).trim(),
        groupId: params.scenarioId,
        gateway,
        coordinatorAgentId: params.coordinatorAgentId,
        steps: smartWorkSteps,
        declaredProjectEnd: true,
        closureMessageId: primaryId,
        forceCoordinatorProjectEnd: llm.ok ? llm.forcedCoordinatorProjectEnd : undefined,
      }).catch((err) => {
        console.warn('[office] smart task closure finalization failed:', err);
      });
    }

    const followUpSourceText =
      executionMode === 'smart' ? (llm.raw || finalText) : finalText;
    const coordinatorSmartDispatchFollowUp =
      executionMode === 'smart'
      && isCoordinator
      && parseSmartCoordinatorAction(followUpSourceText.trim()) === 'assign'
      && hasSmartCoordinatorStructuredDispatch(followUpSourceText.trim());
    if (coordinatorSmartDispatchFollowUp && focus && params.scenario) {
      const { recordSmartAssignPublished } = await import('./smart-assign-ledger');
      const { resolveSmartCoordinatorDispatchTargets } = await import(
        '../../../src/lib/office-smart-dispatch-targets'
      );
      const targets = resolveSmartCoordinatorDispatchTargets(
        followUpSourceText.trim(),
        roles.map((r) => ({
          agentId: r.agentId,
          displayName: r.name,
        })),
        params.coordinatorRoleId ?? role.agentId,
      );
      await recordSmartAssignPublished(
        focus.id,
        primaryId,
        targets.map((t) => t.agentId),
      );
    }

    if (
      focus
      && executionMode === 'smart'
      && isCoordinator
      && memberInboundCoordinator
    ) {
      registerSmartMemberReportsHandledByCoordinatorInbound(
        focus.id,
        options.coalescedFromUserMsgIds?.length
          ? options.coalescedFromUserMsgIds
          : [userMsg.id],
      );
    }

    const followUpDispatchText =
      executionMode === 'smart'
        ? parseRoomMentionStructuredReply(followUpSourceText).dispatch?.trim() ?? ''
        : '';
    const shouldFollowUp =
      !(
        executionMode === 'workflow'
        && isWorkflowTaskRunnerActive(roomTaskId)
      )
      && (
        (
          executionMode !== 'smart'
          && isSubstantiveRoomMentionReply(finalText, {
            workflowMember: executionMode === 'workflow' && !isCoordinator,
          })
        )
        || (
          executionMode === 'smart'
          && !isCoordinator
          && (
            isSubstantiveRoomMentionReply(followUpDispatchText, {
              smartMember: true,
            })
            || (
              coordinator
              && smartMemberReplyMentionsCoordinator(followUpDispatchText, coordinator)
            )
          )
        )
        || coordinatorSmartDispatchFollowUp
      );

    // 协调者派活：先启动 follow-up（含成员极速 ack + Session），再并行做状态/笔记本同步，避免 ack 被阻塞数分钟。
    // 协调者 assign 已落盘群聊后须完成 follow-up，不因 epoch 重启 generation 过期而丢弃派活。
    if (shouldFollowUp) {
      const generationStale = !ensureCurrentGeneration('pre-follow-up');
      if (generationStale && !coordinatorSmartDispatchFollowUp) return;
      if (generationStale && coordinatorSmartDispatchFollowUp) {
        mentionDispatchLog('coordinator-assign-follow-up-stale-override', {
          primaryId,
          projectId: focus?.id ?? roomTaskId,
          roleId: role.id,
        });
      }
    }
    const followUpPromise = shouldFollowUp
      ? dispatchSmartMemberFollowUpIfNeeded(followUpSourceText, {
          executionMode,
          isCoordinator,
          coordinator,
          member: role,
          hooks,
          primaryId,
          projectId: focus?.id ?? roomTaskId,
          groupId: params.scenarioId,
        })
      : Promise.resolve();

    // Smart 结项由 appendRoomMessage/updateRoomMessage 副作用（tryCompleteSmartProjectAfterRoomMessage）统一触发，
    // 勿在此重复调用 maybeCompleteSmartTaskFromCoordinatorReply，否则与 store 副作用并发导致结项/zip 双发。
    if (focus && executionMode === 'smart' && isCoordinator && params.scenario) {
      if (!ensureCurrentGeneration('post-final-coordinator-side-effects')) return;
      void activateSmartTaskOnCoordinatorDispatch(gateway, {
        scenarioId: params.scenarioId,
        scenario: params.scenario as never,
        focus,
        coordinator: role,
        teamRoles: roles,
        replyText: followUpSourceText,
        userMsg,
        source: 'final_publish',
      });
    }

    hooks.auditMissingMentions?.({
      id: primaryId,
      projectId: roomTaskId,
      groupId: params.scenarioId,
      from: role.agentId,
      fromAgentId: role.agentId,
      content: finalText,
      mentions: resolveMentionTargets(
        parseMentions(
          executionMode === 'smart'
            ? parseRoomMentionStructuredReply(followUpSourceText).dispatch ?? ''
            : finalText,
        ),
        roles,
      ).map((r) => r.agentId),
      timestamp: Date.now(),
      replyToId: userMsg.id,
    });

    if (focus && params.scenario) {
      if (!ensureCurrentGeneration('role-status-update')) return;
      void persistRoleWorkStatusAfterMentionReply({
        scenarioId: params.scenarioId,
        task: focus as never,
        scenario: params.scenario as never,
        role: { id: role.id, name: role.name, agentId: role.agentId, displayName: role.name },
        latestReplySnippet: finalText,
      }).catch((err) => console.warn('[office] role status update failed:', role.id, err));
    }

    if (focus && params.scenario && isCoordinator) {
      if (!ensureCurrentGeneration('coordinator-notebook-sync')) return;
      void syncCoordinatorNotebookAfterMention({
        scenarioId: params.scenarioId,
        focus,
        scenario: params.scenario as never,
        roles: roles.map((r) => ({ id: r.id, name: r.name, agentId: r.agentId, displayName: r.name })),
        coordinatorReplyText: finalText,
      }).catch((err) => console.warn('[office] coordinator notebook sync failed:', err));
    }

    await settleMentionFollowUp(executionMode, followUpPromise, role.id);
  } catch (e) {
    const coordinator = roles.find((r) => r.id === params.coordinatorRoleId);
    const detail = e instanceof Error ? e.message : String(e);
    const { appendRoomMessage } = await import('./store');

    if (coordinator && role.id !== coordinator.id) {
      if (!ensureCurrentGeneration('catch-member-fail')) return;
      const failBody = buildLlmFailureCoordinatorReply(coordinator.name, role.name, detail);
      await publishMentionRoleReply(publishParams, role, userMsg, failBody, {
        messageId: primaryId,
        supplementary: true,
        forceAppend: true,
      }).catch(() => undefined);
      await hooks.escalateToCoordinator?.(coordinator).catch(() => undefined);
      return;
    }

    const report = buildRoomMentionFailureReport(role.name, detail, false, {
      validation: false,
    });
    if (!ensureCurrentGeneration('catch-report')) return;
    await publishMentionRoleReply(publishParams, role, userMsg, report, {
      messageId: primaryId,
      supplementary: true,
      forceAppend: true,
    }).catch(() => undefined);
    await appendRoomMessage({
      id: `room-${Date.now()}-mention-err`,
      groupId: params.scenarioId,
      projectId: roomTaskId,
      from: 'system',
      content: `【系统】${report}`,
      mentions: [role.agentId],
      timestamp: Date.now(),
    }).catch(() => undefined);
    if (coordinator && role.id !== coordinator.id) {
      await hooks.escalateToCoordinator?.(coordinator).catch(() => undefined);
    }
  }
}

export async function dispatchSingleRoleMentionReply(
  gateway: GatewayManager,
  params: Parameters<typeof dispatchSingleRoleMentionReplyInner>[1],
  userMsg: RoomMessage,
  members: ProjectMember[],
  member: ProjectMember,
  options: Parameters<typeof dispatchSingleRoleMentionReplyInner>[5],
  hooks: MentionDispatchHooks = {},
): Promise<void> {
  const roles = members.map((m) => normalizeProjectMember(m));
  const role = normalizeProjectMember(member, roles);
  const executionMode =
    params.focusTask?.executionMode === 'smart' ? 'smart' : 'workflow';
  const smartTaskId = resolveSmartMentionCoalesceTaskId(userMsg, params.focusTask);
  const dispatchGeneration =
    executionMode === 'smart' && smartTaskId
      ? smartMentionDispatchGeneration(smartTaskId)
      : 0;
  let key = smartMentionInflightKey(userMsg, role, executionMode, params.focusTask, params);
  const memberInboundKey = key.endsWith(SMART_MEMBER_INBOUND_COORDINATOR_INFLIGHT_SUFFIX);

  const work: SmartMentionDispatchWork = {
    gateway,
    params,
    userMsg,
    members: roles,
    member: role,
    options,
    hooks,
    coalescedFromUserMsgIds: [userMsg.id],
  };

  mentionDispatchLog('dispatch-enter', {
    role: role.name,
    roleId: role.id,
    taskId: params.focusTask?.id ?? userMsg.projectId,
    key,
    memberInbound: memberInboundKey,
    promptVariant: params.promptVariant,
    triggerMsgId: userMsg.id,
    fromAgentId: userMsg.fromAgentId,
  });

  if (
    executionMode === 'smart'
    && smartTaskId
    && !memberInboundKey
    && !memberIsCoordinator(role, params.coordinatorRoleId)
  ) {
    const kickoffGuardMessages = await getRoomMessages(smartTaskId);
    if (
      shouldSkipStaleSmartKickoffMemberDispatch({
        triggerMsgId: userMsg.id,
        memberAgentId: role.agentId,
        roomMessages: kickoffGuardMessages,
        coordinatorAgentId: params.coordinatorAgentId,
        projectId: smartTaskId,
      })
    ) {
      mentionDispatchLog('dispatch-stale-kickoff-skip', {
        taskId: smartTaskId,
        triggerMsgId: userMsg.id,
        memberRoleId: role.id,
        memberRoleName: role.name,
      });
      return;
    }
    if (
      shouldSkipSmartMemberDispatchAfterCompletedReport({
        memberAgentId: role.agentId,
        roomMessages: kickoffGuardMessages,
        projectId: smartTaskId,
        triggerMsg: userMsg,
      })
    ) {
      mentionDispatchLog('dispatch-member-end-redispatch-skip', {
        taskId: smartTaskId,
        triggerMsgId: userMsg.id,
        memberRoleId: role.id,
        memberRoleName: role.name,
      });
      return;
    }
  }

  if (memberInboundKey && executionMode === 'smart' && smartTaskId) {
    const roomMessages = await getRoomMessages(smartTaskId);
    const memberRoleName = roles.find((r) => r.id === userMsg.fromAgentId)?.name;
    const dedup = evaluateSmartMemberReportInboundDedup({
      taskId: smartTaskId,
      triggerMsgId: userMsg.id,
      memberReport: userMsg,
      roomMessages,
      coordinatorRoleId: params.coordinatorRoleId,
      memberRoleName,
    });
    mentionDispatchLog('member-report-dedup-eval', {
      taskId: smartTaskId,
      triggerMsgId: userMsg.id,
      memberRoleId: userMsg.fromAgentId,
      memberRoleName,
      skip: dedup.skip,
      reason: dedup.reason,
      matchedBy: dedup.matchedBy,
      matchedCoordinatorMsgId: dedup.matchedCoordinatorMsgId,
      memberReportTs: dedup.memberReportTs,
      latestCoordinatorSubstantiveTs: dedup.latestCoordinatorSubstantiveTs,
      queueDepth: smartMemberInboundQueueDepthForTesting(key),
      queueRunning: smartMemberInboundRunningForTesting(key),
    });
    if (dedup.skip) {
      mentionDispatchLog('member-inbound-enqueue-skipped-dedup', {
        taskId: smartTaskId,
        triggerMsgId: userMsg.id,
        reason: dedup.reason,
        memberRoleId: userMsg.fromAgentId,
        matchedBy: dedup.matchedBy,
        matchedCoordinatorMsgId: dedup.matchedCoordinatorMsgId,
        memberReportTs: dedup.memberReportTs,
        latestCoordinatorSubstantiveTs: dedup.latestCoordinatorSubstantiveTs,
      });
      return;
    }
    await enqueueSmartMemberInboundWork(key, smartTaskId, work);
    const drain = smartMemberInboundQueues.get(key)?.drainPromise;
    if (drain) {
      void drain.catch((err) => {
        console.warn('[office] smart member-inbound drain failed:', key, err);
      });
    }
    return;
  }

  if (executionMode === 'smart' && resolveSmartMentionCoalesceTaskId(userMsg, params.focusTask)) {
    let inflight = mentionDispatchInflight.get(key);
    if (inflight && isStaleSmartMentionDispatch(smartTaskId, dispatchGeneration)) {
      mentionDispatchLog('dispatch-stale-inflight-drop', {
        key,
        role: role.name,
        taskId: smartTaskId,
        generation: dispatchGeneration,
      });
      mentionDispatchInflight.delete(key);
      smartMentionPendingByKey.delete(key);
      inflight = undefined;
    }
    if (inflight) {
      const pendingForKey = smartMentionPendingByKey.get(key);
      const pendingRoleId = pendingForKey ? memberRoleDispatchId(pendingForKey.member) : '';
      const incomingRoleId = memberRoleDispatchId(work.member);
      if (pendingForKey && pendingRoleId && incomingRoleId && pendingRoleId !== incomingRoleId) {
        const splitKey = `${key}@${incomingRoleId}`;
        mentionDispatchLog('dispatch-key-split', {
          key,
          splitKey,
          role: role.name,
          pendingRoleId,
        });
        key = splitKey;
        inflight = mentionDispatchInflight.get(key);
      }
      if (inflight) {
        key = coalesceSmartMentionDispatch(key, work);
        mentionDispatchLog('dispatch-coalesce-wait', {
          key,
          role: role.name,
          roleId: role.id,
          triggerMsgId: userMsg.id,
          memberInbound: false,
        });
        return mentionDispatchInflight.get(key) ?? inflight;
      }
    }
  } else {
    const prev = mentionDispatchInflight.get(key);
    if (prev) {
      const job = (async () => {
        await prev;
        await dispatchSingleRoleMentionReplyInner(
          gateway,
          params,
          userMsg,
          members,
          member,
          options,
          hooks,
        );
      })().finally(() => {
        if (mentionDispatchInflight.get(key) === job) {
          mentionDispatchInflight.delete(key);
        }
      });
      mentionDispatchInflight.set(key, job);
      return job;
    }
  }

  const job = (async () => {
    if (isStaleSmartMentionDispatch(smartTaskId, dispatchGeneration)) {
      mentionDispatchLog('dispatch-stale-job-abort', {
        key,
        role: role.name,
        taskId: smartTaskId,
        generation: dispatchGeneration,
      });
      return;
    }
    mentionDispatchLog('dispatch-job-start', {
      key,
      role: role.name,
      roleId: role.id,
      taskId: params.focusTask?.id ?? userMsg.projectId,
      memberInbound: memberInboundKey,
      promptVariant: params.promptVariant,
    });
    let batch: SmartMentionDispatchWork = work;
    let dispatchedOnce = false;
    for (let pass = 0; pass < 32; pass++) {
      const pending = smartMentionPendingByKey.get(key);
      if (pending) {
        smartMentionPendingByKey.delete(key);
        batch = mergeSmartPendingDispatchForPass(batch, pending, dispatchedOnce);
        mentionDispatchLog('dispatch-job-drain', {
          key,
          pass,
          role: batch.member.name,
          batchSize: batch.coalescedFromUserMsgIds.length,
          promptVariant: batch.params.promptVariant,
        });
      }
      if (isStaleSmartMentionDispatch(smartTaskId, dispatchGeneration)) {
        mentionDispatchLog('dispatch-stale-batch-abort', {
          key,
          role: batch.member.name,
          taskId: smartTaskId,
          pass,
        });
        return;
      }
      await dispatchSingleRoleMentionReplyInner(
        batch.gateway,
        batch.params,
        batch.userMsg,
        batch.members,
        batch.member,
        {
          ...batch.options,
          coalescedFromUserMsgIds: batch.coalescedFromUserMsgIds,
          smartDispatchGeneration: dispatchGeneration,
        },
        batch.hooks,
      );
      dispatchedOnce = true;
      if (!smartMentionPendingByKey.has(key)) {
        await Promise.resolve();
        if (!smartMentionPendingByKey.has(key)) break;
      }
    }
    while (smartMentionPendingByKey.has(key)) {
      const pending = smartMentionPendingByKey.get(key);
      if (!pending) break;
      smartMentionPendingByKey.delete(key);
      batch = pending;
      mentionDispatchLog('dispatch-job-drain-safety', {
        key,
        role: batch.member.name,
        batchSize: batch.coalescedFromUserMsgIds.length,
      });
      if (isStaleSmartMentionDispatch(smartTaskId, dispatchGeneration)) {
        mentionDispatchLog('dispatch-stale-safety-abort', { key, taskId: smartTaskId });
        return;
      }
      await dispatchSingleRoleMentionReplyInner(
        batch.gateway,
        batch.params,
        batch.userMsg,
        batch.members,
        batch.member,
        {
          ...batch.options,
          coalescedFromUserMsgIds: batch.coalescedFromUserMsgIds,
          smartDispatchGeneration: dispatchGeneration,
        },
        batch.hooks,
      );
    }
    mentionDispatchLog('dispatch-job-done', {
      key,
      role: role.name,
      roleId: role.id,
      taskId: params.focusTask?.id ?? userMsg.projectId,
    });
  })().finally(() => {
    if (mentionDispatchInflight.get(key) === job) {
      mentionDispatchInflight.delete(key);
      mentionDispatchLog('dispatch-inflight-cleared', { key });
    }
  });
  mentionDispatchInflight.set(key, job);
  const awaitSmartMentionJob =
    executionMode !== 'smart'
    || params.promptVariant === 'coordinator_kickoff_decompose';
  if (awaitSmartMentionJob) {
    await job;
  } else {
    void job.catch((err) => {
      console.warn('[office] smart mention dispatch job failed:', key, err);
    });
  }
}
