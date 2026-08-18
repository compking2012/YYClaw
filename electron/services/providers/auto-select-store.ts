/**
 * Per-agent auto-select settings, persisted in the ClawX store (electron-store)
 * — deliberately NOT in openclaw.json. Writing unknown keys into openclaw.json
 * (or registering a plugin via plugins.*) makes the OpenClaw gateway reject the
 * config on reload/startup and tear down all channels. Keeping this state in the
 * app's own store avoids touching the gateway config entirely.
 */
import { getClawXProviderStore } from './store-instance';

export type AgentModelSlot =
  | 'model' | 'imageModel' | 'imageGenerationModel' | 'musicGenerationModel' | 'videoGenerationModel';
export type OptimizationProfile = 'quality' | 'balanced' | 'cost' | 'latency';

export interface AgentAutoSelectSettings {
  autoSelectModel?: Partial<Record<AgentModelSlot, boolean>>;
  optimizationProfile?: OptimizationProfile;
  /** Compliance/sensitive mode: force origin-tier routing (private>…) for this agent. */
  sensitiveMode?: boolean;
}

const STORE_KEY = 'agentAutoSelect';

type AutoSelectMap = Record<string, AgentAutoSelectSettings>;

async function readAll(): Promise<AutoSelectMap> {
  try {
    const store = await getClawXProviderStore();
    return (store.get(STORE_KEY) as AutoSelectMap | undefined) ?? {};
  } catch {
    return {};
  }
}

export async function getAllAutoSelect(): Promise<AutoSelectMap> {
  return readAll();
}

export async function getAutoSelectForAgent(agentId: string): Promise<AgentAutoSelectSettings> {
  const all = await readAll();
  return all[agentId] ?? {};
}

/** Merge-update an agent's auto-select settings; drops falsy slots to stay minimal. */
export async function setAutoSelectForAgent(
  agentId: string,
  update: AgentAutoSelectSettings,
): Promise<void> {
  const store = await getClawXProviderStore();
  const all = (store.get(STORE_KEY) as AutoSelectMap | undefined) ?? {};
  const prev = all[agentId] ?? {};
  const next: AgentAutoSelectSettings = { ...prev };

  if (update.autoSelectModel) {
    const merged = { ...(prev.autoSelectModel ?? {}), ...update.autoSelectModel };
    for (const [slot, enabled] of Object.entries(merged)) {
      if (!enabled) delete merged[slot as AgentModelSlot];
    }
    if (Object.keys(merged).length > 0) next.autoSelectModel = merged;
    else delete next.autoSelectModel;
  }
  if (update.optimizationProfile) next.optimizationProfile = update.optimizationProfile;
  if (typeof update.sensitiveMode === 'boolean') {
    if (update.sensitiveMode) next.sensitiveMode = true;
    else delete next.sensitiveMode;
  }

  if (!next.autoSelectModel && !next.optimizationProfile && !next.sensitiveMode) delete all[agentId];
  else all[agentId] = next;

  store.set(STORE_KEY, all);
}
