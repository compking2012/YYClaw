import {
  ArrowDown,
  GitBranch,
  Layers,
  Play,
  RotateCcw,
  Save,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkflowRollbackEdgeOverlay } from '@/components/office/use-workflow-rollback-edge-overlay';
import type { WorkflowNodeRuntimeStatus } from '@/components/office/WorkflowVisualPreview';
import { workflowStepRowClass } from '@/components/office/WorkflowRuntimeStepList';
import { WorkflowRollbackEdgesSvg } from '@/components/office/WorkflowRollbackEdgesSvg';
import { isLangGraphNativePlan, normalizeLangGraphNativePlan } from '@/lib/office-langgraph-plan-types';
import { deriveLangGraphPlanNodeStatus } from '@/lib/office-langgraph-plan';
import type { TaskStepSyncEntry } from '@/lib/office-task-progress-sync';
import { taskStepPhaseI18nKey } from '@/lib/office-task-progress-sync';
import { workflowNodeRoleIds, workflowNodeAgentIds } from '@/lib/office-workflow-node';
import {
  shouldHighlightWorkflowLayerHandoff,
  workflowNodeShouldPulse,
} from '@/lib/office-workflow-visual-progress';
import { workflowNodeRoleLabels } from '@/lib/office-workflow-visual';
import {
  editGateMissingKeyForLangGraphNode,
  officeMissingNodeFrameClass,
} from '@/lib/office-missing-agents';
import { cn } from '@/lib/utils';
import { OfficeMissingAgentBadge } from '@/components/office/OfficeMissingAgentBadge';
import type {
  LangGraphPlanNode,
  LangGraphVisualLayer,
} from '@/lib/office-langgraph-plan-types';
import type { LangGraphWorkflowSource, NodeRunRecord, WorkflowDefinition, WorkflowNode } from '@/types/office';
import type { ProjectAgentRef } from '@/lib/office-workflow-node';

function membersAsRoles(members: ProjectAgentRef[]): Array<{ id: string; name: string; emoji?: string }> {
  return members.map((m) => ({ id: m.agentId, name: m.displayName, emoji: '🤖' }));
}

interface LangGraphWorkflowVisualPreviewProps {
  workflow: WorkflowDefinition;
  /** @deprecated Use members */
  roles?: Array<{ id: string; name: string; emoji?: string }>;
  members?: ProjectAgentRef[];
  className?: string;
  /** Project card runtime: status colors, handoff arrows, single-step run. */
  runtime?: boolean;
  nodeStatusById?: Record<string, WorkflowNodeRuntimeStatus>;
  nodeRuns?: NodeRunRecord[];
  stepsByNodeId?: Map<string, TaskStepSyncEntry>;
  onRunNode?: (nodeId: string) => void;
  canRunNode?: (nodeId: string) => boolean;
  editGateMissingBadgeByKey?: ReadonlyMap<string, boolean>;
  langGraphMissingKeySource?: LangGraphWorkflowSource;
}

