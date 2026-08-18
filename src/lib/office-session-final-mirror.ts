/**
 * Team room mirror: sync agent session **final** visible outcomes only.
 * Excludes thinking blocks and intermediate narration/tool steps (ExecutionGraph process).
 */

import {
  enrichMessagesForRoomMirror,
  formatAttachmentsForRoomMirror,
  readMirrorAttachments,
} from '@/lib/office-session-attachments';
import {
  pickBestSmartMentionStructuredRaw,
  scoreSmartMentionStructuredCompleteness,
} from '@/lib/office-mention-structured-score';
import {
  isWorkflowStructuredAgentText,
} from '@/lib/office-workflow-agent-structured';

type RawMsg = Record<string, unknown>;

const INTERNAL_TEXT_RE = /^(HEARTBEAT_OK|NO_REPLY)\s*$/i;

function isInternalAssistantText(text: string): boolean {
  return INTERNAL_TEXT_RE.test(text.trim());
}

/** Gateway tool-result wrapper rows are not real user turns. */
export function isRealUserMessage(msg: RawMsg): boolean {
  if (msg.role !== 'user') return false;
  const content = msg.content;
  if (!Array.isArray(content)) return true;
  const blocks = content as Array<{ type?: string }>;
  return (
    blocks.length === 0
    || !blocks.every((b) => b.type === 'tool_result' || b.type === 'toolResult')
  );
}

/** Plain `text` blocks only — not thinking / tool_use. */
export function extractFinalTextBlocks(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
      parts.push(b.text);
    }
  }
  return parts.join('\n').trim();
}

/** Last assistant row in a run segment that has non-empty final text (matches Session Sparkles bubble). */
export function findFinalReplyIndexInSegment(segment: RawMsg[]): number {
  for (let idx = segment.length - 1; idx >= 0; idx -= 1) {
    const msg = segment[idx];
    if (!msg || msg.role !== 'assistant') continue;
    if (extractFinalTextBlocks(msg.content).length > 0) return idx;
  }
  return -1;
}

function extractImagePlaceholders(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const lines: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (b.type !== 'image') continue;
    const hasData = !!(b.data || (b.source as Record<string, unknown> | undefined)?.data);
    if (hasData) lines.push('📷 [图片附件]');
  }
  return lines;
}

/**
 * Deliverable status line from thinking when the model put the answer only in thinking
 * (no text block). Omits English reasoning paragraphs.
 */
export function extractDeliverableStatusFromThinking(thinking: string): string {
  const t = thinking.trim();
  if (!t) return '';

  const lines = t.split('\n').map((line) => line.trim());
  const statusIdx = lines.findIndex((line) =>
    /^(?:✅|【)|已提供|等待用户|关于你提到/u.test(line),
  );
  if (statusIdx >= 0) {
    const tail = lines.slice(statusIdx).join('\n').trim();
    if (tail && (/[\u4e00-\u9fa5]|✅/u.test(tail) || /\.(?:zip|pdf|png|jpe?g|mp3|mp4|wav)/iu.test(tail))) {
      return tail;
    }
  }

  const paras = t.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  for (let i = paras.length - 1; i >= 0; i--) {
    const p = paras[i]!;
    if (/[\u4e00-\u9fa5]{2,}/u.test(p) || /✅/u.test(p)) return p;
  }

  return '';
}

