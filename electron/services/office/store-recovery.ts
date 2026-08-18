import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readOpenClawConfig } from '../../utils/channel-config';
import { OPENCLAW_HOME } from '../../utils/openclaw-paths';
import type { OfficeDataStore, OfficeRole, OfficeTask } from './types';
import { defaultWorkflowForRoles, migrateLegacyStoreToV2 } from './store-legacy';
import { getOfficeAuditPath } from './paths';
import { roomSessionKey } from './session-keys';

const NOTEBOOKS_ROOT = join(OPENCLAW_HOME, 'office', 'notebooks');

function resolveAgentIdForRole(
  roleId: string,
  workspaceSuffix: string,
  agentIds: Set<string>,
): string {
  if (roleId === 'pm' || roleId === 'main') return 'main';
  if (agentIds.has(roleId)) return roleId;
  if (workspaceSuffix === 'pm' || workspaceSuffix === 'main') return 'main';
  if (workspaceSuffix.startsWith('agent-') && agentIds.has(workspaceSuffix)) return workspaceSuffix;
  if (roleId === 'agent-8') return agentIds.has('agent-4') ? 'agent-4' : roleId;
  if (workspaceSuffix === 'agent' && agentIds.has('agent-4')) return 'agent-4';
  return agentIds.has(roleId) ? roleId : workspaceSuffix;
}

async function collectRoleIdsFromSkillFiles(): Promise<Map<string, { agentId: string; skills: string[] }>> {
  const found = new Map<string, { agentId: string; skills: string[] }>();
  const root = OPENCLAW_HOME;
  if (!existsSync(root)) return found;

  const workspaces = await readdir(root, { withFileTypes: true });
  for (const dirent of workspaces) {
    if (!dirent.isDirectory() || !dirent.name.startsWith('workspace-')) continue;
    const suffix = dirent.name.slice('workspace-'.length);
    const officeDir = join(root, dirent.name, 'office');
    if (!existsSync(officeDir)) continue;

    const files = await readdir(officeDir).catch(() => [] as string[]);
    for (const file of files) {
      const m = /^role-(.+)-skills\.json$/.exec(file);
      if (!m) continue;
      const roleId = m[1]!;
      try {
        const raw = await readFile(join(officeDir, file), 'utf8');
        const parsed = JSON.parse(raw) as { allow?: string[] };
        const skills = Array.isArray(parsed.allow) ? parsed.allow.filter((s) => typeof s === 'string') : [];
        if (!found.has(roleId)) {
          found.set(roleId, { agentId: suffix, skills });
        }
      } catch {
        // skip corrupt skill file
      }
    }
  }
  return found;
}

async function collectScenarioIdsFromAudit(): Promise<string[]> {
  const path = getOfficeAuditPath();
  if (!existsSync(path)) return [];
  const raw = await readFile(path, 'utf8');
  const ids = new Set<string>();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as { scenarioId?: string };
      if (typeof row.scenarioId === 'string' && row.scenarioId.trim()) {
        ids.add(row.scenarioId.trim());
      }
    } catch {
      // skip
    }
  }
  return [...ids];
}

async function collectTasksFromNotebooks(scenarioId: string): Promise<OfficeTask[]> {
  const tasks: OfficeTask[] = [];
  if (!existsSync(NOTEBOOKS_ROOT)) return tasks;

  const dirs = await readdir(NOTEBOOKS_ROOT, { withFileTypes: true }).catch(() => []);
  for (const dirent of dirs) {
    if (!dirent.isDirectory()) continue;
    const dirPath = join(NOTEBOOKS_ROOT, dirent.name);
    const files = await readdir(dirPath).catch(() => [] as string[]);
    for (const file of files) {
      const m = /^项目进度汇报-(task-[^.]+)\.json$/.exec(file);
      if (!m) continue;
      const taskId = m[1]!;
      try {
        const nb = JSON.parse(await readFile(join(dirPath, file), 'utf8')) as {
          taskTitle?: string;
          updatedAt?: number;
        };
        const now = nb.updatedAt ?? Date.now();
        tasks.push({
          id: taskId,
          scenarioId,
          sequence: tasks.length + 1,
          title: nb.taskTitle?.trim() || dirent.name,
          featureDescription: '',
          description: '',
          status: 'completed',
          assignedRoleIds: [],
          workflow: { mode: 'simple', nodes: [], edges: [] },
          nodeRuns: [],
          createdAt: now,
          updatedAt: now,
        });
      } catch {
        // skip
      }
    }
  }
  return tasks;
}

