import type { GatewayManager } from '../../gateway/manager';
import {
  collectSmartCompletedStepDeliverablePaths,
} from '../../../src/lib/office-smart-input-validation';
import {
  planSmartProgressNudge,
  smartCoordinatorRepliedSubstantivelySince,
  smartRoomLastTeamActivityAt,
  SMART_PROGRESS_POLL_MS,
} from '../../../src/lib/office-smart-progress-policy';
import {
  resolveSmartNextExecutorRoleIds,
  resolveSmartWorkOrderSteps,
  smartAllMemberWorkOrderStepsDoneInRoom,
  smartMemberWorkOrderSteps,
} from '../../../src/lib/office-smart-work-order';
import { isSmartMentionDispatchInflight } from './room-mention-dispatch';
import { smartCoordinatorHasDecomposedInRoom } from './role-assignment-lookup';
import {
  attemptSmartTaskAutoCompletionFromRoom,
  findCoordinatorProjectClosureMessageInRoom,
  healSmartProjectRunningWithPublishedBundle,
  isSmartTaskMarkedRunning,
  resolveSmartClosureMinMessageTimestamp,
} from './smart-task-completion';
import { verifySmartUpstreamDeliverablePathsOnDisk } from './room-mention-disk-verify';
import { getRoomMessages, getTempProject, listFixedGroups } from './store';
import type { OfficeExecutionMember, OfficeFixedGroup, OfficeTempProject } from './types';
import { loadProjectExecutionMembers } from './office-execution-members';

type DriverHandle = {
  timer: NodeJS.Timeout;
  generation: number;
  taskStartedAt: number;
  kickoffTimestamp: number;
  lastNudgeAtMs: number | null;
};

const drivers = new Map<string, DriverHandle>();
let generationSeq = 0;

async function verifyCompletedStepPathsOnDisk(
  roomMessages: Awaited<ReturnType<typeof getRoomMessages>>,
  projectId: string,
  steps: ReturnType<typeof resolveSmartWorkOrderSteps>,
): Promise<boolean> {
  const paths = collectSmartCompletedStepDeliverablePaths({
    roomMessages,
    taskId: projectId,
    steps,
  });
  if (paths.length === 0) return false;
  const disk = await verifySmartUpstreamDeliverablePathsOnDisk(paths);
  return disk.ok;
}

