/**
 * Observed-workflow projection over the ACP timeline.
 *
 * The workflow lane is an INDEPENDENT, non-ACP feature (see
 * `harness/specs/rules/workflow-lane-independence.md`). This module NEVER mutates
 * the ACP timeline; it only *reads* the reduced `AcpTimelineSnapshot` and derives
 * a single "observed workflow" signal that the chat store turns into a workflow
 * card living beside the transcript.
 *
 * It mirrors the read-only, pure-function shape of
 * `openclaw-file-activities.ts`: given the snapshot (plus a skill resolver), it
 * returns a plain projection with no side effects, so the caller can diff it and
 * fire the store's observed-workflow actions idempotently.
 *
 * ── ACP ToolCallItem shape (verified against `src/lib/acp/timeline-types.ts` +
 * `src/lib/acp/reducer.ts::upsertToolCall`) ──
 *   - `title`   : string. OpenClaw emits `"<toolName>: <detail>"` (e.g.
 *                 `"Read: /…/SKILL.md"`) or a bare `"<toolName>"`; falls back to
 *                 the raw `toolCallId` when ACP omits a title. We parse the
 *                 leading token before the first colon as the tool name.
 *   - `input`   : unknown. This is the ACP `rawInput` — the tool's raw arguments
 *                 object (e.g. `{ todos: [...] }`, `{ file_path: "…" }`). This is
 *                 the load-bearing field for detection.
 *   - `toolKind`: optional ACP `ToolKind` enum ('read' | 'edit' | …). Used only
 *                 as a secondary hint for Read detection.
 *   - `status`  : 'pending' | 'running' | 'completed' | 'failed'.
 *
 * Because the exact title casing/format of OpenClaw's plan tools is not
 * guaranteed, detection is defensive: a plan write is recognized by the tool name
 * (`TodoWrite` / `update_plan`) OR by an input that explicitly carries a
 * `todos`/`plan` array. Reads are recognized by name (`Read`) or `toolKind`.
 *
 * Activation identity is the *latest* user turn that contains workflow-shaped
 * tools (Read of a workflow SKILL.md and/or a plan write). Each new user message
 * opens a fresh window; an earlier terminal activation must not permanently own
 * later turns in the same session.
 */
import { groupAcpTimelineItems } from './timeline-groups';
import type { AcpTimelineSnapshot, MessageSegmentItem, ToolCallItem } from './timeline-types';
import {
  extractReadPath,
  extractTodos,
  toolNameIs,
  type ObservedTodo,
} from '@/stores/chat/observed-workflow';

/** Minimal workflow-skill identity, resolved from a `Read` of the skill's SKILL.md. */
export type AcpObservedWorkflowSkillHint = {
  name: string;
  title: string;
};

export type AcpObservedWorkflowSignal = {
  /**
   * Stable per-activation identity (the triggering user message id, or a
   * session-derived fallback). Lets the caller dedupe re-projections and key
   * terminal cards without colliding across later turns.
   */
  activationKey: string;
  /**
   * Set when a workflow-shaped skill's SKILL.md `Read` was observed — the
   * implicit-arming path. `null` when the card was armed elsewhere (explicit
   * `/skill` or the auto-router's skill deferral, handled on the send path).
   */
  skill: AcpObservedWorkflowSkillHint | null;
  /** Best-effort triggering user message id + text (from the ACP timeline). */
  userMessageId: string;
  userText: string;
  /** Latest declared todos/plan — the authoritative live step list. */
  todos: ObservedTodo[];
  /** True once any plan (TodoWrite/update_plan) has been observed. */
  hasPlan: boolean;
};

export type AcpObservedWorkflowProjection = {
  signal: AcpObservedWorkflowSignal | null;
};

const EMPTY_PROJECTION: AcpObservedWorkflowProjection = { signal: null };

/** Leading tool-name token from an ACP tool-call title (`"Read: /x"` → `"Read"`). */
function toolNameFromTitle(title: string): string {
  const colon = title.indexOf(':');
  return (colon >= 0 ? title.slice(0, colon) : title).trim();
}

function isReadTool(item: ToolCallItem): boolean {
  return toolNameIs(toolNameFromTitle(item.title), 'Read') || item.toolKind === 'read';
}

