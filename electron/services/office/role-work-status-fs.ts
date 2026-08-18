import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  legacyRoleStatusFileName,
  roleStatusFileName,
} from '../../../src/lib/office-project-file-naming';
import {
  appendNdjsonLine,
  filterRecordsByEpoch,
  formatStatusTimeSeconds,
  lastRecordForEpoch,
  parseNdjsonLines,
  type RoleWorkStatusRecord,
} from '../../../src/lib/office-project-context';
import {
  coordinatorProjectRoot,
  resolveCoordinatorPathContext,
  type CoordinatorPathContext,
} from './project-context-paths';
import {
  clearRoleStatusCacheForAgentTask,
  getRoleStatusCache,
  setRoleStatusCache,
} from './role-status-cache';
import type { OfficeFixedGroup, OfficeTempProject } from './types';
import type { ProjectAgentRef } from '../../../src/lib/office-workflow-node';
import { resolveCoordinatorAgentId } from './project-context-paths';
import { loadProjectEpoch } from './project-context-load';

type StatusMember = Pick<ProjectAgentRef, 'agentId' | 'displayName'> & { id?: string };

function memberKey(member: StatusMember): string {
  return (member.id ?? '').trim() || (member.agentId ?? '').trim();
}

function memberDisplayName(member: StatusMember): string {
  return (member.displayName ?? '').trim() || (member.agentId ?? '').trim() || 'member';
}

function projectRoot(_ctx: CoordinatorPathContext, taskTitle: string, taskId: string): string {
  return coordinatorProjectRoot(taskTitle, taskId);
}

function statusFilePathCandidates(
  ctx: CoordinatorPathContext,
  taskTitle: string,
  taskId: string,
  member: StatusMember,
): string[] {
  const root = projectRoot(ctx, taskTitle, taskId);
  const name = memberDisplayName(member);
  const primary = join(root, roleStatusFileName(name));
  const legacy = join(root, legacyRoleStatusFileName(memberKey(member)));
  return primary === legacy ? [primary] : [primary, legacy];
}

function writeStatusFilePath(
  ctx: CoordinatorPathContext,
  taskTitle: string,
  taskId: string,
  member: StatusMember,
): string {
  return join(
    projectRoot(ctx, taskTitle, taskId),
    roleStatusFileName(memberDisplayName(member)),
  );
}

export async function appendRoleWorkStatus(params: {
  coordinatorAgentId: string;
  coordinatorRoleId?: string;
  teamRoles: CoordinatorPathContext['teamRoles'];
  role: StatusMember & { agentId: string };
  task: Pick<OfficeTempProject, 'id' | 'title'>;
  progress: string;
  epoch: number;
}): Promise<RoleWorkStatusRecord> {
  const record: RoleWorkStatusRecord = {
    任务: params.task.title.trim() || params.task.id,
    role: memberDisplayName(params.role),
    roleId: memberKey(params.role),
    time: formatStatusTimeSeconds(Date.now()),
    工作进展: params.progress.trim().slice(0, 400) || '（无正文）',
    epoch: params.epoch,
  };

  const pathCtx = await resolveCoordinatorPathContext(
    { coordinatorAgentId: params.coordinatorAgentId },
    params.teamRoles ?? [],
  );
  const dir = projectRoot(pathCtx, params.task.title, params.task.id);
  await mkdir(dir, { recursive: true });
  const filePath = writeStatusFilePath(
    pathCtx,
    params.task.title,
    params.task.id,
    params.role,
  );

  let existing: string;
  try {
    existing = await readFile(filePath, 'utf8');
  } catch {
    existing = '';
  }
  const kept = filterRecordsByEpoch(parseNdjsonLines<RoleWorkStatusRecord>(existing), params.epoch);
  const body = kept.map((l) => JSON.stringify(l)).join('\n');
  const merged = appendNdjsonLine(body ? `${body}\n` : '', record);
  await writeFile(filePath, merged, 'utf8');

  setRoleStatusCache(
    params.coordinatorAgentId,
    params.task.id,
    memberKey(params.role),
    [...kept, record],
  );
  return record;
}

async function readStatusFileRaw(
  ctx: CoordinatorPathContext,
  taskTitle: string,
  taskId: string,
  role: StatusMember,
): Promise<string> {
  for (const filePath of statusFilePathCandidates(ctx, taskTitle, taskId, role)) {
    try {
      return await readFile(filePath, 'utf8');
    } catch {
      // try legacy path
    }
  }
  return '';
}

export async function readRoleWorkStatusRecords(params: {
  coordinatorAgentId: string;
  coordinatorRoleId: string;
  teamRoles: CoordinatorPathContext['teamRoles'];
  taskTitle: string;
  taskId: string;
  roleId: string;
  roleName?: string;
  epoch: number;
}): Promise<RoleWorkStatusRecord[]> {
  const role: StatusMember = {
    agentId: params.roleId,
    displayName: params.roleName?.trim() || params.roleId,
    id: params.roleId,
  };
  const cached = filterRecordsByEpoch(
    getRoleStatusCache(params.coordinatorAgentId, params.taskId, params.roleId),
    params.epoch,
  );
  if (cached.length > 0) return cached;

  const pathCtx = await resolveCoordinatorPathContext(
    { coordinatorAgentId: params.coordinatorAgentId },
    params.teamRoles ?? [],
  );
  const raw = await readStatusFileRaw(pathCtx, params.taskTitle, params.taskId, role);
  const lines = filterRecordsByEpoch(parseNdjsonLines<RoleWorkStatusRecord>(raw), params.epoch);
  setRoleStatusCache(params.coordinatorAgentId, params.taskId, params.roleId, lines);
  return lines;
}

export async function readLastRoleWorkStatus(
  params: Parameters<typeof readRoleWorkStatusRecords>[0],
): Promise<RoleWorkStatusRecord | null> {
  const lines = await readRoleWorkStatusRecords(params);
  return lastRecordForEpoch(lines, params.epoch);
}

export async function persistAgentWorkStatusAfterExpression(params: {
  project: OfficeTempProject;
  group: Pick<OfficeFixedGroup, 'coordinatorAgentId' | 'agentIds'>;
  member: ProjectAgentRef;
  progress: string;
  members: ProjectAgentRef[];
}): Promise<void> {
  const coord = resolveCoordinatorAgentId(params.project, params.group);
  if (!coord) return;
  const epochInfo = await loadProjectEpoch({
    project: params.project,
    group: params.group,
    members: params.members,
  });
  const epoch = epochInfo?.epoch ?? 1;
  await appendRoleWorkStatus({
    coordinatorAgentId: coord.coordinatorAgentId,
    teamRoles: params.members,
    role: params.member,
    task: params.project,
    progress: params.progress,
    epoch,
  });
}

/** @deprecated */
export const persistRoleWorkStatusAfterExpression = persistAgentWorkStatusAfterExpression;

/** 清空本任务角色进展缓存（磁盘文件由 {@link reinitializeCoordinatorProjectWorkspace} 负责）。 */
export async function clearRoleWorkStatusCache(params: {
  coordinatorAgentId: string;
  taskId: string;
  legacyMemberAgentIds?: string[];
}): Promise<void> {
  const { clearRoleStatusCacheForTask } = await import('./role-status-cache');
  clearRoleStatusCacheForTask(params.taskId);
  clearRoleStatusCacheForAgentTask(params.coordinatorAgentId, params.taskId);
  for (const agentId of params.legacyMemberAgentIds ?? []) {
    clearRoleStatusCacheForAgentTask(agentId, params.taskId);
  }
}
