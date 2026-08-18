import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { getOpenClawConfigDir } from './paths';
import { listConfiguredAgentIds } from './agent-config';
import {
  extractSessionIdFromTranscriptFileName,
  parseUsageEntriesFromJsonl,
  type TokenUsageHistoryEntry,
} from './token-usage-core';
import { logger } from './logger';

export interface ToolEvent {
  timestamp: string;
  name: string;
}

export interface ErrorEvent {
  timestamp: string;
}

export interface ResponseInterval {
  ms: number;
  timestamp: string;
}

export interface TranscriptAggregates {
  usageEntries: TokenUsageHistoryEntry[];
  toolEvents: ToolEvent[];
  errorEvents: ErrorEvent[];
  responseIntervals: ResponseInterval[];
  sessionIds: Set<string>;
  sessionsWithUsage: Set<string>;
}

export interface TranscriptFile {
  filePath: string;
  sessionId: string;
  agentId: string;
  mtimeMs: number;
  size: number;
}

interface CacheEntry {
  mtimeMs: number;
  size: number;
  sessionId: string;
  agentId: string;
  usageEntries: TokenUsageHistoryEntry[];
  toolEvents: ToolEvent[];
  errorEvents: ErrorEvent[];
  responseIntervals: ResponseInterval[];
  hasUsage: boolean;
}

// Per-transcript cache keyed by absolute file path. A file whose mtime+size are
// unchanged since the last scan is reused verbatim and never re-read; only the
// handful of actively-growing transcripts are re-parsed, and deleted files are
// evicted each scan. This mirrors OpenClaw's own mtime/size-keyed transcript
// index and removes the repeated full-directory rescans that froze the main
// process when the sessions directory reached multiple GB.
const cache = new Map<string, CacheEntry>();

let inFlight: Promise<TranscriptAggregates> | null = null;

async function pathExistsAsDirectory(dirPath: string): Promise<boolean> {
  try {
    const result = await stat(dirPath);
    return result.isDirectory();
  } catch {
    return false;
  }
}

async function listAgentIdsWithSessionDirs(): Promise<string[]> {
  const openclawDir = getOpenClawConfigDir();
  const agentsDir = path.join(openclawDir, 'agents');
  const agentIds = new Set<string>();

  try {
    for (const agentId of await listConfiguredAgentIds()) {
      const normalized = agentId.trim();
      if (normalized) agentIds.add(normalized);
    }
  } catch {
    // Fall back to runtime directories below.
  }

  try {
    for (const entry of await readdir(agentsDir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.trim()) {
        agentIds.add(entry.name.trim());
      }
    }
  } catch {
    // Ignore missing OpenClaw homes.
  }

  return [...agentIds].sort();
}

export async function listTranscriptFiles(): Promise<TranscriptFile[]> {
  const openclawDir = getOpenClawConfigDir();
  const files: TranscriptFile[] = [];

  for (const agentId of await listAgentIdsWithSessionDirs()) {
    const sessionsDir = path.join(openclawDir, 'agents', agentId, 'sessions');
    if (!(await pathExistsAsDirectory(sessionsDir))) continue;

    let entries: string[];
    try {
      entries = await readdir(sessionsDir);
    } catch {
      continue;
    }

    for (const fileName of entries) {
      const sessionId = extractSessionIdFromTranscriptFileName(fileName);
      if (!sessionId) continue;
      const filePath = path.join(sessionsDir, fileName);
      try {
        const fileStat = await stat(filePath);
        if (!fileStat.isFile()) continue;
        files.push({ filePath, sessionId, agentId, mtimeMs: fileStat.mtimeMs, size: fileStat.size });
      } catch {
        continue;
      }
    }
  }

  return files.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeToolName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractToolNames(message: Record<string, unknown>): string[] {
  const names: string[] = [];
  const content = message.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      const record = asRecord(block);
      if (!record) continue;
      if (record.type === 'tool_use' || record.type === 'toolCall') {
        const name = normalizeToolName(record.name);
        if (name) names.push(name);
      }
    }
  }

  const toolCalls = Array.isArray(message.tool_calls)
    ? message.tool_calls
    : Array.isArray(message.toolCalls)
      ? message.toolCalls
      : [];
  for (const toolCall of toolCalls) {
    const record = asRecord(toolCall);
    if (!record) continue;
    const functionShape = asRecord(record.function);
    const name = normalizeToolName(record.name) ?? normalizeToolName(functionShape?.name);
    if (name) names.push(name);
  }

  return names;
}

