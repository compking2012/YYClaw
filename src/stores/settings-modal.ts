import { create } from 'zustand';

export type SettingsTab =
  | 'general'
  | 'models'
  | 'usage'
  | 'channels'
  | 'skills'
  | 'memory'
  | 'voice'
  | 'gateway'
  | 'developer'
  | 'updates'
  | 'about';

interface SettingsModalState {
  open: boolean;
  tab: SettingsTab;
  focusItem: string | null;
  openSettings: (tab?: SettingsTab, focusItem?: string) => void;
  setFocusItem: (item: string | null) => void;
  close: () => void;
  setTab: (tab: SettingsTab) => void;
}

export const useSettingsModal = create<SettingsModalState>((set) => ({
  open: false,
  tab: 'general',
  focusItem: null,
  openSettings: (tab, focusItem) => set({ open: true, tab: tab ?? 'general', focusItem: focusItem ?? null }),
  setFocusItem: (item) => set({ focusItem: item }),
  close: () => set({ open: false, focusItem: null }),
  setTab: (tab) => set({ tab, focusItem: null }),
}));
