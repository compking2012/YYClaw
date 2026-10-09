/**
 * after-pack.cjs
 *
 * electron-builder afterPack hook.
 *
 * Problem: electron-builder respects .gitignore when copying extraResources.
 * Since .gitignore contains "node_modules/", the openclaw bundle's
 * node_modules directory is silently skipped during the extraResources copy.
 *
 * Solution: This hook runs AFTER electron-builder finishes packing. It manually
 * copies build/openclaw/node_modules/ into the output resources directory,
 * bypassing electron-builder's glob filtering entirely.
 *
 * Additionally it performs two rounds of cleanup:
 *   1. General cleanup — removes dev artifacts (type defs, source maps, docs,
 *      test dirs) from both the openclaw root and its node_modules.
 *   2. Platform-specific cleanup — strips native binaries for non-target
 *      platforms (koffi multi-platform prebuilds, @napi-rs/canvas, @img/sharp,
 *      @mariozechner/clipboard).
 */

const { cpSync, existsSync, readdirSync, rmSync, statSync, mkdirSync, realpathSync, readFileSync, writeFileSync, chmodSync } = require('fs');
const { execFileSync } = require('child_process');
const { join, dirname, basename, relative } = require('path');
const { ELECTRON_MAIN_RUNTIME_PACKAGES } = require('./openclaw-bundle-config.mjs');
const { patchNsisExtractTemplate } = require('./patch-nsis-extract.mjs');
const { patchNsisInstallSectionTemplate } = require('./patch-nsis-install-section.mjs');
const { patchNsisUninstallTemplate, patchNsisUninstallerCheckTemplate } = require('./patch-nsis-uninstall.mjs');

// On Windows, paths in pnpm's virtual store can exceed the default MAX_PATH
// limit (260 chars). Node.js 18.17+ respects the system LongPathsEnabled
// registry key, but as a safety net we normalize paths to use the \\?\ prefix
// on Windows, which bypasses the limit unconditionally.
function normWin(p) {
  if (process.platform !== 'win32') return p;
  if (p.startsWith('\\\\?\\')) return p;
  return '\\\\?\\' + p.replace(/\//g, '\\');
}

// ── Arch helpers ─────────────────────────────────────────────────────────────
// electron-builder Arch enum: 0=ia32, 1=x64, 2=armv7l, 3=arm64, 4=universal
const ARCH_MAP = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };

function resolveArch(archEnum) {
  return ARCH_MAP[archEnum] || 'x64';
}

const DWS_PLATFORM_ARCHIVES = {
  'darwin-x64': 'dws-darwin-amd64.tar.gz',
  'darwin-arm64': 'dws-darwin-arm64.tar.gz',
  'linux-x64': 'dws-linux-amd64.tar.gz',
  'linux-arm64': 'dws-linux-arm64.tar.gz',
  'win32-x64': 'dws-windows-amd64.zip',
  'win32-arm64': 'dws-windows-arm64.zip',
};

function findDwsBinary(root) {
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try { entries = readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (entry.name === 'dws' || entry.name === 'dws.exe') {
        return entryPath;
      }
    }
  }
  return null;
}

function extractDingTalkDwsVendor(packageDir, platform, arch) {
  const archiveName = DWS_PLATFORM_ARCHIVES[`${platform}-${arch}`];
  if (!archiveName) {
    console.warn(`[after-pack] ⚠️  No DingTalk dws archive for ${platform}-${arch}`);
    return false;
  }
  const archivePath = join(packageDir, 'assets', archiveName);
  const vendorDir = join(packageDir, 'vendor');
  const vendorBin = join(vendorDir, platform === 'win32' ? 'dws.exe' : 'dws');
  if (existsSync(vendorBin)) return true;
  if (!existsSync(archivePath)) {
    console.warn(`[after-pack] ⚠️  Missing DingTalk dws archive: ${archivePath}`);
    return false;
  }

  const tmpDir = join(packageDir, '.dws-extract-tmp');
  try {
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    if (archivePath.endsWith('.tar.gz')) {
      execFileSync('tar', ['-xzf', archivePath, '-C', tmpDir], { stdio: 'ignore' });
    } else if (platform === 'win32') {
      execFileSync('powershell.exe', [
        '-NoLogo',
        '-NoProfile',
        '-Command',
        `Expand-Archive -Path '${archivePath.replace(/'/g, "''")}' -DestinationPath '${tmpDir.replace(/'/g, "''")}' -Force`,
      ], { stdio: 'ignore' });
    } else {
      execFileSync('unzip', ['-q', archivePath, '-d', tmpDir], { stdio: 'ignore' });
    }
    const found = findDwsBinary(tmpDir);
    if (!found) {
      console.warn('[after-pack] ⚠️  DingTalk dws archive did not contain a binary');
      return false;
    }
    mkdirSync(vendorDir, { recursive: true });
    cpSync(found, vendorBin);
    if (platform !== 'win32') {
      chmodSync(vendorBin, 0o755);
    }
    console.log(`[after-pack] ✅ Extracted DingTalk dws binary to ${vendorBin}`);
    return true;
  } catch (error) {
    console.warn(`[after-pack] ⚠️  Failed to extract DingTalk dws binary: ${error.message}`);
    return false;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(readFileSync(normWin(filePath), 'utf8'));
  } catch {
    return null;
  }
}

function listPackageDeps(pkgJson) {
  return Object.keys({
    ...(pkgJson?.dependencies && typeof pkgJson.dependencies === 'object' ? pkgJson.dependencies : {}),
    ...(pkgJson?.optionalDependencies && typeof pkgJson.optionalDependencies === 'object' ? pkgJson.optionalDependencies : {}),
  }).sort((a, b) => a.localeCompare(b));
}

function readInstalledPackageVersion(packageDir) {
  const pkg = readJsonSafe(join(packageDir, 'package.json'));
  return typeof pkg?.version === 'string' ? pkg.version.trim() : null;
}

// ── General cleanup ──────────────────────────────────────────────────────────

