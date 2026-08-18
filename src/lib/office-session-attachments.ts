/**
 * Mirror session attachments (tool results → assistant file cards) into team room text.
 * Matches renderer enrichWithToolResultFiles behavior in chat/helpers.ts.
 */

export type OfficeMirrorAttachment = {
  fileName: string;
  filePath?: string;
  mimeType?: string;
};

type RawMsg = Record<string, unknown>;

/** Drop null/undefined/non-object rows from gateway `chat.history` (sparse arrays crash on `.role`). */
export function sanitizeChatHistoryMessages(messages: unknown[]): RawMsg[] {
  return messages.filter(
    (msg): msg is RawMsg =>
      msg != null && typeof msg === 'object' && !Array.isArray(msg),
  );
}

function isToolResultRole(role: unknown): boolean {
  const normalized = typeof role === 'string' ? role.toLowerCase() : '';
  return normalized === 'toolresult' || normalized === 'tool_result';
}

function officeGetMessageText(content: unknown): string {
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

/** [media attached: path (mime) | path] from any message text. */
export function extractMediaRefsFromText(text: string): Array<{ filePath: string; mimeType: string }> {
  const refs: Array<{ filePath: string; mimeType: string }> = [];
  const regex = /\[media attached:\s*([^\s(]+)\s*\(([^)]+)\)\s*\|[^\]]*\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match[1]) refs.push({ filePath: match[1], mimeType: match[2] || 'application/octet-stream' });
  }
  return refs;
}

function mimeFromExtension(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    zip: 'application/zip',
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    md: 'text/markdown',
    txt: 'text/plain',
  };
  return map[ext] || 'application/octet-stream';
}

/** Absolute paths to files in message / tool output text. */
export function extractRawFilePathsFromText(text: string): Array<{ filePath: string; mimeType: string }> {
  const refs: Array<{ filePath: string; mimeType: string }> = [];
  const seen = new Set<string>();
  const exts =
    'png|jpe?g|gif|webp|bmp|avif|svg|pdf|docx?|xlsx?|pptx?|txt|csv|md|rtf|epub|zip|tar|gz|rar|7z|mp3|wav|ogg|aac|flac|m4a|mp4|mov|avi|mkv|webm|m4v';
  const unixRegex = new RegExp(
    `(?<![\\w./:])((?:\\/|~\\/)[^\\s\\n"'()\\[\\],<>]*?\\.(?:${exts}))`,
    'gi',
  );
  const winRegex = new RegExp(
    `(?<![\\w])([A-Za-z]:\\\\[^\\s\\n"'()\\[\\],<>]*?\\.(?:${exts}))`,
    'gi',
  );
  for (const regex of [unixRegex, winRegex]) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const p = match[1];
      if (p && !seen.has(p)) {
        seen.add(p);
        refs.push({ filePath: p, mimeType: mimeFromExtension(p) });
      }
    }
  }
  return refs;
}

function attachmentFromPath(filePath: string, mimeType: string): OfficeMirrorAttachment {
  const fileName = filePath.split(/[\\/]/).pop() || 'file';
  return { fileName, filePath, mimeType };
}

function collectToolCallPaths(msg: RawMsg, paths: Map<string, string>): void {
  const content = msg.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const b = block as Record<string, unknown>;
      if ((b.type === 'tool_use' || b.type === 'toolCall') && typeof b.id === 'string') {
        const args = (b.input ?? b.arguments) as Record<string, unknown> | undefined;
        if (args) {
          const fp = args.file_path ?? args.filePath ?? args.path ?? args.file;
          if (typeof fp === 'string') paths.set(b.id, fp);
        }
      }
    }
  }
  const toolCalls = msg.tool_calls ?? msg.toolCalls;
  if (Array.isArray(toolCalls)) {
    for (const tc of toolCalls as Array<Record<string, unknown>>) {
      const id = typeof tc.id === 'string' ? tc.id : '';
      if (!id) continue;
      const fn = (tc.function ?? tc) as Record<string, unknown>;
      let args: Record<string, unknown> | undefined;
      try {
        args =
          typeof fn.arguments === 'string'
            ? (JSON.parse(fn.arguments) as Record<string, unknown>)
            : ((fn.arguments ?? fn.input) as Record<string, unknown>);
      } catch {
        args = undefined;
      }
      if (args) {
        const fp = args.file_path ?? args.filePath ?? args.path ?? args.file;
        if (typeof fp === 'string') paths.set(id, fp);
      }
    }
  }
}

