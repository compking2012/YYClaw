#!/usr/bin/env node
/**
 * build_rel：发布用二进制与 skills **以 resources/bin、resources/skills-bundled 为准**（下载与
 * electron-builder 均走此路径）。resources/build-cache 仅作 CI 镜像（含 meta、tgz、node_modules 等），
 * restore 在 meta 校验通过后把缓存/tgz 落到上述 resources 目录；ensure-resources 对 skills 仅认 resources 目录是否非空。
 */
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  readdirSync,
  statSync,
  lstatSync,
  cpSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  bundledBinDir,
  bundledCacheRoot,
  bundledNodeModulesDir,
  bundledSkillsBundledDir,
  repoRootFromImportMeta,
} from './bundled-cache-paths.mjs';

const root = repoRootFromImportMeta(import.meta.url);
const cacheRoot = bundledCacheRoot(root);
const cacheBinDir = bundledBinDir(root);
const cacheSkillsDir = bundledSkillsBundledDir(root);
const cacheNmDir = bundledNodeModulesDir(root);
/** 遗留 tarball，仅用于一次性迁移到上述目录 */
const binTgz = join(cacheRoot, 'bin.tgz');
const skillsTgz = join(cacheRoot, 'skills-bundled.tgz');
const metaBin = join(cacheRoot, 'meta-bin.json');
const metaSkills = join(cacheRoot, 'meta-skills.json');
const nmTgz = join(cacheRoot, 'node_modules.tgz');
const resDir = join(root, 'resources');
const resBinDir = join(resDir, 'bin');
const resSkillsBundledDir = join(resDir, 'skills-bundled');
const rootNodeModules = join(root, 'node_modules');
const metaNm = join(cacheRoot, 'meta-node-modules.json');
const metaEb = join(cacheRoot, 'meta-electron-builder-cache.json');
const ebCacheDir = join(cacheRoot, 'electron-builder');

function readConstFromScript(relPath, re) {
  const p = join(root, relPath);
  const t = readFileSync(p, 'utf8');
  const m = t.match(re);
  return m ? m[1] : '';
}

async function fetchLarkTag() {
  try {
    const r = await fetch('https://api.github.com/repos/larksuite/cli/releases/latest');
    if (!r.ok) return '';
    const j = await r.json();
    return j.tag_name || '';
  } catch {
    return '';
  }
}

function tarExtract(archive, cwd) {
  const r = spawnSync('tar', ['-xzf', archive, '-C', cwd], { stdio: 'inherit' });
  return r.status === 0;
}

