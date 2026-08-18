/**
 * Single predicate: abort / abort-quiesce must block any new Office LLM send.
 * Used by the Gateway send gateway and by retry loops (defense in depth).
 */
import { isTaskUserAborted } from './task-run-abort-registry';
import { isAbortQuiescing } from './project-abort-quiesce';

export class OfficeLlmSendAbortedError extends Error {
  readonly code = 'OFFICE_LLM_SEND_ABORTED' as const;

  constructor(projectId: string) {
    super(`Office LLM send blocked: project abort/quiesce in progress (${projectId})`);
    this.name = 'OfficeLlmSendAbortedError';
  }
}

/** Sync memory gate — lock is installed before abort awaits; sufficient at send time. */
export function shouldBlockOfficeLlmSend(projectId?: string | null): boolean {
  const id = projectId?.trim();
  if (!id) return false;
  return isTaskUserAborted(id) || isAbortQuiescing(id);
}

export function assertOfficeLlmSendAllowed(projectId?: string | null): void {
  const id = projectId?.trim();
  if (!id) return;
  if (shouldBlockOfficeLlmSend(id)) {
    throw new OfficeLlmSendAbortedError(id);
  }
}
