import { cn } from '@/lib/utils';

/** Show section search when at least this many items exist (before filtering). */
export const SKILL_PICKER_SEARCH_MIN_COUNT = 5;

/**
 * Stacking: skill side sheets (marketplace / publish) sit below skill picker modals.
 * Overlay/content z-index is set via CSS modifiers in globals.css (not Tailwind utilities)
 * so it always wins over `.clawx-dialog-* { z-index: 50 }`.
 */
export const SKILL_SIDE_SHEET_Z_INDEX_CLASS = 'z-[100]';
export const SKILL_PICKER_MODAL_OVERLAY_CLASS = 'skill-picker-modal-overlay';
export const SKILL_PICKER_MODAL_CONTENT_CLASS = 'skill-picker-modal-content';
/** Nested confirm/choice above an open skill-picker dialog (must beat content z-111). */
export const SKILL_PICKER_NESTED_MODAL_OVERLAY_CLASS = 'skill-picker-nested-modal-overlay';
export const SKILL_PICKER_NESTED_MODAL_CONTENT_CLASS = 'skill-picker-nested-modal-content';

/** @deprecated Use {@link SKILL_PICKER_MODAL_OVERLAY_CLASS} */
export const skillPickerModalOverlayClasses = SKILL_PICKER_MODAL_OVERLAY_CLASS;

/** Max skill/agent rows visible before the list scrolls. */
export const SKILL_PICKER_LIST_MAX_VISIBLE_ROWS = 5;

export const skillPickerInputClasses =
  'h-[38px] rounded-xl bg-transparent border-black/10 dark:border-white/10 shadow-sm';

export const skillPickerLabelClasses = 'text-[14px] text-foreground/80 font-bold';

/** Page-level section title (e.g. Agent settings「技能」, aligned with「频道」). */
export const skillPickerPageSectionTitleClasses =
  'text-xl font-serif text-foreground font-normal tracking-tight';

export const skillPickerPageSectionDescriptionClasses =
  'text-[14px] text-foreground/70 mt-1';

export const skillPickerPageSectionClasses = 'space-y-4';

export const skillPickerBulkButtonClasses =
  'h-7 rounded-full px-3 text-[11px] border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none';

export const skillPickerListContainerBaseClasses =
  'overflow-y-auto rounded-xl border border-black/10 dark:border-white/10 bg-surface-input p-2 space-y-1';

/** @deprecated Use skillPickerListContainerClassesForCount */
export const skillPickerListContainerClasses = skillPickerListContainerBaseClasses;

/** ≤5 items: natural height; >5 items: cap at 5 rows and scroll. */
export function skillPickerListContainerClassesForCount(itemCount: number): string {
  return cn(
    skillPickerListContainerBaseClasses,
    itemCount > SKILL_PICKER_LIST_MAX_VISIBLE_ROWS && 'max-h-[17rem]',
  );
}

export const skillPickerSectionCardClasses =
  'rounded-2xl border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.03] p-4 space-y-3';

export const skillPickerSectionNestedClasses =
  'space-y-3 pt-4 border-t border-black/10 dark:border-white/10 first:border-t-0 first:pt-0';

export const skillPickerDialogShellClasses =
  'rounded-3xl border-0 shadow-2xl bg-background overflow-hidden';

export const skillPickerDialogHeaderClasses = 'px-6 pt-6 pb-4 shrink-0';

export const skillPickerDialogBodyClasses = 'flex-1 overflow-y-auto px-6 pb-6 min-h-0 space-y-4';

export const skillPickerDialogTitleClasses =
  'text-2xl font-serif font-normal tracking-tight leading-tight';

export const skillPickerDialogSubtitleClasses = 'text-[15px] mt-1 text-foreground/70';

export const skillPickerHeaderActionButtonClasses =
  // disabled:pointer-events-auto overrides Button's disabled:pointer-events-none so
  // disabled Save/Exit still occupy a hit target (no “dead zone” / click-through).
  'no-drag h-8 rounded-full px-4 text-[13px] font-medium border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground disabled:pointer-events-auto disabled:opacity-50';

/** @deprecated Use skillPickerHeaderActionButtonClasses */
export const skillPickerHeaderSaveButtonClasses = skillPickerHeaderActionButtonClasses;

/** @deprecated Use skillPickerHeaderActionButtonClasses */
export const skillPickerHeaderCloseButtonClasses = skillPickerHeaderActionButtonClasses;

export const skillPickerFooterButtonClasses =
  'h-9 text-[13px] font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground';

export const SKILL_FETCH_ERROR_KEYS = new Set(['fetchTimeoutError', 'fetchRateLimitError']);
