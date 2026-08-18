import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expandPath } from '../../utils/paths';
import { resolveRecordedProjectRoot } from './project-context-paths';
import type { OfficeTempProject } from './types';

/** Per-project agent session markdown export directory (hidden). */
export const OFFICE_PROJECT_SESSION_DIR = '.session';

export function officeProjectSessionDirPath(projectRoot: string): string {
  return join(expandPath(projectRoot), OFFICE_PROJECT_SESSION_DIR);
}

/** Remove the entire `.session` directory for a project (best-effort). */
export async function removeOfficeProjectSessionDir(
  project: Pick<OfficeTempProject, 'id' | 'title' | 'projectRootPath'>,
): Promise<void> {
  const root = await resolveRecordedProjectRoot(project);
  if (!root) return;
  const sessionDir = officeProjectSessionDirPath(root);
  try {
    await rm(sessionDir, { recursive: true, force: true });
  } catch (error) {
    console.warn('[office] failed to remove project session directory', {
      projectId: project.id,
      sessionDir,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
