/**
 * Shared marketplace / local skill uninstall orchestration.
 * Keeps IPC and HTTP routes aligned and removes workspace installs, not just ~/.openclaw/skills.
 *
 * Uninstall pause/resume semantics match 2026-07-25 (commit 9a026580):
 * stop Gateway → delete → restart Gateway → sync entries outside the guard.
 */

import path from 'node:path';
import { existsSync } from 'node:fs';
import type { GatewayManager } from '../../gateway/manager';
import type { ClawHubService } from '../../gateway/clawhub';
import { purgeSkillFromAgentAllowlists, listAgentsSnapshotReadOnly } from '../../utils/agent-config';
import { syncSkillsEntriesEnabledFromAgents } from '../../utils/skill-entries-sync';
import { getOpenClawConfigDir, expandPath } from '../../utils/paths';
import { findWorkspaceSkillDirBySlug } from '../../utils/workspace-agent-skills-sync';
import {
  removeExistingSkillDir,
  removeServerMarketplaceSkillLocalInstall,
} from '../skills-marketplace-client';
import { withGatewayRestartForSkillFilesystem } from './skill-gateway-fs-guard';

export type MarketplaceSkillUninstallInput = {
  slug?: string;
  name?: string;
  baseDir?: string;
};

function resolvePath(value: string): string {
  return path.resolve(expandPath(value.trim()));
}

function isPathInsideOpenClawConfigDir(targetDir: string): boolean {
  const root = path.resolve(getOpenClawConfigDir());
  const target = resolvePath(targetDir);
  const relativePath = path.relative(root, target);
  return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function tryRemoveSkillDir(
  targetDir: string,
  removed: Set<string>,
  failed: string[],
): void {
  const resolved = resolvePath(targetDir);
  if (removed.has(resolved)) return;
  if (!existsSync(resolved)) return;
  if (!isPathInsideOpenClawConfigDir(resolved)) return;
  if (removeExistingSkillDir(resolved)) {
    removed.add(resolved);
    return;
  }
  failed.push(resolved);
}

/** Remove skill directories from server marketplace, explicit baseDir, agent workspaces, and global managed root. */
export async function removeLocalSkillInstallFromDisk(params: {
  skillId: string;
  displayName?: string;
  baseDir?: string;
}): Promise<{ removed: string[]; failed: string[] }> {
  const skillId = params.skillId.trim();
  const displayName = (params.displayName || skillId).trim();
  if (!skillId) {
    return { removed: [], failed: [] };
  }

  const removedSet = new Set<string>();
  const failed: string[] = [];

  const serverResult = await removeServerMarketplaceSkillLocalInstall({
    skillId,
    displayName,
    baseDir: params.baseDir,
  });
  for (const dir of serverResult.removed) {
    removedSet.add(resolvePath(dir));
  }
  failed.push(...serverResult.failed);

  const preferredBaseDir = params.baseDir?.trim();
  if (preferredBaseDir) {
    tryRemoveSkillDir(preferredBaseDir, removedSet, failed);
  }

  const snapshot = await listAgentsSnapshotReadOnly();
  for (const agent of snapshot.agents) {
    const workspaceDir = findWorkspaceSkillDirBySlug(agent, skillId);
    if (workspaceDir) {
      tryRemoveSkillDir(workspaceDir, removedSet, failed);
    }
  }

  const globalManagedDir = path.join(getOpenClawConfigDir(), 'skills', skillId);
  tryRemoveSkillDir(globalManagedDir, removedSet, failed);

  return { removed: [...removedSet], failed };
}

export async function executeMarketplaceSkillUninstall(
  input: MarketplaceSkillUninstallInput,
  deps: {
    gatewayManager: GatewayManager;
    clawHubService: ClawHubService;
  },
): Promise<{ success: true } | { success: false; error: string }> {
  const slug = typeof input.slug === 'string' ? input.slug.trim() : '';
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const baseDir = typeof input.baseDir === 'string' ? input.baseDir.trim() : undefined;
  const purgeId = slug || name;
  if (!purgeId) {
    return { success: false, error: 'slug or name is required' };
  }

  // Purge allowlists while the skill is still on disk so alias resolution stays complete.
  await purgeSkillFromAgentAllowlists(purgeId);

  const effectiveSlug = slug || name;
  try {
    await withGatewayRestartForSkillFilesystem(deps.gatewayManager, async () => {
      const diskResult = await removeLocalSkillInstallFromDisk({
        skillId: purgeId,
        displayName: name || slug,
        baseDir,
      });
      if (diskResult.failed.length > 0) {
        throw new Error(`Failed to remove local skill: ${diskResult.failed.join(', ')}`);
      }

      // Always run clawhub uninstall for lock.json + skills.entries cleanup. Omit baseDir when
      // server marketplace already removed a versioned directory under ~/.openclaw/skills.
      const clawhubBaseDir = diskResult.removed.length > 0 && baseDir ? undefined : baseDir;
      await deps.clawHubService.uninstall({ slug: effectiveSlug, baseDir: clawhubBaseDir });
    });
  } catch (error) {
    return { success: false, error: String(error) };
  }

  await syncSkillsEntriesEnabledFromAgents();
  return { success: true };
}
