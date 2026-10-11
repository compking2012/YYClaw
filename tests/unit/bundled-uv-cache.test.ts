import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { inspectUvBinary, reuseBundledUv } from '../../scripts/bundled-uv-cache.mjs';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'yyclaw-uv-cache-')));
  roots.push(root);
  const repo = path.join(root, 'primary');
  const workspace = path.join(root, 'task');
  const cacheDir = path.join(root, 'cache');
  const source = path.join(repo, 'resources/bin/darwin-arm64/uv');
  const buffer = Buffer.alloc(64);
  buffer.writeUInt32LE(0xfeedfacf, 0);
  buffer.writeUInt32LE(0x0100000c, 4);
  await mkdir(path.dirname(source), { recursive: true });
  await writeFile(source, buffer);
  await mkdir(path.join(workspace, 'scripts'), { recursive: true });
  await writeFile(path.join(workspace, 'scripts/download-bundled-uv.mjs'), "const UV_VERSION = '0.10.0';\n");
  const execute = vi.fn(async () => ({ stdout: 'uv 0.10.0 (test-build)\n' }));
  const options = { repo, workspace, cacheDir, platform: 'darwin', arch: 'arm64', execute };
  return { root, repo, workspace, cacheDir, source, buffer, execute, options };
}

it('copies healthy native uv into persistent cache and separate task outputs without network or shared writable binaries', async () => {
  const { root, source, workspace, cacheDir, buffer, options } = await fixture();
  expect(await reuseBundledUv(options)).toMatchObject({ status: 'reused', source: 'primary-workspace', version: '0.10.0', target: 'darwin-arm64' });
  const output = path.join(workspace, 'resources/bin/darwin-arm64/uv');
  expect(await readFile(output)).toEqual(buffer);
  expect(await readFile(path.join(workspace, 'resources/bin/darwin-arm64/.version'), 'utf8')).toBe('0.10.0');
  await writeFile(output, 'task-only modification');
  expect(await readFile(source)).toEqual(buffer);
  expect(await readFile(path.join(cacheDir, 'installed-uv/0.10.0/darwin-arm64/uv'))).toEqual(buffer);
  const next = path.join(root, 'second-task');
  await mkdir(path.join(next, 'scripts'), { recursive: true });
  await writeFile(path.join(next, 'scripts/download-bundled-uv.mjs'), "const UV_VERSION = '0.10.0';\n");
  await rm(source);
  await rm(workspace, { recursive: true });
  expect(await reuseBundledUv({ ...options, workspace: next })).toMatchObject({ status: 'reused', source: 'persistent-cache' });
  expect(await readFile(path.join(next, 'resources/bin/darwin-arm64/uv'))).toEqual(buffer);
});

it('rejects mismatched versions, corrupt binaries, wrong architectures and symlinks without disabling required download', async () => {
  const { root, source, buffer, execute, options } = await fixture();
  execute.mockResolvedValueOnce({ stdout: 'uv 0.9.0\n' });
  expect(await reuseBundledUv(options)).toMatchObject({ status: 'download-required' });
  const wrongArch = Buffer.from(buffer);
  wrongArch.writeUInt32LE(0x01000007, 4);
  await writeFile(source, wrongArch);
  expect(await reuseBundledUv(options)).toMatchObject({ status: 'download-required' });
  await writeFile(source, 'corrupt');
  expect(await reuseBundledUv(options)).toMatchObject({ status: 'download-required' });
  const foreign = path.join(root, 'foreign-uv');
  await writeFile(foreign, buffer);
  await rm(source);
  await symlink(foreign, source);
  expect(await reuseBundledUv(options)).toMatchObject({ status: 'download-required' });
  expect(await inspectUvBinary(source, '0.10.0', options)).toBeNull();
});

it('repopulates a corrupted persistent entry only from a verified matching primary binary', async () => {
  const { source, cacheDir, buffer, options } = await fixture();
  await reuseBundledUv(options);
  const cached = path.join(cacheDir, 'installed-uv/0.10.0/darwin-arm64/uv');
  await writeFile(cached, 'broken');
  expect(await reuseBundledUv(options)).toMatchObject({ status: 'reused', source: 'primary-workspace' });
  expect(await readFile(cached)).toEqual(buffer);
  await writeFile(cached, 'broken-again');
  await rm(source);
  expect(await reuseBundledUv(options)).toMatchObject({ status: 'download-required' });
});

it('uses the frozen workspace uv version and rejects a symlinked cache directory', async () => {
  const { root, workspace, cacheDir, options } = await fixture();
  await writeFile(path.join(workspace, 'scripts/download-bundled-uv.mjs'), "const UV_VERSION = '0.11.0';\n");
  expect(await reuseBundledUv(options)).toMatchObject({ status: 'download-required', version: '0.11.0' });
  await writeFile(path.join(workspace, 'scripts/download-bundled-uv.mjs'), "const UV_VERSION = '0.10.0';\n");
  await mkdir(path.join(root, 'foreign-cache'));
  await symlink(path.join(root, 'foreign-cache'), cacheDir, 'dir');
  await expect(reuseBundledUv(options)).rejects.toThrow('Symlinked');
  expect(await readdir(path.join(root, 'foreign-cache'))).toEqual([]);
});
