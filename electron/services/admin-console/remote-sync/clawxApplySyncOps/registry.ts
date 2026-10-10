import type { GatewayManager } from '../../../../gateway/manager';

export type ClawxApplySyncHandler = (gateway: GatewayManager, payload: unknown) => Promise<unknown>;

const handlers = new Map<string, ClawxApplySyncHandler>();

export function registerClawxApplySyncOp(op: string, handler: ClawxApplySyncHandler): void {
  if (handlers.has(op)) {
    throw new Error(`clawx_apply_sync op already registered: ${op}`);
  }
  handlers.set(op, handler);
}

export function invokeClawxApplySyncOp(
  gateway: GatewayManager,
  op: string,
  payload: unknown,
): Promise<unknown> {
  const h = handlers.get(op);
  if (!h) {
    throw new Error(`Unsupported clawx_apply_sync op: ${op}`);
  }
  return h(gateway, payload);
}
