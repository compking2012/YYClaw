// One-off: fill providers.json[].models with seed ModelMeta.
// Seed/placeholder data (provenance=bundled-seed, confidence 0.3), USD everywhere
// for cost comparability. Real values come from the server catalog at runtime.
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = new URL('../resources/config/providers.json', import.meta.url);
const CUTOFF = '2026-03';
const prov = () => ({ seed: { source: 'bundled-seed', updatedAt: '2026-07-05', confidence: 0.3 } });

// text/vision model meta
function T(o) {
  const s = o.S;
  return {
    pricing: { inputPerM: o.in, outputPerM: o.out, currency: 'USD' },
    contextWindow: o.ctx,
    maxOutputTokens: o.maxOut ?? 32768,
    inputModalities: o.vision ? ['text', 'image'] : ['text'],
    outputModalities: ['text'],
    speed: { throughputTokPerSec: o.tput, ttftMs: o.ttft },
    strengths: s,
    toolUseReliability: s.toolUse,
    reasoningSupport: o.reason ?? true,
    knowledgeCutoff: o.cutoff ?? CUTOFF,
    benchmarks: { qualityIndex: o.qi },
    provenance: prov(),
    status: 'active',
  };
}
// generation / voice model meta (token pricing + text strengths N/A)
function G(inMods, outMods) {
  return { inputModalities: inMods, outputModalities: outMods, provenance: prov(), status: 'active' };
}

// strength profiles (0..1): coding math reasoning longContext vision multilingual creative toolUse agentic instructionFollowing
const S = {
  opus:   { coding: .90, math: .88, reasoning: .95, longContext: .90, vision: .85, multilingual: .88, creative: .85, toolUse: .92, agentic: .93, instructionFollowing: .92 },
  sonnet: { coding: .88, math: .80, reasoning: .85, longContext: .85, vision: .82, multilingual: .85, creative: .80, toolUse: .90, agentic: .88, instructionFollowing: .90 },
  haiku:  { coding: .72, math: .68, reasoning: .70, longContext: .75, vision: .70, multilingual: .78, creative: .68, toolUse: .80, agentic: .75, instructionFollowing: .82 },
  gpt55:  { coding: .90, math: .90, reasoning: .92, longContext: .88, vision: .86, multilingual: .90, creative: .88, toolUse: .93, agentic: .90, instructionFollowing: .93 },
  gpt54:  { coding: .85, math: .84, reasoning: .86, longContext: .82, vision: .82, multilingual: .87, creative: .84, toolUse: .88, agentic: .85, instructionFollowing: .90 },
  gpt54m: { coding: .72, math: .72, reasoning: .72, longContext: .78, vision: .74, multilingual: .80, creative: .70, toolUse: .80, agentic: .74, instructionFollowing: .84 },
  gempro: { coding: .86, math: .88, reasoning: .90, longContext: .95, vision: .90, multilingual: .90, creative: .82, toolUse: .85, agentic: .84, instructionFollowing: .88 },
  gemfl:  { coding: .74, math: .76, reasoning: .76, longContext: .90, vision: .82, multilingual: .85, creative: .72, toolUse: .78, agentic: .74, instructionFollowing: .84 },
  dsPro:  { coding: .88, math: .90, reasoning: .90, longContext: .82, vision: .40, multilingual: .80, creative: .74, toolUse: .84, agentic: .84, instructionFollowing: .85 },
  dsFlash:{ coding: .78, math: .80, reasoning: .78, longContext: .80, vision: .40, multilingual: .76, creative: .68, toolUse: .78, agentic: .76, instructionFollowing: .82 },
  glm52:  { coding: .85, math: .80, reasoning: .88, longContext: .80, vision: .40, multilingual: .90, creative: .70, toolUse: .82, agentic: .85, instructionFollowing: .85 },
  glm51:  { coding: .80, math: .75, reasoning: .82, longContext: .78, vision: .40, multilingual: .88, creative: .68, toolUse: .78, agentic: .80, instructionFollowing: .82 },
  qwenMax:{ coding: .86, math: .84, reasoning: .85, longContext: .85, vision: .40, multilingual: .88, creative: .76, toolUse: .85, agentic: .84, instructionFollowing: .86 },
  qwenPlus:{coding: .80, math: .78, reasoning: .78, longContext: .82, vision: .40, multilingual: .86, creative: .72, toolUse: .80, agentic: .78, instructionFollowing: .84 },
  qwen36: { coding: .78, math: .78, reasoning: .78, longContext: .80, vision: .40, multilingual: .85, creative: .72, toolUse: .80, agentic: .76, instructionFollowing: .82 },
  qwen36p:{ coding: .82, math: .80, reasoning: .80, longContext: .82, vision: .78, multilingual: .86, creative: .74, toolUse: .82, agentic: .80, instructionFollowing: .84 },
  coder:  { coding: .92, math: .72, reasoning: .70, longContext: .85, vision: .40, multilingual: .70, creative: .50, toolUse: .88, agentic: .86, instructionFollowing: .80 },
  qvl:    { coding: .55, math: .62, reasoning: .72, longContext: .70, vision: .90, multilingual: .75, creative: .60, toolUse: .60, agentic: .58, instructionFollowing: .75 },
  m3:     { coding: .68, math: .66, reasoning: .72, longContext: .82, vision: .72, multilingual: .85, creative: .75, toolUse: .70, agentic: .70, instructionFollowing: .80 },
  m25:    { coding: .64, math: .64, reasoning: .70, longContext: .80, vision: .40, multilingual: .84, creative: .72, toolUse: .68, agentic: .68, instructionFollowing: .78 },
  kimi27: { coding: .90, math: .78, reasoning: .80, longContext: .95, vision: .72, multilingual: .82, creative: .70, toolUse: .88, agentic: .86, instructionFollowing: .84 },
  kimi26: { coding: .82, math: .74, reasoning: .78, longContext: .92, vision: .70, multilingual: .82, creative: .72, toolUse: .84, agentic: .80, instructionFollowing: .84 },
  doubao: { coding: .74, math: .74, reasoning: .76, longContext: .80, vision: .78, multilingual: .84, creative: .72, toolUse: .78, agentic: .76, instructionFollowing: .82 },
};

