/**
 * Assemble model-selection candidates from configured provider accounts and run
 * the auto-select utility. Shared by the workflow `model` step and the
 * gateway `model-router` plugin config sync (which embeds these candidates so
 * the plugin can score locally at `before_model_resolve` time).
 */
import type { ModelKind } from '../../shared/providers/model-kind';
import { listProviderAccounts } from './provider-store';
import { getProviderDefinition } from '../../shared/providers/registry';
import { getOpenClawProviderKeyForType } from '../../utils/provider-keys';
import { getModelMetaMap } from './model-meta';
import {
  deriveTaskFeatures,
  selectBestModel,
  type ModelCandidate,
  type OptimizationProfileName,
  type SelectionResult,
} from '../../shared/model-routing/select-model';

export interface AssembledCandidate extends ModelCandidate {
  accountId: string;
  vendorId: string;
  kinds: ModelKind[];
}

function splitModels(model: string | string[] | undefined): string[] {
  if (Array.isArray(model)) return model.map((m) => m.trim()).filter(Boolean);
  if (typeof model === 'string') return model.split(',').map((m) => m.trim()).filter(Boolean);
  return [];
}

/**
 * Build the full candidate set (all modalities) from enabled provider accounts.
 * `meta` is attached from the enriched catalog / bundled seed. Callers filter
 * by modality as needed (the select-model hard constraints also gate this).
 */
export async function assembleModelCandidates(): Promise<AssembledCandidate[]> {
  const accounts = await listProviderAccounts();
  const out: AssembledCandidate[] = [];

  for (const account of accounts) {
    if (account.enabled === false) continue;
    try {
      const definition = getProviderDefinition(account.vendorId);
      const runtimeKey = getOpenClawProviderKeyForType(account.vendorId, account.id);
      const kinds: ModelKind[] =
        (account.modelType && account.modelType.length > 0
          ? account.modelType
          : definition?.modelType) ?? ['text'];

      let modelIds = splitModels(account.model);
      if (modelIds.length === 0) modelIds = splitModels(definition?.defaultModelId);
      // Dedupe while preserving order.
      const seen = new Set<string>();
      for (const modelId of modelIds) {
        if (seen.has(modelId)) continue;
        seen.add(modelId);
        out.push({
          modelRef: `${runtimeKey}/${modelId}`,
          modelId,
          modelType: kinds,
          accountId: account.id,
          vendorId: account.vendorId,
          kinds,
        });
      }
    } catch {
      // Skip accounts we can't map; auto-select degrades to the remaining set.
    }
  }

  const metaMap = await getModelMetaMap(out.map((c) => c.modelRef));
  for (const c of out) {
    c.meta = metaMap[c.modelRef];
  }
  return out;
}

/** True when a candidate can serve text turns (plain text or vision-understanding). */
function isTextSlotCapable(c: AssembledCandidate): boolean {
  const mods = c.meta?.inputModalities ?? c.kinds;
  return mods.includes('text') || mods.includes('image');
}

/**
 * Auto-select the best text-slot model for a task. Returns null when auto-select
 * can't produce a choice (caller falls back to the configured default model).
 */
export async function autoSelectTextModel(opts: {
  prompt: string;
  hasImage?: boolean;
  contextTokens?: number;
  profile?: OptimizationProfileName;
  currentRef?: string;
}): Promise<{ modelRef: string; result: SelectionResult } | null> {
  const candidates = (await assembleModelCandidates()).filter(isTextSlotCapable);
  if (candidates.length === 0) return null;
  const features = deriveTaskFeatures(opts.prompt, {
    hasImage: opts.hasImage,
    contextTokens: opts.contextTokens,
  });
  const result = selectBestModel(candidates, features, opts.profile, { currentRef: opts.currentRef });
  if (!result) return null;
  return { modelRef: result.modelRef, result };
}
