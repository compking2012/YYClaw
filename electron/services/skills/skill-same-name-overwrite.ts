/**
 * User-install same-name overwrite for ~/.openclaw/skills.
 *
 * Same-name is decided by SKILL.md / metadata canonical name (not directory name alone).
 * After overwrite, the managed root must not contain another skill with that name,
 * and openclaw.json skills.entries + agent allowlists must drop old aliases.
 */
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import { getOpenClawSkillsDir } from '../../utils/paths';
import { migrateManagedSkillReplacementConfig } from '../../utils/agent-config';
import { logger } from '../../utils/logger';
import { withManagedSkillMutationLock } from './managed-skill-lock';
import { readSkillManifestCanonicalName } from './skill-manifest';
import { renameManagedSkillDirWithRetry } from './skill-fs-mutate';

export const SAME_NAME_EXISTS_CODE = 'SAME_NAME_EXISTS';

export type ManagedSkillDirMatch = {
  dir: string;
  folderName: string;
  canonicalName: string;
  aliases: string[];
};

function normalizeKey(value?: string | null): string {
  return (value || '').trim().toLowerCase();
}

export { readSkillManifestCanonicalName } from './skill-manifest';

function readOptionalMetadataAliases(skillDir: string): string[] {
  const aliases = new Set<string>();
  const add = (value?: unknown) => {
    if (typeof value === 'string' && value.trim()) aliases.add(value.trim());
  };
  try {
    const metaPath = join(skillDir, '.clawx-server-marketplace.json');
    if (existsSync(metaPath)) {
      const parsed = JSON.parse(readFileSync(metaPath, 'utf8')) as {
        slug?: string;
        versionBase?: string;
      };
      add(parsed.slug);
      add(parsed.versionBase);
    }
  } catch {
    // ignore
  }
  try {
    const manifestPath = join(skillDir, 'manifest.json');
    if (existsSync(manifestPath)) {
      const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        slug?: string;
      };
      add(parsed.slug);
    }
  } catch {
    // ignore
  }
  return [...aliases];
}

export function collectManagedSkillDirAliases(skillDir: string, folderName: string): string[] {
  const aliases = new Set<string>();
  const add = (value?: string) => {
    const key = normalizeKey(value);
    if (key) aliases.add(key);
  };
  const canonical = readSkillManifestCanonicalName(skillDir);
  add(canonical);
  add(folderName);
  for (const alias of readOptionalMetadataAliases(skillDir)) add(alias);
  return [...aliases];
}

/**
 * Find managed dirs that should be replaced when installing `skillName`.
 * Same-name per policy: SKILL.md name or marketplace/manifest slug. An exact
 * folder match is retained as a fallback for incomplete installs without metadata.
 */
