/**
 * Model metadata accessor (main process).
 *
 * Source of truth is the enriched provider catalog served by the Admin Console
 * (`/api/v1/provider-catalog` → `provider.models[modelId]`). The renderer fetches
 * that catalog and pushes the per-model `ModelMeta` down here via
 * `setModelCatalogMeta`, persisted in the ClawX store (`modelCatalogMeta`).
 *
 * Resolution order for a given model:
 *   1. store cache (last catalog fetch — server-authoritative)
 *   2. bundled `resources/config/providers.json` seed (developer-mode debug data)
 *
 * All lookups degrade gracefully (return undefined) so callers can fall back to
 * neutral scoring / the configured default model.
 */
import type { ModelMeta } from '../../shared/providers/types';
import { PROVIDER_DEFINITIONS } from '../../shared/providers/registry';
import { getClawXProviderStore } from './store-instance';

const STORE_KEY = 'modelCatalogMeta';

/** Provider-id → (modelId → ModelMeta). */
export type ModelCatalogMeta = Record<string, Record<string, ModelMeta>>;

/** Bundled seed, keyed by provider id, from resources/config/providers.json. */
const BUNDLED_META: ModelCatalogMeta = (() => {
  const out: ModelCatalogMeta = {};
  for (const def of PROVIDER_DEFINITIONS) {
    if (def.models && typeof def.models === 'object') {
      out[def.id] = def.models as Record<string, ModelMeta>;
    }
  }
  return out;
})();

/** Split `runtimeProviderKey/modelId` on the FIRST slash (modelId may contain slashes). */
export function splitModelRef(modelRef: string): { providerKey: string; modelId: string } {
  const idx = modelRef.indexOf('/');
  if (idx < 0) return { providerKey: '', modelId: modelRef };
  return { providerKey: modelRef.slice(0, idx), modelId: modelRef.slice(idx + 1) };
}

async function readCache(): Promise<ModelCatalogMeta> {
  try {
    const store = await getClawXProviderStore();
    return (store.get(STORE_KEY) as ModelCatalogMeta | undefined) ?? {};
  } catch {
    return {};
  }
}

/** Persist the per-model metadata carried by the enriched catalog (called from renderer via IPC). */
export async function setModelCatalogMeta(meta: ModelCatalogMeta): Promise<void> {
  const store = await getClawXProviderStore();
  store.set(STORE_KEY, meta ?? {});
}

/**
 * Resolve `ModelMeta` for a model ref. Tries an exact provider+model match
 * first (cache, then bundled), then a provider-agnostic match by model id so
 * refs whose runtime provider key differs from the catalog provider id still
 * resolve.
 */
export async function getModelMeta(modelRef: string): Promise<ModelMeta | undefined> {
  const { providerKey, modelId } = splitModelRef(modelRef);
  const cache = await readCache();

  const exact = cache[providerKey]?.[modelId] ?? BUNDLED_META[providerKey]?.[modelId];
  if (exact) return exact;

  for (const source of [cache, BUNDLED_META]) {
    for (const models of Object.values(source)) {
      if (models[modelId]) return models[modelId];
    }
  }
  return undefined;
}

/** Bulk resolve metadata for many refs (cache read once). */
export async function getModelMetaMap(
  modelRefs: string[],
): Promise<Record<string, ModelMeta>> {
  const cache = await readCache();
  const byModelId = (source: ModelCatalogMeta, modelId: string): ModelMeta | undefined => {
    for (const models of Object.values(source)) {
      if (models[modelId]) return models[modelId];
    }
    return undefined;
  };
  const out: Record<string, ModelMeta> = {};
  for (const ref of modelRefs) {
    const { providerKey, modelId } = splitModelRef(ref);
    const meta =
      cache[providerKey]?.[modelId] ??
      BUNDLED_META[providerKey]?.[modelId] ??
      byModelId(cache, modelId) ??
      byModelId(BUNDLED_META, modelId);
    if (meta) out[ref] = meta;
  }
  return out;
}
