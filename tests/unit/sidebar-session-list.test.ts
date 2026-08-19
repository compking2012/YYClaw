import { describe, expect, it } from 'vitest';
import {
  ensureSessionEntryForSidebar,
  pinActiveCurrentSessionKey,
  pruneHiddenSessionActivity,
  resolveSidebarSessionListState,
  shouldInjectSessionIntoSidebar,
} from '../../src/stores/chat/sidebar-session-list';
import type { ChatSession } from '../../src/stores/chat/types';

/** Legacy Office room key — Office was removed, but these keys stay filtered. */
const OFFICE_KEY = 'agent:pm:office:task:proj-1:role:dev:node:gen-0';
const WORKFLOW_KEY = 'wf:r1:step';
const MAIN_KEY = 'agent:main:main';
const USER_KEY = 'agent:main:session-1';

describe('resolveSidebarSessionListState', () => {
  const deduped: ChatSession[] = [{ key: MAIN_KEY }, { key: USER_KEY }];

  it('keeps a hidden legacy office current key and never injects it into the sidebar list', () => {
    const result = resolveSidebarSessionListState({
      currentSessionKey: OFFICE_KEY,
      localSessions: [{ key: OFFICE_KEY }],
      dedupedSessions: deduped,
      defaultSessionKey: MAIN_KEY,
    });
    expect(result.nextSessionKey).toBe(OFFICE_KEY);
    expect(result.sessionsWithCurrent.map((session) => session.key)).toEqual([MAIN_KEY, USER_KEY]);
  });

  it('does not fallback away from a hidden current key even when it is missing from the gateway list', () => {
    const result = resolveSidebarSessionListState({
      currentSessionKey: OFFICE_KEY,
      localSessions: [],
      dedupedSessions: [{ key: MAIN_KEY }],
      defaultSessionKey: MAIN_KEY,
    });
    expect(result.nextSessionKey).toBe(OFFICE_KEY);
    expect(result.sessionsWithCurrent).toEqual([{ key: MAIN_KEY }]);
  });

  it('keeps a hidden workflow current key out of the sidebar list', () => {
    const result = resolveSidebarSessionListState({
      currentSessionKey: WORKFLOW_KEY,
      localSessions: [],
      dedupedSessions: [{ key: MAIN_KEY }],
      defaultSessionKey: MAIN_KEY,
    });
    expect(result.nextSessionKey).toBe(WORKFLOW_KEY);
    expect(result.sessionsWithCurrent).toEqual([{ key: MAIN_KEY }]);
  });

  it('injects a visible pending local session that is missing from the gateway list', () => {
    const pending = 'agent:main:session-pending';
    const result = resolveSidebarSessionListState({
      currentSessionKey: pending,
      localSessions: [{ key: pending }],
      dedupedSessions: deduped,
      defaultSessionKey: MAIN_KEY,
    });
    expect(result.nextSessionKey).toBe(pending);
    expect(result.sessionsWithCurrent.map((session) => session.key)).toEqual([
      MAIN_KEY,
      USER_KEY,
      pending,
    ]);
  });

  it('falls back when the current visible key is missing and not locally pending', () => {
    const result = resolveSidebarSessionListState({
      currentSessionKey: 'agent:main:missing',
      localSessions: deduped,
      dedupedSessions: deduped,
      defaultSessionKey: MAIN_KEY,
    });
    expect(result.nextSessionKey).toBe(MAIN_KEY);
    expect(result.sessionsWithCurrent.map((session) => session.key)).toEqual([MAIN_KEY, USER_KEY]);
  });
});

describe('shouldInjectSessionIntoSidebar', () => {
  it('rejects legacy office and workflow keys', () => {
    expect(shouldInjectSessionIntoSidebar(OFFICE_KEY, [{ key: MAIN_KEY }])).toBe(false);
    expect(shouldInjectSessionIntoSidebar(WORKFLOW_KEY, [{ key: MAIN_KEY }])).toBe(false);
  });

  it('rejects already-listed keys', () => {
    expect(shouldInjectSessionIntoSidebar(MAIN_KEY, [{ key: MAIN_KEY }])).toBe(false);
    expect(shouldInjectSessionIntoSidebar('agent:main:new', [{ key: MAIN_KEY }])).toBe(true);
  });
});

describe('ensureSessionEntryForSidebar', () => {
  it('never adds hidden sessions to the sidebar list', () => {
    const sessions = [{ key: MAIN_KEY }];
    expect(ensureSessionEntryForSidebar(sessions, OFFICE_KEY)).toEqual(sessions);
    expect(ensureSessionEntryForSidebar(sessions, WORKFLOW_KEY)).toEqual(sessions);
  });

  it('adds visible sessions when missing', () => {
    const sessions = [{ key: MAIN_KEY }];
    expect(ensureSessionEntryForSidebar(sessions, USER_KEY)).toEqual([
      { key: MAIN_KEY },
      { key: USER_KEY, displayName: USER_KEY },
    ]);
  });
});

describe('pinActiveCurrentSessionKey', () => {
  it('preserves a hidden current key even when resolved next differs', () => {
    expect(pinActiveCurrentSessionKey(OFFICE_KEY, MAIN_KEY)).toBe(OFFICE_KEY);
    expect(pinActiveCurrentSessionKey(WORKFLOW_KEY, MAIN_KEY)).toBe(WORKFLOW_KEY);
  });

  it('uses resolved next for visible sessions', () => {
    expect(pinActiveCurrentSessionKey('agent:main:missing', MAIN_KEY)).toBe(MAIN_KEY);
  });
});

describe('pruneHiddenSessionActivity', () => {
  it('removes hidden session timestamps while keeping visible ones', () => {
    expect(pruneHiddenSessionActivity({
      [MAIN_KEY]: 100,
      [OFFICE_KEY]: 200,
      [WORKFLOW_KEY]: 300,
    })).toEqual({ [MAIN_KEY]: 100 });
  });
});
