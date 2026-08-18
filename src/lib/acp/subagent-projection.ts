/**
 * Subagent-card projection over the ACP timeline.
 *
 * When the agent delegates work through its Task tool, OpenClaw runs each
 * subagent in an internal `subagent:` session that is filtered out of the
 * sidebar (see `shared/subagent-session.ts`). To keep that work visible, we
 * surface each COMPLETED subagent as a compact card inlined into the PARENT
 * conversation, anchored to the completion event.
 *
 * This module is read-only and pure (mirroring
 * `observed-workflow-projection.ts` / `openclaw-file-activities.ts`): it never
 * mutates the ACP timeline; it only reads the reduced snapshot and derives the
 * cards. The caller interleaves them into the render blocks and offers a
 * drill-down into the subagent transcript via `sessions.history`.
 *
 * ── Completion-event shape (verified against OpenClaw
 * `subagent-announce-origin`) ── the parent session receives an injected
 * message whose text begins with `[Internal task completion event]` followed by
 * `key: value` lines:
 *   [Internal task completion event]
 *   source: <source>
 *   session_key: <the subagent's session key>
 *   session_id: <the subagent's transcript uuid>
 *   type: <announce type>
 *   task: <task label>
 *   status: <status label>
 *
 *   <result>
 */
import { parseAgentIdFromSessionKey } from '@/pages/Chat/task-visualization';
import type { AcpTimelineSnapshot, MessageSegmentItem } from './timeline-types';

export type AcpSubagentCard = {
  /** The subagent's (internal) session key — the drill-down target. */
  sessionKey: string;
  /** The subagent's transcript uuid, as reported by the completion event. */
  sessionId: string;
  /** Agent id parsed from the namespaced session key, when present. */
  agentId: string | null;
  /** Human-readable task label from the completion event, when present. */
  task?: string;
  /** Status label from the completion event (e.g. "completed"), when present. */
  status?: string;
  /** Timeline item id of the completion message — the interleave anchor. */
  anchorItemId: string;
};

const COMPLETION_MARKER = '[Internal task completion event]';

/** Flatten a message segment's markdown parts into plain text. */
function segmentText(item: MessageSegmentItem): string {
  return item.parts
    .filter((part): part is Extract<typeof part, { kind: 'markdown' }> => part.kind === 'markdown')
    .map((part) => part.text)
    .join('\n');
}

/** First `field: value` line's trimmed value, or undefined. */
function field(text: string, name: string): string | undefined {
  const match = text.match(new RegExp(`(?:^|\\n)\\s*${name}:\\s*(.+)`));
  return match?.[1]?.trim() || undefined;
}

/**
 * Derive one card per completed subagent from the ACP timeline, in timeline
 * order. A message is a completion event when its flattened text contains the
 * marker and carries both `session_key` and `session_id`. De-duplicated by
 * session key (the latest completion event for a key wins its anchor).
 */
export function projectAcpSubagentCards(timeline: AcpTimelineSnapshot): AcpSubagentCard[] {
  const byKey = new Map<string, AcpSubagentCard>();
  for (const itemId of timeline.itemOrder) {
    const item = timeline.itemsById[itemId];
    if (!item || item.kind !== 'message-segment') continue;
    const text = segmentText(item);
    if (!text.includes(COMPLETION_MARKER)) continue;
    const sessionKey = field(text, 'session_key');
    const sessionId = field(text, 'session_id');
    if (!sessionKey || !sessionId) continue;
    byKey.set(sessionKey, {
      sessionKey,
      sessionId,
      agentId: parseAgentIdFromSessionKey(sessionKey),
      task: field(text, 'task'),
      status: field(text, 'status'),
      anchorItemId: item.id,
    });
  }
  return [...byKey.values()];
}
