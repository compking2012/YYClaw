import { describe, expect, it } from 'vitest';
import type { SmartWorkOrderStep } from '../../src/lib/office-smart-work-order';
import { validateSmartFlowSemantics } from '../../src/lib/office-smart-flow-semantics';
import {
  buildSmartCoordinatorClosureConflictRetryHeader,
  buildSmartMentionFormatRetryHeader,
  coordinatorDeclaresClosureConflictAction,
  isClosureConflictOnlyFailure,
  SMART_COORDINATOR_PREMATURE_PROJECT_END_ISSUE,
} from '../../src/lib/office-smart-retry-prompt';
import { isSmartTaskClosureGateOpen } from '../../electron/services/office/smart-task-completion';
import { validateSmartRoomMentionSync } from '../../electron/services/office/room-mention-smart-validation';

describe('office smart coordinator closure conflict', () => {
  const prematureEndJson = JSON.stringify({
    role: 'PM',
    inputValidation: '无',
    taskUnderstanding: '开发尚未在群内汇报完成，协调者误判可结项。',
    action: 'end',
    deliverable: { items: [], outputValidation: '无' },
    roomReply: '全部子任务已验收，项目正式结束，感谢各位参与。',
    dispatch: [],
  });

  const steps: SmartWorkOrderStep[] = [
    { stepIndex: 1, nodeId: 'n1', title: '开发', roleIds: ['a-dev'] },
  ];

  const team = [
    { id: 'pm', name: 'PM', agentId: 'a-pm' },
    { id: 'dev', name: '开发', agentId: 'a-dev' },
  ];

  const flowBase = {
    raw: prematureEndJson,
    jsonRaw: prematureEndJson,
    isCoordinator: true,
    coordinatorAgentId: 'a-pm',
    smartWorkSteps: steps,
    teamRoles: team,
    projectId: 't1',
    roomMessages: [],
  };

  it('isClosureConflictOnlyFailure accepts sole premature when raw empty (bracket mirror path)', () => {
    expect(
      isClosureConflictOnlyFailure({
        isCoordinator: true,
        raw: '',
        issues: [SMART_COORDINATOR_PREMATURE_PROJECT_END_ISSUE],
      }),
    ).toBe(true);
  });

  it('coordinatorDeclaresClosureConflictAction rejects assign action', () => {
    const assignJson = JSON.stringify({
      role: 'PM',
      taskUnderstanding: '改派',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: '无' },
      roomReply: '请继续执行下一阶段任务安排。',
      action: 'assign',
      dispatch: [{ role: '开发', task: '继续开发' }],
    });
    expect(coordinatorDeclaresClosureConflictAction(assignJson)).toBe(false);
  });

  it('isSmartTaskClosureGateOpen bypasses engine gate when forceCoordinatorProjectEnd', async () => {
    await expect(
      isSmartTaskClosureGateOpen({
        projectId: 'project-force-gate-bypass-test',
        forceCoordinatorProjectEnd: true,
      }),
    ).resolves.toBe(true);
  });

  it('isClosureConflictOnlyFailure requires sole premature issue and coordinator end', () => {
    expect(
      isClosureConflictOnlyFailure({
        isCoordinator: true,
        raw: prematureEndJson,
        issues: [SMART_COORDINATOR_PREMATURE_PROJECT_END_ISSUE],
      }),
    ).toBe(true);
    expect(
      isClosureConflictOnlyFailure({
        isCoordinator: true,
        raw: prematureEndJson,
        issues: [
          SMART_COORDINATOR_PREMATURE_PROJECT_END_ISSUE,
          'invalid_json_missing_fields',
        ],
      }),
    ).toBe(false);
    expect(
      isClosureConflictOnlyFailure({
        isCoordinator: false,
        raw: prematureEndJson,
        issues: [SMART_COORDINATOR_PREMATURE_PROJECT_END_ISSUE],
      }),
    ).toBe(false);
  });

  it('closure conflict retry header uses 结项冲突 not 格式错误', () => {
    const header = buildSmartCoordinatorClosureConflictRetryHeader({
      roleName: 'PM',
      priorRaw: prematureEndJson,
    });
    expect(header).toContain('【agent PM-结项冲突】');
    expect(header).toContain('本地逻辑怀疑工作顺序尚有步骤未完成');
    expect(header).not.toContain('格式错误');

    const formatHeader = buildSmartMentionFormatRetryHeader({
      roleName: 'PM',
      reasonDetail: 'x',
      priorRaw: prematureEndJson,
    });
    expect(formatHeader).toContain('格式错误');
    expect(formatHeader).not.toContain('结项冲突');
  });

  it('validateSmartFlowSemantics rejects premature without force flag', () => {
    const issues = validateSmartFlowSemantics(flowBase);
    expect(issues).toContain(SMART_COORDINATOR_PREMATURE_PROJECT_END_ISSUE);
  });

  it('validateSmartFlowSemantics bypasses premature when forceCoordinatorProjectEnd', () => {
    const issues = validateSmartFlowSemantics({
      ...flowBase,
      forceCoordinatorProjectEnd: true,
    });
    expect(issues).not.toContain(SMART_COORDINATOR_PREMATURE_PROJECT_END_ISSUE);
  });

  it('validateSmartRoomMentionSync accepts premature end when forceCoordinatorProjectEnd', () => {
    const r = validateSmartRoomMentionSync({
      raw: prematureEndJson,
      transportReason: 'empty',
      isCoordinator: true,
      coordinatorAgentId: 'a-pm',
      smartWorkSteps: steps,
      smartNextExecutorRoleId: 'a-dev',
      teamRoles: team,
      projectId: 't1',
      roomMessages: [],
      forceCoordinatorProjectEnd: true,
    });
    expect(r.ok).toBe(true);
  });

  it('validateSmartRoomMentionSync still rejects premature without force', () => {
    const r = validateSmartRoomMentionSync({
      raw: prematureEndJson,
      transportReason: 'empty',
      isCoordinator: true,
      coordinatorAgentId: 'a-pm',
      smartWorkSteps: steps,
      smartNextExecutorRoleId: 'a-dev',
      teamRoles: team,
      projectId: 't1',
      roomMessages: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues).toContain(SMART_COORDINATOR_PREMATURE_PROJECT_END_ISSUE);
    }
  });

  it('mixed premature + json issue is not closure-conflict-only', () => {
    const broken = '{"role":"PM","action":"end"';
    expect(
      isClosureConflictOnlyFailure({
        isCoordinator: true,
        raw: broken,
        issues: [
          SMART_COORDINATOR_PREMATURE_PROJECT_END_ISSUE,
          'invalid_json_syntax',
        ],
      }),
    ).toBe(false);
  });
});
