import { describe, expect, it } from 'vitest';
import {
  allTodosCompleted,
  buildObservedRun,
  computeObservedStepUpdate,
  extractReadPath,
  extractSkillName,
  extractTodos,
  finalizeObservedRun,
  firstInProgressStepId,
  runFromTodos,
  stepProgressFromRun,
  stepProgressFromTodos,
  stepsFromTodos,
  toolNameIs,
} from '@/stores/chat/observed-workflow';

describe('toolNameIs', () => {
  it('matches case-insensitively', () => {
    expect(toolNameIs('Read', 'Read')).toBe(true);
    expect(toolNameIs('read', 'Read')).toBe(true);
    expect(toolNameIs('TODOWRITE', 'TodoWrite')).toBe(true);
    expect(toolNameIs('update_plan', 'update_plan')).toBe(true);
    expect(toolNameIs('Write', 'Read')).toBe(false);
    expect(toolNameIs(undefined, 'Read')).toBe(false);
  });
});

describe('extractSkillName', () => {
  it('reads { skill } and strips a leading slash / trailing args', () => {
    expect(extractSkillName({ skill: 'deep-research' })).toBe('deep-research');
    expect(extractSkillName({ skill: '/deep-research some query' })).toBe('deep-research');
  });
  it('falls back across common keys and bare strings', () => {
    expect(extractSkillName({ name: 'foo' })).toBe('foo');
    expect(extractSkillName({ command: 'bar' })).toBe('bar');
    expect(extractSkillName('baz')).toBe('baz');
  });
  it('returns null when no name is present', () => {
    expect(extractSkillName({})).toBeNull();
    expect(extractSkillName(null)).toBeNull();
  });
});

describe('extractTodos', () => {
  it('parses a { todos: [...] } payload', () => {
    const todos = extractTodos({ todos: [
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
      { content: 'c', status: 'pending' },
    ] });
    expect(todos).toEqual([
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
      { content: 'c', status: 'pending' },
    ]);
  });
  it('accepts a bare array and alternate content keys', () => {
    expect(extractTodos([{ title: 'x' }])).toEqual([{ content: 'x', status: 'pending' }]);
  });
  it('parses an update_plan { plan: [{ step, status }] } payload', () => {
    expect(extractTodos({ plan: [
      { step: 'gather', status: 'completed' },
      { step: 'write', status: 'in_progress' },
    ] })).toEqual([
      { content: 'gather', status: 'completed' },
      { content: 'write', status: 'in_progress' },
    ]);
  });
  it('returns null for non-todo args', () => {
    expect(extractTodos({ foo: 1 })).toBeNull();
  });
});

describe('allTodosCompleted', () => {
  it('is true only when there is ≥1 todo and all are completed', () => {
    expect(allTodosCompleted([{ content: 'a', status: 'completed' }, { content: 'b', status: 'done' }])).toBe(true);
    expect(allTodosCompleted([{ content: 'a', status: 'completed' }, { content: 'b', status: 'pending' }])).toBe(false);
    expect(allTodosCompleted([])).toBe(false);
  });
});

describe('extractReadPath', () => {
  it('reads common path keys and bare strings', () => {
    expect(extractReadPath({ file_path: '/x/SKILL.md' })).toBe('/x/SKILL.md');
    expect(extractReadPath({ path: '/y/SKILL.md' })).toBe('/y/SKILL.md');
    expect(extractReadPath('/z/SKILL.md')).toBe('/z/SKILL.md');
    expect(extractReadPath({ foo: 1 })).toBeNull();
  });
});

