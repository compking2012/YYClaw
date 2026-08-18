import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Ensure `root` exists and remove only its children.
 * Keeps the root inode so concurrent `mkdir(root, { recursive: true })`
 * cannot race with a full `rm(root)` into ENOENT.
 */
export async function emptyOfficeProjectDirectory(root: string): Promise<void> {
  await mkdir(root, { recursive: true });
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      await mkdir(root, { recursive: true });
      return;
    }
    throw err;
  }
  await Promise.all(
    entries.map((name) => rm(join(root, name), { recursive: true, force: true })),
  );
}
