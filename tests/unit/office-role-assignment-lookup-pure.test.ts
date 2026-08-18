import { describe, expect, it } from 'vitest';
import {
  countSmartCoordinatorKickoffDecompositionsInRoom,
  isSmartCoordKickoffTriggerMessageId,
  isSmartCoordinatorKickoffDecompositionText,
  isSmartCoordinatorKickoffRedispatchInRoom,
  isUnassignedAssignmentText,
  shouldSkipStaleSmartKickoffMemberDispatch,
  smartCoordinatorHasDecomposedInRoom,
  smartCoordinatorNeedsDecomposition,
  smartCoordinatorReplyDispatchesMembers,
} from '../../electron/services/office/role-assignment-lookup';
import type { RoomMessage } from '../../electron/services/office/types';

const KICKOFF_TEXT = '项目正式启动。【任务1】开发模块实现';

function room(partial: Partial<RoomMessage> & Pick<RoomMessage, 'id' | 'content'>): RoomMessage {
  return {
    groupId: 'g1',
    projectId: 'p1',
    from: 'agent',
    fromAgentId: 'agent-pm',
    mentions: [],
    timestamp: Date.now(),
    ...partial,
  };
}

describe('role-assignment-lookup pure helpers', () => {
  it('detects unassigned assignment text', () => {
    expect(isUnassignedAssignmentText('无')).toBe(true);
    expect(isUnassignedAssignmentText('  待分配  ')).toBe(true);
    expect(isUnassignedAssignmentText('@开发 实现登录模块')).toBe(false);
  });

  it('recognizes smart kickoff trigger message ids', () => {
    expect(isSmartCoordKickoffTriggerMessageId('room-123-smart-coord-kickoff')).toBe(true);
    expect(isSmartCoordKickoffTriggerMessageId('room-123-mention')).toBe(false);
  });

  it('detects kickoff decomposition text and room history', () => {
    expect(isSmartCoordinatorKickoffDecompositionText(KICKOFF_TEXT)).toBe(true);
    const messages = [room({ id: 'room-1-smart-coord-kickoff', content: KICKOFF_TEXT })];
    expect(countSmartCoordinatorKickoffDecompositionsInRoom(messages, 'agent-pm', 'p1')).toBe(1);
    expect(smartCoordinatorHasDecomposedInRoom(messages, 'agent-pm', 'p1')).toBe(true);
    expect(
      smartCoordinatorNeedsDecomposition(null, {
        roomMessages: messages,
        projectId: 'p1',
        coordinatorAgentId: 'agent-pm',
      }),
    ).toBe(false);
  });

  it('detects coordinator dispatch to members in structured reply', () => {
    const raw = JSON.stringify({
      role: 'PM',
      taskUnderstanding: '派开发执行',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: '无' },
      roomReply: '请开发继续实现。',
      action: 'assign',
      dispatch: [{ role: '开发', task: '@开发 请实现模块。' }],
    });
    expect(
      smartCoordinatorReplyDispatchesMembers(raw, 'agent-pm', [
        { agentId: 'agent-pm', displayName: 'PM' },
        { agentId: 'agent-dev', displayName: '开发' },
      ]),
    ).toBe(true);
  });

  it('skips stale kickoff member dispatch after substantive report', () => {
    const messages = [
      room({ id: 'room-1-smart-coord-kickoff', content: KICKOFF_TEXT, timestamp: 1 }),
      room({
        id: 'm-report',
        fromAgentId: 'agent-dev',
        content: '【开发汇报】模块已实现并通过自测。',
        timestamp: 2,
      }),
    ];
    expect(
      shouldSkipStaleSmartKickoffMemberDispatch({
        triggerMsgId: 'room-1-smart-coord-kickoff',
        memberAgentId: 'agent-dev',
        roomMessages: messages,
        coordinatorAgentId: 'agent-pm',
        projectId: 'p1',
      }),
    ).toBe(true);
  });

  it('detects kickoff redispatch in room', () => {
    const messages = [
      room({ id: 'k1', content: KICKOFF_TEXT, timestamp: 1 }),
      room({ id: 'k2', content: '项目正式启动。【任务2】调整分工', timestamp: 2 }),
    ];
    expect(isSmartCoordinatorKickoffRedispatchInRoom(messages, 'agent-pm', 'p1')).toBe(true);
  });

  it('smartCoordinatorNeedsDecomposition respects notebook assignments', () => {
    expect(
      smartCoordinatorNeedsDecomposition({
        coordinatorSummary: '@开发 请实现登录模块并完成自测。',
        roles: { 'agent-dev': '实现登录模块' },
      }),
    ).toBe(false);
    expect(
      smartCoordinatorNeedsDecomposition({
        coordinatorSummary: '无',
        roles: { 'agent-dev': '待分配' },
      }),
    ).toBe(true);
    expect(
      smartCoordinatorNeedsDecomposition(null, {
        roomMessages: [room({ id: 'room-1-smart-coord-kickoff', content: KICKOFF_TEXT })],
        coordinatorAgentId: 'agent-pm',
        projectId: 'p1',
      }),
    ).toBe(false);
  });
});
