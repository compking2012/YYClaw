import { describe, expect, it } from 'vitest';
import {
  filterMessagesForSessionSidebarExport,
  formatSessionSidebarMarkdown,
} from '@/lib/office-session-sidebar-md';

describe('office-session-sidebar-md filtering', () => {
  it('drops system and tool_result roles, keeps user/assistant text', () => {
    const msgs = [
      { role: 'system', content: 'boot', timestamp: 1000 },
      { role: 'toolResult', content: 'result', timestamp: 1001 },
      { role: 'user', content: 'hello', timestamp: 1_700_000_000_000 },
      { role: 'assistant', content: 'hi there', timestamp: 1_700_000_001_000 },
    ];
    const kept = filterMessagesForSessionSidebarExport(msgs);
    const roles = kept.map((m) => m.role);
    expect(roles).toContain('user');
    expect(roles).toContain('assistant');
    expect(roles).not.toContain('system');
    expect(roles).not.toContain('toolResult');
  });

  it('keeps tool_use assistant turns even without visible text', () => {
    const msgs = [
      {
        role: 'assistant',
        content: [{ type: 'tool_use', name: 'read_file', input: { path: '/tmp/x' } }],
        timestamp: 1_700_000_000_000,
      },
    ];
    const kept = filterMessagesForSessionSidebarExport(msgs);
    expect(kept.length).toBe(1);
  });

  it('drops heartbeat poll user messages', () => {
    const msgs = [{ role: 'user', content: '[OpenClaw heartbeat poll]', timestamp: 1_700_000_000_000 }];
    expect(filterMessagesForSessionSidebarExport(msgs)).toEqual([]);
  });

  it('drops runtime system injection text', () => {
    const msgs = [
      { role: 'user', content: 'System (untrusted): do X', timestamp: 1_700_000_000_000 },
      { role: 'assistant', content: '[Inter-session message] ping', timestamp: 1_700_000_001_000 },
    ];
    expect(filterMessagesForSessionSidebarExport(msgs)).toEqual([]);
  });

  it('drops assistant thinking-only content (no visible text)', () => {
    const msgs = [
      {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'internal reasoning' }],
        timestamp: 1_700_000_000_000,
      },
    ];
    expect(filterMessagesForSessionSidebarExport(msgs)).toEqual([]);
  });
});

describe('office-session-sidebar-md markdown', () => {
  it('renders headers, text and thinking blocks', () => {
    const md = formatSessionSidebarMarkdown([
      { role: 'user', content: 'question?', timestamp: 1_700_000_000_000 },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'let me think\nmore' },
          { type: 'text', text: 'the answer' },
        ],
        timestamp: 1_700_000_001_000,
      },
    ]);
    expect(md).toContain('### user');
    expect(md).toContain('question?');
    expect(md).toContain('### assistant');
    expect(md).toContain('> **Thinking**');
    expect(md).toContain('the answer');
  });

  it('renders tool_use blocks with json input', () => {
    const md = formatSessionSidebarMarkdown([
      {
        role: 'assistant',
        content: [{ type: 'tool_use', name: 'grep', input: { pattern: 'foo' } }],
        timestamp: 1_700_000_000_000,
      },
    ]);
    expect(md).toContain('**Tool:** `grep`');
    expect(md).toContain('```json');
    expect(md).toContain('"pattern"');
  });

  it('handles string timestamps and plain string content', () => {
    const md = formatSessionSidebarMarkdown([
      { role: 'user', content: 'plain text', timestamp: '2024-01-02T03:04:05.000Z' },
    ]);
    expect(md).toContain('### user · 2024-01-02T03:04:05.000Z');
    expect(md).toContain('plain text');
  });

  it('falls back to msg.text and omits header timestamp when invalid', () => {
    const md = formatSessionSidebarMarkdown([
      { role: 'assistant', text: 'legacy text field', timestamp: 'not-a-date' },
    ]);
    expect(md).toContain('### assistant');
    expect(md).not.toContain('·');
    expect(md).toContain('legacy text field');
  });

  it('returns empty string when nothing visible', () => {
    expect(formatSessionSidebarMarkdown([{ role: 'system', content: 'x' }])).toBe('');
  });
});
