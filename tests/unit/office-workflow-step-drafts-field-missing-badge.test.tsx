/**
 * Regression: removing an earlier step-draft row must not misattribute the
 * "missing agent" badge/red-frame to the wrong (shifted) row.
 *
 * Root cause (fixed): `WorkflowStepDraftsField` used to prefer
 * `editGateMissingBadgeByKey`, a badge map keyed by the *open-time, frozen*
 * row index `step:${index}`, over `stepMissingAgentIds` (a live array the
 * parent correctly splices on row removal via `onRemoveStepMissing`).
 * Because the frozen key map never shifts when a row is removed, every row
 * after the removed one showed the *previous* row's badge state instead of
 * its own. The fix removes that key-map path entirely; step rows now always
 * derive the badge from `stepMissingAgentIds`.
 *
 * This also implements the product requirement: once the user fixes a
 * specific row (replaces the missing agent), that row's badge must clear
 * live; if the user does not save and reopens later, it must be re-flagged
 * from persisted data. `stepMissingAgentIds` naturally satisfies both:
 * `onClearStepMissing` clears it on touch, and it is freshly recomputed from
 * persisted data every time the edit form is (re)built.
 */
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { WorkflowStepDraftsField } from '@/components/office/WorkflowStepDraftsField';
import { buildTaskEditFormStateFromProject } from '@/lib/office-task-edit-form';
import type { AgentSummary } from '@/types/agent';
import type { OfficeTempProject, WorkflowStepDraftRow } from '@/types/office';

function agent(id: string): AgentSummary {
  return { id, name: id, isDefault: false, modelDisplay: '' };
}

const AGENTS: AgentSummary[] = [agent('pm'), agent('dev')];

function row(agentIds: string[], task: string): WorkflowStepDraftRow {
  return { input: '', agentIds, task, output: '', linkMode: 'serial' };
}

/** Three rows: row0 missing (ghost1), row1 healthy, row2 missing (ghost2). */
function openRows(): WorkflowStepDraftRow[] {
  return [
    row(['ghost1'], '第一步'),
    row(['pm'], '第二步'),
    row(['ghost2'], '第三步'),
  ];
}

function TestHarness() {
  const [rows, setRows] = useState<WorkflowStepDraftRow[]>(openRows());
  const [stepMissingAgentIds, setStepMissingAgentIds] = useState<string[][]>([
    ['ghost1'],
    [],
    ['ghost2'],
  ]);

  return (
    <WorkflowStepDraftsField
      rows={rows}
      memberAgentIds={['pm', 'dev']}
      agents={AGENTS}
      testId="wf-step-drafts"
      stepMissingAgentIds={stepMissingAgentIds}
      onClearStepMissing={(index) =>
        setStepMissingAgentIds((prev) => prev.map((ids, i) => (i === index ? [] : ids)))
      }
      onRemoveStepMissing={(index) =>
        setStepMissingAgentIds((prev) => prev.filter((_, i) => i !== index))
      }
      onChange={setRows}
    />
  );
}

describe('WorkflowStepDraftsField missing-badge row attribution after row removal', () => {
  it('keeps correct row attribution after removing an earlier row', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<TestHarness />);

    expect(screen.getByTestId('wf-step-drafts-row-1')).toHaveAttribute('data-missing-agents', 'true');
    expect(screen.getByTestId('wf-step-drafts-row-2')).toHaveAttribute('data-missing-agents', 'false');
    expect(screen.getByTestId('wf-step-drafts-row-3')).toHaveAttribute('data-missing-agents', 'true');

    // Remove row 1 (index 0, "第一步").
    fireEvent.click(screen.getByTestId('wf-step-drafts-remove-1'));

    // After removal: current row1 = old row1 (healthy "第二步"), current row2 = old row2 (missing "第三步").
    expect(screen.getByTestId('wf-step-drafts-row-1')).toHaveAttribute('data-missing-agents', 'false');
    expect(screen.getByTestId('wf-step-drafts-row-2')).toHaveAttribute('data-missing-agents', 'true');
  });

  it('fixing a row live (assigning a real agent) clears its badge immediately', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<TestHarness />);

    expect(screen.getByTestId('wf-step-drafts-row-1')).toHaveAttribute('data-missing-agents', 'true');
    fireEvent.change(screen.getByTestId('wf-step-drafts-who-select-1'), { target: { value: 'dev' } });
    expect(screen.getByTestId('wf-step-drafts-row-1')).toHaveAttribute('data-missing-agents', 'false');
  });
});

