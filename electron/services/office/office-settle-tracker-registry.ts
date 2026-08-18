import { createOfficeRunTracker, type OfficeRunTracker } from './session-run-settle';

const activeSettleTrackers = new Map<string, OfficeRunTracker>();

/** Stable key for one workflow dispatch wait / recovery cycle. */
export function buildOfficeSettleTrackerKey(
  sessionKey: string,
  runId: string | undefined,
  startedAtMs: number,
): string {
  return `${sessionKey}\0${runId ?? ''}\0${startedAtMs}`;
}

export function getOrCreateOfficeSettleTracker(
  key: string,
  runId: string | undefined,
): OfficeRunTracker {
  const existing = activeSettleTrackers.get(key);
  if (existing) return existing;
  const tracker = createOfficeRunTracker(runId);
  activeSettleTrackers.set(key, tracker);
  return tracker;
}

export function peekOfficeSettleTracker(key: string): OfficeRunTracker | undefined {
  return activeSettleTrackers.get(key);
}

/** Drop tracker after successful terminal settle or explicit cleanup. */
export function releaseOfficeSettleTracker(key: string): void {
  activeSettleTrackers.delete(key);
}

/** Test-only: clear all in-flight trackers. */
export function clearOfficeSettleTrackerRegistryForTests(): void {
  activeSettleTrackers.clear();
}
