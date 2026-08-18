import { describe, expect, it } from 'vitest';
import type { ChatRuntimeEvent } from '../../shared/chat-runtime-events';
import {
  canStartSessionTurnSettle,
  historyShowsTurnSettledInEvidence,
  isRunSettledInTurnEvidence,
  isTurnStillInProgressEvidence,
  OfficeRuntimeToolTracker,
  runtimeBlocksTurnSettle,
  segmentHasFinalReply,
  segmentHasOpenToolRun,
  slicePostDispatchSegment,
  turnEvidenceHasPendingToolUse,
  turnEvidenceIsToolOnlyMessage,
} from '../../shared/session-turn-evidence';

const startedAt = 1_700_000_000_000;

describe('session-turn-evidence', () => {
  it('slicePostDispatchSegment anchors on user turn near dispatch', () => {
    const messages = [
      { role: 'user', content: 'old', timestamp: startedAt - 10_000 },
      { role: 'assistant', content: [{ type: 'text', text: 'old reply' }], timestamp: startedAt - 9_000 },
      { role: 'user', content: 'go', timestamp: startedAt },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'read' }], timestamp: startedAt + 100 },
    ];
    const segment = slicePostDispatchSegment(messages, startedAt);
    expect(segment).toHaveLength(1);
    expect(segment[0]?.role).toBe('assistant');
  });

  it('turnEvidenceHasPendingToolUse matches Anthropic and Gateway shapes', () => {
    expect(turnEvidenceHasPendingToolUse({
      role: 'assistant',
      content: [{ type: 'tool_use', id: 't1', name: 'read' }],
      stop_reason: 'tool_use',
    })).toBe(true);
    expect(turnEvidenceHasPendingToolUse({
      role: 'assistant',
      content: [{ type: 'toolCall', id: 't1', name: 'read' }],
      stopReason: 'toolUse',
    })).toBe(true);
    expect(turnEvidenceHasPendingToolUse({
      role: 'assistant',
      content: [{ type: 'text', text: 'done' }],
      stopReason: 'stop',
    })).toBe(false);
  });

  it('segmentHasOpenToolRun stays true until final assistant reply after last tool', () => {
    const toolOnly = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'read' }], stop_reason: 'tool_use' },
    ];
    expect(segmentHasOpenToolRun(toolOnly)).toBe(true);

    const withFinal = [
      ...toolOnly,
      { role: 'tool_result', content: 'ok' },
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    ];
    expect(segmentHasOpenToolRun(withFinal)).toBe(false);
    expect(segmentHasFinalReply(withFinal)).toBe(true);
  });

  it('isRunSettledInTurnEvidence requires final reply and no open tools', () => {
    const inProgress = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'read' }], stop_reason: 'tool_use' },
    ];
    expect(isRunSettledInTurnEvidence(inProgress, { hasRunningTool: false })).toBe(false);

    const settled = [
      ...inProgress,
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    ];
    expect(isRunSettledInTurnEvidence(settled, { hasRunningTool: false })).toBe(true);
  });

  it('runtime running tool blocks settle when history is not yet conclusive', () => {
    const inProgress = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'read' }], stop_reason: 'tool_use' },
    ];
    expect(isTurnStillInProgressEvidence(inProgress, { hasRunningTool: true })).toBe(true);
    expect(canStartSessionTurnSettle(true, inProgress, { hasRunningTool: true })).toBe(false);
  });

  it('ignores stale runtime running tool when history is conclusively settled', () => {
    const settled = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'read' }], stop_reason: 'tool_use' },
      { role: 'tool_result', content: 'ok' },
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    ];
    expect(historyShowsTurnSettledInEvidence(settled)).toBe(true);
    expect(runtimeBlocksTurnSettle(settled, { hasRunningTool: true })).toBe(false);
    expect(isRunSettledInTurnEvidence(settled, { hasRunningTool: true })).toBe(true);
    expect(canStartSessionTurnSettle(true, settled, { hasRunningTool: true })).toBe(true);
  });

  it('segmentHasFinalReply rejects generating status narration and internal tokens', () => {
    const afterTool = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'read' }], stop_reason: 'tool_use' },
      { role: 'tool_result', content: 'ok' },
      { role: 'assistant', content: [{ type: 'text', text: '图片生成中，请稍等' }] },
    ];
    expect(segmentHasFinalReply(afterTool)).toBe(false);
    expect(isTurnStillInProgressEvidence(afterTool, { hasRunningTool: false })).toBe(true);

    const internalOnly = [
      { role: 'assistant', content: [{ type: 'text', text: 'NO_REPLY' }] },
    ];
    expect(segmentHasFinalReply(internalOnly)).toBe(false);

    const realFinal = [
      ...afterTool.slice(0, 2),
      { role: 'assistant', content: [{ type: 'text', text: '已完成，结果如下。' }] },
    ];
    expect(segmentHasFinalReply(realFinal)).toBe(true);
  });

  it('canStartSessionTurnSettle mirrors Chat !sending && !inputRunActive', () => {
    const inProgress = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'read' }], stop_reason: 'tool_use' },
    ];
    expect(canStartSessionTurnSettle(false, inProgress, { hasRunningTool: false })).toBe(false);
    expect(canStartSessionTurnSettle(true, inProgress, { hasRunningTool: false })).toBe(false);

    const settled = [
      ...inProgress,
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    ];
    expect(canStartSessionTurnSettle(true, settled, { hasRunningTool: false })).toBe(true);
  });

  it('turnEvidenceIsToolOnlyMessage treats thinking+tool without text as tool-only', () => {
    expect(turnEvidenceIsToolOnlyMessage({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'searching' },
        { type: 'tool_use', id: 't1', name: 'web_search' },
      ],
      stop_reason: 'tool_use',
    })).toBe(true);
  });

  it('OfficeRuntimeToolTracker tracks tool.started/completed', () => {
    const tracker = new OfficeRuntimeToolTracker();
    tracker.applyRuntimeEvent({ type: 'run.started', runId: 'r1' } as ChatRuntimeEvent);
    tracker.applyRuntimeEvent({
      type: 'tool.started',
      runId: 'r1',
      toolCallId: 't1',
      name: 'read',
    } as ChatRuntimeEvent);
    expect(tracker.snapshot().hasRunningTool).toBe(true);
    tracker.applyRuntimeEvent({
      type: 'tool.completed',
      runId: 'r1',
      toolCallId: 't1',
      isError: false,
    } as ChatRuntimeEvent);
    expect(tracker.snapshot().hasRunningTool).toBe(false);
  });
});
