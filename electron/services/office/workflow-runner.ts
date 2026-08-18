import type { GatewayManager } from '../../gateway/manager';
import { membersForProject } from './office-member-resolve';
import type {
  NodeRunRecord,
  NodeRunStatus,
  OfficeExecutionMember,
  OfficeFixedGroup,
  OfficeTempProject,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from './types';
import { taskWorkflowEngine } from '@/lib/office-workflow-engine';
import { officeWorkflowNodeDispatchRunId } from '@/lib/office-workflow-dispatch-run';
import { isTempProjectArchived } from './agent-binding';
import {
  clearProjectRunArtifacts,
  getRoomMessages,
  getTempProject,
  listTempProjects,
  persistTempProjectProgress,
  upsertTempProject,
} from './store';
import { fetchWorkflowAgentReplyWithRetry, tryRecoverWorkflowSessionStructuredReply } from './workflow-agent-llm';
import { roleTaskSessionKey } from './session-keys';
import { auditLog } from './audit';
import { extractTextFromOfficeMessage, parseGatewayChatEnvelope } from './run-completion';
import {
  buildAgentTaskPrompt,
  formatWorkflowAgentFailureDetail,
  validateWorkflowAgentStructuredReply,
} from './workflow-agent-reply';
import { announceTaskProjectClosure } from './workflow-project-closure';
import {
  clearTaskUserAborted,
  clearWorkflowParallelReworkBatchAbortReason,
  claimTaskAbortClear,
  isTaskUserAborted,
  markTaskUserAborted,
  resolveOfficeTaskAbortMessage,
  setOfficeTaskAbortReason,
  stampWorkflowParallelReworkBatchAbortReason,
} from './task-run-abort-registry';
import { settleWorkflowNodeRunsAfterStop } from '../../../src/lib/office-workflow-abort';
import { shouldBlockOfficeLlmSend } from './office-llm-send-guard';
import { ProjectAbortQuiescingError } from './project-abort-quiesce';
import {
  announceDependencyWait,
  announceWorkflowNodeUpstreamReworkProgress,
  beginTaskNodeRoomPhases,
} from './workflow-room-handoff';
import { nextHandoffTargetsAfterNode } from '../../../src/lib/office-workflow-handoff';
import {
  buildPriorDeliverablesContext,
  type PriorDeliverablesContextScope,
} from '../../../src/lib/office-workflow-prior-context';
import { scheduleWorkflowHandoffCoordinatorWatch, awaitOutstandingHandoffWatchesForTask } from './room-workflow-handoff-watch';
import {
  abortWorkflowNodeRun,
  clearWorkflowNodeRunAbort,
  registerWorkflowNodeRunAbort,
} from './workflow-node-run-registry';
import {
  clearWorkflowTaskRun,
  getWorkflowTaskRunController,
  isWorkflowTaskRunnerActive,
  registerWorkflowTaskRun,
} from './workflow-run-registry';
import { resolveProjectCoordinatorAgentId } from './task-coordinator';
import { roleMentionToken } from '../../../src/lib/office-mention';
import {
  tryResolveWorkflowFailureDeadlock,
  applyWorkflowAutoRollbackForBatch,
  recoverStaleCompletedFailureRollbacks,
  type AppliedWorkflowAutoRollback,
} from '../../../src/lib/office-workflow-failure-rollback';
import {
  isWorkflowDeliverableConclusionFailure,
  readWorkflowDeliverableConclusionFromMirrorText,
} from '../../../src/lib/office-workflow-edge-outcome';
import {
  nodeRunsForWorkflowContinue,
  resetUnattributedCompletedNodeRuns,
} from '../../../src/lib/office-workflow-schedule';
import {
  buildWorkflowReworkPromptPrefix,
  collectDownstreamNodeIds,
  reopenWorkflowUpstreamForRework,
} from '../../../src/lib/office-workflow-upstream-rework';
import {
  clearWorkflowRoomJsonHealTracking,
  collectAuxiliaryRoomHealPendingValidation,
  healWorkflowRunningNodesFromRoom,
  markWorkflowRoomJsonHealValidated,
  resolveRoomHealMinTimestampMs,
  unstuckStaleRunningNodeRuns,
  workflowStallIdleRoundLimit,
  type WorkflowRoomHealPendingValidation,
  type WorkflowRoomHealRollbackIntent,
} from '../../../src/lib/office-workflow-run-heal';
import {
  extractWorkflowRoomJsonReceipt,
  isAuxiliaryValidatedJsonStableForHeal,
  stampAuxiliaryRoomHealValidationSuccess,
} from '../../../src/lib/office-workflow-room-json-heal';
import {
  claimLiveRunAfterUpstreamReworkOpen,
  isWorkflowNodeRunClaimedByOtherPath,
  mapPeerClaimedRunToRoleStepStatus,
  markWorkflowNodeCompletionSource,
  markWorkflowPendingClaim,
  markWorkflowRoomHealPendingClaim,
  sessionRoleResultsIndicateSoftPendingOnly,
  sessionWorkflowApplyMayMutateRun,
  sessionWorkflowOutcomesShouldYieldToPeerClaim,
  type WorkflowNodeCompletionSource,
} from '../../../src/lib/office-workflow-node-run-settled';
import {
  applyWorkflowRoleStepFromParsedReply,
  announceWorkflowRoleStepFailureProgress,
  buildWorkflowRoleStepFromValidationFailure,
  validateWorkflowRoomJsonLikeSession,
  type WorkflowRoleStepResult,
} from './workflow-role-step-outcome';
import {
  roleHasWorkflowNodeDeliverable,
  workflowRoleDeliverSummaryFromRoom,
} from '../../../src/lib/office-workflow-role-step';
import { broadcastToRenderer } from '../../utils/broadcast-renderer';
import {
  clearWorkflowUserInterventionIfNodeTerminal,
} from '../../../src/lib/office-workflow-user-intervention';
import { shouldPersistResolvedWorkflowToProject, materializeWorkflowForProjectRun } from '../../../src/lib/office-task-workflow';
import {
  captureReviewSnapshotOnRun,
  buildReviewHealGuard,
  coalesceReviewBatchForPersist,
  finalizeDeferredBatchIfReady,
  isUserCheckpointEnabled,
  mergeReviewStateFromStored,
  onDeferredNodeCompletedReview,
  openReviewItemForCompletedNode,
  resolveUserCheckpoint,
  reviewHoldNodeIds,
  nextRunnableNodesForExecution,
  shouldSyncNodeRunsFromStoredReview,
  shouldWorkflowRunnerSleepForReview,
  syncReviewBatchExecutionStates,
} from '../../../src/lib/office-workflow-user-checkpoint';
import {
  resolveEffectiveTaskStatus,
  shouldAnnounceWorkflowProjectClosure,
  shouldAnnounceWorkflowTaskFinished,
} from '../../../src/lib/office-task-status';
import type { WorkflowAgentValidationIssue } from '../../../src/lib/office-workflow-agent-validation-issues';
import {
  announceTaskNodeStalled,
  announceTaskWorkflowFinished,
  announceTaskWorkflowStarted,
  announceWorkflowRunnableBatch,
  announceWorkflowUpstreamRework,
} from './workflow-room-progress';
import {
  filterAuxiliaryRoomHealCandidates,
  WORKFLOW_ROOM_AUXILIARY_HEAL_POLL_MS,
  WORKFLOW_ROOM_JSON_HEAL_AUXILIARY_STABLE_MS,
  workflowRoomMirrorSnippetForProgress,
} from './workflow-room-auxiliary-heal';
import { startOfficeAgentSessionMdSync } from './office-agent-session-md-export';
import { officeWorkflowLog } from './office-workflow-log';
import { workflowNodeAgentTimeoutMs } from '../../../src/lib/office-workflow-roles';
import {
  coordinatorProjectRoot,
  ensureOfficeProjectDirectory,
} from './project-context-paths';
import { ENABLE_LANGGRAPH } from '../../../src/lib/feature-langgraph';
import { verifyWorkflowNodeDeliverableOnDisk } from './workflow-project-deliverable-fs';
import { resolveRecordedProjectRoot } from './project-context-paths';
import { declaredDeliverablePathsFromWorkflowJson } from '../../../src/lib/office-deliverable-disk-resolve';
import {
  diagnoseWorkflowStall,
  getIncompletePredecessorRoleIds,
  workflowEdgeList,
} from './workflow-graph';
import {
  resolveWorkflowForExecution,
  workflowNodeIsMultiAgent,
  workflowNodePrimaryAgentId,
  workflowNodeAgentIds,
  type ProjectAgentRef,
} from '../../../src/lib/office-workflow-node';

type RoleStepResult = {
  agentId: string;
  status: NodeRunStatus;
  failureOutcome?: boolean;
  summary?: string;
  deliverablePath?: string;
  error?: string;
  sessionKey?: string;
  runId?: string;
  memberHandoffOk?: boolean;
  upstreamRework?: {
    predecessorNodeIds: string[];
    mentionedAgentIds: string[];
    reason: string;
  };
  outputRetry?: boolean;
  outputRetryAttempts?: number;
};

function asExecutionMember(member: ProjectAgentRef): OfficeExecutionMember {
  return {
    agentId: member.agentId,
    displayName: member.displayName,
    emoji: '🤖',
  };
}

function deliverableDiskContext(
  task: OfficeTempProject,
  group: OfficeFixedGroup,
  member: ProjectAgentRef,
  teamMembers: ProjectAgentRef[],
) {
  return {
    project: task,
    group,
    member: asExecutionMember(member),
    teamMembers: teamMembers.map(asExecutionMember),
  };
}

function teamAgentRefs(members: ProjectAgentRef[]) {
  return members;
}

function roleStepFromWorkflow(step: WorkflowRoleStepResult): RoleStepResult {
  return {
    agentId: step.roleId,
    status: step.status,
    failureOutcome: step.failureOutcome,
    summary: step.summary,
    deliverablePath: step.deliverablePath,
    error: step.error,
    sessionKey: step.sessionKey,
    runId: step.runId,
    memberHandoffOk: step.memberHandoffOk,
    upstreamRework: step.upstreamRework
      ? {
        predecessorNodeIds: step.upstreamRework.predecessorNodeIds,
        mentionedAgentIds: step.upstreamRework.mentionedRoleIds,
        reason: step.upstreamRework.reason,
      }
      : undefined,
    outputRetry: step.outputRetry,
    outputRetryAttempts: step.outputRetryAttempts,
  };
}

async function loadProjectAgentRefs(project: OfficeTempProject): Promise<ProjectAgentRef[]> {
  return membersForProject(project);
}

function freshProjectNodeRuns(nodes: WorkflowNode[]): NodeRunRecord[] {
  return nodes.map((n) => ({
    nodeId: n.id,
    agentId: workflowNodePrimaryAgentId(n),
    status: 'pending' as const,
  }));
}
export type TaskWorkflowRunMode = 'fresh' | 'continue' | 'single';

export interface RunTaskWorkflowOptions {
  mode?: TaskWorkflowRunMode;
  nodeId?: string;
  /** 仅「重新执行」或协调者群聊明确重启时为 true；「开始执行」不清空群聊。 */
  clearProjectRoom?: boolean;
  onUpdate?: RunListener;
  /** 用户群聊介入：仅在该 nodeId 执行时注入【用户介入】说明。 */
  userIntervention?: { nodeId: string; request: string };
  /** LangGraph：将回滚副作用延迟到 state.pendingRework，而非立即 reopen。 */
  deferUpstreamRework?: boolean;
  onDeferredUpstreamRework?: (payload: {
    predecessorNodeIds: string[];
    mentionedAgentIds: string[];
    reason: string;
  }) => void;
  /**
   * Abort-seq permit from {@link issueTaskAbortClearPermit} at run claim time.
   * Runner may clear userAborted only while seq is unchanged (abort did not win).
   */
  abortClearPermit?: number;
}

type RunListener = (task: OfficeTempProject) => void;

const WORKFLOW_STALL_POLL_MS = 1_000;
/** 群聊 JSON 自愈扫描间隔（主循环空闲兜底 / Session history 轮询）。 */
const WORKFLOW_ROOM_HEAL_POLL_MS = 20_000;

export type WorkflowRoomHealSyncOptions = {
  /** 覆盖默认稳定窗口：主循环空闲兜底 5min；辅助路径默认校验通过后再稳定 120s。 */
  jsonStableMs?: number;
  /** 日志前缀，便于区分主路径等待 / 主循环兜底 / 超时兜底。 */
  logContext?: string;
  /** 仅处理指定节点（辅助路径并行自愈 scoped 到当前节点）。 */
  onlyNodeId?: string;
  /**
   * 收稿辅助路径：先完整校验 → 通过后指纹稳定窗 → 应用前再验；
   * 校验失败不 abort Session 主路径；同指纹按轮询重试。
   * 不依赖 Session 收稿闸门，也不与 Session 终稿指纹比对。
   */
  auxiliaryPath?: {
    sessionKey: string;
    sessionStartedAtMs: number;
  };
};

function workflowHealLog(context: string | undefined, message: string, extra?: Record<string, unknown>): void {
  const tag = context ? `[office][workflow-heal][${context}]` : '[office][workflow-heal]';
  officeWorkflowLog('info', tag, {
    message,
    ...(extra ?? {}),
  });
}

function nodeRunsSnapshotFromRunner(
  runs: Map<string, NodeRunRecord>,
  nodes: WorkflowNode[],
): NodeRunRecord[] {
  return nodes.map((n) => {
    const run = runs.get(n.id);
    return (
      run ?? {
        nodeId: n.id,
        agentId: workflowNodePrimaryAgentId(n),
        status: 'pending' as NodeRunStatus,
      }
    );
  });
}

async function persistTaskProgress(
  task: OfficeTempProject,
  runs: Map<string, NodeRunRecord>,
  nodes: WorkflowNode[],
  onUpdate?: RunListener,
  workflowStalled?: boolean,
): Promise<void> {
  const { isAbortQuiescing } = await import('./project-abort-quiesce');

  // Active abort / quiesce: never let runner lag demote the store snapshot.
  if (isTaskUserAborted(task.id) || isAbortQuiescing(task.id)) {
    const stored = await getTempProject(task.id);
    if (stored) {
      onUpdate?.(stored);
    }
    return;
  }
  const storedEarly = await getTempProject(task.id);
  if (storedEarly?.abortQuiescing) {
    onUpdate?.(storedEarly);
    return;
  }

  const runnerStillActive = isWorkflowTaskRunnerActive(task.id);
  if (isUserCheckpointEnabled()) {
    task.workflowReviewBatch = coalesceReviewBatchForPersist(task, storedEarly);
  }
  if (runnerStillActive) {
    task.nodeRuns = nodeRunsSnapshotFromRunner(runs, nodes);
    task.status = resolveEffectiveTaskStatus(task, runs, nodes, {
      runnerActive: true,
      workflowStalled,
    });
  } else {
    task.nodeRuns = nodes.map((n) => {
      const run = runs.get(n.id);
      return (
        run ?? {
          nodeId: n.id,
          agentId: workflowNodePrimaryAgentId(n),
          status: 'pending' as NodeRunStatus,
        }
      );
    });
    task.status = resolveEffectiveTaskStatus(task, runs, nodes, { workflowStalled });
  }

  // Sticky demotion: disk already aborted — allow re-run (`running`/`pending`) but
  // never persist lagging `failed`/`completed` over it (14:14 red-light hole).
  if (
    storedEarly?.status === 'aborted'
    && (task.status === 'failed' || task.status === 'completed')
  ) {
    onUpdate?.(storedEarly);
    return;
  }

  task.updatedAt = Date.now();
  await persistTempProjectProgress(task);
  onUpdate?.(task);
}

async function finalizeAbortedTaskRun(
  task: OfficeTempProject,
  runs: Map<string, NodeRunRecord>,
  nodes: WorkflowNode[],
  onUpdate?: RunListener,
): Promise<OfficeTempProject> {
  const stored = await getTempProject(task.id);
  if (stored && isTempProjectArchived(stored)) {
    onUpdate?.(stored);
    return stored;
  }

  const now = Date.now();
  const abortMsg = resolveOfficeTaskAbortMessage(task.id);
  for (const node of nodes) {
    const run = runs.get(node.id);
    if (!run) continue;
    if (run.status === 'running' || run.status === 'pending') {
      runs.set(node.id, {
        ...run,
        status: 'failed',
        error: run.error && run.error !== 'Aborted' ? run.error : abortMsg,
        completedAt: run.completedAt ?? now,
      });
    }
  }
  task.status = 'aborted';
  // User abort never freezes the group template — drop any leftover snapshot.
  task.workflowFreezeSnapshot = undefined;
  task.nodeRuns = settleWorkflowNodeRunsAfterStop(
    { ...task, nodeRuns: nodeRunsSnapshotFromRunner(runs, nodes) },
    abortMsg,
    now,
  );
  task.updatedAt = now;
  const saved = await upsertTempProject({
    ...task,
    abortQuiescing: stored?.abortQuiescing ?? task.abortQuiescing,
    abortGeneration: stored?.abortGeneration ?? task.abortGeneration,
    abortQuiesceStartedAt: stored?.abortQuiesceStartedAt ?? task.abortQuiesceStartedAt,
    workflowFreezeSnapshot: undefined,
  });
  // upsertTempProject does not broadcast — push aborted so a prior failed progress
  // event cannot leave the Renderer status light stuck on red.
  const { notifyRendererProjectProgressUpdate } = await import('./store');
  notifyRendererProjectProgressUpdate(saved);
  onUpdate?.(saved);
  return saved;
}

export { nextRunnableNodes } from '../../../src/lib/office-workflow-schedule';

function priorContextForNode(
  runs: Map<string, NodeRunRecord>,
  nodes: WorkflowNode[],
  members: ProjectAgentRef[],
  currentNodeId: string,
  edges: WorkflowDefinition['edges'],
  projectRoot?: string,
  scope?: PriorDeliverablesContextScope,
): string {
  return buildPriorDeliverablesContext({
    runs,
    nodes,
    roles: members.map((m) => ({ id: m.agentId, name: m.displayName })),
    currentNodeId,
    edges,
    projectRoot,
    scope,
  });
}

async function workflowProjectRootForTask(
  project: OfficeTempProject,
): Promise<string | undefined> {
  const root = await resolveRecordedProjectRoot(project);
  return root ?? undefined;
}

function nodeRunsFromTaskOrFresh(
  task: OfficeTempProject,
  nodes: WorkflowNode[],
  mode: TaskWorkflowRunMode,
): NodeRunRecord[] {
  if (mode === 'fresh') return freshProjectNodeRuns(nodes);
  if (mode === 'continue') return nodeRunsForWorkflowContinue(task.nodeRuns, nodes);
  const existing = new Map(task.nodeRuns.map((r) => [r.nodeId, r]));
  return nodes.map((n) => {
    const prev = existing.get(n.id);
    if (prev) return { ...prev };
    return {
      nodeId: n.id,
      agentId: workflowNodePrimaryAgentId(n),
      status: 'pending' as const,
    };
  });
}

/** 续跑时若 runs 仍含 failed（如归档重启后磁盘与内存不同步），重新打开为 pending。 */
function reopenFailedRunsForWorkflowContinue(
  runs: Map<string, NodeRunRecord>,
  nodes: WorkflowNode[],
): boolean {
  const reopened = nodeRunsForWorkflowContinue([...runs.values()], nodes);
  let changed = false;
  for (const run of reopened) {
    const prev = runs.get(run.nodeId);
    if (
      !prev
      || prev.status !== run.status
      || prev.error !== run.error
      || prev.runId !== run.runId
    ) {
      runs.set(run.nodeId, run);
      changed = true;
    }
  }
  for (const node of nodes) {
    if (!runs.has(node.id)) {
      runs.set(node.id, {
        nodeId: node.id,
        agentId: workflowNodePrimaryAgentId(node),
        status: 'pending',
      });
      changed = true;
    }
  }
  return changed;
}

function agentValidationIssues(
  agentResult: Awaited<ReturnType<typeof fetchWorkflowAgentReplyWithRetry>>,
): WorkflowAgentValidationIssue[] {
  if (agentResult.ok) return [];
  return agentResult.issues;
}

function expectedHandoffPromptLines(
  expected: ReturnType<typeof nextHandoffTargetsAfterNode>,
  roles: ProjectAgentRef[],
): string[] {
  return expected.map((t) => {
    const r = roles.find((x) => x.agentId === t.roleId);
    const token = r ? roleMentionToken(r) : t.roleId;
    return `- @${token} ${t.stepTitle}`;
  });
}

async function executeNodeForRole(
  gateway: GatewayManager,
  scenario: OfficeFixedGroup,
  task: OfficeTempProject,
  node: WorkflowNode,
  member: ProjectAgentRef,
  workflow: WorkflowDefinition,
  projectMembers: ProjectAgentRef[],
  signal?: AbortSignal,
  priorDeliverables?: string,
  options?: {
    coRoleNames?: string[];
    isCoordinatorRole?: boolean;
    expectedHandoff?: ReturnType<typeof nextHandoffTargetsAfterNode>;
    stepIndex?: number;
    totalSteps?: number;
    userInterventionRequest?: string;
    outputRetryAttempts?: number;
    runs?: Map<string, NodeRunRecord>;
    reworkGeneration?: number;
    reworkReason?: string;
    onLlmDispatched?: (runId: string) => void;
    directPredecessorDeliverables?: string;
    /** 辅助路径 tick 写回 nodeRun（指纹计时 / room_heal 完成）。 */
    onRunRecordProgress?: (run: NodeRunRecord) => void | Promise<void>;
  },
): Promise<RoleStepResult> {
  const { runWithOfficeRoleWorkspacePrepared } = await import('./agent-setup');
  return runWithOfficeRoleWorkspacePrepared(member, projectMembers, async () =>
    executeNodeForRoleWithPinnedWorkspace(
      gateway,
      scenario,
      task,
      node,
      member,
      workflow,
      signal,
      priorDeliverables,
      options,
      projectMembers,
    ),
  );
}

async function executeNodeForRoleWithPinnedWorkspace(
  gateway: GatewayManager,
  scenario: OfficeFixedGroup,
  task: OfficeTempProject,
  node: WorkflowNode,
  member: ProjectAgentRef,
  workflow: WorkflowDefinition,
  signal: AbortSignal | undefined,
  priorDeliverables: string | undefined,
  options: {
    coRoleNames?: string[];
    isCoordinatorRole?: boolean;
    expectedHandoff?: ReturnType<typeof nextHandoffTargetsAfterNode>;
    stepIndex?: number;
    totalSteps?: number;
    userInterventionRequest?: string;
    outputRetryAttempts?: number;
    runs?: Map<string, NodeRunRecord>;
    reworkGeneration?: number;
    reworkReason?: string;
    onLlmDispatched?: (runId: string) => void;
    directPredecessorDeliverables?: string;
    onRunRecordProgress?: (run: NodeRunRecord) => void | Promise<void>;
  } | undefined,
  projectMembers: ProjectAgentRef[],
): Promise<RoleStepResult> {
  const teamMembers = projectMembers;
  const roleTaskList =
    node.description?.trim() || node.title?.trim() || '';
  const coNote =
    options?.coRoleNames && options.coRoleNames.length > 0
      ? `\n\n本步骤与以下角色协同完成（请各自给出本角色视角的评审/交付）：${options.coRoleNames.join('、')}。`
      : '';
  const userInterventionRequest = options?.userInterventionRequest?.trim() || '';
  const userNote = userInterventionRequest
    ? `\n\n【用户介入·须优先满足】\n${userInterventionRequest.slice(0, 4_000)}`
    : '';
  await ensureOfficeProjectDirectory(task);
  const projectDirectoryLines: string[] = [
    `- 项目目录（唯一，所有成员交付/读取/对外产物）：${coordinatorProjectRoot(task.title, task.id)}`,
  ];
  const acceptanceAccelHint = /测试验收/u.test(node.title?.trim() ?? '')
    ? '\n\n【本步加速】以 smoke 验收为主：确认交付物-开发可启动且核心对局可走通；落盘测试验收报告后本轮立即输出唯一结构化 JSON，勿长时间 Playwright 全量回归。'
    : '';
  // Checkpoint settle writes the same 【人工审查意见】 into both workflowUserIntervention
  // and reworkReason. Prefer the user-intervention channel and skip the rework wrapper
  // so the prompt is not double-injected.
  const reworkRaw = options?.reworkReason?.trim() || '';
  const skipReworkForHumanReview =
    Boolean(userInterventionRequest)
    && (reworkRaw === userInterventionRequest || reworkRaw.startsWith('【人工审查意见】'));
  const reworkNote = skipReworkForHumanReview
    ? ''
    : buildWorkflowReworkPromptPrefix(options?.reworkReason);
  const body = buildAgentTaskPrompt({
    roleName: member.displayName,
    taskTitle: task.title,
    taskDescription: task.description ?? '',
    featureDescription: task.featureDescription ?? '',
    stepTitle: node.title?.trim() || roleTaskList.split('\n')[0]?.trim() || task.title,
    stepDescription: `${reworkNote}${reworkNote ? '\n\n' : ''}${roleTaskList || task.description || ''}${coNote}${userNote}${acceptanceAccelHint}`.trim(),
    scenarioName: scenario.name,
    teammateNames: teamMembers.map((r) => r.displayName),
    priorDeliverables,
    directPredecessorDeliverables: options?.directPredecessorDeliverables,
    expectedHandoffLines: options?.expectedHandoff
      ? expectedHandoffPromptLines(options.expectedHandoff, projectMembers)
      : undefined,
    isCoordinatorRole: options?.isCoordinatorRole,
    stepIndex: options?.stepIndex,
    totalSteps: options?.totalSteps,
    projectDirectoryLines,
  });
  const outputRetryAttempts = options?.outputRetryAttempts ?? 0;
  const reworkGeneration = options?.reworkGeneration ?? 0;
  const nodeSessionId =
    outputRetryAttempts > 0
      ? `${node.id}-out-retry-${outputRetryAttempts}`
      : reworkGeneration > 0
        ? `${node.id}-rework-${reworkGeneration}`
        : node.id;
  const sessionKey = roleTaskSessionKey(
    member.agentId,
    member.agentId,
    task.id,
    nodeSessionId,
    task.workflowRunId,
  );
  // 仅传递可展示预览，避免超长 prompt 带来的渲染/传输副作用。
  broadcastToRenderer('office:workflow-dispatch', {
    sessionKey,
    promptText: body.length > 4_000 ? `${body.slice(0, 4_000)}\n\n[工作流派发提示词已截断展示]` : body,
  });
  const dispatchRunId = officeWorkflowNodeDispatchRunId(task.workflowRunId, node.id, task.id);
  const idempotencyKey = `office-task-${task.id}-${nodeSessionId}-${member.agentId}-${dispatchRunId}`;
  let roomPhases: Awaited<ReturnType<typeof beginTaskNodeRoomPhases>> = null;
  const step: RoleStepResult = {
    agentId: member.agentId,
    status: 'running',
    sessionKey,
    outputRetryAttempts,
  };
  try {
    roomPhases = await beginTaskNodeRoomPhases(
      gateway,
      scenario,
      task,
      node,
      asExecutionMember(member),
    );
    await roomPhases?.promoteToRunning();

    const nodeExecution = 'serial';

    const mirrorPartialToRoom = roomPhases
      ? (partial: string) => {
        const phases = roomPhases!;
        const liveRun = options?.runs?.get(node.id);
        if (liveRun && liveRun.status !== 'running') return;
        const snippet = workflowRoomMirrorSnippetForProgress(partial);
        if (snippet) {
          void phases.updateProgress(snippet);
        }
      }
      : undefined;

    officeWorkflowLog('info', '[office][workflow-session] dispatch node', {
      taskId: task.id,
      nodeId: node.id,
      agentId: member.agentId,
      roleName: member.displayName,
      sessionKey,
      timeoutMin: Math.round(workflowNodeAgentTimeoutMs(node, outputRetryAttempts) / 60_000),
    });

    const sessionStartedAt = Date.now();
    const projectRootForSessionMd =
      (await workflowProjectRootForTask(task)) ?? coordinatorProjectRoot(task.title, task.id);
    let sessionMdSync = startOfficeAgentSessionMdSync({
      gateway,
      sessionKey,
      projectRoot: projectRootForSessionMd,
      roleDisplayName: member.displayName,
      startedAtMs: sessionStartedAt,
    });
    const validateWithDisk = async (
      raw: string,
      reason: 'timeout' | 'error' | 'empty',
    ) => {
      const structural = validateWorkflowAgentStructuredReply({
        raw,
        transportReason: reason,
        actorRoleName: member.displayName,
        requireMemberHandoff: false,
        expectedHandoff: options?.expectedHandoff,
        teamRoles: teamAgentRefs(teamMembers),
        directPredecessorDeliverables: options?.directPredecessorDeliverables,
      });
      if (!structural.ok) return structural;
      const deliverablePaths = declaredDeliverablePathsFromWorkflowJson(structural.parsed.jsonOutput);
      if (deliverablePaths.length === 0) {
        return {
          ok: false as const,
          issues: ['deliverable_paths_missing_on_disk' as const],
          detail: 'deliverable.path 未声明，无法落盘校验',
          raw,
        };
      }
      const disk = await verifyWorkflowNodeDeliverableOnDisk({
        ...deliverableDiskContext(task, scenario, member, teamMembers),
        deliverablePaths,
      });
      if (!disk.ok) {
        return {
          ok: false as const,
          issues: ['deliverable_paths_missing_on_disk' as const],
          detail: disk.detail,
          raw,
        };
      }
      return structural;
    };

    const onPartialForSession = mirrorPartialToRoom ?? undefined;

    let activeRunId: string | undefined;
    const onGatewayChat = (data: { message?: unknown }) => {
      const parsed = parseGatewayChatEnvelope(data);
      if (!parsed.sessionKey || parsed.sessionKey !== sessionKey) return;
      if (activeRunId && parsed.runId && parsed.runId !== activeRunId) return;
      const inner = parsed.message;
      if (!inner || inner.role !== 'assistant') return;
      const text = extractTextFromOfficeMessage(inner);
      if (!text || !onPartialForSession) return;
      const state = parsed.state ?? '';
      if (state === 'delta' || state === 'started' || state === 'final' || !state) {
        onPartialForSession(text);
      }
    };

    const onGatewayNotification = (data: { method?: string; params?: unknown }) => {
      const method = data?.method ?? '';
      if (method !== 'agent' && method !== 'chat') return;
      onGatewayChat({ message: data.params });
    };

    gateway.on('chat:message', onGatewayChat);
    gateway.on('notification', onGatewayNotification);

    // 收稿双路径：主路径 = Session Model B 闸门（fetchWorkflowAgentReplyWithRetry）；
    // 辅助路径 = 群聊 JSON 先完整校验 → 稳定 120s → 再验应用（并行 ticker，不依赖闸门）。
    const stopAuxiliaryHealDuringSessionWait =
      options?.runs
        ? startWorkflowRoomAuxiliaryHealDuringSessionWait({
          gateway,
          scenario,
          task,
          workflow,
          node,
          projectMembers,
          teamMembers,
          runs: options.runs,
          sessionKey,
          sessionStartedAtMs: sessionStartedAt,
          signal,
          onRunRecordProgress: async (run) => {
            options.runs?.set(node.id, run);
            await options.onRunRecordProgress?.(run);
          },
        })
        : () => {};

    let agentResult: Awaited<ReturnType<typeof fetchWorkflowAgentReplyWithRetry>>;
    try {
      agentResult = await fetchWorkflowAgentReplyWithRetry(gateway, {
        sessionKey,
        agentId: member.agentId,
        roleName: member.displayName,
        agentBody: body,
        idempotencyKey,
        retryIdempotencyKey: `${idempotencyKey}-format-retry`,
        nodeExecution,
        taskName: node.id,
        stepTitle: node.title,
        timeoutMs: workflowNodeAgentTimeoutMs(node, outputRetryAttempts),
        startedAtMs: sessionStartedAt,
        signal,
        settleRunId: dispatchRunId,
        projectId: task.id,
        shouldAbortWait: () => {
          const peer = options?.runs?.get(node.id);
          return isWorkflowNodeRunClaimedByOtherPath(peer, 'session');
        },
        onPartialReply: onPartialForSession,
        onRunId: (id) => {
          activeRunId = id;
          step.runId = id;
          sessionMdSync?.setRunId(id);
          if (id) options?.onLlmDispatched?.(id);
        },
        requireMemberHandoff: false,
        expectedHandoff: options?.expectedHandoff,
        expectedHandoffLines: options?.expectedHandoff
          ? expectedHandoffPromptLines(options.expectedHandoff, projectMembers)
          : undefined,
        isCoordinatorRole: options?.isCoordinatorRole,
        teamRoles: teamAgentRefs(teamMembers),
        directPredecessorDeliverables: options?.directPredecessorDeliverables,
        verifyDeliverableOnDisk: async (parsed) => {
          const deliverablePaths = declaredDeliverablePathsFromWorkflowJson(parsed.jsonOutput);
          if (deliverablePaths.length === 0) {
            return { ok: false, detail: 'deliverable.path 未声明，无法落盘校验' };
          }
          const disk = await verifyWorkflowNodeDeliverableOnDisk({
            ...deliverableDiskContext(task, scenario, member, teamMembers),
            deliverablePaths,
          });
          return { ok: disk.ok, detail: disk.detail };
        },
      });
    } finally {
      stopAuxiliaryHealDuringSessionWait();
      gateway.off('chat:message', onGatewayChat);
      gateway.off('notification', onGatewayNotification);
      try {
        await sessionMdSync?.finish();
      } finally {
        sessionMdSync?.stop();
        sessionMdSync = null;
      }
    }

    step.runId = agentResult.ok ? agentResult.runId : undefined;

    const peerRun = options?.runs?.get(node.id);
    if (isWorkflowNodeRunClaimedByOtherPath(peerRun, 'session')) {
      return {
        agentId: member.agentId,
        status: mapPeerClaimedRunToRoleStepStatus(peerRun!),
        summary: peerRun!.summary,
        error: peerRun!.error,
        sessionKey: step.sessionKey,
        runId: step.runId,
      };
    }

    if (agentResult.ok) {
      const liveRun = options?.runs?.get(node.id);
      if (!sessionWorkflowApplyMayMutateRun(liveRun)) {
        return {
          agentId: member.agentId,
          status:
            liveRun?.status === 'failed'
              ? 'failed'
              : liveRun?.status === 'completed'
                ? 'completed'
                : 'pending',
          summary: liveRun?.summary,
          error: liveRun?.error,
          sessionKey: step.sessionKey,
          runId: step.runId,
        };
      }
      const applied = await applyWorkflowRoleStepFromParsedReply(
        gateway,
        scenario,
        task,
        node,
        asExecutionMember(member),
        workflow,
        agentResult.parsed,
        agentResult.raw,
        {
          coRoleNames: options?.coRoleNames,
          isCoordinatorRole: options?.isCoordinatorRole,
          expectedHandoff: options?.expectedHandoff,
          outputRetryAttempts: step.outputRetryAttempts,
          allMembers: projectMembers.map(asExecutionMember),
          teamMembers: teamMembers.map(asExecutionMember),
          roomPhases,
        },
      );
      return { ...roleStepFromWorkflow(applied), sessionKey: step.sessionKey, runId: step.runId };
    } else if (agentResult.transportReason === 'timeout') {
      officeWorkflowLog('warn', '[office][workflow-session] timeout waiting for structured reply', {
        taskId: task.id,
        nodeId: node.id,
        roleName: member.displayName,
        sessionKey,
      });
      const runsMap = options?.runs;
      if (runsMap) {
        const recovered = await tryRecoverWorkflowSessionStructuredReply(gateway, {
          sessionKey,
          startedAtMs: sessionStartedAt,
          runId: step.runId,
          signal,
          validateWithDisk,
        });
        if (recovered.ok) {
          const liveRun = runsMap.get(node.id);
          if (sessionWorkflowApplyMayMutateRun(liveRun)) {
            const applied = await applyWorkflowRoleStepFromParsedReply(
              gateway,
              scenario,
              task,
              node,
              asExecutionMember(member),
              workflow,
              recovered.parsed,
              recovered.raw,
              {
                coRoleNames: options?.coRoleNames,
                isCoordinatorRole: options?.isCoordinatorRole,
                expectedHandoff: options?.expectedHandoff,
                outputRetryAttempts: step.outputRetryAttempts,
                allMembers: projectMembers.map(asExecutionMember),
                teamMembers: teamMembers.map(asExecutionMember),
                roomPhases,
              },
            );
            officeWorkflowLog('info', '[office][workflow-session] recovered via gated session recovery after timeout', {
              taskId: task.id,
              nodeId: node.id,
            });
            return { ...roleStepFromWorkflow(applied), sessionKey: step.sessionKey, runId: step.runId };
          }
        }

        const edgeList = workflowEdgeList(workflow.nodes, workflow.edges);
        await syncWorkflowRunsFromRoomHeal(
          gateway,
          scenario,
          task,
          workflow,
          workflow.nodes,
          edgeList,
          runsMap,
          projectMembers,
          teamMembers,
          async (run) => {
            runsMap.set(run.nodeId, run);
            await options?.onRunRecordProgress?.(run);
          },
          {
            logContext: 'timeout-auxiliary',
            onlyNodeId: node.id,
            auxiliaryPath: {
              sessionKey,
              sessionStartedAtMs: sessionStartedAt,
            },
          },
        );
        const healed = runsMap.get(node.id);
        if (healed?.status === 'completed') {
          officeWorkflowLog('info', '[office][workflow-heal] recovered via room after session timeout (fallback)', {
            taskId: task.id,
            nodeId: node.id,
          });
          return {
            agentId: member.agentId,
            status: 'completed',
            summary: healed.summary,
            sessionKey: step.sessionKey,
            runId: step.runId,
          };
        }
      }
      step.status = 'failed';
      step.error =
        `Agent run timed out waiting for reply (${Math.round(workflowNodeAgentTimeoutMs(node, outputRetryAttempts) / 60_000)} min). Ensure Gateway is running and the role has a valid model/API key.`;
      if (roomPhases) await roomPhases.announceFailed(step.error);
    } else if (signal?.aborted) {
      // room_heal aborts the node signal after claiming; prefer peer outcome over "Aborted".
      const peerAfterAbort = options?.runs?.get(node.id);
      if (isWorkflowNodeRunClaimedByOtherPath(peerAfterAbort, 'session')) {
        return {
          agentId: member.agentId,
          status: mapPeerClaimedRunToRoleStepStatus(peerAfterAbort!),
          summary: peerAfterAbort!.summary,
          error: peerAfterAbort!.error,
          sessionKey: step.sessionKey,
          runId: step.runId,
        };
      }
      step.status = 'failed';
      step.error = resolveOfficeTaskAbortMessage(task.id);
      if (roomPhases) await roomPhases.announceFailed(step.error);
    } else {
      const issues = agentValidationIssues(agentResult);
      const transportReason = !agentResult.ok ? agentResult.transportReason : undefined;
      let failDetail = formatWorkflowAgentFailureDetail(agentResult);
      if (failDetail.trim() === 'peer_claimed') {
        const peer = options?.runs?.get(node.id);
        if (peer) {
          return {
            agentId: member.agentId,
            status: mapPeerClaimedRunToRoleStepStatus(peer),
            summary: peer.summary,
            error: peer.error,
            sessionKey: step.sessionKey,
            runId: step.runId,
          };
        }
        // Peer claim signaled but live run missing — soft yield, never announceFailed.
        return {
          agentId: member.agentId,
          status: 'pending',
          sessionKey: step.sessionKey,
          runId: step.runId,
        };
      }
      // Only rewrite the exact Abort sentinel — never substring-match provider text like
      // "Request Aborted by upstream" inside label(reason) room copy.
      const rawAgentDetail = !agentResult.ok ? String(agentResult.detail ?? '').trim() : '';
      if (/^Aborted$/iu.test(failDetail.trim()) || /^Aborted$/iu.test(rawAgentDetail)) {
        failDetail = resolveOfficeTaskAbortMessage(task.id);
      }
      const failedStep = buildWorkflowRoleStepFromValidationFailure({
        roleId: member.agentId,
        issues,
        detail: summarizeAgentError(failDetail),
        outputRetryAttempts: step.outputRetryAttempts,
        transportReason,
      });
      if (failedStep.outputRetry && roomPhases && failedStep.error) {
        await roomPhases.announceOutputRetry(failedStep.error);
      } else if (failedStep.status === 'failed' && roomPhases && failedStep.error) {
        await roomPhases.announceFailed(failedStep.error);
      }
      return { ...roleStepFromWorkflow(failedStep), sessionKey: step.sessionKey, runId: step.runId };
    }
  } catch (e) {
    step.status = 'failed';
    const raw = e instanceof Error ? e.message : String(e);
    step.error = summarizeAgentError(raw);
    if (roomPhases) await roomPhases.announceFailed(step.error);
  }
  return step;
}

async function applyWorkflowRollbackForNode(
  gateway: GatewayManager,
  scenario: OfficeFixedGroup,
  task: OfficeTempProject,
  node: WorkflowNode,
  run: NodeRunRecord,
  workflow: WorkflowDefinition,
  runs: Map<string, NodeRunRecord>,
  projectMembers: ProjectAgentRef[],
  reworkResult: RoleStepResult,
  onProgress?: (run: NodeRunRecord) => void | Promise<void>,
  claimSource: WorkflowNodeCompletionSource = 'session',
): Promise<NodeRunRecord> {
  const { predecessorNodeIds, mentionedAgentIds, reason } = reworkResult.upstreamRework!;
  // Keep map entry fresh before reopen (reopen writes a new object for this node).
  runs.set(node.id, runs.get(node.id) ?? run);
  reopenWorkflowUpstreamForRework({
    runs,
    nodes: workflow.nodes,
    edges: workflow.edges,
    currentNodeId: node.id,
    predecessorNodeIds,
    reworkReason: reason,
  });
  // Claim the *live* map entry — never a stale local `run` (would drop reworkGeneration).
  const claimed = claimLiveRunAfterUpstreamReworkOpen({
    runs,
    nodeId: node.id,
    source: claimSource,
    reason: reason.slice(0, 500) || '【回滚说明】已触发工作流回滚',
  });
  Object.assign(run, claimed);
  await onProgress?.(claimed);

  const predNodes = predecessorNodeIds
    .map((id) => workflow.nodes.find((n) => n.id === id))
    .filter((n): n is WorkflowNode => !!n);
  const upstreamRoles = mentionedAgentIds
    .map((id) => projectMembers.find((r) => r.agentId === id))
    .filter((r): r is ProjectAgentRef => !!r);
  const fromRole = projectMembers.find((r) => r.agentId === reworkResult.agentId) ?? projectMembers[0]!;
  if (fromRole) {
    try {
      await announceWorkflowNodeUpstreamReworkProgress(
        task,
        node,
        asExecutionMember(fromRole),
        scenario,
      );
    } catch (err) {
      console.warn('[office] rollback progress card update failed:', err);
    }
    try {
      await announceWorkflowUpstreamRework(
        gateway,
        scenario,
        task,
        fromRole,
        node,
        predNodes,
        upstreamRoles,
        reason,
      );
    } catch (err) {
      console.warn('[office] rollback room announcement failed:', err);
    }
  }
  return claimed;
}

export async function announceAppliedWorkflowAutoRollbacks(
  gateway: GatewayManager,
  scenario: OfficeFixedGroup,
  task: OfficeTempProject,
  workflow: WorkflowDefinition,
  projectMembers: ProjectAgentRef[],
  appliedList: AppliedWorkflowAutoRollback[],
): Promise<void> {
  for (const applied of appliedList) {
    const node = workflow.nodes.find((n) => n.id === applied.nodeId);
    if (!node) continue;
    const predNodes = applied.decision.targetNodeIds
      .map((id) => workflow.nodes.find((n) => n.id === id))
      .filter((n): n is WorkflowNode => !!n);
    const upstreamAgentIds = new Set<string>();
    for (const pred of predNodes) {
      for (const roleId of workflowNodeAgentIds(pred)) {
        if (projectMembers.some((m) => m.agentId === roleId)) {
          upstreamAgentIds.add(roleId);
        }
      }
    }
    const upstreamRoles = [...upstreamAgentIds]
      .map((id) => projectMembers.find((m) => m.agentId === id))
      .filter((m): m is ProjectAgentRef => !!m);
    const fromAgentId = workflowNodePrimaryAgentId(node);
    const fromRole =
      projectMembers.find((m) => m.agentId === fromAgentId) ?? projectMembers[0];
    if (!fromRole) continue;
    try {
      await announceWorkflowUpstreamRework(
        gateway,
        scenario,
        task,
        asExecutionMember(fromRole),
        node,
        predNodes,
        upstreamRoles.map(asExecutionMember),
        applied.decision.reason,
        { reasonLabel: '本步结论未通过' },
      );
    } catch (err) {
      console.warn('[office] auto rollback room announcement failed:', err);
    }
  }
}

export async function executeWorkflowNode(
  gateway: GatewayManager,
  scenario: OfficeFixedGroup,
  task: OfficeTempProject,
  node: WorkflowNode,
  run: NodeRunRecord,
  workflow: WorkflowDefinition,
  signal?: AbortSignal,
  onProgress?: (run: NodeRunRecord) => void | Promise<void>,
  priorDeliverables?: string,
  runs?: Map<string, NodeRunRecord>,
  runOptions?: Pick<
    RunTaskWorkflowOptions,
    'userIntervention' | 'deferUpstreamRework' | 'onDeferredUpstreamRework'
  >,
  batchAbort?: AbortController,
  directPredecessorDeliverables?: string,
): Promise<NodeRunRecord> {
  const projectMembers = await loadProjectAgentRefs(task);
  const assignedIds = workflowNodeAgentIds(node);
  if (assignedIds.length === 0) {
    return { ...run, status: 'failed', error: 'No roles assigned', completedAt: Date.now() };
  }

  const assignedMembers = assignedIds
    .map((id) => projectMembers.find((r) => r.agentId === id))
    .filter((r): r is ProjectAgentRef => !!r);
  if (assignedMembers.length !== assignedIds.length) {
    return { ...run, status: 'failed', error: 'Role not found', completedAt: Date.now() };
  }

  run.agentId = workflowNodePrimaryAgentId(node);
  run.status = 'running';
  run.error = undefined;
  run.completionSource = undefined;
  // Snapshot downstream rework context BEFORE start-of-run hygiene. Clearing
  // `reworkReason` here (as we still do for edgeOutcome) would drop the
  // `【下游回流·须优先并针对性处理。原因如下】` prefix that `buildWorkflowReworkPromptPrefix`
  // injects into the upstream agent's next LLM prompt after rollback / auto-rework.
  const reworkReasonForPrompt = run.reworkReason?.trim() || undefined;
  // Clear stale routing state from a prior attempt (e.g. edgeOutcome='failure' left by
  // a manual abort) so a fresh run's outcome fully determines edge routing.
  run.edgeOutcome = undefined;
  run.startedAt = Date.now();
  await onProgress?.(run);

  const multiRole = assignedMembers.length > 1;
  const coNames = multiRole ? assignedMembers.map((r) => r.displayName) : [];
  const coordinatorAgentId = resolveProjectCoordinatorAgentId(task, scenario);
  const expectedHandoff = runs
    ? nextHandoffTargetsAfterNode(
      node.id,
      workflow.nodes,
      workflow.edges,
      runs,
      task.title,
    )
    : [];
  const stepIndex = workflow.nodes.findIndex((n) => n.id === node.id) + 1;
  const totalSteps = workflow.nodes.length;
  const intervention = task.workflowUserIntervention;
  const userInterventionRequest =
    intervention?.activeNodeId === node.id
      ? intervention.request
      : runOptions?.userIntervention?.nodeId === node.id
        ? runOptions.userIntervention.request
        : undefined;

  const roomHistory = workflowNodeIsMultiAgent(node)
    ? await getRoomMessages(task.id)
    : [];
  const reworkGeneration = run.reworkGeneration ?? 0;
  const completedAgentIds = new Set(run.completedAgentIds ?? []);

  const roleResults = await Promise.all(
    assignedMembers.map(async (role) => {
      if (
        reworkGeneration === 0
        && !userInterventionRequest
        && !completedAgentIds.has(role.agentId)
        && roleHasWorkflowNodeDeliverable(
          roomHistory,
          node,
          role.agentId,
          workflow.nodes,
        )
      ) {
        completedAgentIds.add(role.agentId);
      }
      if (completedAgentIds.has(role.agentId)) {
        const summary =
          workflowRoleDeliverSummaryFromRoom(
            roomHistory,
            node,
            role.agentId,
            workflow.nodes,
          ) ?? '（本角色本步已交付，跳过重复执行）';
        const mirroredConclusion = readWorkflowDeliverableConclusionFromMirrorText(summary);
        // Without a structured 结论 line we cannot safely judge pass/fail after
        // conclusion-only routing — re-execute instead of stamping success.
        if (!mirroredConclusion) {
          completedAgentIds.delete(role.agentId);
        } else {
          return {
            agentId: role.agentId,
            status: 'completed' as const,
            failureOutcome: isWorkflowDeliverableConclusionFailure(mirroredConclusion),
            summary,
          };
        }
      }
      return executeNodeForRole(
        gateway,
        scenario,
        task,
        node,
        role,
        workflow,
        projectMembers,
        signal,
        priorDeliverables,
        {
          coRoleNames: multiRole ? coNames.filter((n) => n !== role.displayName) : undefined,
          isCoordinatorRole: role.agentId === coordinatorAgentId,
          expectedHandoff,
          stepIndex: stepIndex > 0 ? stepIndex : undefined,
          totalSteps,
          userInterventionRequest,
          outputRetryAttempts: run.outputRetryAttempts,
          runs,
          reworkGeneration,
          reworkReason: reworkReasonForPrompt,
          directPredecessorDeliverables,
          onLlmDispatched: (runId) => {
            run.runId = runId;
            runs?.set(node.id, { ...run });
            void onProgress?.(run);
          },
          onRunRecordProgress: async (updatedRun) => {
            runs?.set(node.id, updatedRun);
            await onProgress?.(updatedRun);
          },
        },
      );
    }),
  );

  const finishedAgentIds = [
    ...new Set([
      ...completedAgentIds,
      ...roleResults.filter((r) => r.status === 'completed').map((r) => r.agentId),
    ]),
  ];
  run.completedAgentIds = finishedAgentIds.length > 0 ? finishedAgentIds : undefined;

  // room_heal may have claimed pending rework / output-retry on the live map entry
  // (local `run` can be a stale reference after runs.set). Yield without rewriting.
  const liveClaimed = runs?.get(node.id);
  if (sessionWorkflowOutcomesShouldYieldToPeerClaim(liveClaimed, 'session')) {
    Object.assign(run, liveClaimed);
    await onProgress?.(run);
    return run;
  }

  const outputRetryResult = roleResults.find((r) => r.outputRetry);
  if (outputRetryResult && runs) {
    const attempts = Math.max(
      run.outputRetryAttempts ?? 0,
      outputRetryResult.outputRetryAttempts ?? 0,
    );
    const claimed = markWorkflowPendingClaim(runs.get(node.id) ?? run, 'session', {
      edgeOutcome: undefined,
      error: outputRetryResult.error,
      outputRetryAttempts: attempts,
      completedAt: undefined,
      summary: undefined,
      startedAt: undefined,
    });
    Object.assign(run, claimed);
    runs.set(node.id, run);
    await onProgress?.(run);
    return run;
  }

  const reworkResult = roleResults.find((r) => r.upstreamRework);
  if (reworkResult?.upstreamRework && runs) {
    // Sibling nodes sharing this batchAbort must not show a generic interrupt —
    // they were stopped because this node triggered upstream rework.
    // Stamp is conditional (no overwrite of gateway/user reasons).
    if (batchAbort) {
      stampWorkflowParallelReworkBatchAbortReason(task.id);
      batchAbort.abort();
    }
    if (runOptions?.deferUpstreamRework) {
      const { predecessorNodeIds, mentionedAgentIds, reason } = reworkResult.upstreamRework;
      runOptions.onDeferredUpstreamRework?.({
        predecessorNodeIds,
        mentionedAgentIds,
        reason,
      });
      const deferred = markWorkflowPendingClaim(runs.get(node.id) ?? run, 'session', {
        edgeOutcome: 'failure',
        error: reason.slice(0, 500) || '【回滚说明】已触发工作流回滚',
        completedAt: undefined,
        summary: undefined,
        startedAt: undefined,
        outputRetryAttempts: undefined,
        completedAgentIds: undefined,
      });
      Object.assign(run, deferred);
      runs.set(node.id, run);
      await onProgress?.(run);
      return run;
    }
    return applyWorkflowRollbackForNode(
      gateway,
      scenario,
      task,
      node,
      run,
      workflow,
      runs,
      projectMembers,
      reworkResult,
      onProgress,
      'session',
    );
  }

  const failed = roleResults.filter((r) => r.status === 'failed');
  const hasFailureOutcome = roleResults.some((r) => r.failureOutcome);
  const projectMembersFinished = assignedMembers.every((r) =>
    finishedAgentIds.includes(r.agentId),
  );
  if (failed.length > 0) {
    run.status = 'failed';
    // Technical failure must not stamp business edgeOutcome=failure (would open on_failure).
    run.edgeOutcome = undefined;
    Object.assign(run, markWorkflowNodeCompletionSource(run, 'session'));
    run.error = failed
      .map((r) => {
        const name = projectMembers.find((x) => x.agentId === r.agentId)?.displayName ?? r.agentId;
        return `${name}: ${r.error ?? 'failed'}`;
      })
      .join('; ')
      .slice(0, 500);
  } else if (sessionRoleResultsIndicateSoftPendingOnly(roleResults)) {
    // Peer/heal soft yield: pending-only results must not promote to completed.
    const live = runs?.get(node.id);
    if (live) Object.assign(run, live);
    else run.status = 'pending';
    await onProgress?.(run);
    return run;
  } else if (multiRole && !projectMembersFinished) {
    run.status = 'pending';
    run.error = '多角色步骤尚未全员交付，等待续跑';
    run.completedAt = undefined;
    run.summary = undefined;
    run.startedAt = undefined;
    officeWorkflowLog('info', '[office][workflow-session] multi-role node held pending (awaiting all members)', {
      projectId: task.id,
      nodeId: node.id,
      finished: finishedAgentIds.length,
      assigned: assignedMembers.length,
    });
    await onProgress?.(run);
    return run;
  } else {
    run.status = 'completed';
    run.edgeOutcome = hasFailureOutcome ? 'failure' : 'success';
    Object.assign(run, markWorkflowNodeCompletionSource(run, 'session'));
    run.reworkReason = undefined;
    run.summary = roleResults
      .map((r) => {
        const name = projectMembers.find((x) => x.agentId === r.agentId)?.displayName ?? r.agentId;
        return `【${name}】\n${r.summary ?? ''}`.trim();
      })
      .filter(Boolean)
      .join('\n\n---\n\n')
      .slice(0, 2000);
    run.deliverablePath = roleResults.find((r) => r.deliverablePath?.trim())?.deliverablePath;
    run.sessionKey = roleResults[0]?.sessionKey;
    run.runId = roleResults[0]?.runId;
  }

  run.completedAt = Date.now();
  if (runs) runs.set(node.id, run);

  officeWorkflowLog('info', '[office][workflow-session] node outcome applied', {
    projectId: task.id,
    nodeId: node.id,
    status: run.status,
    edgeOutcome: run.edgeOutcome,
    failedRoles: failed.length,
    multiRole,
  });

  if (
    (run.status === 'completed' || run.status === 'failed' || run.status === 'skipped')
    && clearWorkflowUserInterventionIfNodeTerminal(task, node.id, run.status)
  ) {
    await persistTempProjectProgress({ ...task, updatedAt: Date.now() });
  }

  if (run.status === 'completed' && runs) {
    if (
      isUserCheckpointEnabled()
      && taskWorkflowEngine(task) !== 'langgraph'
      && resolveUserCheckpoint(task, node)
    ) {
      const roleNames = assignedMembers.map((m) => m.displayName);
      const snapshotted = captureReviewSnapshotOnRun(run, roleNames);
      runs.set(node.id, snapshotted);
      run = snapshotted;
      const isCheckpoint = (n: WorkflowNode) => resolveUserCheckpoint(task, n);
      if (task.workflowReviewBatch?.phase === 'deferred') {
        const reviewPatched = onDeferredNodeCompletedReview({
          task,
          node,
          nodes: workflow.nodes,
          isCheckpoint,
        });
        task.workflowReviewBatch = reviewPatched.workflowReviewBatch;
        task.updatedAt = reviewPatched.updatedAt;
      } else {
        const reviewPatched = openReviewItemForCompletedNode({
          task,
          node,
          nodes: workflow.nodes,
          isCheckpoint,
        });
        task.workflowReviewBatch = reviewPatched.workflowReviewBatch;
        task.updatedAt = reviewPatched.updatedAt;
      }
      task.nodeRuns = workflow.nodes.map((n) => {
        const nr = runs.get(n.id);
        return (
          nr ?? {
            nodeId: n.id,
            agentId: workflowNodePrimaryAgentId(n),
            status: 'pending' as NodeRunStatus,
          }
        );
      });
      await persistTempProjectProgress(task);
    }
  }

  if (run.status === 'completed' && runs && !isWorkflowTaskRunnerActive(task.id)) {
    const memberHandoffOk = roleResults.some((r) => r.memberHandoffOk);
    if (expectedHandoff.length > 0 && !memberHandoffOk) {
      const spokesperson = assignedMembers[0]!;
      try {
        await scheduleWorkflowHandoffCoordinatorWatch({
          gateway,
          group: scenario,
          project: task,
          node,
          fromAgentId: spokesperson.agentId,
          workflow,
          runs,
          expectedHandoff,
        });
      } catch (err) {
        console.warn('[office] workflow handoff watch schedule failed:', err);
      }
    }
  }

  return run;
}

function summarizeAgentError(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length <= 400) return trimmed;
  const modelNotFound = trimmed.match(/Unknown model:\s*[^\s)]+/i);
  const noKey = trimmed.match(/No API key found for provider\s+"([^"]+)"/i);
  if (modelNotFound && noKey) {
    return `${modelNotFound[0]}；${noKey[0]}。请在「模型」页配置密钥，并在角色设置中选择有效模型。`;
  }
  if (modelNotFound) {
    return `${modelNotFound[0]}。请在角色设置中重新选择模型。`;
  }
  if (noKey) {
    return `${noKey[0]}。请在「模型」页为该供应商配置 API Key，或重新保存办公角色。`;
  }
  return `${trimmed.slice(0, 400)}…`;
}

