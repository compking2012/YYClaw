import { describe, expect, it } from 'vitest';
import { configureSidebarOfficeSessionVisibility } from '../../shared/internal-session';
import {
  ensureSessionEntryForSidebar,
  pinActiveCurrentSessionKey,
  pruneHiddenSessionActivity,
  resolveSidebarSessionListState,
  shouldInjectSessionIntoSidebar,
} from '../../src/stores/chat/sidebar-session-list';
import type { ChatSession } from '../../src/stores/chat/types';

const OFFICE_KEY = 'agent:pm:office:task:proj-1:role:dev:node:gen-0';
const MAIN_KEY = 'agent:main:main';
const USER_KEY = 'agent:main:session-1';

describe('resolveSidebarSessionListState', () => {
  const deduped: ChatSession[] = [{ key: MAIN_KEY }, { key: USER_KEY }];

  it('keeps hidden office current key and never injects it into the sidebar list', () => {
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
    configureSidebarOfficeSessionVisibility(false);
    const result = resolveSidebarSessionListState({
      currentSessionKey: OFFICE_KEY,
      localSessions: [],
      dedupedSessions: [{ key: MAIN_KEY }],
      defaultSessionKey: MAIN_KEY,
    });
    expect(result.nextSessionKey).toBe(OFFICE_KEY);
    expect(result.sessionsWithCurrent).toEqual([{ key: MAIN_KEY }]);
  });

  it('injects office current key when office session visibility is enabled', () => {
    configureSidebarOfficeSessionVisibility(true);
    const result = resolveSidebarSessionListState({
      currentSessionKey: OFFICE_KEY,
      localSessions: [],
      dedupedSessions: [{ key: MAIN_KEY }],
      defaultSessionKey: MAIN_KEY,
    });
    expect(result.nextSessionKey).toBe(OFFICE_KEY);
    expect(result.sessionsWithCurrent.map((session) => session.key)).toEqual([MAIN_KEY, OFFICE_KEY]);
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

  it('keeps gateway-listed office sessions when visibility is enabled and user stays on main', () => {
    configureSidebarOfficeSessionVisibility(true);
    const result = resolveSidebarSessionListState({
      currentSessionKey: MAIN_KEY,
      localSessions: [{ key: MAIN_KEY }],
      dedupedSessions: [{ key: MAIN_KEY }, { key: OFFICE_KEY }],
      defaultSessionKey: MAIN_KEY,
    });
    expect(result.nextSessionKey).toBe(MAIN_KEY);
    expect(result.sessionsWithCurrent.map((session) => session.key)).toEqual([MAIN_KEY, OFFICE_KEY]);
  });
});

describe('shouldInjectSessionIntoSidebar', () => {
  it('rejects office keys when visibility is disabled', () => {
    configureSidebarOfficeSessionVisibility(false);
    expect(shouldInjectSessionIntoSidebar(OFFICE_KEY, [{ key: MAIN_KEY }])).toBe(false);
  });

  it('allows office keys when visibility is enabled', () => {
    configureSidebarOfficeSessionVisibility(true);
    expect(shouldInjectSessionIntoSidebar(OFFICE_KEY, [{ key: MAIN_KEY }])).toBe(true);
  });

  it('rejects already-listed keys', () => {
    expect(shouldInjectSessionIntoSidebar(MAIN_KEY, [{ key: MAIN_KEY }])).toBe(false);
    expect(shouldInjectSessionIntoSidebar('agent:main:new', [{ key: MAIN_KEY }])).toBe(true);
  });
});

describe('ensureSessionEntryForSidebar', () => {
  it('never adds hidden sessions to the sidebar list when visibility is disabled', () => {
    configureSidebarOfficeSessionVisibility(false);
    const sessions = [{ key: MAIN_KEY }];
    expect(ensureSessionEntryForSidebar(sessions, OFFICE_KEY)).toEqual(sessions);
  });

  it('adds office sessions when visibility is enabled', () => {
    configureSidebarOfficeSessionVisibility(true);
    const sessions = [{ key: MAIN_KEY }];
    expect(ensureSessionEntryForSidebar(sessions, OFFICE_KEY)).toEqual([
      { key: MAIN_KEY },
      { key: OFFICE_KEY, displayName: OFFICE_KEY },
    ]);
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
  it('preserves hidden office current key even when resolved next differs', () => {
    configureSidebarOfficeSessionVisibility(false);
    expect(pinActiveCurrentSessionKey(OFFICE_KEY, MAIN_KEY)).toBe(OFFICE_KEY);
  });

  it('preserves visible office current key even when resolved next differs', () => {
    configureSidebarOfficeSessionVisibility(true);
    expect(pinActiveCurrentSessionKey(OFFICE_KEY, MAIN_KEY)).toBe(OFFICE_KEY);
  });

  it('uses resolved next for visible non-office sessions', () => {
    configureSidebarOfficeSessionVisibility(true);
    expect(pinActiveCurrentSessionKey('agent:main:missing', MAIN_KEY)).toBe(MAIN_KEY);
  });
});

describe('pruneHiddenSessionActivity', () => {
  it('removes hidden session timestamps while keeping visible ones', () => {
    expect(pruneHiddenSessionActivity({
      [MAIN_KEY]: 100,
      [OFFICE_KEY]: 200,
      'wf:r1:step': 300,
    })).toEqual({ [MAIN_KEY]: 100 });
  });
});
