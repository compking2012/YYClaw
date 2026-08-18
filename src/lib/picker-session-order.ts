/**
 * Picker list ordering: selected-first on session entry, stable positions while open.
 */

export function sortPickerItemsSelectedFirst<T>(
  items: readonly T[],
  isSelected: (item: T) => boolean,
  getName: (item: T) => string,
): T[] {
  return [...items].sort((a, b) => {
    const aSelected = isSelected(a);
    const bSelected = isSelected(b);
    if (aSelected !== bSelected) return aSelected ? -1 : 1;
    return getName(a).localeCompare(getName(b));
  });
}

export function buildPickerSessionOrder<T>(
  items: readonly T[],
  isSelected: (item: T) => boolean,
  getKey: (item: T) => string,
  getName: (item: T) => string,
): string[] {
  return sortPickerItemsSelectedFirst(items, isSelected, getName).map(getKey);
}

export function orderItemsBySessionKeys<T>(
  items: readonly T[],
  sessionOrder: readonly string[],
  getKey: (item: T) => string,
  getName: (item: T) => string,
): T[] {
  const orderMap = new Map(sessionOrder.map((key, index) => [key, index]));
  return [...items].sort((a, b) => {
    const aIndex = orderMap.get(getKey(a));
    const bIndex = orderMap.get(getKey(b));
    const aRank = aIndex ?? Number.MAX_SAFE_INTEGER;
    const bRank = bIndex ?? Number.MAX_SAFE_INTEGER;
    if (aRank !== bRank) return aRank - bRank;
    return getName(a).localeCompare(getName(b));
  });
}
