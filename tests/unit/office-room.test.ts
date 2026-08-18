// Merged office unit tests — 30 sources
import { describe, it, expect, vi } from 'vitest';
import {
  buildMandatoryMentionReplyFallback,
  isSubstantiveRoomMentionReply,
  isUnmirroredRoomSnippet,
  roomReplyProgressSnippet,
} from '../../electron/services/office/room-mention-reply-policy';
import {
  buildMentionProgressContextBlock,
  buildMentionTriggerBlock,
} from '../../src/lib/office-mention-progress-context';
import {
  buildRoomContextBlock,
  roomMessageBodyForContext,
  selectRoomContextMessages,
  selectSubstantiveRoomContextMessages,
} from '../../src/lib/office-room-context';
import {
  buildRoomMentionPickerRoles,
  insertMentionToken,
  ROOM_MENTION_ALL_ID,
} from '../../src/lib/office-mention';
import {
  compareOfficeTasksBySequence,
  formatOfficeTaskListTitle,
  sortOfficeTasksBySequence,
} from '../../src/lib/office-task-order';
import {
  confirmDiscardOfficeDraft,
  isShallowRecordDirty,
  requestCloseOfficeDraft,
} from '../../src/lib/office-unsaved-draft';
import {
  coordinatorDecidedNoReply,
  shouldScheduleUnmentionedCoordinatorWatch,
} from '../../electron/services/office/room-unmentioned-coordinator';
import {
  extractPublicRoomMirrorText,
  finalizeCoordinatorDispatchReply,
  isIntermediateOnlyRoomMirrorText,
  stripSmartProtocolMirrorNoise,
} from '../../src/lib/office-room-mirror-public';
import {
  extractTaskTitleHintsFromRoomContent,
  pickScenarioTaskForRoom,
  resolveTaskFromRoomContent,
  scoreTaskTitleMatch,
} from '../../src/lib/office-room-task-resolve';
import {
  filterMentionRoles,
  getActiveMention,
} from '../../src/lib/office-mention';
import {
  filterRoomMessagesForTask,
  isProjectRoomActive,
  listActiveExecutingProjectIds,
  officeRoomPollIntervalMs,
  officeExecutionProgressPollIntervalMs,
  officeRoomPollTaskIds,
  roomGroupIdForProject,
  shouldPollOfficeRoomMessages,
  shouldPollOfficeRoomsWhileExecuting,
  buildTaskExpandStateForExecutingFocus,
  isOfficeTaskCardExpanded,
  bumpOfficeRoomPanelScheduleToken,
  scheduleOfficeRoomPanelActivation,
  scheduleOfficeRoomPanelDeactivation,
  isOfficeProjectCardExpanded,
  nextActiveRoomTaskIdOnProjectClick,
  officeTaskStatusLight,
  preferredActiveRoomTaskIdOnOfficeEnter,
  preferredScenarioIdOnOfficeEnter,
  shouldAutoExpandRoomOnMessageCount,
  shouldAutoExpandRoomOnTaskStatus,
  shouldShowOfficeProjectRoomsPanel,
  officeRoomSidebarListProjects,
} from '../../src/lib/office-room-sidebar';
import {
  findAssistantAfterCurrentUserTurn,
  findLatestAssistantAfter,
  normalizeOfficeTimestampMs,
  parseGatewayChatEnvelope,
  collectAssistantRoomMirrorText,
  extractPublicReplyFromThinking,
  extractRoomMirrorTextFromAssistantMessage,
  extractTextFromOfficeMessage,
  shouldArmSessionReplyTimeout,
} from '../../electron/services/office/run-completion';
import {
  findRolesReferencedButNotMentioned,
  textImpliesRoleWithoutAt,
} from '../../src/lib/office-implicit-role-mention';
import {
  findUnresolvedMentionTokens,
  mentionsIncludeAll,
  parseMentions,
  resolveMentionTargets,
  roleMatchesMentionToken,
} from '../../electron/services/office/room-mentions';
import {
  formatStructuredValidationFailureDetail,
  sanitizePriorRawForRetryDisplay,
} from '../../src/lib/office-mention-validation-detail';
import {
  isSmartTask,
  isWorkflowTask,
  roomMentionInitialReplyTimeoutMs,
  taskExecutionMode,
} from '../../src/lib/office-task-execution-mode';
import {
  notifyTargetsForAllMention,
  pickRolesDelegatedByCoordinator,
  resolveReplyTargetsAfterCoordinator,
} from '../../electron/services/office/room-coordinator-delegates';
import {
  reconcileTaskNodeRunsFromRoom,
  resolveNodeRoomProgress,
  roomMessageAppliesToNode,
  taskLooksUserAborted,
} from '../../src/lib/task-room-progress-reconcile';
import {
  ROOM_DELIVER_BODY_CHUNK_CHARS,
  buildTaskDeliverRoomContents,
} from '../../src/lib/office-room-deliver';
import {
  scoreRoleRelevanceForAllMention,
  selectPrimaryRolesForAllMention,
} from '../../electron/services/office/room-mention-all';
import { buildRoomCoordinatorPrompt } from '../../electron/services/office/room-coordinator-prompt';
import { buildRoomCoordinatorUnmentionedPrompt } from '../../electron/services/office/room-coordinator-prompt';
import { buildRoomMentionAgentPrompt } from '../../electron/services/office/room-mention-prompt';
import { buildRoomMentionRetryPrompt } from '../../electron/services/office/room-mention-structured-reply';
import { buildTaskHandoffRoomContent } from '../../electron/services/office/workflow-room-handoff';
import { createTaskDraft } from '../../electron/services/office/store';
import { deriveTaskProgressSync } from '../../src/lib/office-task-progress-sync';
import { extractStructuredReplyFromAssistantMessage } from '../../src/lib/office-session-final-mirror';
import { findMissingMentionTargets } from '../../electron/services/office/room-missing-mention-coordinator';
import { formatOfficeTaskCardStatusSummary } from '../../src/lib/office-task-card-summary';
import { inferPhaseFromRoleReplyContent } from '../../src/lib/office-mention-task-sync';
import { normalizeStrictAtMentionText } from '../../src/lib/office-mention-parse';
import { resolveTaskCoordinatorRoleId } from '../../src/lib/office-task-coordinator';
import { roomMessageMentionSpeakerRef, roomMessageSpeakerLabel } from '../../src/lib/office-room-reply';
import { roomMessageRequestsTaskRerun } from '../../electron/services/office/room-task-intent';
import { runningWorkflowStepIndex, taskSnapshotAfterRunRequested } from '../../src/lib/office-task-run';
import { scoreSmartMentionStructuredCompleteness } from '../../src/lib/office-mention-structured-score';
import { validateTaskRunRequest } from '../../electron/services/office/task-run-request';
import { watchAgentSessionText } from '../../electron/services/office/room-mention-gateway';
import type { GatewayManager } from '../../electron/gateway/manager';
import type { OfficeRole, OfficeTask, RoomMessage, WorkflowNode } from '../../src/types/office';

