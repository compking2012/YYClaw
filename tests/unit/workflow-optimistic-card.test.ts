/**
 * Tests for engine (single-agent) auto-workflow routing feedback.
 *
 * The ACP engine turn sends NO ACP prompt, so on send three things must happen
 * synchronously: the session is revealed (sidebar row), a PROVISIONAL card
 * carrying only `userText` is inserted so the query bubble shows immediately
 * (its compact link stays hidden while `pending`), and `workflowRoutingSessionKey`
 * is flagged so the composer shows its normal "思考中" indicator. On resolution
 * the provisional card is promoted in place to the real run; on any fall-through
 * it is removed and the turn runs as a normal ACP prompt. Provisional cards are
 * never persisted. These tests drive the store directly.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { startDynamicWorkflowMock, listWorkflowSkillsMock, getWorkflowSkillMock, shouldRouteMock } = vi.hoisted(() => ({
  startDynamicWorkflowMock: vi.fn(),
  listWorkflowSkillsMock: vi.fn(() => []),
  getWorkflowSkillMock: vi.fn(() => undefined),
  shouldRouteMock: vi.fn(() => true),
}));

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
  startDynamicWorkflow: (...args: unknown[]) => startDynamicWorkflowMock(...args),
}));

vi.mock('@/lib/workflow-route', () => ({
  shouldRouteToWorkflow: (...args: unknown[]) => shouldRouteMock(...args),
}));

vi.mock('@/stores/skill-workflow', () => ({
  useSkillWorkflowStore: {
    getState: () => ({
      listWorkflowSkills: listWorkflowSkillsMock,
      getWorkflowSkill: getWorkflowSkillMock,
    }),
  },
}));

const WORKFLOW_CARDS_KEY = 'clawx:workflow-cards';
const SESSION = 'agent:main:session-wf';
const MAIN = 'agent:main:main';

async function loadStore() {
  const { useChatStore } = await import('@/stores/chat');
  const { useSettingsStore } = await import('@/stores/settings');
  useSettingsStore.setState({ autoWorkflowEnabled: true });
  return useChatStore;
}

describe('routeAndMaybeStartWorkflow — provisional card + routing feedback', () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
    startDynamicWorkflowMock.mockReset();
    listWorkflowSkillsMock.mockReset();
    listWorkflowSkillsMock.mockReturnValue([]);
    getWorkflowSkillMock.mockReset();
    getWorkflowSkillMock.mockReturnValue(undefined);
    shouldRouteMock.mockReset();
    shouldRouteMock.mockReturnValue(true);
  });

  it('inserts a provisional card (query bubble, hidden link) and flags routing during decomposition', async () => {
    const useChatStore = await loadStore();
    // Never resolve — assert the synchronous pre-await state.
    startDynamicWorkflowMock.mockReturnValue(new Promise(() => {}));

    void useChatStore.getState().routeAndMaybeStartWorkflow('plan a launch', SESSION, null);

    const state = useChatStore.getState();
    expect(state.workflowRoutingSessionKey).toBe(SESSION);
    const cards = state.workflowCardsBySession[SESSION] ?? [];
    expect(cards).toHaveLength(1);
    expect(cards[0].pending).toBe(true);
    expect(cards[0].userText).toBe('plan a launch');
    expect(cards[0].source).toBe('engine');
    // A provisional card does NOT auto-open the floating panel (synthetic runId).
    expect(state.openWorkflowPopupRunId).toBeNull();
    // ...and it is never persisted.
    const persisted = JSON.parse(window.localStorage.getItem(WORKFLOW_CARDS_KEY) ?? '{}');
    expect(persisted[SESSION] ?? []).toHaveLength(0);
  });

  it('reveals a brand-new non-:main session (label + activity) synchronously', async () => {
    const useChatStore = await loadStore();
    startDynamicWorkflowMock.mockReturnValue(new Promise(() => {}));

    void useChatStore.getState().routeAndMaybeStartWorkflow('plan a launch', SESSION, null);

    const state = useChatStore.getState();
    expect(state.sessionLabels[SESSION]).toBeTruthy();
    expect(state.sessionLastActivity[SESSION]).toBeTruthy();
  });

  it('does not set a label for a :main session', async () => {
    const useChatStore = await loadStore();
    startDynamicWorkflowMock.mockReturnValue(new Promise(() => {}));

    void useChatStore.getState().routeAndMaybeStartWorkflow('plan a launch', MAIN, null);

    expect(useChatStore.getState().sessionLabels[MAIN]).toBeFalsy();
  });

  it('routed:true promotes the provisional card in place, opens the popup, clears the flag, and persists', async () => {
    const useChatStore = await loadStore();
    startDynamicWorkflowMock.mockResolvedValue({
      routed: true,
      runId: 'run-real',
      title: 'Real workflow',
      steps: [{ id: 's1', title: 'A', kind: 'model' }],
      run: { runId: 'run-real', status: 'running' },
    });

    const result = await useChatStore.getState().routeAndMaybeStartWorkflow('build me a multi-step plan', SESSION, null);

    expect(result).toBe(true);
    const state = useChatStore.getState();
    const cards = state.workflowCardsBySession[SESSION];
    expect(cards).toHaveLength(1);
    expect(cards[0].runId).toBe('run-real');
    expect(cards[0].pending).toBe(false);
    // The identity fields carry over from the provisional card (in-place swap).
    expect(cards[0].userText).toBe('build me a multi-step plan');
    expect(cards[0].messageId).toMatch(/^wf-card-wf-pending-/);
    expect(cards[0].steps).toHaveLength(1);
    // Popup auto-opens for the real run; routing flag cleared.
    expect(state.openWorkflowPopupRunId).toBe('run-real');
    expect(state.workflowRoutingSessionKey).toBeNull();
    // The promoted (non-pending) card is persisted; the synthetic runId is not.
    const persisted = JSON.parse(window.localStorage.getItem(WORKFLOW_CARDS_KEY) ?? '{}');
    expect(persisted[SESSION]).toHaveLength(1);
    expect(persisted[SESSION][0].runId).toBe('run-real');
  });

  it('routed:false removes the provisional card, clears the flag, and returns false', async () => {
    const useChatStore = await loadStore();
    startDynamicWorkflowMock.mockResolvedValue({ routed: false });

    const result = await useChatStore.getState().routeAndMaybeStartWorkflow('do a thing', SESSION, null);

    expect(result).toBe(false);
    const state = useChatStore.getState();
    expect(state.workflowCardsBySession[SESSION] ?? []).toHaveLength(0);
    expect(state.workflowRoutingSessionKey).toBeNull();
  });

  it('a thrown decomposition removes the provisional card, clears the flag, and returns false', async () => {
    const useChatStore = await loadStore();
    startDynamicWorkflowMock.mockRejectedValue(new Error('boom'));

    const result = await useChatStore.getState().routeAndMaybeStartWorkflow('do a thing', SESSION, null);

    expect(result).toBe(false);
    const state = useChatStore.getState();
    expect(state.workflowCardsBySession[SESSION] ?? []).toHaveLength(0);
    expect(state.workflowRoutingSessionKey).toBeNull();
  });

  it('routed:false + matchedSkill removes the provisional card, stages the observed skill, clears the flag', async () => {
    const useChatStore = await loadStore();
    getWorkflowSkillMock.mockReturnValue({ title: 'Deep Research', workflow: {} });
    startDynamicWorkflowMock.mockResolvedValue({ routed: false, matchedSkill: 'deep-research' });

    const result = await useChatStore.getState().routeAndMaybeStartWorkflow('research this', SESSION, null);

    expect(result).toBe(false);
    const state = useChatStore.getState();
    expect(state.workflowCardsBySession[SESSION] ?? []).toHaveLength(0);
    expect(state.pendingObservedSkillBySession[SESSION]?.skillName).toBe('deep-research');
    expect(state.workflowRoutingSessionKey).toBeNull();
  });

  it('never routes (no card, no flag) when auto-workflow is disabled', async () => {
    const useChatStore = await loadStore();
    const { useSettingsStore } = await import('@/stores/settings');
    useSettingsStore.setState({ autoWorkflowEnabled: false });

    const result = await useChatStore.getState().routeAndMaybeStartWorkflow('build a multi-step plan', SESSION, null);

    expect(result).toBe(false);
    expect(useChatStore.getState().workflowCardsBySession[SESSION] ?? []).toHaveLength(0);
    expect(useChatStore.getState().workflowRoutingSessionKey).toBeNull();
    expect(startDynamicWorkflowMock).not.toHaveBeenCalled();
  });
});
