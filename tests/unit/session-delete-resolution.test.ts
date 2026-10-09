/**
 * Regression tests for the "Cannot resolve file / deleted session resurrects" bug.
 *
 * Two root causes are covered here:
 *   1. `deleteSession` derived the storage dir from the key's agent segment
 *      (`agent:ceo:...` → `agents/ceo/`), but the Gateway can persist a session
 *      under a *different* runtime-bound agent dir (`agents/ceo1/`). The delete
 *      then read the wrong sessions.json, resolved nothing, and bailed —
 *      leaving the entry on disk (and resurrecting it after restart).
 *   2. The delete never went through the Gateway's `sessions.delete` RPC, so a
 *      disk edit made while the Gateway ran got rewritten from its in-memory
 *      cache.
 *
 * The fix: prefer the Gateway RPC when connected; when offline, locate the
 * sessions.json that actually holds the key (scanning every agent dir) and
 * resolve stale absolute `sessionFile` entries by sessionId inside the correct
 * dir.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GatewayManager } from '@electron/gateway/manager';

let openclawDir: string;
const { abortRunMock, discardRunMock, writeFileMock, readFileMock, readdirMock } = vi.hoisted(() => ({
  abortRunMock: vi.fn(),
  discardRunMock: vi.fn(),
  writeFileMock: vi.fn(),
  readFileMock: vi.fn(),
  readdirMock: vi.fn(),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  writeFileMock.mockImplementation(actual.writeFile);
  readFileMock.mockImplementation(actual.readFile);
  readdirMock.mockImplementation(actual.readdir);
  return { ...actual, writeFile: writeFileMock, readFile: readFileMock, readdir: readdirMock };
});

vi.mock('@electron/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: () => openclawDir,
  resolveOpenClawStateDir: () => openclawDir,
}));
vi.mock('@electron/workflow', () => ({
  getWorkflowEngine: () => ({ abort: abortRunMock, discardRun: discardRunMock }),
}));

import { createSessionsApi } from '@electron/services/sessions-api';
import { resolveSessionTranscriptPath } from '@electron/utils/session-files';

function makeManager(connected: boolean, rpc = vi.fn()): GatewayManager {
  return { isConnected: () => connected, rpc } as unknown as GatewayManager;
}

describe('resolveSessionTranscriptPath — stale sessionFile robustness', () => {
  const sessionsDir = '/root/agents/ceo1/sessions';
  const key = 'agent:ceo:session-1';

  it('recovers by sessionId when the absolute sessionFile points at the old agent dir', () => {
    const json = {
      [key]: {
        // stale absolute path left behind by an agent rename/clone (points at ceo, not ceo1)
        sessionFile: '/root/agents/ceo/sessions/81300c46.jsonl',
        sessionId: '81300c46',
      },
    };
    const res = resolveSessionTranscriptPath(json, sessionsDir, key);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.resolvedSrcPath).toBe(join(sessionsDir, '81300c46.jsonl'));
      expect(res.baseId).toBe('81300c46');
    }
  });

  it('uses an in-scope absolute sessionFile verbatim', () => {
    const json = { [key]: { sessionFile: join(sessionsDir, 'abc.jsonl') } };
    const res = resolveSessionTranscriptPath(json, sessionsDir, key);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.resolvedSrcPath).toBe(join(sessionsDir, 'abc.jsonl'));
  });

  it('still refuses an out-of-scope path when no sessionId is available', () => {
    const json = { [key]: { sessionFile: '/root/agents/ceo/sessions/abc.jsonl' } };
    const res = resolveSessionTranscriptPath(json, sessionsDir, key);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.failure.kind).toBe('path-outside-scope');
  });
});

describe('sessions-api deleteSession', () => {
  beforeEach(() => {
    openclawDir = mkdtempSync(join(tmpdir(), 'clawx-session-delete-'));
    abortRunMock.mockReset();
    discardRunMock.mockReset();
    writeFileMock.mockClear();
    readFileMock.mockClear();
    readdirMock.mockClear();
  });

  it('preserves workflow snapshots and child sessions when parent deletion fails', async () => {
    const key = 'agent:ceo:session-missing';
    const childKey = 'agent:ceo:wf:run-kept:step';
    const sessionsDir = join(openclawDir, 'agents', 'ceo', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    const indexPath = join(sessionsDir, 'sessions.json');
    writeFileSync(indexPath, JSON.stringify({ [key]: { sessionId: 'parent' }, [childKey]: { sessionId: 'child' } }));
    writeFileMock.mockRejectedValueOnce(new Error('parent index locked'));
    const api = createSessionsApi({ gatewayManager: makeManager(false) });

    const result = await api.delete({ id: key, workflowRunIds: ['run-kept'] });

    expect(result.success).toBe(false);
    expect(abortRunMock).toHaveBeenCalledWith('run-kept');
    expect(discardRunMock).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync(indexPath, 'utf8'))[childKey]).toBeDefined();
  });

  it('does not delete the parent when stopping the workflow fails', async () => {
    abortRunMock.mockImplementation(() => { throw new Error('stop failed'); });
    const rpc = vi.fn().mockResolvedValue({});
    const api = createSessionsApi({ gatewayManager: makeManager(true, rpc) });

    const result = await api.delete({ id: 'agent:ceo:session-parent', workflowRunIds: ['run-kept'] });

    expect(result.success).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    expect(discardRunMock).not.toHaveBeenCalled();
  });

  it('preserves parent transcript and children when offline parent index removal fails', async () => {
    const key = 'agent:ceo:session-parent';
    const childKey = 'agent:ceo:wf:run-kept:step';
    const sessionsDir = join(openclawDir, 'agents', 'ceo', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    const indexPath = join(sessionsDir, 'sessions.json');
    writeFileSync(indexPath, JSON.stringify({ [key]: { sessionId: 'parent' }, [childKey]: { sessionId: 'child' } }));
    writeFileSync(join(sessionsDir, 'parent.jsonl'), 'parent');
    writeFileSync(join(sessionsDir, 'child.jsonl'), 'child');
    writeFileMock.mockRejectedValueOnce(new Error('index locked'));
    const api = createSessionsApi({ gatewayManager: makeManager(false) });

    const result = await api.delete({ id: key, workflowRunIds: ['run-kept'] });

    expect(result.success).toBe(false);
    expect(discardRunMock).not.toHaveBeenCalled();
    expect(existsSync(join(sessionsDir, 'parent.jsonl'))).toBe(true);
    expect(existsSync(join(sessionsDir, 'child.jsonl'))).toBe(true);
    expect(JSON.parse(readFileSync(indexPath, 'utf8'))[key]).toBeDefined();
  });

  it('stops runs before deleting the parent and only then removes online children and snapshots', async () => {
    const key = 'agent:ceo:session-parent';
    const childKey = 'agent:ceo:wf:run-cleaned:step';
    const order: string[] = [];
    abortRunMock.mockImplementation(() => order.push('abort'));
    discardRunMock.mockImplementation(() => order.push('discard'));
    const rpc = vi.fn(async (method: string, payload: { key?: string }) => {
      if (method === 'sessions.delete') order.push(payload.key === key ? 'parent' : 'child');
      if (method === 'sessions.list') return { sessions: [{ key: childKey }] };
      return {};
    });
    const api = createSessionsApi({ gatewayManager: makeManager(true, rpc) });

    await expect(api.delete({ id: key, workflowRunIds: ['run-cleaned'] })).resolves.toEqual({ success: true });
    expect(order).toEqual(['abort', 'parent', 'child', 'discard']);
  });

  it('reports successful deletion with warnings when child or snapshot cleanup fails', async () => {
    const key = 'agent:ceo:session-parent';
    const childKey = 'agent:ceo:wf:run-partial:step';
    discardRunMock.mockImplementation(() => { throw new Error('snapshot locked'); });
    const rpc = vi.fn(async (method: string, payload: { key?: string }) => {
      if (method === 'sessions.list') return { sessions: [{ key: childKey }] };
      if (method === 'sessions.delete' && payload.key === childKey) throw new Error('child locked');
      return {};
    });
    const api = createSessionsApi({ gatewayManager: makeManager(true, rpc) });

    const result = await api.delete({ id: key, workflowRunIds: ['run-partial'] });

    expect(result.success).toBe(true);
    expect(result.warnings).toEqual([
      expect.stringContaining('child locked'),
      expect.stringContaining('snapshot locked'),
    ]);
  });

  it('returns a warning instead of failure when the Gateway deleted the parent but index cleanup fails', async () => {
    const key = 'agent:ceo:session-parent';
    const sessionsDir = join(openclawDir, 'agents', 'ceo', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, 'sessions.json'), JSON.stringify({ [key]: { sessionId: 'parent' } }));
    writeFileMock.mockRejectedValueOnce(new Error('index locked'));
    const api = createSessionsApi({ gatewayManager: makeManager(true, vi.fn().mockResolvedValue({})) });

    const result = await api.delete({ id: key });

    expect(result.success).toBe(true);
    expect(result.warnings).toEqual([expect.stringContaining('index locked')]);
  });

  it('cleans offline children only after the parent index write succeeds', async () => {
    const key = 'agent:ceo:session-parent';
    const childKey = 'agent:ceo:wf:run-cleaned:step';
    const sessionsDir = join(openclawDir, 'agents', 'ceo', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    const indexPath = join(sessionsDir, 'sessions.json');
    writeFileSync(indexPath, JSON.stringify({ [key]: { sessionId: 'parent' }, [childKey]: { sessionId: 'child' } }));
    writeFileSync(join(sessionsDir, 'child.jsonl'), 'child');
    writeFileMock.mockImplementationOnce(async (path, content) => {
      expect(JSON.parse(String(content))[key]).toBeUndefined();
      expect(JSON.parse(String(content))[childKey]).toBeDefined();
      expect(existsSync(join(sessionsDir, 'child.jsonl'))).toBe(true);
      writeFileSync(path, content);
    });
    const api = createSessionsApi({ gatewayManager: makeManager(false) });

    const result = await api.delete({ id: key, workflowRunIds: ['run-cleaned'] });

    expect(result).toEqual({ success: true });
    expect(existsSync(join(sessionsDir, 'child.jsonl'))).toBe(false);
    expect(JSON.parse(readFileSync(indexPath, 'utf8'))[childKey]).toBeUndefined();
    expect(discardRunMock).toHaveBeenCalledWith('run-cleaned');
  });

  it('routes through the Gateway sessions.delete RPC when connected (no disk needed)', async () => {
    const rpc = vi.fn().mockResolvedValue({});
    const api = createSessionsApi({ gatewayManager: makeManager(true, rpc) });

    const res = await api.delete({ id: 'agent:ceo:session-9' });

    expect(res).toEqual({ success: true });
    expect(rpc).toHaveBeenCalledWith('sessions.delete', {
      key: 'agent:ceo:session-9',
      deleteTranscript: true,
    });
  });

  it('sweeps the orphaned store even when the Gateway RPC "succeeds" as a no-op', async () => {
    // Repro of the real bug: `sessions.list` globs an orphaned dir (`ceo1`) the
    // Gateway no longer writes to, but `sessions.delete("agent:ceo:...")`
    // resolves to the active `ceo` store, finds nothing, and returns success —
    // leaving the entry on disk so it reappears after restart. The disk sweep
    // must run *after* the successful RPC and remove it from `ceo1`.
    const key = 'agent:ceo:session-9';
    const ceo1Dir = join(openclawDir, 'agents', 'ceo1', 'sessions');
    mkdirSync(ceo1Dir, { recursive: true });
    const transcript = join(ceo1Dir, 'abc123.jsonl');
    writeFileSync(transcript, '{"type":"assistant"}\n');
    const sessionsJsonPath = join(ceo1Dir, 'sessions.json');
    writeFileSync(sessionsJsonPath, JSON.stringify({ [key]: { sessionId: 'abc123' } }, null, 2));

    const rpc = vi.fn().mockResolvedValue({}); // gateway reports success (no-op)
    const api = createSessionsApi({ gatewayManager: makeManager(true, rpc) });
    const res = await api.delete({ id: key });

    expect(res).toEqual({ success: true });
    expect(rpc).toHaveBeenCalled();
    expect(existsSync(transcript)).toBe(false);
    const after = JSON.parse(readFileSync(sessionsJsonPath, 'utf8')) as Record<string, unknown>;
    expect(after[key]).toBeUndefined();
  });

  it('offline: deletes across the wrong agent dir and by stale sessionId', async () => {
    // Key says `ceo`, but the session actually lives under `ceo1` — and its
    // stored sessionFile still points at the old `ceo` dir.
    const key = 'agent:ceo:session-9';
    const ceo1Dir = join(openclawDir, 'agents', 'ceo1', 'sessions');
    mkdirSync(ceo1Dir, { recursive: true });
    const transcript = join(ceo1Dir, 'abc123.jsonl');
    writeFileSync(transcript, '{"type":"assistant"}\n');
    const sessionsJsonPath = join(ceo1Dir, 'sessions.json');
    writeFileSync(sessionsJsonPath, JSON.stringify({
      [key]: {
        sessionId: 'abc123',
        sessionFile: join(openclawDir, 'agents', 'ceo', 'sessions', 'abc123.jsonl'),
      },
    }, null, 2));

    const api = createSessionsApi({ gatewayManager: makeManager(false) });
    const res = await api.delete({ id: key });

    expect(res).toEqual({ success: true });
    expect(existsSync(transcript)).toBe(false);
    const after = JSON.parse(readFileSync(sessionsJsonPath, 'utf8')) as Record<string, unknown>;
    expect(after[key]).toBeUndefined();
  });

  it('offline: removes metadata without deleting an out-of-scope transcript', async () => {
    const key = 'agent:ceo:session-outside';
    const sessionsDir = join(openclawDir, 'agents', 'ceo', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    const externalFile = join(openclawDir, 'external.jsonl');
    writeFileSync(externalFile, 'must remain');
    const indexPath = join(sessionsDir, 'sessions.json');
    writeFileSync(indexPath, JSON.stringify({ [key]: { sessionFile: externalFile } }));

    const api = createSessionsApi({ gatewayManager: makeManager(false) });
    await expect(api.delete({ id: key })).resolves.toEqual({ success: true });
    expect(readFileSync(externalFile, 'utf8')).toBe('must remain');
    expect(JSON.parse(readFileSync(indexPath, 'utf8'))[key]).toBeUndefined();
  });

  it('offline: removes metadata when the transcript has already disappeared', async () => {
    const key = 'agent:ceo:session-absent';
    const sessionsDir = join(openclawDir, 'agents', 'ceo', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    const indexPath = join(sessionsDir, 'sessions.json');
    writeFileSync(indexPath, JSON.stringify({ [key]: { sessionId: 'absent' } }));

    const api = createSessionsApi({ gatewayManager: makeManager(false) });
    await expect(api.delete({ id: key })).resolves.toEqual({ success: true });
    expect(JSON.parse(readFileSync(indexPath, 'utf8'))[key]).toBeUndefined();
  });

  it('offline: succeeds when no agent directory holds the key', async () => {
    mkdirSync(join(openclawDir, 'agents', 'ceo1', 'sessions'), { recursive: true });
    writeFileSync(join(openclawDir, 'agents', 'ceo1', 'sessions', 'sessions.json'), JSON.stringify({}));

    const api = createSessionsApi({ gatewayManager: makeManager(false) });
    const res = await api.delete({ id: 'agent:ceo:session-missing' });

    expect(res).toEqual({ success: true });
  });

  it('offline: succeeds when the entire agent index directory is absent', async () => {
    const api = createSessionsApi({ gatewayManager: makeManager(false) });
    await expect(api.delete({ id: 'agent:ceo:session-missing' })).resolves.toEqual({ success: true });
  });

  it('offline: does not mistake a corrupt alternate index for confirmed absence', async () => {
    const sessionsDir = join(openclawDir, 'agents', 'ceo1', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, 'sessions.json'), '{invalid json');
    const api = createSessionsApi({ gatewayManager: makeManager(false) });
    await expect(api.delete({ id: 'agent:ceo:session-missing' })).resolves.toMatchObject({
      success: false, error: expect.stringContaining('Could not read sessions.json'),
    });
  });

  it('offline: preserves workflow snapshots when an index cannot be read', async () => {
    readFileMock.mockRejectedValueOnce(Object.assign(new Error('index permission denied'), { code: 'EACCES' }));
    const api = createSessionsApi({ gatewayManager: makeManager(false) });
    await expect(api.delete({ id: 'agent:ceo:session-missing', workflowRunIds: ['run-kept'] })).resolves.toMatchObject({
      success: false, error: expect.stringContaining('index permission denied'),
    });
    expect(discardRunMock).not.toHaveBeenCalled();
  });

  it('offline: does not mistake agent enumeration failure for absence', async () => {
    readdirMock.mockRejectedValueOnce(Object.assign(new Error('directory permission denied'), { code: 'EACCES' }));
    const api = createSessionsApi({ gatewayManager: makeManager(false) });
    await expect(api.delete({ id: 'agent:ceo:session-missing' })).resolves.toMatchObject({
      success: false, error: expect.stringContaining('Could not list agent session directories'),
    });
  });

  it('online: reports index corruption as a cleanup warning after successful deletion', async () => {
    const sessionsDir = join(openclawDir, 'agents', 'ceo', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, 'sessions.json'), '{invalid json');
    const rpc = vi.fn().mockResolvedValue({});
    const api = createSessionsApi({ gatewayManager: makeManager(true, rpc) });
    await expect(api.delete({ id: 'agent:ceo:session-parent' })).resolves.toMatchObject({
      success: true, warnings: [expect.stringContaining('Could not read sessions.json')],
    });
  });

  it('offline: repeated deletion does not resurrect the removed index or transcript', async () => {
    const key = 'agent:ceo:session-parent';
    const sessionsDir = join(openclawDir, 'agents', 'ceo', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    const indexPath = join(sessionsDir, 'sessions.json');
    const transcriptPath = join(sessionsDir, 'parent.jsonl');
    writeFileSync(indexPath, JSON.stringify({ [key]: { sessionId: 'parent' } }));
    writeFileSync(transcriptPath, 'parent transcript');
    const api = createSessionsApi({ gatewayManager: makeManager(false) });
    await expect(api.delete({ id: key })).resolves.toEqual({ success: true });
    await expect(api.delete({ id: key })).resolves.toEqual({ success: true });
    expect(JSON.parse(readFileSync(indexPath, 'utf8'))[key]).toBeUndefined();
    expect(existsSync(transcriptPath)).toBe(false);
  });

  it('offline: cleans remaining workflow children when the parent is already absent', async () => {
    const key = 'agent:ceo:session-parent';
    const childKey = 'agent:ceo:wf:run-leftover:step';
    const sessionsDir = join(openclawDir, 'agents', 'ceo1', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    const indexPath = join(sessionsDir, 'sessions.json');
    const childPath = join(sessionsDir, 'child.jsonl');
    writeFileSync(indexPath, JSON.stringify({ [childKey]: { sessionId: 'child' } }));
    writeFileSync(childPath, 'child transcript');
    const api = createSessionsApi({ gatewayManager: makeManager(false) });
    await expect(api.delete({ id: key, workflowRunIds: ['run-leftover'] })).resolves.toEqual({ success: true });
    expect(abortRunMock).toHaveBeenCalledWith('run-leftover');
    expect(discardRunMock).toHaveBeenCalledWith('run-leftover');
    expect(JSON.parse(readFileSync(indexPath, 'utf8'))[childKey]).toBeUndefined();
    expect(existsSync(childPath)).toBe(false);
  });
});
