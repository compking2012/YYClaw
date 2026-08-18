/**
 * Cron validity-window store (app-side).
 *
 * The bundled OpenClaw Gateway has no start/end validity window for cron jobs,
 * so we enforce it in the app: each job's window is persisted here (keyed by the
 * Gateway job id) and a background reconciler (`cron-window-manager.ts`) toggles
 * the Gateway job's `enabled` flag when the current local date crosses the
 * window bounds.
 *
 * File layout (mirrors `gateway/prelaunch-maintenance-cache.ts`):
 *   userData/cron-windows.json
 *   { schemaVersion: 1, windows: { [jobId]: { start?, end?, desiredEnabled } } }
 *
 * `start` / `end` are inclusive local calendar dates (`YYYY-MM-DD`). Comparison
 * is done on the date strings themselves to sidestep timezone/DST math.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getDataDir } from '../utils/paths';

const WINDOW_SCHEMA_VERSION = 1;
const WINDOW_FILE_NAME = 'cron-windows.json';

export interface CronWindowRecord {
  start?: string;
  end?: string;
  desiredEnabled: boolean;
}

interface CronWindowFile {
  schemaVersion: number;
  windows: Record<string, CronWindowRecord>;
}

function getWindowFilePath(): string {
  return join(getDataDir(), WINDOW_FILE_NAME);
}

function emptyWindowFile(): CronWindowFile {
  return { schemaVersion: WINDOW_SCHEMA_VERSION, windows: {} };
}

function readWindowFile(): CronWindowFile {
  try {
    const path = getWindowFilePath();
    if (!existsSync(path)) return emptyWindowFile();
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as CronWindowFile;
    if (parsed.schemaVersion !== WINDOW_SCHEMA_VERSION || !parsed.windows || typeof parsed.windows !== 'object') {
      return emptyWindowFile();
    }
    return parsed;
  } catch {
    return emptyWindowFile();
  }
}

function writeWindowFile(file: CronWindowFile): boolean {
  try {
    const path = getWindowFilePath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/** Normalize a `YYYY-MM-DD` string, returning undefined for blanks/garbage. */
function normalizeDate(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : undefined;
}

/** Today's local calendar date as `YYYY-MM-DD`. */
export function localDateString(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Whether `today` falls inside the (inclusive) window. A missing bound is open
 * on that side. String comparison is valid for the fixed `YYYY-MM-DD` shape.
 */
export function isWithinWindow(
  window: Pick<CronWindowRecord, 'start' | 'end'> | undefined,
  today: string = localDateString(),
): boolean {
  if (!window) return true;
  const start = normalizeDate(window.start);
  const end = normalizeDate(window.end);
  if (start && today < start) return false;
  if (end && today > end) return false;
  return true;
}

/** Effective Gateway-enabled state given the user's intent and the window. */
export function effectiveEnabled(record: CronWindowRecord, today: string = localDateString()): boolean {
  return record.desiredEnabled && isWithinWindow(record, today);
}

export function getWindow(jobId: string): CronWindowRecord | undefined {
  return readWindowFile().windows[jobId];
}

export function getAllWindows(): Record<string, CronWindowRecord> {
  return readWindowFile().windows;
}

/**
 * Persist a window for a job. A record with neither `start` nor `end` carries no
 * validity constraint, so it is removed instead of stored.
 */
export function writeWindow(jobId: string, record: CronWindowRecord): void {
  const start = normalizeDate(record.start);
  const end = normalizeDate(record.end);
  const file = readWindowFile();
  if (!start && !end) {
    if (file.windows[jobId]) {
      delete file.windows[jobId];
      writeWindowFile(file);
    }
    return;
  }
  file.windows[jobId] = {
    desiredEnabled: record.desiredEnabled,
    ...(start ? { start } : {}),
    ...(end ? { end } : {}),
  };
  writeWindowFile(file);
}

/** Update just the desired-enabled intent for an existing windowed job. */
export function setDesiredEnabled(jobId: string, desiredEnabled: boolean): void {
  const file = readWindowFile();
  const record = file.windows[jobId];
  if (!record) return;
  record.desiredEnabled = desiredEnabled;
  writeWindowFile(file);
}

export function removeWindow(jobId: string): void {
  const file = readWindowFile();
  if (file.windows[jobId]) {
    delete file.windows[jobId];
    writeWindowFile(file);
  }
}

/** Drop window entries whose job id is no longer present. */
export function pruneWindows(existingJobIds: Iterable<string>): void {
  const keep = new Set(existingJobIds);
  const file = readWindowFile();
  let changed = false;
  for (const jobId of Object.keys(file.windows)) {
    if (!keep.has(jobId)) {
      delete file.windows[jobId];
      changed = true;
    }
  }
  if (changed) writeWindowFile(file);
}