describe("__merged__:office-room-context", () => {
  function msg(partial: Partial<RoomMessage> & Pick<RoomMessage, 'id' | 'content'>): RoomMessage {
    return {
      scenarioId: 's1',
      from: 'user',
      mentions: [],
      timestamp: Date.now(),
      ...partial,
    };
  }

  describe('office-room-context', () => {
    it('truncates long running logs to header', () => {
      const body = roomMessageBodyForContext(
        msg({
          id: 'r1',
          from: 'agent',
          phase: 'task_running',
          content: '🤖 【Dev】⚙️ 执行中 · 接口开发',
          progressText: 'x'.repeat(500),
        }),
      );
      expect(body).toBe('🤖 【Dev】⚙️ 执行中 · 接口开发');
    });

    it('selects messages up to trigger id', () => {
      const history = [
        msg({ id: 'm1', content: '问题A：登录失败', timestamp: 1, from: 'user' }),
        msg({ id: 'm2', content: '我来排查', timestamp: 2, from: 'pm', fromRoleId: 'pm' }),
        msg({ id: 'm3', content: '上面这个问题', timestamp: 3, from: 'user' }),
      ];
      const selected = selectRoomContextMessages(history, { upToMessageId: 'm3' });
      expect(selected.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
    });

    it('builds transcript block for agent prompts', () => {
      const history = [
        msg({ id: 'm1', content: '问题A：登录失败', timestamp: 1, from: 'user' }),
        msg({ id: 'm2', content: '上面这个问题', timestamp: 2, from: 'user' }),
      ];
      const block = buildRoomContextBlock(history, (m) => (m.from === 'user' ? '用户' : m.from));
      expect(block).toContain('团队群聊近期记录');
      expect(block).toContain('[1] 用户: 问题A：登录失败');
      expect(block).toContain('[2] 用户: 上面这个问题');
    });

    it('selectSubstantiveRoomContextMessages skips fast ack and keeps last two lines', () => {
      const history = [
        msg({ id: 'm1', content: '成员汇报 A 已完成', timestamp: 1, from: 'dev', fromRoleId: 'dev' }),
        msg({ id: 'm2', content: 'OK，待我思考下', timestamp: 2, from: 'coord', fromRoleId: 'coord' }),
        msg({ id: 'm3', content: '收到，继续推进 B', timestamp: 3, from: 'coord', fromRoleId: 'coord' }),
        msg({ id: 'm4', content: 'OK，待我思考下', timestamp: 4, from: 'coord', fromRoleId: 'coord' }),
        msg({ id: 'm5', content: '成员汇报 C 已完成', timestamp: 5, from: 'qa', fromRoleId: 'qa' }),
      ];
      const selected = selectSubstantiveRoomContextMessages(history, {
        upToMessageId: 'm5',
        maxMessages: 2,
      });
      expect(selected.map((m) => m.id)).toEqual(['m3', 'm5']);
    });
  });
});

describe("__merged__:office-room-coordinator-delegates", () => {
  function role(id: string, name: string): OfficeRole {
    return {
      id,
      name,
      emoji: '🤖',
      agentId: id,
      skillsAllowlist: [],
      createdAt: 0,
      updatedAt: 0,
    };
  }

  describe('office-room-coordinator-delegates', () => {
    const team = [
      role('pm', 'PM'),
      role('dev', '开发'),
      role('qa', '测试'),
      role('coord', '协调者'),
    ];

    it('parses 1–3 roles mentioned by coordinator reply', () => {
      const picked = pickRolesDelegatedByCoordinator(
        '已理解。@PM @开发 请就排期与接口在群内回复。',
        team,
        'coord',
      );
      expect(picked.map((r) => r.agentId)).toEqual(['pm', 'dev']);
    });

    it('delegates @测试角色 to 测试 role', () => {
      const picked = pickRolesDelegatedByCoordinator(
        '代码已更新。请@测试角色开始测试。',
        team,
        'product',
      );
      expect(picked.map((r) => r.agentId)).toEqual(['qa']);
    });

    it('matches Chinese role name tokens like @产品', () => {
      const withProduct = [
        ...team,
        role('product', '产品'),
      ];
      const picked = pickRolesDelegatedByCoordinator(
        '@产品 请更新需求说明书，添加年终奖个税计算功能需求。',
        withProduct,
        'coord',
      );
      expect(picked.map((r) => r.agentId)).toEqual(['product']);
    });

    it('falls back to relevance scoring when coordinator did not @ anyone', () => {
      const picked = resolveReplyTargetsAfterCoordinator(
        '请大家配合推进。',
        team,
        {
          content: '@all 请开发修复登录接口',
          mentions: ['all'],
          focusTask: null,
          coordinatorRoleId: 'coord',
        },
      );
      expect(picked.length).toBeGreaterThanOrEqual(1);
      expect(picked.length).toBeLessThanOrEqual(3);
      expect(picked.some((r) => r.id === 'dev')).toBe(true);
      expect(picked.every((r) => r.id !== 'coord')).toBe(true);
    });

    it('notifyTargetsForAllMention excludes coordinator and delegated', () => {
      const delegated = [team[0]!, team[1]!];
      const notify = notifyTargetsForAllMention(team, delegated, 'coord');
      expect(notify.map((r) => r.agentId)).toEqual(['qa']);
    });
  });
});

describe("__merged__:office-room-deliver", () => {
  const role = { id: 'qa', name: '测试', emoji: '🧪', agentId: 'a1', createdAt: 0, updatedAt: 0 };
  const task = {
    id: 't1',
    scenarioId: 's1',
    title: '象棋',
    description: '',
    status: 'running' as const,
    assignedRoleIds: [],
    nodeRuns: [],
    createdAt: 0,
    updatedAt: 0,
  };
  const node = { id: 'n1', roleId: 'qa', title: '用例', execution: 'serial' as const };

  describe('office-room-deliver', () => {
    it('includes full deliverable in a single message when short', () => {
      const body = 'A'.repeat(400);
      const msgs = buildTaskDeliverRoomContents(role, task, node, body, '用法');
      expect(msgs).toHaveLength(1);
      expect(msgs[0]).toContain(body);
      expect(msgs[0]).toContain('用法说明');
    });

    it('splits long deliverables into multiple room messages', () => {
      const body = 'B'.repeat(ROOM_DELIVER_BODY_CHUNK_CHARS + 500);
      const msgs = buildTaskDeliverRoomContents(role, task, node, body, '用法');
      expect(msgs.length).toBeGreaterThan(1);
      expect(msgs[0]).toContain('（1/');
      expect(msgs.at(-1)).toContain('用法说明');
      expect(msgs.join('')).toContain('B'.repeat(200));
    });
  });
});

describe("__merged__:office-room-mention-all", () => {
  function role(id: string, name: string, extra?: Partial<OfficeRole>): OfficeRole {
    return {
      id,
      name,
      emoji: '🤖',
      agentId: id,
      skillsAllowlist: [],
      createdAt: 0,
      updatedAt: 0,
      ...extra,
    };
  }

  describe('office-room-mention-all', () => {
    const team = [
      role('pm', 'PM', { description: '产品需求与排期' }),
      role('dev', '开发', { description: '接口与后端实现' }),
      role('qa', '测试', { description: '质量与回归' }),
      role('coord', '协调者'),
    ];

    it('picks 1–3 roles most related to message text', () => {
      const { primary, notify } = selectPrimaryRolesForAllMention(team, {
        content: '@all 请开发同学优先修复登录接口 500',
        mentions: ['all'],
        focusTask: null,
      });
      expect(primary.length).toBeGreaterThanOrEqual(1);
      expect(primary.length).toBeLessThanOrEqual(3);
      expect(primary.some((r) => r.id === 'dev')).toBe(true);
      expect(notify.length + primary.length).toBe(team.length);
      expect(notify.some((r) => r.id === 'dev')).toBe(false);
    });

    it('boosts role on running workflow step', () => {
      const task: OfficeTask = {
        id: 't1',
        scenarioId: 's1',
        title: '发布',
        description: '',
        status: 'running',
        assignedRoleIds: ['qa'],
        nodeRuns: [{ nodeId: 'n1', roleId: 'qa', status: 'running' }],
        workflow: {
          mode: 'simple',
          nodes: [{ id: 'n1', roleId: 'qa', execution: 'serial', title: '回归测试' }],
          edges: [],
        },
        createdAt: 0,
        updatedAt: 0,
      };
      const { primary } = selectPrimaryRolesForAllMention(team, {
        content: '@all 当前进展如何？',
        mentions: ['all'],
        focusTask: task,
      });
      expect(primary[0]?.id).toBe('qa');
    });

    it('excludes coordinator from @all primary pool (coordinator leads separately)', () => {
      const teamWithCoord = [
        ...team,
        role('coord', '协调者'),
      ];
      const { primary, notify } = selectPrimaryRolesForAllMention(teamWithCoord, {
        content: '@all 请开发修复登录问题',
        mentions: ['all'],
        focusTask: null,
        coordinatorRoleId: 'coord',
      });
      expect(primary.every((r) => r.id !== 'coord')).toBe(true);
      expect(notify.every((r) => r.id !== 'coord')).toBe(true);
    });

    it('scores explicit @name besides @all', () => {
      const score = scoreRoleRelevanceForAllMention(team[0]!, {
        content: '@all @PM 请评审需求',
        mentions: ['all', 'pm'],
        focusTask: null,
      });
      expect(score).toBeGreaterThan(50);
    });
  });
});

describe("__merged__:office-room-mention-gateway", () => {
  describe('watchAgentSessionText', () => {
    it('ignores assistant events for other sessions or runs', () => {
      const onText = vi.fn();
      const handlers: Record<string, (data: unknown) => void> = {};
      const gateway = {
        on: (event: string, fn: (data: unknown) => void) => {
          handlers[event] = fn;
        },
        off: vi.fn(),
      } as unknown as GatewayManager;

      const targetKey = 'agent:product:office:role:product:dm:room-s1';
      watchAgentSessionText(gateway, targetKey, 'run-new', onText);

      handlers['chat:message']?.({
        message: {
          sessionKey: targetKey,
          runId: 'run-old',
          state: 'delta',
          message: { role: 'assistant', content: 'stale from old run' },
        },
      });
      expect(onText).not.toHaveBeenCalled();

      handlers['chat:message']?.({
        message: {
          sessionKey: 'agent:other:office:role:other:dm:room-s1',
          runId: 'run-new',
          state: 'delta',
          message: { role: 'assistant', content: 'wrong session' },
        },
      });
      expect(onText).not.toHaveBeenCalled();

      handlers['chat:message']?.({
        message: {
          sessionKey: targetKey,
          runId: 'run-new',
          state: 'delta',
          message: { role: 'assistant', content: 'correct line' },
        },
      });
      expect(onText).toHaveBeenCalledWith('correct line');
    });
  });
});

describe("__merged__:office-room-mention-prompt", () => {
  const role = {
    id: 'dev',
    name: '开发',
    emoji: '💻',
    agentId: 'a-dev',
    createdAt: 0,
    updatedAt: 0,
  };

  describe('office-room-mention-prompt', () => {
    it('requires in-room reply to the speaker who @mentioned', () => {
      const body = buildRoomMentionAgentPrompt({
        role,
        roomLine: '@开发 请确认接口方案',
        scenario: { name: '团队' },
        speakerLabel: '产品',
        replyQuote: { fromLabel: '产品', preview: '请确认接口方案' },
      });
      expect(body).toContain('点名人：产品');
      expect(body).toContain('【模式】Workflow');
      expect(body).toContain('【本次点名】');
      expect(body).not.toMatch(/开头\s*@/);
      expect(body).toContain('【群聊回复】');
      expect(body).toContain('摘录：请确认接口方案');
    });

    it('coordinator smart-mode prompt uses five-section JSON task prompt', () => {
      const body = buildRoomMentionAgentPrompt({
        role: { ...role, id: 'coord', name: '协调者' },
        roomLine: '@协调者 请分工',
        scenario: { name: '团队' },
        speakerLabel: '产品',
        isCoordinator: true,
        executionMode: 'smart',
        teamRoles: [
          { id: 'coord', name: '协调者' },
          { id: 'dev', name: '开发' },
        ],
        coordinatorRoleId: 'coord',
      });
      expect(body).toContain('一.【角色信息】');
      expect(body).toContain('"end"');
      expect(body).toContain('4.2 交付物规范');
      expect(body).toContain('五、强制输出格式');
      expect(body).toContain('dispatch 至少1项');
    });

    it('includes project notebook block when provided', () => {
      const body = buildRoomMentionAgentPrompt({
        role,
        roomLine: '@开发',
        scenario: { name: '团队' },
        speakerLabel: '产品',
        projectNotebookContext: '【项目进度汇报】\n任务1:编码，owner:开发',
      });
      expect(body).toContain('项目进度汇报');
      expect(body).toContain('任务1:编码');
    });

    it('coordinator @all prompt requires quote then delegate', () => {
      const body = buildRoomCoordinatorPrompt({
        coordinator: { ...role, id: 'coord', name: '协调者' },
        roomLine: '@all 请推进象棋项目',
        scenario: { name: '团队' },
        speakerLabel: '用户',
        allMention: { teammateNames: ['开发', '测试'] },
      });
      expect(body).toContain('【发起人】');
      expect(body).toContain('用户');
      expect(body).toContain('@all');
    });
  });
});

describe('__merged__:office-room-fast-ack', () => {
  describe('shouldSkipRoomMentionFastAck', () => {
    it('Smart 协调者始终跳过极速 ack', async () => {
      const { shouldSkipRoomMentionFastAck } = await import(
        '../../electron/services/office/room-fast-ack'
      );
      expect(
        shouldSkipRoomMentionFastAck({
          isCoordinator: true,
          executionMode: 'smart',
          promptVariant: 'coordinator_kickoff_decompose',
        }),
      ).toBe(true);
      expect(
        shouldSkipRoomMentionFastAck({
          isCoordinator: true,
          executionMode: 'smart',
          promptVariant: 'coordinator_member_report',
        }),
      ).toBe(true);
    });

    it('Smart 成员在 kickoff follow-up 仍应发极速 ack', async () => {
      const { shouldSkipRoomMentionFastAck } = await import(
        '../../electron/services/office/room-fast-ack'
      );
      expect(
        shouldSkipRoomMentionFastAck({
          isCoordinator: false,
          executionMode: 'smart',
          promptVariant: 'coordinator_kickoff_decompose',
        }),
      ).toBe(false);
    });
  });
});

describe("__merged__:office-room-mention-reply-policy", () => {
  describe('office-room-mention-reply-policy', () => {
    it('rejects legacy filler lines from being mirrored', () => {
      expect(isUnmirroredRoomSnippet('OK，待我思考下，稍后回复')).toBe(true);
      expect(isUnmirroredRoomSnippet('OK，待我在思考下，稍后回复')).toBe(true);
      expect(isUnmirroredRoomSnippet('OK，我在思考中，稍后回复')).toBe(true);
      expect(isUnmirroredRoomSnippet('OK,待我思考下，稍后回复')).toBe(true);
      expect(isUnmirroredRoomSnippet('好的，待我思考一下，稍后再回复')).toBe(true);
      expect(isSubstantiveRoomMentionReply('OK，待我思考下，稍后回复')).toBe(false);
      expect(isSubstantiveRoomMentionReply('OK，待我在思考下，稍后回复')).toBe(false);
      expect(isSubstantiveRoomMentionReply('OK，我在思考中，稍后回复')).toBe(false);
    });

    it('rejects placeholder and internal replies', () => {
      expect(isSubstantiveRoomMentionReply('【开发】正在群聊同步进展…')).toBe(false);
      expect(isSubstantiveRoomMentionReply('NO_REPLY')).toBe(false);
      expect(isSubstantiveRoomMentionReply('收到')).toBe(false);
      expect(
        isSubstantiveRoomMentionReply('@产品 关于接口方案，我建议先对齐字段定义，明天给出草案。'),
      ).toBe(true);
    });

    it('builds fallback that addresses the speaker', () => {
      const text = buildMandatoryMentionReplyFallback('开发', '产品', 'timeout');
      expect(text).toContain('@产品');
      expect(text).not.toMatch(/@\s*🤖/u);
      expect(text).toContain('【开发】');
      expect(text).toContain('闭环');
    });
  });
});

describe("__merged__:office-room-mentions", () => {
  function role(id: string, name: string): OfficeRole {
    return {
      id,
      name,
      emoji: '🤖',
      agentId: id,
      skillsAllowlist: [],
      createdAt: 0,
      updatedAt: 0,
    };
  }

  describe('office-room-mentions', () => {
    it('parseMentions extracts @all', () => {
      expect(parseMentions('请 @all 看一下')).toContain('all');
    });

    it('mentionsIncludeAll detects @all', () => {
      expect(mentionsIncludeAll(parseMentions('@all 开工'))).toBe(true);
      expect(mentionsIncludeAll(parseMentions('@Alice'))).toBe(false);
    });

    it('roleMatchesMentionToken matches @PM to role named PM', () => {
      const pm = role('pm', 'PM');
      expect(roleMatchesMentionToken(pm, 'pm')).toBe(true);
      expect(resolveMentionTargets(['pm'], [pm]).map((r) => r.agentId)).toEqual(['pm']);
    });

    it('roleMatchesMentionToken matches @测试角色 to role named 测试', () => {
      const qa = role('qa', '测试');
      expect(roleMatchesMentionToken(qa, '测试角色')).toBe(true);
      expect(resolveMentionTargets(['测试角色'], [qa]).map((r) => r.agentId)).toEqual(['qa']);
    });

    it('findUnresolvedMentionTokens flags unknown mentions', () => {
      const team = [role('a', 'Alice')];
      expect(findUnresolvedMentionTokens(['pm', 'alice'], team)).toEqual(['pm']);
    });

    it('roomMessageRequestsTaskRerun detects Chinese rerun intent', () => {
      expect(roomMessageRequestsTaskRerun('@PM 你带领大家重新执行下该任务')).toBe(true);
      expect(
        roomMessageRequestsTaskRerun('@all 忘记之前的工作和产出，重新开始这个任务'),
      ).toBe(true);
      expect(roomMessageRequestsTaskRerun('你好')).toBe(false);
    });

    it('pickScenarioTaskForRoom prefers running task', () => {
      const tasks: OfficeTask[] = [
        {
          id: 't1',
          scenarioId: 's1',
          title: 'A',
          description: '',
          status: 'completed',
          assignedRoleIds: [],
          nodeRuns: [],
          createdAt: 1,
          updatedAt: 2,
        },
        {
          id: 't2',
          scenarioId: 's1',
          title: 'B',
          description: '',
          status: 'running',
          assignedRoleIds: [],
          nodeRuns: [],
          createdAt: 3,
          updatedAt: 4,
        },
      ];
      expect(pickScenarioTaskForRoom(tasks, 's1')?.id).toBe('t2');
    });

    it('resolveMentionTargets expands @all to every team role', () => {
      const team = [role('a', 'Alice'), role('b', 'Bob')];
      expect(resolveMentionTargets(['all'], team).map((r) => r.agentId).sort()).toEqual(['a', 'b']);
    });

    it('resolveMentionTargets scopes to team pool only', () => {
      const team = [role('a', 'Alice')];
      const all = [role('a', 'Alice'), role('x', 'Outsider')];
      expect(resolveMentionTargets(['all'], team)).toHaveLength(1);
      expect(resolveMentionTargets(['unknown'], all)).toHaveLength(0);
    });

    it('buildRoomMentionPickerRoles includes @all entry', () => {
      const team = [{ id: 'a', name: 'Alice' }];
      const options = buildRoomMentionPickerRoles(team, '');
      expect(options[0]?.agentId).toBe(ROOM_MENTION_ALL_ID);
      expect(options).toHaveLength(2);
    });

    it('insertMentionToken inserts @all', () => {
      expect(
        insertMentionToken('hi @', 3, {
          id: ROOM_MENTION_ALL_ID,
          name: 'all',
        }),
      ).toBe('hi @all ');
    });
  });
});

describe("__merged__:office-room-message-design", () => {
  const dev = { id: 'dev', name: '开发', emoji: '💻', agentId: 'a1', createdAt: 0, updatedAt: 0 };
  const product = { id: 'product', name: '产品', emoji: '📦', agentId: 'a2', createdAt: 0, updatedAt: 0 };
  const task = {
    id: 't1',
    scenarioId: 's1',
    title: '象棋',
    description: '',
    status: 'running' as const,
    assignedRoleIds: [],
    nodeRuns: [],
    createdAt: 0,
    updatedAt: 0,
  };

  describe('office room message design', () => {
    it('mention prompt: reply speaker, sync in room, no private-only', () => {
      const body = buildRoomMentionAgentPrompt({
        role: dev,
        roomLine: '@开发 接口方案？',
        scenario: { name: '团队' },
        speakerLabel: '【产品】',
        replyQuote: { fromLabel: '【产品】', preview: '接口方案？' },
      });
      expect(body).toContain('【角色】开发');
      expect(body).toContain('【模式】Workflow');
      expect(body).toContain('【@格式】');
      expect(body).toContain('禁止');
      expect(body).toContain('【群聊回复】');
      expect(body).toContain('点名人：【产品】');
      expect(body).not.toContain('已解决');
      expect(body).toContain('本次点名');
    });

    it('mention prompt includes task progress when provided', () => {
      const progress = buildMentionProgressContextBlock({
        task,
        workflowNodes: [
          { id: 'n1', roleId: 'dev', title: '编码', execution: 'serial' },
        ],
        roomMessages: [],
        roles: [{ id: 'dev', name: '开发' }],
        viewerRoleId: 'dev',
        isCoordinator: false,
      });
      const body = buildRoomMentionAgentPrompt({
        role: dev,
        roomLine: '@开发',
        scenario: { name: '团队' },
        speakerLabel: '产品',
        taskProgressContext: progress ?? undefined,
      });
      expect(body).toContain('我的工作进度');
      expect(body).toContain('编码');
    });

    it('coordinator @all: quote speaker then delegate with in-room sync', () => {
      const body = buildRoomCoordinatorPrompt({
        coordinator: { ...dev, id: 'coord', name: '协调者' },
        roomLine: '@all 推进项目',
        scenario: { name: '团队' },
        speakerLabel: '用户',
        allMention: { teammateNames: ['开发', '测试'] },
      });
      expect(body).toContain('【发起人】用户');
      expect(body).toContain('@all');
      expect(body).toContain('【模式】Workflow');
    });

    it('handoff names next-step title per role, not generic continue', () => {
      const fromMember = { agentId: product.agentId, displayName: product.name, emoji: product.emoji };
      expect(
        buildTaskHandoffRoomContent(fromMember, task, [
          { member: { agentId: 'a-qa', displayName: '测试' }, stepTitle: '设计测试用例' },
          { member: { agentId: 'a-dev', displayName: '开发' }, stepTitle: '编码实现' },
        ]),
      ).toBe('📦 【产品】👉 请@测试 设计测试用例，请@开发 编码实现');
    });

    it('mention reply policy: placeholder vs substantive vs fallback', () => {
      expect(isSubstantiveRoomMentionReply('【开发】正在群聊同步进展…')).toBe(false);
      expect(isSubstantiveRoomMentionReply('@产品 方案可行，我先写草案。')).toBe(true);
      const fb = buildMandatoryMentionReplyFallback('开发', '产品', 'timeout');
      expect(fb).toContain('@产品');
      expect(fb).toContain('闭环');
      expect(roomReplyProgressSnippet('  进展  更新  ')).toMatch(/^群聊进展 ·/);
    });
  });
});

describe("__merged__:office-room-mirror-public", () => {
  const SAMPLE = `【理解】用户在询问需求说明书是否写完了。

  ## 💬 产品回复PM

  ### ✅ 我的理解

  @🤖 PM 关于用户询问「写完了吗？」

  ---

  ### ✅ 需求说明书V2.0初稿已完成！

  产品已创建需求说明书 \`docs/PRD.md\` (V2.0)

  ---

  ### ✅ 交付完成

  **请@PM 确认后，发起需求评审！**`;

  describe('office-room-mirror-public', () => {
    it('strips 【理解】 bracket heading and keeps deliverable sections', () => {
      const out = extractPublicRoomMirrorText(SAMPLE);
      expect(out).not.toMatch(/【理解】/);
      expect(out).toContain('需求说明书V2.0初稿已完成');
      expect(out).toContain('交付完成');
    });

    it('treats understanding-only text as intermediate', () => {
      expect(isIntermediateOnlyRoomMirrorText('【理解】用户在询问需求说明书是否写完了。')).toBe(
        true,
      );
      expect(isIntermediateOnlyRoomMirrorText(SAMPLE)).toBe(false);
    });

    it('keeps 【分工】 sections', () => {
      const text = '【理解】内部\n\n【分工】@测试 请验收 PRD。';
      expect(extractPublicRoomMirrorText(text)).toBe('【分工】\n@测试 请验收 PRD。');
    });

    it('strips Smart protocol mirror noise from member publish text', () => {
      const mirror = [
        '【群聊回复】',
        '**CUDA power算子已完成**：源码与文档已落盘。',
        '@算子leader 请验收交付',
        '【完成】',
        'true',
      ].join('\n');
      const out = finalizeCoordinatorDispatchReply(mirror);
      expect(out).not.toMatch(/【完成】/);
      expect(out).not.toContain('true');
      expect(out).toContain('请验收交付');
      expect(stripSmartProtocolMirrorNoise('【群聊回复】正文\n\n【完成】true')).toBe('正文');
    });
  });
});

describe("__merged__:office-room-sidebar", () => {
  function task(partial: Partial<OfficeTask> = {}): OfficeTask {
    return {
      id: 't1',
      scenarioId: 's1',
      title: 'T',
      featureDescription: '',
      description: '',
      status: 'pending',
      assignedRoleIds: [],
      nodeRuns: [],
      createdAt: 0,
      updatedAt: 0,
      ...partial,
    };
  }

  describe('office-room-sidebar', () => {
    it('filterRoomMessagesForTask isolates by taskId', () => {
      const msgs: RoomMessage[] = [
        { id: '1', scenarioId: 's1', taskId: 'a', from: 'user', content: 'a', mentions: [], timestamp: 1 },
        { id: '2', scenarioId: 's1', taskId: 'b', from: 'user', content: 'b', mentions: [], timestamp: 2 },
      ];
      expect(filterRoomMessagesForTask(msgs, 'a').map((m) => m.id)).toEqual(['1']);
    });

    it('roomGroupIdForProject uses parent group or project id', () => {
      expect(
        roomGroupIdForProject({ id: 'proj-1', parentGroupId: 'group-a' }),
      ).toBe('group-a');
      expect(roomGroupIdForProject({ id: 'proj-2' })).toBe('proj-2');
    });

    it('isProjectRoomActive when running or role speaking', () => {
      const roles = new Set(['r1']);
      expect(isProjectRoomActive(task({ status: 'running' }), [], roles)).toBe(true);
      const msgs: RoomMessage[] = [
        {
          id: '1',
          scenarioId: 's1',
          taskId: 't1',
          from: 'agent',
          fromRoleId: 'r1',
          content: 'working',
          mentions: [],
          timestamp: 1,
          phase: 'task_running',
        },
      ];
      expect(isProjectRoomActive(task(), msgs, roles)).toBe(true);
    });

    it('shouldAutoExpandRoomOnMessageCount', () => {
      expect(shouldAutoExpandRoomOnMessageCount(undefined, 3)).toBe(false);
      expect(shouldAutoExpandRoomOnMessageCount(3, 4)).toBe(true);
    });

    it('shouldAutoExpandRoomOnTaskStatus', () => {
      expect(shouldAutoExpandRoomOnTaskStatus('pending', 'running')).toBe(true);
      expect(shouldAutoExpandRoomOnTaskStatus(undefined, 'running')).toBe(false);
    });

    it('buildTaskExpandStateForExecutingFocus expands only the executing task', () => {
      const tasks = [
        { id: 'a', status: 'pending' as const, nodeRuns: [] },
        { id: 'b', status: 'running' as const, nodeRuns: [] },
        { id: 'c', status: 'pending' as const, nodeRuns: [] },
      ];
      expect(buildTaskExpandStateForExecutingFocus(tasks)).toEqual({
        a: false,
        b: true,
        c: false,
      });
      expect(buildTaskExpandStateForExecutingFocus([{ id: 'x', status: 'pending', nodeRuns: [] }])).toEqual(
        {},
      );
    });

    it('nextActiveRoomTaskIdOnProjectClick toggles active project', () => {
      expect(nextActiveRoomTaskIdOnProjectClick(null, 'a')).toBe('a');
      expect(nextActiveRoomTaskIdOnProjectClick('a', 'a')).toBeNull();
      expect(nextActiveRoomTaskIdOnProjectClick('a', 'b')).toBe('b');
    });

    it('shouldShowOfficeProjectRoomsPanel is always visible', () => {
      const archived = { id: 'a', lifecycle: 'dissolved' as const };
      expect(shouldShowOfficeProjectRoomsPanel([], null)).toBe(true);
      expect(shouldShowOfficeProjectRoomsPanel([{ id: 'b' }], null)).toBe(true);
      expect(shouldShowOfficeProjectRoomsPanel([], archived)).toBe(true);
      expect(shouldShowOfficeProjectRoomsPanel([{ id: 'b' }], { id: 'b', lifecycle: 'active' })).toBe(
        true,
      );
    });

    it('officeRoomSidebarListProjects returns only active projects', () => {
      const active = [{ id: 'a', lifecycle: 'active' as const }] as OfficeTask[];
      expect(officeRoomSidebarListProjects(active)).toBe(active);
    });

    it('preferredActiveRoomTaskIdOnOfficeEnter applies enter layout rules', () => {
      const pending = { id: 'a', status: 'pending' as const, nodeRuns: [] };
      const running = { id: 'b', status: 'running' as const, nodeRuns: [] };
      expect(preferredActiveRoomTaskIdOnOfficeEnter([pending])).toBe('a');
      expect(preferredActiveRoomTaskIdOnOfficeEnter([pending, running])).toBe('b');
      expect(preferredActiveRoomTaskIdOnOfficeEnter([pending, { id: 'c', status: 'pending', nodeRuns: [] }])).toBeNull();
    });

    it('preferredScenarioIdOnOfficeEnter selects single team or first running team', () => {
      // 仅一个团队 → 选中该团队
      expect(preferredScenarioIdOnOfficeEnter([{ id: 't1' }], [])).toBe('t1');
      // 多团队，仅一个团队有项目执行 → 该团队
      expect(
        preferredScenarioIdOnOfficeEnter(
          [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
          [{ id: 'a', scenarioId: 't2', status: 'running', nodeRuns: [] }],
        ),
      ).toBe('t2');
      // 多团队，多个团队都有执行 → 从左到右第一个有执行的团队
      expect(
        preferredScenarioIdOnOfficeEnter(
          [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
          [
            { id: 'a', scenarioId: 't3', status: 'running', nodeRuns: [] },
            { id: 'b', scenarioId: 't2', status: 'running', nodeRuns: [] },
          ],
        ),
      ).toBe('t2');
      // 多团队，无执行 → null（由调用方回退）
      expect(
        preferredScenarioIdOnOfficeEnter(
          [{ id: 't1' }, { id: 't2' }],
          [{ id: 'a', scenarioId: 't1', status: 'pending', nodeRuns: [] }],
        ),
      ).toBeNull();
      // 无团队 → null
      expect(preferredScenarioIdOnOfficeEnter([], [])).toBeNull();
    });

    it('officeTaskStatusLight maps task status to a light', () => {
      expect(officeTaskStatusLight({ status: 'running', nodeRuns: [] })).toBe('running');
      expect(
        officeTaskStatusLight({
          status: 'pending',
          nodeRuns: [{ nodeId: 'n', roleId: 'r', status: 'running' }],
        }),
      ).toBe('running');
      expect(officeTaskStatusLight({ status: 'completed', nodeRuns: [] })).toBe('completed');
      expect(officeTaskStatusLight({ status: 'failed', nodeRuns: [] })).toBe('failed');
      expect(officeTaskStatusLight({ status: 'pending', nodeRuns: [] })).toBe('pending');
      expect(officeTaskStatusLight({ status: 'aborted', nodeRuns: [] })).toBe('aborted');
      expect(officeTaskStatusLight({ status: 'blocked', nodeRuns: [] })).toBe('blocked');
    });

    it('isOfficeProjectCardExpanded uses expandedProjectId when provided', () => {
      expect(
        isOfficeProjectCardExpanded({
          projectId: 'a',
          expandedProjectId: 'a',
        }),
      ).toBe(true);
      expect(
        isOfficeProjectCardExpanded({
          projectId: 'b',
          expandedProjectId: 'a',
        }),
      ).toBe(false);
      expect(
        isOfficeProjectCardExpanded({
          projectId: 'a',
          expandedProjectId: 'a',
          activeRoomProjectId: null,
        }),
      ).toBe(true);
    });

    it('scheduleOfficeRoomPanelActivation ignores stale token and expanded mismatch', async () => {
      const tokenRef = { current: 0 };
      const expandedRef = { current: 'b' as string | null };
      const activate = vi.fn();

      const token = bumpOfficeRoomPanelScheduleToken(tokenRef);
      scheduleOfficeRoomPanelActivation({
        projectId: 'a',
        token,
        tokenRef,
        getExpandedProjectId: () => expandedRef.current,
        activate,
      });

      bumpOfficeRoomPanelScheduleToken(tokenRef);
      await Promise.resolve();
      expect(activate).not.toHaveBeenCalled();

      tokenRef.current = 0;
      expandedRef.current = 'a';
      const freshToken = bumpOfficeRoomPanelScheduleToken(tokenRef);
      scheduleOfficeRoomPanelActivation({
        projectId: 'a',
        token: freshToken,
        tokenRef,
        getExpandedProjectId: () => expandedRef.current,
        activate,
      });
      await Promise.resolve();
      expect(activate).toHaveBeenCalledWith('a');
    });

    it('scheduleOfficeRoomPanelDeactivation ignores stale token and re-expand', async () => {
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        queueMicrotask(() => cb(0));
        return 0;
      });

      const tokenRef = { current: 0 };
      const expandedRef = { current: null as string | null };
      const deactivate = vi.fn();

      const token = bumpOfficeRoomPanelScheduleToken(tokenRef);
      scheduleOfficeRoomPanelDeactivation({
        token,
        tokenRef,
        getExpandedProjectId: () => expandedRef.current,
        deactivate,
      });

      bumpOfficeRoomPanelScheduleToken(tokenRef);
      expandedRef.current = 'a';
      await Promise.resolve();
      expect(deactivate).not.toHaveBeenCalled();

      tokenRef.current = 0;
      expandedRef.current = null;
      const freshToken = bumpOfficeRoomPanelScheduleToken(tokenRef);
      scheduleOfficeRoomPanelDeactivation({
        token: freshToken,
        tokenRef,
        getExpandedProjectId: () => expandedRef.current,
        deactivate,
      });
      await Promise.resolve();
      expect(deactivate).toHaveBeenCalledTimes(1);

      vi.unstubAllGlobals();
    });

    it('isOfficeTaskCardExpanded follows active room', () => {
      expect(
        isOfficeTaskCardExpanded({
          taskId: 'a',
          activeRoomTaskId: 'a',
        }),
      ).toBe(true);
      expect(
        isOfficeTaskCardExpanded({
          taskId: 'b',
          activeRoomTaskId: 'a',
        }),
      ).toBe(false);
      expect(
        isOfficeTaskCardExpanded({
          taskId: 'b',
          activeRoomTaskId: null,
        }),
      ).toBe(false);
    });

    it('officeRoomPollTaskIds returns executing task ids only', () => {
      expect(officeRoomPollTaskIds(['a', 'b'])).toEqual(['a', 'b']);
      expect(officeRoomPollTaskIds([])).toEqual([]);
    });

    it('shouldPollOfficeRoomsWhileExecuting is true only with running tasks', () => {
      expect(shouldPollOfficeRoomsWhileExecuting(['a'])).toBe(true);
      expect(shouldPollOfficeRoomsWhileExecuting([])).toBe(false);
    });

    it('shouldPollOfficeRoomMessages polls only when a project is executing', () => {
      expect(
        shouldPollOfficeRoomMessages({ runningProjectIds: ['a'], draftFormOpen: false }),
      ).toBe(true);
      expect(
        shouldPollOfficeRoomMessages({ runningProjectIds: [], draftFormOpen: false }),
      ).toBe(false);
      expect(
        shouldPollOfficeRoomMessages({ runningProjectIds: ['a'], draftFormOpen: true }),
      ).toBe(false);
    });

    it('listActiveExecutingProjectIds ignores archived and non-running projects', () => {
      expect(
        listActiveExecutingProjectIds([
          { id: 'a', status: 'running', nodeRuns: [], lifecycle: 'active' },
          { id: 'b', status: 'completed', nodeRuns: [], lifecycle: 'active' },
          { id: 'c', status: 'running', nodeRuns: [], lifecycle: 'archived' },
          {
            id: 'd',
            status: 'pending',
            nodeRuns: [{ nodeId: 'n1', agentId: 'a1', status: 'running' }],
            lifecycle: 'active',
          },
        ]),
      ).toEqual(['a', 'd']);
    });

    it('officeRoomPollIntervalMs is fixed at 2s during execution polling', () => {
      expect(officeRoomPollIntervalMs()).toBe(3_000);
    });

    it('officeExecutionProgressPollIntervalMs throttles progress fallback refresh', () => {
      expect(officeExecutionProgressPollIntervalMs()).toBe(3_000);
    });
  });
});

describe("__merged__:office-room-task-resolve", () => {
  function task(
    id: string,
    title: string,
    overrides: Partial<OfficeTask> = {},
  ): OfficeTask {
    return {
      id,
      scenarioId: 's1',
      title,
      description: '',
      status: 'completed',
      assignedRoleIds: [],
      nodeRuns: [],
      createdAt: 1,
      updatedAt: 1,
      ...overrides,
    };
  }

  describe('office-room-task-resolve', () => {
    const chess = task('chess', '象棋游戏开发', { updatedAt: 10 });
    const gomoku = task('gomoku', '五子棋游戏开发', {
      status: 'running',
      updatedAt: 100,
    });

    it('extractTaskTitleHintsFromRoomContent parses quoted task names', () => {
      expect(
        extractTaskTitleHintsFromRoomContent('@PM 请重新执行任务"象棋游戏开发"'),
      ).toEqual(['象棋游戏开发']);
      expect(extractTaskTitleHintsFromRoomContent('执行「象棋游戏开发」')).toEqual(['象棋游戏开发']);
    });

    it('scoreTaskTitleMatch prefers exact title over partial overlap', () => {
      expect(scoreTaskTitleMatch('象棋游戏开发', '象棋游戏开发')).toBeGreaterThan(
        scoreTaskTitleMatch('五子棋游戏开发', '象棋游戏开发'),
      );
      expect(scoreTaskTitleMatch('五子棋游戏开发', '象棋游戏开发')).toBe(0);
    });

    it('does not match unrelated tasks on short shared suffix alone', () => {
      expect(resolveTaskFromRoomContent('重新执行「游戏」', [chess, gomoku])).toBeNull();
    });

    it('resolveTaskFromRoomContent picks named task over running task', () => {
      expect(
        resolveTaskFromRoomContent('@PM 请重新执行任务"象棋游戏开发"', [chess, gomoku])?.id,
      ).toBe('chess');
    });

    it('resolveTaskFromRoomContent matches title embedded in message without quotes', () => {
      expect(
        resolveTaskFromRoomContent('请 PM 推进象棋游戏开发的需求', [chess, gomoku])?.id,
      ).toBe('chess');
    });

    it('pickScenarioTaskForRoom uses content hint before running fallback', () => {
      expect(
        pickScenarioTaskForRoom([chess, gomoku], 's1', '@PM 请重新执行任务"象棋游戏开发"')?.id,
      ).toBe('chess');
    });

    it('pickScenarioTaskForRoom still prefers running when no title hint', () => {
      expect(
        pickScenarioTaskForRoom([chess, gomoku], 's1', '@PM 带领大家重新执行该任务')?.id,
      ).toBe('gomoku');
    });

    it('pickScenarioTaskForRoom ignores tasks from other scenarios', () => {
      const other = task('other', '象棋游戏开发', { scenarioId: 's2' });
      expect(
        pickScenarioTaskForRoom([chess, other], 's1', '请重新执行"象棋游戏开发"')?.id,
      ).toBe('chess');
    });
  });
});

describe("__merged__:office-room-unmentioned-coordinator", () => {
  describe('office-room-unmentioned-coordinator', () => {
    it('schedules watch only for no-@ lines with coordinator configured', () => {
      expect(
        shouldScheduleUnmentionedCoordinatorWatch({
          isAllMention: false,
          replyTargetCount: 0,
          mentionTokens: [],
          coordinatorRoleId: 'coord',
          from: 'agent',
          content: '本周进展：需求已定稿',
        }),
      ).toBe(true);

      expect(
        shouldScheduleUnmentionedCoordinatorWatch({
          isAllMention: false,
          replyTargetCount: 0,
          mentionTokens: [],
          coordinatorRoleId: 'coord',
          from: 'user',
          content: '用户无 @ 发言',
          executionMode: 'smart',
        }),
      ).toBe(false);

      expect(
        shouldScheduleUnmentionedCoordinatorWatch({
          isAllMention: false,
          replyTargetCount: 1,
          mentionTokens: ['pm'],
          coordinatorRoleId: 'coord',
          content: '@PM 请确认',
        }),
      ).toBe(false);

      expect(
        shouldScheduleUnmentionedCoordinatorWatch({
          isAllMention: false,
          replyTargetCount: 0,
          mentionTokens: ['pm'],
          resolvedTeamMentionCount: 1,
          coordinatorRoleId: 'coord',
          content: '@PM 请确认',
        }),
      ).toBe(false);

      expect(
        shouldScheduleUnmentionedCoordinatorWatch({
          isAllMention: true,
          replyTargetCount: 0,
          mentionTokens: ['all'],
          coordinatorRoleId: 'coord',
          content: '@all 同步',
        }),
      ).toBe(false);

      expect(
        shouldScheduleUnmentionedCoordinatorWatch({
          isAllMention: false,
          replyTargetCount: 0,
          mentionTokens: [],
          coordinatorRoleId: 'coord',
          fromRoleId: 'coord',
          content: '协调者自言自语',
        }),
      ).toBe(false);
    });

    it('coordinatorDecidedNoReply detects skip patterns', () => {
      expect(coordinatorDecidedNoReply('【判定】无需回应，属进展通报。')).toBe(true);
      expect(coordinatorDecidedNoReply('NO_REPLY')).toBe(true);
      expect(
        coordinatorDecidedNoReply('【理解】需要跟进。【分工】@产品 请更新需求说明书。'),
      ).toBe(false);
    });

    it('unmentioned prompt uses strict coordinator template', () => {
      const body = buildRoomCoordinatorUnmentionedPrompt({
        coordinator: { id: 'c', name: '协调者', agentId: 'a', createdAt: 0, updatedAt: 0 },
        roomLine: '需求已发布',
        scenario: { name: '团队' },
        speakerLabel: '用户',
        waitSeconds: 15,
        executionMode: 'smart',
        teamRoles: [
          { id: 'c', name: '协调者' },
          { id: 'dev', name: '开发' },
        ],
        coordinatorRoleId: 'c',
      });
      expect(body).toContain('3.2【本轮目标】');
      expect(body).toContain('群聊无@发言');
      expect(body).toContain('3.3 【本回合触发】');
      expect(body).toContain('需求已发布');
      expect(body).toContain('五、强制输出格式');
      expect(body).not.toContain('触发来源：');
    });
  });
});

describe("__merged__:office-mention-retry", () => {
  it('formats field-level failure reasons', () => {
    const detail = formatStructuredValidationFailureDetail([
      'input_validation_section_required',
      'missing_room_reply_section',
    ]);
    expect(detail).toContain('【输入校验】');
    expect(detail).toContain('上一跳');
    expect(detail).toContain('【群聊回复】');
  });

  it('strips long deliverable body but keeps path line for retry display', () => {
    const raw = [
      '【任务理解】写文档。',
      '【输入校验】无',
      '【输出校验】-rw-r--r-- 1 u 1 10 /tmp/out.md',
      '【交付产物】/tmp/out.md',
      'x'.repeat(800),
      '【群聊回复】@PM 请验收。',
    ].join('\n');
    const shown = sanitizePriorRawForRetryDisplay(raw);
    expect(shown).toContain('/tmp/out.md');
    expect(shown).toContain('勿粘贴全文');
    expect(shown.length).toBeLessThan(raw.length);
  });

  it('prepends member retry preamble before full agent prompt', () => {
    const base = '【Smart·成员·角色提示词】\n【任务进度】…';
    const prior = [
      '【任务理解】短。',
      '【输入校验】无',
      '【输出校验】无',
      '【交付产物】无',
      '【群聊回复】@PM 收到。',
    ].join('\n');
    const retry = buildRoomMentionRetryPrompt({
      roleName: '产品',
      priorRaw: prior,
      executionMode: 'smart',
      isCoordinator: false,
      issues: ['input_validation_section_required'],
      baseAgentPrompt: base,
    });
    expect(retry.indexOf('【产品-格式错误】')).toBe(0);
    expect(retry).toContain(`--上一轮输出：`);
    expect(retry).toContain(prior);
    expect(retry).toContain(base);
    expect(retry).toContain('不要解释，按照要求重新生成符合格式要求的输出');
    expect(retry.indexOf(base)).toBeGreaterThan(0);
  });

  it('prepends coordinator retry preamble before full agent prompt', () => {
    const base = '【Smart·协调者·角色提示词】';
    const retry = buildRoomMentionRetryPrompt({
      roleName: 'PM',
      priorRaw: '【群聊回复】无 @',
      executionMode: 'smart',
      isCoordinator: true,
      issues: ['smart_coordinator_missing_mention'],
      baseAgentPrompt: base,
    });
    expect(retry.startsWith('【PM-格式错误】')).toBe(true);
    expect(retry).toContain(
      '有新指派时，dispatch 必须包含本阶段执行者；无新指派、咨询、阻塞或结项时 dispatch 写 []',
    );
    expect(retry).toContain('--上一轮输出：');
    expect(retry).toContain(base);
    expect(retry).toContain('不要解释，按照要求重新生成符合格式要求的输出');
  });

  it('uses member missing-mention retry reason when coordinator @ is absent', () => {
    const base = '【Smart·成员·角色提示词】';
    const retry = buildRoomMentionRetryPrompt({
      roleName: '产品',
      priorRaw: '【群聊回复】已完成，请验收。',
      executionMode: 'smart',
      isCoordinator: false,
      issues: ['smart_member_missing_coordinator'],
      baseAgentPrompt: base,
    });
    expect(retry.startsWith('【产品-格式错误】')).toBe(true);
    expect(retry).toContain('dispatch 必须 @协调者汇报');
  });
});

const FULL_STRUCTURED = `【任务理解】本步为产品角色首轮任务：根据五子棋开发任务说明，产出需求文档并向协调者汇报。

【输出校验】-rw-r--r-- 1 u 1 200 /Users/demo/.openclaw/workspace-pm/office/projects/demo-task/requirements-产品.md

【交付产物】/Users/demo/.openclaw/workspace-pm/office/projects/demo-task/requirements-产品.md 关键摘要：需求说明。

【群聊回复】【需求规格说明书已完成】请 @PM 验收。`;

describe("__merged__:office-mention-structured-extract", () => {
  it('prefers thinking block when text only has 【群聊回复】', () => {
    const raw = extractStructuredReplyFromAssistantMessage({
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: '【群聊回复】请 @PM 验收并安排开发阶段。',
        },
        {
          type: 'thinking',
          thinking: FULL_STRUCTURED,
        },
      ],
    });
    expect(raw).toContain('【任务理解】');
    expect(raw).toContain('【输出校验】');
    expect(scoreSmartMentionStructuredCompleteness(raw)).toBeGreaterThan(
      scoreSmartMentionStructuredCompleteness('【群聊回复】请 @PM 验收'),
    );
  });
});

