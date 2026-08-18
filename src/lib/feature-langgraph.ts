export const ENABLE_LANGGRAPH: boolean = __ENABLE_LANGGRAPH__;

export const LANGGRAPH_DISABLED_RUN_ERROR =
  'LangGraph mode is not enabled in this build (set VITE_ENABLE_LANGGRAPH=true in langgraph.env and rebuild).';

export function resolveWorkflowEngineInput(
  executionMode: 'smart' | 'workflow',
  workflowEngine: 'dag' | 'langgraph' | undefined,
): 'dag' | 'langgraph' {
  if (executionMode !== 'workflow') return 'dag';
  if (ENABLE_LANGGRAPH && workflowEngine === 'langgraph') return 'langgraph';
  return 'dag';
}

/** True when compile flag is on and the caller selected LangGraph workflow mode. */
export function isLangGraphWorkflowMode(
  workflowEngine: 'dag' | 'langgraph' | undefined,
): boolean {
  return resolveWorkflowEngineInput('workflow', workflowEngine) === 'langgraph';
}
