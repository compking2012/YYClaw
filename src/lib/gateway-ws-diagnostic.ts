/**
 * Developer-only diagnostic flag, persisted in localStorage.
 *
 * Originally toggled the renderer's WS/HTTP transport fallback. That transport
 * layer has been retired in favour of the typed host IPC bridge, so the flag is
 * now an inert preference kept only to back the Settings developer toggle.
 */
const GATEWAY_WS_DIAG_FLAG = 'clawx:gateway-ws-diagnostic';

export function getGatewayWsDiagnosticEnabled(): boolean {
  try {
    return window.localStorage.getItem(GATEWAY_WS_DIAG_FLAG) === '1';
  } catch {
    return false;
  }
}

export function setGatewayWsDiagnosticEnabled(enabled: boolean): void {
  try {
    if (enabled) {
      window.localStorage.setItem(GATEWAY_WS_DIAG_FLAG, '1');
    } else {
      window.localStorage.removeItem(GATEWAY_WS_DIAG_FLAG);
    }
  } catch {
    // ignore localStorage errors
  }
}
