/**
 * Observed-workflow helpers.
 *
 * When a workflow-shaped skill actually runs inside a normal agent turn, we do
 * NOT re-orchestrate it (that would replace the skill's real behavior). Instead
 * we OBSERVE the turn and synthesize a `RunRecord` that the existing
 * WorkflowInlineCard / WorkflowRunPanel can render unchanged. Progress is driven
 * by the agent's own `TodoWrite` calls (when present) plus the run lifecycle.
 *
 * Pure functions only — the chat store wires these into `handleRuntimeEvent`.
 */
import type { RunRecord, RunStatus, TraceEntry, WorkflowStepMeta } from '@/types/workflow';

export interface ObservedTodo {
  content: string;
  status: string;
}

/** Case-insensitive tool-name match (the runtime may capitalize differently). */
export function toolNameIs(name: string | undefined, canonical: string): boolean {
  return typeof name === 'string' && name.toLowerCase() === canonical.toLowerCase();
}

/** Build the initial observed run (all declared steps pending). */
export function buildObservedRun(runId: string, title: string, now: number): RunRecord {
  return {
    runId,
    defId: 'observed',
    version: 0,
    title,
    status: 'running',
    currentState: '',
    trace: [],
    results: {},
    startedAt: now,
    updatedAt: now,
  };
}

/**
 * Rebuild a minimal observed run from the persisted card, for after a reload
 * when the in-memory live run is gone. A 'done' card then renders its steps as
 * completed (via the `status === 'done'` fallback in the panel) rather than all
 * grey/pending.
 */
export function observedRunFromCard(
  runId: string,
  title: string,
  status: RunStatus,
  error: string | undefined,
  createdAt: number,
): RunRecord {
  return {
    runId,
    defId: 'observed',
    version: 0,
    title,
    status,
    currentState: '',
    trace: [],
    results: {},
    error,
    startedAt: createdAt,
    updatedAt: createdAt,
  };
}

/**
 * Defensively pull the invoked skill name from a `Skill` tool call's args.
 * Handles `{ skill }`, `{ name }`, `{ command }`, a bare string, etc., and
 * strips a leading slash / trailing args so `/deep-research foo` → `deep-research`.
 */
export function extractSkillName(args: unknown): string | null {
  if (typeof args === 'string') return normalizeSkillArg(args);
  if (!args || typeof args !== 'object') return null;
  const rec = args as Record<string, unknown>;
  for (const key of ['skill', 'name', 'command', 'skillName', 'slug', 'id']) {
    const value = rec[key];
    if (typeof value === 'string' && value.trim()) return normalizeSkillArg(value);
  }
  return null;
}

