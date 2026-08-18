/**
 * Data-driven model selection — pure, dependency-free scoring used by the Agent
 * "auto-select model" feature.
 *
 * Two entry points:
 *  - `deriveTaskFeatures(prompt, { hasImage })` → a task feature vector from the
 *    current turn (cheap heuristics; no history needed).
 *  - `selectBestModel(candidates, features, profile, opts)` → argmax of a utility
 *    function over the enriched candidates, after hard-constraint filtering, with
 *    a stickiness bonus for the currently-active model to avoid mid-session churn.
 *
 * This module has NO imports beyond shared types so it can be copied verbatim
 * into the gateway `model-router` plugin (a separate deployable) and reused by
 * the electron workflow model path. Keep it side-effect free and framework-free.
 */
import type { ModelMeta, ModelStrengthKey } from '../providers/types';
import type { ModelKind } from '../providers/model-kind';

// ── Optimization profiles ───────────────────────────────────────────────────

export type OptimizationProfileName = 'quality' | 'balanced' | 'cost' | 'latency';

export interface UtilityWeights {
  /** quality weight */ wq: number;
  /** cost weight (subtracted) */ wc: number;
  /** latency weight (subtracted) */ wl: number;
  /** reliability weight */ wr: number;
}

export const PROFILE_WEIGHTS: Record<OptimizationProfileName, UtilityWeights> = {
  quality: { wq: 1.0, wc: 0.15, wl: 0.1, wr: 0.4 },
  balanced: { wq: 1.0, wc: 0.5, wl: 0.3, wr: 0.4 },
  cost: { wq: 0.6, wc: 1.0, wl: 0.3, wr: 0.35 },
  latency: { wq: 0.7, wc: 0.3, wl: 1.0, wr: 0.4 },
};

export function resolveWeights(
  profile: OptimizationProfileName | UtilityWeights | undefined,
): UtilityWeights {
  if (!profile) return PROFILE_WEIGHTS.balanced;
  if (typeof profile === 'string') return PROFILE_WEIGHTS[profile] ?? PROFILE_WEIGHTS.balanced;
  return profile;
}

// ── Task features ─────────────────────────────────────────────────────────────

export type TaskIntent = 'code' | 'reasoning' | 'research' | 'creative' | 'chat' | 'general';

export interface TaskFeatures {
  requiredModality: ModelKind; // 'image' when the turn carries an image, else 'text'
  hasImage: boolean;
  intent: TaskIntent;
  estInputTokens: number;
  estOutputTokens: number;
  toolIntensive: boolean;
  /** Confidential/sensitive turn — triggers origin-tier routing (private>…). */
  sensitive: boolean;
}

/** Which strength dims matter for each intent (weights sum ≈ 1 within an intent). */
const INTENT_STRENGTH_WEIGHTS: Record<TaskIntent, Partial<Record<ModelStrengthKey, number>>> = {
  code: { coding: 0.5, toolUse: 0.2, agentic: 0.2, reasoning: 0.1 },
  reasoning: { reasoning: 0.5, math: 0.3, longContext: 0.1, instructionFollowing: 0.1 },
  research: { longContext: 0.4, reasoning: 0.3, multilingual: 0.15, instructionFollowing: 0.15 },
  creative: { creative: 0.6, instructionFollowing: 0.2, multilingual: 0.2 },
  chat: { instructionFollowing: 0.4, multilingual: 0.3, creative: 0.3 },
  general: { reasoning: 0.3, instructionFollowing: 0.3, coding: 0.2, longContext: 0.2 },
};

const NEUTRAL_STRENGTH = 0.5;
const NEUTRAL_RELIABILITY = 0.7;
/** Utility bonus added to the currently-active model to damp mid-session switching. */
export const DEFAULT_STICKINESS = 0.08;

