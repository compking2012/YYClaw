import { describe, expect, it } from 'vitest';
import { extractSessionIdFromTranscriptFileName } from '@electron/utils/token-usage-core';

describe('extractSessionIdFromTranscriptFileName', () => {
  it('parses normal jsonl transcript names', () => {
    expect(extractSessionIdFromTranscriptFileName('abc-123.jsonl')).toBe('abc-123');
  });

  it('parses deleted transcript names', () => {
    expect(extractSessionIdFromTranscriptFileName('abc-123.deleted.jsonl')).toBe('abc-123');
  });

  it('parses reset transcript names', () => {
    expect(extractSessionIdFromTranscriptFileName('abc-123.jsonl.reset.2026-03-09T03-01-29.968Z')).toBe('abc-123');
  });

  it('parses deleted reset transcript names', () => {
    expect(extractSessionIdFromTranscriptFileName('abc-123.deleted.jsonl.reset.2026-03-09T03-01-29.968Z')).toBe('abc-123');
  });

  it('returns undefined for non-transcript files', () => {
    expect(extractSessionIdFromTranscriptFileName('sessions.json')).toBeUndefined();
    expect(extractSessionIdFromTranscriptFileName('abc-123.log')).toBeUndefined();
  });

  it('excludes compaction-checkpoint snapshot transcripts', () => {
    // Full pre-compaction copies — counting them double-counts usage and bloats
    // the aggregated response past JSON.stringify's limit at GB scale.
    expect(
      extractSessionIdFromTranscriptFileName(
        '61415246-2385-4674-b8d4-63b73623a4e4.checkpoint.5eab740f-c758-4f23-addd-141521e3efd7.jsonl',
      ),
    ).toBeUndefined();
  });

  it('excludes trajectory artifacts but keeps real sessions', () => {
    expect(extractSessionIdFromTranscriptFileName('abc-123.trajectory.jsonl')).toBeUndefined();
    expect(extractSessionIdFromTranscriptFileName('abc-123.jsonl')).toBe('abc-123');
  });
});
