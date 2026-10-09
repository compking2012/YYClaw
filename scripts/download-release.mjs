import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const runFile = promisify(execFile);

export function getDownloadProxy(env = process.env) {
  return [env.HTTPS_PROXY, env.https_proxy, env.HTTP_PROXY, env.http_proxy,
    env.all_proxy, env.ALL_PROXY].find((value) => /^https?:\/\//i.test(value || '')) || null;
}

export async function downloadRelease(url, {
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
