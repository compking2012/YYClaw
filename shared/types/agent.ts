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
  modelDisplay: string;
  modelRef?: string | null;
  overrideModelRef?: string | null;
  /** Effective token limit after provider transport ceilings are applied. */
  contextWindow?: number;
  inheritedModel: boolean;
  /** Per-slot auto-select toggles (resolved defaults ⊕ per-agent override). */
  autoSelectModel?: Partial<Record<AgentModelSlot, boolean>>;
  /** Optimization profile driving auto-select utility weighting. */
  optimizationProfile?: OptimizationProfile;
  /** Compliance/sensitive mode: force origin-tier routing for this agent. */
  sensitiveMode?: boolean;
  workspace: string;
  agentDir: string;
  mainSessionKey: string;
  channelTypes: string[];
}

export interface AgentsSnapshot {
  agents: AgentSummary[];
  defaultAgentId: string;
  defaultModelRef?: string | null;
  configuredChannelTypes: string[];
  channelOwners: Record<string, string>;
  channelAccountOwners: Record<string, string>;
}
