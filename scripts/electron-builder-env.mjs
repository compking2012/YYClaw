#!/usr/bin/env node
/**
 * Sets productName and copyright from en common.json then runs electron-builder.
 * Use in build scripts so electron-builder.yml can use ${env.APP_NAME} and ${env.APP_COPYRIGHT}.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const commonPath = join(root, 'shared/i18n/locales/en/common.json');
const common = JSON.parse(readFileSync(commonPath, 'utf8'));

process.env.APP_NAME = common.appName;
process.env.APP_COPYRIGHT = common.copyright;

function envForElectronBuilderChild() {
  const env = { ...process.env };
  for (const k of [
    'ELECTRON_MIRROR',
    'NPM_CONFIG_ELECTRON_MIRROR',
    'npm_config_electron_mirror',
    'npm_package_config_electron_mirror',
  ]) {
    delete env[k];
  }
  return env;
}

// Locate a GNU tool, preferring one already on PATH, falling back to a Homebrew keg.
function locateTool(cmdName, brewFormula, brewRelPath) {
  const onPath = spawnSync('bash', ['-lc', `command -v ${cmdName}`], { encoding: 'utf8' });
  if (onPath.status === 0) {
    const p = onPath.stdout.trim();
    if (p && existsSync(p)) return p;
  }
  const brewPrefix = spawnSync('brew', ['--prefix', brewFormula], { encoding: 'utf8' });
  if (brewPrefix.status === 0) {
    const p = join(brewPrefix.stdout.trim(), brewRelPath);
    if (existsSync(p)) return p;
  }
  return '';
}

// macOS ships only BSD ar/tar. fpm (used by electron-builder for .deb) then silently
// assembles a 96-byte empty ar archive (just a `__.SYMDEF` symbol table) instead of a
// valid Debian package, while still exiting 0. Ensure fpm can find GNU `gtar` and GNU
// `ar` (as `gar`): with `gar` present, fpm's ar_cmd selects `["gar","-qcD"]` and produces
// a valid, deterministic .deb; with `gtar` present, tar_cmd selects GNU tar.
function ensureLinuxDebToolchain(env) {
  if (process.platform !== 'darwin') return;
  if (!process.argv.slice(2).includes('--linux')) return;

  const gnuTar = locateTool('gtar', 'gnu-tar', 'bin/gtar');
  const gnuAr = locateTool('gar', 'binutils', 'bin/ar');

  const missing = [];
  if (!gnuTar) missing.push('gnu-tar（提供 gtar）');
  if (!gnuAr) missing.push('binutils（提供 GNU ar）');
  if (missing.length > 0) {
    console.error(
      `[electron-builder-env] 在 macOS 上打 .deb 需要 GNU 工具链，缺失: ${missing.join('、')}`,
    );
    console.error('  请执行: brew install gnu-tar binutils');
    console.error(
      '  原因: 系统自带的 BSD ar/tar 会让 fpm 静默产出 96 字节的空 .deb（非法归档），构建却仍返回成功。',
    );
    process.exit(1);
  }

  // fpm 按名字在 PATH 上查找 `gtar` 与 `gar`。把它们放进一个私有 bin 目录并前置到 PATH，
  // 只暴露这两个专用名（不 shadow 裸 ar/tar/ld/as/clang），避免把 GNU binutils 的链接器
  // 等挤到 Apple 工具链前面、破坏 Electron 原生构建与签名。
  const binDir = join(root, '.build-rel', 'deb-toolchain-bin');
  mkdirSync(binDir, { recursive: true });
  for (const [name, target] of [
    ['gtar', gnuTar],
    ['gar', gnuAr],
  ]) {
    const linkPath = join(binDir, name);
    try {
      rmSync(linkPath, { force: true });
    } catch {
      /* noop */
    }
    symlinkSync(target, linkPath);
  }
  env.PATH = `${binDir}:${env.PATH ?? ''}`;
  console.log(`[electron-builder-env] deb 工具链就绪: gtar=${gnuTar} gar=${gnuAr}`);
}

const childEnv = envForElectronBuilderChild();
ensureLinuxDebToolchain(childEnv);

function artifactNameOverrideArgs() {
  let display = String(process.env.YYCLAW_BUILD_DISPLAY_VERSION || '').trim();
  if (!display) {
    try {
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
      if (typeof pkg.buildDisplayVersion === 'string') {
        display = pkg.buildDisplayVersion.trim();
      }
    } catch {
      /* ignore */
    }
  }
  if (!display) return [];
  // Keep electron-builder macros; only replace the version segment with the CI display stamp.
  const artifactName = `\${productName}-${display}-\${os}-\${arch}.\${ext}`;
  console.log(`[electron-builder-env] artifactName override: ${artifactName}`);
  return [`-c.artifactName=${artifactName}`];
}

const pre = spawnSync(
  process.execPath,
  [join(root, 'scripts/build-rel-cache.mjs'), 'validate-electron-builder-cache'],
  { stdio: 'inherit', env: childEnv, cwd: root },
);
if (pre.status !== 0) process.exit(pre.status ?? 1);

// Resolve the CLI entry so we do not rely on PATH (pnpm / CI / build_rel 子进程里
// 有时未带上 node_modules/.bin，会导致 `electron-builder: command not found`)。
const require = createRequire(import.meta.url);
let electronBuilderCli;
try {
  const pkgDir = dirname(require.resolve('electron-builder/package.json', { paths: [root] }));
  electronBuilderCli = join(pkgDir, 'cli.js');
} catch {
  console.error(
    '[electron-builder-env] 未找到 electron-builder。请在仓库根目录执行 pnpm install（devDependency）。',
  );
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [electronBuilderCli, ...artifactNameOverrideArgs(), ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: childEnv,
    cwd: root,
  },
);
process.exit(result.status ?? 1);
