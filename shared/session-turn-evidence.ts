import type { ChatRuntimeEvent } from './chat-runtime-events';

/** Minimal transcript row for Chat-aligned turn evidence (Main + shared). */
export type TurnEvidenceMessage = Record<string, unknown>;

export type OfficeRuntimeToolSnapshot = {
  hasRunningTool: boolean;
};

function getStopReason(message: TurnEvidenceMessage): string {
  return String(message.stopReason ?? message.stop_reason ?? '').trim().toLowerCase();
}

function getMessageText(message: TurnEvidenceMessage): string {
  const content = message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) {
    return typeof message.text === 'string' ? message.text : '';
  }
  let out = '';
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const row = block as Record<string, unknown>;
    if (row.type === 'text' && typeof row.text === 'string') out += row.text;
  }
  return out;
}

function isToolResultRole(role: unknown): boolean {
  const normalized = String(role ?? '').toLowerCase();
  return normalized === 'toolresult' || normalized === 'tool_result';
}

function isRealUserBoundaryMessage(msg: TurnEvidenceMessage): boolean {
  if (msg.role !== 'user') return false;
  if (!Array.isArray(msg.content)) return true;
  const blocks = msg.content as Array<{ type?: string }>;
  return blocks.length === 0
    || !blocks.every((block) => block.type === 'tool_result' || block.type === 'toolResult');
}

function normalizeTimestampMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return value < 1_000_000_000_000 ? value * 1000 : value;
}

/** Messages after the dispatch user turn (Chat `getPostTriggerSegmentMessages` semantics). */
export function slicePostDispatchSegment(
  messages: TurnEvidenceMessage[],
  startedAtMs: number,
): TurnEvidenceMessage[] {
  let anchorIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (!isRealUserBoundaryMessage(msg)) continue;
    const ts = normalizeTimestampMs(msg.timestamp ?? msg.createdAt ?? msg.ts);
    if (ts > 0 && ts < startedAtMs - 2_000) continue;
    anchorIdx = i;
    break;
  }
  if (anchorIdx < 0) return [];
  return messages.slice(anchorIdx + 1);
}

function extractToolUseBlocks(message: TurnEvidenceMessage): Array<{ id: string; name: string }> {
  const tools: Array<{ id: string; name: string }> = [];
  const content = message.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const row = block as Record<string, unknown>;
      if ((row.type === 'tool_use' || row.type === 'toolCall') && row.name) {
        tools.push({ id: String(row.id ?? ''), name: String(row.name) });
      }
    }
  }
  const toolCalls = message.tool_calls ?? message.toolCalls;
  if (Array.isArray(toolCalls)) {
    for (const tc of toolCalls) {
      if (!tc || typeof tc !== 'object') continue;
      const row = tc as Record<string, unknown>;
      const name = row.name ?? (row.function as Record<string, unknown> | undefined)?.name;
      if (name) tools.push({ id: String(row.id ?? ''), name: String(name) });
    }
  }
  return tools;
}

/** Chat `hasPendingToolUse` (helpers.ts). */
export function turnEvidenceHasPendingToolUse(message: TurnEvidenceMessage | undefined): boolean {
  if (!message) return false;
  const reason = getStopReason(message);
  if (reason === 'tool_use' || reason === 'tooluse') return true;
  if (Array.isArray(message.content)) {
    for (const block of message.content) {
      if (!block || typeof block !== 'object') continue;
      const row = block as Record<string, unknown>;
      if (row.type === 'tool_use' || row.type === 'toolCall') return true;
    }
  }
  const toolCalls = message.tool_calls ?? message.toolCalls;
  return Array.isArray(toolCalls) && toolCalls.length > 0;
}

