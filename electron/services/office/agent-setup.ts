import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { withConfigLock } from '../../utils/config-mutex';
import { readOpenClawConfig, writeOpenClawConfig } from '../../utils/channel-config';
import { getOpenClawConfigDir } from '../../utils/paths';
import { OPENCLAW_HOME } from '../../utils/openclaw-paths';
import type { OfficeRole } from './types';
import { auditLog } from './audit';
import {
  roleWorkspaceRoot,
  ensureRoleWorkspaceProjectsDir,
} from './project-context-paths';
import { assertOfficeOpenClawWriteAllowed } from './office-openclaw-guard';

/** Tools granted to every Office role agent (OpenClaw agents.list[].tools.allow). */
export const OFFICE_SESSION_TOOLS = [
  'sessions_list',
  'sessions_history',
  'sessions_send',
  'session_status',
  'session_send_remote',
  'sessions_send_remote',
  'session_list_remote',
  'sessions_list_remote',
  'session_history_remote',
  'sessions_history_remote',
  'session_status_remote',
  'sessions_status_remote',
  'shared_workspace_list',
  'shared_workspace_read',
  'shared_workspace_write',
  'shared_workspace_commit',
  'shared_workspace_sync',
  'office_shared_workspace_sync',
  'agents_list',
  'read',
  'exec',
  'message',
];

/** OpenClaw agents.list[].skills must be string[] (skill ids), not { allow: string[] }. */
export function applyAgentSkillsAllowlist(
  entry: Record<string, unknown>,
  allowlist: string[] | undefined,
): void {
  const ids = allowlist?.map((s) => s.trim()).filter(Boolean) ?? [];
  if (ids.length > 0) {
    entry.skills = ids;
    return;
  }
  delete entry.skills;
}

const workspaceSyncTailByAgent = new Map<string, Promise<string>>();

async function ensureAgentDefaultWorkspaceDir(agentId: string): Promise<void> {
  const id = agentId.trim();
  if (!id) return;
  await mkdir(join(OPENCLAW_HOME, `workspace-${id}`), { recursive: true });
}

async function syncOpenClawAgentWorkspaceForRoleInner(
  role: Pick<OfficeRole, 'agentId'>,
  _allRoles: Pick<OfficeRole, 'agentId'>[],
): Promise<string> {
  const agentId = (role.agentId ?? '').trim();
  if (agentId) {
    await ensureRoleWorkspaceProjectsDir(agentId);
    await ensureAgentDefaultWorkspaceDir(agentId);
  }
  return roleWorkspaceRoot(agentId || role.agentId);
}

/** 运行前仅确保 workspace 磁盘目录存在；openclaw.json 在 establish 时写入。 */
export async function syncOpenClawAgentWorkspaceForRole(
  role: Pick<OfficeRole, 'agentId'>,
  allRoles: Pick<OfficeRole, 'agentId'>[],
): Promise<string> {
  const agentId = (role.agentId ?? '').trim() || '__unknown__';
  const prev = workspaceSyncTailByAgent.get(agentId) ?? Promise.resolve('');
  const next = prev
    .catch(() => '')
    .then(() => syncOpenClawAgentWorkspaceForRoleInner(role, allRoles));
  workspaceSyncTailByAgent.set(agentId, next);
  return next;
}

/** 执行角色任务前确保 workspace 磁盘目录存在（不写 openclaw.json）。 */
export async function runWithOfficeRoleWorkspacePrepared<T>(
  role: Pick<OfficeRole, 'agentId'>,
  allRoles: Pick<OfficeRole, 'agentId'>[],
  fn: () => Promise<T>,
): Promise<T> {
  await syncOpenClawAgentWorkspaceForRole(role, allRoles);
  return fn();
}

export async function ensureAgentToAgentConfig(agentIds: string[]): Promise<void> {
  await assertOfficeOpenClawWriteAllowed('ensureAgentToAgentConfig');
  await withConfigLock(async () => {
    const config = (await readOpenClawConfig()) as Record<string, unknown>;
    const tools = (config.tools ?? {}) as Record<string, unknown>;
    const allow = new Set([...agentIds, 'main']);
    tools.agentToAgent = {
      enabled: true,
      allow: [...allow],
    };
    config.tools = tools;
    await writeOpenClawConfig(config as Parameters<typeof writeOpenClawConfig>[0]);
  });
  await auditLog('agent_to_agent_enabled', { agentIds });
}

export async function exportOfficeSnapshot(): Promise<string> {
  const { getOfficeDataPath } = await import('./paths');
  return getOfficeDataPath();
}

export { getRoleWorkspacePath } from './project-context-paths';

export function getOpenClawAgentsRoot(): string {
  return join(getOpenClawConfigDir(), 'agents');
}