function cleanupUnnecessaryFiles(dir) {
  let removedCount = 0;

  const REMOVE_DIRS = new Set([
    'test', 'tests', '__tests__', '.github', 'examples', 'example', '.bin',
  ]);
  const REMOVE_FILE_EXTS = ['.d.ts', '.d.ts.map', '.js.map', '.mjs.map', '.ts.map', '.markdown'];
  const REMOVE_FILE_NAMES = new Set([
    '.DS_Store', 'README.md', 'CHANGELOG.md', 'LICENSE.md', 'CONTRIBUTING.md',
    'tsconfig.json', '.npmignore', '.eslintrc', '.prettierrc', '.editorconfig',
  ]);

  function walk(currentDir) {
    let entries;
    try { entries = readdirSync(currentDir, { withFileTypes: true }); } catch { return; }

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (REMOVE_DIRS.has(entry.name)) {
          try { rmSync(fullPath, { recursive: true, force: true }); removedCount++; } catch { /* */ }
        } else {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        const name = entry.name;
        if (REMOVE_FILE_NAMES.has(name) || REMOVE_FILE_EXTS.some(e => name.endsWith(e))) {
          try { rmSync(fullPath, { force: true }); removedCount++; } catch { /* */ }
        }
      }
    }
  }

  walk(dir);
  return removedCount;
}

// ── Platform-specific: koffi ─────────────────────────────────────────────────
// koffi ships 18 platform pre-builds under koffi/build/koffi/{platform}_{arch}/.
// We only need the one matching the target.

function cleanupKoffi(nodeModulesDir, platform, arch) {
  const koffiDir = join(nodeModulesDir, 'koffi', 'build', 'koffi');
  if (!existsSync(koffiDir)) return 0;

  const keepTarget = `${platform}_${arch}`;
  let removed = 0;
  for (const entry of readdirSync(koffiDir)) {
    if (entry !== keepTarget) {
      try { rmSync(join(koffiDir, entry), { recursive: true, force: true }); removed++; } catch { /* */ }
    }
  }
  return removed;
}

// ── Platform-specific: scoped native packages ────────────────────────────────
// Packages like @napi-rs/canvas-darwin-arm64, @img/sharp-linux-x64, etc.
// Only the variant matching the target platform should survive.
//
// Some packages use non-standard platform names:
//   - @node-llama-cpp: "mac" instead of "darwin", "win" instead of "win32"
//   - sqlite-vec: "windows" instead of "win32" (unscoped, handled separately)
// We normalise them before comparison.

const PLATFORM_ALIASES = {
  darwin: 'darwin', mac: 'darwin',
  linux: 'linux', linuxmusl: 'linux',
  win32: 'win32', win: 'win32', windows: 'win32',
};

// Each regex MUST have capture group 1 = platform name and group 2 = arch name.
// Compound arch suffixes (e.g. "x64-msvc", "arm64-gnu", "arm64-metal") are OK —
// we strip the suffix after the first dash to get the base arch.
const PLATFORM_NATIVE_SCOPES = {
  '@napi-rs': /^canvas-(darwin|linux|win32)-(x64|arm64)/,
  '@img': /^sharp(?:-libvips)?-(darwin|linux(?:musl)?|win32)-(x64|arm64|arm|ppc64|riscv64|s390x)/,
  '@mariozechner': /^clipboard-(darwin|linux|win32)-(x64|arm64|universal)/,
  '@snazzah': /^davey-(darwin|linux|android|freebsd|win32|wasm32)-(x64|arm64|arm|ia32|arm64-gnu|arm64-musl|x64-gnu|x64-musl|x64-msvc|arm64-msvc|ia32-msvc|arm-eabi|arm-gnueabihf|wasi)/,
  '@lydell': /^node-pty-(darwin|linux|win32)-(x64|arm64)/,
  '@reflink': /^reflink-(darwin|linux|win32)-(x64|arm64|x64-gnu|x64-musl|arm64-gnu|arm64-musl|x64-msvc|arm64-msvc)/,
  '@openai': /^codex-(darwin|linux|win32)-(x64|arm64)$/,
  '@node-llama-cpp': /^(mac|linux|win)-(arm64|x64|armv7l)(-metal|-cuda|-cuda-ext|-vulkan)?$/,
  '@esbuild': /^(darwin|linux|win32|android|freebsd|netbsd|openbsd|sunos|aix|openharmony)-(x64|arm64|arm|ia32|loong64|mips64el|ppc64|riscv64|s390x)/,
};

// Unscoped packages that follow a <name>-<platform>-<arch> convention.
// Each entry: { prefix, pattern } where pattern captures (platform, arch).
const UNSCOPED_NATIVE_PACKAGES = [
  // sqlite-vec uses "windows" instead of "win32"
  { prefix: 'sqlite-vec-', pattern: /^sqlite-vec-(darwin|linux|windows)-(x64|arm64)$/ },
];

/**
 * Normalise the base arch from a potentially compound value.
 * e.g. "x64-msvc" → "x64", "arm64-gnu" → "arm64", "arm64-metal" → "arm64"
 */
function baseArch(rawArch) {
  const dash = rawArch.indexOf('-');
  return dash > 0 ? rawArch.slice(0, dash) : rawArch;
}

function cleanupNativePlatformPackages(nodeModulesDir, platform, arch) {
  let removed = 0;

  // 1. Scoped packages (e.g. @snazzah/davey-darwin-arm64)
  for (const [scope, pattern] of Object.entries(PLATFORM_NATIVE_SCOPES)) {
    const scopeDir = join(nodeModulesDir, scope);
    if (!existsSync(scopeDir)) continue;

    for (const entry of readdirSync(scopeDir)) {
      const match = entry.match(pattern);
      if (!match) continue; // not a platform-specific package, leave it

      const pkgPlatform = PLATFORM_ALIASES[match[1]] || match[1];
      const pkgArch = baseArch(match[2]);

      const isMatch =
        pkgPlatform === platform &&
        (arch === 'universal' || pkgArch === arch || pkgArch === 'universal');

      if (!isMatch) {
        try {
          rmSync(join(scopeDir, entry), { recursive: true, force: true });
          removed++;
        } catch { /* */ }
      }
    }
  }

  // 2. Unscoped packages (e.g. sqlite-vec-darwin-arm64)
  for (const { pattern } of UNSCOPED_NATIVE_PACKAGES) {
    let entries;
    try { entries = readdirSync(nodeModulesDir); } catch { continue; }

    for (const entry of entries) {
      const match = entry.match(pattern);
      if (!match) continue;

      const pkgPlatform = PLATFORM_ALIASES[match[1]] || match[1];
      const pkgArch = baseArch(match[2]);

      const isMatch =
        pkgPlatform === platform &&
        (arch === 'universal' || pkgArch === arch || pkgArch === 'universal');

      if (!isMatch) {
        try {
          rmSync(join(nodeModulesDir, entry), { recursive: true, force: true });
          removed++;
        } catch { /* */ }
      }
    }
  }

  return removed;
}