async function pollSmartTaskProgress(
  gateway: GatewayManager,
  params: {
    projectId: string;
    groupId: string;
    coordinatorAgentId: string;
  },
  generation: number,
): Promise<void> {
  const active = drivers.get(params.projectId);
  if (!active || active.generation !== generation) return;

  if (!isSmartTaskMarkedRunning(params.projectId)) {
    stopSmartTaskProgressDriver(params.projectId);
    return;
  }

  const project = await getTempProject(params.projectId);
  if (!project || project.status !== 'running' || project.executionMode !== 'smart') {
    stopSmartTaskProgressDriver(params.projectId);
    return;
  }

  const groups = await listFixedGroups();
  const group = groups.find((g) => g.id === params.groupId)
    ?? (project.parentGroupId ? groups.find((g) => g.id === project.parentGroupId) : undefined);
  if (!group) return;

  const teamMembers = await loadProjectExecutionMembers(project);
  const teamRefs = teamMembers.map((m) => ({ agentId: m.agentId, displayName: m.displayName }));
  const teamAgentIds = new Set(teamRefs.map((m) => m.agentId));

  const roomMessages = await getRoomMessages(params.projectId);
  const steps = resolveSmartWorkOrderSteps(group, project.description, teamRefs);

  const closureMinTs = resolveSmartClosureMinMessageTimestamp(project, active.kickoffTimestamp);
  const closureDeclared = Boolean(
    findCoordinatorProjectClosureMessageInRoom(
      roomMessages,
      params.projectId,
      params.coordinatorAgentId,
      closureMinTs,
    ),
  );
  if (closureDeclared && await healSmartProjectRunningWithPublishedBundle(params.projectId)) {
    console.info('[office] smart task healed after published bundle', params.projectId);
    stopSmartTaskProgressDriver(params.projectId);
    return;
  }
  const closed = await attemptSmartTaskAutoCompletionFromRoom({
    projectId: params.projectId,
    groupId: group.id,
    coordinatorAgentId: params.coordinatorAgentId,
    gateway,
    steps,
    roomMessages,
    minClosureMessageTimestamp: closureMinTs,
  });
  if (closed) {
    console.info('[office] smart task completed from room closure', params.projectId);
    stopSmartTaskProgressDriver(params.projectId);
    return;
  }

  const nextExecutorRoleIds = resolveSmartNextExecutorRoleIds({
    steps,
    roomMessages,
    taskId: params.projectId,
  });
  const nextExecutorRoleId = nextExecutorRoleIds[0] ?? null;
  const memberSteps = smartMemberWorkOrderSteps(steps, params.coordinatorAgentId);
  const allMemberStepsDone = smartAllMemberWorkOrderStepsDoneInRoom(
    steps,
    roomMessages,
    params.projectId,
    params.coordinatorAgentId,
  );
  const deliverablePathsVerified = allMemberStepsDone
    ? await verifyCompletedStepPathsOnDisk(roomMessages, params.projectId, memberSteps)
    : false;

  const nowMs = Date.now();
  const teamRolesForPolicy = teamRefs.map((m) => ({ id: m.agentId, name: m.displayName }));

  const plan = planSmartProgressNudge({
    nowMs,
    taskStartedAt: active.taskStartedAt,
    lastTeamActivityAt: smartRoomLastTeamActivityAt(roomMessages, params.projectId, teamAgentIds),
    lastNudgeAtMs: active.lastNudgeAtMs,
    coordinatorRoleId: params.coordinatorAgentId,
    coordinatorHasDecomposed: smartCoordinatorHasDecomposedInRoom(
      roomMessages,
      params.coordinatorAgentId,
      params.projectId,
    ),
    nextExecutorRoleId,
    nextExecutorRoleIds,
    allStepsDoneInRoom: allMemberStepsDone,
    deliverablePathsVerified,
    coordinatorRepliedSinceKickoff: smartCoordinatorRepliedSubstantivelySince(
      roomMessages,
      params.projectId,
      params.coordinatorAgentId,
      active.kickoffTimestamp,
    ),
    teamRoles: teamRolesForPolicy,
    coordinatorClosureInRoom: closureDeclared,
    smartAssignDispatchError: project.smartLastAssign?.error,
    smartAssignDispatchErrorAt:
      project.smartLastAssign?.error && !project.smartLastAssign.dispatchedAt
        ? project.smartLastAssign.at
        : null,
  });

  if (plan) {
    if (isSmartMentionDispatchInflight(params.projectId, plan.targetRoleId)) {
      console.info(
        '[office] smart progress nudge skipped (mention dispatch in flight)',
        params.projectId,
        plan.kind,
        plan.targetRoleId,
      );
      return;
    }
    active.lastNudgeAtMs = nowMs;
    const target = teamRefs.find((m) => m.agentId === plan.targetRoleId);
    try {
      const { postRoomMessage } = await import('./orchestrator');
      await postRoomMessage(gateway, {
        groupId: params.groupId,
        projectId: params.projectId,
        coordinatorAgentId: params.coordinatorAgentId,
        content: plan.roomLine,
        from: 'system',
      });
      console.info(
        '[office] smart progress nudge',
        params.projectId,
        plan.kind,
        target?.displayName ?? plan.targetRoleId,
      );
    } catch (err) {
      console.warn('[office] smart progress nudge failed:', params.projectId, err);
    }
  }
}

export function startSmartTaskProgressDriver(
  gateway: GatewayManager,
  group: Pick<OfficeFixedGroup, 'id' | 'workflow' | 'agentIds'>,
  project: Pick<OfficeTempProject, 'id' | 'description' | 'executionMode' | 'status'>,
  coordinator: Pick<OfficeExecutionMember, 'agentId' | 'displayName'>,
  options?: { kickoffTimestamp?: number },
): void {
  if (project.executionMode !== 'smart') return;
  stopSmartTaskProgressDriver(project.id);

  const generation = ++generationSeq;
  const now = Date.now();
  const kickoffTimestamp = options?.kickoffTimestamp ?? now;
  const handle: DriverHandle = {
    timer: setInterval(() => {
      void pollSmartTaskProgress(
        gateway,
        {
          projectId: project.id,
          groupId: group.id,
          coordinatorAgentId: coordinator.agentId,
        },
        generation,
      ).catch((err) => {
        console.warn('[office] smart progress poll error:', project.id, err);
      });
    }, SMART_PROGRESS_POLL_MS),
    generation,
    taskStartedAt: kickoffTimestamp,
    kickoffTimestamp,
    lastNudgeAtMs: null,
  };
  drivers.set(project.id, handle);
}

export function stopSmartTaskProgressDriver(projectId: string): void {
  const handle = drivers.get(projectId);
  if (!handle) return;
  clearInterval(handle.timer);
  drivers.delete(projectId);
}
