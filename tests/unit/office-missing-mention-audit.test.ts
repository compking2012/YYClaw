import { describe, expect, it } from 'vitest';
import type { RoomMessage } from '../../electron/services/office/types';
import {
  filterMissingMentionTargetsWithRecentHandoffs,
  shouldAuditRoleMessageForMissingMentions,
} from '../../electron/services/office/room-missing-mention-coordinator';

const team = [
  { agentId: 'coord', displayName: 'Coord' },
  { agentId: 'writer', displayName: 'Writer' },
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

describe('missing mention audit — fromAgentId migration', () => {
  it('audits agent posts that only carry fromAgentId (no legacy fromRoleId)', () => {
    const line = msg({
      id: 'm1',
      fromAgentId: 'writer',
      content: '请 Writer 帮忙看一下文档里提到的协调者部分',
    });
    expect(shouldAuditRoleMessageForMissingMentions(line)).toBe(true);
  });

  it('skips system and short lines', () => {
    expect(
      shouldAuditRoleMessageForMissingMentions(
        msg({ id: 's1', from: 'system', content: '系统通知足够长的一行文字' }),
      ),
    ).toBe(false);
    expect(
      shouldAuditRoleMessageForMissingMentions(
        msg({ id: 's2', fromAgentId: 'writer', content: '短' }),
      ),
    ).toBe(false);
  });

  it('dedupes missing targets when recent handoff used fromAgentId', () => {
    const trigger = msg({
      id: 't1',
      fromAgentId: 'writer',
      timestamp: 10_000,
      content: 'Writer 提到了 Coord 但没 @',
    });
    const handoff = msg({
      id: 'h1',
      fromAgentId: 'writer',
      timestamp: 10_500,
      phase: 'task_handoff',
      content: '@Coord 请继续',
      mentions: ['coord'],
    });
    const missing = filterMissingMentionTargetsWithRecentHandoffs(
      [trigger, handoff],
      trigger,
      team,
      [{ agentId: 'coord', displayName: 'Coord' }],
    );
    expect(missing).toHaveLength(0);
  });

  it('audits posts that only carry legacy fromRoleId', () => {
    expect(
      shouldAuditRoleMessageForMissingMentions(
        msg({
          id: 'legacy-1',
          fromRoleId: 'writer',
          content: '请 Writer 帮忙看一下文档里提到的协调者部分',
        }),
      ),
    ).toBe(true);
  });
});
