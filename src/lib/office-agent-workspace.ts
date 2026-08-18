/** Office 角色 workspace 目录名解析（与主进程 project-context-paths 一致）。 */

export type OfficeRoleWorkspaceRef = {
  agentId: string;
  name: string;
};

/** 历史多角色共 agent 时的 scoped 目录后缀（仅用于迁移旧数据）。 */
export function sanitizeWorkspaceRoleDirSuffix(roleName: string): string {
  const trimmed = roleName.trim() || 'role';
  const safe = trimmed.replace(/[/\\?%*:|"<>]/g, '_').replace(/\s+/g, ' ').slice(0, 64);
  return safe || 'role';
}

/**
 * 旧版多角色共 agent 的 workspace 目录名（`workspace-<agentId>-<角色名>`）。
 * 新数据一律使用 {@link agentDefaultWorkspaceDirName}。
 */
export function legacyRoleScopedWorkspaceDirName(agentId: string, roleName: string): string {
  const id = agentId.trim();
  if (!id) return 'workspace-unknown';
  return `workspace-${id}-${sanitizeWorkspaceRoleDirSuffix(roleName)}`;
}

/**
 * openclaw.json `agents.list[].workspace` 与磁盘项目根使用的目录名。
 * 严格 1 agent = 1 Office 角色：`workspace-<agentId>`。
 */
export function agentDefaultWorkspaceDirName(agentId: string): string {
  const id = agentId.trim();
  return id ? `workspace-${id}` : 'workspace-unknown';
}

/**
 * workspace 目录名（不含 OPENCLAW_HOME 前缀）。
 * 与 agent 绑定一一对应：`workspace-<agentId>`（`roles` 参数保留兼容，不参与命名）。
 */
export function roleWorkspaceDirName(
  _roles: OfficeRoleWorkspaceRef[],
  role: OfficeRoleWorkspaceRef,
): string {
  return agentDefaultWorkspaceDirName(role.agentId);
}

/** 相对 ~/.openclaw 的 workspace 路径段，如 `workspace-pm`。 */
export function roleWorkspaceRelativeDir(
  roles: OfficeRoleWorkspaceRef[],
  role: OfficeRoleWorkspaceRef,
): string {
  return roleWorkspaceDirName(roles, role);
}

/** 项目目录在 office 根下的相对片段：`office/project/<projectId>`。 */
export function officeProjectRelativeUnderWorkspace(
  taskTitle: string,
  taskId: string,
  projectDirSegment: (title: string, id: string) => string,
): string {
  return `office/project/${projectDirSegment(taskTitle, taskId)}`;
}

/**
 * 提示词/规则用路径：默认 OPENCLAW_HOME 为 `~/.openclaw` 时用 `~` 前缀，否则用绝对路径。
 */
export function officeProjectRootDisplayPath(
  openclawHome: string,
  _coordinatorRole: OfficeRoleWorkspaceRef,
  _teamRoles: OfficeRoleWorkspaceRef[],
  taskTitle: string,
  taskId: string,
  projectDirSegment: (title: string, id: string) => string,
  homedir: string = process.env.HOME || '',
): string {
  const tail = officeProjectRelativeUnderWorkspace(taskTitle, taskId, projectDirSegment);
  const home = openclawHome.replace(/\/+$/u, '');
  const defaultHome = homedir ? `${homedir.replace(/\/+$/u, '')}/.openclaw` : '';
  if (defaultHome && home === defaultHome) {
    return `~/.openclaw/${tail}`;
  }
  return `${home}/${tail}`;
}
