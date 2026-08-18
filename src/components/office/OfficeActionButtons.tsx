import type { MouseEvent, ReactNode } from 'react';
import { Archive, Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const actionBtnClass = 'h-7 text-[11px]';
const inlineBtnClass =
  'h-7 w-7 shrink-0 p-0 text-muted-foreground hover:bg-muted/80 hover:text-foreground';
const inlineDeleteClass =
  'h-7 w-7 shrink-0 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive';

/** Icon button with zero-delay tooltip (project card header actions). */
export function OfficeInlineIconTooltipButton({
  label,
  testId,
  className,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  testId?: string;
  className: string;
  disabled?: boolean;
  onClick?: (e: MouseEvent) => void;
  children: ReactNode;
}) {
  const button = (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className={className}
      disabled={disabled}
      data-testid={testId}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </Button>
  );

  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        {disabled ? (
          <span className="inline-flex cursor-not-allowed">{button}</span>
        ) : (
          button
        )}
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

interface OfficeActionButtonsProps {
  onEdit?: () => void;
  onDelete?: () => void;
  onArchive?: () => void;
  editLabel?: string;
  deleteLabel?: string;
  archiveLabel?: string;
  editTestId?: string;
  deleteTestId?: string;
  archiveTestId?: string;
  className?: string;
  disableEdit?: boolean;
  disableDelete?: boolean;
  disableArchive?: boolean;
  /** Shown when archive is disabled (e.g. project still running). */
  archiveDisabledTitle?: string;
  showDelete?: boolean;
  showArchive?: boolean;
  /** Icon-only ghost buttons for inline placement beside a title. */
  inline?: boolean;
}

export function OfficeActionButtons({
  onEdit,
  onDelete,
  onArchive,
  editLabel,
  deleteLabel,
  archiveLabel,
  editTestId,
  deleteTestId,
  archiveTestId,
  className,
  disableEdit = false,
  disableDelete = false,
  disableArchive = false,
  archiveDisabledTitle,
  showDelete = true,
  showArchive = false,
  inline = false,
}: OfficeActionButtonsProps) {
  const { t } = useTranslation('office');
  const editText = editLabel ?? t('edit');
  const deleteText = deleteLabel ?? t('delete');
  const archiveText = archiveLabel ?? t('projectCompletion.archive');
  const archiveDisabledText = archiveDisabledTitle ?? t('archiveDisabledRunning');

  const stop = (fn?: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    fn?.();
  };

  if (inline) {
    return (
      <TooltipProvider delayDuration={0}>
        <div className={cn('flex shrink-0 items-center gap-0.5', className)}>
          {showArchive && onArchive ? (
            disableArchive ? (
              <OfficeInlineIconTooltipButton
                label={archiveDisabledText}
                testId={archiveTestId}
                className={cn(inlineBtnClass, 'pointer-events-none opacity-40')}
                disabled
                onClick={stop()}
              >
                <Archive className="h-3.5 w-3.5" />
              </OfficeInlineIconTooltipButton>
            ) : (
              <OfficeInlineIconTooltipButton
                label={archiveText}
                testId={archiveTestId}
                className={inlineBtnClass}
                onClick={stop(onArchive)}
              >
                <Archive className="h-3.5 w-3.5" />
              </OfficeInlineIconTooltipButton>
            )
          ) : null}
          {onEdit ? (
            <OfficeInlineIconTooltipButton
              label={editText}
              testId={editTestId}
              className={inlineBtnClass}
              disabled={disableEdit}
              onClick={stop(onEdit)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </OfficeInlineIconTooltipButton>
          ) : null}
          {showDelete && onDelete ? (
            <OfficeInlineIconTooltipButton
              label={deleteText}
              testId={deleteTestId}
              className={inlineDeleteClass}
              disabled={disableDelete}
              onClick={stop(onDelete)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </OfficeInlineIconTooltipButton>
          ) : null}
        </div>
      </TooltipProvider>
    );
  }

  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {onEdit ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={actionBtnClass}
          disabled={disableEdit}
          data-testid={editTestId}
          onClick={stop(onEdit)}
        >
          <Pencil className="mr-1 h-3 w-3" />
          {editText}
        </Button>
      ) : null}
      {showDelete && onDelete ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={cn(actionBtnClass, 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive')}
          disabled={disableDelete}
          data-testid={deleteTestId}
          onClick={stop(onDelete)}
        >
          <Trash2 className="mr-1 h-3 w-3" />
          {deleteText}
        </Button>
      ) : null}
    </div>
  );
}
