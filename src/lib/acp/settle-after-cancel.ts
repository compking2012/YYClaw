/**
 * Live-timeline settle after the user cancels an ACP turn.
 *
 * ACP cancel stops the prompt, but the reduced timeline may still show
 * in-flight tools / plan steps as running because the agent never emits a
 * final `update_plan` or tool_call_update. This pure helper rewrites only the
 * live snapshot (not Gateway history) so the UI matches the cancelled turn.
 */
import type { AcpTimelineSnapshot, TimelineItem, TimelinePlanEntry } from './timeline-types';

function settlePlanEntry(entry: TimelinePlanEntry): TimelinePlanEntry {
  const status = typeof entry.status === 'string' ? entry.status : '';
  if (status === 'in_progress' || status === 'pending') {
    return { ...entry, status: 'cancelled' };
  }
  return entry;
}

function settleItem(item: TimelineItem): TimelineItem {
  if (item.kind === 'tool-call' && (item.status === 'pending' || item.status === 'running')) {
    return { ...item, status: 'failed', error: item.error ?? 'aborted' };
  }
  if (item.kind === 'permission' && item.status === 'pending') {
    return { ...item, status: 'cancelled' };
  }
  if (item.kind === 'plan') {
    const entries = item.entries.map(settlePlanEntry);
    const changed = entries.some((entry, index) => entry !== item.entries[index]);
    return changed ? { ...item, entries } : item;
  }
  return item;
}

/** Mark in-flight tools/plan/permissions as cancelled/failed after user abort. */
export function settleAcpTimelineAfterCancel(snapshot: AcpTimelineSnapshot): AcpTimelineSnapshot {
  let changed = false;
  const itemsById: Record<string, TimelineItem> = { ...snapshot.itemsById };
  for (const id of snapshot.itemOrder) {
    const item = itemsById[id];
    if (!item) continue;
    const next = settleItem(item);
    if (next !== item) {
      itemsById[id] = next;
      changed = true;
    }
  }
  return changed ? { ...snapshot, itemsById } : snapshot;
}
