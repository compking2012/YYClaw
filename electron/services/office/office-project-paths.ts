import { join } from 'node:path';
import { OPENCLAW_HOME } from '../../utils/openclaw-paths';
import { projectDirSegment } from '../../../src/lib/office-project-context';
import { sanitizeNotebookDirName } from '../../../src/lib/office-project-notebook';

export const OFFICE_PROJECT_DIR = 'project';

/** 临时项目唯一根目录：~/.openclaw/office/project/<projectId>/ */
export function tempProjectRoot(projectTitle: string, projectId: string): string {
  return join(
    OPENCLAW_HOME,
    'office',
    OFFICE_PROJECT_DIR,
    projectDirSegment(projectTitle, projectId),
  );
}

export function tempProjectManifestPath(projectTitle: string, projectId: string): string {
  return join(tempProjectRoot(projectTitle, projectId), 'manifest.json');
}

export function tempProjectRoomDir(projectTitle: string, projectId: string): string {
  return join(tempProjectRoot(projectTitle, projectId), 'room');
}

export function tempProjectDeliverablesDir(projectTitle: string, projectId: string): string {
  return join(tempProjectRoot(projectTitle, projectId), 'deliverables');
}

export function tempProjectStatusDir(projectTitle: string, projectId: string): string {
  return join(tempProjectRoot(projectTitle, projectId), 'status');
}

/** 结项 zip：<项目名>.zip，位于项目根目录。 */
export function tempProjectBundleZipPath(projectTitle: string, projectId: string): string {
  const base = sanitizeNotebookDirName(projectTitle) || 'untitled';
  return join(tempProjectRoot(projectTitle, projectId), `${base}.zip`);
}

export const MAX_PROJECT_BUNDLE_BYTES = 100 * 1024 * 1024;
