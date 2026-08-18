import { describe, expect, it } from 'vitest';
import { isSubagentSessionKey } from '../../shared/subagent-session';
import { isSidebarHiddenSessionKey } from '../../shared/internal-session';

describe('isSubagentSessionKey', () => {
  it('matches top-level and agent-namespaced subagent keys', () => {
    expect(isSubagentSessionKey('subagent:abcd-1234')).toBe(true);
    expect(isSubagentSessionKey('agent:main:subagent:abcd-1234')).toBe(true);
  });

  it('does not match real agent, workflow, or office keys', () => {
    expect(isSubagentSessionKey('agent:main:main')).toBe(false);
    expect(isSubagentSessionKey('agent:main:session-1')).toBe(false);
    expect(isSubagentSessionKey('wf:r1:step')).toBe(false);
    expect(isSubagentSessionKey('agent:pm:office:task:p1:role:dev:node:gen-0')).toBe(false);
  });
});

describe('isSidebarHiddenSessionKey', () => {
  it('hides subagent sub-sessions from the sidebar', () => {
    expect(isSidebarHiddenSessionKey('subagent:abcd')).toBe(true);
    expect(isSidebarHiddenSessionKey('agent:main:subagent:abcd')).toBe(true);
  });

  it('still keeps real agent sessions visible', () => {
    expect(isSidebarHiddenSessionKey('agent:main:main')).toBe(false);
  });
});
