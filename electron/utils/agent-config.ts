import { pinyin } from 'pinyin-pro';
import { copyFile, lstat, mkdir, readdir, rm, stat, rename } from 'fs/promises';
import { join, normalize } from 'path';
import { isDeepStrictEqual } from 'node:util';
import { mutateOpenClawConfig } from '../gateway/config-delivery';
import { withConfigLock } from './config-mutex';
import { deleteAgentChannelAccounts, listConfiguredChannels, readOpenClawConfig, writeOpenClawConfig } from './channel-config';
import type { OpenClawConfig } from './channel-config';
import { expandPath, getOpenClawConfigDir } from './paths';
import * as logger from './logger';
import { toUiChannelType } from './channel-alias';
import { getAllAutoSelect, setAutoSelectForAgent } from '../services/providers/auto-select-store';
import { listProviderAccounts } from '../services/providers/provider-store';
import { seedWorkspaceBootstrapFiles } from './openclaw-workspace';
import { resolveDefaultModelProviderAccountId } from './default-model-provider-account';
import { buildConfiguredModelRefProviderKeys } from './provider-keys';
import { listLocalSkills } from '../services/skills/local-skill-service';
import {
  buildSkillAliasToCanonicalIdMap,
  syncSkillsEntriesEnabledInConfig,
} from './skill-entries-sync';
import {
  mergeGlobalSkillsIntoAgentSkills,
  readDefaultAgentSkillsFromConfig,
} from './global-agent-skills';
import { extractAgentWorkspacesFromEntries } from './agent-workspaces';
import { syncRequiredClawXImagePluginsQuietly } from './clawx-image-plugin-sync';
import {
  buildGlobalCanonicalSkillIdSet,
  canonicalSkillKeyFromRecord,
  collectSkillLookupAliases,
  enhanceSkillsWithAgentAssignments,
  normalizeSkillKey,
  resolveCanonicalSkillAllowlist,
  resolveCanonicalSkillId,
  type SkillWithAgentAssignments,
} from './skill-agent-mapping';

const MAIN_AGENT_ID = 'main';
const MAIN_AGENT_NAME = 'Main Agent';
const DEFAULT_ACCOUNT_ID = 'default';
const DEFAULT_WORKSPACE_PATH = '~/.openclaw/workspace';
const AGENT_BOOTSTRAP_FILES = [
  'AGENTS.md',
  'SOUL.md',
  'TOOLS.md',
  'USER.md',
  'IDENTITY.md',
  'HEARTBEAT.md',
  'BOOT.md',
  'BOOTSTRAP.md',
  'MEMORY.md',
  'memory',
];
const AGENT_RUNTIME_FILES = [
  'auth-profiles.json',
  'models.json',
];

interface AgentModelConfig {
  primary?: string;
  [key: string]: unknown;
}

/** Model modality slots an agent can auto-select for. Mirrors AGENT_MODEL_SLOT_KEYS. */
export type AgentModelSlot =
  | 'model'
  | 'imageModel'
  | 'imageGenerationModel'
  | 'musicGenerationModel'
  | 'videoGenerationModel';

/** Optimization profile weighting for auto-select (see model-routing/select-model). */
export type OptimizationProfile = 'quality' | 'balanced' | 'cost' | 'latency';

/** Per-slot toggle: whether the agent auto-selects the best model for that modality. */
export type AgentAutoSelectConfig = Partial<Record<AgentModelSlot, boolean>>;

interface AgentDefaultsConfig {
  skills?: string[];
  workspace?: string;
  model?: string | AgentModelConfig;
  imageModel?: string | AgentModelConfig;
  imageGenerationModel?: string | AgentModelConfig;
  videoGenerationModel?: string | AgentModelConfig;
  musicGenerationModel?: string | AgentModelConfig;
  [key: string]: unknown;
}

interface AgentListEntry extends Record<string, unknown> {
  id: string;
  name?: string;
  default?: boolean;
  workspace?: string;
  agentDir?: string;
  skills?: string[];
  model?: string | AgentModelConfig;
  imageModel?: string | AgentModelConfig;
  imageGenerationModel?: string | AgentModelConfig;
  videoGenerationModel?: string | AgentModelConfig;
  musicGenerationModel?: string | AgentModelConfig;
}

interface AgentsConfig extends Record<string, unknown> {
  defaults?: AgentDefaultsConfig;
  list?: AgentListEntry[];
}

interface BindingMatch extends Record<string, unknown> {
  channel?: string;
  accountId?: string;
}

interface BindingConfig extends Record<string, unknown> {
  agentId?: string;
  match?: BindingMatch;
}

interface ChannelBindingConfig extends BindingConfig {
  agentId: string;
  match: BindingMatch & { channel: string };
}

interface ChannelSectionConfig extends Record<string, unknown> {
  accounts?: Record<string, Record<string, unknown>>;
  defaultAccount?: string;
  enabled?: boolean;
}

interface AgentConfigDocument extends Record<string, unknown> {
  agents?: AgentsConfig;
  bindings?: BindingConfig[];
  channels?: Record<string, ChannelSectionConfig>;
  session?: {
    mainKey?: string;
    [key: string]: unknown;
  };
}

export interface AgentSummary {
  id: string;
  name: string;
  isDefault: boolean;
  skills?: string[];
  modelDisplay: string;
  modelRef: string | null;
  overrideModelRef: string | null;
  overrideImageModelRef: string | null;
  overrideImageGenerationModelRef: string | null;
  overrideVideoGenerationModelRef: string | null;
  overrideMusicGenerationModelRef: string | null;
  /** Per-slot auto-select toggles, resolved as (defaults ⊕ per-agent override). */
  autoSelectModel: AgentAutoSelectConfig;
  /** Optimization profile driving auto-select utility weighting (default 'balanced'). */
  optimizationProfile: OptimizationProfile;
  /** Compliance/sensitive mode: force origin-tier routing for this agent. */
  sensitiveMode: boolean;
  inheritedModel: boolean;
  workspace: string;
  agentDir: string;
  mainSessionKey: string;
  channelTypes: string[];
}

export interface AgentsSnapshot {
  agents: AgentSummary[];
  defaultAgentId: string;
  defaultModelRef: string | null;
  defaultImageModelRef: string | null;
  defaultImageGenerationModelRef: string | null;
  defaultVideoGenerationModelRef: string | null;
  defaultMusicGenerationModelRef: string | null;
  /** ClawX provider account id for the default model ref (UI list keys), when resolvable. */
  defaultModelProviderAccountId?: string | null;
  configuredChannelTypes: string[];
  channelOwners: Record<string, string>;
  channelAccountOwners: Record<string, string>;
  defaultAgentSkills: string[];
}

function normalizeSkillAllowlist(skills: unknown): string[] {
  if (!Array.isArray(skills)) return [];
  return [...new Set(skills
    .map((item) => (typeof item === 'string' ? item.trim().toLowerCase() : ''))
    .filter(Boolean))];
}

function migrateGlobalEnabledSkillsToPerAgent(
  config: AgentConfigDocument,
  entries: AgentListEntry[],
  agentsConfig: AgentsConfig,
): boolean {
  const skillEntries = config.skills && typeof config.skills === 'object' && !Array.isArray(config.skills)
    ? (config.skills as { entries?: Record<string, { enabled?: boolean } & Record<string, unknown>> }).entries
    : undefined;
  if (!skillEntries || Object.keys(skillEntries).length === 0 || entries.length === 0) {
    return false;
  }

  const globallyEnabled = Object.entries(skillEntries)
    .filter(([, entry]) => entry?.enabled === true)
    .map(([skillKey]) => skillKey.trim())
    .filter(Boolean);
  if (globallyEnabled.length === 0) {
    return false;
  }

  const globallyEnabledNormalized = normalizeSkillAllowlist(globallyEnabled);
  let changed = false;

  const defaults = agentsConfig.defaults && typeof agentsConfig.defaults === 'object'
    ? { ...agentsConfig.defaults }
    : {};
  const prevDefaultsSkills = normalizeSkillAllowlist(defaults.skills);
  const nextDefaultsSkills = mergeGlobalSkillsIntoAgentSkills(prevDefaultsSkills, globallyEnabledNormalized);
  if (
    nextDefaultsSkills.length !== prevDefaultsSkills.length
    || nextDefaultsSkills.some((skill) => !prevDefaultsSkills.includes(skill))
  ) {
    defaults.skills = nextDefaultsSkills;
    agentsConfig.defaults = defaults;
    changed = true;
  }

  for (const entry of entries) {
    const prevSkills = normalizeSkillAllowlist(entry.skills);
    const nextSkills = mergeGlobalSkillsIntoAgentSkills(prevSkills, globallyEnabledNormalized);
    if (
      nextSkills.length !== prevSkills.length
      || nextSkills.some((skill) => !prevSkills.includes(skill))
    ) {
      entry.skills = nextSkills;
      changed = true;
    }
  }

  for (const skillKey of globallyEnabledNormalized) {
    const entry = skillEntries[skillKey];
    if (!entry || entry.enabled !== true) continue;
    delete entry.enabled;
    changed = true;
  }

  return changed;
}

/** Keep skills.entries.enabled aligned with agents.defaults.skills + agents.list[].skills. */
function reconcileSkillsEntriesAfterAgentListChange(
  config: AgentConfigDocument,
  entries: AgentListEntry[],
  localSkills?: Awaited<ReturnType<typeof listLocalSkills>>,
): boolean {
  const aliasToId = localSkills
    ? buildSkillAliasToCanonicalIdMap(localSkills)
    : new Map<string, string>();
  return syncSkillsEntriesEnabledInConfig(
    config,
    entries,
    aliasToId,
    buildGlobalCanonicalSkillIdSet(readDefaultAgentSkillsFromConfig(config), aliasToId),
    localSkills,
  );
}

function dropLegacyMigrationMarker(config: AgentConfigDocument): boolean {
  if (!Object.prototype.hasOwnProperty.call(config, 'clawxMigrations')) {
    return false;
  }
  delete (config as Record<string, unknown>).clawxMigrations;
  return true;
}

function shouldRunLegacyGlobalSkillMigration(
  agentsConfig: AgentsConfig,
  entries: AgentListEntry[],
): boolean {
  if (entries.length === 0) return false;

  const defaultsSkills = agentsConfig.defaults && typeof agentsConfig.defaults === 'object'
    ? agentsConfig.defaults.skills
    : undefined;
  const defaultsAllowlistEstablished = Array.isArray(defaultsSkills) && defaultsSkills.length > 0;
  if (defaultsAllowlistEstablished) {
    return false;
  }

  // One-time legacy migration: only while no agent has an explicit per-agent allowlist field.
  return entries.every((entry) => !Object.prototype.hasOwnProperty.call(entry, 'skills'));
}

function applyAgentSkillsMigrationIfNeeded(
  config: AgentConfigDocument,
  entries: AgentListEntry[],
  agentsConfig: AgentsConfig,
): boolean {
  const cleaned = dropLegacyMigrationMarker(config);
  if (!shouldRunLegacyGlobalSkillMigration(agentsConfig, entries)) {
    return cleaned;
  }
  return migrateGlobalEnabledSkillsToPerAgent(config, entries, agentsConfig) || cleaned;
}

