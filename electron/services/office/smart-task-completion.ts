import type { GatewayManager } from '../../gateway/manager';
import {
  coordinatorReplyDeclaresProjectEnd,
  extractSmartCoordinatorRoomReplyBody,
} from '../../../src/lib/office-smart-project-end';
import {
  isSmartProjectEngineComplete,
} from '../../../src/lib/office-smart-coordinator-dispatch';
import { resolveSmartWorkOrderSteps, type SmartWorkOrderStep } from '../../../src/lib/office-smart-work-order';
import type { ProjectAgentRef } from '../../../src/lib/office-workflow-node';
import { roomMessageFromAgentId, roomMessageFromAgentMatches, roomMessageProjectId } from '../../../src/lib/office-agent-id-resolve';
import { membersForProject } from './office-member-resolve';
import type { OfficeFixedGroup, OfficeTempProject, RoomMessage } from './types';
import {
  getRoomMessages,
  getTempProject,
  listFixedGroups,
  markProjectRunCompleted,
} from './store';
import { resolveProjectCoordinatorAgentId } from './task-coordinator';
import { taskExecutionMode } from './task-execution-mode';
import {
  deliverablesBundleCoversClosure,
  deliverablesBundlePublishSucceeded,
  latestDeliverablesBundleMessage,
  publishProjectDeliverablesBundleMessage,
  type DeliverablesBundlePublishOutcome,
} from './project-deliverables-bundle';
import { isTaskUserAborted } from './task-run-abort-registry';
import { isAbortQuiescing } from './project-abort-quiesce';
import { officeWorkflowLog } from './office-workflow-log';

const smartFinalizeInflight = new Map<string, Promise<boolean>>();

const activeSmartRuns = new Map<string, AbortController>();
/** Projects started in Smart mode until completed, aborted, or failed. */
const smartRunningProjectIds = new Set<string>();

export function isSmartTaskMarkedRunning(projectId: string): boolean {
  return smartRunningProjectIds.has(projectId);
}

export function isAnySmartTaskMarkedRunning(): boolean {
  return smartRunningProjectIds.size > 0;
}

export function registerSmartTaskRun(projectId: string, controller: AbortController): void {
  smartRunningProjectIds.add(projectId);
  activeSmartRuns.set(projectId, controller);
}

export function clearSmartTaskRun(projectId: string, controller?: AbortController): void {
  if (!controller || activeSmartRuns.get(projectId) === controller) {
    activeSmartRuns.delete(projectId);
  }
}

export function endSmartTaskRun(
  projectId: string,
  options?: { abortInflight?: boolean; skipSpawnRelease?: boolean },
): void {
  smartRunningProjectIds.delete(projectId);
  if (options?.abortInflight !== false) {
    activeSmartRuns.get(projectId)?.abort();
  }
  activeSmartRuns.delete(projectId);
  void import('./smart-task-progress-driver')
    .then(({ stopSmartTaskProgressDriver }) => stopSmartTaskProgressDriver(projectId))
    .catch(() => undefined);
  void import('./office-sync-runtime')
    .then(async ({ notifyOfficeProjectRunStopped, isOfficeProjectRunLifecycleActive }) => {
      notifyOfficeProjectRunStopped(projectId);
      if (options?.skipSpawnRelease) return;
      const { isAbortQuiescing } = await import('./project-abort-quiesce');
      if (isAbortQuiescing(projectId)) return;
      if (!isOfficeProjectRunLifecycleActive(projectId)) {
        const { releaseOfficeSpawnDenyAfterRun } = await import('./office-spawn-policy-reconcile');
        await releaseOfficeSpawnDenyAfterRun(projectId);
      }
    })
    .catch(() => undefined);
}

export function abortSmartTaskController(projectId: string): boolean {
  const had = smartRunningProjectIds.delete(projectId);
  const ac = activeSmartRuns.get(projectId);
  if (ac) {
    ac.abort();
    activeSmartRuns.delete(projectId);
    return true;
  }
  return had;
}

/** @deprecated Smart 结项广播已由协调者【群聊回复】发布，不再追加 @all。 */
export async function ensureSmartProjectEndAllBroadcast(
  _gateway: GatewayManager,
  _params: {
    groupId?: string;
    projectId: string;
    coordinatorReply: string;
    coordinatorAgentId: string;
  },
): Promise<void> {
  // 【群聊回复】结项正文已在 mention 发布链路发出；结项禁止 @。
}

