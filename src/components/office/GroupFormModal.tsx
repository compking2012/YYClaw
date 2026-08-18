import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentsStore } from '@/stores/agents';
import { isShallowRecordDirty, requestCloseOfficeDraft } from '@/lib/office-unsaved-draft';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AgentPoolPicker } from '@/components/office/AgentPoolPicker';
import { GroupExecutionModeField } from '@/components/office/GroupExecutionModeField';
import { OfficeStructuredWorkflowPanel } from '@/components/office/OfficeStructuredWorkflowPanel';
import { ScenarioWorkflowSection } from '@/components/office/ScenarioWorkflowSection';
import {
  TaskFormDialogShell,
  TaskFormField,
  TaskFormWorkflowSeparator,
} from '@/components/office/TaskFormDialogShell';
import { TaskWorkflowDescriptionField } from '@/components/office/TaskWorkflowDescriptionField';
import { WorkflowOrchestrationModeField } from '@/components/office/WorkflowOrchestrationModeField';
import { WorkflowStepDraftsField } from '@/components/office/WorkflowStepDraftsField';
import { officeFormFieldClass } from '@/lib/office-form-field-styles';
import { projectMembersFromIds } from '@/lib/office-project-members';
import {
  showHeuristicWorkflowDescriptionField,
  showWorkflowOrchestrationModeField,
  showWorkflowStepDraftsField,
  type WorkflowOrchestrationMode,
} from '@/lib/office-workflow-orchestration-mode';
import { orchestrationBaselineSnapshot } from '@/lib/office-orchestration-baseline';
import { resolveDagWorkflowForSave } from '@/lib/office-workflow-preview';
import {
  shouldFlagDagNodesRegeneratedOnSaveResolve,
  shouldMarkPreviewSyncedAfterMissingAgentsGate,
} from '@/lib/office-edit-save-workflow-sync';
import { useOfficeDagWorkflowPreview } from '@/hooks/useOfficeDagWorkflowPreview';
import { emptyWorkflow } from '@/lib/office-workflow-roles';
import { emptyWorkflowStepDraftRows } from '@/lib/office-workflow-step-drafts';
import { filterKnownAgentIds } from '@/lib/office-group-agents';
import {
  applySessionOnlyStripOnSave,
  buildOfficeMissingAgentsModel,
  formatMissingAgentsLabelForIds,
  formatOfficeSaveBlockedMessage,
  mergeAgentNameMaps,
  nameMapFromAgents,
  nodeMissingBadgeByKey,
  preserveCoordinatorForSave,
  stripAgentIdsFromOfficeWorkflowRefs,
  type OfficeAgentRefEntity,
  type SessionStripWorkflowSnapshot,
} from '@/lib/office-missing-agents';
import { toast } from '@/lib/toast';
import type {
  AgentBindingRecord,
  OfficeTaskExecutionMode,
  WorkflowDefinition,
  WorkflowStepDraftRow,
} from '@/types/office';

export type GroupDraft = {
  name: string;
  description: string;
  agentIds: string[];
  coordinatorAgentId: string;
  executionMode: Extract<OfficeTaskExecutionMode, 'smart' | 'workflow'>;
  workflowOrchestrationMode: WorkflowOrchestrationMode;
  heuristicWorkflowDescription: string;
  workflowDescription: string;
  workflowStepDrafts: WorkflowStepDraftRow[];
  workflow: WorkflowDefinition;
  /** Per-step missing agent ids captured before strip-on-open (for warning labels). */
  stepMissingAgentIds?: string[][];
  /** Historical display names for deleted agents. */
  agentNameHints?: Record<string, string>;
  /** Edit-open strip is session-only unless orchestration is edited. */
  sessionStripSnapshot?: SessionStripWorkflowSnapshot;
  /** Pre-strip refs for missing-agents saveGate / node badges. */
  openAgentRefSnapshot?: OfficeAgentRefEntity;
};

export interface GroupFormModalProps {
  t: (k: string) => string;
  title: string;
  initialDraft: GroupDraft;
  agentBindings: Record<string, AgentBindingRecord>;
  bindingScope?: { kind: 'fixed_group'; entityId: string };
  readOnly?: boolean;
  executionModeLocked?: boolean;
  saving?: boolean;
  onClose: () => void;
  onSave: (draft: GroupDraft) => void | Promise<void>;
}