function agentDisplayName(agentId: string, openclawName?: string): string {
  if (openclawName?.trim()) return openclawName.trim();
  if (agentId === 'main') return 'Main';
  return agentId;
}

/**
 * Best-effort rebuild when `data.json` was truncated/corrupted.
 * Uses audit logs, project notebooks, workspace role skill files, and openclaw.json agents.
 */
export async function recoverOfficeStoreFromArtifacts(): Promise<OfficeDataStore | null> {
  const roleSkillMap = await collectRoleIdsFromSkillFiles();
  const scenarioIds = await collectScenarioIdsFromAudit();
  if (roleSkillMap.size === 0 && scenarioIds.length === 0 && !existsSync(NOTEBOOKS_ROOT)) {
    return null;
  }

  const config = (await readOpenClawConfig()) as {
    agents?: { list?: Array<{ id?: string; name?: string; model?: unknown }> };
  };
  const agents = Array.isArray(config.agents?.list) ? config.agents!.list! : [];
  const agentNameById = new Map(
    agents
      .filter((a) => typeof a.id === 'string')
      .map((a) => [a.id!, typeof a.name === 'string' ? a.name : a.id!]),
  );
  const agentIds = new Set(agentNameById.keys());

  const roleNameById: Record<string, string> = {
    pm: 'PM',
    'agent-6': '测试',
    'agent-7': '开发',
    'agent-8': '产品',
  };

  const roles: OfficeRole[] = [];
  const seenRole = new Set<string>();
  const usedAgentIds = new Set<string>();
  for (const [roleId, meta] of roleSkillMap) {
    if (roleId === 'main' || seenRole.has(roleId)) continue;
    seenRole.add(roleId);
    const agentId = resolveAgentIdForRole(roleId, meta.agentId, agentIds);
    if (usedAgentIds.has(agentId) && roleId !== 'pm') continue;
    usedAgentIds.add(agentId);
    roles.push({
      id: roleId,
      name: roleNameById[roleId] ?? agentDisplayName(agentId, agentNameById.get(agentId)),
      emoji: roleId === 'pm' ? '👔' : '🤖',
      agentId,
      skillsAllowlist: meta.skills,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  const coordinator = roles.find((r) => r.id === 'pm') ?? roles.find((r) => r.agentId === 'main') ?? roles[0];
  const roleIds = [...new Set(roles.map((r) => r.id))];
  const workflow = defaultWorkflowForRoles(roleIds);

  const scenarios = scenarioIds.length > 0
    ? scenarioIds.map((id, index) => ({
      id,
      name: index === 0 ? '协作团队' : `团队 ${index + 1}`,
      roleIds,
      coordinatorRoleId: coordinator?.id ?? roleIds[0]!,
      workflow,
      roomSessionKey: roomSessionKey(coordinator?.agentId ?? 'main', id),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }))
    : [];

  let tasks: OfficeTask[] = [];
  if (scenarios.length > 0) {
    for (const scenario of scenarios) {
      const fromNotebooks = await collectTasksFromNotebooks(scenario.id);
      tasks = tasks.concat(fromNotebooks);
    }
  }

  if (roles.length === 0 && scenarios.length === 0 && tasks.length === 0) {
    return null;
  }

  const allowAgentIds = [...new Set(roles.map((r) => r.agentId))];

  return migrateLegacyStoreToV2({
    version: 1,
    roles,
    scenarios,
    tasks,
    roomMessages: {},
    settings: {
      agentToAgentEnabled: allowAgentIds.length > 0,
      agentToAgentAllow: allowAgentIds,
    },
  });
}

export async function officeArtifactsLookRecoverable(): Promise<boolean> {
  const roleSkillMap = await collectRoleIdsFromSkillFiles();
  if (roleSkillMap.size > 0) return true;

  const scenarioIds = await collectScenarioIdsFromAudit();
  if (scenarioIds.length > 0) return true;

  if (!existsSync(NOTEBOOKS_ROOT)) return false;
  const dirs = await readdir(NOTEBOOKS_ROOT, { withFileTypes: true }).catch(() => []);
  for (const dirent of dirs) {
    if (!dirent.isDirectory()) continue;
    const files = await readdir(join(NOTEBOOKS_ROOT, dirent.name)).catch(() => [] as string[]);
    if (files.some((f) => /^项目进度汇报-task-/.test(f))) return true;
  }
  return false;
}
