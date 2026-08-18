/**
 * OpenClaw workspace context utilities.
 *
 * All file I/O is async (fs/promises) to avoid blocking the Electron
 * main thread.
 */
import { access, readFile, writeFile, readdir, mkdir, unlink } from 'fs/promises';
import { constants } from 'fs';
import { createHash } from 'crypto';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { logger } from './logger';
import { expandPath, getResourcesDir, resolveOpenClawConfigPath, resolveOpenClawStateDir } from './paths';
import { execOpenclaw } from './openclaw-cli';

const CLAWX_BEGIN = '<!-- clawx:begin -->';
const CLAWX_END = '<!-- clawx:end -->';

// ── Helpers ──────────────────────────────────────────────────────

async function fileExists(p: string): Promise<boolean> {
  try { await access(p, constants.F_OK); return true; } catch { return false; }
}

async function ensureDir(dir: string): Promise<void> {
  if (!(await fileExists(dir))) {
    await mkdir(dir, { recursive: true });
  }
}

// ── Pure helpers (no I/O) ────────────────────────────────────────

/**
 * Merge a ClawX context section into an existing file's content.
 * If markers already exist, replaces the section in-place.
 * Otherwise appends it at the end.
 */
export function mergeClawXSection(existing: string, section: string): string {
  const wrapped = `${CLAWX_BEGIN}\n${section.trim()}\n${CLAWX_END}`;
  const beginIdx = existing.indexOf(CLAWX_BEGIN);
  const endIdx = existing.indexOf(CLAWX_END);
  if (beginIdx !== -1 && endIdx !== -1) {
    return existing.slice(0, beginIdx) + wrapped + existing.slice(endIdx + CLAWX_END.length);
  }
  return existing.trimEnd() + '\n\n' + wrapped + '\n';
}

/**
 * Strip the "## First Run" section from workspace AGENTS.md content.
 * This section is seeded by the OpenClaw Gateway but is unnecessary
 * for ClawX-managed workspaces.  Removes everything from the heading
 * line until the next markdown heading (any level) or end of content.
 */
export function stripFirstRunSection(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let skipping = false;
  let consumedFirstParagraph = false;
  let seenBlankAfterParagraph = false;

  for (const line of lines) {
    const isHeading = /^#{1,6}\s/.test(line);
    const trimmed = line.trim();

    if (line.trim() === '## First Run') {
      skipping = true;
      consumedFirstParagraph = false;
      seenBlankAfterParagraph = false;
      continue;
    }

    if (skipping) {
      // A new heading marks the end of the First Run block.
      if (isHeading) {
        skipping = false;
      } else if (!consumedFirstParagraph) {
        // Drop leading blank lines and the first guidance paragraph.
        if (trimmed.length === 0) {
          continue;
        }
        consumedFirstParagraph = true;
        continue;
      } else if (!seenBlankAfterParagraph) {
        // Keep consuming the same paragraph until a blank line appears.
        if (trimmed.length === 0) {
          seenBlankAfterParagraph = true;
          continue;
        }
        continue;
      } else {
        // After paragraph + blank line, preserve subsequent body content.
        if (trimmed.length === 0) {
          continue;
        }
        skipping = false;
      }
    }

    if (!skipping) {
      result.push(line);
    }
  }

  // Collapse any resulting triple+ blank lines into double
  return result.join('\n').replace(/\n{3,}/g, '\n\n');
}

// ── Workspace directory resolution ───────────────────────────────

/**
 * Collect unique workspace directories declared in openclaw.json: each
 * agent's workspace under `agents.list`, plus `agents.defaults.workspace`
 * (only when the agent list is non-empty). Returns an empty array when no
 * agents are configured — workspaces are created on demand when an agent is
 * created, not eagerly on startup.
 */