export function findManagedSkillDirsMatchingInstallName(
  skillName: string,
  skillsRoot = getOpenClawSkillsDir(),
): ManagedSkillDirMatch[] {
  const target = normalizeKey(skillName);
  if (!target || !existsSync(skillsRoot)) return [];

  let entries: Dirent[];
  try {
    entries = readdirSync(skillsRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const matches: ManagedSkillDirMatch[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const dir = join(skillsRoot, entry.name);
    const manifestName = readSkillManifestCanonicalName(dir);
    const canonicalName = manifestName || entry.name;
    const metadataAliases = readOptionalMetadataAliases(dir);
    const hasExplicitIdentity = Boolean(manifestName) || metadataAliases.length > 0;
    const hit =
      normalizeKey(canonicalName) === target
      || metadataAliases.some((alias) => normalizeKey(alias) === target)
      // Directory name is only a recovery fallback for incomplete installs.
      // A valid SKILL.md/metadata identity must never be overridden by a
      // coincidental catalog slug or folder name.
      || (!hasExplicitIdentity && normalizeKey(entry.name) === target);
    if (!hit) continue;
    matches.push({
      dir,
      folderName: entry.name,
      canonicalName,
      aliases: collectManagedSkillDirAliases(dir, entry.name),
    });
  }
  return matches;
}

export type SameNameInstallGateResult =
  | { action: 'proceed'; matches: ManagedSkillDirMatch[] }
  | {
    action: 'confirm';
    code: typeof SAME_NAME_EXISTS_CODE;
    displayName: string;
    existingIds: string[];
    matches: ManagedSkillDirMatch[];
  };

/**
 * Gate user installs: if same-name skills exist under managed root and overwrite
 * was not confirmed, ask UI to confirm; otherwise proceed (caller removes + installs).
 */
export function gateManagedSameNameInstall(params: {
  skillName: string;
  skillAliases?: string[];
  overwriteSameName?: boolean;
  skillsRoot?: string;
}): SameNameInstallGateResult {
  const identities = [params.skillName, ...(params.skillAliases || [])]
    .map((identity) => identity.trim())
    .filter(Boolean);
  const matchesByDir = new Map<string, ManagedSkillDirMatch>();
  for (const identity of identities) {
    for (const match of findManagedSkillDirsMatchingInstallName(identity, params.skillsRoot)) {
      matchesByDir.set(match.dir, match);
    }
  }
  const matches = [...matchesByDir.values()];
  if (matches.length === 0) {
    return { action: 'proceed', matches };
  }
  if (params.overwriteSameName) {
    return { action: 'proceed', matches };
  }
  const existingIds = [...new Set(matches.flatMap((m) => [m.folderName, m.canonicalName]))];
  return {
    action: 'confirm',
    code: SAME_NAME_EXISTS_CODE,
    displayName: matches[0]?.canonicalName || params.skillName,
    existingIds,
    matches,
  };
}

function removeSkillDir(targetDir: string): boolean {
  if (!existsSync(targetDir)) return true;
  try {
    rmSync(targetDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    return !existsSync(targetDir);
  } catch {
    return !existsSync(targetDir);
  }
}

async function purgeStaleSkillAliases(
  previousMatches: ManagedSkillDirMatch[],
  preservedAliases: Iterable<string>,
  newCanonicalSkillId: string,
): Promise<string[]> {
  const previousKeys = new Set(
    previousMatches.flatMap((match) => [
      ...match.aliases,
      normalizeKey(match.folderName),
      normalizeKey(match.canonicalName),
    ]).filter(Boolean),
  );
  const preserveKeys = new Set(
    [...preservedAliases].map((alias) => normalizeKey(alias)).filter(Boolean),
  );
  const keysToPurge = [...previousKeys].filter((key) => !preserveKeys.has(key));

  if (keysToPurge.length > 0) {
    await migrateManagedSkillReplacementConfig({
      staleAliases: keysToPurge,
      newCanonicalSkillId,
    });
  }
  return keysToPurge;
}

type StagedManagedSkillDir = {
  match: ManagedSkillDirMatch;
  backupDir: string;
};

async function stageManagedSkillDirs(
  matches: ManagedSkillDirMatch[],
  skillsRoot: string,
): Promise<{ backupRoot: string; staged: StagedManagedSkillDir[] }> {
  const backupRoot = mkdtempSync(join(skillsRoot, '.clawx-skill-overwrite-'));
  const staged: StagedManagedSkillDir[] = [];
  try {
    for (const match of matches) {
      const backupDir = join(backupRoot, match.folderName);
      await renameManagedSkillDirWithRetry(match.dir, backupDir);
      staged.push({ match, backupDir });
    }
    return { backupRoot, staged };
  } catch (error) {
    const restoreErrors: unknown[] = [];
    for (const item of staged.reverse()) {
      try {
        await renameManagedSkillDirWithRetry(item.backupDir, item.match.dir);
      } catch (restoreError) {
        restoreErrors.push(restoreError);
        logger.error('Failed to restore staged skill after overwrite staging failure', {
          dir: item.match.dir,
          restoreError,
        });
      }
    }
    if (restoreErrors.length > 0) {
      // Keep the hidden backup on disk for manual recovery; deleting it here
      // would turn a staging error into irreversible skill loss.
      throw new AggregateError(
        [error, ...restoreErrors],
        `Failed to stage skill overwrite; recovery backup retained at ${backupRoot}`,
        { cause: error },
      );
    }
    rmSync(backupRoot, { recursive: true, force: true });
    throw error;
  }
}

async function restoreStagedSkillDirs(
  backupRoot: string,
  staged: StagedManagedSkillDir[],
  skillsRoot: string,
  rootEntriesBeforeInstall: Set<string>,
): Promise<void> {
  // Remove directories created by the failed install without touching pre-existing
  // unrelated skills. The hidden backup root is restored below.
  for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || rootEntriesBeforeInstall.has(entry.name)) continue;
    const createdDir = join(skillsRoot, entry.name);
    if (!removeSkillDir(createdDir)) {
      throw new Error(`Failed to remove partial skill install: ${createdDir}`);
    }
  }

  for (const item of staged) {
    if (existsSync(item.match.dir) && !removeSkillDir(item.match.dir)) {
      throw new Error(`Failed to clear partial overwrite target: ${item.match.dir}`);
    }
    await renameManagedSkillDirWithRetry(item.backupDir, item.match.dir);
  }
  rmSync(backupRoot, { recursive: true, force: true });
}

function removeFreshInstallDirs(
  skillsRoot: string,
  rootEntriesBeforeInstall: Set<string>,
): void {
  for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || rootEntriesBeforeInstall.has(entry.name)) continue;
    const createdDir = join(skillsRoot, entry.name);
    if (!removeSkillDir(createdDir)) {
      throw new Error(`Failed to remove partial fresh skill install: ${createdDir}`);
    }
  }
}

