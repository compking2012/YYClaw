import { StrictMode } from 'react';
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePickerSessionOrder } from '@/hooks/use-picker-session-order';

type Item = { id: string; name: string };
const items: Item[] = [{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }];
type Props = { sessionKey: string | null; items: Item[]; selectedKeys: string[] };

function useOrder(props: Props) {
  return usePickerSessionOrder({
    sessionKey: props.sessionKey,
    items: props.items,
    getKey: (item) => item.id,
    getName: (item) => item.name,
    getInitialSelectedKeys: () => props.selectedKeys,
    isItemSelected: (item, selectedKeys) => selectedKeys.includes(item.id),
  });
}

describe('picker session hook', () => {
  it('freezes order for a session and resets when reopened', () => {
    const { result, rerender } = renderHook(useOrder, {
      initialProps: { sessionKey: 'first', items, selectedKeys: ['beta'] } as Props,
      wrapper: StrictMode,
    });
    expect(result.current).toEqual(['beta', 'alpha']);
    rerender({ sessionKey: 'first', items: [...items].reverse(), selectedKeys: ['alpha'] });
    expect(result.current).toEqual(['beta', 'alpha']);
    rerender({ sessionKey: null, items, selectedKeys: ['alpha'] });
    expect(result.current).toEqual([]);
    rerender({ sessionKey: 'first', items, selectedKeys: ['alpha'] });
    expect(result.current).toEqual(['alpha', 'beta']);
  });

  it('captures selection when initially empty data arrives and changes sessions', () => {
    const { result, rerender } = renderHook(useOrder, {
      initialProps: { sessionKey: 'first', items: [], selectedKeys: [] } as Props,
    });
    expect(result.current).toEqual([]);
    rerender({ sessionKey: 'first', items, selectedKeys: ['beta'] });
    expect(result.current).toEqual(['beta', 'alpha']);
    rerender({ sessionKey: 'second', items, selectedKeys: ['alpha'] });
    expect(result.current).toEqual(['alpha', 'beta']);
  });
});