function cleanupNodeModulesRuntimeJunk(nodeModulesDir, platform, arch) {
  let removed = 0;

  const nodeWavDir = join(nodeModulesDir, 'node-wav');
  for (const name of ['x.json', 'x.js', 'x.js~', 'file.wav']) {
    try {
      const target = join(nodeWavDir, name);
      if (existsSync(target)) {
        rmSync(target, { recursive: true, force: true });
        removed++;
      }
    } catch { /* */ }
  }

  const treeSitterBashDir = join(nodeModulesDir, 'tree-sitter-bash');
  const treeSitterSrc = join(treeSitterBashDir, 'src');
  for (const name of ['parser.c', 'scanner.c', 'grammar.json', 'tree_sitter']) {
    try {
      const target = join(treeSitterSrc, name);
      if (existsSync(target)) {
        rmSync(target, { recursive: true, force: true });
        removed++;
      }
    } catch { /* */ }
  }

  const prebuildsDir = join(treeSitterBashDir, 'prebuilds');
  if (existsSync(prebuildsDir)) {
    for (const entry of readdirSync(prebuildsDir)) {
      const [entryPlatform, ...entryArchParts] = entry.split('-');
      const entryArch = baseArch(entryArchParts.join('-'));
      if (entryPlatform === platform && (arch === 'universal' || entryArch === arch || entryArch === 'universal')) continue;
      try {
        rmSync(join(prebuildsDir, entry), { recursive: true, force: true });
        removed++;
      } catch { /* */ }
    }
  }

  return removed;
}

function assertCuaPackagedRuntime(resourcesDir, platform, arch) {
  const target = `${platform}-${arch}`;
  const packageNames = {
    'darwin-x64': 'cua-driver-darwin-x64',
    'darwin-arm64': 'cua-driver-darwin-arm64',
    'win32-x64': 'cua-driver-win32-x64-msvc',
  };
  const packageName = packageNames[target];
  if (!packageName) return;

  const executable = join(resourcesDir, 'bin', platform === 'win32' ? 'cua-driver.exe' : 'cua-driver');
  if (!existsSync(normWin(executable))) {
    throw new Error(`[after-pack] Missing bundled CUA executable for ${target}: ${executable}`);
  }
  if (platform !== 'win32' && (statSync(normWin(executable)).mode & 0o111) === 0) {
    throw new Error(`[after-pack] Bundled CUA executable is not executable for ${target}: ${executable}`);
  }

  const nativeDir = join(
    resourcesDir,
    'app.asar.unpacked',
    'node_modules',
    '@trycua',
    packageName,
  );
  const nativeEntries = existsSync(normWin(nativeDir)) ? readdirSync(normWin(nativeDir)) : [];
  const libraryExtension = platform === 'win32' ? '.dll' : '.dylib';
  if (
    !nativeEntries.some((name) => name.endsWith('.node'))
    || !nativeEntries.some((name) => name.endsWith(libraryExtension))
  ) {
    throw new Error(`[after-pack] Missing unpacked CUA native SDK for ${target}: ${nativeDir}`);
  }
}

function cleanupKnownRuntimeJunk(rootDir, platform, arch) {
  let removed = 0;
  const stack = [rootDir];

  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(normWin(dir), { withFileTypes: true }); } catch { continue; }

    if (basename(dir) === 'node_modules') {
      removed += cleanupNodeModulesRuntimeJunk(dir, platform, arch);
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      stack.push(join(dir, entry.name));
    }
  }

  return removed;
}


// ── Broken module patcher ─────────────────────────────────────────────────────
// Some bundled packages have transpiled CJS that sets `module.exports = exports.default`
// without ever assigning `exports.default`, leaving module.exports === undefined.
// This causes `TypeError: Cannot convert undefined or null to object` in Node.js 22+
// ESM interop (translators.js hasOwnProperty call).  We patch these after copying.

const MODULE_PATCHES = {
  // node-domexception@1.0.0: index.js sets module.exports = undefined.
  // Node.js 18+ ships DOMException as a built-in; this shim re-exports it.
  'node-domexception/index.js': [
    "'use strict';",
    '// Shim: original transpiled file sets module.exports = exports.default (undefined).',
    '// Node.js 18+ has DOMException as a built-in global.',
    'const dom = globalThis.DOMException ||',
    '  class DOMException extends Error {',
    "    constructor(msg, name) { super(msg); this.name = name || 'Error'; }",
    '  };',
    'module.exports = dom;',
    'module.exports.DOMException = dom;',
    'module.exports.default = dom;',
  ].join('\n') + '\n',
};

