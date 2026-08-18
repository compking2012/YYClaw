import type { GatewayManager } from '../../gateway/manager';
import type { ProjectAgentRef } from '../../../src/lib/office-workflow-node';
import { membersForProject } from './office-member-resolve';
import type { OfficeFixedGroup, OfficeTempProject, RoomMessage, RoomMessagePhase } from './types';
import {
  appendRoomMessage,
  getRoomMessages,
  getTempProject,
  listFixedGroups,
  loadStore,
} from './store';
import { callAgentMessage, sessionsSend } from './gateway-rpc';
import { roleDmSessionKey, roleTaskRoomDmSuffix, taskRoomSessionKey } from './session-keys';
import { auditLog } from './audit';
import { waitForSessionReply } from './run-completion';
import { pickRolesDelegatedByCoordinator } from './room-coordinator-delegates';
import { filterFollowUpMentionTargets } from './room-follow-up-policy';
import {
  resolveSmartNextExecutorRoleIds,
  resolveSmartWorkOrderSteps,
} from '../../../src/lib/office-smart-work-order';
import { dedupeMentionTargetsByRoleId } from '../../../src/lib/office-smart-mention-normalize';
import { buildSmartCoordinatorRoomPublishText } from '../../../src/lib/office-smart-room-fields';
import { isSmartJsonShapeText } from '../../../src/lib/office-smart-json-schema';
import { normalizeSmartMentionRaw, parseRoomMentionStructuredReply } from './room-mention-structured-reply';
import {
  findUnresolvedMentionTokens,
  parseMentions,
  resolveMentionTargets,
} from './room-mentions';
import { finalizeRoomMirrorReply, isUnmirroredRoomSnippet } from './room-mention-reply-policy';
import {
  filterMissingMentionTargetsWithRecentHandoffs,
  findMissingMentionTargets,
  scheduleMissingMentionCoordinatorAudit,
  shouldAuditRoleMessageForMissingMentions,
} from './room-missing-mention-coordinator';
import { mirrorAgentSessionToRoomMessage, roleRoomMirrorMessageId } from './room-session-mirror';
import {
  classifyRoomMessageKind,
  filterWorkflowRunnerMentionTargets,
  isCoordinatorBroadcast,
  resolveRoomReplyTargets,
  resolveSmartUserRoomReplyTargets,
  resolveWorkflowMentionSpeakerRoleId,
  shouldDispatchSmartMentionToRole,
  smartUserMentionedNonCoordinatorRoles,
} from './room-dispatch-policy';
import { isWorkflowUpstreamClarificationMessage } from '../../../src/lib/office-workflow-upstream-mention';
import { agentIdsMatch, roomMessageFromAgentId } from '../../../src/lib/office-agent-id-resolve';
import { dispatchSingleRoleMentionReply } from './room-mention-dispatch';
import {
  readOfficeProjectRoomMessages,
  scheduleOfficeRoomMessages,
} from './office-project-room-sync';
import { isOfficeUnifiedPollingActive } from './office-sync-runtime';
import {
  cancelUnmentionedCoordinatorWatch,
  scheduleUnmentionedCoordinatorWatch,
  shouldScheduleUnmentionedCoordinatorWatch,
} from './room-unmentioned-coordinator';
import { shouldImmediateSmartUserRoomCoordinatorIntervention } from '../../../src/lib/office-execution-mode-policy';
import { handleWorkflowUserRoomCoordinatorIntervention } from './workflow-coordinator-intervention';
import { buildRoomContextForAgent } from './room-context';
import {
  roomMessageAuthorLabel,
  roomMessageReplyPreview,
  roomMessageSpeakerLabel,
} from '../../../src/lib/office-room-reply';
import {
  roomMessageRequestsTaskRerun,
  triggerTaskRerunFromRoom,
} from './room-task-intent';
import { normalizeProjectMember } from './room-mention-dispatch';
import { asTeamMemberArray } from '../../../src/lib/office-agent-id-resolve';
import { buildSmartTaskKickoffRoomLine } from './smart-task-prompt';
import { roomMentionInitialReplyTimeoutMs, taskExecutionMode } from './task-execution-mode';
import { resolveProjectCoordinatorAgentId } from './task-coordinator';
import { isWorkflowTaskRunnerActive } from './workflow-run-registry';

export { parseMentions } from './room-mentions';

/** Direct @agent: initial feedback within 60s; @all delegates may take longer. */
const ROOM_MENTION_INITIAL_REPLY_MS = 60_000;

type ProjectMember = ProjectAgentRef & { id: string; name: string };

