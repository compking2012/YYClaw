import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('office-project-session-dir', () => {
  it('removes the entire hidden session directory', async () => {
    const home = mkdtempSync(join(tmpdir(), 'office-session-dir-'));
    const projectRoot = join(home, 'proj');
    const sessionDir = join(projectRoot, '.session');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'session_产品.md'), '# session', 'utf8');

    const { removeOfficeProjectSessionDir } = await import(
      '../../electron/services/office/office-project-session-dir'
    );
    await removeOfficeProjectSessionDir({
      id: 'proj-1',
      title: 'Demo',
      projectRootPath: projectRoot,
    });

    expect(existsSync(sessionDir)).toBe(false);
    expect(existsSync(projectRoot)).toBe(true);
  });
});
