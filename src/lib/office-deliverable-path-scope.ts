/** 规范化路径分隔符并去掉末尾斜杠（不解析 symlink）。 */
export function normalizePathForScopeComparison(absPath: string): string {
  return absPath.replace(/\\/g, '/').replace(/\/+$/u, '');
}

/** 已解析的绝对路径是否位于项目根目录内（含根目录自身）。 */
export function isPathInsideProjectRoot(resolvedPath: string, projectRoot: string): boolean {
  const child = normalizePathForScopeComparison(resolvedPath);
  const root = normalizePathForScopeComparison(projectRoot);
  if (!root || !child) return false;
  return child === root || child.startsWith(`${root}/`);
}
