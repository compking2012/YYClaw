import { describe, it, expect } from 'vitest';
import {
  buildRoomMentionRetryPrompt,
  isLikelyModelRuntimeError,
  validateRoomMentionStructuredReply,
} from '../../electron/services/office/room-mention-structured-reply';

describe('coordinator kickoff retry', () => {
  const json = JSON.stringify({
    role: '上帝',
    taskUnderstanding:
      '作为协调者拆解「股市分析与投资规划」项目，分配子任务给三位股市分析师并行分析各自市场。',
    inputValidation: '无',
    deliverable: { items: [], outputValidation: '无' },
    roomReply:
      '【分工】任务拆解如下：\n\n第一阶段（并行）：@A股分析师 分析A股，@港股分析师 分析港股，@美股分析师 分析美股。',
    action: 'assign',
    dispatch: [
      {
        role: 'A股分析师',
        task: '分析A股过去5年表现；输出A股分析报告-A股分析师.md；验收标准：格式 Markdown，正文≥500字。',
      },
      {
        role: '港股分析师',
        task: '分析港股过去5年表现；输出港股分析报告-港股分析师.md；验收标准：格式 Markdown，正文≥500字。',
      },
      {
        role: '美股分析师',
        task: '分析美股过去5年表现；输出美股分析报告-美股分析师.md；验收标准：格式 Markdown，正文≥500字。',
      },
    ],
  });

  const team = [
    { id: 'god', name: '上帝', agentId: 'a-god' },
    { id: 'cn', name: 'A股分析师', agentId: 'a-cn' },
    { id: 'hk', name: '港股分析师', agentId: 'a-hk' },
    { id: 'us', name: '美股分析师', agentId: 'a-us' },
    { id: 'plan', name: '投资规划师', agentId: 'a-plan' },
  ];

  it('does not treat deliverable「正文≥500字」as model HTTP 5xx error', () => {
    expect(isLikelyModelRuntimeError('正文≥500字')).toBe(false);
    expect(isLikelyModelRuntimeError('HTTP 500 internal error')).toBe(true);
  });

  it('accepts coordinator kickoff JSON with ≥500字 in dispatch', () => {
    const r = validateRoomMentionStructuredReply({
      raw: json,
      transportReason: 'empty',
      executionMode: 'smart',
      isCoordinator: true,
      actorRoleName: '上帝',
      coordinatorRoleId: 'god',
      smartWorkSteps: [],
      smartNextExecutorRoleIds: ['cn', 'hk', 'us'],
      teamRoles: team,
      taskId: 't-stock',
      roomMessages: [],
      needsDecomposition: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) {
      expect(r.issues).not.toContain('model_error');
    }
  });

  it('retry header reason must not duplicate bracket mirror when validation fails', () => {
    const r = validateRoomMentionStructuredReply({
      raw: json,
      transportReason: 'empty',
      executionMode: 'smart',
      isCoordinator: true,
      actorRoleName: '上帝',
      coordinatorRoleId: 'god',
      smartWorkSteps: [],
      smartNextExecutorRoleIds: ['cn'],
      teamRoles: team,
      taskId: 't-stock',
      roomMessages: [],
      needsDecomposition: false,
    });
    if (r.ok) return;
    const retry = buildRoomMentionRetryPrompt({
      roleName: '上帝',
      priorRaw: json,
      executionMode: 'smart',
      isCoordinator: true,
      validationDetail: r.detail,
      issues: r.issues,
      baseAgentPrompt: 'BASE_PROMPT',
    });
    const header = retry.slice(0, retry.indexOf('BASE_PROMPT'));
    expect(header).toMatch(/^【上帝-格式错误】，原因：/);
    expect(header).not.toMatch(/【输入校验】无/);
    expect(header).not.toMatch(/【任务理解】作为协调者/);
    expect(header).toContain('--上一轮输出：');
    expect(header).toContain(json);
  });
});
