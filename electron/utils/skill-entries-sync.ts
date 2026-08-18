import { readOpenClawConfig, writeOpenClawConfig } from './channel-config';
import type { OpenClawConfig } from './channel-config';
import { withConfigLock } from './config-mutex';
import { listLocalSkills } from '../services/skills/local-skill-service';
import {
  collectSkillLookupAliases,
  canonicalSkillKeyFromRecord,
} from '../services/skills/local-skill-service';
import { buildGlobalCanonicalSkillIdSet, normalizeSkillKey } from './skill-agent-mapping';
import type { LocalSkillRecord } from '../services/skills/local-skill-service';
import { extractAgentWorkspacesFromEntries } from './agent-workspaces';
import { readDefaultAgentSkillsFromConfig } from './global-agent-skills';

type SkillConfigEntry = { enabled?: boolean } & Record<string, unknown>;

type OpenClawConfigWithSkillEntries = {
  skills?: {
    entries?: Record<string, SkillConfigEntry>;
    [key: string]: unknown;
  };
  agents?: {
    list?: Array<{ skills?: string[]; workspace?: string }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export function buildSkillAliasToCanonicalIdMap(skills: LocalSkillRecord[]): Map<string, string> {
  const aliasToId = new Map<string, string>();
  for (const skill of skills) {
    const canonicalId = canonicalSkillKeyFromRecord(skill);
    for (const alias of collectSkillLookupAliases(skill)) {
      aliasToId.set(alias, canonicalId);
    }
  }
  return aliasToId;
}

export function collectAssignedCanonicalSkillIds(
  agents: Array<{ skills?: string[] }>,
  aliasToId: Map<string, string>,
): Set<string> {
  const assigned = new Set<string>();
  for (const agent of agents) {
    for (const skillKey of agent.skills || []) {
      const normalized = normalizeSkillKey(skillKey);
      if (!normalized) continue;
      assigned.add(aliasToId.get(normalized) || normalized);
    }
  }
  return assigned;
}

function entryKeyMapsToCanonical(
  entryKey: string,
  canonicalId: string,
  aliasToId: Map<string, string>,
): boolean {
  const normalizedEntryKey = normalizeSkillKey(entryKey);
  const entryCanonical = aliasToId.get(normalizedEntryKey) || normalizedEntryKey;
  return entryCanonical === canonicalId;
}

function ensureSkillsEntries(config: OpenClawConfigWithSkillEntries): Record<string, SkillConfigEntry> {
  if (!config.skills || typeof config.skills !== 'object') {
    config.skills = {};
  }
  if (!config.skills.entries || typeof config.skills.entries !== 'object') {
    config.skills.entries = {};
  }
  return config.skills.entries;
}

/** Derive skills.entries[key].enabled from agents.list[].skills (in-memory). */
export function syncSkillsEntriesEnabledInConfig(
  config: OpenClawConfigWithSkillEntries,
  agents: Array<{ skills?: string[] }>,
  aliasToId: Map<string, string>,
  globalCanonicalIds?: Set<string>,
  localSkills?: LocalSkillRecord[],
): boolean {
  const entries = ensureSkillsEntries(config);
  const assigned = collectAssignedCanonicalSkillIds(agents, aliasToId);
  if (globalCanonicalIds) {
    for (const canonicalId of globalCanonicalIds) {
      assigned.add(canonicalId);
    }
  }
  let changed = false;

  for (const entryKey of Object.keys(entries)) {
    const entry = entries[entryKey];
    const normalizedEntryKey = normalizeSkillKey(entryKey);
    const canonical = aliasToId.get(normalizedEntryKey) || normalizedEntryKey;
    const enabled = assigned.has(canonical);
    if (entry.enabled !== enabled) {
      entry.enabled = enabled;
      changed = true;
    }
  }

  const canonicalIdsToEnsure = new Set<string>(assigned);
  if (localSkills) {
    for (const skill of localSkills) {
      const canonicalId = canonicalSkillKeyFromRecord(skill);
      if (canonicalId) canonicalIdsToEnsure.add(canonicalId);
    }
  }

  for (const canonicalId of canonicalIdsToEnsure) {
    const hasEntry = Object.keys(entries).some((entryKey) =>
      entryKeyMapsToCanonical(entryKey, canonicalId, aliasToId),
    );
    if (!hasEntry) {
      entries[canonicalId] = { enabled: assigned.has(canonicalId) };
      changed = true;
    }
  }

  return changed;
}

export async function syncSkillsEntriesEnabledFromAgents(
  options?: {
    config?: OpenClawConfigWithSkillEntries;
    agents?: Array<{ skills?: string[]; workspace?: string }>;
    localSkills?: LocalSkillRecord[];
    agentWorkspaces?: string[];
  },
): Promise<boolean> {
  if (options?.config && options.agents && options.localSkills) {
    const aliasToId = buildSkillAliasToCanonicalIdMap(options.localSkills);
    const globalCanonicalIds = buildGlobalCanonicalSkillIdSet(
      readDefaultAgentSkillsFromConfig(options.config),
      aliasToId,
    );
    return syncSkillsEntriesEnabledInConfig(
      options.config,
      options.agents,
      aliasToId,
      globalCanonicalIds,
      options.localSkills,
    );
  }

  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as OpenClawConfigWithSkillEntries;
    const agents = config.agents?.list || [];
    const agentWorkspaces = options?.agentWorkspaces
      ?? extractAgentWorkspacesFromEntries(agents);
    const localSkills = options?.localSkills
      ?? await listLocalSkills({ agentWorkspaces });
    const aliasToId = buildSkillAliasToCanonicalIdMap(localSkills);
    const globalCanonicalIds = buildGlobalCanonicalSkillIdSet(
      readDefaultAgentSkillsFromConfig(config),
      aliasToId,
    );
    const changed = syncSkillsEntriesEnabledInConfig(
      config,
      agents,
      aliasToId,
      globalCanonicalIds,
      localSkills,
    );
    if (changed) {
      await writeOpenClawConfig(config as OpenClawConfig);
    }
    return changed;
  });
}
