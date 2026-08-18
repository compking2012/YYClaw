export {
  isOfficeCollaborationEnabled,
  SHOW_OFFICE_COLLABORATION,
} from '@shared/office-collaboration-feature';

/** When true, office runtime sessions appear in the chat sidebar (see office.env). */
export const SHOW_OFFICE_SESSIONS: boolean = __SHOW_OFFICE_SESSIONS__;

export const OFFICE_COLLABORATION_HIDDEN_MESSAGE =
  'Office Collaboration is hidden in this build (set VITE_SHOW_OFFICE_COLLABORATION=true in office.env and rebuild).';
