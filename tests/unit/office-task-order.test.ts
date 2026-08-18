import { describe, expect, it } from 'vitest';
import {
  formatOfficeTaskListTitle,
  formatOfficeTaskRunnerModeLabel,
} from '@/lib/office-task-order';
import type { OfficeTask } from '@/types/office';
import { itLangGraph } from '../helpers/langgraph-flag';

function baseTask(overrides: Partial<OfficeTask> = {}): OfficeTask {
  return {
    id: 'task-1',
    scenarioId: 'scenario-1',
    title: '五子棋游戏开发2',
    description: '',
    status: 'pending',
    assignedRoleIds: [],
    nodeRuns: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('office-task-order', () => {
  it('formatOfficeTaskRunnerModeLabel maps three runner modes', () => {
    expect(formatOfficeTaskRunnerModeLabel(baseTask({ executionMode: 'smart' }))).toBe('Smart');
    expect(formatOfficeTaskRunnerModeLabel(baseTask())).toBe('DAG');
  });

  itLangGraph('formatOfficeTaskRunnerModeLabel maps LangGraph runner mode', () => {
    expect(
      formatOfficeTaskRunnerModeLabel(baseTask({ workflowEngine: 'langgraph' })),
    ).toBe('LangGraph');
  });

  itLangGraph('formatOfficeTaskListTitle appends LangGraph runner mode in parentheses', () => {
    expect(formatOfficeTaskListTitle(baseTask({ workflowEngine: 'langgraph' }))).toBe(
      '五子棋游戏开发2(LangGraph)',
    );
  });
});
