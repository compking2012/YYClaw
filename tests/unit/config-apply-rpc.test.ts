import { describe, expect, it, vi } from 'vitest';
import {
  applyOpenClawConfigViaGatewayRpc,
  buildConfigApplyParams,
} from '../../electron/gateway/config-apply-rpc';

describe('config-apply-rpc', () => {
  it('buildConfigApplyParams attaches baseHash from config.get snapshot', () => {
    expect(buildConfigApplyParams({ skills: {} }, { hash: 'abc123' })).toEqual({
      raw: JSON.stringify({ skills: {} }),
      baseHash: 'abc123',
    });
  });

  it('buildConfigApplyParams rejects missing hash', () => {
    expect(() => buildConfigApplyParams({ skills: {} }, {})).toThrow(/base hash unavailable/i);
  });

  it('applyOpenClawConfigViaGatewayRpc calls config.get then config.apply with baseHash', async () => {
    const rpc = vi.fn(async (method: string) => {
      if (method === 'config.get') return { hash: 'hash-1', raw: '{}' };
      if (method === 'config.apply') return { ok: true };
      throw new Error(`unexpected ${method}`);
    });
    const readConfig = vi.fn(async () => ({ agents: { list: [] } }));

    await applyOpenClawConfigViaGatewayRpc({ rpc, readConfig });

    expect(readConfig).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenNthCalledWith(1, 'config.get', {}, 15_000);
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      'config.apply',
      {
        raw: JSON.stringify({ agents: { list: [] } }),
        baseHash: 'hash-1',
      },
      30_000,
    );
  });

  it('retries once when config changed since last load', async () => {
    let getCount = 0;
    let applyCount = 0;
    const rpc = vi.fn(async (method: string) => {
      if (method === 'config.get') {
        getCount += 1;
        return { hash: getCount === 1 ? 'h1' : 'h2' };
      }
      if (method === 'config.apply') {
        applyCount += 1;
        if (applyCount === 1) {
          throw new Error('config changed since last load; re-run config.get and retry');
        }
        return { ok: true };
      }
      throw new Error(`unexpected ${method}`);
    });

    await applyOpenClawConfigViaGatewayRpc({
      rpc,
      readConfig: async () => ({ ok: true }),
    });

    expect(getCount).toBe(2);
    expect(applyCount).toBe(2);
    expect(rpc).toHaveBeenCalledWith(
      'config.apply',
      expect.objectContaining({ baseHash: 'h2' }),
      30_000,
    );
  });

  it('full regression path: apply without baseHash is rejected; fixed get→apply with baseHash succeeds', async () => {
    const rpc = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'config.get') return { hash: 'live-hash', raw: '{}' };
      if (method === 'config.apply') {
        // Mirror OpenClaw requireConfigBaseHash: missing baseHash → INVALID_REQUEST.
        if (typeof params?.baseHash !== 'string' || !params.baseHash.trim()) {
          throw new Error('config base hash required; re-run config.get and retry');
        }
        return { ok: true };
      }
      throw new Error(`unexpected ${method}`);
    });

    // Legacy YYClaw call shape that produced the production WARN.
    await expect(rpc('config.apply', { raw: JSON.stringify({ skills: {} }) }, 30_000)).rejects.toThrow(
      /base hash required/i,
    );

    await applyOpenClawConfigViaGatewayRpc({
      rpc,
      readConfig: async () => ({ skills: {} }),
    });

    expect(rpc).toHaveBeenCalledWith('config.get', {}, 15_000);
    expect(rpc).toHaveBeenCalledWith(
      'config.apply',
      {
        raw: JSON.stringify({ skills: {} }),
        baseHash: 'live-hash',
      },
      30_000,
    );
  });

  it('derives baseHash from snapshot.raw when hash field is missing', async () => {
    const raw = '{"agents":{}}';
    const params = buildConfigApplyParams({ agents: {} }, { raw });
    expect(params.baseHash).toMatch(/^[a-f0-9]{64}$/);
    expect(params.raw).toBe(JSON.stringify({ agents: {} }));
  });
});
