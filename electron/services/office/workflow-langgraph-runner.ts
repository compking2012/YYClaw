import { Annotation, Command, END, interrupt, MemorySaver, START, StateGraph } from '@langchain/langgraph';
import type { GatewayManager } from '../../gateway/manager';
import type {
  NodeRunRecord,
  NodeRunStatus,
  OfficeFixedGroup,
  OfficeTempProject,
  TaskStatus,
  WorkflowDefinition,
  WorkflowNode,
} from './types';
import type { ProjectAgentRef } from '../../../src/lib/office-workflow-node';
import {
  clearTaskRunArtifacts,
  getTempProject,
  persistTempProjectProgress,
  resetTaskRunState,
  upsertTempProject,
} from './store';
import { isTempProjectArchived } from './agent-binding';
import { membersForFixedGroup } from './office-member-resolve';
import {
  clearWorkflowTaskRun,
  getWorkflowTaskRunController,
  registerWorkflowTaskRun,
} from './workflow-run-registry';
import type { RunTaskWorkflowOptions } from './workflow-runner';
import {
  executeWorkflowNode,
  redispatchWorkflowNodesSessionOutputRetry,
  syncWorkflowRunsFromRoomHeal,
  announceAppliedWorkflowAutoRollbacks,
} from './workflow-runner';
import {
  applyWorkflowAutoRollbackForNode,
  recoverStaleCompletedFailureRollbacks,
} from '../../../src/lib/office-workflow-failure-rollback';
import { syncWorkflowEdges } from './workflow-edges';
import {
  diagnoseWorkflowStall,
  freshNodeRuns,
  getIncompletePredecessorRoleIds,
  workflowEdgeList,
} from './workflow-graph';
import { resolveActiveLangGraphWorkflow } from '../../../src/lib/office-langgraph-workflow-bundle';
import { resolveWorkflowForExecution } from '../../../src/lib/office-workflow-node';
import { shouldPersistResolvedWorkflowToProject, materializeWorkflowForProjectRun } from '../../../src/lib/office-task-workflow';
import { workflowStallIdleRoundLimit } from '../../../src/lib/office-workflow-run-heal';
import {
  announceTaskWorkflowFinished,
  announceTaskWorkflowStarted,
  announceWorkflowRunnableBatch,
} from './workflow-room-progress';
import { announceTaskProjectClosure } from './workflow-project-closure';
import { awaitOutstandingHandoffWatchesForTask } from './room-workflow-handoff-watch';
import { auditLog } from './audit';
import { isLangGraphNativePlan, normalizeLangGraphNativePlan } from '../../../src/lib/office-langgraph-plan-types';
import type { LangGraphOrchestrationPlan } from '../../../src/lib/office-langgraph-plan-types';
import {
  planExecuteFailureTargets,
  planExecuteSuccessTargets,
  planFanInPredecessors,
  planFanOutTargets,
  planNodeById,
  planOutgoingTargets,
} from '../../../src/lib/office-langgraph-plan';
import {
  langGraphNodeRunRoute,
  nodeRunTriggersFailureEdge,
} from '../../../src/lib/office-workflow-edge-outcome';
import {
  nodeRunsForWorkflowContinue,
  resetUnattributedCompletedNodeRuns,
} from '../../../src/lib/office-workflow-schedule';
import { reopenWorkflowNodeAndDownstream, reopenWorkflowUpstreamForRework } from '../../../src/lib/office-workflow-upstream-rework';
import { isWorkflowUserInterventionActive } from '../../../src/lib/office-workflow-user-intervention';
import type {
  LangGraphPendingRework,
  LangGraphUserInterventionRequest,
} from '../../../src/lib/office-langgraph-state-types';
import {
  buildPriorDeliverablesContext,
  type PriorDeliverablesContextScope,
} from '../../../src/lib/office-workflow-prior-context';
import { workflowNodePrimaryRoleId } from '../../../src/lib/office-workflow-node';
import { mergeNodeRunLists } from '../../../src/lib/office-workflow-node-run-merge';
import {
  compileNativeLangGraphStateGraphV2,
  usesNativeLangGraphRuntimeV2,
} from './workflow-langgraph-native-compile';
import {
  compileNativeLangGraphStateGraphV3,
  usesNativeLangGraphRuntimeV3,
} from './workflow-langgraph-native-compile-v3';
import { officeLangGraphFileCheckpointer } from './office-langgraph-thread-store';
import {
  clearLangGraphWorkflowSession,
  getLangGraphWorkflowSession,
  graphResultHasInterrupt,
  langGraphThreadIdForTask,
  planUsesLangGraphCheckpointer,
  planUsesOfficeStoreCheckpointer,
  registerLangGraphWorkflowSession,
  type LangGraphWorkflowSession,
} from './workflow-langgraph-interrupt';
import {
  coordinatorProjectRoot,
  resolveCoordinatorAgentId,
  resolveCoordinatorPathContext,
} from './project-context-paths';

type RunListener = (task: OfficeTempProject) => void;

const WORKFLOW_STALL_POLL_MS = 1_000;
const WORKFLOW_ROOM_HEAL_POLL_MS = 20_000;

/** Shared in-process checkpointer (thread_id = task.id). */
const officeLangGraphCheckpointer = new MemorySaver();

const langGraphThreadId = langGraphThreadIdForTask;

async function resetLangGraphThread(taskId: string, useFileStore: boolean): Promise<void> {
  const checkpointer = useFileStore ? officeLangGraphFileCheckpointer : officeLangGraphCheckpointer;
  try {
    await checkpointer.deleteThread(langGraphThreadId(taskId));
  } catch {
    // Fresh task: no prior thread.
  }
}

type LangGraphRoute = string | typeof END | Array<string | typeof END>;

interface LangGraphWorkflowState {
  task: OfficeTempProject;
  workflow: WorkflowDefinition;
  runs: NodeRunRecord[];
  nextNodeIds: string[];
  blocked: boolean;
  failure: string | null;
  mode: NonNullable<RunTaskWorkflowOptions['mode']>;
  singleNodeId: string | null;
  pendingRework: LangGraphPendingRework | null;
  userInterventionRequest: LangGraphUserInterventionRequest | null;
}

function mergeNodeRuns(left: NodeRunRecord[], right: NodeRunRecord[]): NodeRunRecord[] {
  return mergeNodeRunLists(left, right);
}