async function resolveAllWorkspaceDirs(): Promise<string[]> {
  const openclawDir = join(homedir(), '.openclaw');
  const dirs = new Set<string>();

  const configPath = join(openclawDir, 'openclaw.json');
  try {
    if (await fileExists(configPath)) {
      const config = JSON.parse(await readFile(configPath, 'utf-8'));

      const agents = config?.agents?.list;
      if (Array.isArray(agents)) {
        for (const agent of agents) {
          const ws = agent?.workspace;
          if (typeof ws === 'string' && ws.trim()) {
            dirs.add(ws.replace(/^~/, homedir()));
          }
        }

        // Only seed defaults.workspace when at least one agent exists.
        // deleteAgentConfig does not clear defaults.workspace, so collecting
        // it unconditionally would recreate a deleted agent's workspace dir
        // on the next startup via the context merge's ensureDir.
        if (agents.length > 0) {
          const defaultWs = config?.agents?.defaults?.workspace;
          if (typeof defaultWs === 'string' && defaultWs.trim()) {
            dirs.add(defaultWs.replace(/^~/, homedir()));
          }
        }
      }
    }
  } catch {
    // ignore config parse errors
  }

  // We intentionally do NOT scan ~/.openclaw/ for any directory starting
  // with 'workspace'. Doing so causes a race condition where a recently deleted
  // agent's workspace (e.g., workspace-code23) is found and resuscitated by
  // the context merge routine before its deletion finishes. Only workspaces
  // explicitly declared in openclaw.json should be seeded.

  return [...dirs];
}

/**
 * Raw `agents.defaults.workspace` from openclaw.json (unexpanded, may be
 * `~`-prefixed), or null when unset / unreadable.
 */
async function readDefaultAgentWorkspace(): Promise<string | null> {
  try {
    const raw = await readFile(resolveOpenClawConfigPath(), 'utf-8');
    const config = JSON.parse(raw);
    const ws = config?.agents?.defaults?.workspace;
    return typeof ws === 'string' && ws.trim() ? ws : null;
  } catch {
    return null;
  }
}

/**
 * Seed OpenClaw's canonical bootstrap files (AGENTS.md, TOOLS.md, and the
 * optional IDENTITY.md / USER.md / SOUL.md / HEARTBEAT.md set) into `workspace`
 * without the interactive onboarding wizard.
 *
 * `openclaw setup` is an alias for `openclaw onboard`, whose default path is a
 * conversational wizard that aborts with "Onboarding needs an interactive TTY"
 * when spawned from the main process (we never allocate a TTY). `--baseline`
 * runs the minimal, prompt-free path: it ensures config/workspace/session
 * directories and seeds bootstrap files, nothing else.
 *
 * Baseline setup repoints `agents.defaults.workspace` at the target dir as a
 * side effect, so we capture and restore the original default. Without this,
 * seeding a secondary agent's workspace (new-agent provisioning) or rebuilding
 * a non-default agent's persona would silently move the default agent to the
 * wrong workspace.
 */
export async function seedWorkspaceBootstrapFiles(workspace: string): Promise<void> {
  const originalDefaultWorkspace = await readDefaultAgentWorkspace();
  await execOpenclaw(['setup', '--baseline', '--workspace', workspace]);
  if (
    originalDefaultWorkspace &&
    resolve(expandPath(originalDefaultWorkspace)) !== resolve(workspace)
  ) {
    try {
      await execOpenclaw(['config', 'set', 'agents.defaults.workspace', originalDefaultWorkspace]);
    } catch (error) {
      logger.warn('Failed to restore agents.defaults.workspace after baseline setup', {
        error: String(error),
      });
    }
  }
}

/**
 * Clear the `setupCompletedAt` marker in a workspace's OpenClaw state file so a
 * subsequent `openclaw setup` re-seeds the OPTIONAL bootstrap files
 * (IDENTITY.md, USER.md, SOUL.md, HEARTBEAT.md) instead of only the required
 * AGENTS.md / TOOLS.md.
 *
 * OpenClaw's ensureAgentWorkspace() adds every optional bootstrap file to its
 * skip set once `isWorkspaceSetupCompleted(dir)` is true, so a "rebuild" on an
 * already-completed workspace never restores missing optional files. Clearing
 * only `setupCompletedAt` (and keeping `bootstrapSeededAt`) lets setup re-seed
 * the optional files; OpenClaw's own reconcile step then re-marks the workspace
 * completed without re-creating BOOTSTRAP.md.
 */
export async function resetWorkspaceSetupCompletion(workspaceDir: string): Promise<void> {
  const statePath = join(workspaceDir, 'openclaw-workspace-state.json');
  let raw: string;
  try {
    raw = await readFile(statePath, 'utf-8');
  } catch {
    // No state file yet → setup already treats the workspace as not completed.
    return;
  }

  let state: Record<string, unknown>;
  try {
    state = JSON.parse(raw);
  } catch {
    logger.warn(`Workspace state file is not valid JSON, skipping reset: ${statePath}`);
    return;
  }

  if (typeof state.setupCompletedAt !== 'string') return;

  delete state.setupCompletedAt;
  try {
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
    logger.info(`Reset workspace setup-completed marker for rebuild: ${statePath}`);
  } catch (err) {
    logger.warn(`Failed to reset workspace setup state ${statePath}: ${String(err)}`);
  }
}

