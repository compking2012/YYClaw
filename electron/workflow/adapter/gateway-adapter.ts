// @ts-nocheck
/**
 * GatewayBackedAdapter — the production {@link OpenClawAdapter} for the workflow
 * engine. ALL model work (constrained `runModel` calls AND full `runAgent`
 * sub-tasks) is driven through the OpenClaw gateway (`chat.send` + history
 * polling), so every step uses the exact model + auth the gateway is configured
 * with (`agents.defaults.model.primary`, including OAuth-only providers that a
 * direct REST call could never authenticate). `callTool` stays local/deterministic.
 *
 * The engine core stays electron-free: the gateway is injected at construction
 * (assembled in ../index.ts), and tests can keep using a fake adapter.
 */
import { randomUUID } from 'node:crypto';
import type { ZodType } from 'zod';
import type { GatewayManager } from '../../gateway/manager';
import type {
  AgentTrace,
  OpenClawAdapter,
  RunAgentOptions,
  RunModelOptions,
} from './openclaw-adapter';
import { HeadlessAdapter, extractJson } from './headless-adapter';
import { waitForAgentReply } from './agent-reply-wait';
import { childSessionKey } from '../../../shared/workflow-session';
import { deleteWorkflowChildSessions, cancelSessionBackgroundTasks } from '../../gateway/session-delete';

/** A gateway sub-session must never leak into the user's session list. */
const GATEWAY_TURN_TIMEOUT_MS = 1_800_000; // 30 minutes

/** Coerce an agent's free-text reply into the requested result schema. */
function coerceResult<T>(schema: ZodType<T>, text: string): T {
  // text-shaped schemas accept the raw reply; structured schemas parse JSON out of it.
  const direct = schema.safeParse(text);
  if (direct.success) return direct.data;
  try {
    return schema.parse(extractJson(text));
  } catch {
    // Last resort: hand back the raw text cast to T (callers using z.string() never reach here).
    return text as unknown as T;
  }
}

/**
 * Run ONE gateway turn: send a message on a `deliver:false` sub-session and wait
 * for the agent's reply text. Shared by generation (injected), `runModel`, and
 * `runAgent` so they all use the gateway's configured model + auth.
 *
 * The default sub-session key uses the `wf-agent:` prefix so it's filtered out
 * of the user's session list (see `isWorkflowSessionKey`); callers with a stable
 * node identity pass `childSessionKey(runId, stepId)` for a resumable key.
 */
export async function runGatewayTurn(
  gateway: GatewayManager,
  opts: { message: string; agentId?: string; sessionKey?: string; timeoutMs?: number },
): Promise<string> {
  const startedAt = Date.now();
  const timeoutMs = opts.timeoutMs ?? GATEWAY_TURN_TIMEOUT_MS;
  const sessionKey = opts.sessionKey ?? `wf-agent:${randomUUID().slice(0, 8)}:${startedAt}`;
  const idempotencyKey = `wf-turn-${startedAt}-${randomUUID().slice(0, 6)}`;

  const sendParams: Record<string, unknown> = {
    sessionKey,
    message: opts.message,
    idempotencyKey,
    deliver: false,
  };
  if (opts.agentId) sendParams.agentId = opts.agentId;

  const sendResult = (await gateway.rpc('chat.send', sendParams, Math.max(timeoutMs, 120_000))) as
    | { runId?: unknown }
    | undefined;
  const runId = sendResult && sendResult.runId != null ? String(sendResult.runId) : undefined;

  const text = await waitForAgentReply(gateway, {
    sessionKey,
    startedAtMs: startedAt,
    timeoutMs,
    runId,
  });

  if (text == null) {
    // Best-effort: tell the gateway to stop the stuck run.
    try {
      await gateway.rpc('chat.abort', { sessionKey }, 5_000);
    } catch {
      // ignore — abort is best-effort
    }
    throw new Error(`gateway turn timed out after ${Math.round(timeoutMs / 1000)}s waiting for the reply`);
  }
  return text;
}

export class GatewayBackedAdapter implements OpenClawAdapter {
  private readonly headless: HeadlessAdapter;

  constructor(
    private readonly gateway: GatewayManager,
    headless: HeadlessAdapter = new HeadlessAdapter(),
  ) {
    this.headless = headless;
  }

  callTool<T>(name: string, args: unknown): Promise<T> {
    return this.headless.callTool<T>(name, args);
  }

  /**
   * Discard a run's gateway sub-sessions before a resume: delete every
   * `wf:<runId>:<step>` child session (history + residual active run) and cancel
   * its background tasks, so resumed steps re-run in fresh, empty sessions.
   * `deleteWorkflowChildSessions` matches the gateway's agent-namespaced keys
   * (`agent:<id>:wf:...`) — which a bare-key `chat.abort` cannot. Best-effort.
   */
  async discardRunSessions(runId: string): Promise<void> {
    await deleteWorkflowChildSessions(this.gateway, runId);
    await cancelSessionBackgroundTasks(this.gateway, `wf:${runId}`, runId);
  }

  /**
   * A constrained single model call — routed through the gateway (NOT a direct
   * REST call), so it uses the same model + auth as the conversation. The reply
   * is coerced into the schema (with retries), tolerating an agent that wraps the
   * JSON in prose.
   */
  async runModel<T>(opts: RunModelOptions<T>): Promise<T> {
    const { schema, system, input, maxRetries = 2, timeoutMs, runId, stepId, agentId } = opts;
    const jsonSystem = `${system}\n\nRespond ONLY with a single JSON value matching the required schema. No prose, no markdown fences.`;
    const message = `${jsonSystem}\n\n${input}`;
    // A model step gets a deterministic child session when its node identity is
    // known, so the run stays resumable/idempotent.
    const sessionKey = runId && stepId ? childSessionKey(runId, stepId) : undefined;

    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const text = await runGatewayTurn(this.gateway, { message, agentId, sessionKey, timeoutMs });
        return (schema as ZodType<T>).parse(extractJson(text));
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(
      `runModel failed schema validation after ${maxRetries + 1} attempt(s): ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }

  async runAgent<T>(opts: RunAgentOptions<T>): Promise<{ result: T; trace: AgentTrace }> {
    const startedAt = Date.now();
    // Deterministic child session when the node identity is known (resumable +
    // reconstructable by the renderer); random fallback for tests/standalone use.
    const sessionKey =
      opts.runId && opts.stepId ? childSessionKey(opts.runId, opts.stepId) : undefined;

    const text = await runGatewayTurn(this.gateway, {
      message: opts.goal,
      agentId: opts.agentId,
      sessionKey,
      timeoutMs: opts.budget.timeoutMs,
    });

    const result = coerceResult(opts.resultSchema, text);
    return {
      result,
      trace: { steps: 0, tokens: 0, durationMs: Date.now() - startedAt },
    };
  }
}