/** Prefer published room body, then JSON roomReply, then bracket sections. */
export function smartCoordinatorClosureSourceText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { roomReply?: unknown };
      if (typeof parsed.roomReply === 'string' && parsed.roomReply.trim()) {
        return parsed.roomReply.trim();
      }
    } catch {
      // not JSON
    }
  }
  return extractSmartCoordinatorRoomReplyBody(trimmed) || trimmed;
}

export type SmartTaskClosureGateParams = {
  projectId: string;
  groupId?: string;
  coordinatorAgentId?: string;
  steps?: SmartWorkOrderStep[];
  /** 结项冲突强制结项：窄豁免引擎 work-order 闸门（与校验层 forceCoordinatorProjectEnd 对齐）。 */
  forceCoordinatorProjectEnd?: boolean;
};

function groupContextForProject(
  project: OfficeTempProject,
  groups: OfficeFixedGroup[],
): OfficeFixedGroup {
  if (project.parentGroupId) {
    const group = groups.find((g) => g.id === project.parentGroupId);
    if (group) return group;
  }
  return {
    id: project.parentGroupId ?? project.id,
    name: project.title,
    agentIds: [...project.agentIds],
    coordinatorAgentId: project.coordinatorAgentId,
    workflow: project.workflow ?? { mode: 'dag', nodes: [], edges: [] },
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

async function loadProjectMembers(project: OfficeTempProject) {
  const members = await membersForProject(project);
  return members.map((m) => ({ agentId: m.agentId, displayName: m.displayName }));
}

/**
 * 与发布校验一致的 Smart 结项闸门（可注入 steps；room 始终从 store 重拉）。
 * 成员步骤均已在群内 **…已完成**，且下一跳仅剩协调者或已全部完成。
 */
export function evaluateSmartTaskClosureGate(params: {
  steps: SmartWorkOrderStep[];
  roomMessages: RoomMessage[];
  projectId: string;
  coordinatorAgentId: string;
  teamRoles?: Pick<ProjectAgentRef, 'agentId' | 'displayName'>[];
}): boolean {
  return isSmartProjectEngineComplete({
    steps: params.steps,
    roomMessages: params.roomMessages,
    projectId: params.projectId,
    coordinatorAgentId: params.coordinatorAgentId,
    teamRoles: params.teamRoles,
  });
}

export async function isSmartTaskClosureGateOpen(
  params: SmartTaskClosureGateParams,
): Promise<boolean> {
  if (params.forceCoordinatorProjectEnd) {
    officeWorkflowLog('info', '[office][smart-settle] closure gate bypassed — coordinator insisted project end', {
      projectId: params.projectId,
      coordinatorAgentId: params.coordinatorAgentId,
    });
    return true;
  }

  const project = await getTempProject(params.projectId);
  if (!project || taskExecutionMode(project) !== 'smart') return false;

  const groups = await listFixedGroups();
  const group = groupContextForProject(project, groups);
  const coordinatorAgentId =
    params.coordinatorAgentId?.trim()
    || resolveProjectCoordinatorAgentId(project, group);
  if (!coordinatorAgentId) return false;

  const members = await loadProjectMembers(project);
  const steps =
    params.steps
    ?? resolveSmartWorkOrderSteps(group, project.description, members);
  const roomMessages = await getRoomMessages(params.projectId);

  return evaluateSmartTaskClosureGate({
    steps,
    roomMessages,
    projectId: params.projectId,
    coordinatorAgentId,
    teamRoles: members,
  });
}

function smartProjectMayTransitionToCompleted(
  status: OfficeTempProject['status'],
  project?: Pick<OfficeTempProject, 'id' | 'abortQuiescing'>,
): boolean {
  if (project) {
    if (isTaskUserAborted(project.id) || isAbortQuiescing(project.id) || project.abortQuiescing) {
      return false;
    }
  }
  return status === 'running' || status === 'pending' || status === 'failed';
}

async function markSmartProjectCompleted(projectId: string): Promise<void> {
  await markProjectRunCompleted(projectId);
  endSmartTaskRun(projectId, { abortInflight: false });
}

/**
 * 结项 zip 已发布但 store 仍为 running（历史死锁或 finalize 中断）时自愈标 completed。
 */
export async function healSmartProjectRunningWithPublishedBundle(
  projectId: string,
): Promise<boolean> {
  const project = await getTempProject(projectId);
  if (!project || taskExecutionMode(project) !== 'smart' || project.status !== 'running') {
    return false;
  }

  const groups = await listFixedGroups();
  const group = groupContextForProject(project, groups);
  const coordinatorAgentId = resolveProjectCoordinatorAgentId(project, group);
  if (!coordinatorAgentId) return false;

  const roomMessages = await getRoomMessages(projectId);
  const closure = findCoordinatorProjectClosureMessageInRoom(
    roomMessages,
    projectId,
    coordinatorAgentId,
    resolveSmartClosureMinMessageTimestamp(project),
  );
  if (!closure) return false;

  const bundle = await latestDeliverablesBundleMessage(projectId);
  if (!bundle || !deliverablesBundleCoversClosure(bundle, closure)) {
    return false;
  }

  await markSmartProjectCompleted(projectId);
  officeWorkflowLog('info', '[office][smart-settle] healed running project after published bundle', {
    projectId,
    closureMessageId: closure.id,
    bundleMessageId: bundle.id,
  });
  return true;
}

function isSmartCoordinatorClosureAnchorV2(
  message: Pick<RoomMessage, 'fromAgentId' | 'fromRoleId' | 'from' | 'smartCoordinatorEnd' | 'content' | 'progressText'>,
  coordinatorAgentId: string,
  teamMembers?: import('../../../src/lib/office-agent-id-resolve').LegacyTeamMember[],
): boolean {
  if (!coordinatorAgentId || !roomMessageFromAgentMatches(message as RoomMessage, coordinatorAgentId, teamMembers)) {
    return false;
  }
  if (message.smartCoordinatorEnd === true) return true;
  const body = `${message.content ?? ''}\n${message.progressText ?? ''}`.trim();
  return /【结项】/u.test(body);
}

async function ensureProjectDeliverablesBundleAfterClosure(
  params: {
    project: OfficeTempProject;
    groupId?: string;
    afterMessageId: string;
    coordinatorAgentId: string;
    closure?: RoomMessage | null;
  },
): Promise<DeliverablesBundlePublishOutcome> {
  const roomMessages = await getRoomMessages(params.project.id);
  const closure =
    params.closure
    ?? roomMessages.find((m) => m.id === params.afterMessageId)
    ?? null;
  if (!closure || !isSmartCoordinatorClosureAnchorV2(closure, params.coordinatorAgentId)) {
    return { status: 'closure_missing' };
  }
  return publishProjectDeliverablesBundleMessage(null, {
    groupId: params.groupId,
    project: params.project,
    afterMessageId: closure.id,
    coordinatorAgentId: params.coordinatorAgentId,
    closure,
  });
}

async function tryRecoverDeliverablesBundleForCompletedProject(params: {
  gateway?: GatewayManager | null;
  groupId?: string;
  project: OfficeTempProject;
  coordinatorAgentId: string;
  closureMessageId?: string;
  steps?: SmartWorkOrderStep[];
}): Promise<boolean> {
  if (params.project.status !== 'completed') return false;

  const roomMessages = await getRoomMessages(params.project.id);
  let closure: RoomMessage | null = null;
  const explicitId = params.closureMessageId?.trim();
  if (explicitId) {
    closure = roomMessages.find((m) => m.id === explicitId) ?? null;
  }
  if (!closure) {
    closure = findCoordinatorProjectClosureMessageInRoom(
      roomMessages,
      params.project.id,
      params.coordinatorAgentId,
      resolveSmartClosureMinMessageTimestamp(params.project),
    );
  }
  if (!closure || !isSmartCoordinatorClosureAnchorV2(closure, params.coordinatorAgentId)) {
    return false;
  }

  const existingBundle = await latestDeliverablesBundleMessage(params.project.id);
  if (existingBundle && deliverablesBundleCoversClosure(existingBundle, closure)) {
    endSmartTaskRun(params.project.id, { abortInflight: false });
    return true;
  }

  const outcome = await ensureProjectDeliverablesBundleAfterClosure({
    project: params.project,
    groupId: params.groupId,
    afterMessageId: closure.id,
    coordinatorAgentId: params.coordinatorAgentId,
    closure,
  });
  return deliverablesBundlePublishSucceeded(outcome);
}

/**
 * Smart 结项：先发布系统交付物 zip/说明消息，再将项目标为 completed。
 */
export async function finalizeSmartTaskClosure(params: {
  projectId: string;
  coordinatorReply: string;
  groupId?: string;
  gateway?: GatewayManager | null;
  coordinatorAgentId: string;
  steps?: SmartWorkOrderStep[];
  declaredProjectEnd?: boolean;
  closureMessageId?: string;
  forceCoordinatorProjectEnd?: boolean;
}): Promise<boolean> {
  const inflightKey = params.projectId.trim();
  const existing = smartFinalizeInflight.get(inflightKey);
  if (existing) return existing;
  const work = finalizeSmartTaskClosureInner(params).finally(() => {
    smartFinalizeInflight.delete(inflightKey);
  });
  smartFinalizeInflight.set(inflightKey, work);
  return work;
}

async function finalizeSmartTaskClosureInner(params: {
  projectId: string;
  coordinatorReply: string;
  groupId?: string;
  gateway?: GatewayManager | null;
  coordinatorAgentId: string;
  steps?: SmartWorkOrderStep[];
  declaredProjectEnd?: boolean;
  closureMessageId?: string;
  forceCoordinatorProjectEnd?: boolean;
}): Promise<boolean> {
  if (
    params.declaredProjectEnd !== true
    && !coordinatorReplyDeclaresProjectEnd(params.coordinatorReply)
  ) {
    officeWorkflowLog('debug', '[office][smart-settle] skip: reply does not declare project end', {
      projectId: params.projectId,
    });
    return false;
  }

  const project = await getTempProject(params.projectId);
  if (!project || taskExecutionMode(project) !== 'smart') {
    officeWorkflowLog('debug', '[office][smart-settle] skip: project missing or not smart', {
      projectId: params.projectId,
      found: Boolean(project),
      mode: project ? taskExecutionMode(project) : undefined,
    });
    return false;
  }

  if (project.status === 'completed') {
    return tryRecoverDeliverablesBundleForCompletedProject({
      gateway: params.gateway,
      groupId: params.groupId,
      project,
      coordinatorAgentId: params.coordinatorAgentId,
      closureMessageId: params.closureMessageId,
      steps: params.steps,
    });
  }

  if (!smartProjectMayTransitionToCompleted(project.status, project)) {
    officeWorkflowLog('warn', '[office][smart-settle] blocked: status not transitionable to completed', {
      projectId: params.projectId,
      status: project.status,
      abortQuiescing: project.abortQuiescing === true,
      userAborted: isTaskUserAborted(project.id),
    });
    return false;
  }

  const gateOpen = await isSmartTaskClosureGateOpen({
    projectId: params.projectId,
    groupId: params.groupId,
    coordinatorAgentId: params.coordinatorAgentId,
    steps: params.steps,
    forceCoordinatorProjectEnd: params.forceCoordinatorProjectEnd,
  });
  if (!gateOpen) {
    // Coordinator declared end but not all member steps show **…已完成** in room — the classic
    // "member finished but project stuck" blind spot. Log so it is traceable in clawx-*.log.
    officeWorkflowLog('warn', '[office][smart-settle] closure gate CLOSED despite declared end', {
      projectId: params.projectId,
      coordinatorAgentId: params.coordinatorAgentId,
      status: project.status,
    });
    return false;
  }

  let afterMessageId = params.closureMessageId?.trim();
  if (!afterMessageId) {
    const roomMessages = await getRoomMessages(params.projectId);
    const closure = findCoordinatorProjectClosureMessageInRoom(
      roomMessages,
      params.projectId,
      params.coordinatorAgentId,
      resolveSmartClosureMinMessageTimestamp(project),
    );
    afterMessageId = closure?.id;
  }
  if (!afterMessageId) {
    officeWorkflowLog('warn', '[office][smart-settle] gate open but no closure message anchor found', {
      projectId: params.projectId,
      coordinatorAgentId: params.coordinatorAgentId,
    });
    return false;
  }

  const roomMessages = await getRoomMessages(params.projectId);
  const closureMsg = roomMessages.find((m) => m.id === afterMessageId) ?? null;
  if (!closureMsg || !isSmartCoordinatorClosureAnchorV2(closureMsg, params.coordinatorAgentId)) {
    officeWorkflowLog('warn', '[office][smart-settle] closure anchor lookup failed', {
      projectId: params.projectId,
      afterMessageId,
      found: Boolean(closureMsg),
    });
    return false;
  }

  const outcome = await ensureProjectDeliverablesBundleAfterClosure({
    project,
    groupId: params.groupId,
    afterMessageId,
    coordinatorAgentId: params.coordinatorAgentId,
    closure: closureMsg,
  });
  if (!deliverablesBundlePublishSucceeded(outcome)) {
    officeWorkflowLog('warn', '[office][smart-settle] deliverables bundle publish failed — completion held', {
      projectId: params.projectId,
      outcome: outcome.status,
    });
    return false;
  }

  await markSmartProjectCompleted(params.projectId);
  officeWorkflowLog('info', '[office][smart-settle] project marked completed', {
    projectId: params.projectId,
    bundle: outcome.status,
  });
  return true;
}

export async function maybeCompleteSmartTaskFromCoordinatorReply(
  projectId: string,
  coordinatorReply: string,
  opts?: {
    groupId?: string;
    gateway?: GatewayManager;
    coordinatorAgentId?: string;
    steps?: SmartWorkOrderStep[];
    declaredProjectEnd?: boolean;
    /** 协调者结项群聊消息 id，交付物 zip 系统消息排在其后。 */
    closureMessageId?: string;
    /** 结项冲突强制结项：与 LLM 校验层窄豁免对齐。 */
    forceCoordinatorProjectEnd?: boolean;
  },
): Promise<boolean> {
  const project = await getTempProject(projectId);
  if (!project) return false;

  const groups = await listFixedGroups();
  const group = groupContextForProject(project, groups);
  const coordinatorAgentId =
    opts?.coordinatorAgentId?.trim()
    || resolveProjectCoordinatorAgentId(project, group);
  if (!coordinatorAgentId) return false;

  return finalizeSmartTaskClosure({
    projectId,
    coordinatorReply,
    groupId: opts?.groupId?.trim() || project.parentGroupId,
    gateway: opts?.gateway,
    coordinatorAgentId,
    steps: opts?.steps,
    declaredProjectEnd: opts?.declaredProjectEnd,
    closureMessageId: opts?.closureMessageId,
    forceCoordinatorProjectEnd: opts?.forceCoordinatorProjectEnd,
  });
}

/** Smart 结项扫描下限：用户介入复活后忽略更早的 **项目结项**。 */
export function resolveSmartClosureMinMessageTimestamp(
  project: Pick<OfficeTempProject, 'smartRevivedAt'> | null | undefined,
  fallback?: number,
): number | undefined {
  const revived = project?.smartRevivedAt;
  if (typeof revived === 'number' && revived > 0) return revived;
  if (typeof fallback === 'number' && fallback > 0) return fallback;
  return undefined;
}

/** 群聊中协调者结项消息（smartCoordinatorEnd 或 JSON action=end）。 */
export function findCoordinatorProjectClosureMessageInRoom(
  roomMessages: RoomMessage[],
  projectId: string,
  coordinatorAgentId: string,
  minMessageTimestamp?: number,
): RoomMessage | null {
  const minTs = minMessageTimestamp ?? 0;
  const sorted = roomMessages
    .filter(
      (m) =>
        roomMessageProjectId(m) === projectId
        && roomMessageFromAgentId(m) === coordinatorAgentId
        && m.timestamp >= minTs,
    )
    .sort((a, b) => b.timestamp - a.timestamp);
  for (const m of sorted) {
    if (m.smartCoordinatorEnd) return m;
    const content = (m.content ?? '').trim();
    if (content && coordinatorReplyDeclaresProjectEnd(content)) return m;
    const body = `${content}\n${m.progressText ?? ''}`.trim();
    if (/【结项】/u.test(body)) return m;
  }
  return null;
}

/** @deprecated 使用 {@link findCoordinatorProjectClosureMessageInRoom} */
export function findCoordinatorProjectClosureInRoom(
  roomMessages: RoomMessage[],
  projectId: string,
  coordinatorAgentId: string,
  minMessageTimestamp?: number,
): string | null {
  const msg = findCoordinatorProjectClosureMessageInRoom(
    roomMessages,
    projectId,
    coordinatorAgentId,
    minMessageTimestamp,
  );
  if (!msg) return null;
  return (msg.content ?? '').trim() || (msg.progressText ?? '').trim() || 'end';
}

/** 群聊新消息写入后：若协调者已结项，先发布 zip 系统消息再标 completed。 */
export async function tryCompleteSmartProjectAfterRoomMessage(msg: RoomMessage): Promise<boolean> {
  const projectId = msg.projectId?.trim();
  if (!projectId) return false;
  if (msg.phase === 'deliverable_bundle') {
    return false;
  }
  if (
    msg.phase === 'task_deliver'
    && (msg.content ?? '').includes('📎 交付物完整路径')
  ) {
    return false;
  }
  const project = await getTempProject(projectId);
  if (!project || taskExecutionMode(project) !== 'smart') return false;
  if (isTaskUserAborted(projectId) || isAbortQuiescing(projectId) || project.abortQuiescing) {
    return false;
  }

  if (await healSmartProjectRunningWithPublishedBundle(projectId)) {
    return true;
  }

  const groups = await listFixedGroups();
  const group = groupContextForProject(project, groups);
  const coordinatorAgentId = resolveProjectCoordinatorAgentId(project, group);
  if (!coordinatorAgentId) return false;

  if (project.status === 'completed') {
    const triggerIsClosure =
      msg.smartCoordinatorEnd === true
      || isSmartCoordinatorClosureAnchorV2(msg, coordinatorAgentId);
    if (!triggerIsClosure) {
      const roomMessages = await getRoomMessages(projectId);
      const closure = findCoordinatorProjectClosureMessageInRoom(
        roomMessages,
        projectId,
        coordinatorAgentId,
        resolveSmartClosureMinMessageTimestamp(project),
      );
      if (!closure) return false;
      const bundle = await latestDeliverablesBundleMessage(projectId);
      if (bundle && deliverablesBundleCoversClosure(bundle, closure)) return false;
    }
  }

  const roomMessages = await getRoomMessages(projectId);
  return attemptSmartTaskAutoCompletionFromRoom({
    projectId,
    groupId: msg.groupId ?? project.parentGroupId,
    coordinatorAgentId,
    roomMessages,
    minClosureMessageTimestamp: resolveSmartClosureMinMessageTimestamp(project),
    closureMessageId: msg.smartCoordinatorEnd === true ? msg.id : undefined,
  });
}

/** @deprecated alias */
export const tryCompleteSmartTaskAfterRoomMessage = tryCompleteSmartProjectAfterRoomMessage;

/** 扫描协调者群聊结项消息：先发布交付物 zip，再将项目标为 completed。 */
export async function attemptSmartTaskAutoCompletionFromRoom(params: {
  projectId: string;
  groupId?: string;
  coordinatorAgentId: string;
  gateway?: GatewayManager;
  steps?: SmartWorkOrderStep[];
  roomMessages: RoomMessage[];
  minClosureMessageTimestamp?: number;
  closureMessageId?: string;
}): Promise<boolean> {
  if (isTaskUserAborted(params.projectId) || isAbortQuiescing(params.projectId)) {
    return false;
  }
  const project = await getTempProject(params.projectId);
  if (project?.abortQuiescing) return false;
  const minTs =
    params.minClosureMessageTimestamp
    ?? resolveSmartClosureMinMessageTimestamp(project ?? undefined);
  const closureMsg = findCoordinatorProjectClosureMessageInRoom(
    params.roomMessages,
    params.projectId,
    params.coordinatorAgentId,
    minTs,
  );
  if (!closureMsg) return false;
  const body =
    (closureMsg.content ?? '').trim()
    || (closureMsg.progressText ?? '').trim()
    || 'end';

  const closureMessageId = params.closureMessageId ?? closureMsg.id;
  return finalizeSmartTaskClosure({
    projectId: params.projectId,
    coordinatorReply: body,
    groupId: params.groupId,
    gateway: params.gateway ?? null,
    coordinatorAgentId: params.coordinatorAgentId,
    steps: params.steps,
    declaredProjectEnd: true,
    closureMessageId,
  });
}