// ── Bootstrap file repair ────────────────────────────────────────

/**
 * Remove OpenClaw's "recent workspace attestation" markers for a workspace so
 * `openclaw setup` will re-seed missing bootstrap files instead of throwing
 * WorkspaceVanishedError.
 *
 * ClawX intentionally deletes BOOTSTRAP.md after the gateway seeds a workspace
 * (see removeChatFirstBootstrapFiles). On a re-`setup`, OpenClaw sees a recent
 * attestation but a missing BOOTSTRAP.md and concludes the workspace
 * "disappeared", refusing to reseed. Clearing the attestation is exactly what
 * OpenClaw's own error message prescribes for an intentional reset, which is
 * what rebuilding the persona templates is.
 *
 * Mirrors OpenClaw's resolveWorkspaceAttestationPaths(): a hashed marker under
 * each state dir's `workspace-attestations/`, plus a legacy sibling `.attested`
 * file next to the workspace.
 */
export async function clearWorkspaceAttestation(workspaceDir: string): Promise<void> {
  const resolved = resolve(workspaceDir);
  const key = createHash('sha256').update(resolved).digest('hex');

  // State dirs OpenClaw scans: the configured/default (~/.openclaw) plus the
  // legacy ~/.clawdbot. Clear the hashed marker in each, then the legacy sibling.
  const stateDirs = new Set<string>([
    resolveOpenClawStateDir(),
    join(homedir(), '.clawdbot'),
  ]);

  const candidates = [
    ...[...stateDirs].map((dir) => join(dir, 'workspace-attestations', `${key}.attested`)),
    `${resolved}.attested`,
  ];

  for (const path of candidates) {
    try {
      await unlink(path);
      logger.info(`Cleared OpenClaw workspace attestation for rebuild: ${path}`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn(`Failed to clear workspace attestation ${path}: ${String(err)}`);
      }
    }
  }
}


/**
 * Detect and remove bootstrap .md files that contain only ClawX markers
 * with no meaningful OpenClaw content outside them.
 */
export async function repairClawXOnlyBootstrapFiles(): Promise<void> {
  const workspaceDirs = await resolveAllWorkspaceDirs();
  for (const workspaceDir of workspaceDirs) {
    if (!(await fileExists(workspaceDir))) continue;

    let entries: string[];
    try {
      entries = (await readdir(workspaceDir)).filter((f) => f.endsWith('.md'));
    } catch {
      continue;
    }

    for (const file of entries) {
      const filePath = join(workspaceDir, file);
      let content: string;
      try {
        content = await readFile(filePath, 'utf-8');
      } catch {
        continue;
      }
      const beginIdx = content.indexOf(CLAWX_BEGIN);
      const endIdx = content.indexOf(CLAWX_END);
      if (beginIdx === -1 || endIdx === -1) continue;

      const before = content.slice(0, beginIdx).trim();
      const after = content.slice(endIdx + CLAWX_END.length).trim();
      if (before === '' && after === '') {
        try {
          await unlink(filePath);
          logger.info(`Removed YYClaw-only bootstrap file for re-seeding: ${file} (${workspaceDir})`);
        } catch {
          logger.warn(`Failed to remove YYClaw-only bootstrap file: ${filePath}`);
        }
      }
    }
  }
}

/**
 * ClawX ships a default desktop identity and does not need OpenClaw's
 * chat-first personalization script. Once the Gateway has seeded the regular
 * workspace files, remove BOOTSTRAP.md so sessions start normally.
 */
export async function removeChatFirstBootstrapFiles(): Promise<void> {
  const workspaceDirs = await resolveAllWorkspaceDirs();
  for (const workspaceDir of workspaceDirs) {
    const bootstrapPath = join(workspaceDir, 'BOOTSTRAP.md');
    if (!(await fileExists(bootstrapPath))) continue;

    try {
      await unlink(bootstrapPath);
      logger.info(`Removed chat-first bootstrap file from YYClaw workspace (${workspaceDir})`);
    } catch {
      logger.warn(`Failed to remove chat-first bootstrap file: ${bootstrapPath}`);
    }
  }
}

