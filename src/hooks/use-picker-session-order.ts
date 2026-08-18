import { useEffect, useRef, useState } from 'react';
import { buildPickerSessionOrder } from '@/lib/picker-session-order';

type SessionKey = string | number | boolean | null | undefined;

function ordersEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((key, index) => key === right[index]);
}

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
  const [sessionOrder, setSessionOrder] = useState<string[]>([]);
  const initializedSessionRef = useRef<string | null>(null);
  const orderingSnapshotRef = useRef<readonly string[]>([]);
  const getKeyRef = useRef(getKey);
  const getNameRef = useRef(getName);
  const getInitialSelectedKeysRef = useRef(getInitialSelectedKeys);
  const isItemSelectedRef = useRef(isItemSelected);

  getKeyRef.current = getKey;
  getNameRef.current = getName;
  getInitialSelectedKeysRef.current = getInitialSelectedKeys;
  isItemSelectedRef.current = isItemSelected;

  const normalizedSessionKey = sessionKey != null && sessionKey !== false
    ? String(sessionKey)
    : null;

  useEffect(() => {
    if (!normalizedSessionKey) {
      initializedSessionRef.current = null;
      setSessionOrder((prev) => (prev.length === 0 ? prev : []));
      return;
    }

    if (initializedSessionRef.current !== normalizedSessionKey) {
      orderingSnapshotRef.current = getInitialSelectedKeysRef.current();
    }

    if (initializedSessionRef.current === normalizedSessionKey) {
      return;
    }

    if (items.length === 0) {
      setSessionOrder((prev) => (prev.length === 0 ? prev : []));
      return;
    }

    const snapshot = orderingSnapshotRef.current;
    const nextOrder = buildPickerSessionOrder(
      items,
      (item) => isItemSelectedRef.current(item, snapshot),
      (item) => getKeyRef.current(item),
      (item) => getNameRef.current(item),
    );
    setSessionOrder((prev) => (ordersEqual(prev, nextOrder) ? prev : nextOrder));
    initializedSessionRef.current = normalizedSessionKey;
  }, [normalizedSessionKey, items]);

  return sessionOrder;
}
