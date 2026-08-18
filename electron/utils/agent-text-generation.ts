/**
 * Single-shot text generation using an *agent's currently configured model*.
 *
 * Mirrors the per-agent resolution done by the image-generation test
 * ({@link runImageGenerationTest}): resolve the agent, take its effective
 * text model ref, map that ref to a provider account, then issue exactly one
 * request through {@link callModelOnce}. This lets UI features (e.g. the
 * persona natural-language generator) run a generation on the same model the
 * agent would answer with — not the global default.
 */
import { listAgentsSnapshot } from './agent-config';
import { listProviderAccounts } from '../services/providers/provider-store';
import { resolveDefaultModelProviderAccountId } from './default-model-provider-account';
import { callModelOnce } from '../workflow/model-client';

export interface GenerateAgentTextParams {
  agentId?: string;
  system: string;
  input: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

export interface GenerateAgentTextResult {
  text: string;
  /** The effective model ref used (for debugging / UI display). */
  modelRef: string;
}

/** Strip the leading runtime provider-key prefix, leaving the bare model id. */
function bareModelId(modelRef: string): string {
  const slash = modelRef.indexOf('/');
  return slash > 0 ? modelRef.slice(slash + 1) : modelRef;
}

/**
 * Generate text with the agent's current text model. Throws (with a
 * user-facing message) when the agent has no model configured or the model
 * ref cannot be mapped to an authenticated provider account.
 */
export async function generateAgentText(
  params: GenerateAgentTextParams,
): Promise<GenerateAgentTextResult> {
  const snapshot = await listAgentsSnapshot();
  const agentId = params.agentId?.trim() || snapshot.defaultAgentId;
  const agent = snapshot.agents.find((entry) => entry.id === agentId);
  if (!agent) {
    throw new Error(`Agent "${agentId}" not found`);
  }

  const modelRef = agent.modelRef?.trim();
  if (!modelRef) {
    throw new Error(`Agent "${agent.name}" has no model configured. Set a model for this agent first.`);
  }

  const accounts = await listProviderAccounts();
  const accountId = resolveDefaultModelProviderAccountId(modelRef, accounts);
  if (!accountId) {
    throw new Error(`Cannot resolve a provider account for the agent's model "${modelRef}".`);
  }

  const { text } = await callModelOnce({
    providerId: accountId,
    model: bareModelId(modelRef),
    system: params.system,
    input: params.input,
    temperature: params.temperature,
    maxOutputTokens: params.maxOutputTokens,
    timeoutMs: params.timeoutMs,
  });

  return { text, modelRef };
}
