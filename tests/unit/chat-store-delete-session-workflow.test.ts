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

  it('returns cleanup warnings without retaining a successfully deleted session', async () => {
    sessionsDeleteMock.mockResolvedValue({ success: true, warnings: ['snapshot locked'] });
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({ currentSessionKey: OTHER, sessions: [{ key: SESSION }, { key: OTHER }] });

    await expect(useChatStore.getState().deleteSession(SESSION)).resolves.toEqual({ success: true, warnings: ['snapshot locked'] });
    expect(useChatStore.getState().sessions.some((session) => session.key === SESSION)).toBe(false);
  });

  it('keeps successful bulk deletes separate from cleanup warnings', async () => {
    sessionsDeleteMock.mockResolvedValue({ success: true, warnings: ['child locked'] });
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({ currentSessionKey: OTHER, sessions: [{ key: SESSION }, { key: OTHER }] });

    await expect(useChatStore.getState().deleteSessions([SESSION])).resolves.toEqual({
      deletedKeys: [SESSION], failedKeys: [], warnings: ['child locked'],
    });
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

  it('preserves workflow cards and drafts while Main deletion is pending and after rejection', async () => {
    window.localStorage.setItem(WORKFLOW_CARDS_KEY, JSON.stringify({
      [SESSION]: [makeCard('run-pending', 'running')],
    }));
    let rejectDeletion!: (error: Error) => void;
    sessionsDeleteMock.mockReturnValue(new Promise((_, reject) => { rejectDeletion = reject; }));
    const { useChatStore } = await import('@/stores/chat');
    const { useComposerDraftStore } = await import('@/stores/composer-drafts');
    const loadSessions = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({
      currentSessionKey: OTHER,
      sessions: [{ key: SESSION }, { key: OTHER }],
      sessionLabels: { [SESSION]: 'Keep this label' },
      workflowRunBySession: { [SESSION]: 'run-pending' },
      loadSessions,
    });
    useComposerDraftStore.getState().setDraft(SESSION, 'Keep this draft');
    const deleting = useChatStore.getState().deleteSession(SESSION);
    await vi.waitFor(() => expect(sessionsDeleteMock).toHaveBeenCalled());
    expect(abortWorkflowMock).toHaveBeenCalledWith('run-pending');
    expect(abortWorkflowMock.mock.invocationCallOrder[0]).toBeLessThan(sessionsDeleteMock.mock.invocationCallOrder[0]);
    expect(useChatStore.getState().workflowCardsBySession[SESSION]).toHaveLength(1);
    expect(useChatStore.getState().workflowRunBySession[SESSION]).toBe('run-pending');
    expect(useComposerDraftStore.getState().drafts[SESSION]).toBe('Keep this draft');
    rejectDeletion(new Error('locked'));
    await expect(deleting).resolves.toEqual({ success: false, error: 'Error: locked' });
    expect(useChatStore.getState().workflowCardsBySession[SESSION]).toHaveLength(1);
    expect(useChatStore.getState().sessionLabels[SESSION]).toBe('Keep this label');
    expect(useComposerDraftStore.getState().drafts[SESSION]).toBe('Keep this draft');
    expect(JSON.parse(window.localStorage.getItem(WORKFLOW_CARDS_KEY) ?? '{}')[SESSION]).toHaveLength(1);
  });

  it('cleans only confirmed successful workflow sessions during bulk deletion', async () => {
    window.localStorage.setItem(WORKFLOW_CARDS_KEY, JSON.stringify({
      [SESSION]: [makeCard('run-success', 'running')],
      [OTHER]: [makeCard('run-failed', 'running')],
    }));
    sessionsDeleteMock.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: false, error: 'locked' });
    const { useChatStore } = await import('@/stores/chat');
    const { useComposerDraftStore } = await import('@/stores/composer-drafts');
    useChatStore.setState({
      currentSessionKey: 'agent:main:unrelated',
      sessions: [{ key: SESSION }, { key: OTHER }, { key: 'agent:main:unrelated' }],
      workflowRunBySession: { [SESSION]: 'run-success', [OTHER]: 'run-failed' },
      loadSessions: vi.fn().mockResolvedValue(undefined),
    });
    useComposerDraftStore.getState().setDraft(SESSION, 'Remove me');
    useComposerDraftStore.getState().setDraft(OTHER, 'Keep me');
    await expect(useChatStore.getState().deleteSessions([SESSION, OTHER, SESSION])).resolves.toEqual({
      deletedKeys: [SESSION], failedKeys: [OTHER],
    });
    expect(sessionsDeleteMock).toHaveBeenCalledWith(SESSION, ['run-success']);
    expect(sessionsDeleteMock).toHaveBeenCalledWith(OTHER, ['run-failed']);
    expect(useChatStore.getState().workflowCardsBySession[SESSION]).toBeUndefined();
    expect(useChatStore.getState().workflowCardsBySession[OTHER]).toHaveLength(1);
    expect(useComposerDraftStore.getState().drafts[SESSION]).toBeUndefined();
    expect(useComposerDraftStore.getState().drafts[OTHER]).toBe('Keep me');
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


describe('chat session deletion and agent catalog cleanup', () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
    agentsState.agents = [];
    gatewayRpcMock.mockReset();
    sessionsDeleteMock.mockReset().mockResolvedValue({ success: true });
    abortWorkflowMock.mockReset().mockResolvedValue(null);
  });

  it('forgets all sessions and renderer state after an agent is deleted', async () => {
    const deletedMain = 'agent:test1:main';
    const deletedChat = 'agent:test1:session-123';
    const similarlyNamed = 'agent:test10:main';
    const survivingMain = 'agent:main:main';
    const { useChatStore } = await import('@/stores/chat');
    const { useComposerDraftStore } = await import('@/stores/composer-drafts');
    const { useSessionAttentionStore } = await import('@/stores/session-attention');
    useChatStore.setState({
      currentSessionKey: deletedChat,
      currentAgentId: 'test1',
      sessions: [
        { key: deletedMain },
        { key: deletedChat },
        { key: similarlyNamed },
        { key: survivingMain },
      ],
      sessionLabels: {
        [deletedMain]: 'Deleted main',
        [deletedChat]: 'Deleted chat',
        [similarlyNamed]: 'Similar agent',
        [survivingMain]: 'Main',
      },
      sessionLastActivity: {
        [deletedMain]: 1,
        [deletedChat]: 2,
        [similarlyNamed]: 3,
        [survivingMain]: 4,
      },
    });
    useComposerDraftStore.getState().setDraft(deletedChat, 'unsent');
    useSessionAttentionStore.setState({
      bySessionKey: { [deletedChat]: { observedBusy: false, unread: true } },
      visibleSessionKey: null,
    });

    useChatStore.getState().removeAgentSessions('test1');

    expect(useChatStore.getState()).toMatchObject({
      currentSessionKey: similarlyNamed,
      currentAgentId: 'test10',
      sessions: [{ key: similarlyNamed }, { key: survivingMain }],
      sessionLabels: {
        [similarlyNamed]: 'Similar agent',
        [survivingMain]: 'Main',
      },
      sessionLastActivity: {
        [similarlyNamed]: 3,
        [survivingMain]: 4,
      },
    });
    expect(useComposerDraftStore.getState().drafts[deletedChat]).toBeUndefined();
    expect(useSessionAttentionStore.getState().bySessionKey[deletedChat]).toBeUndefined();

    useChatStore.getState().handleSessionsChanged({
      sessionKey: deletedChat,
      session: { key: deletedChat, derivedTitle: 'Delayed deleted-agent event' },
      ts: 10,
    });
    expect(useChatStore.getState().sessions.some((session) => session.key === deletedChat)).toBe(false);

    useChatStore.getState().reconcileAgentSessionTombstones(['test1']);
    useChatStore.getState().handleSessionsChanged({
      sessionKey: deletedChat,
      session: { key: deletedChat, derivedTitle: 'Recreated agent conversation' },
      ts: 11,
    });
    expect(useChatStore.getState().sessions).toContainEqual(expect.objectContaining({
      key: deletedChat,
      derivedTitle: 'Recreated agent conversation',
    }));
  });

  it('returns to the main-agent entry without fabricating a session after agent deletion', async () => {
    const deletedChat = 'agent:test1:session-123';
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: deletedChat,
      currentAgentId: 'test1',
      sessions: [{ key: deletedChat }],
      sessionLabels: { [deletedChat]: 'Deleted chat' },
      sessionLastActivity: { [deletedChat]: 1 },
    });

    useChatStore.getState().removeAgentSessions('test1');

    const state = useChatStore.getState();
    expect(state.currentAgentId).toBe('main');
    expect(state.currentSessionKey).toBe('agent:main:main');
    expect(state.sessions).toEqual([]);
  });

  it('cleans persisted attention after a successful hard delete', async () => {
    const deletedKey = 'agent:main:delete-me';
    const { useChatStore } = await import('@/stores/chat');
    const { useSessionAttentionStore } = await import('@/stores/session-attention');
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      sessions: [{ key: 'agent:main:main' }, { key: deletedKey }],
    });
    useSessionAttentionStore.setState({
      bySessionKey: { [deletedKey]: { observedBusy: false, unread: true } },
      visibleSessionKey: null,
    });

    await expect(useChatStore.getState().deleteSession(deletedKey)).resolves.toEqual({ success: true });

    expect(useSessionAttentionStore.getState().bySessionKey[deletedKey]).toBeUndefined();
    expect(window.localStorage.getItem('clawx.session-attention')).not.toContain(deletedKey);
  });

  it('deletes an exact parent session without cascading to its native subagent child', async () => {
    const parentKey = 'agent:main:parent';
    const childKey = 'agent:main:subagent:child-1';
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:survivor',
      sessions: [
        { key: parentKey },
        { key: childKey },
        { key: 'agent:main:survivor' },
      ],
      sessionLabels: {
        [parentKey]: 'Parent',
        [childKey]: 'Child',
      },
      sessionLastActivity: {},
    });

    await expect(useChatStore.getState().deleteSession(parentKey)).resolves.toEqual({ success: true });

    expect(sessionsDeleteMock).toHaveBeenCalledTimes(1);
    expect(sessionsDeleteMock).toHaveBeenCalledWith(parentKey, undefined);
    expect(useChatStore.getState().sessions).toContainEqual({ key: childKey });
    expect(useChatStore.getState().sessionLabels[childKey]).toBe('Child');
  });

  it('keeps an explicitly selected native child selected when its parent is deleted', async () => {
    const parentKey = 'agent:main:parent';
    const childKey = 'agent:main:subagent:child-1';
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: childKey,
      currentAgentId: 'main',
      sessions: [
        { key: parentKey },
        { key: childKey },
        { key: 'agent:main:survivor' },
      ],
      sessionLabels: {},
      sessionLastActivity: {},
    });

    await expect(useChatStore.getState().deleteSession(parentKey)).resolves.toEqual({ success: true });

    expect(useChatStore.getState().currentSessionKey).toBe(childKey);
    expect(useChatStore.getState().sessions.map((session) => session.key)).toEqual([
      childKey,
      'agent:main:survivor',
    ]);
  });

  it('does not select a hidden native child when deleting the current parent', async () => {
    const parentKey = 'agent:main:parent';
    const childKey = 'agent:main:subagent:newest-child';
    const survivorKey = 'agent:main:visible-survivor';
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: parentKey,
      currentAgentId: 'main',
      sessions: [
        { key: parentKey, updatedAt: 10 },
        { key: childKey, updatedAt: 1_000 },
        { key: survivorKey, updatedAt: 100 },
      ],
      sessionLabels: {},
      sessionLastActivity: {},
    });

    await expect(useChatStore.getState().deleteSession(parentKey)).resolves.toEqual({ success: true });

    expect(useChatStore.getState().currentSessionKey).toBe(survivorKey);
    expect(useChatStore.getState().sessions).toContainEqual({ key: childKey, updatedAt: 1_000 });
  });

  it('retains session state when a single hard delete reports failure', async () => {
    const key = 'agent:main:delete-failed';
    sessionsDeleteMock.mockResolvedValueOnce({ success: false, error: 'locked' });
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: key,
      currentAgentId: 'main',
      sessions: [{ key, workspacePath: '/workspace' }],
      sessionLabels: { [key]: 'Keep me' },
      sessionLastActivity: { [key]: 123 },
    });

    await expect(useChatStore.getState().deleteSession(key)).resolves.toEqual({
      success: false,
      error: 'locked',
    });
    expect(useChatStore.getState()).toMatchObject({
      currentSessionKey: key,
      currentAgentId: 'main',
      sessions: [{ key, workspacePath: '/workspace' }],
      sessionLabels: { [key]: 'Keep me' },
      sessionLastActivity: { [key]: 123 },
    });
  });

  it('retains session state when a single hard delete throws', async () => {
    const key = 'agent:research:delete-threw';
    sessionsDeleteMock.mockRejectedValueOnce(new Error('offline'));
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: key,
      currentAgentId: 'research',
      sessions: [{ key }],
      sessionLabels: { [key]: 'Keep me too' },
      sessionLastActivity: { [key]: 456 },
    });

    await expect(useChatStore.getState().deleteSession(key)).resolves.toEqual({
      success: false,
      error: 'Error: offline',
    });
    expect(useChatStore.getState()).toMatchObject({
      currentSessionKey: key,
      currentAgentId: 'research',
      sessions: [{ key }],
      sessionLabels: { [key]: 'Keep me too' },
      sessionLastActivity: { [key]: 456 },
    });
  });
});
