/**
 * ingestAcpObservedWorkflow gates: live-only implicit arm, terminal wins,
 * no historical hydrate of orphan running cards, live rebind preserves runId.
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

const SESSION = 'agent:main:session-ingest-obs';

async function loadStore() {
  const { useChatStore } = await import('@/stores/chat');
  const { useSettingsStore } = await import('@/stores/settings');
  useSettingsStore.setState({ autoWorkflowEnabled: true });
  return useChatStore;
}

function signal(over: Partial<{
  activationKey: string;
  skill: { name: string; title: string } | null;
  userMessageId: string;
  userText: string;
  todos: { content: string; status: string }[];
  hasPlan: boolean;
}> = {}) {
  return {
    activationKey: 'user-1',
    skill: { name: 'travel-planner', title: 'Travel Planner' },
    userMessageId: 'user-1',
    userText: 'plan a trip',
    todos: [
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
    ],
    hasPlan: true,
    ...over,
  };
}

function card(over: Partial<WorkflowCardRef> = {}): WorkflowCardRef {
  return {
    runId: 'obs-existing',
    messageId: 'wf-card-obs-existing',
    userMessageId: 'user-1',
    userText: 'plan a trip',
    title: 'Travel Planner',
    steps: stepsFromTodos([
      { content: 'a', status: 'pending' },
      { content: 'b', status: 'pending' },
    ]),
    status: 'running',
    createdAt: 1,
    source: 'observed',
    skillName: 'travel-planner',
    ...over,
  };
}

describe('ingestAcpObservedWorkflow — live / terminal / rebind gates', () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
  });

  it('does not create a card from historical Read+plan when !live', async () => {
    const useChatStore = await loadStore();
    useChatStore.getState().ingestAcpObservedWorkflow(SESSION, signal(), { live: false });

    expect(useChatStore.getState().workflowCardsBySession[SESSION] ?? []).toHaveLength(0);
    expect(useChatStore.getState().pendingObservedSkillBySession[SESSION]).toBeUndefined();
    expect(useChatStore.getState().activeObservedBySession[SESSION]).toBeUndefined();
  });

  it('creates a card from Read+plan when live and autoWorkflow is on', async () => {
    const useChatStore = await loadStore();
    useChatStore.getState().ingestAcpObservedWorkflow(SESSION, signal(), { live: true });

    const cards = useChatStore.getState().workflowCardsBySession[SESSION] ?? [];
    expect(cards).toHaveLength(1);
    expect(cards[0]?.source).toBe('observed');
    expect(cards[0]?.status).toBe('running');
    expect(cards[0]?.userMessageId).toBe('user-1');
    expect(useChatStore.getState().activeObservedBySession[SESSION]).toBe(cards[0]?.runId);
  });

  it('does not revive a terminal card for the same activation', async () => {
    const useChatStore = await loadStore();
    useChatStore.getState().addWorkflowCard(
      SESSION,
      card({ status: 'failed', error: 'aborted', runId: 'obs-failed', messageId: 'wf-card-failed' }),
    );

    useChatStore.getState().ingestAcpObservedWorkflow(SESSION, signal(), { live: true });

    const cards = useChatStore.getState().workflowCardsBySession[SESSION] ?? [];
    expect(cards).toHaveLength(1);
    expect(cards[0]?.runId).toBe('obs-failed');
    expect(cards[0]?.status).toBe('failed');
    expect(useChatStore.getState().activeObservedBySession[SESSION]).toBeUndefined();
  });

  it('does not hydrate an orphan running card when !live', async () => {
    const useChatStore = await loadStore();
    useChatStore.getState().addWorkflowCard(SESSION, card());

    useChatStore.getState().ingestAcpObservedWorkflow(SESSION, signal(), { live: false });

    expect(useChatStore.getState().activeObservedBySession[SESSION]).toBeUndefined();
    expect(useChatStore.getState().observedWorkflowByRun['obs-existing']).toBeUndefined();
    expect(useChatStore.getState().workflowCardsBySession[SESSION]?.[0]?.status).toBe('running');
  });

  it('rebinds a live orphan to the existing runId instead of minting a new UUID', async () => {
    const useChatStore = await loadStore();
    useChatStore.getState().addWorkflowCard(SESSION, card());

    useChatStore.getState().ingestAcpObservedWorkflow(SESSION, signal(), { live: true });

    const cards = useChatStore.getState().workflowCardsBySession[SESSION] ?? [];
    expect(cards).toHaveLength(1);
    expect(cards[0]?.runId).toBe('obs-existing');
    expect(useChatStore.getState().activeObservedBySession[SESSION]).toBe('obs-existing');
    expect(useChatStore.getState().observedWorkflowByRun['obs-existing']?.status).toBe('running');
    const completed = useChatStore.getState().observedWorkflowByRun['obs-existing']?.trace
      ?.filter((t) => t.status === 'completed').length ?? 0;
    expect(completed).toBe(1);
  });

  it('allows a later activation after an earlier terminal card', async () => {
    const useChatStore = await loadStore();
    useChatStore.getState().addWorkflowCard(
      SESSION,
      card({
        status: 'failed',
        error: 'aborted',
        runId: 'obs-old',
        messageId: 'wf-card-old',
        userMessageId: 'user-1',
      }),
    );

    useChatStore.getState().ingestAcpObservedWorkflow(
      SESSION,
      signal({
        activationKey: 'user-2',
        userMessageId: 'user-2',
        userText: 'second trip',
        todos: [
          { content: 'x', status: 'pending' },
          { content: 'y', status: 'pending' },
        ],
      }),
      { live: true },
    );

    const cards = useChatStore.getState().workflowCardsBySession[SESSION] ?? [];
    expect(cards).toHaveLength(2);
    const newest = cards.find((c) => c.userMessageId === 'user-2');
    expect(newest?.status).toBe('running');
    expect(newest?.runId).not.toBe('obs-old');
  });

  it('still creates from pending staging when !live (explicit /skill path)', async () => {
    const useChatStore = await loadStore();
    useChatStore.setState({
      pendingObservedSkillBySession: {
        [SESSION]: {
          skillName: 'travel-planner',
          title: 'Travel Planner',
          userMessageId: 'user-pending',
          userText: '/travel-planner go',
        },
      },
    });

    // No skill on the signal — would not implicit-arm; pending alone arms.
    useChatStore.getState().ingestAcpObservedWorkflow(
      SESSION,
      signal({
        skill: null,
        activationKey: 'user-pending',
        userMessageId: 'user-pending',
      }),
      { live: false },
    );

    const cards = useChatStore.getState().workflowCardsBySession[SESSION] ?? [];
    expect(cards).toHaveLength(1);
    expect(cards[0]?.userMessageId).toBe('user-pending');
  });
});
