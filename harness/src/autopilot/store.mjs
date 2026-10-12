import { appendFile, mkdir, readFile, rename, writeFile, link, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export async function atomicJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(temporary, file);
}

export function safeChild(root, name) {
  if (!/^[a-zA-Z0-9-]+$/.test(name)) throw new Error('Invalid resource identity');
  return path.join(root, name);
}

export class RunStore {
  constructor(root, runId) {
    this.root = path.resolve(root);
    this.runId = runId;
    this.dir = safeChild(this.root, runId);
    this.tail = Promise.resolve();
  }

  async read() {
    return JSON.parse(await readFile(path.join(this.dir, 'run.json'), 'utf8'));
  }

  async save(record) {
    const snapshot = structuredClone(record);
    this.tail = this.tail.then(() => atomicJson(path.join(this.dir, 'run.json'), snapshot));
    await this.tail;
  }

  async event(type, detail = {}) {
    await mkdir(this.dir, { recursive: true });
    await appendFile(path.join(this.dir, 'events.jsonl'), JSON.stringify({ at: new Date().toISOString(), type, ...detail }) + '\n', { mode: 0o600 });
  }

  async lock() {
    await mkdir(this.dir, { recursive: true });
    const lockPath = path.join(this.dir, 'runner.lock');
    const recoveryPath = path.join(this.dir, 'runner.recovery');
    const nonce = randomUUID();
    const candidate = path.join(this.dir, `runner-${nonce}.tmp`);
    let acquired = false;
    const busy = () => new Error('This run already has an active runner');
    const exists = async (file) => lstat(file).then(() => true, (error) => {
      if (error.code !== 'ENOENT') throw error;
      return false;
    });
    await writeFile(candidate, JSON.stringify({ pid: process.pid, nonce }), { flag: 'wx', mode: 0o600 });
    try {
      for (let attempt = 0; attempt < 8; attempt++) {
        if (await exists(recoveryPath)) throw busy();
        try {
          await link(candidate, lockPath);
          if (await exists(recoveryPath)) {
            const current = JSON.parse(await readFile(lockPath, 'utf8'));
            if (current.nonce === nonce) await rm(lockPath);
            throw busy();
          }
          acquired = true;
          break;
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
          let prior;
          try {
            if (!(await lstat(lockPath)).isFile()) throw new Error('Invalid runner lease file ownership');
            prior = JSON.parse(await readFile(lockPath, 'utf8'));
          }
          catch (failure) {
            if (failure.code === 'ENOENT') continue;
            throw new Error('Invalid runner lease; manual ownership verification is required', { cause: failure });
          }
          if (!Number.isSafeInteger(prior.pid) || prior.pid <= 0 || typeof prior.nonce !== 'string') throw new Error('Invalid runner lease ownership');
          try { process.kill(prior.pid, 0); throw busy(); }
          catch (failure) { if (failure.code !== 'ESRCH') throw failure; }
          try { await link(candidate, recoveryPath); }
          catch (failure) { if (failure.code === 'EEXIST') throw busy(); throw failure; }
          try {
            const current = JSON.parse(await readFile(lockPath, 'utf8').catch((failure) => {
              if (failure.code !== 'ENOENT') throw failure;
              return '{}';
            }));
            if (current.nonce === prior.nonce && current.pid === prior.pid) await rm(lockPath);
          } finally { await rm(recoveryPath); }
          if (attempt === 7) throw busy();
        }
      }
      if (!acquired) throw busy();
    } finally { await rm(candidate, { force: true }); }
    let releasePromise;
    return () => {
      releasePromise ??= (async () => {
        const value = JSON.parse(await readFile(lockPath, 'utf8').catch((error) => {
          if (error.code !== 'ENOENT') throw error;
          return '{}';
        }));
        if (value.nonce === nonce) await rm(lockPath, { force: true });
      })().catch((error) => { releasePromise = undefined; throw error; });
      return releasePromise;
    };
  }

  async cancelled() {
    return await lstat(path.join(this.dir, 'cancel')).then(() => true, (error) => {
      if (error.code !== 'ENOENT') throw error;
      return false;
    });
  }
}
