export type AgentModelSlot =
  | 'model'
  | 'imageModel'
  | 'imageGenerationModel'
  | 'musicGenerationModel'
  | 'videoGenerationModel';

export type OptimizationProfile = 'quality' | 'balanced' | 'cost' | 'latency';

export interface AgentSummary {
  id: string;
  name: string;
  isDefault: boolean;
  skills?: string[];
  modelDisplay: string;
  modelRef?: string | null;
  overrideModelRef?: string | null;
  overrideImageModelRef?: string | null;
  overrideImageGenerationModelRef?: string | null;
  overrideVideoGenerationModelRef?: string | null;
  overrideMusicGenerationModelRef?: string | null;
  /** Per-slot auto-select toggles (resolved defaults ⊕ per-agent override). */
  autoSelectModel?: Partial<Record<AgentModelSlot, boolean>>;
  /** Optimization profile driving auto-select utility weighting. */
  optimizationProfile?: OptimizationProfile;
  /** Compliance/sensitive mode: force origin-tier routing for this agent. */
  sensitiveMode?: boolean;
  inheritedModel: boolean;
  workspace: string;
  agentDir: string;
  mainSessionKey: string;
  channelTypes: string[];
}

export interface AgentsSnapshot {
  agents: AgentSummary[];
  defaultAgentId: string;
  defaultModelRef?: string | null;
  defaultImageModelRef?: string | null;
  defaultImageGenerationModelRef?: string | null;
  defaultVideoGenerationModelRef?: string | null;
  defaultMusicGenerationModelRef?: string | null;
  /** Resolved ClawX provider account id for Models UI (matches runtime ref prefix). */
  defaultModelProviderAccountId?: string | null;
  configuredChannelTypes: string[];
  channelOwners: Record<string, string>;
  channelAccountOwners: Record<string, string>;
  defaultAgentSkills?: string[];
}
