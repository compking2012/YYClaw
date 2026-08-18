/**
 * healStaleObservedWorkflows converges orphan running observed cards after
 * reload when no live ACP send is in flight.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowCardRef } from '@/types/workflow';
import { stepsFromTodos } from '@/stores/chat/observed-workflow';

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: {
    getState: () => ({ status: { state: 'running', port: 18789, connectedAt: 0 }, rpc: vi.fn() }),
  },
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: { getState: () => ({ agents: [] }) },
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: { sessions: { delete: vi.fn() } },
}));

vi.mock('@/lib/workflow-api', () => ({
  abortWorkflow: vi.fn(),
  startDynamicWorkflow: vi.fn(),
}));

vi.mock('@/lib/workflow-route', () => ({
  shouldRouteToWorkflow: () => false,
}));

vi.mock('@/stores/skill-workflow', () => ({
  useSkillWorkflowStore: {
    getState: () => ({
      listWorkflowSkills: () => [],
      getWorkflowSkill: () => undefined,
    }),
  },
}));

const WORKFLOW_CARDS_KEY = 'clawx:workflow-cards';
const SESSION = 'agent:main:session-heal-obs';

async function loadStore() {
  const { useChatStore } = await import('@/stores/chat');
  return useChatStore;
}

function card(over: Partial<WorkflowCardRef> = {}): WorkflowCardRef {
  return {
    runId: 'obs-stale',
    messageId: 'wf-card-obs-stale',
    userMessageId: 'user-1',
    userText: 'plan a trip',
    title: 'Travel Planner',
    steps: stepsFromTodos([
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
      { content: 'c', status: 'pending' },
    ]),
    status: 'running',
    createdAt: 1,
    source: 'observed',
    skillName: 'travel-planner',
    ...over,
  };
}

describe('healStaleObservedWorkflows', () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
  });

  it('no-ops while live', async () => {
    const useChatStore = await loadStore();
    useChatStore.getState().addWorkflowCard(SESSION, card());
    useChatStore.getState().healStaleObservedWorkflows(SESSION, { live: true });
    expect(useChatStore.getState().workflowCardsBySession[SESSION]?.[0]?.status).toBe('running');
  });

  it('marks incomplete orphan running cards as failed/interrupted with stepProgress', async () => {
    const useChatStore = await loadStore();
    useChatStore.getState().addWorkflowCard(SESSION, card());

    useChatStore.getState().healStaleObservedWorkflows(SESSION, {
      live: false,
      signal: {
        userMessageId: 'user-1',
        activationKey: 'user-1',
        hasPlan: true,
        todos: [
          { content: 'a', status: 'completed' },
          { content: 'b', status: 'in_progress' },
          { content: 'c', status: 'pending' },
        ],
      },
    });

    const healed = useChatStore.getState().workflowCardsBySession[SESSION]?.[0];
    expect(healed?.status).toBe('failed');
    expect(healed?.error).toBe('interrupted');
    expect(healed?.stepProgress).toEqual([
      { id: 'todo-0', status: 'completed' },
      { id: 'todo-1', status: 'failed' },
      { id: 'todo-2', status: 'pending' },
    ]);

    const persisted = JSON.parse(window.localStorage.getItem(WORKFLOW_CARDS_KEY) ?? '{}') as Record<
      string,
      WorkflowCardRef[]
    >;
    expect(persisted[SESSION]?.[0]?.stepProgress?.[0]?.status).toBe('completed');
  });

  it('finalizes as done when projected todos for the activation are all completed', async () => {
    const useChatStore = await loadStore();
    useChatStore.getState().addWorkflowCard(SESSION, card());

    useChatStore.getState().healStaleObservedWorkflows(SESSION, {
      live: false,
      signal: {
        userMessageId: 'user-1',
        activationKey: 'user-1',
        hasPlan: true,
        todos: [
          { content: 'a', status: 'completed' },
          { content: 'b', status: 'completed' },
          { content: 'c', status: 'completed' },
        ],
      },
    });

    const healed = useChatStore.getState().workflowCardsBySession[SESSION]?.[0];
    expect(healed?.status).toBe('done');
    expect(healed?.stepProgress).toEqual([
      { id: 'todo-0', status: 'completed' },
      { id: 'todo-1', status: 'completed' },
      { id: 'todo-2', status: 'completed' },
    ]);
  });

  it('persists completed stepProgress when failing an active in-memory run', async () => {
    const useChatStore = await loadStore();
    const { buildObservedRun, runFromTodos } = await import('@/stores/chat/observed-workflow');
    useChatStore.getState().addWorkflowCard(SESSION, card({ runId: 'obs-active', messageId: 'wf-active' }));
    const todos = [
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
      { content: 'c', status: 'pending' },
    ];
    const run = runFromTodos(buildObservedRun('obs-active', 'Travel Planner', 1), todos, 2);
    useChatStore.setState({
      activeObservedBySession: { [SESSION]: 'obs-active' },
      observedWorkflowByRun: { 'obs-active': run },
      workflowStepsByRun: { 'obs-active': stepsFromTodos(todos) },
      observedProgressById: {
        'obs-active': { runId: 'user-1', offset: 0, currentStepId: 'todo-1' },
      },
    });

    useChatStore.getState().failObservedWorkflow(SESSION, 'aborted');
    const failed = useChatStore.getState().workflowCardsBySession[SESSION]?.[0];
    expect(failed?.status).toBe('failed');
    expect(failed?.stepProgress).toEqual([
      { id: 'todo-0', status: 'completed' },
      { id: 'todo-1', status: 'failed' },
      { id: 'todo-2', status: 'pending' },
    ]);
  });
});
