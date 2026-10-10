import { app } from 'electron';
import { promises as fs } from 'node:fs';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getSetting } from '../../../utils/store';
import { getOpenClawConfigDir } from '../../../utils/paths';
import { listOpenclawSkills } from '../../../utils/openclaw-skills';
import { collectTranscriptAggregates, listTranscriptFiles } from '../../../utils/transcript-aggregate-cache';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

function getOpenClawHome(): string {
  return process.env.OPENCLAW_HOME || getOpenClawConfigDir();
}

function readOpenClawConfig(): Record<string, unknown> {
  const configPath = path.join(getOpenClawHome(), 'openclaw.json');
  const raw = readFileSync(configPath, 'utf-8');
  return JSON.parse(raw) as Record<string, unknown>;
}

/** OpenClaw session transcript on disk (exclude lock sidecars and tombstones). */
export function isSessionTranscriptJsonl(fileName: string): boolean {
  const base = fileName.trim();
  if (!base.endsWith('.jsonl')) return false;
  if (base.endsWith('.jsonl.lock')) return false;
  if (base.includes('.deleted.')) return false;
  return true;
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getPrimaryIp(): string | null {
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family === 'IPv4' && !entry.internal) {
        return entry.address;
      }
    }
  }
  return null;
}

async function getMachineId(): Promise<string> {
  const id = await getSetting('machineId');
  return id || 'unknown';
}

/** Reported to ClawManager on Centrifuge heartbeat (`status` field on `clients` row). */
export type ClientHeartbeatLifecycleStatus =
  | 'startup'
  | 'online'
  | 'exit'
  | 'error'
  /** Gateway process down or not accepting RPC yet (Manager should not call config.get). */
  | 'gateway_offline'
  /** Gateway process starting or transport reconnecting (hard restart / respawn in progress). */
  | 'gateway_reconfiguring'
  /** Gateway WS running but internal subsystems not ready yet (warmup after connect/reload). */
  | 'gateway_warming';

export async function collectSystemSnapshot(status: ClientHeartbeatLifecycleStatus): Promise<Record<string, unknown>> {
  const deviceConnectedToManager =
    status === 'startup'
    || status === 'online'
    || status === 'gateway_reconfiguring'
    || status === 'gateway_warming'
    || status === 'gateway_offline';
  return {
    id: await getMachineId(),
    username: os.userInfo().username,
    os: `${os.platform()}-${os.arch()}-${os.release()}`,
    ip: getPrimaryIp(),
    timestamp: Math.floor(Date.now() / 1000),
    isOnline: deviceConnectedToManager,
    status,
    version: app.getVersion(),
    hostname: os.hostname(),
    uptimeSec: Math.floor(process.uptime()),
  };
}

export async function collectConfigSnapshot(): Promise<Record<string, unknown>> {
  const config = readOpenClawConfig();
  const agents = (config.agents as Record<string, unknown> | undefined) || {};
  const models = (config.models as Record<string, unknown> | undefined) || {};
  const skills = (config.skills as Record<string, unknown> | undefined) || {};
  const channels = (config.channels as Record<string, unknown> | undefined) || {};
  const commands = (config.commands as Record<string, unknown> | undefined) || {};
  return {
    agents,
    models,
    skills,
    channels,
    crontab: commands,
    gateway: config.gateway,
  };
}

interface DayAggregate {
  date: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  messageCount: number;
  responseTimes: number[];
}

function toWeekAndMonth(daily: Array<Record<string, number | string>>) {
  const weekly: Record<string, any> = {};
  const monthly: Record<string, any> = {};
  for (const row of daily) {
    const date = String(row.date);
    const dt = new Date(`${date}T00:00:00Z`);
    const day = dt.getUTCDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(dt.getTime() + mondayOffset * 86400000).toISOString().slice(0, 10);
    const month = date.slice(0, 7);
    if (!weekly[monday]) weekly[monday] = { date: monday, inputTokens: 0, outputTokens: 0, totalTokens: 0, messageCount: 0 };
    if (!monthly[month]) monthly[month] = { date: month, inputTokens: 0, outputTokens: 0, totalTokens: 0, messageCount: 0 };
    for (const key of ['inputTokens', 'outputTokens', 'totalTokens', 'messageCount'] as const) {
      weekly[monday][key] += Number(row[key] || 0);
      monthly[month][key] += Number(row[key] || 0);
    }
  }
  return {
    weekly: Object.values(weekly).sort((a: any, b: any) => a.date.localeCompare(b.date)),
    monthly: Object.values(monthly).sort((a: any, b: any) => a.date.localeCompare(b.date)),
  };
}

