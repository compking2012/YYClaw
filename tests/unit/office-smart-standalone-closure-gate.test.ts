import { describe, expect, it } from 'vitest';
import {
  collectSmartEverDelegatedAgentIds,
  isSmartProjectEngineComplete,
  isSmartStandaloneDelegatedClosureReady,
} from '@/lib/office-smart-coordinator-dispatch';
import { validateSmartRoomMentionSync } from '../../electron/services/office/room-mention-smart-validation';
import type { RoomMessage } from '@/types/office';

const PROJECT_ID = 'project-standalone-1';
const COORD = 'man-hua-fu-ze-ren';

const team = [
  { agentId: COORD, displayName: '漫画负责人' },
  { agentId: 'man-hua-ce-hua', displayName: '漫画策划' },
  { agentId: 'man-hua-bian-ju', displayName: '漫画编剧' },
  { agentId: 'ppt-she-ji-shi', displayName: 'PPT设计师' },
  { agentId: 'idle-member', displayName: '闲置成员' },
];

function coordAssignJson(role: string, task = '执行任务'): string {
  return JSON.stringify({
    role: '漫画负责人',
    inputValidation: '无',
    taskUnderstanding: `指派 ${role}`,
    action: 'assign',
    deliverable: { items: [], outputValidation: [] },
    dispatch: [{ role, task }],
  });
}

function memberEndMsg(fromAgentId: string, id: string): RoomMessage {
  return {
    id,
    projectId: PROJECT_ID,
    from: fromAgentId,
    fromAgentId,
    content: '交付完成',
    mentions: [],
    timestamp: Date.now(),
    smartMemberEnd: true,
  };
}

function coordAssignMsg(id: string, role: string, ts: number): RoomMessage {
  const raw = coordAssignJson(role);
  return {
    id,
    projectId: PROJECT_ID,
    from: COORD,
    fromAgentId: COORD,
    content: `指派 ${role}`,
    mentions: [],
    timestamp: ts,
    smartJsonRaw: raw,
  };
}

describe('standalone Smart · ever-delegated closure gate', () => {
  it('collectSmartEverDelegatedAgentIds unions historical assign targets', () => {
    const room: RoomMessage[] = [
      coordAssignMsg('a1', '漫画策划', 1),
      coordAssignMsg('a2', '漫画编剧', 2),
      coordAssignMsg('a3', 'PPT设计师', 3),
    ];
    expect(
      collectSmartEverDelegatedAgentIds({
        roomMessages: room,
        projectId: PROJECT_ID,
        coordinatorAgentId: COORD,
        teamRoles: team,
      }),
    ).toEqual(['man-hua-ce-hua', 'man-hua-bian-ju', 'ppt-she-ji-shi']);
  });

  it('never-delegated roster member does not block standalone closure', () => {
    const room: RoomMessage[] = [
      coordAssignMsg('a1', '漫画策划', 1),
      coordAssignMsg('a2', '漫画编剧', 2),
      coordAssignMsg('a3', 'PPT设计师', 3),
      memberEndMsg('man-hua-ce-hua', 'm1'),
      memberEndMsg('man-hua-bian-ju', 'm2'),
      memberEndMsg('ppt-she-ji-shi', 'm3'),
    ];
    expect(
      isSmartStandaloneDelegatedClosureReady({
        roomMessages: room,
        projectId: PROJECT_ID,
        coordinatorAgentId: COORD,
        teamRoles: team,
      }),
    ).toBe(true);
    expect(
      isSmartProjectEngineComplete({
        steps: [],
        roomMessages: room,
        projectId: PROJECT_ID,
        coordinatorAgentId: COORD,
        teamRoles: team,
      }),
    ).toBe(true);
  });

  it('blocks when a delegated member lacks smartMemberEnd', () => {
    const room: RoomMessage[] = [
      coordAssignMsg('a1', '漫画策划', 1),
      coordAssignMsg('a2', '漫画编剧', 2),
      memberEndMsg('man-hua-ce-hua', 'm1'),
    ];
    expect(
      isSmartProjectEngineComplete({
        steps: [],
        roomMessages: room,
        projectId: PROJECT_ID,
        coordinatorAgentId: COORD,
        teamRoles: team,
      }),
    ).toBe(false);
  });

  it('blocks coordinator action=end with zero assign history (M4)', () => {
    const raw = JSON.stringify({
      role: '漫画负责人',
      inputValidation: '无',
      taskUnderstanding: '未 kickoff 不应结项',
      action: 'end',
      deliverable: { items: [], outputValidation: [] },
      dispatch: [],
    });
    const r = validateSmartRoomMentionSync({
      raw,
      transportReason: 'empty',
      isCoordinator: true,
      coordinatorAgentId: COORD,
      smartWorkSteps: [],
      teamRoles: team,
      projectId: PROJECT_ID,
      roomMessages: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues).toContain('smart_coordinator_premature_project_end');
    }
  });

  it('allows coordinator action=end when all ever-delegated members reported smartMemberEnd', () => {
    const room: RoomMessage[] = [
      coordAssignMsg('a1', '漫画策划', 1),
      coordAssignMsg('a2', '漫画编剧', 2),
      coordAssignMsg('a3', 'PPT设计师', 3),
      memberEndMsg('man-hua-ce-hua', 'm1'),
      memberEndMsg('man-hua-bian-ju', 'm2'),
      memberEndMsg('ppt-she-ji-shi', 'm3'),
    ];
    const raw = JSON.stringify({
      role: '漫画负责人',
      inputValidation: '-rw-r--r-- 1 user user 152391 Jul  9 11:07 漫画PPT-PPT设计师.pptx',
      taskUnderstanding: '三阶段全部验收通过，项目结项。',
      action: 'end',
      deliverable: { items: [], outputValidation: [] },
      dispatch: [],
    });
    const r = validateSmartRoomMentionSync({
      raw,
      transportReason: 'empty',
      isCoordinator: true,
      coordinatorAgentId: COORD,
      smartWorkSteps: [],
      teamRoles: team,
      projectId: PROJECT_ID,
      roomMessages: room,
    });
    expect(r.ok).toBe(true);
  });

  it('isSmartProjectEngineComplete is false when steps empty and no assign history', () => {
    expect(
      isSmartProjectEngineComplete({
        steps: [],
        roomMessages: [],
        projectId: PROJECT_ID,
        coordinatorAgentId: COORD,
        teamRoles: team,
      }),
    ).toBe(false);
  });
});