function resolveModelRef(model: unknown): string | null {
  if (typeof model === 'string' && model.trim()) {
    return model.trim();
  }

  if (model && typeof model === 'object') {
    const primary = (model as AgentModelConfig).primary;
    if (typeof primary === 'string' && primary.trim()) {
      return primary.trim();
    }
  }

  return null;
}

function formatModelLabel(model: unknown): string | null {
  const modelRef = resolveModelRef(model);
  if (modelRef) {
    const trimmed = modelRef;
    const parts = trimmed.split('/');
    return parts[parts.length - 1] || trimmed;
  }

  return null;
}

const AGENT_MODEL_SLOT_KEYS = [
  'model',
  'imageModel',
  'imageGenerationModel',
  'musicGenerationModel',
  'videoGenerationModel',
] as const;

/** Provider key encoded in a "providerKey/modelId" ref, or null for bare ids. */
function modelRefProviderKey(ref: string): string | null {
  const separator = ref.indexOf('/');
  return separator > 0 ? ref.slice(0, separator) : null;
}

/**
 * Prune a single model slot (string or `{primary, fallbacks}`) of refs whose
 * provider is no longer configured. Drops the slot entirely when nothing usable
 * remains; otherwise filters stale fallbacks while keeping a valid primary.
 */
function pruneSlotForStaleProviders(
  container: Record<string, unknown>,
  slot: string,
  validRuntimeKeys: Set<string>,
): boolean {
  const value = container[slot];
  if (value === undefined || value === null) return false;

  if (typeof value === 'string') {
    const key = modelRefProviderKey(value.trim());
    if (key && !validRuntimeKeys.has(key)) {
      delete container[slot];
      return true;
    }
    return false;
  }

  if (typeof value !== 'object') return false;

  const modelCfg = value as Record<string, unknown>;
  let changed = false;

  const primary = typeof modelCfg.primary === 'string' ? modelCfg.primary.trim() : '';
  if (primary) {
    const key = modelRefProviderKey(primary);
    if (key && !validRuntimeKeys.has(key)) {
      delete modelCfg.primary;
      changed = true;
    }
  }

  if (Array.isArray(modelCfg.fallbacks)) {
    const filtered = (modelCfg.fallbacks as unknown[]).filter((fallback) => {
      if (typeof fallback !== 'string') return true;
      const key = modelRefProviderKey(fallback.trim());
      return !key || validRuntimeKeys.has(key);
    });
    if (filtered.length !== modelCfg.fallbacks.length) {
      modelCfg.fallbacks = filtered.length > 0 ? filtered : undefined;
      changed = true;
    }
  }

  const hasPrimary = typeof modelCfg.primary === 'string' && modelCfg.primary.trim().length > 0;
  const hasFallbacks = Array.isArray(modelCfg.fallbacks) && modelCfg.fallbacks.length > 0;
  if (!hasPrimary && !hasFallbacks) {
    delete container[slot];
  }
  return changed;
}

/**
 * Clear model refs (global `agents.defaults.*` and per-agent `agents.list[].*`,
 * across every model kind) that point to a provider the user has deleted.
 * `validRuntimeKeys` is the set of runtime keys for currently-configured provider
 * accounts; a ref whose provider key is absent is treated as stale. Callers must
 * skip this when no accounts are loaded, so a transient read failure can't wipe
 * every ref.
 */
function pruneStaleAgentModelOverrides(
  config: AgentConfigDocument,
  entries: AgentListEntry[],
  validRuntimeKeys: Set<string>,
): boolean {
  let changed = false;
  const pruneContainer = (container: Record<string, unknown> | undefined): void => {
    if (!container || typeof container !== 'object') return;
    for (const slot of AGENT_MODEL_SLOT_KEYS) {
      if (pruneSlotForStaleProviders(container, slot, validRuntimeKeys)) {
        changed = true;
      }
    }
  };

  for (const entry of entries) {
    pruneContainer(entry as Record<string, unknown>);
  }
  pruneContainer((config.agents as AgentsConfig | undefined)?.defaults as Record<string, unknown> | undefined);

  return changed;
}

function normalizeAgentName(name: string): string {
  return name.trim() || 'Agent';
}

export function slugifyAgentId(name: string): string {
  // Convert Chinese characters to pinyin
  const pinyinName = pinyin(name, { toneType: 'none', type: 'string', v: true, nonZh: 'consecutive' });
  
  const normalized = pinyinName
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9\s-]/g, ' ') // Replace non-alphanumeric (except hyphen) with space
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-') // Replace spaces and underscores with hyphen
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-|-$/g, ''); // Trim hyphens from start/end

  if (!normalized || /^\d+$/.test(normalized)) return 'agent';
  if (normalized === MAIN_AGENT_ID) return 'agent';
  return normalized;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(path: string): Promise<void> {
  if (!(await fileExists(path))) {
    await mkdir(path, { recursive: true });
  }
}

function getDefaultWorkspacePath(config: AgentConfigDocument): string {
  const defaults = (config.agents && typeof config.agents === 'object'
    ? (config.agents as AgentsConfig).defaults
    : undefined);
  return typeof defaults?.workspace === 'string' && defaults.workspace.trim()
    ? defaults.workspace
    : DEFAULT_WORKSPACE_PATH;
}

function getDefaultAgentDirPath(agentId: string): string {
  return `~/.openclaw/agents/${agentId}/agent`;
}

function createImplicitMainEntry(config: AgentConfigDocument): AgentListEntry {
  return {
    id: MAIN_AGENT_ID,
    name: MAIN_AGENT_NAME,
    default: true,
    workspace: getDefaultWorkspacePath(config),
    agentDir: getDefaultAgentDirPath(MAIN_AGENT_ID),
  };
}

function normalizeAgentsConfig(config: AgentConfigDocument): {
  agentsConfig: AgentsConfig;
  entries: AgentListEntry[];
  defaultAgentId: string;
  syntheticMain: boolean;
} {
  const agentsConfig = (config.agents && typeof config.agents === 'object'
    ? { ...(config.agents as AgentsConfig) }
    : {}) as AgentsConfig;
  const hasExplicitList = Array.isArray(agentsConfig.list);
  const rawEntries = hasExplicitList
    ? agentsConfig.list!.filter((entry): entry is AgentListEntry => (
      Boolean(entry) && typeof entry === 'object' && typeof entry.id === 'string' && entry.id.trim().length > 0
    ))
    : [];

  if (rawEntries.length === 0) {
    if (hasExplicitList) {
      return {
        agentsConfig,
        entries: [],
        defaultAgentId: '',
        syntheticMain: false,
      };
    }

    const main = createImplicitMainEntry(config);
    return {
      agentsConfig,
      entries: [main],
      defaultAgentId: MAIN_AGENT_ID,
      syntheticMain: true,
    };
  }

  const defaultEntry = rawEntries.find((entry) => entry.default) ?? rawEntries[0];
  return {
    agentsConfig,
    entries: rawEntries.map((entry) => ({ ...entry })),
    defaultAgentId: defaultEntry.id,
    syntheticMain: false,
  };
}

function isChannelBinding(binding: unknown): binding is ChannelBindingConfig {
  if (!binding || typeof binding !== 'object') return false;
  const candidate = binding as BindingConfig;
  if (typeof candidate.agentId !== 'string' || !candidate.agentId) return false;
  if (!candidate.match || typeof candidate.match !== 'object' || Array.isArray(candidate.match)) return false;
  if (typeof candidate.match.channel !== 'string' || !candidate.match.channel) return false;
  const keys = Object.keys(candidate.match);
  // Accept bindings with just {channel} or {channel, accountId}
  if (keys.length === 1 && keys[0] === 'channel') return true;
  if (keys.length === 2 && keys.includes('channel') && keys.includes('accountId')) return true;
  return false;
}

/** Normalize agent ID for consistent comparison (bindings vs entries). */
function normalizeAgentIdForBinding(id: string): string {
  return (id ?? '').trim().toLowerCase() || '';
}

function normalizeMainKey(value: unknown): string {
  if (typeof value !== 'string') return 'main';
  const trimmed = value.trim().toLowerCase();
  return trimmed || 'main';
}

function buildAgentMainSessionKey(config: AgentConfigDocument, agentId: string): string {
  return `agent:${normalizeAgentIdForBinding(agentId) || MAIN_AGENT_ID}:${normalizeMainKey(config.session?.mainKey)}`;
}

/**
 * Returns a map of channelType -> agentId from bindings.
 * Account-scoped bindings are preferred; channel-wide bindings serve as fallback.
 * Multiple agents can own the same channel type (different accounts).
 */
function getChannelBindingMap(bindings: unknown): {
  channelToAgent: Map<string, string>;
  accountToAgent: Map<string, string>;
} {
  const channelToAgent = new Map<string, string>();
  const accountToAgent = new Map<string, string>();
  if (!Array.isArray(bindings)) return { channelToAgent, accountToAgent };

  for (const binding of bindings) {
    if (!isChannelBinding(binding)) continue;
    const agentId = normalizeAgentIdForBinding(binding.agentId!);
    const channel = binding.match?.channel;
    if (!agentId || !channel) continue;

    const accountId = binding.match?.accountId;
    if (accountId) {
      accountToAgent.set(`${channel}:${accountId}`, agentId);
    } else {
      channelToAgent.set(channel, agentId);
    }
  }

  return { channelToAgent, accountToAgent };
}

function upsertBindingsForChannel(
  bindings: unknown,
  channelType: string,
  agentId: string | null,
  accountId?: string,
): BindingConfig[] | undefined {
  const normalizedAccountId = accountId?.trim() || '';
  const nextBindings = Array.isArray(bindings)
    ? [...bindings as BindingConfig[]].filter((binding) => {
      if (!isChannelBinding(binding)) return true;
      if (binding.match?.channel !== channelType) return true;

      const bindingAccountId = typeof binding.match?.accountId === 'string'
        ? binding.match.accountId.trim()
        : '';

      // Account-scoped updates must only replace the exact account owner.
      // Otherwise rebinding one Feishu/Lark account can silently drop a
      // sibling account binding on the same agent, which looks like routing
      // or model config "drift" in multi-account setups.
      if (normalizedAccountId) {
        return bindingAccountId !== normalizedAccountId;
      }

      // No accountId: remove channel-wide binding (legacy)
      return Boolean(bindingAccountId);
    })
    : [];

  if (agentId) {
    const match: BindingMatch = { channel: channelType };
    if (normalizedAccountId) {
      match.accountId = normalizedAccountId;
    }
    nextBindings.push({ agentId, match });
  }

  return nextBindings.length > 0 ? nextBindings : undefined;
}

async function listExistingAgentIdsOnDisk(): Promise<Set<string>> {
  const ids = new Set<string>();
  const agentsDir = join(getOpenClawConfigDir(), 'agents');

  try {
    if (!(await fileExists(agentsDir))) return ids;
    const entries = await readdir(agentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) ids.add(entry.name);
    }
  } catch {
    // ignore discovery failures
  }

  return ids;
}

function agentListEntryFromDiskId(
  agentId: string,
  config: AgentConfigDocument,
): AgentListEntry {
  const isMain = agentId === MAIN_AGENT_ID;
  return {
    id: agentId,
    name: isMain ? MAIN_AGENT_NAME : agentId,
    ...(isMain ? { default: true } : {}),
    workspace: isMain
      ? getDefaultWorkspacePath(config)
      : `~/.openclaw/workspace-${agentId}`,
    agentDir: getDefaultAgentDirPath(agentId),
  };
}

