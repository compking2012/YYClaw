import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OfficeExecutionMember, OfficeFixedGroup, OfficeTempProject, WorkflowNode } from '../../electron/services/office/types';

const getRoomMessages = vi.fn();
const updateRoomMessage = vi.fn();

vi.mock('../../electron/services/office/store', () => ({
  getRoomMessages: (...args: unknown[]) => getRoomMessages(...args),
  updateRoomMessage: (...args: unknown[]) => updateRoomMessage(...args),
}));

vi.mock('../../electron/services/office/office-execution-members', () => ({
  loadProjectExecutionMembers: vi.fn(async () => [
    { agentId: 'designer', displayName: 'Designer', emoji: '🎨' },
    { agentId: 'coord', displayName: 'Coord', emoji: '📋' },
  ]),
  resolveRoomCoordinatorMember: vi.fn((_g, _t, _p, member) =>
    member?.agentId === 'designer'
      ? { agentId: 'coord', displayName: 'Coord', emoji: '📋' }
      : null,
  ),
  executionMemberLabel: (m: { displayName: string }) => m.displayName,
}));

vi.mock('../../electron/services/office/workflow-graph', () => ({
  workflowForTask: vi.fn(() => ({ nodes: [{ id: 'gen-1' }], edges: [] })),
}));

vi.mock('../../electron/services/office/orchestrator', () => ({
  postRoomAnnouncement: vi.fn(),
}));

vi.mock('../../../src/lib/task-room-progress-reconcile', () => ({
  roomMessageAppliesToNode: vi.fn(() => true),
}));

vi.mock('../../../src/lib/office-workflow-role-step', () => ({
  roleHasWorkflowNodeDeliverable: vi.fn(() => false),
}));

// postPhase is internal — deliverWorkflowNodeRoomDeliver uses postPhase via module; mock workflow-room-handoff internals
// Instead test the running-row lookup logic via deliverWorkflowNodeRoomDeliver integration with mocks.

import { deliverWorkflowNodeRoomDeliver } from '../../electron/services/office/workflow-room-handoff';

const task: OfficeTempProject = {
  id: 'p1',
  title: 'Demo',
  status: 'running',
  lifecycle: 'active',
  agentIds: ['designer'],
  coordinatorAgentId: 'coord',
  nodeRuns: [],
  sequence: 1,
  createdAt: 1,
  description: '',
  featureDescription: '',
  origin: 'fixed_group',
  parentGroupId: 'g1',
};
const group = {
  id: 'g1',
  name: 'G',
  agentIds: ['designer', 'coord'],
  coordinatorAgentId: 'coord',
} as OfficeFixedGroup;
const node: WorkflowNode = { id: 'gen-1', title: 'Design', roleIds: ['designer'] };
const member: OfficeExecutionMember = {
  agentId: 'designer',
  displayName: 'Designer',
  emoji: '🎨',
};

describe('deliverWorkflowNodeRoomDeliver — running row lookup', () => {
  beforeEach(() => {
    getRoomMessages.mockReset();
    updateRoomMessage.mockReset();
  });

  it('finds task_running row when only fromAgentId is set (no legacy fromRoleId)', async () => {
    getRoomMessages.mockResolvedValue([
      {
        id: 'run-1',
        projectId: 'p1',
        from: 'agent',
        fromAgentId: 'designer',
        content: 'running',
        mentions: [],
        timestamp: 100,
        phase: 'task_running',
        nodeId: 'gen-1',
      },
    ]);
    updateRoomMessage.mockResolvedValue(undefined);

    // postPhase is not exported; deliver will call updateRoomMessage on running row
    await deliverWorkflowNodeRoomDeliver(
      {} as never,
      group,
      task,
      node,
      member,
      'deliverable.md',
      'usage note',
    );

    expect(updateRoomMessage).toHaveBeenCalledWith(
      'p1',
      'run-1',
      expect.objectContaining({ progressText: '执行完成' }),
    );
  });
});
