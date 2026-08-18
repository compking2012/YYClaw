import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildOrchestrationInputKey,
  initialPreviewSyncedKey,
  isOrchestrationPreviewStale,
  type OrchestrationInputSnapshot,
} from '@/lib/office-workflow-preview-state';
import { previewDagWorkflow } from '@/lib/office-workflow-preview';
import type { ProjectAgentRef } from '@/lib/office-workflow-node';
import type { OfficeTaskExecutionMode, WorkflowDefinition, WorkflowStepDraftRow } from '@/types/office';
import type { WorkflowOrchestrationMode } from '@/lib/office-workflow-orchestration-mode';

export type UseOfficeDagWorkflowPreviewParams = {
  executionMode: OfficeTaskExecutionMode;
  orchestrationMode: WorkflowOrchestrationMode;
  workflowStepDrafts: WorkflowStepDraftRow[];
  heuristicDescription: string;
  workflow: WorkflowDefinition;
  members: ProjectAgentRef[];
  agentIds: string[];
  coordinatorAgentId?: string;
  taskTitle?: string;
  featureDescription?: string;
  /** Snapshot when the form was opened (edit) or empty (create). */
  orchestrationBaseline: OrchestrationInputSnapshot;
  /** Whether the project/group already had a materialized workflow when the form opened. */
  baselineHasMaterializedWorkflow?: boolean;
  enabled?: boolean;
};

export function useOfficeDagWorkflowPreview(params: UseOfficeDagWorkflowPreviewParams) {
  const enabled = params.enabled ?? params.executionMode === 'workflow';
  const orchestration = useMemo(
    (): OrchestrationInputSnapshot => ({
      orchestrationMode: params.orchestrationMode,
      workflowStepDrafts: params.workflowStepDrafts,
      heuristicDescription: params.heuristicDescription,
    }),
    [
      params.orchestrationMode,
      params.workflowStepDrafts,
      params.heuristicDescription,
    ],
  );

  const baselineHasMaterializedWorkflow = params.baselineHasMaterializedWorkflow === true;

  const [previewSyncedKey, setPreviewSyncedKey] = useState<string | null>(() =>
    initialPreviewSyncedKey({
      orchestration: params.orchestrationBaseline,
      hasMaterializedWorkflow: baselineHasMaterializedWorkflow,
    }),
  );
  const [isPreviewing, setIsPreviewing] = useState(false);
  const previewLockRef = useRef(false);

  const currentKey = useMemo(
    () => buildOrchestrationInputKey(orchestration),
    [orchestration],
  );

  const baselineKey = useMemo(
    () => buildOrchestrationInputKey(params.orchestrationBaseline),
    [params.orchestrationBaseline],
  );

  useEffect(() => {
    setPreviewSyncedKey(
      initialPreviewSyncedKey({
        orchestration: params.orchestrationBaseline,
        hasMaterializedWorkflow: baselineHasMaterializedWorkflow,
      }),
    );
  }, [baselineKey, baselineHasMaterializedWorkflow, params.orchestrationBaseline]);

  const isStale = useMemo(
    () => enabled && isOrchestrationPreviewStale(previewSyncedKey, orchestration),
    [enabled, orchestration, previewSyncedKey],
  );

  const runPreview = useCallback(async (): Promise<
    | { ok: true; workflow: WorkflowDefinition }
    | { ok: false; errorKey: string }
  > => {
    if (!enabled || previewLockRef.current) {
      return { ok: false, errorKey: 'workflow.previewBusy' };
    }
    previewLockRef.current = true;
    setIsPreviewing(true);
    try {
      const result = await previewDagWorkflow({
        orchestrationMode: params.orchestrationMode,
        workflowStepDrafts: params.workflowStepDrafts,
        heuristicDescription: params.heuristicDescription,
        workflow: params.workflow,
        members: params.members,
        agentIds: params.agentIds,
        coordinatorAgentId: params.coordinatorAgentId,
        taskTitle: params.taskTitle,
        featureDescription: params.featureDescription,
      });
      if (!result.ok) return result;
      setPreviewSyncedKey(currentKey);
      return { ok: true, workflow: result.workflow };
    } finally {
      previewLockRef.current = false;
      setIsPreviewing(false);
    }
  }, [
    currentKey,
    enabled,
    params.agentIds,
    params.coordinatorAgentId,
    params.featureDescription,
    params.heuristicDescription,
    params.members,
    params.orchestrationMode,
    params.taskTitle,
    params.workflow,
    params.workflowStepDrafts,
  ]);

  const markPreviewSynced = useCallback((key?: string) => {
    setPreviewSyncedKey(key ?? currentKey);
  }, [currentKey]);

  return {
    orchestration,
    currentKey,
    previewSyncedKey,
    isStale,
    isPreviewing,
    runPreview,
    markPreviewSynced,
    setPreviewSyncedKey,
  };
}

export type OfficeDagWorkflowPreviewController = ReturnType<typeof useOfficeDagWorkflowPreview>;
