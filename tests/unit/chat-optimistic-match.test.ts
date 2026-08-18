import { describe, expect, it } from 'vitest';
import {
  dropRedundantOptimisticUserMessages,
  hasOptimisticServerEcho,
  matchesOptimisticUserMessage,
  mergePendingOptimisticUserMessages,
  rememberPendingOptimisticUserMessage,
} from '@/stores/chat/helpers';

describe('matchesOptimisticUserMessage', () => {
  it('matches when text is identical', () => {
    const optimistic = { role: 'user', content: 'run github1', timestamp: 1_700_000_000 } as const;
    const candidate = { role: 'user', content: 'run github1', timestamp: 1_700_000_000 } as const;

    expect(matchesOptimisticUserMessage(candidate, optimistic, 1_700_000_000_000)).toBe(true);
  });

  it('matches when Gateway prefixes a weekday/timestamp prefix on the echoed user message', () => {
    const optimistic = { role: 'user', content: 'run github1', timestamp: 1_700_000_000 } as const;
    const candidate = {
      role: 'user',
      content: '[Wed 2026-04-22 10:30 GMT+8] run github1',
      timestamp: 1_700_000_000,
    } as const;

    expect(matchesOptimisticUserMessage(candidate, optimistic, 1_700_000_000_000)).toBe(true);
  });

  it('matches when the server appends [media attached: ...] to the echoed user message', () => {
    const optimistic = {
      role: 'user',
      content: 'Describe this image',
      timestamp: 1_700_000_000,
      _attachedFiles: [
        {
          fileName: 'shot.png',
          mimeType: 'image/png',
          fileSize: 123,
          preview: null,
          filePath: '/tmp/shot.png',
        },
      ],
    } as const;
    const candidate = {
      role: 'user',
      content: 'Describe this image\n\n[media attached: /tmp/shot.png (image/png) | /tmp/shot.png]',
      timestamp: 1_700_000_000,
    } as const;

    expect(matchesOptimisticUserMessage(candidate, optimistic, 1_700_000_000_000)).toBe(true);
  });

  it('matches when the server strips a [message_id: ...] tag from the user message', () => {
    const optimistic = { role: 'user', content: 'hello world', timestamp: 1_700_000_000 } as const;
    const candidate = {
      role: 'user',
      content: 'hello world [message_id: 11111111-2222-3333-4444-555555555555]',
      timestamp: 1_700_000_000,
    } as const;

    expect(matchesOptimisticUserMessage(candidate, optimistic, 1_700_000_000_000)).toBe(true);
  });

  it('matches when Gateway echo timestamp skews within the optimistic window', () => {
    const optimistic = { role: 'user', content: '你好，你是什么模型', timestamp: 1_700_000_000 } as const;
    const candidate = {
      role: 'user',
      content: '你好，你是什么模型',
      timestamp: 1_700_000_030,
    } as const;

    expect(matchesOptimisticUserMessage(candidate, optimistic, 1_700_000_000_000)).toBe(true);
  });

  it('rejects unrelated user messages when timestamp skew is too large', () => {
    const optimistic = { role: 'user', content: '你好，你是什么模型', timestamp: 1_700_000_000 } as const;
    const candidate = {
      role: 'user',
      content: '你好，你是什么模型',
      timestamp: 1_700_030_000,
    } as const;

    expect(matchesOptimisticUserMessage(candidate, optimistic, 1_700_000_000_000)).toBe(false);
  });

  it('still rejects unrelated user messages', () => {
    const optimistic = { role: 'user', content: 'run github1', timestamp: 1_700_000_000 } as const;
    const candidate = {
      role: 'user',
      content: '[Wed 2026-04-22 10:30 GMT+8] completely different text',
      timestamp: 1_700_000_000,
    } as const;

    expect(matchesOptimisticUserMessage(candidate, optimistic, 1_700_000_000_000)).toBe(false);
  });
});

describe('optimistic user message merge', () => {
  it('drops redundant optimistic bubbles when history already contains the echoed user turn', () => {
    const sessionKey = 'agent:main:main';
    const optimistic = {
      id: 'local-optimistic',
      role: 'user' as const,
      content: '你好，你是什么模型',
      timestamp: 1_700_000_000,
    };
    rememberPendingOptimisticUserMessage(sessionKey, optimistic, 1_700_000_000_000);

    const merged = mergePendingOptimisticUserMessages(sessionKey, [
      {
        id: 'server-echo',
        role: 'user',
        content: '[Wed 2026-04-22 10:30 GMT+8] 你好，你是什么模型',
        timestamp: 1_700_000_015,
      },
    ]);
    const deduped = dropRedundantOptimisticUserMessages(sessionKey, merged);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.id).toBe('server-echo');
    expect(hasOptimisticServerEcho(deduped, optimistic, 1_700_000_000_000)).toBe(true);
  });
});
