/**
 * Shared workflow-shape heuristics + step extraction.
 *
 * The sequencing/enumeration heuristic here is the pure, provider-agnostic core
 * shared by:
 *   - renderer routing (`src/lib/workflow-route.ts`, which adds an intent-classifier
 *     gate on top for the query-based path), and
 *   - main-process skill inspection (`electron/utils/skill-quick-access.ts`, which
 *     marks a SKILL.md as "workflow-shaped" and extracts its declared steps).
 *
 * Keep this dependency-free (no `@/` renderer imports) so both layers can use it.
 */

/** Sequencing / step cues (CN + EN). Kept in sync with workflow-route.ts. */
export const SEQUENCING =
  /(首先|然后|接着|其次|之后|最后|分(?:成|为)?\s*\d|步骤|第\s*[一二三四五六七八九十\d]+\s*步|先.{0,40}?再|step\s*\d|firstly|then\b|after that|finally|next steps?)/i;

/** Numbered / bulleted list markers at line starts. */
export const ENUM_LINE = /(^|\n)\s*(\d+\s*[.)、]|[-*]\s|[一二三四五六七八九十]\s*[、.])/g;

/** Minimum length for a plausibly multi-step task. */
export const MIN_TASK_LENGTH = 12;
/** A single sequencing cue only counts if the task is at least this long. */
export const LONGISH_LENGTH = 24;

/**
 * True when the text looks like a clear, multi-step task (sequencing cues or a
 * numbered/bulleted list). This is the L1 signal only — it does NOT apply the
 * quick-Q&A intent gate (that lives in the renderer's `shouldRouteToWorkflow`).
 */
export function looksLikeWorkflowText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < MIN_TASK_LENGTH) return false;

  const enumMatches = trimmed.match(ENUM_LINE);
  const hasList = !!enumMatches && enumMatches.length >= 2;

  const seqGlobal = new RegExp(SEQUENCING.source, 'gi');
  const seqCount = (trimmed.match(seqGlobal) ?? []).length;

  return hasList || seqCount >= 2 || (seqCount >= 1 && trimmed.length >= LONGISH_LENGTH);
}

/** Strip a leading YAML frontmatter block (`---\n...\n---`). */
export function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content;
  const endIndex = content.indexOf('\n---', 3);
  if (endIndex === -1) return content;
  // Skip past the closing `---` line.
  const afterClose = content.indexOf('\n', endIndex + 1);
  return afterClose === -1 ? '' : content.slice(afterClose + 1);
}

/** Extract the raw YAML frontmatter block body (between the fences), or ''. */
export function extractFrontmatter(content: string): string {
  if (!content.startsWith('---')) return '';
  const endIndex = content.indexOf('\n---', 3);
  if (endIndex === -1) return '';
  return content.slice(3, endIndex);
}

/**
 * True when the SKILL.md frontmatter explicitly opts in via `workflow: true`
 * (accepts either a top-level key or one nested under `metadata:`).
 */
export function frontmatterOptsIntoWorkflow(content: string): boolean {
  const fm = extractFrontmatter(content);
  if (!fm) return false;
  return /^\s*workflow\s*:\s*true\s*$/im.test(fm);
}

export interface ParsedWorkflowStep {
  title: string;
}

const MAX_STEP_TITLE = 48;

function truncateTitle(title: string): string {
  const clean = title.replace(/\s+/g, ' ').trim();
  return clean.length > MAX_STEP_TITLE ? `${clean.slice(0, MAX_STEP_TITLE - 1)}…` : clean;
}

/** A numbered / CN-numbered list item at a line start; captures the item text. */
const LIST_ITEM_LINE = /^\s*(?:\d+\s*[.)、]|[一二三四五六七八九十]+\s*[、.]|[-*]\s+)\s*(.+?)\s*$/;

/** Sequencing markers used to split prose into ordered segments (fallback). */
const SEQ_SPLIT =
  /(?:首先|然后|接着|其次|之后|最后|firstly|then|after that|finally|next)[:：,，\s]*/gi;

/**
 * Best-effort extraction of an ordered step list from a SKILL.md body.
 * Prefers an explicit numbered/bulleted list; falls back to splitting prose on
 * sequencing markers. Returns [] when no ≥2-step shape is found.
 */
export function parseWorkflowSteps(content: string, opts?: { max?: number }): ParsedWorkflowStep[] {
  const max = opts?.max ?? 12;
  const body = stripFrontmatter(content);

  // 1) Explicit numbered / bulleted list.
  const listItems: string[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const m = raw.match(LIST_ITEM_LINE);
    const title = m?.[1]?.trim();
    if (title) listItems.push(title);
  }
  if (listItems.length >= 2) {
    return dedupeTitles(listItems).slice(0, max).map((title) => ({ title: truncateTitle(title) }));
  }

  // 2) Sequencing-prose fallback: split on markers, keep the clause after each.
  const segments: string[] = [];
  let lastIndex = -1;
  let match: RegExpExecArray | null;
  const re = new RegExp(SEQ_SPLIT.source, 'gi');
  while ((match = re.exec(body)) !== null) {
    if (lastIndex >= 0) {
      segments.push(body.slice(lastIndex, match.index));
    }
    lastIndex = re.lastIndex;
  }
  if (lastIndex >= 0) segments.push(body.slice(lastIndex));
  const clauses = segments
    .map((seg) => seg.split(/[。！？.!?\n]/)[0]?.trim() ?? '')
    .filter((seg) => seg.length > 0);
  if (clauses.length >= 2) {
    return dedupeTitles(clauses).slice(0, max).map((title) => ({ title: truncateTitle(title) }));
  }

  return [];
}

function dedupeTitles(titles: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const title of titles) {
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(title);
  }
  return out;
}

/**
 * Whole determination for "is this SKILL.md a workflow-shaped skill?":
 * explicit frontmatter opt-in OR the body reads like a multi-step task.
 */
export function isWorkflowSkillContent(content: string): boolean {
  return frontmatterOptsIntoWorkflow(content) || looksLikeWorkflowText(stripFrontmatter(content));
}

/**
 * A human-friendly title for the skill card: the body's first H1, else the
 * frontmatter `name`, else null (caller falls back to the directory name).
 */
export function parseSkillTitle(content: string): string | null {
  const body = stripFrontmatter(content);
  for (const raw of body.split(/\r?\n/)) {
    const h1 = raw.match(/^#\s+(.+?)\s*$/);
    if (h1?.[1]) return truncateTitle(h1[1]);
    if (raw.trim()) break; // only consider a leading H1
  }
  const fm = extractFrontmatter(content);
  const nameMatch = fm.match(/^\s*name\s*:\s*(.+?)\s*$/m);
  const name = nameMatch?.[1]?.trim().replace(/^['"]|['"]$/g, '');
  return name || null;
}
