/**
 * Talk event parsing + subscription helpers.
 *
 * The Main process forwards Gateway `talk.event` payloads to the renderer on the
 * `gateway:talk-event` channel (see electron event-dispatch / ipc-handlers). The
 * exact field names of the kernel's talk-event envelope are normalized here
 * defensively (the kernel emits both `transcript.delta`/`output.audio.delta`
 * style types and, on some relay paths, raw `transcript`/`audio`/`clear` types).
 * Field names should be re-verified at runtime against `talk.event`.
 */
import { subscribeHostEvent } from '@/lib/host-events';

export interface TalkEvent {
  type?: string;
  sessionId?: string;
  final?: boolean;
  role?: string;
  text?: string;
  audioBase64?: string;
  payload?: unknown;
}

function payloadRecord(evt: TalkEvent): Record<string, unknown> {
  return evt.payload && typeof evt.payload === 'object' ? (evt.payload as Record<string, unknown>) : {};
}

export function talkEventText(evt: TalkEvent): string | undefined {
  const p = payloadRecord(evt);
  const text = evt.text ?? p.text ?? p.transcript ?? p.delta;
  return typeof text === 'string' ? text : undefined;
}

export function talkEventRole(evt: TalkEvent): 'user' | 'assistant' | undefined {
  const p = payloadRecord(evt);
  const role = evt.role ?? p.role;
  return role === 'user' || role === 'assistant' ? role : undefined;
}

export function isTranscriptEvent(evt: TalkEvent): boolean {
  return evt.type === 'transcript.delta' || evt.type === 'transcript.done' || evt.type === 'transcript';
}

export function isFinalTranscript(evt: TalkEvent): boolean {
  const p = payloadRecord(evt);
  return evt.type === 'transcript.done' || evt.final === true || p.final === true;
}

export function isOutputAudioStart(evt: TalkEvent): boolean {
  return evt.type === 'output.audio.started';
}

export function isOutputAudioDone(evt: TalkEvent): boolean {
  return evt.type === 'output.audio.done';
}

export function talkEventAudioBase64(evt: TalkEvent): string | undefined {
  if (evt.type !== 'output.audio.delta' && evt.type !== 'audio') return undefined;
  const p = payloadRecord(evt);
  const audio = evt.audioBase64 ?? p.audioBase64 ?? p.audio ?? p.delta ?? (typeof evt.payload === 'string' ? evt.payload : undefined);
  return typeof audio === 'string' ? audio : undefined;
}

export function isClearEvent(evt: TalkEvent): boolean {
  return evt.type === 'clear' || evt.type === 'output.audio.cleared' || evt.type === 'turn.cancelled';
}

export function isSessionError(evt: TalkEvent): boolean {
  return evt.type === 'session.error';
}

/** Subscribe to talk events for a specific session id. Returns an unsubscribe fn. */
export function subscribeTalkSession(sessionId: string, handler: (evt: TalkEvent) => void): () => void {
  return subscribeHostEvent<TalkEvent>('gateway:talk-event', (evt) => {
    if (!evt || (evt.sessionId && evt.sessionId !== sessionId)) return;
    handler(evt);
  });
}
