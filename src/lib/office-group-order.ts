import type { OfficeFixedGroup } from '@/types/office';

export function compareFixedGroupsBySequence(a: OfficeFixedGroup, b: OfficeFixedGroup): number {
  const sa = a.sequence ?? Number.MAX_SAFE_INTEGER;
  const sb = b.sequence ?? Number.MAX_SAFE_INTEGER;
  if (sa !== sb) return sa - sb;
  return a.createdAt - b.createdAt;
}

export function sortFixedGroupsBySequence(groups: OfficeFixedGroup[]): OfficeFixedGroup[] {
  return [...groups].sort(compareFixedGroupsBySequence);
}