/** Chat `isToolOnlyMessage` (helpers.ts) — thinking blocks do not disqualify tool-only. */
export function turnEvidenceIsToolOnlyMessage(message: TurnEvidenceMessage | undefined): boolean {
  if (!message) return false;
  if (isToolResultRole(message.role)) return true;

  const toolCalls = message.tool_calls ?? message.toolCalls;
  const hasOpenAITools = Array.isArray(toolCalls) && toolCalls.length > 0;
  const content = message.content;

  if (!Array.isArray(content)) {
    if (hasOpenAITools) {
      const textContent = typeof content === 'string' ? content.trim() : '';
      return textContent.length === 0;
    }
    return false;
  }

  let hasTool = hasOpenAITools;
  let hasText = false;
  let hasNonToolContent = false;
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const row = block as Record<string, unknown>;
    if (row.type === 'tool_use' || row.type === 'tool_result' || row.type === 'toolCall' || row.type === 'toolResult') {
      hasTool = true;
      continue;
    }
    if (row.type === 'text' && typeof row.text === 'string' && row.text.trim()) {
      hasText = true;
      continue;
    }
    if (row.type === 'image') hasNonToolContent = true;
  }
  return hasTool && !hasText && !hasNonToolContent;
}

function isInternalAssistantReplyText(text: string): boolean {
  return /^(HEARTBEAT_OK|NO_REPLY)\s*$/i.test(text.trim());
}

/** Chat `message-utils.ts` — interim image-generation status, not a final answer. */
function isGeneratingStatusNarration(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^(?:图片(?:正在)?生成中|正在生成(?:图片|图像)|生成中)/i.test(trimmed)) return true;
  if (/稍等(片刻|一下)?/.test(trimmed) && trimmed.length <= 80 && /生成|generat/i.test(trimmed)) {
    return true;
  }
  return false;
}

function messageHasUserVisibleImage(message: TurnEvidenceMessage): boolean {
  if (!Array.isArray(message.content)) return false;
  return (message.content as Array<{ type?: string }>).some((block) => block.type === 'image');
}

function isConclusiveAssistantReplyText(replyText: string): boolean {
  const trimmed = replyText.trim();
  if (!trimmed) return false;
  if (isInternalAssistantReplyText(trimmed)) return false;
  if (isGeneratingStatusNarration(trimmed)) return false;
  return true;
}

/** Transcript shows final reply with no open tool work (Chat history-settled core). */
export function historyShowsTurnSettledInEvidence(segmentMessages: TurnEvidenceMessage[]): boolean {
  return segmentHasFinalReply(segmentMessages) && !segmentHasOpenToolRun(segmentMessages);
}

/**
 * Runtime tool still running — unless history already settled (Chat history-poll 卸约:
 * lost `tool.completed` must not block when transcript is conclusive).
 */
export function runtimeBlocksTurnSettle(
  segmentMessages: TurnEvidenceMessage[],
  runtime: OfficeRuntimeToolSnapshot | null | undefined,
): boolean {
  if (!runtimeSnapshotHasRunningTool(runtime)) return false;
  if (historyShowsTurnSettledInEvidence(segmentMessages)) return false;
  return true;
}

function turnEvidenceHasNonToolAssistantContent(message: TurnEvidenceMessage | undefined): boolean {
  if (!message) return false;
  const text = getMessageText(message).trim();
  if (text) return true;
  if (!Array.isArray(message.content)) return false;
  return (message.content as Array<{ type?: string }>).some((block) => block.type === 'image');
}

/** Chat `segmentHasFinalReply` (task-visualization.ts). */
export function segmentHasFinalReply(segmentMessages: TurnEvidenceMessage[]): boolean {
  let lastToolUseOffset = -1;
  for (let i = segmentMessages.length - 1; i >= 0; i--) {
    const message = segmentMessages[i]!;
    if (message.role === 'assistant' && extractToolUseBlocks(message).length > 0) {
      lastToolUseOffset = i;
      break;
    }
  }
  return segmentMessages.some((message, index) => {
    if (index <= lastToolUseOffset) return false;
    if (message.role !== 'assistant') return false;
    if (messageHasUserVisibleImage(message)) return true;
    const replyText = getMessageText(message).trim();
    if (!isConclusiveAssistantReplyText(replyText)) return false;
    const content = message.content;
    if (!Array.isArray(content)) return true;
    return !(content as Array<{ type?: string }>).some(
      (block) => block.type === 'tool_use' || block.type === 'toolCall',
    );
  });
}