function groupContextForProject(
  project: OfficeTempProject,
  parentGroup?: OfficeFixedGroup | null,
): OfficeFixedGroup {
  if (parentGroup) return parentGroup;
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

async function loadProjectMembers(project: OfficeTempProject): Promise<ProjectMember[]> {
  const members = await membersForProject(project);
  return members.map((m) => ({ ...m, id: m.agentId, name: m.displayName }));
}

async function loadProjectExecutionContext(projectId: string): Promise<{
  project: OfficeTempProject;
  group: OfficeFixedGroup;
  members: ProjectMember[];
} | null> {
  const project = await getTempProject(projectId);
  if (!project) return null;
  const groups = await listFixedGroups();
  const parentGroup = project.parentGroupId
    ? groups.find((g) => g.id === project.parentGroupId)
    : undefined;
  const group = groupContextForProject(project, parentGroup ?? null);
  const members = await loadProjectMembers(project);
  return { project, group, members };
}

function resolveRoomProjectId(
  focusProject: Pick<OfficeTempProject, 'id'> | null | undefined,
  userMsg?: Pick<RoomMessage, 'projectId'>,
): string {
  const id = focusProject?.id ?? userMsg?.projectId?.trim();
  if (!id) throw new Error('Office room requires a projectId');
  return id;
}

function buildHandoffMessage(params: {
  fromMember?: ProjectMember;
  objective: string;
  context: string;
  nextAction: string;
}): string {
  return [
    '[Office Handoff]',
    `Objective: ${params.objective}`,
    `Context: ${params.context}`,
    `Next: ${params.nextAction}`,
    params.fromMember ? `From agent: ${params.fromMember.name} (${params.fromMember.agentId})` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

async function maybeAuditMissingMentionsAfterAgentPost(
  gateway: GatewayManager,
  groupId: string | undefined,
  projectId: string,
  msg: RoomMessage,
): Promise<void> {
  if (!shouldAuditRoleMessageForMissingMentions(msg as never)) return;

  const ctx = await loadProjectExecutionContext(projectId);
  if (!ctx) return;
  const { project, group, members } = ctx;
  const coordinatorAgentId = resolveProjectCoordinatorAgentId(project, group);
  if (!coordinatorAgentId) return;
  const speakerAgentId = roomMessageFromAgentId(msg);
  if (!speakerAgentId) return;
  if (agentIdsMatch(members, speakerAgentId, coordinatorAgentId)) return;

  const speaker = members.find((m) => agentIdsMatch(members, m.agentId, speakerAgentId));
  if (!speaker) return;

  scheduleMissingMentionCoordinatorAudit(groupId ?? project.id, msg.id, async () => {
    const roomProjectId = msg.projectId?.trim();
    if (!roomProjectId) return;
    const history = await getRoomMessages(roomProjectId);
    const fresh = history.find((m) => m.id === msg.id);
    if (!fresh) return;
    let missing = findMissingMentionTargets(
      fresh.content,
      members as never,
      speaker.agentId,
      fresh.mentions ?? [],
    );
    missing = filterMissingMentionTargetsWithRecentHandoffs(
      history,
      fresh,
      members as never,
      missing as never,
    );
    if (missing.length === 0) return;

    const focusProject = project;
    const roomContext = buildRoomContextForAgent(history, members as never, fresh.id);

    const coordMember = members.find((m) => m.agentId === coordinatorAgentId);
    if (!coordMember) return;

    await dispatchCoordinatorMissingMentionCorrection(
      gateway,
      {
        groupId,
        projectId: roomProjectId,
        coordinatorAgentId,
        groupName: group.name,
        focusProject,
        groupContext: {
          workflow: group.workflow,
          coordinatorAgentId: group.coordinatorAgentId,
          agentIds: group.agentIds,
        },
        roomContext,
      },
      members,
      members,
      speaker,
      fresh,
      missing as never,
    );
  });
}

/** 成员发言涉及某 agent 但未 @ 时，协调者在群内补指派。 */
async function dispatchCoordinatorMissingMentionCorrection(
  gateway: GatewayManager,
  params: {
    groupId?: string;
    projectId: string;
    coordinatorAgentId: string;
    groupName: string;
    focusProject: OfficeTempProject | null;
    groupContext: Pick<OfficeFixedGroup, 'workflow' | 'coordinatorAgentId' | 'agentIds'> | null;
    roomContext: string | null;
  },
  allMembers: ProjectMember[],
  teamMembers: ProjectMember[],
  speakerMember: ProjectMember,
  triggerMsg: RoomMessage,
  missingMembers: ProjectMember[],
): Promise<void> {
  const coordinator = allMembers.find((m) => m.agentId === params.coordinatorAgentId);
  if (!coordinator || missingMembers.length === 0) return;

  const focusProject = params.focusProject;
  const roomProjectId = resolveRoomProjectId(focusProject, triggerMsg);

  try {
    const names = missingMembers.map((m) => m.name).join('、');
    await appendRoomMessage({
      id: `room-${Date.now()}-missing-mention-sys`,
      groupId: params.groupId,
      projectId: roomProjectId,
      from: 'system',
      content: `协调者监督：【${speakerMember.name}】发言涉及 ${names} 但未 @ 点名，协调者将补充指派。`,
      mentions: missingMembers.map((m) => m.agentId),
      timestamp: Date.now(),
    });

    await dispatchRoomMentions(
      gateway,
      {
        groupId: params.groupId,
        projectId: params.projectId,
        coordinatorAgentId: params.coordinatorAgentId,
        content: triggerMsg.content,
        fromAgentId: triggerMsg.fromAgentId,
        groupName: params.groupName,
        focusProject: params.focusProject,
        groupContext: params.groupContext,
        replyQuote: {
          fromLabel: `【${speakerMember.name}】`,
          preview: triggerMsg.content.slice(0, 200),
        },
        roomContext: params.roomContext,
        promptVariant: 'coordinator_missing_mention',
        missingMention: {
          speakerRoleName: speakerMember.name,
          missingRoleNames: missingMembers.map((m) => m.name),
          speakerExcerpt: triggerMsg.content,
        },
      },
      triggerMsg,
      teamMembers,
      [coordinator],
      { waitForReplies: true },
    );
  } catch (e) {
    console.warn('[office] missing-mention coordinator correction failed:', e);
  }
}

const smartFollowUpInflight = new Set<string>();

type RoomMentionDispatchParams = {
  groupId?: string;
  projectId: string;
  coordinatorAgentId: string;
  content: string;
  fromAgentId?: string;
  groupName: string;
  focusProject: OfficeTempProject | null;
  groupContext: Pick<OfficeFixedGroup, 'workflow' | 'coordinatorAgentId' | 'agentIds'> | null;
  replyQuote: { fromLabel: string; preview: string } | null;
  roomContext: string | null;
  promptVariant?: import('./room-mention-dispatch').MentionPromptVariant;
  missingMention?: import('./room-mention-dispatch').MissingMentionDispatchContext;
  smartUserMentionedMemberNames?: string[];
  smartJsonRaw?: string;
};

function dispatchParamsForMentionDispatch(
  params: RoomMentionDispatchParams,
): Parameters<typeof dispatchSingleRoleMentionReply>[1] {
  const groupContext =
    params.groupContext
    ?? (params.focusProject
      ? {
          workflow: params.focusProject.workflow ?? { mode: 'dag', nodes: [], edges: [] },
          coordinatorAgentId: params.focusProject.coordinatorAgentId,
          agentIds: [...params.focusProject.agentIds],
        }
      : null);
  return {
    scenarioId: params.groupId ?? params.projectId,
    projectId: params.projectId,
    coordinatorAgentId: params.coordinatorAgentId,
    coordinatorRoleId: params.coordinatorAgentId,
    content: params.content,
    fromRoleId: params.fromAgentId,
    scenarioName: params.groupName,
    focusTask: params.focusProject as never,
    scenario: groupContext,
    replyQuote: params.replyQuote,
    roomContext: params.roomContext,
    promptVariant: params.promptVariant,
    missingMention: params.missingMention,
    smartUserMentionedMemberNames: params.smartUserMentionedMemberNames,
    smartJsonRaw: params.smartJsonRaw,
  } as never;
}

/** After a member @'s others in a room reply, dispatch model replies (assist/handoff). */
async function dispatchRoleFollowUpMentions(
  gateway: GatewayManager,
  params: RoomMentionDispatchParams,
  teamMembers: ProjectMember[],
  fromMember: ProjectMember,
  triggerUserMsg: RoomMessage,
  replyText: string,
  replyMessageId: string,
): Promise<void> {
  const roster = asTeamMemberArray(teamMembers as never);
  const memberList: ProjectMember[] = Array.isArray(teamMembers)
    ? teamMembers
    : roster.map((m) => ({
        id: (m.id ?? m.agentId ?? '').trim(),
        name: (m.name ?? m.displayName ?? m.agentId ?? '').trim(),
        agentId: (m.agentId ?? m.id ?? '').trim(),
        displayName: (m.displayName ?? m.name ?? m.agentId ?? '').trim(),
      }));
  const focus = params.focusProject;
  const mode = focus ? taskExecutionMode(focus) : 'workflow';
  const projectId = focus?.id ?? triggerUserMsg.projectId?.trim() ?? '';
  const roomMessages = projectId ? await getRoomMessages(projectId) : [];
  const coordinatorAgentId = params.coordinatorAgentId;
  const followUpParseText =
    mode === 'smart' && fromMember.agentId === coordinatorAgentId
      ? (() => {
          const norm = normalizeSmartMentionRaw(replyText, {
            isCoordinator: true,
            actorRoleName: fromMember.name,
          });
          const parsed = parseRoomMentionStructuredReply(norm.raw);
          return (
            buildSmartCoordinatorRoomPublishText(parsed.roomReply, parsed.dispatch)
            || norm.raw
          );
        })()
      : replyText;
  const smartNextExecutorRoleIds =
    mode === 'smart' && focus && params.groupContext
      ? resolveSmartNextExecutorRoleIds({
          steps: resolveSmartWorkOrderSteps(
            params.groupContext as never,
            focus.description,
            roster.map((m) => ({
              agentId: m.agentId ?? m.id ?? '',
              displayName: m.displayName ?? m.name ?? m.agentId ?? '',
            })),
          ),
          roomMessages,
          taskId: focus.id,
        })
      : [];
  const delegated = filterFollowUpMentionTargets({
    executionMode: mode,
    coordinatorRoleId: coordinatorAgentId,
    fromRoleId: fromMember.agentId,
    replyText: followUpParseText,
    roomMessages,
    taskId: projectId || undefined,
    replyTimestamp: Date.now(),
    smartNextExecutorRoleIds,
    replyMessageId,
    smartLastAssign: focus?.smartLastAssign,
    delegated: pickRolesDelegatedByCoordinator(
      mode === 'smart' ? replyText.trim() : (replyText.trim() || followUpParseText),
      roster as never,
      fromMember.agentId,
      coordinatorAgentId,
      { executionMode: mode },
    ),
  });
  const smartJsonRawForFollowUp =
    mode === 'smart' && isSmartJsonShapeText(replyText.trim()) ? replyText.trim() : undefined;
  const sourceMsgDraft: RoomMessage = {
    id: replyMessageId,
    groupId: params.groupId,
    projectId: projectId || params.projectId,
    from: fromMember.agentId,
    fromAgentId: fromMember.agentId,
    content: followUpParseText,
    mentions: [],
    timestamp: Date.now(),
    replyToId: triggerUserMsg.replyToId ?? triggerUserMsg.id,
    replyPreview: roomMessageReplyPreview(triggerUserMsg),
    smartJsonRaw: smartJsonRawForFollowUp,
  };
  const mentionTargets =
    projectId && mode === 'workflow'
      ? filterWorkflowRunnerMentionTargets({
          executionMode: mode,
          taskId: projectId,
          coordinatorRoleId: coordinatorAgentId,
          targets: delegated as never,
          teamRoles: memberList as never,
          message: sourceMsgDraft as never,
          focusTask: focus as never,
          scenario: params.groupContext
            ? { workflow: params.groupContext.workflow, agentIds: params.groupContext.agentIds }
            : null,
        })
      : delegated.map((m) => normalizeProjectMember(m as never, memberList as never));
  if (mentionTargets.length === 0) {
    if (
      mode === 'smart'
      && projectId
      && fromMember.agentId === coordinatorAgentId
    ) {
      const { recordSmartAssignFollowUpError } = await import('./smart-assign-ledger');
      const detail = '协调者 assign 已发布，但未能解析出可派发的成员目标（dispatch 角色名与团队不匹配或为空）。';
      await recordSmartAssignFollowUpError(projectId, replyMessageId, detail);
      await appendRoomMessage({
        id: `room-${Date.now()}-smart-assign-no-targets`,
        groupId: params.groupId,
        projectId,
        from: 'system',
        content: `【系统】${detail} 请协调者检查 JSON dispatch 中的 role 是否与团队成员显示名一致后重新 assign。`,
        mentions: [],
        timestamp: Date.now(),
      });
    }
    return;
  }

  if (mode === 'smart' && projectId) {
    const followKey = `${projectId}:${fromMember.agentId}:${replyMessageId}:${mentionTargets
      .map((t) => t.agentId)
      .sort()
      .join(',')}`;
    if (smartFollowUpInflight.has(followKey)) {
      console.info('[office] smart follow-up deduped (same publish)', followKey);
      return;
    }
    smartFollowUpInflight.add(followKey);
    setTimeout(() => smartFollowUpInflight.delete(followKey), 12_000);
  }

  const sourceMsg: RoomMessage = {
    ...sourceMsgDraft,
    mentions: mentionTargets.map((r) => r.agentId),
  };

  const fromLabel = roomMessageSpeakerLabel(sourceMsg, memberList as never, {
    user: '用户',
    system: '系统',
  });

  const followUpPromptVariant =
    mode === 'smart'
      ? fromMember.agentId !== coordinatorAgentId
        ? 'coordinator_member_report'
        : mentionTargets.length === 1 && mentionTargets[0]!.agentId === coordinatorAgentId
          ? params.promptVariant
          : undefined
      : fromMember.agentId !== coordinatorAgentId
        ? 'coordinator_member_report'
        : mentionTargets.length === 1 && mentionTargets[0]!.agentId === coordinatorAgentId
          ? params.promptVariant
          : params.promptVariant === 'coordinator_kickoff_decompose'
            ? undefined
            : params.promptVariant;

  await dispatchRoomMentions(
    gateway,
    {
      ...params,
      content: followUpParseText,
      smartJsonRaw: smartJsonRawForFollowUp ?? params.smartJsonRaw,
      promptVariant: followUpPromptVariant,
      replyQuote: {
        fromLabel,
        preview: replyText.slice(0, 200),
      },
    },
    sourceMsg,
    memberList,
    mentionTargets as never,
    { waitForReplies: true },
  );

  if (
    mode === 'smart'
    && projectId
    && fromMember.agentId === coordinatorAgentId
    && focus?.smartLastAssign?.messageId === replyMessageId
  ) {
    const { recordSmartAssignDispatched } = await import('./smart-assign-ledger');
    await recordSmartAssignDispatched(projectId, replyMessageId);
  }

  await auditLog('room_message', {
    projectId,
    mentions: mentionTargets.map((r) => r.agentId),
    roleFollowUp: true,
    fromAgentId: fromMember.agentId,
  });
}

async function dispatchRoomMentions(
  gateway: GatewayManager,
  params: RoomMentionDispatchParams,
  userMsg: RoomMessage,
  members: ProjectMember[],
  targets: ProjectMember[],
  options: {
    waitForReplies: boolean;
    initialTimeoutMs?: number;
    allowSupplementary?: boolean;
  },
): Promise<void> {
  const roomProjectId = resolveRoomProjectId(params.focusProject, userMsg);
  const roomKey = taskRoomSessionKey(params.coordinatorAgentId, roomProjectId);
  const coordinatorAgentId = params.coordinatorAgentId;
  const dispatchParams = dispatchParamsForMentionDispatch(params);

  const focusForMode = params.focusProject;
  const executionMode = focusForMode ? taskExecutionMode(focusForMode) : 'workflow';
  const speakerRoleId = resolveWorkflowMentionSpeakerRoleId({
    teamRoles: members as never,
    message: userMsg as never,
  });
  const dispatchTargetsRaw =
    executionMode === 'workflow'
      ? filterWorkflowRunnerMentionTargets({
          executionMode,
          taskId: roomProjectId,
          coordinatorRoleId: coordinatorAgentId,
          targets: targets as never,
          teamRoles: members as never,
          message: userMsg as never,
          focusTask: focusForMode as never,
          scenario: params.groupContext
            ? { workflow: params.groupContext.workflow, agentIds: params.groupContext.agentIds }
            : null,
        })
      : targets.filter((m) =>
          shouldDispatchSmartMentionToRole({
            messageFrom: userMsg.from as 'user' | 'system' | 'agent',
            targetAgentId: m.agentId,
            coordinatorAgentId,
            speakerAgentId: speakerRoleId,
          }),
        );
  const dispatchTargets =
    executionMode === 'smart'
      ? dedupeMentionTargetsByRoleId(dispatchTargetsRaw as never)
      : dispatchTargetsRaw;
  if (dispatchTargets.length === 0 && executionMode === 'workflow') {
    await auditLog('room_message', {
      projectId: roomProjectId,
      mentions: [],
      workflowRunnerSkipped: targets.length > 0,
    });
    return;
  }
  if (dispatchTargets.length === 0 && executionMode === 'smart' && targets.length > 0) {
    console.warn('[office] smart mention dispatch skipped (targets filtered)', roomProjectId);
    return;
  }

  if (!options.waitForReplies) {
    for (const member of dispatchTargets as ProjectMember[]) {
      const targetKey = roleDmSessionKey(
        member.agentId,
        member.agentId,
        roleTaskRoomDmSuffix(roomProjectId),
      );
      const handoff = buildHandoffMessage({
        fromMember: params.fromAgentId
          ? members.find((m) => m.agentId === params.fromAgentId)
          : undefined,
        objective: params.content,
        context: [
          `Project room ${roomProjectId}`,
          params.roomContext ?? '',
          'Resolve references like “上面/这个问题” using the transcript above.',
        ]
          .filter(Boolean)
          .join('\n\n'),
        nextAction:
          'You were @all mentioned for awareness only (not selected to reply). Read the transcript. If you contribute, you MUST post in the team room — never only private/DM. Any substantive reply will be mirrored to the room.',
      });
      const excerpt = params.content.trim().slice(0, 160);
      await appendRoomMessage({
        id: `room-${Date.now()}-notify-${userMsg.id}-${member.agentId}`,
        groupId: params.groupId,
        projectId: roomProjectId,
        from: 'system',
        content: `【知悉】已向 @${member.name} 发送群聊上下文（DM）；若其回复将同步显示在群内。摘要：${excerpt}`,
        mentions: [member.agentId],
        timestamp: Date.now(),
        replyToId: userMsg.id,
      });
      const notifyMsgId = roleRoomMirrorMessageId('room-notify', member as never, userMsg.id);
      void (async () => {
        try {
          const startedAt = Date.now();
          const result = await sessionsSend(gateway, {
            sessionKey: roomKey,
            message: handoff,
            targetSessionKey: targetKey,
            targetAgentId: member.agentId,
            idempotencyKey: `room-mention-${userMsg.id}-${member.agentId}-mirror`,
          });
          const text = await mirrorAgentSessionToRoomMessage({
            gateway,
            targetSessionKey: targetKey,
            runId: result.runId,
            scenarioId: params.groupId ?? roomProjectId,
            messageId: notifyMsgId,
            startedAtMs: startedAt,
            timeoutMs: 30_000,
            replyToId: userMsg.id,
            phase: 'task_clarification',
            teamRoles: members as never,
          });
          const publicText = finalizeRoomMirrorReply(text, members as never);
          if (publicText.trim() && !isUnmirroredRoomSnippet(publicText)) {
            await appendRoomMessage({
              id: notifyMsgId,
              groupId: params.groupId,
              projectId: roomProjectId,
              from: member.agentId,
              fromAgentId: member.agentId,
              content: publicText.trim(),
              mentions: [],
              timestamp: Date.now(),
              replyToId: userMsg.id,
              phase: 'task_clarification',
            });
          }
        } catch (err) {
          console.warn('[office] notify-only room mirror failed:', member.agentId, err);
        }
      })();
    }
    return;
  }

  const smartUnlimited = roomMentionInitialReplyTimeoutMs(focusForMode) === 0;
  const initialTimeoutMs = smartUnlimited
    ? 0
    : (options.initialTimeoutMs ?? ROOM_MENTION_INITIAL_REPLY_MS);
  const allowSupplementary = options.allowSupplementary ?? true;

  const coordinator = members.find((m) => m.agentId === coordinatorAgentId);
  const dispatch = (dispatchTargets as ProjectMember[]).map((member) =>
    dispatchSingleRoleMentionReply(
      gateway,
      dispatchParams,
      userMsg as never,
      members as never,
      member as never,
      { initialTimeoutMs, allowSupplementary },
      {
        escalateToCoordinator: coordinator
          ? async (coord, ctx) => {
              await dispatchRoomMentions(
                gateway,
                {
                  ...params,
                  content: ctx?.supervision
                    ? `【成员监督】${ctx?.failedRoleName ?? '成员'} 在未完成交付时发了进行中进度/口头承诺：${ctx?.failDetail?.slice(0, 280) ?? ''}\n请协调者 @${ctx?.failedRoleName ?? '成员'} 先完成任务并自测通过后再 @协调者 汇报，勿重复进度同步。`
                    : `【成员回复异常】${ctx?.failedRoleName ?? '成员'}：${ctx?.failDetail?.slice(0, 320) ?? ''}\n请协调者补充处理、直接答复群聊，或重新 @ 相关成员。`,
                  promptVariant: ctx?.supervision
                    ? 'coordinator_member_supervision'
                    : 'coordinator_member_failure',
                },
                userMsg,
                members,
                [coord as never],
                { waitForReplies: true },
              );
            }
          : undefined,
        dispatchFollowUpMentions: async (fromMember, replyText, sourceMessageId) => {
          const jsonRaw =
            isSmartJsonShapeText(replyText.trim()) ? replyText.trim() : undefined;
          const triggerMsg: RoomMessage = {
            id: sourceMessageId,
            groupId: params.groupId,
            projectId: userMsg.projectId ?? params.projectId,
            from: fromMember.agentId,
            fromAgentId: fromMember.agentId,
            content: replyText,
            mentions: [coordinatorAgentId],
            timestamp: Date.now(),
            replyToId: userMsg.id,
            replyPreview: roomMessageReplyPreview(userMsg),
            smartJsonRaw: jsonRaw,
          };
          await dispatchRoleFollowUpMentions(
            gateway,
            params,
            members,
            fromMember as never,
            triggerMsg,
            replyText,
            sourceMessageId,
          );
        },
        auditMissingMentions: (posted) => {
          void maybeAuditMissingMentionsAfterAgentPost(
            gateway,
            params.groupId,
            params.projectId,
            posted,
          );
        },
      },
    ),
  );

  await Promise.all(dispatch);
}

function processRoomMessageInBackground(
  gateway: GatewayManager,
  params: RoomMentionDispatchParams & {
    resolvedTeamMentionCount?: number;
    mentionTargetsBeforeFilter?: ProjectMember[];
    parsedUserMentionTargets?: ProjectMember[];
  },
  userMsg: RoomMessage,
  allMembers: ProjectMember[],
  teamMembers: ProjectMember[],
  replyTargets: ProjectMember[],
): void {
  const roomProjectId = params.projectId;
  const roomKey = taskRoomSessionKey(params.coordinatorAgentId, roomProjectId);
  const coordinatorAgentId = params.coordinatorAgentId;

  void (async () => {
    const dispatchKind = classifyRoomMessageKind(userMsg.mentions);

    if (
      isCoordinatorBroadcast({
        kind: dispatchKind,
        fromRoleId: params.fromAgentId,
        coordinatorRoleId: coordinatorAgentId,
      })
    ) {
      await auditLog('room_message', { projectId: roomProjectId, mentions: [], broadcastCoordinatorIgnored: true });
      return;
    }

    const roomExecutionMode = params.focusProject
      ? taskExecutionMode(params.focusProject)
      : 'workflow';
    if (
      shouldImmediateSmartUserRoomCoordinatorIntervention({
        executionMode: roomExecutionMode,
        from: userMsg.from as 'user' | 'system' | 'agent',
        hasFocusTask: Boolean(params.focusProject && params.groupContext),
      })
    ) {
      const coordinator = teamMembers.find((m) => m.agentId === coordinatorAgentId);
      if (coordinator && params.focusProject && params.groupContext) {
        cancelUnmentionedCoordinatorWatch(params.groupId ?? roomProjectId, 'user_room_intervention');
        const mentionedMembers = smartUserMentionedNonCoordinatorRoles(
          params.parsedUserMentionTargets ?? [],
          coordinatorAgentId,
        );
        const isUserBroadcast = classifyRoomMessageKind(userMsg.mentions) === 'broadcast';
        const promptVariant = isUserBroadcast
          ? ('coordinator_broadcast_unmentioned' as const)
          : mentionedMembers.length > 0
            ? ('coordinator_user_mention_member' as const)
            : undefined;
        await dispatchRoomMentions(
          gateway,
          {
            ...params,
            promptVariant,
            smartUserMentionedMemberNames: mentionedMembers.map((r) => r.displayName),
          },
          userMsg,
          teamMembers,
          [coordinator],
          { waitForReplies: true },
        );
        return;
      }
    }

    if (replyTargets.length > 0) {
      await dispatchRoomMentions(gateway, params, userMsg, teamMembers, replyTargets, {
        waitForReplies: true,
      });
      return;
    }

    if (
      shouldScheduleUnmentionedCoordinatorWatch({
        replyTargetCount: 0,
        mentionTokens: userMsg.mentions,
        resolvedTeamMentionCount: params.resolvedTeamMentionCount ?? 0,
        coordinatorRoleId: coordinatorAgentId,
        fromRoleId: params.fromAgentId,
        from: userMsg.from as 'user' | 'system' | 'agent',
        content: params.content,
        executionMode: roomExecutionMode,
      })
    ) {
      const speakerLabel = roomMessageSpeakerLabel(userMsg, allMembers as never, {
        user: '用户',
        system: '系统',
      });
      const coordinator = teamMembers.find((m) => m.agentId === coordinatorAgentId);
      scheduleUnmentionedCoordinatorWatch(
        {
          gateway,
          scenarioId: params.groupId ?? roomProjectId,
          coordinatorRoleId: coordinatorAgentId,
          coordinatorAgentId,
          scenarioName: params.groupName,
          focusTask: params.focusProject as never,
          group: params.groupContext
            ? {
                workflow: params.groupContext.workflow,
                coordinatorAgentId: params.groupContext.coordinatorAgentId,
                agentIds: params.groupContext.agentIds,
              }
            : null,
          replyQuote: params.replyQuote,
          roomContext: params.roomContext,
          speakerLabel,
          content: params.content,
          triggerMsg: userMsg as never,
          teamMembers: teamMembers as never,
          allMembers: allMembers as never,
        },
        async (watchParams) => {
          if (!coordinator) return;
          await dispatchRoomMentions(
            watchParams.gateway,
            {
              groupId: params.groupId,
              projectId: roomProjectId,
              coordinatorAgentId,
              content: watchParams.content,
              fromAgentId: watchParams.triggerMsg.fromAgentId,
              groupName: params.groupName,
              focusProject: params.focusProject,
              groupContext: params.groupContext,
              replyQuote: watchParams.replyQuote,
              roomContext: watchParams.roomContext,
              promptVariant: 'coordinator_broadcast_unmentioned',
            },
            watchParams.triggerMsg as never,
            watchParams.teamMembers as never,
            [coordinator],
            { waitForReplies: true },
          );
        },
      );
      return;
    }

    const roomGatewayLine = params.roomContext
      ? `[Room]\n${params.roomContext}\n\n【最新消息】\n${params.content}`
      : `[Room] ${params.content}`;
    void callAgentMessage(gateway, roomKey, roomGatewayLine, `room-${userMsg.id}`).catch((err) => {
      console.warn('[office] room coordinator notify failed:', err);
    });
  })().catch(async (err) => {
    console.warn('[office] room message background processing failed:', err);
    await appendRoomMessage({
      id: `room-${Date.now()}-bg-err`,
      groupId: params.groupId,
      projectId: roomProjectId,
      from: 'system',
      content: `群聊消息处理异常：${err instanceof Error ? err.message : String(err)}`,
      mentions: [],
      timestamp: Date.now(),
    }).catch(() => undefined);
  });
}

/** Persist user line to the room immediately; agent @mention replies are fetched asynchronously. */
export async function postRoomMessage(
  gateway: GatewayManager,
  params: {
    projectId: string;
    coordinatorAgentId: string;
    content: string;
    from?: RoomMessage['from'];
    fromAgentId?: string;
    groupId?: string;
    replyToId?: string;
  },
): Promise<{ message: RoomMessage; replies: RoomMessage[]; pendingReplies: boolean }> {
  const ctx = await loadProjectExecutionContext(params.projectId);
  if (!ctx) throw new Error('Project not found');
  const { project, group, members: teamMembers } = ctx;
  const members = teamMembers;
  const coordinatorAgentId =
    resolveProjectCoordinatorAgentId(project, group) || params.coordinatorAgentId;
  const groupId = params.groupId ?? project.parentGroupId ?? group.id;
  const mentions = parseMentions(params.content);

  let replyToId: string | undefined;
  let replyPreview: string | undefined;
  let replyQuote: { fromLabel: string; preview: string } | null = null;
  if (params.replyToId?.trim()) {
    const history = await getRoomMessages(params.projectId);
    const quoted = history.find((m) => m.id === params.replyToId);
    if (quoted) {
      replyToId = quoted.id;
      replyPreview = roomMessageReplyPreview(quoted);
      replyQuote = {
        fromLabel: roomMessageAuthorLabel(quoted, members as never, { user: '用户', system: '系统' }),
        preview: replyPreview,
      };
    }
  }

  const { formatRoomReplyBody } = await import('../../../src/lib/office-room-reply-format');
  const messageFrom = params.from ?? 'user';
  const userMsg: RoomMessage = {
    id: `room-${Date.now()}-u`,
    groupId,
    projectId: params.projectId,
    from: messageFrom,
    fromAgentId: messageFrom === 'user' ? undefined : params.fromAgentId,
    content: formatRoomReplyBody(params.content, !!replyToId),
    mentions,
    timestamp: Date.now(),
    replyToId,
    replyPreview,
  };
  await appendRoomMessage(userMsg);

  const focusProject = project;

  const dispatchKind = classifyRoomMessageKind(mentions);
  const isBroadcast = dispatchKind === 'broadcast';
  const unresolved = findUnresolvedMentionTokens(mentions, teamMembers as never, {
    coordinatorRoleId: coordinatorAgentId,
  });
  if (unresolved.length > 0) {
    await appendRoomMessage({
      id: `room-${Date.now()}-unresolved`,
      groupId,
      projectId: params.projectId,
      from: 'system',
      content: `未能识别 @${unresolved.join('、@')}，请从提及列表选择团队成员（如 @协调者 或成员显示名）。`,
      mentions: [],
      timestamp: Date.now(),
    });
  }

  const speakerLabel = roomMessageSpeakerLabel(userMsg, members as never, {
    user: '用户',
    system: '系统',
  });
  const mentionQuote =
    replyQuote ??
    ({
      fromLabel: speakerLabel,
      preview: roomMessageReplyPreview(userMsg),
    } as const);

  const postMode = taskExecutionMode(focusProject);
  const parsedUserMentionTargets =
    postMode === 'smart' && userMsg.from === 'user'
      ? resolveMentionTargets(mentions, teamMembers as never, {
          coordinatorRoleId: coordinatorAgentId,
        })
      : [];
  let replyTargets = resolveRoomReplyTargets({
    mentionTokens: mentions,
    teamRoles: teamMembers as never,
    fromRoleId: messageFrom === 'user' ? undefined : params.fromAgentId,
    from: userMsg.from,
    focusTask: focusProject as never,
    coordinatorRoleId: coordinatorAgentId,
    content: params.content,
  });
  const mentionTargetsBeforeFilter = replyTargets;
  if (postMode === 'workflow') {
    replyTargets = filterWorkflowRunnerMentionTargets({
      executionMode: postMode,
      taskId: params.projectId,
      coordinatorRoleId: coordinatorAgentId,
      targets: replyTargets,
      teamRoles: teamMembers as never,
      message: userMsg as never,
    });
  }
  if (postMode === 'smart' && userMsg.from === 'user') {
    replyTargets = resolveSmartUserRoomReplyTargets({
      coordinatorRoleId: coordinatorAgentId,
      targets: replyTargets,
      teamRoles: teamMembers as never,
    });
  }

  if (
    shouldImmediateSmartUserRoomCoordinatorIntervention({
      executionMode: postMode,
      from: userMsg.from as 'user' | 'system' | 'agent',
      hasFocusTask: true,
    })
  ) {
    cancelUnmentionedCoordinatorWatch(groupId ?? params.projectId, 'user_room_intervention');
  }

  if (postMode === 'workflow' && userMsg.from === 'user') {
    const roomHistory = await getRoomMessages(params.projectId);
    const roomContext = buildRoomContextForAgent(roomHistory, members as never, userMsg.id);
    void handleWorkflowUserRoomCoordinatorIntervention(gateway, {
      group,
      project: focusProject,
      userContent: params.content,
      userMsg: userMsg as never,
      roomContext,
    }).catch(async (err) => {
      console.warn('[office] workflow coordinator user intervention failed:', err);
      await appendRoomMessage({
        id: `room-${Date.now()}-wf-intervention-err`,
        groupId,
        projectId: params.projectId,
        from: 'system',
        content: `用户介入处理异常：${err instanceof Error ? err.message : String(err)}`,
        mentions: [],
        timestamp: Date.now(),
      }).catch(() => undefined);
    });
    return {
      message: userMsg,
      replies: [],
      pendingReplies: true,
    };
  }

  if (
    mentionTargetsBeforeFilter.length > 0
    && replyTargets.length === 0
    && postMode === 'workflow'
    && isWorkflowTaskRunnerActive(params.projectId)
    && userMsg.from !== 'user'
    && !isWorkflowUpstreamClarificationMessage(userMsg as never)
  ) {
    await appendRoomMessage({
      id: `room-${Date.now()}-wf-runner-owns`,
      groupId,
      projectId: params.projectId,
      from: 'system',
      content:
        '工作流执行中：成员子任务由工作流自动指派并在节点会话中执行，群聊 @ 不会触发成员回复。上游依赖/输入不合格时，成员可在【协作询问】中 @ 直接前驱角色，对方须在群内回复。人工干预请用「用户」身份 @。',
      mentions: [],
      timestamp: Date.now(),
    });
  }

  if (roomMessageRequestsTaskRerun(params.content)) {
    const rerun = await triggerTaskRerunFromRoom(gateway, groupId, params.content, {
      fromRoleId: params.fromAgentId,
      coordinatorRoleId: coordinatorAgentId,
    });
    if (rerun.error === 'no_task') {
      await appendRoomMessage({
        id: `room-${Date.now()}-rerun-none`,
        groupId,
        projectId: params.projectId,
        from: 'system',
        content: '未找到可重启的团队项目，请先在项目列表中创建项目。',
        mentions: [],
        timestamp: Date.now(),
      });
    }
  }

  const roomHistory = await getRoomMessages(params.projectId);
  const roomContext = buildRoomContextForAgent(roomHistory, members as never, userMsg.id);

  processRoomMessageInBackground(
    gateway,
    {
      groupId,
      projectId: params.projectId,
      coordinatorAgentId,
      content: params.content,
      fromAgentId: params.fromAgentId,
      groupName: group.name,
      focusProject,
      groupContext: {
        workflow: group.workflow,
        coordinatorAgentId: group.coordinatorAgentId,
        agentIds: group.agentIds,
      },
      replyQuote: mentionQuote,
      roomContext,
      resolvedTeamMentionCount:
        parsedUserMentionTargets.length > 0
          ? parsedUserMentionTargets.length
          : mentionTargetsBeforeFilter.length,
      mentionTargetsBeforeFilter: mentionTargetsBeforeFilter as never,
      parsedUserMentionTargets: parsedUserMentionTargets as never,
    },
    userMsg,
    members,
    teamMembers,
    replyTargets as never,
  );

  const pendingReplies =
    replyTargets.length > 0
    || shouldImmediateSmartUserRoomCoordinatorIntervention({
      executionMode: postMode,
      from: userMsg.from as 'user' | 'system' | 'agent',
      hasFocusTask: true,
    })
    || (isBroadcast
      && shouldScheduleUnmentionedCoordinatorWatch({
        replyTargetCount: 0,
        mentionTokens: mentions,
        resolvedTeamMentionCount: mentionTargetsBeforeFilter.length,
        coordinatorRoleId: coordinatorAgentId,
        fromRoleId: params.fromAgentId,
        from: userMsg.from as 'user' | 'system' | 'agent',
        content: params.content,
        executionMode: postMode,
      }));

  return {
    message: userMsg,
    replies: [],
    pendingReplies,
  };
}

/**
 * Smart 启动：协调者自 @ 拆解分工（绕过 resolveRoomReplyTargets 的自 @ 过滤），触发协调者点名 LLM。
 */
export async function dispatchSmartCoordinatorKickoffDecomposition(
  gateway: GatewayManager,
  params: {
    groupId?: string;
    group: Pick<OfficeFixedGroup, 'name' | 'workflow' | 'coordinatorAgentId' | 'agentIds'>;
    projectId: string;
    coordinator: ProjectMember;
    project: OfficeTempProject;
  },
): Promise<RoomMessage> {
  const members = await loadProjectMembers(params.project);
  const coordinatorMember =
    members.find((m) => m.agentId === params.coordinator.agentId)
    ?? normalizeProjectMember({
      agentId: params.coordinator.agentId,
      displayName: params.coordinator.displayName,
    });
  const kickoffContent = buildSmartTaskKickoffRoomLine(coordinatorMember as never, params.project as never);
  const mentions = parseMentions(kickoffContent);
  const userMsg: RoomMessage = {
    id: `room-${Date.now()}-smart-coord-kickoff`,
    groupId: params.groupId,
    projectId: params.projectId,
    from: params.coordinator.agentId,
    fromAgentId: params.coordinator.agentId,
    content: kickoffContent,
    mentions,
    timestamp: Date.now(),
    phase: 'task_received',
  };
  await appendRoomMessage(userMsg);

  const roomHistory = await getRoomMessages(params.projectId);
  const roomContext = buildRoomContextForAgent(roomHistory, members as never, userMsg.id);
  const speakerLabel = roomMessageSpeakerLabel(userMsg, members as never, {
    user: '用户',
    system: '系统',
  });
  const mentionQuote = {
    fromLabel: speakerLabel,
    preview: roomMessageReplyPreview(userMsg),
  };

  await dispatchRoomMentions(
    gateway,
    {
      groupId: params.groupId,
      projectId: params.projectId,
      coordinatorAgentId: params.coordinator.agentId,
      content: kickoffContent,
      fromAgentId: params.coordinator.agentId,
      groupName: params.group.name,
      focusProject: params.project,
      groupContext: params.group,
      replyQuote: mentionQuote,
      roomContext,
      promptVariant: 'coordinator_kickoff_decompose',
    },
    userMsg,
    members,
    [coordinatorMember],
    { waitForReplies: true },
  );

  return userMsg;
}

/**
 * Post an agent-authored room line (deliverable, handoff). Does not block on @mention replies.
 */
export async function postRoomAnnouncement(
  gateway: GatewayManager,
  params: {
    projectId?: string;
    /** @deprecated use projectId */
    taskId?: string;
    coordinatorAgentId: string;
    fromAgentId?: string;
    /** @deprecated use fromAgentId */
    fromRoleId?: string;
    content: string;
    groupId?: string;
    /** @deprecated use groupId */
    scenarioId?: string;
    notifyMentionedAgents?: boolean;
    /** @deprecated alias */
    notifyMentionedRoles?: boolean;
    syncGateway?: boolean;
    phase?: RoomMessagePhase;
    progressText?: string;
    nodeId?: string;
    messageId?: string;
    mentions?: string[];
    attachments?: RoomMessage['attachments'];
  },
): Promise<RoomMessage> {
  const projectId = (params.projectId ?? params.taskId ?? '').trim();
  const fromAgentId = (params.fromAgentId ?? params.fromRoleId ?? '').trim();
  const groupId = params.groupId ?? params.scenarioId;
  if (!projectId) throw new Error('Project not found');
  if (!fromAgentId) throw new Error('fromAgentId is required');

  const ctx = await loadProjectExecutionContext(projectId);
  if (!ctx) throw new Error('Project not found');
  const { project, group, members } = ctx;
  const fromMember = members.find((m) => m.agentId === fromAgentId);
  const mentionTokens =
    params.mentions && params.mentions.length > 0 ? params.mentions : parseMentions(params.content);
  const coordinatorAgentId = resolveProjectCoordinatorAgentId(project, group);
  const replyTargets = resolveRoomReplyTargets({
    mentionTokens,
    teamRoles: members as never,
    fromRoleId: fromAgentId,
    from: 'agent',
    focusTask: project as never,
    coordinatorRoleId: coordinatorAgentId,
    content: params.content,
  });
  const announceProjectId = projectId;
  const announceMode = taskExecutionMode(project);
  const announceMsg: RoomMessage = {
    id: params.messageId ?? `room-${Date.now()}-${fromAgentId}`,
    groupId: groupId ?? project.parentGroupId,
    projectId: announceProjectId,
    from: fromMember?.agentId ?? fromAgentId,
    fromAgentId,
    content: params.content,
    mentions: mentionTokens,
    timestamp: Date.now(),
    phase: params.phase,
    progressText: params.progressText,
    nodeId: params.nodeId,
    attachments: params.attachments,
  };
  const notifyTargets = filterWorkflowRunnerMentionTargets({
    executionMode: announceMode,
    taskId: announceProjectId,
    coordinatorRoleId: coordinatorAgentId,
    targets: replyTargets,
    teamRoles: members as never,
    message: announceMsg as never,
    focusTask: project as never,
    scenario: { workflow: group.workflow, agentIds: group.agentIds },
  });
  const notifyMentioned =
    params.notifyMentionedAgents ?? params.notifyMentionedRoles;
  const runnerOwnsWorkflowExecution =
    announceMode === 'workflow' && isWorkflowTaskRunnerActive(announceProjectId);
  const upstreamClarificationNotify =
    runnerOwnsWorkflowExecution
    && isWorkflowUpstreamClarificationMessage(announceMsg as never)
    && notifyMentioned === true;
  const shouldNotifyMentioned =
    notifyTargets.length > 0
    && (!runnerOwnsWorkflowExecution || upstreamClarificationNotify)
    && (notifyMentioned === true || (notifyMentioned !== false && notifyTargets.length > 0));
  const effectiveNotify = shouldNotifyMentioned;

  const msg: RoomMessage = {
    ...announceMsg,
    mentions: notifyTargets.length > 0 ? notifyTargets.map((r) => r.agentId) : mentionTokens,
  };
  await appendRoomMessage(msg);

  const roomKey = taskRoomSessionKey(params.coordinatorAgentId, announceProjectId);
  if (params.syncGateway !== false) {
    await callAgentMessage(gateway, roomKey, `[Room] ${params.content}`, `room-announce-${msg.id}`);
  }

  if (effectiveNotify && fromMember && announceMode !== 'smart') {
    const roomHistory = await getRoomMessages(announceProjectId);
    const roomContext = buildRoomContextForAgent(roomHistory, members as never, msg.id);
    const speakerLabel = roomMessageSpeakerLabel(msg, members as never, {
      user: '用户',
      system: '系统',
    });
    processRoomMessageInBackground(
      gateway,
      {
        groupId: groupId ?? project.parentGroupId,
        projectId: announceProjectId,
        coordinatorAgentId: params.coordinatorAgentId,
        content: params.content,
        fromAgentId,
        groupName: group.name,
        focusProject: project,
        groupContext: {
          workflow: group.workflow,
          coordinatorAgentId: group.coordinatorAgentId,
          agentIds: group.agentIds,
        },
        replyQuote: {
          fromLabel: speakerLabel,
          preview: roomMessageReplyPreview(msg),
        },
        roomContext,
      },
      msg,
      members,
      members,
      notifyTargets as never,
    );
  }

  void maybeAuditMissingMentionsAfterAgentPost(
    gateway,
    params.groupId ?? project.parentGroupId,
    announceProjectId,
    msg,
  );

  await auditLog('room_announcement', {
    projectId: announceProjectId,
    fromAgentId: params.fromAgentId,
    mentions: msg.mentions,
  });
  return msg;
}

export async function sendP2P(
  gateway: GatewayManager,
  params: {
    fromAgentId: string;
    toAgentId: string;
    content: string;
    threadId?: string;
  },
): Promise<{ runId?: string; sessionKey: string; reply?: string; completed?: boolean }> {
  const fromAgentId = params.fromAgentId.trim();
  const toAgentId = params.toAgentId.trim();
  if (!fromAgentId || !toAgentId) throw new Error('Agent not found');

  const thread = params.threadId ?? 'default';
  const fromKey = roleDmSessionKey(fromAgentId, fromAgentId, `p2p-${toAgentId}-${thread}`);
  const toKey = roleDmSessionKey(toAgentId, toAgentId, `p2p-${fromAgentId}-${thread}`);

  const handoff = buildHandoffMessage({
    objective: params.content,
    context: `P2P thread ${thread}`,
    nextAction: 'Reply directly to the sender agent.',
  });

  const startedAt = Date.now();
  const result = await sessionsSend(gateway, {
    sessionKey: fromKey,
    message: handoff,
    targetSessionKey: toKey,
    targetAgentId: toAgentId,
    idempotencyKey: `p2p-${fromAgentId}-${toAgentId}-${Date.now()}`,
  });

  const waitResult = await waitForSessionReply(gateway, {
    sessionKey: toKey,
    startedAtMs: startedAt,
    timeoutMs: 300_000,
  });

  await auditLog('p2p_message', {
    from: fromAgentId,
    to: toAgentId,
    thread,
    completed: waitResult.completed,
    timedOut: waitResult.timedOut,
  });
  return {
    runId: result.runId,
    sessionKey: toKey,
    reply: waitResult.assistantText,
    completed: waitResult.completed,
  };
}

export async function listRoomHistory(
  projectId: string,
  options?: { urgent?: boolean },
): Promise<RoomMessage[]> {
  if (options?.urgent === true || isOfficeUnifiedPollingActive()) {
    return scheduleOfficeRoomMessages(projectId, options);
  }
  return readOfficeProjectRoomMessages(projectId);
}

export async function getOfficeAgentIds(): Promise<string[]> {
  const s = await loadStore();
  const ids = new Set<string>();
  for (const group of s.fixedGroups) {
    for (const agentId of group.agentIds) ids.add(agentId);
  }
  for (const project of s.tempProjects) {
    for (const agentId of project.agentIds) ids.add(agentId);
  }
  return [...ids];
}
