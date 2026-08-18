/**
 * Shared ClawX skill discovery policy: only managed + bundled + extensions + plugin-skills.
 * Workspace / .agents / skills.load.extraDirs must not be scanned as user skill sources.
 */
import { access, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { getOpenClawConfigDir, getOpenClawResolvedDir } from '@electron/utils/paths';

export const ALLOWED_SKILL_SCAN_SOURCES = [
  'openclaw-managed',
  'openclaw-bundled',
  'openclaw-extension',
  'openclaw-plugin',
] as const;

export type AllowedSkillScanSource = (typeof ALLOWED_SKILL_SCAN_SOURCES)[number];

/**
 * Workspace agent skills disk is no longer an allowlist source of truth (P5).
 * Reconcile must not forward-fill or prune agent skills from those directories.
 */
export const WORKSPACE_DISK_SKILL_RECONCILE_ENABLED = false;

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of paths) {
    const normalized = resolve(entry);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

/** Discover extensions star slash skills roots under OpenClaw package + config dirs (P3). */
export async function listExtensionSkillRoots(options?: {
  openClawDir?: string;
  extensionRoots?: string[];
}): Promise<string[]> {
  const openClawDir = options?.openClawDir || getOpenClawResolvedDir();
  const extensionRoots = options?.extensionRoots || [
    join(getOpenClawConfigDir(), 'extensions'),
    join(openClawDir, 'extensions'),
    join(openClawDir, 'dist', 'extensions'),
  ];

  const skillRoots: string[] = [];
  for (const extensionRoot of extensionRoots) {
    if (!(await pathExists(extensionRoot))) continue;
    try {
      const entries = await readdir(extensionRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillsRoot = join(extensionRoot, entry.name, 'skills');
        if (await pathExists(skillsRoot)) {
          skillRoots.push(skillsRoot);
        }
      }
    } catch {
      // Ignore unreadable extension roots.
    }
  }
  return dedupePaths(skillRoots);
}
