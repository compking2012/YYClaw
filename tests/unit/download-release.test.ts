import { expect, it, vi } from 'vitest';
import { downloadRelease, getDownloadProxy } from '../../scripts/download-release.mjs';

it('selects HTTP proxies', () => {
  expect(getDownloadProxy({ HTTPS_PROXY: 'socks5://localhost:1', HTTP_PROXY: 'http://localhost:2' })).toBe('http://localhost:2');
  expect(getDownloadProxy({})).toBeNull();
});

it('retries transient failures', async () => {
  const fetchImpl = vi.fn().mockRejectedValueOnce(new Error('timeout'))
    .mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2]).buffer });
  const run = vi.fn();
  expect(await downloadRelease('https://example.com/asset', { fetchImpl, run, env: {}, pause: async () => {} })).toEqual(Buffer.from([1, 2]));
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(run).not.toHaveBeenCalled();
});

it('falls back to curl', async () => {
  const fetchImpl = vi.fn().mockRejectedValue(new Error('timeout'));
  const run = vi.fn().mockResolvedValue({ stdout: Buffer.from('binary') });
  expect(await downloadRelease('https://example.com/asset', { fetchImpl, run, env: {}, pause: async () => {} })).toEqual(Buffer.from('binary'));
  expect(fetchImpl).toHaveBeenCalledTimes(3);
  expect(run.mock.calls[0][1]).toContain('--fail');
});

it('reports proxy guidance when both transports fail', async () => {
  await expect(downloadRelease('https://example.com/asset', {
    fetchImpl: vi.fn().mockRejectedValue(new Error('timeout')),
    run: vi.fn().mockRejectedValue(new Error('curl failed')),
    env: {}, pause: async () => {},
  })).rejects.toThrow('HTTPS_PROXY');
});
