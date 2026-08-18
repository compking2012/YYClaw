/**
 * Shared derivation of a workflow run's display state, used by both the
 * inline link ({@link WorkflowInlineCard}) and the floating panel
 * ({@link WorkflowFloatingPanel}) so they stay in sync without duplicating
 * the run/card lookup and status/progress math.
 */
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '@/stores/chat';
import { useWorkflowStore } from '@/stores/workflow';
import type { WorkflowStepMeta } from '@/types/workflow';

export function useWorkflowCardInfo(runId: string) {
  const { t } = useTranslation('chat');
  const init = useWorkflowStore((s) => s.init);
  const engineRun = useWorkflowStore((s) => s.runs[runId]);
  const observedRun = useChatStore((s) => s.observedWorkflowByRun?.[runId]);
  const steps = useChatStore((s) => s.workflowStepsByRun?.[runId]);
  // Persisted card — the live run/steps are in-memory only, so after a reload
  // (or session switch) they may be gone; fall back to the persisted card.
  const card = useChatStore((s) => {
    for (const cards of Object.values(s.workflowCardsBySession ?? {})) {
      const found = cards.find((c) => c.runId === runId);
      if (found) return found;
    }
    return undefined;
  });
  const finalize = useChatStore((s) => s.finalizeWorkflowCard ?? (() => undefined));

  // Observed cards visualize a skill running in a normal turn — their live state
  // lives in the chat store (there is no WorkflowEngine run to query/finalize).
  const isObserved = card?.source === 'observed';
  const run = isObserved ? observedRun : engineRun;

  // Make sure the workflow store is subscribed to `workflow:progress`.
  useEffect(() => {
    void init();
  }, [init]);

  // Persist terminal status + synthesized reply back into the session card.
  // The store-level finalizer (chat store `workflow:progress` subscription) is
  // the authoritative path and owns the empty-`result` fallback; this effect
  // only mirrors a NON-EMPTY result so it never clobbers that fallback with an
  // empty string. Observed cards are finalized by the chat store on completion.
  useEffect(() => {
    if (isObserved || !run) return;
    if (run.status === 'done') {
      if (run.result?.trim()) finalize(runId, { status: 'done', finalText: run.result });
    } else if (run.status === 'failed') {
      finalize(runId, { status: 'failed', error: run.error });
    } else if (run.status === 'running') {
      // A resumed run: clear the stale failed error / final reply so the residual
      // red line under the card (WorkflowTurnBlock) disappears once it's running
      // again. Driven by the workflow store's run (armed via init above), so it
      // works on the persisted-card / post-restart path where the chat store
      // finalizer was never armed.
      if (card && (card.status !== 'running' || card.error != null || card.finalText != null)) {
        finalize(runId, { status: 'running', finalText: undefined, error: undefined });
      }
    }
  }, [isObserved, run, runId, finalize, card]);

  const status = run?.status ?? card?.status ?? 'running';
  const title = run?.title ?? card?.title ?? t('workflow.titleFallback');

  const stepList: WorkflowStepMeta[] = useMemo(
    () => (steps && steps.length > 0 ? steps : card?.steps ?? []),
    [steps, card?.steps],
  );
  const total = stepList.length;
  const done = useMemo(() => {
    if (status === 'done') return total;
    let n = 0;
    for (const step of stepList) {
      const fromRun =
        run?.trace?.some((tr) => tr.state === step.id && tr.status === 'completed')
        || Boolean(run?.results && step.id in run.results);
      const fromCard = card?.stepProgress?.some(
        (entry) => entry.id === step.id && entry.status === 'completed',
      );
      if (fromRun || fromCard) n += 1;
    }
    return n;
  }, [status, total, stepList, run, card?.stepProgress]);

  // Status drives the card's accent (identity + at-a-glance state).
  const accent =
    status === 'running'
      ? 'border-primary/40 bg-primary/5'
      : status === 'failed'
        ? 'border-destructive/40 bg-destructive/5'
        : 'border-emerald-500/40 bg-emerald-500/5';
  const bar =
    status === 'running' ? 'bg-primary' : status === 'failed' ? 'bg-destructive' : 'bg-emerald-500';

  return { run, card, isObserved, pending: card?.pending ?? false, status, title, stepList, total, done, accent, bar };
}
