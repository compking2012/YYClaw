// @ts-nocheck
/**
 * Session-reply waiter for the workflow engine's gateway turns (runAgent /
 * runModel / generation). It must return the agent turn's FINAL reply — never an
 * early streamed preamble.
 *
 * The previous heuristic ("latest assistant text unchanged across two polls")
 * accepted the opening line (e.g. "我先调研一下…") while the agent was still
 * calling tools or running a long model_call, which then poisoned every
 * downstream `{{stepId}}` template and the final synthesis (it only ever saw the
 * placeholder preambles).
 *
 * So acceptance is now gated on the gateway's RUN-COMPLETE event
 * (phase ∈ {completed,done,finished,end,ended}) for this session/run, plus an
 * in-flight tool-work guard and a short post-completion stability check. If the
 * gateway emits no completion phase, a conservative idle fallback (no matching
 * events AND no history change for a while) accepts the latest stable text so we
 * don't block to the deadline. On true timeout/abort it returns null (the caller
 * fails the step cleanly rather than consuming a preamble).
 *
 * Kept self-contained (NO import from electron/services/office/*) — it mirrors the
 * proven office run-settle logic but avoids dragging in the office multi-agent
 * deps (mention dispatch, room mirror, structured-reply, attachments).
 */
import type { GatewayManager } from '../../gateway/manager';
import { logger } from '../../utils/logger';

type RawMessage = {
  role?: unknown;
  content?: unknown;
  timestamp?: unknown;
  createdAt?: unknown;
  [key: string]: unknown;
};

export interface WaitAgentReplyOptions {
  sessionKey: string;
  /** Only messages at/after this wall-clock ms count as the reply. */
  startedAtMs: number;
  /** 0 = unlimited; defaults to 5 minutes. */
  timeoutMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
  /** chat.send runId — extra event-matching safety (sessionKey is the primary match). */
  runId?: string;
  /** Delay before the first history poll (lets the turn begin). */
  initialDelayMs?: number;
  /** No matching events AND no history change for this long ⇒ assume the turn ended. */
  idleFallbackMs?: number;
}

const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_POLL_MS = 2_000;
const DEFAULT_INITIAL_DELAY_MS = 1_000;
const DEFAULT_IDLE_FALLBACK_MS = 45_000;
/** Consecutive identical polls (after the gate opens) required to accept. */
const REQUIRED_STABLE = 2;
/** Gateway run-completion phases (mirror of office OFFICE_RUN_COMPLETE_PHASES). */
const COMPLETE_PHASES = new Set(['completed', 'done', 'finished', 'end', 'ended']);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parse a numeric epoch or ISO string into ms; unknown → 0. */
function timestampMs(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const n = Number(raw);
    if (Number.isFinite(n) && raw.trim() !== '') return n;
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

/** Flatten assistant content (string | Anthropic/OpenAI block arrays) into plain text. */
function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'string') return block;
        if (block && typeof block === 'object') {
          const b = block as { text?: unknown; content?: unknown };
          if (typeof b.text === 'string') return b.text;
          if (typeof b.content === 'string') return b.content;
        }
        return '';
      })
      .join('')
      .trim();
  }
  return '';
}

async function fetchHistory(
  gateway: GatewayManager,
  sessionKey: string,
  limit = 80,
): Promise<RawMessage[]> {
  const attempts: Record<string, unknown>[] = [
    { sessionKey, limit },
    { key: sessionKey, limit },
  ];
  for (const params of attempts) {
    try {
      const result = await gateway.rpc<{ messages?: unknown }>('chat.history', params, 60_000);
      if (result && typeof result === 'object' && Array.isArray(result.messages)) {
        return result.messages as RawMessage[];
      }
      return [];
    } catch {
      // try next param shape
    }
  }
  return [];
}

/** The latest non-empty assistant text at/after `startedAtMs`, or null. */
function latestAssistantAfter(messages: RawMessage[], startedAtMs: number): string | null {
  let best: { at: number; text: string } | null = null;
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue;
    const at = timestampMs(msg.timestamp ?? msg.createdAt);
    if (at && at < startedAtMs) continue;
    const text = extractText(msg.content);
    if (!text) continue;
    if (!best || at >= best.at) best = { at, text };
  }
  return best?.text ?? null;
}

// --- in-flight tool-work detection (self-contained mirror of office logic) ---

function isToolResultRole(role: unknown): boolean {
  const normalized = String(role ?? '').toLowerCase();
  return normalized === 'toolresult' || normalized === 'tool_result';
}

