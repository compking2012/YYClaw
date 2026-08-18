/**
 * Serialize filesystem mutations for a single office project root
 * (`~/.openclaw/office/project/<projectId>/`).
 *
 * Fresh Smart/workflow re-runs wipe and recreate that directory while the UI
 * urgently re-fetches room messages (which also mkdir/ensure the same path).
 * Concurrent `rm(root)` + `mkdir(root)` races as ENOENT and surfaces as a
 * false "start failed" toast even though the runner recovers.
 *
 * True re-entrancy via AsyncLocalStorage: nested calls from the same lock owner
 * run immediately; concurrent callers from other async tasks queue on the chain.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

type ProjectDirLockOwner = { projectId: string; token: symbol };

const projectDirChains = new Map<string, Promise<unknown>>();
const projectDirLockAls = new AsyncLocalStorage<ProjectDirLockOwner>();

export function withOfficeProjectDirLock<T>(
  projectId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const id = projectId.trim();
  if (!id) return fn();

  const current = projectDirLockAls.getStore();
  if (current?.projectId === id) {
    // Same async owner nesting (e.g. reinitialize → ensure) — true re-entry.
    return fn();
  }

  const token = Symbol(`office-project-dir-lock:${id}`);
  const run = (): Promise<T> =>
    projectDirLockAls.run({ projectId: id, token }, () => fn());

  const prev = projectDirChains.get(id) ?? Promise.resolve();
  const next = prev.then(run, run);
  projectDirChains.set(
    id,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

/** @visibleForTesting */
export function resetOfficeProjectDirLocksForTests(): void {
  projectDirChains.clear();
}
