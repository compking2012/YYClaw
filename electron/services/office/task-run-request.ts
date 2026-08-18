import { canContinueTask } from '../../../src/lib/office-task-run';
import {
  materializeWorkflowForProjectRun,
  projectInheritsGroupTemplate,
} from '../../../src/lib/office-task-workflow';
import { projectMembersFromIds } from '../../../src/lib/office-project-members';
import type { OfficeFixedGroup, OfficeTempProject } from './types';
import { taskExecutionMode } from './task-execution-mode';

export type TaskRunRequestMode = 'fresh' | 'continue' | 'single';

function workflowNodesForRunValidation(
  project: OfficeTempProject,
  group?: Pick<
    OfficeFixedGroup,
    'workflow' | 'workflowOrchestrationMode' | 'workflowDescription' | 'workflowStepDrafts'
  > | null,
) {
  if (!projectInheritsGroupTemplate(project)) {
    return project.workflow?.nodes ?? [];
  }
  const members = projectMembersFromIds(project.agentIds ?? [], () => undefined);
  // Continue/rerun for no-own always materializes from the live group: terminal
  // freeze is cleared before the runner starts, so validation must not use the
  // empty-without-freeze guard from resolveEffectiveWorkflow.
  const forRerun: OfficeTempProject = {
    ...project,
    status: 'pending',
    workflowFreezeSnapshot: undefined,
  };
  return materializeWorkflowForProjectRun(forRerun, group ?? null, members).nodes;
}

/** Validates POST /projects/:id/run body; returns i18n-ready error key or null. */
export function validateTaskRunRequest(
  project: OfficeTempProject,
  mode: TaskRunRequestMode,
  nodeId?: string,
  group?: Pick<
    OfficeFixedGroup,
    'workflow' | 'workflowOrchestrationMode' | 'workflowDescription' | 'workflowStepDrafts'
  > | null,
): string | null {
  if (taskExecutionMode(project) === 'smart') {
    if (mode === 'single') return 'taskRun.smartNoSingleStep';
    if (mode === 'continue' && project.status !== 'running') return 'taskRun.smartNoContinue';
    return null;
  }
  if (mode === 'continue' && project.nodeRuns.length === 0) {
    return 'taskRun.noPriorProgress';
  }
  if (mode === 'continue' && taskExecutionMode(project) === 'workflow') {
    const nodes = workflowNodesForRunValidation(project, group);
    if (!canContinueTask(project, nodes)) {
      return 'taskRun.cannotContinue';
    }
  }
  if (mode === 'single' && !nodeId?.trim()) {
    return 'taskRun.nodeIdRequired';
  }
  return null;
}