describe('firstInProgressStepId', () => {
  it('returns the todo id of the first in-progress todo, else null', () => {
    expect(firstInProgressStepId([{ content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress' }])).toBe('todo-1');
    expect(firstInProgressStepId([{ content: 'a', status: 'pending' }])).toBeNull();
  });
});

describe('computeObservedStepUpdate (per-step text attribution)', () => {
  const prog0 = { runId: 'r1', offset: 0, currentStepId: 'todo-0' };
  const todos2 = [{ content: 'A', status: 'in_progress' }, { content: 'B', status: 'pending' }];

  it('attributes text to the completing step on a transition and advances', () => {
    const out = computeObservedStepUpdate({
      prevResults: {},
      prog: prog0,
      todos: [{ content: 'A', status: 'completed' }, { content: 'B', status: 'in_progress' }],
      assistantText: 'step A output',
      runId: 'r1',
    });
    expect(out.results['todo-0']).toBe('step A output');
    expect(out.currentStepId).toBe('todo-1');
    expect(out.offset).toBe('step A output'.length);
    expect(out.done).toBe(false);
  });

  it('does not flush when the in-progress step is unchanged', () => {
    const out = computeObservedStepUpdate({ prevResults: {}, prog: prog0, todos: todos2, assistantText: 'partial', runId: 'r1' });
    expect(out.results['todo-0']).toBeUndefined();
    expect(out.currentStepId).toBe('todo-0');
    expect(out.offset).toBe(0);
  });

  it('flushes the tail to the last step when all todos complete', () => {
    const out = computeObservedStepUpdate({
      prevResults: { 'todo-0': 'A out' },
      prog: { runId: 'r1', offset: 5, currentStepId: 'todo-1' },
      todos: [{ content: 'A', status: 'completed' }, { content: 'B', status: 'completed' }],
      assistantText: 'A outB out',
      runId: 'r1',
    });
    expect(out.results['todo-1']).toBe('B out');
    expect(out.done).toBe(true);
  });

  it('resets offset to 0 when the run changes (new turn)', () => {
    const out = computeObservedStepUpdate({
      prevResults: {},
      prog: { runId: 'r1', offset: 999, currentStepId: 'todo-0' },
      todos: [{ content: 'A', status: 'completed' }, { content: 'B', status: 'in_progress' }],
      assistantText: 'turn2 step A',
      runId: 'r2',
    });
    expect(out.results['todo-0']).toBe('turn2 step A');
    expect(out.currentStepId).toBe('todo-1');
  });
});

describe('observed run progress', () => {
  it('marks completed/running todos in the trace', () => {
    const run = buildObservedRun('r1', 'demo', 1000);
    const todos = [
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
      { content: 'c', status: 'pending' },
    ];
    const next = runFromTodos(run, todos, 2000);
    expect(next.currentState).toBe('todo-1');
    expect(next.trace).toEqual([
      { state: 'todo-0', status: 'completed', at: 2000 },
      { state: 'todo-1', status: 'running', at: 2000 },
    ]);
    expect(stepsFromTodos(todos).map((s) => s.id)).toEqual(['todo-0', 'todo-1', 'todo-2']);
  });

  it('completes all steps on done and clears error', () => {
    const run = buildObservedRun('r1', 'demo', 1000);
    const steps = stepsFromTodos([{ content: 'a', status: 'pending' }, { content: 'b', status: 'pending' }]);
    const done = finalizeObservedRun(run, 'done', steps, 3000);
    expect(done.status).toBe('done');
    expect(done.trace.every((t) => t.status === 'completed')).toBe(true);
    expect(done.error).toBeUndefined();
  });

  it('maps aborted/failed to a failed run with an error', () => {
    const run = buildObservedRun('r1', 'demo', 1000);
    expect(finalizeObservedRun(run, 'aborted', [], 3000).status).toBe('failed');
    expect(finalizeObservedRun(run, 'failed', [], 3000, 'boom').error).toBe('boom');
  });

  it('marks in-progress trace steps failed on abort so the UI spinner stops', () => {
    const base = buildObservedRun('r1', 'demo', 1000);
    const running = runFromTodos(base, [
      { content: '理解需求', status: 'completed' },
      { content: '执行搜索与收集证据', status: 'in_progress' },
    ], 2000);
    const aborted = finalizeObservedRun(running, 'aborted', stepsFromTodos([
      { content: '理解需求', status: 'completed' },
      { content: '执行搜索与收集证据', status: 'in_progress' },
    ]), 3000);
    expect(aborted.status).toBe('failed');
    expect(aborted.trace.find((t) => t.state === 'todo-1')?.status).toBe('failed');
    expect(aborted.currentState).toBe('');
  });
});

describe('stepProgress snapshots', () => {
  it('maps todos into persistable step statuses', () => {
    expect(stepProgressFromTodos([
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
      { content: 'c', status: 'pending' },
    ])).toEqual([
      { id: 'todo-0', status: 'completed' },
      { id: 'todo-1', status: 'running' },
      { id: 'todo-2', status: 'pending' },
    ]);
  });

  it('maps abort traces so in-progress becomes failed for reload display', () => {
    const steps = stepsFromTodos([
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
      { content: 'c', status: 'pending' },
    ]);
    const run = runFromTodos(buildObservedRun('r1', 'demo', 1), [
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
      { content: 'c', status: 'pending' },
    ], 2);
    const aborted = finalizeObservedRun(run, 'aborted', steps, 3);
    expect(stepProgressFromRun(steps, aborted)).toEqual([
      { id: 'todo-0', status: 'completed' },
      { id: 'todo-1', status: 'failed' },
      { id: 'todo-2', status: 'pending' },
    ]);
  });
});
