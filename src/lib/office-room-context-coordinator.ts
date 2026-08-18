import type { RoomMessage } from '@/types/office';

const COORDINATOR_MAX_ROUNDS = 10;

/**
 * Coordinator room context: quoted thread (if any) + up to 10 recent rounds before trigger.
 */
export function selectRoomContextForCoordinator(
  history: RoomMessage[],
  opts: { upToMessageId: string; triggerMessageId?: string },
): RoomMessage[] {
  let ordered = [...history].sort((a, b) => a.timestamp - b.timestamp);
  const cut = ordered.findIndex((m) => m.id === opts.upToMessageId);
  if (cut >= 0) ordered = ordered.slice(0, cut + 1);
  if (ordered.length === 0) return [];

  const trigger =
    ordered.find((m) => m.id === (opts.triggerMessageId ?? opts.upToMessageId)) ??
    ordered[ordered.length - 1]!;
  const selectedIds = new Set<string>();

  const quoteRootId = trigger.replyToId?.trim();
  if (quoteRootId) {
    const rootIdx = ordered.findIndex((m) => m.id === quoteRootId);
    if (rootIdx >= 0) {
      for (let i = rootIdx; i < ordered.length; i += 1) {
        const m = ordered[i]!;
        if (m.id === trigger.id) break;
        selectedIds.add(m.id);
      }
      selectedIds.add(quoteRootId);
      const root = ordered[rootIdx];
      if (root?.replyToId) selectedIds.add(root.replyToId);
    }
  }

  const beforeTrigger = ordered.filter((m) => m.timestamp <= trigger.timestamp);
  const recent = beforeTrigger.slice(-COORDINATOR_MAX_ROUNDS);
  for (const m of recent) selectedIds.add(m.id);

  return ordered.filter((m) => selectedIds.has(m.id));
}
