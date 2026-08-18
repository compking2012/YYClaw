/**
 * WorkflowRunPanel — the step list for one auto-generated workflow run, rendered
 * inline inside the expanded {@link WorkflowInlineCard} (no longer a floating
 * popover).
 *
 * Data sources:
 *  - chat store: per-run step metadata (titles/kind/inputsFrom).
 *  - workflow store: live RunRecord (status/trace/results), kept fresh by the
 *    `workflow:progress` event stream and reconstructed from the persisted
 *    snapshot after a reload (so each step's result survives session reopen).
 *
 * Steps are grouped by dependency depth (derived from `inputsFrom`) so steps
 * that share a depth render as one "parallel group" — execution stays linear for
 * now, but the layout is parallel-ready. Each step shows a preview of its result
 * and can be expanded to read the full result text.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, ChevronDown, Circle, Loader2, RotateCcw, StopCircle, XCircle } from 'lucide-react';
import { useChatStore } from '@/stores/chat';
import { useWorkflowStore } from '@/stores/workflow';
import { observedRunFromCard } from '@/stores/chat/observed-workflow';
import { cn } from '@/lib/utils';
import type { RunRecord, StepKind, WorkflowStepMeta, WorkflowCardRef } from '@/types/workflow';

type StepStatus = 'pending' | 'running' | 'completed' | 'failed';

/**
 * Per-step status. Prefers the live trace; when it's absent (e.g. a finished run
 * reopened after a reload, where only the snapshot-reconstructed record exists),
 * derives completion from `results` / overall status so steps don't all show as
 * pending.
 */
function stepStatus(
  run: RunRecord | undefined,
  stepId: string,
  cardStepProgress?: WorkflowCardRef['stepProgress'],
): StepStatus {
  const entry = run?.trace?.find((t) => t.state === stepId);
  if (entry?.status) {
    // A terminal failed/aborted run must not keep a step spinner from a stale
    // in_progress plan entry that the agent never got to rewrite.
    if (entry.status === 'running' && run?.status === 'failed') return 'failed';
    return entry.status as StepStatus;
  }
  if (run?.results && stepId in run.results) return 'completed';
  if (run?.status === 'done') return 'completed';
  // Post-reload: the in-memory run may be gone; fall back to the per-step
  // progress persisted on the card so completed steps aren't shown as pending.
  const fromCard = cardStepProgress?.find((e) => e.id === stepId)?.status;
  if (fromCard) return fromCard as StepStatus;
  return 'pending';
}

function StatusIcon({ status }: { status: StepStatus }) {
  if (status === 'running') return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />;
  if (status === 'completed') return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />;
  if (status === 'failed') return <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />;
  return <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />;
}

/** Group steps by dependency depth so same-depth steps render as a parallel group. */
function groupByDepth(steps: WorkflowStepMeta[]): WorkflowStepMeta[][] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const depthCache = new Map<string, number>();
  const depthOf = (id: string, seen: Set<string>): number => {
    if (depthCache.has(id)) return depthCache.get(id)!;
    if (seen.has(id)) return 0; // cycle guard
    seen.add(id);
    const step = byId.get(id);
    const deps = step?.inputsFrom?.filter((d) => byId.has(d)) ?? [];
    const depth = deps.length === 0 ? 0 : 1 + Math.max(...deps.map((d) => depthOf(d, seen)));
    depthCache.set(id, depth);
    return depth;
  };
  const groups = new Map<number, WorkflowStepMeta[]>();
  for (const step of steps) {
    const d = depthOf(step.id, new Set());
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d)!.push(step);
  }
  return [...groups.keys()].sort((a, b) => a - b).map((d) => groups.get(d)!);
}