function dirNonEmpty(dir) {
  if (!existsSync(dir)) return false;
  try {
    return readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

function removePath(p) {
  rmSync(p, { recursive: true, force: true });
}

/** 移除旧版在 resources/ 下指向 build-cache 的符号链接（现改为目录复制）。 */
function removeLegacyResourceSymlinks() {
  for (const name of ['bin', 'skills-bundled']) {
    const p = join(resDir, name);
    if (!existsSync(p)) continue;
    try {
      if (lstatSync(p).isSymbolicLink()) {
        console.log(`[build-rel-cache] 移除遗留符号链接: ${p}`);
        removePath(p);
      }
    } catch {
      /* ignore */
    }
  }
}

/** meta 校验通过后：确保 resources/bin 有内容（优先非空的 CI 镜像目录，否则解压 bin.tgz）。 */
function restoreResourcesBinTree() {
  if (dirNonEmpty(resBinDir)) {
    console.log('[build-rel-cache] resources/bin 已存在且非空，跳过从缓存解压/复制。');
    return;
  }
  removeLegacyResourceSymlinks();
  mkdirSync(resDir, { recursive: true });
  if (dirNonEmpty(cacheBinDir)) {
    removePath(resBinDir);
    cpSync(cacheBinDir, resBinDir, { recursive: true, dereference: true });
    console.log('[build-rel-cache] 已写入 resources/bin（从 CI 缓存目录同步）');
    return;
  }
  if (existsSync(binTgz)) {
    console.log('[build-rel-cache] 从 bin.tgz 解压到 resources/ …');
    tarExtract(binTgz, resDir);
  }
}

/** meta 校验通过后：确保 resources/skills-bundled 有内容。 */
function restoreResourcesSkillsTree() {
  if (dirNonEmpty(resSkillsBundledDir)) {
    console.log('[build-rel-cache] resources/skills-bundled 已存在且非空，跳过从缓存解压/复制。');
    return;
  }
  removeLegacyResourceSymlinks();
  mkdirSync(resDir, { recursive: true });
  if (dirNonEmpty(cacheSkillsDir)) {
    removePath(resSkillsBundledDir);
    cpSync(cacheSkillsDir, resSkillsBundledDir, { recursive: true, dereference: true });
    console.log('[build-rel-cache] 已写入 resources/skills-bundled（从 CI 缓存目录同步）');
    return;
  }
  if (existsSync(skillsTgz)) {
    console.log('[build-rel-cache] 从 skills-bundled.tgz 解压到 resources/ …');
    tarExtract(skillsTgz, resDir);
  }
}

/** 将 resources 下发布资源镜像到 build-cache（供 CI 持久化 meta 与目录；应用仍以 resources 为准）。 */
function copyResourcesBinAndSkillsToCache() {
  mkdirSync(cacheRoot, { recursive: true });
  if (dirNonEmpty(resBinDir)) {
    removePath(cacheBinDir);
    cpSync(resBinDir, cacheBinDir, { recursive: true, dereference: true });
    console.log('[build-rel-cache] resources/bin → resources/build-cache/bin（CI 镜像）');
  }
  if (dirNonEmpty(resSkillsBundledDir)) {
    removePath(cacheSkillsDir);
    cpSync(resSkillsBundledDir, cacheSkillsDir, { recursive: true, dereference: true });
    console.log('[build-rel-cache] resources/skills-bundled → resources/build-cache/skills-bundled（CI 镜像）');
  }
}

function copyNodeModulesFromCacheToRoot() {
  removePath(rootNodeModules);
  mkdirSync(root, { recursive: true });
  cpSync(cacheNmDir, rootNodeModules, { recursive: true, dereference: true });
}

function copyNodeModulesFromRootToCache() {
  mkdirSync(cacheRoot, { recursive: true });
  removePath(cacheNmDir);
  cpSync(rootNodeModules, cacheNmDir, { recursive: true, dereference: true });
}

/** pnpm 无法在仓库根 node_modules 为符号链接或非目录时安装；restore 跳过前也需清理遗留布局。 */
function pruneBlockingRootNodeModules() {
  if (!existsSync(rootNodeModules)) return;
  try {
    const st = lstatSync(rootNodeModules);
    if (st.isSymbolicLink() || !st.isDirectory()) {
      console.log(
        '[build-rel-cache] 移除仓库根 node_modules（遗留符号链接或非目录），以便 pnpm install。',
      );
      removePath(rootNodeModules);
    }
  } catch {
    /* ignore */
  }
}

function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function readPackageJson() {
  const pkgPath = join(root, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  return pkg;
}

/** 与二进制缓存相关的 package.json 字段（不含应用 semver） */
function toolchainFingerprint() {
  const pkg = readPackageJson();
  return {
    electronSpecifier: String(pkg.devDependencies?.electron ?? ''),
    packageManager: String(pkg.packageManager ?? ''),
  };
}

/** electron-builder / dmg-builder 本地缓存目录有效性（与 meta 比对，类似 skills-bundled） */
function electronBuilderFingerprint() {
  const pkg = readPackageJson();
  const t = toolchainFingerprint();
  return {
    ...t,
    electronBuilderSpecifier: String(pkg.devDependencies?.['electron-builder'] ?? ''),
  };
}

/** 当前进程是否使用本仓库管理的 ELECTRON_BUILDER_CACHE（与 build_rel.sh 默认路径一致） */
function isUsingManagedElectronBuilderCache() {
  const managed = join(root, 'resources', 'build-cache', 'electron-builder');
  const env = process.env.ELECTRON_BUILDER_CACHE;
  if (!env || !String(env).trim()) return false;
  return resolve(String(env).trim()) === resolve(managed);
}

/**
 * 在即将使用 electron-builder / dmg-builder 前调用：仅当 ELECTRON_BUILDER_CACHE 指向本仓库 build-cache 时生效。
 * - meta 存在且与当前工具链一致 → 校验通过，复用目录；
 * - meta 存在但不一致 → 清理后由本次构建重新填充；
 * - meta 不存在 → 不清理目录（避免同轮 mac → linux 第二次 EB 误删 mac 已写入的缓存），末尾 save-resources 会写入 meta。
 */
function validateElectronBuilderCacheBeforeUse() {
  if (!isUsingManagedElectronBuilderCache()) return;

  mkdirSync(cacheRoot, { recursive: true });
  const cur = electronBuilderFingerprint();
  const m = readJson(metaEb);
  const ok =
    m &&
    m.electronSpecifier === cur.electronSpecifier &&
    m.packageManager === cur.packageManager &&
    m.electronBuilderSpecifier === cur.electronBuilderSpecifier;

  if (ok) {
    mkdirSync(ebCacheDir, { recursive: true });
    console.log(
      '[build-rel-cache] electron-builder / dmg-builder：meta 校验通过，复用 resources/build-cache/electron-builder。',
    );
    return;
  }

  if (m) {
    console.log(
      '[build-rel-cache] electron-builder / dmg-builder：meta 与当前工具链不一致，清理缓存目录后重建 …',
    );
    if (existsSync(ebCacheDir)) rmSync(ebCacheDir, { recursive: true, force: true });
  } else {
    console.log(
      '[build-rel-cache] electron-builder / dmg-builder：尚无 meta-electron-builder-cache.json，跳过清理（保留目录；本轮 save-resources 将写入 meta）。',
    );
  }
  mkdirSync(ebCacheDir, { recursive: true });
}

function hostFingerprint() {
  return {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
  };
}

/** 与发布产物需校验的 uv 架构一致（不含 win32-arm64，与当前安装包目标一致） */
const RELEASE_UV_IDS = [
  'darwin-arm64',
  'darwin-x64',
  'win32-x64',
  'linux-arm64',
  'linux-x64',
];

/** 与 scripts/bundle-lark-cli.mjs --all 产物一致 */
const LARK_RELEASE_BINARIES = [
  ['darwin-x64', 'lark-cli'],
  ['darwin-arm64', 'lark-cli'],
  ['linux-x64', 'lark-cli'],
  ['linux-arm64', 'lark-cli'],
  ['win32-x64', 'lark-cli.exe'],
];

/** 与 scripts/bundle-lark-cli.mjs 中 currentHash 后缀一致 */
const LARK_HASH_SUFFIX_RE = /-(all|mac|linux|win|local)$/;

function larkHashMatchesUpstreamTag(got, liveTag) {
  if (!got || !liveTag) return false;
  if (got === liveTag) return true;
  return got.startsWith(`${liveTag}-`) && LARK_HASH_SUFFIX_RE.test(got);
}

function readUvVersionFromScript() {
  return readConstFromScript('scripts/download-bundled-uv.mjs', /const UV_VERSION = '([^']+)'/);
}

function readNodeWinVersionFromScript() {
  return readConstFromScript('scripts/download-bundled-node.mjs', /const NODE_VERSION = '([^']+)'/);
}

function uvTargetSatisfied(uvVersion, id) {
  const binName = id.startsWith('win32') ? 'uv.exe' : 'uv';
  const base = join(resBinDir, id);
  const binPath = join(base, binName);
  const vf = join(base, '.uv-version');
  const vfLegacy = join(base, '.version');
  if (!existsSync(binPath)) return false;
  try {
    if (existsSync(vf)) return readFileSync(vf, 'utf8').trim() === uvVersion;
    if (existsSync(vfLegacy)) return readFileSync(vfLegacy, 'utf8').trim() === uvVersion;
  } catch {
    return false;
  }
  return false;
}

/** ensure-resources：仅以 resources/skills-bundled 为准（与文件头约定一致）；缓存非空由 restore-resources 落到 resources。 */
function skillsBundledSatisfied() {
  return dirNonEmpty(resSkillsBundledDir);
}

function runPnpm(script) {
  console.log(`[build-rel-cache] pnpm run ${script} …`);
  const r = spawnSync('pnpm', ['run', script], {
    stdio: 'inherit',
    env: process.env,
    cwd: root,
    shell: false,
  });
  if (r.status !== 0) {
    console.error(`[build-rel-cache] pnpm run ${script} 失败（exit ${r.status ?? '∅'}）。`);
    process.exit(r.status ?? 1);
  }
}

/**
 * 发布用 resources 是否完备：目录、二进制、资源包版本（UV / Win Node / Lark 与上游 tag）。
 * 任一不满足则全量 pnpm run bundle:resources-all-platforms。
 */
async function ensureResources() {
  const reasons = [];

  const binRoot = resBinDir;
  if (!existsSync(binRoot)) {
    reasons.push('缺少 resources/bin 目录');
  }

  let uvVersion = '';
  try {
    uvVersion = readUvVersionFromScript();
  } catch {
    reasons.push('无法读取 scripts/download-bundled-uv.mjs');
  }
  if (!uvVersion) {
    if (!reasons.some((r) => r.includes('download-bundled-uv'))) {
      reasons.push('无法解析 scripts/download-bundled-uv.mjs 中的 UV_VERSION');
    }
  } else {
    for (const id of RELEASE_UV_IDS) {
      if (!uvTargetSatisfied(uvVersion, id)) {
        reasons.push(
          `uv ${id} 缺失或 resources/bin/${id}/.uv-version（或旧版 .version）与脚本 UV_VERSION（${uvVersion}）不一致`,
        );
      }
    }
  }

  let nodeWinVersion = '';
  try {
    nodeWinVersion = readNodeWinVersionFromScript();
  } catch {
    reasons.push('无法读取 scripts/download-bundled-node.mjs');
  }
  const nodeExe = join(binRoot, 'win32-x64', 'node.exe');
  if (!nodeWinVersion) {
    if (!reasons.some((r) => r.includes('download-bundled-node'))) {
      reasons.push('无法解析 scripts/download-bundled-node.mjs 中的 NODE_VERSION');
    }
  } else {
    if (!existsSync(nodeExe)) {
      reasons.push('缺少 resources/bin/win32-x64/node.exe');
    } else {
      try {
        if (statSync(nodeExe).size < 5 * 1024 * 1024) {
          reasons.push('resources/bin/win32-x64/node.exe 体积异常（可能损坏）');
        }
      } catch {
        reasons.push('无法读取 resources/bin/win32-x64/node.exe');
      }
    }
  }

  const mbBin = readJson(metaBin);
  if (!mbBin) {
    reasons.push(
      '缺少 resources/build-cache/meta-bin.json（请执行 node scripts/build-rel-cache.mjs sync-meta-bin，或 pnpm run node:download:win / bundle:resources-all-platforms 后自动生成）',
    );
  } else if (!metaMatchesToolchain(mbBin, 'meta-bin.json')) {
    reasons.push('resources/build-cache/meta-bin.json 与当前 package.json 工具链钉版本不一致');
  } else {
    if (uvVersion && mbBin.uvVersion !== uvVersion) {
      reasons.push(
        `meta-bin.json 中 uvVersion 为「${mbBin.uvVersion ?? '∅'}」，脚本要求 UV_VERSION=${uvVersion}`,
      );
    }
    if (nodeWinVersion && mbBin.nodeWinVersion !== nodeWinVersion) {
      reasons.push(
        `meta-bin.json 中 nodeWinVersion 为「${mbBin.nodeWinVersion ?? '∅'}」，脚本要求 NODE_VERSION=${nodeWinVersion}`,
      );
    }
  }

  for (const [dir, name] of LARK_RELEASE_BINARIES) {
    const p = join(binRoot, dir, name);
    if (!existsSync(p)) {
      reasons.push(`缺少 resources/bin/${dir}/${name}`);
      continue;
    }
    try {
      if (statSync(p).size < 1024) {
        reasons.push(`resources/bin/${dir}/${name} 体积异常`);
      }
    } catch {
      reasons.push(`无法读取 resources/bin/${dir}/${name}`);
    }
  }

  const liveLark = await fetchLarkTag();
  const larkHashPath = join(binRoot, '.lark-cli-build-hash');
  if (!liveLark) {
    console.warn(
      '[build-rel-cache] ensure-resources：未能拉取 Lark GitHub latest（网络或限流）；跳过与上游 tag 比对，仅校验 .lark-cli-build-hash 形态。',
    );
    if (!existsSync(larkHashPath)) {
      reasons.push('缺少 resources/bin/.lark-cli-build-hash');
    } else {
      try {
        const got = readFileSync(larkHashPath, 'utf8').trim();
        if (!LARK_HASH_SUFFIX_RE.test(got)) {
          reasons.push(
            `.lark-cli-build-hash「${got}」格式异常（应为 *-(all|mac|linux|win|local)）`,
          );
        }
      } catch {
        reasons.push('无法读取 resources/bin/.lark-cli-build-hash');
      }
    }
  } else if (!existsSync(larkHashPath)) {
    reasons.push('缺少 resources/bin/.lark-cli-build-hash');
  } else {
    try {
      const got = readFileSync(larkHashPath, 'utf8').trim();
      if (!larkHashMatchesUpstreamTag(got, liveLark)) {
        reasons.push(
          `.lark-cli-build-hash 为「${got}」，与当前上游 Lark tag「${liveLark}」不匹配（期望 ${liveLark}-(all|mac|linux|win|local)）`,
        );
      }
    } catch {
      reasons.push('无法读取 resources/bin/.lark-cli-build-hash');
    }
  }

  if (!skillsBundledSatisfied()) {
    reasons.push('resources/skills-bundled 不存在或为空');
  }

  if (reasons.length === 0) {
    console.log(
      '[build-rel-cache] resources 发布资源完备（目录、二进制齐全，uv / win-node / lark 与 hash 规则一致），跳过 bundle:resources-all-platforms。',
    );
    copyResourcesBinAndSkillsToCache();
    return;
  }

  console.log('[build-rel-cache] resources 不完备，将全量重新拉取 pnpm run bundle:resources-all-platforms：');
  for (const r of reasons) {
    console.log(`  - ${r}`);
  }
  runPnpm('bundle:resources-all-platforms');
  console.log('[build-rel-cache] ensure-resources：全量拉取已执行完毕。');
  copyResourcesBinAndSkillsToCache();
}

function metaMatchesToolchain(meta, label) {
  const fp = toolchainFingerprint();
  if (!meta) {
    console.log(`[build-rel-cache] ${label}：meta 缺失，跳过恢复。`);
    return false;
  }
  if (meta.electronSpecifier !== fp.electronSpecifier) {
    console.log(
      `[build-rel-cache] ${label}：package.json 中 electron 声明不一致，跳过恢复。`,
    );
    return false;
  }
  if (meta.packageManager !== fp.packageManager) {
    console.log(
      `[build-rel-cache] ${label}：packageManager 不一致（缓存与当前 pnpm 钉版本可能不同），跳过恢复。`,
    );
    return false;
  }
  return true;
}

/** 与 restore-node-modules 写入的 meta 字段一致；用于 save 时判断是否与当前工作区一致（不含 lock 文件）。 */
function nodeModulesMetaMatchesWorkspace(meta) {
  if (!meta) return false;
  const fp = toolchainFingerprint();
  const host = hostFingerprint();
  return (
    meta.electronSpecifier === fp.electronSpecifier &&
    meta.packageManager === fp.packageManager &&
    meta.nodeVersion === host.nodeVersion &&
    meta.platform === host.platform &&
    meta.arch === host.arch
  );
}

async function restoreResources() {
  mkdirSync(cacheRoot, { recursive: true });
  validateElectronBuilderCacheBeforeUse();
  removeLegacyResourceSymlinks();

  const uv = readConstFromScript('scripts/download-bundled-uv.mjs', /const UV_VERSION = '([^']+)'/);
  const nodeWin = readConstFromScript(
    'scripts/download-bundled-node.mjs',
    /const NODE_VERSION = '([^']+)'/,
  );

  const mb = readJson(metaBin);
  const binToolingOk = metaMatchesToolchain(mb, 'resources/bin');
  const binDataReady =
    dirNonEmpty(resBinDir) || dirNonEmpty(cacheBinDir) || existsSync(binTgz);
  const binOk =
    binToolingOk && mb && mb.uvVersion === uv && mb.nodeWinVersion === nodeWin && binDataReady;
  if (!binOk) {
    if (mb && binToolingOk && (mb.uvVersion !== uv || mb.nodeWinVersion !== nodeWin)) {
      console.log(
        '[build-rel-cache] resources/bin：meta 中 UV / Win Node 与当前脚本不一致，跳过从缓存恢复。',
      );
    } else if (mb && !binDataReady) {
      console.log(
        '[build-rel-cache] resources/bin：无可恢复来源（resources/bin、CI 镜像目录及 bin.tgz 均为空），跳过。',
      );
    }
  } else {
    restoreResourcesBinTree();
  }

  const larkLive = await fetchLarkTag();
  const ms = readJson(metaSkills);
  const skillsToolingOk = metaMatchesToolchain(ms, 'resources/skills-bundled');
  const skillsDataReady =
    dirNonEmpty(resSkillsBundledDir) || dirNonEmpty(cacheSkillsDir) || existsSync(skillsTgz);
  const skillsOk =
    skillsToolingOk && ms && ms.larkTag === larkLive && Boolean(larkLive) && skillsDataReady;
  if (!skillsOk) {
    if (ms && skillsToolingOk && (ms.larkTag !== larkLive || !larkLive)) {
      console.log('[build-rel-cache] resources/skills-bundled：Lark tag 与 meta 不一致，跳过从缓存恢复。');
    } else if (ms && !skillsDataReady) {
      console.log(
        '[build-rel-cache] resources/skills-bundled：无可恢复来源（本地目录、CI 镜像及 tgz 均为空），跳过。',
      );
    }
  } else {
    restoreResourcesSkillsTree();
  }

  if (
    (binOk && (dirNonEmpty(resBinDir) || dirNonEmpty(cacheBinDir))) ||
    (skillsOk && (dirNonEmpty(resSkillsBundledDir) || dirNonEmpty(cacheSkillsDir)))
  ) {
    copyResourcesBinAndSkillsToCache();
  }
}

