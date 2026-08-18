/**
 * 办公协作（Smart 并行工作顺序、校验范围、执行策略、输入/结项）补充单元测试。
 * 仅测试纯函数与策略，不启动 Gateway/Electron。
 */
import { describe, it, expect } from 'vitest';
import {
  shouldDispatchWorkflowRoomMentionLlm,
  shouldImmediateSmartUserRoomCoordinatorIntervention,
  shouldScheduleSmartBroadcastCoordinatorWatch,
  isSmartRoomExecutionDriver,
  isWorkflowRunnerDriven,
} from '@/lib/office-execution-mode-policy';
import {
  collectSmartCompletedStepDeliverablePaths,
  collectSmartRoleDoneDeliverablePathHints,
  collectSmartUpstreamDeliverablePathHints,
  isSmartMemberInputValidationFailureReport,
} from '@/lib/office-smart-input-validation';
import {
  formatStructuredValidationFailureDetail,
} from '@/lib/office-mention-validation-detail';
import {
  buildSmartWorkOrderFromTaskDescription,
  buildSmartTeamMentionRosterBlock,
  findSmartWorkOrderStepIndexForRole,
  formatSmartPrematureProjectEndReason,
  formatSmartWorkOrderHint,
  resolveSmartNextExecutorRoleIds,
  resolveSmartWorkOrderSteps,
  smartMemberSubtaskDoneReportText,
  smartMemberWorkOrderSteps,
} from '@/lib/office-smart-work-order';
import { resolveSmartValidationScope } from '@/lib/office-smart-validation-scope';
import {
  isSmartProjectEngineComplete,
  smartCoordinatorAllowedDispatchRoleIds,
  validateSmartCoordinatorProjectEnd,
  validateSmartCoordinatorRoomMentions,
} from '@/lib/office-smart-coordinator-dispatch';
import {
  planSmartProgressNudge,
  smartAllWorkOrderStepsDoneInRoom,
  SMART_STALL_NUDGE_AFTER_MS,
} from '@/lib/office-smart-progress-policy';
import { isBenignGatewayLifecycleErrorMessage } from '@/lib/gateway-lifecycle-errors';
import type { OfficeFixedGroup, RoomMessage } from '@/types/office';
import type { ProjectAgentRef } from '@/lib/office-workflow-node';

const team: ProjectAgentRef[] = [
  { agentId: 'pm', displayName: 'PM' },
  { agentId: 'cn', displayName: 'A股分析' },
  { agentId: 'us', displayName: '美股分析' },
  { agentId: 'dev', displayName: '开发' },
];

const parallelScenario: Pick<OfficeFixedGroup, 'workflow'> = {
  workflow: {
    mode: 'dag',
    nodes: [
      { id: 'n-par', agentId: 'cn', agentIds: ['cn', 'us'], execution: 'serial', title: '并行分析' },
      { id: 'n-dev', agentId: 'dev', execution: 'serial', title: '开发' },
    ],
    edges: [{ from: 'n-par', to: 'n-dev' }],
  },
};

function roomMsg(partial: Partial<RoomMessage> & Pick<RoomMessage, 'id' | 'content'> & { fromRoleId?: string }): RoomMessage {
  const fromAgentId = partial.fromAgentId ?? partial.fromRoleId ?? 'agent';
  return {
    projectId: 't1',
    groupId: 's1',
    from: 'agent',
    fromAgentId,
    mentions: [],
    timestamp: 1,
    ...partial,
    fromRoleId: undefined,
  } as RoomMessage;
}

function smartMemberEndJson(items: string[], role = '成员'): string {
  return JSON.stringify({
    role,
    action: 'end',
    taskUnderstanding: '子任务完成',
    deliverable: {
      items,
      outputValidation: items.map((p) => `-rw-r--r-- 1 u 1 20 ${p}`),
    },
    dispatch: [{ role: 'PM', task: '请验收' }],
  });
}

function roomMsgWithSmartMemberEnd(
  partial: Partial<RoomMessage> & Pick<RoomMessage, 'id' | 'content' | 'fromRoleId'> & {
    deliverableItems: string[];
    roleName?: string;
  },
): RoomMessage {
  const { deliverableItems, roleName, ...rest } = partial;
  return roomMsg({
    ...rest,
    smartMemberEnd: true,
    smartJsonRaw: smartMemberEndJson(deliverableItems, roleName),
  });
}

