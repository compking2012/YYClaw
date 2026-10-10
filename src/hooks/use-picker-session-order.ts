import { useState } from 'react';
import { buildPickerSessionOrder } from '@/lib/picker-session-order';

type SessionKey = string | number | boolean | null | undefined;

/**
 * Captures a selected-first list order when a picker session starts.
 * Order stays frozen until sessionKey changes or the session is reset.
 */
export function usePickerSessionOrder<T>({
  sessionKey,
  items,
  getKey,
  getName,
  getInitialSelectedKeys,
  isItemSelected,
}: {
  sessionKey: SessionKey;
  items: readonly T[];
  getKey: (item: T) => string;
  getName: (item: T) => string;
  /** Snapshot selection for ordering — only read when a new session starts. */
  getInitialSelectedKeys: () => readonly string[];
  isItemSelected: (item: T, selectedKeys: readonly string[]) => boolean;
}): string[] {
  const [session, setSession] = useState<{
    key: string | null;
    initialized: boolean;
    order: string[];
  }>({ key: null, initialized: false, order: [] });
  const normalizedSessionKey = sessionKey != null && sessionKey !== false
    ? String(sessionKey) || null
    : null;

  if (
    session.key !== normalizedSessionKey
    || (normalizedSessionKey !== null && !session.initialized && items.length > 0)
  ) {
    const initialized = normalizedSessionKey !== null && items.length > 0;
    const selectedKeys = initialized ? getInitialSelectedKeys() : [];
    const order = initialized
      ? buildPickerSessionOrder(items, (item) => isItemSelected(item, selectedKeys), getKey, getName)
      : [];
    setSession({ key: normalizedSessionKey, initialized, order });
    return order;
  }

  return session.order;
}