const reconcileNodes: WorkflowNode[] = [
  { id: 'n1', roleId: 'product', execution: 'serial', title: '产品' },
  { id: 'n2', roleId: 'dev', execution: 'serial', title: '开发' },
];

function reconcileTask(partial: Partial<OfficeTask> = {}): OfficeTask {
  return {
    id: 't1',
    scenarioId: 's1',
    title: 'T',
    description: '',
    status: 'running',
    assignedRoleIds: [],
    nodeRuns: [],
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

function reconcileRoom(partial: Partial<RoomMessage>): RoomMessage {
  return {
    id: 'm1',
    scenarioId: 's1',
    from: 'agent',
    content: 'x',
    mentions: [],
    timestamp: Date.now(),
    taskId: 't1',
    ...partial,
  };
}

describe('task-room-progress-reconcile', () => {
  it('rebuilds nodeRuns from phased room lines for this task only', () => {
    const updated = reconcileTaskNodeRunsFromRoom(
      reconcileTask({ executionMode: 'smart' }),
      reconcileNodes,
      [
        reconcileRoom({ nodeId: 'n1', phase: 'task_deliver', fromRoleId: 'product' }),
        reconcileRoom({ nodeId: 'n2', phase: 'task_received', fromRoleId: 'dev' }),
      ],
    );
    expect(updated.nodeRuns.find((r) => r.nodeId === 'n1')?.status).toBe('completed');
    expect(updated.nodeRuns.find((r) => r.nodeId === 'n2')?.status).toBe('running');
  });

  it('workflow mode keeps pending after upstream rework despite old deliver posts', () => {
    const updated = reconcileTaskNodeRunsFromRoom(
      reconcileTask({
        executionMode: 'workflow',
        nodeRuns: [
          {
            nodeId: 'n1',
            roleId: 'product',
            status: 'pending',
            error: '输入不合格，已回流上游',
          },
          { nodeId: 'n2', roleId: 'dev', status: 'pending' },
        ],
      }),
      reconcileNodes,
      [reconcileRoom({ nodeId: 'n1', phase: 'task_deliver', fromRoleId: 'product' })],
    );
    expect(updated.nodeRuns.find((r) => r.nodeId === 'n1')?.status).toBe('pending');
  });

  it('ignores room lines for other tasks', () => {
    const updated = reconcileTaskNodeRunsFromRoom(
      reconcileTask({ executionMode: 'smart' }),
      reconcileNodes,
      [
        reconcileRoom({ taskId: 'other', nodeId: 'n1', phase: 'task_deliver', fromRoleId: 'product' }),
      ],
    );
    expect(updated.nodeRuns.every((r) => r.status === 'pending')).toBe(true);
  });

  it('preserves in-flight nodeRuns when room not yet posted', () => {
    const updated = reconcileTaskNodeRunsFromRoom(
      reconcileTask({
        nodeRuns: [{ nodeId: 'n1', roleId: 'product', status: 'running', startedAt: 1 }],
      }),
      reconcileNodes,
      [],
    );
    expect(updated.nodeRuns.find((r) => r.nodeId === 'n1')?.status).toBe('running');
  });

  it('resets to pending when room and nodeRuns were cleared for rerun', () => {
    const updated = reconcileTaskNodeRunsFromRoom(reconcileTask({ nodeRuns: [] }), reconcileNodes, []);
    expect(updated.nodeRuns.every((r) => r.status === 'pending')).toBe(true);
  });

  it('does not attribute PM line without nodeId to every PM workflow step', () => {
    const pmNodes: WorkflowNode[] = [
      { id: 'n1', roleId: 'pm', execution: 'serial', title: '启动' },
      { id: 'n2', roleId: 'product', execution: 'serial', title: '需求' },
      { id: 'n5', roleId: 'pm', execution: 'serial', title: '总结' },
    ];
    const pmStatus = reconcileRoom({
      fromRoleId: 'pm',
      content: 'M2 需求分析 ✅ 完成，M3 开发进行中',
      phase: 'task_clarification',
    });
    expect(roomMessageAppliesToNode(pmStatus, pmNodes[0]!, pmNodes)).toBe(false);
    expect(roomMessageAppliesToNode(pmStatus, pmNodes[2]!, pmNodes)).toBe(false);

    const productDeliver = reconcileRoom({
      nodeId: 'n2',
      fromRoleId: 'product',
      content: '需求文档已完成！',
      phase: 'task_running',
    });
    const progress = resolveNodeRoomProgress([productDeliver], pmNodes[1]!, pmNodes);
    expect(progress?.phase).toBe('task_deliver');
  });

  it('does not resurrect user-aborted failed tasks from stale room running lines', () => {
    const aborted = reconcileTask({
      status: 'failed',
      nodeRuns: [
        { nodeId: 'n1', roleId: 'product', status: 'failed', error: 'Aborted', completedAt: 1 },
        { nodeId: 'n2', roleId: 'dev', status: 'failed', error: 'Cancelled', completedAt: 1 },
      ],
    });
    expect(taskLooksUserAborted(aborted)).toBe(true);
    const updated = reconcileTaskNodeRunsFromRoom(aborted, reconcileNodes, [
      reconcileRoom({ nodeId: 'n2', phase: 'task_running', fromRoleId: 'dev' }),
    ]);
    expect(updated.status).toBe('failed');
    expect(updated.nodeRuns.find((r) => r.nodeId === 'n2')?.status).toBe('failed');
  });
});
// --- merged from office-task-mention.test.ts ---

describe("__merged__:office-implicit-role-mention", () => {
  function role(id: string, name: string): OfficeRole {
    return {
      id,
      name,
      agentId: id,
      createdAt: 0,
      updatedAt: 0,
    };
  }

  describe('textImpliesRoleWithoutAt', () => {
    it('detects 需要PM支持 without @', () => {
      expect(textImpliesRoleWithoutAt('需要PM支持排期', role('pm', 'PM'))).toBe(true);
    });

    it('does not match when @ token separates 请 from role name', () => {
      const text = '请 @PM 支持排期';
      expect(textImpliesRoleWithoutAt(text, role('pm', 'PM'))).toBe(false);
    });
  });

  describe('findRolesReferencedButNotMentioned', () => {
    const team = [role('dev', '开发'), role('pm', 'PM'), role('coord', '协调者')];

    it('returns PM when prose references PM without @', () => {
      const missing = findRolesReferencedButNotMentioned(
        '这块需要PM支持确认需求边界',
        team,
        'dev',
      );
      expect(missing.map((r) => r.agentId)).toEqual(['pm']);
    });

    it('returns empty when @PM is present', () => {
      const missing = findRolesReferencedButNotMentioned(
        '请 @PM 支持确认需求边界',
        team,
        'dev',
      );
      expect(missing).toEqual([]);
    });

    it('excludes speaker role', () => {
      const missing = findRolesReferencedButNotMentioned('需要开发补充实现细节', team, 'dev');
      expect(missing).toEqual([]);
    });

    it('respects mentionedRoleIds from room message', () => {
      const text = '请确认需求边界（正文无 @ 但 mentions 已记录）';
      const missing = findRolesReferencedButNotMentioned(text, team, 'dev', {
        mentionedRoleIds: new Set(['pm']),
      });
      expect(missing).toEqual([]);
    });
  });
});

describe("__merged__:office-mention-format", () => {
  function role(id: string, name: string, emoji = '🤖'): OfficeRole {
    return { id, name, emoji, agentId: id, createdAt: 0, updatedAt: 0 };
  }

  describe('normalizeStrictAtMentionText', () => {
    const team = [role('product', '产品'), role('qa', '测试')];

    it('rewrites @🤖 产品 to @产品', () => {
      expect(normalizeStrictAtMentionText('请 @🤖 产品 确认需求', team)).toBe('请 @产品 确认需求');
    });

    it('rewrites fullwidth ＠ with emoji gap', () => {
      expect(normalizeStrictAtMentionText('＠🤖 测试 看一下', team)).toBe('@测试 看一下');
    });
  });

  describe('roomMessageMentionSpeakerRef', () => {
    it('returns role name only without emoji', () => {
      const msg: RoomMessage = {
        id: 'm1',
        scenarioId: 's1',
        from: 'agent-product',
        fromRoleId: 'product',
        content: 'hello',
        mentions: [],
        timestamp: 1,
      };
      expect(roomMessageMentionSpeakerRef(msg, [role('product', '产品')])).toBe('产品');
      expect(roomMessageSpeakerLabel(msg, [role('product', '产品')])).toBe('产品');
    });
  });
});

describe("__merged__:office-mention-progress-context", () => {
  const nodes: WorkflowNode[] = [
    { id: 'n1', roleId: 'product', title: '需求初稿', execution: 'serial' },
    { id: 'n2', roleId: 'dev', title: '编码实现', execution: 'serial' },
  ];

  const task: OfficeTask = {
    id: 't1',
    scenarioId: 's1',
    title: '象棋',
    description: '',
    status: 'running',
    assignedRoleIds: [],
    nodeRuns: [
      { nodeId: 'n1', roleId: 'product', status: 'completed' },
      { nodeId: 'n2', roleId: 'dev', status: 'running' },
    ],
    createdAt: 0,
    updatedAt: 0,
  };

  const roomMessages: RoomMessage[] = [
    {
      id: 'm1',
      scenarioId: 's1',
      from: 'a2',
      fromRoleId: 'product',
      content: '【产品】交付 PRD',
      mentions: [],
      timestamp: 1,
      taskId: 't1',
      nodeId: 'n1',
      phase: 'task_deliver',
    },
    {
      id: 'm2',
      scenarioId: 's1',
      from: 'a3',
      fromRoleId: 'dev',
      content: '【开发】执行中',
      mentions: [],
      timestamp: 2,
      taskId: 't1',
      nodeId: 'n2',
      phase: 'task_running',
      progressText: '实现模块 A',
    },
  ];

  describe('office-mention-progress-context', () => {
    it('non-coordinator sees only own steps', () => {
      const block = buildMentionProgressContextBlock({
        task,
        workflowNodes: nodes,
        roomMessages,
        roles: [
          { id: 'product', name: '产品' },
          { id: 'dev', name: '开发' },
        ],
        viewerRoleId: 'dev',
        isCoordinator: false,
      });
      expect(block).toContain('我的工作进度');
      expect(block).toContain('编码实现');
      expect(block).not.toContain('【产品】');
    });

    it('coordinator sees all roles progress', () => {
      const block = buildMentionProgressContextBlock({
        task,
        workflowNodes: nodes,
        roomMessages,
        roles: [
          { id: 'product', name: '产品' },
          { id: 'dev', name: '开发' },
        ],
        viewerRoleId: 'coord',
        isCoordinator: true,
      });
      expect(block).toContain('各角色工作进度');
      expect(block).toContain('【产品】');
      expect(block).toContain('需求初稿');
      expect(block).toContain('【开发】');
      expect(block).toContain('编码实现');
    });

    it('shows dependency block when upstream step is incomplete', () => {
      const blockedTask: OfficeTask = {
        ...task,
        nodeRuns: [
          { nodeId: 'n1', roleId: 'product', status: 'pending' },
          { nodeId: 'n2', roleId: 'dev', status: 'pending' },
        ],
      };
      const block = buildMentionProgressContextBlock({
        task: blockedTask,
        workflowNodes: nodes,
        workflowEdges: [{ from: 'n1', to: 'n2', when: 'on_success' }],
        roomMessages: [],
        roles: [
          { id: 'product', name: '产品' },
          { id: 'dev', name: '开发' },
        ],
        viewerRoleId: 'dev',
        isCoordinator: false,
      });
      expect(block).toContain('前置依赖未完成');
      expect(block).toContain('需求初稿');
      expect(block).toContain('不可开展');
    });

    it('mention trigger cites speaker and quote', () => {
      const block = buildMentionTriggerBlock('产品', '@开发 看下方案', {
        fromLabel: '产品',
        preview: '看下方案',
      });
      expect(block).toContain('点名人：产品');
      expect(block).toContain('@开发');
      expect(block).toContain('摘录：看下方案');
    });
  });
});

describe("__merged__:office-mention-task-sync", () => {
  const nodes: WorkflowNode[] = [
    { id: 'n-pm', roleId: 'product', execution: 'serial', title: '产品需求' },
    { id: 'n-dev', roleId: 'dev', execution: 'serial', title: '开发实施' },
  ];

  function task(partial: Partial<OfficeTask> = {}): OfficeTask {
    return {
      id: 't1',
      scenarioId: 's1',
      title: '年终奖',
      description: '',
      status: 'pending',
      assignedRoleIds: [],
      nodeRuns: [],
      createdAt: 0,
      updatedAt: 0,
      ...partial,
    };
  }

  describe('office-mention-task-sync', () => {
    it('infers deliver phase from product revision reply', () => {
      const content = '接受，产品已立即补充年终奖所得税功能。需求已补充完整，请 @软件开发 实施';
      expect(inferPhaseFromRoleReplyContent(content)).toBe('task_deliver');
    });

    it('Smart mode maps member acceptance 验收通过 to task_team_review not project_closure', () => {
      expect(
        inferPhaseFromRoleReplyContent('✅ 港股分析报告验收通过！', 'smart'),
      ).toBe('task_team_review');
      expect(
        inferPhaseFromRoleReplyContent('全部子任务已结项，感谢各位。\n\n【结项】', 'smart'),
      ).toBe('project_closure');
    });

    it('reconciles product completed and dev running from phased room lines', () => {
      const roomLines: RoomMessage[] = [
        {
          id: 'm1',
          scenarioId: 's1',
          from: 'agent',
          fromRoleId: 'product',
          content: '需求已修订（含年终奖）✅',
          mentions: [],
          timestamp: Date.now(),
          taskId: 't1',
          nodeId: 'n-pm',
          phase: 'task_deliver',
        },
        {
          id: 'm2',
          scenarioId: 's1',
          from: 'agent',
          fromRoleId: 'dev',
          content: '收到需求，开始开发',
          mentions: [],
          timestamp: Date.now(),
          taskId: 't1',
          nodeId: 'n-dev',
          phase: 'task_received',
        },
      ];
      const updated = reconcileTaskNodeRunsFromRoom(
        task({ executionMode: 'smart' }),
        nodes,
        roomLines,
      );
      expect(updated.nodeRuns.find((r) => r.nodeId === 'n-pm')?.status).toBe('completed');
      expect(updated.nodeRuns.find((r) => r.nodeId === 'n-dev')?.status).toBe('running');
      expect(updated.status).toBe('running');
    });
  });
});

describe("__merged__:office-mention", () => {
  describe('office-mention', () => {
    it('detects active mention at cursor', () => {
      expect(getActiveMention('hello @dev', 10)).toEqual({ start: 6, query: 'dev' });
      expect(getActiveMention('hello@dev', 9)).toBeNull();
      expect(getActiveMention('a @b c', 6)).toBeNull();
    });

    it('detects second @ mention in the same message', () => {
      expect(getActiveMention('@PM 请协助 @设', 10)).toEqual({ start: 8, query: '设' });
      expect(getActiveMention('@PM 请 @', 7)).toEqual({ start: 6, query: '' });
      expect(getActiveMention('@PM@', 4)).toEqual({ start: 3, query: '' });
    });

    it('filters roles by id or name', () => {
      const roles = [
        { agentId: 'writer', displayName: 'Writer' },
        { agentId: 'reviewer', displayName: 'Reviewer' },
      ];
      expect(filterMentionRoles(roles, 'writ').map((r) => r.agentId)).toEqual(['writer']);
      expect(filterMentionRoles(roles, '')).toHaveLength(2);
    });

    it('inserts mention token using role display name', () => {
      expect(insertMentionToken('hi @wr', 3, { id: 'writer', name: 'Writer' })).toBe('hi @Writer ');
      expect(insertMentionToken('hi @', 3, { id: 'pm', name: 'PM' })).toBe('hi @PM ');
    });
  });
});

describe("__merged__:office-missing-mention-audit", () => {
  function role(id: string, name: string): OfficeRole {
    return { id, name, agentId: id, createdAt: 0, updatedAt: 0 };
  }

  const CLARIFICATION = `🤖 【开发】❓ 协作询问 · 需求评审
  @产品 请确认初稿是否为最新版本？是否有需特别说明的边界场景或未明确需求？
  @测试 请同步确认是否需要提前明确测试数据范围或自动化测试可行性要求？
  @产品 @测试 初稿中专项附加扣除部分未列完（"###"处截断），是否后续还有内容？请补充完整版。`;

  describe('missing-mention audit (dev @产品 @测试)', () => {
    const team = [
      role('dev', '开发'),
      role('product', '产品'),
      role('qa', '测试'),
      role('pm', 'PM'),
    ];

    it('parseMentions finds 产品 and 测试', () => {
      const tokens = parseMentions(CLARIFICATION);
      expect(tokens).toContain('产品');
      expect(tokens).toContain('测试');
      const targets = resolveMentionTargets(tokens, team);
      expect(targets.map((r) => r.agentId).sort()).toEqual(['product', 'qa']);
    });

    it('does not flag 产品/测试 when @ tokens present', () => {
      const missing = findMissingMentionTargets(CLARIFICATION, team, 'dev');
      expect(missing.map((r) => r.name)).toEqual([]);
    });

    it('does not flag when product role is named PM but agent wrote @产品', () => {
      const teamPm = [role('dev', '开发'), role('product', 'PM'), role('qa', '测试')];
      const missing = findMissingMentionTargets(CLARIFICATION, teamPm, 'dev');
      expect(missing.map((r) => r.name)).toEqual([]);
    });

    it('flags PM when prose says 需要PM支持 without @', () => {
      const teamPm = [role('dev', '开发'), role('product', 'PM'), role('qa', '测试')];
      const missing = findMissingMentionTargets('需要PM支持确认需求边界', teamPm, 'dev');
      expect(missing.map((r) => r.agentId)).toEqual(['product']);
    });

    it('does not flag 【产品】 bracket style when @ is absent but brackets used', () => {
      const bracketStyle = `🤖 【开发】❓ 协作询问 · 需求评审
  【产品】请确认初稿是否为最新版本？
  【测试】请同步确认测试数据范围？`;
      const missing = findMissingMentionTargets(bracketStyle, team, 'dev');
      expect(missing.map((r) => r.name)).toEqual([]);
    });

    it('does not flag when message.mentions already lists product', () => {
      const missing = findMissingMentionTargets(
        '请确认需求边界（正文无 @）',
        team,
        'dev',
        ['product'],
      );
      expect(missing).toEqual([]);
    });

    it('does not flag fullwidth ＠产品', () => {
      const text = `🤖 【开发】❓ 协作询问 · 需求评审
  ＠产品 请确认初稿是否为最新版本？`;
      const missing = findMissingMentionTargets(text, team, 'dev');
      expect(missing).toEqual([]);
    });
  });
});

describe("__merged__:office-run-completion", () => {
  describe('office run-completion', () => {
    it('shouldArmSessionReplyTimeout treats 0 as unlimited wait', () => {
      expect(shouldArmSessionReplyTimeout(0)).toBe(false);
      expect(shouldArmSessionReplyTimeout(60_000)).toBe(true);
    });

    it('normalizes second and millisecond timestamps', () => {
      expect(normalizeOfficeTimestampMs(1_715_000_000)).toBe(1_715_000_000_000);
      expect(normalizeOfficeTimestampMs(1_715_000_000_000)).toBe(1_715_000_000_000);
    });

    it('finds assistant reply after start when history uses second timestamps', () => {
      const startedAt = 1_715_000_100_000;
      const messages = [
        { role: 'user', content: 'go', timestamp: 1_715_000_000 },
        { role: 'assistant', content: 'done', timestamp: 1_715_000_105 },
      ];
      expect(findLatestAssistantAfter(messages, startedAt)).toBe('done');
    });

    it('ignores assistant messages before the workflow step started', () => {
      const startedAt = 1_715_000_200_000;
      const messages = [
        { role: 'assistant', content: 'old', timestamp: 1_715_000_100 },
      ];
      expect(findLatestAssistantAfter(messages, startedAt)).toBeNull();
    });

    it('parses nested gateway chat envelope', () => {
      const parsed = parseGatewayChatEnvelope({
        message: {
          sessionKey: 'agent:main:office:task:1:role:pm:node:n1',
          state: 'final',
          runId: 'run-1',
          message: { role: 'assistant', content: 'Plan ready' },
        },
      });
      expect(parsed.sessionKey).toContain('office:task');
      expect(parsed.state).toBe('final');
      expect(extractTextFromOfficeMessage(parsed.message!)).toBe('Plan ready');
    });

    it('ignores lone undated assistant without a preceding user turn', () => {
      const startedAt = Date.now();
      const messages = [{ role: 'assistant', content: 'reply without clock' }];
      expect(findLatestAssistantAfter(messages, startedAt)).toBeNull();
      expect(
        findLatestAssistantAfter(messages, startedAt, { allowUndatedFallback: true }),
      ).toBeNull();
    });

    it('prefers undated assistant after the latest user turn', () => {
      const startedAt = Date.now();
      const messages = [
        { role: 'assistant', content: 'stale reply' },
        { role: 'user', content: 'run task now' },
        { role: 'assistant', content: '【任务理解】收到' },
      ];
      expect(findAssistantAfterCurrentUserTurn(messages, startedAt)).toBe('【任务理解】收到');
      expect(findLatestAssistantAfter(messages, startedAt, { allowUndatedFallback: true })).toBe(
        '【任务理解】收到',
      );
    });

    it('extracts deliverable status tail from thinking when needed', () => {
      const thinking =
        "The message is already in the group chat. I've provided the software download information in Chinese. Let me wait for user feedback.\n\n✅ 已提供软件下载方式，等待用户反馈。";
      expect(extractPublicReplyFromThinking(thinking)).toBe('✅ 已提供软件下载方式，等待用户反馈。');
      expect(
        extractTextFromOfficeMessage({
          role: 'assistant',
          content: [{ type: 'thinking', thinking }],
        }),
      ).toBe('✅ 已提供软件下载方式，等待用户反馈。');
    });

    it('collects only final reply not intermediate narration', () => {
      const startedAt = 1_715_000_100_000;
      const messages = [
        { role: 'user', content: 'go', timestamp: 1_715_000_101 },
        { role: 'assistant', content: '先核对下载链接。', timestamp: 1_715_000_102 },
        {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'Checking links…' }],
          timestamp: 1_715_000_103,
        },
        { role: 'assistant', content: '✅ 已提供软件下载方式。', timestamp: 1_715_000_104 },
      ];
      expect(collectAssistantRoomMirrorText(messages, startedAt)).toBe('✅ 已提供软件下载方式。');
    });

    it('does not mirror English-only thinking process', () => {
      expect(
        extractRoomMirrorTextFromAssistantMessage({
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'Compare approaches before answering.' }],
        }),
      ).toBe('');
    });

    it('prefers text blocks over thinking when both exist', () => {
      expect(
        extractTextFromOfficeMessage({
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'internal reasoning only' },
            { type: 'text', text: '@产品 方案已更新，请验收。' },
          ],
        }),
      ).toBe('@产品 方案已更新，请验收。');
    });

    it('skips internal NO_REPLY assistant text', () => {
      const startedAt = Date.now() - 5_000;
      const messages = [{ role: 'assistant', content: 'NO_REPLY', timestamp: Date.now() }];
      expect(findLatestAssistantAfter(messages, startedAt)).toBeNull();
    });
  });
});

