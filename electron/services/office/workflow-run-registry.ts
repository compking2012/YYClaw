import { isTaskUserAborted } from './task-run-abort-registry';

const activeRuns = new Map<string, AbortController>();

export function registerWorkflowTaskRun(taskId: string, controller: AbortController): void {
  activeRuns.get(taskId)?.abort();
  activeRuns.set(taskId, controller);
}

export function clearWorkflowTaskRun(taskId: string): void {
  activeRuns.delete(taskId);
}

export function getWorkflowTaskRunController(taskId: string): AbortController | undefined {
  return activeRuns.get(taskId);
}

export function isWorkflowTaskRunnerActive(taskId: string): boolean {
  return activeRuns.has(taskId) && !isTaskUserAborted(taskId);
}