function mergeWorkflowRoomHealRoleStepIntoRun(
  run: NodeRunRecord,
  step: WorkflowRoleStepResult,
  nowMs: number = Date.now(),
): NodeRunRecord {
  const cleared = clearWorkflowRoomJsonHealTracking(run);
  if (step.upstreamRework) {
    return markWorkflowRoomHealPendingClaim(cleared, {
      edgeOutcome: undefined,
      error: step.error,
      summary: step.summary,
      completedAt: undefined,
      startedAt: undefined,
      outputRetryAttempts: undefined,
    });
  }
  if (step.outputRetry) {
    return markWorkflowRoomHealPendingClaim(cleared, {
      edgeOutcome: undefined,
      error: step.error,
      outputRetryAttempts: step.outputRetryAttempts,
      completedAt: undefined,
      summary: undefined,
      startedAt: undefined,
    });
  }
  if (step.status === 'failed') {
    return markWorkflowNodeCompletionSource(
      {
        ...cleared,
        status: 'failed',
        // Technical/heal failure — not business conclusion failure.
        edgeOutcome: undefined,
        error: step.error?.slice(0, 500),
        completedAt: nowMs,
        outputRetryAttempts: step.outputRetryAttempts,
      },
      'room_heal',
    );
  }
  if (step.status === 'completed') {
    return markWorkflowNodeCompletionSource(
      {
        ...cleared,
        status: 'completed',
        edgeOutcome: step.failureOutcome ? 'failure' : 'success',
        summary: step.summary?.slice(0, 2000),
        deliverablePath: step.deliverablePath,
        error: undefined,
        completedAt: nowMs,
        outputRetryAttempts: undefined,
      },
      'room_heal',
    );
  }
  return cleared;
}

