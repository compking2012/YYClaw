import { describe, expect, it } from 'vitest';
import {
  isOfficeCollaborationConfigurable,
  isOfficeSessionsVisible,
  loadOfficeEnvFiles,
  OFFICE_COLLABORATION_FLAG,
  OFFICE_SESSIONS_VISIBLE_FLAG,
} from '../../scripts/is-office-collaboration-configurable.mjs';

describe('office.env session visibility flag', () => {
  it('defaults to false when unset', () => {
    const previous = process.env[OFFICE_SESSIONS_VISIBLE_FLAG];
    delete process.env[OFFICE_SESSIONS_VISIBLE_FLAG];
    loadOfficeEnvFiles('test');
    expect(isOfficeSessionsVisible()).toBe(false);
    if (previous === undefined) {
      delete process.env[OFFICE_SESSIONS_VISIBLE_FLAG];
    } else {
      process.env[OFFICE_SESSIONS_VISIBLE_FLAG] = previous;
    }
  });
});

describe('office.env collaboration flag', () => {
  it('defaults to true when unset', () => {
    const previous = process.env[OFFICE_COLLABORATION_FLAG];
    delete process.env[OFFICE_COLLABORATION_FLAG];
    loadOfficeEnvFiles('test');
    expect(isOfficeCollaborationConfigurable()).toBe(true);
    if (previous === undefined) {
      delete process.env[OFFICE_COLLABORATION_FLAG];
    } else {
      process.env[OFFICE_COLLABORATION_FLAG] = previous;
    }
  });

  it('is false only when explicitly set to false', () => {
    process.env[OFFICE_COLLABORATION_FLAG] = 'false';
    loadOfficeEnvFiles('test');
    expect(isOfficeCollaborationConfigurable()).toBe(false);
  });

  it('treats any non-false value as enabled', () => {
    process.env[OFFICE_COLLABORATION_FLAG] = 'yes';
    loadOfficeEnvFiles('test');
    expect(isOfficeCollaborationConfigurable()).toBe(true);
  });
});
