import { isOfficeSessionKey } from './office-session';
import { isWorkflowSessionKey } from './workflow-session';

declare const __SHOW_OFFICE_SESSIONS__: boolean | undefined;

const buildTimeShowOfficeSessions =
  typeof __SHOW_OFFICE_SESSIONS__ === 'undefined' ? false : __SHOW_OFFICE_SESSIONS__;

let showOfficeSessionsInSidebar = buildTimeShowOfficeSessions;

/** Compile-time default from office.env (`VITE_SHOW_OFFICE_SESSIONS`). */
export function isOfficeSidebarSessionVisibilityEnabled(): boolean {
  return showOfficeSessionsInSidebar;
}

/** Test-only override; call `resetSidebarOfficeSessionVisibility()` in afterEach. */
export function configureSidebarOfficeSessionVisibility(visible: boolean): void {
  showOfficeSessionsInSidebar = visible;
}

export function resetSidebarOfficeSessionVisibility(): void {
  showOfficeSessionsInSidebar = buildTimeShowOfficeSessions;
}

/** Gateway sessions that must never surface in the user-facing sidebar. */
export function isSidebarHiddenSessionKey(key: string): boolean {
  if (isWorkflowSessionKey(key)) return true;
  if (showOfficeSessionsInSidebar) return false;
  return isOfficeSessionKey(key);
}
