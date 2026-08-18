/**
 * Smart / Workflow 共用：协调者项目目录下交付物命名（按 Agent 组织）。
 * - 进展：status-{Agent显示名}.ndjson
 * - 文件：{原文件名 stem}-{Agent显示名}{ext}
 * - 文件夹：交付物-{Agent显示名}
 */

/** 文件夹类交付物目录 basename 前缀。 */
export const AGENT_SCOPED_DELIVERABLE_DIR_BASENAME = '交付物';

/** @deprecated Use AGENT_SCOPED_DELIVERABLE_DIR_BASENAME */
export const ROLE_SCOPED_DELIVERABLE_DIR_BASENAME = AGENT_SCOPED_DELIVERABLE_DIR_BASENAME;

/** 文件名中 Agent 显示名片段（保留中文、字母数字、._-）。 */
export function sanitizeAgentLabelForFileSegment(agentLabel: string): string {
  const trimmed = agentLabel.trim() || 'Agent';
  const safe = trimmed
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, '')
    .slice(0, 40);
  return safe || 'Agent';
}

/** @deprecated Use sanitizeAgentLabelForFileSegment */
export function sanitizeRoleNameForFileSegment(roleName: string): string {
  return sanitizeAgentLabelForFileSegment(roleName);
}

/** 各 Agent 工作进展 NDJSON：`status-产品.ndjson`。 */
export function agentStatusFileName(agentLabel: string): string {
  return `status-${sanitizeAgentLabelForFileSegment(agentLabel)}.ndjson`;
}

/** @deprecated Use agentStatusFileName */
export function roleStatusFileName(roleName: string): string {
  return agentStatusFileName(roleName);
}

/** @deprecated 旧格式 `{roleId}-status.ndjson`，读取时兼容。 */
export function legacyRoleStatusFileName(roleId: string): string {
  const id = roleId.trim() || 'role';
  return `${id}-status.ndjson`;
}

export function isRoleStatusArtifactFileName(name: string): boolean {
  const base = name.trim().toLowerCase();
  if (!base.endsWith('.ndjson')) return false;
  return base.startsWith('status-') || base.endsWith('-status.ndjson');
}

/**
 * 将交付物文件名加上角色后缀（仅处理 basename，不改目录）。
 * `requirements.md` + `产品` → `requirements-产品.md`
 */
export function agentScopedDeliverableFileName(
  originalFileName: string,
  agentLabel: string,
): string {
  const base = originalFileName.trim().replace(/^.*[/\\]/, '');
  if (!base || isRoleStatusArtifactFileName(base)) return base;

  const agentSeg = sanitizeAgentLabelForFileSegment(agentLabel);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) {
    return base.endsWith(`-${agentSeg}`) ? base : `${base}-${agentSeg}`;
  }
  const stem = base.slice(0, dot);
  const ext = base.slice(dot);
  if (stem.endsWith(`-${agentSeg}`)) return base;
  return `${stem}-${agentSeg}${ext}`;
}

/** @deprecated Use agentScopedDeliverableFileName */
export function roleScopedDeliverableFileName(
  originalFileName: string,
  roleName: string,
): string {
  return agentScopedDeliverableFileName(originalFileName, roleName);
}

/** 交付物 basename 是否已含 `-{角色名}` 后缀（扩展名之前）。 */
export function deliverableFileNameMatchesRole(
  fileName: string,
  roleName: string,
): boolean {
  const base = fileName.trim().replace(/^.*[/\\]/, '');
  if (!base) return false;
  const roleSeg = sanitizeRoleNameForFileSegment(roleName);
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  if (stem.endsWith(`-${roleSeg}`)) return true;
  const roleToken = `-${roleSeg}`;
  const tokenIdx = stem.indexOf(roleToken);
  if (tokenIdx < 0) return false;
  const after = stem.slice(tokenIdx + roleToken.length);
  return after.length === 0 || after.startsWith('-') || after.startsWith('_');
}

