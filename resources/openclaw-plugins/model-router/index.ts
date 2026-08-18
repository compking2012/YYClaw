/**
 * OpenClaw `model-router` plugin — data-driven per-task model auto-selection.
 *
 * Runs inside the gateway on `before_model_resolve` (fires for every agent turn,
 * across all channels). When auto-select is enabled for the turn's agent, it
 * derives task features from the current prompt + attachments and picks the
 * best model from the candidate set (with enriched ModelMeta) using the
 * optimization profile, then overrides provider/model for that turn only.
 *
 * Config is injected by the YYClaw electron host
 * (electron/utils/openclaw-auth.ts → ensureModelRouterPluginEnabled): candidates
 * + enriched meta + per-agent { autoSelectText, profile }. Requires
 * `hooks.allowConversationAccess: true` to read the current prompt.
 *
 * Selecting a model does NOT call any LLM — scoring is local and deterministic.
 */
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import {
  deriveTaskFeatures,
  selectBestModel,
  type ModelCandidate,
  type ModelKind,
  type OptimizationProfileName,
} from './select-model';

interface AgentRouteConfig {
  autoSelectText?: boolean;
  profile?: OptimizationProfileName;
  sensitiveMode?: boolean;
}

interface ModelRouterConfig {
  enabled?: boolean;
  candidates?: ModelCandidate[];
  byAgent?: Record<string, AgentRouteConfig>;
  defaultAgentId?: string;
  language?: string;
}

/** Best-effort agent id from an OpenClaw session key (e.g. `agent:main:...`). */
function resolveAgentId(sessionKey: string | undefined, fallback: string | undefined): string | undefined {
  if (sessionKey) {
    const m = sessionKey.match(/(?:^|:)agent:([^:]+)/) ?? sessionKey.match(/^([^:]+):/);
    if (m) return m[1];
  }
  return fallback;
}

function extractPrompt(event: unknown): string {
  const e = event as Record<string, unknown> | undefined;
  if (!e) return '';
  for (const key of ['prompt', 'input', 'message', 'text', 'content']) {
    const v = e[key];
    if (typeof v === 'string' && v) return v;
  }
  return '';
}

const IMAGE_MIME_RE = /^image\//i;

function extractHasImage(event: unknown): boolean {
  const e = event as Record<string, unknown> | undefined;
  const atts = e?.attachments;
  if (!Array.isArray(atts)) return false;
  return atts.some((a) => {
    const rec = a as Record<string, unknown>;
    const mime = typeof rec?.mimeType === 'string' ? rec.mimeType : typeof rec?.type === 'string' ? rec.type : '';
    return IMAGE_MIME_RE.test(mime) || rec?.kind === 'image';
  });
}

function isTextSlotCapable(c: ModelCandidate): boolean {
  const mods: ModelKind[] = c.meta?.inputModalities ?? c.modelType ?? ['text'];
  return mods.includes('text') || mods.includes('image');
}

function splitRef(modelRef: string): { provider: string; model: string } {
  const idx = modelRef.indexOf('/');
  if (idx < 0) return { provider: '', model: modelRef };
  return { provider: modelRef.slice(0, idx), model: modelRef.slice(idx + 1) };
}

export default definePluginEntry({
  id: 'model-router',
  name: 'Model Router',
  description: 'Data-driven per-task model auto-selection (efficiency/cost/performance).',

  register(api: any) {
    api.on(
      'before_model_resolve',
      async (event: unknown, ctx: { sessionKey?: string }) => {
        try {
          const cfg = (api.pluginConfig ?? {}) as ModelRouterConfig;
          if (!cfg.enabled) return {};

          const agentId = resolveAgentId(ctx?.sessionKey, cfg.defaultAgentId);
          const agentCfg = agentId ? cfg.byAgent?.[agentId] : undefined;
          if (!agentCfg?.autoSelectText) return {};

          const candidates = (cfg.candidates ?? []).filter(isTextSlotCapable);
          if (candidates.length === 0) return {};

          const prompt = extractPrompt(event);
          const hasImage = extractHasImage(event);
          const features = deriveTaskFeatures(prompt, { hasImage, sensitiveMode: agentCfg.sensitiveMode });
          const result = selectBestModel(candidates, features, agentCfg.profile ?? 'balanced', {
            language: cfg.language,
          });
          if (!result) return {};

          const { provider, model } = splitRef(result.modelRef);
          if (!model) return {};

          const top = result.factors[0];
          console.log(
            `[model-router] agent=${agentId} intent=${features.intent}` +
            `${features.sensitive ? ' [sensitive]' : ''} → ${result.modelRef}` +
            ` (score=${result.score.toFixed(3)}, top=${top?.factor}, considered=${result.consideredCount})`,
          );

          const out: Record<string, string> = { modelOverride: model };
          if (provider) out.providerOverride = provider;
          return out;
        } catch (err) {
          console.warn(`[model-router] before_model_resolve failed: ${String(err)}`);
          return {};
        }
      },
      { name: 'model-router-resolve' },
    );
  },
});
