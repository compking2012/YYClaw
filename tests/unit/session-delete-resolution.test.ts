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

vi.mock('@electron/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: () => openclawDir,
  resolveOpenClawStateDir: () => openclawDir,
}));
vi.mock('@electron/workflow', () => ({
  getWorkflowEngine: () => ({ discardRun: vi.fn() }),
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

  it('offline: reports failure when no agent dir holds the key', async () => {
    mkdirSync(join(openclawDir, 'agents', 'ceo1', 'sessions'), { recursive: true });
    writeFileSync(join(openclawDir, 'agents', 'ceo1', 'sessions', 'sessions.json'), JSON.stringify({}));

    const api = createSessionsApi({ gatewayManager: makeManager(false) });
    const res = await api.delete({ id: 'agent:ceo:session-missing' });

    expect(res.success).toBe(false);
    expect(res.error).toContain('Cannot resolve file');
  });
});
