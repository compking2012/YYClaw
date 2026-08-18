import { describe, expect, it } from 'vitest';
import {
  classifyIntent,
  PRUNE_CONFIDENCE_THRESHOLD,
  type OptimizationProfile,
} from '@/lib/intent-classifier';

describe('classifyIntent', () => {
  it('detects coding intent (EN + CN) and keeps fs/exec groups', () => {
    for (const text of ['Refactor this TypeScript function', '帮我调试一下这段代码的报错']) {
      const p = classifyIntent({ text });
      expect(p.intent).toBe('coding');
      expect(p.keepGroups).toEqual(['fs', 'exec']);
      expect(p.confidence).toBeGreaterThanOrEqual(PRUNE_CONFIDENCE_THRESHOLD);
    }
  });

  it('detects document intent and keeps fs/office', () => {
    const p = classifyIntent({ text: '把这个 Excel 表格转换成 PDF' });
    expect(p.intent).toBe('file_docs');
    expect(p.keepGroups).toEqual(['fs', 'office']);
  });

  it('detects web research and keeps search/browser with recent history', () => {
    const p = classifyIntent({ text: '搜索一下今天的最新新闻' });
    expect(p.intent).toBe('web_research');
    expect(p.keepGroups).toEqual(['search', 'browser']);
    expect(p.historyMode).toBe('recent');
  });

  it('detects image/media intent', () => {
    const p = classifyIntent({ text: 'draw a poster for our launch' });
    expect(p.intent).toBe('image_media');
    expect(p.keepGroups).toEqual(['media']);
  });

  it('treats short greetings as quick_qa with no extra tool groups', () => {
    const p = classifyIntent({ text: '你好,在吗?' });
    expect(p.intent).toBe('quick_qa');
    expect(p.keepGroups).toEqual([]);
    expect(p.confidence).toBeGreaterThanOrEqual(PRUNE_CONFIDENCE_THRESHOLD);
  });

  it('treats a bare CJK greeting with no trailing punctuation as quick_qa', () => {
    // Regression: `\b` never matches right after a CJK character (not `\w`),
    // so a naive `(你好|...)\b` alternation silently fails to match "你好" alone.
    expect(classifyIntent({ text: '你好' }).intent).toBe('quick_qa');
    expect(classifyIntent({ text: '谢谢' }).intent).toBe('quick_qa');
  });

  it('falls back to keep-all (no pruning) for ambiguous input', () => {
    const p = classifyIntent({ text: 'Help me think through our Q3 strategy and tradeoffs' });
    expect(p.intent).toBe('unknown');
    expect(p.confidence).toBeLessThan(PRUNE_CONFIDENCE_THRESHOLD);
    // keep-all profile must include every group so enforcement prunes nothing
    expect([...p.keepGroups].sort()).toEqual(
      ['browser', 'exec', 'fs', 'media', 'office', 'search'],
    );
  });

  it('returns the safe keep-all fallback for empty input', () => {
    const p: OptimizationProfile = classifyIntent({ text: '   ' });
    expect(p.intent).toBe('unknown');
    expect(p.confidence).toBe(0);
    expect(p.historyMode).toBe('full');
  });

  it('does not misclassify a long question merely ending with "?" as quick_qa', () => {
    const longQuestion =
      'I have been mulling over how our team should reorganize the roadmap for the second half, '
      + 'considering the competing priorities across product and infra teams, what do you think?';
    const p = classifyIntent({ text: longQuestion });
    expect(p.intent).not.toBe('quick_qa');
  });

  it('never throws on unusual input', () => {
    expect(() => classifyIntent({ text: '🚀'.repeat(50) })).not.toThrow();
    expect(() => classifyIntent({ text: '', recentMessages: [], targetAgentId: null })).not.toThrow();
  });
});
