import { describe, it, expect } from 'vitest';
import type { ModelCandidate } from '@electron/shared/model-routing/select-model';
import {
  deriveTaskFeatures,
  selectBestModel,
  filterCandidates,
  PROFILE_WEIGHTS,
  originOrder,
  restrictToTopOriginTier,
  topAvailableOriginTier,
  hasOrigin,
} from '@electron/shared/model-routing/select-model';

// Seed candidates roughly mirroring the bundled providers.json examples.
const CODER: ModelCandidate = {
  modelRef: 'qwen3coders/Qwen3-Coder-Next-FP8',
  modelId: 'Qwen3-Coder-Next-FP8',
  meta: {
    pricing: { inputPerM: 0.2, outputPerM: 0.8 },
    contextWindow: 262144,
    inputModalities: ['text'],
    speed: { throughputTokPerSec: 120, ttftMs: 400 },
    strengths: { coding: 0.92, reasoning: 0.7, toolUse: 0.88, agentic: 0.86, longContext: 0.85 },
    toolUseReliability: 0.88,
    status: 'active',
  },
};
const REASONER: ModelCandidate = {
  modelRef: 'glm52s/GLM52',
  modelId: 'GLM52',
  meta: {
    pricing: { inputPerM: 0.6, outputPerM: 2.2 },
    contextWindow: 200000,
    inputModalities: ['text'],
    speed: { throughputTokPerSec: 70, ttftMs: 600 },
    strengths: { coding: 0.85, reasoning: 0.88, math: 0.8, agentic: 0.85, longContext: 0.8 },
    toolUseReliability: 0.85,
    status: 'active',
  },
};
const VISION: ModelCandidate = {
  modelRef: 'qwen3vls/Qwen3-VL-30B-A3B-Thinking-FP8',
  modelId: 'Qwen3-VL-30B-A3B-Thinking-FP8',
  meta: {
    pricing: { inputPerM: 0.35, outputPerM: 1.2 },
    contextWindow: 131072,
    inputModalities: ['text', 'image'],
    speed: { throughputTokPerSec: 60, ttftMs: 700 },
    strengths: { vision: 0.9, reasoning: 0.72, coding: 0.55 },
    toolUseReliability: 0.6,
    status: 'active',
  },
};
const CHEAP_FAST: ModelCandidate = {
  modelRef: 'minimaxm3/minimax-m3',
  modelId: 'minimax-m3',
  meta: {
    pricing: { inputPerM: 0.15, outputPerM: 0.6 },
    contextWindow: 245760,
    inputModalities: ['text', 'image'],
    speed: { throughputTokPerSec: 140, ttftMs: 350 },
    strengths: { reasoning: 0.72, instructionFollowing: 0.8, coding: 0.68 },
    toolUseReliability: 0.72,
    status: 'active',
  },
};
const ALL = [CODER, REASONER, VISION, CHEAP_FAST];

describe('deriveTaskFeatures', () => {
  it('detects code intent from a code fence / keywords', () => {
    const f = deriveTaskFeatures('修复这个 function 里的 bug，报错 stack trace 如下 ```ts\nconst x=1```');
    expect(f.intent).toBe('code');
    expect(f.toolIntensive).toBe(true);
    expect(f.requiredModality).toBe('text');
  });

  it('marks image turns as requiring the image modality', () => {
    const f = deriveTaskFeatures('这张图里有什么？', { hasImage: true });
    expect(f.hasImage).toBe(true);
    expect(f.requiredModality).toBe('image');
  });

  it('treats short prompts as chat', () => {
    expect(deriveTaskFeatures('你好').intent).toBe('chat');
  });

  it('detects research intent', () => {
    expect(deriveTaskFeatures('帮我搜索一下最新的相关资料并对比').intent).toBe('research');
  });
});

