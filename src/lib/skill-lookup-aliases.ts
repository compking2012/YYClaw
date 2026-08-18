import type { Skill } from '@/types/skill';

export function normalizeSkillKey(value?: string): string {
  return (value || '').trim().toLowerCase();
}

/** Normalized `name` is the sole canonical skill key for allowlist storage and matching. */
export function canonicalSkillKeyFromSkill(skill: Pick<Skill, 'id' | 'name'>): string {
  const fromName = normalizeSkillKey(skill.name);
  if (fromName) return fromName;
  return normalizeSkillKey(skill.id);
}

/** Canonical skill key from SKILL.md `name` (version is not part of the id). */
export function buildSkillScanId(name: string, _version?: string): string {
  return (name || '').trim();
}

export function collectSkillLookupAliases(
  skill: Pick<Skill, 'id' | 'slug' | 'name' | 'baseDir' | 'version'>,
): string[] {
  const aliases = new Set<string>();
  const add = (value?: string) => {
    const key = normalizeSkillKey(value);
    if (key) aliases.add(key);
  };
  const canonical = canonicalSkillKeyFromSkill(skill);
  add(canonical);
  add(skill.id);
  add(skill.slug);
  add(skill.name);
  if (skill.baseDir) {
    const leaf = skill.baseDir.replace(/\\/g, '/').split('/').pop();
    add(leaf);
  }
  const trimmedVersion = skill.version?.trim();
  if (skill.name && trimmedVersion) {
    add(`${skill.name.trim()}@${trimmedVersion}`);
  }
  return [...aliases];
}

export function buildSkillAliasToCanonicalIdMap(skills: Skill[]): Map<string, string> {
  const aliasToId = new Map<string, string>();
  for (const skill of skills) {
    const canonicalId = canonicalSkillKeyFromSkill(skill);
    for (const alias of collectSkillLookupAliases(skill)) {
      aliasToId.set(alias, canonicalId);
    }
  }
  return aliasToId;
}

/** Map agent.skills keys to canonical normalized names (drops unknown/orphan keys). */
export function resolveAgentSkillSelection(agentSkillKeys: string[], availableSkills: Skill[]): string[] {
  const aliasToId = buildSkillAliasToCanonicalIdMap(availableSkills);
  const catalogIds = new Set(availableSkills.map((skill) => canonicalSkillKeyFromSkill(skill)));
  const resolved = new Set<string>();
  for (const key of agentSkillKeys) {
    const normalized = normalizeSkillKey(key);
    if (!normalized) continue;
    const canonicalId = aliasToId.get(normalized) || normalized;
    if (catalogIds.has(canonicalId)) {
      resolved.add(canonicalId);
    }
  }
  return [...resolved];
}

export function countSelectedCatalogSkills(availableSkills: Skill[], selectedCanonicalIds: Iterable<string>): number {
  const selected = new Set([...selectedCanonicalIds].map(normalizeSkillKey));
  return availableSkills.filter((skill) => selected.has(canonicalSkillKeyFromSkill(skill))).length;
}

export function sortSkillKeys(keys: string[]): string[] {
  return [...keys].sort();
}

export function findCatalogSkillByKey(skillKey: string, availableSkills: Skill[]): Skill | undefined {
  const aliasToId = buildSkillAliasToCanonicalIdMap(availableSkills);
  const normalized = normalizeSkillKey(skillKey);
  if (!normalized) return undefined;
  const canonicalId = aliasToId.get(normalized) || normalized;
  return availableSkills.find((skill) => canonicalSkillKeyFromSkill(skill) === canonicalId);
}

export function buildSelectedCatalogIdSet(selectedKeys: string[], availableSkills: Skill[]): Set<string> {
  return new Set(resolveAgentSkillSelection(selectedKeys, availableSkills).map(normalizeSkillKey));
}

export function isCatalogSkillSelected(
  skill: Skill,
  selectedKeys: string[],
  availableSkills: Skill[],
): boolean {
  return buildSelectedCatalogIdSet(selectedKeys, availableSkills).has(canonicalSkillKeyFromSkill(skill));
}

export function addCatalogSkillToSelection(
  skill: Skill,
  selectedKeys: string[],
  availableSkills: Skill[],
): string[] {
  const next = buildSelectedCatalogIdSet(selectedKeys, availableSkills);
  next.add(canonicalSkillKeyFromSkill(skill));
  return [...next];
}

export function removeCatalogSkillsFromSelection(
  skillsToRemove: Skill[],
  selectedKeys: string[],
  availableSkills: Skill[],
): string[] {
  const removeIds = new Set(skillsToRemove.map((item) => canonicalSkillKeyFromSkill(item)));
  return resolveAgentSkillSelection(selectedKeys, availableSkills).filter(
    (id) => !removeIds.has(normalizeSkillKey(id)),
  );
}

export function removeCatalogSkillFromSelection(
  skill: Skill,
  selectedKeys: string[],
  availableSkills: Skill[],
): string[] {
  return removeCatalogSkillsFromSelection([skill], selectedKeys, availableSkills);
}

/** Canonical normalized names ready to persist on agent.skills / defaults.skills. */
export function normalizeSkillsSelectionForPersist(selectedKeys: string[], availableSkills: Skill[]): string[] {
  return sortSkillKeys(resolveAgentSkillSelection(selectedKeys, availableSkills));
}

export function agentSkillsSelectionChanged(
  selectedKeys: string[],
  storedAgentSkills: string[],
  availableSkills: Skill[],
): boolean {
  const selectedPersisted = normalizeSkillsSelectionForPersist(selectedKeys, availableSkills);
  const storedResolved = normalizeSkillsSelectionForPersist(storedAgentSkills, availableSkills);
  if (selectedPersisted.join('\0') !== storedResolved.join('\0')) {
    return true;
  }
  const storedRawFingerprint = sortSkillKeys(
    storedAgentSkills.map((key) => normalizeSkillKey(key)),
  ).join('\0');
  const persistedFingerprint = sortSkillKeys(selectedPersisted.map(normalizeSkillKey)).join('\0');
  return storedRawFingerprint !== persistedFingerprint;
}