describe("__merged__:office-task-card-summary", () => {
  const t = ((key: string, opts?: Record<string, unknown>) => {
    if (key === 'taskStatus.running') return '运行中';
    if (key === 'taskStatus.aborted') return '已中止';
    if (key === 'taskStatus.completed') return '已完成';
    if (key === 'taskStepsRunning') {
      return `运行中 ${opts?.current}/${opts?.total}`;
    }
    return key;
  }) as Parameters<typeof formatOfficeTaskCardStatusSummary>[0];

  describe('office-task-card-summary', () => {
    it('formats step progress when running', () => {
      const task: OfficeTask = {
        id: 't1',
        scenarioId: 's1',
        title: 'Demo',
        status: 'running',
        assignedRoleIds: [],
        nodeRuns: [{ nodeId: 'n1', roleId: 'r1', status: 'running' }],
        createdAt: 0,
        updatedAt: 0,
      };
      const nodes = [{ id: 'n1', roleId: 'r1', title: 'Step 1' }];
      const sync = deriveTaskProgressSync(task, nodes, []);
      const text = formatOfficeTaskCardStatusSummary(t, task, nodes, sync);
      expect(text).toBe('运行中 1/1');
    });

    it('terminal status only — no step fraction', () => {
      const task: OfficeTask = {
        id: 't2',
        scenarioId: 's1',
        title: 'Demo',
        status: 'aborted',
        assignedRoleIds: [],
        nodeRuns: [
          { nodeId: 'n1', roleId: 'r1', status: 'completed' },
          { nodeId: 'n2', roleId: 'r2', status: 'pending' },
        ],
        createdAt: 0,
        updatedAt: 0,
      };
      const nodes = [
        { id: 'n1', roleId: 'r1', title: 'Step 1' },
        { id: 'n2', roleId: 'r2', title: 'Step 2' },
      ];
      const sync = deriveTaskProgressSync(task, nodes, []);
      expect(formatOfficeTaskCardStatusSummary(t, task, nodes, sync)).toBe('已中止');
    });
  });
});

