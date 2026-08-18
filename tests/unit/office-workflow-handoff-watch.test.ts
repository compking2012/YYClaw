import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OfficeFixedGroup, OfficeTempProject, RoomMessage, WorkflowNode } from '../../electron/services/office/types';

const getRoomMessages = vi.fn();
const membersForFixedGroup = vi.fn();
const loadProjectExecutionMembers = vi.fn();
const announceWorkflowHandoff = vi.fn();

vi.mock('../../electron/services/office/store', () => ({
  getRoomMessages: (...args: unknown[]) => getRoomMessages(...args),
}));

vi.mock('../../electron/services/office/office-member-resolve', () => ({
  membersForFixedGroup: (...args: unknown[]) => membersForFixedGroup(...args),
}));

vi.mock('../../electron/services/office/office-execution-members', () => ({
  loadProjectExecutionMembers: (...args: unknown[]) => loadProjectExecutionMembers(...args),
  resolveRoomCoordinatorMember: vi.fn(() => ({ agentId: 'coord', displayName: 'Coord' })),
}));

vi.mock('../../electron/services/office/workflow-room-handoff', () => ({
  announceWorkflowHandoff: (...args: unknown[]) => announceWorkflowHandoff(...args),
}));

import {
  awaitOutstandingHandoffWatchesForTask,
  scheduleWorkflowHandoffCoordinatorWatch,
} from '../../electron/services/office/room-workflow-handoff-watch';
import { UNMENTIONED_RESPONSE_WAIT_MS } from '../../electron/services/office/room-unmentioned-coordinator';

const node: WorkflowNode = { id: 'gen-1', title: 'Step', roleIds: ['a1'] };
const project: OfficeTempProject = {
  id: 'p1',
  title: 'Demo',
  status: 'running',
  lifecycle: 'active',
  agentIds: ['a1'],
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
  agentIds: ['a1', 'coord'],
  coordinatorAgentId: 'coord',
} as OfficeFixedGroup;

describe('workflow handoff watch — promise lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getRoomMessages.mockReset();
    membersForFixedGroup.mockReset();
    loadProjectExecutionMembers.mockReset();
    announceWorkflowHandoff.mockReset();
    membersForFixedGroup.mockResolvedValue([
      { agentId: 'a1', displayName: 'A1' },
      { agentId: 'a2', displayName: 'A2' },
    ]);
    loadProjectExecutionMembers.mockResolvedValue([{ agentId: 'a1', displayName: 'A1' }]);
    getRoomMessages.mockResolvedValue([]);
    announceWorkflowHandoff.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('awaits coordinator fallback handoff before resolving the watch promise', async () => {
    const watchPromise = scheduleWorkflowHandoffCoordinatorWatch({
      gateway: {} as never,
      group,
      project,
      node,
      fromAgentId: 'a1',
      workflow: { nodes: [node], edges: [] },
      runs: new Map(),
      expectedHandoff: [{ roleId: 'a2', stepTitle: 'Next' }],
    });

    let settled = false;
    void watchPromise.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(UNMENTIONED_RESPONSE_WAIT_MS + 10);
    expect(settled).toBe(false);
    expect(announceWorkflowHandoff).toHaveBeenCalledTimes(1);

    await vi.runAllTimersAsync();
    await watchPromise;
    expect(settled).toBe(true);
  });

  it('resolves without fallback when valid handoff already exists', async () => {
    const handoff: RoomMessage = {
      id: 'h1',
      projectId: 'p1',
      from: 'agent',
      fromAgentId: 'a1',
      content: '@A2 请继续下一步',
      mentions: ['a2'],
      timestamp: Date.now(),
      nodeId: 'gen-1',
      phase: 'task_handoff',
    };
    getRoomMessages.mockResolvedValue([handoff]);

    const watchPromise = scheduleWorkflowHandoffCoordinatorWatch({
      gateway: {} as never,
      group,
      project,
      node,
      fromAgentId: 'a1',
      workflow: { nodes: [node], edges: [] },
      runs: new Map(),
      expectedHandoff: [{ roleId: 'a2', stepTitle: 'Next' }],
    });

    await vi.advanceTimersByTimeAsync(UNMENTIONED_RESPONSE_WAIT_MS + 100);
    await watchPromise;
    expect(announceWorkflowHandoff).not.toHaveBeenCalled();
  });

  it('skips coordinator fallback when handoff appears before announce (TOCTOU)', async () => {
    let call = 0;
    getRoomMessages.mockImplementation(async () => {
      call += 1;
      if (call >= 2) {
        return [{
          id: 'h1',
          projectId: 'p1',
          from: 'agent',
          fromAgentId: 'a1',
          content: '@A2 请继续下一步',
          mentions: ['a2'],
          timestamp: Date.now(),
          nodeId: 'gen-1',
          phase: 'task_handoff',
        }];
      }
      return [];
    });

    const watchPromise = scheduleWorkflowHandoffCoordinatorWatch({
      gateway: {} as never,
      group,
      project,
      node,
      fromAgentId: 'a1',
      workflow: { nodes: [node], edges: [] },
      runs: new Map(),
      expectedHandoff: [{ roleId: 'a2', stepTitle: 'Next' }],
    });

    await vi.advanceTimersByTimeAsync(UNMENTIONED_RESPONSE_WAIT_MS + 100);
    await watchPromise;
    expect(announceWorkflowHandoff).not.toHaveBeenCalled();
  });

  it('awaitOutstandingHandoffWatchesForTask blocks until fallback completes', async () => {
    scheduleWorkflowHandoffCoordinatorWatch({
      gateway: {} as never,
      group,
      project,
      node,
      fromAgentId: 'a1',
      workflow: { nodes: [node], edges: [] },
      runs: new Map(),
      expectedHandoff: [{ roleId: 'a2', stepTitle: 'Next' }],
    });

    await vi.advanceTimersByTimeAsync(UNMENTIONED_RESPONSE_WAIT_MS + 10);
    expect(announceWorkflowHandoff).toHaveBeenCalledTimes(1);

    const pending = awaitOutstandingHandoffWatchesForTask('p1');
    await vi.runAllTimersAsync();
    await pending;
    expect(announceWorkflowHandoff).toHaveBeenCalledTimes(1);
  });
});
