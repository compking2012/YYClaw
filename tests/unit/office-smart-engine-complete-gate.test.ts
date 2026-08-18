import { describe, expect, it } from 'vitest';
import { validateSmartRoomMentionSync } from '../../electron/services/office/room-mention-smart-validation';

describe('resolveProjectEngineComplete — empty smartWorkSteps', () => {
  it('blocks coordinator action=end when smartWorkSteps is empty and no assign history', () => {
    const raw = JSON.stringify({
      role: 'PM',
      inputValidation: '无',
      taskUnderstanding: '工单未加载，不应允许结项。',
      action: 'end',
      deliverable: { items: [], outputValidation: '无' },
      roomReply: '项目全部完成，感谢各位协作。',
      dispatch: [],
    });
    const r = validateSmartRoomMentionSync({
      raw,
      transportReason: 'empty',
      isCoordinator: true,
      coordinatorAgentId: 'coord',
      smartWorkSteps: [],
      teamRoles: [{ agentId: 'coord', displayName: 'PM' }],
      projectId: 'p1',
      roomMessages: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues).toContain('smart_coordinator_premature_project_end');
    }
  });
});
