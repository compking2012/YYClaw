import { ArrowDown } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { WorkflowRollbackEdgesSvg } from '@/components/office/WorkflowRollbackEdgesSvg';
import { useWorkflowRollbackEdgeOverlay } from '@/components/office/use-workflow-rollback-edge-overlay';
import { nodeMaxRuntimeMinutes } from '@/lib/office-workflow-roles';
import {
  shouldHighlightWorkflowLayerHandoff,
  workflowNodeShouldPulse,
} from '@/lib/office-workflow-visual-progress';
import { workflowNodeRoleLabels, workflowVisualLayers } from '@/lib/office-workflow-visual';
import { workflowNodeAgentIds, workflowNodeRoleIds } from '@/lib/office-workflow-node';
import {
  editGateMissingKeyForWorkflowNode,
  officeMissingNodeFrameClass,
} from '@/lib/office-missing-agents';
import { cn } from '@/lib/utils';
import { OfficeMissingAgentBadge } from '@/components/office/OfficeMissingAgentBadge';
import type { NodeRunRecord, WorkflowDefinition } from '@/types/office';
import type { ProjectAgentRef } from '@/lib/office-workflow-node';

function membersAsRoles(members: ProjectAgentRef[]): Array<{ id: string; name: string; emoji?: string }> {
  return members.map((m) => ({ id: m.agentId, name: m.displayName, emoji: '🤖' }));
}

export type WorkflowNodeRuntimeStatus = 'pending' | 'running' | 'completed' | 'failed';

export function workflowNodeVisualStatusClass(
  status: WorkflowNodeRuntimeStatus | undefined,
): string {
  switch (status) {
    case 'running':
      return 'border-primary bg-primary/10 ring-2 ring-primary/45 shadow-sm';
    case 'completed':
      return 'border-emerald-500/50 bg-emerald-500/5';
    case 'failed':
      return 'border-destructive/60 bg-destructive/5';
    default:
      return 'border-primary/30';
  }
}

interface WorkflowVisualPreviewProps {
  workflow: WorkflowDefinition;
  /** @deprecated Use members */
  roles?: Array<{ id: string; name: string; emoji?: string }>;
  members?: ProjectAgentRef[];
  className?: string;
  /** 项目执行时各步骤状态；`running` 步骤高亮。 */
  nodeStatusById?: Record<string, WorkflowNodeRuntimeStatus>;
  /** 与 nodeStatusById 配合：runId 存在才视为 LLM 已真正发起（用于脉冲高亮）。 */
  nodeRuns?: NodeRunRecord[];
  onRunNode?: (nodeId: string) => void;
  canRunNode?: (nodeId: string) => boolean;
  /** Open-edit snapshot: keys `workflow:{nodeId}` → show fixed missing badge + red frame. */
  editGateMissingBadgeByKey?: ReadonlyMap<string, boolean>;
  /**
   * True once the DAG has been (re)generated at least once in this edit session
   * (manual "预览工作流" or save-time auto-resolve). Regenerated nodes get fresh
   * ids that the generator only ever fills from the current known team — they
   * can no longer literally carry a missing/ghost agent id, so the frozen
   * open-snapshot `editGateMissingBadgeByKey` lookup is no longer meaningful
   * (and can spuriously keep matching by coincidental id reuse). Once true,
   * that map is ignored; empty nodes still show the "未指定负责人" badge/frame
   * from live content (same as empty nodes created by unbind without regen).
   */
  nodesRegenerated?: boolean;
}

