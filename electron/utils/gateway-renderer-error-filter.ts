/**
 * GatewayManager may emit `error` while the process is intentionally restarting
 * (e.g. admin apply-sync). Those messages should not be surfaced as UI toasts.
 */
export function shouldForwardGatewayErrorToRenderer(message: string | undefined): boolean {
  if (!message) return true;
  const m = message.toLowerCase();
  if (m.includes('gateway stopped')) return false;
  return true;
}
