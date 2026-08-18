import { describe, expect, it } from 'vitest';
import { projectAcpSubagentCards } from '../../src/lib/acp/subagent-projection';
import type { AcpTimelineSnapshot, TimelineItem } from '../../src/lib/acp/timeline-types';

function completionText(sessionKey: string, sessionId: string, task: string, status = 'completed'): string {
  return [
    '[Internal task completion event]',
    'source: task',
    `session_key: ${sessionKey}`,
    `session_id: ${sessionId}`,
    'type: announce',
    `task: ${task}`,
    `status: ${status}`,
    '',
    'the result body',
  ].join('\n');
}

function timeline(items: TimelineItem[]): AcpTimelineSnapshot {
  return {
    sessionId: 'agent:main:main',
    loadGeneration: 0,
    itemOrder: items.map((item) => item.id),
    itemsById: Object.fromEntries(items.map((item) => [item.id, item])),
    metadata: {},
    openMessageSegments: {},
    segmentCounts: {},
  };
}

function msg(id: string, role: 'user' | 'assistant', text: string): TimelineItem {
  return { kind: 'message-segment', id, role, messageId: id, segmentIndex: 0, parts: [{ kind: 'markdown', text }] };
}

describe('projectAcpSubagentCards', () => {
  it('extracts a card per completion event with parsed fields and anchor', () => {
    const tl = timeline([
      msg('u1', 'user', 'do a big task'),
      msg('c1', 'user', completionText('agent:main:subagent:aaa', 'sid-aaa', 'fetch investors')),
    ]);
    const cards = projectAcpSubagentCards(tl);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      sessionKey: 'agent:main:subagent:aaa',
      sessionId: 'sid-aaa',
      agentId: 'main',
      task: 'fetch investors',
      status: 'completed',
      anchorItemId: 'c1',
    });
  });

  it('ignores ordinary messages without the completion marker', () => {
    const tl = timeline([msg('m1', 'assistant', 'session_key: not-a-completion')]);
    expect(projectAcpSubagentCards(tl)).toEqual([]);
  });

  it('deduplicates by session key, keeping the latest anchor', () => {
    const tl = timeline([
      msg('c1', 'user', completionText('agent:main:subagent:aaa', 'sid-aaa', 'first')),
      msg('c2', 'user', completionText('agent:main:subagent:aaa', 'sid-aaa', 'retry')),
    ]);
    const cards = projectAcpSubagentCards(tl);
    expect(cards).toHaveLength(1);
    expect(cards[0].anchorItemId).toBe('c2');
    expect(cards[0].task).toBe('retry');
  });

  it('skips completion events missing session_key/session_id', () => {
    const tl = timeline([msg('c1', 'user', '[Internal task completion event]\ntask: orphan')]);
    expect(projectAcpSubagentCards(tl)).toEqual([]);
  });
});
