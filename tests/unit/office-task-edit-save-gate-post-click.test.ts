/**
 * Regression: fixing a step row's missing agent must not require the user to
 * click "预览工作流" before Save becomes usable, and the missing-agents
 * save gate must be evaluated against the freshly (auto-)regenerated DAG
 * workflow — not the stale pre-regenerate `form.workflow` snapshot.
 *
 * Also covers the Medium fix: do NOT markPreviewSynced until the missing
 * gate clears; always write the resolved workflow back so a later Save that
 * reuses `previewSyncedKey === currentKey` still sees healthy nodes.
 */
import { describe, expect, it } from 'vitest';
import { resolveDagWorkflowForSave } from '@/lib/office-workflow-preview';
import { buildOrchestrationInputKey } from '@/lib/office-workflow-preview-state';
import { buildOfficeMissingAgentsModel } from '@/lib/office-missing-agents';
import {
  shouldFlagDagNodesRegeneratedOnSaveResolve,
  shouldMarkPreviewSyncedAfterMissingAgentsGate,
} from '@/lib/office-edit-save-workflow-sync';
import type { OrchestrationInputSnapshot } from '@/lib/office-workflow-preview-state';
import type { ProjectAgentRef } from '@/lib/office-workflow-node';
import type { WorkflowDefinition } from '@/types/office';

const CATALOG = ['pm', 'dev'];
const MEMBERS: ProjectAgentRef[] = [
  { agentId: 'pm', displayName: 'PM' },
  { agentId: 'dev', displayName: 'Dev' },
];

function wf(nodes: WorkflowDefinition['nodes']): WorkflowDefinition {
  return { mode: 'dag', nodes, edges: [] };
}

