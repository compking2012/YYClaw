// @ts-nocheck
/**
 * HeadlessAdapter — v1 implementation of {@link OpenClawAdapter}.
 *
 * - `callTool`  dispatches to the local {@link StepRegistry} (validate → run),
 *               never touching the model or any agent hook.
 * - `runModel`  issues one constrained model call via {@link callModelOnce},
 *               then enforces the zod schema with bounded retries.
 * - `runAgent`  is the Phase-2 escape hatch; v1 throws a clear error.
 */
import type { ZodType } from 'zod';
import type {
  AgentTrace,
  OpenClawAdapter,
  RunAgentOptions,
  RunModelOptions,
} from './openclaw-adapter';
import { callModelOnce } from '../model-client';
import { stepRegistry, type StepRegistry } from '../step-registry';

/** Best-effort extraction of a JSON object from a model's text response. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  // Strip ```json … ``` fences if present.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const body = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(body);
  } catch {
    // Fall back to the first {...} or [...] block.
    const start = body.search(/[{[]/);
    const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'));
    if (start >= 0 && end > start) {
      return JSON.parse(body.slice(start, end + 1));
    }
    throw new Error('Model response did not contain JSON');
  }
}

export class HeadlessAdapter implements OpenClawAdapter {
  constructor(private readonly registry: StepRegistry = stepRegistry) {}

  async callTool<T>(name: string, args: unknown): Promise<T> {
    const tool = this.registry.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }
    const parsed = tool.schema.parse(args);
    return (await tool.run(parsed)) as T;
  }

  async runModel<T>(opts: RunModelOptions<T>): Promise<T> {
    const { schema, system, input, temperature = 0, maxRetries = 2, providerId, model, timeoutMs } = opts;
    const jsonSystem = `${system}\n\nRespond ONLY with a single JSON value matching the required schema. No prose, no markdown fences.`;
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const { text } = await callModelOnce({ system: jsonSystem, input, temperature, providerId, model, timeoutMs });
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

  async runAgent<T>(_opts: RunAgentOptions<T>): Promise<{ result: T; trace: AgentTrace }> {
    throw new Error(
      'runAgent (agentic escape hatch) is not implemented in v1. Planned for Phase 2 via gateway chat.send with a budget.',
    );
  }
}