/**
 * Repair openclaw.json when agents.list was lost but ~/.openclaw/agents/* still exist.
 * Prevents the Agents UI from showing only the implicit "main" entry after a partial config write.
 */
export async function reconcileAgentsListFromDisk(
  config: AgentConfigDocument,
): Promise<{ config: AgentConfigDocument; repaired: boolean }> {
  const diskIds = await listExistingAgentIdsOnDisk();
  if (diskIds.size === 0) return { config, repaired: false };

  const agentsConfig = (config.agents && typeof config.agents === 'object'
    ? { ...(config.agents as AgentsConfig) }
    : {}) as AgentsConfig;
  if (Array.isArray(agentsConfig.list)) {
    return { config, repaired: false };
  }

  const { entries } = normalizeAgentsConfig(config);
  const listedIds = new Set(entries.map((entry) => entry.id));
  const missingDiskIds = [...diskIds].filter((id) => !listedIds.has(id));

  if (missingDiskIds.length === 0) {
    return { config, repaired: false };
  }

  const sortedDiskIds = [...diskIds].sort((a, b) => {
    if (a === MAIN_AGENT_ID) return -1;
    if (b === MAIN_AGENT_ID) return 1;
    return a.localeCompare(b);
  });

  const mergedById = new Map<string, AgentListEntry>();
  for (const entry of entries) {
    mergedById.set(entry.id, { ...entry });
  }
  for (const id of sortedDiskIds) {
    if (!mergedById.has(id)) {
      mergedById.set(id, agentListEntryFromDiskId(id, config));
    }
  }
  if (!mergedById.has(MAIN_AGENT_ID)) {
    mergedById.set(MAIN_AGENT_ID, createImplicitMainEntry(config));
  }

  const nextEntries = [...mergedById.values()].sort((a, b) => {
    if (a.id === MAIN_AGENT_ID) return -1;
    if (b.id === MAIN_AGENT_ID) return 1;
    return a.id.localeCompare(b.id);
  });
  const defaultId =
    nextEntries.find((entry) => entry.default)?.id
    ?? nextEntries.find((entry) => entry.id === MAIN_AGENT_ID)?.id
    ?? nextEntries[0]!.id;
  const list = nextEntries.map((entry) => ({
    ...entry,
    default: entry.id === defaultId,
  }));

  return {
    config: {
      ...config,
      agents: {
        ...agentsConfig,
        list,
      },
    },
    repaired: true,
  };
}

async function removeAgentRuntimeDirectory(agentId: string): Promise<void> {
  const runtimeDir = join(getOpenClawConfigDir(), 'agents', agentId);
  try {
    await rm(runtimeDir, { recursive: true, force: true });
  } catch (error) {
    logger.warn('Failed to remove agent runtime directory', {
      agentId,
      runtimeDir,
      error: String(error),
    });
  }
}

function trimTrailingSeparators(path: string): string {
  return path.replace(/[\\/]+$/, '');
}

function getManagedWorkspaceDirectory(agent: AgentListEntry): string | null {
  if (agent.id === MAIN_AGENT_ID) return null;

  const configuredWorkspace = expandPath(agent.workspace || `~/.openclaw/workspace-${agent.id}`);
  const managedWorkspace = join(getOpenClawConfigDir(), `workspace-${agent.id}`);
  const normalizedConfigured = trimTrailingSeparators(normalize(configuredWorkspace));
  const normalizedManaged = trimTrailingSeparators(normalize(managedWorkspace));

  return normalizedConfigured === normalizedManaged ? configuredWorkspace : null;
}

export async function removeAgentWorkspaceDirectory(agent: { id: string; workspace?: string }): Promise<void> {
  const workspaceDir = getManagedWorkspaceDirectory(agent as AgentListEntry);
  if (!workspaceDir) {
    logger.warn('Skipping agent workspace deletion for unmanaged path', {
      agentId: agent.id,
      workspace: agent.workspace,
    });
    return;
  }

  try {
    await rm(workspaceDir, { recursive: true, force: true });
  } catch (error) {
    logger.warn('Failed to remove agent workspace directory', {
      agentId: agent.id,
      workspaceDir,
      error: String(error),
    });
  }
}

async function copyDirectory(src: string, dest: string): Promise<void> {
  const entries = await readdir(src, { withFileTypes: true });
  await ensureDir(dest);
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      if (!(await fileExists(destPath))) {
        await copyFile(srcPath, destPath);
      }
    }
  }
}

async function copyBootstrapFiles(sourceWorkspace: string, targetWorkspace: string): Promise<void> {
  await ensureDir(targetWorkspace);

  for (const fileName of AGENT_BOOTSTRAP_FILES) {
    const source = join(sourceWorkspace, fileName);
    const target = join(targetWorkspace, fileName);
    
    if (!(await fileExists(source))) continue;
    const s = await stat(source).catch(() => null);
    if (!s) continue;

    if (s.isDirectory()) {
      await copyDirectory(source, target);
    } else {
      if (!(await fileExists(target))) {
        await copyFile(source, target);
      }
    }
  }
}

async function copyRuntimeFiles(sourceAgentDir: string, targetAgentDir: string): Promise<void> {
  await ensureDir(targetAgentDir);

  for (const fileName of AGENT_RUNTIME_FILES) {
    const source = join(sourceAgentDir, fileName);
    const target = join(targetAgentDir, fileName);
    if (!(await fileExists(source)) || (await fileExists(target))) continue;
    await copyFile(source, target);
  }
}

async function provisionAgentFilesystem(
  config: AgentConfigDocument,
  agent: AgentListEntry,
  options?: { inheritWorkspace?: boolean },
): Promise<void> {
  const { entries } = normalizeAgentsConfig(config);
  const mainEntry = entries.find((entry) => entry.id === MAIN_AGENT_ID) ?? createImplicitMainEntry(config);
  const sourceWorkspace = expandPath(mainEntry.workspace || getDefaultWorkspacePath(config));
  const targetWorkspace = expandPath(agent.workspace || `~/.openclaw/workspace-${agent.id}`);
  const sourceAgentDir = expandPath(mainEntry.agentDir || getDefaultAgentDirPath(MAIN_AGENT_ID));
  const targetAgentDir = expandPath(agent.agentDir || getDefaultAgentDirPath(agent.id));
  const targetSessionsDir = join(getOpenClawConfigDir(), 'agents', agent.id, 'sessions');

  await ensureDir(targetWorkspace);
  await ensureDir(targetAgentDir);
  await ensureDir(targetSessionsDir);

  // When inheritWorkspace is true, copy the main agent's workspace bootstrap
  // files (SOUL.md, AGENTS.md, etc.) so the new agent inherits the same
  // personality / instructions. When false (default), use the OpenClaw CLI
  // to seed the standard default bootstrap files in the new workspace.
  if (targetWorkspace !== sourceWorkspace) {
    if (options?.inheritWorkspace) {
      await copyBootstrapFiles(sourceWorkspace, targetWorkspace);
    } else {
      try {
        await seedWorkspaceBootstrapFiles(targetWorkspace);
        logger.info('Seeded default agent workspace templates via CLI', { targetWorkspace });
      } catch (error) {
        logger.error('Failed to seed workspace templates via CLI', { targetWorkspace, error: String(error) });
      }
    }
  }
  if (targetAgentDir !== sourceAgentDir) {
    await copyRuntimeFiles(sourceAgentDir, targetAgentDir);
  }
}

export function resolveAccountIdForAgent(agentId: string): string {
  return agentId === MAIN_AGENT_ID ? DEFAULT_ACCOUNT_ID : agentId;
}

function listConfiguredAccountIdsForChannel(config: AgentConfigDocument, channelType: string): string[] {
  const channelSection = config.channels?.[channelType];
  if (!channelSection || channelSection.enabled === false) {
    return [];
  }

  const accounts = channelSection.accounts;
  if (!accounts || typeof accounts !== 'object' || Object.keys(accounts).length === 0) {
    return [DEFAULT_ACCOUNT_ID];
  }

  return Object.keys(accounts)
    .filter(Boolean)
    .sort((a, b) => {
      if (a === DEFAULT_ACCOUNT_ID) return -1;
      if (b === DEFAULT_ACCOUNT_ID) return 1;
      return a.localeCompare(b);
    });
}

