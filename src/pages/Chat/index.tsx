/**
 * Chat Page
 * ACP-native runtime rendering through the ordered inline timeline.
 */
import { Suspense, lazy, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowDownToLine, FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { DEFAULT_SESSION_KEY } from '@shared/chat/types';
import { Button } from '@/components/ui/button';
import { useAgentsStore } from '@/stores/agents';
import { useArtifactPanel } from '@/stores/artifact-panel';
import { useChatStore } from '@/stores/chat';
import { useSessionAttentionStore } from '@/stores/session-attention';
import { useSettingsStore } from '@/stores/settings';
import { ensureAcpChatSubscriptions, useAcpChatSessionStore } from '@/stores/acp-chat-session';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { cn } from '@/lib/utils';
import {
  getWorkspaceDisplayLabel,
  isDefaultWorkspacePath,
  normalizeWorkspacePath,
  resolveEffectiveWorkspace,
} from '@/lib/workspace-context';
import { useStickToBottomInstant } from '@/hooks/use-stick-to-bottom-instant';
import { getAcpUserMessageAnchorId } from '@/lib/acp/timeline-anchors';
import type { MessageSegmentItem, RenderPart } from '@/lib/acp/timeline-types';
import { createEmptyAcpTimeline } from '@/lib/acp/reducer';
import { projectOpenClawFileActivities, type AcpFileActivityProjection } from '@/lib/acp/openclaw-file-activities';
import { projectAcpObservedWorkflow } from '@/lib/acp/observed-workflow-projection';
import { useSkillWorkflowStore } from '@/stores/skill-workflow';
import { hostApi } from '@/lib/host-api';
import { getSessionDisplayTitle } from '@shared/chat/session-title';
import { ChatInput, type ChatWorkspaceOption, type FileAttachment } from './ChatInput';
import { ChatToolbar } from './ChatToolbar';
import { AcpTimelineGroup, streamingMessageSegmentIds } from './AcpTimeline';
import { AcpErrorBanner } from './AcpErrorBanner';
// Workflow lane: an INDEPENDENT, non-ACP feature. Cards come from the fork's
// persisted store + `workflow:progress` stream, never from
// `acpTimeline.itemsById`/`itemOrder`. They are interleaved into the conversation
// at RENDER time by `buildConversationBlocks` (no ACP-store mutation) so an
// engine workflow turn lands at its trigger position
// (see harness/specs/rules/workflow-lane-independence.md).
import { WorkflowTurnBlock } from './WorkflowTurnBlock';
import { buildConversationBlocks } from './workflow-timeline-merge';
import { groupAcpTimelineItems } from '@/lib/acp/timeline-groups';
import { WorkflowFloatingPanel } from './WorkflowFloatingPanel';

const ArtifactPanelLazy = lazy(() =>
  import('@/components/file-preview/ArtifactPanel').then((m) => ({ default: m.ArtifactPanel })),
);
const PanelResizeDividerLazy = lazy(() =>
  import('@/components/file-preview/PanelResizeDivider').then((m) => ({ default: m.PanelResizeDivider })),
);

const EMPTY_FILE_ACTIVITY: AcpFileActivityProjection = {
  activities: [],
  turnSummariesByTurnId: {},
  fileGroups: [],
  uniqueFileCount: 0,
};

type WorkspaceContextCheck = {
  key: string;
  available: boolean;
};

function buildQuestionDirectoryTitle(item: MessageSegmentItem, fallback: string): string {
  const markdown = item.parts.find(
    (part): part is Extract<RenderPart, { kind: 'markdown' }> => part.kind === 'markdown' && part.text.trim().length > 0,
  );
  const normalized = markdown?.text.replace(/\s+/g, ' ').trim();
  if (!normalized) return fallback;
  const graphemes = Array.from(
    new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(normalized),
    ({ segment }) => segment,
  );
  return graphemes.length > 64 ? `${graphemes.slice(0, 61).join('')}...` : normalized;
}

function isRecoverableInitialAcpLoadError(message: string | null): boolean {
  return !!message && message.includes("reply was never sent");
}

function AcpEmptyState() {
  const { t } = useTranslation('chat');
  return (
    <div data-testid="acp-chat-empty-state" className="flex h-[60vh] flex-col items-center justify-center text-center">
      <h1 className="text-4xl font-serif font-normal tracking-tight text-foreground/80 md:text-5xl">
        {t('welcome.subtitle')}
      </h1>
    </div>
  );
}

function WorkspaceUnavailableBanner({
  path,
  readOnly,
  onChooseWorkspace,
}: {
  path: string;
  readOnly: boolean;
  onChooseWorkspace?: () => void;
}) {
  const { t } = useTranslation('chat');
  return (
    <div
      data-testid="workspace-unavailable-banner"
      className="flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-surface-modal px-4 py-3 text-amber-700 shadow-sm dark:text-amber-400"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{t('workspace.unavailable.title')}</p>
        <p className="mt-1 break-words text-sm opacity-80">
          {t(readOnly ? 'workspace.unavailable.boundDescription' : 'workspace.unavailable.description', { path })}
        </p>
        {!readOnly && onChooseWorkspace && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3 border-amber-500/30 bg-transparent text-amber-700 hover:bg-black/5 dark:text-amber-400 dark:hover:bg-white/10"
            onClick={onChooseWorkspace}
          >
            <FolderOpen className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('workspace.unavailable.chooseAction')}
          </Button>
        )}
      </div>
    </div>
  );
}

