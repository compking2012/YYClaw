import { hostApiFetch } from '@/lib/host-api';

const POLL_MS = 50;
const DEFAULT_WAIT_MS = 10_000;

export async function fetchOfficeExecutionSyncActive(): Promise<boolean> {
  const res = await hostApiFetch<{ success: boolean; active: boolean }>(
    '/api/office/execution-sync/status',
  );
  return res.active === true;
}

/** Wait until Main execution sync (batch ticks) is active — call before starting renderer poll loops. */
export async function waitForOfficeExecutionSyncActive(
  maxWaitMs: number = DEFAULT_WAIT_MS,
): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    if (await fetchOfficeExecutionSyncActive()) return true;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return false;
}
