/**
 * Generates a {@link DynamicWorkflowDefinition} from a single user task via one
 * constrained model call. Doubles as the workflow-suitability triage: returns
 * `null` when the model deems the task unsuitable (one-shot Q&A) or yields < 2
 * steps — the caller then falls back to a normal chat reply.
 *
 * Uses {@link callModelOnce} (bypasses the agent loop) so generation is a cheap,
 * bounded, schema-validated call. Electron-free apart from the model client.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { callModelOnce } from '../model-client';
import { extractJson } from '../adapter/headless-adapter';
import { logger } from '../../utils/logger';
import { buildDynamicWorkflowPrompt } from './prompt';
import type { DynamicStep, DynamicWorkflowDefinition } from './types';

const GenStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  goal: z.string().min(1),
  kind: z.enum(['agent', 'model', 'deterministic']).optional(),
  inputsFrom: z.array(z.string()).optional(),
});

const GenSchema = z.object({
  suitable: z.boolean().optional(),
  title: z.string().optional(),
  steps: z.array(GenStepSchema).optional(),
  /** Set instead of `steps` when the task should defer to an installed skill. */
  matchedSkill: z.string().optional(),
  /**
   * Set when a resumable run's context was provided AND the user's message is a
   * request to continue/retry that unfinished workflow (rather than a new task).
   */
  resume: z.boolean().optional(),
});

/** Compact view of an unfinished run, so the model can decide "continue vs new". */
export interface ResumableRunContext {
  title?: string;
  /** Steps in order with their outcome, so the model sees where it stopped. */
  steps?: Array<{ title: string; status?: 'done' | 'failed' | 'pending' }>;
  error?: string;
}

export interface GenerateDynamicWorkflowOptions {
  providerId?: string;
  model?: string;
  timeoutMs?: number;
  /** Agent to generate on (gateway-backed); mirrors the conversation's agent. */
  agentId?: string;
  /** Installed workflow-shaped skills the model may defer to instead of inventing steps. */
  skills?: Array<{ name: string; description?: string }>;
  /** Called (instead of returning steps) when the model defers to one of `skills`. */
  onSkillMatch?: (skillName: string) => void;
  /**
   * Context of an unfinished workflow run in the current conversation. When
   * present, the model is asked to FIRST judge whether the user's message means
   * "continue/retry that run" — if so it returns `{resume:true}` and `onResume`
   * fires (the caller then continues the existing run instead of building a new
   * one). This replaces the old regex intent match with a model decision.
   */
  resumable?: ResumableRunContext;
  /** Called (instead of returning steps) when the model judges the turn a resume. */
  onResume?: () => void;
  /**
   * Injected one-shot model runner. In production this routes through the gateway
   * (`chat.send`) so generation uses the SAME model + auth as the conversation
   * (`agents.defaults.model.primary`, including OAuth-only providers a direct REST
   * call can't authenticate). When absent (tests / no gateway) it falls back to
   * the direct {@link callModelOnce}.
   */
  runOnce?: (req: { system: string; input: string; timeoutMs?: number }) => Promise<string>;
}

/** Sanitize an id to `[a-z0-9_]`, falling back to a positional id. */
function sanitizeId(raw: string, index: number): string {
  const cleaned = raw.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || `step${index + 1}`;
}

