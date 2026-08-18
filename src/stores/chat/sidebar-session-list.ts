import { isSidebarHiddenSessionKey, isOfficeSidebarSessionVisibilityEnabled } from '../../../shared/internal-session';
import { isOfficeSessionKey } from '../../../shared/office-session';
import { isClawXDesktopSessionKey } from './session-key-utils';
import { pickStartupSessionFallback } from './session-selection';
import type { ChatSession } from './types';

export interface ResolveSidebarSessionListInput {
  currentSessionKey: string;
  localSessions: ChatSession[];
  dedupedSessions: ChatSession[];
  defaultSessionKey: string;
}

export interface ResolveSidebarSessionListResult {
  nextSessionKey: string;
  sessionsWithCurrent: ChatSession[];
}

/**
 * Resolve sidebar session list + active key after Gateway `sessions.list`.
 *
 * Rules:
 * - Workflow sub-sessions are always excluded upstream via `isSidebarHiddenSessionKey`.
 * - Office sessions are excluded when `VITE_SHOW_OFFICE_SESSIONS=false`, otherwise treated like normal sessions.
 * - Hidden current keys (incl. office when hidden) are never injected and never fallback-replaced.
 * - Visible active office keys missing from the gateway list are kept and injected.
 */
export function resolveSidebarSessionListState({
  currentSessionKey,
  localSessions,
  dedupedSessions,
  defaultSessionKey,
}: ResolveSidebarSessionListInput): ResolveSidebarSessionListResult {
  let nextSessionKey = currentSessionKey || defaultSessionKey;

  if (isSidebarHiddenSessionKey(nextSessionKey)) {
    return {
      nextSessionKey,
      sessionsWithCurrent: dedupedSessions,
    };
  }

  if (!dedupedSessions.some((session) => session.key === nextSessionKey) && dedupedSessions.length > 0) {
    const hasLocalPendingSession = localSessions.some((session) => session.key === nextSessionKey);
    const keepActiveMissingOfficeKey = nextSessionKey === currentSessionKey
      && isOfficeSessionKey(nextSessionKey)
      && isOfficeSidebarSessionVisibilityEnabled();
    if (!hasLocalPendingSession && !keepActiveMissingOfficeKey) {
      const fallbackKey = pickStartupSessionFallback(nextSessionKey, dedupedSessions);
      if (fallbackKey) {
        nextSessionKey = fallbackKey;
      }
    }
  }

  const sessionsWithCurrent = shouldInjectSessionIntoSidebar(nextSessionKey, dedupedSessions)
    ? [
      ...dedupedSessions,
      { key: nextSessionKey, displayName: nextSessionKey },
    ]
    : dedupedSessions;

  return { nextSessionKey, sessionsWithCurrent };
}

/** Keep the active internal/hidden or visible office session during background list refresh. */
export function pinActiveCurrentSessionKey(
  rawCurrentSessionKey: string,
  resolvedNextSessionKey: string,
): string {
  if (isSidebarHiddenSessionKey(rawCurrentSessionKey)) {
    return rawCurrentSessionKey;
  }
  if (
    isOfficeSidebarSessionVisibilityEnabled()
    && isOfficeSessionKey(rawCurrentSessionKey)
  ) {
    return rawCurrentSessionKey;
  }
  return resolvedNextSessionKey;
}

/** @deprecated Use {@link pinActiveCurrentSessionKey}. */
export function pinHiddenCurrentSessionKey(
  rawCurrentSessionKey: string,
  resolvedNextSessionKey: string,
): string {
  return pinActiveCurrentSessionKey(rawCurrentSessionKey, resolvedNextSessionKey);
}

export function shouldInjectSessionIntoSidebar(
  sessionKey: string,
  dedupedSessions: ChatSession[],
): boolean {
  if (!sessionKey || isSidebarHiddenSessionKey(sessionKey) || !isClawXDesktopSessionKey(sessionKey)) return false;
  return !dedupedSessions.some((session) => session.key === sessionKey);
}

export function ensureSessionEntryForSidebar(
  sessions: ChatSession[],
  sessionKey: string,
): ChatSession[] {
  if (isSidebarHiddenSessionKey(sessionKey)) return sessions;
  if (sessions.some((session) => session.key === sessionKey)) {
    return sessions;
  }
  return [...sessions, { key: sessionKey, displayName: sessionKey }];
}

/** Remove hidden-session timestamps so sidebar metadata stays clean. */
export function pruneHiddenSessionActivity(activity: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(activity).filter(([key]) => !isSidebarHiddenSessionKey(key)),
  );
}