type WorkflowRoomJsonHealValidationPassOptions = {
  /**
   * 辅助路径：校验失败只阻止计时/自愈，不 abort Session、不改节点失败态；
   * 同指纹不锁死，下一轮询可再验。通过后以校验完成墙钟重开稳定钟。
   */
  softFail?: boolean;
};

async function runWorkflowRoomJsonHealValidationPass(
  gateway: GatewayManager,
  scenario: OfficeFixedGroup,
  task: OfficeTempProject,
  nodes: WorkflowNode[],
  runs: Map<string, NodeRunRecord>,
  projectMembers: ProjectAgentRef[],
  teamMembers: ProjectAgentRef[],
  pending: WorkflowRoomHealPendingValidation[],
  onProgress?: (run: NodeRunRecord) => void | Promise<void>,
  passOpts?: WorkflowRoomJsonHealValidationPassOptions,
): Promise<{ changed: boolean; sessionRedispatchNodeIds: string[] }> {
  let changed = false;
  const sessionRedispatchNodeIds: string[] = [];
  const softFail = passOpts?.softFail === true;
  for (const item of pending) {
    const node = nodes.find((n) => n.id === item.nodeId);
    const run = runs.get(item.nodeId);
    const role = projectMembers.find((r) => r.agentId === item.roleId);
    if (!node || !run || !role || run.status !== 'running') continue;
    if (isWorkflowNodeRunClaimedByOtherPath(run, 'room_heal')) continue;

    const fp = item.receipt.fingerprint;
    if (!softFail && run.roomHealValidationFailFingerprint === fp) continue;

    const validation = await validateWorkflowRoomJsonLikeSession({
      raw: item.receipt.raw,
      roleName: role.displayName,
      project: task,
      group: scenario,
      member: asExecutionMember(role),
      teamMembers: teamMembers.map(asExecutionMember),
    });
    if (!validation.ok) {
      if (softFail) {
        runs.set(item.nodeId, {
          ...run,
          roomHealJsonFingerprint: fp,
          roomHealValidatedFingerprint: undefined,
          roomHealJsonStableSinceMs: undefined,
          roomHealValidationFailFingerprint: undefined,
        });
        await onProgress?.(runs.get(item.nodeId)!);
        changed = true;
        continue;
      }
      const failedStep = buildWorkflowRoleStepFromValidationFailure({
        roleId: role.agentId,
        issues: validation.issues,
        detail: validation.detail,
        outputRetryAttempts: run.outputRetryAttempts,
      });
      abortWorkflowNodeRun(task.id, item.nodeId);
      const updated = mergeWorkflowRoomHealRoleStepIntoRun(run, failedStep);
      runs.set(item.nodeId, {
        ...updated,
        roomHealValidationFailFingerprint: fp,
        roomHealJsonFingerprint: undefined,
        roomHealJsonStableSinceMs: undefined,
        roomHealValidatedFingerprint: undefined,
      });
      await onProgress?.(runs.get(item.nodeId)!);
      if (failedStep.outputRetry) {
        sessionRedispatchNodeIds.push(item.nodeId);
        if (failedStep.error) {
          await announceWorkflowRoleStepFailureProgress(
            gateway,
            scenario,
            task,
            node,
            asExecutionMember(role),
            failedStep.error,
            'outputRetry',
          );
        }
      } else if (failedStep.status === 'failed' && failedStep.error) {
        await announceWorkflowRoleStepFailureProgress(
          gateway,
          scenario,
          task,
          node,
          asExecutionMember(role),
          failedStep.error,
          'failed',
        );
      }
      changed = true;
      continue;
    }

    if (softFail) {
      // 开表必须用校验完成墙钟；receipt.fp 与 tick 对齐，避免 validated 与群聊指纹漂移导致永远计不到 120s。
      runs.set(
        item.nodeId,
        stampAuxiliaryRoomHealValidationSuccess(run, fp, Date.now()),
      );
    } else {
      runs.set(item.nodeId, markWorkflowRoomJsonHealValidated(run, validation.fingerprint));
    }
    await onProgress?.(runs.get(item.nodeId)!);
    changed = true;
  }

  return { changed, sessionRedispatchNodeIds };
}

