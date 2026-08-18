/**
 * Skills State Store
 * Manages skill/plugin state
 */
import { create } from 'zustand';
import { hostApi, type SkillsStatusResult } from '@/lib/host-api';
import { AppError, normalizeAppError } from '@/lib/error-model';
import { useGatewayStore } from './gateway';
import type { Skill, MarketplaceSkill } from '../types/skill';
import { findCatalogSkillByKey, canonicalSkillKeyFromSkill } from '@/lib/skill-lookup-aliases';
import { resolveSkillEnabledAfterAgentMapping } from '@/lib/agent-selector-draft';
import { useAgentsStore } from './agents';

type SkillInstallContext = {
  baseDir?: string;
  workspace?: string;
  sessionAgentId?: string;
  overwriteSameName?: boolean;
};

async function resolveSkillInstallContext(
  options?: SkillInstallContext,
): Promise<SkillInstallContext> {
  if (options?.sessionAgentId) {
    return options;
  }
  try {
    const { useChatStore } = await import('./chat');
    const sessionAgentId = useChatStore.getState().currentAgentId;
    return { ...options, sessionAgentId: sessionAgentId || undefined };
  } catch {
    return options || {};
  }
}

type GatewaySkillStatus = NonNullable<SkillsStatusResult['skills']>[number];

type GatewaySkillsStatusResult = {
  skills?: GatewaySkillStatus[];
};

type LocalSkillsResult = {
  success: boolean;
  skills?: Skill[];
  error?: string;
};

const BUNDLED_OPENCLAW_SKILL_ALLOWLIST = new Set(['skill-creator']);
const GATEWAY_ONLY_APPENDABLE_SOURCES = new Set(['openclaw-plugin', 'openclaw-extra']);
/** Skills shipped inside bundled channel plugins (e.g. openclaw-lark). */
const BUNDLED_PLUGIN_SKILL_PREFIXES = ['feishu-', 'lark-'] as const;

function slugLooksLikeBundledPluginSkill(...values: Array<string | undefined>): boolean {
  return values.some((value) => {
    const normalized = (value || '').trim().toLowerCase();
    return normalized.length > 0
      && BUNDLED_PLUGIN_SKILL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
  });
}

/** Skills under ~/.openclaw/plugin-skills (channel plugin bundles). */
function isPluginSkillsPath(baseDir?: string): boolean {
  const normalized = String(baseDir || '').trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return /\/plugin-skills(\/|$)/.test(normalized);
}

function isShippedBundledPluginSkill(status: GatewaySkillStatus): boolean {
  const source = (status.source || '').trim().toLowerCase();
  if (source === 'openclaw-plugin') return true;
  if (source === 'openclaw-extra' && isPluginSkillsPath(status.baseDir)) return true;
  return slugLooksLikeBundledPluginSkill(status.skillKey, status.slug, status.name);
}

function mapErrorCodeToSkillErrorKey(
  code: AppError['code'],
  operation: 'fetch' | 'search' | 'install',
): string | null {
  if (code === 'TIMEOUT') {
    return operation === 'search'
      ? 'searchTimeoutError'
      : operation === 'install'
        ? 'installTimeoutError'
        : 'fetchTimeoutError';
  }
  if (code === 'RATE_LIMIT') {
    return operation === 'search'
      ? 'searchRateLimitError'
      : operation === 'install'
        ? 'installRateLimitError'
        : 'fetchRateLimitError';
  }
  return null;
}

function normalizeSkillKey(value?: string): string {
  return (value || '').trim().toLowerCase();
}