const META = {
  // ── company private deployments ──
  glm52s:       { GLM52: T({ in: .6, out: 2.2, ctx: 200000, tput: 70, ttft: 600, S: S.glm52, qi: 82 }) },
  minimaxm25s:  { 'minimax-m2.5': T({ in: .2, out: .8, ctx: 245760, tput: 130, ttft: 380, S: S.m25, qi: 68 }) },
  qwen3coders:  { 'Qwen3-Coder-Next-FP8': T({ in: .2, out: .8, ctx: 262144, maxOut: 65536, tput: 120, ttft: 400, S: S.coder, qi: 74, reason: false }) },
  qwen3vls:     { 'Qwen3-VL-30B-A3B-Thinking-FP8': T({ in: .35, out: 1.2, ctx: 131072, vision: true, tput: 60, ttft: 700, S: S.qvl, qi: 70 }) },
  // ── national (CN) ──
  glm52:        { 'glm-5.2': T({ in: .6, out: 2.2, ctx: 200000, tput: 70, ttft: 600, S: S.glm52, qi: 82 }) },
  glm51:        { 'glm-5.1': T({ in: .4, out: 1.5, ctx: 200000, tput: 80, ttft: 550, S: S.glm51, qi: 76 }) },
  minimaxm3:    { 'minimax-m3': T({ in: .15, out: .6, ctx: 245760, vision: true, tput: 140, ttft: 350, S: S.m3, qi: 71 }) },
  kimik27code:  { 'kimi-k2.7-code': T({ in: .4, out: 1.6, ctx: 262144, maxOut: 65536, vision: true, tput: 70, ttft: 600, S: S.kimi27, qi: 78 }) },
  kimik26:      { 'kimi-k2.6': T({ in: .3, out: 1.2, ctx: 262144, vision: true, tput: 75, ttft: 580, S: S.kimi26, qi: 74 }) },
  qwen37max:    { 'qwen-3.7-max': T({ in: .8, out: 3.2, ctx: 262144, tput: 80, ttft: 550, S: S.qwenMax, qi: 82 }) },
  qwen37plus:   { 'qwen-3.7-plus': T({ in: .3, out: 1.2, ctx: 131072, tput: 120, ttft: 400, S: S.qwenPlus, qi: 74 }) },
  deepseekv4pro:{ 'deepseek-v4-pro': T({ in: .5, out: 2, ctx: 131072, maxOut: 65536, tput: 40, ttft: 900, S: S.dsPro, qi: 84 }) },
  deepseekv4flash:{ 'deepseek-v4-pro': T({ in: .15, out: .6, ctx: 131072, tput: 120, ttft: 400, S: S.dsFlash, qi: 72 }) },
  // ── overseas CD-* (Claude aliases: cd-o=Opus, cd-s=Sonnet, cd-h=Haiku) ──
  cdo48:        { 'cd-o-4-8': T({ in: 6, out: 30, ctx: 200000, maxOut: 64000, vision: true, tput: 60, ttft: 700, S: S.opus, qi: 92 }) },
  cdo47:        { 'cd-o-4-7': T({ in: 5.5, out: 27, ctx: 200000, maxOut: 64000, vision: true, tput: 60, ttft: 700, S: S.opus, qi: 90 }) },
  cdo46:        { 'cd-o-4-6': T({ in: 5, out: 25, ctx: 200000, maxOut: 64000, vision: true, tput: 62, ttft: 680, S: S.opus, qi: 88 }) },
  cds46:        { 'cd-s-4-6': T({ in: 3, out: 15, ctx: 200000, maxOut: 64000, vision: true, tput: 90, ttft: 500, S: S.sonnet, qi: 82 }) },
  cdh45:        { 'cd-h-4-5': T({ in: .8, out: 4, ctx: 200000, maxOut: 32000, vision: true, tput: 180, ttft: 300, S: S.haiku, qi: 68 }) },
  // ── overseas GPT ──
  gpt55:        { 'gpt-5.5': T({ in: 4, out: 20, ctx: 400000, maxOut: 128000, vision: true, tput: 70, ttft: 600, S: S.gpt55, qi: 90 }) },
  gpt54:        { 'gpt-5.4': T({ in: 2.5, out: 12, ctx: 272000, maxOut: 128000, vision: true, tput: 100, ttft: 450, S: S.gpt54, qi: 82 }) },
  gpt54mini:    { 'gpt-5.4-mini': T({ in: .3, out: 1.2, ctx: 272000, maxOut: 65536, vision: true, tput: 160, ttft: 300, S: S.gpt54m, qi: 68 }) },
  gptimage2:    { 'gpt-image-2': G(['text', 'image'], ['image_generate']) },
  'openai-voice': { 'gpt-4o-mini-tts': G(['text'], ['tts']), 'gpt-4o-transcribe': G(['tts'], ['text']), 'gpt-realtime-2': G(['text', 'tts'], ['text', 'tts']) },
  // ── overseas Gemini ──
  gemini35flash:      { 'gemini-3.5-flash': T({ in: .15, out: .6, ctx: 1000000, maxOut: 65536, vision: true, tput: 200, ttft: 250, S: S.gemfl, qi: 72 }) },
  gemini31propreview: { 'gemini-3.1-pro-preview': T({ in: 2, out: 12, ctx: 1000000, maxOut: 65536, vision: true, tput: 90, ttft: 600, S: S.gempro, qi: 88 }) },
  gemini31flashimage: { 'gemini-3.1-flash-image': G(['text', 'image'], ['image_generate']) },
  // ── official aggregators ──
  anthropic:    { 'claude-opus-4-7': T({ in: 5.5, out: 27, ctx: 200000, maxOut: 64000, vision: true, tput: 60, ttft: 700, S: S.opus, qi: 90 }) },
  openai: {
    'gpt-5.5': T({ in: 4, out: 20, ctx: 400000, maxOut: 128000, vision: true, tput: 70, ttft: 600, S: S.gpt55, qi: 90 }),
    'gpt-image-2': G(['text', 'image'], ['image_generate']),
    'gpt-4o-mini-tts': G(['text'], ['tts']),
    'gpt-4o-transcribe': G(['tts'], ['text']),
    'gpt-realtime-2': G(['text', 'tts'], ['text', 'tts']),
  },
  google: {
    'gemini-3.1-pro-preview': T({ in: 2, out: 12, ctx: 1000000, maxOut: 65536, vision: true, tput: 90, ttft: 600, S: S.gempro, qi: 88 }),
    'gemini-3.1-flash-image-preview': G(['text', 'image'], ['image_generate']),
    'lyria-3-pro-preview': G(['text'], ['music_generate']),
    'veo-3.1-generate-preview': G(['text', 'image'], ['video_generate']),
  },
  ark: {
    'doubao-seed-2-0-lite-260428': T({ in: .1, out: .4, ctx: 262144, vision: true, tput: 130, ttft: 350, S: S.doubao, qi: 70 }),
    'doubao-seedream-5-0-260128': G(['text', 'image'], ['image_generate']),
    'doubao-seedance-2-0-260128': G(['text', 'image'], ['video_generate']),
  },
  moonshot:        { 'kimi-k2.6': T({ in: .3, out: 1.2, ctx: 262144, vision: true, tput: 75, ttft: 580, S: S.kimi26, qi: 74 }) },
  'moonshot-global': { 'kimi-k2.6': T({ in: .3, out: 1.2, ctx: 262144, vision: true, tput: 75, ttft: 580, S: S.kimi26, qi: 74 }) },
  siliconflow: {
    'deepseek-ai/DeepSeek-V4-Flash': T({ in: .15, out: .6, ctx: 131072, tput: 120, ttft: 400, S: S.dsFlash, qi: 72 }),
    'Qwen/Qwen3.6-35B-A3B': T({ in: .2, out: .8, ctx: 131072, tput: 110, ttft: 420, S: S.qwen36, qi: 70 }),
    'Qwen/Qwen-Image': G(['text', 'image'], ['image_generate']),
    'Wan-AI/Wan2.2-I2V-A14B': G(['text', 'image'], ['video_generate']),
  },
  deepseek:        { 'deepseek-v4-pro': T({ in: .5, out: 2, ctx: 131072, maxOut: 65536, tput: 40, ttft: 900, S: S.dsPro, qi: 84 }) },
  'minimax-portal': { 'MiniMax-M3': T({ in: .15, out: .6, ctx: 245760, tput: 140, ttft: 350, S: S.m3, qi: 71 }) },
  'minimax-portal-cn': {
    'MiniMax-M3': T({ in: .15, out: .6, ctx: 245760, tput: 140, ttft: 350, S: S.m3, qi: 71 }),
    'image-01': G(['text', 'image'], ['image_generate']),
    'music-2.6': G(['text'], ['music_generate']),
    'MiniMax-Hailuo-2.3': G(['text', 'image'], ['video_generate']),
    'speech-2.8-hd': G(['text'], ['tts']),
  },
  modelstudio: {
    'qwen3.6-plus': T({ in: .3, out: 1.2, ctx: 131072, vision: true, tput: 120, ttft: 400, S: S.qwen36p, qi: 74 }),
    'wan2.7-image-pro': G(['text', 'image'], ['image_generate']),
    'fun-music-v1': G(['text'], ['music_generate']),
    'happyhorse-1.0-t2v': G(['text'], ['video_generate']),
  },
};