export async function redispatchWorkflowNodesSessionOutputRetry(
  gateway: GatewayManager,
  scenario: OfficeFixedGroup,
  task: OfficeTempProject,
  workflow: WorkflowDefinition,
  nodes: WorkflowNode[],
  nodeIds: string[],
  runs: Map<string, NodeRunRecord>,
  projectMembers: ProjectAgentRef[],
  _teamMembers: ProjectAgentRef[],
  ac: AbortController,
  options: RunTaskWorkflowOptions | undefined,
  onProgress: (run: NodeRunRecord) => void | Promise<void>,
): Promise<void> {
  for (const nodeId of nodeIds) {
    const node = nodes.find((n) => n.id === nodeId);
    const current = runs.get(nodeId);
    if (!node || !current || current.status !== 'pending') continue;

    abortWorkflowNodeRun(task.id, nodeId);
    const projectRoot = await workflowProjectRootForTask(task);
    const prior = priorContextForNode(
      runs,
      nodes,
      projectMembers,
      nodeId,
      workflow.edges,
      projectRoot,
    );
    const directPrior = priorContextForNode(
      runs,
      nodes,
      projectMembers,
      nodeId,
      workflow.edges,
      projectRoot,
      'direct_predecessors',
    );
    const nodeRunAc = new AbortController();
    registerWorkflowNodeRunAbort(task.id, nodeId, nodeRunAc);
    const runSignal = AbortSignal.any([ac.signal, nodeRunAc.signal]);
    try {
      const updated = await executeWorkflowNode(
        gateway,
        scenario,
        task,
        node,
        { ...current },
        workflow,
        runSignal,
        async (run) => {
          runs.set(nodeId, run);
          await onProgress(run);
        },
        prior || undefined,
        runs,
        options,
        undefined,
        directPrior || undefined,
      );
      runs.set(nodeId, updated);
      await onProgress(updated);
    } finally {
      clearWorkflowNodeRunAbort(task.id, nodeId);
      nodeRunAc.abort();
    }
  }
}

