import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { GatewayManager } from '../../gateway/manager';
import { expandPath } from '../../utils/paths';
import { taskWorkflowEngine } from '@/lib/office-workflow-engine';
import {
  deriveWorkflowExecutionPhase,
  isUserCheckpointEnabled,
  isWorkflowReviewActive,
  settleReviewBatch,
  submitReviewDecision,
  type ValidateEditedPathsFn,
} from '../../../src/lib/office-workflow-user-checkpoint';
import { isUnderRoleScopedDeliverableDir, roleScopedDeliverableDirName } from '../../../src/lib/office-project-file-naming';
import { normalizeDeliverablePathForDisk } from '../../../src/lib/office-deliverable-disk-resolve';
import { workflowForProject } from './workflow-graph';
import { getTempProject, upsertTempProject } from './store';
import { runOfficeProject } from './task-run';
import { resolveRecordedProjectRoot } from './project-context-paths';
import { isWorkflowTaskRunnerActive } from './workflow-run-registry';
import type {
  NodeRunRecord,
  OfficeFixedGroup,
  OfficeTempProject,
  WorkflowReviewAction,
} from './types';

export type WorkflowReviewStatus = {
  enabled: boolean;
  phase: ReturnType<typeof deriveWorkflowExecutionPhase>;
  batch: OfficeTempProject['workflowReviewBatch'];
};

function runsMapFromProject(project: OfficeTempProject): Map<string, NodeRunRecord> {
  return new Map(project.nodeRuns.map((r) => [r.nodeId, r]));
}

function buildEditedPathsExist(projectRoot: string | null): ValidateEditedPathsFn {
  if (!projectRoot) return () => false;
  const expandedRoot = expandPath(projectRoot);
  return (paths, roleNames) => {
    for (const raw of paths) {
      const rel = normalizeDeliverablePathForDisk(raw);
      if (!rel) return false;
      if (roleNames.length > 0) {
        const underRole = roleNames.some((role) => isUnderRoleScopedDeliverableDir(rel, role));
        if (!underRole) return false;
      }
      const atRoot = join(expandedRoot, rel);
      if (existsSync(atRoot)) continue;
      const roleHit = roleNames.some((role) => {
        const roleDir = roleScopedDeliverableDirName(role);
        return existsSync(join(expandedRoot, roleDir, rel));
      });
      if (!roleHit) return false;
    }
    return true;
  };
}

export function getWorkflowReviewStatus(project: OfficeTempProject): WorkflowReviewStatus {
  return {
    enabled: isUserCheckpointEnabled(),
    phase: deriveWorkflowExecutionPhase(project),
    batch: project.workflowReviewBatch,
  };
}

export async function submitWorkflowReviewDecision(
  gateway: GatewayManager,
  project: OfficeTempProject,
  group: OfficeFixedGroup,
  nodeId: string,
  decision: WorkflowReviewAction,
  expectedBatchUpdatedAt: number,
): Promise<{ project: OfficeTempProject; error?: string; settled?: boolean }> {
  if (!isUserCheckpointEnabled()) {
    return { project, error: 'user_checkpoint_disabled' };
  }
  if (taskWorkflowEngine(project) === 'langgraph') {
    return { project, error: 'langgraph_not_supported' };
  }
  if (!Number.isFinite(expectedBatchUpdatedAt)) {
    return { project, error: 'batch_updated_at_required' };
  }

  const fresh = await getTempProject(project.id);
  if (!fresh) {
    return { project, error: 'project_not_found' };
  }
  if (!isWorkflowReviewActive(fresh)) {
    return { project: fresh, error: 'review_batch_missing' };
  }

  const workflow = workflowForProject(fresh, group);
  const runs = runsMapFromProject(fresh);
  const projectRoot = await resolveRecordedProjectRoot(fresh);
  const pathsExist = buildEditedPathsExist(projectRoot);
  const result = submitReviewDecision({
    task: fresh,
    nodes: workflow.nodes,
    edges: workflow.edges,
    nodeId,
    decision,
    runs,
    pathsExist,
    expectedBatchUpdatedAt,
  });
  if (result.error) {
    return { project: fresh, error: result.error };
  }

  let updated: OfficeTempProject = {
    ...result.task,
    nodeRuns:
      result.settled && result.task.nodeRuns.length > 0
        ? result.task.nodeRuns
        : fresh.nodeRuns,
    status: 'running',
    updatedAt: Date.now(),
  };
  await upsertTempProject(updated);

  if (result.settled) {
    const settledRuns = runsMapFromProject(result.task);
    const iv = result.task.workflowUserIntervention;
    updated = await continueWorkflowAfterReviewSettle(
      gateway,
      updated,
      group,
      settledRuns,
      iv
        ? {
            activeNodeId: iv.activeNodeId,
            request: iv.request,
          }
        : undefined,
    );
  }

  return { project: updated, settled: result.settled };
}