async function runAfterCommitBestEffort<T>(
  callback: ((value: T) => Promise<void>) | undefined,
  value: T,
): Promise<void> {
  if (!callback) return;
  try {
    await callback(value);
  } catch (error) {
    // The install/config transaction is already valid. Winner convergence is
    // recoverable and must not roll back a committed skill/config pair.
    logger.warn('Managed skill winner convergence deferred after commit', { error });
  }
}

export type RunManagedSameNameInstallResult<T> =
  | { ok: true; value: T; overwritten: boolean; removedKeys: string[] }
  | {
    ok: false;
    code: typeof SAME_NAME_EXISTS_CODE;
    displayName: string;
    existingIds: string[];
  };

/**
 * Transactional user-install policy.
 *
 * Existing matching dirs are renamed into a hidden backup under the same
 * filesystem. A failed or incomplete install removes its newly-created dirs and
 * restores the old skill. Stale config aliases are purged only after the new
 * installation is present.
 */
export async function runManagedSameNameInstall<T>(params: {
  skillName: string;
  skillAliases?: string[];
  overwriteSameName?: boolean;
  skillsRoot?: string;
  withFilesystemGuard?: (
    operation: () => Promise<RunManagedSameNameInstallResult<T>>,
  ) => Promise<RunManagedSameNameInstallResult<T>>;
  install: () => Promise<T>;
  afterCommit?: (value: T) => Promise<void>;
}): Promise<RunManagedSameNameInstallResult<T>> {
  return withManagedSkillMutationLock(async () => {
    const operation = async (): Promise<RunManagedSameNameInstallResult<T>> => {
      const skillsRoot = params.skillsRoot ?? getOpenClawSkillsDir();
      const gate = gateManagedSameNameInstall({
        skillName: params.skillName,
        skillAliases: params.skillAliases,
        overwriteSameName: params.overwriteSameName,
        skillsRoot,
      });
      if (gate.action === 'confirm') {
        return {
          ok: false,
          code: gate.code,
          displayName: gate.displayName,
          existingIds: gate.existingIds,
        };
      }

      if (gate.matches.length === 0) {
        const rootEntriesBeforeInstall = new Set(
          readdirSync(skillsRoot, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name),
        );
        try {
          const value = await params.install();
          await runAfterCommitBestEffort(params.afterCommit, value);
          return {
            ok: true,
            value,
            overwritten: false,
            removedKeys: [],
          };
        } catch (error) {
          removeFreshInstallDirs(skillsRoot, rootEntriesBeforeInstall);
          throw error;
        }
      }

      const { backupRoot, staged } = await stageManagedSkillDirs(gate.matches, skillsRoot);
      const rootEntriesBeforeInstall = new Set(
        readdirSync(skillsRoot, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name),
      );

      try {
        const value = await params.install();
        const installedMatchesByDir = new Map<string, ManagedSkillDirMatch>();
        for (const identity of [params.skillName, ...(params.skillAliases || [])]) {
          for (const match of findManagedSkillDirsMatchingInstallName(identity, skillsRoot)) {
            installedMatchesByDir.set(match.dir, match);
          }
        }
        const installedMatches = [...installedMatchesByDir.values()];
        if (installedMatches.length === 0) {
          throw new Error('SKILL_OVERWRITE_INSTALL_MISSING');
        }

        const preservedAliases = new Set<string>([
          params.skillName,
          ...(params.skillAliases || []),
        ]);
        for (const match of installedMatches) {
          preservedAliases.add(match.folderName);
          preservedAliases.add(match.canonicalName);
          for (const alias of match.aliases) preservedAliases.add(alias);
        }
        const newCanonicalSkillId = installedMatches
          .map((match) => normalizeKey(match.canonicalName))
          .find(Boolean)
          || normalizeKey(params.skillName);
        const removedKeys = await purgeStaleSkillAliases(
          gate.matches,
          preservedAliases,
          newCanonicalSkillId,
        );
        await runAfterCommitBestEffort(params.afterCommit, value);
        rmSync(backupRoot, { recursive: true, force: true });
        return { ok: true, value, overwritten: true, removedKeys };
      } catch (error) {
        try {
          await restoreStagedSkillDirs(
            backupRoot,
            staged,
            skillsRoot,
            rootEntriesBeforeInstall,
          );
        } catch (restoreError) {
          logger.error('Failed to roll back same-name skill overwrite', {
            skillName: params.skillName,
            restoreError,
          });
          throw new AggregateError(
            [error, restoreError],
            'Skill overwrite failed and rollback could not fully restore the previous skill',
            { cause: restoreError },
          );
        }
        throw error;
      }
    };

    if (params.withFilesystemGuard) {
      return params.withFilesystemGuard(operation);
    }
    return operation();
  });
}
