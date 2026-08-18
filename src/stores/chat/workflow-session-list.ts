/**
 * Session-list helpers for inline workflows.
 *
 * Workflow nodes run in internal `wf:<runId>:<stepId>` sub-sessions (delivered
 * with `deliver:false`), but the Gateway still returns them from `sessions.list`.
 * They must never surface in the user's session list — their only entry point is
 * the workflow card's node drill-down in the main conversation.
 *
 * Conversely, a "parent" session whose only activity was a workflow turn has no
 * Gateway-persisted history (the turn never hit `chat.send` on it), so the
 * Gateway omits it from `sessions.list` and it would vanish. We re-inject such
 * parents from the locally-persisted workflow cards so they stay permanently in
 * the list.
 */
import { isSidebarHiddenSessionKey } from '../../../shared/internal-session';
import type { ChatSession } from './types';
import type { WorkflowCardRef } from '@/types/workflow';

/** Drop internal workflow / office sub-sessions from the sidebar list. */
export function filterOutWorkflowSessions(sessions: ChatSession[]): ChatSession[] {
  return sessions.filter((s) => !isSidebarHiddenSessionKey(s.key));
}

/**
 * Ensure every parent session that has local workflow cards is present in the
 * list, even when the Gateway didn't return it. Existing entries are preserved
 * (never overwritten); missing parents are appended with the latest card's title
 * and creation time so they sort/label sensibly.
 */
export function mergeWorkflowParentSessions(
  sessions: ChatSession[],
  workflowCardsBySession: Record<string, WorkflowCardRef[]>,
): ChatSession[] {
  const present = new Set(sessions.map((s) => s.key));
  const injected: ChatSession[] = [];
  for (const [key, cards] of Object.entries(workflowCardsBySession)) {
    if (!cards || cards.length === 0) continue;
    if (isSidebarHiddenSessionKey(key)) continue; // never re-inject an internal session
    if (present.has(key)) continue;
    const latest = cards[cards.length - 1];
    injected.push({
      key,
      displayName: key,
      derivedTitle: latest.title,
      updatedAt: latest.createdAt,
    });
  }
  return injected.length > 0 ? [...sessions, ...injected] : sessions;
}
