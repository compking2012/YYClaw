import type { OfficeTempProject, OfficeTaskExecutionMode, OfficeWorkflowEngine } from '@/types/office';
import { ENABLE_LANGGRAPH, isLangGraphWorkflowMode, resolveWorkflowEngineInput } from '@/lib/feature-langgraph';

/** UI-facing unified runner mode (maps to executionMode + workflowEngine). */
export type TaskRunnerMode = 'smart' | 'dag' | 'langgraph';

export function taskRunnerModeFromFields(
  executionMode: OfficeTaskExecutionMode | undefined,
  workflowEngine: OfficeWorkflowEngine | undefined,
): TaskRunnerMode {
  if (executionMode === 'smart') return 'smart';
  if (isLangGraphWorkflowMode(workflowEngine)) return 'langgraph';
  return 'dag';
}

export function taskRunnerModeFromTask(
  project: Pick<OfficeTempProject, 'executionMode' | 'workflowEngine'>,
): TaskRunnerMode {
  return taskRunnerModeFromFields(project.executionMode, project.workflowEngine);
}

export function taskRunnerModeToFields(mode: TaskRunnerMode): {
  executionMode: OfficeTaskExecutionMode;
  workflowEngine: OfficeWorkflowEngine;
} {
  if (mode === 'smart') {
    return { executionMode: 'smart', workflowEngine: 'dag' };
  }
  return {
    executionMode: 'workflow',
    workflowEngine: resolveWorkflowEngineInput('workflow', mode === 'langgraph' ? 'langgraph' : 'dag'),
  };
}

export function isWorkflowRunnerMode(mode: TaskRunnerMode): boolean {
  return mode === 'dag' || (ENABLE_LANGGRAPH && mode === 'langgraph');
}

export function availableTaskRunnerModes(): TaskRunnerMode[] {
  return ENABLE_LANGGRAPH ? ['smart', 'dag', 'langgraph'] : ['smart', 'dag'];
}
