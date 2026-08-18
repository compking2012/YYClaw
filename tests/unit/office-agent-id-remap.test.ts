import { describe, expect, it } from 'vitest';
import {
  orphanWorkflowStepDraftAgentIds,
  remapFixedGroupAgentIds,
  remapTempProjectAgentIds,
  remapWorkflowStepDraftAgentIds,
  stripUnknownWorkflowStepDraftAgentIds,
} from '@/lib/office-agent-id-remap';
import { workflowStepDraftsToGenerationDraft } from '@/lib/office-workflow-step-drafts';
import type { OfficeFixedGroup, WorkflowStepDraftRow } from '@/types/office';

describe('office agent id remap', () => {
  it('remaps fixed group member + draft + workflow node ids', () => {
    const group = {
      id: 'g1',
      name: '软件开发小组',
      agentIds: ['pm', 'ux-gong-cheng-shi'],
      coordinatorAgentId: 'pm',
      workflow: {
        mode: 'dag',
        nodes: [
          {
            id: 'gen-2',
            agentId: 'ux-gong-cheng-shi',
            agentIds: ['ruan-jian-ce-shi', 'ux-gong-cheng-shi'],
            title: '评审',
            execution: 'serial',
          },
        ],
        edges: [],
      },
      workflowStepDrafts: [
        {
          input: '',
          agentIds: ['ux-gong-cheng-shi', 'ruan-jian-ce-shi'],
          task: '评审',
          output: '',
          linkMode: 'serial',
        },
      ],
      createdAt: 1,
      updatedAt: 1,
      executionMode: 'workflow',
    } as OfficeFixedGroup;

    const next = remapFixedGroupAgentIds(group, 'ux-gong-cheng-shi', 'ui-gong-cheng-shi');
    expect(next.agentIds).toEqual(['pm', 'ui-gong-cheng-shi']);
    expect(next.workflow.nodes[0]?.agentId).toBe('ui-gong-cheng-shi');
    expect(next.workflow.nodes[0]?.agentIds).toEqual([
      'ruan-jian-ce-shi',
      'ui-gong-cheng-shi',
    ]);
    expect(next.workflowStepDrafts?.[0]?.agentIds).toEqual([
      'ui-gong-cheng-shi',
      'ruan-jian-ce-shi',
    ]);
  });

  it('strips unknown draft agent ids so preview can succeed after rename', () => {
    const rows: WorkflowStepDraftRow[] = [
      {
        input: '',
        agentIds: ['ux-gong-cheng-shi', 'ui-gong-cheng-shi'],
        task: '评审需求',
        output: '评审结论',
        linkMode: 'serial',
      },
    ];
    const sanitized = stripUnknownWorkflowStepDraftAgentIds(rows, ['ui-gong-cheng-shi', 'pm']);
    expect(sanitized[0]?.agentIds).toEqual(['ui-gong-cheng-shi']);
    const draft = workflowStepDraftsToGenerationDraft(rows, [
      { agentId: 'ui-gong-cheng-shi', displayName: 'UI工程师' },
      { agentId: 'pm', displayName: 'PM' },
    ]);
    expect(draft).not.toBeNull();
    expect(draft?.steps[0]?.roleNames).toEqual(['UI工程师']);
  });

  it('detects orphan draft ids for grayed UI chips', () => {
    expect(
      orphanWorkflowStepDraftAgentIds(
        ['ux-gong-cheng-shi', 'ui-gong-cheng-shi'],
        ['ui-gong-cheng-shi'],
        ['ui-gong-cheng-shi'],
      ),
    ).toEqual(['ux-gong-cheng-shi']);
  });

  it('remap drafts is idempotent when id absent', () => {
    const rows = remapWorkflowStepDraftAgentIds(
      [{ input: '', agentIds: ['pm'], task: 't', output: '', linkMode: 'serial' }],
      'ux-gong-cheng-shi',
      'ui-gong-cheng-shi',
    );
    expect(rows?.[0]?.agentIds).toEqual(['pm']);
  });

  it('remaps langGraph bundle and agentNameHints keys', () => {
    const project = {
      id: 'p1',
      title: 't',
      origin: 'standalone' as const,
      agentIds: ['ux-gong-cheng-shi'],
      coordinatorAgentId: 'ux-gong-cheng-shi',
      lifecycle: 'active' as const,
      featureDescription: '',
      description: '',
      status: 'pending' as const,
      nodeRuns: [],
      createdAt: 1,
      updatedAt: 1,
      agentNameHints: { 'ux-gong-cheng-shi': 'UX工程师' },
      langGraphWorkflowBundle: {
        activeSource: 'custom' as const,
        activeSavedAt: 1,
        custom: {
          savedAt: 1,
          workflow: {
            mode: 'dag' as const,
            nodes: [{ id: 'n', agentId: 'ux-gong-cheng-shi', execution: 'serial' as const }],
            edges: [],
          },
        },
      },
    };
    const next = remapTempProjectAgentIds(project, 'ux-gong-cheng-shi', 'ui-gong-cheng-shi');
    expect(next.agentIds).toEqual(['ui-gong-cheng-shi']);
    expect(next.agentNameHints?.['ui-gong-cheng-shi']).toBe('UX工程师');
    expect(next.agentNameHints?.['ux-gong-cheng-shi']).toBeUndefined();
    expect(next.langGraphWorkflowBundle?.custom?.workflow.nodes[0]?.agentId).toBe('ui-gong-cheng-shi');
  });
});
