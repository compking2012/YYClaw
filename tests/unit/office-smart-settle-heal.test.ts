import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomMessage } from '../../electron/services/office/types';

vi.mock('../../electron/services/office/store', () => ({
  getRoomMessages: vi.fn(),
  getTempProject: vi.fn(),
  listFixedGroups: vi.fn(),
  markProjectRunCompleted: vi.fn(),
}));

describe('smart settle heal', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('healSmartProjectRunningWithPublishedBundle marks completed when bundle covers closure', async () => {
    const officeStore = await import('../../electron/services/office/store');
    const completion = await import('../../electron/services/office/smart-task-completion');

    const closure: RoomMessage = {
      id: 'closure-1',
      groupId: 'g1',
      projectId: 'p1',
      from: 'coord',
      fromAgentId: 'coord',
      content: '全部完成\n\n【结项】',
      smartCoordinatorEnd: true,
      mentions: [],
      timestamp: 200,
      phase: 'project_closure',
    };
    const bundle: RoomMessage = {
      id: 'bundle-1',
      groupId: 'g1',
      projectId: 'p1',
      from: 'system',
      content: 'zip',
      mentions: [],
      timestamp: 201,
      phase: 'deliverable_bundle',
      replyToId: closure.id,
    };

    vi.mocked(officeStore.getTempProject).mockResolvedValue({
      id: 'p1',
      title: '漫画PPT',
      origin: 'standalone',
      agentIds: ['coord'],
      coordinatorAgentId: 'coord',
      lifecycle: 'active',
      featureDescription: '',
      description: '',
      status: 'running',
      executionMode: 'smart',
      nodeRuns: [],
      createdAt: 1,
      updatedAt: 2,
    });
    vi.mocked(officeStore.listFixedGroups).mockResolvedValue([]);
    vi.mocked(officeStore.getRoomMessages).mockResolvedValue([closure, bundle]);
    vi.mocked(officeStore.markProjectRunCompleted).mockResolvedValue({
      id: 'p1',
      title: '漫画PPT',
      status: 'completed',
    } as never);

    const healed = await completion.healSmartProjectRunningWithPublishedBundle('p1');
    expect(healed).toBe(true);
    expect(officeStore.markProjectRunCompleted).toHaveBeenCalledWith('p1');
    expect(completion.isSmartTaskMarkedRunning('p1')).toBe(false);
  });

  it('tryCompleteSmartProjectAfterRoomMessage skips deliverable_bundle phase', async () => {
    const completion = await import('../../electron/services/office/smart-task-completion');
    const healSpy = vi
      .spyOn(completion, 'healSmartProjectRunningWithPublishedBundle')
      .mockResolvedValue(false);
    const attemptSpy = vi
      .spyOn(completion, 'attemptSmartTaskAutoCompletionFromRoom')
      .mockResolvedValue(false);

    const done = await completion.tryCompleteSmartProjectAfterRoomMessage({
      id: 'bundle-1',
      groupId: 'g1',
      projectId: 'p1',
      from: 'system',
      content: 'zip',
      mentions: [],
      timestamp: 1,
      phase: 'deliverable_bundle',
    });

    expect(done).toBe(false);
    expect(healSpy).not.toHaveBeenCalled();
    expect(attemptSpy).not.toHaveBeenCalled();
  });
});