export async function collectStatsAll(): Promise<Record<string, unknown>> {
  // Reuse the shared incremental transcript cache (mtime+size keyed, async IO)
  // instead of re-reading and line-parsing every session transcript on the main
  // thread each heartbeat — the old path froze the UI when sessions were large.
  const { usageEntries, responseIntervals } = await collectTranscriptAggregates();
  const dayMap: Record<string, DayAggregate> = {};

  for (const entry of usageEntries) {
    const date = String(entry.timestamp).slice(0, 10);
    if (!dayMap[date]) {
      dayMap[date] = { date, inputTokens: 0, outputTokens: 0, totalTokens: 0, messageCount: 0, responseTimes: [] };
    }
    const bucket = dayMap[date];
    bucket.inputTokens += entry.inputTokens;
    bucket.outputTokens += entry.outputTokens;
    bucket.totalTokens += entry.totalTokens;
    bucket.messageCount += 1;
  }

  for (const interval of responseIntervals) {
    const date = String(interval.timestamp).slice(0, 10);
    if (!dayMap[date]) {
      dayMap[date] = { date, inputTokens: 0, outputTokens: 0, totalTokens: 0, messageCount: 0, responseTimes: [] };
    }
    dayMap[date].responseTimes.push(interval.ms);
  }

  const daily = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({
    date: d.date,
    inputTokens: d.inputTokens,
    outputTokens: d.outputTokens,
    totalTokens: d.totalTokens,
    messageCount: d.messageCount,
    avgResponseMs: d.responseTimes.length ? Math.round(d.responseTimes.reduce((x, y) => x + y, 0) / d.responseTimes.length) : 0,
  }));
  const grouped = toWeekAndMonth(daily);
  return { daily, ...grouped };
}

export async function collectStatsModels(): Promise<Record<string, unknown>> {
  const { usageEntries } = await collectTranscriptAggregates();
  const modelMap: Record<string, { modelId: string; provider: string; inputTokens: number; outputTokens: number; totalTokens: number; messageCount: number }> = {};

  for (const entry of usageEntries) {
    if (!entry.model) continue;
    const provider = String(entry.provider || 'unknown');
    const modelId = String(entry.model);
    const key = `${provider}/${modelId}`;
    if (!modelMap[key]) {
      modelMap[key] = { provider, modelId, inputTokens: 0, outputTokens: 0, totalTokens: 0, messageCount: 0 };
    }
    modelMap[key].inputTokens += entry.inputTokens;
    modelMap[key].outputTokens += entry.outputTokens;
    modelMap[key].totalTokens += entry.totalTokens;
    modelMap[key].messageCount += 1;
  }

  return { models: Object.values(modelMap).sort((a, b) => b.totalTokens - a.totalTokens) };
}

export async function collectAgentActivity(): Promise<Record<string, unknown>> {
  const config = readOpenClawConfig();
  const now = Date.now();
  const agentsRaw = (config.agents as any)?.list;
  const list = Array.isArray(agentsRaw) ? agentsRaw : [{ id: 'main', name: 'main' }];

  const files = await listTranscriptFiles();
  const lastActiveByAgent = new Map<string, number>();
  for (const file of files) {
    const cur = lastActiveByAgent.get(file.agentId) ?? 0;
    if (file.mtimeMs > cur) lastActiveByAgent.set(file.agentId, file.mtimeMs);
  }

  const agents = list.map((agent: Record<string, any>) => {
    const lastActive = lastActiveByAgent.get(String(agent.id)) ?? 0;
    const diff = now - lastActive;
    const state = lastActive === 0 || diff > 10 * 60 * 1000 ? 'offline' : diff <= 2 * 60 * 1000 ? 'working' : 'idle';
    return {
      agentId: String(agent.id),
      name: agent.name || agent.id,
      emoji: agent.identity?.emoji || agent.emoji || '🤖',
      state,
      lastActive,
    };
  });

  return { agents };
}

