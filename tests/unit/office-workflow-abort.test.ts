import { describe, expect, it } from 'vitest';
import {
  isOfficeProjectAbortQuiescing,
  isUserAbortRoomMessage,
  settleWorkflowNodeRunsAfterStop,
  shouldBlockOfficeProgressWriteDuringAbort,
  taskSnapshotAfterAbortRequested,
  USER_ABORT_ROOM_MESSAGE,
  WORKFLOW_USER_ABORT_NODE_PROGRESS_TEXT,
} from '@/lib/office-workflow-abort';
import type { OfficeTempProject } from '@/types/office';

describe('isUserAbortRoomMessage', () => {
  it('matches the user-abort system terminal only', () => {
    expect(
      isUserAbortRoomMessage({ from: 'system', content: USER_ABORT_ROOM_MESSAGE }),
    ).toBe(true);
    expect(
      isUserAbortRoomMessage({ from: 'system', content: `  ${USER_ABORT_ROOM_MESSAGE}  ` }),
    ).toBe(true);
    expect(isUserAbortRoomMessage({ from: 'user', content: USER_ABORT_ROOM_MESSAGE })).toBe(false);
    expect(isUserAbortRoomMessage({ from: 'system', content: '执行失败：用户已手动中止' })).toBe(
      false,
    );
  });

  it('matches legacy workflow announceFailed progress card for red abort styling', () => {
    expect(
      isUserAbortRoomMessage({
        from: 'ruan-jian-kai-fa',
        fromAgentId: 'ruan-jian-kai-fa',
        progressText: '执行失败：用户已手动中止本项目',
      } as { from?: string; progressText?: string }),
    ).toBe(true);
  });

  it('does not treat quiet node-stopped progress as a second abort terminal', () => {
    expect(
      isUserAbortRoomMessage({
        from: 'ruan-jian-kai-fa',
        progressText: WORKFLOW_USER_ABORT_NODE_PROGRESS_TEXT,
      } as { from?: string; progressText?: string }),
    ).toBe(false);
  });
});

describe('isUserAbortFailureDetail', () => {
  it('detects user-abort failure copy', async () => {
    const { isUserAbortFailureDetail } = await import('@/lib/office-workflow-abort');
    expect(isUserAbortFailureDetail('用户已手动中止本项目')).toBe(true);
    expect(isUserAbortFailureDetail('执行失败：用户已手动中止本项目')).toBe(true);
    expect(isUserAbortFailureDetail('Gateway timeout')).toBe(false);
  });
});

describe('taskSnapshotAfterAbortRequested', () => {
  it('sets aborted + abortQuiescing with bumped generation', () => {
    const project = {
      id: 'p1',
      title: 't',
      status: 'running',
      lifecycle: 'active',
      agentIds: ['a1'],
      nodeRuns: [{ nodeId: 'n1', agentId: 'a1', status: 'running', sessionKey: 'agent:a1:task:p1' }],
      workflow: {
        mode: 'dag',
        nodes: [{ id: 'n1', agentId: 'a1', title: 'Step', execution: 'serial' }],
        edges: [],
      },
      abortGeneration: 2,
      createdAt: 1,
      updatedAt: 1,
    } as OfficeTempProject;

    const snap = taskSnapshotAfterAbortRequested(project, '用户已手动中止本项目', 9_000);
    expect(snap.status).toBe('aborted');
    expect(snap.abortQuiescing).toBe(true);
    expect(snap.abortGeneration).toBe(3);
    expect(snap.abortQuiesceStartedAt).toBe(9_000);
    expect(isOfficeProjectAbortQuiescing(snap)).toBe(true);
    expect(snap.nodeRuns[0]?.status).toBe('failed');
  });
});