function roleNamesForNode(
  node: WorkflowNode,
  roles: Array<{ id: string; name: string }>,
): string {
  return workflowNodeRoleIds(node)
    .map((id) => roles.find((role) => role.id === id)?.name ?? id)
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

function isParallelLayer(
  layer: LangGraphVisualLayer,
  executePlanNodes: LangGraphPlanNode[],
): boolean {
  return layer.kind === 'parallel' || executePlanNodes.length > 1;
}

function ParallelLayerHeader({
  t,
  subtitle,
}: {
  t: (key: string) => string;
  subtitle?: string;
}) {
  return (
    <div
      className="mb-2 flex flex-wrap items-center gap-2"
      data-testid="office-langgraph-parallel-header"
    >
      <span
        className="inline-flex items-center gap-1 rounded-full border border-sky-500/50 bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:text-sky-400"
        data-testid="office-langgraph-parallel-badge"
      >
        <GitBranch className="h-3 w-3" />
        {t('workflow.langGraphParallelBadge')}
      </span>
      {subtitle ? (
        <span className="text-[10px] text-muted-foreground">{subtitle}</span>
      ) : null}
    </div>
  );
}

function PreviewExecuteStepCard({
  label,
  subtitle,
  status,
  showMissingBadge = false,
  showEmptyNodeBadge = false,
  missingBadgeTestId,
  emptyBadgeTestId,
}: {
  label: string;
  subtitle?: string;
  status?: WorkflowNodeRuntimeStatus;
  showMissingBadge?: boolean;
  showEmptyNodeBadge?: boolean;
  missingBadgeTestId?: string;
  emptyBadgeTestId?: string;
}) {
  const showAnyBadge = showMissingBadge || showEmptyNodeBadge;
  return (
    <div
      className={cn(
        'min-w-[9rem] rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-center shadow-sm',
        showAnyBadge && officeMissingNodeFrameClass(true),
        status === 'running' && 'ring-2 ring-primary/45',
        status === 'completed' && 'border-emerald-500/50 bg-emerald-500/5',
        status === 'failed' && 'border-destructive/60 bg-destructive/5',
      )}
      data-missing-agents={showAnyBadge ? 'true' : 'false'}
    >
      <div className="flex flex-col items-center gap-1">
        <p className="text-[11px] font-semibold leading-tight">{label}</p>
        {showMissingBadge ? (
          <OfficeMissingAgentBadge className="ml-0" testId={missingBadgeTestId} />
        ) : null}
        {showEmptyNodeBadge ? (
          <OfficeMissingAgentBadge
            className="ml-0"
            testId={emptyBadgeTestId}
            labelKey="missingAgents.emptyNodeBadge"
          />
        ) : null}
      </div>
      {subtitle ? (
        <p className="mt-1 text-[10px] text-muted-foreground leading-tight">{subtitle}</p>
      ) : null}
    </div>
  );
}

function RuntimeExecuteNodeRow({
  officeNode,
  roles,
  status,
  step,
  showRun,
  onRunNode,
  nodeRef,
  pulse,
  t,
}: {
  officeNode: WorkflowNode;
  roles: Array<{ id: string; name: string; emoji?: string }>;
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
      data-testid={`office-workflow-step-row-${officeNode.id}`}
      data-workflow-node-status={status}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-semibold text-foreground">
          {officeNode.title?.trim() || t('workflow.unnamedStep')}
        </span>
        <span className="w-[30%] max-w-[7rem] shrink-0 truncate text-center text-muted-foreground">
          {roleNamesForNode(officeNode, roles)}
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
              data-testid={`office-workflow-step-run-${officeNode.id}`}
              onClick={() => onRunNode?.(officeNode.id)}
            >
              {t('runSingleStep')}
            </button>
          ) : null}
        </span>
      </div>
    </div>
  );
}

function executeNodesInPlanLayer(
  layer: LangGraphVisualLayer,
  planNodeById: Map<string, LangGraphPlanNode>,
  workflowNodes: WorkflowNode[],
): WorkflowNode[] {
  const nodeById = new Map(workflowNodes.map((node) => [node.id, node]));
  return layer.nodeIds
    .map((graphId) => planNodeById.get(graphId))
    .filter((node): node is LangGraphPlanNode => node?.kind === 'execute' && Boolean(node.officeNodeId))
    .map((node) => nodeById.get(node.officeNodeId!))
    .filter((node): node is WorkflowNode => Boolean(node));
}

function executePlanNodesInLayer(
  layer: LangGraphVisualLayer,
  planNodeById: Map<string, LangGraphPlanNode>,
): LangGraphPlanNode[] {
  return layer.nodeIds
    .map((graphId) => planNodeById.get(graphId))
    .filter((node): node is LangGraphPlanNode => node?.kind === 'execute');
}