function collectToolCallIds(msg: RawMessage): string[] {
  const ids: string[] = [];
  const content = msg.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const b = block as Record<string, unknown>;
      if (b.type !== 'tool_use' && b.type !== 'toolCall') continue;
      const id = b.id ?? b.name;
      if (id != null && String(id).trim()) ids.push(String(id));
    }
  }
  const toolCalls = (msg.tool_calls ?? msg.toolCalls) as unknown;
  if (Array.isArray(toolCalls)) {
    for (const tc of toolCalls) {
      if (!tc || typeof tc !== 'object') continue;
      const row = tc as Record<string, unknown>;
      const id = row.id ?? row.name;
      if (id != null && String(id).trim()) ids.push(String(id));
    }
  }
  return ids;
}

/**
 * True when the current turn still has an unmatched tool call (agent will keep
 * working), so we must not accept a reply yet. Scans messages at/after the turn
 * start (child sessions are single-turn; model-step retries reuse the key, hence
 * the timestamp filter).
 */
function hasInFlightToolWork(messages: RawMessage[], startedAtMs: number): boolean {
  const pending = new Set<string>();
  let lastRelevant: RawMessage | undefined;
  for (const msg of messages) {
    const at = timestampMs(msg.timestamp ?? msg.createdAt);
    if (at && at < startedAtMs) continue;
    if (msg.role === 'assistant') {
      for (const id of collectToolCallIds(msg)) pending.add(id);
    } else if (isToolResultRole(msg.role)) {
      const toolCallId = msg.toolCallId ?? msg.tool_call_id;
      if (toolCallId != null) pending.delete(String(toolCallId));
      else pending.clear();
    }
    lastRelevant = msg;
  }
  if (pending.size > 0) return true;
  return Boolean(lastRelevant && isToolResultRole(lastRelevant.role));
}

// --- gateway event parsing (self-contained subset of office parseGatewayChatEnvelope) ---

type ChatEvent = { sessionKey?: string; state?: string; phase?: string; runId?: string };

function readStr(...vals: unknown[]): string | undefined {
  const found = vals.find((v) => typeof v === 'string' && (v as string).trim());
  return found == null ? undefined : String(found);
}

/** Parse a `chat:message` event envelope: `{ message: { sessionKey, state, phase, runId, ... } }`. */
function parseChatMessage(data: { message?: unknown }): ChatEvent | null {
  const outer = data?.message;
  if (!outer || typeof outer !== 'object') return null;
  const o = outer as Record<string, unknown>;
  const d = o.data && typeof o.data === 'object' ? (o.data as Record<string, unknown>) : {};
  return {
    sessionKey: readStr(o.sessionKey, d.sessionKey),
    state: readStr(o.state, d.state),
    phase: readStr(o.phase, d.phase),
    runId: o.runId != null ? String(o.runId) : d.runId != null ? String(d.runId) : undefined,
  };
}

/** Parse a JSON-RPC `notification` (method 'agent' | 'chat') into a chat event. */
function parseNotification(data: { method?: string; params?: unknown }): ChatEvent | null {
  const method = data?.method ?? '';
  if (method !== 'agent' && method !== 'chat') return null;
  const p = (data?.params && typeof data.params === 'object' ? data.params : {}) as Record<string, unknown>;
  const d = p.data && typeof p.data === 'object' ? (p.data as Record<string, unknown>) : {};
  const session = p.session && typeof p.session === 'object' ? (p.session as Record<string, unknown>) : {};
  return {
    sessionKey: readStr(p.sessionKey, d.sessionKey, p.key, d.key, session.key),
    state: readStr(p.state, d.state),
    phase: readStr(d.phase, p.phase),
    runId: p.runId != null ? String(p.runId) : d.runId != null ? String(d.runId) : undefined,
  };
}

/**
 * Match an event to our turn. The gateway may namespace our sessionKey under an
 * agent (we send `wf:<runId>:<stepId>`, events carry `agent:ceo:wf:<runId>:<stepId>`),
 * so match by suffix; runId is a stronger match when both sides have it.
 */
function eventMatches(evt: ChatEvent, sessionKey: string, runId?: string): boolean {
  if (runId && evt.runId) return evt.runId === runId;
  const k = evt.sessionKey;
  if (!k) return false;
  return k === sessionKey || k.endsWith(sessionKey);
}

/**
 * Wait for the FINAL assistant reply of one gateway turn on `sessionKey`.
 * Returns the reply text, or null on timeout/abort.
 */
