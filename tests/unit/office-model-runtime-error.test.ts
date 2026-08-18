import { describe, it, expect } from 'vitest';
import { isLikelyModelRuntimeError } from '../../electron/services/office/room-mention-structured-reply';

describe('isLikelyModelRuntimeError (conservative)', () => {
  it('rejects structured Smart JSON and bracket mirror', () => {
    expect(
      isLikelyModelRuntimeError(
        JSON.stringify({
          role: '上帝',
          taskUnderstanding: '拆解任务',
          inputValidation: '无',
          deliverable: { items: [], outputValidation: '无' },
          roomReply: '@A股分析师 请开始',
          dispatch: '正文≥500字',
        }),
      ),
    ).toBe(false);
    expect(
      isLikelyModelRuntimeError(
        ['【任务理解】拆解', '【输入校验】无', '【群聊回复】@PM 请执行'].join('\n'),
      ),
    ).toBe(false);
  });

  it('rejects business copy that mentions limits, codes, or keys', () => {
    expect(isLikelyModelRuntimeError('正文≥500字')).toBe(false);
    expect(isLikelyModelRuntimeError('请分析 rate limit 策略对 API 设计的影响，并举例 429 场景。')).toBe(
      false,
    );
    expect(isLikelyModelRuntimeError('文档需说明 no api key 时的降级方案')).toBe(false);
    expect(isLikelyModelRuntimeError('error 500 字以内的摘要')).toBe(false);
    expect(
      isLikelyModelRuntimeError(
        '@A股分析师 子任务说明\n\n【验收标准】\n- 格式：Markdown，正文≥500字\n- HTTP 500 仅作历史数据参考',
      ),
    ).toBe(false);
  });

  it('accepts short high-confidence runtime error stubs', () => {
    expect(isLikelyModelRuntimeError('Agent failed: connection reset')).toBe(true);
    expect(isLikelyModelRuntimeError('All models failed')).toBe(true);
    expect(isLikelyModelRuntimeError('model_not_found')).toBe(true);
    expect(isLikelyModelRuntimeError('No API key configured for provider openai')).toBe(true);
    expect(isLikelyModelRuntimeError('HTTP 429 rate limit exceeded')).toBe(true);
    expect(isLikelyModelRuntimeError('HTTP 500 internal server error')).toBe(true);
    expect(isLikelyModelRuntimeError('Error: 503 service unavailable')).toBe(true);
  });

  it('rejects embedded error phrases inside long coordinator dispatch', () => {
    const longDispatch = [
      '@A股分析师 分析A股',
      '【验收标准】',
      '- 正文≥500字',
      '- 若遇到 HTTP 500 需重试（说明性文字，非运行时错误）',
      '- rate limit 由协调者统一管控，成员无需关心 429',
      '- no api key 场景由管理员配置',
    ].join('\n');
    expect(isLikelyModelRuntimeError(longDispatch)).toBe(false);
  });
});
