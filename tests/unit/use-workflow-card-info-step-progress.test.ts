/**
 * useWorkflowCardInfo must count completed steps from persisted card.stepProgress
 * when the in-memory observed run is gone (post-reload).
 */
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { WorkflowCardRef } from '@/types/workflow';
import { stepsFromTodos } from '@/stores/chat/observed-workflow';

const SESSION = 'agent:main:session-card-info';
const RUN_ID = 'obs-reload';

const card: WorkflowCardRef = {
  runId: RUN_ID,
  messageId: `wf-card-${RUN_ID}`,
  userMessageId: 'user-1',
  userText: 'trip',
  title: 'Travel Planner',
  steps: stepsFromTodos([
    { content: 'a', status: 'completed' },
    { content: 'b', status: 'in_progress' },
    { content: 'c', status: 'pending' },
    { content: 'd', status: 'pending' },
    { content: 'e', status: 'pending' },
    { content: 'f', status: 'pending' },
  ]),
  status: 'failed',
  createdAt: 1,
  source: 'observed',
  skillName: 'travel-planner',
  error: 'aborted',
  stepProgress: [
    { id: 'todo-0', status: 'completed' },
    { id: 'todo-1', status: 'failed' },
    { id: 'todo-2', status: 'pending' },
    { id: 'todo-3', status: 'pending' },
    { id: 'todo-4', status: 'pending' },
    { id: 'todo-5', status: 'pending' },
  ],
};

vi.mock('@/stores/workflow', () => ({
  useWorkflowStore: (selector: (s: { init: () => void; runs: Record<string, never> }) => unknown) =>
    selector({ init: vi.fn(), runs: {} }),
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (s: {
    observedWorkflowByRun: Record<string, never>;
    workflowStepsByRun: Record<string, never>;
    workflowCardsBySession: Record<string, WorkflowCardRef[]>;
    finalizeWorkflowCard: () => void;
  }) => unknown) =>
    selector({
      observedWorkflowByRun: {},
      workflowStepsByRun: {},
      workflowCardsBySession: { [SESSION]: [card] },
      finalizeWorkflowCard: vi.fn(),
    }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('useWorkflowCardInfo — persisted stepProgress', () => {
  it('reports failed status and done count from card.stepProgress without a live run', async () => {
    const { useWorkflowCardInfo } = await import('@/pages/Chat/useWorkflowCardInfo');
    const { result } = renderHook(() => useWorkflowCardInfo(RUN_ID));
    expect(result.current.status).toBe('failed');
    expect(result.current.total).toBe(6);
    expect(result.current.done).toBe(1);
    expect(result.current.isObserved).toBe(true);
  });
});