describe('save gate is evaluated against the resolved (auto-regenerated) workflow, not the stale one', () => {
  it('BEFORE the fix would wrongly stay blocked: evaluating against stale form.workflow', () => {
    const openSnap = {
      agentIds: ['pm', 'ghost'],
      coordinatorAgentId: 'pm',
      workflow: wf([{ id: 'n1', agentId: 'ghost', execution: 'serial' as const }]),
      workflowStepDrafts: [
        { input: '', agentIds: ['ghost'], task: '步骤', output: '', linkMode: 'serial' as const },
      ],
    };
    const staleFormWorkflow = wf([{ id: 'n1', agentId: '', execution: 'serial' as const }]);
    const model = buildOfficeMissingAgentsModel({
      entity: openSnap,
      currentEntity: {
        agentIds: ['pm', 'dev'],
        coordinatorAgentId: 'pm',
        workflow: staleFormWorkflow,
        workflowStepDrafts: [
          { input: '', agentIds: ['dev'], task: '步骤', output: '', linkMode: 'serial' as const },
        ],
      },
      catalogAgentIds: CATALOG,
    });
    expect(model.saveGate).toBe('block');
  });

  it('FIX: resolve/regenerate the workflow first, then evaluate the gate → no longer block', async () => {
    const openSnap = {
      agentIds: ['pm', 'ghost'],
      coordinatorAgentId: 'pm',
      workflow: wf([{ id: 'n1', agentId: 'ghost', execution: 'serial' as const }]),
      workflowStepDrafts: [
        { input: '', agentIds: ['ghost'], task: '步骤', output: '', linkMode: 'serial' as const },
      ],
    };
    const fixedStepDrafts = [
      { input: '', agentIds: ['dev'], task: '步骤', output: '', linkMode: 'serial' as const },
    ];
    const orchestrationBaseline: OrchestrationInputSnapshot = {
      orchestrationMode: 'rule',
      workflowStepDrafts: openSnap.workflowStepDrafts,
      heuristicDescription: '',
    };
    const orchestration: OrchestrationInputSnapshot = {
      orchestrationMode: 'rule',
      workflowStepDrafts: fixedStepDrafts,
      heuristicDescription: '',
    };

    const resolved = await resolveDagWorkflowForSave({
      executionMode: 'workflow',
      spawnFromGroup: false,
      orchestration,
      orchestrationBaseline,
      previewSyncedKey: null,
      workflow: wf([{ id: 'n1', agentId: '', execution: 'serial' as const }]),
      members: MEMBERS,
      agentIds: ['pm', 'dev'],
      coordinatorAgentId: 'pm',
      taskTitle: '任务',
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.workflow.nodes.some((n) => n.agentId === 'dev' || n.agentIds?.includes('dev'))).toBe(true);

    const model = buildOfficeMissingAgentsModel({
      entity: openSnap,
      currentEntity: {
        agentIds: ['pm', 'dev'],
        coordinatorAgentId: 'pm',
        workflow: resolved.workflow,
        workflowStepDrafts: fixedStepDrafts,
      },
      catalogAgentIds: CATALOG,
    });
    expect(model.saveGate).not.toBe('block');
    expect(model.saveBlockReasons).not.toContain('empty_node');
  });
});

describe('markPreviewSynced only after missing-agents gate clears (Medium fix)', () => {
  it('policy: block / confirm-cancel must not mark synced; allow / confirm-accept must', () => {
    expect(shouldMarkPreviewSyncedAfterMissingAgentsGate('block')).toBe(false);
    expect(shouldMarkPreviewSyncedAfterMissingAgentsGate('confirm', false)).toBe(false);
    expect(shouldMarkPreviewSyncedAfterMissingAgentsGate('confirm', true)).toBe(true);
    expect(shouldMarkPreviewSyncedAfterMissingAgentsGate('allow')).toBe(true);
  });

  it('BUG REPRO: premature sync + stale empty form.workflow → second resolve reuses empty nodes', async () => {
    const fixedStepDrafts = [
      { input: '', agentIds: ['dev'], task: '步骤', output: '', linkMode: 'serial' as const },
    ];
    const orchestrationBaseline: OrchestrationInputSnapshot = {
      orchestrationMode: 'rule',
      workflowStepDrafts: [
        { input: '', agentIds: ['ghost'], task: '步骤', output: '', linkMode: 'serial' as const },
      ],
      heuristicDescription: '',
    };
    const orchestration: OrchestrationInputSnapshot = {
      orchestrationMode: 'rule',
      workflowStepDrafts: fixedStepDrafts,
      heuristicDescription: '',
    };
    const staleEmpty = wf([{ id: 'n1', agentId: '', execution: 'serial' as const }]);

    const first = await resolveDagWorkflowForSave({
      executionMode: 'workflow',
      spawnFromGroup: false,
      orchestration,
      orchestrationBaseline,
      previewSyncedKey: null,
      workflow: staleEmpty,
      members: MEMBERS,
      agentIds: ['pm', 'dev'],
      coordinatorAgentId: 'pm',
      taskTitle: '任务',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.workflow.nodes.some((n) => n.agentId === 'dev' || n.agentIds?.includes('dev'))).toBe(true);

    // Old bug: markSynced immediately, leave form.workflow as staleEmpty, then Save again.
    const prematureSyncedKey = buildOrchestrationInputKey(orchestration);
    const secondBuggy = await resolveDagWorkflowForSave({
      executionMode: 'workflow',
      spawnFromGroup: false,
      orchestration,
      orchestrationBaseline,
      previewSyncedKey: prematureSyncedKey,
      workflow: staleEmpty,
      members: MEMBERS,
      agentIds: ['pm', 'dev'],
      coordinatorAgentId: 'pm',
      taskTitle: '任务',
    });
    expect(secondBuggy.ok).toBe(true);
    if (!secondBuggy.ok) return;
    expect(secondBuggy.workflow.nodes.every((n) => !n.agentId?.trim())).toBe(true);

    // Fix path A: write resolved workflow back before any later reuse.
    const secondWrittenBack = await resolveDagWorkflowForSave({
      executionMode: 'workflow',
      spawnFromGroup: false,
      orchestration,
      orchestrationBaseline,
      previewSyncedKey: prematureSyncedKey,
      workflow: first.workflow,
      members: MEMBERS,
      agentIds: ['pm', 'dev'],
      coordinatorAgentId: 'pm',
      taskTitle: '任务',
    });
    expect(secondWrittenBack.ok).toBe(true);
    if (!secondWrittenBack.ok) return;
    expect(
      secondWrittenBack.workflow.nodes.some((n) => n.agentId === 'dev' || n.agentIds?.includes('dev')),
    ).toBe(true);

    // Fix path B: do not markSynced on gate abort → next Save regenerates again.
    const secondNoSync = await resolveDagWorkflowForSave({
      executionMode: 'workflow',
      spawnFromGroup: false,
      orchestration,
      orchestrationBaseline,
      previewSyncedKey: null,
      workflow: staleEmpty,
      members: MEMBERS,
      agentIds: ['pm', 'dev'],
      coordinatorAgentId: 'pm',
      taskTitle: '任务',
    });
    expect(secondNoSync.ok).toBe(true);
    if (!secondNoSync.ok) return;
    expect(
      secondNoSync.workflow.nodes.some((n) => n.agentId === 'dev' || n.agentIds?.includes('dev')),
    ).toBe(true);
  });

  it('save-resolve that regenerates should flag nodesRegenerated', () => {
    const previous = wf([{ id: 'n1', agentId: '', execution: 'serial' }]);
    const resolved = wf([{ id: 'gen-0', agentId: 'dev', execution: 'serial' }]);
    expect(shouldFlagDagNodesRegeneratedOnSaveResolve({
      willRegenerateOnSave: true,
      previousWorkflow: previous,
      resolvedWorkflow: resolved,
    })).toBe(true);
    expect(shouldFlagDagNodesRegeneratedOnSaveResolve({
      willRegenerateOnSave: false,
      previousWorkflow: previous,
      resolvedWorkflow: previous,
    })).toBe(false);
  });
});
