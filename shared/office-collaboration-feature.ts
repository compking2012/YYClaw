declare const __SHOW_OFFICE_COLLABORATION__: boolean | undefined;

const buildTimeShowOfficeCollaboration =
  typeof __SHOW_OFFICE_COLLABORATION__ === 'undefined' ? true : __SHOW_OFFICE_COLLABORATION__;

/** Compile-time gate from office.env (`VITE_SHOW_OFFICE_COLLABORATION`, default true). */
export function isOfficeCollaborationEnabled(): boolean {
  return buildTimeShowOfficeCollaboration;
}

/** Alias for {@link isOfficeCollaborationEnabled}. */
export const SHOW_OFFICE_COLLABORATION = buildTimeShowOfficeCollaboration;
