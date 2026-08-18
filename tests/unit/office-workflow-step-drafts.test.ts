import { describe, expect, it } from 'vitest';
import {
  emptyWorkflowStepDraftRow,
  emptyWorkflowStepDraftRows,
  effectiveParallelWithStep,
  generateWorkflowFromStepDraftRows,
  hasWorkflowStepDraftContent,
  normalizeWorkflowStepDraftRows,
  parallelStepOptions,
  removeWorkflowStepDraftRow,
  resolveWorkflowStepDraftRows,
  validateWorkflowStepDraftRows,
  workflowDescriptionOrDraftsKey,
  workflowStepDraftsFromDescription,
  workflowStepDraftsToGenerationDraft,
} from '@/lib/office-workflow-step-drafts';

const members = [
  { agentId: 'pm', displayName: 'PM' },
  { agentId: 'dev', displayName: '开发' },
];

describe('office-workflow-step-drafts', () => {
  it('defaults to three empty draft rows', () => {
    expect(emptyWorkflowStepDraftRows()).toHaveLength(3);
  });

  it('defaults each empty draft row to serial link mode', () => {
    for (const row of emptyWorkflowStepDraftRows()) {
      expect(row.linkMode).toBe('serial');
      expect(row.parallelWithStep).toBeUndefined();
    }
  });

  it('forces the first step to serial during normalize', () => {
    const rows = normalizeWorkflowStepDraftRows([
      {
        ...emptyWorkflowStepDraftRow(),
        agentIds: ['pm'],
        task: '启动',
        linkMode: 'parallel',
        parallelWithStep: 1,
      },
      {
        ...emptyWorkflowStepDraftRow(),
        agentIds: ['dev'],
        task: '实现',
        linkMode: 'serial',
      },
    ]);
    expect(rows[0]?.linkMode).toBe('serial');
    expect(rows[0]?.parallelWithStep).toBeUndefined();
    expect(rows[1]?.linkMode).toBe('serial');
  });

  it('allows trailing empty rows when leading rows are valid and contiguous', () => {
    const rows = emptyWorkflowStepDraftRows();
    rows[0] = { ...emptyWorkflowStepDraftRow(), agentIds: ['pm'], task: '写 PRD', linkMode: 'serial' };
    rows[1] = { ...emptyWorkflowStepDraftRow(), agentIds: ['dev'], task: '实现', linkMode: 'serial' };
    const result = validateWorkflowStepDraftRows(rows, ['pm', 'dev'], { minValidRows: 0 });
    expect(result.ok).toBe(true);
    expect(result.validCount).toBe(2);
  });

  it('rejects gap rows in the middle', () => {
    const rows = emptyWorkflowStepDraftRows();
    rows[0] = { ...emptyWorkflowStepDraftRow(), agentIds: ['pm'], task: '写 PRD', linkMode: 'serial' };
    rows[2] = { ...emptyWorkflowStepDraftRow(), agentIds: ['dev'], task: '实现', linkMode: 'serial' };
    const result = validateWorkflowStepDraftRows(rows, ['pm', 'dev'], { minValidRows: 0 });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('gap_row');
  });

  it('requires parallel step number when parallel is selected', () => {
    const rows = [
      { ...emptyWorkflowStepDraftRow(), agentIds: ['pm'], task: '写 PRD', linkMode: 'serial' as const },
      {
        ...emptyWorkflowStepDraftRow(),
        agentIds: ['dev'],
        task: '实现',
        linkMode: 'parallel' as const,
      },
    ];
    const result = validateWorkflowStepDraftRows(rows, ['pm', 'dev'], { minValidRows: 1 });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('parallel_step_required');
  });

  it('generates one node per valid row', () => {
    const rows = [
      { ...emptyWorkflowStepDraftRow(), agentIds: ['pm'], task: '写 PRD', linkMode: 'serial' as const },
      {
        ...emptyWorkflowStepDraftRow(),
        agentIds: ['dev'],
        task: '实现',
        linkMode: 'parallel' as const,
        parallelWithStep: 1,
      },
    ];
    const draft = workflowStepDraftsToGenerationDraft(rows, members);
    expect(draft?.steps).toHaveLength(2);
    const generated = generateWorkflowFromStepDraftRows(rows, members, 'dag');
    expect(generated?.workflow.nodes).toHaveLength(2);
  });

  it('resolveWorkflowStepDraftRows falls back to description when stored drafts are empty', () => {
    const rows = resolveWorkflowStepDraftRows(
      [],
      'PM负责写 PRD，开发负责实现',
      members,
    );
    expect(hasWorkflowStepDraftContent(rows)).toBe(true);
    expect(rows[0]?.task).toBeTruthy();
  });

  it('workflowDescriptionOrDraftsKey ignores padded empty draft rows', () => {
    const padded = emptyWorkflowStepDraftRows();
    expect(workflowDescriptionOrDraftsKey('legacy text', padded)).toBe('legacy text');
  });

  it('narrows parallel options to last serial anchor through N-1', () => {
    const rows = [
      { ...emptyWorkflowStepDraftRow(), agentIds: ['pm'], task: 'a', linkMode: 'serial' as const },
      {
        ...emptyWorkflowStepDraftRow(),
        agentIds: ['dev'],
        task: 'b',
        linkMode: 'parallel' as const,
        parallelWithStep: 1,
      },
      { ...emptyWorkflowStepDraftRow(), agentIds: ['pm'], task: 'c', linkMode: 'serial' as const },
      {
        ...emptyWorkflowStepDraftRow(),
        agentIds: ['dev'],
        task: 'd',
        linkMode: 'parallel' as const,
        parallelWithStep: 3,
      },
    ];
    expect(parallelStepOptions(rows, 4)).toEqual([3]);
    expect(validateWorkflowStepDraftRows(rows, ['pm', 'dev'], { minValidRows: 1 }).ok).toBe(true);
    expect(
      validateWorkflowStepDraftRows(
        rows.map((row, i) => (i === 3 ? { ...row, parallelWithStep: 2 } : row)),
        ['pm', 'dev'],
        { minValidRows: 1 },
      ).ok,
    ).toBe(false);
  });

  it('falls back to 1..N-1 when all prior steps are parallel', () => {
    const rows = [
      { ...emptyWorkflowStepDraftRow(), agentIds: ['pm'], task: 'a', linkMode: 'parallel' as const, parallelWithStep: 1 },
      {
        ...emptyWorkflowStepDraftRow(),
        agentIds: ['dev'],
        task: 'b',
        linkMode: 'parallel' as const,
        parallelWithStep: 1,
      },
      {
        ...emptyWorkflowStepDraftRow(),
        agentIds: ['pm'],
        task: 'c',
        linkMode: 'parallel' as const,
        parallelWithStep: 2,
      },
    ];
    expect(parallelStepOptions(rows, 3)).toEqual([1, 2]);
    expect(effectiveParallelWithStep(rows, 3, 2)).toBe(1);
  });

  it('removes a row and renumbers parallel and rollback step references', () => {
    const rows = [
      { ...emptyWorkflowStepDraftRow(), agentIds: ['pm'], task: 'a', linkMode: 'serial' as const },
      { ...emptyWorkflowStepDraftRow(), agentIds: ['dev'], task: 'b', linkMode: 'serial' as const },
      {
        ...emptyWorkflowStepDraftRow(),
        agentIds: ['pm'],
        task: 'c',
        linkMode: 'parallel' as const,
        parallelWithStep: 1,
      },
      {
        ...emptyWorkflowStepDraftRow(),
        agentIds: ['dev'],
        task: 'd',
        linkMode: 'parallel' as const,
        parallelWithStep: 3,
        rollbackEnabled: true,
        rollbackCondition: '失败',
        rollbackStep: 2,
      },
    ];
    const next = removeWorkflowStepDraftRow(rows, 1);
    expect(next).toHaveLength(3);
    expect(next[2]?.parallelWithStep).toBe(2);
    expect(next[2]?.rollbackStep).toBe(1);
  });

  it('keeps at least one row when removing the only row', () => {
    const rows = [
      { ...emptyWorkflowStepDraftRow(), agentIds: ['pm'], task: 'only', linkMode: 'serial' as const },
    ];
    expect(removeWorkflowStepDraftRow(rows, 0)).toHaveLength(1);
  });

  it('requires rollback condition and step when rollback is enabled', () => {
    const rows = [
      { ...emptyWorkflowStepDraftRow(), agentIds: ['pm'], task: 'a', linkMode: 'serial' as const },
      {
        ...emptyWorkflowStepDraftRow(),
        agentIds: ['dev'],
        task: 'b',
        linkMode: 'serial' as const,
        rollbackEnabled: true,
      },
    ];
    expect(validateWorkflowStepDraftRows(rows, ['pm', 'dev'], { minValidRows: 1 }).error).toBe(
      'rollback_condition_required',
    );
    rows[1] = {
      ...rows[1]!,
      rollbackCondition: '测试失败',
      rollbackStep: 1,
    };
    expect(validateWorkflowStepDraftRows(rows, ['pm', 'dev'], { minValidRows: 1 }).ok).toBe(true);
  });

  it('generateWorkflowFromStepDraftRows applies per-step maxRuntimeMinutes', () => {
    const members = [{ agentId: 'pm', displayName: 'PM' }];
    const rows = [
      {
        ...emptyWorkflowStepDraftRow(),
        agentIds: ['pm'],
        task: '写 PRD',
        linkMode: 'serial' as const,
        maxRuntimeMinutes: 45,
      },
    ];
    const result = generateWorkflowFromStepDraftRows(rows, members, 'dag');
    expect(result?.workflow.nodes[0]?.maxRuntimeMinutes).toBe(45);
  });

  it('generateWorkflowFromStepDraftRows applies userCheckpoint on nodes', () => {
    const rows = [
      {
        ...emptyWorkflowStepDraftRow(),
        agentIds: ['pm'],
        task: '写 PRD',
        linkMode: 'serial' as const,
        userCheckpoint: true,
      },
    ];
    const result = generateWorkflowFromStepDraftRows(rows, members, 'dag');
    expect(result?.workflow.nodes[0]?.userCheckpoint).toBe(true);
  });

  it('workflowStepDraftsFromDescription maps inferred userCheckpoint', () => {
    const rows = workflowStepDraftsFromDescription(
      '1.测试编写用例\n2.测试验收，此步需要人工审核',
      [{ agentId: 'qa', displayName: '测试' }],
    );
    expect(rows[1]?.userCheckpoint).toBe(true);
    expect(rows[0]?.userCheckpoint).toBeFalsy();
  });
});
