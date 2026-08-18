import type { GatewayManager } from '../../gateway/manager';
import type { OfficeExecutionMember, OfficeFixedGroup, OfficeTempProject } from './types';
import {
  clearProjectRunArtifacts,
  getTempProject,
  resetProjectRunState,
  upsertTempProject,
} from './store';
import { resolveRoomCoordinatorMember, loadProjectExecutionMembers } from './office-execution-members';
import { clearTaskUserAborted, isTaskUserAborted, markTaskUserAborted, claimTaskAbortClear } from './task-run-abort-registry';
import { isAbortQuiescing, ProjectAbortQuiescingError } from './project-abort-quiesce';
import { shouldBlockOfficeLlmSend } from './office-llm-send-guard';
import { taskExecutionMode } from './task-execution-mode';
import {
  abortSmartTaskController,
  attemptSmartTaskAutoCompletionFromRoom,
  endSmartTaskRun,
  findCoordinatorProjectClosureMessageInRoom,
  isSmartTaskMarkedRunning,
  registerSmartTaskRun,
  resolveSmartClosureMinMessageTimestamp,
} from './smart-task-completion';
import { smartCoordinatorReplyDispatchesMembers } from './role-assignment-lookup';
import { startSmartTaskProgressDriver } from './smart-task-progress-driver';
import { pickRolesDelegatedByCoordinator } from './room-coordinator-delegates';
import { asTeamMemberArray } from '../../../src/lib/office-agent-id-resolve';
import { SMART_KICKOFF_MAX_FAIL_COUNT } from '../../../src/lib/office-smart-mention-stall';
import type { RunTaskWorkflowOptions } from './workflow-runner';

export async function runSmartTask(
  gateway: GatewayManager,
  group: OfficeFixedGroup,
  project: OfficeTempProject,
  options?: RunTaskWorkflowOptions,
): Promise<void> {
  const { clearSmartMentionDispatchInflightForTask } = await import('./room-mention-dispatch');
  clearSmartMentionDispatchInflightForTask(project.id);
  abortSmartTaskController(project.id);
  const ac = new AbortController();
  registerSmartTaskRun(project.id, ac);
  if (options?.abortClearPermit !== undefined) {
    clearTaskUserAborted(project.id, { onlyIfAbortSeq: options.abortClearPermit });
  } else {
    claimTaskAbortClear(project.id);
  }
  if (shouldBlockOfficeLlmSend(project.id)) {
    throw new ProjectAbortQuiescingError(project.id);
  }

  const team = await loadProjectExecutionMembers(project);
  if (shouldBlockOfficeLlmSend(project.id)) {
    throw new ProjectAbortQuiescingError(project.id);
  }
  const coord = resolveRoomCoordinatorMember(group, team, project);
  if (!coord) {
    endSmartTaskRun(project.id);
    throw new Error('No coordinator agent for smart project');
  }

  const { dispatchSmartCoordinatorKickoffDecomposition } = await import('./orchestrator');
  const mode = options?.mode ?? 'fresh';
  if (mode === 'fresh') {
    if (shouldBlockOfficeLlmSend(project.id)) {
      throw new ProjectAbortQuiescingError(project.id);
    }
    if (options?.clearProjectRoom) {
      await clearProjectRunArtifacts(project.id);
    } else {
      await resetProjectRunState(project.id);
    }
  }

  const running: OfficeTempProject = {
    ...project,
    status: 'running',
    nodeRuns: [],
    workflowRunId: undefined,
    smartRevivedAt: mode === 'fresh' ? undefined : project.smartRevivedAt,
    updatedAt: Date.now(),
  };
  if (shouldBlockOfficeLlmSend(project.id)) {
    throw new ProjectAbortQuiescingError(project.id);
  }
  await upsertTempProject(running);

  try {
    const kickoffMsg = await dispatchSmartCoordinatorKickoffDecomposition(gateway, {
      groupId: group.id,
      group,
      projectId: project.id,
      coordinator: {
        agentId: coord.agentId,
        displayName: coord.displayName,
        id: coord.agentId,
        name: coord.displayName,
      },
      project: running,
    });

    const afterKickoff = await getTempProject(project.id);
    if (afterKickoff) {
      await upsertTempProject({
        ...afterKickoff,
        kickoffError: undefined,
        kickoffFailCount: 0,
      });
    }

    startSmartTaskProgressDriver(gateway, group, running, coord, {
      kickoffTimestamp: kickoffMsg.timestamp,
    });

    if (ac.signal.aborted || isTaskUserAborted(project.id)) {
      endSmartTaskRun(project.id);
      return;
    }
  } catch (err) {
    endSmartTaskRun(project.id);
    const detail = err instanceof Error ? err.message : String(err);
    console.warn('[office] smart task kickoff failed:', project.id, detail);
    if (!isTaskUserAborted(project.id)) {
      const cur = await getTempProject(project.id);
      if (cur) {
        const failCount = (cur.kickoffFailCount ?? 0) + 1;
        const status = failCount >= SMART_KICKOFF_MAX_FAIL_COUNT ? 'failed' : 'running';
        const updated = await upsertTempProject({
          ...cur,
          status: cur.status === 'running' ? status : cur.status,
          kickoffFailCount: failCount,
          kickoffError: detail.slice(0, 500),
          updatedAt: Date.now(),
        });
        if (failCount < SMART_KICKOFF_MAX_FAIL_COUNT && updated.status === 'running') {
          startSmartTaskProgressDriver(gateway, group, updated, coord, {
            kickoffTimestamp: updated.updatedAt,
          });
        }
      }
      try {
        const { appendRoomMessage } = await import('./store');
        await appendRoomMessage({
          id: `room-${Date.now()}-smart-kickoff-err`,
          groupId: group.id,
          projectId: project.id,
          from: 'system',
          content: `智能任务启动失败：${detail.slice(0, 400)}`,
          mentions: [],
          timestamp: Date.now(),
        });
      } catch {
        // project room storage unavailable
      }
    }
    throw err;
  }
}

