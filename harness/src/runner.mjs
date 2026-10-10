import { spawn } from 'node:child_process';
import { mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './specs.mjs';

export async function runStep(step, options = {}) {
  const started = Date.now();
  let log;
  if (options.logPath) {
    await mkdir(path.dirname(options.logPath), { recursive: true });
    log = await open(options.logPath, 'a');
  }
  return await new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let timer;
    let killTimer;
    const finish = async (exitCode, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      options.signal?.removeEventListener('abort', terminate);
      if (child.pid && process.platform !== 'win32') {
        try { process.kill(-child.pid, 'SIGKILL'); } catch {}
      }
      try { await registration; await options.onExit?.(child); } catch (failure) { error ??= failure; }
      await log?.close();
      resolve({ ...step, status: exitCode === 0 && !timedOut && !options.signal?.aborted && !error ? 'pass' : 'fail', exitCode, durationMs: Date.now() - started,
        ...(error ? { error: error.message } : {}), ...(timedOut ? { error: 'Command timed out' } : {}),
        ...(options.signal?.aborted ? { error: 'Command cancelled' } : {}), ...(options.logPath ? { logPath: options.logPath } : {}),
      });
    };
    const terminate = () => {
      if (!child.pid || settled) return;
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
        killTimer = setTimeout(() => {
          try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
        }, 2000);
      }
    };
    const pnpmEntry = process.env.npm_execpath;
    const useNodePnpm = step.command === 'pnpm' && pnpmEntry && /pnpm.*\.[cm]?js$/.test(pnpmEntry);
    const child = spawn(useNodePnpm ? process.execPath : step.command, useNodePnpm ? [pnpmEntry, ...step.args] : step.args, {
      cwd: options.cwd ?? ROOT,
      env: options.env ?? process.env,
      stdio: options.input !== undefined ? ['pipe', log ? log.fd : 'inherit', log ? log.fd : 'inherit'] : log ? ['ignore', log.fd, log.fd] : 'inherit',
      shell: false,
      detached: process.platform !== 'win32',
    });
    const registration = Promise.resolve(options.onSpawn?.(child));
    registration.catch((error) => { terminate(); void finish(null, error); });
    if (options.input !== undefined) {
      child.stdin.on('error', () => {});
      child.stdin.end(options.input);
    }
    child.on('error', (error) => void finish(null, error));
    child.on('close', (exitCode) => void finish(exitCode));
    options.signal?.addEventListener('abort', terminate, { once: true });
    if (options.signal?.aborted) terminate();
    timer = setTimeout(() => { timedOut = true; terminate(); }, options.timeoutMs ?? 20 * 60 * 1000);
  });
}
