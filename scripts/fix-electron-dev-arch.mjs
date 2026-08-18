#!/usr/bin/env node
/**
 * Repair node_modules/electron/dist to the host-native CPU arch after install.
 *
 * Why this exists:
 *   package.json sets pnpm.supportedArchitectures.cpu = ["x64", "arm64"] so that
 *   `release:mac` can package BOTH Intel (x64) and Apple Silicon (arm64) mac apps
 *   (their native modules — sharp/koffi/etc. — need both prebuilds). A side effect
 *   is that pnpm runs electron's install script twice (npm_config_arch=x64 and
 *   =arm64) and both extract into the SAME node_modules/electron/dist, racing and
 *   clobbering each other. The result on Apple Silicon is often an x86_64 binary
 *   (so `pnpm dev` runs under Rosetta and is very slow) or a half-extracted dist.
 *
 * This dist is ONLY used by `pnpm dev` (vite-plugin-electron launches it).
 * `release:mac` is unaffected — electron-builder downloads its own Electron per
 * target arch independently of this dist. So we just realign dist to the host's
 * native arch here. Runs as the last step of `postinstall`, after the racing
 * install scripts have finished, so the repair is deterministic.
 *
 * Idempotent: skips work when dist already matches the native arch.
 */

import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, rmSync, renameSync } from 'fs';
import { dirname, join } from 'path';

const rootRequire = createRequire(import.meta.url);

let electronDir;
try {
  electronDir = dirname(rootRequire.resolve('electron/package.json'));
} catch {
  console.log('[fix-electron-dev-arch] electron not installed, skipping');
  process.exit(0);
}

// Resolve electron's bundled deps from electron's own module context.
const electronRequire = createRequire(join(electronDir, 'package.json'));
const { version } = electronRequire('./package.json');
const { downloadArtifact } = electronRequire('@electron/get');
// electron >= 40.10 renamed its bundled unzip dep from `extract-zip` to
// `@electron-internal/extract-zip` (and exposes the fn as a default export).
// Try the new name first, fall back to the old one for older electron.
const extract = (() => {
  for (const name of ['@electron-internal/extract-zip', 'extract-zip']) {
    try {
      const mod = electronRequire(name);
      return typeof mod === 'function' ? mod : mod.default;
    } catch {
      // try next candidate
    }
  }
  throw new Error(
    '[fix-electron-dev-arch] neither @electron-internal/extract-zip nor extract-zip is resolvable from electron',
  );
})();
const checksums = electronRequire('./checksums.json');

const platform = process.platform;
const arch = process.arch;

const platformPath =
  platform === 'win32'
    ? 'electron.exe'
    : platform === 'darwin'
      ? 'Electron.app/Contents/MacOS/Electron'
      : 'electron';

const distDir = join(electronDir, 'dist');
const binPath = join(distDir, platformPath);
const pathTxt = join(electronDir, 'path.txt');

// Map process.arch -> token printed by `file(1)` for that arch's Mach-O/ELF.
const ARCH_FILE_TOKEN = { arm64: 'arm64', x64: 'x86_64' };

function binMatchesArch() {
  // `file` is available on darwin/linux; on win32 skip the arch sniff.
  if (platform === 'win32') return true;
  const token = ARCH_FILE_TOKEN[arch];
  if (!token) return true; // unknown arch — don't fight it
  try {
    return execFileSync('file', [binPath], { encoding: 'utf-8' }).includes(token);
  } catch {
    return false;
  }
}

function isHealthy() {
  try {
    if (readFileSync(join(distDir, 'version'), 'utf-8').replace(/^v/, '') !== version) return false;
    if (!existsSync(binPath)) return false;
    return binMatchesArch();
  } catch {
    return false;
  }
}

if (isHealthy()) {
  console.log(`[fix-electron-dev-arch] dist already native (${platform}-${arch}), nothing to do`);
  process.exit(0);
}

console.log(`[fix-electron-dev-arch] repairing dist -> ${platform}-${arch} (v${version})`);

rmSync(distDir, { recursive: true, force: true });
rmSync(pathTxt, { force: true });

const zipPath = await downloadArtifact({
  version,
  artifactName: 'electron',
  platform,
  arch,
  checksums,
});

await extract(zipPath, { dir: distDir });

// install.js moves the type definitions up to the module root.
const srcTypeDef = join(distDir, 'electron.d.ts');
if (existsSync(srcTypeDef)) {
  renameSync(srcTypeDef, join(electronDir, 'electron.d.ts'));
}

writeFileSync(pathTxt, platformPath);

// Sanity check — never leave a half-extracted dist behind.
if (!isHealthy()) {
  console.error('[fix-electron-dev-arch] repair failed: dist still incomplete after extract');
  process.exit(1);
}

console.log(`[fix-electron-dev-arch] done -> ${platform}-${arch}`);
