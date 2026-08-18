import { closeOfficeModalWithFocusHandoff } from '@/lib/preserve-document-focus';

/**
 * Confirm before closing office create/edit dialogs when the form has unsaved edits.
 */
export function confirmDiscardOfficeDraft(message: string): boolean {
  if (typeof window === 'undefined') return true;
  return window.confirm(message);
}

export function requestCloseOfficeDraft(params: {
  dirty: boolean;
  onClose: () => void;
  message: string;
}): void {
  if (!params.dirty || confirmDiscardOfficeDraft(params.message)) {
    closeOfficeModalWithFocusHandoff(params.onClose);
  }
}

export function isShallowRecordDirty<T>(current: T, baseline: T): boolean {
  return JSON.stringify(current) !== JSON.stringify(baseline);
}
