import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome } = vi.hoisted(() => ({
  testHome: `/tmp/clawx-dashboard-snapshot-${Math.random().toString(36).slice(2)}`,
}));

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  const mocked = {
    ...actual,
    homedir: () => testHome,
  };
  return {
    ...mocked,
    default: mocked,
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const mocked = {
    ...actual,
    homedir: () => testHome,
  };
  return {
    ...mocked,
    default: mocked,
  };
});

vi.mock('@electron/utils/openclaw-skills', () => ({
  listOpenclawSkills: vi.fn(async () => ({ skills: [], agents: {}, total: 3 })),
}));

describe('dashboard snapshot schema', () => {
  beforeEach(async () => {
    vi.resetModules();
    await rm(testHome, { recursive: true, force: true });
  });

  it('builds all required ranges with exact bucket counts and aggregate data', async () => {
    const openclawDir = join(testHome, '.openclaw');
    const sessionsDir = join(openclawDir, 'agents', 'main', 'sessions');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(join(openclawDir, 'openclaw.json'), JSON.stringify({
      agents: {
        defaults: { model: { primary: 'openai/gpt-4.1' } },
        list: [{ id: 'main', name: 'Main', default: true }],
      },
      models: { openai: ['gpt-4.1'] },
      commands: {
        jobs: [
          { id: 'enabled', enabled: true },
          { id: 'disabled', enabled: false },
        ],
      },
    }), 'utf8');
    await writeFile(
      join(sessionsDir, 'session-1.jsonl'),
      [
        JSON.stringify({
          type: 'message',
          timestamp: '2026-04-30T11:45:10.000Z',
          message: { role: 'user', content: 'hello' },
        }),
        JSON.stringify({
          type: 'message',
          timestamp: '2026-04-30T11:50:15.000Z',
          message: {
            role: 'assistant',
            provider: 'openai',
            model: 'gpt-4.1',
            content: [{ type: 'toolCall', name: 'shell', id: 'call-1' }],
            usage: {
              input: 100,
              output: 40,
              cacheRead: 5,
              cacheWrite: 1,
              total: 146,
              cost: { total: 0.0123 },
            },
          },
        }),
      ].join('\n'),
      'utf8',
    );

    const { buildDashboardSnapshot } = await import('@electron/services/admin-console/dashboard-snapshot');
    const snapshot = await buildDashboardSnapshot('client-1', new Date('2026-04-30T12:00:30.000Z')) as any;

    expect(snapshot).toMatchObject({
      client_id: 'client-1',
      schema_version: 1,
      data: {
        stats: {
          session_count: 1,
          cron_enabled_count: 1,
          installed_skill_count: 3,
        },
        coverage: {
          total_sessions: 1,
          sessions_with_usage: 1,
        },
      },
    });

    const ranges = snapshot.data.ranges;
    expect(Object.keys(ranges).sort()).toEqual([
      'last_15m',
      'last_1h',
      'last_24h',
      'last_30d',
      'last_7d',
      'last_8h',
    ].sort());
    expect(ranges.last_15m.bucket_unit).toBe('minute');
    expect(ranges.last_15m.series).toHaveLength(15);
    expect(ranges.last_1h.bucket_unit).toBe('5m');
    expect(ranges.last_1h.series).toHaveLength(12);
    expect(ranges.last_8h.bucket_unit).toBe('15m');
    expect(ranges.last_8h.series).toHaveLength(32);
    expect(ranges.last_24h.bucket_unit).toBe('hour');
    expect(ranges.last_24h.series).toHaveLength(24);
    expect(ranges.last_7d.bucket_unit).toBe('day');
    expect(ranges.last_7d.series).toHaveLength(7);
    expect(ranges.last_30d.bucket_unit).toBe('day');
    expect(ranges.last_30d.series).toHaveLength(30);

    expect(ranges.last_1h.range_key).toBe('last_1h');
    expect(ranges.last_1h.totals).toMatchObject({
      input: 100,
      output: 40,
      cache_read: 5,
      cache_write: 1,
      total_tokens: 146,
      total_cost: 0.0123,
      missing_cost_entries: 0,
    });
    expect(ranges.last_1h.top_models[0]).toMatchObject({
      provider: 'openai',
      model: 'gpt-4.1',
      count: 1,
    });
    expect(ranges.last_1h.top_tools[0]).toEqual({ name: 'shell', count: 1 });
  });
});
