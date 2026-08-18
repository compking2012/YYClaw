/**
 * WorkflowFloatingPanel — the full workflow card (header + step list) for the
 * single workflow run currently "popped open" (see `openWorkflowPopupRunId`
 * in the chat store). Rendered as a fixed-corner, non-modal floating window
 * instead of expanding inline in the transcript, so it never interrupts
 * reading the conversation or blocks the input box.
 *
 * Mounted once globally in `Chat/index.tsx`. Only one panel can be open at a
 * time — opening a different run's panel replaces this one.
 */
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Workflow, X } from 'lucide-react';
import { useChatStore } from '@/stores/chat';
import { useWorkflowStore } from '@/stores/workflow';
import { getWorkflowStatus } from '@/lib/workflow-api';
import { cn } from '@/lib/utils';
import { useWorkflowCardInfo } from './useWorkflowCardInfo';
import { WorkflowRunPanel } from './WorkflowRunPanel';

export function WorkflowFloatingPanel() {
  const runId = useChatStore((s) => s.openWorkflowPopupRunId);
  const close = useChatStore((s) => s.closeWorkflowPopup);
  if (!runId) return null;
  return <WorkflowFloatingPanelInner key={runId} runId={runId} onClose={close} />;
}

function WorkflowFloatingPanelInner({ runId, onClose }: { runId: string; onClose: () => void }) {
  const { t } = useTranslation(['chat', 'common']);
  const ingestRun = useWorkflowStore((s) => s.ingestRun);
  const { run, isObserved, title, accent } = useWorkflowCardInfo(runId);
  const hydratedRef = useRef(false);

  // Lazily hydrate per-step results if opened but the in-memory run has none
  // (a finished run reopened after reload). Observed runs have no engine
  // snapshot, so there is nothing to hydrate.
  useEffect(() => {
    if (isObserved || hydratedRef.current) return;
    if (run?.results || run?.status === 'running') return;
    hydratedRef.current = true;
    let cancelled = false;
    void getWorkflowStatus(runId).then((r) => {
      if (!cancelled && r) ingestRun(r);
    });
    return () => {
      cancelled = true;
    };
  }, [isObserved, runId, run?.results, run?.status, ingestRun]);

  return createPortal(
    <div
      data-testid="workflow-floating-panel"
      className={cn(
        'no-drag',
        accent,
        'fixed top-16 right-4 z-40 flex max-h-[70vh] w-80 flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg',
      )}
    >
      <div className={cn('flex items-center gap-2 px-3 py-2', accent)}>
        <Workflow className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={title}>
          {title}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common:actions.close')}
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-black/10 dark:hover:bg-white/10"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-border/60 px-3 py-2">
        <WorkflowRunPanel runId={runId} />
      </div>
    </div>,
    document.body,
  );
}