type WorkflowRoomJsonHealApplyPassOptions = {
  /** 辅助路径：须在校验通过后的 stableSince 上再满稳定窗才可应用。 */
  requireValidatedStableMs?: number;
  /** 应用前再验失败时清空 validated/计时以便重开校验→计时。 */
  clearOnRevalidateFail?: boolean;
  nowMs?: number;
  /** Same floor as auxiliary extract — ignore prior-run room JSON on revalidate. */
  minRoomMessageTimestampMs?: number;
};

async function runWorkflowRoomJsonHealApplyPass(
  gateway: GatewayManager,
  scenario: OfficeFixedGroup,
  task: OfficeTempProject,
  workflow: WorkflowDefinition,
  nodes: WorkflowNode[],
  runs: Map<string, NodeRunRecord>,
  projectMembers: ProjectAgentRef[],
  teamMembers: ProjectAgentRef[],
  onProgress?: (run: NodeRunRecord) => void | Promise<void>,
  passOpts?: WorkflowRoomJsonHealApplyPassOptions,
): Promise<{ changed: boolean; rollbacks: WorkflowRoomHealRollbackIntent[] }> {
  const room = await getRoomMessages(task.id);
  const rollbacks: WorkflowRoomHealRollbackIntent[] = [];
  let changed = false;
  const coordinatorAgentId = resolveProjectCoordinatorAgentId(task, scenario);
  const nowMs = passOpts?.nowMs ?? Date.now();
  const requireValidatedStableMs = passOpts?.requireValidatedStableMs;
  const clearOnRevalidateFail = passOpts?.clearOnRevalidateFail === true;

  for (const node of nodes) {
    const run = runs.get(node.id);
    if (!run || run.status !== 'running' || !run.roomHealValidatedFingerprint) continue;
    if (isWorkflowNodeRunClaimedByOtherPath(run, 'room_heal')) continue;
    if (run.roomHealValidatedFingerprint !== run.roomHealJsonFingerprint) continue;
    if (
      requireValidatedStableMs != null
      && !isAuxiliaryValidatedJsonStableForHeal(run, nowMs, requireValidatedStableMs)
    ) {
      continue;
    }

    const role = projectMembers.find((r) => r.agentId === (run.agentId ?? workflowNodePrimaryAgentId(node)));
    if (!role) continue;

    const taskRoom = room.filter(
      (m) => m.projectId === task.id && m.phase !== 'project_closure',
    );
    const receipt = extractWorkflowRoomJsonReceipt(
      taskRoom,
      node,
      workflow.nodes,
      role,
      {
        minTimestampMs: resolveRoomHealMinTimestampMs(
          { minRoomMessageTimestampMs: passOpts?.minRoomMessageTimestampMs },
          run,
        ),
      },
    );
    if (!receipt || receipt.fingerprint !== run.roomHealValidatedFingerprint) continue;

    const validation = await validateWorkflowRoomJsonLikeSession({
      raw: receipt.raw,
      roleName: role.displayName,
      project: task,
      group: scenario,
      member: asExecutionMember(role),
      teamMembers: teamMembers.map(asExecutionMember),
    });
    if (!validation.ok) {
      if (clearOnRevalidateFail) {
        runs.set(node.id, {
          ...run,
          roomHealValidatedFingerprint: undefined,
          roomHealJsonStableSinceMs: undefined,
          roomHealValidationFailFingerprint: undefined,
        });
        await onProgress?.(runs.get(node.id)!);
        changed = true;
      }
      continue;
    }

    const expectedHandoff = nextHandoffTargetsAfterNode(
      node.id,
      workflow.nodes,
      workflow.edges,
      runs,
      task.title,
    );
    const roleStep = await applyWorkflowRoleStepFromParsedReply(
      gateway,
      scenario,
      task,
      node,
      asExecutionMember(role),
      workflow,
      validation.parsed,
      validation.raw,
      {
        isCoordinatorRole: role.agentId === coordinatorAgentId,
        expectedHandoff,
        outputRetryAttempts: run.outputRetryAttempts,
        allMembers: projectMembers.map(asExecutionMember),
        teamMembers: teamMembers.map(asExecutionMember),
        roomPhases: null,
      },
    );

    if (roleStep.upstreamRework) {
      // Atomic: abort + reopen + claim before any further await that could let
      // session observe claim-without-reopen (forbidden race window).
      const edgeList = workflowEdgeList(workflow.nodes, workflow.edges);
      const predecessorNodeIds = roleStep.upstreamRework.predecessorNodeIds;
      abortWorkflowNodeRun(task.id, node.id);
      for (const predId of predecessorNodeIds) {
        abortWorkflowNodeRun(task.id, predId);
      }
      for (const downId of collectDownstreamNodeIds(node.id, edgeList)) {
        abortWorkflowNodeRun(task.id, downId);
      }
      await applyWorkflowRollbackForNode(
        gateway,
        scenario,
        task,
        node,
        runs.get(node.id) ?? run,
        workflow,
        runs,
        projectMembers,
        {
          agentId: role.agentId,
          status: 'pending',
          upstreamRework: {
            predecessorNodeIds,
            mentionedAgentIds: roleStep.upstreamRework.mentionedRoleIds,
            reason: roleStep.upstreamRework.reason,
          },
        },
        onProgress,
        'room_heal',
      );
      changed = true;
      continue;
    }

    const updated = mergeWorkflowRoomHealRoleStepIntoRun(run, roleStep);
    runs.set(node.id, updated);
    await onProgress?.(updated);
    if (updated.status === 'completed' || updated.status === 'failed') {
      abortWorkflowNodeRun(task.id, node.id);
    }
    changed = true;
  }

  return { changed, rollbacks };
}

