import { sanitizeNotebookDirName } from '@/lib/office-project-notebook';
import type {
  OfficeTaskExecutionMode,
  OfficeWorkflowEngine,
  WorkflowDefinition,
} from '@/types/office';

export const PROJECT_MANIFEST_FILE = 'manifest.json';
export const PROJECT_PROGRESS_FILE = 'progress.json';
export const PROJECT_DEFINITION_FILE = 'definition.json';
export const PROJECT_ROOM_MIRROR_FILE = 'room.jsonl';
/** @deprecated 旧进展文件后缀 `{roleId}-status.ndjson` */
export const ROLE_STATUS_FILE_SUFFIX = '-status.ndjson';

export {
  legacyRoleStatusFileName,
  roleStatusFileName,
} from '@/lib/office-project-file-naming';

/** Persisted project spec (survives app restarts; lives under coordinator workspace). */
export type ProjectTaskDefinition = {
  taskId: string;
  taskTitle: string;
  executionMode: OfficeTaskExecutionMode;
  workflowEngine?: OfficeWorkflowEngine;
  featureDescription: string;
  description: string;
  coordinatorRoleId: string;
  workflow?: WorkflowDefinition;
  langGraphWorkflowBundle?: import('@/types/office').LangGraphWorkflowBundle;
  updatedAt: number;
};

export type ProjectContextManifest = {
  taskId: string;
  taskTitle: string;
  /** Monotonic generation; readers ignore records with older epoch. */
  epoch: number;
  startedAt: number;
  coordinatorAgentId: string;
  coordinatorRoleId: string;
  /** 项目启动时落盘的项目根目录绝对路径（~/.openclaw/office/project/<projectId>/）。 */
  projectRootPath?: string;
};

/** One append-only work-status record (NDJSON line). */
export type RoleWorkStatusRecord = {
  任务: string;
  role: string;
  roleId: string;
  time: string;
  工作进展: string;
  epoch: number;
};

export type RoomMirrorLine = {
  epoch: number;
  message: Record<string, unknown>;
};

export function projectDirSegment(_taskTitle: string, taskId: string): string {
  return taskId.trim();
}

/** 旧版目录名：`{项目名}-{projectId}`（仅用于迁移查找）。 */
export function legacyProjectDirSegment(taskTitle: string, taskId: string): string {
  return `${sanitizeNotebookDirName(taskTitle)}-${taskId.trim()}`;
}

/** 路径末级是否为旧版 `{title}-{id}` 目录（非 id-only）。 */
export function isLegacyProjectDirName(dirName: string, projectId: string): boolean {
  const id = projectId.trim();
  const name = dirName.trim();
  if (!id || !name) return false;
  return name !== id && name.endsWith(`-${id}`);
}

export function formatStatusTimeSeconds(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function parseNdjsonLines<T>(raw: string): T[] {
  const out: T[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as T);
    } catch {
      // skip corrupt line
    }
  }
  return out;
}

export function appendNdjsonLine(existing: string, record: unknown): string {
  const line = JSON.stringify(record);
  const base = existing.trimEnd();
  return base ? `${base}\n${line}\n` : `${line}\n`;
}

export function filterRecordsByEpoch<T extends { epoch: number }>(records: T[], epoch: number): T[] {
  return records.filter((r) => r.epoch === epoch);
}

export function lastRecordForEpoch<T extends { epoch: number }>(
  records: T[],
  epoch: number,
): T | null {
  const filtered = filterRecordsByEpoch(records, epoch);
  return filtered.length > 0 ? filtered[filtered.length - 1]! : null;
}

export function formatRoleStatusForPrompt(record: RoleWorkStatusRecord): string {
  return `【${record.role}】${record.time}：${record.工作进展}`;
}
