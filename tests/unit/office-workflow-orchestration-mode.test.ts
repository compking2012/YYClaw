import { orchestrationBaselineSnapshot } from '@/lib/office-orchestration-baseline';
import { buildOrchestrationInputKey } from '@/lib/office-workflow-preview-state';
import {
  orchestrationContentChanged,
  orchestrationTemplateKey,
  orchestrationWillRegenerateOnSave,
  prepareDagOrchestrationForSave,
  prepareDagOrchestrationPersistPayload,
  resolveWorkflowOrchestrationMode,
} from '@/lib/office-workflow-orchestration-mode';
import { shouldInheritGroupWorkflowOnSpawn as shouldInheritFromTaskWorkflow } from '@/lib/office-task-workflow';
import { emptyWorkflow } from '@/lib/office-workflow-roles';
import { emptyWorkflowStepDraftRow } from '@/lib/office-workflow-step-drafts';

const members = [{ agentId: 'a1', name: 'Alice' }];

describe('office-workflow-orchestration-mode', () => {
  it('resolveWorkflowOrchestrationMode prefers stored mode', () => {
    expect(resolveWorkflowOrchestrationMode('heuristic')).toBe('heuristic');
    expect(resolveWorkflowOrchestrationMode('rule')).toBe('rule');
  });

  it('resolveWorkflowOrchestrationMode infers from legacy data', () => {
    expect(
      resolveWorkflowOrchestrationMode(undefined, {
        workflowStepDrafts: [{ ...emptyWorkflowStepDraftRow(), task: 'Do work', agentIds: ['a1'] }],
      }),
    ).toBe('rule');
    expect(
      resolveWorkflowOrchestrationMode(undefined, {
        workflowDescription: 'Describe flow',
      }),
    ).toBe('heuristic');
  });

  it('prepareDagOrchestrationPersistPayload keeps only active mode data', () => {
    const rule = prepareDagOrchestrationPersistPayload({
      mode: 'rule',
      workflowStepDrafts: [{ ...emptyWorkflowStepDraftRow(), task: 'Step', agentIds: ['a1'] }],
      heuristicDescription: 'ignored',
      members,
    });
    expect(rule.workflowOrchestrationMode).toBe('rule');
    expect(rule.workflowStepDrafts?.length).toBe(1);
    expect(rule.workflowDescription).toBeUndefined();
    expect(rule.description).toBe('');

    const heuristic = prepareDagOrchestrationPersistPayload({
      mode: 'heuristic',
      workflowStepDrafts: [{ ...emptyWorkflowStepDraftRow(), task: 'ignored', agentIds: ['a1'] }],
      heuristicDescription: ' LLM flow ',
      members,
    });
    expect(heuristic.workflowOrchestrationMode).toBe('heuristic');
    expect(heuristic.workflowStepDrafts).toBeUndefined();
    expect(heuristic.description).toBe('LLM flow');
  });

  it('orchestrationContentChanged detects rule draft edits', () => {
    const row = { ...emptyWorkflowStepDraftRow(), task: 'Step', agentIds: ['a1'] };
    expect(
      orchestrationContentChanged({
        orchestrationMode: 'rule',
        workflowStepDrafts: [row],
        heuristicDescription: '',
        previousOrchestrationMode: 'rule',
        previousWorkflowStepDrafts: [{ ...row, task: 'Old' }],
      }),
    ).toBe(true);
    expect(
      orchestrationContentChanged({
        orchestrationMode: 'rule',
        workflowStepDrafts: [row],
        heuristicDescription: '',
        previousOrchestrationMode: 'rule',
        previousWorkflowStepDrafts: [row],
      }),
    ).toBe(false);
  });

  it('prepareDagOrchestrationForSave skips rule regeneration when drafts unchanged', async () => {
    const row = { ...emptyWorkflowStepDraftRow(), task: 'Step', agentIds: ['a1'] };
    const workflow = {
      mode: 'dag' as const,
      nodes: [{ id: 'n1', title: 'Step', agentIds: ['a1'] }],
      edges: [],
    };
    const orchestrationBaseline = orchestrationBaselineSnapshot({
      orchestrationMode: 'rule',
      workflowStepDrafts: [row],
    });
    const result = await prepareDagOrchestrationForSave({
      orchestrationMode: 'rule',
      workflowStepDrafts: [row],
      heuristicDescription: '',
      members,
      workflow,
      title: 'Group',
      featureDescription: 'Feature',
      agentIds: ['a1'],
      coordinatorAgentId: 'a1',
      orchestrationBaseline,
      previewSyncedKey: buildOrchestrationInputKey(orchestrationBaseline),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workflow.nodes[0]?.title).toBe('Step');
    }
  });

  it('prepareDagOrchestrationForSave skips heuristic regeneration when description unchanged', async () => {
    const workflow = {
      mode: 'dag' as const,
      nodes: [{ id: 'n1', title: 'Step', agentIds: ['a1'] }],
      edges: [],
    };
    const orchestrationBaseline = orchestrationBaselineSnapshot({
      orchestrationMode: 'heuristic',
      heuristicDescription: 'Build a game',
    });
    const result = await prepareDagOrchestrationForSave({
      orchestrationMode: 'heuristic',
      workflowStepDrafts: [],
      heuristicDescription: 'Build a game',
      members,
      workflow,
      title: 'Group',
      featureDescription: 'Feature',
      agentIds: ['a1'],
      coordinatorAgentId: 'a1',
      orchestrationBaseline,
      previewSyncedKey: buildOrchestrationInputKey(orchestrationBaseline),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workflow.nodes[0]?.title).toBe('Step');
    }
  });

  it('orchestrationWillRegenerateOnSave is true when heuristic description changes', () => {
    expect(
      orchestrationWillRegenerateOnSave({
        executionMode: 'workflow',
        orchestrationMode: 'heuristic',
        workflowStepDrafts: [],
        heuristicDescription: 'New flow',
        workflow: emptyWorkflow('dag'),
        previousOrchestrationMode: 'heuristic',
        previousDescription: 'Old flow',
      }),
    ).toBe(true);
    expect(
      orchestrationWillRegenerateOnSave({
        executionMode: 'workflow',
        orchestrationMode: 'heuristic',
        workflowStepDrafts: [],
        heuristicDescription: 'Same flow',
        workflow: { mode: 'dag', nodes: [{ id: 'n1', title: 'Step', agentIds: ['a1'] }], edges: [] },
        previousOrchestrationMode: 'heuristic',
        previousDescription: 'Same flow',
      }),
    ).toBe(false);
  });

  it('orchestrationTemplateKey distinguishes rule and heuristic templates', () => {
    const ruleKey = orchestrationTemplateKey({
      workflowOrchestrationMode: 'rule',
      workflowStepDrafts: [{ ...emptyWorkflowStepDraftRow(), task: 'A', agentIds: ['a1'] }],
    });
    const heuristicKey = orchestrationTemplateKey({
      workflowOrchestrationMode: 'heuristic',
      workflowDescription: 'Natural language',
    });
    expect(ruleKey.startsWith('rule:')).toBe(true);
    expect(heuristicKey).toBe('heuristic:Natural language');
    expect(ruleKey).not.toBe(heuristicKey);
  });
});

describe('shouldInheritGroupWorkflowOnSpawn with orchestration mode', () => {
  it('returns true for empty spawn payload in rule mode', () => {
    expect(
      shouldInheritFromTaskWorkflow({
        executionMode: 'workflow',
        workflowEngine: 'dag',
        workflow: emptyWorkflow('dag'),
        description: '',
        workflowOrchestrationMode: 'rule',
        workflowStepDrafts: [],
      }),
    ).toBe(true);
  });

  it('returns false when heuristic description diverges from group', () => {
    expect(
      shouldInheritFromTaskWorkflow(
        {
          executionMode: 'workflow',
          workflowEngine: 'dag',
          workflow: emptyWorkflow('dag'),
          description: '',
          heuristicWorkflowDescription: 'Custom flow',
          workflowOrchestrationMode: 'heuristic',
        },
        {
          workflowOrchestrationMode: 'heuristic',
          workflowDescription: 'Group flow',
        },
      ),
    ).toBe(false);
  });
});