async function applyWorkflowRoomHealRollbacks(
  gateway: GatewayManager,
  scenario: OfficeFixedGroup,
  task: OfficeTempProject,
  workflow: WorkflowDefinition,
  runs: Map<string, NodeRunRecord>,
  projectMembers: ProjectAgentRef[],
  rollbacks: WorkflowRoomHealRollbackIntent[],
  onProgress?: (run: NodeRunRecord) => void | Promise<void>,
): Promise<void> {
  const edgeList = workflowEdgeList(workflow.nodes, workflow.edges);
  for (const rb of rollbacks) {
    const node = workflow.nodes.find((n) => n.id === rb.nodeId);
    const run = runs.get(rb.nodeId);
    if (!node || !run) continue;
    const { predecessorNodeIds, mentionedRoles, reason } = rb.decision;
    abortWorkflowNodeRun(task.id, rb.nodeId);
    for (const predId of predecessorNodeIds) {
      abortWorkflowNodeRun(task.id, predId);
    }
    for (const downId of collectDownstreamNodeIds(rb.nodeId, edgeList)) {
      abortWorkflowNodeRun(task.id, downId);
    }
    await applyWorkflowRollbackForNode(
      gateway,
      scenario,
      task,
      node,
      run,
      workflow,
      runs,
      projectMembers,
      {
        agentId: rb.roleId,
        status: 'pending',
        upstreamRework: {
          predecessorNodeIds,
          mentionedAgentIds: mentionedRoles.map((r) => r.id),
          reason: reason || rb.summary.slice(0, 500),
        },
      },
      onProgress,
      'room_heal',
    );
  }
}

async function applyWorkflowRoomHealEffects(
  gateway: GatewayManager,
  scenario: OfficeFixedGroup,
  task: OfficeTempProject,
  workflow: WorkflowDefinition,
  nodes: WorkflowNode[],
  _edges: WorkflowEdge[],
  runs: Map<string, NodeRunRecord>,
  projectMembers: ProjectAgentRef[],
  teamMembers: ProjectAgentRef[],
  ac: AbortController,
  options: RunTaskWorkflowOptions | undefined,
  reportProgress: () => Promise<void>,
  healResult: { changed: boolean; sessionRedispatchNodeIds: string[] },
): Promise<void> {
  if (healResult.changed) {
    task.status = resolveEffectiveTaskStatus(task, runs, nodes);
    await reportProgress();
  }
  if (healResult.sessionRedispatchNodeIds.length > 0) {
    await redispatchWorkflowNodesSessionOutputRetry(
      gateway,
      scenario,
      task,
      workflow,
      nodes,
      healResult.sessionRedispatchNodeIds,
      runs,
      projectMembers,
      teamMembers,
      ac,
      options,
      async (run) => {
        runs.set(run.nodeId, run);
        await reportProgress();
      },
    );
    task.status = resolveEffectiveTaskStatus(task, runs, nodes);
    await reportProgress();
  }
}

