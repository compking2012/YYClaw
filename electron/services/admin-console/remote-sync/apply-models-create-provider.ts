// @ts-nocheck
import type { GatewayManager } from '../../../gateway/manager';
import { logger } from '../../../utils/logger';
import { readModifyWriteOpenClawJson, ensureProviderRequestAllowPrivateNetwork } from '../../../utils/openclaw-auth';
import { broadcastToRenderer } from '../../../utils/broadcast-renderer';
import { storeApiKey } from '../../../utils/secure-storage';
import type { ProviderAccount, ProviderType } from '../../../shared/providers/types';
import { getProviderAccount, saveProviderAccount, setDefaultProviderAccount } from '../../providers/provider-store';
import { adminSyncLagLog } from './admin-sync-lag-log';
import { normalizeConfigPayload } from './config-helpers';
import { scheduleGatewayRefresh } from '../../providers/provider-runtime-sync';

function normProviderId(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '-');
}

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Cloud push: merge new provider into openclaw.json on disk under config lock (same path as local saves), then debounced gateway reload. */
export async function applyModelsCreateProvider(
  gateway: GatewayManager,
  payloadUnknown: unknown,
): Promise<{ ok: boolean; providerId: string }> {
  adminSyncLagLog('models_create_provider_enter', {});
  const payload = asObj(payloadUnknown);
  if (!payload) throw new Error('models_create_provider: payload must be an object');

  const providerId = normProviderId(String(payload.providerId ?? payload.id ?? ''));
  const api = String(payload.api ?? '').trim();
  const baseUrl = String(payload.baseUrl ?? '').trim();
  const apiKey = String(payload.apiKey ?? '').trim();
  const pendingPrimary =
    typeof payload.pendingPrimaryModel === 'string' ? payload.pendingPrimaryModel.trim() : '';
  const accountLabelRaw =
    typeof payload.accountLabel === 'string' ? payload.accountLabel.trim() : '';

  const modelsRaw = payload.models;
  if (!Array.isArray(modelsRaw) || modelsRaw.length === 0) {
    throw new Error('models_create_provider: models must be a non-empty array');
  }

  const modelsArr: Array<{ id: string; name: string; input: unknown[] }> = [];
  for (const m of modelsRaw) {
    const row = asObj(m);
    if (!row) continue;
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    if (!id) continue;
    const input = Array.isArray(row.input) ? row.input.filter((x) => x === 'text' || x === 'image') : ['text'];
    const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : id;
    modelsArr.push({ id, name, input: input.length ? input : ['text'] });
  }

  if (!providerId || !/^[a-z0-9_-]+$/.test(providerId)) {
    throw new Error('models_create_provider: invalid provider id');
  }
  if (!api || !baseUrl || !apiKey || modelsArr.length === 0) {
    throw new Error('models_create_provider: api, baseUrl, apiKey and models are required');
  }

  adminSyncLagLog('models_create_provider_inputs_ok', {
    providerId,
    modelCount: modelsArr.length,
    hasPendingPrimary: Boolean(pendingPrimary),
  });

  const modelIds = modelsArr.map((m) => m.id);

  adminSyncLagLog('models_create_provider_disk_write_start', { providerId });
  let nextPrimary = '';
  await readModifyWriteOpenClawJson((currentRaw) => {
    const currentConfig = normalizeConfigPayload(currentRaw);

    const modelsBlock = asObj(currentConfig.models) ?? {};
    const allProviders = asObj(modelsBlock.providers) ?? {};
    if (allProviders[providerId]) {
      adminSyncLagLog('models_create_provider_abort_already_exists', { providerId });
      throw new Error(`models_create_provider: provider "${providerId}" already exists`);
    }

    const modelsValue = modelsArr.map((m) => ({ id: m.id, name: m.name, input: [...m.input] }));
    const providerEntry: Record<string, unknown> = { api, baseUrl, models: modelsValue, apiKey };
    ensureProviderRequestAllowPrivateNetwork(providerEntry, { providerKey: providerId, baseUrl });
    const newProviders = { ...allProviders, [providerId]: providerEntry };

    const agents = asObj(currentConfig.agents) ?? {};
    const defaults = asObj(agents.defaults) ?? {};
    const existingDefaultsModels = { ...(asObj(defaults.models) ?? {}) };
    const newDefaultsModels: Record<string, { alias?: string }> = {
      ...(existingDefaultsModels as Record<string, { alias?: string }>),
    };
    for (const modelId of modelIds) {
      newDefaultsModels[`${providerId}/${modelId}`] = { alias: modelId };
    }

    const prevModelBlock = { ...(asObj(defaults.model) ?? {}) };
    const newProviderPrefix = `${providerId}/`;
    const rawPrimary =
      typeof payload.primaryModel === 'string' ? payload.primaryModel.trim() : '';
    const primaryForThisProvider =
      rawPrimary && rawPrimary.startsWith(newProviderPrefix) ? rawPrimary : '';
    const pendingForThisProvider =
      pendingPrimary && pendingPrimary.startsWith(newProviderPrefix) ? pendingPrimary : '';
    if (primaryForThisProvider) {
      nextPrimary = primaryForThisProvider;
    } else if (pendingForThisProvider) {
      nextPrimary = pendingForThisProvider;
    } else {
      nextPrimary = `${providerId}/${modelIds[0]!}`;
    }

    return {
      ...currentConfig,
      models: { ...modelsBlock, mode: 'replace', providers: newProviders },
      agents: {
        ...agents,
        defaults: {
          ...defaults,
          models: newDefaultsModels,
          model: { ...prevModelBlock, ...(nextPrimary ? { primary: nextPrimary } : {}) },
        },
      },
    };
  });
  adminSyncLagLog('models_create_provider_disk_write_done', { providerId, nextPrimary });

  /** Align with desktop Add Provider — vendorId stays the catalog / template slug, not `"custom"`. */
  adminSyncLagLog('models_create_provider_before_provider_persist', { providerId });
  const vendorId = providerId as ProviderType;
  const now = new Date().toISOString();
  const prevAccount = await getProviderAccount(providerId);
  const label =
    accountLabelRaw ||
    prevAccount?.label ||
    providerId.charAt(0).toUpperCase() + providerId.slice(1);

  const account: ProviderAccount = {
    id: providerId,
    vendorId,
    label,
    authMode: vendorId === 'ollama' ? 'local' : 'api_key',
    baseUrl,
    apiProtocol: api as ProviderAccount['apiProtocol'],
    model: nextPrimary,
    enabled: true,
    isDefault: false,
    createdAt: prevAccount?.createdAt ?? now,
    updatedAt: now,
  };
  await saveProviderAccount(account);
  await storeApiKey(providerId, apiKey);
  await setDefaultProviderAccount(providerId);
  adminSyncLagLog('models_create_provider_after_provider_persist', { providerId });

  broadcastToRenderer('providers:snapshot-changed', { reason: 'models_create_provider', providerId });
  logger.info(
    `[clawx_apply_sync] models_create_provider ${providerId} (account + key persisted; native watcher like local save)`,
  );
  adminSyncLagLog('models_create_provider_gateway_refresh_scheduled', { providerId });
  scheduleGatewayRefresh(
    gateway,
    `[clawx_apply_sync] OpenClaw config written after models_create_provider "${providerId}"`,
  );
  return { ok: true, providerId };
}
