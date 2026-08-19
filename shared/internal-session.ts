import { isWorkflowSessionKey } from './workflow-session';

/**
 * Legacy Office collaboration session keys. The Office feature was removed, but
 * Gateway still persists these keys for installs that used it, so keep filtering
 * them out of the sidebar instead of surfacing orphaned rooms to the user.
 */
const LEGACY_OFFICE_SESSION_KEY_RE = /(?:^|:)office:(?:task-room|task|p2p|role):/;

/** Gateway sessions that must never surface in the user-facing sidebar. */
export function isSidebarHiddenSessionKey(key: string): boolean {
  if (!key) return false;
  if (isWorkflowSessionKey(key)) return true;
  return LEGACY_OFFICE_SESSION_KEY_RE.test(key);
}