async function buildSnapshotFromConfig(
  config: AgentConfigDocument,
  preloadedChannels?: string[],
  options?: { persist?: boolean },
): Promise<AgentsSnapshot> {
  const persist = options?.persist !== false;
  const { entries, defaultAgentId, agentsConfig } = normalizeAgentsConfig(config);

  // Load configured provider accounts once: used both to prune stale model refs
  // (refs to deleted providers) and to resolve the default model's account id.
  let providerAccounts: Awaited<ReturnType<typeof listProviderAccounts>> = [];
  try {
    providerAccounts = await listProviderAccounts();
  } catch (error) {
    logger.warn('Could not load provider accounts for agents snapshot', { error: String(error) });
  }
  const validRuntimeKeys = buildConfiguredModelRefProviderKeys(providerAccounts);

  let configChanged = false;
  if (persist) {
    if (applyAgentSkillsMigrationIfNeeded(config, entries, agentsConfig)) {
      config.agents = {
        ...agentsConfig,
        list: entries,
      };
      configChanged = true;
    }
    // Skip pruning when no accounts loaded — a transient store read failure must
    // not wipe every agent/default model ref.
    if (providerAccounts.length > 0 && pruneStaleAgentModelOverrides(config, entries, validRuntimeKeys)) {
      config.agents = {
        ...agentsConfig,
        list: entries,
      };
      configChanged = true;
    }
    if (reconcileSkillsEntriesAfterAgentListChange(config, entries)) {
      configChanged = true;
    }
    if (configChanged) {
      await writeOpenClawConfig(config);
    }
  }
  const configuredChannels = preloadedChannels ?? await listConfiguredChannels();
  const { channelToAgent, accountToAgent } = getChannelBindingMap(config.bindings);
  const defaultAgentIdNorm = normalizeAgentIdForBinding(defaultAgentId);
  const channelOwners: Record<string, string> = {};
  const channelAccountOwners: Record<string, string> = {};

  // Build per-agent channel lists from account-scoped bindings
  const agentChannelSets = new Map<string, Set<string>>();

  for (const channelType of configuredChannels) {
    const accountIds = listConfiguredAccountIdsForChannel(config, channelType);
    let primaryOwner: string | undefined;
    for (const accountId of accountIds) {
      const owner =
        accountToAgent.get(`${channelType}:${accountId}`)
        || (
          accountId === DEFAULT_ACCOUNT_ID
            ? channelToAgent.get(channelType)
            : undefined
        );

      if (!owner) {
        continue;
      }

      channelAccountOwners[`${channelType}:${accountId}`] = owner;
      primaryOwner ??= owner;
      const existing = agentChannelSets.get(owner) ?? new Set();
      existing.add(channelType);
      agentChannelSets.set(owner, existing);
    }

    if (!primaryOwner) {
      primaryOwner = channelToAgent.get(channelType) || defaultAgentIdNorm;
      if (!primaryOwner) {
        continue;
      }
      const existing = agentChannelSets.get(primaryOwner) ?? new Set();
      existing.add(channelType);
      agentChannelSets.set(primaryOwner, existing);
    }

    channelOwners[channelType] = primaryOwner;
  }

  const defaultModelConfig = (config.agents as AgentsConfig | undefined)?.defaults?.model;
  const defaultImageModelConfig = (config.agents as AgentsConfig | undefined)?.defaults?.imageModel;
  const defaultImageGenerationModelConfig = (config.agents as AgentsConfig | undefined)?.defaults?.imageGenerationModel;
  const defaultVideoGenerationModelConfig = (config.agents as AgentsConfig | undefined)?.defaults?.videoGenerationModel;
  const defaultMusicGenerationModelConfig = (config.agents as AgentsConfig | undefined)?.defaults?.musicGenerationModel;
  
  const defaultModelLabel = formatModelLabel(defaultModelConfig);
  const defaultModelRef = resolveModelRef(defaultModelConfig);
  const defaultImageModelRef = resolveModelRef(defaultImageModelConfig);
  const defaultImageGenerationModelRef = resolveModelRef(defaultImageGenerationModelConfig);
  const defaultVideoGenerationModelRef = resolveModelRef(defaultVideoGenerationModelConfig);
  const defaultMusicGenerationModelRef = resolveModelRef(defaultMusicGenerationModelConfig);

  // Auto-select settings live in the ClawX store, NOT openclaw.json (writing
  // unknown keys into openclaw.json breaks gateway config validation).
  const autoSelectByAgent = await getAllAutoSelect();

  const agents: AgentSummary[] = entries.map((entry) => {
    const explicitModelRef = resolveModelRef(entry.model);
    const explicitImageModelRef = resolveModelRef(entry.imageModel);
    const explicitImageGenerationModelRef = resolveModelRef(entry.imageGenerationModel);
    const explicitVideoGenerationModelRef = resolveModelRef(entry.videoGenerationModel);
    const explicitMusicGenerationModelRef = resolveModelRef(entry.musicGenerationModel);
    
    const modelLabel = formatModelLabel(entry.model) || defaultModelLabel || 'Not configured';
    const inheritedModel = !explicitModelRef && Boolean(defaultModelLabel);
    const entryIdNorm = normalizeAgentIdForBinding(entry.id);
    const ownedChannels = agentChannelSets.get(entryIdNorm) ?? new Set<string>();
    return {
      id: entry.id,
      name: entry.name || (entry.id === MAIN_AGENT_ID ? MAIN_AGENT_NAME : entry.id),
      isDefault: entry.id === defaultAgentId,
      skills: normalizeSkillAllowlist(entry.skills),
      modelDisplay: modelLabel,
      modelRef: explicitModelRef || defaultModelRef || null,
      overrideModelRef: explicitModelRef,
      overrideImageModelRef: explicitImageModelRef,
      overrideImageGenerationModelRef: explicitImageGenerationModelRef,
      overrideVideoGenerationModelRef: explicitVideoGenerationModelRef,
      overrideMusicGenerationModelRef: explicitMusicGenerationModelRef,
      autoSelectModel: autoSelectByAgent[entry.id]?.autoSelectModel ?? {},
      optimizationProfile: autoSelectByAgent[entry.id]?.optimizationProfile ?? 'balanced',
      sensitiveMode: autoSelectByAgent[entry.id]?.sensitiveMode ?? false,
      inheritedModel,
      workspace: entry.workspace || (entry.id === MAIN_AGENT_ID ? getDefaultWorkspacePath(config) : `~/.openclaw/workspace-${entry.id}`),
      agentDir: entry.agentDir || getDefaultAgentDirPath(entry.id),
      mainSessionKey: buildAgentMainSessionKey(config, entry.id),
      channelTypes: configuredChannels
        .filter((ct) => ownedChannels.has(ct))
        .map((channelType) => toUiChannelType(channelType)),
    };
  });

  let defaultModelProviderAccountId: string | null = null;
  try {
    defaultModelProviderAccountId = resolveDefaultModelProviderAccountId(defaultModelRef, providerAccounts);
  } catch (error) {
    logger.warn('Could not resolve default model provider account id', { error: String(error) });
  }

  return {
    agents,
    defaultAgentId,
    defaultModelRef,
    defaultImageModelRef,
    defaultImageGenerationModelRef,
    defaultVideoGenerationModelRef,
    defaultMusicGenerationModelRef,
    defaultModelProviderAccountId,
    configuredChannelTypes: configuredChannels.map((channelType) => toUiChannelType(channelType)),
    channelOwners,
    channelAccountOwners,
    defaultAgentSkills: readDefaultAgentSkillsFromConfig(config),
  };
}

/** Read-only: agent id → display name from openclaw.json (no reconcile/migrate/write). */
export async function readAgentDisplayNamesFromConfig(): Promise<Map<string, string>> {
  const config = (await readOpenClawConfig()) as AgentConfigDocument;
  const list = config.agents?.list ?? [];
  const map = new Map<string, string>();
  for (const entry of list) {
    const id = entry.id?.trim();
    if (!id) continue;
    map.set(id, entry.name?.trim() || id);
  }
  return map;
}

/** Read-only: known agent ids from openclaw.json (no reconcile/migrate/write). */
export async function readAgentIdsFromOpenClawConfig(): Promise<Set<string>> {
  const config = (await readOpenClawConfig()) as AgentConfigDocument;
  const list = config.agents?.list ?? [];
  return new Set(list.map((entry) => entry.id?.trim()).filter(Boolean) as string[]);
}

/** Build agents snapshot from on-disk config only (no reconcile / write). */
export async function listAgentsSnapshotReadOnly(): Promise<AgentsSnapshot> {
  const config = (await readOpenClawConfig()) as AgentConfigDocument;
  return buildSnapshotFromConfig(config, undefined, { persist: false });
}

export async function listAgentsSnapshot(): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    let config = (await readOpenClawConfig()) as AgentConfigDocument;
    const { config: reconciled, repaired } = await reconcileAgentsListFromDisk(config);
    if (repaired) {
      config = reconciled;
      await writeOpenClawConfig(config);
      logger.info('Reconciled agents.list from on-disk agent directories', {
        count: Array.isArray((config.agents as AgentsConfig | undefined)?.list)
          ? (config.agents as AgentsConfig).list!.length
          : 0,
      });
    }
    return buildSnapshotFromConfig(config);
  });
}

export async function listAgentsSnapshotFromConfig(config: OpenClawConfig, configuredChannels?: string[]): Promise<AgentsSnapshot> {
  return buildSnapshotFromConfig(config as AgentConfigDocument, configuredChannels);
}

/** Single-scan local skills with agent assignments; syncs skills.entries in one config lock. */
export async function listEnhancedLocalSkills(): Promise<SkillWithAgentAssignments[]> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const { agentsConfig, entries } = normalizeAgentsConfig(config);
    if (applyAgentSkillsMigrationIfNeeded(config, entries, agentsConfig)) {
      config.agents = {
        ...agentsConfig,
        list: entries,
      };
    }

    const agentWorkspaces = extractAgentWorkspacesFromEntries(entries);
    const localSkills = await listLocalSkills({ agentWorkspaces });
    const aliasToId = buildSkillAliasToCanonicalIdMap(localSkills);
    const globalCanonicalIds = buildGlobalCanonicalSkillIdSet(
      readDefaultAgentSkillsFromConfig(config),
      aliasToId,
    );
    const entriesChanged = syncSkillsEntriesEnabledInConfig(
      config,
      entries,
      aliasToId,
      globalCanonicalIds,
      localSkills,
    );
    if (entriesChanged) {
      // This is a read path (listing skills). Syncing the enabled flags back to
      // disk is a convenience, not a requirement — and on Windows the write can
      // transiently fail (EPERM/EBUSY during the atomic rename while the Gateway
      // watcher holds a handle). Never let that failure reject the whole skill
      // listing; the in-memory `config` already carries the correct flags.
      try {
        await writeOpenClawConfig(config);
      } catch (error) {
        logger.warn('Failed to persist synced skill enabled flags during listEnhancedLocalSkills; continuing with in-memory config', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const snapshot = await listAgentsSnapshotFromConfig(config);
    return enhanceSkillsWithAgentAssignments(localSkills, snapshot.agents, globalCanonicalIds);
  });
}

export async function listConfiguredAgentIds(): Promise<string[]> {
  const config = await readOpenClawConfig() as AgentConfigDocument;
  const hasExplicitList = Boolean(config.agents && typeof config.agents === 'object' && Array.isArray((config.agents as AgentsConfig).list));
  const { entries } = normalizeAgentsConfig(config);
  const ids = [...new Set(entries.map((entry) => entry.id.trim()).filter(Boolean))];
  return ids.length > 0 || hasExplicitList ? ids : [MAIN_AGENT_ID];
}

/**
 * Resolve agentId from channel and accountId using bindings.
 * Returns the agentId if found, or null if no binding exists.
 */
export async function resolveAgentIdFromChannel(channel: string, accountId?: string): Promise<string | null> {
  const config = await readOpenClawConfig() as AgentConfigDocument;
  const { channelToAgent, accountToAgent } = getChannelBindingMap(config.bindings);

  // First try account-specific binding
  if (accountId) {
    const agentId = accountToAgent.get(`${channel}:${accountId}`);
    if (agentId) return agentId;
  }

  // Fallback to channel-only binding
  const agentId = channelToAgent.get(channel);
  return agentId ?? null;
}

