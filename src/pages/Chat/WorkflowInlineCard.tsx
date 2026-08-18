/**
 * WorkflowInlineCard — the in-conversation representation of an auto-generated
 * workflow run. It no longer renders the full card inline; it's a single
 * compact link at the run's position in the transcript. Clicking it opens the
 * full card (step list + per-step results) in the floating
 * {@link WorkflowFloatingPanel} instead of expanding in place.
 */
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Loader2, Workflow, XCircle } from 'lucide-react';
import { useChatStore } from '@/stores/chat';
import { cn } from '@/lib/utils';
import { useWorkflowCardInfo } from './useWorkflowCardInfo';

export function WorkflowInlineCard({ runId }: { runId: string }) {
  const { t } = useTranslation('chat');
  const openPopup = useChatStore((s) => s.openWorkflowPopup);
  const { pending, status, title, total, done, accent } = useWorkflowCardInfo(runId);

  // A provisional card exists only to surface the query bubble the instant an
  // engine turn routes to a workflow; its compact link is suppressed until the
  // server resolves the real run (the composer's "思考中" indicator conveys the
  // in-flight state meanwhile). See routeAndMaybeStartWorkflow.
  if (pending) return null;

  return (
    <div className="ml-11" data-testid="workflow-inline-card" data-status={status}>
      <button
        type="button"
        onClick={() => openPopup(runId)}
        aria-label={t('workflow.viewProgress')}
        data-testid="workflow-inline-card-button"
        data-status={status}
        className={cn(
          'inline-flex max-w-md items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors',
          'hover:bg-black/5 dark:hover:bg-white/10',
          accent,
        )}
      >
        <Workflow className="h-3.5 w-3.5 text-primary" />
        <span className="truncate font-medium" title={title}>
          {title}
        </span>
        {total > 0 && (
          <span className="tabular-nums text-muted-foreground">{t('workflow.progress', { done, total })}</span>
        )}
        {status === 'running' && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />}
        {status === 'done' && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
        {status === 'failed' && <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />}
      </button>
    </div>
  );
}