/** Chat `segmentHasOpenToolRun` (chat.ts). */
export function segmentHasOpenToolRun(segmentMessages: TurnEvidenceMessage[]): boolean {
  if (segmentMessages.length === 0) return false;
  const hasToolActivity = segmentMessages.some(
    (message) => message.role === 'assistant'
      && (turnEvidenceHasPendingToolUse(message) || turnEvidenceIsToolOnlyMessage(message)),
  );
  if (!hasToolActivity) return false;

  let lastToolUseOffset = -1;
  for (let i = segmentMessages.length - 1; i >= 0; i--) {
    const message = segmentMessages[i]!;
    if (message.role === 'assistant'
      && (turnEvidenceHasPendingToolUse(message) || turnEvidenceIsToolOnlyMessage(message))) {
      lastToolUseOffset = i;
      break;
    }
  }

  return !segmentMessages.some((message, index) => {
    if (index <= lastToolUseOffset) return false;
    if (message.role !== 'assistant') return false;
    if (turnEvidenceHasPendingToolUse(message)) return false;
    if (turnEvidenceHasNonToolAssistantContent(message)) return true;
    return !turnEvidenceIsToolOnlyMessage(message);
  });
}

/** Chat `hasRunningRuntimeTool` (Chat/index.tsx). */
export function runtimeSnapshotHasRunningTool(snapshot: OfficeRuntimeToolSnapshot | null | undefined): boolean {
  return Boolean(snapshot?.hasRunningTool);
}

/**
 * Chat `runSettledInHistory` core (index.tsx), without image/stream UI branches.
 * True when transcript shows a final reply and no open tool work in history or runtime.
 */
export function isRunSettledInTurnEvidence(
  segmentMessages: TurnEvidenceMessage[],
  runtime: OfficeRuntimeToolSnapshot | null | undefined,
): boolean {
  if (runtimeBlocksTurnSettle(segmentMessages, runtime)) return false;
  if (segmentHasOpenToolRun(segmentMessages)) return false;
  return segmentHasFinalReply(segmentMessages);
}

/**
 * Chat `inputRunActive` evidence half: turn still in progress after protocol discharge.
 * Mirrors `hasActiveExecutionGraph && !runSettledInHistory` + `runStillExecutingTools`.
 */
export function isTurnStillInProgressEvidence(
  segmentMessages: TurnEvidenceMessage[],
  runtime: OfficeRuntimeToolSnapshot | null | undefined,
): boolean {
  if (runtimeBlocksTurnSettle(segmentMessages, runtime)) return true;
  if (segmentHasOpenToolRun(segmentMessages)) return true;
  const hasToolActivity = segmentMessages.some(
    (message) => message.role === 'assistant'
      && (turnEvidenceHasPendingToolUse(message) || turnEvidenceIsToolOnlyMessage(message)),
  );
  const hasFinalReply = segmentHasFinalReply(segmentMessages);
  if (hasToolActivity && !hasFinalReply) return true;
  return !isRunSettledInTurnEvidence(segmentMessages, runtime);
}

/**
 * Office 开始收稿（不含 5s/hash/JSON）≈ Chat `!sending && !inputRunActive` 的证据 + 协议部分。
 * `protocolDischarged` ≈ `!store.sending` (run.ended / sessions.list idle reconcile).
 */
export function canStartSessionTurnSettle(
  protocolDischarged: boolean,
  segmentMessages: TurnEvidenceMessage[],
  runtime: OfficeRuntimeToolSnapshot | null | undefined,
): boolean {
  if (!protocolDischarged) return false;
  return isRunSettledInTurnEvidence(segmentMessages, runtime);
}

export class OfficeRuntimeToolTracker {
  private statuses = new Map<string, 'running' | 'completed' | 'error'>();

  reset(): void {
    this.statuses.clear();
  }

  applyRuntimeEvent(event: ChatRuntimeEvent): void {
    if (event.type === 'run.started') {
      this.reset();
      return;
    }
    if (event.type === 'tool.started' || event.type === 'tool.updated') {
      this.statuses.set(event.toolCallId, 'running');
      return;
    }
    if (event.type === 'tool.completed') {
      this.statuses.set(event.toolCallId, event.isError ? 'error' : 'completed');
    }
  }

  snapshot(): OfficeRuntimeToolSnapshot {
    return {
      hasRunningTool: [...this.statuses.values()].some((status) => status === 'running'),
    };
  }
}
