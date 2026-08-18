/**
 * Regression tests for the "deleted session resurrects" bug.
 *
 * A session whose only activity was an inline auto-workflow has no Gateway
 * transcript; its visibility is kept alive by the workflow cards persisted in
 * localStorage (`clawx:workflow-cards`), which `loadSessions` re-injects via
 * `mergeWorkflowParentSessions`. Deleting the session therefore MUST also
 * remove those cards (and the run mapping), or the session reappears in the
 * sidebar on the next startup.
 *
 * Post v0.4.9 IPC migration the delete path goes through the typed host facade
 * (`hostApi.sessions.delete(key, workflowRunIds)`) and workflow aborts through
 * `abortWorkflow` (→ `hostApi.workflow.abort`), not the old `/api/*` HTTP routes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { gatewayRpcMock, agentsState, sessionsDeleteMock, abortWorkflowMock } = vi.hoisted(() => ({
  gatewayRpcMock: vi.fn(),
  agentsState: {
    agents: [] as Array<Record<string, unknown>>,
  },
  sessionsDeleteMock: vi.fn(),
  abortWorkflowMock: vi.fn(),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: {
    getState: () => ({
      status: { state: 'running', port: 18789, connectedAt: Date.now() },
      rpc: gatewayRpcMock,
    }),
  },
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: {
    getState: () => agentsState,
  },
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    sessions: {
      delete: (...args: unknown[]) => sessionsDeleteMock(...args),
    },
  },
}));

vi.mock('@/lib/workflow-api', () => ({
  abortWorkflow: (...args: unknown[]) => abortWorkflowMock(...args),
  startDynamicWorkflow: vi.fn(),
}));

const WORKFLOW_CARDS_KEY = 'clawx:workflow-cards';
const SESSION = 'agent:main:session-wf';
const OTHER = 'agent:main:session-other';

function makeCard(runId: string, status: 'running' | 'done' | 'failed') {
  return {
    runId,
    messageId: `msg-${runId}`,
    userMessageId: `user-${runId}`,
    userText: 'do the thing',
    title: 'Auto workflow',
    steps: [],
    status,
    createdAt: 1000,
  };
}

describe('useChatStore.deleteSession — workflow cleanup', () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
    agentsState.agents = [];
    gatewayRpcMock.mockReset();
    sessionsDeleteMock.mockReset();
    abortWorkflowMock.mockReset();
    sessionsDeleteMock.mockResolvedValue({ success: true });
    abortWorkflowMock.mockResolvedValue(null);
  });

  it('aborts running runs, clears the run mapping, and drops the persisted cards', async () => {
    window.localStorage.setItem(WORKFLOW_CARDS_KEY, JSON.stringify({
      [SESSION]: [makeCard('run-a', 'running'), makeCard('run-b', 'done')],
      [OTHER]: [makeCard('run-c', 'done')],
    }));
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: OTHER,
      currentAgentId: 'main',
      sessions: [{ key: SESSION }, { key: OTHER }],
      sessionLabels: {},
      sessionLastActivity: {},
      workflowRunBySession: { [SESSION]: 'run-a' },
    });

    await useChatStore.getState().deleteSession(SESSION);

    // Only the still-running run gets aborted.
    expect(abortWorkflowMock).toHaveBeenCalledTimes(1);
    expect(abortWorkflowMock).toHaveBeenCalledWith('run-a');

    // The delete request carries every run id tied to the session so the main
    // process can discard snapshots + child sessions.
    expect(sessionsDeleteMock).toHaveBeenCalledTimes(1);
    expect(sessionsDeleteMock).toHaveBeenCalledWith(SESSION, ['run-a', 'run-b']);

    const state = useChatStore.getState();
    expect(state.sessions.map((s) => s.key)).toEqual([OTHER]);
    expect(state.workflowCardsBySession[SESSION]).toBeUndefined();
    expect(state.workflowRunBySession[SESSION]).toBeUndefined();
    expect(state.workflowCardsBySession[OTHER]).toHaveLength(1);

    // localStorage is rewritten — this is what stops the startup re-injection.
    const persisted = JSON.parse(window.localStorage.getItem(WORKFLOW_CARDS_KEY) ?? '{}');
    expect(persisted[SESSION]).toBeUndefined();
    expect(persisted[OTHER]).toHaveLength(1);
  });

  it('a deleted session can no longer be re-injected by mergeWorkflowParentSessions', async () => {
    window.localStorage.setItem(WORKFLOW_CARDS_KEY, JSON.stringify({
      [SESSION]: [makeCard('run-z', 'done')],
    }));
    const { useChatStore } = await import('@/stores/chat');
    const { mergeWorkflowParentSessions } = await import('@/stores/chat/workflow-session-list');
    useChatStore.setState({
      currentSessionKey: OTHER,
      currentAgentId: 'main',
      sessions: [{ key: SESSION }, { key: OTHER }],
      sessionLabels: {},
      sessionLastActivity: {},
    });

    // Sanity: before the delete, the cards WOULD resurrect the session.
    expect(
      mergeWorkflowParentSessions([], useChatStore.getState().workflowCardsBySession)
        .map((s) => s.key),
    ).toEqual([SESSION]);

    await useChatStore.getState().deleteSession(SESSION);

    expect(
      mergeWorkflowParentSessions([], useChatStore.getState().workflowCardsBySession),
    ).toEqual([]);
  });

  it('a session without workflow state sends a plain delete and skips the abort call', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: OTHER,
      currentAgentId: 'main',
      sessions: [{ key: SESSION }, { key: OTHER }],
      sessionLabels: {},
      sessionLastActivity: {},
    });

    await useChatStore.getState().deleteSession(SESSION);

    expect(abortWorkflowMock).not.toHaveBeenCalled();
    expect(sessionsDeleteMock).toHaveBeenCalledTimes(1);
    expect(sessionsDeleteMock).toHaveBeenCalledWith(SESSION, undefined);
  });

  it('does not drop the session when the backend delete fails; reconciles via loadSessions', async () => {
    sessionsDeleteMock.mockResolvedValue({ success: false, error: 'boom' });
    const { useChatStore } = await import('@/stores/chat');
    const loadSessionsMock = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({
      currentSessionKey: OTHER,
      currentAgentId: 'main',
      sessions: [{ key: SESSION }, { key: OTHER }],
      sessionLabels: {},
      sessionLastActivity: {},
      // Override the action so we assert the reconcile without driving the full
      // sessions.list pipeline.
      loadSessions: loadSessionsMock,
    });

    await useChatStore.getState().deleteSession(SESSION);

    // Failure path re-syncs from the Gateway instead of optimistically dropping.
    expect(loadSessionsMock).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().sessions.map((s) => s.key)).toEqual([SESSION, OTHER]);
  });
});
