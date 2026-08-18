import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export async function beginOfficeStoreTestIsolation(): Promise<string> {
  const testRoot = await mkdtemp(join(tmpdir(), 'office-test-'));
  process.env.OPENCLAW_HOME = join(testRoot, '.openclaw');
  await seedOfficeRecoveryArtifacts(testRoot);
  return testRoot;
}

export async function endOfficeStoreTestIsolation(testRoot: string): Promise<void> {
  delete process.env.OPENCLAW_HOME;
  await rm(testRoot, { recursive: true, force: true });
}

/** Minimal artifacts for `recoverOfficeStoreFromArtifacts` in isolated OPENCLAW_HOME. */
export async function seedOfficeRecoveryArtifacts(testRoot: string): Promise<void> {
  const openclawHome = join(testRoot, '.openclaw');
  const officeDir = join(openclawHome, 'office');
  const workspaceOffice = join(openclawHome, 'workspace-pm', 'office');
  await mkdir(officeDir, { recursive: true });
  await mkdir(workspaceOffice, { recursive: true });
  await writeFile(join(workspaceOffice, 'role-pm-skills.json'), JSON.stringify({ allow: [] }), 'utf8');
  await writeFile(
    join(officeDir, 'audit.jsonl'),
    `${JSON.stringify({ scenarioId: 'scenario-recovered', action: 'test' })}\n`,
    'utf8',
  );
}
