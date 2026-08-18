/**
 * Smart 模式审计单测：提示词 / few-shot / 校验 / 进群聊 / 点名 一致性探针。
 */
import { describe, expect, it } from 'vitest';
import { agent } from '../helpers/office-agents';
import { buildSmartMemberFewShotBlock } from '../../electron/services/office/room-prompts/smart/member-role-prompt';
import { buildSmartCoordinatorAgentTaskPrompt } from '../../src/lib/office-smart-coordinator-task-prompt';
import { roomMentionFewShotBlock } from '../../electron/services/office/room-prompts/few-shots';
import { SMART_MENTION_ALWAYS_RULE } from '../../electron/services/office/room-prompts/smart/blocks';
import { validateSmartJsonDeliverableItems } from '../../src/lib/office-deliverable-file-policy';
import { validateSmartRoomJsonStructure } from '../../src/lib/office-smart-json-validate';
import { pickRolesDelegatedByCoordinator } from '../../electron/services/office/room-coordinator-delegates';
import {
  smartCoordinatorReplyIsDispatching,
} from '../../src/lib/office-smart-coordinator-dispatch';
import { validateSmartFlowSemantics } from '../../src/lib/office-smart-flow-semantics';
import {
  roleReportedSubtaskDoneInRoom,
} from '../../src/lib/office-smart-work-order';
import {
  validateSmartMemberRoomReply,
} from '../../src/lib/office-smart-member-reply';
import {
  buildSmartMemberDispatchAssignment,
} from '../../src/lib/office-smart-room-fields';
import {
  buildRoomMentionRetryPrompt,
  MENTION_PUBLISH_SALVAGE_TRANSPORT_ISSUES,
  shouldAttemptMentionPublishSalvage,
} from '../../electron/services/office/room-mention-structured-reply';
import { formatSmartWorkflowMirrorIssue } from '../../src/lib/office-workflow-output-sections';
import type { RoomMessage } from '../../src/types/office';

function extractFewShotJson(block: string, marker: string): Record<string, unknown> {
  const idx = block.indexOf(marker);
  if (idx < 0) throw new Error(`marker not found: ${marker}`);
  const after = block.slice(idx + marker.length);
  const nextSection = after.search(/\n--- /u);
  const chunk = (nextSection >= 0 ? after.slice(0, nextSection) : after).trim();
  const start = chunk.indexOf('{');
  return JSON.parse(chunk.slice(start)) as Record<string, unknown>;
}

describe('office-smart audit: prompt / few-shot vs JSON validation', () => {
  it('few-shot doc example file path passes role-scoped deliverable validation', () => {
    const few = buildSmartMemberFewShotBlock();
    const json = extractFewShotJson(few, '--- 正向 1 · 文档 ---');
    const items = (json.deliverable as { items: string[] }).items;
    expect(items[0]).toBe('交付物-产品/requirements-产品.md');
    expect(validateSmartJsonDeliverableItems('产品', items)).toBe(true);
  });

  it('few-shot doc example passes validateSmartRoomJsonStructure', () => {
    const few = buildSmartMemberFewShotBlock();
    const json = extractFewShotJson(few, '--- 正向 1 · 文档 ---');
    const r = validateSmartRoomJsonStructure(JSON.stringify(json), {
      isCoordinator: false,
      actorRoleName: '产品',
    });
    expect(r.ok).toBe(true);
  });

  it('few-shot code directory example passes validation', () => {
    const few = buildSmartMemberFewShotBlock();
    const json = extractFewShotJson(few, '--- 正向 2 · 工程 ---');
    const items = (json.deliverable as { items: string[] }).items;
    expect(validateSmartJsonDeliverableItems('开发', items)).toBe(true);
    const r = validateSmartRoomJsonStructure(JSON.stringify(json), {
      isCoordinator: false,
      actorRoleName: '开发',
    });
    expect(r.ok).toBe(true);
  });

  it('coordinator few-shot unmentioned uses JSON not bracket sections', () => {
    const block = roomMentionFewShotBlock('smart', 'coordinator_unmentioned');
    expect(block).not.toContain('【分工】');
    expect(block).toContain('"dispatch"');
    const json = JSON.parse(block.split('--- 样例 1 ---')[1]!.trim());
    expect(json.action).toBe('assign');
    expect(json.dispatch[0].role).toBe('开发');
  });

  it('coordinator live prompt says dispatch not roomReply for assign', () => {
    const prompt = buildSmartCoordinatorAgentTaskPrompt({
      roleName: 'PM',
      teammateNames: ['开发'],
      currentTrigger: '请派活',
    });
    expect(prompt).toContain('dispatch');
    expect(prompt).toContain('禁止在 dispatch 中重复指派');
    expect(SMART_MENTION_ALWAYS_RULE).toContain('dispatch 数组');
    expect(SMART_MENTION_ALWAYS_RULE).not.toContain('【群聊回复】须 @协调者');
  });
});

