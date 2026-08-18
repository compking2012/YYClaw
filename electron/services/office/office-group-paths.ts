import { join } from 'node:path';
import { OPENCLAW_HOME } from '../../utils/openclaw-paths';
import { sanitizeNotebookDirName } from '../../../src/lib/office-project-notebook';

export const OFFICE_GROUP_DIR = 'group';
export const OFFICE_PROJECT_DIR = 'project';

export function sanitizeOfficeDirName(name: string): string {
  return sanitizeNotebookDirName(name.trim()) || 'untitled';
}

export function fixedGroupDirSegment(groupName: string, groupId: string): string {
  const base = sanitizeOfficeDirName(groupName);
  const suffix = groupId.slice(-6);
  return `${base}-${suffix}`;
}

export function officeGroupRoot(groupName: string, groupId: string): string {
  return join(
    OPENCLAW_HOME,
    'office',
    OFFICE_GROUP_DIR,
    fixedGroupDirSegment(groupName, groupId),
  );
}

export function officeGroupManifestPath(groupName: string, groupId: string): string {
  return join(officeGroupRoot(groupName, groupId), 'manifest.json');
}

export function officeGroupWorkflowDir(groupName: string, groupId: string): string {
  return join(officeGroupRoot(groupName, groupId), 'workflow');
}