describe("__merged__:office-task-coordinator", () => {
  describe('resolveTaskCoordinatorRoleId', () => {
    it('always prefers scenario-level coordinator', () => {
      expect(
        resolveTaskCoordinatorRoleId(
          { coordinatorRoleId: 'dev' },
          { coordinatorRoleId: 'pm', roleIds: ['pm', 'dev', 'qa'] },
        ),
      ).toBe('pm');
    });

    it('falls back to scenario coordinator', () => {
      expect(
        resolveTaskCoordinatorRoleId(
          {},
          { coordinatorRoleId: 'pm', roleIds: ['pm', 'dev'] },
        ),
      ).toBe('pm');
    });
  });
});

describe("__merged__:office-task-execution-mode", () => {
  function task(partial: Partial<OfficeTask> = {}): OfficeTask {
    return {
      id: 't1',
      scenarioId: 's1',
      title: '象棋应用',
      featureDescription: 'feature',
      description: 'desc',
      status: 'pending',
      assignedRoleIds: [],
      nodeRuns: [],
      createdAt: 0,
      updatedAt: 0,
      ...partial,
    };
  }

  describe('office task execution mode', () => {
    it('defaults to workflow when unset', () => {
      expect(taskExecutionMode(task())).toBe('workflow');
      expect(isWorkflowTask(task())).toBe(true);
    });

    it('detects smart mode', () => {
      expect(taskExecutionMode(task({ executionMode: 'smart' }))).toBe('smart');
      expect(isSmartTask(task({ executionMode: 'smart' }))).toBe(true);
    });

    it('room mention initial timeout is unlimited for smart tasks', () => {
      expect(roomMentionInitialReplyTimeoutMs(task({ executionMode: 'smart' }))).toBe(0);
      expect(roomMentionInitialReplyTimeoutMs(task())).toBe(60_000);
      expect(roomMentionInitialReplyTimeoutMs(null)).toBe(60_000);
    });

    it('createTaskDraft sets empty workflow for smart', () => {
      const draft = createTaskDraft({
        scenarioId: 's1',
        title: 'T',
        description: '',
        assignedRoleIds: ['r1'],
        executionMode: 'smart',
      });
      expect(draft.executionMode).toBe('smart');
      expect(draft.workflow?.nodes).toEqual([]);
    });

    it('validateTaskRunRequest rejects single-step for smart', () => {
      expect(validateTaskRunRequest(task({ executionMode: 'smart' }), 'single', 'n1')).toBe(
        'taskRun.smartNoSingleStep',
      );
    });

    it('validateTaskRunRequest allows fresh smart run', () => {
      expect(validateTaskRunRequest(task({ executionMode: 'smart' }), 'fresh')).toBeNull();
    });

    it('validateTaskRunRequest requires nodeRuns for workflow continue', () => {
      expect(validateTaskRunRequest(task(), 'continue')).toBe('taskRun.noPriorProgress');
    });

    it('validateTaskRunRequest rejects workflow continue without partial completion', () => {
      const nodes = [
        { id: 'n1', roleId: 'a', execution: 'serial' as const },
        { id: 'n2', roleId: 'b', execution: 'serial' as const },
      ];
      expect(
        validateTaskRunRequest(
          task({
            workflow: { mode: 'simple', nodes },
            nodeRuns: [
              { nodeId: 'n1', roleId: 'a', status: 'failed' },
              { nodeId: 'n2', roleId: 'b', status: 'failed' },
            ],
          }),
          'continue',
        ),
      ).toBe('taskRun.cannotContinue');
      expect(
        validateTaskRunRequest(
          task({
            workflow: { mode: 'simple', nodes },
            nodeRuns: nodes.map((n) => ({
              nodeId: n.id,
              roleId: n.roleId,
              status: 'completed' as const,
            })),
          }),
          'continue',
        ),
      ).toBe('taskRun.cannotContinue');
    });

    it('validateTaskRunRequest allows workflow continue with partial completion', () => {
      const nodes = [
        { id: 'n1', roleId: 'a', execution: 'serial' as const },
        { id: 'n2', roleId: 'b', execution: 'serial' as const },
      ];
      expect(
        validateTaskRunRequest(
          task({
            status: 'aborted',
            workflow: { mode: 'simple', nodes },
            nodeRuns: [
              { nodeId: 'n1', roleId: 'a', status: 'completed' },
              { nodeId: 'n2', roleId: 'b', status: 'failed' },
            ],
          }),
          'continue',
        ),
      ).toBeNull();
    });

    it('validateTaskRunRequest allows continue for inheriting spawn with group workflow nodes', () => {
      const nodes = [
        { id: 'n1', agentId: 'a', label: 'step-1' },
        { id: 'n2', agentId: 'b', label: 'step-2' },
      ];
      expect(
        validateTaskRunRequest(
          task({
            status: 'aborted',
            origin: 'fixed_group',
            parentGroupId: 'group-1',
            agentIds: ['a', 'b'],
            inheritsGroupTemplate: true,
            workflow: { mode: 'dag', nodes: [], edges: [] },
            nodeRuns: [
              { nodeId: 'n1', agentId: 'a', status: 'completed' },
              { nodeId: 'n2', agentId: 'b', status: 'failed' },
            ],
          }),
          'continue',
          undefined,
          {
            id: 'group-1',
            workflow: { mode: 'dag', nodes, edges: [] },
          } as never,
        ),
      ).toBeNull();
    });
  });
});