function snapshotNodeRunsFromMap(
  runs: Map<string, NodeRunRecord>,
  nodes: WorkflowNode[],
): NodeRunRecord[] {
  return nodes.map((node) => (
    runs.get(node.id) ?? {
      nodeId: node.id,
      agentId: workflowNodePrimaryRoleId(node),
      status: 'pending' as NodeRunStatus,
    }
  ));
}

function mergedRunsForLangGraphState(
  stateRuns: NodeRunRecord[],
  localRuns: Map<string, NodeRunRecord>,
  nodes: WorkflowNode[],
): NodeRunRecord[] {
  return mergeNodeRunLists(stateRuns, snapshotNodeRunsFromMap(localRuns, nodes));
}

function langGraphReturnRuns(
  stateRuns: NodeRunRecord[],
  localRuns: Map<string, NodeRunRecord>,
  nodes: WorkflowNode[],
  task?: OfficeTempProject,
): NodeRunRecord[] {
  if (task?.nodeRuns.length) {
    return mergeNodeRunLists(stateRuns, task.nodeRuns);
  }
  return mergedRunsForLangGraphState(stateRuns, localRuns, nodes);
}

const WorkflowState = Annotation.Root({
  task: Annotation<OfficeTempProject>(),
  workflow: Annotation<WorkflowDefinition>(),
  runs: Annotation<NodeRunRecord[]>({
    reducer: mergeNodeRuns,
    default: () => [],
  }),
  nextNodeIds: Annotation<string[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  blocked: Annotation<boolean>({
    reducer: (_left, right) => right,
    default: () => false,
  }),
  failure: Annotation<string | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  mode: Annotation<NonNullable<RunTaskWorkflowOptions['mode']>>(),
  singleNodeId: Annotation<string | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  pendingRework: Annotation<LangGraphPendingRework | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  userInterventionRequest: Annotation<LangGraphUserInterventionRequest | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
});

function runsMap(runs: NodeRunRecord[]): Map<string, NodeRunRecord> {
  return new Map(runs.map((run) => [run.nodeId, { ...run }]));
}

function taskStatusForRuns(
  runs: Map<string, NodeRunRecord>,
  nodes: WorkflowNode[],
  options?: { runnerActive?: boolean; blocked?: boolean },
): TaskStatus {
  const statuses = nodes.map((node) => runs.get(node.id)?.status ?? 'pending');
  if (statuses.some((status) => status === 'running')) return 'running';
  if (
    options?.runnerActive
    && statuses.some((status) => status === 'pending')
    && !statuses.some((status) => status === 'failed')
  ) {
    return 'running';
  }
  if (statuses.every((status) => status === 'completed' || status === 'skipped')) return 'completed';
  if (statuses.some((status) => status === 'failed')) return 'failed';
  if (
    options?.blocked
    && statuses.some((status) => status === 'pending')
    && !statuses.some((status) => status === 'running')
  ) {
    return 'blocked';
  }
  return 'pending';
}

function isWorkflowComplete(runs: Map<string, NodeRunRecord>, nodes: WorkflowNode[]): boolean {
  return nodes.every((node) => {
    const status = runs.get(node.id)?.status;
    return status === 'completed' || status === 'skipped';
  });
}

/** invoke 结束后是否仍有 pending/running 节点需要续跑（非 interrupt/blocked/已完成）。 */
export function langGraphWorkflowRunNeedsContinuation(
  runs: Map<string, NodeRunRecord> | NodeRunRecord[],
  nodes: WorkflowNode[],
  options?: { blocked?: boolean },
): boolean {
  if (options?.blocked) return false;
  const runMap = runs instanceof Map ? runs : runsMap(runs);
  if (isWorkflowComplete(runMap, nodes)) return false;
  const statuses = nodes.map((node) => runMap.get(node.id)?.status ?? 'pending');
  if (statuses.some((status) => status === 'failed')) return false;
  return statuses.some((status) => status === 'pending' || status === 'running');
}

function nodeRunsFromTaskOrFresh(
  task: OfficeTempProject,
  nodes: WorkflowNode[],
  mode: NonNullable<RunTaskWorkflowOptions['mode']>,
): NodeRunRecord[] {
  if (mode === 'fresh') return freshNodeRuns(nodes);
  if (mode === 'continue') return nodeRunsForWorkflowContinue(task.nodeRuns, nodes);
  const existing = runsMap(task.nodeRuns);
  return nodes.map((node) => (
    existing.get(node.id) ?? {
      nodeId: node.id,
      agentId: workflowNodePrimaryRoleId(node),
      status: 'pending' as const,
    }
  ));
}

async function projectRootForTask(
  task: OfficeTempProject,
  group: OfficeFixedGroup,
  teamRoles: ProjectAgentRef[],
): Promise<string | undefined> {
  const coordPack = resolveCoordinatorAgentId(task, group);
  return coordPack
    ? coordinatorProjectRoot(
        await resolveCoordinatorPathContext(coordPack, teamRoles),
        task.title,
        task.id,
      )
    : undefined;
}

function priorContextForNode(params: {
  runs: Map<string, NodeRunRecord>;
  nodes: WorkflowNode[];
  roles: ProjectAgentRef[];
  nodeId: string;
  edges: WorkflowDefinition['edges'];
  projectRoot?: string;
  scope?: PriorDeliverablesContextScope;
}): string {
  return buildPriorDeliverablesContext({
    runs: params.runs,
    nodes: params.nodes,
    roles: params.roles.map((m) => ({ id: m.agentId, name: m.displayName })),
    currentNodeId: params.nodeId,
    edges: params.edges,
    projectRoot: params.projectRoot,
    scope: params.scope,
  });
}

function persistTaskProgressFactory(
  onUpdate?: RunListener,
): (task: OfficeTempProject, runs: Map<string, NodeRunRecord>, nodes: WorkflowNode[], blocked?: boolean) => Promise<OfficeTempProject> {
  return async (task, runs, nodes, blocked = false) => {
    const localNodeRuns = snapshotNodeRunsFromMap(runs, nodes);
    const latest = (await getTempProject(task.id));
    const nodeRuns = latest
      ? mergeNodeRunLists(latest.nodeRuns, localNodeRuns)
      : localNodeRuns;
    const mergedRuns = new Map(nodeRuns.map((run) => [run.nodeId, run]));
    const updated: OfficeTempProject = {
      ...task,
      status: taskStatusForRuns(mergedRuns, nodes, {
        runnerActive: true,
        blocked,
      }),
      nodeRuns,
      updatedAt: Date.now(),
    };
    const saved = await persistTempProjectProgress(updated);
    onUpdate?.(saved);
    return saved;
  };
}

async function finalizeAbortedTask(
  task: OfficeTempProject,
  runs: Map<string, NodeRunRecord>,
  nodes: WorkflowNode[],
  onUpdate?: RunListener,
): Promise<OfficeTempProject> {
  const now = Date.now();
  for (const node of nodes) {
    const run = runs.get(node.id);
    if (!run) continue;
    if (run.status === 'running' || run.status === 'pending') {
      runs.set(node.id, {
        ...run,
        status: 'failed',
        error: run.error ?? 'Aborted',
        completedAt: run.completedAt ?? now,
      });
    }
  }
  const aborted: OfficeTempProject = {
    ...task,
    status: 'aborted',
    workflowFreezeSnapshot: undefined,
    nodeRuns: nodes.map((node) => (
      runs.get(node.id) ?? {
        nodeId: node.id,
        agentId: workflowNodePrimaryRoleId(node),
        status: 'failed' as NodeRunStatus,
        error: 'Aborted',
        completedAt: now,
      }
    )),
    updatedAt: now,
  };
  const saved = await upsertTempProject(aborted);
  const { notifyRendererProjectProgressUpdate } = await import('./store');
  notifyRendererProjectProgressUpdate(saved);
  onUpdate?.(saved);
  return saved;
}

function hasFailureRollbackTrigger(
  nodeId: string,
  edges: WorkflowDefinition['edges'],
  runs: Map<string, NodeRunRecord>,
): boolean {
  return edges.some(
    (edge) =>
      edge.to === nodeId
      && (edge.when ?? 'on_success') === 'on_failure'
      && nodeRunTriggersFailureEdge(runs.get(edge.from) ?? { status: 'pending' }),
  );
}

function buildLangGraphWorkflow(params: {
  gateway: GatewayManager;
  scenario: OfficeFixedGroup;
  controller: AbortController;
  onUpdate?: RunListener;
}) {
  const persistTaskProgress = persistTaskProgressFactory(params.onUpdate);

  function syncLocalRunsFromTask(
    runs: Map<string, NodeRunRecord>,
    task: OfficeTempProject,
  ): void {
    for (const run of task.nodeRuns) {
      runs.set(run.nodeId, run);
    }
  }

  const nodeById = new Map<string, WorkflowNode>();
  const forwardOutgoing = new Map<string, string[]>();
  const failureOutgoing = new Map<string, string[]>();
  const forwardIncoming = new Map<string, string[]>();

  function edgeListFor(workflow: WorkflowDefinition): ReturnType<typeof workflowEdgeList> {
    return workflowEdgeList(workflow.nodes, workflow.edges);
  }

  const executeNodeById = (nodeId: string) => async (state: LangGraphWorkflowState) => {
    const { workflow } = state;
    const nodes = workflow.nodes;
    const node = nodeById.get(nodeId) ?? nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return {};
    const edges = edgeListFor(workflow);
    const runs = runsMap(state.runs);
    if (params.controller.signal.aborted) throw new Error('Aborted');

    const nativePlan = isLangGraphNativePlan(workflow.orchestrationPlan)
      ? workflow.orchestrationPlan
      : null;
    const useInterruptResume = nativePlan != null && usesNativeLangGraphRuntimeV3(nativePlan);

    // Legacy checkpoint: older LangGraph runs deferred upstream rework across invokes.
    if (state.pendingRework) {
      const rework = state.pendingRework;
      reopenWorkflowUpstreamForRework({
        runs,
        nodes,
        edges: workflow.edges,
        currentNodeId: rework.currentNodeId,
        predecessorNodeIds: rework.predecessorNodeIds,
        reworkReason: rework.reworkReason,
      });
      const cur = runs.get(rework.currentNodeId);
      if (cur) {
        runs.set(rework.currentNodeId, {
          ...cur,
          status: 'pending',
          edgeOutcome: undefined,
          error: rework.reworkReason.slice(0, 500) || cur.error,
          completedAt: undefined,
          summary: undefined,
          startedAt: undefined,
          outputRetryAttempts: undefined,
          completedAgentIds: undefined,
        });
      }
      let nextTask = await persistTaskProgress(state.task, runs, nodes);
      return {
        pendingRework: null,
        task: nextTask,
        runs: langGraphReturnRuns(state.runs, runs, nodes, nextTask),
      };
    }

    const existing = runs.get(node.id) ?? {
      nodeId: node.id,
      agentId: workflowNodePrimaryRoleId(node),
      status: 'pending' as const,
    };
    if (
      hasFailureRollbackTrigger(node.id, workflow.edges, runs)
      && (existing.status === 'completed' || existing.status === 'skipped')
    ) {
      reopenWorkflowNodeAndDownstream({
        runs,
        nodes,
        edges: workflow.edges,
        nodeId: node.id,
      });
    } else if (existing.status === 'completed' || existing.status === 'skipped') {
      return {};
    }
    if (
      existing.status === 'failed'
      && !(failureOutgoing.get(node.id)?.length)
      && !hasFailureRollbackTrigger(node.id, workflow.edges, runs)
    ) {
      throw new Error(existing.error ?? 'Workflow node failed');
    }

    const blockers = getIncompletePredecessorRoleIds(node.id, nodes, edges, runs);
    if (blockers.length > 0) {
      return {
        runs: mergedRunsForLangGraphState(state.runs, runs, nodes),
      };
    }

    const interventionRequest =
      state.userInterventionRequest?.nodeId === node.id
        ? state.userInterventionRequest.request
        : undefined;

    if (
      useInterruptResume
      && isWorkflowUserInterventionActive(state.task)
      && state.task.workflowUserIntervention!.activeNodeId === node.id
      && !interventionRequest
    ) {
      interrupt({
        type: 'user_intervention',
        nodeId: node.id,
        activeNodeId: state.task.workflowUserIntervention!.activeNodeId,
      });
    }

    const teamMembers = await membersForFixedGroup(params.scenario);
    const projectRoot = await projectRootForTask(state.task, params.scenario, teamMembers);
    let nextTask = state.task;

    try {
      await announceWorkflowRunnableBatch(params.gateway, params.scenario, nextTask, [node]);
    } catch (err) {
      console.warn('[office] langgraph workflow node room announcement failed:', err);
    }

    const prior = priorContextForNode({
      runs,
      nodes,
      roles: teamMembers,
      nodeId: node.id,
      edges: workflow.edges,
      projectRoot,
    });
    const directPrior = priorContextForNode({
      runs,
      nodes,
      roles: teamMembers,
      nodeId: node.id,
      edges: workflow.edges,
      projectRoot,
      scope: 'direct_predecessors',
    });

    const updated = await executeWorkflowNode(
      params.gateway,
      params.scenario,
      nextTask,
      node,
      { ...existing, status: 'pending', edgeOutcome: undefined, error: undefined, completedAt: undefined },
      workflow,
      params.controller.signal,
      async (run) => {
        runs.set(node.id, run);
        nextTask = await persistTaskProgress(nextTask, runs, nodes);
        syncLocalRunsFromTask(runs, nextTask);
      },
      prior || undefined,
      runs,
      {
        userIntervention: interventionRequest
          ? { nodeId: node.id, request: interventionRequest }
          : undefined,
      },
      undefined,
      directPrior || undefined,
    );
    runs.set(node.id, updated);

    const autoRollback = applyWorkflowAutoRollbackForNode({
      nodeId: node.id,
      nodes,
      edges: workflow.edges,
      runs,
    });
    if (autoRollback) {
      try {
        await announceAppliedWorkflowAutoRollbacks(
          params.gateway,
          params.scenario,
          nextTask,
          workflow,
          teamMembers,
          [autoRollback],
        );
      } catch (err) {
        console.warn('[office] langgraph auto rollback room announcement failed:', err);
      }
      nextTask = await persistTaskProgress(nextTask, runs, nodes);
      return {
        task: nextTask,
        runs: langGraphReturnRuns(state.runs, runs, nodes, nextTask),
      };
    }

    if (updated.status === 'failed') {
      nextTask = await persistTaskProgress(nextTask, runs, nodes);
      if ((failureOutgoing.get(node.id) ?? []).length === 0) {
        throw new Error(updated.error ?? 'Workflow node failed');
      }
      return {
        task: nextTask,
        runs: langGraphReturnRuns(state.runs, runs, nodes, nextTask),
      };
    }

    if (state.mode !== 'single') {
      const healResult = await syncWorkflowRunsFromRoomHeal(
        params.gateway,
        params.scenario,
        nextTask,
        workflow,
        nodes,
        edges,
        runs,
        teamMembers,
        teamMembers,
        async (run) => {
          runs.set(run.nodeId, run);
          nextTask = await persistTaskProgress(nextTask, runs, nodes);
          syncLocalRunsFromTask(runs, nextTask);
        },
      );

      if (healResult.sessionRedispatchNodeIds.length > 0) {
        await redispatchWorkflowNodesSessionOutputRetry(
          params.gateway,
          params.scenario,
          nextTask,
          workflow,
          nodes,
          healResult.sessionRedispatchNodeIds,
          runs,
          teamMembers,
          teamMembers,
          params.controller,
          undefined,
          async (run) => {
            runs.set(run.nodeId, run);
            nextTask = await persistTaskProgress(nextTask, runs, nodes);
            syncLocalRunsFromTask(runs, nextTask);
          },
        );
      }
    }

    nextTask = await persistTaskProgress(nextTask, runs, nodes);
    return {
      task: nextTask,
      runs: langGraphReturnRuns(state.runs, runs, nodes, nextTask),
    };
  };

  return {
    compile(workflow: WorkflowDefinition) {
      const nativePlan = isLangGraphNativePlan(workflow.orchestrationPlan)
        ? workflow.orchestrationPlan
        : null;
      if (nativePlan) {
        const normalized = normalizeLangGraphNativePlan(nativePlan);
        const useCheckpointer = planUsesLangGraphCheckpointer(normalized);
        const checkpointer = planUsesOfficeStoreCheckpointer(normalized)
          ? officeLangGraphFileCheckpointer
          : officeLangGraphCheckpointer;
        const builder = usesNativeLangGraphRuntimeV3(normalized)
          ? compileNativeLangGraphStateGraphV3({
              plan: normalized,
              executeNodeById: executeNodeById as never,
              workflowState: WorkflowState,
            })
          : usesNativeLangGraphRuntimeV2(normalized)
            ? compileNativeLangGraphStateGraphV2({
                plan: normalized,
                executeNodeById: executeNodeById as never,
                workflowState: WorkflowState,
              })
            : compileNativeLangGraphStateGraph({
                plan: normalized,
                executeNodeById,
              });
        const compileName = usesNativeLangGraphRuntimeV3(normalized)
          ? 'office-langgraph-native-v3'
          : usesNativeLangGraphRuntimeV2(normalized)
            ? 'office-langgraph-native-v2'
            : 'office-langgraph-native-plan';
        return builder.compile({
          name: compileName,
          checkpointer: useCheckpointer ? checkpointer : undefined,
        });
      }

      nodeById.clear();
      forwardOutgoing.clear();
      failureOutgoing.clear();
      forwardIncoming.clear();
      const builder = new StateGraph(WorkflowState);

      for (const node of workflow.nodes) {
        nodeById.set(node.id, node);
        builder.addNode(node.id, executeNodeById(node.id) as never);
      }

      const edges = workflowEdgeList(workflow.nodes, workflow.edges);
      for (const edge of edges) {
        const when = edge.when ?? 'on_success';
        const outMap = when === 'on_failure' ? failureOutgoing : forwardOutgoing;
        const list = outMap.get(edge.from) ?? [];
        list.push(edge.to);
        outMap.set(edge.from, list);
        if (when !== 'on_failure') {
          const incoming = forwardIncoming.get(edge.to) ?? [];
          incoming.push(edge.from);
          forwardIncoming.set(edge.to, incoming);
        }
      }

      const roots = workflow.nodes.filter((node) => !(forwardIncoming.get(node.id)?.length));
      for (const root of roots) {
        builder.addEdge(START, root.id as never);
      }

      const pathMap: Record<string, string | typeof END> = { [END]: END };
      for (const node of workflow.nodes) pathMap[node.id] = node.id;

      for (const node of workflow.nodes) {
        builder.addConditionalEdges(
          node.id as never,
          (state: LangGraphWorkflowState): LangGraphRoute => {
            if (state.mode === 'single') return END;
            const run = state.runs.find((candidate) => candidate.nodeId === node.id);
            switch (langGraphNodeRunRoute(run)) {
              case 'pending':
                return END;
              case 'failure': {
                const failureTargets = failureOutgoing.get(node.id) ?? [];
                return failureTargets.length > 0 ? failureTargets : END;
              }
              case 'halt':
                return END;
              case 'success': {
                const successTargets = forwardOutgoing.get(node.id) ?? [];
                return successTargets.length > 0 ? successTargets : END;
              }
              default:
                return END;
            }
          },
          pathMap as never,
        );
      }

      return builder.compile({
        name: 'office-workflow-langgraph',
      });
    },
  };
}

function compileNativeLangGraphStateGraph(params: {
  plan: LangGraphOrchestrationPlan;
  executeNodeById: (nodeId: string) => (state: LangGraphWorkflowState) => Promise<Partial<LangGraphWorkflowState>>;
}) {
  const { plan, executeNodeById } = params;
  const builder = new StateGraph(WorkflowState);
  const pathMap: Record<string, string | typeof END> = { [END]: END };
  for (const node of plan.nodes) pathMap[node.id] = node.id;

  for (const planNode of plan.nodes) {
    switch (planNode.kind) {
      case 'execute':
        if (planNode.officeNodeId) {
          builder.addNode(planNode.id, executeNodeById(planNode.officeNodeId) as never);
        }
        break;
      case 'fan_out':
        builder.addNode(planNode.id, (async () => ({})) as never);
        break;
      case 'fan_in':
        builder.addNode(
          planNode.id,
          (async (state: LangGraphWorkflowState) => {
            const predecessors = planFanInPredecessors(plan, planNode.id);
            for (const predGraphId of predecessors) {
              const officeId = planNodeById(plan, predGraphId)?.officeNodeId;
              if (!officeId) continue;
              const run = state.runs.find((candidate) => candidate.nodeId === officeId);
              if (!run || (run.status !== 'completed' && run.status !== 'skipped')) {
                return {};
              }
            }
            return {};
          }) as never,
        );
        break;
      case 'checkpoint':
        builder.addNode(
          planNode.id,
          (async (state: LangGraphWorkflowState) => ({ task: state.task })) as never,
        );
        break;
      default:
        break;
    }
  }

  builder.addEdge(START, plan.entry as never);

  // Route exclusively via conditional edges — never mix addEdge + addConditionalEdges on one node.
  for (const planNode of plan.nodes) {
    if (planNode.kind === 'fan_out') {
      const targets = planFanOutTargets(plan, planNode.id);
      builder.addConditionalEdges(
        planNode.id as never,
        (): LangGraphRoute => (targets.length > 0 ? targets : END),
        pathMap as never,
      );
      continue;
    }

    if (planNode.kind === 'execute' && planNode.officeNodeId) {
      const graphId = planNode.id;
      const officeId = planNode.officeNodeId;
      builder.addConditionalEdges(
        graphId as never,
        (state: LangGraphWorkflowState): LangGraphRoute => {
          if (state.mode === 'single') return END;
          const run = state.runs.find((candidate) => candidate.nodeId === officeId);
          switch (langGraphNodeRunRoute(run)) {
            case 'pending':
              return END;
            case 'failure': {
              const failureTargets = planExecuteFailureTargets(plan, graphId);
              return failureTargets.length > 0 ? failureTargets : END;
            }
            case 'halt':
              return END;
            case 'success': {
              const successTargets = planExecuteSuccessTargets(plan, graphId);
              return successTargets.length > 0 ? successTargets : END;
            }
            default:
              return END;
          }
        },
        pathMap as never,
      );
      continue;
    }

    if (planNode.kind === 'fan_in') {
      const nextTargets = planOutgoingTargets(plan, planNode.id, 'always');
      builder.addConditionalEdges(
        planNode.id as never,
        (state: LangGraphWorkflowState): LangGraphRoute => {
          const predecessors = planFanInPredecessors(plan, planNode.id);
          for (const predGraphId of predecessors) {
            const predOfficeId = planNodeById(plan, predGraphId)?.officeNodeId;
            if (!predOfficeId) continue;
            const run = state.runs.find((candidate) => candidate.nodeId === predOfficeId);
            if (!run || (run.status !== 'completed' && run.status !== 'skipped')) {
              return END;
            }
          }
          return nextTargets.length > 0 ? nextTargets : END;
        },
        pathMap as never,
      );
      continue;
    }

    if (planNode.kind === 'checkpoint') {
      const nextTargets = planOutgoingTargets(plan, planNode.id, 'always');
      builder.addConditionalEdges(
        planNode.id as never,
        (): LangGraphRoute => (nextTargets.length > 0 ? nextTargets : END),
        pathMap as never,
      );
    }
  }

  return builder;
}

function buildLangGraphInitialState(
  task: OfficeTempProject,
  workflow: WorkflowDefinition,
  mode: NonNullable<RunTaskWorkflowOptions['mode']>,
  options?: RunTaskWorkflowOptions,
): LangGraphWorkflowState {
  return {
    task,
    workflow,
    runs: task.nodeRuns,
    nextNodeIds: [],
    blocked: false,
    failure: null,
    mode,
    singleNodeId: options?.nodeId ?? null,
    pendingRework: null,
    userInterventionRequest: options?.userIntervention ?? null,
  };
}

async function finalizeLangGraphTaskFromState(
  gateway: GatewayManager,
  scenario: OfficeFixedGroup,
  result: LangGraphWorkflowState,
  nodes: WorkflowNode[],
  onUpdate?: RunListener,
  finalizeOptions?: { workflowStalled?: boolean },
): Promise<OfficeTempProject> {
  const finalRuns = runsMap(result.runs);
  const finalTask: OfficeTempProject = {
    ...result.task,
    status: taskStatusForRuns(finalRuns, nodes, {
      blocked: result.blocked || finalizeOptions?.workflowStalled,
    }),
    nodeRuns: nodes.map((node) => (
      finalRuns.get(node.id) ?? {
        nodeId: node.id,
        agentId: workflowNodePrimaryRoleId(node),
        status: 'pending' as NodeRunStatus,
      }
    )),
    updatedAt: Date.now(),
  };
  const saved = await upsertTempProject(finalTask);
  onUpdate?.(saved);

  await awaitOutstandingHandoffWatchesForTask(saved.id);

  if (saved.status === 'completed' || saved.status === 'failed') {
    try {
      await announceTaskWorkflowFinished(gateway, scenario, saved, nodes, finalRuns);
    } catch (err) {
      console.warn('[office] langgraph task workflow finish room announcement failed:', err);
    }
  }

  if (isWorkflowComplete(finalRuns, nodes)) {
    try {
      await announceTaskProjectClosure(gateway, scenario, saved, finalRuns, nodes);
    } catch (err) {
      console.warn('[office] langgraph project closure announcement failed:', err);
    }
  }

  await auditLog('task_workflow_langgraph_done', { taskId: saved.id, status: saved.status });
  return saved;
}

async function persistLangGraphInterruptTask(
  task: OfficeTempProject,
  result: LangGraphWorkflowState,
  nodes: WorkflowNode[],
  onUpdate?: RunListener,
): Promise<OfficeTempProject> {
  const finalRuns = runsMap(result.runs);
  const interrupted: OfficeTempProject = {
    ...result.task,
    status: 'blocked',
    nodeRuns: nodes.map((node) => (
      finalRuns.get(node.id) ?? {
        nodeId: node.id,
        agentId: workflowNodePrimaryRoleId(node),
        status: 'pending' as NodeRunStatus,
      }
    )),
    updatedAt: Date.now(),
  };
  const saved = await upsertTempProject(interrupted);
  onUpdate?.(saved);
  return saved;
}

type CompiledLangGraphWorkflow = ReturnType<
  ReturnType<typeof buildLangGraphWorkflow>['compile']
>;

async function invokeLangGraphWorkflowOnce(
  graph: CompiledLangGraphWorkflow,
  input: LangGraphWorkflowState | Command,
  config: Record<string, unknown>,
  graphNodeCount: number,
): Promise<LangGraphWorkflowState> {
  const invokable = graph as { invoke: (input: unknown, config: unknown) => Promise<unknown> };
  return invokable.invoke(input, {
    recursionLimit: Math.max(40, graphNodeCount * 10),
    ...config,
  }) as Promise<LangGraphWorkflowState>;
}

type LangGraphInvokeLoopParams = {
  task: OfficeTempProject;
  workflow: WorkflowDefinition;
  nodes: WorkflowNode[];
  graph: CompiledLangGraphWorkflow;
  config: Record<string, unknown>;
  graphNodeCount: number;
  useInterruptSession: boolean;
  gateway: GatewayManager;
  scenario: OfficeFixedGroup;
  controller: AbortController;
  onUpdate?: RunListener;
  initialInput: LangGraphWorkflowState | Command;
  runOptions?: RunTaskWorkflowOptions;
};

async function runLangGraphWorkflowUntilSettled(
  params: LangGraphInvokeLoopParams,
): Promise<OfficeTempProject> {
  const {
    task,
    workflow,
    nodes,
    graph,
    config,
    graphNodeCount,
    useInterruptSession,
    gateway,
    scenario,
    controller,
    onUpdate,
    initialInput,
    runOptions,
  } = params;

  const edges = workflowEdgeList(nodes, workflow.edges);
  let input: LangGraphWorkflowState | Command = initialInput;
  let idleRounds = 0;
  let lastRoomHealMs = 0;
  const workflowStalled = false;

  while (!controller.signal.aborted) {
    const stored = await getTempProject(task.id);
    if (stored && isTempProjectArchived(stored)) {
      clearLangGraphWorkflowSession(task.id);
      return stored;
    }

    const result = await invokeLangGraphWorkflowOnce(graph, input, config, graphNodeCount);

    if (graphResultHasInterrupt(result) && useInterruptSession) {
      registerLangGraphWorkflowSession({
        taskId: task.id,
        graph: graph as LangGraphWorkflowSession['graph'],
        config,
        gateway,
        scenario,
        workflow,
        onUpdate,
      });
      return persistLangGraphInterruptTask(task, result, nodes, onUpdate);
    }

    const finalRuns = runsMap(result.runs);

    if (!langGraphWorkflowRunNeedsContinuation(finalRuns, nodes, { blocked: result.blocked })) {
      clearLangGraphWorkflowSession(task.id);
      return finalizeLangGraphTaskFromState(gateway, scenario, result, nodes, onUpdate, {
        workflowStalled,
      });
    }

    const stillRunning = [...finalRuns.values()].some((run) => run.status === 'running');
    let progressMade = false;
    const nowHeal = Date.now();

    if (nowHeal - lastRoomHealMs >= WORKFLOW_ROOM_HEAL_POLL_MS) {
      lastRoomHealMs = nowHeal;
      const teamMembers = await membersForFixedGroup(scenario);
      const healResult = await syncWorkflowRunsFromRoomHeal(
        gateway,
        scenario,
        result.task,
        workflow,
        nodes,
        edges,
        finalRuns,
        teamMembers,
        teamMembers,
        async (run) => {
          finalRuns.set(run.nodeId, run);
          const updated: OfficeTempProject = {
            ...result.task,
            status: 'running',
            nodeRuns: nodes.map((node) => (
              finalRuns.get(node.id) ?? {
                nodeId: node.id,
                agentId: workflowNodePrimaryRoleId(node),
                status: 'pending' as NodeRunStatus,
              }
            )),
            updatedAt: Date.now(),
          };
          await persistTempProjectProgress(updated);
          onUpdate?.(updated);
        },
      );
      if (healResult.changed) progressMade = true;
      if (healResult.sessionRedispatchNodeIds.length > 0) {
        await redispatchWorkflowNodesSessionOutputRetry(
          gateway,
          scenario,
          result.task,
          workflow,
          nodes,
          healResult.sessionRedispatchNodeIds,
          finalRuns,
          teamMembers,
          teamMembers,
          controller,
          runOptions,
          async (run) => {
            finalRuns.set(run.nodeId, run);
            const updated: OfficeTempProject = {
              ...result.task,
              status: 'running',
              nodeRuns: nodes.map((node) => (
                finalRuns.get(node.id) ?? {
                  nodeId: node.id,
                  agentId: workflowNodePrimaryRoleId(node),
                  status: 'pending' as NodeRunStatus,
                }
              )),
              updatedAt: Date.now(),
            };
            await persistTempProjectProgress(updated);
            onUpdate?.(updated);
          },
        );
        progressMade = true;
      }
    }

    if (progressMade || stillRunning || result.pendingRework) {
      idleRounds = 0;
    } else {
      idleRounds += 1;
      const stallLimit = workflowStallIdleRoundLimit(nodes, finalRuns, WORKFLOW_STALL_POLL_MS);
      if (idleRounds > stallLimit) {
        const stallMessage = diagnoseWorkflowStall(nodes, edges, finalRuns);
        if (stallMessage) {
          for (const node of nodes) {
            const run = finalRuns.get(node.id);
            if (run?.status === 'pending') {
              finalRuns.set(node.id, {
                ...run,
                error: stallMessage.slice(0, 500),
              });
            }
          }
        }
        clearLangGraphWorkflowSession(task.id);
        return finalizeLangGraphTaskFromState(
          gateway,
          scenario,
          {
            ...result,
            runs: nodes.map((node) => (
              finalRuns.get(node.id) ?? {
                nodeId: node.id,
                agentId: workflowNodePrimaryRoleId(node),
                status: 'pending' as NodeRunStatus,
              }
            )),
          },
          nodes,
          onUpdate,
          { workflowStalled: true },
        );
      }
    }

    await new Promise((resolve) => setTimeout(resolve, WORKFLOW_STALL_POLL_MS));

    const latestTask = (await getTempProject(task.id)) ?? result.task;
    if (isTempProjectArchived(latestTask)) {
      clearLangGraphWorkflowSession(task.id);
      return latestTask;
    }

    const mergedRuns = nodes.map((node) => (
      finalRuns.get(node.id) ?? latestTask.nodeRuns.find((run) => run.nodeId === node.id) ?? {
        nodeId: node.id,
        agentId: workflowNodePrimaryRoleId(node),
        status: 'pending' as NodeRunStatus,
      }
    ));
    const continuingTask: OfficeTempProject = {
      ...latestTask,
      status: 'running',
      nodeRuns: mergedRuns,
      updatedAt: Date.now(),
    };
    await persistTempProjectProgress(continuingTask);
    onUpdate?.(continuingTask);

    input = {
      ...buildLangGraphInitialState(
        continuingTask,
        workflow,
        'continue',
        runOptions,
      ),
      pendingRework: result.pendingRework ?? null,
    };
  }

  const latestTask = (await getTempProject(task.id)) ?? task;
  return finalizeAbortedTask(latestTask, runsMap(latestTask.nodeRuns), nodes, onUpdate);
}

/** Resume an interrupted v3 LangGraph session (after user intervention Command). */
export async function continueLangGraphWorkflowAfterResume(
  gateway: GatewayManager,
  scenario: OfficeFixedGroup,
  task: OfficeTempProject,
  onUpdate?: RunListener,
  userIntervention?: LangGraphUserInterventionRequest,
): Promise<OfficeTempProject> {
  const active = getLangGraphWorkflowSession(task.id);
  if (!active) {
    return runTaskWorkflowLangGraph(gateway, scenario, task, {
      mode: 'continue',
      onUpdate,
      userIntervention,
    });
  }

  getWorkflowTaskRunController(task.id)?.abort();
  const controller = new AbortController();
  registerWorkflowTaskRun(task.id, controller);

  const nodes = active.workflow.nodes;
  const nativePlan = isLangGraphNativePlan(active.workflow.orchestrationPlan)
    ? normalizeLangGraphNativePlan(active.workflow.orchestrationPlan)
    : null;
  const graphNodeCount = nativePlan?.nodes.length ?? nodes.length;

  try {
    return await runLangGraphWorkflowUntilSettled({
      task,
      workflow: active.workflow,
      nodes,
      graph: active.graph as CompiledLangGraphWorkflow,
      config: active.config as Record<string, unknown>,
      graphNodeCount,
      useInterruptSession: true,
      gateway,
      scenario,
      controller,
      onUpdate,
      initialInput: new Command({
        resume: userIntervention?.request ?? true,
        update: {
          task,
          ...(userIntervention ? { userInterventionRequest: userIntervention } : {}),
        },
      }),
      runOptions: { mode: 'continue', onUpdate, userIntervention },
    });
  } catch (err) {
    if (controller.signal.aborted) {
      return finalizeAbortedTask(task, runsMap(task.nodeRuns), nodes, onUpdate);
    }
    throw err;
  } finally {
    if (!getLangGraphWorkflowSession(task.id)) {
      clearWorkflowTaskRun(task.id);
    }
  }
}

export async function runTaskWorkflowLangGraph(
  gateway: GatewayManager,
  scenario: OfficeFixedGroup,
  task: OfficeTempProject,
  options?: RunTaskWorkflowOptions,
): Promise<OfficeTempProject> {
  const mode = options?.mode ?? 'fresh';
  const onUpdate = options?.onUpdate;

  const { clearTaskUserAborted, claimTaskAbortClear } = await import('./task-run-abort-registry');
  const { shouldBlockOfficeLlmSend } = await import('./office-llm-send-guard');
  const { ProjectAbortQuiescingError } = await import('./project-abort-quiesce');
  if (options?.abortClearPermit !== undefined) {
    clearTaskUserAborted(task.id, { onlyIfAbortSeq: options.abortClearPermit });
  } else {
    claimTaskAbortClear(task.id);
  }
  if (shouldBlockOfficeLlmSend(task.id)) {
    throw new ProjectAbortQuiescingError(task.id);
  }

  getWorkflowTaskRunController(task.id)?.abort();
  const controller = new AbortController();
  registerWorkflowTaskRun(task.id, controller);

  const {
    projectHasNoOwnWorkflow,
    pruneNodeRunsToWorkflow,
  } = await import('../../../src/lib/office-spawned-workflow-ownership');
  const { alignNoOwnSpawnedProjectForRerun } = await import('../../../src/lib/office-task-workflow');
  if (projectHasNoOwnWorkflow(task)) {
    const aligned = alignNoOwnSpawnedProjectForRerun(task, scenario);
    if (aligned !== task) {
      task = aligned;
      await upsertTempProject({ ...task, workflowFreezeSnapshot: undefined });
    }
  }
  const teamMembers = await membersForFixedGroup(scenario);
  const bundleWorkflow = resolveActiveLangGraphWorkflow(task.langGraphWorkflowBundle);
  const baseWorkflow = bundleWorkflow?.nodes?.length
    ? bundleWorkflow
    : materializeWorkflowForProjectRun(task, scenario, teamMembers);
  let workflow = resolveWorkflowForExecution(
    syncWorkflowEdges(baseWorkflow),
    teamMembers,
  );
  if (Array.isArray(task.nodeRuns) && task.nodeRuns.length > 0) {
    const pruned = pruneNodeRunsToWorkflow(task.nodeRuns, workflow);
    if (pruned.length !== task.nodeRuns.length) {
      task = { ...task, nodeRuns: pruned, updatedAt: Date.now() };
      await upsertTempProject(task);
    }
  }
  const syncedJson = JSON.stringify(workflow);
  const taskJson = JSON.stringify(task.workflow ?? null);
  if (syncedJson !== taskJson && shouldPersistResolvedWorkflowToProject(task)) {
    task = { ...task, workflow, updatedAt: Date.now() };
    await upsertTempProject(task);
  }

  if (mode === 'fresh') {
    const nativePlanForReset = isLangGraphNativePlan(workflow.orchestrationPlan)
      ? workflow.orchestrationPlan
      : null;
    await resetLangGraphThread(
      task.id,
      nativePlanForReset != null && planUsesOfficeStoreCheckpointer(nativePlanForReset),
    );
    if (options?.clearProjectRoom) {
      await clearTaskRunArtifacts(task.id, scenario.id);
    } else {
      await resetTaskRunState(task.id, scenario.id);
    }
  }

  task = {
    ...task,
    status: mode === 'single' ? task.status : 'running',
    workflowRunId: mode === 'single' ? `run-single-langgraph-${Date.now()}` : `run-langgraph-${Date.now()}`,
    nodeRuns: nodeRunsFromTaskOrFresh(task, workflow.nodes, mode),
    updatedAt: Date.now(),
  };
  await upsertTempProject(task);
  onUpdate?.(task);

  const nodes = workflow.nodes;
  const runs = runsMap(task.nodeRuns);
  if (mode !== 'single') {
    resetUnattributedCompletedNodeRuns(runs);
    task = {
      ...task,
      nodeRuns: nodes.map((node) => (
        runs.get(node.id) ?? {
          nodeId: node.id,
          agentId: workflowNodePrimaryRoleId(node),
          status: 'pending' as NodeRunStatus,
        }
      )),
      updatedAt: Date.now(),
    };
    await upsertTempProject(task);
    if (mode === 'continue') {
      const startupRollbacks = recoverStaleCompletedFailureRollbacks({
        runs,
        nodes,
        edges: workflow.edges,
      });
      if (startupRollbacks.length > 0) {
        const teamMembers = await membersForFixedGroup(scenario);
        await announceAppliedWorkflowAutoRollbacks(
          gateway,
          scenario,
          task,
          workflow,
          teamMembers,
          startupRollbacks,
        );
        task = {
          ...task,
          nodeRuns: nodes.map((node) => (
            runs.get(node.id) ?? {
              nodeId: node.id,
              agentId: workflowNodePrimaryRoleId(node),
              status: 'pending' as NodeRunStatus,
            }
          )),
          workflowStall: undefined,
          updatedAt: Date.now(),
        };
        await upsertTempProject(task);
      }
    }
  }

  if (nodes.length === 0) {
    const failed = { ...task, status: 'failed' as const, updatedAt: Date.now() };
    await upsertTempProject(failed);
    clearWorkflowTaskRun(task.id);
    return failed;
  }

  if (mode !== 'single') {
    try {
      await announceTaskWorkflowStarted(gateway, scenario, task, nodes, mode);
    } catch (err) {
      console.warn('[office] langgraph task workflow start room announcement failed:', err);
    }
  }

  try {
    const graph = buildLangGraphWorkflow({
      gateway,
      scenario,
      controller,
      onUpdate,
    }).compile(workflow);
    const graphNodeCount = isLangGraphNativePlan(workflow.orchestrationPlan)
      ? workflow.orchestrationPlan.nodes.length
      : nodes.length;
    const nativePlan = isLangGraphNativePlan(workflow.orchestrationPlan)
      ? normalizeLangGraphNativePlan(workflow.orchestrationPlan)
      : null;
    const useCheckpointer = nativePlan != null && planUsesLangGraphCheckpointer(nativePlan);
    const useInterruptSession = nativePlan != null && usesNativeLangGraphRuntimeV3(nativePlan);
    const config = useCheckpointer
      ? { configurable: { thread_id: langGraphThreadId(task.id) } }
      : {};

    return await runLangGraphWorkflowUntilSettled({
      task,
      workflow,
      nodes,
      graph,
      config,
      graphNodeCount,
      useInterruptSession,
      gateway,
      scenario,
      controller,
      onUpdate,
      initialInput: buildLangGraphInitialState(task, workflow, mode, options),
      runOptions: options,
    });
  } catch (err) {
    const latestTask = (await getTempProject(task.id)) ?? task;
    if (controller.signal.aborted) {
      return finalizeAbortedTask(latestTask, runsMap(latestTask.nodeRuns), nodes, onUpdate);
    }
    const message = err instanceof Error ? err.message : String(err);
    const failed: OfficeTempProject = {
      ...latestTask,
      status: 'failed',
      nodeRuns: latestTask.nodeRuns.map((run) =>
        run.status === 'running'
          ? { ...run, status: 'failed' as NodeRunStatus, error: message.slice(0, 500), completedAt: Date.now() }
          : run,
      ),
      updatedAt: Date.now(),
    };
    const saved = await upsertTempProject(failed);
    onUpdate?.(saved);
    return saved;
  } finally {
    if (!getLangGraphWorkflowSession(task.id)) {
      clearWorkflowTaskRun(task.id);
    }
  }
}
