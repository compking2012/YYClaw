// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- OpenClaw config shapes are loosely typed in admin sync ops
// @ts-nocheck
import type { GatewayManager } from '../../../gateway/manager';
import { logger } from '../../../utils/logger';

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * Cloud push: update skill config via gateway `skills.update`.
 */
export async function applySkillsUpdateConfig(
  gateway: GatewayManager,
  payloadUnknown: unknown,
): Promise<unknown> {
  const payload = asObj(payloadUnknown);
  if (!payload) throw new Error('skills_update_config: payload must be an object');

  const skillKey = String(payload.skillKey ?? '').trim();
  if (!skillKey) throw new Error('skills_update_config: skillKey is required');

  const params: Record<string, unknown> = { skillKey };
  if ('enabled' in payload && typeof payload.enabled === 'boolean') {
    params.enabled = payload.enabled;
  }
  if ('apiKey' in payload && typeof payload.apiKey === 'string') {
    params.apiKey = payload.apiKey;
  }
  if ('env' in payload && asObj(payload.env)) {
    params.env = payload.env;
  }

  const result = await gateway.rpc<unknown>(
    'skills.update',
    params,
    30_000,
  );
  logger.info(`[clawx_apply_sync] skills_update_config ${skillKey} updated`);
  return result ?? { ok: true };
}
