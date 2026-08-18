/**
 * Sync the `model-router` gateway plugin registration into openclaw.json.
 *
 * IMPORTANT: only writes keys that are part of OpenClaw's official config schema
 * (`plugins.load.paths`, `plugins.allow`, `plugins.entries.<id>.{enabled,hooks,config}`).
 * Per-agent auto-select settings live in the ClawX store (NOT on agents.list —
 * those are non-schema keys and would make the gateway reject the config).
 *
 * The plugin runs auto-selection inside the gateway (before_model_resolve),
 * needing in its config: the candidate model set (with enriched ModelMeta) and
 * per-agent { autoSelectText, profile } — read here from the store and embedded
 * so the plugin scores locally without runtime LLM/IPC calls.
 *
 * The plugin is registered ONLY when at least one agent opts into text
 * auto-select. Mirrors the safe plugins.allow/entries pattern of
 * ensureOAuthPluginEnabled.
 */
import * as path from 'path';
import { getResourcesDir } from '../../utils/paths';
import { readOpenClawConfig, writeOpenClawConfig } from '../../utils/channel-config';
import { assembleModelCandidates } from './model-candidates';
import { getAllAutoSelect } from './auto-select-store';
import { getSetting } from '../../utils/store';
import { logger } from '../../utils/logger';

const PLUGIN_ID = 'model-router';

function pluginDir(): string {
  return path.join(getResourcesDir(), 'openclaw-plugins', PLUGIN_ID);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Recompute and write the model-router plugin registration from the store's
 * auto-select settings + provider accounts. Idempotent; safe to call after any
 * auto-select / provider change.
 */
export async function syncModelRouterPlugin(): Promise<void> {
  const config = (await readOpenClawConfig()) as Record<string, unknown>;
  const agents = asRecord(config.agents);
  const list = Array.isArray(agents.list) ? (agents.list as Array<Record<string, unknown>>) : [];

  // Per-agent auto-select comes from the ClawX store (not openclaw.json).
  const autoSelectByAgent = await getAllAutoSelect();
  const byAgent: Record<string, { autoSelectText: boolean; profile: string; sensitiveMode: boolean }> = {};
  let anyEnabled = false;
  for (const [id, settings] of Object.entries(autoSelectByAgent)) {
    const autoSelectText = settings.autoSelectModel?.model === true;
    if (!autoSelectText) continue;
    byAgent[id] = {
      autoSelectText: true,
      profile: settings.optimizationProfile ?? 'balanced',
      sensitiveMode: settings.sensitiveMode === true,
    };
    anyEnabled = true;
  }

  // UI language drives origin-tier order for sensitive turns.
  let language = 'en';
  try {
    language = (await getSetting('language')) || 'en';
  } catch {
    // keep default
  }

  const plugins = asRecord(config.plugins);
  const allow = asStringArray(plugins.allow);
  const load = asRecord(plugins.load);
  const loadPaths = asStringArray(load.paths);
  const entries = asRecord(plugins.entries);
  const dir = pluginDir();

  const writeBack = async () => {
    if (allow.length) plugins.allow = allow; else delete plugins.allow;
    if (loadPaths.length) load.paths = loadPaths; else delete (load as Record<string, unknown>).paths;
    if (Object.keys(load).length) plugins.load = load; else delete plugins.load;
    if (Object.keys(entries).length) plugins.entries = entries; else delete plugins.entries;
    if (Object.keys(plugins).length) config.plugins = plugins; else delete config.plugins;
    await writeOpenClawConfig(config);
  };

  if (!anyEnabled) {
    // Tear down registration when no agent uses auto-select.
    const idxAllow = allow.indexOf(PLUGIN_ID);
    if (idxAllow >= 0) allow.splice(idxAllow, 1);
    const idxPath = loadPaths.indexOf(dir);
    if (idxPath >= 0) loadPaths.splice(idxPath, 1);
    delete entries[PLUGIN_ID];
    await writeBack();
    logger.info('[model-router] plugin disabled (no agent auto-selects)');
    return;
  }

  const candidates = (await assembleModelCandidates())
    .filter((c) => {
      const mods = c.meta?.inputModalities ?? c.kinds;
      return mods.includes('text') || mods.includes('image');
    })
    .map((c) => ({ modelRef: c.modelRef, modelId: c.modelId, modelType: c.kinds, meta: c.meta }));

  if (!loadPaths.includes(dir)) loadPaths.push(dir);
  if (!allow.includes(PLUGIN_ID)) allow.push(PLUGIN_ID);

  const defaultAgentId =
    (list.find((e) => e.default === true)?.id as string | undefined) ??
    (typeof list[0]?.id === 'string' ? (list[0].id as string) : undefined);

  entries[PLUGIN_ID] = {
    ...asRecord(entries[PLUGIN_ID]),
    enabled: true,
    hooks: { allowConversationAccess: true },
    config: { enabled: true, defaultAgentId, language, byAgent, candidates },
  };

  await writeBack();
  logger.info('[model-router] synced plugin config', {
    agents: Object.keys(byAgent).length,
    candidates: candidates.length,
  });
}