export async function createAgent(
  name: string,
  options?: { inheritWorkspace?: boolean; id?: string; skills?: string[] },
): Promise<AgentsSnapshot> {
  let snapshot: AgentsSnapshot | undefined;
  let createdAgentId = '';
  let agentToProvision: AgentListEntry | undefined;
  let provisioningConfig: AgentConfigDocument | undefined;
  await mutateOpenClawConfig(async (configSnapshot) => {
    const config = configSnapshot as AgentConfigDocument;
    const { agentsConfig, entries, syntheticMain } = normalizeAgentsConfig(config);
    if (applyAgentSkillsMigrationIfNeeded(config, entries, agentsConfig)) {
      config.agents = {
        ...agentsConfig,
        list: entries,
      };
    }
    const normalizedName = normalizeAgentName(name);
    const existingIds = new Set(entries.map((entry) => entry.id));
    const diskIds = await listExistingAgentIdsOnDisk();
    
    let nextId: string;
    if (options?.id) {
      nextId = options.id.trim().toLowerCase();
      if (!/^[a-z0-9_-]+$/.test(nextId)) {
        throw new Error('Agent id must contain only letters, digits, hyphen, underscore');
      }
      if (nextId === MAIN_AGENT_ID) {
        throw new Error('Cannot create an agent with reserved id "main"');
      }
      if (existingIds.has(nextId) || diskIds.has(nextId)) {
        throw new Error(`Agent id "${nextId}" already exists`);
      }
    } else {
      nextId = slugifyAgentId(normalizedName);
      let suffix = 2;

      while (existingIds.has(nextId) || diskIds.has(nextId)) {
        nextId = `${slugifyAgentId(normalizedName)}-${suffix}`;
        suffix += 1;
      }
    }

    const nextEntries = syntheticMain ? [createImplicitMainEntry(config), ...entries.filter((_, index) => index > 0)] : [...entries];
    const localSkills = await listLocalSkills({
      agentWorkspaces: extractAgentWorkspacesFromEntries(nextEntries),
    });
    const newAgent: AgentListEntry = {
      id: nextId,
      name: normalizedName,
      ...(nextEntries.length === 0 ? { default: true } : {}),
      workspace: `~/.openclaw/workspace-${nextId}`,
      agentDir: getDefaultAgentDirPath(nextId),
      // UI pre-fills defaults; persist user selection as-is so per-agent global opt-out works.
      skills: normalizeSkillAllowlist(resolveCanonicalSkillAllowlist(options?.skills, localSkills)),
    };

    if (!nextEntries.some((entry) => entry.id === MAIN_AGENT_ID) && syntheticMain) {
      nextEntries.unshift(createImplicitMainEntry(config));
    }
    nextEntries.push(newAgent);

    config.agents = {
      ...agentsConfig,
      list: nextEntries,
    };

    syncSkillsEntriesEnabledInConfig(
      config,
      nextEntries,
      buildSkillAliasToCanonicalIdMap(localSkills),
      buildGlobalCanonicalSkillIdSet(readDefaultAgentSkillsFromConfig(config), buildSkillAliasToCanonicalIdMap(localSkills)),
      localSkills,
    );
    // Filesystem provisioning happens after the coordinator commits below, so a
    // provisioning failure can roll the new entry back out of the config.
    createdAgentId = nextId;
    agentToProvision = newAgent;
    provisioningConfig = structuredClone(config);
    snapshot = await buildSnapshotFromConfig(config);
  });
  const createdAgent = agentToProvision!;
  const workspaceExisted = await fileExists(expandPath(createdAgent.workspace!));
  const runtimeDirectory = join(getOpenClawConfigDir(), 'agents', createdAgent.id);
  const runtimeDirectoryExisted = await fileExists(runtimeDirectory);
  try {
    await provisionAgentFilesystem(provisioningConfig!, createdAgent, { inheritWorkspace: options?.inheritWorkspace });
  } catch (provisioningError) {
    let rollbackError: unknown;
    try {
      await mutateOpenClawConfig((configSnapshot) => {
        const config = configSnapshot as AgentConfigDocument;
        const { agentsConfig, entries } = normalizeAgentsConfig(config);
        const createdIndex = entries.findIndex((entry) => (
          entry.id === createdAgent.id && isDeepStrictEqual(entry, createdAgent)
        ));
        if (createdIndex === -1) return;
        config.agents = {
          ...agentsConfig,
          list: entries.filter((_, index) => index !== createdIndex),
        };
      });
    } catch (error) {
      rollbackError = error;
    }

    if (!workspaceExisted) {
      await removeAgentWorkspaceDirectory(createdAgent);
    }
    if (!runtimeDirectoryExisted) {
      await removeAgentRuntimeDirectory(createdAgent.id);
    }
    if (rollbackError) {
      throw new AggregateError(
        [provisioningError, rollbackError],
        `Failed to provision agent "${createdAgent.id}" and roll back its config entry`,
        { cause: provisioningError },
      );
    }
    throw provisioningError;
  }
  logger.info('Created agent config entry', { agentId: createdAgentId, inheritWorkspace: !!options?.inheritWorkspace });
  return snapshot!;
}

/**
 * Create an agent with an explicit id (Manager remote sync / workbench).
 * Does not slugify the id beyond trim + lowercase ASCII normalization.
 */
export async function createAgentWithSuppliedId(
  agentIdInput: string,
  options?: { displayName?: string; workspace?: string; inheritWorkspace?: boolean; skills?: string[] },
): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const agentId = agentIdInput.trim().toLowerCase();
    if (!agentId) {
      throw new Error('Agent id is required');
    }
    if (!/^[a-z0-9_-]+$/.test(agentId)) {
      throw new Error('Agent id must contain only letters, digits, hyphen, underscore');
    }
    if (agentId === MAIN_AGENT_ID) {
      throw new Error('Cannot create an agent with reserved id "main"');
    }
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const { agentsConfig, entries, syntheticMain } = normalizeAgentsConfig(config);
    if (applyAgentSkillsMigrationIfNeeded(config, entries, agentsConfig)) {
      config.agents = {
        ...agentsConfig,
        list: entries,
      };
    }
    const existingIds = new Set(entries.map((entry) => entry.id));
    const diskIds = await listExistingAgentIdsOnDisk();
    if (existingIds.has(agentId) || diskIds.has(agentId)) {
      throw new Error(`Agent id "${agentId}" already exists`);
    }
    const displayName = options?.displayName?.trim()
      ? normalizeAgentName(options.displayName)
      : agentId;
    const workspace =
      typeof options?.workspace === 'string' && options.workspace.trim()
        ? options.workspace.trim()
        : `~/.openclaw/workspace-${agentId}`;
    const nextEntries = syntheticMain
      ? [createImplicitMainEntry(config), ...entries.filter((_, index) => index > 0)]
      : [...entries];
    const localSkills = await listLocalSkills({
      agentWorkspaces: extractAgentWorkspacesFromEntries(nextEntries),
    });
    const defaultSkills = readDefaultAgentSkillsFromConfig(config);
    const initialSkills = options?.skills !== undefined
      ? resolveCanonicalSkillAllowlist(options.skills, localSkills)
      : mergeGlobalSkillsIntoAgentSkills([], defaultSkills);
    const newAgent: AgentListEntry = {
      id: agentId,
      name: displayName,
      ...(nextEntries.length === 0 ? { default: true } : {}),
      workspace,
      agentDir: getDefaultAgentDirPath(agentId),
      skills: normalizeSkillAllowlist(initialSkills),
    };
    if (!nextEntries.some((entry) => entry.id === MAIN_AGENT_ID) && syntheticMain) {
      nextEntries.unshift(createImplicitMainEntry(config));
    }
    nextEntries.push(newAgent);
    config.agents = {
      ...agentsConfig,
      list: nextEntries,
    };
    await provisionAgentFilesystem(config, newAgent, { inheritWorkspace: options?.inheritWorkspace });
    syncSkillsEntriesEnabledInConfig(
      config,
      nextEntries,
      buildSkillAliasToCanonicalIdMap(localSkills),
      buildGlobalCanonicalSkillIdSet(readDefaultAgentSkillsFromConfig(config), buildSkillAliasToCanonicalIdMap(localSkills)),
      localSkills,
    );
    await writeOpenClawConfig(config);
    logger.info('Created agent with supplied id', {
      agentId,
      inheritWorkspace: !!options?.inheritWorkspace,
    });
    return buildSnapshotFromConfig(config);
  });
}

export async function updateAgentId(oldId: string, newIdInput: string): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const newId = newIdInput.trim().toLowerCase();
    if (!newId) {
      throw new Error('Agent id is required');
    }
    if (!/^[a-z0-9_-]+$/.test(newId)) {
      throw new Error('Agent id must contain only letters, digits, hyphen, underscore');
    }
    if (newId === MAIN_AGENT_ID) {
      throw new Error('Cannot rename an agent to reserved id "main"');
    }
    if (oldId === MAIN_AGENT_ID) {
      throw new Error('The main agent cannot be renamed');
    }
    if (newId === oldId) {
      return listAgentsSnapshot();
    }
    
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const { agentsConfig, entries, defaultAgentId } = normalizeAgentsConfig(config);
    
    const existingIds = new Set(entries.map((entry) => entry.id));
    const diskIds = await listExistingAgentIdsOnDisk();
    if (existingIds.has(newId) || diskIds.has(newId)) {
      throw new Error(`Agent id "${newId}" already exists`);
    }

    const index = entries.findIndex((entry) => entry.id === oldId);
    if (index === -1) {
      throw new Error(`Agent "${oldId}" not found`);
    }

    const oldEntry = entries[index];
    const nextEntry: AgentListEntry = { ...oldEntry, id: newId };

    const defaultOldWorkspace = `~/.openclaw/workspace-${oldId}`;
    if (!oldEntry.workspace || oldEntry.workspace === defaultOldWorkspace) {
      nextEntry.workspace = `~/.openclaw/workspace-${newId}`;
    }
    
    const defaultOldAgentDir = getDefaultAgentDirPath(oldId);
    if (!oldEntry.agentDir || oldEntry.agentDir === defaultOldAgentDir) {
      nextEntry.agentDir = getDefaultAgentDirPath(newId);
    }

    entries[index] = nextEntry;

    if (Array.isArray(config.bindings)) {
      config.bindings = config.bindings.map(binding => {
        if (isChannelBinding(binding) && binding.agentId === oldId) {
          return { ...binding, agentId: newId };
        }
        return binding;
      });
    }

    if (defaultAgentId === oldId) {
      if (!agentsConfig.defaults) {
        agentsConfig.defaults = {};
      }
      agentsConfig.defaults.agent = newId;
    }

    config.agents = {
      ...agentsConfig,
      list: entries,
    };

    const oldWorkspaceDir = getManagedWorkspaceDirectory(oldEntry);
    const newWorkspaceDir = getManagedWorkspaceDirectory(nextEntry);
    if (oldWorkspaceDir && newWorkspaceDir && oldWorkspaceDir !== newWorkspaceDir) {
      try {
        await rename(oldWorkspaceDir, newWorkspaceDir);
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          logger.warn(`Failed to rename workspace directory from ${oldWorkspaceDir} to ${newWorkspaceDir}`, { error: String(err) });
        }
      }
    }

    const oldBaseAgentDir = join(getOpenClawConfigDir(), 'agents', oldId);
    const newBaseAgentDir = join(getOpenClawConfigDir(), 'agents', newId);
    try {
      await rename(oldBaseAgentDir, newBaseAgentDir);
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        logger.warn(`Failed to rename base agent directory from ${oldBaseAgentDir} to ${newBaseAgentDir}`, { error: String(err) });
      }
    }

    if (oldEntry.agentDir && oldEntry.agentDir !== defaultOldAgentDir) {
      const oldCustomAgentDir = expandPath(oldEntry.agentDir);
      const newCustomAgentDir = expandPath(nextEntry.agentDir!);
      if (oldCustomAgentDir !== newCustomAgentDir) {
        try {
          await rename(oldCustomAgentDir, newCustomAgentDir);
        } catch (err: any) {
          if (err.code !== 'ENOENT') {
            logger.warn(`Failed to rename custom agent directory from ${oldCustomAgentDir} to ${newCustomAgentDir}`, { error: String(err) });
          }
        }
      }
    }

    await writeOpenClawConfig(config);
    return listAgentsSnapshot();
  });
}

export async function updateAgentName(agentId: string, name: string): Promise<AgentsSnapshot> {
  let snapshot: AgentsSnapshot | undefined;
  const normalizedName = normalizeAgentName(name);
  await mutateOpenClawConfig(async (configSnapshot) => {
    const config = configSnapshot as AgentConfigDocument;
    const { agentsConfig, entries } = normalizeAgentsConfig(config);
    if (applyAgentSkillsMigrationIfNeeded(config, entries, agentsConfig)) {
      config.agents = {
        ...agentsConfig,
        list: entries,
      };
    }
    const normalizedName = normalizeAgentName(name);
    const index = entries.findIndex((entry) => entry.id === agentId);
    if (index === -1) {
      throw new Error(`Agent "${agentId}" not found`);
    }

    entries[index] = {
      ...entries[index],
      name: normalizedName,
    };

    config.agents = {
      ...agentsConfig,
      list: entries,
    };

    snapshot = await buildSnapshotFromConfig(config);
  });
  logger.info('Updated agent name', { agentId, name: normalizedName });
  return snapshot!;
}

