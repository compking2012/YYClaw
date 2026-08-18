/**
 * Agent-layer intent classifier (Track B).
 *
 * Runs in the renderer where the full user input + recent history is available,
 * BEFORE a turn is sent to the gateway. It produces an {@link OptimizationProfile}
 * describing which tool groups a turn actually needs, so the gateway-side
 * fetch-preload interceptor can prune irrelevant tool schemas from the outbound
 * LLM request (the biggest non-cached, always-resent chunk).
 *
 * Design rules (per Track B decisions):
 * - Rules-first: pure keyword/regex matching, zero token cost, zero latency,
 *   fully explainable. A model-based classifier can be layered in later behind
 *   the same interface.
 * - Bilingual: the user base is mixed CN/EN, so keywords cover both.
 * - Safe by default: anything ambiguous returns `intent: "unknown"` with low
 *   confidence, which downstream enforcement treats as "do not prune".
 *
 * This module decides INTENT and abstract tool GROUPS only. Mapping groups to
 * concrete provider tool ids (and the actual pruning + savings measurement)
 * happens at the enforcement layer against the real outbound tools array.
 */

export type Intent =
  | 'quick_qa'
  | 'web_research'
  | 'coding'
  | 'file_docs'
  | 'image_media'
  | 'unknown';

/** How much conversation history the turn likely needs. */
export type HistoryMode = 'full' | 'recent';

/** Abstract tool-group keys the enforcement layer maps to concrete tool ids. */
export type ToolGroup = 'search' | 'browser' | 'fs' | 'exec' | 'office' | 'media';

export interface OptimizationProfile {
  intent: Intent;
  /** Tool groups to KEEP (beyond always-kept core tools). */
  keepGroups: ToolGroup[];
  historyMode: HistoryMode;
  /** 0..1. Below {@link PRUNE_CONFIDENCE_THRESHOLD} enforcement keeps all tools. */
  confidence: number;
}

export interface ClassifyInput {
  text: string;
  recentMessages?: Array<{ role: string; content: string }>;
  targetAgentId?: string | null;
}

/** Enforcement must NOT prune when confidence is below this. Exported for reuse. */
export const PRUNE_CONFIDENCE_THRESHOLD = 0.6;

/** Profile that disables pruning (the safe fallback). */
const KEEP_ALL: OptimizationProfile = {
  intent: 'unknown',
  keepGroups: ['search', 'browser', 'fs', 'exec', 'office', 'media'],
  historyMode: 'full',
  confidence: 0,
};

interface IntentRule {
  intent: Intent;
  keepGroups: ToolGroup[];
  historyMode: HistoryMode;
  /** Matched case-insensitively against the user text. */
  patterns: RegExp;
}

// Order matters: the first rule that matches wins. More specific/expensive
// intents (coding, docs, media, research) are checked before the catch-alls.
const INTENT_RULES: IntentRule[] = [
  {
    intent: 'coding',
    keepGroups: ['fs', 'exec'],
    historyMode: 'full',
    patterns:
      /\b(code|coding|function|class|refactor|implement|compile|debug|stack\s?trace|exception|typescript|javascript|python|golang|rust|regex|api|sql|git|terminal|shell|bash|npm|build|test case|unit test)\b|写代码|代码|函数|重构|实现|编译|报错|调试|堆栈|异常|脚本|终端|命令行|跑测试|单元测试/i,
  },
  {
    intent: 'file_docs',
    keepGroups: ['fs', 'office'],
    historyMode: 'full',
    patterns:
      /\b(pdf|excel|spreadsheet|xlsx|csv|word|docx|powerpoint|pptx|slide|invoice|contract|resume)\b|表格|文档|电子表格|发票|合同|简历|幻灯片|演示文稿|附件|文件/i,
  },
  {
    intent: 'image_media',
    keepGroups: ['media'],
    historyMode: 'recent',
    patterns:
      /\b(image|picture|photo|draw|render|poster|illustration|logo|video|music|audio)\b|图片|配图|画一|生成图|海报|插画|视频|音频|音乐|渲染/i,
  },
  {
    intent: 'web_research',
    keepGroups: ['search', 'browser'],
    historyMode: 'recent',
    patterns:
      /\b(search|google|look\s?up|latest|news|today|current|weather|stock|price|website|url|http)\b|搜索|查一下|查询|最新|新闻|今天|实时|天气|股价|行情|网址|网站|搜一下/i,
  },
];

// Very short, self-contained questions/chitchat that almost never need a tool.
// The CJK greeting branch intentionally has no trailing `\b` — CJK characters
// aren't `\w`, so `\b` never matches right after them, which would silently
// fail to match a bare "你好" with nothing else after it.
const QUICK_QA_PATTERNS =
  /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no)\b|^(你好|谢谢|多谢|好的|是的|不用了|在吗|嗨)|[?？]\s*$/i;

function normalize(text: string): string {
  return (text || '').trim();
}

/**
 * Classify a turn's intent into an {@link OptimizationProfile}. Pure & synchronous.
 * Never throws; returns the keep-all fallback for empty/ambiguous input.
 */
export function classifyIntent(input: ClassifyInput): OptimizationProfile {
  const text = normalize(input.text);
  if (!text) return KEEP_ALL;

  for (const rule of INTENT_RULES) {
    if (rule.patterns.test(text)) {
      return {
        intent: rule.intent,
        keepGroups: rule.keepGroups,
        historyMode: rule.historyMode,
        confidence: 0.7,
      };
    }
  }

  // Short greeting / trivial question with no tool cues: keep only core tools.
  // Require it to be short so we don't strip tools off a real request that
  // merely happens to end with a question mark.
  if (text.length <= 80 && QUICK_QA_PATTERNS.test(text)) {
    return {
      intent: 'quick_qa',
      keepGroups: [],
      historyMode: 'recent',
      confidence: 0.65,
    };
  }

  // Unknown → keep everything (no pruning).
  return KEEP_ALL;
}