describe('filterCandidates (hard constraints)', () => {
  it('excludes non-vision models for image turns', () => {
    const f = deriveTaskFeatures('描述这张图', { hasImage: true });
    const kept = filterCandidates(ALL, f).map((c) => c.modelId);
    expect(kept).toContain('Qwen3-VL-30B-A3B-Thinking-FP8');
    expect(kept).toContain('minimax-m3');
    expect(kept).not.toContain('Qwen3-Coder-Next-FP8');
    expect(kept).not.toContain('GLM52');
  });

  it('excludes models whose context window is too small', () => {
    const f = deriveTaskFeatures('x'.repeat(40), { contextTokens: 400000 });
    expect(filterCandidates(ALL, f)).toHaveLength(0);
  });

  it('excludes deprecated models', () => {
    const dep: ModelCandidate = { ...CHEAP_FAST, modelRef: 'x/dep', meta: { ...CHEAP_FAST.meta!, status: 'deprecated' } };
    const f = deriveTaskFeatures('hello there general');
    expect(filterCandidates([dep], f)).toHaveLength(0);
  });
});

describe('selectBestModel (utility argmax)', () => {
  it('picks the coding specialist for a code task under balanced profile', () => {
    const f = deriveTaskFeatures('重构这个模块的 function，修复 bug');
    const r = selectBestModel(ALL, f, 'balanced');
    expect(r?.modelRef).toBe(CODER.modelRef);
    expect(r?.intent).toBe('code');
    expect(r?.factors[0]).toBeDefined();
  });

  it('only ever picks a vision-capable model for an image task', () => {
    const f = deriveTaskFeatures('这张图里的表格是什么内容', { hasImage: true });
    const r = selectBestModel(ALL, f, 'balanced');
    expect([VISION.modelRef, CHEAP_FAST.modelRef]).toContain(r?.modelRef);
  });

  it('prefers the stronger-vision model when other factors are equal', () => {
    const weakVision: ModelCandidate = {
      modelRef: 'x/weak-vision',
      modelId: 'weak-vision',
      meta: { ...VISION.meta!, strengths: { ...VISION.meta!.strengths, vision: 0.4 } },
    };
    const strongVision: ModelCandidate = {
      modelRef: 'x/strong-vision',
      modelId: 'strong-vision',
      meta: { ...VISION.meta!, strengths: { ...VISION.meta!.strengths, vision: 0.95 } },
    };
    const f = deriveTaskFeatures('分析这张图', { hasImage: true });
    const r = selectBestModel([weakVision, strongVision], f, 'quality');
    expect(r?.modelRef).toBe(strongVision.modelRef);
  });

  it('cost profile shifts selection toward cheaper models for a generic task', () => {
    const f = deriveTaskFeatures('给我讲讲这件事的大致背景和影响，简单说明即可');
    const cheap = selectBestModel(ALL, f, 'cost');
    const quality = selectBestModel(ALL, f, 'quality');
    // Cost profile should not pick a strictly more expensive model than quality profile.
    expect(cheap?.modelRef).toBeDefined();
    expect(quality?.modelRef).toBeDefined();
    // The cheapest general-capable candidate is minimax-m3; cost profile favors it.
    expect(cheap?.modelRef).toBe(CHEAP_FAST.modelRef);
  });

  it('returns null when no candidate passes hard constraints', () => {
    const f = deriveTaskFeatures('描述这张图', { hasImage: true });
    expect(selectBestModel([CODER, REASONER], f, 'balanced')).toBeNull();
  });

  it('stickiness keeps the current model unless a challenger clearly wins', () => {
    const f = deriveTaskFeatures('简单聊聊今天的安排');
    // Without stickiness, some model wins outright.
    const base = selectBestModel(ALL, f, 'balanced');
    expect(base).not.toBeNull();
    // Pin current to a non-winning but eligible model with a big stickiness bonus.
    const other = ALL.find((c) => c.modelRef !== base!.modelRef)!;
    const sticky = selectBestModel(ALL, f, 'balanced', { currentRef: other.modelRef, stickiness: 5 });
    expect(sticky?.modelRef).toBe(other.modelRef);
  });
});

describe('PROFILE_WEIGHTS', () => {
  it('cost profile weighs cost more than quality profile', () => {
    expect(PROFILE_WEIGHTS.cost.wc).toBeGreaterThan(PROFILE_WEIGHTS.quality.wc);
    expect(PROFILE_WEIGHTS.latency.wl).toBeGreaterThan(PROFILE_WEIGHTS.balanced.wl);
  });
});

