import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { lstatSync } from 'node:fs';
import path from 'node:path';
import { isolatedEnvironment } from './adapters.mjs';

const execute = promisify(execFile);
const networkVariables = [
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS',
  'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE',
  'ELECTRON_MIRROR', 'ELECTRON_CUSTOM_DIR', 'ELECTRON_CUSTOM_FILENAME',
  'npm_config_electron_mirror', 'npm_config_electron_builder_binaries_mirror',
  'npm_config_registry',
  'NPM_CONFIG_REGISTRY',
];

export async function resolveDependencyCache(repo, artifactRoot) {
  const cacheRoot = path.join(path.resolve(repo), 'node_modules', '.autopilot-cache');
  const storeRoot = path.join(cacheRoot, 'pnpm-store');
  const metadata = { schemaVersion: 1, storeDir: storeRoot, releaseCacheDir: path.join(cacheRoot, 'releases'), electronCacheDir: path.join(cacheRoot, 'electron'), lockRoot: path.join(cacheRoot, 'locks') };
  validateDependencyCache(metadata, repo, artifactRoot);
  const entry = process.env.npm_execpath;
  const nodePnpm = entry && /pnpm.*\.[cm]?js$/.test(entry);
  const args = ['store', 'path', '--store-dir', storeRoot];
  const { stdout } = await execute(nodePnpm ? process.execPath : 'pnpm', nodePnpm ? [entry, ...args] : args, { cwd: repo, timeout: 15000 });
  const storeDir = stdout.trim();
  if (!contained(storeRoot, storeDir)) throw new Error('pnpm resolved a store outside the project Autopilot cache');
  return validateDependencyCache({ ...metadata, storeDir }, repo, artifactRoot);
}

function contained(root, value) {
  const relative = path.relative(path.resolve(root), value);
  return !relative || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function validateDependencyCache(cache, repo, artifactRoot) {
  if (cache?.schemaVersion !== 1) throw new Error('Unsupported shared dependency cache metadata');
  for (const key of ['storeDir', 'releaseCacheDir', 'electronCacheDir', 'lockRoot']) {
    const value = cache[key];
    if (typeof value !== 'string' || !path.isAbsolute(value) || path.resolve(value) !== value) throw new Error('Shared dependency cache paths must be absolute and normalized');
    if (contained(artifactRoot, value) || contained(value, artifactRoot)) throw new Error('Shared dependency caches cannot overlap run artifacts');
    const modulesRoot = path.join(path.resolve(repo), 'node_modules');
    const cacheRoot = path.join(modulesRoot, '.autopilot-cache');
    if (contained(modulesRoot, value)) {
      if (!contained(cacheRoot, value) || value === cacheRoot) throw new Error('Shared dependency caches must use the dedicated project cache, not installed workspace dependencies');
      for (let directory = value; contained(modulesRoot, directory); directory = path.dirname(directory)) {
        try {
          const info = lstatSync(directory);
          if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Project dependency cache cannot use symlinks or non-directories');
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
    }
  }
  return cache;
}

export async function ensureDependencyCache(cache) {
  for (const key of ['storeDir', 'releaseCacheDir', 'electronCacheDir', 'lockRoot']) await mkdir(cache[key], { recursive: true, mode: 0o700 });
}

export function dependencyEnvironment(home, cache, source = process.env) {
  const network = Object.fromEntries(networkVariables.filter((name) => source[name] !== undefined).map((name) => [name, source[name]]));
  return isolatedEnvironment(home, {
    PATH: [path.join(home, 'bin'), process.env.PATH].filter(Boolean).join(path.delimiter),
    ...network, npm_config_store_dir: cache.storeDir,
    npm_config_package_import_method: 'copy', npm_config_side_effects_cache: 'false',
    YYCLAW_RELEASE_CACHE_DIR: cache.releaseCacheDir,
    electron_config_cache: cache.electronCacheDir,
    npm_config_userconfig: path.join(home, '.npmrc'),
  });
}

export async function prepareDependencyTools(home) {
  const entry = process.env.npm_execpath;
  if (!entry || !/pnpm.*\.[cm]?js$/.test(entry) || !path.isAbsolute(entry)) return;
  const directory = path.join(home, 'bin');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const script = `#!/usr/bin/env node\nconst { spawnSync } = require('node:child_process');\nconst result = spawnSync(${JSON.stringify(process.execPath)}, [${JSON.stringify(entry)}, ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });\nif (result.error) console.error(result.error.message);\nprocess.exit(result.status ?? 1);\n`;
  await writeFile(path.join(directory, 'pnpm'), script, { mode: 0o755 });
  if (process.platform === 'win32') await writeFile(path.join(directory, 'pnpm.cmd'), `@echo off\r\n"${process.execPath}" "${entry}" %*\r\n`, { mode: 0o700 });
}

export function dependencyFailure(log) {
  const release = log.match(/Download failed: (https:\/\/github\.com\/[^\s;]+?)\.(?: Check|\s*postinstall:)/);
  if (release) {
    const asset = new URL(release[1]);
    asset.username = ''; asset.password = ''; asset.search = ''; asset.hash = '';
    return { failureKind: 'bundled release download unavailable', failureDetail: `${asset.toString()}; reuse a verified matching local binary or provide GitHub connectivity / HTTPS_PROXY` };
  }
  return { failureKind: /(?:ERR_PNPM_FETCH_(?:401|403)|E401|E403)/.test(log) ? 'private registry authentication unavailable' : /(?:postinstall|preinstall|install)\$/.test(log) ? 'dependency lifecycle scripts' : /(?:ECONNRESET|ETIMEDOUT|ERR_PNPM_FETCH|downloaded [1-9]\d*|GET https?:)/.test(log) ? 'dependency downloads' : 'dependency installation' };
}

export function dependencyInstallStep(cache) {
  return { name: 'Install committed workspace dependencies', command: 'pnpm', args: ['install', '--frozen-lockfile', '--prefer-offline', '--store-dir', cache.storeDir, '--package-import-method=copy', '--no-side-effects-cache', '--stream'] };
}

export function initializationError(taskId, stage, result) {
  const reason = result.error === 'Command timed out' ? 'timed out' : result.error === 'Command cancelled' ? 'was cancelled' : `failed (exit ${result.exitCode ?? 'unknown'})`;
  return `${taskId} ${stage} ${reason}; elapsed ${Math.round(result.durationMs / 1000)}s; limit ${Math.round(result.timeoutMs / 1000)}s; log: ${result.logPath}${result.failureKind ? `; last observed phase: ${result.failureKind}` : ''}${result.failureDetail ? `; ${result.failureDetail}` : ''}${result.error && !['Command timed out', 'Command cancelled'].includes(result.error) ? `; ${result.error}` : ''}`;
}
