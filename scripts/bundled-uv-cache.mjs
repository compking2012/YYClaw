import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const executeFile = promisify(execFile);
const checksum = (buffer) => createHash('sha256').update(buffer).digest('hex');

function matchesTarget(buffer, platform, arch) {
  if (buffer.length < 32 || !['arm64', 'x64'].includes(arch)) return false;
  if (platform === 'darwin') return buffer.readUInt32LE(0) === 0xfeedfacf && buffer.readUInt32LE(4) === (arch === 'arm64' ? 0x0100000c : 0x01000007);
  if (platform === 'linux') return buffer.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) && buffer[4] === 2 && buffer[5] === 1 && buffer.readUInt16LE(18) === (arch === 'arm64' ? 183 : 62);
  if (platform === 'win32' && buffer.length >= 64 && buffer.readUInt16LE(0) === 0x5a4d) {
    const offset = buffer.readUInt32LE(0x3c);
    return offset + 6 <= buffer.length && buffer.readUInt32LE(offset) === 0x00004550 && buffer.readUInt16LE(offset + 4) === (arch === 'arm64' ? 0xaa64 : 0x8664);
  }
  return false;
}

export async function inspectUvBinary(file, version, { platform = process.platform, arch = process.arch, execute = executeFile, env } = {}) {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || await realpath(file) !== path.resolve(file)) return null;
    const buffer = await readFile(file);
    if (!matchesTarget(buffer, platform, arch)) return null;
    const { stdout } = await execute(file, ['--version'], { timeout: 5000, maxBuffer: 4096, env: env ?? { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR } });
    if (stdout.trim().split(/\s+/).slice(0, 2).join(' ') !== `uv ${version}`) return null;
    return { buffer, sha256: checksum(buffer), bytes: buffer.length };
  } catch {
    return null;
  }
}

async function atomicFile(file, buffer, mode) {
  for (let directory = path.dirname(path.resolve(file)); ; directory = path.dirname(directory)) {
    const info = await lstat(directory).catch((error) => { if (error.code !== 'ENOENT') throw error; return null; });
    if (info && (info.isSymbolicLink() || !info.isDirectory())) throw new Error('Symlinked uv cache or destination is forbidden');
    if (directory === path.dirname(directory)) break;
  }
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  if (await realpath(path.dirname(file)) !== path.resolve(path.dirname(file))) throw new Error('Symlinked uv cache or destination is forbidden');
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, buffer, { mode, flag: 'wx' });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function reuseBundledUv({ repo, workspace, cacheDir, platform = process.platform, arch = process.arch, execute = executeFile, env }) {
  const script = await readFile(path.join(workspace, 'scripts/download-bundled-uv.mjs'), 'utf8').catch((error) => { if (error.code !== 'ENOENT') throw error; return ''; });
  const version = script.match(/const UV_VERSION = '([^']+)'/)?.[1];
  if (!version) return { status: 'not-required' };
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version) || !['darwin', 'linux', 'win32'].includes(platform) || !['x64', 'arm64'].includes(arch)) return { status: 'download-required', reason: 'Unsupported uv version or target' };
  const target = `${platform}-${arch}`;
  const name = platform === 'win32' ? 'uv.exe' : 'uv';
  const directory = path.join(cacheDir, 'installed-uv', version, target);
  const binary = path.join(directory, name);
  const receiptFile = path.join(directory, 'receipt.json');
  const options = { platform, arch, execute, env };
  let verified;
  let source = 'persistent-cache';
  try {
    const info = await lstat(receiptFile);
    if (!info.isFile() || info.isSymbolicLink() || await realpath(receiptFile) !== path.resolve(receiptFile)) throw new Error('Unsafe uv cache receipt');
    const receipt = JSON.parse(await readFile(receiptFile, 'utf8'));
    const binaryInfo = await lstat(binary);
    if (!binaryInfo.isFile() || binaryInfo.isSymbolicLink() || await realpath(binary) !== path.resolve(binary)) throw new Error('Unsafe uv cache binary');
    if (receipt.schemaVersion === 1 && receipt.version === version && receipt.target === target && checksum(await readFile(binary)) === receipt.sha256) {
      verified = await inspectUvBinary(binary, version, options);
      if (verified?.bytes !== receipt.bytes) verified = null;
    }
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  if (!verified) {
    const candidate = path.join(repo, 'resources/bin', target, name);
    verified = await inspectUvBinary(candidate, version, options);
    source = 'primary-workspace';
    if (!verified) return { status: 'download-required', version, target, reason: 'No healthy matching local uv binary; required postinstall download remains enabled' };
    await atomicFile(binary, verified.buffer, 0o755);
    await atomicFile(receiptFile, JSON.stringify({ schemaVersion: 1, version, target, sha256: verified.sha256, bytes: verified.bytes }), 0o600);
  }
  const output = path.join(workspace, 'resources/bin', target);
  await atomicFile(path.join(output, name), verified.buffer, 0o755);
  if (!await inspectUvBinary(path.join(output, name), version, options)) throw new Error('Materialized uv binary failed version or platform verification');
  await atomicFile(path.join(output, '.version'), version, 0o600);
  await atomicFile(path.join(output, '.uv-version'), version, 0o600);
  return { status: 'reused', source, version, target, sha256: verified.sha256, bytes: verified.bytes };
}