// ── Context merging ──────────────────────────────────────────────

/**
 * Merge ClawX context snippets into workspace bootstrap files that
 * already exist on disk.  Returns the number of target files that were
 * skipped because they don't exist yet.
 */
async function mergeClawXContextOnce(): Promise<number> {
  const contextDir = join(getResourcesDir(), 'context');
  if (!(await fileExists(contextDir))) {
    logger.debug('YYClaw context directory not found, skipping context merge');
    return 0;
  }

  let files: string[];
  try {
    files = (await readdir(contextDir)).filter((f) => f.endsWith('.clawx.md'));
  } catch {
    return 0;
  }

  const workspaceDirs = await resolveAllWorkspaceDirs();
  let skipped = 0;

  for (const workspaceDir of workspaceDirs) {
    await ensureDir(workspaceDir);

    for (const file of files) {
      const targetName = file.replace('.clawx.md', '.md');
      const targetPath = join(workspaceDir, targetName);

      if (!(await fileExists(targetPath))) {
        logger.debug(`Skipping ${targetName} in ${workspaceDir} (file does not exist yet, will be seeded by gateway)`);
        skipped++;
        continue;
      }

      const section = await readFile(join(contextDir, file), 'utf-8');
      const originalExisting = await readFile(targetPath, 'utf-8');
      let existing = originalExisting;

      // Strip unwanted Gateway-seeded sections before merging
      if (targetName === 'AGENTS.md') {
        const stripped = stripFirstRunSection(existing);
        if (stripped !== existing) {
          existing = stripped;
          logger.info(`Stripped First Run section from ${targetName} (${workspaceDir})`);
        }
      }

      const merged = mergeClawXSection(existing, section);
      // Compare against on-disk content so we persist changes even when only
      // First Run stripping happened and the ClawX section stayed identical.
      if (merged !== originalExisting) {
        await writeFile(targetPath, merged, 'utf-8');
        logger.info(`Merged YYClaw context into ${targetName} (${workspaceDir})`);
      }
    }
  }

  return skipped;
}

export async function ensureClawXIdentityFile(
  workspaceDir: string,
  options?: { createDir?: boolean },
): Promise<void> {
  const contextDir = join(getResourcesDir(), 'context');
  if (!(await fileExists(contextDir))) {
    logger.debug('YYClaw context directory not found, skipping identity merge');
    return;
  }

  if (options?.createDir) {
    await ensureDir(workspaceDir);
  }

  let files: string[];
  try {
    files = (await readdir(contextDir)).filter((f) => f.endsWith('.clawx.md'));
  } catch {
    return;
  }

  for (const file of files) {
    const targetName = file.replace('.clawx.md', '.md');
    const targetPath = join(workspaceDir, targetName);
    if (!(await fileExists(targetPath))) {
      await writeFile(targetPath, '', 'utf-8');
    }
    const section = await readFile(join(contextDir, file), 'utf-8');
    const existing = await readFile(targetPath, 'utf-8');
    const merged = mergeClawXSection(existing, section);
    if (merged !== existing) {
      await writeFile(targetPath, merged, 'utf-8');
    }
  }
}

const RETRY_INTERVAL_MS = 2000;
const MAX_RETRIES = 15;

/**
 * Ensure ClawX context snippets are merged into the openclaw workspace
 * bootstrap files.
 */
export async function ensureClawXContext(..._args: unknown[]): Promise<void> {
  let skipped = await mergeClawXContextOnce();
  if (skipped === 0) {
    await removeChatFirstBootstrapFiles();
    return;
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    await new Promise((r) => setTimeout(r, RETRY_INTERVAL_MS));
    skipped = await mergeClawXContextOnce();
    if (skipped === 0) {
      await removeChatFirstBootstrapFiles();
      logger.info(`YYClaw context merge completed after ${attempt} retry(ies)`);
      return;
    }
    logger.debug(`YYClaw context merge: ${skipped} file(s) still missing (retry ${attempt}/${MAX_RETRIES})`);
  }

  logger.warn(`YYClaw context merge: ${skipped} file(s) still missing after ${MAX_RETRIES} retries`);
  await removeChatFirstBootstrapFiles();
}

export async function ensureClawXDefaultIdentity(): Promise<void> {
  await ensureClawXContext();
}