describe('office-smart audit: dispatch vs roomReply routing', () => {
  it('roomReply @ coordinator does not satisfy mention when dispatch lacks coordinator', () => {
    const coord = agent('a-pm', 'PM');
    expect(
      validateSmartMemberRoomReply('请 @PM 验收完成。', coord, 'ready', {
        dispatchText: '无',
        memberEnd: true,
      }),
    ).toContain('smart_member_missing_coordinator');
  });

  it('roomReply @ peer does not fail when dispatch only targets coordinator', () => {
    const coord = { id: 'a-pm', name: 'PM', agentId: 'a-pm', createdAt: 0, updatedAt: 0 };
    const team = [
      coord,
      { id: 'a-dev', name: '开发', agentId: 'a-dev', createdAt: 0, updatedAt: 0 },
    ];
    expect(
      validateSmartMemberRoomReply('请 @开发 先看接口；我已完成，请 @PM 验收。', coord, 'ready', {
        teamRoles: team,
        dispatchText: '@PM 请验收 交付物-产品/requirements-产品.md',
        memberEnd: true,
        deliverablePathText: '交付物-产品/requirements-产品.md',
        actorRoleName: '产品',
      }),
    ).not.toContain('smart_member_mentions_peer');
    const peerIssues = validateSmartMemberRoomReply(
      '请 @开发 先看接口；我已完成。',
      coord,
      'ready',
      {
        teamRoles: team,
        dispatchText: '@开发 请配合',
        memberEnd: true,
        deliverablePathText: '交付物-产品/requirements-产品.md',
        actorRoleName: '产品',
      },
    );
    expect(peerIssues).toContain('smart_member_mentions_peer');
  });

  it('buildSmartMemberDispatchAssignment uses JSON dispatch only, not roomReply', () => {
    const raw = JSON.stringify({
      role: '协调者',
      action: 'assign',
      roomReply: '🚀 并行\n@专家A 任务A\n@专家B 任务B',
      dispatch: [{ role: '专家A', task: '任务A细节' }],
      taskUnderstanding: '拆解',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: [] },
    });
    expect(
      buildSmartMemberDispatchAssignment(raw, { id: 'b', name: '专家B' }, ''),
    ).toBe('');
    expect(
      buildSmartMemberDispatchAssignment(raw, { id: 'a', name: '专家A' }, ''),
    ).toContain('任务A细节');
  });

  it('buildSmartMemberDispatchAssignment falls back to coordinator publish text', () => {
    const publish = [
      '项目kickoff：并行调研',
      '',
      '@AI-Agent工程专家 目标：调研优秀方案。落盘路径：交付物-AI-Agent工程专家/report.md',
      '',
      '@大模型调优专家 目标：调研机会与未来。落盘路径：交付物-大模型调优专家/report.md',
    ].join('\n');
    const eng = buildSmartMemberDispatchAssignment(
      '',
      { id: 'eng', name: 'AI-Agent工程专家' },
      publish,
    );
    expect(eng).toContain('@AI-Agent工程专家');
    expect(eng).toContain('调研优秀方案');
    const tune = buildSmartMemberDispatchAssignment(
      '',
      { id: 'tune', name: '大模型调优专家' },
      publish,
    );
    expect(tune).toContain('@大模型调优专家');
    expect(tune).toContain('调研机会与未来');
  });

  it('smartCoordinatorReplyIsDispatching ignores roomReply @ when dispatch is 无', () => {
    expect(
      smartCoordinatorReplyIsDispatching({
        roomBody: '@开发 请开始实现',
        dispatch: '无',
      }),
    ).toBe(false);
  });

  it('pickRolesDelegatedByCoordinator ignores roomReply @ when dispatch is empty', () => {
    const team = [
      agent('coord', '协调者'),
      agent('a', '专家A'),
      agent('b', '专家B'),
    ];
    const raw = JSON.stringify({
      role: '协调者',
      action: 'assign',
      roomReply: '🚀 并行\n@专家A 任务A\n@专家B 任务B',
      dispatch: [],
      taskUnderstanding: '拆解',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: [] },
    });
    expect(
      pickRolesDelegatedByCoordinator(raw, team, 'coord', 'coord', {
        executionMode: 'smart',
      }).map((r) => r.agentId),
    ).toEqual([]);
  });

  it('hasSmartCoordinatorStructuredDispatch requires dispatch array not roomReply', async () => {
    const { hasSmartCoordinatorStructuredDispatch } = await import(
      '../../src/lib/office-smart-room-fields'
    );
    const roomOnly = JSON.stringify({
      role: 'PM',
      action: 'assign',
      roomReply: '@开发 请开工',
      dispatch: [],
      taskUnderstanding: '派活',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: '无' },
    });
    expect(hasSmartCoordinatorStructuredDispatch(roomOnly)).toBe(false);
    const withDispatch = JSON.stringify({
      role: 'PM',
      action: 'assign',
      roomReply: '@开发 请开工',
      dispatch: [{ role: '开发', task: '实现功能' }],
      taskUnderstanding: '派活',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: '无' },
    });
    expect(hasSmartCoordinatorStructuredDispatch(withDispatch)).toBe(true);
  });

  it('coordinator action=end passes semantics without dispatch @ or roomReply mention rules', () => {
    const raw = JSON.stringify({
      role: 'PM',
      action: 'end',
      roomReply: '@全员 项目结束，感谢协作。',
      dispatch: [],
      taskUnderstanding: '结项',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: '无' },
    });
    const issues = validateSmartFlowSemantics({
      raw,
      isCoordinator: true,
      coordinatorAgentId: 'a-pm',
      teamRoles: [agent('a-pm', 'PM')],
      smartWorkSteps: [],
      roomMessages: [],
      taskId: 't1',
    });
    expect(issues).not.toContain('smart_coordinator_missing_mention');
    expect(issues).not.toContain('smart_coordinator_project_end_has_mention');
  });
});

