// @ts-nocheck
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getOpenClawConfigDir } from '../../utils/paths';
import { listOpenclawSkills } from '../../utils/openclaw-skills';
import {
  type TokenUsageHistoryEntry,
} from '../../utils/token-usage-core';
import {
  collectTranscriptAggregates,
  type ToolEvent,
  type TranscriptAggregates as SnapshotEvents,
} from '../../utils/transcript-aggregate-cache';

type RangeKey = 'last_15m' | 'last_1h' | 'last_8h' | 'last_24h' | 'last_7d' | 'last_30d';

interface DashboardTotals {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  total_tokens: number;
  total_cost: number;
  input_cost: number;
  output_cost: number;
  cache_read_cost: number;
  cache_write_cost: number;
  missing_cost_entries: number;
}

interface DashboardSeriesPoint {
  ts: string;
  label: string;
  tokens: number;
  cost: number;
  messages: number;
  tool_calls: number;
  errors: number;
}

interface DashboardRange {
  range_key: RangeKey;
  start_at: string;
  end_at: string;
  bucket_unit: string;
  totals: DashboardTotals;
  series: DashboardSeriesPoint[];
  kpis: Array<{ key: string; label: string; value: string; hint: string }>;
  top_models: Array<{ provider: string; model: string; count: number; totals: DashboardTotals }>;
  top_providers: Array<{ provider: string; count: number; totals: DashboardTotals }>;
  top_tools: Array<{ name: string; count: number }>;
}

const RANGE_DEFINITIONS: Record<RangeKey, { bucketUnit: string; bucketMs: number; count: number }> = {
  last_15m: { bucketUnit: 'minute', bucketMs: 60_000, count: 15 },
  last_1h: { bucketUnit: '5m', bucketMs: 5 * 60_000, count: 12 },
  last_8h: { bucketUnit: '15m', bucketMs: 15 * 60_000, count: 32 },
  last_24h: { bucketUnit: 'hour', bucketMs: 60 * 60_000, count: 24 },
  last_7d: { bucketUnit: 'day', bucketMs: 24 * 60 * 60_000, count: 7 },
  last_30d: { bucketUnit: 'day', bucketMs: 24 * 60 * 60_000, count: 30 },
};

function emptyTotals(): DashboardTotals {
  return {
    input: 0,
    output: 0,
    cache_read: 0,
    cache_write: 0,
    total_tokens: 0,
    total_cost: 0,
    input_cost: 0,
    output_cost: 0,
    cache_read_cost: 0,
    cache_write_cost: 0,
    missing_cost_entries: 0,
  };
}

function addUsageToTotals(totals: DashboardTotals, entry: TokenUsageHistoryEntry): void {
  totals.input += entry.inputTokens;
  totals.output += entry.outputTokens;
  totals.cache_read += entry.cacheReadTokens;
  totals.cache_write += entry.cacheWriteTokens;
  totals.total_tokens += entry.totalTokens;
  if (typeof entry.costUsd === 'number' && Number.isFinite(entry.costUsd)) {
    totals.total_cost += entry.costUsd;
  } else if (entry.usageStatus === 'available' && entry.totalTokens > 0) {
    totals.missing_cost_entries += 1;
  }
}

function cloneTotals(totals: DashboardTotals): DashboardTotals {
  return { ...totals };
}

function floorUtcTime(timestampMs: number, bucketMs: number): number {
  return Math.floor(timestampMs / bucketMs) * bucketMs;
}