function normalizeSkillArg(value: string): string {
  const first = value.trim().split(/\s+/)[0] ?? '';
  return first.replace(/^\//, '').trim();
}

/**
 * Defensively pull the todo list out of a `TodoWrite` / `update_plan` tool
 * call's args. Handles `{todos|items|tasks|plan: [...]}` or a bare array, with
 * per-item text under `content|title|text|name|step`.
 */
export function extractTodos(args: unknown): ObservedTodo[] | null {
  const rec = args && typeof args === 'object' ? (args as Record<string, unknown>) : null;
  const raw = Array.isArray(args) ? args : rec?.todos ?? rec?.items ?? rec?.tasks ?? rec?.plan;
  if (!Array.isArray(raw)) return null;
  const todos: ObservedTodo[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const content =
      (typeof r.content === 'string' && r.content)
      || (typeof r.title === 'string' && r.title)
      || (typeof r.text === 'string' && r.text)
      || (typeof r.name === 'string' && r.name)
      || (typeof r.step === 'string' && r.step)
      || '';
    if (!content.trim()) continue;
    const status = typeof r.status === 'string' ? r.status : 'pending';
    todos.push({ content: content.trim(), status });
  }
  return todos.length ? todos : null;
}

/** True when there is at least one todo and every todo is completed. */
export function allTodosCompleted(todos: ObservedTodo[]): boolean {
  return todos.length > 0 && todos.every((todo) => normalizeTodoStatus(todo.status) === 'completed');
}

/** Pull a file path out of a `Read`-like tool call's args. */
export function extractReadPath(args: unknown): string | null {
  if (typeof args === 'string') return args.trim() || null;
  if (!args || typeof args !== 'object') return null;
  const rec = args as Record<string, unknown>;
  for (const key of ['file_path', 'filePath', 'path', 'file', 'filename', 'target']) {
    const value = rec[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function normalizeTodoStatus(status: string): 'pending' | 'running' | 'completed' {
  const v = status.toLowerCase();
  if (v === 'completed' || v === 'done' || v === 'complete') return 'completed';
  if (v === 'in_progress' || v === 'in-progress' || v === 'running' || v === 'active') return 'running';
  return 'pending';
}

/** Persistable per-step statuses derived from the agent's latest todos. */
export function stepProgressFromTodos(
  todos: ObservedTodo[],
): Array<{ id: string; status: 'pending' | 'running' | 'completed' | 'failed' }> {
  return todos.map((todo, index) => ({
    id: `todo-${index}`,
    status: normalizeTodoStatus(todo.status),
  }));
}

/**
 * Persistable per-step statuses from an observed run's trace (abort/fail path).
 * Steps missing from the trace stay `pending`; in-progress trace entries are
 * recorded as `failed` so reload does not resurrect a spinner.
 */
export function stepProgressFromRun(
  steps: WorkflowStepMeta[],
  run: Pick<RunRecord, 'trace'>,
): Array<{ id: string; status: 'pending' | 'running' | 'completed' | 'failed' }> {
  const byId = new Map(run.trace.map((entry) => [entry.state, entry.status] as const));
  return steps.map((step) => {
    const status = byId.get(step.id);
    if (status === 'completed') return { id: step.id, status: 'completed' as const };
    if (status === 'failed' || status === 'running') return { id: step.id, status: 'failed' as const };
    return { id: step.id, status: 'pending' as const };
  });
}

/** Todos become the authoritative live step list once the agent emits them. */
export function stepsFromTodos(todos: ObservedTodo[]): WorkflowStepMeta[] {
  return todos.map((todo, index) => ({ id: `todo-${index}`, title: todo.content, kind: 'agent' as const }));
}

/** The step id (`todo-<i>`) of the first in-progress todo, or null. */
export function firstInProgressStepId(todos: ObservedTodo[]): string | null {
  const index = todos.findIndex((todo) => normalizeTodoStatus(todo.status) === 'running');
  return index >= 0 ? `todo-${index}` : null;
}

export interface ObservedProgress {
  runId: string;
  offset: number;
  currentStepId: string | null;
}

/**
 * Attribute the assistant text produced since the last step transition to the
 * step that was in progress, and advance the tracked step. `offset` is a length
 * into the current run's accumulated `assistantText`; it resets when the run
 * changes (a new turn). Pure — the store applies the returned patch.
 */
export function computeObservedStepUpdate(params: {
  prevResults: Record<string, string>;
  prog: ObservedProgress;
  todos: ObservedTodo[];
  assistantText: string;
  runId: string;
}): { results: Record<string, string>; currentStepId: string | null; offset: number; done: boolean } {
  const { prevResults, prog, todos, assistantText, runId } = params;
  const offset = prog.runId === runId ? prog.offset : 0;
  const sliceText = assistantText.slice(offset);
  const newInProgress = firstInProgressStepId(todos);
  const done = allTodosCompleted(todos);
  const results = { ...prevResults };
  let currentStepId = prog.currentStepId;
  let nextOffset = offset;

  if (done) {
    if (currentStepId) results[currentStepId] = (results[currentStepId] ?? '') + sliceText;
  } else if (currentStepId && newInProgress && newInProgress !== currentStepId) {
    results[currentStepId] = (results[currentStepId] ?? '') + sliceText;
    nextOffset = assistantText.length;
    currentStepId = newInProgress;
  } else if (!currentStepId && newInProgress) {
    currentStepId = newInProgress;
    nextOffset = assistantText.length;
  }

  return { results, currentStepId, offset: nextOffset, done };
}

/** Recompute the observed run's trace/currentState from the latest todos. */
export function runFromTodos(prev: RunRecord, todos: ObservedTodo[], now: number): RunRecord {
  const trace: TraceEntry[] = [];
  todos.forEach((todo, index) => {
    const id = `todo-${index}`;
    const status = normalizeTodoStatus(todo.status);
    if (status === 'completed') trace.push({ state: id, status: 'completed', at: now });
    else if (status === 'running') trace.push({ state: id, status: 'running', at: now });
  });
  const running = todos.findIndex((todo) => normalizeTodoStatus(todo.status) === 'running');
  return {
    ...prev,
    trace,
    currentState: running >= 0 ? `todo-${running}` : prev.currentState,
    currentStepKind: 'agent',
    updatedAt: now,
  };
}

/** Mark the observed run terminal; on success, complete any still-pending steps. */
export function finalizeObservedRun(
  prev: RunRecord,
  status: 'done' | 'failed' | 'aborted',
  steps: WorkflowStepMeta[],
  now: number,
  error?: string,
): RunRecord {
  const runStatus: RunStatus = status === 'done' ? 'done' : 'failed';
  const trace: TraceEntry[] =
    status === 'done'
      ? steps.map((step) => ({ state: step.id, status: 'completed', at: now }))
      // Abort/fail must not leave in-progress steps spinning in the panel.
      : prev.trace.map((entry) => (
        entry.status === 'running'
          ? { ...entry, status: 'failed' as const, at: now }
          : entry
      ));
  return {
    ...prev,
    status: runStatus,
    trace,
    currentState: '',
    error: status === 'done' ? undefined : error ?? (status === 'aborted' ? 'aborted' : prev.error),
    updatedAt: now,
  };
}
