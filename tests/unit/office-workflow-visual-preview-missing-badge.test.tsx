/**
 * Regression: after the DAG is regenerated (manual "预览工作流" click, or the
 * save-time auto-resolve), a node that now genuinely has an agent must not
 * keep showing the "智能体缺失" red frame/badge — regenerated node ids are
 * freshly assigned each time and can coincidentally collide with an id that
 * existed in the open-time snapshot, making the frozen
 * `editGateMissingBadgeByKey` lookup spuriously match forever.
 *
 * Fix: once `nodesRegenerated` is true, open-snapshot missing badges are
 * ignored. Healthy nodes show nothing; a node that is still genuinely empty
 * shows "未指定负责人". Empty nodes also red-frame without regeneration
 * (e.g. after roster unbind) so saveBlockedEmptyNode has a visible target.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WorkflowVisualPreview } from '@/components/office/WorkflowVisualPreview';
import { editGateMissingKeyForWorkflowNode } from '@/lib/office-missing-agents';
import type { ProjectAgentRef } from '@/lib/office-workflow-node';
import type { WorkflowDefinition } from '@/types/office';

const MEMBERS: ProjectAgentRef[] = [{ agentId: 'dev', displayName: 'Dev' }];

function wf(nodes: WorkflowDefinition['nodes']): WorkflowDefinition {
  return { mode: 'dag', nodes, edges: [] };
}

describe('WorkflowVisualPreview node badge after DAG regeneration', () => {
  it('before regeneration: frozen open-snapshot badge shows "智能体缺失" as today', () => {
    const workflow = wf([{ id: 'n1', agentId: 'dev', execution: 'serial' }]);
    const editGateMissingBadgeByKey = new Map([[editGateMissingKeyForWorkflowNode('n1'), true]]);
    render(
      <WorkflowVisualPreview
        workflow={workflow}
        members={MEMBERS}
        editGateMissingBadgeByKey={editGateMissingBadgeByKey}
      />,
    );
    expect(screen.getByTestId('office-workflow-visual-node-n1')).toHaveAttribute(
      'data-missing-agents',
      'true',
    );
    expect(screen.getByTestId('office-workflow-visual-missing-n1')).toBeInTheDocument();
  });

  it('after regeneration + node now healthy: badge/red-frame must clear even if the (coincidentally reused) id still matches the frozen open-snapshot map', () => {
    const workflow = wf([{ id: 'n1', agentId: 'dev', execution: 'serial' }]);
    // Simulates the exact bug: node id `n1` happens to match the frozen
    // open-snapshot key (regeneration restarts numbering from the same
    // sequence when structure is unchanged).
    const editGateMissingBadgeByKey = new Map([[editGateMissingKeyForWorkflowNode('n1'), true]]);
    render(
      <WorkflowVisualPreview
        workflow={workflow}
        members={MEMBERS}
        editGateMissingBadgeByKey={editGateMissingBadgeByKey}
        nodesRegenerated
      />,
    );
    expect(screen.getByTestId('office-workflow-visual-node-n1')).toHaveAttribute(
      'data-missing-agents',
      'false',
    );
    expect(screen.queryByTestId('office-workflow-visual-missing-n1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('office-workflow-visual-empty-n1')).not.toBeInTheDocument();
  });

  it('after regeneration + node still unfixed (empty): shows the distinct "empty node" badge, not "智能体缺失"', () => {
    const workflow = wf([{ id: 'n1', agentId: '', execution: 'serial' }]);
    const editGateMissingBadgeByKey = new Map([[editGateMissingKeyForWorkflowNode('n1'), true]]);
    render(
      <WorkflowVisualPreview
        workflow={workflow}
        members={MEMBERS}
        editGateMissingBadgeByKey={editGateMissingBadgeByKey}
        nodesRegenerated
      />,
    );
    expect(screen.getByTestId('office-workflow-visual-node-n1')).toHaveAttribute(
      'data-missing-agents',
      'true',
    );
    expect(screen.queryByTestId('office-workflow-visual-missing-n1')).not.toBeInTheDocument();
    expect(screen.getByTestId('office-workflow-visual-empty-n1')).toBeInTheDocument();
  });

  it('without regeneration: empty node (e.g. after unbind) still red-frames with empty badge', () => {
    const workflow = wf([{ id: 'n1', agentId: '', execution: 'serial' }]);
    render(
      <WorkflowVisualPreview
        workflow={workflow}
        members={MEMBERS}
      />,
    );
    expect(screen.getByTestId('office-workflow-visual-node-n1')).toHaveAttribute(
      'data-missing-agents',
      'true',
    );
    expect(screen.getByTestId('office-workflow-visual-empty-n1')).toBeInTheDocument();
    expect(screen.queryByTestId('office-workflow-visual-missing-n1')).not.toBeInTheDocument();
  });

  it('without regeneration: open-snapshot missing wins over empty label when map flags the node', () => {
    const workflow = wf([{ id: 'n1', agentId: '', execution: 'serial' }]);
    const editGateMissingBadgeByKey = new Map([[editGateMissingKeyForWorkflowNode('n1'), true]]);
    render(
      <WorkflowVisualPreview
        workflow={workflow}
        members={MEMBERS}
        editGateMissingBadgeByKey={editGateMissingBadgeByKey}
      />,
    );
    expect(screen.getByTestId('office-workflow-visual-node-n1')).toHaveAttribute(
      'data-missing-agents',
      'true',
    );
    expect(screen.getByTestId('office-workflow-visual-missing-n1')).toBeInTheDocument();
    expect(screen.queryByTestId('office-workflow-visual-empty-n1')).not.toBeInTheDocument();
  });
});