/** Rewrite `{{originalId}}` placeholders to their sanitized ids (handles spaces in keys). */
function rewritePlaceholders(goal: string, idMap: Map<string, string>): string {
  let out = goal;
  for (const [orig, mapped] of idMap) {
    if (orig === mapped) continue;
    const escaped = orig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`, 'g'), `{{${mapped}}}`);
  }
  return out;
}

/**
 * Preamble describing an unfinished run, asking the model to decide resume-vs-new
 * as the FIRST thing. Prepended to the normal decomposition prompt so a single
 * model call handles both (the merged triage).
 */
function buildResumePreamble(ctx: ResumableRunContext): string {
  const statusMark = (s?: string): string =>
    s === 'done' ? '✅已完成' : s === 'failed' ? '❌中断' : '⏳未开始';
  const stepLines = (ctx.steps ?? []).map((s) => `- ${s.title} ${statusMark(s.status)}`);
  return [
    '【当前会话有一个尚未完成的工作流】',
    `标题：${ctx.title ?? '(未命名)'}`,
    ...(stepLines.length ? ['步骤进度：', ...stepLines] : []),
    ...(ctx.error ? [`中断原因：${ctx.error}`] : []),
    '',
    '请先判断用户下面这条消息的意图：',
    '- 如果是想「继续 / 重试 / 接着跑完」上面这个未完成的工作流（而不是发起一个全新任务），',
    '  只输出 {"resume": true}，不要输出 steps。',
    '- 否则忽略这段，按下面的规则把它当作一个新任务处理。',
    '',
  ].join('\n');
}

/**
 * Decompose `task` into a dynamic workflow, or return `null` if it isn't a good
 * fit (unsuitable / fewer than 2 steps / generation failed).
 */
export async function generateDynamicWorkflow(
  task: string,
  options: GenerateDynamicWorkflowOptions = {},
): Promise<DynamicWorkflowDefinition | null> {
  const trimmed = task.trim();
  if (!trimmed) return null;

  const system = options.resumable
    ? '你是一个任务编排助手，只输出 JSON。可能需要先判断用户是否想继续一个未完成的工作流。'
    : '你是一个任务编排助手，只输出 JSON。';
  const basePrompt = buildDynamicWorkflowPrompt(trimmed, options.skills);
  const input = options.resumable ? `${buildResumePreamble(options.resumable)}${basePrompt}` : basePrompt;

  let parsed: z.infer<typeof GenSchema> | null = null;
  for (let attempt = 0; attempt < 2 && !parsed; attempt += 1) {
    try {
      // Prefer the injected (gateway-backed) runner so generation uses the same
      // model + auth as the conversation; fall back to the direct client.
      const text = options.runOnce
        ? await options.runOnce({ system, input, timeoutMs: options.timeoutMs })
        : (
            await callModelOnce({
              system,
              input,
              temperature: 0,
              providerId: options.providerId,
              model: options.model,
              timeoutMs: options.timeoutMs,
            })
          ).text;
      parsed = GenSchema.parse(extractJson(text));
    } catch (err) {
      // Not silent: a thrown model call (e.g. no usable provider) or an
      // unparseable reply is the usual reason a multi-step task fails to route
      // into a workflow. Surface it so the "never enters workflow" failure mode
      // is diagnosable instead of looking like a deliberate fall-through.
      console.warn(`[generateDynamicWorkflow] attempt ${attempt + 1} failed:`, err);
      logger.warn(`[generateDynamicWorkflow] attempt ${attempt + 1} failed: ${err instanceof Error ? err.message : String(err)}`);
      parsed = null;
    }
  }

  if (!parsed) return null;
  // Merged triage: a resume request short-circuits generation — the caller
  // continues the existing run instead of building a new one.
  if (parsed.resume === true && options.resumable) {
    options.onResume?.();
    return null;
  }
  if (parsed.matchedSkill) {
    options.onSkillMatch?.(parsed.matchedSkill);
    return null;
  }
  if (parsed.suitable === false) return null;
  const rawSteps = parsed.steps ?? [];
  // Require ≥3 steps: 2-step "decompositions" are usually a normal task the
  // model over-split, and routing them just adds workflow overhead + fragile
  // multi-turn execution for no real benefit.
  if (rawSteps.length < 3) return null;

  // Build original → sanitized id map (unique), then rewrite goals/inputsFrom.
  const seen = new Set<string>();
  const idMap = new Map<string, string>();
  rawSteps.forEach((s, i) => {
    let id = sanitizeId(s.id, i);
    while (seen.has(id)) id = `${id}_${i}`;
    seen.add(id);
    idMap.set(s.id, id);
  });

  const ids = rawSteps.map((s) => idMap.get(s.id)!);

  // A unique id for the appended synthesis step.
  let synthId = 'synthesize';
  for (let n = 1; seen.has(synthId); n += 1) synthId = `synthesize_${n}`;
  seen.add(synthId);

  const steps: DynamicStep[] = rawSteps.map((s, i) => ({
    id: ids[i],
    title: s.title.trim().slice(0, 12),
    kind: s.kind ?? 'agent',
    goalTemplate: rewritePlaceholders(s.goal.trim(), idMap),
    inputsFrom: s.inputsFrom?.map((dep) => idMap.get(dep) ?? dep),
    // The last task step now feeds the synthesis step instead of terminating.
    next: i < rawSteps.length - 1 ? ids[i + 1] : synthId,
  }));

  // Final synthesis step: fold all prior outputs into one user-facing reply.
  // It is the terminal step, so the engine surfaces its output as the run
  // result. Modeled as an `agent` step (free-text result) rather than a `model`
  // step, because a model step must satisfy a JSON schema — wrapping a long,
  // multi-paragraph synthesized answer into `{ "output": "..." }` is brittle
  // (newlines/quotes in the prose break JSON), whereas an agent step returns
  // plain text directly.
  const refs = ids.map((id) => `【${id}】\n{{${id}}}`).join('\n\n');
  steps.push({
    id: synthId,
    title: '汇总',
    kind: 'agent',
    goalTemplate:
      '你负责汇总一个多步骤任务的执行结果。以下是各步骤的产出：\n\n' +
      `${refs}\n\n` +
      '请综合这些结果，面向用户输出对原任务「{{goal}}」的完整、连贯、可直接阅读的最终答复；' +
      '只输出最终答复正文，不要罗列步骤、不要复述过程或加入额外说明。',
    inputsFrom: ids,
    next: null,
  });

  return {
    id: `dyn-${randomUUID().slice(0, 8)}`,
    version: 1,
    title: (parsed.title?.trim() || trimmed).slice(0, 40),
    goal: trimmed,
    entry: steps[0].id,
    steps,
  };
}
