import fs from 'node:fs';

export const SKILL_FILESYSTEM_BUSY_CODE = 'SKILL_FILESYSTEM_BUSY';

const BUSY_RETRY_ATTEMPTS = process.platform === 'win32' ? 8 : 5;
const BUSY_RETRY_BASE_MS = process.platform === 'win32' ? 100 : 50;

export class SkillFilesystemBusyError extends Error {
  readonly code = SKILL_FILESYSTEM_BUSY_CODE;

  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'SkillFilesystemBusyError';
  }
}

function isBusyFsError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Rename a managed skill directory with busy-handle retries.
 * Never stops/restarts Gateway; exhausted retries surface SKILL_FILESYSTEM_BUSY.
 */
export async function renameManagedSkillDirWithRetry(
  from: string,
  to: string,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < BUSY_RETRY_ATTEMPTS; attempt += 1) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      lastError = error;
      if (!isBusyFsError(error) || attempt >= BUSY_RETRY_ATTEMPTS - 1) {
        break;
      }
      await delay(BUSY_RETRY_BASE_MS * (attempt + 1));
    }
  }

  if (isBusyFsError(lastError)) {
    throw new SkillFilesystemBusyError(
      `Skill filesystem busy renaming ${from} -> ${to}`,
      lastError,
    );
  }
  throw lastError;
}
