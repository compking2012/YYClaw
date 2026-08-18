/**
 * File-backed LangGraph checkpointer (office_store) — persists MemorySaver state per thread.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { MemorySaver } from '@langchain/langgraph';
import { ensureOfficeDirs, getOfficeDataDir } from './paths';

type PersistedThread = {
  storage: Record<string, Record<string, Record<string, unknown[]>>>;
  writes: Record<string, Record<string, unknown[]>>;
};

function checkpointsDir(): string {
  return join(getOfficeDataDir(), 'langgraph-checkpoints');
}

function threadFilePath(threadId: string): string {
  return join(checkpointsDir(), `${encodeURIComponent(threadId)}.json`);
}

export class OfficeLangGraphThreadStore extends MemorySaver {
  private loadedThreads = new Set<string>();
  private persistQueues = new Map<string, Promise<void>>();

  private async ensureLoaded(threadId: string): Promise<void> {
    if (this.loadedThreads.has(threadId)) return;
    await ensureOfficeDirs();
    const filePath = threadFilePath(threadId);
    if (existsSync(filePath)) {
      try {
        const raw = await readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw) as PersistedThread;
        if (parsed.storage && typeof parsed.storage === 'object') {
          Object.assign(this.storage, parsed.storage);
        }
        if (parsed.writes && typeof parsed.writes === 'object') {
          Object.assign(this.writes, parsed.writes);
        }
      } catch (err) {
        console.warn('[office] langgraph checkpoint load failed:', threadId, err);
      }
    }
    this.loadedThreads.add(threadId);
  }

  private async persistThread(threadId: string | undefined): Promise<void> {
    if (!threadId) return;
    const prev = this.persistQueues.get(threadId) ?? Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(async () => {
        try {
          await ensureOfficeDirs();
          const dir = checkpointsDir();
          await mkdir(dir, { recursive: true });
          const payload: PersistedThread = {
            storage: this.storage[threadId] ? { [threadId]: this.storage[threadId] } : {},
            writes: Object.fromEntries(
              Object.entries(this.writes).filter(([key]) => {
                try {
                  const [storedThreadId] = JSON.parse(key) as [string];
                  return storedThreadId === threadId;
                } catch {
                  return false;
                }
              }),
            ),
          };
          const filePath = threadFilePath(threadId);
          await writeFile(filePath, JSON.stringify(payload), 'utf8');
        } catch (err) {
          console.warn('[office] langgraph checkpoint persist failed:', threadId, err);
        }
      });
    this.persistQueues.set(threadId, next);
    await next;
  }

  override async getTuple(config: Parameters<MemorySaver['getTuple']>[0]) {
    const threadId = config.configurable?.thread_id;
    if (threadId) await this.ensureLoaded(threadId);
    return super.getTuple(config);
  }

  override async put(...args: Parameters<MemorySaver['put']>) {
    const result = await super.put(...args);
    const threadId = args[0]?.configurable?.thread_id;
    await this.persistThread(threadId);
    return result;
  }

  override async putWrites(...args: Parameters<MemorySaver['putWrites']>) {
    const result = await super.putWrites(...args);
    const threadId = args[0]?.configurable?.thread_id;
    await this.persistThread(threadId);
    return result;
  }

  override async deleteThread(threadId: string): Promise<void> {
    await super.deleteThread(threadId);
    this.loadedThreads.delete(threadId);
    const filePath = threadFilePath(threadId);
    if (existsSync(filePath)) {
      try {
        await writeFile(filePath, JSON.stringify({ storage: {}, writes: {} }), 'utf8');
      } catch (err) {
        console.warn('[office] langgraph checkpoint delete failed:', threadId, err);
      }
    }
  }
}

/** Shared on-disk checkpointer (thread_id = office-task-{taskId}). */
export const officeLangGraphFileCheckpointer = new OfficeLangGraphThreadStore();