/** 文件夹类交付物目录名：`交付物-Agent显示名`。 */
export function agentScopedDeliverableDirName(agentLabel: string): string {
  return `${AGENT_SCOPED_DELIVERABLE_DIR_BASENAME}-${sanitizeAgentLabelForFileSegment(agentLabel)}`;
}

/** @deprecated Use agentScopedDeliverableDirName */
export function roleScopedDeliverableDirName(roleName: string): string {
  return agentScopedDeliverableDirName(roleName);
}

/** 路径是否位于 `交付物-{角色名}/` 目录下（目录内文件 basename 可不再重复角色后缀）。 */
export function isUnderRoleScopedDeliverableDir(
  pathHint: string,
  roleName: string,
): boolean {
  const dir = roleScopedDeliverableDirName(roleName);
  const normalized = pathHint.replace(/\\/g, '/');
  return (
    normalized.includes(`/${dir}/`)
    || normalized.endsWith(`/${dir}`)
    || normalized.startsWith(`${dir}/`)
  );
}

/** 目录 basename 是否为统一的 `交付物-角色名`。 */
export function deliverableDirNameMatchesRole(
  dirName: string,
  roleName: string,
): boolean {
  const base = dirName.trim().replace(/^.*[/\\]/, '').replace(/\/+$/u, '');
  if (!base) return false;
  return base === roleScopedDeliverableDirName(roleName);
}

/** Workflow/Smart：交付物须落在 `交付物-角色名/` 下（目录本身或目录内相对路径）。 */
export function workflowDeliverablePathUnderRoleDir(
  pathHint: string,
  roleName: string,
): boolean {
  const dir = roleScopedDeliverableDirName(roleName);
  const norm = pathHint
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+$/u, '');
  if (!norm) return false;
  if (norm === dir) return true;
  if (norm.startsWith(`${dir}/`)) return true;
  return isUnderRoleScopedDeliverableDir(norm, roleName);
}

/** basename 是否为工程类交付目录 `交付物-角色名`（不含路径前缀）。 */
export function isRoleScopedDeliverableDirBasename(name: string): boolean {
  const base = name.trim().replace(/^.*[/\\]/, '').replace(/\/+$/u, '');
  if (!base || base === ROLE_SCOPED_DELIVERABLE_DIR_BASENAME) return false;
  return base.startsWith(`${ROLE_SCOPED_DELIVERABLE_DIR_BASENAME}-`);
}

export const OFFICE_AGENT_SCOPED_DELIVERABLE_DIR_NAMING_LINE =
  '【交付·命名·文件夹】工程/多文件类交付须落盘为目录 `交付物-Agent显示名/`（如 交付物-开发/），勿使用其它文件夹名；查找与 ls 均在该路径下进行。';

export const OFFICE_AGENT_SCOPED_DELIVERABLE_NAMING_LINE =
  '【交付·命名】所有交付物须落在 `交付物-Agent显示名/` 目录下（与 Smart 一致）；' +
  '文档类：`交付物-Agent/xxx-Agent.md`；工程类：`交付物-Agent/` 目录内多文件；' +
  '禁止写入 target/ 或其它自定义目录；进展文件 status-Agent显示名.ndjson 由系统写入。';

export const OFFICE_AGENT_SCOPED_STATUS_NAMING_LINE =
  '【进展·命名】各 Agent 工作进展由系统写入协调者项目目录下 status-Agent显示名.ndjson（勿使用成员 workspace）。';

/** @deprecated Use OFFICE_AGENT_SCOPED_* constants */
export const OFFICE_ROLE_SCOPED_DELIVERABLE_DIR_NAMING_LINE = OFFICE_AGENT_SCOPED_DELIVERABLE_DIR_NAMING_LINE;
export const OFFICE_ROLE_SCOPED_DELIVERABLE_NAMING_LINE = OFFICE_AGENT_SCOPED_DELIVERABLE_NAMING_LINE;
export const OFFICE_ROLE_SCOPED_STATUS_NAMING_LINE = OFFICE_AGENT_SCOPED_STATUS_NAMING_LINE;