describe('office collaboration · execution mode policy', () => {
  it('identifies smart vs workflow drivers', () => {
    expect(isSmartRoomExecutionDriver('smart')).toBe(true);
    expect(isWorkflowRunnerDriven('workflow')).toBe(true);
    expect(isSmartRoomExecutionDriver('workflow')).toBe(false);
  });

  it('shouldImmediateSmartUserRoomCoordinatorIntervention only for user + focus', () => {
    expect(
      shouldImmediateSmartUserRoomCoordinatorIntervention({
        executionMode: 'smart',
        from: 'user',
        hasFocusTask: true,
      }),
    ).toBe(true);
    expect(
      shouldImmediateSmartUserRoomCoordinatorIntervention({
        executionMode: 'smart',
        from: 'agent',
        hasFocusTask: true,
      }),
    ).toBe(false);
    expect(
      shouldImmediateSmartUserRoomCoordinatorIntervention({
        executionMode: 'workflow',
        from: 'user',
        hasFocusTask: true,
      }),
    ).toBe(false);
  });

  it('shouldScheduleSmartBroadcastCoordinatorWatch for team broadcast without mentions', () => {
    expect(
      shouldScheduleSmartBroadcastCoordinatorWatch({
        executionMode: 'smart',
        kind: 'broadcast',
        replyTargetCount: 0,
        resolvedTeamMentionCount: 0,
        coordinatorRoleId: 'pm',
        fromRoleId: 'dev',
        from: 'agent',
        content: '大家看一下进度',
      }),
    ).toBe(true);
    expect(
      shouldScheduleSmartBroadcastCoordinatorWatch({
        executionMode: 'smart',
        kind: 'broadcast',
        replyTargetCount: 0,
        resolvedTeamMentionCount: 1,
        coordinatorRoleId: 'pm',
        fromRoleId: 'dev',
        content: '@PM 请看',
      }),
    ).toBe(false);
    expect(
      shouldScheduleSmartBroadcastCoordinatorWatch({
        executionMode: 'smart',
        kind: 'broadcast',
        replyTargetCount: 0,
        coordinatorRoleId: 'pm',
        fromRoleId: 'dev',
        from: 'user',
        content: '用户发言',
      }),
    ).toBe(false);
  });

  it('shouldDispatchWorkflowRoomMentionLlm allows user @ coordinator and upstream clarification', () => {
    expect(
      shouldDispatchWorkflowRoomMentionLlm({
        targetRoleId: 'pm',
        coordinatorRoleId: 'pm',
        messageFrom: 'user',
      }),
    ).toBe(true);
    expect(
      shouldDispatchWorkflowRoomMentionLlm({
        targetRoleId: 'dev',
        coordinatorRoleId: 'pm',
        messageFrom: 'agent',
        allowUpstreamClarification: true,
      }),
    ).toBe(true);
    expect(
      shouldDispatchWorkflowRoomMentionLlm({
        targetRoleId: 'dev',
        coordinatorRoleId: 'pm',
        messageFrom: 'agent',
      }),
    ).toBe(false);
  });
});

