export interface PendingGatewayRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  /** OpenClaw RPC method for this request (omit for non-RPC waiters such as connect handshake). */
  method?: string;
}

export function clearPendingGatewayRequests(
  pendingRequests: Map<string, PendingGatewayRequest>,
  error: Error,
): void {
  for (const [, request] of pendingRequests) {
    clearTimeout(request.timeout);
    request.reject(error);
  }
  pendingRequests.clear();
}

export function resolvePendingGatewayRequest(
  pendingRequests: Map<string, PendingGatewayRequest>,
  id: string,
  value: unknown,
): boolean {
  const request = pendingRequests.get(id);
  if (!request) return false;
  clearTimeout(request.timeout);
  pendingRequests.delete(id);
  request.resolve(value);
  return true;
}

export function rejectPendingGatewayRequest(
  pendingRequests: Map<string, PendingGatewayRequest>,
  id: string,
  error: Error,
): boolean {
  const request = pendingRequests.get(id);
  if (!request) return false;
  clearTimeout(request.timeout);
  pendingRequests.delete(id);
  request.reject(error);
  return true;
}

/** Reject all pending RPCs whose `method` matches (e.g. cooperative cancel during admin apply-sync). */
export function rejectPendingGatewayRequestsByMethod(
  pendingRequests: Map<string, PendingGatewayRequest>,
  method: string,
  error: Error,
): number {
  let count = 0;
  for (const [id, request] of [...pendingRequests.entries()]) {
    if (request.method !== method) continue;
    clearTimeout(request.timeout);
    pendingRequests.delete(id);
    request.reject(error);
    count += 1;
  }
  return count;
}
