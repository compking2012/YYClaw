import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { sortWorkflowNodesByProcessOrder } from '@/lib/office-workflow-sort';
import { shouldShowWorkflowReviewPanel } from '@/lib/office-workflow-review-visibility';
import { useOfficeStore } from '@/stores/office';
import type { OfficeTempProject, WorkflowDefinition, WorkflowReviewAction } from '@/types/office';

type WorkflowReviewPanelProps = {
  project: OfficeTempProject;
  workflow: WorkflowDefinition;
  disabled?: boolean;
};

export function WorkflowReviewPanel({
  project,
  workflow,
  disabled = false,
}: WorkflowReviewPanelProps) {
  const { t } = useTranslation('office');
  const submitReview = useOfficeStore((s) => s.submitWorkflowReview);
  const settleReview = useOfficeStore((s) => s.settleWorkflowReview);
  const batch = project.workflowReviewBatch;
  const [comment, setComment] = useState('');
  const [rollbackTarget, setRollbackTarget] = useState('');
  const [busyNodeId, setBusyNodeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const nodeTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of workflow.nodes) {
      map.set(node.id, node.title?.trim() || node.id);
    }
    return map;
  }, [workflow.nodes]);

  const orderedNodeIds = useMemo(
    () => sortWorkflowNodesByProcessOrder(workflow).nodes.map((n) => n.id),
    [workflow],
  );

  if (!shouldShowWorkflowReviewPanel(project) || !batch) return null;

  const rollbackOptionsFor = (nodeId: string) => {
    const idx = orderedNodeIds.indexOf(nodeId);
    if (idx <= 0) return [];
    return orderedNodeIds.slice(0, idx).map((id) => ({
      id,
      label: nodeTitleById.get(id) ?? id,
    }));
  };

  const runSubmit = async (nodeId: string, decision: WorkflowReviewAction) => {
    if (!batch.updatedAt) return;
    setError(null);
    setBusyNodeId(nodeId);
    try {
      await submitReview(project.id, nodeId, decision, batch.updatedAt);
      setComment('');
      setRollbackTarget('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyNodeId(null);
    }
  };

  const runSettle = async () => {
    setError(null);
    setBusyNodeId('__settle__');
    try {
      await settleReview(project.id, batch.settleGeneration);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyNodeId(null);
    }
  };

  return (
    <div
      className="mt-2 rounded-lg border border-violet-500/30 bg-violet-500/5 px-3 py-2.5"
      data-testid="office-workflow-review-panel"
    >
      <p className="text-[11px] font-semibold text-violet-800 dark:text-violet-300">
        {t('workflowReview.title')}
      </p>
      <p className="mt-0.5 text-[10px] text-muted-foreground">
        {t(`workflowReview.phase.${batch.phase}`)}
      </p>

      <ul className="mt-2 space-y-2">
        {batch.expectedNodeIds.map((nodeId) => {
          const item = batch.items[nodeId];
          const title = nodeTitleById.get(nodeId) ?? nodeId;
          const awaiting = item?.state === 'awaiting_decision';
          const submitted = item?.state === 'submitted';
          const rollbackOptions = rollbackOptionsFor(nodeId);

          return (
            <li
              key={nodeId}
              className="rounded-md border border-border/50 bg-card/80 px-2 py-1.5"
              data-testid={`office-workflow-review-item-${nodeId}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[11px] font-medium">{title}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {submitted
                    ? t('workflowReview.itemSubmitted')
                    : awaiting
                      ? t('workflowReview.itemAwaiting')
                      : t('workflowReview.itemPending')}
                </span>
              </div>

              {awaiting && batch.phase === 'collecting' ? (
                <div className="mt-1.5 flex flex-col gap-1.5">
                  <textarea
                    className="min-h-[2.5rem] w-full rounded-md border border-border/60 bg-surface-input px-2 py-1 text-[11px]"
                    placeholder={t('workflowReview.commentPlaceholder')}
                    value={comment}
                    disabled={disabled || busyNodeId !== null}
                    data-testid={`office-workflow-review-comment-${nodeId}`}
                    onChange={(e) => setComment(e.target.value)}
                  />
                  <div className="flex flex-wrap gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-[10px]"
                      disabled={disabled || busyNodeId !== null}
                      data-testid={`office-workflow-review-approve-${nodeId}`}
                      onClick={() => void runSubmit(nodeId, { kind: 'approve' })}
                    >
                      {t('workflowReview.approve')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-[10px]"
                      disabled={disabled || busyNodeId !== null || !comment.trim()}
                      data-testid={`office-workflow-review-redo-${nodeId}`}
                      onClick={() =>
                        void runSubmit(nodeId, { kind: 'redo', comment: comment.trim() })
                      }
                    >
                      {t('workflowReview.redo')}
                    </Button>
                    {rollbackOptions.length > 0 ? (
                      <>
                        <select
                          className="h-7 max-w-[8rem] rounded-md border border-border/60 bg-surface-input px-1 text-[10px]"
                          value={rollbackTarget}
                          disabled={disabled || busyNodeId !== null}
                          data-testid={`office-workflow-review-rollback-target-${nodeId}`}
                          onChange={(e) => setRollbackTarget(e.target.value)}
                        >
                          <option value="">{t('workflowReview.rollbackTarget')}</option>
                          {rollbackOptions.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 text-[10px]"
                          disabled={
                            disabled
                            || busyNodeId !== null
                            || !comment.trim()
                            || !rollbackTarget
                          }
                          data-testid={`office-workflow-review-rollback-${nodeId}`}
                          onClick={() =>
                            void runSubmit(nodeId, {
                              kind: 'rollback',
                              targetNodeId: rollbackTarget,
                              comment: comment.trim(),
                            })
                          }
                        >
                          {t('workflowReview.rollback')}
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {batch.phase === 'ready_to_settle' ? (
        <div className="mt-2 flex justify-end">
          <Button
            type="button"
            size="sm"
            className="h-7 text-[10px]"
            disabled={disabled || busyNodeId !== null}
            data-testid="office-workflow-review-settle"
            onClick={() => void runSettle()}
          >
            {t('workflowReview.settle')}
          </Button>
        </div>
      ) : null}

      {error ? (
        <p className="mt-1.5 text-[10px] text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
