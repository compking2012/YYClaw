import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getOpenClawSkillsDir } from '../../utils/paths';
import type { GatewayManager } from '../../gateway/manager';
import { migrateManagedSkillReplacementConfig } from '../../utils/agent-config';
import { logger } from '../../utils/logger';
import { withGatewayHotSkillFilesystem } from './skill-gateway-fs-guard';
import { withManagedSkillMutationLock } from './managed-skill-lock';
import { readSkillManifestCanonicalName } from './skill-manifest';
import { renameManagedSkillDirWithRetry } from './skill-fs-mutate';

const INSTALL_META_FILENAME = '.clawx-install.json';
const SHADOWED_DIRNAME = '.clawx-shadowed';
let reconcileTimer: ReturnType<typeof setTimeout> | null = null;

export type ManagedSkillInstallMetadata = {
  installedAt: string;
  source: string;
  canonicalName: string;
  slug?: string;
  version?: string;
  versionBase?: string;
};

export function writeManagedSkillInstallMetadata(
  skillDir: string,
  metadata: ManagedSkillInstallMetadata,
): void {
  writeFileSync(
    join(skillDir, INSTALL_META_FILENAME),
    JSON.stringify(metadata, null, 2),
    'utf8',
  );
}

function readJson(filePath: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function timestampForSkillDir(skillDir: string): number {
  const installMeta = readJson(join(skillDir, INSTALL_META_FILENAME));
  const serverMeta = readJson(join(skillDir, '.clawx-server-marketplace.json'));
  const raw = installMeta?.installedAt || serverMeta?.installedAt;
  const parsed = typeof raw === 'string' ? Date.parse(raw) : Number.NaN;
  if (Number.isFinite(parsed)) return parsed;
  try {
    return statSync(skillDir).mtimeMs;
  } catch {
    return 0;
  }
}

type ManagedCandidate = {
  dir: string;
  folderName: string;
  canonicalName: string;
  timestamp: number;
  aliases: string[];
};

function aliasesForSkillDir(skillDir: string, folderName: string, canonicalName: string): string[] {
  const aliases = new Set([folderName, canonicalName]);
  for (const filename of [INSTALL_META_FILENAME, '.clawx-server-marketplace.json', 'manifest.json']) {
    const metadata = readJson(join(skillDir, filename));
    for (const field of ['slug', 'versionBase']) {
      const value = metadata?.[field];
      if (typeof value === 'string' && value.trim()) aliases.add(value.trim());
    }
  }
  return [...aliases];
}

/**
 * Keep exactly one active P1 directory for each canonical SKILL.md name.
 * Controlled installs carry installedAt metadata; legacy/direct installs use
 * directory mtime only as a fallback. Losers are recoverably quarantined.
 */
export async function reconcileManagedSkillWinners(
  skillsRoot = getOpenClawSkillsDir(),
): Promise<{ quarantined: string[] }> {
  return withManagedSkillMutationLock(async () => {
    return await reconcileManagedSkillWinnersWhileLocked(skillsRoot);
  });
}

/**
 * Reconcile while the caller already owns `withManagedSkillMutationLock`.
 * Used from runManagedSameNameInstall.afterCommit to avoid lock re-entry.
 */
export async function reconcileManagedSkillWinnersWhileLocked(
  skillsRoot = getOpenClawSkillsDir(),
): Promise<{ quarantined: string[] }> {
  if (!existsSync(skillsRoot)) return { quarantined: [] };
  let entries;
  try {
    entries = await readdir(skillsRoot, { withFileTypes: true });
  } catch {
    return { quarantined: [] };
  }

  const groups = new Map<string, ManagedCandidate[]>();
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const dir = join(skillsRoot, entry.name);
    const canonicalName = readSkillManifestCanonicalName(dir);
    if (!canonicalName) continue;
    const key = canonicalName.trim().toLowerCase();
    if (!key) continue;
    const candidate = {
      dir,
      folderName: entry.name,
      canonicalName,
      timestamp: timestampForSkillDir(dir),
      aliases: aliasesForSkillDir(dir, entry.name, canonicalName),
    };
    groups.set(key, [...(groups.get(key) || []), candidate]);
  }

  const quarantined: string[] = [];
  for (const candidates of groups.values()) {
    if (candidates.length < 2) continue;
    candidates.sort((left, right) =>
      right.timestamp - left.timestamp || left.folderName.localeCompare(right.folderName));
    const winner = candidates[0]!;
    const losers = candidates.slice(1);
    const bucket = join(skillsRoot, SHADOWED_DIRNAME, `${Date.now()}-${winner.folderName}`);
    const pendingBucket = join(skillsRoot, SHADOWED_DIRNAME, `.pending-${Date.now()}-${winner.folderName}`);
    mkdirSync(pendingBucket, { recursive: true });
    const staged: Array<{ from: string; pending: string; final: string }> = [];
    for (const loser of losers) {
      const pending = join(pendingBucket, loser.folderName);
      const final = join(bucket, loser.folderName);
      await renameManagedSkillDirWithRetry(loser.dir, pending);
      staged.push({ from: loser.dir, pending, final });
    }
    try {
      await migrateManagedSkillReplacementConfig({
        staleAliases: losers.flatMap((loser) => loser.aliases),
        newCanonicalSkillId: winner.canonicalName,
      });
    } catch (error) {
      for (const item of staged.reverse()) {
        try {
          await renameManagedSkillDirWithRetry(item.pending, item.from);
        } catch {
          // The original config write failed; keep any unrecoverable staging
          // directory hidden rather than expose a partial loser to Gateway.
        }
      }
      throw error;
    }
    mkdirSync(bucket, { recursive: true });
    for (const item of staged) {
      try {
        await renameManagedSkillDirWithRetry(item.pending, item.final);
        quarantined.push(item.final);
      } catch {
        // Config now points at the winner and the loser is already hidden in
        // .pending. Keep that safe state; a future reconcile can finish moving
        // the quarantine entry without reopening the loser to Gateway.
        quarantined.push(item.pending);
      }
    }
  }
  return { quarantined };
}

/** Debounced convergence for standard chat/runtime installs that bypass Settings. */
export function scheduleManagedSkillWinnerReconcile(
  gatewayManager: GatewayManager,
  delayMs = 800,
): void {
  if (reconcileTimer) clearTimeout(reconcileTimer);
  reconcileTimer = setTimeout(() => {
    reconcileTimer = null;
    void withGatewayHotSkillFilesystem(
      gatewayManager,
      reconcileManagedSkillWinners,
    ).catch((error) => {
      logger.warn('Failed to reconcile managed skill winners after chat install', { error });
    });
  }, delayMs);
}