describe('office-smart audit: completion metadata', () => {
  it('roleReportedSubtaskDoneInRoom requires smartMemberEnd not text marker', () => {
    const room: RoomMessage[] = [
      {
        id: 'm1',
        scenarioId: 's1',
        projectId: 't1',
        from: 'dev',
        fromAgentId: 'a-dev',
        content: '**开发已完成**',
        mentions: [],
        timestamp: 1,
      },
    ];
    expect(roleReportedSubtaskDoneInRoom(room, 't1', 'a-dev')).toBe(false);
  });
});

describe('office-smart audit: salvage policy', () => {
  it('shouldAttemptMentionPublishSalvage allows transport-only failures', () => {
    expect(
      shouldAttemptMentionPublishSalvage({
        transportReason: 'timeout',
        issues: ['transport_timeout'],
      }),
    ).toBe(true);
    expect(
      shouldAttemptMentionPublishSalvage({
        transportReason: 'error',
        issues: ['transport_error'],
      }),
    ).toBe(true);
  });

  it('shouldAttemptMentionPublishSalvage rejects semantic validation failures', () => {
    expect(
      shouldAttemptMentionPublishSalvage({
        transportReason: 'empty',
        issues: ['smart_member_missing_coordinator'],
      }),
    ).toBe(false);
    expect(
      shouldAttemptMentionPublishSalvage({
        transportReason: 'timeout',
        issues: ['transport_timeout', 'invalid_json_schema'],
      }),
    ).toBe(false);
  });

  it('MENTION_PUBLISH_SALVAGE_TRANSPORT_ISSUES excludes semantic issues', () => {
    expect(MENTION_PUBLISH_SALVAGE_TRANSPORT_ISSUES.has('transport_timeout')).toBe(true);
    expect(MENTION_PUBLISH_SALVAGE_TRANSPORT_ISSUES.has('smart_member_missing_coordinator')).toBe(
      false,
    );
  });
});

describe('office-smart audit: retry copy', () => {
  it('smart retry without baseAgentPrompt omits deprecated bracket format', () => {
    const retry = buildRoomMentionRetryPrompt({
      roleName: '产品',
      priorRaw: '{"role":"产品"}',
      executionMode: 'smart',
      isCoordinator: false,
      issues: ['invalid_json_syntax'],
    });
    expect(retry).not.toContain('【输出格式·必须严格遵守】');
    expect(retry).not.toContain('【任务理解】');
  });

  it('formatSmartWorkflowMirrorIssue uses JSON field names for deliverable paths', () => {
    expect(formatSmartWorkflowMirrorIssue('deliverable_filename_missing_role_suffix')).toMatch(
      /deliverable\.items/,
    );
    expect(formatSmartWorkflowMirrorIssue('missing_task_understanding')).toContain(
      'taskUnderstanding',
    );
  });
});
