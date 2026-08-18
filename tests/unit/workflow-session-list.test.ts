import { describe, expect, it } from 'vitest';
import {
  filterOutWorkflowSessions,
  mergeWorkflowParentSessions,
} from '../../src/stores/chat/workflow-session-list';
import { pickStartupSessionFallback } from '../../src/stores/chat/session-selection';
import type { ChatSession } from '../../src/stores/chat/types';
import type { WorkflowCardRef } from '../../src/types/workflow';

const card = (over: Partial<WorkflowCardRef> = {}): WorkflowCardRef => ({
  runId: 'r1',
  messageId: 'wf-card-r1',
  userMessageId: 'u1',
  userText: 't',
  title: '抓取汇总',
  steps: [],
  status: 'done',
  createdAt: 1_000,
  ...over,
});

describe('filterOutWorkflowSessions', () => {
  it('drops wf: and legacy wf-agent: sub-sessions (incl. agent-namespaced), keeps real agent sessions', () => {
    const sessions: ChatSession[] = [
      { key: 'agent:main:main' },
      { key: 'wf:r1:fetch' },
      { key: 'agent:main:wf:r1:summarize' },
      { key: 'wf-agent:abcd:1700000000000' },
      { key: 'agent:main:session-1' },
    ];
    expect(filterOutWorkflowSessions(sessions).map((s) => s.key)).toEqual([
      'agent:main:main',
      'agent:main:session-1',
    ]);
  });

  it('drops office internal sessions', () => {
    const sessions: ChatSession[] = [
      { key: 'agent:main:main' },
      { key: 'agent:pm:office:task:proj-1:role:dev:node:gen-0' },
      { key: 'agent:pm:office:task-room:proj-1' },
      { key: 'agent:pm:office:p2p:dev:thread-1' },
      { key: 'agent:pm:office:role:dev:dm:task-proj-1' },
    ];
    expect(filterOutWorkflowSessions(sessions).map((s) => s.key)).toEqual(['agent:main:main']);
  });
});

describe('mergeWorkflowParentSessions', () => {
  it('injects a parent session that has cards but is missing from the list', () => {
    const merged = mergeWorkflowParentSessions([], { 'agent:main:main': [card()] });
    expect(merged.map((s) => s.key)).toEqual(['agent:main:main']);
    expect(merged[0].derivedTitle).toBe('抓取汇总');
    expect(merged[0].updatedAt).toBe(1_000);
  });

  it('does not duplicate a parent already present', () => {
    const existing: ChatSession[] = [{ key: 'agent:main:main', derivedTitle: 'kept' }];
    const merged = mergeWorkflowParentSessions(existing, { 'agent:main:main': [card()] });
    expect(merged).toHaveLength(1);
    expect(merged[0].derivedTitle).toBe('kept');
  });

  it('uses the latest card for title/updatedAt and never re-injects a sub-session key', () => {
    const merged = mergeWorkflowParentSessions([], {
      'agent:main:main': [card({ title: '旧', createdAt: 1_000 }), card({ title: '新', createdAt: 2_000 })],
      'wf:r9:step': [card({ runId: 'r9' })],
    });
    expect(merged.map((s) => s.key)).toEqual(['agent:main:main']);
    expect(merged[0].derivedTitle).toBe('新');
    expect(merged[0].updatedAt).toBe(2_000);
  });
});

describe('pickStartupSessionFallback — internal sessions are never selected', () => {
  it('skips wf: sessions even when they are the only non-main entries', () => {
    const sessions: ChatSession[] = [
      { key: 'wf:r1:fetch', updatedAt: 5_000 },
      { key: 'wf:r1:summarize', updatedAt: 6_000 },
    ];
    expect(pickStartupSessionFallback('agent:main:main', sessions)).toBeNull();
  });

  it('prefers a real agent session over a more-recent wf: session', () => {
    const sessions: ChatSession[] = [
      { key: 'wf:r1:fetch', updatedAt: 9_000 },
      { key: 'agent:main:session-1', updatedAt: 1_000 },
    ];
    expect(pickStartupSessionFallback('agent:main:main', sessions)).toBe('agent:main:session-1');
  });

  it('skips office internal sessions', () => {
    const sessions: ChatSession[] = [
      { key: 'agent:pm:office:task:proj-1:role:dev:node:gen-0', updatedAt: 9_000 },
      { key: 'agent:main:session-1', updatedAt: 1_000 },
    ];
    expect(pickStartupSessionFallback('agent:main:main', sessions)).toBe('agent:main:session-1');
  });
});
