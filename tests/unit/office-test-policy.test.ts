import { describe, expect, it } from 'vitest';
import {
  assertOfficeTestMayWrite,
  isOfficeTestWriteAllowed,
} from './office-test-policy.mts';

describe('office-test-policy', () => {
  it('allows office API writes', () => {
    expect(isOfficeTestWriteAllowed('POST', '/api/office/tasks/task-1/run')).toBe(true);
    expect(isOfficeTestWriteAllowed('PATCH', '/api/office/tasks/task-1')).toBe(true);
  });

  it('allows read-only global probes', () => {
    expect(isOfficeTestWriteAllowed('GET', '/api/agents')).toBe(true);
    expect(isOfficeTestWriteAllowed('GET', '/api/gateway/status')).toBe(true);
  });

  it('forbids global config writes', () => {
    expect(isOfficeTestWriteAllowed('PUT', '/api/agents/pm/model')).toBe(false);
    expect(isOfficeTestWriteAllowed('POST', '/api/provider-accounts')).toBe(false);
    expect(isOfficeTestWriteAllowed('PUT', '/api/agents/defaults/models')).toBe(false);
  });

  it('assertOfficeTestMayWrite throws on forbidden writes', () => {
    expect(() => assertOfficeTestMayWrite('PUT', '/api/agents/pm/model')).toThrow(
      /office-test-policy/,
    );
  });
});
