import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  Archive,
  Building2,
  FolderKanban,
  RefreshCw,
  Users,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  filterRoomMessagesForProject,
  listActiveExecutingProjectIds,
  readExecutingProjectIdsFromStore,
  shouldPollOfficeRoomMessages,
  isOfficeProjectExecuting,
  isOfficeProjectArchived,
  shouldAutoExpandRoomOnMessageCount,
  bumpOfficeRoomPanelScheduleToken,
  scheduleOfficeRoomPanelDeactivation,
} from '@/lib/office-room-sidebar';
import { isOfficeProjectAbortQuiescing } from '@/lib/office-workflow-abort';
import { subscribeHostEvent } from '@/lib/host-events';
import { pauseRoomReplyPoll, stopAllProjectRunPolls, useOfficeStore } from '@/stores/office';
import { useAgentsStore } from '@/stores/agents';
import { useGatewayStore } from '@/stores/gateway';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from '@/lib/toast';
import type { OfficeFixedGroup, OfficeTempProject, WorkflowDefinition, WorkflowStepDraftRow } from '@/types/office';
import type { OfficeProjectProgress } from '@/lib/office-project-progress';
import {
  TaskCreateDialog,
  emptyTaskCreateForm,
  taskCreateFormFromGroup,
  type TaskCreateFormState,
  type TaskCreateOpenOptions,
  type TaskCreateSubmitMeta,
} from '@/components/office/TaskCreateDialog';
import { emptyWorkflow, ensureCoordinatorInTeam } from '@/lib/office-workflow-roles';
import { OfficeWorkspaceArea } from '@/pages/Office/OfficeWorkspaceArea';
import { useOfficeDisplayLists } from '@/hooks/use-office-display-lists';
import { useOfficePrefetchRevision, useGatewayInitialOfficePrefetchUi } from '@/hooks/use-office-project-prefetch';
import {
  handleOfficePageEnter,
  isOfficeCachePrefetchInFlight,
  runOfficeCachePrefetch,
  subscribeOfficeCachePrefetch,
} from '@/lib/office-cache-prefetch';
import {
  getOfficeDisplayCache,
  isOfficeDisplayCacheSyncReady,
  shouldBlockOfficePageForSyncLoading,
  subscribeOfficeDisplayCache,
  type OfficeSyncHydrationLevel,
} from '@/lib/office-display-cache';
import {
  ensureProjectCardOnExpand,
  invalidateProjectRoomPrefetch,
  isProjectLeftPanelReady,
  preferredPrefetchTargetId,
  prepareProjectExpandPrefetch,
  resolveOfficeDraftFormBootstrap,
  scheduleProjectRoomOnExpand,
} from '@/lib/office-project-prefetch';
import {
  resolveOfficeEnterActiveProject,
  shouldAutoExpandPreferredProject,
  shouldDeferPollRoomAutoExpand,
} from '@/lib/office-enter-layout';
import { GroupFormModal, type GroupDraft } from '@/components/office/GroupFormModal';
import { sortOfficeProjectsBySequence } from '@/lib/office-task-order';
import { isWorkflowDescriptionSatisfied, projectInheritsGroupTemplateOnSave, projectOwnsWorkflow, shouldInheritGroupWorkflowOnSpawn, workflowDescriptionForProject } from '@/lib/office-task-workflow';
import { materializeOwnedWorkflowPayload, shouldUseWorkflowFreezeSnapshot, workflowFreezeSnapshotAsCompareGroup } from '@/lib/office-spawned-workflow-ownership';
import { syncWorkflowEdges } from '@/lib/office-workflow-edges';
import { prepareLangGraphTaskSave, langGraphWorkflowDescriptionRequired } from '@/lib/office-langgraph-workflow-bundle';
import { ENABLE_LANGGRAPH } from '@/lib/feature-langgraph';
import { useProviderStore } from '@/stores/providers';
import { taskExecutionMode } from '@/lib/office-task-execution-mode';
import { projectMembersFromIds } from '@/lib/office-project-members';
import { taskWorkflowEngine } from '@/lib/office-workflow-engine';
import { ensureWorkflowForTaskSave } from '@/lib/office-workflow-generate-client';
import { filterKnownAgentIds } from '@/lib/office-group-agents';
import {
  missingDraftRowAgentIds,
  sanitizeOfficeWorkflowRefsOnEditOpen,
  buildSessionStripWorkflowSnapshot,
  preserveCoordinatorForSave,
  type OfficeAgentRefEntity,
} from '@/lib/office-missing-agents';
import { groupDraftSeedFromStandaloneProject } from '@/lib/office-standalone-upgrade';
import { useOfficeViewportChrome } from '@/hooks/use-office-viewport-chrome';
import { fixedGroupExecutionMode, isFixedGroupSpawnedProject, normalizeGroupExecutionMode, spawnedProjectOrchestrationModeLocked } from '@/lib/office-fixed-group';
import {
  isOfficeStandaloneDissolvedUpgrade,
  isOfficeFixedGroupProjectAutoArchive,
  isOfficeStandaloneAwaitingArchivePrompt,
} from '@/lib/office-project-lifecycle';
import {
  subscribeWorkflowReviewAttention,
  type WorkflowReviewAttentionEvent,
} from '@/lib/office-workflow-review-attention';
import {
  emptyWorkflowStepDraftRows,
  hasWorkflowStepDraftContent,
  prepareWorkflowStepDraftsPayload,
  resolveWorkflowStepDraftRows,
  validateWorkflowStepDraftRows,
} from '@/lib/office-workflow-step-drafts';
import {
  DEFAULT_WORKFLOW_ORCHESTRATION_MODE,
  heuristicDescriptionForForm,
  orchestrationModeFromGroup,
  prepareDagOrchestrationPersistPayload,
  showHeuristicWorkflowDescriptionField,
  showWorkflowStepDraftsField,
  type WorkflowOrchestrationMode,
} from '@/lib/office-workflow-orchestration-mode';
import { TaskEditDialog } from '@/components/office/TaskEditDialog';
import { ProjectCompletionDialog } from '@/components/office/ProjectCompletionDialog';
import { WorkflowReviewAttentionDialog } from '@/components/office/WorkflowReviewAttentionDialog';
import {
  closeOfficeModalWithFocusHandoff,
  recoverDocumentFocusAfterModalClose,
} from '@/lib/preserve-document-focus';
import { OfficeStatChip } from '@/components/office/OfficeStatChip';
import {
  officePageHeaderClass,
  officePageShellClass,
} from '@/lib/office-surface-styles';

function emptyGroupDraft(): GroupDraft {
  return {
    name: '',
    description: '',
    agentIds: [],
    coordinatorAgentId: '',
    executionMode: 'workflow',
    workflowOrchestrationMode: DEFAULT_WORKFLOW_ORCHESTRATION_MODE,
    heuristicWorkflowDescription: '',
    workflowDescription: '',
    workflowStepDrafts: emptyWorkflowStepDraftRows(),
    workflow: emptyWorkflow('dag'),
  };
}

function groupDraftFromFixedGroup(
  group: OfficeFixedGroup,
  agents: ReturnType<typeof useAgentsStore.getState>['agents'],
): GroupDraft {
  const catalogIds = agents.map((a) => a.id);
  // Keep roster ids even when missing from catalog — edit UI shows red missing warnings.
  // Keep orphan coordinator in roster so save still satisfies coordinator∈team.
  const agentIds = [...group.agentIds];
  const coordinatorAgentId = group.coordinatorAgentId;
  if (coordinatorAgentId && !agentIds.includes(coordinatorAgentId)) {
    agentIds.push(coordinatorAgentId);
  }
  const knownMembers = projectMembersFromIds(
    filterKnownAgentIds(agentIds, agents),
    (id) => agents.find((a) => a.id === id)?.name,
  );
  const workflowOrchestrationMode = orchestrationModeFromGroup(group);
  const draftsBefore =
    workflowOrchestrationMode === 'rule'
      ? resolveWorkflowStepDraftRows(group.workflowStepDrafts, undefined, knownMembers)
      : emptyWorkflowStepDraftRows();
  const stepMissingAgentIds = draftsBefore.map((row) =>
    missingDraftRowAgentIds(row.agentIds, catalogIds),
  );
  const workflowSnapshot = structuredClone(group.workflow);
  const draftsSnapshot = structuredClone(draftsBefore);
  const openAgentRefSnapshot: OfficeAgentRefEntity = {
    agentIds: [...agentIds],
    coordinatorAgentId,
    workflow: workflowSnapshot,
    workflowStepDrafts: draftsSnapshot,
    agentNameHints: group.agentNameHints ? { ...group.agentNameHints } : undefined,
  };
  const sanitized = sanitizeOfficeWorkflowRefsOnEditOpen(
    {
      workflow: workflowSnapshot,
      workflowStepDrafts: draftsSnapshot,
    },
    catalogIds,
  );
  const openWorkflow = sanitized.workflow ?? structuredClone(group.workflow);
  const openDrafts =
    workflowOrchestrationMode === 'rule'
      ? (sanitized.workflowStepDrafts ?? emptyWorkflowStepDraftRows())
      : emptyWorkflowStepDraftRows();
  return {
    name: group.name,
    description: group.description ?? '',
    agentIds,
    coordinatorAgentId,
    executionMode: fixedGroupExecutionMode(group),
    workflowOrchestrationMode,
    heuristicWorkflowDescription: heuristicDescriptionForForm({
      orchestrationMode: workflowOrchestrationMode,
      storedDescription: group.workflowDescription,
    }),
    workflowDescription: group.workflowDescription ?? '',
    workflowStepDrafts: openDrafts,
    workflow: openWorkflow,
    stepMissingAgentIds,
    agentNameHints: group.agentNameHints ? { ...group.agentNameHints } : undefined,
    openAgentRefSnapshot,
    sessionStripSnapshot: buildSessionStripWorkflowSnapshot({
      persistedWorkflow: workflowSnapshot,
      persistedWorkflowStepDrafts: draftsSnapshot,
      openWorkflow,
      openWorkflowStepDrafts: openDrafts,
    }),
  };
}