export async function updateAgentSkills(agentId: string, skills: string[]): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const { agentsConfig, entries } = normalizeAgentsConfig(config);
    if (applyAgentSkillsMigrationIfNeeded(config, entries, agentsConfig)) {
      config.agents = {
        ...agentsConfig,
        list: entries,
      };
    }
    const index = entries.findIndex((entry) => entry.id === agentId);
    if (index === -1) {
      throw new Error(`Agent "${agentId}" not found`);
    }

    const localSkills = await listLocalSkills({
      agentWorkspaces: extractAgentWorkspacesFromEntries(entries),
    });
    const canonicalSkills = resolveCanonicalSkillAllowlist(skills, localSkills);

    entries[index] = {
      ...entries[index],
      skills: normalizeSkillAllowlist(canonicalSkills),
    };
    config.agents = {
      ...agentsConfig,
      list: entries,
    };

    syncSkillsEntriesEnabledInConfig(
      config,
      entries,
      buildSkillAliasToCanonicalIdMap(localSkills),
      buildGlobalCanonicalSkillIdSet(readDefaultAgentSkillsFromConfig(config), buildSkillAliasToCanonicalIdMap(localSkills)),
      localSkills,
    );

    await writeOpenClawConfig(config);
    logger.info('Updated agent skills', { agentId, skills: normalizeSkillAllowlist(canonicalSkills) });
    return buildSnapshotFromConfig(config);
  });
}

function buildSkillAliasKeySet(skillId: string, localSkills: Awaited<ReturnType<typeof listLocalSkills>>): {
  normalizedSkillId: string;
  skillAliasKeys: Set<string>;
} {
  const normalizedSkillId = normalizeSkillKey(resolveCanonicalSkillId(skillId, localSkills));
  const skillAliasKeys = new Set(
    localSkills
      .filter((skill) => canonicalSkillKeyFromRecord(skill) === normalizedSkillId)
      .flatMap((skill) => collectSkillLookupAliases(skill)),
  );
  skillAliasKeys.add(normalizedSkillId);
  skillAliasKeys.add(normalizeSkillKey(skillId));
  return { normalizedSkillId, skillAliasKeys };
}

function agentSkillListHasAlias(agentSkills: string[], skillAliasKeys: Set<string>): boolean {
  return agentSkills.some((skillKey) => skillAliasKeys.has(normalizeSkillKey(skillKey)));
}

function removeSkillAliasesFromAllowlist(agentSkills: string[], skillAliasKeys: Set<string>): string[] {
  return normalizeSkillAllowlist(
    agentSkills.filter((skillKey) => !skillAliasKeys.has(normalizeSkillKey(skillKey))),
  );
}

/** Enable/disable skills by mutating agent allowlists (used by preinstall/bootstrap paths). */
export async function applyBulkSkillEnabledState(skillKeys: string[], enabled: boolean): Promise<void> {
  if (skillKeys.length === 0) return;

  // Routed through the delivery coordinator so a skill toggle cannot lose a
  // concurrent config write; the coordinator owns the lock and the CAS commit.
  await mutateOpenClawConfig(async (configSnapshot) => {
    const config = configSnapshot as AgentConfigDocument;
    const { agentsConfig, entries } = normalizeAgentsConfig(config);
    if (applyAgentSkillsMigrationIfNeeded(config, entries, agentsConfig)) {
      config.agents = {
        ...agentsConfig,
        list: entries,
      };
    }

    const localSkills = await listLocalSkills({
      agentWorkspaces: extractAgentWorkspacesFromEntries(entries),
    });
    const aliasToId = buildSkillAliasToCanonicalIdMap(localSkills);

    for (const skillKey of skillKeys) {
      const { normalizedSkillId, skillAliasKeys } = buildSkillAliasKeySet(skillKey, localSkills);
      if (enabled) {
        const defaults = agentsConfig.defaults && typeof agentsConfig.defaults === 'object'
          ? { ...agentsConfig.defaults }
          : {};
        const prevDefaultsSkills = normalizeSkillAllowlist(defaults.skills);
        if (!agentSkillListHasAlias(prevDefaultsSkills, skillAliasKeys)) {
          defaults.skills = normalizeSkillAllowlist([...prevDefaultsSkills, normalizedSkillId]);
          agentsConfig.defaults = defaults;
        }
        for (const entry of entries) {
          const agentSkills = entry.skills || [];
          if (!agentSkillListHasAlias(agentSkills, skillAliasKeys)) {
            entry.skills = normalizeSkillAllowlist([...agentSkills, normalizedSkillId]);
          }
        }
      } else {
        for (const entry of entries) {
          if (!entry.skills?.length) continue;
          entry.skills = removeSkillAliasesFromAllowlist(entry.skills, skillAliasKeys);
        }
        const defaults = agentsConfig.defaults && typeof agentsConfig.defaults === 'object'
          ? { ...agentsConfig.defaults }
          : {};
        if (Array.isArray(defaults.skills)) {
          defaults.skills = removeSkillAliasesFromAllowlist(defaults.skills, skillAliasKeys);
          agentsConfig.defaults = defaults;
        }
      }
    }

    config.agents = {
      ...agentsConfig,
      list: entries,
    };
    syncSkillsEntriesEnabledInConfig(
      config,
      entries,
      aliasToId,
      buildGlobalCanonicalSkillIdSet(readDefaultAgentSkillsFromConfig(config), aliasToId),
      localSkills,
    );
  });
}

function applyOneSkillAgentsMapping(
  entries: AgentListEntry[],
  agentsConfig: AgentsConfig,
  skillId: string,
  targetAgentIds: string[],
  localSkills: Awaited<ReturnType<typeof listLocalSkills>>,
): void {
  const { normalizedSkillId, skillAliasKeys } = buildSkillAliasKeySet(skillId, localSkills);
  const targetAgentIdSet = new Set((targetAgentIds || []).map((id) => normalizeSkillKey(id)));

  for (const entry of entries) {
    const agentSkills = entry.skills || [];
    const hasSkill = agentSkillListHasAlias(agentSkills, skillAliasKeys);
    const shouldHaveSkill = targetAgentIdSet.has(normalizeSkillKey(entry.id));
    if (hasSkill && !shouldHaveSkill) {
      entry.skills = removeSkillAliasesFromAllowlist(agentSkills, skillAliasKeys);
    } else if (!hasSkill && shouldHaveSkill) {
      entry.skills = normalizeSkillAllowlist([...agentSkills, normalizedSkillId]);
    }
  }

  // Per-agent mapping only: empty targetAgentIds means all agents opt out while
  // agents.defaults.skills is unchanged. Use updateGlobalAgentSkills / demote to
  // remove a skill from global defaults.
}

/** Atomically apply multiple skill -> agentIds mappings in one config transaction. */
export async function applyBatchSkillAgentsMapping(
  updates: Array<{ skillId: string; agentIds: string[] }>,
): Promise<AgentsSnapshot> {
  if (updates.length === 0) {
    return listAgentsSnapshot();
  }

  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const { agentsConfig, entries } = normalizeAgentsConfig(config);
    if (applyAgentSkillsMigrationIfNeeded(config, entries, agentsConfig)) {
      config.agents = {
        ...agentsConfig,
        list: entries,
      };
    }

    const localSkills = await listLocalSkills({
      agentWorkspaces: extractAgentWorkspacesFromEntries(entries),
    });

    for (const update of updates) {
      if (!update?.skillId?.trim()) continue;
      applyOneSkillAgentsMapping(entries, agentsConfig, update.skillId, update.agentIds || [], localSkills);
    }

    config.agents = {
      ...agentsConfig,
      list: entries,
    };

    const aliasToId = buildSkillAliasToCanonicalIdMap(localSkills);
    syncSkillsEntriesEnabledInConfig(
      config,
      entries,
      aliasToId,
      buildGlobalCanonicalSkillIdSet(readDefaultAgentSkillsFromConfig(config), aliasToId),
      localSkills,
    );
    await writeOpenClawConfig(config);
    logger.info('Applied batch skill agents mapping', { count: updates.length });
    return buildSnapshotFromConfig(config);
  });
}

export type AgentWorkspaceSkillAllowlistPatch = {
  agentId: string;
  add?: string[];
  remove?: string[];
};

/** Apply per-agent skill allowlist deltas without touching agents.defaults.skills. */
export async function applyPerAgentWorkspaceSkillAllowlistPatches(
  patches: AgentWorkspaceSkillAllowlistPatch[],
): Promise<AgentsSnapshot> {
  const meaningful = patches.filter(
    (patch) => (patch.add?.length ?? 0) > 0 || (patch.remove?.length ?? 0) > 0,
  );
  if (meaningful.length === 0) {
    return listAgentsSnapshot();
  }

  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const { agentsConfig, entries } = normalizeAgentsConfig(config);
    if (applyAgentSkillsMigrationIfNeeded(config, entries, agentsConfig)) {
      config.agents = {
        ...agentsConfig,
        list: entries,
      };
    }

    const localSkills = await listLocalSkills({
      agentWorkspaces: extractAgentWorkspacesFromEntries(entries),
    });

    for (const patch of meaningful) {
      const agentId = patch.agentId?.trim();
      if (!agentId) continue;
      const index = entries.findIndex((entry) => entry.id === agentId);
      if (index === -1) continue;

      let skills = normalizeSkillAllowlist(entries[index].skills);
      for (const removeId of patch.remove || []) {
        const { skillAliasKeys } = buildSkillAliasKeySet(removeId, localSkills);
        skills = removeSkillAliasesFromAllowlist(skills, skillAliasKeys);
      }
      for (const addId of patch.add || []) {
        const { normalizedSkillId, skillAliasKeys } = buildSkillAliasKeySet(addId, localSkills);
        if (!agentSkillListHasAlias(skills, skillAliasKeys)) {
          skills = normalizeSkillAllowlist([...skills, normalizedSkillId]);
        }
      }
      entries[index] = {
        ...entries[index],
        skills,
      };
    }

    config.agents = {
      ...agentsConfig,
      list: entries,
    };

    const aliasToId = buildSkillAliasToCanonicalIdMap(localSkills);
    syncSkillsEntriesEnabledInConfig(
      config,
      entries,
      aliasToId,
      buildGlobalCanonicalSkillIdSet(readDefaultAgentSkillsFromConfig(config), aliasToId),
      localSkills,
    );
    await writeOpenClawConfig(config);
    logger.info('Applied per-agent workspace skill allowlist patches', { count: meaningful.length });
    return buildSnapshotFromConfig(config);
  });
}

/** Atomically apply skill -> agentIds mapping in a single config transaction. */
export async function applySkillAgentsMapping(skillId: string, targetAgentIds: string[]): Promise<AgentsSnapshot> {
  return applyBatchSkillAgentsMapping([{ skillId, agentIds: targetAgentIds }]);
}

