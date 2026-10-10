import { unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import type { ProviderAccount, ProviderType } from '../shared/providers/types';
import type { GatewayManager } from '../gateway/manager';
import { updateDefaultModels } from '../utils/agent-config';
import { logger } from '../utils/logger';
import { getProviderService } from '../services/providers/provider-service';
import { providerAccountToConfig } from '../services/providers/provider-store';
import {
  scheduleGatewayRefresh,
  syncDefaultProviderToRuntime,
  syncSavedProviderToRuntime,
} from '../services/providers/provider-runtime-sync';

export const CI_SMOKE_READY_FILE = 'ci-smoke-ready';
export const CI_SMOKE_FAILED_FILE = 'ci-smoke-failed';

export function isCiSmokeMode(): boolean {
  return process.env.CLAWX_CI_SMOKE === '1';
}

function markerPath(name: string): string {
  return join(app.getPath('userData'), name);
}

function writeMarker(name: string, content: string): void {
  writeFileSync(markerPath(name), content, { encoding: 'utf8', mode: 0o600 });
}

function clearMarkers(): void {
  for (const name of [CI_SMOKE_READY_FILE, CI_SMOKE_FAILED_FILE]) {
    try {
      unlinkSync(markerPath(name));
    } catch {
      // ignore missing markers
    }
  }
}

function readSmokeEnv(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value || fallback;
}

/**
 * Packaged mac CI smoke: configure the domestic GLM-5.2 (or override) provider from
 * SMOKE_* env vars before Gateway auto-start. Writes ci-smoke-ready on success.
 */
export async function runCiSmokeProviderSetup(gatewayManager: GatewayManager): Promise<void> {
  if (!isCiSmokeMode()) {
    return;
  }

  clearMarkers();

  const apiKey = process.env.SMOKE_GLM_API_KEY?.trim() ?? '';
  if (!apiKey) {
    const message = 'SMOKE_GLM_API_KEY is required when CLAWX_CI_SMOKE=1';
    writeMarker(CI_SMOKE_FAILED_FILE, message);
    logger.error(`[ci-smoke] ${message}`);
    return;
  }

  const vendorId = readSmokeEnv('SMOKE_GLM_VENDOR_ID', 'glm52');
  const modelId = readSmokeEnv('SMOKE_GLM_MODEL_ID', 'glm-5.2');
  const label = readSmokeEnv('SMOKE_GLM_LABEL', '国内GLM-5.2模型');
  const baseUrl = readSmokeEnv('SMOKE_GLM_BASE_URL', 'https://claw-x.com/v1');
  const now = new Date().toISOString();

  const account: ProviderAccount = {
    id: vendorId,
    vendorId: vendorId as ProviderType,
    label,
    authMode: 'api_key',
    baseUrl,
    apiProtocol: 'openai-completions',
    model: modelId,
    enabled: true,
    isDefault: false,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const providerService = getProviderService();
    const existing = await providerService.getAccount(vendorId);

    if (existing) {
      const { id: _id, createdAt: _createdAt, ...patch } = account;
      const updated = await providerService.updateAccount(vendorId, { ...patch, updatedAt: now }, apiKey);
      await syncSavedProviderToRuntime(providerAccountToConfig(updated), apiKey, gatewayManager);
    } else {
      await providerService.createAccount(account, apiKey);
      await syncSavedProviderToRuntime(providerAccountToConfig(account), apiKey, gatewayManager);
    }

    await providerService.setDefaultAccount(vendorId);
    await syncDefaultProviderToRuntime(vendorId, gatewayManager);

    const modelRef = `${vendorId}/${modelId}`;
    await updateDefaultModels({ model: modelRef });
    scheduleGatewayRefresh(gatewayManager, '[ci-smoke] default model updated');

    writeMarker(CI_SMOKE_READY_FILE, now);
    logger.info(`[ci-smoke] Provider configured (${label}, ${modelRef}); marker written`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeMarker(CI_SMOKE_FAILED_FILE, message);
    logger.error('[ci-smoke] Provider setup failed:', error);
  }
}