function groupDraftFromStandaloneProject(
  project: OfficeTempProject,
  agents: ReturnType<typeof useAgentsStore.getState>['agents'],
): GroupDraft {
  return groupDraftSeedFromStandaloneProject(project, agents);
}

async function buildGroupWorkflowSavePayload(
  draft: GroupDraft,
  members: ReturnType<typeof projectMembersFromIds>,
): Promise<
  | {
      ok: true;
      workflow: WorkflowDefinition;
      workflowDescription?: string;
      workflowStepDrafts?: WorkflowStepDraftRow[];
      workflowOrchestrationMode?: WorkflowOrchestrationMode;
    }
  | { ok: false; errorKey: string }
> {
  if (draft.executionMode === 'smart') {
    return {
      ok: true,
      workflow: emptyWorkflow('dag'),
      workflowDescription: '',
      workflowStepDrafts: [],
      workflowOrchestrationMode: undefined,
    };
  }

  const persisted = prepareDagOrchestrationPersistPayload({
    mode: draft.workflowOrchestrationMode,
    workflowStepDrafts: draft.workflowStepDrafts,
    heuristicDescription: draft.heuristicWorkflowDescription,
    members,
  });
  const workflow = syncWorkflowEdges({ ...draft.workflow, mode: 'dag' });
  if (workflow.nodes.some((n) => !n.title?.trim())) {
    return { ok: false, errorKey: 'workflow.validationNeedTaskNames' };
  }
  const hasWorkflow = workflow.nodes.length > 0;
  const hasOrchestration =
    (persisted.workflowStepDrafts?.length ?? 0) > 0
    || Boolean(persisted.workflowDescription?.trim());
  if (!hasOrchestration && !hasWorkflow) {
    return {
      ok: true,
      workflow: emptyWorkflow('dag'),
      workflowDescription: '',
      workflowStepDrafts: [],
      workflowOrchestrationMode: persisted.workflowOrchestrationMode,
    };
  }
  return {
    ok: true,
    workflow,
    workflowDescription: persisted.workflowDescription,
    workflowStepDrafts: persisted.workflowStepDrafts,
    workflowOrchestrationMode: persisted.workflowOrchestrationMode,
  };
}

function toastWorkflowStepDraftsError(
  t: (key: string, opts?: Record<string, unknown>) => string,
  result: ReturnType<typeof validateWorkflowStepDraftRows>,
): void {
  if (result.ok || !result.error) return;
  toast.error(t(`workflowStepDrafts.validation.${result.error}`, { step: result.errorStep ?? 0 }));
}

