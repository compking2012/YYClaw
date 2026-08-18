import { mkdir, rm, writeFile, utimes } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome, testUserData } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testHome: `/tmp/clawx-transcript-cache-${suffix}`,
    testUserData: `/tmp/clawx-transcript-cache-user-data-${suffix}`,
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const mocked = { ...actual, homedir: () => testHome };
  return { ...mocked, default: mocked };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => testUserData,
    getVersion: () => '0.0.0-test',
  },
}));

const SESSIONS_DIR = join(testHome, '.openclaw', 'agents', 'main', 'sessions');

// Fixed-width line so two variants can share an identical byte length, letting a
// test prove the (mtime,size) cache key is honoured (same key => no re-read).
function assistantLine(timestamp: string, total: number): string {
  return JSON.stringify({
    type: 'message',
    timestamp,
    message: {
      role: 'assistant',
      model: 'gpt-5',
      provider: 'openai',
      usage: { input: total, output: 0, total },
      content: [{ type: 'tool_use', name: 'read' }],
    },
  });
}

async function writeTranscript(name: string, lines: string[]): Promise<void> {
  await writeFile(join(SESSIONS_DIR, name), `${lines.join('\n')}\n`, 'utf8');
}

describe('transcript aggregate incremental cache', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
    await mkdir(SESSIONS_DIR, { recursive: true });
    await writeFile(
      join(testHome, '.openclaw', 'openclaw.json'),
      JSON.stringify({ agents: { list: [{ id: 'main', name: 'Main', default: true }] } }),
      'utf8',
    );
  });

  it('reuses the cached parse when mtime and size are unchanged', async () => {
    const name = '11111111-1111-1111-1111-111111111111.jsonl';
    const filePath = join(SESSIONS_DIR, name);
    const fixedMtime = new Date('2026-03-12T12:00:00.000Z');
    await writeTranscript(name, [assistantLine('2026-03-12T12:00:00.000Z', 100)]);
    await utimes(filePath, fixedMtime, fixedMtime);

    const { collectTranscriptAggregates } = await import('@electron/utils/transcript-aggregate-cache');
    const first = await collectTranscriptAggregates();
    expect(first.usageEntries).toHaveLength(1);
    expect(first.usageEntries[0].totalTokens).toBe(100);
    expect(first.toolEvents).toHaveLength(1);

    // Overwrite with different content of identical byte length, then pin the
    // mtime back to the same value — the cache key (mtime,size) is unchanged, so
    // the stale 100 value must be returned, proving the file was not re-read.
    await writeTranscript(name, [assistantLine('2026-03-12T12:00:00.000Z', 999)]);
    await utimes(filePath, fixedMtime, fixedMtime);

    const second = await collectTranscriptAggregates();
    expect(second.usageEntries).toHaveLength(1);
    expect(second.usageEntries[0].totalTokens).toBe(100);
  });

  it('re-parses a transcript after it grows', async () => {
    const name = '22222222-2222-2222-2222-222222222222.jsonl';
    await writeTranscript(name, [assistantLine('2026-03-12T12:00:00.000Z', 100)]);

    const { collectTranscriptAggregates } = await import('@electron/utils/transcript-aggregate-cache');
    const first = await collectTranscriptAggregates();
    expect(first.usageEntries).toHaveLength(1);

    await writeTranscript(name, [
      assistantLine('2026-03-12T12:00:00.000Z', 100),
      assistantLine('2026-03-12T12:05:00.000Z', 200),
    ]);
    const future = new Date(Date.now() + 5_000);
    await utimes(join(SESSIONS_DIR, name), future, future);

    const second = await collectTranscriptAggregates();
    expect(second.usageEntries).toHaveLength(2);
    expect(second.usageEntries.map((e) => e.totalTokens).sort((a, b) => a - b)).toEqual([100, 200]);
  });

  it('evicts cache entries for deleted transcripts', async () => {
    const name = '33333333-3333-3333-3333-333333333333.jsonl';
    await writeTranscript(name, [assistantLine('2026-03-12T12:00:00.000Z', 100)]);

    const { collectTranscriptAggregates } = await import('@electron/utils/transcript-aggregate-cache');
    const first = await collectTranscriptAggregates();
    expect(first.sessionIds.size).toBe(1);

    await rm(join(SESSIONS_DIR, name), { force: true });

    const second = await collectTranscriptAggregates();
    expect(second.sessionIds.size).toBe(0);
    expect(second.usageEntries).toHaveLength(0);
  });
});
