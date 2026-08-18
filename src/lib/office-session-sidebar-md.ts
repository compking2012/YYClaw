/**
 * Format gateway session messages for sidebar-equivalent markdown export.
 * Mirrors Chat history visibility: keeps tool-use turns, drops internal plumbing.
 */

import {
  enrichMessagesForRoomMirror,
  formatAttachmentsForRoomMirror,
  readMirrorAttachments,
  sanitizeChatHistoryMessages,
} from './office-session-attachments';
import {
  isGeneratingStatusNarration,
  isInternalAssistantReplyText,
  isOpenClawRuntimeEventPrompt,
} from '../pages/Chat/message-utils';

type RawMsg = Record<string, unknown>;

function isToolResultRole(role: unknown): boolean {
  const normalized = String(role ?? '').toLowerCase();
  return normalized === 'toolresult' || normalized === 'tool_result';
}

function messageHasToolUse(msg: RawMsg): boolean {
  const content = msg.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const b = block as Record<string, unknown>;
      if (b.type === 'tool_use' || b.type === 'toolCall') return true;
    }
  }
  const toolCalls = msg.tool_calls ?? msg.toolCalls;
  return Array.isArray(toolCalls) && toolCalls.length > 0;
}

function getMessageText(msg: RawMsg): string {
  const content = msg.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) {
    return typeof msg.text === 'string' ? msg.text : '';
  }
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
  }
  return parts.join('\n');
}

function isRuntimeSystemInjection(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  if (/^\s*System\s*\(untrusted\)\s*:/i.test(normalized)) return true;
  if (
    /An async command you ran earlier has completed/i.test(normalized)
    && /Do not relay it to the user unless explicitly requested/i.test(normalized)
  ) {
    return true;
  }
  if (/^\[Inter-session message\]/i.test(normalized)) return true;
  if (isOpenClawRuntimeEventPrompt(normalized)) return true;
  if (
    /^\s*Current time\s*:/i.test(normalized)
    && /^\s*Current time\s*:[^\n]*\/\s*\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+UTC\s*$/i.test(normalized)
  ) {
    return true;
  }
  return false;
}

function shouldDropFromSidebarExport(msg: RawMsg): boolean {
  if (msg.role === 'system') return true;
  if (isToolResultRole(msg.role)) return true;
  if (messageHasToolUse(msg)) return false;

  const text = getMessageText(msg);
  if (msg.role === 'assistant') {
    if (isInternalAssistantReplyText(text)) return true;
    if (isGeneratingStatusNarration(text)) return true;
    if (!text.trim() && Array.isArray(msg.content)) {
      const blocks = msg.content as Array<Record<string, unknown>>;
      const hasThinking = blocks.some(
        (block) => block.type === 'thinking' && String(block.thinking ?? '').trim(),
      );
      const hasVisibleText = blocks.some(
        (block) => block.type === 'text' && String(block.text ?? '').trim(),
      );
      if (hasThinking && !hasVisibleText) return true;
    }
  }
  if (msg.role === 'user' && /^\[OpenClaw heartbeat poll\]\s*$/i.test(text.trim())) return true;
  if ((msg.role === 'user' || msg.role === 'assistant') && isRuntimeSystemInjection(text)) return true;
  return false;
}

function formatTimestamp(raw: unknown): string {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const ms = raw > 1e12 ? raw : raw * 1000;
    return new Date(ms).toISOString();
  }
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return '';
}

function formatContentBlocks(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
      parts.push(b.text.trim());
    } else if (b.type === 'thinking' && typeof b.thinking === 'string' && b.thinking.trim()) {
      parts.push(`> **Thinking**\n> ${b.thinking.trim().replace(/\n/g, '\n> ')}`);
    } else if ((b.type === 'tool_use' || b.type === 'toolCall') && typeof b.name === 'string') {
      const input = b.input ?? b.arguments;
      const inputText =
        typeof input === 'string'
          ? input
          : input && typeof input === 'object'
            ? JSON.stringify(input, null, 2)
            : '';
      parts.push(`**Tool:** \`${b.name}\`${inputText ? `\n\`\`\`json\n${inputText}\n\`\`\`` : ''}`);
    }
  }
  return parts.join('\n\n');
}

function formatMessageSection(msg: RawMsg): string | null {
  const role = String(msg.role ?? 'unknown');
  const ts = formatTimestamp(msg.timestamp ?? msg.createdAt ?? msg.ts);
  const header = ts ? `### ${role} · ${ts}` : `### ${role}`;
  const body = formatContentBlocks(msg.content) || getMessageText(msg).trim();
  const attachments = readMirrorAttachments(msg);
  const attachmentText = attachments.length > 0 ? formatAttachmentsForRoomMirror(attachments) : '';
  const combined = [body, attachmentText].filter(Boolean).join('\n\n');
  if (!combined.trim()) return null;
  return `${header}\n\n${combined}`;
}

/** Messages visible in the Chat sidebar for one session (post-enrichment). */
export function filterMessagesForSessionSidebarExport(messages: unknown[]): RawMsg[] {
  const safe = enrichMessagesForRoomMirror(sanitizeChatHistoryMessages(messages));
  return safe.filter((msg) => !shouldDropFromSidebarExport(msg));
}

export function formatSessionSidebarMarkdown(messages: unknown[]): string {
  const visible = filterMessagesForSessionSidebarExport(messages);
  const sections = visible
    .map((msg) => formatMessageSection(msg))
    .filter((section): section is string => Boolean(section));
  return sections.join('\n\n');
}