describe("__merged__:office-task-order", () => {
  function task(id: string, sequence?: number, title = '任务'): OfficeTask {
    return {
      id,
      scenarioId: 's1',
      sequence,
      title,
      description: '',
      status: 'pending',
      assignedRoleIds: [],
      nodeRuns: [],
      createdAt: Number(id.replace(/\D/g, '') || 0),
      updatedAt: 0,
    };
  }

  describe('office-task-order', () => {
    it('sorts by sequence ascending', () => {
      const sorted = sortOfficeTasksBySequence([
        task('t3', 3),
        task('t1', 1),
        task('t2', 2),
      ]);
      expect(sorted.map((t) => t.id)).toEqual(['t1', 't2', 't3']);
    });

    it('formats list title with runner mode (no sequence prefix)', () => {
      expect(formatOfficeTaskListTitle(task('t1', 2, '象棋开发'))).toBe('象棋开发(DAG)');
      expect(formatOfficeTaskListTitle(task('t1', 2, '2. 已有编号'))).toBe('2. 已有编号(DAG)');
      expect(
        formatOfficeTaskListTitle({
          ...task('t3', undefined, '协调项目'),
          executionMode: 'smart',
        }),
      ).toBe('协调项目(Smart)');
    });

    (process.env.VITE_ENABLE_LANGGRAPH === 'true' ? it : it.skip)(
      'formats list title with LangGraph runner mode',
      () => {
        expect(
          formatOfficeTaskListTitle({
            ...task('t2', undefined, '五子棋游戏开发2'),
            workflowEngine: 'langgraph',
          }),
        ).toBe('五子棋游戏开发2(LangGraph)');
      },
    );

    it('compare puts unnumbered tasks after numbered', () => {
      expect(compareOfficeTasksBySequence(task('a', 1), task('b'))).toBeLessThan(0);
    });
  });
});