function startWorkflowRoomAuxiliaryHealDuringSessionWait(params: {
  gateway: GatewayManager;
  scenario: OfficeFixedGroup;
  task: OfficeTempProject;
  workflow: WorkflowDefinition;
  node: WorkflowNode;
  projectMembers: ProjectAgentRef[];
  teamMembers: ProjectAgentRef[];
  runs: Map<string, NodeRunRecord>;
  sessionKey: string;
  sessionStartedAtMs: number;
  signal?: AbortSignal;
  onRunRecordProgress?: (run: NodeRunRecord) => void | Promise<void>;
}): () => void {
  if (isTaskUserAborted(params.task.id)) return () => {};

  const edges = workflowEdgeList(params.workflow.nodes, params.workflow.edges);
  let tickInFlight = false;

  const onHealProgress = async (run: NodeRunRecord) => {
    params.runs.set(run.nodeId, run);
    await params.onRunRecordProgress?.(run);
  };

  const timer = setInterval(() => {
    if (params.signal?.aborted) return;
    if (isTaskUserAborted(params.task.id)) return;
    const liveRun = params.runs.get(params.node.id);
    if (!liveRun || liveRun.status !== 'running') return;
    if (tickInFlight) return;
    tickInFlight = true;
    void syncWorkflowRunsFromRoomHeal(
      params.gateway,
      params.scenario,
      params.task,
      params.workflow,
      params.workflow.nodes,
      edges,
      params.runs,
      params.projectMembers,
      params.teamMembers,
      onHealProgress,
      {
        logContext: 'auxiliary-during-session-wait',
        onlyNodeId: params.node.id,
        auxiliaryPath: {
          sessionKey: params.sessionKey,
          sessionStartedAtMs: params.sessionStartedAtMs,
        },
      },
    )
      .catch((err) => {
        officeWorkflowLog('warn', '[office][workflow-heal][auxiliary] tick failed', {
          taskId: params.task.id,
          nodeId: params.node.id,
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        tickInFlight = false;
      });
  }, WORKFLOW_ROOM_AUXILIARY_HEAL_POLL_MS);

  return () => clearInterval(timer);
}

/**
 * 群聊 JSON 自愈：主路径空闲兜底仍为「先稳定 5min → 校验 → 应用」；
 * auxiliaryPath 为「先完整校验 → 通过后稳定 120s → 应用前再验」（失败不 abort Session）。
 */
export async function syncWorkflowRunsFromRoomHeal(
  gateway: GatewayManager,
  scenario: OfficeFixedGroup,
  task: OfficeTempProject,
  workflow: WorkflowDefinition,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  runs: Map<string, NodeRunRecord>,
  projectMembers: ProjectAgentRef[],
  teamMembers: ProjectAgentRef[],
  onProgress?: (run: NodeRunRecord) => void | Promise<void>,
  healOpts?: WorkflowRoomHealSyncOptions,
): Promise<{ changed: boolean; sessionRedispatchNodeIds: string[] }> {
  const isAuxiliary = Boolean(healOpts?.auxiliaryPath);
  const jsonStableMs =
    healOpts?.jsonStableMs
    ?? (isAuxiliary ? WORKFLOW_ROOM_JSON_HEAL_AUXILIARY_STABLE_MS : undefined);
  const logContext = healOpts?.logContext;
  const nowMs = Date.now();
  const room = await getRoomMessages(task.id);
  const minRoomMessageTimestampMs = healOpts?.auxiliaryPath?.sessionStartedAtMs;
  const healPassOpts = {
    nowMs,
    roles: teamAgentRefs(projectMembers),
    edges,
    teamRoles: teamAgentRefs(teamMembers),
    jsonStableMs,
    onlyNodeId: healOpts?.onlyNodeId,
    reviewHealGuard: buildReviewHealGuard(task),
    minRoomMessageTimestampMs,
  };
  const healPass = healWorkflowRunningNodesFromRoom(nodes, runs, room, task.id, healPassOpts);
  let changed = healPass.changed;
  const rollbacks: WorkflowRoomHealRollbackIntent[] = [];
  const sessionRedispatchNodeIds: string[] = [];

  let pendingValidation = isAuxiliary
    ? collectAuxiliaryRoomHealPendingValidation(nodes, runs, room, task.id, healPassOpts)
    : healPass.pendingValidation;
  if (isAuxiliary && pendingValidation.length > 0) {
    const before = pendingValidation.length;
    pendingValidation = filterAuxiliaryRoomHealCandidates(pendingValidation);
    if (before > pendingValidation.length) {
      workflowHealLog(logContext, 'auxiliary path filtered candidates', {
        taskId: task.id,
        before,
        after: pendingValidation.length,
      });
    }
  }

  if (pendingValidation.length > 0) {
    workflowHealLog(logContext, isAuxiliary
      ? 'pending JSON validation (validate-before-stable)'
      : 'pending JSON validation', {
      taskId: task.id,
      nodeIds: pendingValidation.map((p) => p.nodeId),
      stableMs: jsonStableMs ?? 'default',
    });
    const validationPass = await runWorkflowRoomJsonHealValidationPass(
      gateway,
      scenario,
      task,
      nodes,
      runs,
      projectMembers,
      teamMembers,
      pendingValidation,
      onProgress,
      isAuxiliary
        ? { softFail: true }
        : undefined,
    );
    if (validationPass.changed) changed = true;
    sessionRedispatchNodeIds.push(...validationPass.sessionRedispatchNodeIds);
  }

  const applyPass = await runWorkflowRoomJsonHealApplyPass(
    gateway,
    scenario,
    task,
    workflow,
    nodes,
    runs,
    projectMembers,
    teamMembers,
    onProgress,
    isAuxiliary
      ? {
          requireValidatedStableMs: jsonStableMs ?? WORKFLOW_ROOM_JSON_HEAL_AUXILIARY_STABLE_MS,
          clearOnRevalidateFail: true,
          nowMs,
          minRoomMessageTimestampMs,
        }
      : undefined,
  );
  rollbacks.push(...applyPass.rollbacks);
  if (applyPass.changed) {
    changed = true;
    for (const node of nodes) {
      const run = runs.get(node.id);
      if (run?.status === 'completed' && run.completionSource === 'room_heal') {
        workflowHealLog(logContext, 'node completed via auxiliary room heal', {
          taskId: task.id,
          nodeId: node.id,
          title: node.title,
        });
      }
    }
  }

  const unstuck = unstuckStaleRunningNodeRuns(nodes, runs, room, task.id);
  if (unstuck) changed = true;

  if (rollbacks.length > 0) {
    await applyWorkflowRoomHealRollbacks(
      gateway,
      scenario,
      task,
      workflow,
      runs,
      projectMembers,
      rollbacks,
      onProgress,
    );
    changed = true;
  }

  return { changed, sessionRedispatchNodeIds: [...new Set(sessionRedispatchNodeIds)] };
}

export async function runTaskWorkflow(
  gateway: GatewayManager,
  scenario: OfficeFixedGroup,
  task: OfficeTempProject,
  options?: RunTaskWorkflowOptions,
): Promise<OfficeTempProject> {
  const mode = options?.mode ?? 'fresh';
  const onUpdate = options?.onUpdate;
  // Only clear prior user-abort if this run still owns the abort-seq permit.
  // Unconditional clear let a concurrent abort be wiped by a stale runner.
  if (options?.abortClearPermit !== undefined) {
    clearTaskUserAborted(task.id, { onlyIfAbortSeq: options.abortClearPermit });
  } else {
    claimTaskAbortClear(task.id);
  }
  if (shouldBlockOfficeLlmSend(task.id)) {
    throw new ProjectAbortQuiescingError(task.id);
  }
  getWorkflowTaskRunController(task.id)?.abort();
  const ac = new AbortController();
  registerWorkflowTaskRun(task.id, ac);

  const {
    projectHasNoOwnWorkflow,
    pruneNodeRunsToWorkflow,
  } = await import('../../../src/lib/office-spawned-workflow-ownership');
  const { alignNoOwnSpawnedProjectForRerun } = await import('../../../src/lib/office-task-workflow');
  if (projectHasNoOwnWorkflow(task)) {
    const aligned = alignNoOwnSpawnedProjectForRerun(task, scenario);
    if (aligned !== task) {
      task = aligned;
      await upsertTempProject({ ...task, workflowFreezeSnapshot: undefined });
    }
  }
  const projectMembers = await loadProjectAgentRefs(task);
  if (shouldBlockOfficeLlmSend(task.id)) {
    throw new ProjectAbortQuiescingError(task.id);
  }
  const teamMembers = projectMembers;
  let workflow = materializeWorkflowForProjectRun(task, scenario, projectMembers);
  workflow = resolveWorkflowForExecution(workflow, projectMembers);
  // After freeze clear / group sync, drop nodeRuns for deleted nodes so continue
  // cannot revive targets that no longer exist in the effective workflow.
  if (Array.isArray(task.nodeRuns) && task.nodeRuns.length > 0) {
    const pruned = pruneNodeRunsToWorkflow(task.nodeRuns, workflow);
    if (pruned.length !== task.nodeRuns.length) {
      task = { ...task, nodeRuns: pruned, updatedAt: Date.now() };
      await upsertTempProject(task);
    }
  }
  const syncedJson = JSON.stringify(workflow);
  const taskJson = JSON.stringify(task.workflow ?? null);
  if (syncedJson !== taskJson && shouldPersistResolvedWorkflowToProject(task)) {
    task = { ...task, workflow, updatedAt: Date.now() };
    await upsertTempProject(task);
  }

  if (mode === 'fresh') {
    if (shouldBlockOfficeLlmSend(task.id)) {
      throw new ProjectAbortQuiescingError(task.id);
    }
    if (options?.clearProjectRoom) {
      await clearProjectRunArtifacts(task.id);
    } else {
      const { resetProjectRunState } = await import('./store');
      await resetProjectRunState(task.id);
    }
  }

  task.status = mode === 'single' ? task.status : 'running';
  if (mode !== 'single') task.workflowRunId = `run-${Date.now()}`;
  if (mode === 'fresh' || mode === 'continue') {
    task.workflowStall = undefined;
  }
  task.nodeRuns = nodeRunsFromTaskOrFresh(task, workflow.nodes, mode);
  if (shouldBlockOfficeLlmSend(task.id)) {
    throw new ProjectAbortQuiescingError(task.id);
  }
  await upsertTempProject(task);
  onUpdate?.(task);

  const runs = new Map(task.nodeRuns.map((r) => [r.nodeId, r]));
  const { nodes } = workflow;
  if (mode !== 'single') {
    resetUnattributedCompletedNodeRuns(runs);
    task.nodeRuns = nodes.map((n) => {
      const run = runs.get(n.id);
      return (
        run ?? {
          nodeId: n.id,
          agentId: workflowNodePrimaryAgentId(n),
          status: 'pending' as NodeRunStatus,
        }
      );
    });
    await upsertTempProject({ ...task, nodeRuns: task.nodeRuns, updatedAt: Date.now() });
    if (mode === 'continue') {
      const startupRollbacks = recoverStaleCompletedFailureRollbacks({
        runs,
        nodes,
        edges: workflow.edges,
      });
      if (startupRollbacks.length > 0) {
        await announceAppliedWorkflowAutoRollbacks(
          gateway,
          scenario,
          task,
          workflow,
          projectMembers,
          startupRollbacks,
        );
        task.nodeRuns = nodes.map((n) => {
          const run = runs.get(n.id);
          return (
            run ?? {
              nodeId: n.id,
              agentId: workflowNodePrimaryAgentId(n),
              status: 'pending' as NodeRunStatus,
            }
          );
        });
        task.workflowStall = undefined;
        await upsertTempProject({ ...task, nodeRuns: task.nodeRuns, updatedAt: Date.now() });
      }
    }
  }
  const edges = workflowEdgeList(nodes, workflow.edges);

  if (nodes.length === 0) {
    task.status = 'failed';
    task.updatedAt = Date.now();
    await upsertTempProject(task);
    clearWorkflowTaskRun(task.id);
    return task;
  }

  let workflowStalled = false;
  const reportProgress = () =>
    persistTaskProgress(task, runs, nodes, onUpdate, workflowStalled);

  if (mode !== 'single') {
    try {
      await announceTaskWorkflowStarted(gateway, scenario, task, nodes, mode);
    } catch (err) {
      console.warn('[office] task workflow start room announcement failed:', err);
    }
  }

  if (mode === 'single') {
    const node = nodes.find((n) => n.id === options?.nodeId);
    if (!node) {
      task.status = 'failed';
      task.updatedAt = Date.now();
      await upsertTempProject(task);
      clearWorkflowTaskRun(task.id);
      return task;
    }
    const assignedIds = workflowNodeAgentIds(node);
    const assignedMembers = assignedIds
      .map((id) => projectMembers.find((r) => r.agentId === id))
      .filter((r): r is ProjectAgentRef => !!r);
    if (assignedMembers.length === 0) {
      task.status = 'failed';
      await upsertTempProject(task);
      clearWorkflowTaskRun(task.id);
      return task;
    }
    const spokesperson = assignedMembers[0]!;
    const blockingRoleIds = getIncompletePredecessorRoleIds(node.id, nodes, edges, runs);
    if (blockingRoleIds.length > 0) {
      const blockingRoles = blockingRoleIds
        .map((id) => projectMembers.find((r) => r.agentId === id))
        .filter((r): r is ProjectAgentRef => !!r);
      await announceDependencyWait(gateway, scenario, task, node, spokesperson, blockingRoles);
      const run = runs.get(node.id) ?? {
        nodeId: node.id,
        agentId: workflowNodePrimaryAgentId(node),
        status: 'pending' as const,
      };
      run.error = 'Waiting for upstream roles to complete';
      runs.set(node.id, run);
      task.status = resolveEffectiveTaskStatus(task, runs, nodes);
      await reportProgress();
      clearWorkflowTaskRun(task.id);
      return task;
    }
    try {
      task.workflowRunId = `run-single-${Date.now()}`;
      await upsertTempProject(task);
      task.status = 'running';
      let current = runs.get(node.id);
      if (!current) {
        current = { nodeId: node.id, agentId: workflowNodePrimaryAgentId(node), status: 'pending' };
        runs.set(node.id, current);
      }
      if (current.status === 'completed') {
        task.status = resolveEffectiveTaskStatus(task, runs, nodes);
        await reportProgress();
        clearWorkflowTaskRun(task.id);
        return task;
      }
      const projectRoot = await workflowProjectRootForTask(task);
      const prior = priorContextForNode(
        runs,
        nodes,
        projectMembers,
        node.id,
        workflow.edges,
        projectRoot,
      );
      const directPrior = priorContextForNode(
        runs,
        nodes,
        projectMembers,
        node.id,
        workflow.edges,
        projectRoot,
        'direct_predecessors',
      );
      const updated = await executeWorkflowNode(
        gateway,
        scenario,
        task,
        node,
        { ...current, status: 'pending', edgeOutcome: undefined, error: undefined, completedAt: undefined },
        workflow,
        ac.signal,
        async (run) => {
          runs.set(node.id, run);
          await reportProgress();
        },
        prior || undefined,
        runs,
        options,
        undefined,
        directPrior || undefined,
      );
      runs.set(node.id, updated);
      task.status = resolveEffectiveTaskStatus(task, runs, nodes);
      await reportProgress();
      if (shouldAnnounceWorkflowProjectClosure(task, runs, nodes)) {
        try {
          await announceTaskProjectClosure(gateway, scenario, task, runs, nodes);
        } catch (err) {
          console.warn('[office] project closure announcement failed:', err);
        }
      }
      return task;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      task.status = 'failed';
      const run = runs.get(node.id);
      if (run) {
        run.status = 'failed';
        run.error = message.slice(0, 500);
        runs.set(node.id, run);
      }
      await reportProgress();
      throw err;
    } finally {
      clearWorkflowTaskRun(task.id);
    }
  }

  let idleRounds = 0;
  let lastRoomHealSyncMs = 0;
  let lastRunningWaitLogMs = 0;
  const stallRoundLimit = () => workflowStallIdleRoundLimit(nodes, runs, WORKFLOW_STALL_POLL_MS);

  try {
    while (!ac.signal.aborted) {
      const stored = await getTempProject(task.id);
      if (stored && isTempProjectArchived(stored)) {
        onUpdate?.(stored);
        return stored;
      }
      if (stored) {
        // Evaluate sync against pre-merge memory: settle clears the disk batch, and
        // mergeReviewStateFromStored then clears memory's batch — checking after merge
        // would see !sb&&!tb and skip pulling reopen/rework nodeRuns.
        const syncRunsFromStored = shouldSyncNodeRunsFromStoredReview(stored, task);
        task = mergeReviewStateFromStored(stored, task, runs);
        if (syncRunsFromStored) {
          for (const nr of stored.nodeRuns) {
            runs.set(nr.nodeId, nr);
          }
          task = {
            ...task,
            nodeRuns: stored.nodeRuns,
            workflowUserIntervention: stored.workflowUserIntervention,
            updatedAt: stored.updatedAt,
          };
        }
      }

      const batchBeforeFinalize = task.workflowReviewBatch;
      if (task.workflowReviewBatch && task.workflowReviewBatch.phase !== 'closed') {
        const syncedBatch = syncReviewBatchExecutionStates(task.workflowReviewBatch, runs);
        if (syncedBatch !== task.workflowReviewBatch) {
          task = { ...task, workflowReviewBatch: syncedBatch };
        }
        task = finalizeDeferredBatchIfReady({ task, runs });
      }
      if (batchBeforeFinalize && !task.workflowReviewBatch) {
        await reportProgress();
      }

      const nowHeal = Date.now();
      if (nowHeal - lastRoomHealSyncMs >= WORKFLOW_ROOM_HEAL_POLL_MS) {
        lastRoomHealSyncMs = nowHeal;
        const healResult = await syncWorkflowRunsFromRoomHeal(
          gateway,
          scenario,
          task,
          workflow,
          nodes,
          edges,
          runs,
          projectMembers,
          teamMembers,
          async (run) => {
            runs.set(run.nodeId, run);
            await reportProgress();
          },
          { logContext: 'loop' },
        );
        await applyWorkflowRoomHealEffects(
          gateway,
          scenario,
          task,
          workflow,
          nodes,
          edges,
          runs,
          projectMembers,
          teamMembers,
          ac,
          options,
          reportProgress,
          healResult,
        );
      }

      const pending = [...runs.values()].filter((r) => r.status === 'pending' || r.status === 'running');
      const stillRunning = [...runs.values()].some((r) => r.status === 'running');
      if (pending.length === 0 && !stillRunning) {
        if (shouldWorkflowRunnerSleepForReview({ task, nodes, edges, runs })) {
          idleRounds = 0;
          await reportProgress();
          await new Promise((r) => setTimeout(r, WORKFLOW_STALL_POLL_MS));
          continue;
        }
        if (
          mode === 'continue'
          && reopenFailedRunsForWorkflowContinue(runs, nodes)
        ) {
          await reportProgress();
          continue;
        }
        break;
      }

      const holdIds = reviewHoldNodeIds(task);
      const batch = nextRunnableNodesForExecution(nodes, edges, runs, holdIds);
      if (batch.length === 0) {
        const anyFailed = [...runs.values()].some((r) => r.status === 'failed');
        if (anyFailed) {
          if (
            mode === 'continue'
            && reopenFailedRunsForWorkflowContinue(runs, nodes)
          ) {
            await reportProgress();
            continue;
          }
          break;
        }
        if (stillRunning) {
          idleRounds = 0;
          // No newly-runnable node, but node(s) still marked running: we are waiting for a run
          // to settle (收稿). Throttled log so a node stuck in running never-settling is traceable.
          const nowWait = Date.now();
          if (nowWait - lastRunningWaitLogMs >= 30_000) {
            lastRunningWaitLogMs = nowWait;
            officeWorkflowLog('warn', '[office][workflow-session] waiting for running node(s) to settle', {
              projectId: task.id,
              runningNodeIds: [...runs.values()]
                .filter((r) => r.status === 'running')
                .map((r) => r.nodeId)
                .join(','),
            });
          }
          await new Promise((r) => setTimeout(r, WORKFLOW_STALL_POLL_MS));
          continue;
        }
        if (shouldWorkflowRunnerSleepForReview({ task, nodes, edges, runs })) {
          idleRounds = 0;
          await reportProgress();
          await new Promise((r) => setTimeout(r, WORKFLOW_STALL_POLL_MS));
          continue;
        }
        if (tryResolveWorkflowFailureDeadlock({ runs, nodes, edges })) {
          idleRounds = 0;
          await reportProgress();
          continue;
        }
        idleRounds += 1;
        const stallMessage = diagnoseWorkflowStall(nodes, edges, runs, task);
        if (!stallMessage) {
          idleRounds = 0;
          await reportProgress();
          await new Promise((r) => setTimeout(r, WORKFLOW_STALL_POLL_MS));
          continue;
        }
        if (idleRounds > stallRoundLimit()) {
          workflowStalled = true;
          const pendingNodeIds = nodes
            .filter((n) => runs.get(n.id)?.status === 'pending')
            .map((n) => n.id);
          officeWorkflowLog('warn', '[office][workflow-session] workflow STALLED — no runnable node', {
            projectId: task.id,
            pendingNodeIds: pendingNodeIds.join(','),
            diagnosis: stallMessage.slice(0, 200),
          });
          task.workflowStall = {
            at: Date.now(),
            diagnosis: stallMessage,
            pendingNodeIds,
            suggestedAction: 'POST /office/projects/:id/unblock',
          };
          for (const node of nodes) {
            const run = runs.get(node.id);
            if (run && run.status === 'pending') {
              run.error = stallMessage.slice(0, 500);
              const role = projectMembers.find((r) => r.agentId === workflowNodePrimaryAgentId(node));
              if (role) {
                void announceTaskNodeStalled(gateway, scenario, task, node, role, stallMessage).catch(
                  (err) => console.warn('[office] stall room announcement failed:', err),
                );
              }
            }
          }
          break;
        }
        await new Promise((r) => setTimeout(r, WORKFLOW_STALL_POLL_MS));
        continue;
      }

      idleRounds = 0;

      try {
        await announceWorkflowRunnableBatch(gateway, scenario, task, batch);
      } catch (err) {
        console.warn('[office] workflow batch room announcement failed:', err);
      }

      const batchAbort = new AbortController();
      let results: NodeRunRecord[];
      try {
        results = await Promise.all(
          batch.map(async (node) => {
            const current = runs.get(node.id);
            if (!current || current.status !== 'pending') {
              return (
                current ?? {
                  nodeId: node.id,
                  agentId: workflowNodePrimaryAgentId(node),
                  status: 'failed' as const,
                  error: 'Missing node run',
                }
              );
            }
            const projectRoot = await workflowProjectRootForTask(task);
            const prior = priorContextForNode(
              runs,
              nodes,
              projectMembers,
              node.id,
              workflow.edges,
              projectRoot,
            );
            const directPrior = priorContextForNode(
              runs,
              nodes,
              projectMembers,
              node.id,
              workflow.edges,
              projectRoot,
              'direct_predecessors',
            );
            const nodeRunAc = new AbortController();
            registerWorkflowNodeRunAbort(task.id, node.id, nodeRunAc);
            const runSignal = AbortSignal.any([ac.signal, batchAbort.signal, nodeRunAc.signal]);
            let updated: NodeRunRecord;
            try {
              updated = await executeWorkflowNode(
                gateway,
                scenario,
                task,
                node,
                { ...current },
                workflow,
                runSignal,
                async (run) => {
                  runs.set(node.id, run);
                  await reportProgress();
                },
                prior || undefined,
                runs,
                options,
                batchAbort,
                directPrior || undefined,
              );
            } finally {
              clearWorkflowNodeRunAbort(task.id, node.id);
              nodeRunAc.abort();
            }
            runs.set(node.id, updated);
            return updated;
          }),
        );
      } finally {
        // Only drop our parallel-rework stamp — never wipe gateway/user abort reasons.
        clearWorkflowParallelReworkBatchAbortReason(task.id);
      }

      await reportProgress();

      const autoRollbacks = applyWorkflowAutoRollbackForBatch({
        nodeIds: results.map((r) => r.nodeId),
        nodes,
        edges,
        runs,
      });
      if (autoRollbacks.length > 0) {
        await announceAppliedWorkflowAutoRollbacks(
          gateway,
          scenario,
          task,
          workflow,
          projectMembers,
          autoRollbacks,
        );
        idleRounds = 0;
        await reportProgress();
        continue;
      }

      const deadlockRollback = tryResolveWorkflowFailureDeadlock({ runs, nodes, edges });
      if (deadlockRollback) {
        await announceAppliedWorkflowAutoRollbacks(
          gateway,
          scenario,
          task,
          workflow,
          projectMembers,
          [deadlockRollback],
        );
        idleRounds = 0;
        await reportProgress();
        continue;
      }

      if (results.some((r) => r.status === 'failed') && workflow.mode === 'simple') {
        break;
      }

      if (
        results.some(
          (r) => r.status === 'pending' && (r.error?.includes('【输出补全】') ?? false),
        )
      ) {
        await new Promise((r) => setTimeout(r, 1_500));
      }

      const allDone = nodes.every((n) => {
        const r = runs.get(n.id);
        return r && (r.status === 'completed' || r.status === 'skipped');
      });
      if (allDone) {
        if (shouldWorkflowRunnerSleepForReview({ task, nodes, edges, runs })) {
          idleRounds = 0;
          await reportProgress();
          await new Promise((r) => setTimeout(r, WORKFLOW_STALL_POLL_MS));
          continue;
        }
        break;
      }
    }

    if (ac.signal.aborted) {
      return finalizeAbortedTaskRun(task, runs, nodes, onUpdate);
    }

    await awaitOutstandingHandoffWatchesForTask(task.id);

    task.status = resolveEffectiveTaskStatus(task, runs, nodes, { workflowStalled });
    await reportProgress();
    if (shouldAnnounceWorkflowTaskFinished(task)) {
      try {
        await announceTaskWorkflowFinished(gateway, scenario, task, nodes, runs);
      } catch (err) {
        console.warn('[office] task workflow finish room announcement failed:', err);
      }
    }
    if (shouldAnnounceWorkflowProjectClosure(task, runs, nodes)) {
      try {
        await announceTaskProjectClosure(gateway, scenario, task, runs, nodes);
      } catch (err) {
        console.warn('[office] project closure announcement failed:', err);
      }
    }
    await auditLog('task_workflow_done', { taskId: task.id, status: task.status });
    onUpdate?.(task);
    return task;
  } catch (err) {
    if (ac.signal.aborted) {
      return finalizeAbortedTaskRun(task, runs, nodes, onUpdate);
    }
    const now = Date.now();
    const message = err instanceof Error ? err.message : String(err);
    task.status = 'failed';
    for (const nr of runs.values()) {
      if (nr.status === 'running' || nr.status === 'pending') {
        nr.status = 'failed';
        nr.error = nr.error ?? message.slice(0, 500);
        nr.completedAt = now;
      }
    }
    await reportProgress();
    onUpdate?.(task);
    throw err;
  } finally {
    clearWorkflowTaskRun(task.id);
  }
}

export async function abortTaskRun(
  taskId: string,
  options?: {
    markUserAborted?: boolean;
    reason?: string;
    /** When set, persist abortQuiescing metadata (gateway stop still pending). */
    abortQuiesce?: {
      generation: number;
      startedAt: number;
    };
    /** Defer spawn-deny release until gateway abort quiesce clears. */
    skipSpawnRelease?: boolean;
  },
): Promise<OfficeTempProject | null> {
  if (options?.markUserAborted !== false) {
    markTaskUserAborted(taskId);
  }
  const reason = options?.reason?.trim() || '用户已手动中止本项目';
  setOfficeTaskAbortReason(taskId, reason);
  getWorkflowTaskRunController(taskId)?.abort();
  clearWorkflowTaskRun(taskId);

  const tasks = await listTempProjects();
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return null;

  if (task.executionMode === 'workflow') {
    if (ENABLE_LANGGRAPH && taskWorkflowEngine(task) === 'langgraph') {
      const { teardownLangGraphTaskResources } = await import('./workflow-langgraph-interrupt');
      await teardownLangGraphTaskResources(taskId);
    }
  }

  const now = Date.now();
  const needsStop =
    task.status === 'running' ||
    task.nodeRuns.some((nr) => nr.status === 'running' || nr.status === 'pending') ||
    Boolean(task.abortQuiescing);

  if (!needsStop && !options?.abortQuiesce) return task;

  task.status = 'aborted';
  task.nodeRuns = settleWorkflowNodeRunsAfterStop(task, reason, now);
  task.updatedAt = now;
  if (options?.abortQuiesce) {
    task.abortQuiescing = true;
    task.abortGeneration = options.abortQuiesce.generation;
    task.abortQuiesceStartedAt = options.abortQuiesce.startedAt;
  }
  const saved = await upsertTempProject(task);
  if (!options?.skipSpawnRelease) {
    const { releaseOfficeSpawnDenyForOrphanedProjectAbort } = await import(
      './office-spawn-policy-reconcile'
    );
    await releaseOfficeSpawnDenyForOrphanedProjectAbort(taskId);
  }
  return saved;
}

