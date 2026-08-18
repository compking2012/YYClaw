// @ts-nocheck
import type { GatewayManager } from '../../../gateway/manager';
import type { ProviderAccount } from '../../../shared/providers/types';
import { logger } from '../../../utils/logger';
import { getOpenClawProviderKeyForType } from '../../../utils/provider-keys';
import { readModifyWriteOpenClawJson, removeProviderFromOpenClaw } from '../../../utils/openclaw-auth';
import { broadcastToRenderer } from '../../../utils/broadcast-renderer';
import { getProviderService } from '../../providers/provider-service';
import { listProviderAccounts } from '../../providers/provider-store';
import { adminSyncLagLog } from './admin-sync-lag-log';
import { normalizeConfigPayload } from './config-helpers';
import { scheduleGatewayRefresh } from '../../providers/provider-runtime-sync';

function normProviderId(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '-');
}

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * Manager 删除的 models.providers key 可能是短名（如 glm51），本地 account.id 可能是 clawserverglm51-clawserv，
 * 仅靠 id===key 或 id.startsWith(key+'-') 删不干净。
 */
function accountStorageIdMatchesDeletedOpenClawKey(idNorm: string, key: string): boolean {
  if (!idNorm || !key) return false;
  if (idNorm === key) return true;
  if (idNorm.startsWith(`${key}-`)) return true;
  // 仅对较长 key 做分段模糊匹配，避免误删（如 key=open 命中 openrouter）
  if (key.length < 5) return false;
  const segments = idNorm.split('-').filter(Boolean);
  for (const seg of segments) {
    if (seg === key) return true;
    if (seg.length > key.length && (seg.startsWith(key) || seg.endsWith(key))) {
      return true;
    }
  }
  return false;
}

function isProviderAccountBoundToDeletedModelsKey(acc: ProviderAccount, key: string): boolean {
  const idNorm = normProviderId(acc.id);
  let bucketNorm = '';
  try {
    bucketNorm = normProviderId(getOpenClawProviderKeyForType(String(acc.vendorId), acc.id));
  } catch {
    bucketNorm = '';
  }
  return (
    idNorm === key ||
    bucketNorm === key ||
    idNorm.startsWith(`${key}-`) ||
    accountStorageIdMatchesDeletedOpenClawKey(idNorm, key)
  );
}

/**
 * 与客户端 DELETE /api/providers/:id 一致：先删本地账号/密钥，再对「运行时 openclaw key」与 account.id
 * 分别执行 removeProviderFromOpenClaw（见 provider-runtime-sync.removeDeletedProviderFromOpenClaw）。
 *
 * Manager 往往只下发 models.providers 里的短 key（如 glm51），而 custom 在 openclaw 里实际可能是
 * getOpenClawProviderKeyForType 算出的 custom-xxxx；若只 removeProviderFromOpenClaw(glm51)，会残留
 * custom-xxxx，随后 resolveActiveProviderAccountRows 会再次 seed，表现为壳子行仍在。
 */
async function purgeManagerDeletedProviderLocalBindings(openClawKeyRaw: string): Promise<void> {
  const key = normProviderId(openClawKeyRaw);
  if (!key) return;

  let accounts: ProviderAccount[];
  try {
    accounts = await listProviderAccounts();
  } catch (e) {
    logger.warn(`[clawx_apply_sync] listProviderAccounts failed during delete cleanup for ${key}`, e);
    return;
  }

  const matches = accounts.filter((acc) => isProviderAccountBoundToDeletedModelsKey(acc, key));
  const svc = getProviderService();
  const rows = matches.map((acc) => ({ id: acc.id, vendorId: String(acc.vendorId) }));

  for (const row of rows) {
    try {
      await svc.deleteAccount(row.id);
    } catch (e) {
      logger.warn(`[clawx_apply_sync] deleteAccount(${row.id}) failed during models key ${key} cleanup`, e);
    }
  }

  const strippedNorm = new Set<string>();
  const stripOne = async (rawKey: string): Promise<void> => {
    const k = rawKey.trim();
    if (!k) return;
    const n = normProviderId(k);
    if (strippedNorm.has(n)) return;
    strippedNorm.add(n);
    try {
      await removeProviderFromOpenClaw(k);
    } catch (e) {
      logger.warn(`[clawx_apply_sync] removeProviderFromOpenClaw(${k}) failed for deleted models key ${key}`, e);
    }
  };

  for (const row of rows) {
    let runtimeKey = '';
    try {
      runtimeKey = getOpenClawProviderKeyForType(row.vendorId, row.id);
    } catch {
      runtimeKey = '';
    }
    if (runtimeKey) {
      await stripOne(runtimeKey);
    }
    if (normProviderId(row.id) !== normProviderId(runtimeKey)) {
      await stripOne(row.id);
    }
  }

  await stripOne(key);
}

/** Remove refs like `providerId/model` from defaults.model / imageModel / each agent (matches openclaw-auth removeProvider cleanup). */
function stripModelFieldForDeletedProvider(field: unknown, providerId: string): unknown {
  const prefix = `${providerId}/`;
  const hitsProvider = (ref: string): boolean => typeof ref === 'string' && ref.startsWith(prefix);

  if (field == null) return field;
  if (typeof field === 'string') {
    return hitsProvider(field) ? undefined : field;
  }
  if (typeof field === 'object' && !Array.isArray(field)) {
    const obj = { ...(field as Record<string, unknown>) };
    if (typeof obj.primary === 'string' && hitsProvider(obj.primary)) {
      delete obj.primary;
    }
    if (Array.isArray(obj.fallbacks)) {
      const next = (obj.fallbacks as unknown[]).filter(
        (fb) => typeof fb !== 'string' || !hitsProvider(fb),
      );
      if (next.length > 0) {
        obj.fallbacks = next;
      } else {
        delete obj.fallbacks;
      }
    }
    if (Object.keys(obj).length === 0) return undefined;
    return obj;
  }
  return field;
}