/**
 * Return the todos from a plan-writing tool call, or null when the item is not a
 * plan write. Recognizes `TodoWrite`/`update_plan` by name, and defensively
 * accepts unknown titles only when the raw input explicitly carries a
 * `todos`/`plan` array (avoids matching unrelated tools whose args happen to
 * contain `items`/`tasks`).
 */
function planTodos(item: ToolCallItem): ObservedTodo[] | null {
  const name = toolNameFromTitle(item.title);
  if (toolNameIs(name, 'TodoWrite') || toolNameIs(name, 'update_plan')) {
    return extractTodos(item.input);
  }
  const rec = item.input && typeof item.input === 'object' && !Array.isArray(item.input)
    ? (item.input as Record<string, unknown>)
    : null;
  if (rec && (Array.isArray(rec.todos) || Array.isArray(rec.plan))) {
    return extractTodos(item.input);
  }
  return null;
}

/** Flatten a user message segment's markdown parts into plain text. */
function userSegmentText(item: MessageSegmentItem): string {
  return item.parts
    .filter((part): part is Extract<typeof part, { kind: 'markdown' }> => part.kind === 'markdown')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

type ActivationWindow = {
  user: { id: string; text: string };
  skill: AcpObservedWorkflowSkillHint | null;
  todos: ObservedTodo[] | null;
  hasPlan: boolean;
};

/**
 * Derive the single active observed-workflow signal from the ACP timeline.
 *
 * There is at most one *live* observed workflow per session in the chat store,
 * but the transcript may contain several historical activations. We attribute
 * the signal to the *latest* user turn that contains workflow-shaped tools so a
 * terminal earlier card cannot permanently block a later Travel Planner turn.
 */
export function projectAcpObservedWorkflow(input: {
  timeline: AcpTimelineSnapshot;
  resolveWorkflowSkillByReadPath: (path: string) => AcpObservedWorkflowSkillHint | null;
}): AcpObservedWorkflowProjection {
  const groups = groupAcpTimelineItems(input.timeline);

  let currentUser: { id: string; text: string } = { id: '', text: '' };
  // Avoid a nested mutator: TypeScript does not track assignments inside closures,
  // which previously narrowed `latest` to `never` after `if (!latest) return`.
  let currentWindow: ActivationWindow = {
    user: currentUser,
    skill: null,
    todos: null,
    hasPlan: false,
  };
  let windowTouched = false;
  let latestActivation: ActivationWindow | null = null;

  const touchWindow = () => {
    if (!windowTouched) {
      currentWindow = {
        user: currentUser,
        skill: null,
        todos: null,
        hasPlan: false,
      };
      windowTouched = true;
    }
  };

  const publishWindow = (): ActivationWindow | null => {
    if (!windowTouched) return latestActivation;
    latestActivation = {
      user: currentWindow.user,
      skill: currentWindow.skill,
      todos: currentWindow.todos,
      hasPlan: currentWindow.hasPlan,
    };
    return latestActivation;
  };

  for (const group of groups) {
    if (group.kind === 'user') {
      // Commit the previous user-turn window (if any) before opening a fresh one.
      publishWindow();
      const seg = group.items[group.items.length - 1];
      if (seg) currentUser = { id: seg.id, text: userSegmentText(seg) };
      windowTouched = false;
      currentWindow = {
        user: currentUser,
        skill: null,
        todos: null,
        hasPlan: false,
      };
      continue;
    }

    for (const item of group.items) {
      if (item.kind !== 'tool-call') continue;

      if (isReadTool(item)) {
        const path = extractReadPath(item.input);
        const hint = path ? input.resolveWorkflowSkillByReadPath(path) : null;
        if (hint) {
          touchWindow();
          currentWindow = { ...currentWindow, skill: hint };
          publishWindow();
        }
        continue;
      }

      const todos = planTodos(item);
      if (todos) {
        touchWindow();
        currentWindow = { ...currentWindow, todos, hasPlan: true };
        publishWindow();
      }
    }
  }

  // Trailing assistant tools after the last user message.
  const latest = publishWindow();
  if (!latest) return { ...EMPTY_PROJECTION };

  return {
    signal: {
      activationKey: latest.user.id || `acp-observed:${input.timeline.sessionId}`,
      skill: latest.skill,
      userMessageId: latest.user.id || `wf-user-${input.timeline.sessionId}`,
      userText: latest.user.text,
      todos: latest.todos ?? [],
      hasPlan: latest.hasPlan,
    },
  };
}
