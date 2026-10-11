import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { downloadRelease, getDownloadProxy } from '../../scripts/download-release.mjs';

const cacheRoots: string[] = [];
afterEach(async () => {
  for (const root of cacheRoots.splice(0)) await rm(root, { recursive: true, force: true });
});

it('reuses integrity-checked release archives offline and supplements changed versions', async () => {
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'yyclaw-release-cache-'));
  cacheRoots.push(cacheDir);
  const first = Buffer.from('version-one');
  const second = Buffer.from('version-two');
  const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(first)).mockResolvedValueOnce(new Response(second));
  const options = { cacheDir, env: {}, fetchImpl, run: vi.fn(), pause: async () => {} };
  const firstHash = createHash('sha256').update(first).digest('hex');
  expect(await downloadRelease('https://example.com/v1/asset-arm64', { ...options, sha256: firstHash })).toEqual(first);
  expect(await downloadRelease('https://example.com/v1/asset-arm64', { ...options, sha256: firstHash })).toEqual(first);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(await downloadRelease('https://example.com/v2/asset-arm64', options)).toEqual(second);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect((await readdir(cacheDir)).filter((file) => file.endsWith('.asset'))).toHaveLength(2);
});

it('rejects corrupted or incomplete binary caches and reacquires the archive', async () => {
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'yyclaw-release-integrity-'));
  cacheRoots.push(cacheDir);
  const url = 'https://example.com/v1/asset-x64';
  const buffer = Buffer.from('verified-binary');
  const fetchImpl = vi.fn().mockImplementation(async () => new Response(buffer));
  const options = { cacheDir, env: {}, fetchImpl, run: vi.fn(), pause: async () => {} };
  await downloadRelease(url, options);
  const key = createHash('sha256').update(url).digest('hex');
  await writeFile(path.join(cacheDir, `${key}.asset`), 'corrupted');
  expect(await downloadRelease(url, options)).toEqual(buffer);
  await rm(path.join(cacheDir, `${key}.json`));
  expect(await downloadRelease(url, options)).toEqual(buffer);
  expect(fetchImpl).toHaveBeenCalledTimes(3);
  expect(JSON.parse(await readFile(path.join(cacheDir, `${key}.json`), 'utf8')).bytes).toBe(buffer.length);
  await expect(downloadRelease(url, { ...options, sha256: '0'.repeat(64) })).rejects.toThrow('checksum mismatch');
  expect((await readdir(cacheDir)).some((file) => file.endsWith('.tmp'))).toBe(false);
});

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
