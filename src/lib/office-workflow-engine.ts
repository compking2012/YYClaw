import type { OfficeTempProject, OfficeWorkflowEngine } from '@/types/office';
import {
  LANGGRAPH_DISABLED_RUN_ERROR,
  resolveWorkflowEngineInput,
} from '@/lib/feature-langgraph';

export { LANGGRAPH_DISABLED_RUN_ERROR };

export function taskWorkflowEngine(
  project: Pick<OfficeTempProject, 'executionMode' | 'workflowEngine'>,
): OfficeWorkflowEngine {
  const executionMode = project.executionMode === 'smart' ? 'smart' : 'workflow';
  return resolveWorkflowEngineInput(executionMode, project.workflowEngine);
}

/** Raw persisted workflow engine (ignores compile flag). */
export function taskStoredWorkflowEngine(
  project: Pick<OfficeTempProject, 'executionMode' | 'workflowEngine'>,
): OfficeWorkflowEngine {
  if (project.executionMode === 'smart') return 'dag';
  return project.workflowEngine === 'langgraph' ? 'langgraph' : 'dag';
}

export function isLangGraphWorkflowTask(
  project: Pick<OfficeTempProject, 'executionMode' | 'workflowEngine'>,
): boolean {
  return taskStoredWorkflowEngine(project) === 'langgraph';
}