/**
 * Atomically migrate managed-skill aliases after a successful same-name
 * replacement. Agent allowlists, defaults, and skills.entries are updated in
 * one config lock and one write, so a filesystem rollback never leaves a
 * partially purged allowlist behind.
 */
export async function migrateManagedSkillReplacementConfig(params: {
  staleAliases: string[];
  newCanonicalSkillId: string;
}): Promise<AgentsSnapshot> {
  const newCanonicalSkillId = normalizeSkillKey(params.newCanonicalSkillId);
  const staleAliasKeys = new Set(
    params.staleAliases.map(normalizeSkillKey).filter((key) => key && key !== newCanonicalSkillId),
  );
  if (!newCanonicalSkillId || staleAliasKeys.size === 0) {
    return listAgentsSnapshotReadOnly();
  }

  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const { agentsConfig, entries } = normalizeAgentsConfig(config);
    const replaceAliases = (skills: unknown): string[] => {
      const current = normalizeSkillAllowlist(skills);
      const replaced = current.some((skillId) => staleAliasKeys.has(normalizeSkillKey(skillId)));
      const retained = current.filter((skillId) => !staleAliasKeys.has(normalizeSkillKey(skillId)));
      return replaced ? normalizeSkillAllowlist([...retained, newCanonicalSkillId]) : retained;
    };

    for (const entry of entries) {
      entry.skills = replaceAliases(entry.skills);
    }
    const defaults = agentsConfig.defaults && typeof agentsConfig.defaults === 'object'
      ? { ...agentsConfig.defaults }
      : {};
    defaults.skills = replaceAliases(defaults.skills);
    agentsConfig.defaults = defaults;
    config.agents = { ...agentsConfig, list: entries };

    const skillsConfig = (
      config.skills && typeof config.skills === 'object' && !Array.isArray(config.skills)
        ? config.skills as { entries?: Record<string, Record<string, unknown>> }
        : {}
    );
    const skillEntries = (
      skillsConfig.entries && typeof skillsConfig.entries === 'object'
        ? { ...skillsConfig.entries }
        : {}
    ) as Record<string, Record<string, unknown>>;
    const mergedStaleEntry: Record<string, unknown> = {};
    for (const [entryKey, entry] of Object.entries(skillEntries)) {
      if (!staleAliasKeys.has(normalizeSkillKey(entryKey))) continue;
      Object.assign(mergedStaleEntry, entry);
      delete skillEntries[entryKey];
    }
    if (Object.keys(mergedStaleEntry).length > 0) {
      skillEntries[newCanonicalSkillId] = {
        ...mergedStaleEntry,
        ...(skillEntries[newCanonicalSkillId] || {}),
      };
    }
    config.skills = {
      ...skillsConfig,
      entries: skillEntries,
    };

    const localSkills = await listLocalSkills({
      agentWorkspaces: extractAgentWorkspacesFromEntries(entries),
    });
    const aliasToId = buildSkillAliasToCanonicalIdMap(localSkills);
    syncSkillsEntriesEnabledInConfig(
      config,
      entries,
      aliasToId,
      buildGlobalCanonicalSkillIdSet(readDefaultAgentSkillsFromConfig(config), aliasToId),
      localSkills,
    );
    await writeOpenClawConfig(config);
    logger.info('Migrated managed skill aliases after replacement', {
      newCanonicalSkillId,
      staleAliases: [...staleAliasKeys],
    });
    return buildSnapshotFromConfig(config, undefined, { persist: false });
  });
}

/** Remove a skill (and aliases) from every agent allowlist and agents.defaults.skills. */
export async function purgeSkillFromAgentAllowlists(skillId: string): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const { agentsConfig, entries } = normalizeAgentsConfig(config);
    if (applyAgentSkillsMigrationIfNeeded(config, entries, agentsConfig)) {
      config.agents = {
        ...agentsConfig,
        list: entries,
      };
    }

    const localSkills = await listLocalSkills({
      agentWorkspaces: extractAgentWorkspacesFromEntries(entries),
    });
    const { skillAliasKeys } = buildSkillAliasKeySet(skillId, localSkills);

    for (const entry of entries) {
      if (!entry.skills?.length) continue;
      entry.skills = removeSkillAliasesFromAllowlist(entry.skills, skillAliasKeys);
    }

    const defaults = agentsConfig.defaults && typeof agentsConfig.defaults === 'object'
      ? { ...agentsConfig.defaults }
      : {};
    if (Array.isArray(defaults.skills)) {
      defaults.skills = removeSkillAliasesFromAllowlist(defaults.skills, skillAliasKeys);
    }
    agentsConfig.defaults = defaults;

    config.agents = {
      ...agentsConfig,
      list: entries,
    };

    syncSkillsEntriesEnabledInConfig(
      config,
      entries,
      buildSkillAliasToCanonicalIdMap(localSkills),
      buildGlobalCanonicalSkillIdSet(readDefaultAgentSkillsFromConfig(config), buildSkillAliasToCanonicalIdMap(localSkills)),
      localSkills,
    );
    await writeOpenClawConfig(config);
    logger.info('Purged skill from agent allowlists', { skillId: normalizeSkillKey(skillId) });
    return buildSnapshotFromConfig(config);
  });
}

/** Update display name and optional identity fields on the agents.list entry (config lock). */
export async function updateAgentListProfile(
  agentId: string,
  profile: { name?: string; theme?: string; emoji?: string; avatar?: string },
): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const { agentsConfig, entries } = normalizeAgentsConfig(config);
    const index = entries.findIndex((entry) => entry.id === agentId);
    if (index === -1) {
      throw new Error(`Agent "${agentId}" not found`);
    }
    const prev = entries[index];
    const next: AgentListEntry = { ...prev };
    if (profile.name !== undefined) {
      next.name = normalizeAgentName(profile.name);
    }
    const prevIdentity =
      prev.identity && typeof prev.identity === 'object' && !Array.isArray(prev.identity)
        ? { ...(prev.identity as Record<string, unknown>) }
        : {};
    const identity: Record<string, unknown> = { ...prevIdentity };
    if (profile.theme !== undefined) {
      identity.theme = profile.theme.trim() || undefined;
    }
    if (profile.emoji !== undefined) {
      identity.emoji = profile.emoji.trim() || undefined;
    }
    if (profile.avatar !== undefined) {
      identity.avatar = profile.avatar.trim() || undefined;
    }
    if (profile.name !== undefined) {
      identity.name = normalizeAgentName(profile.name);
    }
    const cleaned = Object.fromEntries(
      Object.entries(identity).filter(([, v]) => v !== undefined && v !== ''),
    );
    if (Object.keys(cleaned).length > 0) {
      next.identity = cleaned;
    } else {
      delete next.identity;
    }
    entries[index] = next;
    config.agents = {
      ...agentsConfig,
      list: entries,
    };
    await writeOpenClawConfig(config);
    logger.info('Updated agent profile', { agentId });
    return buildSnapshotFromConfig(config);
  });
}

export async function updateAgentToolsPolicy(
  agentId: string,
  tools: { allow?: string[]; deny?: string[] },
): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const { agentsConfig, entries } = normalizeAgentsConfig(config);
    const index = entries.findIndex((entry) => entry.id === agentId);
    if (index === -1) {
      throw new Error(`Agent "${agentId}" not found`);
    }
    const nextEntry: AgentListEntry = { ...entries[index] };
    nextEntry.tools = {
      allow: tools.allow,
      deny: tools.deny,
    };
    entries[index] = nextEntry;
    config.agents = {
      ...agentsConfig,
      list: entries,
    };
    await writeOpenClawConfig(config);
    logger.info('Updated agent tools policy', { agentId });
    return buildSnapshotFromConfig(config);
  });
}

export async function setDefaultAgent(agentId: string): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const { agentsConfig, entries } = normalizeAgentsConfig(config);
    const index = entries.findIndex((entry) => entry.id === agentId);
    if (index === -1) {
      throw new Error(`Agent "${agentId}" not found`);
    }

    const nextEntries = entries.map((entry, i) => {
      const next: AgentListEntry = { ...entry };
      delete next.default;
      if (i === index) {
        next.default = true;
      }
      return next;
    });

    config.agents = {
      ...agentsConfig,
      list: nextEntries,
    };

    await writeOpenClawConfig(config);
    logger.info('Set default agent', { agentId });
    return buildSnapshotFromConfig(config);
  });
}

function isValidModelRef(modelRef: string): boolean {
  const firstSlash = modelRef.indexOf('/');
  return firstSlash > 0 && firstSlash < modelRef.length - 1;
}

export async function updateAgentModel(agentId: string, modelRef: string | null, targetSlot: 'model' | 'imageModel' | 'imageGenerationModel' | 'videoGenerationModel' | 'musicGenerationModel' = 'model'): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const { agentsConfig, entries } = normalizeAgentsConfig(config);
    const index = entries.findIndex((entry) => entry.id === agentId);
    if (index === -1) {
      throw new Error(`Agent "${agentId}" not found`);
    }

    const normalizedModelRef = typeof modelRef === 'string' ? modelRef.trim() : '';
    const nextEntry: AgentListEntry = { ...entries[index] };

    if (!normalizedModelRef) {
      delete nextEntry[targetSlot];
    } else {
      if (!isValidModelRef(normalizedModelRef)) {
        throw new Error('modelRef must be in "provider/model" format');
      }

      if (targetSlot === 'model') {
        // Merge into the existing model block: replacing it wholesale discards
        // hand-configured fields such as `fallbacks`.
        const existingModel = entries[index].model;
        const nextModel: AgentModelConfig = existingModel && typeof existingModel === 'object'
          ? { ...existingModel, primary: normalizedModelRef }
          : { primary: normalizedModelRef };
        // The OpenClaw runtime treats a per-agent model block without a
        // `fallbacks` key as an EMPTY fallback override, which suppresses
        // agents.defaults.model.fallbacks entirely. Inherit the defaults chain
        // so switching models never silently disables failover.
        if (!Array.isArray(nextModel.fallbacks)) {
          const defaultsModel = agentsConfig.defaults?.model;
          const defaultFallbacks = defaultsModel && typeof defaultsModel === 'object'
            ? (defaultsModel as AgentModelConfig).fallbacks
            : undefined;
          if (Array.isArray(defaultFallbacks)) {
            const inherited = defaultFallbacks.filter((ref): ref is string => typeof ref === 'string' && ref.trim().length > 0);
            if (inherited.length > 0) {
              nextModel.fallbacks = inherited;
            }
          }
        }
        nextEntry.model = nextModel;
      } else if (targetSlot === 'imageGenerationModel' || targetSlot === 'videoGenerationModel') {
        nextEntry[targetSlot] = {
          primary: normalizedModelRef,
          timeoutMs: 180_000,
        };
      } else {
        nextEntry[targetSlot] = { primary: normalizedModelRef };
      }
    }

    entries[index] = nextEntry;
    config.agents = {
      ...agentsConfig,
      list: entries,
    };

    await writeOpenClawConfig(config);
    logger.info(`Updated agent ${targetSlot}`, { agentId, modelRef: normalizedModelRef || null });
    if (targetSlot === 'imageGenerationModel') {
      await syncRequiredClawXImagePluginsQuietly(config);
    }
    return buildSnapshotFromConfig(config);
  });
}

