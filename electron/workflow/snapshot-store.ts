// @ts-nocheck
/**
 * Versioned JSON snapshot store — one file per run under a base directory.
 *
 * XState's persisted snapshot is pure JSON, so a flat file per run is enough for
 * the desktop (no SQLite, matching the app's "no database" convention). Because
 * completed-step outputs live in the persisted context, resuming from a snapshot
 * does NOT re-run already-completed steps.
 *
 * Every record carries the definition `version`; the engine refuses to feed an
 * old snapshot into a newer machine (see engine.resume) — that guards the
 * in-flight-migration trap.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SnapshotRecord } from './types';

export class SnapshotStore {
  constructor(private readonly baseDir: string) {}

  private ensureDir(): void {
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private fileFor(runId: string): string {
    return join(this.baseDir, `${runId}.json`);
  }

  save(record: SnapshotRecord): void {
    this.ensureDir();
    writeFileSync(this.fileFor(record.runId), JSON.stringify(record), { encoding: 'utf8' });
  }

  /** Delete a run's snapshot file (no-op when absent). */
  remove(runId: string): void {
    try {
      rmSync(this.fileFor(runId), { force: true });
    } catch {
      // Best-effort: a locked/unreadable file just leaves a stale snapshot.
    }
  }

  load(runId: string): SnapshotRecord | null {
    const file = this.fileFor(runId);
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as SnapshotRecord;
    } catch {
      return null;
    }
  }

  /** All runs still in `running` status — candidates for rehydration on startup. */
  listActive(): SnapshotRecord[] {
    if (!existsSync(this.baseDir)) return [];
    const records: SnapshotRecord[] = [];
    for (const name of readdirSync(this.baseDir)) {
      if (!name.endsWith('.json')) continue;
      try {
        const record = JSON.parse(readFileSync(join(this.baseDir, name), 'utf8')) as SnapshotRecord;
        if (record.status === 'running') records.push(record);
      } catch {
        // Skip corrupt files rather than failing startup.
      }
    }
    return records;
  }
}
