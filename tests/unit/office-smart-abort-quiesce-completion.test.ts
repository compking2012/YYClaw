import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearTaskUserAborted,
  markTaskUserAborted,
} from '@electron/services/office/task-run-abort-registry';
import {
  resetAbortQuiesceLocksForTests,
  setAbortQuiesceLock,
} from '@electron/services/office/project-abort-quiesce';

const getTempProject = vi.hoisted(() => vi.fn());
const markProjectRunCompleted = vi.hoisted(() => vi.fn());
const getRoomMessages = vi.hoisted(() => vi.fn());
const listFixedGroups = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock('@electron/services/office/store', () => ({
  getTempProject,
  markProjectRunCompleted,
  getRoomMessages,
  listFixedGroups,
}));

vi.mock('@electron/services/office/project-deliverables-bundle', () => ({
  deliverablesBundleCoversClosure: vi.fn(() => false),
  deliverablesBundlePublishSucceeded: vi.fn(() => true),
  latestDeliverablesBundleMessage: vi.fn().mockResolvedValue(null),
  publishProjectDeliverablesBundleMessage: vi.fn().mockResolvedValue({ status: 'published' }),
}));

vi.mock('@electron/services/office/office-workflow-log', () => ({
  officeWorkflowLog: vi.fn(),
}));

import { attemptSmartTaskAutoCompletionFromRoom } from '@electron/services/office/smart-task-completion';

describe('smart completion vs abort quiesce', () => {
  beforeEach(() => {
    resetAbortQuiesceLocksForTests();
    clearTaskUserAborted('proj-smart');
    vi.clearAllMocks();
    getTempProject.mockResolvedValue({
      id: 'proj-smart',
      status: 'aborted',
      executionMode: 'smart',
      abortQuiescing: true,
      agentIds: ['coord', 'dev'],
      coordinatorAgentId: 'coord',
      nodeRuns: [],
      workflow: { mode: 'simple', nodes: [], edges: [] },
      createdAt: 1,
      updatedAt: 1,
      lifecycle: 'active',
      title: 't',
    });
  });

  it('does not complete while user-aborted / abortQuiescing', async () => {
    markTaskUserAborted('proj-smart');
    setAbortQuiesceLock({
      projectId: 'proj-smart',
      generation: 1,
      startedAt: 1,
      staticSessionKeys: [],
      inflightSessionKeys: [],
      abortWork: Promise.resolve(),
    });

    const ok = await attemptSmartTaskAutoCompletionFromRoom({
      projectId: 'proj-smart',
      coordinatorAgentId: 'coord',
      roomMessages: [
        {
          id: 'm1',
          projectId: 'proj-smart',
          from: 'coord',
          fromAgentId: 'coord',
          content: '项目结束 end',
          smartCoordinatorEnd: true,
          mentions: [],
          timestamp: Date.now(),
        },
      ],
    });
    expect(ok).toBe(false);
    expect(markProjectRunCompleted).not.toHaveBeenCalled();
  });
});
