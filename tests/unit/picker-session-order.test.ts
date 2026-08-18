import { describe, expect, it } from 'vitest';
import {
  buildPickerSessionOrder,
  orderItemsBySessionKeys,
  sortPickerItemsSelectedFirst,
} from '../../src/lib/picker-session-order';

type Item = { id: string; name: string };

const items: Item[] = [
  { id: 'alpha', name: 'Alpha' },
  { id: 'beta', name: 'Beta' },
  { id: 'gamma', name: 'Gamma' },
];

describe('picker-session-order', () => {
  it('sortPickerItemsSelectedFirst places selected items before unselected items', () => {
    const sorted = sortPickerItemsSelectedFirst(
      items,
      (item) => item.id === 'gamma',
      (item) => item.name,
    );
    expect(sorted.map((item) => item.id)).toEqual(['gamma', 'alpha', 'beta']);
  });

  it('buildPickerSessionOrder returns stable keys for the selected-first order', () => {
    const order = buildPickerSessionOrder(
      items,
      (item) => item.id === 'beta',
      (item) => item.id,
      (item) => item.name,
    );
    expect(order).toEqual(['beta', 'alpha', 'gamma']);
  });

  it('orderItemsBySessionKeys preserves session positions when selection changes', () => {
    const sessionOrder = ['alpha', 'beta', 'gamma'];
    const reordered = orderItemsBySessionKeys(
      items,
      sessionOrder,
      (item) => item.id,
      (item) => item.name,
    );
    expect(reordered.map((item) => item.id)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('orderItemsBySessionKeys appends unknown items after the frozen order', () => {
    const sessionOrder = ['beta', 'alpha'];
    const extended = [
      ...items,
      { id: 'delta', name: 'Delta' },
    ];
    const reordered = orderItemsBySessionKeys(
      extended,
      sessionOrder,
      (item) => item.id,
      (item) => item.name,
    );
    expect(reordered.map((item) => item.id)).toEqual(['beta', 'alpha', 'delta', 'gamma']);
  });
});