describe('office collaboration · parallel work order', () => {
  it('buildSmartWorkOrderFromTaskDescription assigns all matched roles per line', () => {
    const steps = buildSmartWorkOrderFromTaskDescription(
      '1. A股分析中国股票市场\n2. 美股分析美国股市\n3. 开发实现',
      team,
    );
    expect(steps[0]!.roleIds).toEqual(['cn']);
    expect(steps[1]!.roleIds).toEqual(['us']);
    expect(steps[2]!.roleIds).toEqual(['dev']);
  });

  it('findSmartWorkOrderStepIndexForRole finds any executor in parallel step', () => {
    const steps = resolveSmartWorkOrderSteps(parallelScenario, '', team);
    expect(findSmartWorkOrderStepIndexForRole(steps, 'us')).toBe(0);
    expect(findSmartWorkOrderStepIndexForRole(steps, 'dev')).toBe(1);
    expect(findSmartWorkOrderStepIndexForRole(steps, 'missing')).toBe(-1);
  });

  it('formatSmartWorkOrderHint shows parallel stage line', () => {
    const steps = resolveSmartWorkOrderSteps(parallelScenario, '', team);
    const hint = formatSmartWorkOrderHint(steps, team, ['cn', 'us']);
    expect(hint).toContain('【本阶段·可并行 @】');
    expect(hint).toContain('A股分析');
    expect(hint).toContain('美股分析');
    expect(hint).toContain('须待该阶段全部成员');
  });

  it('formatSmartPrematureProjectEndReason describes parallel stage', () => {
    const steps = resolveSmartWorkOrderSteps(parallelScenario, '', team);
    const reason = formatSmartPrematureProjectEndReason({
      nextExecutorRoleIds: ['cn', 'us'],
      teamRoles: team,
      steps,
    });
    expect(reason).toContain('本阶段并行执行者');
    expect(reason).toContain('A股分析');
    expect(reason).toContain('美股分析');
    expect(reason).toContain('全部成员');
  });

  it('smartMemberWorkOrderSteps drops coordinator-only parallel step', () => {
    const steps: ReturnType<typeof resolveSmartWorkOrderSteps> = [
      { stepIndex: 1, nodeId: 'n1', title: '协调', roleIds: ['pm'] },
      { stepIndex: 2, nodeId: 'n2', title: '开发', roleIds: ['dev'] },
    ];
    const member = smartMemberWorkOrderSteps(steps, 'pm');
    expect(member.map((s) => s.nodeId)).toEqual(['n2']);
  });

  it('isSmartProjectEngineComplete false until parallel stage done', () => {
    const steps = resolveSmartWorkOrderSteps(parallelScenario, '', team);
    const room: RoomMessage[] = [
      roomMsg({
        id: 'm1',
        fromRoleId: 'cn',
        content: '**A股分析已完成**',
        smartMemberEnd: true,
        timestamp: 1,
      }),
    ];
    expect(
      isSmartProjectEngineComplete({
        steps,
        roomMessages: room,
        taskId: 't1',
        coordinatorRoleId: 'pm',
      }),
    ).toBe(false);
    expect(resolveSmartNextExecutorRoleIds({ steps, roomMessages: room, taskId: 't1' })).toEqual(['us']);
  });
});

describe('office collaboration · subtask done text', () => {
  it('smartMemberSubtaskDoneReportText prefers field with done marker', () => {
    expect(
      smartMemberSubtaskDoneReportText({
        content: '**子任务已完成** /a',
        progressText: '进行中',
      }),
    ).toContain('已完成');
    expect(
      smartMemberSubtaskDoneReportText({
        content: '草稿',
        progressText: '**进度已完成**',
      }),
    ).toContain('已完成');
    expect(
      smartMemberSubtaskDoneReportText({ content: '无标记', progressText: '' }),
    ).toBe('无标记');
  });
});

describe('office collaboration · deliverable path collection', () => {
  const projectRoot =
    '/Users/demo/.openclaw/workspace-pm/office/projects/并行分析-task-t1';
  const cnPath = `${projectRoot}/交付物-产品/分析-cn.md`;
  const usPath = `${projectRoot}/交付物-产品/分析-us.md`;
  const steps = resolveSmartWorkOrderSteps(parallelScenario, '', team);
  const room: RoomMessage[] = [
    roomMsgWithSmartMemberEnd({
      id: 'm-cn',
      fromRoleId: 'cn',
      content: `**A股分析已完成** ${cnPath}`,
      deliverableItems: [cnPath],
      roleName: 'A股分析',
      timestamp: 1,
    }),
    roomMsgWithSmartMemberEnd({
      id: 'm-us',
      fromRoleId: 'us',
      content: `**美股分析已完成** ${usPath}`,
      deliverableItems: [usPath],
      roleName: '美股分析',
      timestamp: 2,
    }),
  ];

  it('collectSmartCompletedStepDeliverablePaths gathers all parallel reporters', () => {
    const paths = collectSmartCompletedStepDeliverablePaths({
      roomMessages: room,
      taskId: 't1',
      steps,
    });
    expect(paths).toContain(cnPath);
    expect(paths).toContain(usPath);
  });

  it('collectSmartUpstreamDeliverablePathHints includes all roles before current step', () => {
    const hints = collectSmartUpstreamDeliverablePathHints({
      roomMessages: room,
      taskId: 't1',
      steps,
      beforeRoleId: 'dev',
    });
    expect(hints).toContain(cnPath);
    expect(hints).toContain(usPath);
  });

  it('collectSmartUpstreamDeliverablePathHints empty when viewer is first step', () => {
    expect(
      collectSmartUpstreamDeliverablePathHints({
        roomMessages: room,
        taskId: 't1',
        steps,
        beforeRoleId: 'cn',
      }),
    ).toEqual([]);
  });

  it('collectSmartRoleDoneDeliverablePathHints scopes to one role', () => {
    const onlyCn = collectSmartRoleDoneDeliverablePathHints({
      roomMessages: room,
      taskId: 't1',
      roleId: 'cn',
    });
    expect(onlyCn).toEqual([cnPath]);
  });
});