export async function abortSmartTaskRun(
  projectId: string,
  options?: {
    markUserAborted?: boolean;
    reason?: string;
    abortQuiesce?: {
      generation: number;
      startedAt: number;
    };
    /** When true (user abort), never auto-complete from an existing closure post. */
    skipAutoComplete?: boolean;
  },
): Promise<OfficeTempProject | null> {
  const { clearSmartMentionDispatchInflightForTask } = await import('./room-mention-dispatch');
  clearSmartMentionDispatchInflightForTask(projectId);
  const { stopSmartTaskProgressDriver } = await import('./smart-task-progress-driver');
  stopSmartTaskProgressDriver(projectId);
  abortSmartTaskController(projectId);
  if (options?.markUserAborted !== false) {
    markTaskUserAborted(projectId);
  }

  let skipEndRun = false;
  try {
    const project = await getTempProject(projectId);
    if (!project) return null;

    const skipAutoComplete =
      options?.skipAutoComplete === true || options?.markUserAborted !== false;

    if (
      !skipAutoComplete
      && taskExecutionMode(project) === 'smart'
      && (project.status === 'running' || project.status === 'aborted' || project.status === 'failed')
    ) {
      const { getRoomMessages, listFixedGroups } = await import('./store');
      const groups = await listFixedGroups();
      const parentGroup = project.parentGroupId
        ? groups.find((g) => g.id === project.parentGroupId)
        : undefined;
      const coordinatorAgentId = project.coordinatorAgentId?.trim()
        || parentGroup?.coordinatorAgentId?.trim()
        || '';
      if (coordinatorAgentId) {
        const roomMessages = await getRoomMessages(projectId);
        if (
          findCoordinatorProjectClosureMessageInRoom(
            roomMessages,
            projectId,
            coordinatorAgentId,
            resolveSmartClosureMinMessageTimestamp(project),
          )
        ) {
          const completed = await attemptSmartTaskAutoCompletionFromRoom({
            projectId,
            groupId: parentGroup?.id,
            coordinatorAgentId,
            roomMessages,
            minClosureMessageTimestamp: resolveSmartClosureMinMessageTimestamp(project),
          });
          if (completed) {
            skipEndRun = true;
            clearTaskUserAborted(projectId);
            return (await getTempProject(projectId)) ?? project;
          }
        }
      }
    }

    const latest = (await getTempProject(projectId)) ?? project;
    const now = Date.now();
    const reason = options?.reason?.trim() || 'Aborted';
    const needsStop =
      latest.status === 'running'
      || latest.nodeRuns.some((nr) => nr.status === 'running' || nr.status === 'pending')
      || Boolean(options?.abortQuiesce);

    if (!needsStop) return latest;

    return upsertTempProject({
      ...latest,
      status: 'aborted',
      nodeRuns: latest.nodeRuns.map((nr) =>
        nr.status === 'running' || nr.status === 'pending'
          ? { ...nr, status: 'failed', error: nr.error ?? reason }
          : nr,
      ),
      workflowRunId: undefined,
      abortQuiescing: options?.abortQuiesce ? true : latest.abortQuiescing,
      abortGeneration: options?.abortQuiesce?.generation ?? latest.abortGeneration,
      abortQuiesceStartedAt: options?.abortQuiesce?.startedAt ?? latest.abortQuiesceStartedAt,
      updatedAt: now,
    });
  } finally {
    if (!skipEndRun) {
      endSmartTaskRun(projectId, {
        abortInflight: false,
        // Defer spawn-deny release until gateway abort quiesce clears.
        skipSpawnRelease: Boolean(options?.abortQuiesce),
      });
    }
  }
}

/** 协调者派活后是否应将 Smart 项目标为 running。 */
export function shouldMarkSmartTaskRunningAfterCoordinatorDispatch(
  status: OfficeTempProject['status'],
  userInitiated: boolean,
): boolean {
  if (status === 'running') return false;
  if (userInitiated) {
    return (
      status === 'pending'
      || status === 'blocked'
      || status === 'completed'
      || status === 'failed'
      || status === 'aborted'
    );
  }
  return status === 'pending' || status === 'blocked';
}