/**
 * End-to-end product requirement: a live in-session fix (see test above) is
 * NOT persisted anywhere on its own. Closing without saving and reopening the
 * edit form must re-derive `stepMissingAgentIds` fresh from the still-unsaved,
 * still-broken persisted project — i.e. the badge must reappear.
 */
describe('reopening the edit form without saving re-flags an unresolved missing agent', () => {
  const CATALOG = ['pm', 'dev'];

  function projectWithMissingStepAgent(): OfficeTempProject {
    const now = Date.now();
    return {
      id: 'p-reopen',
      title: '任务',
      origin: 'standalone',
      agentIds: ['pm', 'ghost'],
      coordinatorAgentId: 'pm',
      lifecycle: 'active',
      featureDescription: '',
      description: '',
      status: 'pending',
      nodeRuns: [],
      executionMode: 'workflow',
      workflowOrchestrationMode: 'rule',
      workflowStepDrafts: [
        { input: '', agentIds: ['ghost'], task: '步骤', output: '', linkMode: 'serial' },
      ],
      workflow: { mode: 'dag', nodes: [], edges: [] },
      createdAt: now,
      updatedAt: now,
    };
  }

  it('same (unsaved) persisted project still flags the row missing on a fresh open', () => {
    const project = projectWithMissingStepAgent();

    // First open: row is flagged missing (nothing fixed/saved yet).
    const firstOpen = buildTaskEditFormStateFromProject(project, null, undefined, CATALOG);
    expect(firstOpen.stepMissingAgentIds?.[0]).toEqual(['ghost']);

    // User fixes it live in the component (covered above) but never saves —
    // the persisted `project` object is untouched. Closing + reopening the
    // dialog re-runs `buildTaskEditFormStateFromProject` from scratch.
    const reopened = buildTaskEditFormStateFromProject(project, null, undefined, CATALOG);
    expect(reopened.stepMissingAgentIds?.[0]).toEqual(['ghost']);
  });
});

describe('contentful empty step row red-frames like empty_node save block', () => {
  it('shows empty badge + red frame when row has task but no agents', () => {
    render(
      <WorkflowStepDraftsField
        rows={[row([], '未指定负责人的步骤')]}
        memberAgentIds={['pm', 'dev']}
        agents={AGENTS}
        testId="wf-step-drafts"
        stepMissingAgentIds={[[]]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('wf-step-drafts-row-1')).toHaveAttribute(
      'data-missing-agents',
      'true',
    );
    expect(screen.getByTestId('wf-step-drafts-empty-1')).toBeInTheDocument();
    expect(screen.queryByTestId('wf-step-drafts-missing-1')).not.toBeInTheDocument();
  });

  it('blank skeleton row (no task / agents) does not red-frame', () => {
    render(
      <WorkflowStepDraftsField
        rows={[row([], '')]}
        memberAgentIds={['pm', 'dev']}
        agents={AGENTS}
        testId="wf-step-drafts"
        stepMissingAgentIds={[[]]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('wf-step-drafts-row-1')).toHaveAttribute(
      'data-missing-agents',
      'false',
    );
    expect(screen.queryByTestId('wf-step-drafts-empty-1')).not.toBeInTheDocument();
  });
});

describe('WorkflowStepDraftsField first-node orchestration row', () => {
  it('hides flow/link controls on step 1 and keeps them on later steps', () => {
    render(
      <WorkflowStepDraftsField
        rows={[
          row(['pm'], '第一步'),
          row(['dev'], '第二步'),
        ]}
        memberAgentIds={['pm', 'dev']}
        agents={AGENTS}
        testId="wf-step-drafts"
        onChange={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('wf-step-drafts-flow-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('wf-step-drafts-link-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('wf-step-drafts-rollback-1')).not.toBeInTheDocument();

    expect(screen.getByTestId('wf-step-drafts-flow-2')).toBeInTheDocument();
    expect(screen.getByTestId('wf-step-drafts-link-2')).toBeInTheDocument();
    expect(screen.getByTestId('wf-step-drafts-rollback-2')).toBeInTheDocument();
  });
});