export async function settleWorkflowReviewBatch(
  gateway: GatewayManager,
  project: OfficeTempProject,
  group: OfficeFixedGroup,
  expectedSettleGeneration: number,
): Promise<{ project: OfficeTempProject; error?: string }> {
  if (!isUserCheckpointEnabled()) {
    return { project, error: 'user_checkpoint_disabled' };
  }
  if (taskWorkflowEngine(project) === 'langgraph') {
    return { project, error: 'langgraph_not_supported' };
  }
  if (!Number.isFinite(expectedSettleGeneration)) {
    return { project, error: 'settle_generation_required' };
  }

  const fresh = await getTempProject(project.id);
  if (!fresh) {
    return { project, error: 'project_not_found' };
  }
  const batch = fresh.workflowReviewBatch;
  if (!batch || batch.phase !== 'ready_to_settle') {
    return { project: fresh, error: 'review_not_ready_to_settle' };
  }

  const workflow = workflowForProject(fresh, group);
  const runs = runsMapFromProject(fresh);
  const settled = settleReviewBatch({
    task: fresh,
    nodes: workflow.nodes,
    edges: workflow.edges,
    runs,
    expectedSettleGeneration,
  });
  if (settled.error) {
    return { project: fresh, error: settled.error };
  }

  let updated: OfficeTempProject = {
    ...settled.task,
    nodeRuns: workflow.nodes.map((n) => settled.runs.get(n.id) ?? runs.get(n.id)!),
    status: 'running',
    updatedAt: Date.now(),
  };
  await upsertTempProject(updated);

  if (settled.needsContinue) {
    updated = await continueWorkflowAfterReviewSettle(
      gateway,
      updated,
      group,
      settled.runs,
      settled.intervention
        ? {
            activeNodeId: settled.intervention.activeNodeId,
            request: settled.intervention.request,
          }
        : undefined,
    );
  }

  return { project: updated };
}

async function continueWorkflowAfterReviewSettle(
  gateway: GatewayManager,
  project: OfficeTempProject,
  group: OfficeFixedGroup,
  runs: Map<string, NodeRunRecord>,
  intervention?: { activeNodeId: string; request: string },
): Promise<OfficeTempProject> {
  const fresh = await getTempProject(project.id);
  const base = fresh ?? project;
  const workflow = workflowForProject(base, group);
  const merged: OfficeTempProject = {
    ...base,
    nodeRuns: workflow.nodes.map((n) => runs.get(n.id) ?? base.nodeRuns.find((r) => r.nodeId === n.id)!),
    status: 'running',
    workflowUserIntervention: intervention
      ? {
          activeNodeId: intervention.activeNodeId,
          request: intervention.request,
          startedAt: Date.now(),
          kind: 'redo',
        }
      : base.workflowUserIntervention,
    updatedAt: Date.now(),
  };
  await upsertTempProject(merged);
  if (isWorkflowTaskRunnerActive(merged.id)) {
    return merged;
  }
  void runOfficeProject(gateway, merged, group, {
    mode: 'continue',
    ...(intervention
      ? {
          userIntervention: {
            nodeId: intervention.activeNodeId,
            request: intervention.request,
          },
        }
      : {}),
  }).catch((err) => {
    console.warn('[office] review settle continue run failed:', err);
  });
  return merged;
}