const CODE_RE = /```|\b(function|class|import|export|const|def|null|undefined|async|await|regex|stack ?trace|traceback|compile|refactor|debug|bug|npm|pnpm|yarn|git|typescript|python|java|rust|golang)\b|代码|函数|报错|调试|编译|重构|堆栈/i;
const PATH_RE = /(?:\.\/|\/)[\w./-]+\.\w{1,5}\b|\b\w+\.(ts|tsx|js|jsx|py|go|rs|java|cpp|c|json|yaml|yml|sql)\b/i;
const RESEARCH_RE = /\b(search|research|latest|compare|investigate|sources?|cite|news)\b|搜索|调研|查一下|最新|对比|资料|新闻/i;
const CREATIVE_RE = /\b(poem|story|essay|lyrics|brainstorm|slogan|creative)\b|写(一首|一篇|个|段)?(诗|故事|文案|小说|散文)|头脑风暴|创意/i;
const REASONING_RE = /\b(prove|derive|solve|reason|analy[sz]e|step[- ]by[- ]step|why|explain|calculate)\b|证明|推导|求解|推理|分析|为什么|计算|逐步/i;
const TOOL_RE = /\b(run|execute|browse|fetch|deploy|repository|repo|terminal|shell|api|database|crawl)\b|执行|部署|仓库|终端|抓取|数据库/i;
const SENSITIVE_RE = /机密|保密|涉密|绝密|秘密|内部(资料|文件|使用|文档)?|不(得|要)?外传|仅(限)?内部|商业机密|敏感(信息|数据)|隐私|\b(confidential|secret|classified|proprietary|sensitive|nda|internal[- ]only|do not share)\b/i;

// ── Origin (data-residency) tiers for sensitive-task routing ───────────────────

export type ModelOrigin = 'private' | 'domestic' | 'overseas';

/** Preference order by UI language: zh → private>domestic>overseas; else private>overseas>domestic. */
export function originOrder(language?: string): ModelOrigin[] {
  const zh = (language ?? '').toLowerCase().startsWith('zh');
  return zh ? ['private', 'domestic', 'overseas'] : ['private', 'overseas', 'domestic'];
}

function candidateOrigin(c: ModelCandidate): ModelOrigin | undefined {
  return c.meta?.origin;
}

/** True if any candidate has the given origin. */
export function hasOrigin(candidates: ModelCandidate[], origin: ModelOrigin): boolean {
  return candidates.some((c) => candidateOrigin(c) === origin);
}

/** The highest-priority origin tier (by order) that has ≥1 candidate; 'unknown' if only
 *  origin-less candidates remain; null if the set is empty. */
export function topAvailableOriginTier(
  candidates: ModelCandidate[],
  order: ModelOrigin[],
): ModelOrigin | 'unknown' | null {
  for (const tier of order) {
    if (candidates.some((c) => candidateOrigin(c) === tier)) return tier;
  }
  if (candidates.some((c) => !candidateOrigin(c))) return 'unknown';
  return candidates.length > 0 ? 'unknown' : null;
}

/** Restrict to the highest-priority origin tier that has candidates (hard tiering).
 *  Origin-less candidates rank after all known tiers. */
export function restrictToTopOriginTier(candidates: ModelCandidate[], order: ModelOrigin[]): ModelCandidate[] {
  for (const tier of order) {
    const inTier = candidates.filter((c) => candidateOrigin(c) === tier);
    if (inTier.length > 0) return inTier;
  }
  const unknown = candidates.filter((c) => !candidateOrigin(c));
  return unknown.length > 0 ? unknown : candidates;
}

/**
 * Derive a task feature vector from the current turn. Cheap, deterministic, and
 * history-free — matches what the gateway `before_model_resolve` hook can see
 * (current prompt + attachment metadata only).
 */
export function deriveTaskFeatures(
  prompt: string,
  opts?: { hasImage?: boolean; contextTokens?: number; sensitiveMode?: boolean },
): TaskFeatures {
  const text = prompt ?? '';
  const hasImage = opts?.hasImage ?? false;
  const chars = text.length;
  const estInputTokens = Math.ceil(chars / 4) + (opts?.contextTokens ?? 0);

  let intent: TaskIntent;
  if (CODE_RE.test(text) || PATH_RE.test(text)) intent = 'code';
  else if (RESEARCH_RE.test(text)) intent = 'research';
  else if (CREATIVE_RE.test(text)) intent = 'creative';
  else if (REASONING_RE.test(text)) intent = 'reasoning';
  else if (chars < 160) intent = 'chat';
  else intent = 'general';

  const toolIntensive = intent === 'code' || TOOL_RE.test(text);
  const sensitive = (opts?.sensitiveMode ?? false) || SENSITIVE_RE.test(text);

  // Output-size heuristic: code/creative tend to be longer; short chat is short.
  let estOutputTokens = 800;
  if (intent === 'code' || intent === 'creative') estOutputTokens = 1500;
  else if (intent === 'chat') estOutputTokens = 400;

  return {
    requiredModality: hasImage ? 'image' : 'text',
    hasImage,
    intent,
    estInputTokens,
    estOutputTokens,
    toolIntensive,
    sensitive,
  };
}

// ── Candidates & scoring ────────────────────────────────────────────────────

export interface ModelCandidate {
  /** `runtimeProviderKey/modelId` */
  modelRef: string;
  modelId: string;
  meta?: ModelMeta;
  /** Fallback capability when meta.inputModalities is absent. */
  modelType?: ModelKind[];
  /** Client-side telemetry success rate (0..1), optional calibration signal. */
  reliabilitySuccessRate?: number;
}

export interface ScoreFactor {
  factor: 'quality' | 'cost' | 'latency' | 'reliability' | 'stickiness';
  /** Signed contribution to the utility total. */
  contribution: number;
  /** Raw normalized sub-score (0..1) before weighting. */
  raw: number;
}

export interface SelectionResult {
  modelRef: string;
  score: number;
  /** Sorted by absolute contribution, for explainability / auditing. */
  factors: ScoreFactor[];
  intent: TaskIntent;
  /** Number of candidates that passed the hard-constraint filter. */
  consideredCount: number;
}

function modelInputModalities(c: ModelCandidate): ModelKind[] {
  if (c.meta?.inputModalities && c.meta.inputModalities.length > 0) return c.meta.inputModalities;
  if (c.modelType && c.modelType.length > 0) return c.modelType;
  return ['text'];
}

/** Hard-constraint filter: modality, context window, tool reliability, status. */
export function filterCandidates(candidates: ModelCandidate[], features: TaskFeatures): ModelCandidate[] {
  const needTokens = features.estInputTokens + features.estOutputTokens;
  return candidates.filter((c) => {
    if (c.meta?.status === 'deprecated') return false;
    if (features.requiredModality === 'image' && !modelInputModalities(c).includes('image')) return false;
    if (c.meta?.contextWindow != null && c.meta.contextWindow < needTokens) return false;
    // Only exclude on tool reliability when the metric is known and clearly low.
    if (features.toolIntensive && c.meta?.toolUseReliability != null && c.meta.toolUseReliability < 0.4) {
      return false;
    }
    return true;
  });
}

function qualityScore(meta: ModelMeta | undefined, features: TaskFeatures): number {
  const weights: Partial<Record<ModelStrengthKey, number>> = { ...INTENT_STRENGTH_WEIGHTS[features.intent] };
  if (features.hasImage) weights.vision = (weights.vision ?? 0) + 0.5; // favor stronger vision models
  const strengths = meta?.strengths;
  let weighted = 0;
  let totalWeight = 0;
  for (const [key, w] of Object.entries(weights) as [ModelStrengthKey, number][]) {
    const s = strengths?.[key];
    weighted += w * (s ?? NEUTRAL_STRENGTH);
    totalWeight += w;
  }
  const strengthScore = totalWeight > 0 ? weighted / totalWeight : NEUTRAL_STRENGTH;
  const qi = meta?.benchmarks?.qualityIndex;
  if (typeof qi === 'number') {
    const anchored = Math.max(0, Math.min(1, qi / 100));
    return 0.85 * strengthScore + 0.15 * anchored;
  }
  return strengthScore;
}

function estCostUsd(meta: ModelMeta | undefined, features: TaskFeatures): number | undefined {
  const p = meta?.pricing;
  if (!p || (p.inputPerM == null && p.outputPerM == null)) return undefined;
  const inCost = ((p.inputPerM ?? 0) * features.estInputTokens) / 1_000_000;
  const outCost = ((p.outputPerM ?? 0) * features.estOutputTokens) / 1_000_000;
  return inCost + outCost;
}

function estLatencyMs(meta: ModelMeta | undefined, features: TaskFeatures): number | undefined {
  const sp = meta?.speed;
  if (!sp || (sp.ttftMs == null && sp.throughputTokPerSec == null)) return undefined;
  const ttft = sp.ttftMs ?? 500;
  const gen = sp.throughputTokPerSec ? (features.estOutputTokens / sp.throughputTokPerSec) * 1000 : 0;
  return ttft + gen;
}

/** Min-max normalize to 0..1; equal values → all 0 (no differentiation). */
function normalize(values: Array<number | undefined>): number[] {
  const known = values.filter((v): v is number => v != null);
  if (known.length === 0) return values.map(() => 0.5); // all unknown → neutral
  const min = Math.min(...known);
  const max = Math.max(...known);
  const span = max - min;
  return values.map((v) => {
    if (v == null) return 0.5; // unknown → neutral (neither cheapest nor most expensive)
    if (span === 0) return 0;
    return (v - min) / span;
  });
}

export interface SelectOptions {
  /** The model the session is currently using — gets a stickiness bonus. */
  currentRef?: string;
  stickiness?: number;
  /** UI language ('zh'/'en'/…) — drives origin-tier order for sensitive turns. */
  language?: string;
}

/**
 * Choose the best model for the task. Returns null when no candidate passes the
 * hard constraints (caller then falls back to the configured slot default).
 */
export function selectBestModel(
  candidates: ModelCandidate[],
  features: TaskFeatures,
  profile: OptimizationProfileName | UtilityWeights | undefined,
  opts?: SelectOptions,
): SelectionResult | null {
  let eligible = filterCandidates(candidates, features);
  if (eligible.length === 0) return null;

  // Sensitive turns: hard origin tiering — keep only the highest-priority origin
  // tier (by UI language) that has an eligible candidate, then score within it.
  if (features.sensitive) {
    eligible = restrictToTopOriginTier(eligible, originOrder(opts?.language));
    if (eligible.length === 0) return null;
  }

  const w = resolveWeights(profile);
  const stickiness = opts?.stickiness ?? DEFAULT_STICKINESS;

  const costNorm = normalize(eligible.map((c) => estCostUsd(c.meta, features)));
  const latNorm = normalize(eligible.map((c) => estLatencyMs(c.meta, features)));

  let best: SelectionResult | null = null;
  eligible.forEach((c, i) => {
    const q = qualityScore(c.meta, features);
    const cost = costNorm[i];
    const lat = latNorm[i];
    const rel = c.reliabilitySuccessRate ?? NEUTRAL_RELIABILITY;
    const stick = opts?.currentRef && c.modelRef === opts.currentRef ? stickiness : 0;

    const factors: ScoreFactor[] = [
      { factor: 'quality', contribution: w.wq * q, raw: q },
      { factor: 'cost', contribution: -w.wc * cost, raw: cost },
      { factor: 'latency', contribution: -w.wl * lat, raw: lat },
      { factor: 'reliability', contribution: w.wr * rel, raw: rel },
    ];
    if (stick) factors.push({ factor: 'stickiness', contribution: stick, raw: 1 });

    const score = factors.reduce((sum, f) => sum + f.contribution, 0);
    if (!best || score > best.score) {
      best = {
        modelRef: c.modelRef,
        score,
        factors: [...factors].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)),
        intent: features.intent,
        consideredCount: eligible.length,
      };
    }
  });

  return best;
}
