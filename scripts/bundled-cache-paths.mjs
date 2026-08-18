import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 仓库根：从任意 scripts/*.mjs 的 import.meta.url 解析 */
export function repoRootFromImportMeta(importMetaUrl) {
  return join(dirname(fileURLToPath(importMetaUrl)), '..');
}

export function bundledCacheRoot(repoRoot) {
  return join(repoRoot, 'resources', 'build-cache');
}

export function bundledBinDir(repoRoot) {
  return join(bundledCacheRoot(repoRoot), 'bin');
}

export function bundledSkillsBundledDir(repoRoot) {
  return join(bundledCacheRoot(repoRoot), 'skills-bundled');
}

export function bundledNodeModulesDir(repoRoot) {
  return join(bundledCacheRoot(repoRoot), 'node_modules');
}
