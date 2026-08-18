import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayManager } from '@electron/gateway/manager';
import type { OfficeTempProject } from '@electron/services/office/types';
import {
  clearTaskUserAborted,
  markTaskUserAborted,
  isTaskUserAborted,
} from '@electron/services/office/task-run-abort-registry';
import { resetAbortQuiesceLocksForTests } from '@electron/services/office/project-abort-quiesce';

const getTempProject = vi.hoisted(() => vi.fn());
const upsertTempProject = vi.hoisted(() => vi.fn());
const startSmartTaskProgressDriver = vi.hoisted(() => vi.fn());

vi.mock('@electron/services/office/store', () => ({
  getTempProject,
  upsertTempProject,
}));

vi.mock('@electron/services/office/smart-task-progress-driver', () => ({
  startSmartTaskProgressDriver,
  stopSmartTaskProgressDriver: vi.fn(),
}));

vi.mock('@electron/services/office/room-mention-dispatch', () => ({
  clearSmartMentionDispatchInflightForTask: vi.fn(),
}));

import { ensureSmartTaskRunningAfterCoordinatorDispatch } from '@electron/services/office/smart-task-runner';

function smartAbortedQuiescing(): OfficeTempProject {
  return {
    id: 'proj-smart',
    title: 't',
    status: 'aborted',
    lifecycle: 'active',
    executionMode: 'smart',
    agentIds: ['coord', 'dev'],
    coordinatorAgentId: 'coord',
    abortQuiescing: true,
    abortGeneration: 2,
    nodeRuns: [],
    workflow: { mode: 'simple', nodes: [], edges: [] },
    createdAt: 1,
    updatedAt: 1,
  } as OfficeTempProject;
}

describe('smart revival during abort quiesce hole', () => {
  beforeEach(() => {
    resetAbortQuiesceLocksForTests();
    clearTaskUserAborted('proj-smart');
    markTaskUserAborted('proj-smart');
    vi.clearAllMocks();
    getTempProject.mockResolvedValue(smartAbortedQuiescing());
    upsertTempProject.mockImplementation(async (p: OfficeTempProject) => p);
  });

  it('repro: userInitiated coordinator dispatch revives running while abortQuiescing', async () => {
    const gateway = {
      isConnected: () => true,
      getStatus: () => ({ state: 'running' }),
    } as unknown as GatewayManager;

    const roomReply =
      '收到反馈，需优化界面布局。@开发 请将棋盘格子从96px再调小至约84px，同时优化整体界面配色、按钮样式、间距排版，提升美观度。修复后重新落盘。';
    const dispatch =
      '@开发 请优化界面布局。要求：将棋盘格子调至约84px；优化配色与间距；落盘 交付物-开发/index.html。';
    const coordinatorReplyText = JSON.stringify({
      role: 'PM',
      action: 'assign',
      roomReply,
      dispatch,
      taskUnderstanding: '用户要求优化界面',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: '无' },
    });

    const ok = await ensureSmartTaskRunningAfterCoordinatorDispatch(gateway, {
      group: { id: 'g1', workflow: { mode: 'simple', nodes: [], edges: [] }, agentIds: ['coord', 'dev'] },
      project: smartAbortedQuiescing(),
      coordinator: { agentId: 'coord', displayName: 'PM' },
      coordinatorReplyText,
      teamMembers: [
        { agentId: 'coord', displayName: 'PM' },
        { agentId: 'dev', displayName: '开发' },
      ],
      userInitiated: true,
    });

    // Fixed: quiescing hard-blocks revival even for userInitiated.
    expect(ok).toBe(false);
    expect(upsertTempProject).not.toHaveBeenCalled();
    expect(isTaskUserAborted('proj-smart')).toBe(true);
  });
});
