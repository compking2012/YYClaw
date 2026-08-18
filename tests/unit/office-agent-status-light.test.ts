import { describe, it, expect } from 'vitest';
import {
  deriveProjectAgentLights,
  deriveRoomMessageAgentLight,
  resolveOfficeRoomBubbleLight,
} from '../../src/lib/office-scenario-role-activity';
import { isRoomFastAckSuperseded } from '../../src/lib/office-room-fast-ack';
import { officeProjectStatusLightBubbleStyle } from '../../src/lib/office-project-status-light';
import {
  roomMessageAuthorPlainLabel,
  roomMessageFromCoordinator,
} from '../../src/lib/office-room-reply';
import {
  stripRoomAgentIconFromContent,
  stripRoomAgentIconPrefix,
} from '../../src/lib/office-room-reply-format';
import type { OfficeFixedGroup, OfficeTempProject, NodeRunStatus } from '../../src/types/office';

const NODES = [
  { id: 'gen-0', roleId: 'A', title: '挖掘', execution: 'serial' as const },
  { id: 'gen-1', roleId: 'B', title: '撰写', execution: 'serial' as const },
  { id: 'gen-2', roleId: 'C', title: '审查', execution: 'serial' as const },
];
const EDGES = [
  { from: 'gen-0', to: 'gen-1', when: 'on_success' as const },
  { from: 'gen-1', to: 'gen-2', when: 'on_success' as const },
];

function project(
  status: OfficeTempProject['status'],
  runs: Array<{ nodeId: string; roleId: string; status: NodeRunStatus }>,
): OfficeTempProject {
  return {
    id: 'p1',
    title: 'T',
    status,
    executionMode: 'workflow',
    workflow: { mode: 'dag', nodes: NODES, edges: EDGES },
    nodeRuns: runs,
    agentIds: ['A', 'B', 'C'],
  } as unknown as OfficeTempProject;
}

const GROUP = { id: 'g1', workflow: { nodes: NODES, edges: EDGES } } as unknown as OfficeFixedGroup;

describe('deriveProjectAgentLights (req ②: per-agent status light in group chat)', () => {
  it('running project: completed→蓝, running→绿, pending→灰', () => {
    const lights = deriveProjectAgentLights(
      project('running', [
        { nodeId: 'gen-0', roleId: 'A', status: 'completed' },
        { nodeId: 'gen-1', roleId: 'B', status: 'running' },
        { nodeId: 'gen-2', roleId: 'C', status: 'pending' },
      ]),
      GROUP,
      [],
    );
    expect(lights.get('A')).toBe('completed');
    expect(lights.get('B')).toBe('running');
    expect(lights.get('C')).toBe('pending');
  });

  it('failed node → failed(红); running takes precedence over completed', () => {
    const lights = deriveProjectAgentLights(
      project('running', [
        { nodeId: 'gen-0', roleId: 'A', status: 'failed' },
        { nodeId: 'gen-1', roleId: 'B', status: 'running' },
        { nodeId: 'gen-2', roleId: 'C', status: 'completed' },
      ]),
      GROUP,
      [],
    );
    expect(lights.get('A')).toBe('failed');
    expect(lights.get('B')).toBe('running');
    expect(lights.get('C')).toBe('completed');
  });

  it('aborted project: uncompleted agent→黄(aborted), completed agent stays 蓝', () => {
    const lights = deriveProjectAgentLights(
      project('aborted', [
        { nodeId: 'gen-0', roleId: 'A', status: 'completed' },
        { nodeId: 'gen-1', roleId: 'B', status: 'pending' },
        { nodeId: 'gen-2', roleId: 'C', status: 'pending' },
      ]),
      GROUP,
      [],
    );
    expect(lights.get('A')).toBe('completed');
    expect(lights.get('B')).toBe('aborted');
    expect(lights.get('C')).toBe('aborted');
  });

  it('node-less workflow with no room → per-member 灰(pending)', () => {
    const p = { ...project('running', []), workflow: { mode: 'dag', nodes: [], edges: [] } } as unknown as OfficeTempProject;
    const g = { id: 'g1', workflow: { nodes: [], edges: [] } } as unknown as OfficeFixedGroup;
    const lights = deriveProjectAgentLights(p, g, []);
    expect(lights.get('A')).toBe('pending');
    expect(lights.get('B')).toBe('pending');
    expect(lights.get('C')).toBe('pending');
  });
});

