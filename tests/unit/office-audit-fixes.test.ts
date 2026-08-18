import { describe, expect, it } from 'vitest';
import { roomMessageFromAgentMatches } from '../../src/lib/office-agent-id-resolve';
import { validateSmartCoordinatorRoomMentions } from '../../src/lib/office-smart-coordinator-dispatch';
import { filterMissingMentionTargetsWithRecentHandoffs } from '../../electron/services/office/room-missing-mention-coordinator';
import type { RoomMessage } from '../../electron/services/office/types';

const team = [
  { agentId: 'agent-writer', displayName: 'Writer', id: 'legacy-writer' },
  { agentId: 'agent-coord', displayName: 'Coord' },
];

function msg(partial: Partial<RoomMessage> & Pick<RoomMessage, 'id' | 'content'>): RoomMessage {
  return {
    groupId: 'g1',
    projectId: 'p1',
    from: 'agent',
    mentions: [],
    timestamp: Date.now(),
    ...partial,
  };
}

describe('office audit fixes — mention identity & kickoff gates', () => {
  it('dedupes handoff when mentions use legacy role id tokens', () => {
    const trigger = msg({
      id: 't1',
      fromAgentId: 'agent-writer',
      timestamp: 10_000,
      content: 'Writer 提到了 Coord 但没 @',
    });
    const handoff = msg({
      id: 'h1',
      fromAgentId: 'agent-writer',
      timestamp: 10_500,
      phase: 'task_handoff',
      content: '@Coord 请继续',
      mentions: ['legacy-coord'],
    });
    const missing = filterMissingMentionTargetsWithRecentHandoffs(
      [trigger, handoff],
      trigger,
      team,
      [{ agentId: 'agent-coord', displayName: 'Coord', id: 'legacy-coord' }],
    );
    expect(missing).toHaveLength(0);
  });

  it('rejects kickoff dispatch with @all before work order is materialized', () => {
    expect(
      validateSmartCoordinatorRoomMentions({
        publishText: '请全员并行启动分析任务并汇报。',
        dispatchText: '@all 请并行执行。',
        coordinatorAgentId: 'agent-pm',
        teamRoles: [
          { agentId: 'agent-pm', displayName: 'PM' },
          { agentId: 'agent-a', displayName: 'A' },
        ],
        kickoffMentionRelaxed: true,
        raw: JSON.stringify({ action: 'assign', dispatch: [] }),
      }),
    ).toBe('broadcast_before_project_complete');
  });

  it('matches Smart closure anchor via legacy fromRoleId on roster', () => {
    expect(
      roomMessageFromAgentMatches(
        {
          from: 'agent',
          fromRoleId: 'legacy-coord',
          smartCoordinatorEnd: true,
          content: '项目结束',
        },
        'agent-coord',
        [{ agentId: 'agent-coord', id: 'legacy-coord', displayName: 'Coord' }],
      ),
    ).toBe(true);
  });
});
