/**
 * Prompt template for the "enhance prompt" button available in the main
 * composer and the cron task editor. Takes
 * the user's rough draft and rewrites it into a clearer, more actionable
 * prompt. The actual model call happens over `hostApi.agents.generateText`
 * (which uses the target agent's currently configured text model), mirroring
 * `persona-generate.ts`'s natural-language generator.
 */

export interface EnhancePromptGenPrompt {
  system: string;
  input: string;
}

/** Cap the draft so a very long paste can't blow the prompt. */
const MAX_DRAFT_CHARS = 6000;

function clip(content: string, max = MAX_DRAFT_CHARS): string {
  if (content.length <= max) return content;
  return `${content.slice(0, max)}\n…(truncated)`;
}

/**
 * Build the system + user prompt for rewriting a draft prompt into a better
 * one. The model must return ONLY the rewritten prompt text — it goes
 * straight back into the same text field the user was editing.
 */
export function buildEnhancePromptGenPrompt(draftText: string): EnhancePromptGenPrompt {
  const system = [
    'You rewrite draft prompts into clearer, more actionable prompts for an AI agent.',
    '',
    'Rules:',
    '- Output ONLY the rewritten prompt text itself. No explanations, no preamble, no closing remarks, no quotes around it.',
    '- Do NOT wrap the output in code fences (```).',
    "- Write in the same language as the draft.",
    '- Preserve the user\'s actual intent and any concrete constraints (file names, numbers, deadlines, tool/skill references) — clarify and structure, do not invent new requirements.',
    '- If the draft is already clear and well-structured, make only light touch-ups rather than rewriting it wholesale.',
  ].join('\n');

  const input = `Draft prompt to rewrite:\n${clip(draftText.trim())}`;

  return { system, input };
}
