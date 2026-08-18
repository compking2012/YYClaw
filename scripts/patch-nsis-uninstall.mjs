#!/usr/bin/env node
/**
 * Patch electron-builder's uninstallOldVersion to skip the legacy uninstaller on
 * upgrades. customCheckAppRunning already kills processes and moves $INSTDIR
 * aside; running the old uninstaller often fails on locked openclaw bundles and
 * shows a misleading "app cannot be closed" dialog even when ClawX is not running.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

export const INSTALL_UTIL_NSH = join(
  ROOT,
  'node_modules',
  'app-builder-lib',
  'templates',
  'nsis',
  'include',
  'installUtil.nsh',
);

export const UNINSTALLER_NSH = join(
  ROOT,
  'node_modules',
  'app-builder-lib',
  'templates',
  'nsis',
  'uninstaller.nsh',
);

const PATCH_MARKER = 'ClawX-patched: skip legacy uninstaller';
const UNINSTALLER_CHECK_PATCH_MARKER = 'ClawX-patched: uninstaller check without CHECK_APP_RUNNING';

const SKIP_LEGACY_UNINSTALLER = [
  '  ; ClawX-patched: skip legacy uninstaller on upgrades.',
  '  ; customCheckAppRunning already killed processes and moved $INSTDIR aside.',
  '  DetailPrint "Skipping legacy uninstaller; continuing with overwrite install..."',
  '  ClearErrors',
  '  Return',
].join('\n');

const LEGACY_UNINSTALL_BLOCK =
  /  StrCpy \$uninstallerFileNameTemp "\$PLUGINSDIR\\old-uninstaller\.exe"[\s\S]*?  DoesNotExist:\r?\n    SetErrors\r?\nFunctionEnd/;

const DEFAULT_UNINSTALLER_CHECK = [
  'Function un.checkAppRunning',
  '  !insertmacro CHECK_APP_RUNNING',
  'FunctionEnd',
].join('\n');

const CLAWX_UNINSTALLER_CHECK = [
  'Function un.checkAppRunning',
  `  ; ${UNINSTALLER_CHECK_PATCH_MARKER}.`,
  '  ; Avoid electron-builder _CHECK_APP_RUNNING here: it uses fixed labels',
  '  ; that can collide during BUILD_UNINSTALLER compilation.',
  '  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0',
  '  ${if} $R0 == 0',
  '    DetailPrint `Closing running "${PRODUCT_NAME}" before uninstall...`',
  '    nsExec::ExecToStack \'taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"\'',
  '    Pop $0',
  '    Pop $1',
  '    nsExec::ExecToStack \'taskkill /F /IM openclaw-gateway.exe\'',
  '    Pop $0',
  '    Pop $1',
  '    Sleep 2000',
  '  ${endIf}',
  '  ${nsProcess::Unload}',
  'FunctionEnd',
].join('\n');

/**
 * @param {string} [targetPath]
 * @returns {boolean}
 */
export function patchNsisUninstallTemplate(targetPath = INSTALL_UTIL_NSH) {
  if (!existsSync(targetPath)) {
    console.warn('[patch-nsis-uninstall] installUtil.nsh not found, skipping.');
    return false;
  }

  const original = readFileSync(targetPath, 'utf8');
  if (original.includes(PATCH_MARKER)) {
    return true;
  }

  if (!original.includes('Function uninstallOldVersion')) {
    console.warn('[patch-nsis-uninstall] uninstallOldVersion not found — template may have changed.');
    return false;
  }

  if (!LEGACY_UNINSTALL_BLOCK.test(original)) {
    console.warn('[patch-nsis-uninstall] Legacy uninstall block regex did not match.');
    return false;
  }

  const patched = original.replace(
    LEGACY_UNINSTALL_BLOCK,
    `${SKIP_LEGACY_UNINSTALLER}\nFunctionEnd`,
  );

  if (patched === original) {
    console.warn('[patch-nsis-uninstall] No changes applied.');
    return false;
  }

  writeFileSync(targetPath, patched, 'utf8');
  console.log('[patch-nsis-uninstall] Patched installUtil.nsh (skip legacy uninstaller on upgrade).');
  return true;
}

/**
 * Patch uninstaller.nsh so it does not expand electron-builder's built-in
 * CHECK_APP_RUNNING while BUILD_UNINSTALLER is compiling. In electron-builder
 * 26.8.x that macro can expand _CHECK_APP_RUNNING with fixed labels such as
 * `doStopProcess:`, causing duplicate-label failures on macOS makensis.
 *
 * @param {string} [targetPath]
 * @returns {boolean}
 */
export function patchNsisUninstallerCheckTemplate(targetPath = UNINSTALLER_NSH) {
  if (!existsSync(targetPath)) {
    console.warn('[patch-nsis-uninstall] uninstaller.nsh not found, skipping.');
    return false;
  }

  const original = readFileSync(targetPath, 'utf8');
  if (original.includes(UNINSTALLER_CHECK_PATCH_MARKER)) {
    return true;
  }

  if (!original.includes(DEFAULT_UNINSTALLER_CHECK)) {
    console.warn('[patch-nsis-uninstall] un.checkAppRunning block not found — template may have changed.');
    return false;
  }

  const patched = original.replace(DEFAULT_UNINSTALLER_CHECK, CLAWX_UNINSTALLER_CHECK);
  if (patched === original) {
    console.warn('[patch-nsis-uninstall] No uninstaller.nsh changes applied.');
    return false;
  }

  writeFileSync(targetPath, patched, 'utf8');
  console.log('[patch-nsis-uninstall] Patched uninstaller.nsh (custom app-running check).');
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ok = patchNsisUninstallTemplate() && patchNsisUninstallerCheckTemplate();
  process.exit(ok ? 0 : 1);
}
