/**
 * Prompt templates for the persona natural-language generator.
 *
 * The persona settings modal lets the user describe a persona in natural
 * language and generate the corresponding workspace files (SOUL.md,
 * IDENTITY.md, ...). This module owns the per-file-type prompts so the
 * generation stays consistent whether generating a single file or the whole
 * core set. The actual model call happens over `hostApi.agents.generateText`
 * (which uses the agent's currently configured model).
 */

export interface PersonaGenPrompt {
  system: string;
  input: string;
}

/** A persona file supplied as read-only context for consistency. */
export interface PersonaContextFile {
  name: string;
  content: string;
}

export interface BuildPersonaGenPromptOptions {
  /** Current content of the target file — used as the editing baseline. */
  currentContent?: string;
  /**
   * Other persona files supplied purely as context (for cross-file
   * consistency). The model must NOT output these — only the target file.
   */
  contextFiles?: PersonaContextFile[];
}

/** Cap each context/current file so a large workspace can't blow the prompt. */
const MAX_CONTEXT_CHARS = 4000;

function clip(content: string, max = MAX_CONTEXT_CHARS): string {
  if (content.length <= max) return content;
  return `${content.slice(0, max)}\n…(truncated)`;
}

/**
 * The core persona files produced by the "generate whole set" mode. These are
 * the identity-defining documents; structural files (AGENTS.md, TOOLS.md,
 * MEMORY.md, ...) are intentionally left out — they hold OpenClaw base +
 * YYClaw environment/tool content and aren't derived from a free-text
 * persona description (the "重建人格模板" action restores those instead).
 */
export const PERSONA_GEN_SET = ['IDENTITY.md', 'USER.md', 'SOUL.md'] as const;

/** Per-file guidance describing what each persona file should contain. */
const FILE_SPECS: Record<string, { title: string; guidance: string }> = {
  'IDENTITY.md': {
    title: "IDENTITY.md — the agent's identity card",
    guidance:
      'A concise Markdown profile: the name, what kind of creature/entity it is, '
      + 'its vibe (how it comes across), a signature emoji, and optionally an avatar note. '
      + 'Keep it short and evocative, like a character sheet.',
  },
  'SOUL.md': {
    title: "SOUL.md — the agent's personality and behavioral principles",
    guidance:
      'The core personality, values, tone of voice, boundaries, and how the agent '
      + 'should behave. Write clear Markdown guidelines (with headings like Core Truths, '
      + 'Boundaries, Vibe) that the agent will actually follow.',
  },
  'USER.md': {
    title: 'USER.md — context about the human user',
    guidance:
      'Who the user is, their preferences, working style, and context the agent should '
      + 'remember about them.',
  },
  'TOOLS.md': {
    title: 'TOOLS.md — tools and capabilities',
    guidance:
      "The tools and capabilities the agent has, and guidance on how and when to use them.",
  },
  'DREAMS.md': {
    title: 'DREAMS.md — goals and aspirations',
    guidance:
      "The agent's goals, aspirations, and longer-term intentions.",
  },
  'HEARTBEAT.md': {
    title: 'HEARTBEAT.md — recurring check-ins',
    guidance:
      'Recurring things the agent should periodically check on or do.',
  },
};

const GENERIC_SPEC = {
  title: 'a persona Markdown file',
  guidance:
    'A well-structured Markdown document that fits this file within the agent persona.',
};

/** Whether single-file natural-language generation is offered for this file. */
export function isPersonaGeneratableFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.md');
}

function specForFile(fileName: string) {
  return FILE_SPECS[fileName] ?? GENERIC_SPEC;
}

/**
 * Build the system + user prompt for generating (or adjusting) a single
 * persona file.
 *
 * - `currentContent` (if any) is the editing baseline: the model works FROM it,
 *   so a small/local request naturally keeps the rest intact, while a "rewrite"
 *   request replaces it. The extent of change is driven by the user's request,
 *   not a built-in bias.
 * - `contextFiles` are the agent's OTHER persona files, supplied purely so the
 *   result stays consistent with them. The model must never output them.
 */
export function buildPersonaGenPrompt(
  fileName: string,
  description: string,
  opts: BuildPersonaGenPromptOptions = {},
): PersonaGenPrompt {
  const spec = specForFile(fileName);
  const { currentContent, contextFiles } = opts;
  const hasCurrent = typeof currentContent === 'string' && currentContent.trim().length > 0;
  const context = (contextFiles ?? []).filter((f) => f.content.trim().length > 0);

  const system = [
    `You are editing the "${fileName}" file for an AI agent's persona.`,
    `This file is ${spec.title}.`,
    `Content: ${spec.guidance}`,
    '',
    'Rules:',
    `- Output ONLY the raw Markdown content of ${fileName}. No explanations, no preamble, no closing remarks.`,
    '- Do NOT wrap the output in code fences (```).',
    "- Write in the same language as the user's description.",
    hasCurrent
      ? '- Apply the request to the CURRENT content below, which is your baseline. Do exactly what the request asks: a small/local tweak stays small (keep everything else intact); a full rewrite is fine when that is what is asked.'
      : '- Produce a complete, ready-to-save file.',
    context.length > 0
      ? '- The other persona files are provided ONLY as context for consistency. Never output them; keep this file coherent with them.'
      : '',
  ].filter(Boolean).join('\n');

  const contextBlock = context.length > 0
    ? `\n\nOther persona files (context only — do NOT output these):\n${
      context.map((f) => `--- ${f.name} ---\n${clip(f.content)}`).join('\n\n')
    }`
    : '';

  const input = [
    `Persona description / request:\n${description.trim()}`,
    hasCurrent ? `\n\nCurrent ${fileName} content (baseline to edit):\n${clip(currentContent!)}` : '',
    contextBlock,
  ].join('');

  return { system, input };
}
