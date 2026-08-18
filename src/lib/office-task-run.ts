import { workflowNodePrimaryAgentId } from '@/lib/office-workflow-node';
import { nodeRunsForWorkflowContinue } from '@/lib/office-workflow-schedule';
import type { OfficeTempProject, WorkflowNode } from '@/types/office';

export function canContinueTask(project: OfficeTempProject, workflowNodes: WorkflowNode[]): boolean {
  if (project.status === 'running' || workflowNodes.length === 0) return false;
  const runs = project.nodeRuns;
  if (runs.length === 0) return false;
  const completed = runs.filter((r) => r.status === 'completed').length;
  return completed > 0 && completed < workflowNodes.length;
}

export function canRerunFresh(project: OfficeTempProject): boolean {
  return project.status !== 'running' && project.nodeRuns.some((r) => r.status !== 'pending');
}

/** Optimistic store patch after POST /run succeeds (runner persists async). */
export function taskSnapshotAfterRunRequested(
  project: OfficeTempProject,
  options?: { mode?: 'fresh' | 'continue' | 'single' },
): OfficeTempProject {
  const mode = options?.mode ?? 'fresh';
  if (mode === 'single') {
    return { ...project, status: 'running', updatedAt: Date.now() };
  }

  const nodes = project.workflow?.nodes ?? [];
  let nodeRuns = project.nodeRuns;
  if (mode === 'fresh' && nodes.length > 0) {
    nodeRuns = nodes.map((n) => ({
      nodeId: n.id,
      agentId: workflowNodePrimaryAgentId(n),
      status: 'pending' as const,
    }));
  } else if (mode === 'continue' && nodes.length > 0) {
    nodeRuns = nodeRunsForWorkflowContinue(project.nodeRuns, nodes);
  }

  return {
    ...project,
    status: 'running',
    nodeRuns,
    workflowRunId: `run-${Date.now()}`,
    updatedAt: Date.now(),
  };
}

function nodeRunStatus(
  project: OfficeTempProject,
  nodeId: string,
): OfficeTempProject['nodeRuns'][number]['status'] {
  return project.nodeRuns.find((r) => r.nodeId === nodeId)?.status ?? 'pending';
}

/** 1-based index of the active workflow step while a project is running. */
export function runningWorkflowStepIndex(
  project: OfficeTempProject,
  workflowNodes: WorkflowNode[],
): number | null {
  if (workflowNodes.length === 0) return null;
  const active =
    project.status === 'running' || project.nodeRuns.some((r) => r.status === 'running');
  if (!active) return null;

  for (let i = 0; i < workflowNodes.length; i++) {
    if (nodeRunStatus(project, workflowNodes[i]!.id) === 'running') return i + 1;
  }
  for (let i = 0; i < workflowNodes.length; i++) {
    const st = nodeRunStatus(project, workflowNodes[i]!.id);
    if (st === 'pending' || st === 'failed') return i + 1;
  }
  return workflowNodes.length;
}
