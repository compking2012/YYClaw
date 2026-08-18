import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** LangChain/LangGraph roots used by Electron main (office workflow-langgraph-*). */
export const MAIN_PROCESS_BUNDLED_ROOT_PACKAGES = [
  '@langchain/core',
  '@langchain/langgraph',
  'p-finally',
  'p-timeout',
];

export function packageNameFromImportId(id) {
  const normalized = id.split('?')[0] ?? id;
  if (normalized.startsWith('@')) {
    const parts = normalized.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : normalized;
  }
  return normalized.split('/')[0] ?? normalized;
}

function packageJsonPathFor(projectRoot, packageName) {
  return resolve(projectRoot, 'node_modules', ...packageName.split('/'), 'package.json');
}

/**
 * Collect runtime deps (dependencies + optionalDependencies) reachable from roots.
 * Does NOT traverse peerDependencies to avoid pulling react/vue/openai/etc.
 */
export function collectBundledPackageGraph(projectRoot, rootPackages) {
  const bundled = new Set();
  const queue = [...rootPackages];
  while (queue.length > 0) {
    const packageName = queue.shift();
    if (!packageName || bundled.has(packageName)) continue;
    bundled.add(packageName);

    const packageJsonPath = packageJsonPathFor(projectRoot, packageName);
    if (!existsSync(packageJsonPath)) continue;

    try {
      const json = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
      const deps = [
        ...Object.keys(json.dependencies ?? {}),
        ...Object.keys(json.optionalDependencies ?? {}),
      ];
      for (const dep of deps) {
        if (!bundled.has(dep)) queue.push(dep);
      }
    } catch {
      // Ignore malformed package metadata.
    }
  }
  return bundled;
}

export function isBundledMainProcessImport(id, bundledPackages) {
  return bundledPackages.has(packageNameFromImportId(id));
}
