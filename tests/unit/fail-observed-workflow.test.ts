/**
 * failObservedWorkflow must finalize orphan running observed cards even when
 * `activeObservedBySession` is empty, and must always clear pending staging.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowCardRef } from '@/types/workflow';
import { buildObservedRun, runFromTodos, stepsFromTodos } from '@/stores/chat/observed-workflow';

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
const SESSION = 'agent:main:session-fail-obs';

async function loadStore() {
  const { useChatStore } = await import('@/stores/chat');
  return useChatStore;
}

function observedCard(over: Partial<WorkflowCardRef> = {}): WorkflowCardRef {
  return {
    runId: 'obs-orphan-1',
    messageId: 'wf-card-obs-orphan-1',
    userMessageId: 'user-1',
    userText: 'plan a trip',
    title: 'Travel Planner',
    steps: stepsFromTodos([
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
    ]),
    status: 'running',
    createdAt: 1,
    source: 'observed',
    skillName: 'travel-planner',
    ...over,
  };
}

describe('failObservedWorkflow — orphan + pending hardening', () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
  });

  it('finalizes running observed cards when activeObserved is already empty', async () => {
    const useChatStore = await loadStore();
    const card = observedCard();
    useChatStore.getState().addWorkflowCard(SESSION, card);

    expect(useChatStore.getState().activeObservedBySession[SESSION]).toBeUndefined();
    useChatStore.getState().failObservedWorkflow(SESSION, 'aborted');

    const cards = useChatStore.getState().workflowCardsBySession[SESSION] ?? [];
    expect(cards).toHaveLength(1);
    expect(cards[0]?.status).toBe('failed');
    expect(cards[0]?.error).toBe('aborted');

    const persisted = JSON.parse(window.localStorage.getItem(WORKFLOW_CARDS_KEY) ?? '{}') as Record<
      string,
      WorkflowCardRef[]
    >;
    expect(persisted[SESSION]?.[0]?.status).toBe('failed');
  });

  it('clears pending staging even when no cards exist', async () => {
    const useChatStore = await loadStore();
    useChatStore.setState({
      pendingObservedSkillBySession: {
        [SESSION]: {
          skillName: 'travel-planner',
          title: 'Travel Planner',
          userMessageId: 'user-1',
          userText: 'go',
        },
      },
    });

    useChatStore.getState().failObservedWorkflow(SESSION, 'aborted');
    expect(useChatStore.getState().pendingObservedSkillBySession[SESSION]).toBeUndefined();
  });

  it('fails the active run and every other running observed card in the session', async () => {
    const useChatStore = await loadStore();
    const active = observedCard({ runId: 'obs-active', messageId: 'wf-card-obs-active' });
    const orphan = observedCard({ runId: 'obs-orphan', messageId: 'wf-card-obs-orphan', userMessageId: 'user-0' });
    useChatStore.getState().addWorkflowCard(SESSION, active);
    useChatStore.getState().addWorkflowCard(SESSION, orphan);

    const now = Date.now();
    const todos = [
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
    ];
    const run = runFromTodos(buildObservedRun(active.runId, active.title, now), todos, now);
    useChatStore.setState({
      activeObservedBySession: { [SESSION]: active.runId },
      observedWorkflowByRun: { [active.runId]: run },
      workflowStepsByRun: { [active.runId]: stepsFromTodos(todos) },
      observedProgressById: {
        [active.runId]: { runId: 'activation', offset: 0, currentStepId: 'todo-1' },
      },
    });

    useChatStore.getState().failObservedWorkflow(SESSION, 'aborted');

    const state = useChatStore.getState();
    expect(state.activeObservedBySession[SESSION]).toBeUndefined();
    expect(state.observedProgressById[active.runId]).toBeUndefined();
    expect(state.observedWorkflowByRun[active.runId]?.status).toBe('failed');
    expect(state.workflowCardsBySession[SESSION]?.map((c) => c.status)).toEqual(['failed', 'failed']);
  });

  it('does not clobber an already-terminal observed card', async () => {
    const useChatStore = await loadStore();
    useChatStore.getState().addWorkflowCard(
      SESSION,
      observedCard({ status: 'done', runId: 'obs-done', messageId: 'wf-card-obs-done' }),
    );

    useChatStore.getState().failObservedWorkflow(SESSION, 'aborted');
    expect(useChatStore.getState().workflowCardsBySession[SESSION]?.[0]?.status).toBe('done');
  });
});
