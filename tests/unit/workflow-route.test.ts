import { describe, expect, it } from 'vitest';
import { shouldRouteToWorkflow } from '@/lib/workflow-route';

describe('shouldRouteToWorkflow', () => {
  it('routes clear multi-step tasks (sequencing words)', () => {
    expect(
      shouldRouteToWorkflow('先抓取竞品的定价数据，然后汇总成一份表格，最后分析给出建议'),
    ).toBe(true);
  });

  it('routes numbered / bulleted lists of 2+ items', () => {
    expect(shouldRouteToWorkflow('1. 调研市场\n2. 写方案\n3. 输出报告')).toBe(true);
    expect(shouldRouteToWorkflow('- 收集需求\n- 设计原型\n- 评审')).toBe(true);
  });

  it('does NOT route short / simple Q&A (rejected for free by classifyIntent)', () => {
    expect(shouldRouteToWorkflow('你好')).toBe(false);
    expect(shouldRouteToWorkflow('谢谢')).toBe(false);
  });

  it('does NOT route plain-language one-shot requests lacking multi-step structure', () => {
    // Whitelist gate: no list, no sequencing connectors, no step language ⇒
    // treated as a normal chat turn rather than auto-decomposed into a workflow.
    expect(shouldRouteToWorkflow('1+1等于几')).toBe(false);
    expect(shouldRouteToWorkflow('帮我把这段话翻译成英文')).toBe(false);
    expect(shouldRouteToWorkflow('先吃饭再睡觉')).toBe(false);
  });
});
