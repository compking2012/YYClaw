import { resolve } from 'node:path';
import { expandPath } from './paths';

const MAIN_AGENT_ID = 'main';
const DEFAULT_MAIN_WORKSPACE_PATH = '~/.openclaw/workspace';

/** Unique expanded workspace paths from agent list entries (for skill scan roots). */
export function extractAgentWorkspacesFromEntries(
  entries: Array<Record<string, unknown>>,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of entries) {
    const workspace = expandPath(typeof entry.workspace === 'string' ? entry.workspace : '').trim();
    if (!workspace) continue;
    const normalized = resolve(workspace);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(workspace);
  }
  return result;
}

/**
 * Workspace paths passed to listLocalSkills, including main-agent legacy
 * `~/.openclaw/workspace-main` when config still uses `~/.openclaw/workspace`.
 */
export function extractAgentWorkspacesForSkillScan(
  entries: Array<{ id?: string; workspace?: string }>,
): string[] {
  const result = extractAgentWorkspacesFromEntries(entries);
  const seen = new Set(result.map((workspace) => resolve(expandPath(workspace))));

  for (const entry of entries) {
    if (entry.id !== MAIN_AGENT_ID) continue;
    const configured = resolve(expandPath(
      (typeof entry.workspace === 'string' && entry.workspace.trim())
        ? entry.workspace
        : DEFAULT_MAIN_WORKSPACE_PATH,
    ));
    const defaultMain = resolve(expandPath(DEFAULT_MAIN_WORKSPACE_PATH));
    if (configured !== defaultMain) continue;
    const legacyWorkspace = expandPath(`~/.openclaw/workspace-${MAIN_AGENT_ID}`);
    const legacyResolved = resolve(legacyWorkspace);
    if (seen.has(legacyResolved)) continue;
    seen.add(legacyResolved);
    result.push(legacyWorkspace);
  }

  return result;
}