describe('office collaboration · validation scope', () => {
  it('resolveSmartValidationScope merges input paths from parallel prior step', () => {
    const steps = resolveSmartWorkOrderSteps(parallelScenario, '', team);
    const projectRoot =
      '/Users/demo/.openclaw/workspace-pm/office/projects/并行分析-task-t1';
    const cnPath = `${projectRoot}/分析-cn.md`;
    const usPath = `${projectRoot}/分析-us.md`;
    const room: RoomMessage[] = [
      roomMsgWithSmartMemberEnd({
        id: 'm-cn',
        fromRoleId: 'cn',
        content: `**A股已完成** ${cnPath}`,
        deliverableItems: [cnPath],
        roleName: 'A股分析',
        timestamp: 1,
      }),
      roomMsgWithSmartMemberEnd({
        id: 'm-us',
        fromRoleId: 'us',
        content: `**美股已完成** ${usPath}`,
        deliverableItems: [usPath],
        roleName: '美股分析',
        timestamp: 2,
      }),
    ];
    const scope = resolveSmartValidationScope({
      raw: JSON.stringify({
        role: 'PM',
        action: 'assign',
        taskUnderstanding: '开发',
        inputValidation: '无',
        deliverable: { items: [], outputValidation: [] },
        dispatch: [{ role: '开发', task: '请实现' }],
      }),
      viewerRoleId: 'pm',
      steps,
      roomMessages: room,
      taskId: 't1',
      isCoordinator: true,
    });
    expect(scope.inputPaths).toEqual(expect.arrayContaining([cnPath, usPath]));
    expect(scope.outputPaths).toEqual([]);
  });

  it('resolveSmartValidationScope skips coordinator output paths on member report inbound', () => {
    const memberPath = '交付物-大模型调优专家/大模型运用现实问题调研-大模型调优专家.md';
    const memberReportRaw = smartMemberEndJson([memberPath], '大模型调优专家');
    const scope = resolveSmartValidationScope({
      raw: JSON.stringify({
        role: 'PM',
        action: 'assign',
        taskUnderstanding: '验收成员汇报。',
        inputValidation: `-rw-r--r-- 1 u 1 20 ${memberPath}`,
        deliverable: { items: [], outputValidation: [] },
        dispatch: [{ role: '大模型调优专家', task: '继续。' }],
      }),
      viewerRoleId: 'coord',
      steps: [],
      roomMessages: [],
      taskId: 't1',
      isCoordinator: true,
      memberReportRaw,
    });
    expect(scope.inputPaths).toEqual([memberPath]);
    expect(scope.outputPaths).toEqual([]);
  });
});