// ── Sensitive-task origin tiering ──────────────────────────────────────────────
const mk = (ref: string, origin: 'private' | 'domestic' | 'overseas' | undefined, reasoning: number): ModelCandidate => ({
  modelRef: ref,
  modelId: ref.split('/')[1],
  meta: {
    ...(origin ? { origin } : {}),
    contextWindow: 200000,
    inputModalities: ['text'],
    strengths: { reasoning, math: reasoning, longContext: reasoning, instructionFollowing: reasoning },
    pricing: { inputPerM: 1, outputPerM: 4 },
  },
});
const PRIV = mk('p/priv', 'private', 0.6);   // private but weakest
const DOM = mk('d/dom', 'domestic', 0.8);
const OVS = mk('o/ovs', 'overseas', 0.95);   // strongest overall

describe('deriveTaskFeatures sensitivity', () => {
  it('flags keyword-sensitive prompts', () => {
    expect(deriveTaskFeatures('请分析这份商业机密材料的要点').sensitive).toBe(true);
    expect(deriveTaskFeatures('summarize this confidential NDA doc').sensitive).toBe(true);
  });
  it('honors the explicit sensitiveMode toggle', () => {
    expect(deriveTaskFeatures('普通问题', { sensitiveMode: true }).sensitive).toBe(true);
  });
  it('non-sensitive by default', () => {
    expect(deriveTaskFeatures('帮我总结一下今天的安排').sensitive).toBe(false);
  });
});

describe('originOrder', () => {
  it('zh → private>domestic>overseas', () => {
    expect(originOrder('zh')).toEqual(['private', 'domestic', 'overseas']);
    expect(originOrder('zh-CN')).toEqual(['private', 'domestic', 'overseas']);
  });
  it('non-zh → private>overseas>domestic', () => {
    expect(originOrder('en')).toEqual(['private', 'overseas', 'domestic']);
    expect(originOrder('ja')).toEqual(['private', 'overseas', 'domestic']);
    expect(originOrder(undefined)).toEqual(['private', 'overseas', 'domestic']);
  });
});

describe('selectBestModel origin tiering (sensitive)', () => {
  const sensitive = deriveTaskFeatures('请分析这份商业机密材料'); // sensitive + reasoning

  it('non-sensitive ignores origin (strongest wins)', () => {
    const nonSensitive = deriveTaskFeatures('帮我分析这个问题的思路'); // reasoning, not sensitive
    const r = selectBestModel([PRIV, DOM, OVS], nonSensitive, 'quality', { language: 'zh' });
    expect(r?.modelRef).toBe(OVS.modelRef);
  });

  it('zh sensitive → private wins even though overseas is stronger', () => {
    const r = selectBestModel([PRIV, DOM, OVS], sensitive, 'quality', { language: 'zh' });
    expect(r?.modelRef).toBe(PRIV.modelRef);
  });

  it('zh sensitive, no private → domestic (next tier)', () => {
    const r = selectBestModel([DOM, OVS], sensitive, 'quality', { language: 'zh' });
    expect(r?.modelRef).toBe(DOM.modelRef);
  });

  it('en sensitive, no private → overseas (before domestic)', () => {
    const r = selectBestModel([DOM, OVS], sensitive, 'quality', { language: 'en' });
    expect(r?.modelRef).toBe(OVS.modelRef);
  });

  it('unknown-origin candidates rank after known tiers', () => {
    const UNK = mk('u/unk', undefined, 0.99);
    const order = originOrder('zh');
    expect(restrictToTopOriginTier([UNK, DOM], order).map((c) => c.modelId)).toEqual(['dom']);
    expect(restrictToTopOriginTier([UNK], order).map((c) => c.modelId)).toEqual(['unk']);
  });
});

describe('origin helpers', () => {
  it('topAvailableOriginTier picks the highest present tier', () => {
    expect(topAvailableOriginTier([DOM, OVS], originOrder('zh'))).toBe('domestic');
    expect(topAvailableOriginTier([PRIV, OVS], originOrder('zh'))).toBe('private');
    expect(topAvailableOriginTier([], originOrder('zh'))).toBeNull();
  });
  it('hasOrigin detects presence', () => {
    expect(hasOrigin([DOM, OVS], 'private')).toBe(false);
    expect(hasOrigin([PRIV, OVS], 'private')).toBe(true);
  });
});
