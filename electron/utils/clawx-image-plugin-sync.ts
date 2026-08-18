/**
 * Install + enable the ClawX image-generation plugins the current OpenClaw
 * config actually asks for.
 *
 * Which plugin is needed is decided purely by the referenced model id family
 * (`resolveRequiredClawXImagePlugins`), so this must run on every path that can
 * change `agents.*.imageGenerationModel` — not only at Gateway prelaunch.
 * Otherwise picking a Gemini image model in the UI leaves
 * `~/.openclaw/extensions/clawx-gemini-image` missing until the next app start.
 *
 * Kept in its own module (rather than inside `config-sync.ts`) so the UI write
 * paths in `openclaw-image-generation.ts` / `agent-config.ts` can call it
 * without importing the Gateway launch pipeline.
 */
import { readOpenClawConfig } from './channel-config';
import { logger } from './logger';
import {
  ensureClawXGeminiImagePluginInstalled,
  ensureClawXOpenAiImagePluginInstalled,
  type PluginInstallResult,
} from './plugin-install';
import {
  CLAWX_GEMINI_IMAGE_PROVIDER_KEY,
  CLAWX_OPENAI_IMAGE_PROVIDER_KEY,
} from './openclaw-image-relay-constants';
import {
  ensureClawXImagePluginConfig,
  resolveRequiredClawXImagePlugins,
} from '../gateway/image-generation-plugin-resolution';

/**
 * Plugin id → mirror installer. A table rather than a conditional so a future
 * model family that `resolveClawXImagePluginId` learns about cannot silently
 * fall through to the OpenAI installer; it gets a loud warning instead.
 */
const CLAWX_IMAGE_PLUGIN_INSTALLERS: Record<string, () => Promise<PluginInstallResult>> = {
  [CLAWX_OPENAI_IMAGE_PROVIDER_KEY]: ensureClawXOpenAiImagePluginInstalled,
  [CLAWX_GEMINI_IMAGE_PROVIDER_KEY]: ensureClawXGeminiImagePluginInstalled,
};

/**
 * Resolve, install, and enable the ClawX image plugins this config needs.
 *
 * @param rawConfig Already-read openclaw.json, when the caller has one. Omit to
 *   read it here.
 * @returns the plugin ids that were required (empty when none apply).
 */
export async function syncRequiredClawXImagePlugins(rawConfig?: unknown): Promise<string[]> {
  const config = rawConfig === undefined ? await readOpenClawConfig() : rawConfig;
  const { pluginIds, providerKeys } = resolveRequiredClawXImagePlugins(config);
  if (pluginIds.length === 0) return [];

  for (const pluginId of pluginIds) {
    const install = CLAWX_IMAGE_PLUGIN_INSTALLERS[pluginId];
    if (!install) {
      logger.warn(`[plugin] No mirror installer registered for ClawX image plugin "${pluginId}"`);
      continue;
    }
    const result = await install();
    if (result.warning) logger.warn(`[plugin] ${pluginId}: ${result.warning}`);
  }

  await ensureClawXImagePluginConfig(pluginIds, providerKeys);
  return pluginIds;
}

/**
 * `syncRequiredClawXImagePlugins` for callers whose primary job is a config
 * write that must not fail because a plugin mirror could not be copied. The
 * Gateway prelaunch pass reconciles anything missed here.
 */
export async function syncRequiredClawXImagePluginsQuietly(rawConfig?: unknown): Promise<void> {
  try {
    await syncRequiredClawXImagePlugins(rawConfig);
  } catch (err) {
    logger.warn('[plugin] Failed to sync ClawX image generation plugins:', err);
  }
}
