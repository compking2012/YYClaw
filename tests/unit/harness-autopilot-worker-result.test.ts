import { describe, it, expect } from 'vitest';
import { workerResultSchema } from '../../harness/src/autopilot/contracts.mjs';

const acceptedStatuses = ['implemented', 'blocked', 'validation-pending'] as const;
const requiredFields = ['status', 'summary', 'blockers'] as const;

describe('workerResultSchema contract', () => {
  it.each([
    ['implemented', {
      status: 'implemented',
      summary: 'Implementation is ready for independent controller validation.',
      blockers: [],
    }],
    ['blocked', {
      status: 'blocked',
      summary: 'Implementation cannot proceed without the required API contract.',
      blockers: ['The required API contract is missing from the frozen task sources.'],
    }],
  ])('accepts legacy worker status: %s', (_status, fixture) => {
    expect(workerResultSchema.parse(fixture)).toEqual(fixture);
  });

  it('accepts validation-pending without controller acceptance', () => {
    const fixture = {
      status: 'validation-pending',
      summary: 'Code is ready, but worker-local validation is unavailable; controller acceptance is still pending.',
      blockers: ['Worker-local tests cannot listen or spawn processes because of listen/spawn EPERM sandbox restrictions.'],
    };

    const parsed = workerResultSchema.parse(fixture);

    expect(parsed).toEqual(fixture);
    expect(parsed.status).toBe('validation-pending');
  });

  it('rejects pass as a worker status', () => {
    const fixture = {
      status: 'implemented',
      summary: 'Implementation is ready for independent controller validation.',
      blockers: [],
    };
    const invalidFixture = { ...fixture, status: 'pass' };

    expect(workerResultSchema.safeParse(invalidFixture).success).toBe(false);
    expect(() => workerResultSchema.parse(invalidFixture)).toThrow();
  });

  it.each(acceptedStatuses.flatMap((status) => requiredFields.map((field) => [status, field] as const)))(
    'rejects missing required field: %s / %s',
    (status, field) => {
      const fixture: { status?: string; summary?: string; blockers?: string[] } = {
        status,
        summary: 'Worker result awaiting independent controller review.',
        blockers: [],
      };
      delete fixture[field];

      expect(workerResultSchema.safeParse(fixture).success).toBe(false);
      expect(() => workerResultSchema.parse(fixture)).toThrow();
    },
  );

  it.each(acceptedStatuses)('rejects unknown extra fields: %s', (status) => {
    const fixture = {
      status,
      summary: 'Worker result awaiting independent controller review.',
      blockers: [],
      acceptanceEvidence: 'Unknown worker-result field; this is not controller evidence.',
    };

    expect(workerResultSchema.safeParse(fixture).success).toBe(false);
    expect(() => workerResultSchema.parse(fixture)).toThrow();
  });
});
