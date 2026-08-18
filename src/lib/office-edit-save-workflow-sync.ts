import type { OfficeEditSaveGate } from '@/lib/office-missing-agents';
import type { WorkflowDefinition } from '@/types/office';

/**
 * Edit-save sequencing after `resolveDagWorkflowForSave` + missing-agents gate.
 *
 * Globally optimal policy (shared by TaskEditDialog / GroupFormModal):
 * 1. Always write the resolved workflow back into form state immediately so the
 *    preview and the gate evaluate the same DAG (and so a later Save that hits
 *    the `previewSyncedKey === currentKey` reuse path still has healthy nodes).
 * 2. Call `markPreviewSynced` ONLY after the missing-agents gate has cleared
 *    (`allow`, or user accepted `confirm`). On `block` toast / confirm cancel,
 *    leave `previewSyncedKey` untouched so the next Save can regenerate again
 *    if write-back were somehow skipped (defense in depth).
 */
export function shouldMarkPreviewSyncedAfterMissingAgentsGate(
  saveGate: OfficeEditSaveGate,
  confirmAccepted = true,
): boolean {
  if (saveGate === 'block') return false;
  if (saveGate === 'confirm') return confirmAccepted;
  return true;
}

/** True when resolved DAG should refresh the live preview "nodes regenerated" badge mode. */
export function shouldFlagDagNodesRegeneratedOnSaveResolve(params: {
  willRegenerateOnSave: boolean;
  previousWorkflow: WorkflowDefinition;
  resolvedWorkflow: WorkflowDefinition;
}): boolean {
  if (params.willRegenerateOnSave) return true;
  // Defensive: treat structural replacement as regenerated even if isStale raced.
  return params.previousWorkflow !== params.resolvedWorkflow
    && (
      params.previousWorkflow.nodes.length !== params.resolvedWorkflow.nodes.length
      || params.previousWorkflow.nodes.some((node, i) => {
        const next = params.resolvedWorkflow.nodes[i];
        return !next || next.id !== node.id || next.agentId !== node.agentId;
      })
    );
}
