import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const runFile = promisify(execFile);

export function getDownloadProxy(env = process.env) {
  return [env.HTTPS_PROXY, env.https_proxy, env.HTTP_PROXY, env.http_proxy,
    env.all_proxy, env.ALL_PROXY].find((value) => /^https?:\/\//i.test(value || '')) || null;
}

export async function downloadRelease(url, options = {}) {
  const cacheDir = options.cacheDir ?? (options.env ?? process.env).YYCLAW_RELEASE_CACHE_DIR;
  const expectedSha256 = options.sha256;
  const checksum = (buffer) => createHash('sha256').update(buffer).digest('hex');
  if (!cacheDir) {
    const buffer = await fetchRelease(url, options);
    if (expectedSha256 && checksum(buffer) !== expectedSha256) throw new Error('Release archive checksum mismatch');
    return buffer;
  }
  if (!path.isAbsolute(cacheDir)) throw new Error('Release cache directory must be absolute');
  const key = checksum(url);
  const assetPath = path.join(cacheDir, `${key}.asset`);
  const receiptPath = path.join(cacheDir, `${key}.json`);
  await mkdir(cacheDir, { recursive: true, mode: 0o700 });
  if ((await lstat(cacheDir)).isSymbolicLink()) throw new Error('Symlinked release cache is forbidden');
  try {
    for (const file of [assetPath, receiptPath]) if (!(await lstat(file)).isFile()) throw new Error('Release cache entries must be regular files');
    const [buffer, receipt] = await Promise.all([readFile(assetPath), readFile(receiptPath, 'utf8').then(JSON.parse)]);
    const digest = checksum(buffer);
    if (buffer.length && receipt?.schemaVersion === 1 && receipt.sha256 === digest && receipt.bytes === buffer.length && (!expectedSha256 || expectedSha256 === digest)) return buffer;
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
      for (const file of [assetPath, receiptPath]) {
        const info = await lstat(file).catch((failure) => { if (failure.code !== 'ENOENT') throw failure; });
        if (info && !info.isFile()) throw new Error('Unsafe release cache entry; refusing replacement');
      }
    }
  }
  const buffer = await fetchRelease(url, options);
  const digest = checksum(buffer);
  if (!buffer.length || expectedSha256 && digest !== expectedSha256) throw new Error('Release archive checksum mismatch or empty download');
  const temporary = `${assetPath}.${randomUUID()}.tmp`;
  const temporaryReceipt = `${temporary}.json`;
  try {
    await writeFile(temporary, buffer, { mode: 0o600 });
    await writeFile(temporaryReceipt, JSON.stringify({ schemaVersion: 1, sha256: digest, bytes: buffer.length }), { mode: 0o600 });
    await rename(temporary, assetPath);
    await rename(temporaryReceipt, receiptPath);
  } finally {
    await rm(temporary, { force: true });
    await rm(temporaryReceipt, { force: true });
  }
  return buffer;
}

async function fetchRelease(url, {
  fetchImpl = globalThis.fetch, run = runFile, env = process.env,
  pause = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
} = {}) {
  const proxy = getDownloadProxy(env);
  let agent;
  let failure;
  try {
    if (proxy) {
      const { fetch, ProxyAgent } = await import('undici');
      fetchImpl = fetch;
      agent = new ProxyAgent(proxy);
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetchImpl(url, {
          signal: AbortSignal.timeout(120_000),
          ...(agent ? { dispatcher: agent } : {}),
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }
        return Buffer.from(await response.arrayBuffer());
      } catch (error) {
        failure = error;
        if (attempt < 2) await pause(1000 * (attempt + 1));
      }
    }
  } catch (error) {
    failure = error;
  } finally {
    await agent?.close();
  }
  try {
    const args = ['--fail', '--location', '--silent', '--show-error',
      '--connect-timeout', '15', '--max-time', '180', '--retry', '2'];
    if (proxy) args.push('--proxy', proxy);
    args.push(url);
    const { stdout } = await run(process.platform === 'win32' ? 'curl.exe' : 'curl', args, {
      encoding: 'buffer', maxBuffer: 256 * 1024 * 1024, timeout: 600_000, env,
    });
    return Buffer.from(stdout);
  } catch (error) {
    throw new Error(`Download failed: ${url}. Check GitHub connectivity or set HTTPS_PROXY to your HTTP proxy address.`,
      { cause: new AggregateError([failure, error], 'fetch and curl failed') });
  }
}