/** 写入 resources/build-cache/meta-bin.json（与 save-resources 在 bin 镜像非空时的 meta 一致；供 ensure-resources 与 download-bundled-node 落盘后同步）。 */
function writeMetaBinFromScripts() {
  const uv = readConstFromScript('scripts/download-bundled-uv.mjs', /const UV_VERSION = '([^']+)'/);
  const nodeWin = readConstFromScript(
    'scripts/download-bundled-node.mjs',
    /const NODE_VERSION = '([^']+)'/,
  );
  const fp = toolchainFingerprint();
  mkdirSync(cacheRoot, { recursive: true });
  writeFileSync(
    metaBin,
    JSON.stringify(
      {
        ...fp,
        uvVersion: uv,
        nodeWinVersion: nodeWin,
        savedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );
}

async function saveResources() {
  mkdirSync(cacheRoot, { recursive: true });
  removeLegacyResourceSymlinks();
  copyResourcesBinAndSkillsToCache();

  const larkTag = await fetchLarkTag();
  const fp = toolchainFingerprint();

  if (dirNonEmpty(cacheBinDir)) {
    writeMetaBinFromScripts();
    console.log('[build-rel-cache] 已同步 meta-bin.json（指纹文件在 resources/build-cache；内容对应 resources/bin）');
  }

  if (dirNonEmpty(cacheSkillsDir)) {
    writeFileSync(
      metaSkills,
      JSON.stringify(
        {
          ...fp,
          larkTag,
          savedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf8',
    );
    console.log(
      '[build-rel-cache] 已同步 meta-skills.json（指纹在 resources/build-cache；内容对应 resources/skills-bundled）',
    );
  }

  mkdirSync(cacheRoot, { recursive: true });
  mkdirSync(ebCacheDir, { recursive: true });
  writeFileSync(
    metaEb,
    JSON.stringify(
      {
        ...electronBuilderFingerprint(),
        savedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log('[build-rel-cache] 已写入 meta-electron-builder-cache.json（供下次恢复前校验）');
}

function restoreNodeModules() {
  if (process.env.YYCLAW_BUILD_REL_CACHE_NODE_MODULES !== '1') return;
  pruneBlockingRootNodeModules();

  const m = readJson(metaNm);
  const host = hostFingerprint();

  if (!metaMatchesToolchain(m, 'node_modules')) return;

  if (m.nodeVersion !== host.nodeVersion) {
    console.log(
      `[build-rel-cache] node_modules：Node 版本不一致（缓存 ${m.nodeVersion ?? '∅'} ≠ 当前 ${host.nodeVersion}），跳过恢复。`,
    );
    return;
  }
  if (m.platform !== host.platform || m.arch !== host.arch) {
    console.log(
      `[build-rel-cache] node_modules：平台不一致（缓存 ${m.platform}-${m.arch} ≠ 当前 ${host.platform}-${host.arch}），跳过恢复。`,
    );
    return;
  }
  const nmDataReady = dirNonEmpty(cacheNmDir) || existsSync(nmTgz);
  if (!nmDataReady) {
    console.log(
      '[build-rel-cache] node_modules：缺少 build-cache/node_modules 且无遗留 node_modules.tgz，跳过恢复。',
    );
    return;
  }

  if (!dirNonEmpty(cacheNmDir) && existsSync(nmTgz)) {
    console.log('[build-rel-cache] 从遗留 node_modules.tgz 解压到 build-cache …');
    tarExtract(nmTgz, cacheRoot);
  }
  if (!dirNonEmpty(cacheNmDir)) {
    console.log('[build-rel-cache] node_modules：解压后仍无 build-cache/node_modules，跳过恢复。');
    return;
  }

  copyNodeModulesFromCacheToRoot();
  console.log(
    '[build-rel-cache] 已将 resources/build-cache/node_modules 复制到仓库根 node_modules',
  );
}

function saveNodeModules() {
  if (process.env.YYCLAW_BUILD_REL_CACHE_NODE_MODULES !== '1') return;
  mkdirSync(cacheRoot, { recursive: true });
  const fp = toolchainFingerprint();
  const host = hostFingerprint();
  const prev = readJson(metaNm);

  if (existsSync(rootNodeModules)) {
    try {
      if (lstatSync(rootNodeModules).isSymbolicLink()) {
        console.log('[build-rel-cache] 移除遗留的 node_modules 符号链接 …');
        removePath(rootNodeModules);
        if (dirNonEmpty(cacheNmDir)) {
          copyNodeModulesFromCacheToRoot();
          console.log(
            '[build-rel-cache] 已从 resources/build-cache/node_modules 复制回仓库根（去除链接）。',
          );
        }
        return;
      }
    } catch {
      /* ignore */
    }
  }

  if (!existsSync(rootNodeModules)) {
    if (dirNonEmpty(cacheNmDir) && nodeModulesMetaMatchesWorkspace(prev)) {
      writeFileSync(
        metaNm,
        JSON.stringify(
          {
            ...fp,
            nodeVersion: host.nodeVersion,
            platform: host.platform,
            arch: host.arch,
            savedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        'utf8',
      );
      console.log(
        '[build-rel-cache] 已刷新 meta-node-modules.json（仓库根无 node_modules，复用 build-cache）',
      );
    }
    return;
  }

  if (dirNonEmpty(cacheNmDir) && nodeModulesMetaMatchesWorkspace(prev)) {
    console.log(
      '[build-rel-cache] node_modules 缓存 meta 与当前环境一致且 build-cache 已有内容，跳过写回（避免整目录复制）。',
    );
    return;
  }

  copyNodeModulesFromRootToCache();
  writeFileSync(
    metaNm,
    JSON.stringify(
      {
        ...fp,
        nodeVersion: host.nodeVersion,
        platform: host.platform,
        arch: host.arch,
        savedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log('[build-rel-cache] 已将项目根 node_modules 复制到 resources/build-cache/node_modules');
}

const cmd = process.argv[2];
if (cmd === 'restore-resources') {
  await restoreResources();
} else if (cmd === 'save-resources') {
  await saveResources();
} else if (cmd === 'sync-meta-bin') {
  writeMetaBinFromScripts();
  console.log('[build-rel-cache] 已写入 resources/build-cache/meta-bin.json（来自脚本中的 UV_VERSION / NODE_VERSION 与 package.json 工具链指纹）');
} else if (cmd === 'validate-electron-builder-cache') {
  validateElectronBuilderCacheBeforeUse();
} else if (cmd === 'ensure-resources') {
  await ensureResources();
} else if (cmd === 'restore-node-modules') {
  restoreNodeModules();
} else if (cmd === 'save-node-modules') {
  saveNodeModules();
} else {
  console.error(
    '用法: node scripts/build-rel-cache.mjs <restore-resources|save-resources|sync-meta-bin|validate-electron-builder-cache|ensure-resources|restore-node-modules|save-node-modules>',
  );
  process.exit(1);
}