export function Chat() {
  ensureAcpChatSubscriptions();

  const { t } = useTranslation('chat');

  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const sessions = useChatStore((s) => s.sessions);
  const sessionLabels = useChatStore((s) => s.sessionLabels);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const selectAcpSession = useChatStore((s) => s.selectAcpSession);
  const acknowledgeAcpSessionCreated = useChatStore((s) => s.acknowledgeAcpSessionCreated);
  const setSessionWorkspaceOverride = useChatStore((s) => s.setSessionWorkspaceOverride);
  const setSessionModelOverride = useChatStore((s) => s.setSessionModelOverride);
  const routeAndMaybeStartWorkflow = useChatStore((s) => s.routeAndMaybeStartWorkflow);
  const workflowRoutingSessionKey = useChatStore((s) => s.workflowRoutingSessionKey);
  const ingestAcpObservedWorkflow = useChatStore((s) => s.ingestAcpObservedWorkflow);
  const failObservedWorkflow = useChatStore((s) => s.failObservedWorkflow);
  const healStaleObservedWorkflows = useChatStore((s) => s.healStaleObservedWorkflows);
  const workflowCards = useChatStore((s) => s.workflowCardsBySession[currentSessionKey]);
  const getWorkflowSkillByReadPath = useSkillWorkflowStore((s) => s.getWorkflowSkillByReadPath);
  const workflowSkillsByName = useSkillWorkflowStore((s) => s.byName);
  const setVisibleSession = useSessionAttentionStore((s) => s.setVisibleSession);
  const chatWorkspacePath = useSettingsStore((s) => s.chatWorkspacePath);
  const recentWorkspacePaths = useSettingsStore((s) => s.recentWorkspacePaths ?? []);
  const workspaceLabels = useSettingsStore((s) => s.workspaceLabels);
  const setChatWorkspacePath = useSettingsStore((s) => s.setChatWorkspacePath);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);
  const agents = useAgentsStore((s) => s.agents);
  const [sessionDiscoveryAttempted, setSessionDiscoveryAttempted] = useState(false);
  const [lastPromptAttemptSessionKey, setLastPromptAttemptSessionKey] = useState<string | null>(null);
  const [questionDirectoryOpenSessionKey, setQuestionDirectoryOpenSessionKey] = useState<string | null>(null);
  const [resolvedWorkspaceContext, setResolvedWorkspaceContext] = useState<{
    key: string;
    sessionKey: string;
    workspaceRoot: string;
    executionCwd: string;
  } | null>(null);
  const [workspaceContextCheck, setWorkspaceContextCheck] = useState<WorkspaceContextCheck | null>(null);
  const currentSession = useMemo(
    () => sessions.find((session) => session.key === currentSessionKey) ?? null,
    [currentSessionKey, sessions],
  );
  const currentSessionTitle = currentSession
    ? getSessionDisplayTitle(currentSession, sessionLabels)
    : currentSessionKey;
  const allWorkspacePaths = useMemo(() => {
    const seen = new Set<string>();
    const paths: string[] = [];
    const candidatePaths = [
      ...recentWorkspacePaths,
      chatWorkspacePath,
      ...sessions.map((session) => session.workspacePath).filter((path): path is string => !!path),
    ];
    for (const path of candidatePaths) {
      const normalized = normalizeWorkspacePath(path);
      if (!normalized || isDefaultWorkspacePath(normalized)) continue;
      const slashedPath = normalized.replace(/\\/g, '/');
      const identity = /^[A-Za-z]:\//.test(slashedPath) ? slashedPath.toLowerCase() : slashedPath;
      if (seen.has(identity)) continue;
      seen.add(identity);
      paths.push(normalized);
    }
    return paths;
  }, [chatWorkspacePath, recentWorkspacePaths, sessions]);
  const workspaceOptions = useMemo<ChatWorkspaceOption[]>(() => {
    return allWorkspacePaths.map((normalized) => ({
      path: normalized,
      label: getWorkspaceDisplayLabel(
        normalized,
        t('workspace.defaultLabel'),
        workspaceLabels,
        allWorkspacePaths,
      ),
    }));
  }, [allWorkspacePaths, t, workspaceLabels]);
  const currentAgent = useMemo(
    () => (agents ?? []).find((agent) => agent.id === currentAgentId) ?? null,
    [agents, currentAgentId],
  );
  const workspaceOverride = useChatStore((s) => s.workspaceOverrideBySessionKey[currentSessionKey]);
  const sessionModelOverride = useChatStore((s) => s.sessionModelOverrideBySessionKey[currentSessionKey] ?? null);
  const effectiveWorkspace = useMemo(
    () => resolveEffectiveWorkspace({
      session: currentSession,
      agentWorkspace: currentAgent?.workspace,
      globalWorkspace: chatWorkspacePath,
      explicitWorkspace: workspaceOverride,
    }),
    [chatWorkspacePath, currentSession, currentAgent, workspaceOverride],
  );
  const cwd = effectiveWorkspace.cwd;
  const workspaceLabel = getWorkspaceDisplayLabel(
    cwd,
    t('workspace.defaultLabel'),
    workspaceLabels,
    allWorkspacePaths,
  );

  const acpTimeline = useAcpChatSessionStore((s) => s.timeline);
  const renderedAcpTimeline = useDeferredValue(acpTimeline);
  const emptyCurrentTimeline = useMemo(
    () => createEmptyAcpTimeline(currentSessionKey ?? '', 0),
    [currentSessionKey],
  );
  const visibleAcpTimeline = renderedAcpTimeline.sessionId === currentSessionKey
    ? renderedAcpTimeline
    : acpTimeline.sessionId === currentSessionKey
      ? acpTimeline
      : emptyCurrentTimeline;
  const acpTurnTimings = useAcpChatSessionStore((s) => s.turnTimingsByUserMessageId);
  const acpLoading = useAcpChatSessionStore((s) => s.loading);
  const acpSending = useAcpChatSessionStore((s) => s.sending);
  const imageGenerationPending = useAcpChatSessionStore(
    (s) => Boolean(s.pendingImageGenerationTaskIds?.length),
  );
  const acpCancelling = useAcpChatSessionStore((s) => s.cancelling);
  const acpError = useAcpChatSessionStore((s) => s.error);
  const acpActiveSessionKey = useAcpChatSessionStore((s) => s.activeSessionKey);
  const acpWorkspaceRoot = useAcpChatSessionStore((s) => s.workspaceRoot);
  const acpCwd = useAcpChatSessionStore((s) => s.cwd);
  const prepareLocalAcpSession = useAcpChatSessionStore((s) => s.prepareLocalSession);
  const loadAcpSession = useAcpChatSessionStore((s) => s.loadSession);
  const sendAcpPrompt = useAcpChatSessionStore((s) => s.sendPrompt);
  const cancelAcp = useAcpChatSessionStore((s) => s.cancel);
  const respondAcpPermission = useAcpChatSessionStore((s) => s.respondPermission);
  const clearAcpError = useAcpChatSessionStore((s) => s.clearError);

  const panelOpen = useArtifactPanel((s) => s.open);
  const panelWidthPct = useArtifactPanel((s) => s.widthPct);
  const closeArtifactPanel = useArtifactPanel((s) => s.close);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const acpLoadInFlightKeyRef = useRef<string | null>(null);
  const { contentRef, scrollRef, scrollToBottom, isAtBottom } = useStickToBottomInstant(
    currentSessionKey,
    acpSending || acpCancelling,
  );

  useEffect(() => {
    setVisibleSession(currentSessionKey);
    return () => setVisibleSession(null);
  }, [currentSessionKey, setVisibleSession]);

  useEffect(() => {
    void fetchAgents({ reconcile: false }).catch(() => undefined);
  }, [fetchAgents]);

  useEffect(() => {
    closeArtifactPanel();
  }, [currentSessionKey, closeArtifactPanel]);

  const projectionExecutionCwd = acpActiveSessionKey === currentSessionKey && acpCwd ? acpCwd : cwd;
  const workspaceContextKey = currentSessionKey && cwd && projectionExecutionCwd
    ? `${currentSessionKey}\0${cwd}\0${projectionExecutionCwd}`
    : null;

  useEffect(() => {
    if (!workspaceContextKey || !currentSessionKey || !cwd || !projectionExecutionCwd) return;
    let stale = false;
    setWorkspaceContextCheck(null);
    void hostApi.files.resolveWorkspaceContext({
      workspaceRoot: cwd,
      executionCwd: projectionExecutionCwd,
    }).then((result) => {
      if (stale) return;
      if (!result.ok || !result.workspaceRoot || !result.executionCwd) {
        setResolvedWorkspaceContext(null);
        // The default managed workspace (~/.openclaw/workspace) is created lazily
        // — seeded by the gateway once ready, or provisioned by the ACP service on
        // session load. Its transient absence is not a "moved/deleted" error, so
        // treat it as available (mirrors use-workspace-availability's exclusion).
        setWorkspaceContextCheck({ key: workspaceContextKey, available: isDefaultWorkspacePath(cwd) });
        return;
      }
      setResolvedWorkspaceContext({
        key: workspaceContextKey,
        sessionKey: currentSessionKey,
        workspaceRoot: result.workspaceRoot,
        executionCwd: result.executionCwd,
      });
      setWorkspaceContextCheck({ key: workspaceContextKey, available: true });
    }).catch(() => {
      if (stale) return;
      setResolvedWorkspaceContext(null);
      setWorkspaceContextCheck({ key: workspaceContextKey, available: isDefaultWorkspacePath(cwd) });
    });
    return () => {
      stale = true;
    };
  }, [currentSessionKey, cwd, projectionExecutionCwd, workspaceContextKey]);

  const workspaceContextAvailable = !!workspaceContextKey
    && workspaceContextCheck?.key === workspaceContextKey
    && workspaceContextCheck.available;
  const workspaceUnavailable = !!workspaceContextKey
    && workspaceContextCheck?.key === workspaceContextKey
    && !workspaceContextCheck.available;

  useEffect(() => {
    if (currentSessionKey !== DEFAULT_SESSION_KEY || sessions.length > 0 || sessionDiscoveryAttempted) return;
    let cancelled = false;
    void loadSessions()
      .finally(() => {
        if (!cancelled) setSessionDiscoveryAttempted(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [currentSessionKey, loadSessions, sessionDiscoveryAttempted, sessions.length]);

  useEffect(() => {
    if (!currentSessionKey || !cwd || !currentSession?.createdLocally) return;
    acpLoadInFlightKeyRef.current = null;
    const hasStaleTimeline = acpTimeline.sessionId !== currentSessionKey || acpTimeline.itemOrder.length > 0;
    if (acpActiveSessionKey === currentSessionKey && acpWorkspaceRoot === cwd && acpCwd === cwd && !hasStaleTimeline) return;
    prepareLocalAcpSession({ sessionKey: currentSessionKey, workspaceRoot: cwd, cwd });
  }, [acpActiveSessionKey, acpCwd, acpTimeline.itemOrder.length, acpTimeline.sessionId, acpWorkspaceRoot, currentSession, currentSessionKey, cwd, prepareLocalAcpSession]);

  useEffect(() => {
    if (!currentSessionKey || !cwd || !workspaceContextAvailable) return;
    if (currentSessionKey === DEFAULT_SESSION_KEY && sessions.length === 0 && acpActiveSessionKey == null && !sessionDiscoveryAttempted) return;
    if (acpActiveSessionKey === currentSessionKey && acpWorkspaceRoot === cwd && acpCwd === cwd) return;
    const acpLoadKey = `${currentSessionKey}\0${cwd}`;
    if (acpLoadInFlightKeyRef.current === acpLoadKey) return;
    const currentSession = sessions.find((session) => session.key === currentSessionKey);
    if (currentSession?.createdLocally) return;
    const createIfMissing = !currentSession;
    acpLoadInFlightKeyRef.current = acpLoadKey;
    if (createIfMissing) selectAcpSession(currentSessionKey, cwd);
    void loadAcpSession({
      sessionKey: currentSessionKey,
      workspaceRoot: cwd,
      cwd,
      ...(createIfMissing ? { createIfMissing: true } : {}),
    }).then((loaded) => {
      if (loaded && createIfMissing) {
        acknowledgeAcpSessionCreated(currentSessionKey, cwd);
      }
    }).finally(() => {
      if (acpLoadInFlightKeyRef.current === acpLoadKey) {
        acpLoadInFlightKeyRef.current = null;
      }
    });
  }, [acknowledgeAcpSessionCreated, acpActiveSessionKey, acpCwd, acpWorkspaceRoot, currentSessionKey, cwd, loadAcpSession, selectAcpSession, sessionDiscoveryAttempted, sessions, workspaceContextAvailable]);

  const platform = window.electron?.platform;
  const isMac = platform === 'darwin';
  const isWindows = platform === 'win32';
  const composerBusy = acpSending || acpCancelling || workflowRoutingSessionKey === currentSessionKey;
  const showScrollToLatest = visibleAcpTimeline.itemOrder.length > 0 && !isAtBottom;
  const hasAttemptedAcpPromptForCurrentSession = lastPromptAttemptSessionKey === currentSessionKey;
  const visibleAcpError = !workspaceUnavailable && acpError
    && !(acpTimeline.itemOrder.length === 0 && !hasAttemptedAcpPromptForCurrentSession && isRecoverableInitialAcpLoadError(acpError))
    ? acpError
    : null;
  const chooseReplacementWorkspace = async () => {
    try {
      const result = await hostApi.dialog.open({
        title: t('composer.workspacePickerTitle'),
        buttonLabel: t('composer.workspacePickerButton'),
        properties: ['openDirectory', 'createDirectory'],
      });
      const selected = result.filePaths[0]?.trim();
      if (!result.canceled && selected) {
        setSessionWorkspaceOverride(currentSessionKey, selected);
        setChatWorkspacePath(selected);
      }
    } catch {
      toast.error(t('composer.workspacePickerFailed'));
    }
  };
  const handleSelectModel = async (modelRef: string | null) => {
    if (!currentSessionKey || !cwd) return;
    const sessionKey = currentSessionKey;
    const previousOverride = sessionModelOverride;
    // Optimistic — reflected in the picker immediately; this is the only
    // "source of truth" the UI keeps (in-memory, never persisted). The actual
    // authority is the `/model` directive landing on the gateway's own
    // session-store entry for this sessionKey, below.
    setSessionModelOverride(sessionKey, modelRef);
    try {
      const existingSession = sessions.find((session) => session.key === sessionKey);
      const createIfMissing = !existingSession || !!existingSession.createdLocally;
      if (
        createIfMissing
        || acpActiveSessionKey !== sessionKey
        || acpWorkspaceRoot !== cwd
        || acpCwd !== cwd
      ) {
        const loaded = await loadAcpSession({
          sessionKey,
          workspaceRoot: cwd,
          cwd,
          ...(createIfMissing ? { createIfMissing: true } : {}),
        });
        if (loaded && createIfMissing) {
          acknowledgeAcpSessionCreated(sessionKey, cwd);
        }
        if (!loaded) throw new Error(t('composer.workspacePickerFailed'));
      }
      // A directive-only message ("/model ...") is recognized and applied by
      // the gateway to this session's own store entry — it is never routed
      // through the workflow engine and never written to openclaw.json.
      await sendAcpPrompt({
        sessionKey,
        cwd,
        message: modelRef ? `/model ${modelRef}` : '/model default',
        silent: true,
      });
    } catch (error) {
      setSessionModelOverride(sessionKey, previousOverride);
      throw error;
    }
  };
  const fileActivity = useMemo(() => {
    if (
      !workspaceContextKey
      || resolvedWorkspaceContext?.key !== workspaceContextKey
      || resolvedWorkspaceContext.sessionKey !== currentSessionKey
      || acpActiveSessionKey !== currentSessionKey
      || visibleAcpTimeline.sessionId !== currentSessionKey
    ) return EMPTY_FILE_ACTIVITY;
    return projectOpenClawFileActivities({
      timeline: visibleAcpTimeline,
      workspaceRoot: resolvedWorkspaceContext.workspaceRoot,
      executionCwd: resolvedWorkspaceContext.executionCwd,
    });
  }, [acpActiveSessionKey, visibleAcpTimeline, currentSessionKey, resolvedWorkspaceContext, workspaceContextKey]);

  // ── Observed-workflow lane (independent, non-ACP) ─────────────────────────
  // Derive observed-workflow signals from the ACP timeline WITHOUT mutating it,
  // mirroring the file-activity projection. The signal is fired into the chat
  // store's observed-workflow actions; a ref dedupes unchanged re-projections so
  // the idempotent store actions are only invoked on real changes.
  const observedWorkflowSignal = useMemo(() => {
    if (acpActiveSessionKey !== currentSessionKey || visibleAcpTimeline.sessionId !== currentSessionKey) return null;
    // `workflowSkillsByName` is only in deps so the memo recomputes when the
    // skill cache finishes loading; the resolver reads it via the store method.
    void workflowSkillsByName;
    return projectAcpObservedWorkflow({
      timeline: visibleAcpTimeline,
      resolveWorkflowSkillByReadPath: (path) => {
        const hit = getWorkflowSkillByReadPath(path);
        if (!hit || !hit.workflow) return null;
        return { name: hit.name, title: hit.title || hit.name };
      },
    }).signal;
  }, [acpActiveSessionKey, visibleAcpTimeline, currentSessionKey, getWorkflowSkillByReadPath, workflowSkillsByName]);
  const observedAppliedSigRef = useRef<Record<string, string>>({});
  useEffect(() => {
    if (!observedWorkflowSignal || !currentSessionKey) return;
    const signature = [
      observedWorkflowSignal.activationKey,
      observedWorkflowSignal.skill?.name ?? '',
      observedWorkflowSignal.hasPlan
        ? observedWorkflowSignal.todos.map((todo) => `${todo.content}:${todo.status}`).join('|')
        : '',
      // Re-run when a live send starts so a prior historical no-op can arm.
      acpSending ? '1' : '0',
    ].join('\0');
    if (observedAppliedSigRef.current[currentSessionKey] === signature) return;
    observedAppliedSigRef.current[currentSessionKey] = signature;
    // Historical session-load replay must not arm/create cards (`live: false`).
    // Only an in-flight ACP send may implicitly arm from Read(SKILL.md).
    ingestAcpObservedWorkflow(currentSessionKey, observedWorkflowSignal, { live: acpSending });
  }, [observedWorkflowSignal, currentSessionKey, ingestAcpObservedWorkflow, acpSending]);

  // Converge orphan `running` observed cards after historical load (no live send).
  // Ingest itself refuses to hydrate them when `!live`; heal writes durable
  // done/failed + step snapshots so reload shows the correct terminal UI.
  useEffect(() => {
    if (!currentSessionKey || acpSending || acpLoading) return;
    if (acpActiveSessionKey !== currentSessionKey) return;
    healStaleObservedWorkflows(currentSessionKey, {
      live: false,
      signal: observedWorkflowSignal,
    });
  }, [
    currentSessionKey,
    acpSending,
    acpLoading,
    acpActiveSessionKey,
    observedWorkflowSignal,
    healStaleObservedWorkflows,
  ]);

  const questionDirectoryItems = useMemo(() => {
    const userItems = visibleAcpTimeline.itemOrder
      .map((itemId) => visibleAcpTimeline.itemsById[itemId])
      .filter((item): item is MessageSegmentItem => item?.kind === 'message-segment' && item.role === 'user');
    return userItems.map((item, index) => ({
      itemId: item.id,
      anchorId: getAcpUserMessageAnchorId(item.id),
      title: buildQuestionDirectoryTitle(item, t('questionDirectory.fallback', { number: index + 1 })),
    }));
  }, [t, visibleAcpTimeline]);
  const questionDirectoryVisible = questionDirectoryOpenSessionKey === currentSessionKey
    && questionDirectoryItems.length > 1;
  // Workflow lane cards for this session, oldest-first. Sourced entirely from the
  // fork's persisted store (never from the ACP timeline), so rendering them beside
  // the transcript keeps the lane independent of ACP history.
  const sortedWorkflowCards = useMemo(
    () => [...(workflowCards ?? [])].sort((a, b) => a.createdAt - b.createdAt),
    [workflowCards],
  );
  // Interleave the workflow cards into the ACP display groups at render time
  // (never mutating the ACP timeline store). An empty result means both the ACP
  // timeline and the workflow lane are empty → show the welcome state.
  const conversationBlocks = useMemo(
    () => buildConversationBlocks(groupAcpTimelineItems(visibleAcpTimeline), sortedWorkflowCards),
    [visibleAcpTimeline, sortedWorkflowCards],
  );
  const streamingSegmentIds = useMemo(
    () => streamingMessageSegmentIds(visibleAcpTimeline, acpSending || acpCancelling),
    [visibleAcpTimeline, acpSending, acpCancelling],
  );
  const timelineWorkspaceRoot = resolvedWorkspaceContext?.key === workspaceContextKey
    ? resolvedWorkspaceContext.workspaceRoot
    : undefined;

  // The visible transcript is driven by the singleton ACP store, so during a
  // session switch there is a window where `currentSessionKey` is already the
  // new session but `acpTimeline` still belongs to the previous one (the load is
  // deferred behind the async workspace-context resolution). Mirror the
  // fileActivity / observedWorkflowSignal guards so we never paint the previous
  // session's content under the new key: treat a mismatch as loading. The
  // `acpActiveSessionKey !== null` precondition keeps cold-start / default empty
  // sessions on the welcome screen instead of a spurious spinner.
  const acpTimelineMatchesSession =
    acpActiveSessionKey === currentSessionKey && acpTimeline.sessionId === currentSessionKey;
  const acpTransitionPending = acpActiveSessionKey !== null && !acpTimelineMatchesSession;
  const showAcpLoading = acpLoading || acpTransitionPending;

  return (
    <div
      ref={splitContainerRef}
      data-testid="chat-page"
      className={cn(
        'relative flex min-h-0 -m-6 overflow-hidden transition-colors duration-500',
        'bg-background',
        isMac && 'z-20 rounded-tl-2xl shadow-[inset_1px_1px_0_hsl(var(--border)/0.55)]',
        isWindows && 'rounded-tl-2xl',
      )}
      style={{ height: isMac ? 'calc(100vh - 1px)' : 'calc(100vh - 2.5rem)' }}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <div className={cn(
          'relative flex shrink-0 items-center px-4 py-2',
          isWindows ? 'gap-4' : 'justify-end',
        )}>
          <div data-testid="chat-toolbar-drag-region" className="drag-region absolute inset-0 z-0" aria-hidden="true" />
          {isWindows && (
            <div className="drag-region relative z-10 min-w-0 flex-1">
              <h1
                data-testid="chat-session-title"
                title={currentSessionTitle}
                className="truncate text-sm font-medium text-foreground"
              >
                {currentSessionTitle}
              </h1>
            </div>
          )}
          <div data-testid="chat-toolbar-actions" className="no-drag relative z-10">
            <ChatToolbar
              questionDirectoryOpen={questionDirectoryVisible}
              questionDirectoryItems={questionDirectoryItems}
              onToggleQuestionDirectory={() => setQuestionDirectoryOpenSessionKey((openSessionKey) => (
                openSessionKey === currentSessionKey ? null : currentSessionKey
              ))}
              onCloseQuestionDirectory={() => setQuestionDirectoryOpenSessionKey(null)}
              workspaceAvailable={!!cwd}
            />
          </div>
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden py-4">
          <div className="mx-auto flex h-full min-h-0 w-full flex-col gap-4 lg:flex-row lg:items-stretch">
            <div data-testid="chat-scroll-column" className="relative min-h-0 min-w-0 flex-1">
              <div ref={scrollRef} className="h-full min-h-0 min-w-0 overflow-y-auto" data-testid="chat-scroll-container">
                <div ref={contentRef} className="mx-auto max-w-4xl space-y-4">
                  {workspaceUnavailable && (
                    <WorkspaceUnavailableBanner
                      path={cwd}
                      readOnly={effectiveWorkspace.readOnly}
                      onChooseWorkspace={effectiveWorkspace.readOnly ? undefined : () => void chooseReplacementWorkspace()}
                    />
                  )}
                  {visibleAcpError && <AcpErrorBanner message={visibleAcpError} onDismiss={clearAcpError} />}
                  {showAcpLoading ? (
                    <div className="flex min-h-[40vh] items-center justify-center" data-testid="acp-chat-loading">
                      <LoadingSpinner size="md" />
                    </div>
                  ) : conversationBlocks.length === 0 ? (
                    <AcpEmptyState />
                  ) : (
                    <div data-testid="acp-chat-timeline" className="flex flex-col gap-4">
                      {conversationBlocks.map((block) =>
                        block.kind === 'acp-group' ? (
                          <AcpTimelineGroup
                            key={block.key}
                            group={block.group}
                            streamingSegmentIds={streamingSegmentIds}
                            fileActivity={fileActivity}
                            workspaceRoot={timelineWorkspaceRoot}
                            timing={block.group.kind !== 'user' && block.group.userMessageId ? acpTurnTimings?.[block.group.userMessageId] : undefined}
                            onPermissionSelect={(requestId, optionId) => {
                              void respondAcpPermission(requestId, optionId);
                            }}
                          />
                        ) : (
                          <WorkflowTurnBlock key={block.key} card={block.card} />
                        ),
                      )}
                    </div>
                  )}
                </div>
              </div>

              {showScrollToLatest && (
                <button
                  type="button"
                  onClick={() => void scrollToBottom({ animation: 'smooth', ignoreEscapes: true })}
                  className="absolute bottom-4 right-4 z-20 inline-flex items-center gap-2 rounded-full border border-border bg-background/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-lg shadow-black/10 backdrop-blur transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:hover:bg-white/10 dark:shadow-black/30"
                  aria-label={t('scrollToLatest')}
                  title={t('scrollToLatest')}
                  data-testid="chat-scroll-to-latest"
                >
                  <ArrowDownToLine className="h-3.5 w-3.5" />
                  <span>{t('scrollToLatest')}</span>
                </button>
              )}
            </div>
          </div>
        </div>

        <ChatInput
          onSend={(text: string, attachments?: FileAttachment[], targetAgentId?: string | null) => {
            if (!currentSessionKey || !cwd || !workspaceContextAvailable) return;
            const targetAgent = targetAgentId
              ? agents.find((agent) => agent.id === targetAgentId) ?? null
              : null;
            // Switching to another agent via @mention always starts a FRESH
            // conversation for that agent. Reusing the agent's persistent main
            // session (`agent:<id>:main`) would jump into its prior transcript
            // and bleed unrelated context ("上下文串用"). A new `session-<ts>`
            // key is created-on-demand downstream (createIfMissing below).
            const sessionKey = targetAgent
              ? `agent:${targetAgent.id}:session-${Date.now()}`
              : currentSessionKey;
            const existingSession = sessions.find((session) => session.key === sessionKey);
            setLastPromptAttemptSessionKey(sessionKey);
            const promptCwd = targetAgent?.workspace || cwd;
            const media = attachments
              ?.filter((file) => file.status === 'ready')
              .map((file) => ({
                filePath: file.stagedPath,
                stagingId: file.id,
                fileName: file.fileName,
                mimeType: file.mimeType,
              }));
            if (targetAgent || !existingSession) {
              selectAcpSession(sessionKey, promptCwd);
            }
            void (async () => {
              // Workflow lane routing (independent, non-ACP): engine workflows are
              // server-orchestrated, so a routed turn must NOT also send an ACP
              // prompt. Guarded by `autoWorkflowEnabled` inside the action.
              // Attachments never auto-route (they go straight to the agent).
              if (!(attachments && attachments.length)) {
                const routed = await routeAndMaybeStartWorkflow(text, sessionKey, targetAgentId ?? null);
                if (routed) {
                  requestAnimationFrame(() => {
                    void scrollToBottom({ animation: 'instant', ignoreEscapes: true });
                  });
                  return;
                }
              }
              if (promptCwd !== cwd) {
                const promptWorkspace = await hostApi.files.resolveWorkspaceContext({
                  workspaceRoot: promptCwd,
                  executionCwd: promptCwd,
                }).catch(() => ({ ok: false }));
                if (!promptWorkspace.ok) return;
              }
              const createIfMissing = !existingSession || !!existingSession.createdLocally;
              if (
                createIfMissing
                || acpActiveSessionKey !== sessionKey
                || acpWorkspaceRoot !== promptCwd
                || acpCwd !== promptCwd
              ) {
                const acpLoadKey = `${sessionKey}\0${promptCwd}`;
                acpLoadInFlightKeyRef.current = acpLoadKey;
                const loaded = await (async () => {
                  try {
                    return await loadAcpSession({
                      sessionKey,
                      workspaceRoot: promptCwd,
                      cwd: promptCwd,
                      ...(createIfMissing ? { createIfMissing: true } : {}),
                    });
                  } finally {
                    if (acpLoadInFlightKeyRef.current === acpLoadKey) {
                      acpLoadInFlightKeyRef.current = null;
                    }
                  }
                })();
                if (loaded && createIfMissing) {
                  acknowledgeAcpSessionCreated(sessionKey, promptCwd, text);
                }
                if (!loaded) return;
              }
              const sendPromise = sendAcpPrompt({
                sessionKey,
                cwd: promptCwd,
                message: text,
                media,
              });
              requestAnimationFrame(() => {
                void scrollToBottom({ animation: 'instant', ignoreEscapes: true });
              });
              await sendPromise;
            })();
          }}
          onStop={() => {
            // Finalize the independent workflow lane immediately (ACP cancel does
            // not receive Gateway run.ended). cancelAcp also settles plan/tools
            // and Main dual-aborts ACP + chat.abort.
            failObservedWorkflow?.(currentSessionKey, 'aborted');
            void cancelAcp();
          }}
          disabled={acpLoading || acpCancelling || !cwd || !workspaceContextAvailable}
          sending={composerBusy}
          imageGenerating={imageGenerationPending}
          workspaceLabel={workspaceLabel}
          workspacePath={cwd}
          workspaceOptions={workspaceOptions}
          workspaceReadOnly={effectiveWorkspace.readOnly}
          onSelectWorkspace={(path) => {
            setSessionWorkspaceOverride(currentSessionKey, path);
            setChatWorkspacePath(path);
          }}
          sessionModelOverride={sessionModelOverride}
          onSelectModel={handleSelectModel}
        />
      </div>

      {panelOpen && (
        <>
          <Suspense fallback={null}>
            <PanelResizeDividerLazy containerRef={splitContainerRef} />
          </Suspense>
          <aside
            data-testid="artifact-panel-aside"
            className={cn(
              'relative z-20 hidden shrink-0 border-l border-black/5 dark:border-white/10 lg:flex lg:flex-col',
              isMac && 'no-drag',
            )}
            style={{ width: `${panelWidthPct}%` }}
          >
            <Suspense
              fallback={(
                <div className="flex h-full items-center justify-center">
                  <LoadingSpinner size="md" />
                </div>
              )}
            >
              <ArtifactPanelLazy
                fileGroups={fileActivity.fileGroups}
                uniqueFileCount={fileActivity.uniqueFileCount}
                agent={currentAgent}
                workspacePath={cwd}
                workspaceLabel={workspaceLabel}
                runStartedAt={null}
              />
            </Suspense>
          </aside>
        </>
      )}

      {/* Independent workflow lane popup — mounted once, portals itself. */}
      <WorkflowFloatingPanel />
    </div>
  );
}

export default Chat;
