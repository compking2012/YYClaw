/**
 * Abort quiesce lock: UI/store may already be `aborted`, but /run stays blocked
 * until Gateway LLM sessions for the project are confirmed idle (or force-clear).
 */

export type ProjectAbortQuiesceLock = {
  projectId: string;
  generation: number;
  startedAt: number;
  staticSessionKeys: string[];
  inflightSessionKeys: string[];
  abortWork: Promise<void>;
};

const locks = new Map<string, ProjectAbortQuiesceLock>();

export function getAbortQuiesceLock(projectId: string): ProjectAbortQuiesceLock | undefined {
  const id = projectId.trim();
  if (!id) return undefined;
  return locks.get(id);
}

export function isAbortQuiescing(projectId: string): boolean {
  return Boolean(getAbortQuiesceLock(projectId));
}

export function setAbortQuiesceLock(lock: ProjectAbortQuiesceLock): void {
  const id = lock.projectId.trim();
  if (!id) return;
  locks.set(id, { ...lock, projectId: id });
}

export function clearAbortQuiesceLock(
  projectId: string,
  generation?: number,
): ProjectAbortQuiesceLock | undefined {
  const id = projectId.trim();
  if (!id) return undefined;
  const existing = locks.get(id);
  if (!existing) return undefined;
  if (generation !== undefined && existing.generation !== generation) return undefined;
  locks.delete(id);
  return existing;
}

export class ProjectAbortQuiescingError extends Error {
  readonly code = 'PROJECT_ABORT_QUIESCING' as const;

  constructor(projectId: string) {
    super(`Project abort still in progress: ${projectId}`);
    this.name = 'ProjectAbortQuiescingError';
  }
}

export function assertProjectNotAbortQuiescing(projectId: string): void {
  const id = projectId.trim();
  if (!id) return;
  if (isAbortQuiescing(id)) {
    throw new ProjectAbortQuiescingError(id);
  }
}

/** @visibleForTesting */
export function resetAbortQuiesceLocksForTests(): void {
  locks.clear();
}
