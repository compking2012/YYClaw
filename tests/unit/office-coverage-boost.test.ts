/**
 * 办公模块覆盖率补充：纯函数 / 可 mock 的策略逻辑。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  isWorkflowUpstreamClarificationMessage,
  findWorkflowSpeakerNodeId,
  resolveWorkflowUpstreamMentionRoleIds,
  isWorkflowUpstreamClarificationTarget,
} from '@/lib/office-workflow-upstream-mention';
import {
  clearWorkflowUserInterventionIfNodeDone,
  clearWorkflowUserInterventionIfNodeTerminal,
  isWorkflowUserInterventionActive,
  parseWorkflowUserInterventionKind,
  pickWorkflowNodeForUserIntervention,
  planWorkflowUserIntervention,
  planWorkflowUserInterventionFromCoordinator,
} from '@/lib/office-workflow-user-intervention';
import { selectRoomContextForCoordinator } from '@/lib/office-room-context-coordinator';
import {
  isTaskCoordinatorSpeaker,
  parseRoomMessageSpeakerNameFromContent,
  resolveRoomMessageSpeakerRoleId,
} from '@/lib/office-room-speaker-role';
import {
  deriveProjectRoleStates,
  PROJECT_ROLE_STATE_RECONCILE_MS,
  reconcileActiveProjectRoleState,
  teamRoleIdsWorkingInScenario,
} from '@/lib/office-project-role-state';
import {
  displayRoomMessageBody,
  formatRoomReplyBody,
  joinInlineQuotedReply,
  splitInlineQuotedContent,
  stripInlineQuotePrefix,
} from '@/lib/office-room-reply-format';
import {
  officeRoleBubbleStyle,
  officeRoleColorAt,
  officeRoleColorForId,
  OFFICE_ROLE_COLORS,
} from '@/lib/office-role-colors';
import {
  getBlockingPredecessorSteps,
  getIncompletePredecessorRoleIds as libGetIncompletePredecessorRoleIds,
  nodeRunsMap,
} from '@/lib/office-workflow-deps';
import {
  formatStatusTimeSeconds,
  projectDirSegment,
} from '@/lib/office-project-context';
import {
  classifySmartMemberReportToCoordinator,
  compactSmartMemberAssignmentSummary,
  hasCoordinatorDirectAssignmentToRole,
  inferSmartMemberReadiness,
  inferSmartMemberReadinessForMention,
  isSmartMemberAcceptanceNotice,
  isSmartMemberDeliverableReply,
  isSmartMemberDependencyReportReply,
  isSmartMemberInProgressOnlyReply,
  isSmartMemberPromiseOnlyReply,
  isSmartMemberSubtaskDoneMarker,
  isSmartMemberWaitingForPeerReply,
  isSmartSubtaskDoneBracketTitle,
  mentionClauseForRole,
  pickPeerMentionTokenForWaiting,
  resolveSmartMemberReadiness,
  smartCoordinatorMentionRef,
  smartCoordinatorReplyHasDirectMemberAssignment,
  smartMemberMentionRoomLine,
  smartMemberReplyMentionsCoordinator,
  smartMemberReportKindLabel,
  stripProjectGateClauses,
  synthesizeBlockedMemberDependencyReply,
  validateSmartMemberRoomReply,
} from '@/lib/office-smart-member-reply';
import {
  collectFinalRoomMirrorText,
  extractDeliverableStatusFromThinking,
  extractFinalAssistantRoomMirror,
  extractFinalTextBlocks,
  extractStructuredReplyFromAssistantMessage,
  extractWorkflowStructuredFromAssistantMessage,
  findFinalReplyIndexInSegment,
  findLatestMentionStructuredRaw,
  findLatestWorkflowStructuredRaw,
  isRealUserMessage,
  joinThinkingBlocks,
} from '@/lib/office-session-final-mirror';
import {
  collectAssistantRoomMirrorText,
  gatewayEventMatchesRun,
  hasTriggeringUserTurnAfter,
  normalizeOfficeTimestampMs,
  payloadMatchesSession,
  parseGatewayChatEnvelope,
  resolveMentionAssistantReplyFromHistory,
  shouldArmSessionReplyTimeout,
} from '@electron/services/office/run-completion';
import {
  applyOfficeRunGatewayEvent,
  applyOfficeRunRuntimeEvent,
  canAcceptStableSessionReply,
  createOfficeRunTracker,
  hashSessionReplyText,
  isOfficeRunCompletePhase,
  sessionHasInFlightToolWork,
  sleepAbortable,
} from '@electron/services/office/session-run-settle';
import {
  diagnoseWorkflowStall,
  freshNodeRuns,
  getIncompletePredecessorRoleIds,
  reconcileWorkflowForScenario,
} from '@electron/services/office/workflow-graph';
import {
  augmentSmartAssignmentFromCoordinatorLines,
  collectSmartCoordinatorRoomLinesForRole,
  isUnassignedAssignmentText,
  smartCoordinatorHasDecomposedInRoom,
  smartCoordinatorNeedsDecomposition,
  smartCoordinatorReplyDispatchesMembers,
} from '@electron/services/office/role-assignment-lookup';
import {
  abortSmartTaskController,
  endSmartTaskRun,
  evaluateSmartTaskClosureGate,
  isSmartTaskMarkedRunning,
  registerSmartTaskRun,
  smartCoordinatorClosureSourceText,
} from '@electron/services/office/smart-task-completion';
import type { OfficeTask, RoomMessage, WorkflowNode } from '@/types/office';
import { agent, roomMsg } from '../helpers/office-agents';

const teamRoles = [
  { id: 'a-pm', name: 'PM', agentId: 'a-pm' },
  { id: 'a-dev', name: '开发', agentId: 'a-dev' },
  { id: 'a-qa', name: '测试', agentId: 'a-qa' },
  { id: 'a-cn', name: 'A股', agentId: 'a-cn' },
  { id: 'a-us', name: '美股', agentId: 'a-us' },
];

const wfNodes: WorkflowNode[] = [
  { id: 'n1', agentId: 'a-dev', title: '开发实现', execution: 'serial' },
  { id: 'n2', agentId: 'a-qa', title: '测试验收', execution: 'serial' },
];
const wfEdges = [{ from: 'n1', to: 'n2', when: 'on_success' as const }];

function room(partial: Partial<RoomMessage> & Pick<RoomMessage, 'id' | 'content'>): RoomMessage {
  return roomMsg({
    projectId: 't1',
    from: 'agent',
    mentions: [],
    timestamp: 1,
    ...partial,
  });
}

describe('office coverage boost · workflow upstream mention', () => {
  it('detects clarification messages', () => {
    expect(isWorkflowUpstreamClarificationMessage(undefined)).toBe(false);
    expect(isWorkflowUpstreamClarificationMessage({ content: '❓ 协作询问 @开发' })).toBe(true);
    expect(isWorkflowUpstreamClarificationMessage({ content: '普通发言', from: 'user' })).toBe(false);
  });

  it('findWorkflowSpeakerNodeId resolves explicit, title, and running run', () => {
    expect(
      findWorkflowSpeakerNodeId({
        nodes: wfNodes,
        speakerRoleId: 'a-qa',
        messageNodeId: 'n2',
      }),
    ).toBe('n2');
    expect(
      findWorkflowSpeakerNodeId({
        nodes: wfNodes,
        speakerRoleId: 'a-qa',
        content: '关于测试验收的问题',
      }),
    ).toBe('n2');
    expect(
      findWorkflowSpeakerNodeId({
        nodes: wfNodes,
        speakerRoleId: 'a-dev',
        nodeRuns: [{ nodeId: 'n1', agentId: 'a-dev', status: 'running' }],
      }),
    ).toBe('n1');
  });

  it('resolveWorkflowUpstreamMentionRoleIds filters to upstream roles', () => {
    const ids = resolveWorkflowUpstreamMentionRoleIds({
      message: {
        content: '❓ 协作询问 @开发 请确认接口',
        phase: 'task_clarification',
        nodeId: 'n2',
      },
      speakerRoleId: 'a-qa',
      nodes: wfNodes,
      edges: wfEdges,
      teamRoles,
    });
    expect(ids).toEqual(['a-dev']);
  });

  it('isWorkflowUpstreamClarificationTarget matches allowed upstream', () => {
    expect(
      isWorkflowUpstreamClarificationTarget({
        message: { content: '❓ 协作询问 @开发', phase: 'task_clarification', nodeId: 'n2' },
        speakerRoleId: 'a-qa',
        targetRoleId: 'a-dev',
        coordinatorRoleId: 'a-pm',
        nodes: wfNodes,
        edges: wfEdges,
        teamRoles,
      }),
    ).toBe(true);
    expect(
      isWorkflowUpstreamClarificationTarget({
        message: { content: '❓ 协作询问 @开发', phase: 'task_clarification', nodeId: 'n2' },
        speakerRoleId: 'a-qa',
        targetRoleId: 'a-pm',
        coordinatorRoleId: 'a-pm',
        nodes: wfNodes,
        edges: wfEdges,
        teamRoles,
      }),
    ).toBe(false);
  });
});

describe('office coverage boost · workflow user intervention', () => {
  it('parses intervention kinds and active state', () => {
    expect(parseWorkflowUserInterventionKind('请重做本步')).toBe('redo');
    expect(parseWorkflowUserInterventionKind('跳过直接进入测试')).toBe('skip_to');
    expect(parseWorkflowUserInterventionKind('暂停一下')).toBe('other');
    expect(
      isWorkflowUserInterventionActive({ workflowUserIntervention: { activeNodeId: 'n1', request: 'x', startedAt: 1, kind: 'redo' } }),
    ).toBe(true);
  });

  it('pickWorkflowNodeForUserIntervention picks by title or last done', () => {
    const runs = new Map([
      ['n1', { nodeId: 'n1', agentId: 'a-dev', status: 'completed' as const }],
      ['n2', { nodeId: 'n2', agentId: 'a-qa', status: 'pending' as const }],
    ]);
    expect(
      pickWorkflowNodeForUserIntervention({
        nodes: wfNodes,
        roleId: 'a-dev',
        runs,
        userContent: '重做开发实现这一步',
      })?.id,
    ).toBe('n1');
  });

  it('planWorkflowUserIntervention redo and skip_to', () => {
    const devRole = { id: 'a-dev', name: '开发', agentId: 'a-dev' };
    const runs = new Map(wfNodes.map((n) => [n.id, { nodeId: n.id, agentId: n.agentId!, status: 'completed' as const }]));
    const redo = planWorkflowUserIntervention({
      nodes: wfNodes,
      edges: wfEdges,
      runs,
      targetRoles: [devRole],
      userContent: '重做开发实现',
    });
    expect(redo?.kind).toBe('redo');
    expect(redo?.activeNodeId).toBe('n1');

    const skipRuns = new Map([
      ['n1', { nodeId: 'n1', agentId: 'a-dev', status: 'completed' as const }],
      ['n2', { nodeId: 'n2', agentId: 'a-qa', status: 'completed' as const }],
    ]);
    const skip = planWorkflowUserIntervention({
      nodes: wfNodes,
      edges: wfEdges,
      runs: skipRuns,
      targetRoles: [devRole],
      userContent: '跳过开发实现，直接进入测试验收',
    });
    expect(skip?.kind).toBe('skip_to');
    expect(skip?.skippedNodeId).toBe('n1');
    expect(skip?.activeNodeId).toBe('n2');
  });

  it('planWorkflowUserInterventionFromCoordinator and clear helpers', () => {
    const runs = new Map(wfNodes.map((n) => [n.id, { nodeId: n.id, agentId: n.agentId!, status: 'pending' as const }]));
    const plan = planWorkflowUserInterventionFromCoordinator({
      nodes: wfNodes,
      edges: wfEdges,
      runs,
      userContent: '协调者介入',
      activeNodeId: 'n1',
      kind: 'redo',
    });
    expect(plan?.activeNodeId).toBe('n1');

    const task = {
      id: 't1',
      workflowUserIntervention: { activeNodeId: 'n1', request: 'r', startedAt: 1, kind: 'redo' as const },
    } as OfficeTask;
    expect(clearWorkflowUserInterventionIfNodeDone(task, 'n1')).toBe(true);
    expect(task.workflowUserIntervention).toBeUndefined();
    task.workflowUserIntervention = { activeNodeId: 'n1', request: 'r', startedAt: 1, kind: 'redo' };
    expect(clearWorkflowUserInterventionIfNodeTerminal(task, 'n1', 'failed')).toBe(true);
  });
});

describe('office coverage boost · room context and speaker', () => {
  it('selectRoomContextForCoordinator includes quote thread and recent rounds', () => {
    const history: RoomMessage[] = [
      room({ id: 'a', fromAgentId: 'a-pm', content: 'A', timestamp: 1 }),
      room({ id: 'b', fromAgentId: 'a-dev', content: 'B', timestamp: 2, replyToId: 'a' }),
      room({ id: 'c', fromAgentId: 'a-qa', content: 'C', timestamp: 3 }),
    ];
    const selected = selectRoomContextForCoordinator(history, { upToMessageId: 'c', triggerMessageId: 'c' });
    expect(selected.map((m) => m.id)).toEqual(expect.arrayContaining(['a', 'b', 'c']));
  });

  it('resolveRoomMessageSpeakerRoleId and coordinator check', () => {
    expect(parseRoomMessageSpeakerNameFromContent('👔 【PM】👉 请执行')).toBe('PM');
    expect(
      resolveRoomMessageSpeakerRoleId(
        { from: 'agent', fromAgentId: 'a-dev', content: '【开发】已完成' },
        teamRoles,
      ),
    ).toBe('a-dev');
    expect(isTaskCoordinatorSpeaker('a-pm', 'a-pm')).toBe(true);
    expect(isTaskCoordinatorSpeaker('a-dev', 'a-pm')).toBe(false);
  });
});

describe('office coverage boost · project role state and room reply format', () => {
  const group = {
    id: 's1',
    agentIds: ['a-pm', 'a-dev'],
    workflow: { nodes: [], edges: [] },
    name: 'G',
    coordinatorAgentId: 'a-pm',
    createdAt: 0,
    updatedAt: 0,
  };
  const project = {
    id: 't1',
    parentGroupId: 's1',
    title: 'demo',
    description: '',
    status: 'running',
    agentIds: ['a-dev'],
    coordinatorAgentId: 'a-pm',
    createdAt: 0,
    updatedAt: 0,
  };

  it('deriveProjectRoleStates and reconcile cache', () => {
    const msgs = [room({ id: 'm1', fromAgentId: 'a-dev', content: '执行中', timestamp: 1, phase: 'task_running' })];
    const states = deriveProjectRoleStates(group, project, msgs);
    expect(states['a-dev']).toBe('working');
    expect(PROJECT_ROLE_STATE_RECONCILE_MS).toBe(2_000);
    const cache = reconcileActiveProjectRoleState(group, [project], { t1: msgs }, ['t1'], {});
    expect(cache.t1?.['a-dev']).toBe('working');
    expect(teamRoleIdsWorkingInScenario(group, [project], { t1: msgs }, cache).has('a-dev')).toBe(true);
  });

  it('room reply formatting helpers', () => {
    expect(joinInlineQuotedReply('上游摘要', '正文')).toContain('引用');
    expect(stripInlineQuotePrefix('（引用：旧）\n\n新正文')).toBe('新正文');
    expect(splitInlineQuotedContent('（引用：Q）\n\n答').body).toBe('答');
    expect(formatRoomReplyBody('答', true)).toMatch(/^\n\n/);
    expect(displayRoomMessageBody({ content: '（引用：Q）\n\n答', replyToId: 'x' })).toContain('答');
  });

  it('office role colors', () => {
    expect(OFFICE_ROLE_COLORS.length).toBeGreaterThan(0);
    expect(officeRoleColorAt(9)).toBe(officeRoleColorAt(1));
    expect(officeRoleColorForId('dev', [{ id: 'dev' }])).toMatch(/^#/);
    expect(officeRoleBubbleStyle('dev', [{ id: 'dev' }]).backgroundColor).toContain('1a');
  });

  it('project context helpers', () => {
    expect(projectDirSegment('任务A', 'task-1')).toBe('task-1');
    expect(formatStatusTimeSeconds(0)).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });
});

describe('office coverage boost · workflow deps and graph', () => {
  it('nodeRunsMap and lib predecessor roles', () => {
    const runs = nodeRunsMap([{ nodeId: 'n1', agentId: 'a-dev', status: 'pending' }]);
    expect(libGetIncompletePredecessorRoleIds('n2', wfNodes, wfEdges, runs)).toEqual(['a-dev']);
    const blocking = getBlockingPredecessorSteps('n2', wfNodes, wfEdges, runs, teamRoles);
    expect(blocking[0]?.nodeId).toBe('n1');
  });

  it('workflow graph reconcile and stall diagnosis', () => {
    const scenario = {
      id: 's1',
      agentIds: ['a-dev', 'a-qa'],
      workflow: { mode: 'dag' as const, nodes: wfNodes, edges: wfEdges },
      name: 'S',
      coordinatorAgentId: 'a-pm',
      createdAt: 1,
      updatedAt: 1,
    };
    const reconciled = reconcileWorkflowForScenario(scenario);
    expect(reconciled.nodes.length).toBeGreaterThan(0);
    expect(freshNodeRuns(reconciled.nodes).every((r) => r.status === 'pending')).toBe(true);
    const runs = new Map([['n1', { nodeId: 'n1', agentId: 'a-dev', status: 'pending' as const }]]);
    expect(diagnoseWorkflowStall(wfNodes, wfEdges, runs)).toMatch(/blocked|stalled/i);
    expect(getIncompletePredecessorRoleIds('n2', wfNodes, wfEdges, runs)).toContain('a-dev');
  });
});

describe('office coverage boost · smart member reply', () => {
  const dev = agent('a-dev', '开发');
  const pm = agent('a-pm', 'PM');

  it('stripProjectGateClauses and mention helpers', () => {
    expect(stripProjectGateClauses('开发完成，待测试完成后即可结项。')).not.toContain('结项');
    expect(mentionClauseForRole('@开发 请今日完成接口', dev)).toContain('@');
    expect(smartMemberMentionRoomLine('@开发 短', dev, 'preview')).toContain('开发');
    expect(isSmartSubtaskDoneBracketTitle('五子棋文档已完成')).toBe(true);
  });

  it('readiness and reply classifiers', () => {
    expect(isSmartMemberPromiseOnlyReply('收到，马上开始执行')).toBe(true);
    expect(isSmartMemberInProgressOnlyReply('撰写中，预计明日交付')).toBe(true);
    expect(isSmartMemberDependencyReportReply('依赖开发提供接口，暂无法开展')).toBe(true);
    expect(isSmartMemberSubtaskDoneMarker('**开发已完成**')).toBe(true);
    expect(isSmartMemberDeliverableReply('已完成交付物见 /tmp/a.html')).toBe(true);
    expect(isSmartMemberWaitingForPeerReply('等待 @测试 验收')).toBe(true);
    const dispatchLine = JSON.stringify({
      role: 'PM',
      action: 'assign',
      roomReply: '请开发今日完成 API 实现',
      dispatch: [{ role: '开发', task: '请今日完成 API 实现' }],
      taskUnderstanding: '派活',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: '无' },
    });
    expect(
      inferSmartMemberReadinessForMention({
        coordinatorRoomLine: dispatchLine,
        mentionTargetRole: dev,
      }),
    ).toBe('ready');
    expect(
      inferSmartMemberReadiness(['待开发完成后你再测试']),
    ).toBe('blocked');
    expect(
      resolveSmartMemberReadiness('ready', '已完成 API 实现并自测通过'),
    ).toBe('ready');
  });

  it('coordinator interaction helpers', () => {
    expect(smartCoordinatorMentionRef(pm)).toContain('PM');
    expect(smartMemberReplyMentionsCoordinator('@PM 请验收', pm)).toBe(true);
    const assignJson = JSON.stringify({
      role: 'PM',
      action: 'assign',
      roomReply: '请开发联调',
      dispatch: [{ role: '开发', task: '请完成联调' }],
      taskUnderstanding: '派活',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: '无' },
    });
    expect(hasCoordinatorDirectAssignmentToRole(assignJson, dev)).toBe(true);
    expect(pickPeerMentionTokenForWaiting('等待 @测试 确认', dev)).toBe('测试');
    expect(
      synthesizeBlockedMemberDependencyReply(pm, '缺少设计稿', dev),
    ).toContain('无法开工');
    expect(
      JSON.parse(synthesizeBlockedMemberDependencyReply(pm, '缺少设计稿', dev) ?? '{}').action,
    ).toBe('help');
    expect(
      classifySmartMemberReportToCoordinator(
        JSON.stringify({
          role: '成员',
          action: 'end',
          taskUnderstanding: '子任务已完成，见路径',
          deliverable: { items: ['交付物-成员/out.md'], outputValidation: [] },
          dispatch: [{ role: 'PM', task: '请验收。' }],
        }),
      ),
    ).toBe('subtask_done');
    expect(smartMemberReportKindLabel('subtask_done')).toBeTruthy();
    expect(compactSmartMemberAssignmentSummary('已完成编写 /tmp/a.py 并测试通过')).toContain('/tmp/a.py');
    expect(isSmartMemberAcceptanceNotice('@开发 请今日完成实现', dev)).toBe(false);
    expect(isSmartMemberAcceptanceNotice('', dev)).toBe(false);
    expect(
      smartCoordinatorReplyHasDirectMemberAssignment(assignJson),
    ).toBe(true);
    const replyText = '@PM 已确认收到，感谢协调';
    const issues = validateSmartMemberRoomReply(
      replyText,
      pm,
      'acceptance',
      { dispatchText: '@PM 已确认收到，感谢协调' },
    );
    expect(issues).not.toContain('smart_member_missing_coordinator');
  });
});

describe('office coverage boost · session mirror and run completion', () => {
  it('isRealUserMessage and extract helpers', () => {
    expect(isRealUserMessage({ role: 'user', content: 'hi' })).toBe(true);
    expect(isRealUserMessage({ role: 'assistant', content: 'hi' })).toBe(false);
    expect(extractFinalTextBlocks([{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }])).toContain('A');
    expect(extractDeliverableStatusFromThinking('已完成交付 /tmp/x.md')).toContain('已完成');
    expect(joinThinkingBlocks([{ type: 'thinking', thinking: 'plan' }])).toContain('plan');
    const assistant = {
      role: 'assistant',
      content: [{ type: 'text', text: '【群聊回复】\n@开发 请执行' }],
    };
    expect(extractStructuredReplyFromAssistantMessage(assistant)).toContain('群聊回复');
    expect(extractFinalAssistantRoomMirror(assistant)).toBeTruthy();
    expect(findFinalReplyIndexInSegment([{ role: 'user', content: 'u' }, assistant])).toBe(1);
  });

  it('findLatest structured raw and collectFinalRoomMirrorText', () => {
    const msgs = [
      { role: 'user', content: 'go', timestamp: 1000 },
      {
        role: 'assistant',
        content: [
          '【任务理解】执行',
          '【输入校验】无',
          '【输出校验】无',
          '【交付产物】无',
          '【群聊回复】',
          '@dev ok',
        ].join('\n'),
        timestamp: 2000,
      },
    ];
    expect(findLatestMentionStructuredRaw(msgs, 500, normalizeOfficeTimestampMs)?.length).toBeGreaterThan(0);
    const wfMsg = {
      role: 'assistant',
      content: '{"role":"dev","step":"s","inputValidation":"ok","execution":"ok","outputValidation":"ok","deliverable":"ok","rollback":"ok"}',
      timestamp: 2000,
    };
    expect(extractWorkflowStructuredFromAssistantMessage(wfMsg)).toContain('"role"');
    expect(findLatestWorkflowStructuredRaw([wfMsg], 500, normalizeOfficeTimestampMs)).toBeTruthy();
    expect(collectFinalRoomMirrorText(msgs, 500, normalizeOfficeTimestampMs)).toBeTruthy();
  });

  it('run-completion pure helpers', () => {
    expect(normalizeOfficeTimestampMs('2020-01-01T00:00:00.000Z')).toBeGreaterThan(0);
    expect(payloadMatchesSession({ sessionKey: 'sk-1' }, 'sk-1')).toBe(true);
    expect(gatewayEventMatchesRun('r1', 'r1')).toBe(true);
    expect(shouldArmSessionReplyTimeout(0)).toBe(false);
    expect(shouldArmSessionReplyTimeout(1000)).toBe(true);
    const parsed = parseGatewayChatEnvelope({
      message: {
        sessionKey: 'sk',
        state: 'done',
        runId: 'r1',
        phase: 'completed',
        message: { role: 'assistant', content: 'ok' },
      },
    });
    expect(parsed.runId).toBe('r1');
    const history = [
      { role: 'user', content: 'start', timestamp: 5000 },
      { role: 'assistant', content: '【群聊回复】\nOK', timestamp: 6000 },
    ];
    expect(hasTriggeringUserTurnAfter(history, 4000)).toBe(true);
    expect(
      resolveMentionAssistantReplyFromHistory(history, 4000, { requireFreshUserTurn: true }),
    ).toContain('OK');
    expect(
      collectAssistantRoomMirrorText(history, 4000),
    ).toBeTruthy();
  });
});

describe('office coverage boost · session run settle', () => {
  it('tracker, hash, and tool work detection', () => {
    const tracker = createOfficeRunTracker('run-1');
    applyOfficeRunGatewayEvent(tracker, { runId: 'run-1', phase: 'started' });
    applyOfficeRunRuntimeEvent(tracker, {
      type: 'run.ended',
      runId: 'run-1',
      status: 'completed',
      // Real normalizer always carries lifecyclePhase for run.ended; a bare completed
      // without phase/stopReason is intentionally NOT a run-level discharge (Model B).
      lifecyclePhase: 'completed',
    });
    expect(isOfficeRunCompletePhase('completed')).toBe(true);
    expect(canAcceptStableSessionReply(tracker)).toBe(true);
    expect(hashSessionReplyText(' abc ')).toHaveLength(64);

    const msgs = [
      { role: 'user', content: 'go', timestamp: 5000 },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1' }],
        timestamp: 5100,
      },
    ];
    expect(sessionHasInFlightToolWork(msgs, 4900)).toBe(true);
  });

  it('sleepAbortable resolves and rejects on abort', async () => {
    const ac = new AbortController();
    const p = sleepAbortable(50, ac.signal);
    ac.abort();
    await expect(p).rejects.toThrow('aborted');
    await expect(sleepAbortable(1)).resolves.toBeUndefined();
  });
});

describe('office coverage boost · role assignment lookup', () => {
  it('isUnassignedAssignmentText', () => {
    expect(isUnassignedAssignmentText('')).toBe(true);
    expect(isUnassignedAssignmentText('无')).toBe(true);
    expect(isUnassignedAssignmentText('@开发 负责 API')).toBe(false);
  });

  it('smart coordinator decomposition detection', () => {
    const dispatchJson = JSON.stringify({
      role: 'PM',
      action: 'assign',
      roomReply: '请开发今日完成模块实现与联调。',
      dispatch: [{ role: '开发', task: '请今日完成模块实现与联调' }],
      taskUnderstanding: '拆解',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: '无' },
    });
    const msgs = [
      room({
        id: 'm1',
        fromAgentId: 'a-pm',
        content: dispatchJson,
        timestamp: 1,
      }),
    ];
    expect(smartCoordinatorHasDecomposedInRoom(msgs, 'a-pm', 't1')).toBe(true);
    expect(
      smartCoordinatorReplyDispatchesMembers(dispatchJson, 'a-pm', teamRoles),
    ).toBe(true);
    expect(
      smartCoordinatorReplyDispatchesMembers('@开发 请实现', 'a-pm', teamRoles),
    ).toBe(false);
    expect(smartCoordinatorNeedsDecomposition(null, { roomMessages: msgs, coordinatorRoleId: 'a-pm', taskId: 't1' })).toBe(false);
    expect(
      augmentSmartAssignmentFromCoordinatorLines({
        assignment: { state: 'unassigned', summary: null, source: 'none' },
        coordinatorRoomLines: [dispatchJson],
        role: { id: 'a-dev', name: '开发', agentId: 'a-dev' },
      }).state,
    ).toBe('assigned');
    const lines = collectSmartCoordinatorRoomLinesForRole({
      roomMessages: msgs,
      coordinatorRoleId: 'a-pm',
      role: { id: 'a-dev', name: '开发', agentId: 'a-dev' },
      triggerMessage: msgs[0]!,
    });
    expect(lines.length).toBeGreaterThan(0);
  });
});

describe('office coverage boost · smart task completion registry', () => {
  beforeEach(() => {
    endSmartTaskRun('task-x', { abortInflight: false });
    endSmartTaskRun('task-y', { abortInflight: false });
  });

  it('tracks smart task runs', () => {
    const ac = new AbortController();
    registerSmartTaskRun('task-x', ac);
    expect(isSmartTaskMarkedRunning('task-x')).toBe(true);
    endSmartTaskRun('task-x');
    expect(isSmartTaskMarkedRunning('task-x')).toBe(false);
    registerSmartTaskRun('task-y', ac);
    expect(abortSmartTaskController('task-y')).toBe(true);
  });

  it('smartCoordinatorClosureSourceText and closure gate', () => {
    expect(smartCoordinatorClosureSourceText('{"roomReply":"**项目结项**"}')).toContain('结项');
    const steps = [
      { stepIndex: 1, nodeId: 'n1', title: '开发', roleIds: ['a-dev'] },
      { stepIndex: 2, nodeId: 'n2', title: 'PM', roleIds: ['a-pm'] },
    ];
    const roomMsgs = [
      room({
        id: 'm1',
        fromAgentId: 'a-dev',
        content: '**开发已完成**',
        smartMemberEnd: true,
        timestamp: 1,
      }),
    ];
    expect(
      evaluateSmartTaskClosureGate({
        steps,
        roomMessages: roomMsgs,
        projectId: 't1',
        coordinatorAgentId: 'a-pm',
      }),
    ).toBe(true);
  });
});