function patchBrokenModules(nodeModulesDir) {
  const { writeFileSync, readFileSync } = require('fs');
  let count = 0;
  for (const [rel, content] of Object.entries(MODULE_PATCHES)) {
    const target = join(nodeModulesDir, rel);
    if (existsSync(target)) {
      writeFileSync(target, content, 'utf8');
      count++;
    }
  }

  // https-proxy-agent: add a CJS `require` condition only when we can point to
  // a real CommonJS entry. Mapping `require` to an ESM file can cause
  // ERR_REQUIRE_CYCLE_MODULE in Node.js CLI/TUI flows.
  const hpaPkgPath = join(nodeModulesDir, 'https-proxy-agent', 'package.json');
  if (existsSync(hpaPkgPath)) {
    try {
      const { existsSync: fsExistsSync } = require('fs');
      const raw = readFileSync(hpaPkgPath, 'utf8');
      const pkg = JSON.parse(raw);
      const exp = pkg.exports;
      const hasRequireCondition = Boolean(
        (exp && typeof exp === 'object' && exp.require) ||
        (exp && typeof exp === 'object' && exp['.'] && exp['.'].require) ||
        (exp && typeof exp === 'string') // Sometimes exports is just a string
      );

      const pkgDir = dirname(hpaPkgPath);
      const mainEntry = typeof pkg.main === 'string' ? pkg.main : null;
      const dotImport = exp && typeof exp === 'object' && exp['.'] && typeof exp['.'].import === 'string'
        ? exp['.'].import
        : null;
      const rootImport = exp && typeof exp === 'object' && typeof exp.import === 'string'
        ? exp.import
        : null;
      const importEntry = dotImport || rootImport;

      let cjsCandidates = [
        mainEntry,
        importEntry && importEntry.endsWith('.js') ? importEntry.replace(/\.js$/, '.cjs') : null,
        './dist/index.js',
        './dist/index.cjs',
      ].filter(Boolean);
      // for https-proxy-agent 7.x, main is often empty or points to dist/index.js (which is commonjs but not exported)
      // If we don't have good candidates, just try dist/index.js.

      let requireTarget = cjsCandidates.find((candidate) =>
        fsExistsSync(join(pkgDir, candidate)),
      );

      // Only patch if exports is missing, or lacks a CJS `require` condition, and we
      // have a verified CJS target file.
      if (!hasRequireCondition && requireTarget) {
        let newExports = {
          '.': {
            import: importEntry || requireTarget,
            require: requireTarget,
            default: importEntry || requireTarget,
          },
        };
        // Preserve other subpath exports if they exist
        if (exp && typeof exp === 'object') {
          for (const [key, value] of Object.entries(exp)) {
            if (key !== '.') {
              newExports[key] = value;
            }
          }
        }
        pkg.exports = newExports;
        // Make sure "main" also points correctly just in case
        pkg.main = requireTarget;
        writeFileSync(hpaPkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
        count++;
        console.log(`[after-pack] 🩹 Patched https-proxy-agent exports for CJS compatibility (require=${requireTarget})`);
      } else if (!exp && requireTarget) {
        // If there are no exports at all, just ensure main is correct.
        pkg.exports = {
          '.': {
            require: requireTarget,
            default: requireTarget,
          }
        };
        pkg.main = requireTarget;
        writeFileSync(hpaPkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
        count++;
        console.log(`[after-pack] 🩹 Patched https-proxy-agent missing exports for CJS compatibility (require=${requireTarget})`);
      }
    } catch (err) {
      console.warn('[after-pack] ⚠️  Failed to patch https-proxy-agent:', err.message);
    }
  }

  // lru-cache CJS/ESM interop fix (recursive):
  // Multiple versions of lru-cache may exist in the output tree — not just
  // at node_modules/lru-cache/ but also nested inside other packages.
  // Older CJS versions (v5, v6) export the class via `module.exports = LRUCache`
  // without a named `LRUCache` property, so `import { LRUCache } from 'lru-cache'`
  // fails in Node.js 22+ ESM interop (used by Electron 40+).
  // We recursively scan the entire output for ALL lru-cache installations and
  // patch each CJS entry to ensure `exports.LRUCache` always exists.
  function patchAllLruCacheInstances(rootDir) {
    let lruCount = 0;
    const stack = [rootDir];
    while (stack.length > 0) {
      const dir = stack.pop();
      let entries;
      try { entries = readdirSync(normWin(dir), { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        let isDirectory = entry.isDirectory();
        if (!isDirectory) {
          // pnpm layout may contain symlink/junction directories on Windows.
          try { isDirectory = statSync(normWin(fullPath)).isDirectory(); } catch { isDirectory = false; }
        }
        if (!isDirectory) continue;
        if (entry.name === 'lru-cache') {
          const pkgPath = join(fullPath, 'package.json');
          if (!existsSync(normWin(pkgPath))) { stack.push(fullPath); continue; }
          try {
            const pkg = JSON.parse(readFileSync(normWin(pkgPath), 'utf8'));
            if (pkg.type === 'module') continue; // ESM version — already has named exports
            const mainFile = pkg.main || 'index.js';
            const entryFile = join(fullPath, mainFile);
            if (!existsSync(normWin(entryFile))) continue;
            const original = readFileSync(normWin(entryFile), 'utf8');
            if (!original.includes('exports.LRUCache')) {
              const patched = [
                original,
                '',
                '// ClawX patch: add LRUCache named export for Node.js 22+ ESM interop',
                'if (typeof module.exports === "function" && !module.exports.LRUCache) {',
                '  module.exports.LRUCache = module.exports;',
                '}',
                '',
              ].join('\n');
              writeFileSync(normWin(entryFile), patched, 'utf8');
              lruCount++;
              console.log(`[after-pack] 🩹 Patched lru-cache CJS (v${pkg.version}) at ${relative(rootDir, fullPath)}`);
            }

            // lru-cache v7 ESM entry exports default only; add named export.
            const moduleFile = typeof pkg.module === 'string' ? pkg.module : null;
            if (moduleFile) {
              const esmEntry = join(fullPath, moduleFile);
              if (existsSync(normWin(esmEntry))) {
                const esmOriginal = readFileSync(normWin(esmEntry), 'utf8');
                if (
                  esmOriginal.includes('export default LRUCache') &&
                  !esmOriginal.includes('export { LRUCache')
                ) {
                  const esmPatched = [esmOriginal, '', 'export { LRUCache }', ''].join('\n');
                  writeFileSync(normWin(esmEntry), esmPatched, 'utf8');
                  lruCount++;
                  console.log(`[after-pack] 🩹 Patched lru-cache ESM (v${pkg.version}) at ${relative(rootDir, fullPath)}`);
                }
              }
            }
          } catch (err) {
            console.warn(`[after-pack] ⚠️  Failed to patch lru-cache at ${fullPath}:`, err.message);
          }
        } else {
          stack.push(fullPath);
        }
      }
    }
    return lruCount;
  }
  const lruPatched = patchAllLruCacheInstances(nodeModulesDir);
  count += lruPatched;

  if (count > 0) {
    console.log(`[after-pack] 🩹 Patched ${count} broken module(s) in ${nodeModulesDir}`);
  }
}

// ── Plugin ID mismatch patcher ───────────────────────────────────────────────
// Some plugins (e.g. wecom) have a compiled JS entry that hardcodes a different
// ID than what openclaw.plugin.json declares.  The Gateway rejects mismatches,
// so we fix them after copying.

const PLUGIN_ID_FIXES = {
  'wecom-openclaw-plugin': 'wecom',
};

function patchPluginIds(pluginDir, expectedId) {
  const { readFileSync, writeFileSync } = require('fs');

  const pkgJsonPath = join(pluginDir, 'package.json');
  if (!existsSync(pkgJsonPath)) return;

  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  const entryFiles = [pkg.main, pkg.module].filter(Boolean);

  for (const entry of entryFiles) {
    const entryPath = join(pluginDir, entry);
    if (!existsSync(entryPath)) continue;

    let content = readFileSync(entryPath, 'utf8');
    let patched = false;

    for (const [wrongId, correctId] of Object.entries(PLUGIN_ID_FIXES)) {
      if (correctId !== expectedId) continue;
      const pattern = new RegExp(`(\\bid\\s*:\\s*)(["'])${wrongId.replace(/-/g, '\\-')}\\2`, 'g');
      const replaced = content.replace(pattern, `$1$2${correctId}$2`);
      if (replaced !== content) {
        content = replaced;
        patched = true;
        console.log(`[after-pack] 🩹 Patching plugin ID in ${entry}: "${wrongId}" → "${correctId}"`);
      }
    }

    if (patched) {
      writeFileSync(entryPath, content, 'utf8');
    }
  }
}

// ── Plugin bundler ───────────────────────────────────────────────────────────
// Bundles a single OpenClaw plugin (and its transitive deps) from node_modules
// directly into the packaged resources directory.  Mirrors the logic in
// bundle-openclaw-plugins.mjs so the packaged app is self-contained even when
// build/openclaw-plugins/ was not pre-generated.

/**
 * npm-sourced OpenClaw plugins mirrored into <Resources>/openclaw-plugins/.
 * Keep in sync with the PLUGINS list in scripts/bundle-openclaw-plugins.mjs.
 */
const BUNDLED_NPM_PLUGINS = [
  { npmName: '@soimy/dingtalk', pluginId: 'dingtalk' },
  { npmName: '@wecom/wecom-openclaw-plugin', pluginId: 'wecom' },
  { npmName: '@larksuite/openclaw-lark', pluginId: 'openclaw-lark' },
  { npmName: '@tencent-weixin/openclaw-weixin', pluginId: 'openclaw-weixin' },
  // Not a channel plugin: tokenjuice is the exec/bash output compactor behind
  // the "prompt optimization" setting. OpenClaw 2026.7.1 dropped it from its own
  // package and made it an external official plugin whose catalog entry prefers
  // npm, so a configured-but-unshipped tokenjuice makes the kernel shell out to
  // `npm view @openclaw/tokenjuice` during startup migration. Shipping the
  // mirror is what keeps a package manager out of the startup path.
  { npmName: '@openclaw/tokenjuice', pluginId: 'tokenjuice' },
];

function getVirtualStoreNodeModules(realPkgPath) {
  let dir = realPkgPath;
  while (dir !== dirname(dir)) {
    if (basename(dir) === 'node_modules') return dir;
    dir = dirname(dir);
  }
  return null;
}

function listPkgs(nodeModulesDir) {
  const result = [];
  const nDir = normWin(nodeModulesDir);
  if (!existsSync(nDir)) return result;
  for (const entry of readdirSync(nDir)) {
    if (entry === '.bin') continue;
    // Use original (non-normWin) join for the logical path stored in result.fullPath,
    // so callers can still call getVirtualStoreNodeModules() on it correctly.
    const fullPath = join(nodeModulesDir, entry);
    if (entry.startsWith('@')) {
      let subs;
      try { subs = readdirSync(normWin(fullPath)); } catch { continue; }
      for (const sub of subs) {
        result.push({ name: `${entry}/${sub}`, fullPath: join(fullPath, sub) });
      }
    } else {
      result.push({ name: entry, fullPath });
    }
  }
  return result;
}

function bundlePlugin(nodeModulesRoot, npmName, destDir) {
  const pkgPath = join(nodeModulesRoot, ...npmName.split('/'));
  if (!existsSync(pkgPath)) {
    console.warn(`[after-pack] ⚠️  Plugin package not found: ${pkgPath}. Run pnpm install.`);
    return false;
  }

  let realPluginPath;
  try { realPluginPath = realpathSync(pkgPath); } catch { realPluginPath = pkgPath; }

  // Copy plugin package itself
  if (existsSync(normWin(destDir))) rmSync(normWin(destDir), { recursive: true, force: true });
  mkdirSync(normWin(destDir), { recursive: true });
  cpSync(normWin(realPluginPath), normWin(destDir), { recursive: true, dereference: true });

  // Collect transitive deps via pnpm virtual store BFS
  const collected = new Map();
  const queue = [];

  const rootVirtualNM = getVirtualStoreNodeModules(realPluginPath);
  if (!rootVirtualNM) {
    console.warn(`[after-pack] ⚠️  Could not find virtual store for ${npmName}, skipping deps.`);
    return true;
  }
  queue.push({ nodeModulesDir: rootVirtualNM, skipPkg: npmName });

  // Read peerDependencies from the plugin's package.json so we don't bundle
  // packages that are provided by the host environment (e.g. openclaw itself).
  const SKIP_PACKAGES = new Set(['typescript', '@playwright/test']);
  const SKIP_SCOPES = ['@types/'];
  try {
    const pluginPkg = JSON.parse(
      require('fs').readFileSync(join(destDir, 'package.json'), 'utf8')
    );
    for (const peer of Object.keys(pluginPkg.peerDependencies || {})) {
      SKIP_PACKAGES.add(peer);
    }
  } catch { /* ignore */ }

  while (queue.length > 0) {
    const { nodeModulesDir, skipPkg } = queue.shift();
    for (const { name, fullPath } of listPkgs(nodeModulesDir)) {
      if (name === skipPkg) continue;
      if (SKIP_PACKAGES.has(name) || SKIP_SCOPES.some(s => name.startsWith(s))) continue;
      let rp;
      try { rp = realpathSync(fullPath); } catch { continue; }
      if (collected.has(rp)) continue;
      collected.set(rp, name);
      const depVirtualNM = getVirtualStoreNodeModules(rp);
      if (depVirtualNM && depVirtualNM !== nodeModulesDir) {
        queue.push({ nodeModulesDir: depVirtualNM, skipPkg: name });
      }
    }
  }

  // Copy flattened deps into destDir/node_modules
  const destNM = join(destDir, 'node_modules');
  mkdirSync(destNM, { recursive: true });
  const copiedNames = new Set();
  let count = 0;
  for (const [rp, pkgName] of collected) {
    if (copiedNames.has(pkgName)) continue;
    copiedNames.add(pkgName);
    const d = join(destNM, pkgName);
    try {
      mkdirSync(normWin(dirname(d)), { recursive: true });
      cpSync(normWin(rp), normWin(d), { recursive: true, dereference: true });
      count++;
    } catch (e) {
      console.warn(`[after-pack]   Skipped dep ${pkgName}: ${e.message}`);
    }
  }
  console.log(`[after-pack] ✅ Plugin ${npmName}: copied ${count} deps to ${destDir}`);
  return true;
}

// ── Main hook ────────────────────────────────────────────────────────────────

exports.default = async function afterPack(context) {
  const appOutDir = context.appOutDir;
  const platform = context.electronPlatformName; // 'win32' | 'darwin' | 'linux'
  const arch = resolveArch(context.arch);

  console.log(`[after-pack] Target: ${platform}/${arch}`);

  const src = join(__dirname, '..', 'build', 'openclaw', 'node_modules');

  let resourcesDir;
  if (platform === 'darwin') {
    const appName = context.packager.appInfo.productFilename;
    resourcesDir = join(appOutDir, `${appName}.app`, 'Contents', 'Resources');
  } else {
    resourcesDir = join(appOutDir, 'resources');
  }

  const openclawRoot = join(resourcesDir, 'openclaw');
  const dest = join(openclawRoot, 'node_modules');
  const nodeModulesRoot = join(__dirname, '..', 'node_modules');
  const pluginsDestRoot = join(resourcesDir, 'openclaw-plugins');

  if (!existsSync(src)) {
    throw new Error(
      '[after-pack] build/openclaw/node_modules not found. Run `pnpm run package` (bundle-openclaw) before electron-builder.',
    );
  }

  // 1. Copy node_modules (electron-builder skips it due to .gitignore)
  const depCount = readdirSync(src, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== '.bin')
    .length;

  console.log(`[after-pack] Copying ${depCount} openclaw dependencies to ${dest} ...`);
  cpSync(normWin(src), normWin(dest), { recursive: true, dereference: true });
  console.log('[after-pack] ✅ openclaw node_modules copied.');

  const missingRuntimePackages = ELECTRON_MAIN_RUNTIME_PACKAGES.filter((pkgName) => {
    const pkgJson = join(dest, ...pkgName.split('/'), 'package.json');
    return !existsSync(pkgJson);
  });
  if (missingRuntimePackages.length > 0) {
    throw new Error(
      `[after-pack] Missing required Electron main runtime packages after copy: ${missingRuntimePackages.join(', ')}`,
    );
  }

  // Patch broken modules whose CJS transpiled output sets module.exports = undefined,
  // causing TypeError in Node.js 22+ ESM interop.
  patchBrokenModules(dest);

  // 1.1 Bundle OpenClaw plugins directly from node_modules into packaged resources.
  //     This is intentionally done in afterPack (not extraResources) because:
  //     - electron-builder silently skips extraResources entries whose source
  //       directory doesn't exist (build/openclaw-plugins/ may not be pre-generated)
  //     - node_modules/ is excluded by .gitignore so the deps copy must be manual
  mkdirSync(pluginsDestRoot, { recursive: true });
  for (const { npmName, pluginId } of BUNDLED_NPM_PLUGINS) {
    const pluginDestDir = join(pluginsDestRoot, pluginId);
    console.log(`[after-pack] Bundling plugin ${npmName} -> ${pluginDestDir}`);
    const ok = bundlePlugin(nodeModulesRoot, npmName, pluginDestDir);
    if (ok) {
      const pluginNM = join(pluginDestDir, 'node_modules');
      cleanupUnnecessaryFiles(pluginDestDir);
      if (existsSync(pluginNM)) {
        cleanupKoffi(pluginNM, platform, arch);
        cleanupNativePlatformPackages(pluginNM, platform, arch);
      }
      // Fix hardcoded plugin ID mismatches in compiled JS
      patchPluginIds(pluginDestDir, pluginId);
    }
  }
  verifyPackagedNpmPluginMirrors(pluginsDestRoot);

  // 1.1b Bundle the official DingTalk workspace CLI (`dws`) so calendar/doc
  //      skills can execute from the packaged Gateway PATH.
  const dwsDestDir = join(resourcesDir, 'dingtalk-dws');
  const dwsOk = bundlePlugin(nodeModulesRoot, 'dingtalk-workspace-cli', dwsDestDir);
  if (dwsOk) {
    cleanupUnnecessaryFiles(dwsDestDir);
    if (extractDingTalkDwsVendor(dwsDestDir, platform, arch)) {
      // The vendor binary is self-contained. Shipping all six platform
      // archives adds roughly 26 MB to every platform build for no benefit.
      rmSync(join(dwsDestDir, 'assets'), { recursive: true, force: true });
      console.log(`[after-pack] ✅ Bundled DingTalk workspace CLI to ${dwsDestDir}`);
    } else {
      rmSync(dwsDestDir, { recursive: true, force: true });
    }
  }

  // 1.2 Copy built-in extension node_modules that electron-builder skipped.
  //     OpenClaw 3.31+ ships built-in extensions (discord, qqbot, etc.) under
  //     dist/extensions/<ext>/node_modules/. These are skipped by extraResources
  //     because .gitignore contains "node_modules/".
  //
  //     Extension code is loaded via shared chunks in dist/ (e.g. outbound-*.js)
  //     which resolve modules from the top-level openclaw/node_modules/, NOT from
  //     the extension's own node_modules/. So we must merge extension deps into
  //     the top-level node_modules/ as well.
  const buildExtDir = join(__dirname, '..', 'build', 'openclaw', 'dist', 'extensions');
  const packExtDir = join(openclawRoot, 'dist', 'extensions');
  if (existsSync(buildExtDir)) {
    let extNMCount = 0;
    let mergedPkgCount = 0;
    for (const extEntry of readdirSync(buildExtDir, { withFileTypes: true })) {
      if (!extEntry.isDirectory()) continue;
      const srcNM = join(buildExtDir, extEntry.name, 'node_modules');
      if (!existsSync(srcNM)) continue;

      // Copy to extension's own node_modules (for direct requires from extension code)
      const destExtNM = join(packExtDir, extEntry.name, 'node_modules');
      if (!existsSync(destExtNM)) {
        cpSync(normWin(srcNM), normWin(destExtNM), { recursive: true, dereference: true });
      }
      extNMCount++;

      // Merge into top-level openclaw/node_modules/ (for shared chunks in dist/)
      for (const pkgEntry of readdirSync(srcNM, { withFileTypes: true })) {
        if (!pkgEntry.isDirectory() || pkgEntry.name === '.bin') continue;
        const srcPkg = join(srcNM, pkgEntry.name);
        const destPkg = join(dest, pkgEntry.name);

        if (pkgEntry.name.startsWith('@')) {
          // Scoped package — iterate sub-entries
          for (const scopeEntry of readdirSync(srcPkg, { withFileTypes: true })) {
            if (!scopeEntry.isDirectory()) continue;
            const srcScoped = join(srcPkg, scopeEntry.name);
            const destScoped = join(destPkg, scopeEntry.name);
            if (!existsSync(destScoped)) {
              mkdirSync(dirname(destScoped), { recursive: true });
              cpSync(normWin(srcScoped), normWin(destScoped), { recursive: true, dereference: true });
              mergedPkgCount++;
            }
          }
        } else {
          if (!existsSync(destPkg)) {
            cpSync(normWin(srcPkg), normWin(destPkg), { recursive: true, dereference: true });
            mergedPkgCount++;
          }
        }
      }
    }
    if (extNMCount > 0) {
      console.log(`[after-pack] ✅ Copied node_modules for ${extNMCount} built-in extension(s), merged ${mergedPkgCount} packages into top-level.`);
    }
  }

  // 2. General cleanup on the full openclaw directory (not just node_modules)
  console.log('[after-pack] 🧹 Cleaning up unnecessary files ...');
  const removedRoot = cleanupUnnecessaryFiles(openclawRoot);
  console.log(`[after-pack] ✅ Removed ${removedRoot} unnecessary files/directories.`);

  // 3. Platform-specific: strip koffi non-target platform binaries
  const koffiRemoved = cleanupKoffi(dest, platform, arch);
  if (koffiRemoved > 0) {
    console.log(`[after-pack] ✅ koffi: removed ${koffiRemoved} non-target platform binaries (kept ${platform}_${arch}).`);
  }

  // 4. Platform-specific: strip wrong-platform native packages
  const nativeRemoved = cleanupNativePlatformPackages(dest, platform, arch);
  if (nativeRemoved > 0) {
    console.log(`[after-pack] ✅ Removed ${nativeRemoved} non-target native platform packages.`);
  }

  // 5. Patch lru-cache in app.asar.unpacked
  //
  // Production dependencies (electron-updater → semver → lru-cache@6,
  // posthog-node → proxy agents → lru-cache@7, etc.) end up inside app.asar.
  // Older CJS versions lack the `LRUCache` named export, breaking
  // `import { LRUCache }` in Electron 40+ (Node.js 22+ ESM interop).
  //
  // electron-builder.yml lists `**/node_modules/lru-cache/**` in asarUnpack,
  // which extracts those files to app.asar.unpacked/.  We patch them here so
  // Electron's transparent asar fs layer serves the fixed version at runtime.
  const asarUnpackedDir = join(resourcesDir, 'app.asar.unpacked');
  assertCuaPackagedRuntime(resourcesDir, platform, arch);
  if (existsSync(asarUnpackedDir)) {
    const { readFileSync: readFS, writeFileSync: writeFS } = require('fs');
    let asarLruCount = 0;
    const lruStack = [asarUnpackedDir];
    while (lruStack.length > 0) {
      const dir = lruStack.pop();
      let entries;
      try { entries = readdirSync(normWin(dir), { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        let isDirectory = entry.isDirectory();
        if (!isDirectory) {
          // pnpm layout may contain symlink/junction directories on Windows.
          try { isDirectory = statSync(normWin(fullPath)).isDirectory(); } catch { isDirectory = false; }
        }
        if (!isDirectory) continue;
        if (entry.name === 'lru-cache') {
          const pkgPath = join(fullPath, 'package.json');
          if (!existsSync(normWin(pkgPath))) { lruStack.push(fullPath); continue; }
          try {
            const pkg = JSON.parse(readFS(normWin(pkgPath), 'utf8'));
            if (pkg.type === 'module') continue; // ESM — already exports LRUCache
            const mainFile = pkg.main || 'index.js';
            const entryFile = join(fullPath, mainFile);
            if (!existsSync(normWin(entryFile))) continue;
            const original = readFS(normWin(entryFile), 'utf8');
            if (!original.includes('exports.LRUCache')) {
              const patched = [
                original,
                '',
                '// ClawX patch: add LRUCache named export for Node.js 22+ ESM interop',
                'if (typeof module.exports === "function" && !module.exports.LRUCache) {',
                '  module.exports.LRUCache = module.exports;',
                '}',
                '',
              ].join('\n');
              writeFS(normWin(entryFile), patched, 'utf8');
              asarLruCount++;
              console.log(`[after-pack] 🩹 Patched lru-cache CJS (v${pkg.version}) in app.asar.unpacked at ${relative(asarUnpackedDir, fullPath)}`);
            }

            // lru-cache v7 ESM entry exports default only; add named export.
            const moduleFile = typeof pkg.module === 'string' ? pkg.module : null;
            if (moduleFile) {
              const esmEntry = join(fullPath, moduleFile);
              if (existsSync(normWin(esmEntry))) {
                const esmOriginal = readFS(normWin(esmEntry), 'utf8');
                if (
                  esmOriginal.includes('export default LRUCache') &&
                  !esmOriginal.includes('export { LRUCache')
                ) {
                  const esmPatched = [esmOriginal, '', 'export { LRUCache }', ''].join('\n');
                  writeFS(normWin(esmEntry), esmPatched, 'utf8');
                  asarLruCount++;
                  console.log(`[after-pack] 🩹 Patched lru-cache ESM (v${pkg.version}) in app.asar.unpacked at ${relative(asarUnpackedDir, fullPath)}`);
                }
              }
            }
          } catch (err) {
            console.warn(`[after-pack] ⚠️  Failed to patch lru-cache in asar.unpacked at ${fullPath}:`, err.message);
          }
        } else {
          lruStack.push(fullPath);
        }
      }
    }
    if (asarLruCount > 0) {
      console.log(`[after-pack] 🩹 Patched ${asarLruCount} lru-cache instance(s) in app.asar.unpacked`);
    }
  }
  // 6. [Windows only] Ensure NSIS templates are patched (also done pre-build in package:win).
  if (platform === 'win32') {
    const extractOk = patchNsisExtractTemplate();
    const installSectionOk = patchNsisInstallSectionTemplate();
    const uninstallOk = patchNsisUninstallTemplate();
    const uninstallerCheckOk = patchNsisUninstallerCheckTemplate();
    if (extractOk && installSectionOk && uninstallOk && uninstallerCheckOk) {
      console.log('[after-pack] ⚡ NSIS install templates ready (overwrite upgrade).');
    }
  }

  // 7. Verify the ClawX-authored plugin mirrors actually made it into the package.
  //
  //    electron-builder copies resources/ via extraResources, but a filter typo
  //    or a stale build tree silently drops a plugin directory while the build
  //    still exits 0.  That produced a shipped 0.5.1 with no clawx-gemini-image
  //    mirror, so ~/.openclaw/extensions/ could never get the plugin no matter
  //    what the config asked for.  Fail the build instead.
  verifyPackagedClawXPluginMirrors(resourcesDir);
};

/** Plugin ids that must always ship; a missing source dir is itself a failure. */
const REQUIRED_CLAWX_PLUGIN_IDS = ['clawx-openai-image', 'clawx-gemini-image'];

/**
 * Assert every npm-sourced plugin mirror landed in the package.
 *
 * bundlePlugin() only warns when a package is missing from node_modules, so
 * without this the build exits 0 and ships an app whose
 * ~/.openclaw/extensions/ can never be populated for that plugin. For
 * tokenjuice that also puts npm back on the Gateway startup path, which is the
 * whole thing the mirror exists to avoid.
 */
function verifyPackagedNpmPluginMirrors(pluginsDestRoot) {
  const missing = BUNDLED_NPM_PLUGINS
    .filter(({ pluginId }) => !existsSync(normWin(join(pluginsDestRoot, pluginId, 'openclaw.plugin.json'))))
    .map(({ npmName, pluginId }) => `${pluginId} (${npmName})`);

  if (missing.length > 0) {
    throw new Error(
      `[after-pack] npm plugin mirrors missing from the package: ${missing.join(', ')}. `
      + `Expected <Resources>/openclaw-plugins/<id>/openclaw.plugin.json under ${pluginsDestRoot}. `
      + 'Run `pnpm install` so every mirrored plugin package is present in node_modules.',
    );
  }

  console.log(
    `[after-pack] ✅ Verified ${BUNDLED_NPM_PLUGINS.length} npm plugin mirror(s): `
    + BUNDLED_NPM_PLUGINS.map(({ pluginId }) => pluginId).join(', '),
  );
}

/**
 * Assert every ClawX-authored plugin under resources/openclaw-plugins/ is present
 * in the packaged resources with a readable manifest.
 */
function verifyPackagedClawXPluginMirrors(resourcesDir) {
  const sourceRoot = join(__dirname, '..', 'resources', 'openclaw-plugins');
  const packagedRoot = join(resourcesDir, 'resources', 'openclaw-plugins');

  let sourceIds;
  try {
    sourceIds = readdirSync(normWin(sourceRoot), { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .filter(id => existsSync(normWin(join(sourceRoot, id, 'openclaw.plugin.json'))));
  } catch (err) {
    throw new Error(`[after-pack] Cannot read ${sourceRoot}: ${err.message}`);
  }

  const missingSources = REQUIRED_CLAWX_PLUGIN_IDS.filter(id => !sourceIds.includes(id));
  if (missingSources.length > 0) {
    throw new Error(
      `[after-pack] Missing plugin source directories under resources/openclaw-plugins: ${missingSources.join(', ')}`,
    );
  }

  const missingPackaged = sourceIds.filter(
    id => !existsSync(normWin(join(packagedRoot, id, 'openclaw.plugin.json'))),
  );
  if (missingPackaged.length > 0) {
    throw new Error(
      `[after-pack] ClawX plugin mirrors missing from the package: ${missingPackaged.join(', ')}. `
      + `Expected <Resources>/resources/openclaw-plugins/<id>/openclaw.plugin.json under ${packagedRoot}. `
      + 'Check the extraResources filter in electron-builder.yml.',
    );
  }

  console.log(`[after-pack] ✅ Verified ${sourceIds.length} ClawX plugin mirror(s): ${sourceIds.join(', ')}`);
}

// ── Test hooks ───────────────────────────────────────────────────────────────
// Exposed for unit tests (tests/unit/after-pack-cleanup.test.ts). Not used at
// runtime — the main afterPack hook calls these helpers inline.

exports.__test = {
  assertCuaPackagedRuntime,
  cleanupNativePlatformPackages,
  cleanupNodeModulesRuntimeJunk,
  verifyPackagedNpmPluginMirrors,
  BUNDLED_NPM_PLUGINS,
};
