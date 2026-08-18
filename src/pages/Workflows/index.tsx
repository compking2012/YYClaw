/**
 * Workflows Page
 *
 * Surfaces the deterministic workflow engine: registered definitions can be
 * launched, and each run shows a per-node trace that explicitly labels whether a
 * node ran deterministically or touched the model — the audit story behind the
 * "workflow-first" execution model.
 */
import { useEffect } from 'react';
import { Workflow as WorkflowIcon, Play, CheckCircle2, XCircle, Loader2, Cpu, Cog } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useWorkflowStore } from '@/stores/workflow';
import type { RunRecord, StepKind, TraceEntry } from '@/types/workflow';

function StepKindBadge({ kind }: { kind?: StepKind }) {
  const { t } = useTranslation('workflow');
  if (!kind) return null;
  const isModel = kind === 'model';
  const isAgent = kind === 'agent';
  return (
    <Badge
      variant="secondary"
      className={cn(
        'gap-1 text-[11px]',
        isModel || isAgent
          ? 'text-amber-700 dark:text-amber-400'
          : 'text-emerald-700 dark:text-emerald-400',
      )}
    >
      {isModel || isAgent ? <Cpu className="h-3 w-3" /> : <Cog className="h-3 w-3" />}
      {t(`stepKind.${kind}`)}
    </Badge>
  );
}

function TraceRow({ entry }: { entry: TraceEntry }) {
  const statusIcon =
    entry.status === 'completed' ? (
      <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
    ) : entry.status === 'failed' ? (
      <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
    ) : (
      <Loader2 className="h-4 w-4 animate-spin text-foreground/60" />
    );
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      {statusIcon}
      <span className="font-mono text-[13px] text-foreground/90">{entry.state}</span>
      <StepKindBadge kind={entry.stepKind} />
    </div>
  );
}

function RunCard({ run }: { run: RunRecord }) {
  const { t } = useTranslation('workflow');
  const statusColor =
    run.status === 'done'
      ? 'text-emerald-700 dark:text-emerald-400'
      : run.status === 'failed'
        ? 'text-red-700 dark:text-red-400'
        : 'text-foreground/70';
  return (
    <div className="rounded-xl border bg-surface-modal p-4" data-testid="workflow-run-card" data-status={run.status}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">{run.title}</span>
          <span className="font-mono text-[11px] text-muted-foreground">{run.runId.slice(0, 8)}</span>
        </div>
        <span className={cn('text-[13px] font-medium', statusColor)}>{t(`status.${run.status}`)}</span>
      </div>
      <div className="rounded-lg bg-surface-input px-3 py-1.5">
        {run.trace.map((entry, i) => (
          <TraceRow key={`${entry.state}-${i}`} entry={entry} />
        ))}
      </div>
      {run.error && <p className="mt-2 text-[13px] text-red-700 dark:text-red-400">{run.error}</p>}
    </div>
  );
}

export function Workflows() {
  const { t } = useTranslation('workflow');
  const definitions = useWorkflowStore((s) => s.definitions);
  const runs = useWorkflowStore((s) => s.runs);
  const init = useWorkflowStore((s) => s.init);
  const start = useWorkflowStore((s) => s.start);

  useEffect(() => {
    void init();
  }, [init]);

  const runList = Object.values(runs).sort((a, b) => b.startedAt - a.startedAt);

  return (
    <div
      data-testid="workflows-page"
      className="flex flex-col -m-6 dark:bg-background h-[calc(100vh-2.5rem)] overflow-hidden"
    >
      <div className="w-full max-w-5xl mx-auto flex flex-col h-full p-10 pt-16 overflow-y-auto">
        {/* Header */}
        <div className="mb-10 shrink-0">
          <h1
            className="text-3xl md:text-4xl font-serif text-foreground mb-3 font-normal tracking-tight"
            style={{ fontFamily: 'Georgia, Cambria, "Times New Roman", Times, serif' }}
          >
            {t('title')}
          </h1>
          <p className="text-[17px] text-foreground/70 font-medium">{t('subtitle')}</p>
        </div>

        {/* Definitions */}
        <div className="mb-10 shrink-0">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
            {t('definitions')}
          </h2>
          <div className="flex flex-col gap-2">
            {definitions.length === 0 && (
              <p className="text-[14px] text-muted-foreground">{t('noDefinitions')}</p>
            )}
            {definitions.map((def) => (
              <div
                key={def.id}
                className="flex items-center justify-between rounded-xl border bg-surface-modal px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <WorkflowIcon className="h-5 w-5 text-foreground/70" />
                  <div>
                    <div className="font-medium text-foreground">{def.title}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {def.id} · v{def.version}
                    </div>
                  </div>
                </div>
                <Button
                  size="sm"
                  data-testid={`workflow-start-${def.id}`}
                  onClick={() => void start(def.id)}
                >
                  <Play className="mr-1.5 h-4 w-4" />
                  {t('run')}
                </Button>
              </div>
            ))}
          </div>
        </div>

        {/* Runs */}
        <div className="shrink-0" data-testid="workflow-runs">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
            {t('runs')}
          </h2>
          <div className="flex flex-col gap-3">
            {runList.length === 0 && (
              <p className="text-[14px] text-muted-foreground">{t('noRuns')}</p>
            )}
            {runList.map((run) => (
              <RunCard key={run.runId} run={run} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