describe('office collaboration · coordinator dispatch', () => {
  const teamWithAgent = [
    { id: 'pm', name: 'PM', agentId: 'a-pm', createdAt: 0, updatedAt: 0 },
    { id: 'cn', name: 'A股分析', agentId: 'a-cn', createdAt: 0, updatedAt: 0 },
    { id: 'us', name: '美股分析', agentId: 'a-us', createdAt: 0, updatedAt: 0 },
    { id: 'dev', name: '开发', agentId: 'a-dev', createdAt: 0, updatedAt: 0 },
  ];

  it('smartCoordinatorAllowedDispatchRoleIds unions parallel stage ids', () => {
    const ids = smartCoordinatorAllowedDispatchRoleIds({
      nextExecutorRoleIds: ['cn', 'us'],
      allowReporterFixRoleId: 'dev',
    });
    expect(ids).toEqual(expect.arrayContaining(['cn', 'us', 'dev']));
  });

  it('validateSmartCoordinatorRoomMentions rejects off-stage role in parallel phase', () => {
    expect(
      validateSmartCoordinatorRoomMentions({
        publishText: '并行阶段启动。',
        dispatchText: '@开发 请等待',
        coordinatorRoleId: 'pm',
        nextExecutorRoleIds: ['cn', 'us'],
        teamRoles: teamWithAgent,
      }),
    ).toBe('mentions_non_next_executor');
  });

  it('validateSmartCoordinatorRoomMentions accepts @ all parallel stage executors', () => {
    expect(
      validateSmartCoordinatorRoomMentions({
        publishText: '并行阶段启动。',
        dispatchText: '@A股分析 @美股分析 请并行开始',
        coordinatorRoleId: 'pm',
        nextExecutorRoleIds: ['cn', 'us'],
        teamRoles: teamWithAgent,
      }),
    ).toBe('ok');
  });

  it('isSmartProjectEngineComplete true after parallel stage and downstream done', () => {
    const steps = resolveSmartWorkOrderSteps(parallelScenario, '', team);
    const room: RoomMessage[] = [
      roomMsg({ id: 'm1', fromRoleId: 'cn', content: '**A股分析已完成**', smartMemberEnd: true, timestamp: 1 }),
      roomMsg({ id: 'm2', fromRoleId: 'us', content: '**美股分析已完成**', smartMemberEnd: true, timestamp: 2 }),
      roomMsg({ id: 'm3', fromRoleId: 'dev', content: '**开发已完成**', smartMemberEnd: true, timestamp: 3 }),
    ];
    expect(
      isSmartProjectEngineComplete({
        steps,
        roomMessages: room,
        taskId: 't1',
        coordinatorRoleId: 'pm',
      }),
    ).toBe(true);
    expect(resolveSmartNextExecutorRoleIds({ steps, roomMessages: room, taskId: 't1' })).toEqual([]);
  });

  it('validateSmartCoordinatorProjectEnd rejects premature closure', () => {
    const raw = JSON.stringify({
      role: 'PM',
      taskUnderstanding: '误判结项',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: [] },
      roomReply: '全部完成。**项目结项**',
      action: 'end',
      dispatch: [],
    });
    expect(
      validateSmartCoordinatorProjectEnd({
        raw,
        allStepsComplete: false,
      }),
    ).toBe('premature_project_end');
  });

  it('formatStructuredValidationFailureDetail uses parallel premature reason', () => {
    const steps = resolveSmartWorkOrderSteps(parallelScenario, '', team);
    const detail = formatStructuredValidationFailureDetail(
      ['smart_coordinator_premature_project_end'],
      {
        smartNextExecutorRoleIds: ['cn', 'us'],
        teamRoles: team,
        smartWorkSteps: steps,
      },
    );
    expect(detail).toContain('本阶段并行执行者');
    expect(detail).toContain('【群聊回复】');
  });
});

describe('office collaboration · progress policy', () => {
  const smartProgressTeam = [
    { id: 'coord', name: '协调者' },
    { id: 'pm', name: 'PM' },
    { id: 'cn', name: 'A股分析' },
    { id: 'us', name: '美股分析' },
    { id: 'dev', name: '开发' },
  ];

  it('smartAllWorkOrderStepsDoneInRoom requires every role in parallel step', () => {
    const steps = resolveSmartWorkOrderSteps(parallelScenario, '', team);
    const room: RoomMessage[] = [
      roomMsgWithSmartMemberEnd({
        id: 'm1',
        fromRoleId: 'cn',
        content: '**A股分析已完成**',
        deliverableItems: ['交付物-产品/分析-cn.md'],
        roleName: 'A股分析',
        timestamp: 1,
      }),
    ];
    expect(smartAllWorkOrderStepsDoneInRoom(steps, room, 't1')).toBe(false);
    room.push(
      roomMsgWithSmartMemberEnd({
        id: 'm2',
        fromRoleId: 'us',
        content: '**美股分析已完成**',
        deliverableItems: ['交付物-产品/分析-us.md'],
        roleName: '美股分析',
        timestamp: 2,
      }),
    );
    expect(smartAllWorkOrderStepsDoneInRoom(steps, room, 't1')).toBe(false);
    room.push(
      roomMsgWithSmartMemberEnd({
        id: 'm3',
        fromRoleId: 'dev',
        content: '**开发已完成**',
        deliverableItems: ['交付物-开发/out.html'],
        roleName: '开发',
        timestamp: 3,
      }),
    );
    expect(smartAllWorkOrderStepsDoneInRoom(steps, room, 't1')).toBe(true);
  });

  it('planSmartProgressNudge stall line lists parallel next executors', () => {
    const now = 500_000;
    const plan = planSmartProgressNudge({
      nowMs: now,
      taskStartedAt: now - 600_000,
      lastTeamActivityAt: now - SMART_STALL_NUDGE_AFTER_MS - 10_000,
      lastNudgeAtMs: null,
      coordinatorRoleId: 'coord',
      coordinatorHasDecomposed: true,
      nextExecutorRoleId: 'cn',
      nextExecutorRoleIds: ['cn', 'us'],
      allStepsDoneInRoom: false,
      deliverablePathsVerified: false,
      coordinatorRepliedSinceKickoff: true,
      teamRoles: smartProgressTeam,
    });
    expect(plan?.kind).toBe('stall_coordinator');
    expect(plan?.roomLine).toMatch(/A股分析、美股分析|美股分析、A股分析/);
  });
});