function smartProject(status: OfficeTempProject['status']): OfficeTempProject {
  return {
    id: 'sp1',
    title: 'Smart',
    status,
    executionMode: 'smart',
    workflow: { mode: 'dag', nodes: [], edges: [] },
    nodeRuns: [],
    agentIds: ['A', 'B', 'C'],
  } as unknown as OfficeTempProject;
}

function room(fromAgentId: string, phase: string, timestamp: number) {
  return {
    id: `${fromAgentId}-${timestamp}`,
    projectId: 'sp1',
    from: 'role',
    fromAgentId,
    phase,
    content: 'x',
    timestamp,
  } as unknown as import('../../src/types/office').RoomMessage;
}

describe('deriveProjectAgentLights — Smart mode (per-member latest room phase)', () => {
  it('smart running: deliver→蓝, running→绿, no-message→灰; group optional (null)', () => {
    const lights = deriveProjectAgentLights(
      smartProject('running'),
      null,
      [
        room('A', 'task_running', 1),
        room('A', 'task_deliver', 2),
        room('B', 'task_running', 3),
      ],
    );
    expect(lights.get('A')).toBe('completed');
    expect(lights.get('B')).toBe('running');
    expect(lights.get('C')).toBe('pending');
  });

  it('smart aborted: not-yet-started member → 黄(aborted)', () => {
    const lights = deriveProjectAgentLights(smartProject('aborted'), undefined, [
      room('A', 'task_deliver', 1),
    ]);
    expect(lights.get('A')).toBe('completed');
    expect(lights.get('B')).toBe('aborted');
    expect(lights.get('C')).toBe('aborted');
  });

  it('ignores other-project + system/user room lines', () => {
    const lights = deriveProjectAgentLights(smartProject('running'), null, [
      { ...room('A', 'task_deliver', 1), projectId: 'other' } as never,
      { ...room('B', 'task_running', 2), from: 'system' } as never,
    ]);
    expect(lights.get('A')).toBe('pending');
    expect(lights.get('B')).toBe('pending');
  });
});

describe('officeProjectStatusLightBubbleStyle (group-chat message tint)', () => {
  it('maps each light to a distinct border+background hex (bg alpha 1a, border alpha 55)', () => {
    expect(officeProjectStatusLightBubbleStyle('running')).toEqual({
      backgroundColor: '#10b9811a',
      borderColor: '#10b98155',
    });
    expect(officeProjectStatusLightBubbleStyle('completed')).toEqual({
      backgroundColor: '#0ea5e91a',
      borderColor: '#0ea5e955',
    });
    expect(officeProjectStatusLightBubbleStyle('failed')).toEqual({
      backgroundColor: '#ef44441a',
      borderColor: '#ef444455',
    });
    expect(officeProjectStatusLightBubbleStyle('aborted').backgroundColor).toBe('#fbbf241a');
    expect(officeProjectStatusLightBubbleStyle('blocked').backgroundColor).toBe('#fbbf241a');
    expect(officeProjectStatusLightBubbleStyle('awaiting_review').backgroundColor).toBe('#8b5cf61a');
    expect(officeProjectStatusLightBubbleStyle('pending').backgroundColor).toBe('#94a3b81a');
  });
});

function workflowRoom(
  fromAgentId: string,
  phase: import('../../src/types/office').RoomMessagePhase,
  nodeId: string,
  extra?: Partial<import('../../src/types/office').RoomMessage>,
): import('../../src/types/office').RoomMessage {
  return {
    id: `${fromAgentId}-${nodeId}-${phase}`,
    projectId: 'p1',
    from: fromAgentId,
    fromAgentId,
    phase,
    nodeId,
    content: 'x',
    timestamp: Date.now(),
    mentions: [],
    ...extra,
  };
}

