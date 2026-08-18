/**
 * Settings State Store
 * Manages application settings
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import i18n from '@/i18n';
import { hostApi } from '@/lib/host-api';
import { resolveSupportedLanguage } from '@shared/language';
import { DEFAULT_WORKSPACE_CWD, MAX_RECENT_WORKSPACES } from '@shared/workspace';
import {
  getWorkspaceDisplayLabel,
  isDefaultWorkspacePath,
  normalizeWorkspacePath,
} from '@/lib/workspace-context';

type Theme = 'light' | 'dark' | 'system';
type UpdateChannel = 'stable' | 'beta' | 'dev';

interface SettingsState {
  // General
  theme: Theme;
  language: string;
  startMinimized: boolean;
  launchAtStartup: boolean;
  telemetryEnabled: boolean;
  promptOptimizationEnabled: boolean;
  /** When true, a single-agent turn may auto-decompose into a workflow. Default off. */
  autoWorkflowEnabled: boolean;

  // Gateway
  gatewayAutoStart: boolean;
  gatewayPort: number;
  proxyEnabled: boolean;
  proxyServer: string;
  proxyHttpServer: string;
  proxyHttpsServer: string;
  proxyAllServer: string;
  proxyBypassRules: string;

  // Update
  updateChannel: UpdateChannel;
  autoCheckUpdate: boolean;
  autoDownloadUpdate: boolean;

  // UI State
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  devModeUnlocked: boolean;
  chatWorkspacePath: string;
  recentWorkspacePaths: string[];
  workspaceLabels: Record<string, string>;

  // Voice
  voiceAutoRead: boolean;
  voiceInputMode: 'dictation' | 'conversation';
  voiceCaps: { tts: boolean; transcription: boolean; realtime: boolean };

  // Setup
  setupComplete: boolean;
  isLoggedIn: boolean;

  // Actions
  init: () => Promise<void>;
  setTheme: (theme: Theme) => void;
  setLanguage: (language: string) => void;
  setStartMinimized: (value: boolean) => void;
  setLaunchAtStartup: (value: boolean) => void;
  setTelemetryEnabled: (value: boolean) => void;
  setPromptOptimizationEnabled: (value: boolean) => void;
  setAutoWorkflowEnabled: (value: boolean) => void;
  setGatewayAutoStart: (value: boolean) => void;
  setGatewayPort: (port: number) => void;
  setProxyEnabled: (value: boolean) => void;
  setProxyServer: (value: string) => void;
  setProxyHttpServer: (value: string) => void;
  setProxyHttpsServer: (value: string) => void;
  setProxyAllServer: (value: string) => void;
  setProxyBypassRules: (value: string) => void;
  setUpdateChannel: (channel: UpdateChannel) => void;
  setAutoCheckUpdate: (value: boolean) => void;
  setAutoDownloadUpdate: (value: boolean) => void;
  setSidebarCollapsed: (value: boolean) => void;
  setSidebarWidth: (value: number) => void;
  setDevModeUnlocked: (value: boolean) => void;
  setVoiceAutoRead: (value: boolean) => void;
  setVoiceInputMode: (value: 'dictation' | 'conversation') => void;
  refreshVoiceCapabilities: () => Promise<void>;
  setChatWorkspacePath: (workspacePath: string) => void;
  setWorkspaceLabel: (workspacePath: string, label: string) => void;
  removeWorkspace: (workspacePath: string) => Promise<void>;
  markSetupComplete: () => void;
  setLoggedIn: (value: boolean, userInfo?: unknown) => void;
  resetSettings: () => void;
}

const defaultSettings = {
  theme: 'system' as Theme,
  language: resolveSupportedLanguage(typeof navigator !== 'undefined' ? navigator.language : undefined),
  startMinimized: false,
  launchAtStartup: false,
  telemetryEnabled: true,
  promptOptimizationEnabled: true,
  autoWorkflowEnabled: false,
  gatewayAutoStart: true,
  gatewayPort: 18789,
  proxyEnabled: false,
  proxyServer: '',
  proxyHttpServer: '',
  proxyHttpsServer: '',
  proxyAllServer: '',
  proxyBypassRules: '<local>;localhost;127.0.0.1;::1',
  updateChannel: 'stable' as UpdateChannel,
  autoCheckUpdate: true,
  autoDownloadUpdate: false,
  sidebarCollapsed: false,
  sidebarWidth: 280,
  devModeUnlocked: false,
  voiceAutoRead: false,
  voiceInputMode: 'dictation' as 'dictation' | 'conversation',
  voiceCaps: { tts: false, transcription: false, realtime: false },
  chatWorkspacePath: DEFAULT_WORKSPACE_CWD,
  recentWorkspacePaths: [DEFAULT_WORKSPACE_CWD],
  workspaceLabels: {},
  setupComplete: false,
  isLoggedIn: false,
};