function formatLabel(timestampMs: number, bucketUnit: string): string {
  const date = new Date(timestampMs);
  if (bucketUnit === 'day') {
    return date.toISOString().slice(5, 10);
  }
  return date.toISOString().slice(11, 16);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function readOpenClawConfigSafe(): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(path.join(getOpenClawConfigDir(), 'openclaw.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return asRecord(parsed) ?? {};
  } catch {
    return {};
  }
}

function countConfiguredModels(config: Record<string, unknown>): number {
  const modelRefs = new Set<string>();
  const models = config.models;
  if (Array.isArray(models)) {
    for (const model of models) {
      if (typeof model === 'string' && model.trim()) modelRefs.add(model.trim());
      const id = asRecord(model)?.id;
      if (typeof id === 'string' && id.trim()) modelRefs.add(id.trim());
    }
  } else if (models && typeof models === 'object') {
    for (const [provider, value] of Object.entries(models as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        for (const model of value) {
          if (typeof model === 'string' && model.trim()) modelRefs.add(`${provider}/${model.trim()}`);
        }
      } else {
        modelRefs.add(provider);
      }
    }
  }

  const agents = asRecord(config.agents);
  const defaults = asRecord(agents?.defaults);
  const defaultModel = asRecord(defaults?.model)?.primary ?? defaults?.model;
  if (typeof defaultModel === 'string' && defaultModel.trim()) modelRefs.add(defaultModel.trim());
  const list = Array.isArray(agents?.list) ? agents.list : [];
  for (const agent of list) {
    const record = asRecord(agent);
    const model = asRecord(record?.model)?.primary ?? record?.model;
    if (typeof model === 'string' && model.trim()) modelRefs.add(model.trim());
  }

  return modelRefs.size;
}

function countEnabledJobs(value: unknown): number {
  return Array.isArray(value)
    ? value.filter((job) => asRecord(job)?.enabled !== false).length
    : 0;
}

async function countEnabledCronJobs(config: Record<string, unknown>): Promise<number> {
  try {
    const raw = await readFile(path.join(getOpenClawConfigDir(), 'cron', 'cron.json'), 'utf8');
    const parsed = JSON.parse(raw);
    const fileJobs = Array.isArray(parsed) ? parsed : asRecord(parsed)?.jobs;
    const count = countEnabledJobs(fileJobs);
    if (count > 0) return count;
  } catch {
    // Fall back to legacy config locations below.
  }

  const commands = asRecord(config.commands);
  const commandJobs = countEnabledJobs(commands?.jobs);
  if (commandJobs > 0) return commandJobs;

  const cron = asRecord(config.cron);
  return countEnabledJobs(cron?.jobs);
}

async function countInstalledSkills(): Promise<number> {
  try {
    const result = await listOpenclawSkills();
    return result.total;
  } catch {
    return 0;
  }
}

function bucketIndexFor(timestamp: string, startMs: number, bucketMs: number, count: number): number | null {
  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs)) return null;
  const index = Math.floor((timestampMs - startMs) / bucketMs);
  return index >= 0 && index < count ? index : null;
}

function buildTopModels(entries: TokenUsageHistoryEntry[]) {
  const map = new Map<string, { provider: string; model: string; count: number; totals: DashboardTotals }>();
  for (const entry of entries) {
    const provider = (entry.provider?.trim() || 'unknown');
    const model = (entry.model?.trim() || 'unknown');
    const key = `${provider}\0${model}`;
    const target = map.get(key) ?? { provider, model, count: 0, totals: emptyTotals() };
    target.count += 1;
    addUsageToTotals(target.totals, entry);
    map.set(key, target);
  }
  return [...map.values()]
    .sort((a, b) => b.totals.total_tokens - a.totals.total_tokens || b.count - a.count)
    .slice(0, 10)
    .map((item) => ({ ...item, totals: cloneTotals(item.totals) }));
}

function buildTopProviders(entries: TokenUsageHistoryEntry[]) {
  const map = new Map<string, { provider: string; count: number; totals: DashboardTotals }>();
  for (const entry of entries) {
    const provider = (entry.provider?.trim() || 'unknown');
    const target = map.get(provider) ?? { provider, count: 0, totals: emptyTotals() };
    target.count += 1;
    addUsageToTotals(target.totals, entry);
    map.set(provider, target);
  }
  return [...map.values()]
    .sort((a, b) => b.totals.total_tokens - a.totals.total_tokens || b.count - a.count)
    .slice(0, 10)
    .map((item) => ({ ...item, totals: cloneTotals(item.totals) }));
}