function extractAttachmentsFromContent(content: unknown, matchedPath?: string): OfficeMirrorAttachment[] {
  if (!Array.isArray(content)) return [];
  const files: OfficeMirrorAttachment[] = [];

  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (b.type === 'image') {
      const name = matchedPath?.split(/[\\/]/).pop() || 'image';
      files.push({
        fileName: name,
        filePath: matchedPath,
        mimeType: typeof b.mimeType === 'string' ? b.mimeType : 'image/jpeg',
      });
    }
    if ((b.type === 'tool_result' || b.type === 'toolResult') && b.content) {
      files.push(...extractAttachmentsFromContent(b.content, matchedPath));
    }
  }
  return files;
}

function extractRefsFromMessageText(text: string): OfficeMirrorAttachment[] {
  const out: OfficeMirrorAttachment[] = [];
  const seen = new Set<string>();
  const mediaPaths = new Set(extractMediaRefsFromText(text).map((r) => r.filePath));

  for (const ref of extractMediaRefsFromText(text)) {
    const key = ref.filePath;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(attachmentFromPath(ref.filePath, ref.mimeType));
  }
  for (const ref of extractRawFilePathsFromText(text)) {
    if (mediaPaths.has(ref.filePath) || seen.has(ref.filePath)) continue;
    seen.add(ref.filePath);
    out.push(attachmentFromPath(ref.filePath, ref.mimeType));
  }
  return out;
}

/** Attach tool-result files to the next assistant row (same as chat history enrich). */
export function enrichMessagesForRoomMirror(messages: RawMsg[]): RawMsg[] {
  const pending: OfficeMirrorAttachment[] = [];
  const toolCallPaths = new Map<string, string>();

  return sanitizeChatHistoryMessages(messages).map((msg) => {
    if (msg.role === 'assistant') {
      collectToolCallPaths(msg, toolCallPaths);
    }

    if (isToolResultRole(msg.role)) {
      const matchedPath =
        typeof msg.toolCallId === 'string' ? toolCallPaths.get(msg.toolCallId) : undefined;
      if (matchedPath) {
        pending.push(attachmentFromPath(matchedPath, mimeFromExtension(matchedPath)));
      }
      pending.push(...extractAttachmentsFromContent(msg.content, matchedPath));
      const text = officeGetMessageText(msg.content);
      if (text) pending.push(...extractRefsFromMessageText(text));
      return msg;
    }

    if (msg.role === 'assistant') {
      const inline = extractRefsFromMessageText(officeGetMessageText(msg.content));
      const fromPending = pending.splice(0);
      const merged = [...fromPending, ...inline];
      const deduped: OfficeMirrorAttachment[] = [];
      const seen = new Set<string>();
      for (const f of merged) {
        const key = f.filePath || f.fileName;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(f);
      }
      if (deduped.length === 0) return msg;
      return { ...msg, _mirrorAttachments: deduped };
    }

    return msg;
  });
}

function formatMimeLabel(mimeType?: string): string {
  if (!mimeType?.trim()) return '';
  const m = mimeType.toLowerCase();
  if (m.startsWith('image/')) return '图片';
  if (m.startsWith('audio/')) return '音频';
  if (m.startsWith('video/')) return '视频';
  if (m.includes('zip')) return '压缩包';
  if (m.includes('pdf')) return 'PDF';
  return mimeType;
}

export function formatAttachmentsForRoomMirror(attachments: OfficeMirrorAttachment[]): string {
  return attachments
    .map((f) => {
      const name = f.fileName.trim() || 'file';
      const kind = formatMimeLabel(f.mimeType);
      const kindLine = kind ? `（${kind}）` : '';
      if (f.filePath?.trim()) return `📎 ${name}${kindLine}\n${f.filePath.trim()}`;
      return `📎 ${name}${kindLine}`;
    })
    .join('\n\n');
}

export function readMirrorAttachments(msg: RawMsg): OfficeMirrorAttachment[] {
  const raw = msg._mirrorAttachments;
  if (!Array.isArray(raw)) return [];
  const out: OfficeMirrorAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const fileName = typeof o.fileName === 'string' ? o.fileName.trim() : '';
    if (!fileName) continue;
    out.push({
      fileName,
      filePath: typeof o.filePath === 'string' ? o.filePath : undefined,
      mimeType: typeof o.mimeType === 'string' ? o.mimeType : undefined,
    });
  }
  return out;
}
