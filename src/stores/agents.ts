import { create } from 'zustand';
import { hostApi } from '@/lib/host-api';
import type { ChannelType } from '@/types/channel';
import type { AgentSummary, AgentsSnapshot } from '@/types/agent';

interface AgentsState {
  agents: AgentSummary[];
  defaultAgentId: string;
  defaultModelRef: string | null;
  defaultImageModelRef: string | null;
  defaultImageGenerationModelRef: string | null;
  defaultVideoGenerationModelRef: string | null;
  defaultMusicGenerationModelRef: string | null;
  defaultModelProviderAccountId: string | null;
  configuredChannelTypes: string[];
  channelOwners: Record<string, string>;
  channelAccountOwners: Record<string, string>;
  defaultAgentSkills: string[];
  loading: boolean;
  error: string | null;
  focusAgentId: string | null;
  fetchAgents: (opts?: { silent?: boolean; reconcile?: boolean }) => Promise<void>;
  createAgent: (name: string, options?: { id?: string; inheritWorkspace?: boolean; skills?: string[] }) => Promise<void>;
  updateAgent: (agentId: string, payload: { name?: string; skills?: string[] }) => Promise<void>;
  updateAgentId: (agentId: string, newId: string) => Promise<void>;
  updateAgentModel: (
    agentId: string,
    modelRef: string | null,
    targetSlot?: 'model' | 'imageModel' | 'imageGenerationModel' | 'videoGenerationModel' | 'musicGenerationModel',
  ) => Promise<void>;
  updateDefaultModels: (models: Record<string, string | null>) => Promise<void>;
  updateAgentAutoSelect: (
    agentId: string,
    update: {
      autoSelectModel?: Partial<Record<'model' | 'imageModel' | 'imageGenerationModel' | 'videoGenerationModel' | 'musicGenerationModel', boolean>>;
      optimizationProfile?: 'quality' | 'balanced' | 'cost' | 'latency';
      sensitiveMode?: boolean;
    },
  ) => Promise<void>;
  setDefaultAgent: (agentId: string) => Promise<void>;
  deleteAgent: (agentId: string) => Promise<void>;
  assignChannel: (agentId: string, channelType: ChannelType) => Promise<void>;
  removeChannel: (agentId: string, channelType: ChannelType) => Promise<void>;
  clearError: () => void;
  setFocusAgentId: (id: string | null) => void;
  updateGlobalAgentSkills: (skills: string[]) => Promise<void>;
}

function applySnapshot(snapshot: AgentsSnapshot | undefined) {
  return snapshot ? {
    agents: snapshot.agents ?? [],
    defaultAgentId: snapshot.defaultAgentId ?? '',
    defaultModelRef: snapshot.defaultModelRef ?? null,
    defaultImageModelRef: snapshot.defaultImageModelRef ?? null,
    defaultImageGenerationModelRef: snapshot.defaultImageGenerationModelRef ?? null,
    defaultVideoGenerationModelRef: snapshot.defaultVideoGenerationModelRef ?? null,
    defaultMusicGenerationModelRef: snapshot.defaultMusicGenerationModelRef ?? null,
    defaultModelProviderAccountId: snapshot.defaultModelProviderAccountId ?? null,
    configuredChannelTypes: snapshot.configuredChannelTypes ?? [],
    channelOwners: snapshot.channelOwners ?? {},
    channelAccountOwners: snapshot.channelAccountOwners ?? {},
    defaultAgentSkills: snapshot.defaultAgentSkills ?? [],
  } : {};
}

export const useAgentsStore = create<AgentsState>((set) => ({
  agents: [],
  defaultAgentId: '',
  defaultModelRef: null,
  defaultImageModelRef: null,
  defaultImageGenerationModelRef: null,
  defaultVideoGenerationModelRef: null,
  defaultMusicGenerationModelRef: null,
  defaultModelProviderAccountId: null,
  configuredChannelTypes: [],
  channelOwners: {},
  channelAccountOwners: {},
  defaultAgentSkills: [],
  loading: false,
  error: null,
  focusAgentId: null,
  setFocusAgentId: (id) => set({ focusAgentId: id }),

  fetchAgents: async ({ silent = false, reconcile = true } = {}) => {
    if (!silent) set({ loading: true, error: null });
    try {
      const snapshot = await hostApi.agents.list(
        reconcile ? undefined : { reconcile: false },
      ) as AgentsSnapshot & { success?: boolean };
      set({
        ...applySnapshot(snapshot),
        loading: false,
      });
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },

  createAgent: async (name: string, options?: { id?: string; inheritWorkspace?: boolean; skills?: string[] }) => {
    set({ error: null });
    try {
      const snapshot = await hostApi.agents.create({
        name,
        id: options?.id,
        inheritWorkspace: options?.inheritWorkspace,
        skills: options?.skills,
      }) as AgentsSnapshot & { success?: boolean };
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  updateAgent: async (agentId: string, payload: { name?: string; skills?: string[] }) => {
    set({ error: null });
    try {
      const snapshot = await hostApi.agents.update(agentId, payload) as AgentsSnapshot & { success?: boolean };
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  updateAgentId: async (agentId: string, newId: string) => {
    set({ error: null });
    try {
      const snapshot = await hostApi.agents.updateId(agentId, newId) as AgentsSnapshot & { success?: boolean };
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  updateAgentModel: async (agentId: string, modelRef: string | null, targetSlot: 'model' | 'imageModel' | 'imageGenerationModel' | 'videoGenerationModel' | 'musicGenerationModel' = 'model') => {
    set({ error: null });
    try {
      const snapshot = await hostApi.agents.updateModel(agentId, modelRef, targetSlot) as AgentsSnapshot & { success?: boolean };
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  updateDefaultModels: async (models: Record<string, string | null>) => {
    set({ error: null });
    try {
      const snapshot = await hostApi.agents.updateDefaultModels(models) as AgentsSnapshot & { success?: boolean };
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  updateAgentAutoSelect: async (agentId, update) => {
    set({ error: null });
    try {
      const snapshot = await hostApi.agents.updateAutoSelect(agentId, update) as AgentsSnapshot & { success?: boolean };
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  setDefaultAgent: async (agentId: string) => {
    set({ error: null });
    try {
      const snapshot = await hostApi.agents.setDefault(agentId) as AgentsSnapshot & { success?: boolean };
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  deleteAgent: async (agentId: string) => {
    set({ error: null });
    try {
      const snapshot = await hostApi.agents.delete(agentId) as AgentsSnapshot & { success?: boolean };
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  assignChannel: async (agentId: string, channelType: ChannelType) => {
    set({ error: null });
    try {
      const snapshot = await hostApi.agents.assignChannel(agentId, channelType) as AgentsSnapshot & { success?: boolean };
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  removeChannel: async (agentId: string, channelType: ChannelType) => {
    set({ error: null });
    try {
      const snapshot = await hostApi.agents.removeChannel(agentId, channelType) as AgentsSnapshot & { success?: boolean };
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  clearError: () => set({ error: null }),

  updateGlobalAgentSkills: async (skills: string[]) => {
    set({ error: null });
    try {
      const snapshot = await hostApi.agents.updateGlobalSkills(skills) as AgentsSnapshot & { success?: boolean };
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },
}));