describe("__merged__:office-task-progress-sync", () => {
  const nodes: WorkflowNode[] = [
    { id: 'n1', roleId: 'a', execution: 'serial', title: 'Step 1' },
    { id: 'n2', roleId: 'b', execution: 'serial', title: 'Step 2' },
  ];

  function task(partial: Partial<OfficeTask>): OfficeTask {
    return {
      id: 't1',
      scenarioId: 's1',
      title: 'T',
      description: '',
      status: 'pending',
      assignedRoleIds: [],
      nodeRuns: [],
      createdAt: 0,
      updatedAt: 0,
      ...partial,
    };
  }

  function room(partial: Partial<RoomMessage>): RoomMessage {
    return {
      id: 'm1',
      scenarioId: 's1',
      from: 'agent',
      content: 'x',
      mentions: [],
      timestamp: Date.now(),
      taskId: 't1',
      ...partial,
    };
  }

  describe('deriveTaskProgressSync', () => {
    it('marks step completed when room shows handoff', () => {
      const t = task({
        executionMode: 'smart',
        status: 'running',
        nodeRuns: [{ nodeId: 'n1', roleId: 'a', status: 'running' }],
      });
      const sync = deriveTaskProgressSync(t, nodes, [
        room({ nodeId: 'n1', phase: 'task_handoff', content: 'handoff' }),
      ]);
      expect(sync.steps[0]?.status).toBe('completed');
      expect(sync.currentStep).toBe(2);
    });

    it('uses task_running phase while node run still pending in store', () => {
      const t = task({
        executionMode: 'smart',
        status: 'running',
        nodeRuns: [{ nodeId: 'n1', roleId: 'a', status: 'pending' }],
      });
      const sync = deriveTaskProgressSync(t, nodes, [
        room({
          nodeId: 'n1',
          phase: 'task_running',
          progressText: '正在生成方案…',
          content: 'run',
        }),
      ]);
      expect(sync.steps[0]?.status).toBe('running');
      expect(sync.steps[0]?.phase).toBe('task_running');
      expect(sync.runningLog).toContain('正在生成方案');
      expect(sync.currentStep).toBe(1);
    });

    it('shows running when nodeRun is running but room not yet posted', () => {
      const t = task({
        status: 'running',
        nodeRuns: [{ nodeId: 'n1', roleId: 'a', status: 'running' }],
      });
      const sync = deriveTaskProgressSync(t, nodes, []);
      expect(sync.steps[0]?.status).toBe('running');
      expect(sync.steps[0]?.phase).toBe('task_running');
      expect(sync.steps[0]?.progressSnippet).toBe('启动中…');
    });

    it('syncs step when nodeRuns reconciled from room deliver phase', () => {
      const t = task({
        status: 'running',
        nodeRuns: [{ nodeId: 'n1', roleId: 'a', status: 'completed' }],
      });
      const sync = deriveTaskProgressSync(t, nodes, [
        room({ nodeId: 'n1', phase: 'task_deliver', fromRoleId: 'a' }),
      ]);
      expect(sync.steps[0]?.status).toBe('completed');
    });

    it('counts completed steps from room deliver on first node', () => {
      const t = task({ executionMode: 'smart', status: 'running', nodeRuns: [] });
      const sync = deriveTaskProgressSync(t, nodes, [
        room({ nodeId: 'n1', phase: 'task_deliver', content: 'done' }),
        room({ nodeId: 'n2', phase: 'task_received', content: 'recv' }),
      ]);
      expect(sync.completedSteps).toBe(1);
      expect(sync.steps[1]?.phase).toBe('task_received');
      expect(sync.currentStep).toBe(2);
    });

    it('shows first failed step as current while workflow continue is running', () => {
      const workflowNodes: WorkflowNode[] = [
        { id: 'n1', roleId: 'a', execution: 'serial' },
        { id: 'n2', roleId: 'b', execution: 'serial' },
        { id: 'n3', roleId: 'c', execution: 'serial' },
        { id: 'n4', roleId: 'd', execution: 'serial' },
        { id: 'n5', roleId: 'e', execution: 'serial' },
      ];
      const t = task({
        executionMode: 'workflow',
        status: 'running',
        workflow: { mode: 'simple', nodes: workflowNodes },
        nodeRuns: [
          { nodeId: 'n1', roleId: 'a', status: 'completed' },
          { nodeId: 'n2', roleId: 'b', status: 'failed', error: 'aborted' },
          { nodeId: 'n3', roleId: 'c', status: 'failed', error: 'aborted' },
          { nodeId: 'n4', roleId: 'd', status: 'failed', error: 'aborted' },
          { nodeId: 'n5', roleId: 'e', status: 'failed', error: 'aborted' },
        ],
      });
      const sync = deriveTaskProgressSync(t, workflowNodes, []);
      expect(sync.currentStep).toBe(2);
    });
  });
});