// Data-residency origin per provider id (private self-hosted > domestic-CN > overseas).
const ORIGIN = {
  // private (公司私有化部署)
  glm52s: 'private', minimaxm25s: 'private', qwen3coders: 'private', qwen3vls: 'private',
  // domestic (国内 + 官方国产厂商)
  glm52: 'domestic', glm51: 'domestic', minimaxm3: 'domestic', kimik27code: 'domestic', kimik26: 'domestic',
  qwen37max: 'domestic', qwen37plus: 'domestic', deepseekv4pro: 'domestic', deepseekv4flash: 'domestic',
  deepseek: 'domestic', moonshot: 'domestic', 'minimax-portal-cn': 'domestic', modelstudio: 'domestic',
  siliconflow: 'domestic', ark: 'domestic',
  // overseas (海外 + 国际官方 + 出海/全球端点)
  cdo48: 'overseas', cdo47: 'overseas', cdo46: 'overseas', cds46: 'overseas', cdh45: 'overseas',
  gpt55: 'overseas', gpt54: 'overseas', gpt54mini: 'overseas', gptimage2: 'overseas', 'openai-voice': 'overseas',
  gemini35flash: 'overseas', gemini31propreview: 'overseas', gemini31flashimage: 'overseas',
  anthropic: 'overseas', openai: 'overseas', google: 'overseas',
  'minimax-portal': 'overseas', 'moonshot-global': 'overseas',
};

const json = JSON.parse(readFileSync(FILE, 'utf8'));
const filled = [];
const skipped = [];
for (const p of json) {
  if (META[p.id]) {
    const origin = ORIGIN[p.id];
    for (const meta of Object.values(META[p.id])) {
      if (origin) meta.origin = origin;
    }
    p.models = META[p.id];
    filled.push(p.id);
  } else {
    delete p.models;
    skipped.push(p.id);
  }
}
writeFileSync(FILE, JSON.stringify(json, null, 2) + '\n', 'utf8');
console.log('filled', filled.length, ':', filled.join(', '));
console.log('skipped', skipped.length, ':', skipped.join(', '));
