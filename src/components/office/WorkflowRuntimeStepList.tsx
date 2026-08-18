import { ArrowDown } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { WorkflowRollbackEdgesSvg } from '@/components/office/WorkflowRollbackEdgesSvg';
import { useWorkflowRollbackEdgeOverlay } from '@/components/office/use-workflow-rollback-edge-overlay';
import { taskStepPhaseI18nKey } from '@/lib/office-task-progress-sync';
import type { TaskStepSyncEntry } from '@/lib/office-task-progress-sync';
import {
  shouldHighlightWorkflowLayerHandoff,
  workflowNodeShouldPulse,
} from '@/lib/office-workflow-visual-progress';
import { workflowNodeAgentIds } from '@/lib/office-workflow-node';
import type { ProjectAgentRef } from '@/lib/office-workflow-node';
import { workflowVisualLayers } from '@/lib/office-workflow-visual';
import { cn } from '@/lib/utils';
import type { NodeRunRecord, WorkflowDefinition, WorkflowNode } from '@/types/office';
import type { WorkflowNodeRuntimeStatus } from '@/components/office/WorkflowVisualPreview';

export function workflowStepRowClass(
  status: WorkflowNodeRuntimeStatus | undefined,
): string {
  switch (status) {
    case 'completed':
      // 与“已完成=蓝灯”一致。
      return 'border-sky-500/50 bg-sky-500/5';
    case 'failed':
      return 'border-destructive/60 bg-destructive/5';
    case 'running':
      // 与“执行中=绿灯”一致。
      return 'border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500/30';
    default:
      return 'border-border/40 bg-background';
  }
}

function agentNamesForNode(node: WorkflowNode, members: ProjectAgentRef[]): string {
  return workflowNodeAgentIds(node)
    .map((id) => members.find((m) => m.agentId === id)?.displayName ?? id)
    .join(' + ');
}

function statusLabelForStep(
  t: (key: string) => string,
  status: WorkflowNodeRuntimeStatus,
  phase: TaskStepSyncEntry['phase'],
): string {
  const phaseKey = phase ? taskStepPhaseI18nKey(phase) : null;
  if (phaseKey) return t(phaseKey);
  if (status === 'running') return t('workflow.visualStatusRunning');
  if (status === 'completed') return t('workflow.visualStatusCompleted');
  if (status === 'failed') return t('workflow.visualStatusFailed');
  return t('workflow.visualStatusPending');
}

type WorkflowRuntimeStepListProps = {
  workflow: WorkflowDefinition;
  members: ProjectAgentRef[];
  stepsByNodeId: Map<string, TaskStepSyncEntry>;
  nodeStatusById: Record<string, WorkflowNodeRuntimeStatus>;
  nodeRuns?: NodeRunRecord[];
  className?: string;
  onRunNode?: (nodeId: string) => void;
  canRunNode?: (nodeId: string) => boolean;
};

function WorkflowRuntimeStepRow({
  node,
  members,
  status,
  step,
  showRun,
  onRunNode,
  nodeRef,
  pulse,
  t,
}: {
  node: WorkflowNode;
  members: ProjectAgentRef[];
  status: WorkflowNodeRuntimeStatus;
  step: TaskStepSyncEntry | undefined;
  showRun: boolean;
  onRunNode?: (nodeId: string) => void;
  nodeRef: (el: HTMLDivElement | null) => void;
  pulse: boolean;
  t: (key: string) => string;
}) {
  const statusText = statusLabelForStep(t, status, step?.phase ?? null);
  return (
    <div
      ref={nodeRef}
      className={cn(
        'relative z-[1] min-w-0 flex-1 rounded-lg border px-2.5 py-1.5 text-[11px] shadow-sm transition-colors',
        workflowStepRowClass(status),
        pulse && 'animate-pulse',
      )}
      data-testid={`office-workflow-step-row-${node.id}`}
      data-workflow-node-status={status}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-semibold text-foreground">
          {node.title?.trim() || t('workflow.unnamedStep')}
        </span>
        <span className="w-[30%] max-w-[7rem] shrink-0 truncate text-center text-muted-foreground">
          {agentNamesForNode(node, members)}
        </span>
        <span
          className={cn(
            'w-12 shrink-0 text-right font-medium',
            status === 'running' && 'text-emerald-700 dark:text-emerald-400',
            status === 'failed' && 'text-destructive',
            status === 'completed' && 'text-sky-700 dark:text-sky-400',
            status === 'pending' && 'text-muted-foreground',
          )}
        >
          {statusText}
        </span>
        <span className="flex w-[3.75rem] shrink-0 justify-end">
          {showRun ? (
            <button
              type="button"
              className="whitespace-nowrap rounded border border-border bg-background px-1 py-0.5 text-[9px] hover:bg-muted"
              data-testid={`office-workflow-step-run-${node.id}`}
              onClick={() => onRunNode?.(node.id)}
            >
              {t('runSingleStep')}
            </button>
          ) : null}
        </span>
      </div>
    </div>
  );
}

