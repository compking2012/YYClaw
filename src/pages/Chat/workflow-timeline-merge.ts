/**
 * Interleave workflow-card render blocks into the ACP display groups for the
 * Chat conversation.
 *
 * This is a RENDER-ONLY concern: workflow cards remain sourced solely from the
 * fork's `workflowCardsBySession` store and are never inserted into the ACP
 * timeline store (`acpTimeline.itemsById`/`itemOrder`). We only decide, at
 * render time, WHERE each card's block appears relative to the ACP groups so an
 * engine (single-agent) workflow turn — whose user message + synthesized reply
 * live only on the card — renders in its correct chronological position instead
 * of pinned at the end.
 */
import type { AcpTimelineDisplayGroup } from '@/lib/acp/timeline-groups';
import type { WorkflowCardRef } from '@/types/workflow';

export type ConversationBlock =
  | { kind: 'acp-group'; key: string; group: AcpTimelineDisplayGroup }
  | { kind: 'workflow-card'; key: string; card: WorkflowCardRef };

/** Stable synthetic id for an engine card's final synthesized reply bubble. */
export function workflowFinalMessageId(runId: string): string {
  return `wf-final-${runId}`;
}

function groupContainsItem(group: AcpTimelineDisplayGroup, itemId: string): boolean {
  return group.items.some((item) => item.id === itemId);
}

/**
 * The insertion slot for a card, in `0..groups.length`, where slot `s` means
 * "render this card just before ACP group `s`" (slot `groups.length` = after
 * the last group):
 *  - no anchor            → slot 0 (before all groups; the engine no-history case)
 *  - anchor found at i    → slot i + 1 (immediately after its trigger group)
 *  - anchor set, not found → slot groups.length (a pruned anchor sorts to the end)
 */
function cardSlot(groups: AcpTimelineDisplayGroup[], card: WorkflowCardRef): number {
  if (!card.acpAnchorItemId) return 0;
  for (let i = 0; i < groups.length; i += 1) {
    if (groupContainsItem(groups[i], card.acpAnchorItemId)) return i + 1;
  }
  return groups.length;
}

/**
 * Build the ordered render sequence of ACP groups and workflow-card blocks.
 * Cards sharing a slot keep `createdAt` order. Stable and pure.
 */
export function buildConversationBlocks(
  groups: AcpTimelineDisplayGroup[],
  cards: WorkflowCardRef[],
): ConversationBlock[] {
  if (cards.length === 0) {
    return groups.map((group) => ({ kind: 'acp-group', key: group.id, group }));
  }

  const bySlot = new Map<number, WorkflowCardRef[]>();
  for (const card of cards) {
    const slot = cardSlot(groups, card);
    const bucket = bySlot.get(slot);
    if (bucket) bucket.push(card);
    else bySlot.set(slot, [card]);
  }
  for (const bucket of bySlot.values()) bucket.sort((a, b) => a.createdAt - b.createdAt);

  const out: ConversationBlock[] = [];
  const pushCards = (slot: number) => {
    for (const card of bySlot.get(slot) ?? []) {
      // Key on the stable messageId (preserved across a provisional→real
      // promotion) rather than runId, so promoting the card updates in place
      // instead of remounting — the query bubble never flickers.
      out.push({ kind: 'workflow-card', key: card.messageId, card });
    }
  };

  for (let i = 0; i < groups.length; i += 1) {
    pushCards(i);
    out.push({ kind: 'acp-group', key: groups[i].id, group: groups[i] });
  }
  pushCards(groups.length);
  return out;
}
