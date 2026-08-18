/**
 * Removes config references that point exclusively to legacy skill roots which
 * ClawX no longer scans: workspace/skills, workspace/.agents/skills,
 * ~/.agents/skills, and skills.load.extraDirs.
 *
 * Files are deliberately not deleted. This only prevents invisible legacy
 * skills from surviving as agent-assignment placeholders in Settings.
 */
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { extractAgentWorkspacesForSkillScan } from './agent-workspaces';
import { expandPath } from './paths';

function normalize(value?: string): string {
  return String(value || '').trim().toLowerCase();
}

function addAlias(aliases: Set<string>, value?: unknown): void {
  if (typeof value !== 'string') return;
  const normalized = normalize(value);
  if (normalized) aliases.add(normalized);
}

async function readSkillAliases(skillDir: string, fallbackName: string): Promise<string[]> {
  const aliases = new Set<string>();
  addAlias(aliases, fallbackName);
  try {
    const entries = await readdir(skillDir, { withFileTypes: true });
    const skillFile = entries.find(
      (entry) => entry.isFile() && entry.name.toLowerCase() === 'skill.md',
    )?.name;
    if (!skillFile) return [];
    const content = await readFile(join(skillDir, skillFile), 'utf8');
    const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const name = frontmatter?.[1].match(/^\s*name\s*:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1];
    addAlias(aliases, name);
  } catch {
    return [];
  }

  for (const filename of ['manifest.json', '.clawx-server-marketplace.json']) {
    try {
      const parsed = JSON.parse(await readFile(join(skillDir, filename), 'utf8')) as {
        slug?: unknown;
        name?: unknown;
        versionBase?: unknown;
      };
      addAlias(aliases, parsed.slug);
      addAlias(aliases, parsed.name);
      addAlias(aliases, parsed.versionBase);
    } catch {
      // Optional metadata is best-effort.
    }
  }
  return [...aliases];
}

async function collectRootSkillAliases(root: string): Promise<Set<string>> {
  const aliases = new Set<string>();
  const normalizedRoot = expandPath(root);
  const queue: Array<{ dir: string; fallbackName: string; depth: number }> = [{
    dir: normalizedRoot,
    fallbackName: normalizedRoot.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '',
    depth: 0,
  }];
  let visited = 0;
  while (queue.length > 0 && visited < 2_000) {
    const current = queue.shift()!;
    visited += 1;
    for (const alias of await readSkillAliases(current.dir, current.fallbackName)) aliases.add(alias);
    if (current.depth >= 6) continue;
    try {
      const entries = await readdir(current.dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        queue.push({
          dir: join(current.dir, entry.name),
          fallbackName: entry.name,
          depth: current.depth + 1,
        });
      }
    } catch {
      // A missing or unreadable legacy root has no aliases to clean.
    }
  }
  return aliases;
}

function legacySkillRoots(config: Record<string, unknown>, extraDirs: string[]): string[] {
  const agents = config.agents && typeof config.agents === 'object'
    ? config.agents as { list?: Array<{ id?: string; workspace?: string }> }
    : {};
  const configuredDefaultWorkspace = (
    agents as { defaults?: { workspace?: unknown } }
  ).defaults?.workspace;
  const workspaces = [
    ...extractAgentWorkspacesForSkillScan(agents.list || []),
    typeof configuredDefaultWorkspace === 'string' && configuredDefaultWorkspace.trim()
      ? configuredDefaultWorkspace
      : '~/.openclaw/workspace',
  ];
  return [
    ...workspaces.flatMap((workspace) => [
      join(expandPath(workspace), 'skills'),
      join(expandPath(workspace), '.agents', 'skills'),
    ]),
    join(homedir(), '.agents', 'skills'),
    ...extraDirs.map(expandPath),
  ];
}

export type LegacySkillConfigCleanupResult = {
  removedAliases: string[];
  modified: boolean;
};

export async function removeLegacySkillConfigReferences(
  config: Record<string, unknown>,
  extraDirs: string[] = [],
  options?: {
    allowedAliases?: Iterable<string>;
    legacyRoots?: string[];
  },
): Promise<LegacySkillConfigCleanupResult> {
  const legacyAliases = new Set<string>();
  for (const root of options?.legacyRoots || legacySkillRoots(config, extraDirs)) {
    for (const alias of await collectRootSkillAliases(root)) legacyAliases.add(alias);
  }
  if (legacyAliases.size === 0) return { removedAliases: [], modified: false };

  // Never remove an alias that still resolves to an allowed P1–P4 skill.
  const allowedAliases = new Set<string>();
  if (options?.allowedAliases) {
    for (const alias of options.allowedAliases) addAlias(allowedAliases, alias);
  } else {
    const {
      canonicalSkillKeyFromRecord,
      collectSkillLookupAliases,
      listLocalSkills,
    } = await import('../services/skills/local-skill-service');
    for (const skill of await listLocalSkills()) {
      addAlias(allowedAliases, canonicalSkillKeyFromRecord(skill));
      for (const alias of collectSkillLookupAliases(skill)) addAlias(allowedAliases, alias);
    }
  }
  const removable = new Set([...legacyAliases].filter((alias) => !allowedAliases.has(alias)));
  if (removable.size === 0) return { removedAliases: [], modified: false };

  let modified = false;
  const agents = config.agents && typeof config.agents === 'object'
    ? config.agents as {
      defaults?: { skills?: unknown };
      list?: Array<{ skills?: unknown }>;
    }
    : undefined;
  const filterSkills = (skills: unknown): string[] => {
    if (!Array.isArray(skills)) return [];
    const retained = skills.filter((skill) => !removable.has(normalize(typeof skill === 'string' ? skill : '')));
    if (retained.length !== skills.length) modified = true;
    return retained.filter((skill): skill is string => typeof skill === 'string');
  };
  if (agents?.defaults && typeof agents.defaults === 'object' && Array.isArray(agents.defaults.skills)) {
    agents.defaults.skills = filterSkills(agents.defaults.skills);
  }
  for (const agent of agents?.list || []) {
    if (!Array.isArray(agent.skills)) continue;
    agent.skills = filterSkills(agent.skills);
  }

  const skills = config.skills && typeof config.skills === 'object'
    ? config.skills as { entries?: Record<string, unknown> }
    : undefined;
  if (skills?.entries && typeof skills.entries === 'object') {
    for (const key of Object.keys(skills.entries)) {
      if (!removable.has(normalize(key))) continue;
      delete skills.entries[key];
      modified = true;
    }
  }

  return { removedAliases: [...removable].sort(), modified };
}