function isErrorLine(parsed: Record<string, unknown>, message: Record<string, unknown> | null): boolean {
  if (typeof parsed.type === 'string' && parsed.type.toLowerCase().includes('error')) {
    return true;
  }
  if (message?.isError === true || message?.error === true) {
    return true;
  }
  const role = typeof message?.role === 'string' ? message.role.toLowerCase() : '';
  if (role === 'error') return true;
  const content = typeof message?.content === 'string' ? message.content.toLowerCase() : '';
  return role === 'system' && (content.includes('run failed:') || content.includes('error:'));
}

function collectTranscriptEvents(content: string): {
  toolEvents: ToolEvent[];
  errorEvents: ErrorEvent[];
  responseIntervals: ResponseInterval[];
} {
  const toolEvents: ToolEvent[] = [];
  const errorEvents: ErrorEvent[] = [];
  const responseIntervals: ResponseInterval[] = [];
  // Last-seen user-message timestamp (ms). An assistant message WITH usage
  // closes the interval; capped at 10 min to match the legacy stats collector.
  let lastUserTsMs: number | null = null;
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const timestamp = typeof parsed.timestamp === 'string' && Number.isFinite(Date.parse(parsed.timestamp))
      ? parsed.timestamp
      : null;
    if (!timestamp) continue;

    const message = asRecord(parsed.message);
    if (message) {
      for (const name of extractToolNames(message)) {
        toolEvents.push({ timestamp, name });
      }
    }
    if (isErrorLine(parsed, message)) {
      errorEvents.push({ timestamp });
    }

    const role = typeof message?.role === 'string' ? message.role : '';
    if (role === 'user') {
      lastUserTsMs = Date.parse(timestamp);
    } else if (role === 'assistant' && lastUserTsMs != null && message && 'usage' in message) {
      const diff = Date.parse(timestamp) - lastUserTsMs;
      if (diff > 0 && diff < 600_000) responseIntervals.push({ ms: diff, timestamp });
      lastUserTsMs = null;
    }
  }
  return { toolEvents, errorEvents, responseIntervals };
}

async function refreshCacheEntry(file: TranscriptFile): Promise<CacheEntry> {
  const cached = cache.get(file.filePath);
  if (cached && cached.mtimeMs === file.mtimeMs && cached.size === file.size) {
    return cached;
  }

  let content = '';
  try {
    content = await readFile(file.filePath, 'utf8');
  } catch (error) {
    logger.debug(`Failed to read transcript ${file.filePath}:`, error);
  }

  const usageEntries = parseUsageEntriesFromJsonl(content, {
    sessionId: file.sessionId,
    agentId: file.agentId,
  });
  const { toolEvents, errorEvents, responseIntervals } = collectTranscriptEvents(content);
  const entry: CacheEntry = {
    mtimeMs: file.mtimeMs,
    size: file.size,
    sessionId: file.sessionId,
    agentId: file.agentId,
    usageEntries,
    toolEvents,
    errorEvents,
    responseIntervals,
    hasUsage: usageEntries.some((e) => e.usageStatus === 'available'),
  };
  cache.set(file.filePath, entry);
  return entry;
}

async function collect(): Promise<TranscriptAggregates> {
  const files = await listTranscriptFiles();
  const seen = new Set<string>();

  const usageEntries: TokenUsageHistoryEntry[] = [];
  const toolEvents: ToolEvent[] = [];
  const errorEvents: ErrorEvent[] = [];
  const responseIntervals: ResponseInterval[] = [];
  const sessionIds = new Set<string>();
  const sessionsWithUsage = new Set<string>();

  for (const file of files) {
    seen.add(file.filePath);
    sessionIds.add(file.sessionId);
    const entry = await refreshCacheEntry(file);
    usageEntries.push(...entry.usageEntries);
    toolEvents.push(...entry.toolEvents);
    errorEvents.push(...entry.errorEvents);
    responseIntervals.push(...entry.responseIntervals);
    if (entry.hasUsage) sessionsWithUsage.add(file.sessionId);
  }

  // Evict cache entries for transcripts that no longer exist on disk.
  for (const key of cache.keys()) {
    if (!seen.has(key)) cache.delete(key);
  }

  usageEntries.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  return { usageEntries, toolEvents, errorEvents, responseIntervals, sessionIds, sessionsWithUsage };
}

/**
 * Aggregate usage/tool/error events across every agent session transcript,
 * re-reading only the files whose mtime or size changed since the previous
 * call. Concurrent callers share a single in-flight scan so the cache is never
 * mutated by two scans at once.
 */
export async function collectTranscriptAggregates(): Promise<TranscriptAggregates> {
  if (inFlight) return inFlight;
  inFlight = collect().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Test-only: drop all cached transcript state. */
export function __resetTranscriptAggregateCache(): void {
  cache.clear();
  inFlight = null;
}
