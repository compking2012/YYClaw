const sentLedger = new Map<string, boolean>();
const inFlight = new Map<string, Promise<void>>();
const ledgerEpochByProject = new Map<string, number>();

export function projectSessionNewLedgerKey(projectId: string, sessionKey: string): string {
  return `${projectId.trim()}\0${sessionKey.trim()}`;
}

export function getProjectAgentNewLedgerEpoch(projectId: string): number {
  return ledgerEpochByProject.get(projectId.trim()) ?? 0;
}

export function hasProjectSessionNewSent(projectId: string, sessionKey: string): boolean {
  return sentLedger.get(projectSessionNewLedgerKey(projectId, sessionKey)) === true;
}

export function markProjectSessionNewSent(projectId: string, sessionKey: string): void {
  sentLedger.set(projectSessionNewLedgerKey(projectId, sessionKey), true);
}

export function getProjectSessionNewInFlight(
  projectId: string,
  sessionKey: string,
): Promise<void> | undefined {
  return inFlight.get(projectSessionNewLedgerKey(projectId, sessionKey));
}

export function setProjectSessionNewInFlight(
  projectId: string,
  sessionKey: string,
  promise: Promise<void>,
): void {
  inFlight.set(projectSessionNewLedgerKey(projectId, sessionKey), promise);
}

export function clearProjectSessionNewInFlight(projectId: string, sessionKey: string): void {
  inFlight.delete(projectSessionNewLedgerKey(projectId, sessionKey));
}

export function clearProjectAgentNewLedger(projectId?: string): void {
  if (!projectId?.trim()) {
    sentLedger.clear();
    inFlight.clear();
    ledgerEpochByProject.clear();
    return;
  }
  const id = projectId.trim();
  ledgerEpochByProject.set(id, (ledgerEpochByProject.get(id) ?? 0) + 1);
  const prefix = `${id}\0`;
  for (const key of sentLedger.keys()) {
    if (key.startsWith(prefix)) sentLedger.delete(key);
  }
  for (const key of inFlight.keys()) {
    if (key.startsWith(prefix)) inFlight.delete(key);
  }
}

/** @internal test helper */
export function resetProjectAgentNewLedgerForTesting(): void {
  sentLedger.clear();
  inFlight.clear();
  ledgerEpochByProject.clear();
}
