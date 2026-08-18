/**
 * RPC / transport failures that are expected while the local Gateway is
 * restarting (admin sync, debounced refresh, etc.). Do not show as fatal UI errors.
 */
export function isBenignGatewayLifecycleError(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error);
  return isBenignGatewayLifecycleErrorMessage(raw);
}

export function isBenignGatewayLifecycleErrorMessage(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('gateway 服务重启中')
    || m.includes('gateway service is restarting')
    || m.includes('gateway stopped')
    || m.includes('gateway stopped or in error state')
  );
}