function renderRuntimeExecuteNode({
  node,
  workflow,
  roles,
  nodeStatusById,
  stepsByNodeId,
  nodeRuns,
  onRunNode,
  canRunNode,
  setNodeRef,
  t,
}: {
  node: LangGraphPlanNode;
  workflow: WorkflowDefinition;
  roles: Array<{ id: string; name: string; emoji?: string }>;
  nodeStatusById?: Record<string, WorkflowNodeRuntimeStatus>;
  stepsByNodeId?: Map<string, TaskStepSyncEntry>;
  nodeRuns: NodeRunRecord[];
  onRunNode?: (nodeId: string) => void;
  canRunNode?: (nodeId: string) => boolean;
  setNodeRef: (nodeId: string, el: HTMLDivElement | null) => void;
  t: (key: string) => string;
}) {
  const officeNode = node.officeNodeId
    ? workflow.nodes.find((candidate) => candidate.id === node.officeNodeId)
    : undefined;
  if (!officeNode) return null;

  const executeStatus = nodeStatusById?.[officeNode.id] ?? 'pending';
  const step = stepsByNodeId?.get(officeNode.id);
  const nodeRun = nodeRuns.find((run) => run.nodeId === officeNode.id);
  const pulse = workflowNodeShouldPulse(executeStatus, nodeRun);
  const showRun =
    Boolean(onRunNode)
    && (canRunNode?.(officeNode.id) ?? false)
    && executeStatus !== 'running'
    && executeStatus !== 'completed';

  return (
    <RuntimeExecuteNodeRow
      key={node.id}
      officeNode={officeNode}
      roles={roles}
      status={executeStatus}
      step={step}
      showRun={showRun}
      onRunNode={onRunNode}
      nodeRef={(el) => setNodeRef(officeNode.id, el)}
      pulse={pulse}
      t={t}
    />
  );
}

function parallelLayerSubtitleFromExecutes(
  executePlanNodes: LangGraphPlanNode[],
  workflow: WorkflowDefinition,
  t: (key: string) => string,
): string {
  const titles = executePlanNodes
    .map((node) => {
      const office = node.officeNodeId
        ? workflow.nodes.find((candidate) => candidate.id === node.officeNodeId)
        : undefined;
      return office?.title?.trim() || node.label;
    })
    .filter(Boolean);
  if (titles.length === 0) return t('workflow.langGraphSubgraph');
  return titles.join(' · ');
}

function resolvePlanEntryStepLabel(
  plan: ReturnType<typeof normalizeLangGraphNativePlan>,
  planNodeById: Map<string, LangGraphPlanNode>,
  workflow: WorkflowDefinition,
): string {
  const entryNode = planNodeById.get(plan.entry);
  if (entryNode?.kind === 'execute') {
    const office = entryNode.officeNodeId
      ? workflow.nodes.find((candidate) => candidate.id === entryNode.officeNodeId)
      : undefined;
    return office?.title?.trim() || entryNode.label;
  }
  const entryLayer = plan.visualLayers.find((layer) => layer.nodeIds.includes(plan.entry));
  if (entryLayer) {
    const executes = executePlanNodesInLayer(entryLayer, planNodeById);
    const first = executes[0];
    if (first) {
      const office = first.officeNodeId
        ? workflow.nodes.find((candidate) => candidate.id === first.officeNodeId)
        : undefined;
      return office?.title?.trim() || first.label;
    }
  }
  return entryNode?.label ?? plan.entry;
}