export async function collectSessions(agentId: string): Promise<Record<string, unknown>> {
  const sessionsPath = path.join(getOpenClawHome(), `agents/${agentId}/sessions/sessions.json`);
  const sessions = safeJsonParse(readFileSync(sessionsPath, 'utf-8')) as Record<string, any> | null;
  if (!sessions) return { agentId, sessions: [] };
  const list = Object.entries(sessions).map(([key, val]) => ({
    key,
    sessionId: val?.sessionId || null,
    updatedAt: val?.updatedAt || 0,
    totalTokens: val?.totalTokens || 0,
    contextTokens: val?.contextTokens || 0,
    systemSent: val?.systemSent || false,
  })).sort((a, b) => b.updatedAt - a.updatedAt);
  return { agentId, sessions: list };
}

export async function collectGatewayHealth(): Promise<Record<string, unknown>> {
  const config = readOpenClawConfig();
  const gateway = (config.gateway || {}) as Record<string, any>;
  const port = Number(gateway.port || 18789);
  const token = String(gateway?.auth?.token || '');
  const startedAt = Date.now();

  try {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const resp = await fetch(`http://127.0.0.1:${port}/api/health`, { headers });
    const checkedAt = Date.now();
    if (resp.ok) {
      return {
        ok: true,
        data: await resp.json().catch(() => null),
        status: checkedAt - startedAt > 1500 ? 'degraded' : 'healthy',
        checkedAt,
        responseMs: checkedAt - startedAt,
      };
    }
  } catch {
    // fallback below
  }

  try {
    const args = ['gateway', 'status', '--json', '--timeout', '5000'];
    if (token) args.push('--token', token);
    const result = process.platform === 'win32'
      ? await execAsync(`openclaw ${args.join(' ')}`, { shell: 'cmd.exe' })
      : await execFileAsync('openclaw', args);
    const parsed = safeJsonParse(`${result.stdout}\n${result.stderr || ''}`) as Record<string, any> | null;
    return {
      ok: Boolean(parsed?.rpc?.ok),
      error: parsed?.rpc?.error,
      status: parsed?.rpc?.ok ? 'healthy' : 'down',
      checkedAt: Date.now(),
      responseMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false,
      status: 'down',
      error: error instanceof Error ? error.message : String(error),
      checkedAt: Date.now(),
      responseMs: Date.now() - startedAt,
    };
  }
}

export async function collectSkills(): Promise<unknown> {
  return await listOpenclawSkills();
}

export async function collectSkillContent(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const skillName = typeof payload.skillName === 'string' ? payload.skillName : '';
  if (!skillName) return { error: 'skillName is required' };
  const skillPath = path.join(getOpenClawHome(), 'skills', skillName, 'SKILL.md');
  if (!existsSync(skillPath)) return { skillName, content: null };
  const content = await fs.readFile(skillPath, 'utf-8');
  return { skillName, content };
}

export async function collectPixelOfficeTracks(): Promise<Record<string, unknown>> {
  const dir = path.join(__dirname, '../../../out/assets/pixel-office');
  try {
    const files = await fs.readdir(dir);
    const tracks = files.filter((f) => f.toLowerCase().endsWith('.mp3')).map((f) => `/assets/pixel-office/${f}`);
    return { tracks };
  } catch {
    return { tracks: [] };
  }
}

export async function collectLogsForUpload(): Promise<Record<string, unknown>> {
  const id = await getMachineId();
  const userData = app.getPath('userData');
  const logsDir = path.join(userData, 'logs');
  const files = existsSync(logsDir) ? readdirSync(logsDir).filter((f) => f.endsWith('.log')).sort() : [];
  const latest = files.length > 0 ? files[files.length - 1] : null;
  let content = '';
  if (latest) {
    content = readFileSync(path.join(logsDir, latest), 'utf-8').split('\n').slice(-2000).join('\n');
  }
  return { id, file: latest, logs: content };
}