/** One step row: status dot + title + kind badge, with an expandable result body. */
function StepRow({
  run,
  step,
  index,
  cardStepProgress,
}: {
  run: RunRecord | undefined;
  step: WorkflowStepMeta;
  index: number;
  cardStepProgress?: WorkflowCardRef['stepProgress'];
}) {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const st = stepStatus(run, step.id, cardStepProgress);
  const result = run?.results?.[step.id]?.trim() ?? '';
  const hasResult = result.length > 0;
  const label = step.id.startsWith('synthesize') ? t('workflow.synthesizeStep') : step.title;

  return (
    <div className="relative pl-6">
      {/* timeline node + connector */}
      <span className="absolute left-0 top-0.5">
        <StatusIcon status={st} />
      </span>
      <button
        type="button"
        disabled={!hasResult}
        onClick={() => hasResult && setOpen((v) => !v)}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left text-xs transition-colors',
          hasResult && 'hover:bg-black/5 dark:hover:bg-white/10',
        )}
      >
        <span className="w-4 shrink-0 text-[10px] tabular-nums text-muted-foreground/60">{index + 1}</span>
        <span
          className={cn(
            'flex-1 truncate font-medium',
            st === 'completed' && 'text-muted-foreground',
            st === 'failed' && 'text-destructive',
          )}
          title={step.title}
        >
          {label}
        </span>
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {t(`workflow.kind.${step.kind}`)}
        </span>
        <span className="flex w-4 shrink-0 items-center justify-center">
          {hasResult && (
            <ChevronDown
              className={cn('h-3 w-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
            />
          )}
        </span>
      </button>

      {/* collapsed one-line preview of the step's result */}
      {!open && hasResult && (
        <div className="ml-4 mt-0.5 truncate text-[11px] text-muted-foreground/80" title={result}>
          {result}
        </div>
      )}

      {/* expanded full result text */}
      {open && hasResult && (
        <div className="ml-4 mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border/60 bg-black/5 px-2 py-1.5 text-[11px] text-foreground/90 dark:bg-white/5">
          {result}
        </div>
      )}
    </div>
  );
}

export function WorkflowRunPanel({ runId }: { runId: string }) {
  const { t } = useTranslation('chat');
  const steps = useChatStore((s) => s.workflowStepsByRun?.[runId]);
  const abort = useWorkflowStore((s) => s.abort);
  const retry = useWorkflowStore((s) => s.retry);
  const engineRun = useWorkflowStore((s) => s.runs[runId]);
  const observedRun = useChatStore((s) => s.observedWorkflowByRun?.[runId]);
  // Persisted card fallback — in-memory run/steps may be gone after reload.
  const card = useChatStore((s) => {
    for (const cards of Object.values(s.workflowCardsBySession ?? {})) {
      const found = cards.find((c) => c.runId === runId);
      if (found) return found;
    }
    return undefined;
  });

  // Observed cards (a skill running in a normal turn) source their live state
  // from the chat store; there is no WorkflowEngine run to abort. After a reload
  // the live run is gone, so fall back to a card-derived run for correct icons.
  const isObserved = card?.source === 'observed';
  const run = isObserved
    ? observedRun ?? (card ? observedRunFromCard(runId, card.title, card.status, card.error, card.createdAt) : undefined)
    : engineRun;

  const status = run?.status ?? card?.status ?? 'running';
  const stepList: WorkflowStepMeta[] =
    steps && steps.length > 0
      ? steps
      : card?.steps && card.steps.length > 0
        ? card.steps
        : (run?.trace ?? [])
            .filter((tr) => tr.state !== 'done' && tr.state !== 'failed')
            .map((tr) => ({ id: tr.state, title: tr.state, kind: (tr.stepKind ?? 'agent') as StepKind }));

  const groups = groupByDepth(stepList);
  const showGroupLabels = groups.length > 1 && groups.some((g) => g.length > 1);

  // Continuous 1-based index across groups for the timeline numbering.
  let runningIndex = 0;

  return (
    <div data-testid="workflow-run-panel" className="w-full">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {status === 'running' &&
            (run?.currentStepKind === undefined && stepList.length === 0
              ? t('workflow.synthesizing')
              : t('workflow.running'))}
          {status === 'done' && `✅ ${t('workflow.done')}`}
          {status === 'failed' && `❌ ${t('workflow.failed')}`}
        </span>
        {status === 'running' && !isObserved && (
          <button
            type="button"
            onClick={() => void abort(runId)}
            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            aria-label={t('workflow.abort')}
            title={t('workflow.abort')}
          >
            <StopCircle className="h-4 w-4" />
          </button>
        )}
        {status === 'failed' && !isObserved && (
          <button
            type="button"
            onClick={() => void retry(runId)}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
            aria-label={t('workflow.resume')}
            title={t('workflow.resume')}
            data-testid="workflow-resume"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>{t('workflow.resume')}</span>
          </button>
        )}
      </div>

      <div className="space-y-2">
        {groups.map((group, gi) => (
          <div key={gi} className="space-y-1.5 border-l border-border/50 pl-2">
            {showGroupLabels && (
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                {group.length > 1 ? t('workflow.parallelGroup', { n: gi + 1 }) : t('workflow.stage', { n: gi + 1 })}
              </div>
            )}
            {group.map((step) => (
              <StepRow key={step.id} run={run} step={step} index={runningIndex++} cardStepProgress={card?.stepProgress} />
            ))}
          </div>
        ))}
      </div>

      {status === 'failed' && (run?.error ?? card?.error) && (
        <div className="mt-2 border-t border-border pt-2 text-xs text-destructive">
          {(run?.error ?? card?.error ?? '').slice(0, 120)}
        </div>
      )}
    </div>
  );
}