/**
 * Toggle per-slot auto-select and/or set the optimization profile for an agent.
 * Persists to the ClawX store (NOT openclaw.json — see auto-select-store).
 */
export async function updateAgentAutoSelect(
  agentId: string,
  update: { autoSelectModel?: AgentAutoSelectConfig; optimizationProfile?: OptimizationProfile; sensitiveMode?: boolean },
): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const { entries } = normalizeAgentsConfig(config);
    if (!entries.some((entry) => entry.id === agentId)) {
      throw new Error(`Agent "${agentId}" not found`);
    }
    await setAutoSelectForAgent(agentId, update);
    logger.info('Updated agent auto-select', {
      agentId,
      autoSelectModel: update.autoSelectModel ?? null,
      optimizationProfile: update.optimizationProfile ?? null,
    });
    // Read-only snapshot (no openclaw.json write); auto-select overlaid from store.
    return buildSnapshotFromConfig(config, undefined, { persist: false });
  });
}

export async function updateDefaultModels(models: Record<string, string | null>): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const { agentsConfig } = normalizeAgentsConfig(config);
    
    if (!agentsConfig.defaults) {
      agentsConfig.defaults = {};
    }

    const targetSlots = ['model', 'imageModel', 'imageGenerationModel', 'videoGenerationModel', 'musicGenerationModel'] as const;

    for (const targetSlot of targetSlots) {
      if (models[targetSlot] !== undefined) {
        const modelRef = models[targetSlot];
        const normalizedModelRef = typeof modelRef === 'string' ? modelRef.trim() : '';

        if (!normalizedModelRef) {
          delete agentsConfig.defaults[targetSlot];
        } else {
          if (!isValidModelRef(normalizedModelRef)) {
            throw new Error(`modelRef for ${targetSlot} must be in "provider/model" format`);
          }

          if (targetSlot === 'imageGenerationModel' || targetSlot === 'videoGenerationModel') {
            agentsConfig.defaults[targetSlot] = {
              primary: normalizedModelRef,
              timeoutMs: 180_000,
            };
          } else {
            agentsConfig.defaults[targetSlot] = { primary: normalizedModelRef };
          }
        }
      }
    }

    config.agents = agentsConfig;

    await writeOpenClawConfig(config);
    logger.info('Updated default models', { models });
    if (models.imageGenerationModel !== undefined) {
      await syncRequiredClawXImagePluginsQuietly(config);
    }
    return buildSnapshotFromConfig(config);
  });
}

export async function deleteAgentConfig(agentId: string): Promise<{ snapshot: AgentsSnapshot; removedEntry: AgentListEntry }> {
  let result: { snapshot: AgentsSnapshot; removedEntry: AgentListEntry } | undefined;
  await mutateOpenClawConfig(async (configSnapshot) => {
    const config = configSnapshot as AgentConfigDocument;
    const { agentsConfig, entries, defaultAgentId } = normalizeAgentsConfig(config);
    const bindingsBeforeDeletion = Array.isArray(config.bindings)
      ? config.bindings.filter(isChannelBinding)
      : [];
    const removedEntry = entries.find((entry) => entry.id === agentId);
    const nextEntries = entries.filter((entry) => entry.id !== agentId);
    if (!removedEntry || nextEntries.length === entries.length) {
      throw new Error(`Agent "${agentId}" not found`);
    }

    config.agents = {
      ...agentsConfig,
      list: nextEntries,
    };
    config.bindings = Array.isArray(config.bindings)
      ? config.bindings.filter((binding) => !(isChannelBinding(binding) && binding.agentId === agentId))
      : undefined;

    if (defaultAgentId === agentId) {
      for (let index = 0; index < nextEntries.length; index += 1) {
        nextEntries[index] = {
          ...nextEntries[index],
          default: index === 0,
        };
      }
    }

    const localSkills = await listLocalSkills({
      agentWorkspaces: extractAgentWorkspacesFromEntries(nextEntries),
    });
    syncSkillsEntriesEnabledInConfig(
      config,
      nextEntries,
      buildSkillAliasToCanonicalIdMap(localSkills),
      buildGlobalCanonicalSkillIdSet(readDefaultAgentSkillsFromConfig(config), buildSkillAliasToCanonicalIdMap(localSkills)),
      localSkills,
    );

    const normalizedAgentId = normalizeAgentIdForBinding(agentId);
    const legacyAccountId = resolveAccountIdForAgent(agentId);
    const { channelToAgent, accountToAgent } = getChannelBindingMap(bindingsBeforeDeletion);
    const boundChannelTypes = new Set(bindingsBeforeDeletion.map((binding) => binding.match.channel));
    const ownedLegacyAccounts = new Set(
      [...boundChannelTypes]
        .filter((channelType) => {
          const accountOwner = accountToAgent.get(`${channelType}:${legacyAccountId}`);
          const effectiveOwner = accountOwner
            ?? (legacyAccountId === DEFAULT_ACCOUNT_ID ? channelToAgent.get(channelType) : undefined);
          return effectiveOwner === normalizedAgentId;
        })
        .map((channelType) => `${channelType}:${legacyAccountId}`),
    );

    await deleteAgentChannelAccounts(agentId, ownedLegacyAccounts);
    result = { snapshot: await buildSnapshotFromConfig(config), removedEntry };
  });
  await removeAgentRuntimeDirectory(agentId);
  // The caller removes the workspace only after the coordinator commit above.
  logger.info('Deleted agent config entry', { agentId });
  return result!;
}

export async function assignChannelToAgent(agentId: string, channelType: string): Promise<AgentsSnapshot> {
  let snapshot: AgentsSnapshot | undefined;
  const accountId = resolveAccountIdForAgent(agentId);
  await mutateOpenClawConfig(async (configSnapshot) => {
    const config = configSnapshot as AgentConfigDocument;
    const { entries } = normalizeAgentsConfig(config);
    if (!entries.some((entry) => entry.id === agentId)) {
      throw new Error(`Agent "${agentId}" not found`);
    }

    config.bindings = upsertBindingsForChannel(config.bindings, channelType, agentId, accountId);
    snapshot = await buildSnapshotFromConfig(config);
  });
  logger.info('Assigned channel to agent', { agentId, channelType, accountId });
  return snapshot!;
}

export async function assignChannelAccountToAgent(
  agentId: string,
  channelType: string,
  accountId: string,
  options?: { migrateLegacy?: boolean },
): Promise<AgentsSnapshot> {
  const trimmedAccountId = accountId.trim();
  if (!trimmedAccountId) {
    throw new Error('accountId is required');
  }
  let snapshot: AgentsSnapshot | undefined;
  await mutateOpenClawConfig(async (configSnapshot) => {
    const config = configSnapshot as AgentConfigDocument;
    const { entries } = normalizeAgentsConfig(config);
    if (!entries.some((entry) => entry.id === agentId)) {
      throw new Error(`Agent "${agentId}" not found`);
    }
    if (options?.migrateLegacy) {
      const validAgentIds = new Set(entries.map((entry) => normalizeAgentIdForBinding(entry.id)));
      migrateLegacyChannelBindingInConfig(config, channelType, validAgentIds);
    }
    config.bindings = upsertBindingsForChannel(config.bindings, channelType, agentId, trimmedAccountId);
    snapshot = await buildSnapshotFromConfig(config);
  });
  logger.info('Assigned channel account to agent', { agentId, channelType, accountId: trimmedAccountId });
  return snapshot!;
}

export async function clearChannelBinding(channelType: string, accountId?: string): Promise<AgentsSnapshot> {
  let snapshot: AgentsSnapshot | undefined;
  await mutateOpenClawConfig(async (configSnapshot) => {
    const config = configSnapshot as AgentConfigDocument;
    config.bindings = upsertBindingsForChannel(config.bindings, channelType, null, accountId);
    snapshot = await buildSnapshotFromConfig(config);
  });
  logger.info('Cleared channel binding', { channelType, accountId });
  return snapshot!;
}

export async function clearAllBindingsForChannel(channelType: string): Promise<void> {
  await mutateOpenClawConfig((configSnapshot) => {
    const config = configSnapshot as AgentConfigDocument;
    if (!Array.isArray(config.bindings)) return;

    const nextBindings = config.bindings.filter((binding) => {
      if (!isChannelBinding(binding)) return true;
      return binding.match?.channel !== channelType;
    });

    config.bindings = nextBindings.length > 0 ? nextBindings : undefined;
  });
  logger.info('Cleared all bindings for channel', { channelType });
}

function migrateLegacyChannelBindingInConfig(
  config: AgentConfigDocument,
  channelType: string,
  validAgentIds: Set<string>,
): void {
  const { channelToAgent, accountToAgent } = getChannelBindingMap(config.bindings);
  const legacyOwner = channelToAgent.get(channelType);
  if (!legacyOwner) return;

  const explicitDefaultOwner = accountToAgent.get(`${channelType}:${DEFAULT_ACCOUNT_ID}`);
  const defaultOwner = explicitDefaultOwner && validAgentIds.has(explicitDefaultOwner)
    ? explicitDefaultOwner
    : (validAgentIds.has(legacyOwner) ? legacyOwner : null);
  if (defaultOwner) {
    config.bindings = upsertBindingsForChannel(
      config.bindings,
      channelType,
      defaultOwner,
      DEFAULT_ACCOUNT_ID,
    );
  }
  config.bindings = upsertBindingsForChannel(config.bindings, channelType, null);
}

export async function migrateLegacyChannelWideBinding(channelType: string): Promise<void> {
  await mutateOpenClawConfig((configSnapshot) => {
    const config = configSnapshot as AgentConfigDocument;
    const { entries } = normalizeAgentsConfig(config);
    const validAgentIds = new Set(entries.map((entry) => normalizeAgentIdForBinding(entry.id)));
    migrateLegacyChannelBindingInConfig(config, channelType, validAgentIds);
  });
  logger.info('Migrated legacy channel-wide binding', { channelType });
}

export async function ensureScopedChannelBinding(channelType: string, accountId?: string): Promise<void> {
  const normalizedAccountId = accountId?.trim();
  if (!normalizedAccountId) return;

  await mutateOpenClawConfig((configSnapshot) => {
    const config = configSnapshot as AgentConfigDocument;
    const { entries } = normalizeAgentsConfig(config);
    if (entries.length === 0) return;
    const validAgentIds = new Set(entries.map((entry) => normalizeAgentIdForBinding(entry.id)));

    if (normalizedAccountId === DEFAULT_ACCOUNT_ID) {
      const mainAgent = entries.find((entry) => entry.id === MAIN_AGENT_ID);
      if (mainAgent) {
        config.bindings = upsertBindingsForChannel(
          config.bindings,
          channelType,
          mainAgent.id,
          DEFAULT_ACCOUNT_ID,
        );
      }
      return;
    }

    migrateLegacyChannelBindingInConfig(config, channelType, validAgentIds);
    const accountAgent = entries.find((entry) => entry.id === normalizedAccountId);
    if (accountAgent) {
      config.bindings = upsertBindingsForChannel(
        config.bindings,
        channelType,
        accountAgent.id,
        normalizedAccountId,
      );
    }
  });
  logger.info('Ensured scoped channel binding', { channelType, accountId: normalizedAccountId });
}