function buildAgentsWithStrippedModelRefs(
  agents: Record<string, unknown>,
  defaults: Record<string, unknown>,
  newDefaultsModels: Record<string, unknown>,
  providerId: string,
): Record<string, unknown> {
  const nextDefaults: Record<string, unknown> = {
    ...defaults,
    models: newDefaultsModels,
  };

  const strippedModel = stripModelFieldForDeletedProvider(defaults.model, providerId);
  if (strippedModel === undefined) {
    delete nextDefaults.model;
  } else {
    nextDefaults.model = strippedModel;
  }

  const strippedImage = stripModelFieldForDeletedProvider(defaults.imageModel, providerId);
  if (strippedImage === undefined) {
    delete nextDefaults.imageModel;
  } else {
    nextDefaults.imageModel = strippedImage;
  }

  const nextAgents: Record<string, unknown> = { ...agents, defaults: nextDefaults };

  const list = agents.list;
  if (Array.isArray(list)) {
    nextAgents.list = list.map((agent) => {
      if (!agent || typeof agent !== 'object' || Array.isArray(agent)) {
        return agent;
      }
      const a = { ...(agent as Record<string, unknown>) };
      if ('model' in a) {
        const next = stripModelFieldForDeletedProvider(a.model, providerId);
        if (next === undefined) delete a.model;
        else a.model = next;
      }
      if ('imageModel' in a) {
        const next = stripModelFieldForDeletedProvider(a.imageModel, providerId);
        if (next === undefined) delete a.imageModel;
        else a.imageModel = next;
      }
      return a;
    });
  }

  return nextAgents;
}

/** Single device-side op: merge-remove provider in openclaw.json on disk under config lock, drop local account/key, then debounced gateway reload (same as local provider delete). */
export async function applyModelsDeleteProvider(
  gateway: GatewayManager,
  payloadUnknown: unknown,
): Promise<{ ok: boolean; providerId: string }> {
  adminSyncLagLog('models_delete_provider_enter', {});
  const payload = asObj(payloadUnknown);
  if (!payload) throw new Error('models_delete_provider: payload must be an object');

  const providerId = normProviderId(String(payload.providerId ?? payload.id ?? ''));
  if (!providerId || !/^[a-z0-9_-]+$/.test(providerId)) {
    throw new Error('models_delete_provider: invalid provider id');
  }

  const branch = { kind: 'written' as 'written' | 'absent' };
  adminSyncLagLog('models_delete_provider_disk_write_start', { providerId });
  await readModifyWriteOpenClawJson((current) => {
    const currentConfig = normalizeConfigPayload(current);
    const modelsBlock = asObj(currentConfig.models) ?? {};
    const allProviders = asObj(modelsBlock.providers) ?? {};
    if (!allProviders[providerId]) {
      branch.kind = 'absent';
      adminSyncLagLog('models_delete_provider_absent_in_config', { providerId });
      return current;
    }

    branch.kind = 'written';
    const newProviders = { ...allProviders };
    delete newProviders[providerId];

    const agents = asObj(currentConfig.agents) ?? {};
    const defaults = asObj(agents.defaults) ?? {};
    const existingDefaultsModels = { ...(asObj(defaults.models) ?? {}) };
    const newDefaultsModels: Record<string, unknown> = {};
    for (const [modelRef, entry] of Object.entries(existingDefaultsModels)) {
      if (!modelRef.startsWith(`${providerId}/`)) {
        newDefaultsModels[modelRef] = entry;
      }
    }

    const newAgents = buildAgentsWithStrippedModelRefs(agents, defaults, newDefaultsModels, providerId);

    return {
      ...currentConfig,
      models: { ...modelsBlock, mode: 'replace', providers: newProviders },
      agents: newAgents,
    };
  });
  adminSyncLagLog('models_delete_provider_disk_write_done', { providerId, branch: branch.kind });

  if (branch.kind === 'absent') {
    await purgeManagerDeletedProviderLocalBindings(providerId);
    broadcastToRenderer('providers:snapshot-changed', { reason: 'models_delete_provider', providerId });
    logger.info(
      `[clawx_apply_sync] models_delete_provider ${providerId} (already absent from config; store cleaned; native watcher like local)`,
    );
    adminSyncLagLog('models_delete_provider_gateway_refresh_scheduled', { providerId, branch: 'absent' });
    scheduleGatewayRefresh(
      gateway,
      `[clawx_apply_sync] OpenClaw config written after models_delete_provider (absent) "${providerId}"`,
    );
    return { ok: true, providerId };
  }

  adminSyncLagLog('models_delete_provider_before_purge_bindings', { providerId });
  await purgeManagerDeletedProviderLocalBindings(providerId);
  adminSyncLagLog('models_delete_provider_after_purge_bindings', { providerId });

  broadcastToRenderer('providers:snapshot-changed', { reason: 'models_delete_provider', providerId });

  logger.info(
    `[clawx_apply_sync] models_delete_provider ${providerId} (config + account removed; native watcher like local)`,
  );
  adminSyncLagLog('models_delete_provider_gateway_refresh_scheduled', { providerId, branch: 'full' });
  scheduleGatewayRefresh(
    gateway,
    `[clawx_apply_sync] OpenClaw config written after models_delete_provider "${providerId}"`,
  );
  return { ok: true, providerId };
}
