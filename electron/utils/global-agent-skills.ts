import { readOpenClawConfig, writeOpenClawConfig } from './channel-config';
import type { OpenClawConfig } from './channel-config';
import { withConfigLock } from './config-mutex';
import { listLocalSkills } from '../services/skills/local-skill-service';
import {
  buildSkillAliasToCanonicalIdMap,
  syncSkillsEntriesEnabledInConfig,
} from './skill-entries-sync';
import { normalizeSkillKey } from './skill-agent-mapping';
import type { AgentsSnapshot } from './agent-config';
import { listAgentsSnapshotFromConfig } from './agent-config';
import { extractAgentWorkspacesFromEntries } from './agent-workspaces';

type AgentDefaultsConfig = {
  skills?: string[];
  [key: string]: unknown;
};

type AgentsConfigShape = {
  defaults?: AgentDefaultsConfig;
  list?: Array<{ id?: string; skills?: string[]; [key: string]: unknown }>;
  [key: string]: unknown;
};

type ConfigWithAgents = {
  agents?: AgentsConfigShape;
  [key: string]: unknown;
};

function normalizeSkillAllowlist(skills: unknown): string[] {
  if (!Array.isArray(skills)) return [];
  return [...new Set(skills
    .map((item) => (typeof item === 'string' ? item.trim().toLowerCase() : ''))
    .filter(Boolean))];
}

function resolveCanonicalSkillKeys(keys: string[], aliasToId: Map<string, string>): string[] {
  const resolved = new Set<string>();
  for (const key of keys) {
    const normalized = normalizeSkillKey(key);
    if (!normalized) continue;
    resolved.add(aliasToId.get(normalized) || normalized);
  }
  return [...resolved];
}

export function readDefaultAgentSkillsFromConfig(config: ConfigWithAgents): string[] {
  const defaults = config.agents?.defaults;
  if (!defaults || typeof defaults !== 'object') return [];
  return normalizeSkillAllowlist(defaults.skills);
}

export function mergeGlobalSkillsIntoAgentSkills(agentSkills: string[], globalSkills: string[]): string[] {
  return normalizeSkillAllowlist([...globalSkills, ...agentSkills]);
}

export async function setDefaultAgentSkills(nextSkillIds: string[]): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as ConfigWithAgents;
    const agentsConfig = (config.agents && typeof config.agents === 'object'
      ? { ...config.agents }
      : {}) as AgentsConfigShape;
    const entries = Array.isArray(agentsConfig.list)
      ? agentsConfig.list.map((entry) => ({ ...entry }))
      : [];

    const localSkills = await listLocalSkills({
      agentWorkspaces: extractAgentWorkspacesFromEntries(entries),
    });
    const aliasToId = buildSkillAliasToCanonicalIdMap(localSkills);

    const oldGlobalCanonical = new Set(
      resolveCanonicalSkillKeys(readDefaultAgentSkillsFromConfig(config), aliasToId),
    );
    const newGlobalCanonical = new Set(
      resolveCanonicalSkillKeys(nextSkillIds, aliasToId),
    );

    for (const entry of entries) {
      const agentCanonical = new Set(
        resolveCanonicalSkillKeys(entry.skills || [], aliasToId),
      );
      const perAgentOnly = [...agentCanonical].filter((id) => !oldGlobalCanonical.has(id));
      const optOuts = [...oldGlobalCanonical].filter((id) => !agentCanonical.has(id));
      const nextGlobalForAgent = [...newGlobalCanonical].filter((id) => !optOuts.includes(id));
      entry.skills = normalizeSkillAllowlist([...perAgentOnly, ...nextGlobalForAgent]);
    }

    const defaults = (agentsConfig.defaults && typeof agentsConfig.defaults === 'object'
      ? { ...agentsConfig.defaults }
      : {}) as AgentDefaultsConfig;
    defaults.skills = [...newGlobalCanonical];
    agentsConfig.defaults = defaults;
    agentsConfig.list = entries;
    config.agents = agentsConfig;

    syncSkillsEntriesEnabledInConfig(config, entries, aliasToId, newGlobalCanonical, localSkills);
    await writeOpenClawConfig(config as OpenClawConfig);
    return listAgentsSnapshotFromConfig(config as OpenClawConfig);
  });
}

export async function getDefaultAgentSkills(): Promise<string[]> {
  const config = await readOpenClawConfig() as ConfigWithAgents;
  return readDefaultAgentSkillsFromConfig(config);
}