/**
 * Smart：协调者在群聊 @ 成员派活后，将项目标为 running 并注册推进器。
 */
export async function ensureSmartTaskRunningAfterCoordinatorDispatch(
  gateway: GatewayManager,
  params: {
    groupId?: string;
    group?: Pick<OfficeFixedGroup, 'id' | 'workflow' | 'agentIds'>;
    project?: OfficeTempProject;
    coordinator: Pick<OfficeExecutionMember, 'agentId' | 'displayName'> & {
      name?: string;
    };
    coordinatorReplyText: string;
    teamMembers?: OfficeExecutionMember[];
    kickoffTimestamp?: number;
    userInitiated?: boolean;
    /** @deprecated */
    scenarioId?: string;
    scenario?: Pick<OfficeFixedGroup, 'id' | 'workflow' | 'agentIds'> & { roleIds?: string[] };
    task?: OfficeTempProject;
    teamRoles?: Array<Pick<OfficeExecutionMember, 'agentId' | 'displayName'> & { name?: string }>;
  },
): Promise<boolean> {
  const project = params.project ?? params.task;
  const legacyScenario = params.scenario as
    | (Pick<OfficeFixedGroup, 'id' | 'workflow' | 'agentIds'> & { roleIds?: string[] })
    | undefined;
  const group =
    params.group
    ?? (legacyScenario
      ? {
          id: legacyScenario.id ?? params.groupId ?? params.scenarioId ?? '',
          workflow: legacyScenario.workflow,
          agentIds: legacyScenario.agentIds ?? legacyScenario.roleIds ?? [],
        }
      : undefined);
  const teamMembers = asTeamMemberArray(params.teamMembers ?? params.teamRoles);
  const coordinatorAgentId = params.coordinator.agentId.trim();
  const coordinatorDisplayName =
    (params.coordinator.displayName ?? params.coordinator.name ?? coordinatorAgentId).trim()
    || coordinatorAgentId;

  if (!project || !group) {
    return false;
  }

  const userInitiated = params.userInitiated === true;
  const replyText = params.coordinatorReplyText;
  const teamRefs = teamMembers.map((m) => ({
    agentId: m.agentId,
    displayName: (m.displayName ?? m.name ?? m.agentId).trim() || m.agentId,
  }));
  const dispatches = smartCoordinatorReplyDispatchesMembers(
    replyText,
    coordinatorAgentId,
    teamRefs,
    { userInitiated },
  );
  const delegated = dispatches
    ? pickRolesDelegatedByCoordinator(
        replyText,
        teamRefs,
        coordinatorAgentId,
        coordinatorAgentId,
        { executionMode: 'smart' },
      ).map((r) => r.displayName)
    : [];

  if (!dispatches) {
    return false;
  }

  const latestProject = (await getTempProject(project.id)) ?? project;
  if (taskExecutionMode(latestProject) !== 'smart') {
    return false;
  }
  // Hard gate: never revive while Gateway abort quiesce is in progress (any path).
  if (latestProject.abortQuiescing || isAbortQuiescing(latestProject.id)) {
    return false;
  }
  if (!userInitiated && isTaskUserAborted(latestProject.id)) {
    return false;
  }
  if (!userInitiated && (latestProject.status === 'failed' || latestProject.status === 'aborted')) {
    return false;
  }
  if (latestProject.status === 'completed' && !userInitiated) {
    return false;
  }

  const revivalAt = params.kickoffTimestamp ?? Date.now();
  const needsStatusUpdate = shouldMarkSmartTaskRunningAfterCoordinatorDispatch(
    latestProject.status,
    userInitiated,
  );
  const needsRunRegistry = !isSmartTaskMarkedRunning(latestProject.id);
  const needsRevivalMarker = userInitiated && latestProject.smartRevivedAt !== revivalAt;
  if (!needsStatusUpdate && !needsRunRegistry && !needsRevivalMarker) {
    return false;
  }

  const runningProject: OfficeTempProject = {
    ...latestProject,
    status: needsStatusUpdate ? 'running' : latestProject.status,
    smartRevivedAt: userInitiated ? revivalAt : latestProject.smartRevivedAt,
    updatedAt: Date.now(),
  };

  if (needsStatusUpdate || needsRevivalMarker) {
    await upsertTempProject(runningProject);
  }

  if (needsRunRegistry) {
    const ac = new AbortController();
    registerSmartTaskRun(latestProject.id, ac);
    const { issueTaskAbortClearPermit } = await import('./task-run-abort-registry');
    const permit = issueTaskAbortClearPermit(latestProject.id);
    clearTaskUserAborted(latestProject.id, { onlyIfAbortSeq: permit });
    if (isAbortQuiescing(latestProject.id) || isTaskUserAborted(latestProject.id)) {
      return false;
    }
    startSmartTaskProgressDriver(
      gateway,
      group as OfficeFixedGroup,
      runningProject,
      { agentId: coordinatorAgentId, displayName: coordinatorDisplayName },
      { kickoffTimestamp: params.kickoffTimestamp ?? Date.now() },
    );
  }

  void delegated;
  return true;
}