describe('office collaboration · input validation helpers', () => {
  it('isSmartMemberInputValidationFailureReport detects failure phrases', () => {
    expect(
      isSmartMemberInputValidationFailureReport(
        JSON.stringify({
          role: '开发',
          action: 'help',
          taskUnderstanding: '【输入校验】上游路径不存在，无法 stat',
          deliverable: { items: [], outputValidation: [] },
          dispatch: [{ role: 'PM', task: '请协调' }],
        }),
      ),
    ).toBe(true);
    expect(
      isSmartMemberInputValidationFailureReport(
        JSON.stringify({
          role: '开发',
          action: 'help',
          taskUnderstanding: '无',
          deliverable: { items: [], outputValidation: [] },
          dispatch: [{ role: 'PM', task: '请协调' }],
        }),
      ),
    ).toBe(false);
  });
});

describe('office collaboration · gateway lifecycle benign errors', () => {
  it('isBenignGatewayLifecycleErrorMessage matches restart copy', () => {
    expect(isBenignGatewayLifecycleErrorMessage('Gateway 服务重启中')).toBe(true);
    expect(isBenignGatewayLifecycleErrorMessage('gateway service is restarting')).toBe(true);
    expect(isBenignGatewayLifecycleErrorMessage('model_not_found')).toBe(false);
  });
});

describe('office collaboration · work order resolution', () => {
  it('resolveSmartWorkOrderSteps prefers scenario workflow over task description', () => {
    const fromScenario = resolveSmartWorkOrderSteps(
      parallelScenario,
      '1. 不应采用说明\n2. 忽略',
      team,
    );
    expect(fromScenario).toHaveLength(2);
    expect(fromScenario[0]!.roleIds).toEqual(['cn', 'us']);

    const fromDesc = resolveSmartWorkOrderSteps(
      { workflow: { mode: 'dag', nodes: [], edges: [] } },
      '1. A股分析\n2. 开发',
      [
        { agentId: 'cn', displayName: 'A股分析' },
        { agentId: 'dev', displayName: '开发' },
      ],
    );
    expect(fromDesc[0]!.roleIds).toEqual(['cn']);
    expect(fromDesc[1]!.roleIds).toEqual(['dev']);
  });

  it('resolveSmartWorkOrderSteps returns empty when no workflow or numbered description', () => {
    const steps = resolveSmartWorkOrderSteps(
      { workflow: { mode: 'dag', nodes: [], edges: [] } },
      '无编号步骤的纯描述',
      team,
    );
    expect(steps).toEqual([]);
    const fromScenario = resolveSmartWorkOrderSteps(parallelScenario, '', team);
    expect(fromScenario.length).toBeGreaterThan(0);
  });

  it('validateSmartCoordinatorRoomMentions accepts legacy nextExecutorRoleId only', () => {
    expect(
      validateSmartCoordinatorRoomMentions({
        publishText: '首轮指派。',
        dispatchText: '@A股分析 请开始',
        coordinatorRoleId: 'pm',
        nextExecutorRoleId: 'cn',
        teamRoles: [
          { id: 'pm', name: 'PM' },
          { id: 'cn', name: 'A股分析' },
        ],
      }),
    ).toBe('ok');
  });
});

describe('office collaboration · roster block', () => {
  it('buildSmartTeamMentionRosterBlock dedupes nextExecutorRoleIds', () => {
    const block = buildSmartTeamMentionRosterBlock({
      teamRoles: team,
      coordinatorRoleId: 'pm',
      nextExecutorRoleIds: ['cn', 'us', 'cn'],
      nextExecutorRoleId: 'cn',
    });
    expect(block.match(/可并行 @/u)?.length ?? 0).toBe(1);
    expect(block).toContain('A股分析');
    expect(block).toContain('美股分析');
  });
});