function normalizeSkillPath(value?: string): string {
  return (value || '').trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function isAllowedBundledGatewaySkill(status: GatewaySkillStatus): boolean {
  if (!status.bundled) return true;

  const aliases = [status.skillKey, status.slug]
    .map((value) => normalizeSkillKey(value))
    .filter(Boolean);

  return aliases.some((alias) => BUNDLED_OPENCLAW_SKILL_ALLOWLIST.has(alias));
}

function shouldAppendGatewayOnlySkill(status: GatewaySkillStatus): boolean {
  return GATEWAY_ONLY_APPENDABLE_SOURCES.has((status.source || '').trim().toLowerCase());
}

function buildSkillScanId(name: string, _version?: string): string {
  return (name || '').trim();
}

function mapGatewaySkillToSkill(status: GatewaySkillStatus, existing?: Skill): Skill {
  // enabled: preserve local API value (includes global defaults); else derive from agent assignments
  const hasAgentAssignments = Boolean(existing?.agents && existing.agents.length > 0);
  const enabled = Boolean(existing?.enabled) || hasAgentAssignments;
  const mergedName = status.name || existing?.name || status.skillKey;
  const mergedVersion = status.version || existing?.version;
  const scanId = buildSkillScanId(mergedName, mergedVersion);
  const nameKey = normalizeSkillKey(mergedName);

  return {
    id: existing?.id || (nameKey || scanId || status.skillKey),
    slug: status.slug || existing?.slug || status.skillKey,
    name: mergedName,
    description: status.description || existing?.description || '',
    enabled,
    icon: status.emoji || existing?.icon || '📦',
    version: mergedVersion,
    author: status.author || existing?.author,
    config: {
      ...(existing?.config || {}),
      ...(status.config || {}),
    },
    isCore: Boolean((status.bundled && status.always) || existing?.isCore),
    isBundled: Boolean(existing?.isBundled) || Boolean(status.bundled) || isShippedBundledPluginSkill(status),
    source: status.source || existing?.source,
    baseDir: status.baseDir || existing?.baseDir,
    filePath: status.filePath || existing?.filePath,
    marketplace: existing?.marketplace,
    // Preserve agents mapping from local data (gateway doesn't have this info)
    agents: existing?.agents,
  };
}

function registerSkillAliases(index: Map<string, number>, skill: Skill, position: number): void {
  const baseDir = normalizeSkillPath(skill.baseDir);
  const baseName = baseDir ? normalizeSkillKey(baseDir.split('/').pop()) : '';
  const legacyVersionedId = skill.name && skill.version?.trim()
    ? `${skill.name.trim()}@${skill.version.trim()}`
    : '';
  [
    normalizeSkillKey(skill.name),
    normalizeSkillKey(skill.id),
    normalizeSkillKey(skill.slug),
    normalizeSkillKey(legacyVersionedId),
    baseDir,
    baseName,
  ].filter(Boolean).forEach((alias) => index.set(alias, position));
}

function findGatewaySkillMatchIndex(
  merged: Skill[],
  index: Map<string, number>,
  gatewaySkill: GatewaySkillStatus,
): number | undefined {
  const gatewayVersionedId = gatewaySkill.name && gatewaySkill.version?.trim()
    ? `${gatewaySkill.name.trim()}@${gatewaySkill.version.trim()}`
    : '';
  const aliases = [
    normalizeSkillKey(gatewaySkill.name),
    normalizeSkillKey(gatewaySkill.skillKey),
    normalizeSkillKey(gatewaySkill.slug),
    normalizeSkillKey(gatewayVersionedId),
    normalizeSkillPath(gatewaySkill.baseDir),
    gatewaySkill.baseDir ? normalizeSkillKey(gatewaySkill.baseDir.split('/').pop()) : '',
  ].filter(Boolean);
  const byAlias = aliases.map((alias) => index.get(alias)).find((value): value is number => value !== undefined);
  if (byAlias !== undefined) {
    return byAlias;
  }

  // Gateway skillKey can differ from scanned id (e.g. feishu__update_doc vs feishu-update-doc).
  const gatewayName = normalizeSkillKey(gatewaySkill.name);
  if (!gatewayName) {
    return undefined;
  }
  return merged.findIndex((skill) =>
    normalizeSkillKey(skill.id) === gatewayName
    || normalizeSkillKey(skill.slug) === gatewayName
    || normalizeSkillKey(skill.name) === gatewayName,
  );
}

function preferMergedSkillRecord(current: Skill, candidate: Skill): Skill {
  const currentAgents = current.agents?.length ?? 0;
  const candidateAgents = candidate.agents?.length ?? 0;
  if (candidateAgents !== currentAgents) {
    return candidateAgents > currentAgents ? candidate : current;
  }

  const currentHasPath = Boolean(normalizeSkillPath(current.baseDir));
  const candidateHasPath = Boolean(normalizeSkillPath(candidate.baseDir));
  if (candidateHasPath !== currentHasPath) {
    return candidateHasPath ? candidate : current;
  }

  const nameKey = normalizeSkillKey(current.name);
  if (nameKey && normalizeSkillKey(candidate.id) === nameKey) {
    return {
      ...candidate,
      agents: candidate.agents ?? current.agents,
      config: { ...current.config, ...candidate.config },
    };
  }
  if (nameKey && normalizeSkillKey(current.id) === nameKey) {
    return {
      ...current,
      agents: current.agents ?? candidate.agents,
      config: { ...candidate.config, ...current.config },
    };
  }

  return current;
}

function dedupeSkillsById(skills: Skill[]): Skill[] {
  const byId = new Map<string, Skill>();
  const withoutId: Skill[] = [];

  for (const skill of skills) {
    const idKey = normalizeSkillKey(skill.id);
    if (!idKey) {
      withoutId.push(skill);
      continue;
    }
    const existing = byId.get(idKey);
    if (!existing) {
      byId.set(idKey, skill);
      continue;
    }
    byId.set(idKey, preferMergedSkillRecord(existing, skill));
  }

  return [...byId.values(), ...withoutId];
}

function dedupeSkillsByBaseDir(skills: Skill[]): Skill[] {
  const result: Skill[] = [];
  const indexByPath = new Map<string, number>();

  for (const skill of skills) {
    const pathKey = normalizeSkillPath(skill.baseDir);
    if (!pathKey) {
      result.push(skill);
      continue;
    }

    const existingIndex = indexByPath.get(pathKey);
    if (existingIndex === undefined) {
      indexByPath.set(pathKey, result.length);
      result.push(skill);
      continue;
    }

    result[existingIndex] = preferMergedSkillRecord(result[existingIndex], skill);
  }

  return result;
}

function mergeGatewaySkills(localSkills: Skill[], gatewaySkills?: GatewaySkillStatus[]): Skill[] {
  if (!gatewaySkills || gatewaySkills.length === 0) {
    return dedupeSkillsById(dedupeSkillsByBaseDir(localSkills));
  }

  const merged = [...localSkills];
  const index = new Map<string, number>();

  localSkills.forEach((skill, position) => {
    registerSkillAliases(index, skill, position);
  });

  for (const gatewaySkill of gatewaySkills) {
    if (!isAllowedBundledGatewaySkill(gatewaySkill)) {
      continue;
    }
    const existingIndex = findGatewaySkillMatchIndex(merged, index, gatewaySkill);

    if (existingIndex !== undefined && existingIndex >= 0) {
      const nextSkill = mapGatewaySkillToSkill(gatewaySkill, merged[existingIndex]);
      merged[existingIndex] = nextSkill;
      registerSkillAliases(index, nextSkill, existingIndex);
      continue;
    }

    if (!shouldAppendGatewayOnlySkill(gatewaySkill)) {
      continue;
    }

    const nextSkill = mapGatewaySkillToSkill(gatewaySkill);
    const nextIndex = merged.push(nextSkill) - 1;
    registerSkillAliases(index, nextSkill, nextIndex);
  }

  return dedupeSkillsById(dedupeSkillsByBaseDir(merged.sort((a, b) => {
    if (a.enabled && !b.enabled) return -1;
    if (!a.enabled && b.enabled) return 1;
    if (a.isCore && !b.isCore) return -1;
    if (!a.isCore && b.isCore) return 1;
    return a.name.localeCompare(b.name);
  })));
}

interface SkillsState {
  skills: Skill[];
  searchResults: MarketplaceSkill[];
  loading: boolean;
  searching: boolean;
  searchError: string | null;
  installing: Record<string, boolean>;
  error: string | null;

  fetchSkills: () => Promise<boolean>;
  searchSkills: (query: string) => Promise<void>;
  installSkill: (slug: string, version?: string, options?: SkillInstallContext) => Promise<void>;
  /** Install from server API (zip under ~/.openclaw/skills); `name` matches catalog `name` / skill_file path. */
  installServerMarketplaceSkill: (
    name: string,
    archiveHash?: string,
    listingRevision?: string,
    version?: string,
    versionBase?: string,
    category?: string,
    options?: SkillInstallContext,
  ) => Promise<void>;
  uninstallSkill: (slug: string, options?: { baseDir?: string }) => Promise<void>;
  setSkills: (skills: Skill[]) => void;
  updateSkill: (skillId: string, updates: Partial<Skill>) => void;
  /** Update the agents assigned to a skill (skill-centric agent selection) */
  updateSkillAgents: (skillId: string, agentIds: string[]) => Promise<void>;
  /** Batch update skill -> agent mappings in one transaction */
  updateSkillAgentsBatch: (updates: Array<{ skillId: string; agentIds: string[] }>) => Promise<void>;
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  skills: [],
  searchResults: [],
  loading: false,
  searching: false,
  searchError: null,
  installing: {},
  error: null,

  fetchSkills: async () => {
    if (get().skills.length === 0) {
      set({ loading: true, error: null });
    }

    const gatewayDataPromise = useGatewayStore.getState().rpc<GatewaySkillsStatusResult>('skills.status');

    try {
      const localResult = await hostApi.skills.local() as LocalSkillsResult;
      if (!localResult.success) {
        throw new Error(localResult.error || 'Failed to fetch local skills');
      }

      const localSkills = Array.isArray(localResult.skills) ? localResult.skills : [];
      // A transient backend failure (e.g. Windows config read racing an atomic
      // rewrite of openclaw.json) can momentarily yield an empty scan. Overwriting
      // a previously-good list with [] blanks the agent/skill pickers until the
      // next fetch. Keep the last non-empty snapshot instead of clearing it.
      const prevSkills = get().skills;
      if (localSkills.length === 0 && prevSkills.length > 0) {
        console.warn('fetchSkills: local scan returned no skills; keeping previous non-empty list');
        set({ loading: false, error: null });
      } else {
        set({ skills: localSkills, loading: false, error: null });
      }

      void gatewayDataPromise
        .then((gatewayData) => {
          set((state) => ({
            skills: mergeGatewaySkills(state.skills, gatewayData.skills),
            loading: false,
          }));
        })
        .catch(() => {
          // Local data is already rendered; runtime merge is best-effort only.
        });

      return true;
    } catch (error) {
      console.error('Failed to fetch local skills:', error);
      try {
        const gatewayData = await gatewayDataPromise;
        const gatewaySkills = mergeGatewaySkills([], gatewayData.skills);
        // Gateway-only fallback can only recover plugin-sourced skills; the rest
        // need a local match. If it comes back emptier than what we already have,
        // keep the previous list rather than collapsing the pickers.
        const prevSkills = get().skills;
        if (gatewaySkills.length === 0 && prevSkills.length > 0) {
          console.warn('fetchSkills: gateway fallback returned no skills; keeping previous non-empty list');
          set({ loading: false, error: null });
        } else {
          set({ skills: gatewaySkills, loading: false, error: null });
        }
        return true;
      } catch (gatewayError) {
        console.error('Failed to fetch gateway skills fallback:', gatewayError);
        const appError = normalizeAppError(error, { module: 'skills', operation: 'fetch' });
        const errorKey = mapErrorCodeToSkillErrorKey(appError.code, 'fetch');
        set((prev) => ({ loading: false, error: errorKey ?? appError.message, skills: prev.skills }));
        return false;
      }
    }
  },

  searchSkills: async (query: string) => {
    set({ searching: true, searchError: null });
    try {
      const result = await hostApi.skills.marketplaceSearch({ query }) as { success: boolean; results?: MarketplaceSkill[]; error?: string };
      if (result.success) {
        set({ searchResults: result.results || [] });
      } else {
        throw normalizeAppError(new Error(result.error || 'Search failed'), {
          module: 'skills',
          operation: 'search',
        });
      }
    } catch (error) {
      const appError = normalizeAppError(error, { module: 'skills', operation: 'search' });
      set({ searchError: mapErrorCodeToSkillErrorKey(appError.code, 'search') || appError.message });
    } finally {
      set({ searching: false });
    }
  },

  installSkill: async (slug: string, version?: string, options?: SkillInstallContext) => {
    set((state) => ({ installing: { ...state.installing, [slug]: true } }));
    try {
      const installContext = await resolveSkillInstallContext(options);
      const result = await hostApi.skills.marketplaceInstall({
        slug,
        version,
        ...installContext,
      }) as {
        success: boolean;
        error?: string;
        code?: string;
        displayName?: string;
        existingIds?: string[];
      };
      if (!result.success) {
        if (result.error === 'SAME_NAME_EXISTS' || result.code === 'SAME_NAME_EXISTS') {
          const err = new Error('SAME_NAME_EXISTS') as Error & {
            code?: string;
            displayName?: string;
            existingIds?: string[];
          };
          err.code = 'SAME_NAME_EXISTS';
          err.displayName = result.displayName;
          err.existingIds = result.existingIds;
          throw err;
        }
        const appError = normalizeAppError(new Error(result.error || 'Install failed'), {
          module: 'skills',
          operation: 'install',
        });
        throw new Error(mapErrorCodeToSkillErrorKey(appError.code, 'install') || appError.message);
      }
      await get().fetchSkills();
    } catch (error) {
      console.error('Install error:', error);
      throw error;
    } finally {
      set((state) => {
        const newInstalling = { ...state.installing };
        delete newInstalling[slug];
        return { installing: newInstalling };
      });
    }
  },

  installServerMarketplaceSkill: async (
    name: string,
    archiveHash?: string,
    listingRevision?: string,
    version?: string,
    versionBase?: string,
    category?: string,
    options?: SkillInstallContext,
  ) => {
    const key = name.trim();
    set((state) => ({ installing: { ...state.installing, [key]: true } }));
    try {
      const installContext = await resolveSkillInstallContext(options);
      const result = await hostApi.skills.marketplaceInstall({
        name: key,
        archiveHash,
        listingRevision,
        version,
        versionBase,
        category,
        ...installContext,
      }) as {
        success: boolean;
        error?: string;
        code?: string;
        displayName?: string;
        existingIds?: string[];
      };
      if (!result.success) {
        if (result.error === 'SAME_NAME_EXISTS' || result.code === 'SAME_NAME_EXISTS') {
          const err = new Error('SAME_NAME_EXISTS') as Error & {
            code?: string;
            displayName?: string;
            existingIds?: string[];
          };
          err.code = 'SAME_NAME_EXISTS';
          err.displayName = result.displayName;
          err.existingIds = result.existingIds;
          throw err;
        }
        const raw = result.error || 'Install failed';
        const appError = normalizeAppError(new Error(raw), {
          module: 'skills',
          operation: 'install',
        });
        if (appError.code === 'TIMEOUT' || appError.code === 'RATE_LIMIT') {
          const mapped = mapErrorCodeToSkillErrorKey(appError.code, 'install');
          if (mapped) throw new Error(mapped);
        }
        throw new Error(raw);
      }
      await get().fetchSkills();
    } catch (error) {
      console.error('Server marketplace install error:', error);
      throw error;
    } finally {
      set((state) => {
        const next = { ...state.installing };
        delete next[key];
        return { installing: next };
      });
    }
  },

  uninstallSkill: async (slug: string, options?: { baseDir?: string }) => {
    set((state) => ({ installing: { ...state.installing, [slug]: true } }));
    try {
      const result = await hostApi.skills.marketplaceUninstall({ slug, baseDir: options?.baseDir }) as { success: boolean; error?: string };
      if (!result.success) {
        throw new Error(result.error || 'Uninstall failed');
      }
      await get().fetchSkills();
    } catch (error) {
      console.error('Uninstall error:', error);
      throw error;
    } finally {
      set((state) => {
        const newInstalling = { ...state.installing };
        delete newInstalling[slug];
        return { installing: newInstalling };
      });
    }
  },

  setSkills: (skills) => set({ skills }),

  updateSkill: (skillId, updates) => {
    set((state) => ({
      skills: state.skills.map((skill) =>
        skill.id === skillId ? { ...skill, ...updates } : skill,
      ),
    }));
  },

  updateSkillAgents: async (skillId, agentIds) => {
    await get().updateSkillAgentsBatch([{ skillId, agentIds }]);
  },

  updateSkillAgentsBatch: async (updates) => {
    if (updates.length === 0) return;
    try {
      const result = await hostApi.skills.updateAgentsMappingBatch(updates) as { success: boolean; error?: string };
      if (!result.success) {
        throw new Error(result.error || 'Failed to update skill agents');
      }
      const { skills, updateSkill } = get();
      const defaultAgentSkills = useAgentsStore.getState().defaultAgentSkills ?? [];
      for (const update of updates) {
        const catalogSkill = findCatalogSkillByKey(update.skillId, skills);
        const localSkillId = catalogSkill?.id ?? update.skillId;
        const skillKeys = catalogSkill
          ? [
            canonicalSkillKeyFromSkill(catalogSkill),
            normalizeSkillKey(catalogSkill.id),
            normalizeSkillKey(catalogSkill.slug),
            normalizeSkillKey(catalogSkill.name),
          ]
          : [normalizeSkillKey(update.skillId)];
        updateSkill(localSkillId, {
          agents: update.agentIds,
          enabled: resolveSkillEnabledAfterAgentMapping({
            agentIds: update.agentIds,
            skillKeys,
            defaultAgentSkills,
          }),
        });
      }
    } catch (error) {
      console.error('Failed to update skill agents:', error);
      throw error;
    }
  },
}));
