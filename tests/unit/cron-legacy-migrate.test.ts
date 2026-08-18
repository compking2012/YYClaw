import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GatewayManager } from '@electron/gateway/manager';

let openclawDir = '';

vi.mock('@electron/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: () => openclawDir,
}));

// Stub cron-api so the migrate module loads without pulling in its heavy
// runtime deps (channel-alias, agent-config, session-util). These stubs
// preserve pass-through semantics sufficient for mapping-logic assertions.
vi.mock('@electron/services/cron-api', () => ({
  normalizeCronDelivery: (d: unknown) => (d && typeof d === 'object' ? d : { mode: 'none' }),
  normalizeScheduleInput: (s: unknown) => s,
}));

import {
  isEligibleForMigration,
  mapLegacyToCronAddPayload,
  migrateLegacyCronJobs,
  archiveLegacyCronFiles,
} from '@electron/services/cron-legacy-migrate';

type GatewayCronJobLike = Parameters<typeof isEligibleForMigration>[0];

function makeJob(overrides: Partial<GatewayCronJobLike> = {}): GatewayCronJobLike {
  return {
    id: 'job-1',
    name: 'My Task',
    enabled: true,
    createdAtMs: 0,
    updatedAtMs: 0,
    schedule: { kind: 'cron', expr: '0 3 * * *' },
    payload: { kind: 'agentTurn', message: 'do work' },
    delivery: { mode: 'none' },
    sessionTarget: 'isolated',
    ...overrides,
  } as GatewayCronJobLike;
}

function makeGatewayManager(rpc: ReturnType<typeof vi.fn>): GatewayManager {
  return { rpc } as unknown as GatewayManager;
}

function seedCronFile(fileName: string, payload: unknown): void {
  mkdirSync(join(openclawDir, 'cron'), { recursive: true });
  writeFileSync(join(openclawDir, 'cron', fileName), JSON.stringify(payload), 'utf-8');
}

describe('isEligibleForMigration', () => {
  it('passes a normal user-created cron job', () => {
    expect(isEligibleForMigration(makeJob())).toBe(true);
  });

  it('skips disabled jobs', () => {
    expect(isEligibleForMigration(makeJob({ enabled: false }))).toBe(false);
  });

  it('skips [managed-by=...] internal tasks', () => {
    expect(isEligibleForMigration(makeJob({ description: '[managed-by=memory-core.short-term-promotion] x' }))).toBe(false);
  });

  it.each([
    ['cron missing expr', { kind: 'cron' }],
    ['every missing everyMs', { kind: 'every' }],
    ['at missing at', { kind: 'at' }],
    ['unknown kind', { kind: 'nope' }],
  ])('skips malformed schedule (%s)', (schedule) => {
    expect(isEligibleForMigration(makeJob({ schedule: schedule as GatewayCronJobLike['schedule'] }))).toBe(false);
  });

  it('skips jobs without a usable message', () => {
    expect(isEligibleForMigration(makeJob({ payload: { kind: 'agentTurn' } }))).toBe(false);
  });
});

describe('mapLegacyToCronAddPayload', () => {
  it('maps message and passes structured schedule/delivery through', () => {
    const payload = mapLegacyToCronAddPayload(makeJob());
    expect(payload.name).toBe('My Task');
    expect(payload.payload).toEqual({ kind: 'agentTurn', message: 'do work' });
    expect(payload.schedule).toEqual({ kind: 'cron', expr: '0 3 * * *' });
    expect(payload.delivery).toEqual({ mode: 'none' });
    expect(payload.enabled).toBe(true);
  });

  it('falls back to payload.text when message is absent', () => {
    const payload = mapLegacyToCronAddPayload(makeJob({ payload: { kind: 'agentTurn', text: 'fallback' } }));
    expect(payload.payload).toEqual({ kind: 'agentTurn', message: 'fallback' });
  });

  it('applies defaults for agentId / sessionTarget / wakeMode', () => {
    const job = makeJob();
    delete (job as { agentId?: string }).agentId;
    const payload = mapLegacyToCronAddPayload(job);
    expect(payload.agentId).toBe('main');
    expect(payload.sessionTarget).toBe('isolated');
    expect(payload.wakeMode).toBe('next-heartbeat');
  });
});

