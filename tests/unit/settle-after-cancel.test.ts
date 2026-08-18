import { describe, expect, it } from 'vitest';
import { createEmptyAcpTimeline } from '@/lib/acp/reducer';
import { settleAcpTimelineAfterCancel } from '@/lib/acp/settle-after-cancel';
import type { PlanItem, ToolCallItem } from '@/lib/acp/timeline-types';

describe('settleAcpTimelineAfterCancel', () => {
  it('marks running/pending tools failed and in_progress plan steps cancelled', () => {
    const base = createEmptyAcpTimeline('agent:main:s1', 1);
    const tool: ToolCallItem = {
      kind: 'tool-call',
      id: 'tool:t1',
      toolCallId: 't1',
      title: 'web_fetch',
      status: 'running',
      outputParts: [],
      locations: [],
    };
    const plan: PlanItem = {
      kind: 'plan',
      id: 'plan:current',
      entries: [
        { content: 'done step', status: 'completed' } as never,
        { content: '执行搜索与收集证据', status: 'in_progress' } as never,
        { content: 'later', status: 'pending' } as never,
      ],
    };
    const snapshot = {
      ...base,
      itemOrder: [tool.id, plan.id],
      itemsById: { [tool.id]: tool, [plan.id]: plan },
    };

    const settled = settleAcpTimelineAfterCancel(snapshot);
    const nextTool = settled.itemsById[tool.id] as ToolCallItem;
    const nextPlan = settled.itemsById[plan.id] as PlanItem;

    expect(nextTool.status).toBe('failed');
    expect(nextTool.error).toBe('aborted');
    expect((nextPlan.entries[0] as { status: string }).status).toBe('completed');
    expect((nextPlan.entries[1] as { status: string }).status).toBe('cancelled');
    expect((nextPlan.entries[2] as { status: string }).status).toBe('cancelled');
  });

  it('is a no-op when nothing is in flight', () => {
    const base = createEmptyAcpTimeline('agent:main:s1', 1);
    const tool: ToolCallItem = {
      kind: 'tool-call',
      id: 'tool:t1',
      toolCallId: 't1',
      title: 'web_fetch',
      status: 'completed',
      outputParts: [],
      locations: [],
    };
    const snapshot = {
      ...base,
      itemOrder: [tool.id],
      itemsById: { [tool.id]: tool },
    };
    expect(settleAcpTimelineAfterCancel(snapshot)).toBe(snapshot);
  });
});
