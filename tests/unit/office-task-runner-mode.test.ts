import { describe, expect, it } from 'vitest';
import {
  isWorkflowRunnerMode,
  taskRunnerModeFromFields,
  taskRunnerModeToFields,
  availableTaskRunnerModes,
} from '@/lib/office-task-runner-mode';
import { ENABLE_LANGGRAPH } from '@/lib/feature-langgraph';
import { itLangGraph } from '../helpers/langgraph-flag';

describe('office-task-runner-mode', () => {
  it('maps fields to unified runner mode', () => {
    expect(taskRunnerModeFromFields('smart', 'dag')).toBe('smart');
    expect(taskRunnerModeFromFields('workflow', 'dag')).toBe('dag');
  });

  itLangGraph('maps workflow+langgraph fields to LangGraph runner mode', () => {
    expect(taskRunnerModeFromFields('workflow', 'langgraph')).toBe('langgraph');
  });

  it('maps runner mode back to executionMode and workflowEngine', () => {
    expect(taskRunnerModeToFields('smart')).toEqual({ executionMode: 'smart', workflowEngine: 'dag' });
    expect(taskRunnerModeToFields('dag')).toEqual({ executionMode: 'workflow', workflowEngine: 'dag' });
  });

  itLangGraph('maps LangGraph runner mode back to execution fields', () => {
    expect(taskRunnerModeToFields('langgraph')).toEqual({
      executionMode: 'workflow',
      workflowEngine: 'langgraph',
    });
  });

  it('identifies workflow runner modes', () => {
    expect(isWorkflowRunnerMode('smart')).toBe(false);
    expect(isWorkflowRunnerMode('dag')).toBe(true);
  });

  itLangGraph('identifies LangGraph as workflow runner mode when enabled', () => {
    expect(isWorkflowRunnerMode('langgraph')).toBe(true);
  });

  it('lists available runner modes for the current build', () => {
    expect(availableTaskRunnerModes()).toEqual(
      ENABLE_LANGGRAPH ? ['smart', 'dag', 'langgraph'] : ['smart', 'dag'],
    );
  });
});
