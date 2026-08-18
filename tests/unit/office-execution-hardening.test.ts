import { describe, expect, it } from 'vitest';
import { isPathInsideProjectRoot } from '../../src/lib/office-deliverable-path-scope';
import {
  resolveSmartCoordinatorDispatchTargets,
  structuredSmartDispatchHasDelegableItems,
} from '../../src/lib/office-smart-dispatch-targets';
import {
  smartMentionStallWatchdogMs,
  SMART_KICKOFF_MAX_FAIL_COUNT,
} from '../../src/lib/office-smart-mention-stall';
import {
  assertSmartResolvableExecutors,
  smartMemberWorkOrderSteps,
  smartAllMemberWorkOrderStepsDoneInRoom,
} from '../../src/lib/office-smart-work-order';
import { validateSmartFlowSemantics } from '../../src/lib/office-smart-flow-semantics';
import { smartAssignFollowUpAlreadyDispatched } from '../../electron/services/office/smart-assign-ledger';
import { filterSmartFollowUpMentionTargets } from '../../electron/services/office/room-follow-up-policy';
import { smartMentionReplyTimeoutMs } from '../../src/lib/office-task-execution-mode';

function coordinatorAssignJson(
  dispatch: Array<{ role: string; task: string }>,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    role: 'PM',
    action: 'assign',
    taskUnderstanding: '派活',
    inputValidation: '无',
    deliverable: { items: [], outputValidation: '无' },
    roomReply: '请相关同学按分工开工。',
    dispatch,
    ...extra,
  });
}

describe('office execution hardening', () => {
  it('resolveSmartCoordinatorDispatchTargets maps structured dispatch roles', () => {
    const raw = coordinatorAssignJson([{ role: '开发', task: '实现功能' }]);
    const team = [{ agentId: 'a-dev', displayName: '开发' }];
    const targets = resolveSmartCoordinatorDispatchTargets(raw, team, 'a-pm');
    expect(targets).toHaveLength(1);
    expect(targets[0]!.agentId).toBe('a-dev');
  });

  it('validateSmartFlowSemantics rejects unresolvable dispatch targets', () => {
    const raw = coordinatorAssignJson([{ role: '不存在的人', task: '干活' }], {
      roomReply: '@不存在的人 请开始',
    });
    const issues = validateSmartFlowSemantics({
      raw,
      isCoordinator: true,
      coordinatorAgentId: 'a-pm',
      teamRoles: [{ agentId: 'a-dev', displayName: '开发' }],
    });
    expect(issues).toContain('smart_dispatch_targets_unresolvable');
  });

  it('structuredSmartDispatchHasDelegableItems detects non-empty dispatch', () => {
    const raw = coordinatorAssignJson([{ role: '开发', task: 'x' }]);
    expect(structuredSmartDispatchHasDelegableItems(raw)).toBe(true);
  });

  it('assertSmartResolvableExecutors rejects steps with no matching agents', () => {
    expect(() =>
      assertSmartResolvableExecutors(
        [{ stepIndex: 1, nodeId: 's1', title: 't', roleIds: ['ghost'] }],
        ['a-dev'],
      ),
    ).toThrow(/没有任何步骤能匹配项目成员/);
  });

  it('smartMemberWorkOrderSteps does not fall back to empty-role steps', () => {
    const steps = smartMemberWorkOrderSteps(
      [
        { stepIndex: 1, nodeId: 's1', title: 'a', roleIds: [] },
        { stepIndex: 2, nodeId: 's2', title: 'b', roleIds: ['a-dev'] },
      ],
      'a-pm',
    );
    expect(steps).toHaveLength(1);
    expect(steps[0]!.roleIds).toEqual(['a-dev']);
  });

  it('smartAllMemberWorkOrderStepsDoneInRoom true when no member steps', () => {
    const done = smartAllMemberWorkOrderStepsDoneInRoom(
      [{ stepIndex: 1, nodeId: 's1', title: 'a', roleIds: [] }],
      [],
      'p1',
      'a-pm',
    );
    expect(done).toBe(true);
  });

  it('isPathInsideProjectRoot accepts paths under project root', () => {
    expect(
      isPathInsideProjectRoot('/tmp/project/foo.md', '/tmp/project'),
    ).toBe(true);
    expect(
      isPathInsideProjectRoot('/tmp/other/foo.md', '/tmp/project'),
    ).toBe(false);
  });

  it('smartMentionStallWatchdogMs defaults to 0', () => {
    const prev = process.env.SMART_MENTION_STALL_MS;
    delete process.env.SMART_MENTION_STALL_MS;
    expect(smartMentionStallWatchdogMs()).toBe(0);
    if (prev !== undefined) process.env.SMART_MENTION_STALL_MS = prev;
  });

  it('smartMentionReplyTimeoutMs uses watchdog when env set', () => {
    const prev = process.env.SMART_MENTION_STALL_MS;
    process.env.SMART_MENTION_STALL_MS = '120000';
    expect(smartMentionReplyTimeoutMs({ executionMode: 'smart' })).toBe(120_000);
    if (prev !== undefined) process.env.SMART_MENTION_STALL_MS = prev;
    else delete process.env.SMART_MENTION_STALL_MS;
  });

  it('filterSmartFollowUpMentionTargets skips when assign already dispatched', () => {
    const delegated = [{ id: 'a-dev', agentId: 'a-dev', name: '开发' }];
    const filtered = filterSmartFollowUpMentionTargets({
      executionMode: 'smart',
      coordinatorRoleId: 'a-pm',
      fromRoleId: 'a-pm',
      delegated,
      replyMessageId: 'msg-1',
      smartLastAssign: {
        messageId: 'msg-1',
        targetAgentIds: ['a-dev'],
        at: Date.now(),
        dispatchedAt: Date.now(),
      },
    });
    expect(filtered).toHaveLength(0);
  });

  it('smartAssignFollowUpAlreadyDispatched detects completed ledger', () => {
    expect(
      smartAssignFollowUpAlreadyDispatched(
        {
          messageId: 'm1',
          targetAgentIds: ['a'],
          at: 1,
          dispatchedAt: 2,
        },
        'm1',
      ),
    ).toBe(true);
  });

  it('SMART_KICKOFF_MAX_FAIL_COUNT is 3', () => {
    expect(SMART_KICKOFF_MAX_FAIL_COUNT).toBe(3);
  });
});
