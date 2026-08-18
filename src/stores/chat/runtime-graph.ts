import type { ChatRuntimeEvent } from '../../../shared/chat-runtime-events';
import {
  extractImagesAsAttachedFiles,
  extractMediaRefs,
  extractRawFilePaths,
  getMessageText,
  makeAttachedFile,
} from './helpers';
import type { AttachedFileMeta, ChatRuntimeRunState } from './types';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function cloneRunState(runId: string, event: ChatRuntimeEvent): ChatRuntimeRunState {
  return {
    runId,
    sessionKey: event.sessionKey,
    status: event.type === 'run.ended' ? event.status : 'running',
    startedAt: event.type === 'run.started' ? event.startedAt : undefined,
    endedAt: event.type === 'run.ended' ? event.endedAt : undefined,
    assistantText: '',
    thinkingText: '',
    events: [],
  };
}

function stableRuntimeFingerprint(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return `${typeof value}:${String(value)}`;
  if (Array.isArray(value)) return `[${value.map(stableRuntimeFingerprint).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableRuntimeFingerprint(child)}`)
    .join(',')}}`;
}

function sameRuntimeEvent(left: ChatRuntimeEvent | undefined, right: ChatRuntimeEvent): boolean {
  if (!left) return false;
  if (left.runId !== right.runId || left.type !== right.type) return false;
  if (typeof left.seq === 'number' && typeof right.seq === 'number') {
    return left.seq === right.seq;
  }
  if (left.type === 'tool.started') {
    return right.type === left.type && right.toolCallId === left.toolCallId;
  }
  if (left.type === 'tool.updated') {
    return right.type === left.type
      && right.toolCallId === left.toolCallId
      && stableRuntimeFingerprint(right.partialResult) === stableRuntimeFingerprint(left.partialResult);
  }
  if (left.type === 'tool.completed') {
    return right.type === left.type
      && right.toolCallId === left.toolCallId
      && right.isError === left.isError
      && stableRuntimeFingerprint(right.result) === stableRuntimeFingerprint(left.result)
      && stableRuntimeFingerprint(right.meta) === stableRuntimeFingerprint(left.meta);
  }
  if (left.type === 'command.output') {
    return right.type === left.type
      && right.toolCallId === left.toolCallId
      && right.itemId === left.itemId
      && right.phase === left.phase
      && right.output === left.output;
  }
  if (left.type === 'patch.completed') {
    return right.type === left.type && right.toolCallId === left.toolCallId && right.summary === left.summary;
  }
  if (left.type === 'approval.updated') {
    return right.type === left.type
      && right.toolCallId === left.toolCallId
      && right.status === left.status
      && right.phase === left.phase
      && right.message === left.message;
  }
  if (left.type === 'assistant.delta') {
    return right.type === left.type && right.text === left.text && right.delta === left.delta;
  }
  if (left.type === 'thinking.delta') {
    return right.type === left.type && right.text === left.text && right.delta === left.delta;
  }
  if (left.type === 'run.started') return right.type === left.type;
  if (left.type === 'run.ended') return right.type === left.type && right.status === left.status && right.endedAt === left.endedAt;
  return false;
}

/**
 * Upper bound on the structured `events` array retained per run. Streaming
 * deltas are NOT stored here (they are folded into assistantText/thinkingText),
 * so this only ever holds structural events (run.*, tool.*, command.output,
 * patch.completed, approval.updated). The cap is a backstop against pathological
 * tool storms; the only consumers (Chat page graph derivation + running-tool
 * checks) care about recent structural state, not unbounded history.
 */
const MAX_RUNTIME_EVENTS_PER_RUN = 500;

/**
 * Delta events are high-frequency and already aggregated into
 * `assistantText` / `thinkingText`; keeping every one in the `events` array is
 * the dominant source of unbounded `runtimeRuns` growth (and the lag that
 * builds up with long-running workflow sessions). They are intentionally not
 * retained in the array.
 */
function shouldRetainRuntimeEvent(event: ChatRuntimeEvent): boolean {
  return event.type !== 'assistant.delta' && event.type !== 'thinking.delta';
}

function appendRuntimeEvent(
  events: ChatRuntimeEvent[],
  event: ChatRuntimeEvent,
): ChatRuntimeEvent[] {
  if (!shouldRetainRuntimeEvent(event)) return events;
  if (sameRuntimeEvent(events.at(-1), event)) return events;
  const next = [...events, event];
  return next.length > MAX_RUNTIME_EVENTS_PER_RUN
    ? next.slice(next.length - MAX_RUNTIME_EVENTS_PER_RUN)
    : next;
}

export function applyRuntimeEventToRuns(
  currentRuns: Record<string, ChatRuntimeRunState>,
  event: ChatRuntimeEvent,
): Record<string, ChatRuntimeRunState> {
  const existing = currentRuns[event.runId] ?? cloneRunState(event.runId, event);
  const nextRun: ChatRuntimeRunState = {
    ...existing,
    sessionKey: event.sessionKey ?? existing.sessionKey,
    events: appendRuntimeEvent(existing.events, event),
  };

  switch (event.type) {
    case 'run.started':
      nextRun.status = 'running';
      nextRun.startedAt = event.startedAt ?? nextRun.startedAt;
      nextRun.endedAt = undefined;
      break;
    case 'run.ended':
      nextRun.status = event.status;
      nextRun.endedAt = event.endedAt ?? event.ts ?? Date.now();
      break;
    case 'assistant.delta': {
      const incoming = event.text ?? event.delta ?? '';
      if (incoming) {
        if (event.replace) {
          nextRun.assistantText = incoming;
        } else if (event.text) {
          nextRun.assistantText = event.text.startsWith(nextRun.assistantText)
            ? event.text
            : event.text;
        } else {
          nextRun.assistantText = `${nextRun.assistantText}${event.delta ?? ''}`;
        }
      }
      break;
    }
    case 'thinking.delta': {
      const incoming = event.text ?? event.delta ?? '';
      if (incoming) {
        if (event.text) {
          nextRun.thinkingText = event.text.startsWith(nextRun.thinkingText)
            ? event.text
            : event.text;
        } else {
          nextRun.thinkingText = `${nextRun.thinkingText}${event.delta ?? ''}`;
        }
      }
      break;
    }
    default:
      break;
  }

  return {
    ...currentRuns,
    [event.runId]: nextRun,
  };
}

function collectRuntimeResultTexts(result: unknown): string[] {
  const texts: string[] = [];
  if (typeof result === 'string' && result.trim()) {
    texts.push(result);
  }
  if (Array.isArray(result)) {
    const text = getMessageText(result);
    if (text.trim()) texts.push(text);
  }
  const record = asRecord(result);
  if (!record) return texts;

  const candidates = [record.content, record.output, record.summary, record.error, record.stdout, record.stderr];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      texts.push(candidate);
      continue;
    }
    const text = getMessageText(candidate);
    if (text.trim()) texts.push(text);
  }

  return texts;
}

export function extractToolCompletedFiles(event: ChatRuntimeEvent): AttachedFileMeta[] {
  if (event.type !== 'tool.completed') return [];

  const files: AttachedFileMeta[] = extractImagesAsAttachedFiles(event.result)
    .filter((file) => !file.mimeType.startsWith('image/'))
    .map((file) => (file.source ? file : { ...file, source: 'tool-result' as const }));

  const seenPaths = new Set(files.map((file) => file.filePath).filter(Boolean));
  for (const text of collectRuntimeResultTexts(event.result)) {
    const mediaRefs = extractMediaRefs(text);
    const mediaRefPaths = new Set(mediaRefs.map((ref) => ref.filePath));
    for (const ref of mediaRefs) {
      if (seenPaths.has(ref.filePath)) continue;
      const file = makeAttachedFile(ref, 'tool-result');
      seenPaths.add(ref.filePath);
      files.push(file);
    }
    for (const ref of extractRawFilePaths(text)) {
      if (ref.mimeType.startsWith('image/')) continue;
      if (mediaRefPaths.has(ref.filePath) || seenPaths.has(ref.filePath)) continue;
      const file = makeAttachedFile(ref, 'tool-result');
      seenPaths.add(ref.filePath);
      files.push(file);
    }
  }

  return files;
}