function buildTopTools(events: ToolEvent[]) {
  const counts = new Map<string, number>();
  for (const event of events) {
    counts.set(event.name, (counts.get(event.name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 10);
}

function buildRange(rangeKey: RangeKey, events: SnapshotEvents, nowMs: number): DashboardRange {
  const definition = RANGE_DEFINITIONS[rangeKey];
  const endMs = floorUtcTime(nowMs, definition.bucketMs) + definition.bucketMs;
  const startMs = endMs - definition.bucketMs * definition.count;
  const series: DashboardSeriesPoint[] = Array.from({ length: definition.count }, (_, index) => {
    const tsMs = startMs + index * definition.bucketMs;
    return {
      ts: new Date(tsMs).toISOString(),
      label: formatLabel(tsMs, definition.bucketUnit),
      tokens: 0,
      cost: 0,
      messages: 0,
      tool_calls: 0,
      errors: 0,
    };
  });
  const totals = emptyTotals();
  const rangeEntries: TokenUsageHistoryEntry[] = [];
  const rangeTools: ToolEvent[] = [];

  for (const entry of events.usageEntries) {
    const index = bucketIndexFor(entry.timestamp, startMs, definition.bucketMs, definition.count);
    if (index === null) continue;
    rangeEntries.push(entry);
    addUsageToTotals(totals, entry);
    series[index].tokens += entry.totalTokens;
    series[index].cost += entry.costUsd ?? 0;
    series[index].messages += 1;
  }

  for (const event of events.toolEvents) {
    const index = bucketIndexFor(event.timestamp, startMs, definition.bucketMs, definition.count);
    if (index === null) continue;
    rangeTools.push(event);
    series[index].tool_calls += 1;
  }

  let rangeErrorCount = 0;
  for (const event of events.errorEvents) {
    const index = bucketIndexFor(event.timestamp, startMs, definition.bucketMs, definition.count);
    if (index === null) continue;
    rangeErrorCount += 1;
    series[index].errors += 1;
  }

  return {
    range_key: rangeKey,
    start_at: new Date(startMs).toISOString(),
    end_at: new Date(endMs).toISOString(),
    bucket_unit: definition.bucketUnit,
    totals,
    series,
    kpis: [
      { key: 'messages', label: 'Messages', value: String(rangeEntries.length), hint: `${definition.count} ${definition.bucketUnit} buckets` },
      { key: 'tool_calls', label: 'Tool calls', value: String(rangeTools.length), hint: `${definition.count} ${definition.bucketUnit} buckets` },
      { key: 'errors', label: 'Errors', value: String(rangeErrorCount), hint: `${definition.count} ${definition.bucketUnit} buckets` },
    ],
    top_models: buildTopModels(rangeEntries),
    top_providers: buildTopProviders(rangeEntries),
    top_tools: buildTopTools(rangeTools),
  };
}

export async function buildDashboardSnapshot(clientId: string, now: Date = new Date()): Promise<Record<string, unknown>> {
  const [events, config, installedSkillCount] = await Promise.all([
    collectTranscriptAggregates(),
    readOpenClawConfigSafe(),
    countInstalledSkills(),
  ]);
  const nowMs = now.getTime();
  const cronEnabledCount = await countEnabledCronJobs(config);

  return {
    client_id: clientId,
    schema_version: 1,
    reported_at: now.toISOString(),
    data: {
      stats: {
        session_count: events.sessionIds.size,
        cron_enabled_count: cronEnabledCount,
        model_count: countConfiguredModels(config),
        installed_skill_count: installedSkillCount,
      },
      coverage: {
        total_sessions: events.sessionIds.size,
        sessions_with_usage: events.sessionsWithUsage.size,
      },
      ranges: {
        last_15m: buildRange('last_15m', events, nowMs),
        last_1h: buildRange('last_1h', events, nowMs),
        last_8h: buildRange('last_8h', events, nowMs),
        last_24h: buildRange('last_24h', events, nowMs),
        last_7d: buildRange('last_7d', events, nowMs),
        last_30d: buildRange('last_30d', events, nowMs),
      },
    },
  };
}
