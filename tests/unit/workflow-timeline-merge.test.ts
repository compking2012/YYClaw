import { describe, expect, it } from 'vitest';
import { buildConversationBlocks } from '../../src/pages/Chat/workflow-timeline-merge';
import type { AcpTimelineDisplayGroup } from '../../src/lib/acp/timeline-groups';
import type { WorkflowCardRef } from '../../src/types/workflow';

function userGroup(id: string, itemIds: string[]): AcpTimelineDisplayGroup {
  return {
    kind: 'user',
    id,
    items: itemIds.map((itemId) => ({
      kind: 'message-segment',
      id: itemId,
      role: 'user',
      messageId: itemId,
      segmentIndex: 0,
      parts: [],
    })),
    attachments: [],
  };
}

function card(runId: string, createdAt: number, acpAnchorItemId?: string): WorkflowCardRef {
  return {
    runId,
    messageId: `wf-card-${runId}`,
    userMessageId: `wf-user-${runId}`,
    userText: runId,
    title: runId,
    steps: [],
    status: 'done',
    createdAt,
    acpAnchorItemId,
    source: 'engine',
  };
}

function keys(groups: AcpTimelineDisplayGroup[], cards: WorkflowCardRef[]): string[] {
  return buildConversationBlocks(groups, cards).map((block) =>
    block.kind === 'acp-group' ? `g:${block.group.id}` : `c:${block.card.runId}`,
  );
}

describe('buildConversationBlocks', () => {
  it('returns only ACP groups when there are no cards', () => {
    const groups = [userGroup('g1', ['a']), userGroup('g2', ['b'])];
    expect(keys(groups, [])).toEqual(['g:g1', 'g:g2']);
  });

  it('places an anchorless card before all groups (engine no-history case)', () => {
    const groups = [userGroup('g1', ['a'])];
    expect(keys(groups, [card('r1', 1)])).toEqual(['c:r1', 'g:g1']);
  });

  it('renders a pure-engine turn as the whole conversation when there are no groups', () => {
    expect(keys([], [card('r1', 1)])).toEqual(['c:r1']);
  });

  it('splices a card immediately after the group holding its anchor item', () => {
    const groups = [userGroup('g1', ['a']), userGroup('g2', ['b'])];
    expect(keys(groups, [card('r1', 1, 'a')])).toEqual(['g:g1', 'c:r1', 'g:g2']);
  });

  it('sorts a card with an unknown/pruned anchor to the end', () => {
    const groups = [userGroup('g1', ['a'])];
    expect(keys(groups, [card('r1', 1, 'missing')])).toEqual(['g:g1', 'c:r1']);
  });

  it('keeps cards sharing a slot in createdAt order', () => {
    const groups = [userGroup('g1', ['a'])];
    const later = card('later', 20, 'a');
    const earlier = card('earlier', 10, 'a');
    expect(keys(groups, [later, earlier])).toEqual(['g:g1', 'c:earlier', 'c:later']);
  });

  it('interleaves multiple cards across their respective anchors', () => {
    const groups = [userGroup('g1', ['a']), userGroup('g2', ['b'])];
    const cards = [card('c-pre', 1), card('c-mid', 2, 'a'), card('c-end', 3, 'b')];
    expect(keys(groups, cards)).toEqual(['c:c-pre', 'g:g1', 'c:c-mid', 'g:g2', 'c:c-end']);
  });

  it('keys the workflow-card block on messageId so a provisional→real promotion is stable', () => {
    const groups = [userGroup('g1', ['a'])];
    // A provisional card and its promoted counterpart share messageId/createdAt/
    // anchor but differ in runId. They must occupy the same slot AND produce the
    // same block key, so promotion updates in place without a remount.
    const provisional: WorkflowCardRef = {
      ...card('wf-pending-s-1', 5, 'a'),
      messageId: 'wf-card-stable',
      status: 'running',
      pending: true,
    };
    const promoted: WorkflowCardRef = {
      ...card('run-real', 5, 'a'),
      messageId: 'wf-card-stable',
      status: 'running',
    };

    const before = buildConversationBlocks(groups, [provisional]);
    const after = buildConversationBlocks(groups, [promoted]);
    const cardBefore = before.find((b) => b.kind === 'workflow-card');
    const cardAfter = after.find((b) => b.kind === 'workflow-card');

    expect(cardBefore?.key).toBe('wf-card-stable');
    expect(cardAfter?.key).toBe('wf-card-stable');
    // Same position in the sequence (after g1) before and after promotion.
    expect(before.map((b) => b.kind)).toEqual(after.map((b) => b.kind));
  });
});