export async function waitForAgentReply(
  gateway: GatewayManager,
  options: WaitAgentReplyOptions,
): Promise<string | null> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const idleFallbackMs = options.idleFallbackMs ?? DEFAULT_IDLE_FALLBACK_MS;
  const unlimited = timeoutMs === 0;
  const deadline = unlimited ? Number.POSITIVE_INFINITY : Date.now() + timeoutMs;
  const startedWaitAt = Date.now();

  logger.info(
    `[waitForAgentReply] start session=${options.sessionKey} run=${options.runId ?? ''} timeoutMs=${timeoutMs} idleFallbackMs=${idleFallbackMs}`,
  );

  // Authoritative completion signal, driven by gateway events for this session/run.
  let runComplete = false;
  let lastActivityAt = Date.now();

  const onEvent = (evt: ChatEvent | null) => {
    if (!evt) return;
    const phase = (evt.phase ?? '').trim().toLowerCase();
    const state = (evt.state ?? '').trim().toLowerCase();
    if (!eventMatches(evt, options.sessionKey, options.runId)) {
      // Diagnostic: a completion-phase event we couldn't attribute to our turn
      // is the prime suspect for a stall (event namespace / runId mismatch —
      // see breakpoint "a"). Log so a real timeout can be traced to it.
      if (COMPLETE_PHASES.has(phase)) {
        logger.warn(
          `[waitForAgentReply] unmatched completion event phase=${phase} evtSession=${evt.sessionKey ?? ''} evtRun=${evt.runId ?? ''} ourSession=${options.sessionKey} ourRun=${options.runId ?? ''}`,
        );
      }
      return;
    }
    lastActivityAt = Date.now();
    if (state === 'started' || phase === 'started') {
      runComplete = false; // a fresh turn started — don't accept a stale completion
      return;
    }
    if (COMPLETE_PHASES.has(phase)) {
      if (!runComplete) {
        logger.info(
          `[waitForAgentReply] run-complete matched phase=${phase} session=${options.sessionKey} run=${options.runId ?? ''}`,
        );
      }
      runComplete = true;
    }
  };
  const onChat = (data: { message?: unknown }) => onEvent(parseChatMessage(data));
  const onNotification = (data: { method?: string; params?: unknown }) => onEvent(parseNotification(data));
  gateway.on('chat:message', onChat);
  gateway.on('notification', onNotification);

  try {
    await sleep(initialDelayMs);

    let lastText: string | null = null;
    let stable = 0;
    let historyFingerprint = '';
    let pollCount = 0;
    let lastInFlight = false;

    while (Date.now() < deadline) {
      if (options.signal?.aborted) {
        logger.warn(`[waitForAgentReply] aborted session=${options.sessionKey} run=${options.runId ?? ''}`);
        return null;
      }

      const messages = await fetchHistory(gateway, options.sessionKey);

      // Any history growth/change counts as activity (feeds the idle fallback).
      const last = messages[messages.length - 1];
      const fp = `${messages.length}:${timestampMs(last?.timestamp ?? last?.createdAt)}`;
      if (fp !== historyFingerprint) {
        historyFingerprint = fp;
        lastActivityAt = Date.now();
      }

      const inFlight = hasInFlightToolWork(messages, options.startedAtMs);
      const text = latestAssistantAfter(messages, options.startedAtMs);
      const idle = Date.now() - lastActivityAt >= idleFallbackMs;
      const gateOpen = runComplete || idle;
      lastInFlight = inFlight;

      // Periodic snapshot (~every 10s at the 2s poll) so a stall can be traced to
      // the exact failing condition: empty history (text null ⇒ breakpoint "b"),
      // never-clearing tool work (inFlight ⇒ "c"), or gate never opening
      // (!runComplete && !idle ⇒ "a").
      if (pollCount % 5 === 0) {
        logger.info(
          `[waitForAgentReply] poll session=${options.sessionKey} msgs=${messages.length} hasText=${Boolean(text)} inFlight=${inFlight} runComplete=${runComplete} idle=${idle} stable=${stable} elapsedS=${Math.round((Date.now() - startedWaitAt) / 1000)}`,
        );
      }
      pollCount += 1;

      if (text && !inFlight && gateOpen) {
        if (text === lastText) {
          stable += 1;
          if (stable >= REQUIRED_STABLE) return text;
        } else {
          stable = 1;
          lastText = text;
        }
      } else {
        if (inFlight || !text) stable = 0;
        if (text) lastText = text; // remember latest (not returned unless gated+stable)
      }

      await sleep(pollIntervalMs);
    }
    // Deadline with no gated+stable reply: fail cleanly rather than return a preamble.
    logger.warn(
      `[waitForAgentReply] TIMEOUT session=${options.sessionKey} run=${options.runId ?? ''} elapsedS=${Math.round((Date.now() - startedWaitAt) / 1000)} hadText=${Boolean(lastText)} inFlight=${lastInFlight} runComplete=${runComplete}`,
    );
    return null;
  } finally {
    gateway.off('chat:message', onChat);
    gateway.off('notification', onNotification);
  }
}