describe('shouldBlockOfficeProgressWriteDuringAbort', () => {
  it('blocks running overwrite while quiescing', () => {
    expect(
      shouldBlockOfficeProgressWriteDuringAbort({
        before: { status: 'aborted', abortQuiescing: true },
        next: {
          status: 'running',
          abortQuiescing: false,
          nodeRuns: [{ nodeId: 'n1', agentId: 'a1', status: 'running' }],
        },
        userAborted: true,
        memoryQuiescing: false,
      }),
    ).toBe(true);
  });

  it('blocks completed overwrite while abort/quiesce active', () => {
    expect(
      shouldBlockOfficeProgressWriteDuringAbort({
        before: { status: 'aborted', abortQuiescing: true },
        next: {
          status: 'completed',
          abortQuiescing: false,
          nodeRuns: [{ nodeId: 'n1', agentId: 'a1', status: 'completed' }],
        },
        userAborted: true,
        memoryQuiescing: true,
      }),
    ).toBe(true);
  });

  it('blocks failed project status while abort context active', () => {
    expect(
      shouldBlockOfficeProgressWriteDuringAbort({
        before: { status: 'aborted', abortQuiescing: true },
        next: {
          status: 'failed',
          abortQuiescing: false,
          nodeRuns: [{ nodeId: 'n1', agentId: 'a1', status: 'failed' }],
        },
        userAborted: true,
        memoryQuiescing: false,
      }),
    ).toBe(true);
  });

  it('blocks aborted→failed demotion after quiesce flags cleared (14:14 hole)', () => {
    expect(
      shouldBlockOfficeProgressWriteDuringAbort({
        before: { status: 'aborted', abortQuiescing: false },
        next: {
          status: 'failed',
          abortQuiescing: false,
          nodeRuns: [{ nodeId: 'n1', agentId: 'a1', status: 'failed' }],
        },
        userAborted: false,
        memoryQuiescing: false,
      }),
    ).toBe(true);
  });

  it('allows aborted terminal write even when some nodes still pending', () => {
    expect(
      shouldBlockOfficeProgressWriteDuringAbort({
        before: { status: 'running', abortQuiescing: true },
        next: {
          status: 'aborted',
          abortQuiescing: true,
          nodeRuns: [
            { nodeId: 'n1', agentId: 'a1', status: 'failed' },
            { nodeId: 'n2', agentId: 'a2', status: 'pending' },
          ],
        },
        userAborted: true,
        memoryQuiescing: true,
      }),
    ).toBe(false);
  });

  it('allows aborted→running for a fresh re-run after claim', () => {
    expect(
      shouldBlockOfficeProgressWriteDuringAbort({
        before: { status: 'aborted', abortQuiescing: false },
        next: {
          status: 'running',
          abortQuiescing: false,
          nodeRuns: [{ nodeId: 'n1', agentId: 'a1', status: 'pending' }],
        },
        userAborted: false,
        memoryQuiescing: false,
      }),
    ).toBe(false);
  });
});

describe('settleWorkflowNodeRunsAfterStop', () => {
  it('marks running and pending nodes as failed with abort reason', () => {
    const project: Pick<OfficeTempProject, 'nodeRuns' | 'workflow'> = {
      workflow: {
        mode: 'dag',
        nodes: [
          { id: 'n1', agentId: 'a1', title: 'Step 1', execution: 'serial' },
          { id: 'n2', agentId: 'a2', title: 'Step 2', execution: 'serial' },
        ],
        edges: [{ from: 'n1', to: 'n2', when: 'on_success' }],
      },
      nodeRuns: [
        { nodeId: 'n1', agentId: 'a1', status: 'completed' },
        { nodeId: 'n2', agentId: 'a2', status: 'running' },
      ],
    };

    const settled = settleWorkflowNodeRunsAfterStop(project, '用户已手动中止本项目', 1_000);
    expect(settled).toEqual([
      { nodeId: 'n1', agentId: 'a1', status: 'completed' },
      {
        nodeId: 'n2',
        agentId: 'a2',
        status: 'failed',
        error: '用户已手动中止本项目',
        completedAt: 1_000,
      },
    ]);
  });

  it('fills missing workflow nodes as failed', () => {
    const project: Pick<OfficeTempProject, 'nodeRuns' | 'workflow'> = {
      workflow: {
        mode: 'dag',
        nodes: [{ id: 'n1', agentId: 'a1', title: 'Step 1', execution: 'serial' }],
        edges: [],
      },
      nodeRuns: [],
    };

    const settled = settleWorkflowNodeRunsAfterStop(project, '用户已手动中止本项目', 2_000);
    expect(settled).toEqual([
      {
        nodeId: 'n1',
        agentId: 'a1',
        status: 'failed',
        error: '用户已手动中止本项目',
        completedAt: 2_000,
      },
    ]);
  });
});