function renderPreviewExecuteStep({
  node,
  plan,
  workflow,
  roles,
  planNodeById,
  nodeStatusById,
  editGateMissingBadgeByKey,
  langGraphMissingKeySource,
}: {
  node: LangGraphPlanNode;
  plan: ReturnType<typeof normalizeLangGraphNativePlan>;
  workflow: WorkflowDefinition;
  roles: Array<{ id: string; name: string; emoji?: string }>;
  planNodeById: Map<string, LangGraphPlanNode>;
  nodeStatusById?: Record<string, WorkflowNodeRuntimeStatus>;
  editGateMissingBadgeByKey?: ReadonlyMap<string, boolean>;
  langGraphMissingKeySource?: LangGraphWorkflowSource;
}) {
  const officeNode = node.officeNodeId
    ? workflow.nodes.find((candidate) => candidate.id === node.officeNodeId)
    : undefined;
  if (!officeNode) return null;
  const status = deriveLangGraphPlanNodeStatus(node, plan, nodeStatusById, planNodeById);
  const isEmptyNode = workflowNodeAgentIds(officeNode).length === 0;
  const showMissingFromOpen = Boolean(
    langGraphMissingKeySource
    && editGateMissingBadgeByKey?.get(
      editGateMissingKeyForLangGraphNode(langGraphMissingKeySource, officeNode.id),
    ),
  );
  const showMissingBadge = showMissingFromOpen;
  const showEmptyNodeBadge = isEmptyNode && !showMissingFromOpen;

  return (
    <PreviewExecuteStepCard
      label={officeNode.title?.trim() || node.label}
      subtitle={workflowNodeRoleLabels(officeNode, roles)}
      status={status}
      showMissingBadge={showMissingBadge}
      showEmptyNodeBadge={showEmptyNodeBadge}
      missingBadgeTestId={`office-langgraph-visual-missing-${officeNode.id}`}
      emptyBadgeTestId={`office-langgraph-visual-empty-${officeNode.id}`}
    />
  );
}

