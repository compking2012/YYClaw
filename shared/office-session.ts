/**
 * Office collaboration internal session keys (task nodes, task room, p2p, role dm).
 * Gateway persists them for history sync; they must not appear in the chat sidebar.
 *
 * Keep in sync with `electron/services/office/session-keys.ts`.
 */
export function isOfficeSessionKey(key: string): boolean {
  if (!key) return false;
  return /(?:^|:)office:(?:task-room|task|p2p|role):/.test(key);
}