describe('deriveRoomMessageAgentLight (per-message bubble tint)', () => {
  it('same agent on two nodes: old deliver stays 蓝, new running stays 绿', () => {
    const p = project('running', [
      { nodeId: 'gen-0', roleId: 'A', status: 'completed' },
      { nodeId: 'gen-1', roleId: 'A', status: 'running' },
      { nodeId: 'gen-2', roleId: 'C', status: 'pending' },
    ]);
    const oldDeliver = workflowRoom('A', 'task_deliver', 'gen-0');
    const newRunning = workflowRoom('A', 'task_running', 'gen-1');
    expect(deriveRoomMessageAgentLight(oldDeliver, p, GROUP)).toBe('completed');
    expect(deriveRoomMessageAgentLight(newRunning, p, GROUP)).toBe('running');
  });

  it('consolidated progress line: 执行完成 → 蓝 even when phase is task_running', () => {
    const p = project('running', [{ nodeId: 'gen-0', roleId: 'A', status: 'completed' }]);
    const msg = workflowRoom('A', 'task_running', 'gen-0', { progressText: '执行完成' });
    expect(deriveRoomMessageAgentLight(msg, p, GROUP)).toBe('completed');
  });

  it('执行失败 on coordinator message stays red (bubble light must not force completed)', () => {
    const p = project('failed', [{ nodeId: 'gen-0', roleId: 'coord', status: 'failed' }]);
    const msg = workflowRoom('coord', 'task_running', 'gen-0', {
      progressText: '执行失败：网关/终端发生重启（stopped）',
    });
    expect(deriveRoomMessageAgentLight(msg, p, GROUP)).toBe('failed');
    expect(
      resolveOfficeRoomBubbleLight({
        message: msg,
        isCoordinatorMessage: true,
        project: p,
        group: GROUP,
      }),
    ).toBe('failed');
    expect(
      resolveOfficeRoomBubbleLight({
        message: workflowRoom('coord', 'task_handoff', 'gen-0'),
        isCoordinatorMessage: true,
        project: p,
        group: GROUP,
      }),
    ).toBe('completed');
  });

  it('回流进度短终态 does not tint red (business control flow)', () => {
    const p = project('running', [{ nodeId: 'gen-6', roleId: 'A', status: 'pending' }]);
    const msg = workflowRoom('A', 'task_running', 'gen-6', {
      progressText: '已回流上游，等待重做',
    });
    expect(deriveRoomMessageAgentLight(msg, p, GROUP)).toBe('pending');
  });

  it('legacy misleading abort progress + pending node does not stay red', () => {
    const p = project('running', [{ nodeId: 'gen-6', roleId: 'A', status: 'pending' }]);
    const msg = workflowRoom('A', 'task_running', 'gen-6', {
      progressText:
        '执行失败：任务执行被中断（可能因网关重启或重新执行覆盖，请稍后点击续跑）',
    });
    expect(deriveRoomMessageAgentLight(msg, p, GROUP)).toBe('pending');
  });

  it('legacy misleading abort progress + failed node stays red (true hard fail)', () => {
    const p = project('failed', [{ nodeId: 'gen-6', roleId: 'A', status: 'failed' }]);
    const msg = workflowRoom('A', 'task_running', 'gen-6', {
      progressText:
        '执行失败：任务执行被中断（可能因网关重启或重新执行覆盖，请稍后点击续跑）',
    });
    expect(deriveRoomMessageAgentLight(msg, p, GROUP)).toBe('failed');
  });

  it('Smart: each message uses its own phase, not latest per agent', () => {
    const p = smartProject('running');
    const done = room('A', 'task_deliver', 1);
    const running = room('A', 'task_running', 2);
    expect(deriveRoomMessageAgentLight(done, p, null)).toBe('completed');
    expect(deriveRoomMessageAgentLight(running, p, null)).toBe('running');
  });

  it('aborted project: in-flight task_received on unfinished node → 黄', () => {
    const p = project('aborted', [
      { nodeId: 'gen-0', roleId: 'A', status: 'completed' },
      { nodeId: 'gen-1', roleId: 'B', status: 'pending' },
    ]);
    const recv = workflowRoom('B', 'task_received', 'gen-1');
    expect(deriveRoomMessageAgentLight(recv, p, GROUP)).toBe('aborted');
  });

  it('fast ack stays 绿 until substantive reply, then turns 蓝', () => {
    const p = smartProject('running');
    const triggerId = 'user-mention-1';
    const roundId = 'round-abc';
    const roleId = 'illustrator-role';
    const agentId = 'illustrator-agent';
    const fastAck = {
      id: `room-ack-${roundId}-${roleId}`,
      projectId: 'sp1',
      from: agentId,
      fromAgentId: agentId,
      phase: 'task_clarification',
      content: 'OK，待我思考下',
      timestamp: 100,
      replyToId: triggerId,
    } as import('../../src/types/office').RoomMessage;
    const formal = {
      id: `room-mention-${roundId}-${roleId}`,
      projectId: 'sp1',
      from: agentId,
      fromAgentId: agentId,
      phase: 'task_running',
      content: '依据漫画剧本绘制10页插画…',
      timestamp: 200,
      replyToId: triggerId,
    } as import('../../src/types/office').RoomMessage;
    const projectRoom = [fastAck];

    expect(deriveRoomMessageAgentLight(fastAck, p, null, projectRoom)).toBe('running');
    expect(deriveRoomMessageAgentLight(fastAck, p, null, [fastAck, formal])).toBe('completed');
    expect(deriveRoomMessageAgentLight(formal, p, null, [fastAck, formal])).toBe('running');
  });
});

