import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { SkillPickerDialogHeaderActions } from '@/components/skills/SkillPickerDialogHeaderActions';
import {
  skillPickerDialogBodyClasses,
  skillPickerDialogHeaderClasses,
  skillPickerDialogShellClasses,
  skillPickerDialogSubtitleClasses,
  skillPickerDialogTitleClasses,
  SKILL_PICKER_MODAL_CONTENT_CLASS,
  SKILL_PICKER_MODAL_OVERLAY_CLASS,
} from '@/components/skills/skill-picker-styles';
import { cn } from '@/lib/utils';

export interface SkillPickerDialogShellProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  onSave: () => void;
  saving?: boolean;
  saveDisabled?: boolean;
  closeDisabled?: boolean;
  saveLabel?: string;
  saveTestId?: string;
  closeTestId?: string;
  testId?: string;
  maxWidthClass?: string;
}

export function SkillPickerDialogShell({
  open,
  onClose,
  title,
  subtitle,
  children,
  onSave,
  saving = false,
  saveDisabled = false,
  closeDisabled = false,
  saveLabel,
  saveTestId,
  closeTestId,
  testId,
  maxWidthClass = 'max-w-lg',
}: SkillPickerDialogShellProps) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && !closeDisabled && onClose()}>
      <DialogContent
        overlayClassName={SKILL_PICKER_MODAL_OVERLAY_CLASS}
        className={cn(
          SKILL_PICKER_MODAL_CONTENT_CLASS,
          maxWidthClass,
          'max-h-[90vh] w-full flex flex-col p-0 gap-0',
          skillPickerDialogShellClasses,
        )}
        data-testid={testId}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <div className={cn('no-drag flex items-start justify-between gap-4', skillPickerDialogHeaderClasses)}>
          <div className="min-w-0 flex-1">
            <DialogTitle className={skillPickerDialogTitleClasses}>{title}</DialogTitle>
            {subtitle ? (
              <p className={skillPickerDialogSubtitleClasses}>{subtitle}</p>
            ) : null}
          </div>
          <SkillPickerDialogHeaderActions
            onSave={onSave}
            saving={saving}
            saveDisabled={saveDisabled}
            closeDisabled={closeDisabled}
            saveLabel={saveLabel}
            saveTestId={saveTestId}
            closeTestId={closeTestId}
          />
        </div>
        <div className={skillPickerDialogBodyClasses}>{children}</div>
      </DialogContent>
    </Dialog>
  );
}
