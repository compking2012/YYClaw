import { describe, expect, it } from 'vitest';
import {
  parseTranscriptMessages,
  extractMessageText,
  extractFirstUserTitle,
  extractLastTimestampMs,
} from '../../electron/utils/session-summary';

describe('parseTranscriptMessages', () => {
  it('parses message lines and skips malformed / non-message entries', () => {
    const raw = [
      JSON.stringify({ type: 'message', message: { role: 'user', content: 'hi' } }),
      'not json',
      JSON.stringify({ type: 'meta', message: { role: 'system' } }),
      JSON.stringify({ type: 'message', message: { role: 'assistant', content: 'yo' } }),
    ].join('\n');
    const msgs = parseTranscriptMessages(raw);
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
  });
});

describe('extractMessageText', () => {
  it('handles string and content-block array shapes', () => {
    expect(extractMessageText('plain')).toBe('plain');
    expect(extractMessageText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])).toBe('ab');
    expect(extractMessageText([{ type: 'image' }])).toBe('');
    expect(extractMessageText(null)).toBe('');
  });
});

describe('extractFirstUserTitle', () => {
  it('returns the first user message cleaned of untrusted metadata', () => {
    const title = extractFirstUserTitle([
      { role: 'user', content: 'System (untrusted): internal noise' },
      { role: 'assistant', content: 'irrelevant' },
      { role: 'user', content: 'Sender (untrusted): Bob\n\nThe real question' },
    ]);
    expect(title).toBe('The real question');
  });

  it('returns null when no usable user message exists', () => {
    expect(extractFirstUserTitle([{ role: 'assistant', content: 'hi' }])).toBeNull();
    expect(extractFirstUserTitle([{ role: 'user', content: 'System (untrusted): x' }])).toBeNull();
  });
});

describe('extractLastTimestampMs', () => {
  it('returns the latest timestamp normalized to ms (seconds → ms)', () => {
    expect(
      extractLastTimestampMs([
        { role: 'user', content: 'a', timestamp: 1700000000 },
        { role: 'user', content: 'b', timestamp: 1700000002 },
      ]),
    ).toBe(1700000002000);
  });

  it('passes through millisecond timestamps and returns null when absent', () => {
    expect(extractLastTimestampMs([{ role: 'user', content: 'a', timestamp: 1700000000000 }])).toBe(1700000000000);
    expect(extractLastTimestampMs([{ role: 'user', content: 'a' }])).toBeNull();
  });
});
