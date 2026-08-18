import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { WorkflowReviewAttentionEvent } from '@/lib/office-workflow-review-attention';
import { ModalPortal } from '@/components/ui/modal-portal';

interface WorkflowReviewAttentionDialogProps {
  event: WorkflowReviewAttentionEvent;
  onOpenProject: () => void;
  onDismiss: () => void;
}

export function WorkflowReviewAttentionDialog({
  event,
  onOpenProject,
  onDismiss,
}: WorkflowReviewAttentionDialogProps) {
  const { t } = useTranslation('office');

  const messageKey =
    event.phase === 'ready_to_settle'
      ? 'workflowReview.dialogReadyToSettle'
      : event.phase === 'deferred'
        ? 'workflowReview.dialogDeferred'
        : 'workflowReview.dialogCollecting';

  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      data-testid="office-workflow-review-attention-dialog"
    >
      <div className="w-full max-w-md rounded-xl border border-border/50 bg-background p-5 shadow-xl">
        <h3 className="font-serif text-base font-normal tracking-tight">
          {t('workflowReview.dialogTitle')}
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          {t(messageKey, { title: event.title })}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t(`workflowReview.phase.${event.phase}`)}
        </p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onDismiss}
            data-testid="office-workflow-review-attention-dismiss"
          >
            {t('workflowReview.dialogLater')}
          </Button>
          <Button
            size="sm"
            onClick={onOpenProject}
            data-testid="office-workflow-review-attention-open"
          >
            {t('workflowReview.dialogOpenProject')}
          </Button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
