import {
  buildSkillScanId,
  canonicalSkillKeyFromRecord,
  collectSkillLookupAliases,
  type LocalSkillRecord,
} from '../services/skills/local-skill-service';
import type { AgentSummary } from './agent-config';

export function normalizeSkillKey(value?: string): string {
  return (value || '').trim().toLowerCase();
}

function buildSkillAliasToIdMap(skills: LocalSkillRecord[]): Map<string, string> {
  const aliasToId = new Map<string, string>();
  for (const skill of skills) {
    const canonicalId = canonicalSkillKeyFromRecord(skill);
    for (const alias of collectSkillLookupAliases(skill)) {
      aliasToId.set(alias, canonicalId);
    }
  }
  return aliasToId;
}

function buildAgentsByCanonicalSkillId(
  agents: AgentSummary[],
  aliasToId: Map<string, string>,
): Map<string, string[]> {
  const agentsBySkillId = new Map<string, string[]>();

  for (const agent of agents) {
    const normalizedAgentId = normalizeSkillKey(agent.id);
    for (const skillKey of agent.skills || []) {
      const normalizedSkillKey = normalizeSkillKey(skillKey);
      if (!normalizedSkillKey) continue;
      const canonicalId = aliasToId.get(normalizedSkillKey) || normalizedSkillKey;
      const existing = agentsBySkillId.get(canonicalId) || [];
      if (!existing.includes(normalizedAgentId)) {
        existing.push(normalizedAgentId);
      }
      agentsBySkillId.set(canonicalId, existing);
    }
  }

  return agentsBySkillId;
}

/** Build skillId -> agentIds from agents.list[].skills (single source of truth). */
export function buildSkillAgentsMap(agents: AgentSummary[]): Map<string, string[]> {
  return buildAgentsByCanonicalSkillId(agents, new Map());
}

export type SkillWithAgentAssignments = LocalSkillRecord & {
  agents: string[];
};

export function buildGlobalCanonicalSkillIdSet(
  globalSkillKeys: string[],
  aliasToId: Map<string, string>,
): Set<string> {
  const globalCanonicalIds = new Set<string>();
  for (const key of globalSkillKeys) {
    const normalized = normalizeSkillKey(key);
    if (!normalized) continue;
    globalCanonicalIds.add(aliasToId.get(normalized) || normalized);
  }
  return globalCanonicalIds;
}

/** Attach agent assignments; enabled = in global defaults OR assigned to any agent. */
export function enhanceSkillsWithAgentAssignments(
  skills: LocalSkillRecord[],
  agents: AgentSummary[],
  globalCanonicalIds: Set<string> = new Set(),
): SkillWithAgentAssignments[] {
  const aliasToId = buildSkillAliasToIdMap(skills);
  const agentsBySkillId = buildAgentsByCanonicalSkillId(agents, aliasToId);

  const enhanced: SkillWithAgentAssignments[] = skills.map((skill) => {
    const canonicalId = canonicalSkillKeyFromRecord(skill);
    const assignedAgents = agentsBySkillId.get(canonicalId) || [];
    const inGlobalDefaults = globalCanonicalIds.has(canonicalId);
    return {
      ...skill,
      agents: assignedAgents,
      enabled: inGlobalDefaults || assignedAgents.length > 0,
    };
  });

  const presentSkillIds = new Set(enhanced.map((skill) => canonicalSkillKeyFromRecord(skill)));
  const knownCanonicalIds = new Set(aliasToId.values());

  for (const [skillId, assignedAgents] of agentsBySkillId) {
    if (assignedAgents.length === 0) continue;
    if (presentSkillIds.has(skillId)) continue;
    if (knownCanonicalIds.has(skillId)) continue;

    enhanced.push({
      id: skillId,
      name: skillId,
      description: '',
      enabled: globalCanonicalIds.has(skillId) || assignedAgents.length > 0,
      agents: assignedAgents,
      source: 'agent-assignment',
    });
    presentSkillIds.add(skillId);
  }

  return enhanced;
}

export function resolveCanonicalSkillId(skillId: string, skills: LocalSkillRecord[]): string {
  const normalized = normalizeSkillKey(skillId);
  if (!normalized) return skillId;
  const aliasToId = buildSkillAliasToIdMap(skills);
  return aliasToId.get(normalized) || normalized;
}

/** Resolve allowlist keys (including legacy aliases) to canonical normalized names for persist. */
export function resolveCanonicalSkillAllowlist(keys: unknown, skills: LocalSkillRecord[]): string[] {
  if (!Array.isArray(keys)) return [];
  const aliasToId = buildSkillAliasToIdMap(skills);
  const resolved = new Set<string>();
  for (const item of keys) {
    const normalized = normalizeSkillKey(typeof item === 'string' ? item : '');
    if (!normalized) continue;
    resolved.add(aliasToId.get(normalized) || normalized);
  }
  return [...resolved];
}

export function buildSkillAgentsMappingObject(
  skills: LocalSkillRecord[],
  agents: AgentSummary[],
): Record<string, string[]> {
  const aliasToId = buildSkillAliasToIdMap(skills);
  const agentsBySkillId = buildAgentsByCanonicalSkillId(agents, aliasToId);
  const mapping: Record<string, string[]> = {};

  for (const skill of skills) {
    const canonicalId = canonicalSkillKeyFromRecord(skill);
    mapping[canonicalId] = agentsBySkillId.get(canonicalId) || [];
  }

  for (const [skillId, assignedAgents] of agentsBySkillId) {
    if (!(skillId in mapping)) {
      mapping[skillId] = assignedAgents;
    }
  }

  return mapping;
}

export { buildSkillScanId, canonicalSkillKeyFromRecord, collectSkillLookupAliases };