/** Join model `thinking` blocks (not mirrored to team room by default). */
export function joinThinkingBlocks(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return '';
      const b = block as Record<string, unknown>;
      return b.type === 'thinking' && typeof b.thinking === 'string' ? b.thinking : '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

/** Final assistant row → room body (text + attachments + media placeholders). */
export function extractFinalAssistantRoomMirror(msg: RawMsg): string {
  const parts: string[] = [];

  const text = extractFinalTextBlocks(msg.content);
  if (text && !isInternalAssistantText(text)) {
    parts.push(text);
  }

  for (const line of extractImagePlaceholders(msg.content)) {
    if (!parts.some((p) => p.includes(line))) parts.push(line);
  }

  const attachBlock = formatAttachmentsForRoomMirror(readMirrorAttachments(msg));
  if (attachBlock) {
    const body = parts.join('\n\n');
    const missing =
      !body.includes(attachBlock)
      && attachBlock.split('\n').every((line) => !line.trim() || !body.includes(line.trim()));
    if (missing) parts.push(attachBlock);
  }

  if (parts.length === 0) {
    const status = extractDeliverableStatusFromThinking(joinThinkingBlocks(msg.content));
    if (status && !isInternalAssistantText(status)) parts.push(status);
  }

  return parts.join('\n\n').trim();
}

/**
 * 点名回复专用：优先取含【群聊回复】的正文；若模型把结构化输出写在 thinking 里也能拾取。
 * （团队群只发布校验后的【群聊回复】段，【理解】不会进群发。）
 */
export function extractStructuredReplyFromAssistantMessage(msg: RawMsg): string {
  const text = extractFinalTextBlocks(msg.content);
  const thinking = joinThinkingBlocks(msg.content);
  const mirror = extractFinalAssistantRoomMirror(msg);

  const best = pickBestSmartMentionStructuredRaw(text, thinking, mirror);
  if (best) return best;

  if (text) return text.trim();
  if (thinking) {
    const status = extractDeliverableStatusFromThinking(thinking);
    return status || thinking.trim();
  }
  return '';
}

/** 本次 @mention 之后最新一条可解析的 assistant 结构化回复（含 thinking 兜底）。 */
export function findLatestMentionStructuredRaw(
  messages: RawMsg[],
  startedAtMs: number,
  normalizeTs: (raw: unknown) => number,
): string | null {
  const enriched = enrichMessagesForRoomMirror(messages);

  let best = '';
  let bestTs = 0;
  let bestScore = 0;
  for (const msg of enriched) {
    if (msg.role !== 'assistant') continue;
    const ts = normalizeTs(msg.timestamp ?? msg.createdAt ?? msg.ts);
    if (ts > 0 && ts < startedAtMs - 2_000) continue;
    const raw = extractStructuredReplyFromAssistantMessage(msg);
    if (!raw || isInternalAssistantText(raw)) continue;
    const score = scoreSmartMentionStructuredCompleteness(raw);
    if (score > bestScore || (score === bestScore && ts >= bestTs)) {
      best = raw;
      bestTs = ts;
      bestScore = score;
    }
  }
  return best.trim() || null;
}

export function extractWorkflowStructuredFromAssistantMessage(msg: RawMsg): string {
  const text = extractFinalTextBlocks(msg.content);
  const thinking = joinThinkingBlocks(msg.content);
  if (text && isWorkflowStructuredAgentText(text)) return text.trim();
  if (thinking && isWorkflowStructuredAgentText(thinking)) return thinking.trim();
  const mirror = extractFinalAssistantRoomMirror(msg);
  if (mirror && isWorkflowStructuredAgentText(mirror)) return mirror.trim();
  return '';
}

const WORKFLOW_SECTION_MARK_RE =
  /【\s*(?:项目目录|任务理解|理解|输入校验|输入检查|执行说明|执行过程|执行|输出校验|输出检查|协作询问|交付产物|产物|用法说明|用法|回滚说明|回滚|交接)/u;

function extractWorkflowSectionBlobFromAssistant(msg: RawMsg): string {
  const text = extractFinalTextBlocks(msg.content);
  const thinking = joinThinkingBlocks(msg.content);
  return [text, thinking]
    .filter((part) => part.trim() && WORKFLOW_SECTION_MARK_RE.test(part))
    .join('\n\n')
    .trim();
}

/** 合并同一轮 user 触发后多条 assistant 消息中的【】段落（工具调用常拆成多段）。 */
function mergeWorkflowStructuredAcrossAssistantTurn(
  messages: RawMsg[],
  startedAtMs: number,
  normalizeTs: (raw: unknown) => number,
): string | null {
  const enriched = enrichMessagesForRoomMirror(messages);
  let anchorIdx = -1;
  for (let i = enriched.length - 1; i >= 0; i--) {
    const msg = enriched[i]!;
    if (!isRealUserMessage(msg)) continue;
    const ts = normalizeTs(msg.timestamp ?? msg.createdAt ?? msg.ts);
    if (ts > 0 && ts < startedAtMs - 2_000) continue;
    anchorIdx = i;
    break;
  }
  if (anchorIdx < 0) return null;

  const blobs: string[] = [];
  for (let i = anchorIdx + 1; i < enriched.length; i++) {
    const msg = enriched[i]!;
    if (isRealUserMessage(msg)) break;
    if (msg.role !== 'assistant') continue;
    const blob = extractWorkflowSectionBlobFromAssistant(msg);
    if (blob) blobs.push(blob);
  }
  const merged = blobs.join('\n\n').trim();
  if (!merged || !isWorkflowStructuredAgentText(merged)) return null;
  return merged;
}

/** 本次节点派发之后最新一条含【任务理解】+【交付产物】的 assistant 结构化回复。 */
export function findLatestWorkflowStructuredRaw(
  messages: RawMsg[],
  startedAtMs: number,
  normalizeTs: (raw: unknown) => number,
): string | null {
  const merged = mergeWorkflowStructuredAcrossAssistantTurn(
    messages,
    startedAtMs,
    normalizeTs,
  );
  if (merged) return merged;

  const enriched = enrichMessagesForRoomMirror(messages);

  let best = '';
  let bestTs = 0;
  for (const msg of enriched) {
    if (msg.role !== 'assistant') continue;
    const ts = normalizeTs(msg.timestamp ?? msg.createdAt ?? msg.ts);
    if (ts > 0 && ts < startedAtMs - 2_000) continue;
    const raw = extractWorkflowStructuredFromAssistantMessage(msg);
    if (!raw || isInternalAssistantText(raw)) continue;
    if (ts === 0) {
      if (!best) best = raw;
      continue;
    }
    if (ts >= bestTs) {
      bestTs = ts;
      best = raw;
    }
  }
  return best.trim() || null;
}

function dedupeParts(parts: string[]): string[] {
  const out: string[] = [];
  for (const part of parts) {
    const t = part.trim();
    if (!t) continue;
    if (out.length > 0 && out[out.length - 1] === t) continue;
    out.push(t);
  }
  return out;
}

function splitSegmentsAfterAnchor(enriched: RawMsg[], anchorUserIdx: number): RawMsg[][] {
  const segments: RawMsg[][] = [];
  let current: RawMsg[] = [];

  for (let i = anchorUserIdx + 1; i < enriched.length; i++) {
    const msg = enriched[i]!;
    if (isRealUserMessage(msg)) {
      if (current.length > 0) segments.push(current);
      current = [];
      continue;
    }
    current.push(msg);
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

/**
 * Mirror final agent outcomes after the triggering user turn: per user→agent run segment,
 * only the Sparkles-style final reply (+ files/images from tool results), no thinking/process narration.
 */
export function collectFinalRoomMirrorText(
  messages: RawMsg[],
  startedAtMs: number,
  normalizeTs: (raw: unknown) => number,
): string {
  const enriched = enrichMessagesForRoomMirror(messages);

  let anchorUserIdx = -1;
  for (let i = enriched.length - 1; i >= 0; i--) {
    const msg = enriched[i];
    if (!msg || !isRealUserMessage(msg)) continue;
    const ts = normalizeTs(msg.timestamp ?? msg.createdAt ?? msg.ts);
    if (ts > 0 && ts < startedAtMs - 5_000) continue;
    anchorUserIdx = i;
    break;
  }
  if (anchorUserIdx < 0) return '';

  const parts: string[] = [];
  for (const segment of splitSegmentsAfterAnchor(enriched, anchorUserIdx)) {
    const finalIdx = findFinalReplyIndexInSegment(segment);
    if (finalIdx < 0) continue;
    const chunk = extractFinalAssistantRoomMirror(segment[finalIdx]!);
    if (!chunk || isInternalAssistantText(chunk)) continue;
    parts.push(chunk);
  }

  return dedupeParts(parts).join('\n\n').trim();
}
