import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

/**
 * Prefer CI buildDisplayVersion (YYYYMMDD-HHMMSS) when present on the packaged
 * package.json; otherwise fall back to Electron's semver app version.
 */
export function getAppDisplayVersion(): string {
  try {
    const pkgPath = join(app.getAppPath(), 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      buildDisplayVersion?: unknown;
    };
    if (typeof pkg.buildDisplayVersion === 'string') {
      const display = pkg.buildDisplayVersion.trim();
      if (display) return display;
    }
  } catch {
    // packaged path / parse failures → semver fallback
  }
  return app.getVersion();
}
