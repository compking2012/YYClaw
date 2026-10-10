import { appendFile, mkdir, readFile, rename, writeFile, open, rm, lstat } from 'node:fs/promises';
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
    const handle = await open(lockPath, 'wx').catch(async (error) => {
      if (error.code !== 'EEXIST') throw error;
      const prior = JSON.parse(await readFile(lockPath, 'utf8'));
      try { process.kill(prior.pid, 0); } catch (failure) {
        if (failure.code !== 'ESRCH') throw failure;
        await rm(lockPath);
        return await open(lockPath, 'wx');
      }
      throw new Error('This run already has an active runner');
    });
    const nonce = randomUUID();
    await handle.writeFile(JSON.stringify({ pid: process.pid, nonce }));
    await handle.close();
    return async () => {
      const value = JSON.parse(await readFile(lockPath, 'utf8').catch(() => '{}'));
      if (value.nonce === nonce) await rm(lockPath, { force: true });
    };
  }

  async cancelled() {
    return await lstat(path.join(this.dir, 'cancel')).then(() => true, (error) => {
      if (error.code !== 'ENOENT') throw error;
      return false;
    });
  }
}