describe('isRoomFastAckSuperseded', () => {
  const roundId = 'shared-coord-thread';
  const roleId = 'illustrator-role';
  const agentId = 'illustrator-agent';
  const triggerId = 'coord-assign';

  function ack(timestamp: number) {
    return {
      id: `room-ack-${roundId}-${roleId}`,
      projectId: 'sp1',
      from: agentId,
      fromAgentId: agentId,
      content: 'OK，待我思考下',
      timestamp,
      replyToId: triggerId,
    } as import('../../src/types/office').RoomMessage;
  }

  function formal(timestamp: number, projectId = 'sp1') {
    return {
      id: `room-mention-${roundId}-${roleId}`,
      projectId,
      from: agentId,
      fromAgentId: agentId,
      content: '依据漫画剧本绘制10页插画…',
      timestamp,
      replyToId: triggerId,
    } as import('../../src/types/office').RoomMessage;
  }

  it('paired formal newer than ack → superseded', () => {
    const fastAck = ack(100);
    expect(isRoomFastAckSuperseded(fastAck, [fastAck, formal(200)])).toBe(true);
  });

  it('paired formal older than ack (round id reused) → not superseded', () => {
    const fastAck = ack(300);
    expect(isRoomFastAckSuperseded(fastAck, [formal(200), fastAck])).toBe(false);
  });

  it('paired formal same timestamp as ack → superseded', () => {
    const fastAck = ack(200);
    expect(isRoomFastAckSuperseded(fastAck, [fastAck, formal(200)])).toBe(true);
  });

  it('does not supersede via replyToId when room-ack id has no paired formal yet', () => {
    const fastAck = ack(400);
    const stale = {
      ...formal(200),
      id: 'room-mention-other-round-role',
    } as import('../../src/types/office').RoomMessage;
    expect(isRoomFastAckSuperseded(fastAck, [stale, fastAck])).toBe(false);
  });

  it('ignores formal replies from another project', () => {
    const fastAck = ack(100);
    expect(isRoomFastAckSuperseded(fastAck, [fastAck, formal(200, 'other-project')])).toBe(false);
  });
});

describe('group-chat display helpers', () => {
  it('stripRoomAgentIconFromContent removes emoji + 【name】 from first line', () => {
    expect(
      stripRoomAgentIconFromContent('🤖 【PPT美化师】📥 收到任务 · PPT制作'),
    ).toBe('📥 收到任务 · PPT制作');
    expect(stripRoomAgentIconPrefix('📋 【协调者】🚀 任务开始')).toBe('🚀 任务开始');
  });

  it('roomMessageAuthorPlainLabel omits emoji; coordinator detection', () => {
    const members = [{ agentId: 'coord', displayName: '协调者', emoji: '📋' }];
    const msg = {
      from: 'coord',
      fromAgentId: 'coord',
      content: 'x',
    } as import('../../src/types/office').RoomMessage;
    expect(
      roomMessageAuthorPlainLabel(msg, members, { user: 'You', system: 'System' }),
    ).toBe('协调者');
    expect(roomMessageFromCoordinator(msg, 'coord')).toBe(true);
    expect(roomMessageFromCoordinator(msg, 'other')).toBe(false);
  });
});
