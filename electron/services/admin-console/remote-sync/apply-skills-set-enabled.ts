// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- OpenClaw config shapes are loosely typed in admin sync ops
// @ts-nocheck
import type { GatewayManager } from '../../../gateway/manager';
import { logger } from '../../../utils/logger';

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * Cloud push: set skill enabled/disabled via gateway `skills.update` (same params as manager workbench).
 */
export async function applySkillsSetEnabled(
  gateway: GatewayManager,
  payloadUnknown: unknown,
): Promise<unknown> {
  const payload = asObj(payloadUnknown);
  if (!payload) throw new Error('skills_set_enabled: payload must be an object');

  const skillKey = String(payload.skillKey ?? '').trim();
  if (!skillKey) throw new Error('skills_set_enabled: skillKey is required');

  if (!('enabled' in payload)) {
    throw new Error('skills_set_enabled: enabled is required');
  }
  if (typeof payload.enabled !== 'boolean') {
    throw new Error('skills_set_enabled: enabled must be a boolean');
  }

  const result = await gateway.rpc<unknown>(
    'skills.update',
    { skillKey, enabled: payload.enabled },
    30_000,
  );
  logger.info(`[clawx_apply_sync] skills_set_enabled ${skillKey} enabled=${payload.enabled}`);
  return result ?? { ok: true };
}
