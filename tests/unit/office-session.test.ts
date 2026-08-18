import { describe, expect, it } from 'vitest';
import { isOfficeSessionKey } from '../../shared/office-session';
import {
  configureSidebarOfficeSessionVisibility,
  isSidebarHiddenSessionKey,
} from '../../shared/internal-session';

describe('isOfficeSessionKey', () => {
  it('matches office task, task-room, p2p, and role dm keys', () => {
    expect(isOfficeSessionKey('agent:pm:office:task:proj-1:role:dev:node:gen-0')).toBe(true);
    expect(isOfficeSessionKey('agent:pm:office:task:proj-1:role:dev:node:gen-0:run:run-1')).toBe(true);
    expect(isOfficeSessionKey('agent:pm:office:task-room:proj-1')).toBe(true);
    expect(isOfficeSessionKey('agent:pm:office:p2p:dev:thread-1')).toBe(true);
    expect(isOfficeSessionKey('agent:pm:office:role:dev:dm:task-proj-1')).toBe(true);
  });

  it('does not match normal agent sessions', () => {
    expect(isOfficeSessionKey('agent:main:main')).toBe(false);
    expect(isOfficeSessionKey('agent:main:session-1700000000000')).toBe(false);
    expect(isOfficeSessionKey('agent:main:wf:run1:fetch')).toBe(false);
    expect(isOfficeSessionKey('')).toBe(false);
  });
});

describe('isSidebarHiddenSessionKey', () => {
  it('includes workflow and office internal keys when office sessions are hidden', () => {
    configureSidebarOfficeSessionVisibility(false);
    expect(isSidebarHiddenSessionKey('wf:r1:fetch')).toBe(true);
    expect(isSidebarHiddenSessionKey('agent:main:wf:r1:fetch')).toBe(true);
    expect(isSidebarHiddenSessionKey('agent:pm:office:task:proj-1:role:dev:node:gen-0')).toBe(true);
  });

  it('excludes office keys when office session visibility is enabled', () => {
    configureSidebarOfficeSessionVisibility(true);
    expect(isSidebarHiddenSessionKey('agent:pm:office:task:proj-1:role:dev:node:gen-0')).toBe(false);
    expect(isSidebarHiddenSessionKey('wf:r1:fetch')).toBe(true);
  });

  it('excludes user-facing sessions', () => {
    expect(isSidebarHiddenSessionKey('agent:main:main')).toBe(false);
  });
});