export function LangGraphWorkflowVisualPreview({
  workflow,
  roles: rolesProp,
  members,
  className,
  runtime = false,
  nodeStatusById,
  nodeRuns = [],
  stepsByNodeId,
  onRunNode,
  canRunNode,
  editGateMissingBadgeByKey,
  langGraphMissingKeySource,
}: LangGraphWorkflowVisualPreviewProps) {
  const { t } = useTranslation('office');
  const roles = rolesProp ?? membersAsRoles(members ?? []);
  const plan = isLangGraphNativePlan(workflow.orchestrationPlan)
    ? normalizeLangGraphNativePlan(workflow.orchestrationPlan)
    : null;

  const planNodeById = useMemo(
    () => new Map((plan?.nodes ?? []).map((node) => [node.id, node])),
    [plan],
  );

  const {
    markerId,
    rollbackEdges,
    containerRef,
    setNodeRef,
    rollbackPaths,
    overlaySize,
  } = useWorkflowRollbackEdgeOverlay(runtime ? workflow : { ...workflow, edges: [] });

  if (!plan || (plan.visualLayers?.length ?? 0) === 0) {
    return (
      <p className={cn('text-[11px] text-muted-foreground', className)} data-testid="office-langgraph-visual">
        {t('workflow.langGraphLegacyPlanHint')}
      </p>
    );
  }

  const layersContent = plan.visualLayers.map((layer, layerIndex) => {
    const executePlanNodes = executePlanNodesInLayer(layer, planNodeById);
    if (executePlanNodes.length === 0) return null;

    const prevExecuteNodes =
      layerIndex > 0
        ? executeNodesInPlanLayer(plan.visualLayers[layerIndex - 1]!, planNodeById, workflow.nodes)
        : [];
    const nextExecuteNodes = executeNodesInPlanLayer(layer, planNodeById, workflow.nodes);
    const handoffActive =
      runtime
      && layerIndex > 0
      && shouldHighlightWorkflowLayerHandoff(
        prevExecuteNodes,
        nextExecuteNodes,
        nodeStatusById ?? {},
        nodeRuns,
      );

    const parallelLayer = isParallelLayer(layer, executePlanNodes);
    const parallelRuntime = runtime && parallelLayer;
    const parallelPreview = !runtime && parallelLayer;
    const parallelSubtitle = parallelLayerSubtitleFromExecutes(executePlanNodes, workflow, t);

    const runtimeExecuteRows = executePlanNodes.map((node) =>
      renderRuntimeExecuteNode({
        node,
        workflow,
        roles,
        nodeStatusById,
        stepsByNodeId,
        nodeRuns,
        onRunNode,
        canRunNode,
        setNodeRef,
        t,
      }),
    );

    const previewExecuteCards = executePlanNodes.map((node) => (
      <div key={node.id}>
        {renderPreviewExecuteStep({
          node,
          plan,
          workflow,
          roles,
          planNodeById,
          nodeStatusById,
          editGateMissingBadgeByKey,
          langGraphMissingKeySource,
        })}
      </div>
    ));

    return (
      <div key={`layer-${layerIndex}`}>
        {layerIndex > 0 ? (
          <div className="flex justify-center py-0.5" aria-hidden>
            <ArrowDown
              className={cn(
                'h-3.5 w-3.5 transition-colors',
                runtime && handoffActive
                  ? 'text-emerald-500 drop-shadow-[0_0_5px_rgba(16,185,129,0.5)]'
                  : 'text-muted-foreground',
              )}
              data-testid={runtime && handoffActive ? 'office-workflow-handoff-edge-active' : undefined}
            />
          </div>
        ) : null}

        <div className="space-y-2">
          {!runtime && !parallelLayer ? (
            <div className="flex items-center gap-2 text-[10px] font-medium text-muted-foreground">
              <Layers className="h-3.5 w-3.5" />
              {t('workflow.langGraphSequentialLayer')}
            </div>
          ) : null}

          {parallelRuntime || parallelPreview ? (
            <div
              className="rounded-xl border border-dashed border-sky-500/40 bg-sky-500/5 p-2"
              data-testid="office-workflow-step-parallel-layer"
            >
              <ParallelLayerHeader t={t} subtitle={parallelSubtitle} />
              <div className={cn(parallelRuntime ? 'flex flex-col gap-2' : 'flex flex-row flex-wrap justify-center gap-2')}>
                {parallelRuntime ? runtimeExecuteRows : previewExecuteCards}
              </div>
            </div>
          ) : runtime ? (
            <div className="flex flex-col gap-2">{runtimeExecuteRows}</div>
          ) : (
            <div className="flex flex-col items-center gap-2">{previewExecuteCards}</div>
          )}
        </div>
      </div>
    );
  });

  return (
    <div
      className={cn('space-y-1', className)}
      data-testid={runtime ? 'office-langgraph-visual-runtime' : 'office-langgraph-visual'}
    >
      {!runtime ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-[10px] text-muted-foreground">
          <Play className="h-3.5 w-3.5 text-primary" />
          <span>
            {t('workflow.langGraphNativeEntryStep', {
              step: resolvePlanEntryStepLabel(plan, planNodeById, workflow),
            })}
          </span>
          <span className="text-border">|</span>
          <Save className="h-3.5 w-3.5" />
          <span>
            {plan.checkpointer === 'langgraph_memory'
              ? t('workflow.langGraphNativePersistenceMemory')
              : t('workflow.langGraphNativePersistence')}
          </span>
        </div>
      ) : null}

      <div ref={runtime ? containerRef : undefined} className={cn('relative flex flex-col', runtime && 'gap-0.5')}>
        {runtime ? (
          <WorkflowRollbackEdgesSvg
            paths={rollbackPaths}
            width={overlaySize.width}
            height={overlaySize.height}
            markerId={markerId}
          />
        ) : null}
        {layersContent}
      </div>

      {runtime && rollbackEdges.length > 0 ? (
        <p
          className="text-center text-[10px] text-red-600/90 dark:text-red-400/90"
          data-testid="office-workflow-rollback-legend"
        >
          {t('workflow.visualRollbackEdgeLegend')}
        </p>
      ) : null}

      {!runtime && plan.conditionalRoutes.length > 0 ? (
        <div className="rounded-lg border border-dashed border-destructive/40 bg-destructive/5 p-3">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-medium text-destructive">
            <RotateCcw className="h-3.5 w-3.5" />
            {t('workflow.langGraphConditionalRoutes')}
          </div>
          <ul className="space-y-1 text-[10px] text-muted-foreground">
            {plan.conditionalRoutes.map((route) => {
              const from = planNodeById.get(route.from);
              const failure = route.branches.find((branch) => branch.when === 'failure');
              const targets = (failure?.targets ?? [])
                .map((target) => planNodeById.get(target)?.label ?? target)
                .join(', ');
              return (
                <li key={route.from}>
                  {from?.label ?? route.from} → {t('workflow.langGraphOnFailure')} → {targets}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