function GroupFormModalInner({
  t,
  title,
  initialDraft,
  agentBindings,
  bindingScope,
  readOnly = false,
  executionModeLocked = false,
  saving: savingProp = false,
  onClose,
  onSave,
}: GroupFormModalProps) {
  const { t: tOffice } = useTranslation('office');
  const agents = useAgentsStore((s) => s.agents);
  const [draft, setDraft] = useState(initialDraft);
  const baselineRef = useRef(initialDraft);
  const [savingLocal, setSavingLocal] = useState(false);
  const saving = savingProp || savingLocal;

  const onPatch = useCallback((patch: Partial<GroupDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  }, []);

  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const handleRequestClose = useCallback(() => {
    requestCloseOfficeDraft({
      dirty: isShallowRecordDirty(draftRef.current, baselineRef.current),
      onClose,
      message: tOffice('unsaved.confirmDiscard'),
    });
  }, [onClose, tOffice]);
  const teamMembers = useMemo(
    () =>
      projectMembersFromIds(
        filterKnownAgentIds(draft.agentIds, agents),
        (id) => agents.find((a) => a.id === id)?.name,
      ),
    [agents, draft.agentIds],
  );
  const knownMemberIds = useMemo(
    () => filterKnownAgentIds(draft.agentIds, agents),
    [agents, draft.agentIds],
  );
  const catalogAgentIds = useMemo(() => agents.map((a) => a.id), [agents]);
  // Keep orphan coordinator while still in roster; do not silently replace for preview/save gen.
  const coordinatorId = useMemo(
    () =>
      preserveCoordinatorForSave({
        coordinatorId: draft.coordinatorAgentId,
        agentIds: draft.agentIds,
        catalogAgentIds,
      }),
    [catalogAgentIds, draft.agentIds, draft.coordinatorAgentId],
  );

  const orchestrationBaseline = useMemo(
    () =>
      orchestrationBaselineSnapshot({
        orchestrationMode: baselineRef.current.workflowOrchestrationMode,
        heuristicDescription: baselineRef.current.heuristicWorkflowDescription,
        workflowStepDrafts: baselineRef.current.workflowStepDrafts,
      }),
    [],
  );

  const dagPreviewCtrl = useOfficeDagWorkflowPreview({
    executionMode: draft.executionMode,
    orchestrationMode: draft.workflowOrchestrationMode,
    workflowStepDrafts: draft.workflowStepDrafts,
    heuristicDescription: draft.heuristicWorkflowDescription,
    workflow: draft.workflow,
    members: teamMembers,
    agentIds: draft.agentIds,
    coordinatorAgentId: coordinatorId,
    taskTitle: draft.name,
    featureDescription: draft.description,
    orchestrationBaseline,
    baselineHasMaterializedWorkflow: baselineRef.current.workflow.nodes.length > 0,
  });

  const willRegenerateOnSave = dagPreviewCtrl.isStale;

  // Once the DAG has been (re)generated at least once, its node ids are fresh
  // (the generator only ever fills from the current known team) — the frozen
  // open-snapshot missing-agent badge is no longer meaningful for those nodes.
  // See `WorkflowVisualPreview`'s `nodesRegenerated` prop.
  const [dagWorkflowRegenerated, setDagWorkflowRegenerated] = useState(false);

  // `workflowOverride` lets handleSave re-evaluate the gate against the
  // just-resolved/regenerated DAG workflow (post `resolveDagWorkflowForSave`),
  // instead of the possibly-stale pre-regenerate `draft.workflow` — this is
  // what makes "fix a step row → save" work without first requiring a manual
  // click on "生成工作流".
  const buildMissingSaveModelFor = useCallback((workflowOverride?: WorkflowDefinition) => {
    const openSnap = draft.openAgentRefSnapshot ?? {
      agentIds: draft.agentIds,
      coordinatorAgentId: draft.coordinatorAgentId,
      workflow: draft.sessionStripSnapshot?.persistedWorkflow,
      workflowStepDrafts: draft.sessionStripSnapshot?.persistedWorkflowStepDrafts,
      agentNameHints: draft.agentNameHints,
    };
    const langGraphActiveSource =
      openSnap.langGraphWorkflowBundle?.activeSource ?? 'heuristic';
    return buildOfficeMissingAgentsModel({
      entity: openSnap,
      currentEntity: {
        agentIds: draft.agentIds,
        // Use form field (may be '' after unbind), not preserveCoordinatorForSave auto-fill.
        coordinatorAgentId: draft.coordinatorAgentId,
        workflow: workflowOverride ?? draft.workflow,
        workflowStepDrafts: draft.workflowStepDrafts,
        langGraphWorkflowBundle: openSnap.langGraphWorkflowBundle,
        agentNameHints: draft.agentNameHints,
      },
      catalogAgentIds: catalogAgentIds,
      langGraphActiveSource: openSnap.langGraphWorkflowBundle
        ? langGraphActiveSource
        : undefined,
    });
  }, [
    catalogAgentIds,
    draft.agentIds,
    draft.agentNameHints,
    draft.coordinatorAgentId,
    draft.openAgentRefSnapshot,
    draft.sessionStripSnapshot,
    draft.workflow,
    draft.workflowStepDrafts,
  ]);
  const missingSaveModel = useMemo(
    () => buildMissingSaveModelFor(),
    [buildMissingSaveModelFor],
  );
  const editGateMissingBadgeByKey = useMemo(
    () => nodeMissingBadgeByKey(missingSaveModel.nodes),
    [missingSaveModel.nodes],
  );

  const handleSave = useCallback(async () => {
    if (saving || readOnly) return;
    setSavingLocal(true);
    try {
      let nextDraft = draftRef.current;
      let forcePersistCurrent = false;
      let resolvedForGate = false;
      if (nextDraft.executionMode === 'workflow') {
        const previousWorkflow = nextDraft.workflow;
        const resolved = await resolveDagWorkflowForSave({
          executionMode: nextDraft.executionMode,
          spawnFromGroup: false,
          orchestration: dagPreviewCtrl.orchestration,
          orchestrationBaseline,
          previewSyncedKey: dagPreviewCtrl.previewSyncedKey,
          workflow: nextDraft.workflow,
          members: teamMembers,
          agentIds: nextDraft.agentIds,
          coordinatorAgentId: coordinatorId,
          taskTitle: nextDraft.name,
          featureDescription: nextDraft.description,
        });
        if (!resolved.ok) {
          toast.error(tOffice(resolved.errorKey));
          return;
        }
        if (willRegenerateOnSave) forcePersistCurrent = true;
        nextDraft = { ...nextDraft, workflow: resolved.workflow };
        resolvedForGate = true;
        // Write back immediately so preview/gate share the resolved DAG. Do NOT
        // markPreviewSynced yet — only after the missing-agents gate clears.
        onPatch({ workflow: resolved.workflow });
        if (shouldFlagDagNodesRegeneratedOnSaveResolve({
          willRegenerateOnSave,
          previousWorkflow,
          resolvedWorkflow: resolved.workflow,
        })) {
          setDagWorkflowRegenerated(true);
        }
      }

      // Missing-agents gate runs post-click, against the resolved workflow.
      const gateModel = buildMissingSaveModelFor(nextDraft.workflow);
      if (gateModel.saveGate === 'block') {
        toast.error(
          formatOfficeSaveBlockedMessage(gateModel.saveBlockReasons, (key) => tOffice(key)),
        );
        return;
      }
      if (gateModel.saveGate === 'confirm') {
        const nameById = mergeAgentNameMaps(draft.agentNameHints, nameMapFromAgents(agents));
        const label = formatMissingAgentsLabelForIds(
          gateModel.confirmMissingIds,
          nameById,
          (key, options) => tOffice(key, options),
        );
        if (!window.confirm(tOffice('missingAgents.confirmSave', { label }))) return;
      }

      if (
        resolvedForGate
        && shouldMarkPreviewSyncedAfterMissingAgentsGate(gateModel.saveGate, true)
      ) {
        dagPreviewCtrl.markPreviewSynced();
      }

      const restored = applySessionOnlyStripOnSave(
        {
          workflow: nextDraft.workflow,
          workflowStepDrafts: nextDraft.workflowStepDrafts,
        },
        nextDraft.sessionStripSnapshot,
        { forcePersistCurrent },
      );
      nextDraft = {
        ...nextDraft,
        workflow: restored.workflow,
        workflowStepDrafts: restored.workflowStepDrafts,
      };
      await onSave(nextDraft);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingLocal(false);
    }
  }, [
    agents,
    buildMissingSaveModelFor,
    coordinatorId,
    dagPreviewCtrl,
    draft.agentNameHints,
    onPatch,
    onSave,
    orchestrationBaseline,
    readOnly,
    saving,
    tOffice,
    teamMembers,
    willRegenerateOnSave,
  ]);

  const dagPreviewBinding = useMemo(
    () => ({
      isStale: dagPreviewCtrl.isStale,
      isPreviewing: dagPreviewCtrl.isPreviewing,
      previewDisabled: saving,
      onPreview: async () => {
        const result = await dagPreviewCtrl.runPreview();
        if (result.ok) {
          onPatch({ workflow: result.workflow });
          setDagWorkflowRegenerated(true);
        }
        return result;
      },
    }),
    [dagPreviewCtrl, onPatch, saving],
  );

  const saveLabel = saving
    ? (willRegenerateOnSave ? tOffice('workflow.generateRunning') : tOffice('taskForm.saving'))
    : t('wizard.save');

  const patchWorkflow = useCallback(
    ({ workflow }: { workflow: WorkflowDefinition }) => onPatch({ workflow }),
    [onPatch],
  );
  const patchWorkflowStepDrafts = useCallback(
    (workflowStepDrafts: WorkflowStepDraftRow[]) => onPatch({ workflowStepDrafts }),
    [onPatch],
  );
  const patchHeuristicDescription = useCallback(
    (heuristicWorkflowDescription: string) => onPatch({ heuristicWorkflowDescription }),
    [onPatch],
  );
  const patchOrchestrationMode = useCallback(
    (workflowOrchestrationMode: WorkflowOrchestrationMode) => onPatch({ workflowOrchestrationMode }),
    [onPatch],
  );
  const patchAgents = useCallback(
    ({
      agentIds,
      coordinatorAgentId: nextCoordinatorId,
      removedAgentIds,
    }: {
      agentIds: string[];
      coordinatorAgentId: string;
      removedAgentIds?: string[];
    }) => {
      if (!removedAgentIds?.length) {
        onPatch({ agentIds, coordinatorAgentId: nextCoordinatorId });
        return;
      }
      const remove = new Set(removedAgentIds);
      setDraft((prev) => {
        const stripped = stripAgentIdsFromOfficeWorkflowRefs(prev, removedAgentIds);
        return {
          ...stripped,
          agentIds,
          coordinatorAgentId: nextCoordinatorId,
          stepMissingAgentIds: (prev.stepMissingAgentIds ?? []).map((ids) =>
            ids.filter((id) => !remove.has(id)),
          ),
        };
      });
    },
    [],
  );
  const patchExecutionMode = useCallback(
    (executionMode: Extract<OfficeTaskExecutionMode, 'smart' | 'workflow'>) => {
      if (executionMode === 'smart') {
        onPatch({
          executionMode,
          workflow: emptyWorkflow('dag'),
          workflowDescription: '',
          heuristicWorkflowDescription: '',
          workflowStepDrafts: emptyWorkflowStepDraftRows(),
        });
        return;
      }
      onPatch({ executionMode });
    },
    [onPatch],
  );

  const showWorkflowSection = draft.agentIds.length > 0 && draft.executionMode === 'workflow';
  const structuredRuleMode =
    draft.workflowOrchestrationMode === 'rule'
    && showWorkflowStepDraftsField({
      executionMode: draft.executionMode,
      workflowEngine: 'dag',
      orchestrationMode: draft.workflowOrchestrationMode,
    });
  const previewBusy = saving || dagPreviewCtrl.isPreviewing;

  return (
    <TaskFormDialogShell
      testId="office-group-form"
      size={draft.executionMode === 'workflow' ? 'tall' : 'default'}
      title={(
        <>
          {title}
          {readOnly ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-sans font-normal text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
              {t('viewOnlyRunning')}
            </span>
          ) : null}
        </>
      )}
      onClose={handleRequestClose}
      footer={(
        <>
          <Button variant="outline" onClick={handleRequestClose} disabled={saving}>
            {readOnly ? t('close') : t('wizard.cancel')}
          </Button>
          {readOnly ? null : (
            <Button
              data-testid="office-group-form-save"
              disabled={previewBusy}
              onClick={() => void handleSave()}
            >
              {saveLabel}
            </Button>
          )}
        </>
      )}
    >
      <div className="space-y-4">
        <TaskFormField>
          <Label htmlFor="office-group-name">{t('wizard.name')}</Label>
          <Input
            id="office-group-name"
            placeholder={t('wizard.name')}
            value={draft.name}
            disabled={readOnly}
            className={officeFormFieldClass('h-9')}
            onChange={(e) => onPatch({ name: e.target.value })}
          />
        </TaskFormField>
        <TaskFormField>
          <Label htmlFor="office-group-description">{t('wizard.description')}</Label>
          <Textarea
            id="office-group-description"
            placeholder={t('wizard.description')}
            value={draft.description}
            disabled={readOnly}
            className={officeFormFieldClass('min-h-[4.5rem] resize-y')}
            rows={2}
            onChange={(e) => onPatch({ description: e.target.value })}
          />
        </TaskFormField>
        <AgentPoolPicker
          agents={agents}
          selectedAgentIds={draft.agentIds}
          coordinatorAgentId={draft.coordinatorAgentId}
          agentBindings={agentBindings}
          bindingScope={bindingScope}
          agentNameHints={draft.agentNameHints}
          disabled={readOnly}
          layout="split"
          onChange={patchAgents}
        />
        <TaskFormWorkflowSeparator />
        <GroupExecutionModeField
          value={draft.executionMode}
          disabled={readOnly}
          locked={executionModeLocked || readOnly}
          onChange={patchExecutionMode}
        />
        {showWorkflowSection ? (
          <div className="office-form-scroll-section space-y-4">
            {showWorkflowOrchestrationModeField({
              executionMode: draft.executionMode,
              workflowEngine: 'dag',
            }) ? (
              <WorkflowOrchestrationModeField
                value={draft.workflowOrchestrationMode}
                disabled={readOnly}
                onChange={patchOrchestrationMode}
              />
            ) : null}
            {showHeuristicWorkflowDescriptionField({
              executionMode: draft.executionMode,
              workflowEngine: 'dag',
              orchestrationMode: draft.workflowOrchestrationMode,
            }) ? (
              <TaskWorkflowDescriptionField
                executionMode="workflow"
                value={draft.heuristicWorkflowDescription}
                disabled={readOnly}
                id="office-group-heuristic-workflow-desc"
                testId="office-group-heuristic-workflow-desc"
                onChange={patchHeuristicDescription}
              />
            ) : null}
            {structuredRuleMode ? (
              <OfficeStructuredWorkflowPanel
                stepDrafts={(
                  <WorkflowStepDraftsField
                    rows={draft.workflowStepDrafts}
                    memberAgentIds={knownMemberIds}
                    agents={agents}
                    disabled={readOnly}
                    embedded
                    testId="office-group-workflow-step-drafts"
                    stepMissingAgentIds={draft.stepMissingAgentIds}
                    agentNameHints={draft.agentNameHints}
                    onClearStepMissing={(index) =>
                      setDraft((prev) => ({
                        ...prev,
                        stepMissingAgentIds: (prev.stepMissingAgentIds ?? []).map((ids, i) =>
                          (i === index ? [] : ids),
                        ),
                      }))
                    }
                    onRemoveStepMissing={(index) =>
                      setDraft((prev) => ({
                        ...prev,
                        stepMissingAgentIds: (prev.stepMissingAgentIds ?? []).filter((_, i) => i !== index),
                      }))
                    }
                    onChange={patchWorkflowStepDrafts}
                  />
                )}
                preview={(
                  <ScenarioWorkflowSection
                    workflow={draft.workflow}
                    teamMembers={teamMembers}
                    agentIds={draft.agentIds}
                    coordinatorAgentId={coordinatorId}
                    taskDescription=""
                    workflowStepDrafts={draft.workflowStepDrafts}
                    structuredOrchestration
                    embedded
                    sectionHintKey="workflow.sectionHintStructured"
                    disabled={readOnly}
                    orchestrationMode={draft.workflowOrchestrationMode}
                    dagPreview={dagPreviewBinding}
                    onChange={patchWorkflow}
                    editGateMissingBadgeByKey={editGateMissingBadgeByKey}
                    nodesRegenerated={dagWorkflowRegenerated}
                  />
                )}
              />
            ) : (
              <ScenarioWorkflowSection
                workflow={draft.workflow}
                teamMembers={teamMembers}
                agentIds={draft.agentIds}
                coordinatorAgentId={coordinatorId}
                taskDescription={
                  draft.workflowOrchestrationMode === 'heuristic'
                    ? draft.heuristicWorkflowDescription
                    : ''
                }
                workflowStepDrafts={
                  draft.workflowOrchestrationMode === 'rule' ? draft.workflowStepDrafts : undefined
                }
                structuredOrchestration={draft.workflowOrchestrationMode === 'rule'}
                sectionHintKey={
                  draft.workflowOrchestrationMode === 'rule'
                    ? 'workflow.sectionHintStructured'
                    : undefined
                }
                disabled={readOnly}
                orchestrationMode={draft.workflowOrchestrationMode}
                dagPreview={dagPreviewBinding}
                onChange={patchWorkflow}
                editGateMissingBadgeByKey={editGateMissingBadgeByKey}
                nodesRegenerated={dagWorkflowRegenerated}
              />
            )}
          </div>
        ) : null}
      </div>
    </TaskFormDialogShell>
  );
}

export const GroupFormModal = memo(GroupFormModalInner);
