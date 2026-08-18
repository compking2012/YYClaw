import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { OPENCLAW_HOME } from '../../utils/openclaw-paths';
import { OFFICE_GROUP_DIR } from './office-group-paths';
import { OFFICE_PROJECT_DIR } from './office-project-paths';

/** Office roster / team / project metadata (not runtime room chat or deliverables). */
export function getOfficeDataDir(): string {
  return join(OPENCLAW_HOME, 'office');
}

export function getOfficeDataPath(): string {
  return join(getOfficeDataDir(), 'data.json');
}

export function getOfficeGroupDataDir(): string {
  return join(getOfficeDataDir(), OFFICE_GROUP_DIR);
}

export function getOfficeProjectDataDir(): string {
  return join(getOfficeDataDir(), OFFICE_PROJECT_DIR);
}

export function getOfficeAuditPath(): string {
  return join(getOfficeDataDir(), 'audit.jsonl');
}

export async function ensureOfficeDirs(): Promise<void> {
  const dirs = [
    getOfficeDataDir(),
    getOfficeGroupDataDir(),
    getOfficeProjectDataDir(),
  ];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }
}
