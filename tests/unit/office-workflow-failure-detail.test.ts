import { describe, expect, it } from 'vitest';
import { appendGatewayTerminalErrorDetail } from '../../electron/services/office/gateway-run-error';
import {
  extractWorkflowFailureReasonHint,
  formatWorkflowAgentFailureDetail,
} from '../../electron/services/office/workflow-agent-reply';

describe('formatWorkflowAgentFailureDetail', () => {
  it('appends gateway terminal reason for model_error', () => {
    const detail = appendGatewayTerminalErrorDetail(
      '未收到模型正文',
      '⚠️ API rate limit reached. Please try again later.',
    );
    expect(
      formatWorkflowAgentFailureDetail({
        issues: ['model_error'],
        detail,
      }),
    ).toBe('模型运行时错误(API rate limit reached. Please try again later.)');
  });

  it('appends raw stub reason when model_error detail is the provider message', () => {
    expect(
      formatWorkflowAgentFailureDetail({
        issues: ['model_error'],
        detail: 'The AI service is temporarily overloaded. Please try again in a moment.',
      }),
    ).toBe(
      '模型运行时错误(The AI service is temporarily overloaded. Please try again in a moment.)',
    );
  });

  it('keeps empty-body label with terminal reason for output-retry path', () => {
    const detail = appendGatewayTerminalErrorDetail(
      '未收到模型正文',
      'The AI service is temporarily overloaded. Please try again in a moment.',
    );
    expect(
      formatWorkflowAgentFailureDetail({
        issues: ['empty'],
        detail,
      }),
    ).toBe(
      '未收到模型正文(The AI service is temporarily overloaded. Please try again in a moment.)',
    );
  });

  it('appends gateway terminal reason for transport_error (RPC / call fail path)', () => {
    const detail = appendGatewayTerminalErrorDetail(
      '模型会话调用异常',
      'FailoverError: ⚠️ API rate limit reached. Please try again later.',
    );
    expect(
      formatWorkflowAgentFailureDetail({
        issues: ['transport_error'],
        detail,
      }),
    ).toBe('调用异常(API rate limit reached. Please try again later.)');
  });

  it('appends short cause even when it is a substring of the primary detail', () => {
    // Regression: old detail.includes(code) skipped enrich for「异常」inside「模型会话调用异常」.
    const detail = appendGatewayTerminalErrorDetail('模型会话调用异常', '异常');
    expect(detail).toContain('模型运行结束但未产出可校验回复：异常');
    expect(
      formatWorkflowAgentFailureDetail({
        issues: ['transport_error'],
        detail,
      }),
    ).toBe('调用异常(异常)');
  });

  it('does not double-append when primary detail already equals the cause', () => {
    const cause = '⚠️ API rate limit reached. Please try again later.';
    expect(appendGatewayTerminalErrorDetail(cause, cause)).toBe(cause);
  });

  it('does not invent a parenthetical for plain validation labels', () => {
    expect(
      formatWorkflowAgentFailureDetail({
        issues: ['invalid_json_syntax'],
        detail: 'JSON 语法错误（字符串内双引号须转义为 \\"；已尝试自动修复但失败）',
      }),
    ).toBe('JSON 语法错误（字符串内双引号须转义为 \\"；已尝试自动修复但失败）');
  });

  it('does not append a reason for user-abort detail', () => {
    expect(
      formatWorkflowAgentFailureDetail({
        issues: [],
        detail: '用户已手动中止本项目',
      }),
    ).toBe('用户已手动中止本项目');
    expect(extractWorkflowFailureReasonHint('用户已手动中止本项目')).toBeUndefined();
  });

  it('does not parenthesize Chinese synonym detail for transport_timeout', () => {
    // issue label「回复超时」vs validation detail「等待模型回复超时」— not a provider cause.
    expect(
      formatWorkflowAgentFailureDetail({
        issues: ['transport_timeout'],
        detail: '等待模型回复超时',
      }),
    ).toBe('回复超时');
  });

  it('is idempotent when detail is already label(reason)', () => {
    const once = formatWorkflowAgentFailureDetail({
      issues: ['model_error'],
      detail: 'API rate limit reached. Please try again later.',
    });
    expect(once).toBe('模型运行时错误(API rate limit reached. Please try again later.)');
    expect(
      formatWorkflowAgentFailureDetail({
        issues: ['model_error'],
        detail: once,
      }),
    ).toBe(once);
  });

  it('does not put bare Aborted into the formatted string (avoids runner abort rewrite false positive)', () => {
    // Bare Abort sentinel must not become label(Aborted); runner rewrites exact "Aborted" only.
    const formatted = formatWorkflowAgentFailureDetail({
      issues: ['transport_error'],
      detail: 'Aborted',
    });
    expect(formatted.includes('Aborted')).toBe(false);
    expect(formatted).toBe('调用异常');
  });

  it('still appends provider text that merely contains the word Aborted', () => {
    expect(
      formatWorkflowAgentFailureDetail({
        issues: ['model_error'],
        detail: 'Request Aborted by upstream gateway',
      }),
    ).toBe('模型运行时错误(Request Aborted by upstream gateway)');
  });

  it('appends concrete disk-missing detail under deliverable_paths_missing_on_disk', () => {
    expect(
      formatWorkflowAgentFailureDetail({
        issues: ['deliverable_paths_missing_on_disk'],
        detail: '缺少文件：交付物-PM/plan.md',
      }),
    ).toBe(
      'deliverable.path 声明的路径未在项目目录中找到，须先落盘(缺少文件：交付物-PM/plan.md)',
    );
  });
});
