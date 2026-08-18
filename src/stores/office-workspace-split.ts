/**
 * Office 办公区 / 项目群水平分栏宽度（右侧项目群占容器宽度百分比）。
 * 默认 35%（办公区 65%），用户拖拽后持久化。
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  OFFICE_ROOM_DEFAULT_WIDTH_PCT,
  OFFICE_ROOM_MAX_WIDTH_PCT,
  OFFICE_ROOM_MIN_WIDTH_PCT,
} from '@/lib/office-layout';

interface OfficeWorkspaceSplitState {
  roomWidthPct: number;
  setRoomWidthPct: (pct: number) => void;
}

function clampRoomWidth(pct: number): number {
  if (!Number.isFinite(pct)) return OFFICE_ROOM_DEFAULT_WIDTH_PCT;
  if (pct < OFFICE_ROOM_MIN_WIDTH_PCT) return OFFICE_ROOM_MIN_WIDTH_PCT;
  if (pct > OFFICE_ROOM_MAX_WIDTH_PCT) return OFFICE_ROOM_MAX_WIDTH_PCT;
  return pct;
}

export const useOfficeWorkspaceSplit = create<OfficeWorkspaceSplitState>()(
  persist(
    (set) => ({
      roomWidthPct: OFFICE_ROOM_DEFAULT_WIDTH_PCT,
      setRoomWidthPct: (pct) => set({ roomWidthPct: clampRoomWidth(pct) }),
    }),
    {
      name: 'clawx.office-workspace-split',
      partialize: (state) => ({ roomWidthPct: state.roomWidthPct }),
    },
  ),
);
