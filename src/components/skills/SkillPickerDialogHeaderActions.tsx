import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { DialogClose } from '@/components/ui/dialog';
import { skillPickerHeaderActionButtonClasses } from '@/components/skills/skill-picker-styles';

export interface SkillPickerDialogHeaderActionsProps {
  onSave: () => void;
  /** Use for custom modal shells; omit inside Radix Dialog (uses DialogClose). */
  onClose?: () => void;
  saving?: boolean;
  saveDisabled?: boolean;
  closeDisabled?: boolean;
  /** Override default common:actions.save label (e.g. "Save assignments"). */
  saveLabel?: string;
  saveTestId?: string;
  closeTestId?: string;
}

export function SkillPickerDialogHeaderActions({
  onSave,
  onClose,
  saving = false,
  saveDisabled = false,
  closeDisabled = false,
  saveLabel,
  saveTestId,
  closeTestId,
}: SkillPickerDialogHeaderActionsProps) {
  const { t } = useTranslation('common');

  const exitButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={closeDisabled || saving}
      data-testid={closeTestId}
      className={skillPickerHeaderActionButtonClasses}
    >
      {t('actions.exit')}
    </Button>
  );

  return (
    // no-drag: Windows frameless titlebar drag regions steal clicks on header actions.
    <div className="no-drag flex shrink-0 items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onSave}
        disabled={saving || saveDisabled}
        data-testid={saveTestId}
        className={skillPickerHeaderActionButtonClasses}
      >
        {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : (saveLabel ?? t('actions.save'))}
      </Button>
      {onClose ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onClose}
          disabled={closeDisabled || saving}
          data-testid={closeTestId}
          className={skillPickerHeaderActionButtonClasses}
        >
          {t('actions.exit')}
        </Button>
      ) : (
        <DialogClose asChild>
          {exitButton}
        </DialogClose>
      )}
    </div>
  );
}
