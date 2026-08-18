import { describe, expect, it } from 'vitest';
import { isSessionTranscriptJsonl } from '../../electron/services/admin-console/collectors/index';

describe('isSessionTranscriptJsonl', () => {
  it('accepts normal transcript files', () => {
    expect(isSessionTranscriptJsonl('1a3b874b.jsonl')).toBe(true);
  });

  it('rejects lock sidecars and tombstones', () => {
    expect(isSessionTranscriptJsonl('1a3b874b.jsonl.lock')).toBe(false);
    expect(isSessionTranscriptJsonl('sess.deleted.jsonl')).toBe(false);
    expect(isSessionTranscriptJsonl('sessions.json')).toBe(false);
  });
});
