import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const publishBundleMock = vi.fn();
const removeSessionDirMock = vi.fn();

vi.mock('@electron/services/office/project-deliverables-bundle', () => ({
  deliverablesBundlePublishSucceeded: (outcome: { status: string }) => (
    outcome.status === 'published' || outcome.status === 'no_files' || outcome.status === 'already_announced'
  ),
  findCoordinatorProjectClosureInRoomMessages: () => null,
  publishProjectDeliverablesBundleMessage: (...args: unknown[]) => publishBundleMock(...args),
}));

vi.mock('@electron/services/office/office-project-session-dir', () => ({
  removeOfficeProjectSessionDir: (...args: unknown[]) => removeSessionDirMock(...args),
}));

vi.mock('@electron/services/office/office-execution-members', () => ({
  loadProjectExecutionMembers: async () => ([
    { agentId: 'coord', displayName: '协调者', emoji: '🤖' },
  ]),
}));

vi.mock('@electron/services/office/task-coordinator', () => ({
  resolveProjectCoordinatorAgentId: () => 'coord',
}));

vi.mock('@electron/services/office/orchestrator', () => ({
  postRoomAnnouncement: async () => ({
    id: 'closure-1',
    fromAgentId: 'coord',
    content: '✅ 各成员顺利完成任务，本项目结束。',
    timestamp: Date.now(),
  }),
}));

vi.mock('@electron/services/office/store', () => ({
  getRoomMessages: async () => [],
}));

describe('announceTaskProjectClosure session cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    publishBundleMock.mockResolvedValue({ status: 'published', message: { id: 'bundle-1' } });
    removeSessionDirMock.mockResolvedValue(undefined);
  });

  it('removes .session only after deliverables bundle publish succeeds', async () => {
    const home = mkdtempSync(join(tmpdir(), 'office-closure-session-'));
    const projectRoot = join(home, 'proj');
    const sessionDir = join(projectRoot, '.session');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'session_协调者.md'), '# session', 'utf8');

    const project = {
      id: 'proj-1',
      title: 'Demo',
      projectRootPath: projectRoot,
      coordinatorAgentId: 'coord',
      agentIds: ['coord'],
      status: 'completed' as const,
      nodeRuns: [],
      workflow: { mode: 'simple' as const, nodes: [], edges: [] },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const { announceTaskProjectClosure } = await import(
      '@electron/services/office/workflow-project-closure'
    );
    await announceTaskProjectClosure({} as never, {
      id: 'group-1',
      name: 'G',
      agentIds: ['coord'],
      coordinatorAgentId: 'coord',
      executionMode: 'workflow',
      workflow: { mode: 'simple', nodes: [], edges: [] },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }, project, new Map(), []);

    expect(publishBundleMock).toHaveBeenCalledTimes(1);
    expect(removeSessionDirMock).toHaveBeenCalledWith(project);
  });

  it('keeps .session when deliverables bundle publish does not succeed', async () => {
    publishBundleMock.mockResolvedValue({ status: 'closure_missing' });

    const { announceTaskProjectClosure } = await import(
      '@electron/services/office/workflow-project-closure'
    );
    await announceTaskProjectClosure({} as never, {
      id: 'group-1',
      name: 'G',
      agentIds: ['coord'],
      coordinatorAgentId: 'coord',
      executionMode: 'workflow',
      workflow: { mode: 'simple', nodes: [], edges: [] },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }, {
      id: 'proj-2',
      title: 'Demo',
      coordinatorAgentId: 'coord',
      agentIds: ['coord'],
      status: 'completed',
      nodeRuns: [],
      workflow: { mode: 'simple', nodes: [], edges: [] },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }, new Map(), []);

    expect(removeSessionDirMock).not.toHaveBeenCalled();
  });
});
