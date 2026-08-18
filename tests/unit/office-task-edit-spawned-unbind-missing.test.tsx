/**
 * Spawned workflow project edit: missing roster chips must expose X (unbind-missing).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TaskEditDialog } from '@/components/office/TaskEditDialog';
import type { AgentSummary } from '@/types/agent';
import type { OfficeFixedGroup, OfficeTempProject } from '@/types/office';

const { AGENTS } = vi.hoisted(() => ({
  AGENTS: [
    { id: 'pm', name: '产品经理', isDefault: false, modelDisplay: '' },
  ] as AgentSummary[],
}));

vi.mock('@/stores/agents', () => {
  const state = { agents: AGENTS };
  const useAgentsStore = Object.assign(
    (selector: (s: typeof state) => unknown) => selector(state),
    { getState: () => state },
  );
  return { useAgentsStore };
});

vi.mock('@/hooks/useOfficeDagWorkflowPreview', () => ({
  useOfficeDagWorkflowPreview: () => ({
    isStale: false,
    isPreviewing: false,
    runPreview: vi.fn(),
    markPreviewSynced: vi.fn(),
    orchestration: {
      mode: 'rule',
      stepDraftsKey: '',
      heuristicDescription: '',
    },
  }),
}));

function group(): OfficeFixedGroup {
  const now = Date.now();
  return {
    id: 'g1',
    name: '组',
    agentIds: ['pm', 'qa-ghost', 'review-ghost'],
    coordinatorAgentId: 'pm',
    executionMode: 'workflow',
    workflowOrchestrationMode: 'rule',
    workflowDescription: '',
    workflowStepDrafts: [],
    workflow: { mode: 'dag', nodes: [], edges: [] },
    createdAt: now,
    updatedAt: now,
  };
}

function spawnedProject(overrides: Partial<OfficeTempProject> = {}): OfficeTempProject {
  const now = Date.now();
  return {
    id: 'p1',
    title: '派出任务',
    origin: 'fixed_group',
    parentGroupId: 'g1',
    inheritsGroupTemplate: true,
    agentIds: ['pm', 'qa-ghost', 'review-ghost'],
    coordinatorAgentId: 'pm',
    agentNameHints: {
      'qa-ghost': '软件测试',
      'review-ghost': '审核工程师',
    },
    lifecycle: 'active',
    featureDescription: 'feat',
    description: '',
    status: 'pending',
    nodeRuns: [],
    executionMode: 'workflow',
    workflowOrchestrationMode: 'rule',
    workflowStepDrafts: [],
    workflow: { mode: 'dag', nodes: [], edges: [] },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('TaskEditDialog spawned missing-agent unbind', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('active non-running spawned workflow: missing chips show X (unbind-missing)', () => {
    const g = group();
    render(
      <TaskEditDialog
        project={spawnedProject()}
        group={g}
        agentBindings={{}}
        agentIds={['pm', 'qa-ghost', 'review-ghost']}
        t={(key) => key}
        unsavedCloseMessage="unsaved"
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByTestId('office-agent-pool-picker')).toHaveAttribute(
      'data-interaction-mode',
      'unbind-missing',
    );
    expect(screen.getByTestId('office-agent-missing-qa-ghost')).toBeInTheDocument();
    expect(screen.getByTestId('office-agent-missing-review-ghost')).toBeInTheDocument();
    expect(screen.getByTestId('office-agent-unbind-missing-qa-ghost')).toBeInTheDocument();
    expect(screen.getByTestId('office-agent-unbind-missing-review-ghost')).toBeInTheDocument();
  });

  it('archived-restart badge must not remove X on missing chips (still active, not running)', () => {
    const g = group();
    render(
      <TaskEditDialog
        project={spawnedProject({ archivedRestartedAt: Date.now() })}
        group={g}
        agentBindings={{}}
        agentIds={['pm', 'qa-ghost', 'review-ghost']}
        t={(key) => key}
        unsavedCloseMessage="unsaved"
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByTestId('office-agent-pool-picker')).toHaveAttribute(
      'data-interaction-mode',
      'unbind-missing',
    );
    expect(screen.getByTestId('office-agent-unbind-missing-qa-ghost')).toBeInTheDocument();
  });

  it('readOnly (running) keeps red missing chips but hides X', () => {
    const g = group();
    render(
      <TaskEditDialog
        project={spawnedProject({ status: 'running' })}
        group={g}
        agentBindings={{}}
        agentIds={['pm', 'qa-ghost', 'review-ghost']}
        t={(key) => key}
        readOnly
        unsavedCloseMessage="unsaved"
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByTestId('office-agent-pool-picker')).toHaveAttribute(
      'data-interaction-mode',
      'view',
    );
    expect(screen.getByTestId('office-agent-missing-qa-ghost')).toBeInTheDocument();
    expect(screen.queryByTestId('office-agent-unbind-missing-qa-ghost')).not.toBeInTheDocument();
  });
});
