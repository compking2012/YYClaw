import type { GatewayManager } from '../../gateway/manager';
import { workflowNodeRoleIds } from '../../../src/lib/office-workflow-node';
import {
  isWorkflowUserInterventionActive,
  planWorkflowUserIntervention,
  type WorkflowUserInterventionPlan,
} from '../../../src/lib/office-workflow-user-intervention';
import { workflowForProject } from './workflow-graph';
import { announceWorkflowUserIntervention } from './workflow-room-progress';
import {
  clearWorkflowTaskRun,
  getWorkflowTaskRunController,
  isWorkflowTaskRunnerActive,
} from './workflow-run-registry';
import { runOfficeProject } from './task-run';
import { upsertTempProject } from './store';
import type { OfficeExecutionMember, OfficeFixedGroup, OfficeTempProject } from './types';

export type WorkflowUserInterventionResult =
  | { applied: true; nodeId: string; nodeTitle: string; activeNodeId: string; kind: string }
  | { applied: false; reason: string };

/**
 * 应用已生成的介入计划：公示、中止 runner、从 activeNode 续跑。
 */
export async function applyWorkflowUserInterventionPlan(
  gateway: GatewayManager,
  params: {
    group: OfficeFixedGroup;
    /** @deprecated use group */
    scenario?: OfficeFixedGroup;
    project: OfficeTempProject;
    /** @deprecated use project */
    task?: OfficeTempProject;
    plan: WorkflowUserInterventionPlan;
    targetMembers: OfficeExecutionMember[];
    /** @deprecated use targetMembers */
    targetRoles?: OfficeExecutionMember[];
    userContent: string;
    coordinatorReply?: string;
  },
): Promise<WorkflowUserInterventionResult> {
  const group = params.group ?? params.scenario!;
  const project = params.project ?? params.task!;
  const targetMembers = params.targetMembers ?? params.targetRoles ?? [];

  const workflow = workflowForProject(project, group);
  const nodes = workflow.nodes;
  const activeNode = nodes.find((n) => n.id === params.plan.activeNodeId);
  if (!activeNode) {
    return { applied: false, reason: 'node_not_found' };
  }

  const updated: OfficeTempProject = {
    ...project,
    workflowUserIntervention: params.plan.intervention,
    status:
      project.status === 'completed'
      || project.status === 'failed'
      || project.status === 'aborted'
      || project.status === 'pending'
        ? 'running'
        : project.status,
    updatedAt: Date.now(),
  };
  await upsertTempProject(updated);

  try {
    await announceWorkflowUserIntervention(
      gateway,
      group,
      updated,
      activeNode,
      targetMembers,
      params.userContent,
      params.plan.downstreamNodeIds.length > 0,
      {
        kind: params.plan.kind,
        skippedTitle:
          params.plan.skippedNodeId
            ? nodes.find((n) => n.id === params.plan.skippedNodeId)?.title
            : undefined,
      },
    );
  } catch (err) {
    console.warn('[office] user intervention room announcement failed:', err);
  }

  if (isWorkflowTaskRunnerActive(updated.id)) {
    if (__ENABLE_LANGGRAPH__) {
      const { usesLangGraphInterruptResume } = await import('./workflow-langgraph-interrupt');
      if (usesLangGraphInterruptResume(updated, workflow)) {
        const { continueLangGraphWorkflowAfterResume } = await import('./workflow-langgraph-runner');
        void continueLangGraphWorkflowAfterResume(
          gateway,
          group,
          updated,
          undefined,
          {
            nodeId: params.plan.activeNodeId,
            request: params.plan.intervention.request,
          },
        ).catch((err) => {
          console.warn('[office] langgraph user intervention resume failed:', err);
        });
        return {
          applied: true,
          nodeId: params.plan.nodeId,
          nodeTitle: params.plan.nodeTitle,
          activeNodeId: params.plan.activeNodeId,
          kind: params.plan.kind,
        };
      }
    }
    getWorkflowTaskRunController(updated.id)?.abort();
    clearWorkflowTaskRun(updated.id);
  }

  void runOfficeProject(gateway, updated, group, {
    mode: 'continue',
    userIntervention: {
      nodeId: params.plan.activeNodeId,
      request: params.plan.intervention.request,
    },
  }).catch((err) => {
    console.warn('[office] user intervention workflow resume failed:', err);
  });

  return {
    applied: true,
    nodeId: params.plan.nodeId,
    nodeTitle: params.plan.nodeTitle,
    activeNodeId: params.plan.activeNodeId,
    kind: params.plan.kind,
  };
}

/**
 * @deprecated 用户 @ 成员启发式介入；Workflow 用户发言请走协调者判定。
 */
export async function applyWorkflowUserInterventionFromRoom(
  gateway: GatewayManager,
  params: {
    group: OfficeFixedGroup;
    scenario?: OfficeFixedGroup;
    project: OfficeTempProject;
    task?: OfficeTempProject;
    targetMembers: OfficeExecutionMember[];
    targetRoles?: OfficeExecutionMember[];
    userContent: string;
  },
): Promise<WorkflowUserInterventionResult> {
  const group = params.group ?? params.scenario!;
  const project = params.project ?? params.task!;
  const targetMembers = params.targetMembers ?? params.targetRoles ?? [];

  if (isWorkflowUserInterventionActive(project)) {
    const active = project.workflowUserIntervention!;
    return {
      applied: false,
      reason: `intervention_in_progress:${active.activeNodeId}`,
    };
  }

  const workflow = workflowForProject(project, group);
  const nodes = workflow.nodes;
  if (nodes.length === 0) {
    return { applied: false, reason: 'no_workflow_nodes' };
  }

  const runs = new Map((project.nodeRuns ?? []).map((r) => [r.nodeId, { ...r }]));
  const plan = planWorkflowUserIntervention({
    nodes,
    edges: workflow.edges,
    runs,
    targetRoles: targetMembers as never,
    userContent: params.userContent,
  });
  if (!plan) {
    return { applied: false, reason: 'no_node_for_role' };
  }

  const nodeRuns = nodes.map((n) => {
    const r = runs.get(n.id);
    return (
      r ?? {
        nodeId: n.id,
        agentId: workflowNodeRoleIds(n)[0] ?? n.agentId ?? '',
        status: 'pending' as const,
      }
    );
  });

  return applyWorkflowUserInterventionPlan(gateway, {
    group,
    project: { ...project, nodeRuns },
    plan,
    targetMembers,
    userContent: params.userContent,
  });
}