describe("__merged__:office-task-run", () => {
  const nodes: WorkflowNode[] = [
    { id: 'n1', roleId: 'a', execution: 'serial' },
    { id: 'n2', roleId: 'b', execution: 'serial' },
    { id: 'n3', roleId: 'c', execution: 'serial' },
    { id: 'n4', roleId: 'd', execution: 'serial' },
  ];

  function task(partial: Partial<OfficeTask>): OfficeTask {
    return {
      id: 't1',
      scenarioId: 's1',
      title: 'T',
      description: '',
      status: 'pending',
      assignedRoleIds: [],
      nodeRuns: [],
      createdAt: 0,
      updatedAt: 0,
      ...partial,
    };
  }

  describe('runningWorkflowStepIndex', () => {
    it('returns 1-based index of the running node', () => {
      const t = task({
        status: 'running',
        nodeRuns: [
          { nodeId: 'n1', roleId: 'a', status: 'completed' },
          { nodeId: 'n2', roleId: 'b', status: 'completed' },
          { nodeId: 'n3', roleId: 'c', status: 'running' },
          { nodeId: 'n4', roleId: 'd', status: 'pending' },
        ],
      });
      expect(runningWorkflowStepIndex(t, nodes)).toBe(3);
    });

    it('returns null when task is not active', () => {
      const t = task({
        status: 'completed',
        nodeRuns: nodes.map((n) => ({ nodeId: n.id, roleId: n.roleId, status: 'completed' as const })),
      });
      expect(runningWorkflowStepIndex(t, nodes)).toBeNull();
    });
  });

  describe('taskSnapshotAfterRunRequested', () => {
    it('marks fresh workflow rerun as running with pending node runs', () => {
      const completed = task({
        status: 'completed',
        workflow: { mode: 'simple', nodes },
        nodeRuns: nodes.map((n) => ({
          nodeId: n.id,
          roleId: n.roleId,
          status: 'completed' as const,
        })),
      });
      const next = taskSnapshotAfterRunRequested(completed, {
        mode: 'fresh',
        clearProjectRoom: true,
      });
      expect(next.status).toBe('running');
      expect(next.nodeRuns).toHaveLength(4);
      expect(next.nodeRuns.every((r) => r.status === 'pending')).toBe(true);
    });

    it('reopens failed steps on continue optimistic snapshot', () => {
      const aborted = task({
        status: 'aborted',
        workflow: { mode: 'simple', nodes },
        nodeRuns: [
          { nodeId: 'n1', roleId: 'a', status: 'completed' },
          { nodeId: 'n2', roleId: 'b', status: 'failed', error: 'aborted' },
          { nodeId: 'n3', roleId: 'c', status: 'failed', error: 'aborted' },
          { nodeId: 'n4', roleId: 'd', status: 'failed', error: 'aborted' },
        ],
      });
      const next = taskSnapshotAfterRunRequested(aborted, { mode: 'continue' });
      expect(next.status).toBe('running');
      expect(next.nodeRuns.find((r) => r.nodeId === 'n1')?.status).toBe('completed');
      expect(next.nodeRuns.find((r) => r.nodeId === 'n2')?.status).toBe('pending');
      expect(next.nodeRuns.find((r) => r.nodeId === 'n2')?.error).toBeUndefined();
    });
  });
});

describe('office-unsaved-draft', () => {
  it('isShallowRecordDirty detects JSON-serializable changes', () => {
    expect(isShallowRecordDirty({ a: 1 }, { a: 1 })).toBe(false);
    expect(isShallowRecordDirty({ a: 2 }, { a: 1 })).toBe(true);
  });

  it('requestCloseOfficeDraft skips confirm when not dirty', () => {
    const onClose = vi.fn();
    requestCloseOfficeDraft({ dirty: false, onClose, message: 'msg' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('requestCloseOfficeDraft calls onClose when user confirms', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onClose = vi.fn();
    requestCloseOfficeDraft({ dirty: true, onClose, message: 'discard?' });
    expect(confirmSpy).toHaveBeenCalledWith('discard?');
    expect(onClose).toHaveBeenCalledOnce();
    confirmSpy.mockRestore();
  });

  it('requestCloseOfficeDraft keeps dialog open when user cancels', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const onClose = vi.fn();
    requestCloseOfficeDraft({ dirty: true, onClose, message: 'discard?' });
    expect(onClose).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('confirmDiscardOfficeDraft delegates to window.confirm', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    expect(confirmDiscardOfficeDraft('x')).toBe(true);
    expect(confirmSpy).toHaveBeenCalledWith('x');
    confirmSpy.mockRestore();
  });
});

describe('workflow room dispatch policy', () => {
  it('blocks user @ member when runner inactive (coordinator-only)', async () => {
    const { shouldDispatchWorkflowMentionToRole } = await import(
      '../../electron/services/office/room-dispatch-policy'
    );
    expect(
      shouldDispatchWorkflowMentionToRole({
        executionMode: 'workflow',
        taskId: 'task-1',
        targetRoleId: 'dev',
        coordinatorRoleId: 'pm',
        message: { from: 'user', content: '@开发 请返工' },
      }),
    ).toBe(false);
    expect(
      shouldDispatchWorkflowMentionToRole({
        executionMode: 'workflow',
        taskId: 'task-1',
        targetRoleId: 'pm',
        coordinatorRoleId: 'pm',
        message: { from: 'user', content: '@协调者 请调整' },
      }),
    ).toBe(true);
  });
});
