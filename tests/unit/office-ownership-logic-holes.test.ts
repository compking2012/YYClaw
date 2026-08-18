import { describe, expect, it } from 'vitest';
import {
  resolveEffectiveWorkflow,
  shouldApplyTerminalWorkflowFreeze,
  withTerminalWorkflowFreeze,
  spawnedWorkflowDirtyVsGroup,
  clearWorkflowFreezeForRerun,
  projectOwnsWorkflow,
  pruneNodeRunsToWorkflow,
} from '@/lib/office-spawned-workflow-ownership';
import { resolveDagWorkflowForSave } from '@/lib/office-workflow-preview';
import type { OfficeFixedGroup, OfficeTempProject, WorkflowDefinition } from '@/types/office';

const groupWorkflow2: WorkflowDefinition = {
  mode: 'dag',
  nodes: [
    { id: 'gen-0', title: '计划', agentIds: ['pm'] },
    { id: 'gen-1', title: '总结', agentIds: ['pm'] },
  ],
  edges: [{ from: 'gen-0', to: 'gen-1' }],
};

const groupWorkflow1: WorkflowDefinition = {
  mode: 'dag',
  nodes: [{ id: 'gen-0', title: '计划', agentIds: ['pm'] }],
  edges: [],
};

const group: OfficeFixedGroup = {
  id: 'g1',
  name: 'g',
  agentIds: ['pm'],
  coordinatorAgentId: 'pm',
  workflow: groupWorkflow2,
  workflowDescription: 'plan then summarize',
  workflowOrchestrationMode: 'heuristic',
  createdAt: 1,
  updatedAt: 1,
};

function project(overrides: Partial<OfficeTempProject> = {}): OfficeTempProject {
  return {
    id: 'p1',
    title: 't',
    origin: 'fixed_group',
    parentGroupId: 'g1',
    inheritsGroupTemplate: true,
    workflow: { mode: 'dag', nodes: [], edges: [] },
    executionMode: 'workflow',
    status: 'pending',
    lifecycle: 'active',
    agentIds: ['pm'],
    coordinatorAgentId: 'pm',
    featureDescription: 'f',
    description: '',
    nodeRuns: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('ownership logic-hole reproductions', () => {
  it('HOLE-A: completed freeze must NOT follow live group edits', () => {
    const completed = project({ status: 'completed' });
    expect(shouldApplyTerminalWorkflowFreeze(completed)).toBe(true);
    const frozen = withTerminalWorkflowFreeze(completed, group);
    expect(frozen.workflowFreezeSnapshot?.workflow.nodes).toHaveLength(2);

    const liveAfterGroupEdit = { ...group, workflow: groupWorkflow1, updatedAt: 99 };
    const effective = resolveEffectiveWorkflow(frozen, liveAfterGroupEdit);
    expect(effective.nodes).toHaveLength(2);
    expect(effective.nodes[1]?.title).toBe('总结');
  });

  it('HOLE-B: resolveEffectiveWorkflow(completed, no freeze) must not track live group', () => {
    const completedNoFreeze = project({ status: 'completed' });
    const live = { ...group, workflow: groupWorkflow1 };
    const effective = resolveEffectiveWorkflow(completedNoFreeze, live);
    // Until freeze exists, prefer empty — never silently track live group.
    expect(effective.nodes.length === 1 && effective.nodes[0]?.title === '计划').toBe(false);
  });

  it('HOLE-B2: failed/aborted without freeze follow live group', () => {
    const live = { ...group, workflow: groupWorkflow1 };
    for (const status of ['failed', 'aborted'] as const) {
      const effective = resolveEffectiveWorkflow(project({ status }), live);
      expect(effective.nodes).toHaveLength(1);
      expect(effective.nodes[0]?.title).toBe('计划');
    }
  });

  it('HOLE-C: resolveDagWorkflowForSave must not blank DAG when spawn/edit dirty vs group but baseline unchanged', async () => {
    // Roster diverges → dirty; orchestration baseline unchanged; form DAG empty.
    // Returning empty is OK only if caller still sees dirty; returning empty AND
    // treating as inherit would drop ownership elevation signal.
    const result = await resolveDagWorkflowForSave({
      executionMode: 'workflow',
      spawnFromGroup: true,
      groupWorkflow: groupWorkflow2,
      group,
      orchestration: {
        orchestrationMode: 'heuristic',
        workflowStepDrafts: [],
        heuristicDescription: 'plan then summarize',
      },
      orchestrationBaseline: {
        orchestrationMode: 'heuristic',
        workflowStepDrafts: [],
        heuristicDescription: 'plan then summarize',
      },
      previewSyncedKey: null,
      workflow: { mode: 'dag', nodes: [], edges: [] },
      members: [{ agentId: 'pm', displayName: 'PM' }],
      agentIds: ['pm', 'extra'], // dirty roster
      coordinatorAgentId: 'pm',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Dirty vs group — must NOT take the "untouched spawn keep empty" shortcut in a way
    // that loses the dirty signal. Empty DAG is fine; dirty flag must remain true.
    expect(
      spawnedWorkflowDirtyVsGroup(group, {
        executionMode: 'workflow',
        workflow: result.workflow,
        description: 'plan then summarize',
        heuristicWorkflowDescription: 'plan then summarize',
        workflowOrchestrationMode: 'heuristic',
        agentIds: ['pm', 'extra'],
        coordinatorAgentId: 'pm',
      }),
    ).toBe(true);
  });

  it('HOLE-D: LangGraph bundle equal to group DAG must not force ownership (一字未改)', () => {
    expect(
      spawnedWorkflowDirtyVsGroup(group, {
        executionMode: 'workflow',
        workflowEngine: 'langgraph',
        workflow: { mode: 'dag', nodes: [], edges: [] },
        description: 'plan then summarize',
        heuristicWorkflowDescription: 'plan then summarize',
        workflowOrchestrationMode: 'heuristic',
        agentIds: ['pm'],
        coordinatorAgentId: 'pm',
        langGraphWorkflowBundle: {
          activeSource: 'heuristic',
          heuristic: { workflow: structuredClone(groupWorkflow2) },
        },
      }),
    ).toBe(false);
  });

  it('HOLE-E: clear freeze then continue must detect structure change vs old nodeRuns', () => {
    const frozen = withTerminalWorkflowFreeze(
      project({
        status: 'completed',
        nodeRuns: [
          { nodeId: 'gen-0', agentId: 'pm', status: 'completed' },
          { nodeId: 'gen-1', agentId: 'pm', status: 'pending' },
        ],
      }),
      group,
    );
    const cleared = clearWorkflowFreezeForRerun({ ...frozen, status: 'pending' });
    const live = { ...group, workflow: groupWorkflow1 };
    const wf = resolveEffectiveWorkflow(cleared, live);
    const staleNodeIds = (cleared.nodeRuns ?? [])
      .map((n) => n.nodeId)
      .filter((id) => !wf.nodes.some((n) => n.id === id));
    // After group deleted gen-1, continue must not keep gen-1 as a live run target.
    expect(staleNodeIds).toContain('gen-1');
    const pruned = pruneNodeRunsToWorkflow(cleared.nodeRuns ?? [], wf);
    expect(pruned.map((n) => n.nodeId)).toEqual(['gen-0']);
  });

  it('HOLE-F: owned sticky — matching group again still owns', () => {
    expect(
      projectOwnsWorkflow(
        project({
          inheritsGroupTemplate: false,
          workflow: structuredClone(groupWorkflow2),
        }),
      ),
    ).toBe(true);
  });
});