/** 项目卡片：分层单行步骤 + 红色回滚虚线（与编辑页流程图一致）。 */
export function WorkflowRuntimeStepList({
  workflow,
  members,
  stepsByNodeId,
  nodeStatusById,
  nodeRuns = [],
  className,
  onRunNode,
  canRunNode,
}: WorkflowRuntimeStepListProps) {
  const { t } = useTranslation('office');
  const layers = useMemo(() => workflowVisualLayers(workflow), [workflow]);
  const {
    markerId,
    rollbackEdges,
    containerRef,
    setNodeRef,
    rollbackPaths,
    overlaySize,
  } = useWorkflowRollbackEdgeOverlay(workflow);

  if (layers.length === 0) {
    return (
      <p className={cn('text-[11px] text-muted-foreground', className)} data-testid="office-workflow-step-list-empty">
        {t('workflow.visualEmpty')}
      </p>
    );
  }

  return (
    <div className={cn('flex flex-col gap-0.5', className)} data-testid="office-workflow-step-list">
      <div ref={containerRef} className="relative flex flex-col">
        <WorkflowRollbackEdgesSvg
          paths={rollbackPaths}
          width={overlaySize.width}
          height={overlaySize.height}
          markerId={markerId}
        />

        {layers.map((layer, layerIdx) => {
          const handoffActive =
            layerIdx > 0
            && shouldHighlightWorkflowLayerHandoff(
              layers[layerIdx - 1]!.nodes,
              layer.nodes,
              nodeStatusById,
              nodeRuns,
            );
          return (
          <div key={layer.nodes.map((n) => n.id).join('-')}>
            {layerIdx > 0 ? (
              <div
                className="flex justify-center py-0.5"
                data-testid={handoffActive ? 'office-workflow-handoff-edge-active' : undefined}
                aria-hidden
              >
                <ArrowDown
                  className={cn(
                    'h-3.5 w-3.5 transition-colors',
                    handoffActive
                      ? 'text-emerald-500 drop-shadow-[0_0_5px_rgba(16,185,129,0.5)]'
                      : 'text-muted-foreground',
                  )}
                />
              </div>
            ) : null}
            <div
              className={cn(
                'flex gap-2',
                layer.parallel ? 'flex-row flex-wrap' : 'flex-col',
              )}
              data-testid={
                layer.parallel && layer.nodes.length > 1
                  ? 'office-workflow-step-parallel-layer'
                  : undefined
              }
            >
              {layer.nodes.map((node) => {
                const status = nodeStatusById[node.id] ?? 'pending';
                const step = stepsByNodeId.get(node.id);
                const nodeRun = nodeRuns.find((r) => r.nodeId === node.id);
                const pulse = workflowNodeShouldPulse(status, nodeRun);
                const showRun =
                  Boolean(onRunNode)
                  && (canRunNode?.(node.id) ?? false)
                  && status !== 'running'
                  && status !== 'completed';
                return (
                  <WorkflowRuntimeStepRow
                    key={node.id}
                    node={node}
                    members={members}
                    status={status}
                    step={step}
                    showRun={showRun}
                    onRunNode={onRunNode}
                    nodeRef={(el) => setNodeRef(node.id, el)}
                    pulse={pulse}
                    t={t}
                  />
                );
              })}
            </div>
          </div>
          );
        })}
      </div>

      {rollbackEdges.length > 0 ? (
        <p
          className="text-center text-[10px] text-red-600/90 dark:text-red-400/90"
          data-testid="office-workflow-rollback-legend"
        >
          {t('workflow.visualRollbackEdgeLegend')}
        </p>
      ) : null}
    </div>
  );
}