describe('migrateLegacyCronJobs', () => {
  beforeEach(() => {
    openclawDir = mkdtempSync(join(tmpdir(), 'clawx-cron-'));
    mkdirSync(join(openclawDir, 'cron'), { recursive: true });
    vi.clearAllMocks();
  });

  it('(a) no source files → no-op, no archive', async () => {
    const rpc = vi.fn();
    await migrateLegacyCronJobs(makeGatewayManager(rpc));
    expect(rpc).not.toHaveBeenCalled();
    expect(existsSync(join(openclawDir, 'cron', 'legacy-archive'))).toBe(false);
  });

  it('(b) eligible jobs → cron.add called, files archived', async () => {
    seedCronFile('jobs.json.bak', { version: 1, jobs: [makeJob({ id: 'a', name: 'A' })] });
    const rpc = vi.fn().mockResolvedValue({ id: 'new-a' });
    rpc.mockResolvedValueOnce({ jobs: [] }); // cron.list
    rpc.mockResolvedValueOnce({ id: 'new-a' }); // cron.add

    await migrateLegacyCronJobs(makeGatewayManager(rpc));

    expect(rpc).toHaveBeenCalledWith('cron.list', { includeDisabled: true }, 8000);
    expect(rpc).toHaveBeenCalledWith('cron.add', expect.objectContaining({ name: 'A' }), 30000);
    expect(existsSync(join(openclawDir, 'cron', 'jobs.json.bak'))).toBe(false);
    const archiveRoot = join(openclawDir, 'cron', 'legacy-archive');
    expect(existsSync(archiveRoot)).toBe(true);
    const sub = readdirSync(archiveRoot)[0];
    expect(existsSync(join(archiveRoot, sub, 'jobs.json.bak'))).toBe(true);
  });

  it('(c) partial cron.add failure → no archive (retry next launch)', async () => {
    seedCronFile('jobs.json.bak', { version: 1, jobs: [makeJob({ id: 'a', name: 'A' }), makeJob({ id: 'b', name: 'B' })] });
    const rpc = vi.fn();
    rpc.mockResolvedValueOnce({ jobs: [] }); // cron.list
    rpc.mockRejectedValueOnce(new Error('rpc boom')); // cron.add A fails
    rpc.mockResolvedValueOnce({ id: 'new-b' }); // cron.add B ok

    await migrateLegacyCronJobs(makeGatewayManager(rpc));

    expect(existsSync(join(openclawDir, 'cron', 'legacy-archive'))).toBe(false);
    expect(existsSync(join(openclawDir, 'cron', 'jobs.json.bak'))).toBe(true);
  });

  it('(d) dedupe key already present → skip cron.add, still archive', async () => {
    seedCronFile('jobs.json.bak', { version: 1, jobs: [makeJob({ id: 'a', name: 'A' })] });
    const rpc = vi.fn();
    rpc.mockResolvedValueOnce({ jobs: [makeJob({ id: 'existing', name: 'A' })] }); // cron.list has same name+schedule

    await migrateLegacyCronJobs(makeGatewayManager(rpc));

    expect(rpc).toHaveBeenCalledTimes(1); // only cron.list, no cron.add
    expect(existsSync(join(openclawDir, 'cron', 'legacy-archive'))).toBe(true);
    expect(existsSync(join(openclawDir, 'cron', 'jobs.json.bak'))).toBe(false);
  });

  it('(e) source files with only managed-by jobs → archive, no cron.add', async () => {
    seedCronFile('jobs.json.bak', {
      version: 1,
      jobs: [makeJob({ id: 'm', name: 'Internal', description: '[managed-by=x] y' })],
    });
    const rpc = vi.fn().mockResolvedValue({ jobs: [] });

    await migrateLegacyCronJobs(makeGatewayManager(rpc));

    expect(rpc).toHaveBeenCalledWith('cron.list', { includeDisabled: true }, 8000);
    expect(rpc).not.toHaveBeenCalledWith('cron.add', expect.anything(), expect.anything());
    expect(existsSync(join(openclawDir, 'cron', 'legacy-archive'))).toBe(true);
    expect(existsSync(join(openclawDir, 'cron', 'jobs.json.bak'))).toBe(false);
  });
});

describe('archiveLegacyCronFiles', () => {
  beforeEach(() => {
    openclawDir = mkdtempSync(join(tmpdir(), 'clawx-cron-'));
    mkdirSync(join(openclawDir, 'cron'), { recursive: true });
  });

  it('moves all existing legacy files and leaves runs/ untouched', () => {
    mkdirSync(join(openclawDir, 'cron', 'runs'), { recursive: true });
    writeFileSync(join(openclawDir, 'cron', 'jobs.json.bak'), '{"version":1,"jobs":[]}');
    writeFileSync(join(openclawDir, 'cron', 'jobs-state.json'), '{}');
    writeFileSync(join(openclawDir, 'cron', 'runs', 'abc.jsonl'), 'log-line');

    archiveLegacyCronFiles(join(openclawDir, 'cron'), 'ts');

    expect(existsSync(join(openclawDir, 'cron', 'jobs.json.bak'))).toBe(false);
    expect(existsSync(join(openclawDir, 'cron', 'jobs-state.json'))).toBe(false);
    expect(existsSync(join(openclawDir, 'cron', 'legacy-archive', 'ts', 'jobs.json.bak'))).toBe(true);
    expect(existsSync(join(openclawDir, 'cron', 'legacy-archive', 'ts', 'jobs-state.json'))).toBe(true);
    expect(existsSync(join(openclawDir, 'cron', 'runs', 'abc.jsonl'))).toBe(true);
  });
});
