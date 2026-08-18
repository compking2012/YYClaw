/**
 * Thin wrapper over the main-process Gateway RPC proxy (`gateway:rpc`).
 *
 * Voice features must NOT open their own WebSocket to the Gateway — the
 * Main process owns the Gateway transport (see AGENTS.md). All voice RPCs
 * (`talk.*`, `tts.*`) flow through this proxy, exactly like `chat.send`.
 */
import { hostApi } from '@/lib/host-api';

export async function gatewayRpc<T = unknown>(
  method: string,
  params?: unknown,
  timeoutMs?: number,
): Promise<T> {
  return hostApi.gateway.rpc<T>(method, params, timeoutMs);
}
