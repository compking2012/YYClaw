import { taskRunnerModeFromTask } from '@/lib/office-task-runner-mode';
import type { OfficeTempProject } from '@/types/office';

/** 项目卡片/列表括号内的执行模式短标签。 */
export function formatOfficeTempProjectRunnerModeLabel(
  project: Pick<OfficeTempProject, 'executionMode' | 'workflowEngine'>,
): 'Smart' | 'DAG' | 'LangGraph' {
  const mode = taskRunnerModeFromTask(project);
  if (mode === 'smart') return 'Smart';
  if (mode === 'langgraph') return 'LangGraph';
  return 'DAG';
}

/** @deprecated Use formatOfficeTempProjectRunnerModeLabel */
export function formatOfficeTaskRunnerModeLabel(
  project: Pick<OfficeTempProject, 'executionMode' | 'workflowEngine'>,
): 'Smart' | 'DAG' | 'LangGraph' {
  return formatOfficeTempProjectRunnerModeLabel(project);
}

export function compareOfficeProjectsBySequence(
  a: Pick<OfficeTempProject, 'sequence' | 'createdAt'>,
  b: Pick<OfficeTempProject, 'sequence' | 'createdAt'>,
): number {
  const sa = a.sequence ?? Number.MAX_SAFE_INTEGER;
  const sb = b.sequence ?? Number.MAX_SAFE_INTEGER;
  if (sa !== sb) return sa - sb;
  return a.createdAt - b.createdAt;
}

export function sortOfficeProjectsBySequence(projects: OfficeTempProject[]): OfficeTempProject[] {
  return [...projects].sort(compareOfficeProjectsBySequence);
}

/** @deprecated Use compareOfficeProjectsBySequence */
export const compareOfficeTasksBySequence = compareOfficeProjectsBySequence;

/** @deprecated Use sortOfficeProjectsBySequence */
export function sortOfficeTasksBySequence<T extends Pick<OfficeTempProject, 'sequence' | 'createdAt'>>(
  projects: T[],
): T[] {
  return [...projects].sort((a, b) => compareOfficeProjectsBySequence(a, b));
}

/** @deprecated Use sortOfficeProjectsBySequence */
export function sortOfficeTempProjectsBySequence(projects: OfficeTempProject[]): OfficeTempProject[] {
  return sortOfficeProjectsBySequence(projects);
}

function titleWithExecutionMode(
  title: string,
  project: Pick<OfficeTempProject, 'executionMode' | 'workflowEngine'>,
): string {
  const base = title.trim();
  const mode = formatOfficeTempProjectRunnerModeLabel(project);
  return base ? `${base}(${mode})` : `(${mode})`;
}

/** 项目列表标题：项目名称(执行模式)。 */
export function formatOfficeProjectListTitle(
  project: Pick<OfficeTempProject, 'title' | 'executionMode' | 'workflowEngine'>,
): string {
  const title = project.title.trim();
  return titleWithExecutionMode(title, project);
}

/** @deprecated Use formatOfficeProjectListTitle */
export function formatOfficeTaskListTitle(
  project: Pick<OfficeTempProject, 'title' | 'executionMode' | 'workflowEngine'>,
): string {
  return formatOfficeProjectListTitle(project);
}

/** @deprecated Use formatOfficeProjectListTitle */
export function formatOfficeTempProjectListTitle(
  project: Pick<OfficeTempProject, 'title' | 'executionMode' | 'workflowEngine'>,
): string {
  return formatOfficeProjectListTitle(project);
}