const clampSidebarWidth = (value: number) => Math.min(420, Math.max(220, Math.round(value)));

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...defaultSettings,

      init: async () => {
        try {
          const settings = await hostApi.settings.getAll();
          const resolvedLanguage = settings.language
            ? resolveSupportedLanguage(settings.language)
            : undefined;
          set((state) => ({
            ...state,
            ...settings,
            ...(resolvedLanguage ? { language: resolvedLanguage } : {}),
            ...(typeof settings.sidebarWidth === 'number'
              ? { sidebarWidth: clampSidebarWidth(settings.sidebarWidth) }
              : {}),
          }));
          if (resolvedLanguage) {
            i18n.changeLanguage(resolvedLanguage);
          }
          void get().refreshVoiceCapabilities();
        } catch {
          // Keep renderer-persisted settings as a fallback when the main
          // process store is not reachable.
        }
      },

      setTheme: (theme) => {
        set({ theme });
        void hostApi.settings.set('theme', theme).catch(() => { });
      },
      setLanguage: (language) => {
        const resolvedLanguage = resolveSupportedLanguage(language);
        i18n.changeLanguage(resolvedLanguage);
        set({ language: resolvedLanguage });
        void hostApi.settings.set('language', resolvedLanguage).catch(() => { });
      },
      setStartMinimized: (startMinimized) => set({ startMinimized }),
      setLaunchAtStartup: (launchAtStartup) => {
        set({ launchAtStartup });
        void hostApi.settings.set('launchAtStartup', launchAtStartup).catch(() => { });
      },
      setTelemetryEnabled: (telemetryEnabled) => {
        set({ telemetryEnabled });
        void hostApi.settings.set('telemetryEnabled', telemetryEnabled).catch(() => { });
      },
      setPromptOptimizationEnabled: (promptOptimizationEnabled) => {
        set({ promptOptimizationEnabled });
        void hostApi.settings.set('promptOptimizationEnabled', promptOptimizationEnabled).catch(() => { });
      },
      setAutoWorkflowEnabled: (autoWorkflowEnabled) => {
        set({ autoWorkflowEnabled });
        void hostApi.settings.set('autoWorkflowEnabled', autoWorkflowEnabled).catch(() => { });
      },
      setGatewayAutoStart: (gatewayAutoStart) => {
        set({ gatewayAutoStart });
        void hostApi.settings.set('gatewayAutoStart', gatewayAutoStart).catch(() => { });
      },
      setGatewayPort: (gatewayPort) => {
        set({ gatewayPort });
        void hostApi.settings.set('gatewayPort', gatewayPort).catch(() => { });
      },
      setProxyEnabled: (proxyEnabled) => set({ proxyEnabled }),
      setProxyServer: (proxyServer) => set({ proxyServer }),
      setProxyHttpServer: (proxyHttpServer) => set({ proxyHttpServer }),
      setProxyHttpsServer: (proxyHttpsServer) => set({ proxyHttpsServer }),
      setProxyAllServer: (proxyAllServer) => set({ proxyAllServer }),
      setProxyBypassRules: (proxyBypassRules) => set({ proxyBypassRules }),
      setUpdateChannel: (updateChannel) => set({ updateChannel }),
      setAutoCheckUpdate: (autoCheckUpdate) => {
        set({ autoCheckUpdate });
        void hostApi.settings.set('autoCheckUpdate', autoCheckUpdate).catch(() => { });
      },
      setAutoDownloadUpdate: (autoDownloadUpdate) => {
        set({ autoDownloadUpdate });
        void hostApi.settings.set('autoDownloadUpdate', autoDownloadUpdate).catch(() => { });
      },

      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth: clampSidebarWidth(sidebarWidth) }),
      setDevModeUnlocked: (devModeUnlocked) => {
        set({ devModeUnlocked });
        void hostApi.settings.set('devModeUnlocked', devModeUnlocked).catch(() => { });
      },
      setVoiceAutoRead: (voiceAutoRead) => {
        set({ voiceAutoRead });
        void hostApi.settings.set('voiceAutoRead', voiceAutoRead).catch(() => { });
      },
      setVoiceInputMode: (voiceInputMode) => {
        set({ voiceInputMode });
        void hostApi.settings.set('voiceInputMode', voiceInputMode).catch(() => { });
      },
      refreshVoiceCapabilities: async () => {
        try {
          const res = await hostApi.voice.configStatus() as { success?: boolean; configured?: { tts?: boolean; transcription?: boolean; realtime?: boolean } };
          set({
            voiceCaps: {
              tts: Boolean(res.configured?.tts),
              transcription: Boolean(res.configured?.transcription),
              realtime: Boolean(res.configured?.realtime),
            },
          });
        } catch {
          set({ voiceCaps: { tts: false, transcription: false, realtime: false } });
        }
      },
      setChatWorkspacePath: (chatWorkspacePath) => {
        const normalized = normalizeWorkspacePath(chatWorkspacePath) ?? DEFAULT_WORKSPACE_CWD;
        set((state) => {
          const recentWorkspacePaths = [
            normalized,
            ...state.recentWorkspacePaths.filter((entry) => normalizeWorkspacePath(entry) !== normalized),
          ].slice(0, MAX_RECENT_WORKSPACES);
          const existingLabel = state.workspaceLabels[normalized]?.trim()
            || state.workspaceLabels[chatWorkspacePath.trim()]?.trim();
          const workspaceLabels = !isDefaultWorkspacePath(normalized) && !existingLabel
            ? {
              ...state.workspaceLabels,
              [normalized]: getWorkspaceDisplayLabel(
                normalized,
                '',
                state.workspaceLabels,
                [...state.recentWorkspacePaths, normalized],
              ),
            }
            : state.workspaceLabels;
          void hostApi.settings.setMany({
            chatWorkspacePath: normalized,
            recentWorkspacePaths,
            ...(workspaceLabels !== state.workspaceLabels ? { workspaceLabels } : {}),
          }).catch(() => { });
          return { chatWorkspacePath: normalized, recentWorkspacePaths, workspaceLabels };
        });
      },
      setWorkspaceLabel: (workspacePath, label) => {
        const normalizedPath = workspacePath.trim();
        const normalizedLabel = label.trim();
        if (!normalizedPath || !normalizedLabel) return;
        set((state) => {
          const workspaceLabels = {
            ...state.workspaceLabels,
            [normalizedPath]: normalizedLabel,
          };
          void hostApi.settings.setMany({ workspaceLabels }).catch(() => { });
          return { workspaceLabels };
        });
      },
      removeWorkspace: async (workspacePath) => {
        const target = normalizeWorkspacePath(workspacePath);
        if (!target) return;
        const isTarget = (candidate: string) => normalizeWorkspacePath(candidate) === target;
        const state = useSettingsStore.getState();
        const resetsGlobalWorkspace = isTarget(state.chatWorkspacePath);
        const recentWorkspacePaths = state.recentWorkspacePaths.filter((entry) => !isTarget(entry));
        if (
          resetsGlobalWorkspace
          && !recentWorkspacePaths.some((entry) => normalizeWorkspacePath(entry) === DEFAULT_WORKSPACE_CWD)
        ) {
          recentWorkspacePaths.unshift(DEFAULT_WORKSPACE_CWD);
        }
        const workspaceLabels = Object.fromEntries(
          Object.entries(state.workspaceLabels).filter(([path]) => !isTarget(path)),
        );
        const patch = {
          chatWorkspacePath: resetsGlobalWorkspace ? DEFAULT_WORKSPACE_CWD : state.chatWorkspacePath,
          recentWorkspacePaths,
          workspaceLabels,
        };
        set(patch);
        await hostApi.settings.setMany(patch);
      },
      markSetupComplete: () => set({ setupComplete: true }),
      setLoggedIn: (isLoggedIn) => set({ isLoggedIn }),
      resetSettings: () => set(defaultSettings),
    }),
    {
      name: 'clawx-settings',
      migrate: (persisted) => {
        if (!persisted || typeof persisted !== 'object') return persisted;
        const next = { ...(persisted as Record<string, unknown>) };
        delete next.officeCollaborationEnabled;
        return next;
      },
    }
  )
);
