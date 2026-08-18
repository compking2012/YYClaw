import { appendFile } from 'node:fs/promises';
import { ensureOfficeDirs, getOfficeAuditPath } from './paths';

export async function auditLog(event: string, payload: Record<string, unknown>): Promise<void> {
  await ensureOfficeDirs();
  const line = JSON.stringify({ ts: Date.now(), event, ...payload }) + '\n';
  await appendFile(getOfficeAuditPath(), line, 'utf8');
}