export function WorkflowVisualPreview({
  workflow,
  roles: rolesProp,
  members,
  className,
  nodeStatusById,
  nodeRuns = [],
  onRunNode,
  canRunNode,
  editGateMissingBadgeByKey,
  nodesRegenerated = false,
}: WorkflowVisualPreviewProps) {
  const { t } = useTranslation('office');
  const roles = rolesProp ?? membersAsRoles(members ?? []);
  const layers = useMemo(() => workflowVisualLayers(workflow), [workflow]);
  const runtime = Boolean(nodeStatusById && Object.keys(nodeStatusById).length > 0);
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
      <p className={cn('text-[11px] text-muted-foreground', className)} data-testid="office-workflow-visual-empty">
        {t('workflow.visualEmpty')}
      </p>
    );
  }

  return (
    <div className={cn('flex flex-col items-stretch gap-1', className)}>
      <div
        ref={containerRef}
        className="relative flex flex-col items-stretch gap-1"
        data-testid="office-workflow-visual"
      >
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
              nodeStatusById ?? {},
              nodeRuns,
            );
          return (
          <div key={layer.nodes.map((n) => n.id).join('-')}>
            {layerIdx > 0 ? (
              <div
                className="flex justify-center py-0.5"
                data-testid={handoffActive ? 'office-workflow-handoff-edge-active' : undefined}
              >
                <ArrowDown
                  className={cn(
                    'h-4 w-4 transition-colors',
                    handoffActive
                      ? 'text-primary drop-shadow-[0_0_6px_hsl(var(--primary)/0.55)]'
                      : 'text-muted-foreground',
                  )}
                  aria-hidden
                />
              </div>
            ) : null}
            <div
              className={cn(
                'flex gap-2',
                layer.parallel ? 'flex-row flex-wrap justify-center' : 'flex-col',
              )}
            >
              {layer.nodes.map((node, nodeIdx) => {
                const status = nodeStatusById?.[node.id];
                const nodeRun = nodeRuns.find((r) => r.nodeId === node.id);
                const pulse = workflowNodeShouldPulse(status, nodeRun);
                const statusLabel =
                  status === 'running'
                    ? t('workflow.visualStatusRunning')
                    : status === 'completed'
                      ? t('workflow.visualStatusCompleted')
                      : status === 'failed'
                        ? t('workflow.visualStatusFailed')
                        : runtime
                          ? t('workflow.visualStatusPending')
                          : null;
                const showRun =
                  onRunNode && canRunNode?.(node.id) && status !== 'running' && status !== 'completed';
                // Empty (no assignee) always red-frames — including after roster
                // unbind without a DAG regen, so saveBlockedEmptyNode toast points
                // at a visible node. Open-snapshot "智能体缺失" still wins when the
                // frozen map says so and we have not regenerated (ghost open case).
                const isEmptyNode = workflowNodeAgentIds(node).length === 0;
                const showMissingFromOpen =
                  !nodesRegenerated
                  && editGateMissingBadgeByKey?.get(editGateMissingKeyForWorkflowNode(node.id)) === true;
                const showMissingBadge = showMissingFromOpen;
                const showEmptyNodeBadge = isEmptyNode && !showMissingFromOpen;
                const showAnyBadge = showMissingBadge || showEmptyNodeBadge;

                return (
                  <div
                    key={node.id}
                    ref={(el) => setNodeRef(node.id, el)}
                    className={cn(
                      'relative z-[1] min-w-[140px] flex-1 rounded-lg border-2 bg-card px-3 py-2 shadow-sm transition-colors',
                      layer.parallel ? 'max-w-[48%]' : 'w-full',
                      showAnyBadge
                        ? officeMissingNodeFrameClass(true)
                        : workflowNodeVisualStatusClass(status),
                      pulse && 'animate-pulse',
                    )}
                    data-testid={`office-workflow-visual-node-${node.id}`}
                    data-workflow-node-status={status ?? 'pending'}
                    data-missing-agents={showAnyBadge ? 'true' : 'false'}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                          status === 'running'
                            ? 'bg-primary text-primary-foreground'
                            : status === 'completed'
                              ? 'bg-emerald-600 text-white'
                              : 'bg-primary/80 text-primary-foreground',
                        )}
                      >
                        {layerIdx + 1}
                        {layer.parallel && layer.nodes.length > 1 ? `.${nodeIdx + 1}` : ''}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-1">
                          <p className="truncate text-xs font-semibold">
                            {node.title?.trim() || t('workflow.unnamedStep')}
                          </p>
                          {showMissingBadge ? (
                            <OfficeMissingAgentBadge
                              className="ml-0 shrink-0"
                              testId={`office-workflow-visual-missing-${node.id}`}
                            />
                          ) : null}
                          {showEmptyNodeBadge ? (
                            <OfficeMissingAgentBadge
                              className="ml-0 shrink-0"
                              testId={`office-workflow-visual-empty-${node.id}`}
                              labelKey="missingAgents.emptyNodeBadge"
                            />
                          ) : null}
                        </div>
                        <p className="truncate text-[10px] text-muted-foreground">
                          {workflowNodeRoleLabels(node, roles)}
                        </p>
                        {runtime && statusLabel ? (
                          <p
                            className={cn(
                              'text-[10px] font-medium',
                              status === 'running' ? 'text-primary' : 'text-muted-foreground',
                            )}
                          >
                            {statusLabel}
                          </p>
                        ) : (
                          <p className="text-[10px] text-muted-foreground">
                            {t('workflow.visualMaxRuntime', {
                              minutes: nodeMaxRuntimeMinutes(node),
                            })}
                          </p>
                        )}
                      </div>
                    </div>
                    {layer.parallel && layer.nodes.length > 1 ? (
                      <span className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
                        {t('workflow.visualParallel')}
                      </span>
                    ) : null}
                    {workflowNodeRoleIds(node).length > 1 ? (
                      <span className="mt-1 inline-block rounded bg-primary/10 px-1.5 py-0.5 text-[9px] text-primary">
                        {t('workflow.visualCoExecute')}
                      </span>
                    ) : null}
                    {showRun ? (
                      <button
                        type="button"
                        className="mt-1.5 rounded border border-border bg-background px-1.5 py-0.5 text-[9px] text-foreground hover:bg-muted"
                        data-testid={`office-workflow-visual-run-${node.id}`}
                        onClick={() => onRunNode(node.id)}
                      >
                        {t('runSingleStep')}
                      </button>
                    ) : null}
                  </div>
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