export function Office() {
  const { t } = useTranslation('office');
  useOfficeViewportChrome();
  const {
    fixedGroups,
    tempProjects,
    agentBindings,
    archivedCount,
  } = useOfficeDisplayLists();
  const loading = useOfficeStore((s) => s.loading);
  const error = useOfficeStore((s) => s.error);
  const fetchExecutingProjectsProgress = useOfficeStore((s) => s.fetchExecutingProjectsProgress);
  const applyProjectProgress = useOfficeStore((s) => s.applyProjectProgress);
  const fetchAgentPool = useOfficeStore((s) => s.fetchAgentPool);
  const createFixedGroup = useOfficeStore((s) => s.createFixedGroup);
  const updateFixedGroup = useOfficeStore((s) => s.updateFixedGroup);
  const deleteFixedGroup = useOfficeStore((s) => s.deleteFixedGroup);
  const reorderFixedGroups = useOfficeStore((s) => s.reorderFixedGroups);
  const createTempProject = useOfficeStore((s) => s.createTempProject);
  const spawnProjectFromGroup = useOfficeStore((s) => s.spawnProjectFromGroup);
  const runProject = useOfficeStore((s) => s.runProject);
  const abortProject = useOfficeStore((s) => s.abortProject);
  const deleteTempProject = useOfficeStore((s) => s.deleteTempProject);
  const deleteArchivedProject = useOfficeStore((s) => s.deleteArchivedProject);
  const updateTempProject = useOfficeStore((s) => s.updateTempProject);
  const archiveProject = useOfficeStore((s) => s.archiveProject);
  const dismissCompletionFollowUp = useOfficeStore((s) => s.dismissCompletionFollowUp);
  const restartProject = useOfficeStore((s) => s.restartProject);
  const fetchRoomMessages = useOfficeStore((s) => s.fetchRoomMessages);
  const reconcileActiveProjectAgentStates = useOfficeStore((s) => s.reconcileActiveProjectAgentStates);
  const postRoomMessage = useOfficeStore((s) => s.postRoomMessage);

  const fetchAgents = useAgentsStore((s) => s.fetchAgents);
  const refreshProviders = useProviderStore((s) => s.refreshProviderSnapshot);
  const gatewayStatus = useGatewayStore((s) => s.status);

  const [showGroupWizard, setShowGroupWizard] = useState(false);
  const [groupWizardKey, setGroupWizardKey] = useState(0);
  const [groupWizardInitial, setGroupWizardInitial] = useState<GroupDraft>(emptyGroupDraft);
  const [groupEditSession, setGroupEditSession] = useState<{
    key: number;
    groupId: string;
    initial: GroupDraft;
  } | null>(null);
  const [showTaskCreate, setShowTaskCreate] = useState(false);
  const [taskCreateKey, setTaskCreateKey] = useState(0);
  const [taskCreateInitial, setTaskCreateInitial] = useState<TaskCreateFormState>(emptyTaskCreateForm());
  const [taskCreateOpenOptions, setTaskCreateOpenOptions] = useState<TaskCreateOpenOptions | undefined>();
  const [creatingProject, setCreatingProject] = useState(false);
  const [savingProject, setSavingProject] = useState(false);
  const [savingGroup, setSavingGroup] = useState(false);
  const [editingProject, setEditingProject] = useState<OfficeTempProject | null>(null);
  const [upgradeSourceProjectId, setUpgradeSourceProjectId] = useState<string | null>(null);
  const [completionPromptProjectId, setCompletionPromptProjectId] = useState<string | null>(null);
  const [workflowReviewAttentionQueue, setWorkflowReviewAttentionQueue] = useState<
    WorkflowReviewAttentionEvent[]
  >([]);
  const autoArchiveInFlightRef = useRef(new Set<string>());
  const officeSplitContainerRef = useRef<HTMLDivElement | null>(null);

  const unsavedCloseMessage = t('unsaved.confirmDiscard');

  const openGroupWizard = useCallback((initial: GroupDraft) => {
    setGroupWizardInitial(initial);
    setGroupWizardKey((k) => k + 1);
    setShowGroupWizard(true);
  }, []);

  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const [activeRoomProjectId, setActiveRoomProjectId] = useState<string | null>(null);
  const expandedProjectIdRef = useRef<string | null>(null);
  const roomPanelTokenRef = useRef(0);
  const cardExpandTargetRef = useRef<string | null>(null);
  const roomExpandTargetRef = useRef<string | null>(null);
  const roomMessageCountsRef = useRef<Record<string, number>>({});
  const officeEnterRoomLayoutAppliedRef = useRef<'none' | OfficeSyncHydrationLevel>('none');
  const pendingAutoExpandRef = useRef<string | null>(null);

  const bumpRoomPanelToken = useCallback(
    () => bumpOfficeRoomPanelScheduleToken(roomPanelTokenRef),
    [],
  );

  useEffect(() => {
    expandedProjectIdRef.current = expandedProjectId;
  }, [expandedProjectId]);

  const syncOfficeRoomPanelSelection = useCallback(
    (projectId: string | null) => {
      bumpRoomPanelToken();
      if (projectId) {
        const project = useOfficeStore.getState().tempProjects.find((p) => p.id === projectId);
        prepareProjectExpandPrefetch(
          projectId,
          project ? isOfficeProjectArchived(project) : false,
        );
      }
      setExpandedProjectId(projectId);
      setActiveRoomProjectId(projectId);
    },
    [bumpRoomPanelToken],
  );

  const prefetchRevision = useOfficePrefetchRevision();
  const gatewayInitialPrefetchUi = useGatewayInitialOfficePrefetchUi();
  const syncCacheRevision = useSyncExternalStore(
    subscribeOfficeDisplayCache,
    () => getOfficeDisplayCache().sync.dataRevision,
    () => 0,
  );
  const officePageBlocked = useSyncExternalStore(
    subscribeOfficeDisplayCache,
    shouldBlockOfficePageForSyncLoading,
    () => false,
  );
  const cachePrefetchInFlight = useSyncExternalStore(
    subscribeOfficeCachePrefetch,
    isOfficeCachePrefetchInFlight,
    () => false,
  );

  const applyOfficeEnterRoomLayout = useCallback((projects: OfficeTempProject[]) => {
    const preferred =
      getOfficeDisplayCache().sync.preferredProjectId
      ?? preferredPrefetchTargetId(projects);
    const enterLayout = resolveOfficeEnterActiveProject(preferred, (projectId) => {
      const live = useOfficeStore.getState().tempProjects.find((p) => p.id === projectId);
      return isProjectLeftPanelReady(projectId, live);
    });
    pendingAutoExpandRef.current = enterLayout.pendingAutoExpandId;
    syncOfficeRoomPanelSelection(enterLayout.activeProjectId);
    for (const project of projects) {
      const isolated = filterRoomMessagesForProject(
        useOfficeStore.getState().roomMessagesByProject[project.id] ?? [],
        project.id,
      );
      roomMessageCountsRef.current[project.id] = isolated.length;
    }
    officeEnterRoomLayoutAppliedRef.current = getOfficeDisplayCache().sync.hydrationLevel;
  }, [syncOfficeRoomPanelSelection]);

  useEffect(() => {
    handleOfficePageEnter();
  }, []);

  useEffect(() => {
    if (!isOfficeDisplayCacheSyncReady()) return;
    const level = getOfficeDisplayCache().sync.hydrationLevel;
    if (officeEnterRoomLayoutAppliedRef.current === level) return;
    applyOfficeEnterRoomLayout(useOfficeStore.getState().tempProjects);
     
  }, [applyOfficeEnterRoomLayout, syncCacheRevision]);

  const projectCounts = useMemo(() => {
    let active = 0;
    for (const p of tempProjects) {
      if (!isOfficeProjectArchived(p)) active += 1;
    }
    return { active, archived: archivedCount };
  }, [tempProjects, archivedCount]);

  const sortedNonArchivedProjects = useMemo(
    () =>
      sortOfficeProjectsBySequence(
        tempProjects.filter((p) => !isOfficeProjectArchived(p)),
      ),
    [tempProjects],
  );

  const isProjectFormOpen = showTaskCreate || editingProject !== null;
  const isGroupFormOpen = showGroupWizard || groupEditSession !== null;
  const isOfficeDraftFormOpen = isProjectFormOpen || isGroupFormOpen;

  useEffect(() => {
    if (!isOfficeDraftFormOpen) return;
    const bootstrap = resolveOfficeDraftFormBootstrap();
    if (bootstrap.fetchAgentPool) {
      void fetchAgentPool();
    }
    if (bootstrap.fetchAgents) {
      void fetchAgents({ silent: true, reconcile: false });
    }
    void refreshProviders();
  }, [isOfficeDraftFormOpen, fetchAgentPool, fetchAgents, refreshProviders]);

  useEffect(() => {
    const preferred = pendingAutoExpandRef.current;
    if (!shouldAutoExpandPreferredProject(preferred, expandedProjectId, (projectId) => {
      const live = useOfficeStore.getState().tempProjects.find((p) => p.id === projectId);
      return isProjectLeftPanelReady(projectId, live);
    })) {
      return;
    }
    syncOfficeRoomPanelSelection(preferred);
    pendingAutoExpandRef.current = null;
  }, [prefetchRevision, expandedProjectId, syncOfficeRoomPanelSelection]);

  useEffect(() => {
    if (!expandedProjectId) {
      cardExpandTargetRef.current = null;
      return;
    }
    if (cardExpandTargetRef.current === expandedProjectId) return;
    const project = tempProjects.find((p) => p.id === expandedProjectId);
    if (!project) return;
    cardExpandTargetRef.current = expandedProjectId;
    void ensureProjectCardOnExpand(expandedProjectId, isOfficeProjectArchived(project));
  }, [expandedProjectId, tempProjects]);

  useEffect(() => {
    if (!activeRoomProjectId) {
      roomExpandTargetRef.current = null;
      return;
    }
    if (roomExpandTargetRef.current === activeRoomProjectId) return;
    const project = tempProjects.find((p) => p.id === activeRoomProjectId);
    if (!project) return;
    roomExpandTargetRef.current = activeRoomProjectId;
    scheduleProjectRoomOnExpand(activeRoomProjectId, isOfficeProjectArchived(project));
  }, [activeRoomProjectId, tempProjects]);

  useEffect(() => {
    const pending = pendingAutoExpandRef.current;
    if (!pending) return;
    const project = tempProjects.find((p) => p.id === pending);
    if (!project || isOfficeProjectArchived(project)) {
      pendingAutoExpandRef.current = null;
    }
  }, [tempProjects]);

  useEffect(() => {
    setExpandedProjectId((current) =>
      current && !tempProjects.some((p) => p.id === current) ? null : current,
    );
    setActiveRoomProjectId((current) =>
      current && !tempProjects.some((p) => p.id === current) ? null : current,
    );
  }, [tempProjects]);

  const runningProjectIds = useMemo(
    () => listActiveExecutingProjectIds(sortedNonArchivedProjects),
    [sortedNonArchivedProjects],
  );

  const shouldPollRooms = shouldPollOfficeRoomMessages({
    runningProjectIds,
    draftFormOpen: isOfficeDraftFormOpen,
  });

  const lastExecutionProgressAtRef = useRef(0);

  const reconcileProgressProjectAgents = useCallback((projectId: string) => {
    const state = useOfficeStore.getState();
    const project = state.tempProjects.find((p) => p.id === projectId);
    if (!project) return;
    const groupId = project.parentGroupId?.trim() ?? project.id;
    if (!groupId) return;
    state.reconcileActiveProjectAgentStates(groupId, [projectId]);
  }, []);

  useEffect(() => {
    return subscribeHostEvent<OfficeProjectProgress>('office:project-progress', (progress) => {
      const projectId = progress?.id?.trim();
      if (!projectId) return;
      applyProjectProgress(progress);
      const project = useOfficeStore.getState().tempProjects.find((p) => p.id === projectId);
      if (project && isOfficeProjectExecuting(project)) {
        reconcileProgressProjectAgents(projectId);
      }
    });
  }, [applyProjectProgress, reconcileProgressProjectAgents]);

  useEffect(() => {
    return subscribeHostEvent<{ projectId?: string; taskId?: string }>(
      'office:room-message-appended',
      (payload) => {
        const projectId = (payload.projectId ?? payload.taskId)?.trim();
        if (!projectId) return;
        const project = useOfficeStore.getState().tempProjects.find((p) => p.id === projectId);
        if (!project) return;
        // Allow abort terminal while quiescing (executing poll already stopped).
        if (!isOfficeProjectExecuting(project) && !isOfficeProjectAbortQuiescing(project)) return;
        invalidateProjectRoomPrefetch(projectId);
        void fetchRoomMessages(projectId, { urgent: true });
      },
    );
  }, [fetchRoomMessages]);

  useEffect(() => {
    if (!isOfficeDraftFormOpen || !activeRoomProjectId) return;
    pauseRoomReplyPoll(activeRoomProjectId);
  }, [isOfficeDraftFormOpen, activeRoomProjectId]);

  useEffect(() => {
    if (runningProjectIds.length > 0) return;
    stopAllProjectRunPolls();
  }, [runningProjectIds]);

  useEffect(() => {
    if (!shouldPollRooms) return;

    let cancelled = false;

    const syncProjectRoom = async (projectId: string) => {
      const prevCount = roomMessageCountsRef.current[projectId];
      await fetchRoomMessages(projectId);
      const msgs = useOfficeStore.getState().roomMessagesByProject[projectId] ?? [];
      const nextCount = filterRoomMessagesForProject(msgs, projectId).length;
      if (shouldAutoExpandRoomOnMessageCount(prevCount, nextCount)) {
        if (!shouldDeferPollRoomAutoExpand(pendingAutoExpandRef.current)) {
          syncOfficeRoomPanelSelection(projectId);
        }
      }
      roomMessageCountsRef.current[projectId] = nextCount;
    };

    const tick = async () => {
      if (cancelled) return;
      const liveRunningIds = readExecutingProjectIdsFromStore(
        useOfficeStore.getState().tempProjects,
      );
      if (liveRunningIds.length === 0) return;

      for (const projectId of liveRunningIds) {
        if (cancelled) break;
        await syncProjectRoom(projectId);
      }
      if (cancelled) return;

      lastExecutionProgressAtRef.current = Date.now();
      const idsForProgress = readExecutingProjectIdsFromStore(
        useOfficeStore.getState().tempProjects,
      );
      if (idsForProgress.length > 0) {
        await fetchExecutingProjectsProgress(idsForProgress, {
          notifyReview: false,
          silent: true,
        });
      }
      const state = useOfficeStore.getState();
      const idsAfterProgress = readExecutingProjectIdsFromStore(state.tempProjects);
      for (const projectId of idsAfterProgress) {
        const project = state.tempProjects.find((p) => p.id === projectId);
        const groupId = project?.parentGroupId?.trim() ?? project?.id;
        if (!groupId) continue;
        reconcileActiveProjectAgentStates(groupId, [projectId]);
      }
    };

    void tick();
    const unsubscribe = subscribeHostEvent('office:unified-poll-tick', () => {
      void tick();
    });

    return () => {
      cancelled = true;
      unsubscribe();
      lastExecutionProgressAtRef.current = 0;
    };
  }, [
    shouldPollRooms,
    runningProjectIds,
    fetchExecutingProjectsProgress,
    reconcileActiveProjectAgentStates,
    fetchRoomMessages,
    syncOfficeRoomPanelSelection,
  ]);

  const focusProjectRoom = useCallback((projectId: string | null) => {
    pendingAutoExpandRef.current = null;
    if (projectId === null) {
      const token = bumpRoomPanelToken();
      setExpandedProjectId(null);
      scheduleOfficeRoomPanelDeactivation({
        token,
        tokenRef: roomPanelTokenRef,
        getExpandedProjectId: () => expandedProjectIdRef.current,
        deactivate: () => setActiveRoomProjectId(null),
      });
      return;
    }
    syncOfficeRoomPanelSelection(projectId);
  }, [bumpRoomPanelToken, syncOfficeRoomPanelSelection]);

  const completionPromptProject = useMemo(
    () =>
      completionPromptProjectId
        ? tempProjects.find((p) => p.id === completionPromptProjectId) ?? null
        : null,
    [completionPromptProjectId, tempProjects],
  );

  const workflowReviewAttention = workflowReviewAttentionQueue[0] ?? null;

  useEffect(() => {
    return subscribeWorkflowReviewAttention((event) => {
      setWorkflowReviewAttentionQueue((current) => {
        if (current.some((item) => item.projectId === event.projectId && item.phase === event.phase)) {
          return current;
        }
        return [...current, event];
      });
    });
  }, []);

  const dismissWorkflowReviewAttention = useCallback(() => {
    setWorkflowReviewAttentionQueue((current) => current.slice(1));
  }, []);

  const openWorkflowReviewAttentionProject = useCallback(() => {
    setWorkflowReviewAttentionQueue((queue) => {
      const current = queue[0];
      if (current) focusProjectRoom(current.projectId);
      return queue.slice(1);
    });
  }, [focusProjectRoom]);

  useEffect(() => {
    if (completionPromptProjectId) return;
    const next = tempProjects.find((p) => isOfficeStandaloneAwaitingArchivePrompt(p));
    if (next) setCompletionPromptProjectId(next.id);
  }, [completionPromptProjectId, tempProjects]);

  useEffect(() => {
    if (!completionPromptProjectId) return;
    const project = tempProjects.find((p) => p.id === completionPromptProjectId);
    if (!project || !isOfficeStandaloneAwaitingArchivePrompt(project)) {
      setCompletionPromptProjectId(null);
    }
  }, [completionPromptProjectId, tempProjects]);

  useEffect(() => {
    const target = tempProjects.find(
      (p) => isOfficeFixedGroupProjectAutoArchive(p) && !autoArchiveInFlightRef.current.has(p.id),
    );
    if (!target) return;

    autoArchiveInFlightRef.current.add(target.id);
    void (async () => {
      try {
        try {
          await archiveProject(target.id);
        } catch {
          await archiveProject(target.id);
        }
      } catch {
        try {
          await dismissCompletionFollowUp(target.id);
        } catch {
          // ignore secondary failure
        }
        toast.error(t('projectCompletion.autoArchiveFailed', { name: target.title }));
      } finally {
        autoArchiveInFlightRef.current.delete(target.id);
        bumpRoomPanelToken();
        setExpandedProjectId((current) => (current === target.id ? null : current));
        setActiveRoomProjectId((current) => (current === target.id ? null : current));
      }
    })();
  }, [archiveProject, dismissCompletionFollowUp, t, tempProjects, bumpRoomPanelToken]);

  const toggleProjectRoom = useCallback(
    (projectId: string) => {
      pendingAutoExpandRef.current = null;
      const token = bumpRoomPanelToken();
      setExpandedProjectId((current) => {
        if (current === projectId) {
          scheduleOfficeRoomPanelDeactivation({
            token,
            tokenRef: roomPanelTokenRef,
            getExpandedProjectId: () => expandedProjectIdRef.current,
            deactivate: () => setActiveRoomProjectId(null),
          });
          return null;
        }
        const project = useOfficeStore.getState().tempProjects.find((p) => p.id === projectId);
        prepareProjectExpandPrefetch(
          projectId,
          project ? isOfficeProjectArchived(project) : false,
        );
        setActiveRoomProjectId(projectId);
        return projectId;
      });
    },
    [bumpRoomPanelToken],
  );

  const resolveAgentName = useCallback(
    (id: string) => useAgentsStore.getState().agents.find((a) => a.id === id)?.name,
    [],
  );

  const openTaskCreate = useCallback((options?: TaskCreateOpenOptions) => {
    const agents = useAgentsStore.getState().agents;
    let initial = emptyTaskCreateForm();
    if (options?.origin === 'spawn' && options.groupId) {
      const group = fixedGroups.find((g) => g.id === options.groupId);
      if (group) {
        initial = taskCreateFormFromGroup(group, agents);
      }
    }
    setTaskCreateInitial(initial);
    setTaskCreateOpenOptions(options);
    setTaskCreateKey((k) => k + 1);
    setShowTaskCreate(true);
  }, [fixedGroups]);

  const beginUpgradeFromProject = useCallback(
    (project: OfficeTempProject) => {
      if (isOfficeStandaloneDissolvedUpgrade(project)) {
        if (!confirm(t('upgradeDissolvedProjectConfirm', { name: project.title }))) return;
      }
      setCompletionPromptProjectId(null);
      const initial = groupDraftFromStandaloneProject(project, useAgentsStore.getState().agents);
      setUpgradeSourceProjectId(project.id);
      openGroupWizard(initial);
    },
    [openGroupWizard, t],
  );

  const handleArchiveProject = useCallback(
    (projectId: string, options?: { skipConfirm?: boolean }) => {
      const project = tempProjects.find((p) => p.id === projectId);
      if (!project || isOfficeProjectArchived(project)) return;
      if (isOfficeProjectExecuting(project)) {
        toast.error(t('archiveDisabledRunning'));
        return;
      }
      if (!options?.skipConfirm) {
        const confirmKey =
          project.status === 'completed'
            ? 'archiveConfirmCompleted'
            : 'archiveConfirmIncomplete';
        if (!confirm(t(confirmKey, { name: project.title }))) return;
        // Native confirm can leave document.hasFocus() false on Windows.
        recoverDocumentFocusAfterModalClose();
      }

      void archiveProject(projectId)
        .then(() => {
          setCompletionPromptProjectId((current) => (current === projectId ? null : current));
          bumpRoomPanelToken();
          setExpandedProjectId((current) => (current === projectId ? null : current));
          setActiveRoomProjectId((current) => (current === projectId ? null : current));
          toast.success(t('projectArchived'));
        })
        .catch((e) => toast.error(e instanceof Error ? e.message : String(e)));
    },
    [archiveProject, bumpRoomPanelToken, t, tempProjects],
  );

  const handleRestartProject = useCallback(
    (projectId: string) => {
      void restartProject(projectId)
        .then(({ agentSync }) => {
          toast.success(t('projectRestarted'));
          if (agentSync?.changed) {
            const formatNames = (ids: string[]) =>
              ids.map((id) => resolveAgentName(id) ?? id).join('、');
            const detailParts: string[] = [];
            if (agentSync.addedAgentIds.length > 0) {
              detailParts.push(
                t('archivedRestartAgentSyncAdded', {
                  names: formatNames(agentSync.addedAgentIds),
                }),
              );
            }
            if (agentSync.removedAgentIds.length > 0) {
              detailParts.push(
                t('archivedRestartAgentSyncRemoved', {
                  names: formatNames(agentSync.removedAgentIds),
                }),
              );
            }
            toast.warning(
              t('archivedRestartAgentSync', {
                groupName: agentSync.groupName,
                detail: detailParts.join('；'),
              }),
              { duration: 8000 },
            );
          }
        })
        .catch((e) => toast.error(e instanceof Error ? e.message : String(e)));
    },
    [restartProject, resolveAgentName, t],
  );

  // Delete an archived project: removes its directory + all artifacts on disk and unbinds its
  // agents (confirmation happens in the card before this handler is invoked).
  const handleDeleteArchivedProject = useCallback(
    (projectId: string) => {
      void deleteArchivedProject(projectId)
        .then(() => {
          bumpRoomPanelToken();
          setExpandedProjectId((current) => (current === projectId ? null : current));
          setActiveRoomProjectId((current) => (current === projectId ? null : current));
          toast.success(t('projectDeleted'));
        })
        .catch((e) => toast.error(e instanceof Error ? e.message : String(e)));
    },
    [deleteArchivedProject, bumpRoomPanelToken, t],
  );

  const handleCreateGroup = async (groupWizard: GroupDraft) => {
    if (!groupWizard.name.trim()) {
      toast.error(t('wizard.name'));
      return;
    }
    if (groupWizard.agentIds.length === 0) {
      toast.error(t('agentPool.needAgentsFirst'));
      return;
    }
    if (groupWizard.executionMode === 'workflow') {
      if (groupWizard.workflowOrchestrationMode === 'rule') {
        const draftCheck = validateWorkflowStepDraftRows(groupWizard.workflowStepDrafts, groupWizard.agentIds, {
          minValidRows: 0,
        });
        if (!draftCheck.ok) {
          toastWorkflowStepDraftsError(t, draftCheck);
          return;
        }
      } else if (
        !groupWizard.heuristicWorkflowDescription.trim()
        && groupWizard.workflow.nodes.length === 0
      ) {
        toast.error(t('taskForm.descriptionRequired'));
        return;
      }
    }
    const catalogAgentIds = useAgentsStore.getState().agents.map((a) => a.id);
    const coordinatorAgentId = preserveCoordinatorForSave({
      coordinatorId: groupWizard.coordinatorAgentId,
      agentIds: groupWizard.agentIds,
      catalogAgentIds,
    });
    const groupMembers = projectMembersFromIds(groupWizard.agentIds, resolveAgentName);
    try {
      setSavingGroup(true);
      const workflowPayload = await buildGroupWorkflowSavePayload(
        groupWizard,
        groupMembers,
      );
      if (!workflowPayload.ok) {
        toast.error(t(workflowPayload.errorKey));
        return;
      }
      await createFixedGroup({
        name: groupWizard.name.trim(),
        description: groupWizard.description.trim(),
        agentIds: groupWizard.agentIds,
        coordinatorAgentId,
        executionMode: groupWizard.executionMode,
        workflow: workflowPayload.workflow,
        workflowDescription: workflowPayload.workflowDescription,
        workflowStepDrafts: workflowPayload.workflowStepDrafts,
        workflowOrchestrationMode: workflowPayload.workflowOrchestrationMode,
        upgradeFromProjectId: upgradeSourceProjectId ?? undefined,
      });
      if (upgradeSourceProjectId) {
        setUpgradeSourceProjectId(null);
        toast.success(t('projectUpgraded'));
      } else {
        toast.success(t('wizard.save'));
      }
      closeOfficeModalWithFocusHandoff(() => setShowGroupWizard(false));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSavingGroup(false);
    }
  };

  const prepareProjectWorkflow = async (
    form: TaskCreateFormState,
    agentIds: string[],
    coordinatorAgentId: string,
    opts?: {
      requireWorkflowDescription?: boolean;
      spawnFromGroup?: boolean;
      group?: OfficeFixedGroup | null;
    },
  ) => {
    const requireWorkflowDescription = opts?.requireWorkflowDescription ?? true;
    const spawnFromGroup = opts?.spawnFromGroup ?? false;
    const spawnGroup = opts?.group ?? null;
    let workflow = form.workflow;
    let langGraphWorkflowBundle = form.langGraphWorkflowBundle;
    const executionMode = spawnFromGroup
      ? normalizeGroupExecutionMode(form.executionMode)
      : form.executionMode;
    const teamMembers = projectMembersFromIds(agentIds, resolveAgentName);
    let description = form.description.trim();
    let workflowStepDrafts: WorkflowStepDraftRow[] | undefined = form.workflowStepDrafts;
    let workflowOrchestrationMode = form.workflowOrchestrationMode;
    if (spawnFromGroup && spawnGroup && spawnedProjectOrchestrationModeLocked(spawnGroup)) {
      workflowOrchestrationMode = orchestrationModeFromGroup(spawnGroup);
    }
    const isLangGraph = ENABLE_LANGGRAPH && form.workflowEngine === 'langgraph';
    const showStepDrafts = showWorkflowStepDraftsField({
      executionMode,
      workflowEngine: form.workflowEngine,
      langGraphTab: form.langGraphTab,
      orchestrationMode: workflowOrchestrationMode,
    });
    const showHeuristicDescription = showHeuristicWorkflowDescriptionField({
      executionMode,
      workflowEngine: form.workflowEngine,
      langGraphTab: form.langGraphTab,
      orchestrationMode: workflowOrchestrationMode,
    });

    if (!form.featureDescription.trim()) {
      toast.error(t('taskForm.featureDescriptionRequired'));
      return null;
    }

    if (executionMode === 'workflow' && !isLangGraph) {
      const inheritsUnchangedTemplate =
        spawnFromGroup && shouldInheritGroupWorkflowOnSpawn(form, spawnGroup);
      if (workflowOrchestrationMode === 'rule' && showStepDrafts && !inheritsUnchangedTemplate) {
        const minValidRows = spawnFromGroup ? 1 : 0;
        const draftCheck = validateWorkflowStepDraftRows(form.workflowStepDrafts, agentIds, { minValidRows });
        if (!draftCheck.ok) {
          toastWorkflowStepDraftsError(t, draftCheck);
          return null;
        }
      } else if (
        showHeuristicDescription
        && requireWorkflowDescription
        && !form.heuristicWorkflowDescription.trim()
        && form.workflow.nodes.length === 0
      ) {
        toast.error(t('taskForm.descriptionRequired'));
        return null;
      }
    } else if (showStepDrafts) {
      const minValidRows = spawnFromGroup ? 1 : 0;
      const draftCheck = validateWorkflowStepDraftRows(form.workflowStepDrafts, agentIds, { minValidRows });
      if (!draftCheck.ok) {
        toastWorkflowStepDraftsError(t, draftCheck);
        return null;
      }
      const prepared = prepareWorkflowStepDraftsPayload(form.workflowStepDrafts, teamMembers);
      description = prepared.workflowDescription;
      workflowStepDrafts = prepared.workflowStepDrafts;
    }

    if (
      requireWorkflowDescription &&
      executionMode === 'workflow'
      && isLangGraph
      && langGraphWorkflowDescriptionRequired(form.workflowEngine, form.langGraphTab)
      && !description
      && !hasWorkflowStepDraftContent(workflowStepDrafts)
    ) {
      toast.error(t('taskForm.descriptionRequired'));
      return null;
    }

    if (executionMode === 'workflow') {
      if (isLangGraph) {
        let draftWorkflow = workflow;
        if (form.langGraphTab === 'heuristic' && draftWorkflow.nodes.length === 0) {
          const canGenerate =
            description.trim().length > 0 || hasWorkflowStepDraftContent(workflowStepDrafts);
          if (canGenerate) {
            const ensured = await ensureWorkflowForTaskSave({
              title: form.title,
              featureDescription: form.featureDescription,
              description,
              workflowStepDrafts,
              workflow: draftWorkflow,
              agentIds,
              coordinatorAgentId,
              workflowEngine: form.workflowEngine,
            });
            if (!ensured.ok) {
              toast.error(t(ensured.errorKey));
              return null;
            }
            draftWorkflow = ensured.workflow;
          }
        }
        const prepared = prepareLangGraphTaskSave({
          bundle: langGraphWorkflowBundle,
          activeTab: form.langGraphTab,
          workflow: draftWorkflow,
          description: form.description,
          customJsonDraft: form.langGraphCustomJsonDraft,
          teamRoles: teamMembers,
        });
        if (!prepared.ok) {
          toast.error(
            'parseError' in prepared && prepared.parseError
              ? prepared.parseError
              : t(prepared.errorKey),
          );
          return null;
        }
        workflow = prepared.workflow;
        langGraphWorkflowBundle = prepared.bundle;
      } else {
        const persisted = prepareDagOrchestrationPersistPayload({
          mode: workflowOrchestrationMode,
          workflowStepDrafts: form.workflowStepDrafts,
          heuristicDescription: form.heuristicWorkflowDescription,
          members: teamMembers,
        });
        description = persisted.description;
        workflowStepDrafts = persisted.workflowStepDrafts;
        workflowOrchestrationMode = persisted.workflowOrchestrationMode;
        workflow = syncWorkflowEdges({ ...form.workflow, mode: 'dag' });
        if (workflow.nodes.some((n) => !n.title?.trim())) {
          toast.error(t('workflow.validationNeedTaskNames'));
          return null;
        }
      }
    }

    const workflowEngine: 'dag' | 'langgraph' =
      executionMode === 'workflow'
        ? ENABLE_LANGGRAPH && form.workflowEngine === 'langgraph'
          ? 'langgraph'
          : 'dag'
        : 'dag';

    const inheritGroupWorkflow =
      spawnFromGroup && shouldInheritGroupWorkflowOnSpawn(form, spawnGroup);

    return {
      executionMode,
      description,
      workflowStepDrafts,
      workflowOrchestrationMode,
      workflow:
        executionMode === 'workflow' && !inheritGroupWorkflow ? workflow : undefined,
      inheritGroupWorkflow,
      langGraphWorkflowBundle:
        executionMode === 'workflow' && ENABLE_LANGGRAPH && form.workflowEngine === 'langgraph'
          ? langGraphWorkflowBundle
          : undefined,
      workflowEngine,
    };
  };

  const handleCreateProject = async (meta: TaskCreateSubmitMeta, form: TaskCreateFormState) => {
    const group = meta.group;
    const taskCreateMode = meta.mode;
    const smartSpawn =
      taskCreateMode === 'spawn' && group && fixedGroupExecutionMode(group) === 'smart';
    const agentIds =
      taskCreateMode === 'spawn' && group && !smartSpawn
        ? [...group.agentIds]
        : [...form.agentIds];
    const coordinatorAgentId =
      taskCreateMode === 'spawn' && group && !smartSpawn
        ? group.coordinatorAgentId
        : ensureCoordinatorInTeam(
            form.coordinatorAgentId,
            agentIds,
            agentIds[0] ?? '',
          );

    if (!form.title.trim()) return;
    setCreatingProject(true);
    try {
      const prepared = await prepareProjectWorkflow(form, agentIds, coordinatorAgentId, {
        requireWorkflowDescription: taskCreateMode !== 'spawn',
        spawnFromGroup: taskCreateMode === 'spawn',
        group: taskCreateMode === 'spawn' ? group ?? null : null,
      });
      if (!prepared) return;

      const body = {
        title: form.title.trim(),
        featureDescription: form.featureDescription.trim(),
        description: prepared.description ?? '',
        workflowStepDrafts: prepared.workflowStepDrafts,
        workflowOrchestrationMode: prepared.workflowOrchestrationMode,
        coordinatorAgentId,
        agentIds,
        executionMode: prepared.executionMode,
        workflowEngine: prepared.workflowEngine,
        workflow: prepared.workflow,
        langGraphWorkflowBundle: prepared.langGraphWorkflowBundle,
      };

      if (taskCreateMode === 'spawn' && group) {
        await spawnProjectFromGroup(group.id, body);
      } else {
        await createTempProject(body);
      }

      closeOfficeModalWithFocusHandoff(() => setShowTaskCreate(false));
      toast.success(t('taskForm.create'));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setCreatingProject(false);
    }
  };

  const handleUpdateGroup = useCallback(
    async (editGroup: GroupDraft, editingGroupId: string) => {
      if (editGroup.executionMode === 'workflow') {
        if (editGroup.workflowOrchestrationMode === 'rule') {
          const draftCheck = validateWorkflowStepDraftRows(editGroup.workflowStepDrafts, editGroup.agentIds, {
            minValidRows: 0,
          });
          if (!draftCheck.ok) {
            toastWorkflowStepDraftsError(t, draftCheck);
            return;
          }
        } else if (
          !editGroup.heuristicWorkflowDescription.trim()
          && editGroup.workflow.nodes.length === 0
        ) {
          toast.error(t('taskForm.descriptionRequired'));
          return;
        }
      }
      const catalogAgentIds = useAgentsStore.getState().agents.map((a) => a.id);
      const coordinatorAgentId = preserveCoordinatorForSave({
        coordinatorId: editGroup.coordinatorAgentId,
        agentIds: editGroup.agentIds,
        catalogAgentIds,
      });
      const groupMembers = projectMembersFromIds(editGroup.agentIds, resolveAgentName);
      setSavingGroup(true);
      try {
        const workflowPayload = await buildGroupWorkflowSavePayload(
          editGroup,
          groupMembers,
        );
        if (!workflowPayload.ok) {
          toast.error(t(workflowPayload.errorKey));
          return;
        }
        await updateFixedGroup(editingGroupId, {
          name: editGroup.name.trim(),
          description: editGroup.description.trim(),
          agentIds: editGroup.agentIds,
          coordinatorAgentId,
          workflow: workflowPayload.workflow,
          workflowDescription: workflowPayload.workflowDescription,
          workflowStepDrafts: workflowPayload.workflowStepDrafts,
          workflowOrchestrationMode: workflowPayload.workflowOrchestrationMode,
        });
        closeOfficeModalWithFocusHandoff(() => setGroupEditSession(null));
        toast.success(t('wizard.save'));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setSavingGroup(false);
      }
    },
    [fixedGroups, resolveAgentName, t, updateFixedGroup],
  );

  return (
    <div className={officePageShellClass} data-testid="office-page">
      <header className={officePageHeaderClass}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary shadow-sm ring-1 ring-primary/15">
              <Building2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate font-serif text-lg font-normal tracking-tight text-foreground">
                {t('title')}
              </h1>
              <p className="truncate text-xs text-muted-foreground">{t('subtitle')}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <OfficeStatChip
              icon={<Users className="h-3.5 w-3.5" />}
              value={fixedGroups.length}
              label={t('stats.fixedGroups')}
            />
            <OfficeStatChip
              icon={<FolderKanban className="h-3.5 w-3.5" />}
              value={projectCounts.active}
              label={t('stats.tempProjects')}
            />
            <OfficeStatChip
              icon={<Archive className="h-3.5 w-3.5" />}
              value={projectCounts.archived}
              label={t('stats.archivedProjects')}
              testId="office-stats-archived-projects"
            />
            <div className="mx-0.5 hidden h-5 w-px bg-border/60 sm:block" aria-hidden />
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              data-testid="office-refresh"
              data-gateway-initial-prefetch={gatewayInitialPrefetchUi ? 'true' : 'false'}
              onClick={() => {
                void (async () => {
                  await runOfficeCachePrefetch({ kind: 'manual-full' });
                  void fetchAgentPool();
                })();
              }}
              disabled={loading || cachePrefetchInFlight}
            >
              {gatewayInitialPrefetchUi ? (
                <span
                  className="mr-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.15)]"
                  data-testid="office-refresh-green"
                  aria-hidden
                />
              ) : null}
              <RefreshCw
                className={cn(
                  'mr-1 h-3.5 w-3.5',
                  (loading || cachePrefetchInFlight) && 'animate-spin',
                )}
              />
              {t('refresh')}
            </Button>
          </div>
        </div>
      </header>

      {gatewayStatus.state !== 'running' ? (
        <div
          className="shrink-0 border-b border-amber-500/25 bg-amber-500/10 px-4 py-2 text-center text-xs font-medium text-amber-900 dark:text-amber-200"
          data-testid="office-gateway-banner"
        >
          {t('gatewayRequired')}
        </div>
      ) : null}

      {error ? (
        <div className="shrink-0 border-b border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {officePageBlocked ? (
        <div
          className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-muted-foreground"
          data-testid="office-sync-loading"
        >
          <RefreshCw className="h-8 w-8 animate-spin" />
          <p className="text-sm">{t('loading')}</p>
        </div>
      ) : !isOfficeDraftFormOpen ? (
        <OfficeWorkspaceArea
          t={t}
          expandedProjectId={expandedProjectId}
          activeRoomProjectId={activeRoomProjectId}
          officeSplitContainerRef={officeSplitContainerRef}
          onNewGroup={() => openGroupWizard(emptyGroupDraft())}
          onEditGroup={(group) => {
            setGroupEditSession({
              key: Date.now(),
              groupId: group.id,
              initial: groupDraftFromFixedGroup(group, useAgentsStore.getState().agents),
            });
          }}
          onDeleteGroup={(id) => {
            void deleteFixedGroup(id)
              .then(() => toast.success(t('groupDeleted')))
              .catch((e) => toast.error(e instanceof Error ? e.message : String(e)));
          }}
          onReorderGroups={(orderedIds) => {
            void reorderFixedGroups(orderedIds).catch((e) => {
              toast.error(e instanceof Error ? e.message : String(e));
            });
          }}
          onNewProject={() => openTaskCreate({ origin: 'standalone' })}
          onSpawnProject={(groupId) =>
            openTaskCreate({
              origin: 'spawn',
              groupId,
            })
          }
          onToggleProject={toggleProjectRoom}
          onRunProject={(id, opts) => {
            focusProjectRoom(id);
            void runProject(id, opts).catch((e) => toast.error(String(e)));
          }}
          onEditProject={setEditingProject}
          onAbortProject={(id) => {
            void abortProject(id)
              .then(() => toast.success(t('taskAborted')))
              .catch((e) => toast.error(String(e)));
          }}
          onDeleteProject={(id) => {
            const project = tempProjects.find((x) => x.id === id);
            if (project && isOfficeProjectArchived(project)) {
              toast.error(t('archivedDeleteBlocked'));
              return;
            }
            const msg =
              project?.status === 'running'
                ? t('deleteRunningTaskConfirm')
                : t('deleteTaskConfirm');
            if (!confirm(msg)) return;
            void deleteTempProject(id)
              .then(() => {
                bumpRoomPanelToken();
                setExpandedProjectId((current) => (current === id ? null : current));
                setActiveRoomProjectId((current) => (current === id ? null : current));
                toast.success(t('taskDeleted'));
              })
              .catch((e) => toast.error(e instanceof Error ? e.message : String(e)));
          }}
          onUpgradeProject={(id) => {
            const project = tempProjects.find((p) => p.id === id);
            if (project) beginUpgradeFromProject(project);
          }}
          onArchiveProject={handleArchiveProject}
          onRestartProject={handleRestartProject}
          onDeleteArchivedProject={handleDeleteArchivedProject}
          onPostRoom={async (projectId, content, opts) => {
            focusProjectRoom(projectId);
            await postRoomMessage(projectId, content, opts);
          }}
        />
      ) : (
        <div className="min-h-0 flex-1" aria-hidden data-testid="office-workspace-suspended" />
      )}

      {completionPromptProject ? (
        <ProjectCompletionDialog
          project={completionPromptProject}
          onArchive={() =>
            handleArchiveProject(completionPromptProject.id, { skipConfirm: true })
          }
          onUpgrade={
            completionPromptProject.origin === 'standalone'
              ? () => beginUpgradeFromProject(completionPromptProject)
              : undefined
          }
          onLater={() => {
            void dismissCompletionFollowUp(completionPromptProject.id)
              .then(() => setCompletionPromptProjectId(null))
              .catch((e) => toast.error(e instanceof Error ? e.message : String(e)));
          }}
        />
      ) : null}

      {workflowReviewAttention ? (
        <WorkflowReviewAttentionDialog
          event={workflowReviewAttention}
          onOpenProject={openWorkflowReviewAttentionProject}
          onDismiss={dismissWorkflowReviewAttention}
        />
      ) : null}

      {showGroupWizard ? (
        <GroupFormModal
          key={groupWizardKey}
          t={t}
          title={t('wizard.title')}
          initialDraft={groupWizardInitial}
          agentBindings={agentBindings}
          onClose={() => {
            setShowGroupWizard(false);
            setUpgradeSourceProjectId(null);
          }}
          onSave={(draft) => void handleCreateGroup(draft)}
          saving={savingGroup}
        />
      ) : null}

      {groupEditSession ? (
        <GroupFormModal
          key={groupEditSession.key}
          t={t}
          title={t('editGroup')}
          initialDraft={groupEditSession.initial}
          agentBindings={agentBindings}
          bindingScope={{ kind: 'fixed_group' as const, entityId: groupEditSession.groupId }}
          executionModeLocked
          saving={savingGroup}
          readOnly={tempProjects.some(
            (p) => p.parentGroupId === groupEditSession.groupId && isOfficeProjectExecuting(p),
          )}
          onClose={() => setGroupEditSession(null)}
          onSave={(draft) => void handleUpdateGroup(draft, groupEditSession.groupId)}
        />
      ) : null}

      {showTaskCreate ? (
        <TaskCreateDialog
          key={taskCreateKey}
          open={showTaskCreate}
          openOptions={taskCreateOpenOptions}
          initialForm={taskCreateInitial}
          fixedGroups={fixedGroups}
          agentBindings={agentBindings}
          saving={creatingProject}
          onClose={() => setShowTaskCreate(false)}
          onCreate={(meta, form) => void handleCreateProject(meta, form)}
        />
      ) : null}

      {editingProject ? (
        <TaskEditDialog
          project={editingProject}
          group={
            editingProject.parentGroupId
              ? fixedGroups.find((g) => g.id === editingProject.parentGroupId) ?? null
              : null
          }
          agentBindings={agentBindings}
          agentIds={editingProject.agentIds}
          t={t}
          saving={savingProject}
          readOnly={
            isOfficeProjectExecuting(editingProject)
            || isOfficeProjectArchived(editingProject)
          }
          unsavedCloseMessage={unsavedCloseMessage}
          onClose={() => setEditingProject(null)}
          onSave={async (patch) => {
            setSavingProject(true);
            try {
              const editAgentIds = patch.agentIds ?? editingProject.agentIds;
              const editCoordinatorId =
                patch.coordinatorAgentId ?? editingProject.coordinatorAgentId;
              const editGroup =
                editingProject.parentGroupId
                  ? fixedGroups.find((g) => g.id === editingProject.parentGroupId) ?? null
                  : null;
              const teamMembers = projectMembersFromIds(editAgentIds, resolveAgentName);
              const baselineWorkflowDescription = workflowDescriptionForProject(
                editingProject,
                editGroup,
              );
              const spawnedFromFixedGroup = isFixedGroupSpawnedProject(editingProject, editGroup);
              const saveExecutionMode = spawnedFromFixedGroup
                ? (editGroup ? fixedGroupExecutionMode(editGroup) : taskExecutionMode(editingProject))
                : patch.executionMode;
              const saveWorkflowEngine = spawnedFromFixedGroup
                ? taskWorkflowEngine(editingProject)
                : patch.workflowEngine;
              // Prefer the save-time roster (incl. missing-agent X unbinds on spawned workflow).
              const workflowAgentIds = editAgentIds;
              const workflowCoordinatorId = editCoordinatorId;
              let workflow = patch.workflow;
              let langGraphWorkflowBundle = patch.langGraphWorkflowBundle;
              let description = patch.description;
              let workflowStepDrafts: WorkflowStepDraftRow[] | undefined =
                patch.workflowStepDrafts ?? emptyWorkflowStepDraftRows();
              let workflowOrchestrationMode = patch.workflowOrchestrationMode;
              if (
                spawnedFromFixedGroup
                && editGroup
                && spawnedProjectOrchestrationModeLocked(editGroup)
              ) {
                workflowOrchestrationMode = orchestrationModeFromGroup(editGroup);
              }
              const isLangGraph = ENABLE_LANGGRAPH && saveWorkflowEngine === 'langgraph';
              const showStepDrafts = showWorkflowStepDraftsField({
                executionMode: saveExecutionMode,
                workflowEngine: saveWorkflowEngine,
                langGraphTab: patch.langGraphTab,
                orchestrationMode: workflowOrchestrationMode,
              });
              const showHeuristicDescription = showHeuristicWorkflowDescriptionField({
                executionMode: saveExecutionMode,
                workflowEngine: saveWorkflowEngine,
                langGraphTab: patch.langGraphTab,
                orchestrationMode: workflowOrchestrationMode,
              });
              if (!patch.featureDescription.trim()) {
                toast.error(t('taskForm.featureDescriptionRequired'));
                return;
              }
              if (saveExecutionMode === 'workflow' && !isLangGraph) {
                if (workflowOrchestrationMode === 'rule' && showStepDrafts) {
                  const minValidRows = spawnedFromFixedGroup ? 1 : 0;
                  const draftCheck = validateWorkflowStepDraftRows(
                    patch.workflowStepDrafts ?? [],
                    workflowAgentIds,
                    { minValidRows },
                  );
                  if (!draftCheck.ok) {
                    toastWorkflowStepDraftsError(t, draftCheck);
                    return;
                  }
                } else if (
                  showHeuristicDescription
                  && !patch.heuristicWorkflowDescription.trim()
                  && patch.workflow.nodes.length === 0
                ) {
                  toast.error(t('taskForm.descriptionRequired'));
                  return;
                }
              } else if (showStepDrafts) {
                const minValidRows = spawnedFromFixedGroup ? 1 : 0;
                const draftCheck = validateWorkflowStepDraftRows(
                  patch.workflowStepDrafts ?? [],
                  workflowAgentIds,
                  { minValidRows },
                );
                if (!draftCheck.ok) {
                  toastWorkflowStepDraftsError(t, draftCheck);
                  return;
                }
                const prepared = prepareWorkflowStepDraftsPayload(
                  patch.workflowStepDrafts ?? [],
                  teamMembers,
                );
                description = prepared.workflowDescription;
                workflowStepDrafts = prepared.workflowStepDrafts;
              }
              if (
                saveExecutionMode === 'workflow'
                && isLangGraph
                && langGraphWorkflowDescriptionRequired(saveWorkflowEngine, patch.langGraphTab)
                && !showStepDrafts
                && !isWorkflowDescriptionSatisfied(
                  editingProject,
                  editGroup,
                  description,
                  workflowStepDrafts,
                )
              ) {
                toast.error(t('taskForm.descriptionRequired'));
                return;
              }
              if (saveExecutionMode === 'workflow') {
                if (isLangGraph) {
                  let draftWorkflow = workflow;
                  if (patch.langGraphTab === 'heuristic') {
                    const canGenerate =
                      description.trim().length > 0
                      || hasWorkflowStepDraftContent(workflowStepDrafts)
                      || draftWorkflow.nodes.length > 0;
                    if (canGenerate) {
                      const ensured = await ensureWorkflowForTaskSave({
                        title: patch.title,
                        featureDescription: patch.featureDescription,
                        description,
                        workflowStepDrafts,
                        workflow: draftWorkflow,
                        agentIds: workflowAgentIds,
                        coordinatorAgentId: workflowCoordinatorId,
                        workflowEngine: saveWorkflowEngine,
                        previousDescription: baselineWorkflowDescription,
                        previousWorkflowStepDrafts: editingProject.workflowStepDrafts,
                      });
                      if (!ensured.ok) {
                        toast.error(t(ensured.errorKey));
                        return;
                      }
                      draftWorkflow = ensured.workflow;
                    }
                  }
                  const prepared = prepareLangGraphTaskSave({
                    bundle: langGraphWorkflowBundle,
                    activeTab: patch.langGraphTab,
                    workflow: draftWorkflow,
                    description: patch.description,
                    customJsonDraft: patch.langGraphCustomJsonDraft,
                    teamRoles: teamMembers,
                  });
                  if (!prepared.ok) {
                    toast.error(
                      'parseError' in prepared && prepared.parseError
                        ? prepared.parseError
                        : t(prepared.errorKey),
                    );
                    return;
                  }
                  workflow = prepared.workflow;
                  langGraphWorkflowBundle = prepared.bundle;
                } else {
                  const persisted = prepareDagOrchestrationPersistPayload({
                    mode: workflowOrchestrationMode,
                    workflowStepDrafts: patch.workflowStepDrafts ?? [],
                    heuristicDescription: patch.heuristicWorkflowDescription,
                    members: teamMembers,
                  });
                  description = persisted.description;
                  workflowStepDrafts = persisted.workflowStepDrafts;
                  workflowOrchestrationMode = persisted.workflowOrchestrationMode;
                  workflow = syncWorkflowEdges({ ...patch.workflow, mode: 'dag' });
                  if (workflow.nodes.some((n) => !n.title?.trim())) {
                    toast.error(t('workflow.validationNeedTaskNames'));
                    return;
                  }
                }
              }
              const previousOwns = projectOwnsWorkflow(editingProject);
              const ownershipCompareGroup =
                shouldUseWorkflowFreezeSnapshot(editingProject)
                && editingProject.workflowFreezeSnapshot
                  ? workflowFreezeSnapshotAsCompareGroup(editingProject.workflowFreezeSnapshot)
                  : editGroup;
              const inheritsGroupTemplate =
                ownershipCompareGroup && editingProject.parentGroupId
                  ? projectInheritsGroupTemplateOnSave(ownershipCompareGroup, {
                      parentGroupId: editingProject.parentGroupId,
                      executionMode: saveExecutionMode,
                      description,
                      workflowStepDrafts,
                      workflow: workflow ?? { mode: 'dag', nodes: [], edges: [] },
                      workflowOrchestrationMode,
                      agentIds: editAgentIds,
                      coordinatorAgentId: editCoordinatorId,
                      previousOwnsWorkflow: previousOwns,
                    })
                  : false;
              const ownedPayload =
                !inheritsGroupTemplate && editGroup && spawnedFromFixedGroup
                  ? materializeOwnedWorkflowPayload({
                      workflow: workflow ?? { mode: 'dag', nodes: [], edges: [] },
                      description,
                      workflowStepDrafts,
                      workflowOrchestrationMode,
                      langGraphWorkflowBundle,
                      agentIds: editAgentIds,
                      coordinatorAgentId: editCoordinatorId,
                      // When elevating from a completed freeze, lock/mode source is the freeze
                      // snapshot — not the live group (which may have diverged).
                      group: ownershipCompareGroup ?? editGroup,
                    })
                  : null;
              await updateTempProject(editingProject.id, {
                title: patch.title,
                featureDescription: patch.featureDescription.trim(),
                description: inheritsGroupTemplate
                  ? ''
                  : (ownedPayload?.description ?? description.trim()),
                workflowStepDrafts: inheritsGroupTemplate
                  ? undefined
                  : (ownedPayload?.workflowStepDrafts ?? workflowStepDrafts),
                workflowOrchestrationMode: inheritsGroupTemplate
                  ? undefined
                  : (ownedPayload?.workflowOrchestrationMode ?? workflowOrchestrationMode),
                agentIds: ownedPayload?.agentIds ?? editAgentIds,
                coordinatorAgentId: ownedPayload?.coordinatorAgentId ?? editCoordinatorId,
                executionMode: saveExecutionMode,
                workflowEngine:
                  saveExecutionMode === 'workflow'
                    ? ENABLE_LANGGRAPH && saveWorkflowEngine === 'langgraph'
                      ? 'langgraph'
                      : 'dag'
                    : 'dag',
                workflow:
                  saveExecutionMode === 'workflow'
                    ? inheritsGroupTemplate
                      ? { mode: 'dag', nodes: [], edges: [] }
                      : (ownedPayload?.workflow ?? workflow)
                    : undefined,
                langGraphWorkflowBundle:
                  saveExecutionMode === 'workflow'
                  && ENABLE_LANGGRAPH
                  && saveWorkflowEngine === 'langgraph'
                    ? (inheritsGroupTemplate
                      ? undefined
                      : (ownedPayload?.langGraphWorkflowBundle ?? langGraphWorkflowBundle))
                    : undefined,
                ...(spawnedFromFixedGroup
                  ? {
                      inheritsGroupTemplate,
                      // Elevating to owned clears terminal freeze (JSON null; undefined is dropped).
                      ...(!inheritsGroupTemplate ? { workflowFreezeSnapshot: null as null } : {}),
                    }
                  : {}),
              });
              closeOfficeModalWithFocusHandoff(() => setEditingProject(null));
              toast.success(t('taskForm.save'));
            } catch (e) {
              toast.error(String(e));
            } finally {
              setSavingProject(false);
            }
          }}
        />
      ) : null}
    </div>
  );
}
