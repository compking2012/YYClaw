export type WorkflowJsonObjectParseResult =
  | {
      ok: true;
      object: Record<string, unknown>;
      /** JSON text used for parsing; may be repaired. */
      jsonText: string;
      repaired: boolean;
      raw: string;
    }
  | {
      ok: false;
      stage: 'syntax';
      detail: string;
      raw: string;
    };

function extractJsonCandidates(raw: string): string[] {
  const trimmed = raw.trim();
  const candidates: string[] = [];
  const push = (s: string) => {
    const t = s.trim();
    if (t && !candidates.includes(t)) candidates.push(t);
  };

  push(trimmed);

  const wholeFence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  if (wholeFence?.[1]) push(wholeFence[1]);

  const embeddedRe = /```(?:json)?\s*([\s\S]*?)```/giu;
  let fenceMatch: RegExpExecArray | null;
  while ((fenceMatch = embeddedRe.exec(trimmed)) !== null) {
    if (fenceMatch[1]) push(fenceMatch[1]);
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) push(trimmed.slice(start, end + 1));

  return candidates;
}

function parseJsonObjectCandidate(candidate: string): Record<string, unknown> | null {
  const parsed = JSON.parse(candidate);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return null;
}

function nextNonWhitespace(text: string, start: number): string | undefined {
  let i = start;
  while (i < text.length && /\s/u.test(text[i]!)) i++;
  return text[i];
}

const VALID_JSON_STRING_ESCAPE_CHARS = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u']);

/**
 * Repair backslashes inside JSON string values for macOS `ls -l` paths.
 *
 * - `\` + invalid escape (e.g. `\Domain` from gen-2) → `\\Domain` (legal JSON, one `\` in value)
 * - `\\` + char (e.g. `\\Domain` from gen-0/1) → left unchanged (already legal JSON)
 */
export function repairInvalidJsonStringEscapes(raw: string): string {
  const out: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (!inString) {
      if (ch === '"') inString = true;
      out.push(ch);
      continue;
    }

    if (escaped) {
      out.push(ch);
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      const next = raw[i + 1];
      if (next !== undefined && !VALID_JSON_STRING_ESCAPE_CHARS.has(next)) {
        out.push('\\\\');
        continue;
      }
      out.push(ch);
      escaped = true;
      continue;
    }

    if (ch === '"') {
      const next = nextNonWhitespace(raw, i + 1);
      if (next === ':' || next === ',' || next === '}' || next === ']' || next === undefined) {
        out.push(ch);
        inString = false;
      } else {
        out.push('\\"');
      }
      continue;
    }

    out.push(ch);
  }

  return out.join('');
}

/** Repair common LLM JSON slips without changing semantic content. */
export function repairCommonWorkflowJsonSyntax(raw: string): string {
  const out: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (!inString) {
      if (ch === '"') inString = true;
      out.push(ch);
      continue;
    }

    if (escaped) {
      out.push(ch);
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      out.push(ch);
      escaped = true;
      continue;
    }

    if (ch === '"') {
      const next = nextNonWhitespace(raw, i + 1);
      // Valid JSON string terminators. `:` covers object keys; the others cover values.
      if (next === ':' || next === ',' || next === '}' || next === ']' || next === undefined) {
        out.push(ch);
        inString = false;
      } else {
        out.push('\\"');
      }
      continue;
    }

    out.push(ch);
  }

  return out.join('').replace(/,\s*([}\]])/gu, '$1');
}

/** 从 Agent 正文中提取 JSON 对象（支持前文/附件与 ```json 代码块；会修复轻微语法错误）。 */
export function parseWorkflowJsonObjectDetailed(raw: string): WorkflowJsonObjectParseResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, stage: 'syntax', detail: '未收到 JSON 正文', raw };
  }

  const candidates = extractJsonCandidates(trimmed);
  let lastError = '';
  for (const c of candidates) {
    try {
      const object = parseJsonObjectCandidate(c);
      if (object) return { ok: true, object, jsonText: c, repaired: false, raw };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }

    const repairedQuotes = repairCommonWorkflowJsonSyntax(c);
    if (repairedQuotes !== c) {
      try {
        const object = parseJsonObjectCandidate(repairedQuotes);
        if (object) return { ok: true, object, jsonText: repairedQuotes, repaired: true, raw };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    const repairedEscapes = repairInvalidJsonStringEscapes(c);
    if (repairedEscapes !== c) {
      try {
        const object = parseJsonObjectCandidate(repairedEscapes);
        if (object) return { ok: true, object, jsonText: repairedEscapes, repaired: true, raw };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    const repairedBoth = repairInvalidJsonStringEscapes(repairedQuotes);
    if (repairedBoth !== c && repairedBoth !== repairedQuotes && repairedBoth !== repairedEscapes) {
      try {
        const object = parseJsonObjectCandidate(repairedBoth);
        if (object) return { ok: true, object, jsonText: repairedBoth, repaired: true, raw };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
  }

  return {
    ok: false,
    stage: 'syntax',
    detail: lastError ? `JSON 语法错误：${lastError}` : '未找到可解析的 JSON 对象',
    raw,
  };
}

/** 从 Agent 正文中提取 Workflow JSON 对象（支持前文/附件与 ```json 代码块）。 */
export function tryParseWorkflowJsonObject(raw: string): Record<string, unknown> | null {
  const parsed = parseWorkflowJsonObjectDetailed(raw);
  return parsed.ok ? parsed.object : null;
}

export function workflowJsonDeliverablePathFromText(text: string): string | null {
  const obj = tryParseWorkflowJsonObject(text);
  if (!obj) return null;
  const deliver = obj.deliverable && typeof obj.deliverable === 'object'
    ? (obj.deliverable as Record<string, unknown>)
    : null;
  const path = deliver?.path;
  return typeof path === 'string' && path.trim() ? path.trim() : null;
}
