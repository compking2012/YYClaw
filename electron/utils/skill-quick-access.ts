import { access, lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { expandPath, getOpenClawConfigDir, getOpenClawResolvedDir, getOpenClawSkillsDir } from './paths';
import {
  isWorkflowSkillContent,
  parseSkillTitle,
  parseWorkflowSteps,
  type ParsedWorkflowStep,
} from '@shared/workflow/skill-workflow';
import { ALLOWED_SKILL_SCAN_SOURCES, listExtensionSkillRoots } from '../services/skills/skill-scan-policy';

export type QuickAccessSkillSource = 'workspace' | 'openclaw' | 'agents' | 'legacy';

export interface QuickAccessSkill {
  name: string;
  description: string;
  source: QuickAccessSkillSource;
  sourceLabel: string;
  manifestPath: string;
  baseDir: string;
  /** True when this SKILL.md is workflow-shaped (frontmatter opt-in or body heuristic). */
  workflow?: boolean;
  /** Ordered step titles parsed from the SKILL.md body (only when `workflow`). */
  workflowSteps?: ParsedWorkflowStep[];
  /** Human-friendly card title (SKILL.md H1 / frontmatter name), when `workflow`. */
  workflowTitle?: string;
}

type QuickAccessScanParams = {
  agentsRoots?: string[];
  legacyRoots?: string[];
  openClawRoots?: string[];
  workspace?: string | null;
  openClawDir?: string | null;
};

export type QuickAccessRuntimeSkillStatus = {
  skillKey?: string;
  slug?: string;
  name?: string;
  disabled?: boolean;
  baseDir?: string;
};

type SourceDescriptor = {
  source: QuickAccessSkillSource;
  sourceLabel: string;
  priority: number;
  roots: string[];
};

const MAX_SKILL_FILE_BYTES = 256_000;

function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of paths) {
    const normalized = resolve(entry);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isInsideRoot(rootPath: string, candidatePath: string): boolean {
  const rel = relative(rootPath, candidatePath);
  return rel === '' || (!rel.startsWith('..') && rel !== '..');
}

function parseFrontmatterDescription(content: string): string | null {
  if (!content.startsWith('---')) return null;
  const endIndex = content.indexOf('\n---', 3);
  if (endIndex === -1) return null;
  const frontmatter = content.slice(3, endIndex);
  const match = frontmatter.match(/^\s*description\s*:\s*(.+)\s*$/m);
  if (!match) return null;
  return match[1]?.trim().replace(/^['"]|['"]$/g, '') || null;
}

function parseBodyDescription(content: string): string {
  const lines = content.split(/\r?\n/);
  let inFrontmatter = false;
  let frontmatterClosed = false;

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? '';
    const trimmed = rawLine.trim();

    if (index === 0 && trimmed === '---') {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter) {
      if (trimmed === '---') {
        inFrontmatter = false;
        frontmatterClosed = true;
      }
      continue;
    }
    if (!trimmed) continue;
    if (frontmatterClosed && trimmed === '---') continue;
    if (/^#{1,6}\s+/.test(trimmed)) continue;
    return trimmed.replace(/^[-*]\s+/, '');
  }

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (/^#{1,6}\s+/.test(trimmed)) {
      return trimmed.replace(/^#{1,6}\s+/, '');
    }
  }

  return 'No description available.';
}

interface SkillMeta {
  description: string;
  workflow: boolean;
  workflowSteps?: ParsedWorkflowStep[];
  workflowTitle?: string;
}

async function readSkillMeta(manifestPath: string): Promise<SkillMeta> {
  const fileStat = await stat(manifestPath);
  if (fileStat.size > MAX_SKILL_FILE_BYTES) {
    return { description: 'Description unavailable (SKILL.md exceeds size limit).', workflow: false };
  }
  const content = await readFile(manifestPath, 'utf-8');
  const description = parseFrontmatterDescription(content) || parseBodyDescription(content);
  const workflow = isWorkflowSkillContent(content);
  if (!workflow) return { description, workflow: false };
  const workflowSteps = parseWorkflowSteps(content);
  return {
    description,
    workflow: true,
    workflowSteps: workflowSteps.length ? workflowSteps : undefined,
    workflowTitle: parseSkillTitle(content) ?? undefined,
  };
}

async function resolveSafeRoot(root: string): Promise<string | null> {
  if (!(await pathExists(root))) return null;
  try {
    const rootStat = await stat(root);
    if (!rootStat.isDirectory()) return null;
    return await realpath(root);
  } catch {
    return null;
  }
}

async function inspectSkillDir(params: {
  source: QuickAccessSkillSource;
  sourceLabel: string;
  priority: number;
  root: string;
  rootRealPath: string;
  skillDir: string;
}): Promise<QuickAccessSkill | null> {
  const manifestPath = join(params.skillDir, 'SKILL.md');
  if (!(await pathExists(manifestPath))) return null;

  try {
    const skillDirRealPath = await realpath(params.skillDir);
    if (!isInsideRoot(params.rootRealPath, skillDirRealPath)) {
      return null;
    }
    const meta = await readSkillMeta(manifestPath);
    return {
      name: basename(skillDirRealPath),
      description: meta.description,
      source: params.source,
      sourceLabel: params.sourceLabel,
      manifestPath,
      baseDir: skillDirRealPath,
      workflow: meta.workflow,
      workflowSteps: meta.workflowSteps,
      workflowTitle: meta.workflowTitle,
    };
  } catch {
    return null;
  }
}

async function scanRoot(descriptor: Omit<SourceDescriptor, 'roots'> & { root: string }): Promise<QuickAccessSkill[]> {
  const rootRealPath = await resolveSafeRoot(descriptor.root);
  if (!rootRealPath) return [];

  const skillDirs = new Set<string>();
  const rootManifest = join(descriptor.root, 'SKILL.md');
  if (await pathExists(rootManifest)) {
    skillDirs.add(descriptor.root);
  }

  try {
    const entries = await readdir(descriptor.root, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.name === 'node_modules') continue;
      const entryPath = join(descriptor.root, entry.name);
      if (entry.isDirectory()) {
        skillDirs.add(entryPath);
        continue;
      }
      if (entry.isSymbolicLink()) {
        try {
          const symlinkStat = await lstat(entryPath);
          if (symlinkStat.isSymbolicLink()) {
            const resolved = await stat(entryPath);
            if (resolved.isDirectory()) {
              skillDirs.add(entryPath);
            }
          }
        } catch {
          // Ignore broken symlinks and unreadable entries.
        }
      }
    }
  } catch {
    return [];
  }

  const items = await Promise.all(
    [...skillDirs].map((skillDir) =>
      inspectSkillDir({
        source: descriptor.source,
        sourceLabel: descriptor.sourceLabel,
        priority: descriptor.priority,
        root: descriptor.root,
        rootRealPath,
        skillDir,
      }),
    ),
  );

  return items.filter((item): item is QuickAccessSkill => item != null);
}

async function resolveLegacyRoots(explicitRoots?: string[]): Promise<string[]> {
  if (explicitRoots) {
    return dedupePaths(explicitRoots);
  }

  const openClawDir = getOpenClawResolvedDir();
  const extensionSkillRoots = await listExtensionSkillRoots({ openClawDir });

  return dedupePaths([
    join(openClawDir, 'skills'),
    ...extensionSkillRoots,
  ]);
}

async function buildDescriptors(params: QuickAccessScanParams): Promise<SourceDescriptor[]> {
  // Align with listLocalSkills policy: only managed + bundled/extensions + plugin-skills.
  // Do not scan workspace skills or ~/.agents/skills (multi-version duplicates).
  void ALLOWED_SKILL_SCAN_SOURCES;
  const openClawDir = params.openClawDir ? expandPath(params.openClawDir) : '';
  const openClawRoots = params.openClawRoots
    ? dedupePaths(params.openClawRoots)
    : dedupePaths([
      getOpenClawSkillsDir(),
      openClawDir ? join(openClawDir, 'skills') : '',
      join(getOpenClawConfigDir(), 'plugin-skills'),
    ].filter(Boolean));
  const bundledAndExtensionRoots = params.legacyRoots
    ? dedupePaths(params.legacyRoots)
    : await resolveLegacyRoots(undefined);

  return [
    {
      source: 'openclaw',
      sourceLabel: 'OpenClaw',
      // Lower priority wins on name collision — managed/plugin roots listed first in openClawRoots.
      priority: 0,
      roots: openClawRoots,
    },
    {
      source: 'legacy',
      sourceLabel: 'Bundled',
      priority: 1,
      roots: bundledAndExtensionRoots,
    },
  ];
}

export async function collectQuickAccessSkills(params: QuickAccessScanParams): Promise<QuickAccessSkill[]> {
  const descriptors = await buildDescriptors(params);
  const discovered = await Promise.all(
    descriptors.flatMap((descriptor) =>
      descriptor.roots.map(async (root) => {
        const items = await scanRoot({ ...descriptor, root });
        return items.map((item) => ({ ...item, priority: descriptor.priority }));
      }),
    ),
  );

  const byName = new Map<string, QuickAccessSkill & { priority: number }>();
  for (const item of discovered.flat()) {
    const key = item.name.trim().toLowerCase();
    if (!key) continue;
    const existing = byName.get(key);
    if (!existing || item.priority < existing.priority) {
      byName.set(key, item);
    }
  }

  return [...byName.values()]
    .sort((left, right) => {
      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }
      return left.name.localeCompare(right.name);
    })
    .map(({ priority: _priority, ...skill }) => skill);
}

function normalizeLookupKey(value?: string | null): string {
  return (value || '').trim().toLowerCase();
}

export function filterEnabledQuickAccessSkills(
  skills: QuickAccessSkill[],
  runtimeSkills?: QuickAccessRuntimeSkillStatus[] | null,
  configs?: Record<string, { enabled?: boolean } | undefined>,
): QuickAccessSkill[] {
  const enabledKeys = new Set<string>();
  const disabledKeys = new Set<string>();
  const knownKeys = new Set<string>();
  const enabledPaths = new Set<string>();
  const disabledPaths = new Set<string>();
  const configDisabledKeys = new Set<string>();
  const configEnabledKeys = new Set<string>();

  for (const [skillKey, config] of Object.entries(configs || {})) {
    const normalizedKey = normalizeLookupKey(skillKey);
    if (!normalizedKey) continue;
    if (config?.enabled === false) {
      configDisabledKeys.add(normalizedKey);
    } else if (config?.enabled === true) {
      configEnabledKeys.add(normalizedKey);
    }
  }

  for (const skill of runtimeSkills || []) {
    const aliases = [
      skill.skillKey,
      skill.slug,
      skill.name,
      skill.baseDir ? basename(skill.baseDir) : '',
    ]
      .map((value) => normalizeLookupKey(value))
      .filter(Boolean);
    const targetKeys = skill.disabled ? disabledKeys : enabledKeys;
    for (const alias of aliases) {
      targetKeys.add(alias);
      knownKeys.add(alias);
    }
    if (skill.baseDir) {
      const normalizedPath = resolve(skill.baseDir);
      if (skill.disabled) {
        disabledPaths.add(normalizedPath);
      } else {
        enabledPaths.add(normalizedPath);
      }
    }
  }

  return skills.filter((skill) => {
    const normalizedKey = normalizeLookupKey(skill.name);
    const normalizedPath = resolve(skill.baseDir);
    if (
      disabledKeys.has(normalizedKey)
      || disabledPaths.has(normalizedPath)
      || configDisabledKeys.has(normalizedKey)
    ) {
      return false;
    }

    if (!runtimeSkills || runtimeSkills.length === 0) {
      return true;
    }

    if (
      enabledKeys.has(normalizedKey)
      || enabledPaths.has(normalizedPath)
      || configEnabledKeys.has(normalizedKey)
    ) {
      return true;
    }

    return !knownKeys.has(normalizedKey);
  });
}
