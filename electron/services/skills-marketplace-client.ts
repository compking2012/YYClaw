/**
 * Remote skills server API: list/search (GET /api/v1/skill_list, /api/v1/skill_search),
 * install from zip (GET /api/v1/skill_file/:name → ~/.openclaw/skills/<name> via adm-zip),
 * and report successful installs (POST /api/v1/skill_client_install) for server download_count.
 */
import AdmZip from 'adm-zip';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ServerMarketplaceSkill } from '../../src/types/skill';
import { getOpenClawConfigDir, ensureDir } from '../utils/paths';
import { proxyAwareFetch } from '../utils/proxy-fetch';
import { resolveFarmApiBaseUrl } from '../utils/farm-api-base';
import { removeSkillConfig } from '../utils/skill-config';
import { writeManagedSkillInstallMetadata } from './skills/managed-skill-winner';

export type SkillsMarketplaceFetchParams = {
  query: string;
  limit?: number;
  category?: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function mapSkillRow(raw: unknown): ServerMarketplaceSkill | null {
  if (!isRecord(raw)) return null;
  const nameField = raw.name ?? raw.slug ?? raw.id ?? raw.title;
  const nameStr = String(nameField ?? '').trim();
  if (!nameStr) return null;
  const slug = nameStr;
  const description = String(raw.description ?? raw.summary ?? '').trim();
  const versionRaw = raw.version != null ? String(raw.version).trim() : '';
  const versionBase = raw.version_base != null ? String(raw.version_base).trim() : undefined;
  const author = raw.author != null ? String(raw.author).trim() : undefined;
  const archiveHash = raw.archive_hash != null ? String(raw.archive_hash).trim() : undefined;
  const listingRevision = raw.listing_revision != null ? String(raw.listing_revision).trim() : undefined;
  const category = raw.category != null ? String(raw.category).trim() : undefined;
  const downloads = typeof raw.downloads === 'number' ? raw.downloads : undefined;
  const stars = typeof raw.stars === 'number' ? raw.stars : undefined;
  return {
    slug,
    name: nameStr,
    description,
    version: versionRaw,
    ...(versionBase ? { versionBase } : {}),
    ...(author ? { author } : {}),
    ...(category ? { category } : {}),
    ...(archiveHash ? { archiveHash } : {}),
    ...(listingRevision ? { listingRevision } : {}),
    ...(downloads !== undefined ? { downloads } : {}),
    ...(stars !== undefined ? { stars } : {}),
  };
}

function parseSkillsPayload(json: unknown): ServerMarketplaceSkill[] {
  if (!isRecord(json)) return [];
  const skills = json.skills;
  if (!Array.isArray(skills)) return [];
  const out: ServerMarketplaceSkill[] = [];
  for (const row of skills) {
    const m = mapSkillRow(row);
    if (m) out.push(m);
  }
  return out;
}

const DEFAULT_FETCH_MS = 15_000;

/**
 * Empty query → GET /api/v1/skill_list; non-empty → GET /api/v1/skill_search?q=
 */
export async function fetchRemoteSkillsMarketplace(
  params: SkillsMarketplaceFetchParams,
): Promise<ServerMarketplaceSkill[]> {
  const base = resolveFarmApiBaseUrl();
  if (!base) {
    throw new Error('SKILLS_MARKETPLACE_NO_BASE_URL');
  }

  const q = params.query.trim();
  const category = String(params.category || '').trim();
  const searchParams = new URLSearchParams();
  if (q.length > 0) {
    searchParams.set('q', q);
  }
  if (category && category !== 'all') {
    searchParams.set('category', category);
  }
  const queryString = searchParams.toString();
  const urlPath = q.length === 0
    ? `/api/v1/skill_list${queryString ? `?${queryString}` : ''}`
    : `/api/v1/skill_search?${queryString}`;
  const url = `${base}${urlPath}`;

  const limit = params.limit ?? 50;

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_FETCH_MS);
  let res: Response;
  try {
    res = await proxyAwareFetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`SKILLS_MARKETPLACE_HTTP_${res.status}: ${text.slice(0, 200)}`);
  }

  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error('SKILLS_MARKETPLACE_INVALID_JSON');
  }

  let out = parseSkillsPayload(json);
  if (out.length > limit) {
    out = out.slice(0, limit);
  }
  return out;
}

// --- Install (zip) ---

const SKILL_NAME_SAFE = /^[a-zA-Z0-9._-]+$/;

const DOWNLOAD_TIMEOUT_MS = 60_000;
const SERVER_INSTALL_DIR_SUFFIX_MAX = 48;

export type ServerSkillArchiveIdentity = {
  /** Canonical identity used for same-name overwrite checks. */
  canonicalName: string;
  aliases: string[];
};

export type PreparedServerSkillInstall = {
  identity: ServerSkillArchiveIdentity;
  install: () => Promise<string>;
};

export function assertSafeServerSkillName(name: string): void {
  const trimmed = name.trim();
  if (!trimmed || trimmed !== name || !SKILL_NAME_SAFE.test(name)) {
    throw new Error('SKILLS_MARKETPLACE_INVALID_SKILL_NAME');
  }
}

/**
 * Fetch zip bytes from the server (Bearer optional).
 */
export async function downloadServerSkillZip(skillName: string): Promise<Buffer> {
  assertSafeServerSkillName(skillName);
  const base = resolveFarmApiBaseUrl();
  if (!base) {
    throw new Error('SKILLS_MARKETPLACE_NO_BASE_URL');
  }

  const url = `${base}/api/v1/skill_file/${encodeURIComponent(skillName)}`;
  const headers: Record<string, string> = {
    Accept: 'application/zip, application/octet-stream, */*',
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  let res: Response;
  try {
    res = await proxyAwareFetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (!res.ok) {
    const preview = buf.length ? buf.toString('utf8', 0, Math.min(200, buf.length)) : '';
    throw new Error(`SKILLS_MARKETPLACE_HTTP_${res.status}: ${preview}`);
  }
  if (buf.length === 0) {
    throw new Error('SKILLS_MARKETPLACE_EMPTY_ZIP');
  }
  return buf;
}

const CLIENT_INSTALL_REPORT_TIMEOUT_MS = 10_000;

/**
 * Tell the skills server a client install/upgrade succeeded so it can bump download_count.
 * Best-effort: callers should not fail the local install if this returns false.
 */
export async function reportServerSkillClientInstall(
  skillName: string,
  versionBase?: string,
): Promise<boolean> {
  const name = String(skillName || '').trim();
  const versionBaseTrimmed = String(versionBase || '').trim();
  if (!name && !versionBaseTrimmed) {
    return false;
  }

  const base = resolveFarmApiBaseUrl();
  if (!base) {
    return false;
  }

  const body: Record<string, string> = {};
  if (name) body.name = name;
  if (versionBaseTrimmed) body.version_base = versionBaseTrimmed;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIENT_INSTALL_REPORT_TIMEOUT_MS);
  try {
    const res = await proxyAwareFetch(`${base}/api/v1/skill_client_install`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function reportServerSkillClientInstallBestEffort(
  skillName: string,
  versionBase?: string,
): Promise<void> {
  try {
    await reportServerSkillClientInstall(skillName, versionBase);
  } catch {
    // Local install already succeeded; counting is non-critical.
  }
}

function normalizeArchiveEntryName(value: string): string | null {
  const slashNormalized = value.replace(/\\/g, '/');
  if (
    !slashNormalized
    || slashNormalized.startsWith('/')
    || /^[a-zA-Z]:\//.test(slashNormalized)
    || slashNormalized.includes('\0')
  ) {
    return null;
  }
  const normalized = slashNormalized.replace(/^\.\//, '');
  if (!normalized || normalized.split('/').some((part) => part === '..')) return null;
  return normalized;
}

function safeArchiveEntries(zip: AdmZip): Array<{
  entry: ReturnType<AdmZip['getEntries']>[number];
  name: string;
}> {
  const entries: Array<{
    entry: ReturnType<AdmZip['getEntries']>[number];
    name: string;
  }> = [];
  for (const entry of zip.getEntries()) {
    const name = normalizeArchiveEntryName(entry.entryName);
    if (!name) {
      throw new Error('SKILLS_MARKETPLACE_UNSAFE_ARCHIVE');
    }
    entries.push({ entry, name });
  }
  return entries;
}

function parseSkillFrontmatterName(content: string): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return '';
  const nameMatch = match[1].match(/^\s*name\s*:\s*["']?([^"'\n]+)["']?\s*$/m);
  return nameMatch?.[1]?.trim() || '';
}

/**
 * Resolve the identity carried by a server ZIP before any managed skill
 * directory is mutated. This keeps same-name confirmation based on the actual
 * SKILL.md rather than only on a catalog slug.
 */
export function readServerSkillArchiveIdentity(
  zipBuffer: Buffer,
  fallbackName: string,
): ServerSkillArchiveIdentity {
  let zip: AdmZip;
  try {
    zip = new AdmZip(zipBuffer);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`SKILLS_MARKETPLACE_EXTRACT_FAILED: ${detail}`, { cause: error });
  }

  const entries = safeArchiveEntries(zip)
    .filter((item) => item.entry.isDirectory !== true);
  const skillEntries = entries
    .filter((item) => /(^|\/)skill\.md$/i.test(item.name))
    .sort((left, right) => left.name.split('/').length - right.name.split('/').length);
  if (skillEntries.length === 0) {
    throw new Error('SKILLS_MARKETPLACE_EMPTY_ZIP');
  }
  if (skillEntries.length > 1) {
    throw new Error('SKILLS_MARKETPLACE_AMBIGUOUS_SKILL_ARCHIVE');
  }
  const skillEntry = skillEntries[0]!;

  let skillContent: string;
  try {
    skillContent = skillEntry.entry.getData().toString('utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`SKILLS_MARKETPLACE_EXTRACT_FAILED: ${detail}`, { cause: error });
  }

  const aliases = new Set<string>();
  const add = (value?: unknown) => {
    if (typeof value === 'string' && value.trim()) aliases.add(value.trim());
  };
  const canonicalName = parseSkillFrontmatterName(skillContent) || fallbackName;
  add(canonicalName);
  add(fallbackName);

  const skillDir = skillEntry.name.slice(0, Math.max(0, skillEntry.name.lastIndexOf('/')));
  const manifestNames = new Set([
    skillDir ? `${skillDir}/manifest.json` : 'manifest.json',
    'manifest.json',
  ]);
  for (const item of entries) {
    if (!manifestNames.has(item.name)) continue;
    try {
      const manifest = JSON.parse(item.entry.getData().toString('utf8')) as {
        slug?: unknown;
      };
      add(manifest.slug);
    } catch {
      // A malformed optional manifest must not override a valid SKILL.md.
    }
  }

  return { canonicalName, aliases: [...aliases] };
}

function isMissingPathError(error: unknown): boolean {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function pathIsDefinitelyAbsent(targetPath: string): boolean {
  try {
    fs.statSync(targetPath);
    return false;
  } catch (error) {
    return isMissingPathError(error);
  }
}

function chmodWritableBestEffort(targetPath: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(targetPath);
  } catch {
    return;
  }

  try {
    fs.chmodSync(targetPath, stat.isDirectory() ? 0o700 : 0o600);
  } catch {
    // Ignore permission normalization failures; rm will surface the final result.
  }

  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    return;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(targetPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    chmodWritableBestEffort(path.join(targetPath, entry.name));
  }
}

function quoteWindowsCmdPath(targetPath: string): string {
  return `"${targetPath.replace(/"/g, '""')}"`;
}

function clearWindowsReadonlyAttributesBestEffort(targetPath: string): void {
  if (process.platform !== 'win32') return;
  try {
    spawnSync(
      'cmd.exe',
      ['/d', '/s', '/c', `attrib -R -S -H ${quoteWindowsCmdPath(targetPath)} /S /D`],
      { windowsHide: true, stdio: 'ignore' },
    );
  } catch {
    // Ignore attribute cleanup failures; the actual delete attempt determines the result.
  }
}

function grantWindowsDeletePermissionBestEffort(targetPath: string): void {
  if (process.platform !== 'win32') return;
  const user = process.env.USERNAME || process.env.USER || '';
  const domain = process.env.USERDOMAIN || '';
  const account = user ? (domain ? `${domain}\\${user}` : user) : '';

  try {
    spawnSync('takeown.exe', ['/F', targetPath, '/R', '/D', 'Y'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  } catch {
    // Ignore ownership repair failures; icacls/rmdir will surface the final result.
  }

  if (!account) return;
  try {
    spawnSync('icacls.exe', [targetPath, '/grant', `${account}:(OI)(CI)F`, '/T', '/C', '/Q'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  } catch {
    // Ignore ACL repair failures; the delete attempt determines the result.
  }
}

function removeWindowsDirectoryBestEffort(targetPath: string): boolean {
  if (process.platform !== 'win32' || pathIsDefinitelyAbsent(targetPath)) {
    return pathIsDefinitelyAbsent(targetPath);
  }

  grantWindowsDeletePermissionBestEffort(targetPath);
  clearWindowsReadonlyAttributesBestEffort(targetPath);
  chmodWritableBestEffort(targetPath);
  try {
    spawnSync(
      'cmd.exe',
      ['/d', '/s', '/c', `rmdir /S /Q ${quoteWindowsCmdPath(targetPath)}`],
      { windowsHide: true, stdio: 'ignore' },
    );
  } catch {
    // Fall through to the final existence check.
  }

  return pathIsDefinitelyAbsent(targetPath);
}

export function removeExistingSkillDir(targetDir: string): boolean {
  if (pathIsDefinitelyAbsent(targetDir)) {
    return true;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      grantWindowsDeletePermissionBestEffort(targetDir);
      clearWindowsReadonlyAttributesBestEffort(targetDir);
      fs.rmSync(targetDir, {
        recursive: true,
        force: true,
        // Windows can briefly keep files locked after the gateway or Explorer has
        // scanned the skill directory. Let Node retry before falling back.
        maxRetries: 5,
        retryDelay: 200,
      });
      if (pathIsDefinitelyAbsent(targetDir)) {
        return true;
      }
    } catch {
      chmodWritableBestEffort(targetDir);
      grantWindowsDeletePermissionBestEffort(targetDir);
      clearWindowsReadonlyAttributesBestEffort(targetDir);
    }
  }

  return removeWindowsDirectoryBestEffort(targetDir);
}

function writeServerMarketplaceMeta(
  targetDir: string,
  skillName: string,
  archiveHash?: string,
  listingRevision?: string,
  installedVersion?: string,
  versionBase?: string,
  category?: string,
): void {
  if (!archiveHash && !listingRevision && !installedVersion && !versionBase && !category) {
    return;
  }
  fs.writeFileSync(
    path.join(targetDir, '.clawx-server-marketplace.json'),
    JSON.stringify(
      {
        provider: 'server',
        slug: skillName,
        installedVersion,
        versionBase,
        category,
        archiveHash,
        listingRevision,
        installedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );
}

function safeInstallDirSuffix(value?: string): string {
  const raw = String(value || Date.now()).trim();
  const safe = raw.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return (safe || String(Date.now())).slice(0, SERVER_INSTALL_DIR_SUFFIX_MAX);
}

function serverInstallTargetCandidates(skillsRoot: string, skillName: string, listingRevision?: string): string[] {
  const primary = path.join(skillsRoot, skillName);
  const suffixBase = safeInstallDirSuffix(listingRevision);
  const candidates = [primary];
  for (let i = 0; i < 100; i += 1) {
    const suffix = i === 0 ? suffixBase : `${suffixBase}-${i}`;
    candidates.push(path.join(skillsRoot, `${skillName}--${suffix}`));
  }
  candidates.push(path.join(skillsRoot, `${skillName}--${suffixBase}-${Date.now()}`));
  return candidates;
}

function copySkillDirToAvailableTarget(sourceDir: string, candidates: string[]): string {
  let lastError: unknown;
  for (const candidate of candidates) {
    if (!removeExistingSkillDir(candidate)) {
      continue;
    }
    try {
      fs.cpSync(sourceDir, candidate, {
        recursive: true,
        force: true,
        errorOnExist: false,
      });
      return candidate;
    } catch (error) {
      lastError = error;
      removeExistingSkillDir(candidate);
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error('SKILLS_MARKETPLACE_NO_INSTALL_TARGET');
}

function cleanupOlderServerSkillInstalls(skillsRoot: string, installedDir: string, skillName: string, versionBase?: string): void {
  const installedRealPath = path.resolve(installedDir);
  const normalizedSkillName = normalizeIdentifier(skillName);
  const normalizedVersionBase = normalizeIdentifier(versionBase);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(skillsRoot, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillDir = path.join(skillsRoot, entry.name);
    if (path.resolve(skillDir) === installedRealPath) continue;
    const meta = readJsonFile(path.join(skillDir, '.clawx-server-marketplace.json'));
    if (meta?.provider !== 'server') continue;
    const metaVersionBase = normalizeIdentifier(typeof meta.versionBase === 'string' ? meta.versionBase : '');
    const metaSlug = normalizeIdentifier(typeof meta.slug === 'string' ? meta.slug : '');
    if (normalizedVersionBase) {
      if (metaVersionBase !== normalizedVersionBase && metaSlug !== normalizedSkillName) continue;
    } else if (metaSlug !== normalizedSkillName) {
      continue;
    }
    removeExistingSkillDir(skillDir);
  }
}

function materializeZipToSkillDir(
  zipBuffer: Buffer,
  skillName: string,
  skillsRoot: string,
  archiveHash?: string,
  listingRevision?: string,
  installedVersion?: string,
  versionBase?: string,
  category?: string,
): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawx-skill-'));
  const unpackDir = path.join(tempDir, 'unpack');
  try {
    fs.mkdirSync(unpackDir, { recursive: true });
    try {
      const zip = new AdmZip(zipBuffer);
      safeArchiveEntries(zip);
      zip.extractAllTo(unpackDir, true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`SKILLS_MARKETPLACE_EXTRACT_FAILED: ${msg}`, { cause: err });
    }

    const top = fs.readdirSync(unpackDir, { withFileTypes: true });
    const sourceDir =
      top.length === 1 && top[0].isDirectory()
        ? path.join(unpackDir, top[0].name)
        : unpackDir;
    const targetDir = copySkillDirToAvailableTarget(
      sourceDir,
      serverInstallTargetCandidates(skillsRoot, skillName, listingRevision),
    );
    writeServerMarketplaceMeta(targetDir, skillName, archiveHash, listingRevision, installedVersion, versionBase, category);
    cleanupOlderServerSkillInstalls(skillsRoot, targetDir, skillName, versionBase);
    return targetDir;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function downloadAndInstallServerSkill(
  skillName: string,
  archiveHash?: string,
  listingRevision?: string,
  installedVersion?: string,
  versionBase?: string,
  category?: string,
): Promise<void> {
  assertSafeServerSkillName(skillName);
  const buf = await downloadServerSkillZip(skillName);
  const workDir = getOpenClawConfigDir();
  ensureDir(workDir);
  const skillsRoot = path.join(workDir, 'skills');
  ensureDir(skillsRoot);
  materializeZipToSkillDir(buf, skillName, skillsRoot, archiveHash, listingRevision, installedVersion, versionBase, category);
  await reportServerSkillClientInstallBestEffort(skillName, versionBase);
}

/**
 * Download and validate a server artifact before a same-name overwrite may
 * stage or delete an existing managed skill. The returned installer consumes
 * the already downloaded bytes, avoiding a second request after confirmation.
 */
export async function prepareServerSkillInstall(
  skillName: string,
  archiveHash?: string,
  listingRevision?: string,
  installedVersion?: string,
  versionBase?: string,
  category?: string,
): Promise<PreparedServerSkillInstall> {
  assertSafeServerSkillName(skillName);
  const zipBuffer = await downloadServerSkillZip(skillName);
  const identity = readServerSkillArchiveIdentity(zipBuffer, skillName);
  return {
    identity,
    install: async () => {
      const workDir = getOpenClawConfigDir();
      ensureDir(workDir);
      const skillsRoot = path.join(workDir, 'skills');
      ensureDir(skillsRoot);
      const installedDir = materializeZipToSkillDir(
        zipBuffer,
        skillName,
        skillsRoot,
        archiveHash,
        listingRevision,
        installedVersion,
        versionBase,
        category,
      );
      writeManagedSkillInstallMetadata(installedDir, {
        installedAt: new Date().toISOString(),
        source: 'server',
        canonicalName: identity.canonicalName,
        slug: skillName,
        version: installedVersion,
        versionBase,
      });
      await reportServerSkillClientInstallBestEffort(skillName, versionBase);
      return installedDir;
    },
  };
}

function normalizeIdentifier(value?: string): string {
  return String(value || '').trim().toLowerCase();
}

function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function readSkillManifestName(skillDir: string): string {
  try {
    const raw = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
    const match = raw.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) return '';
    const nameMatch = match[1].match(/^\s*name\s*:\s*["']?([^"'\n]+)["']?\s*$/m);
    return nameMatch?.[1]?.trim() || '';
  } catch {
    return '';
  }
}

function removeDirBestEffort(dir: string): boolean {
  return removeExistingSkillDir(dir);
}

function isPathInsideDirectory(rootDir: string, targetDir: string): boolean {
  const relativePath = path.relative(path.resolve(rootDir), path.resolve(targetDir));
  return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function removeMatchingSkillDir(
  skillDir: string,
  identifiers: Set<string>,
): 'removed' | 'failed' | 'skipped' {
  const meta = readJsonFile(path.join(skillDir, '.clawx-server-marketplace.json'));
  const manifestName = readSkillManifestName(skillDir);
  const candidates = [
    path.basename(skillDir),
    manifestName,
    typeof meta?.slug === 'string' ? meta.slug : '',
  ].map(normalizeIdentifier).filter(Boolean);

  const hasMatch = candidates.some((candidate) => identifiers.has(candidate));
  if (!hasMatch) return 'skipped';

  const hasServerMeta = meta?.provider === 'server';
  const isLegacyDirectMatch =
    identifiers.has(normalizeIdentifier(path.basename(skillDir))) ||
    identifiers.has(normalizeIdentifier(manifestName));
  if (!hasServerMeta && !isLegacyDirectMatch) return 'skipped';

  return removeDirBestEffort(skillDir) ? 'removed' : 'failed';
}

function removeSelectedServerSkillDir(
  skillDir: string,
  identifiers: Set<string>,
): 'removed' | 'failed' | 'skipped' {
  const meta = readJsonFile(path.join(skillDir, '.clawx-server-marketplace.json'));
  if (meta?.provider === 'server') {
    return removeDirBestEffort(skillDir) ? 'removed' : 'failed';
  }
  return removeMatchingSkillDir(skillDir, identifiers);
}

export async function removeServerMarketplaceSkillLocalInstall(params: {
  skillId?: string;
  displayName?: string;
  baseDir?: string;
}): Promise<{ removed: string[]; failed: string[] }> {
  const rawIdentifiers = [...new Set(
    [params.skillId, params.displayName]
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  )];
  const identifiers = new Set(rawIdentifiers.map(normalizeIdentifier));
  if (identifiers.size === 0) {
    return { removed: [], failed: [] };
  }

  const workDir = getOpenClawConfigDir();
  const skillsRoot = path.join(workDir, 'skills');
  if (!fs.existsSync(skillsRoot)) {
    return { removed: [], failed: [] };
  }

  const removed: string[] = [];
  const failed: string[] = [];
  const attempted = new Set<string>();
  const recordResult = (skillDir: string, result: 'removed' | 'failed' | 'skipped') => {
    const resolved = path.resolve(skillDir);
    attempted.add(resolved);
    if (result === 'removed') {
      removed.push(skillDir);
    } else if (result === 'failed') {
      failed.push(skillDir);
    }
  };

  const preferredBaseDir = String(params.baseDir || '').trim();
  if (preferredBaseDir) {
    if (isPathInsideDirectory(skillsRoot, preferredBaseDir)) {
      try {
        if (fs.statSync(preferredBaseDir).isDirectory()) {
          const result = removeSelectedServerSkillDir(preferredBaseDir, identifiers);
          recordResult(preferredBaseDir, result);
        }
      } catch {
        // A stale selected directory is treated as already absent.
      }
    }
  }

  const entries = fs.readdirSync(skillsRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillDir = path.join(skillsRoot, entry.name);
    if (attempted.has(path.resolve(skillDir))) continue;
    const result = removeMatchingSkillDir(skillDir, identifiers);
    recordResult(skillDir, result);
  }

  for (const id of rawIdentifiers) {
    await removeSkillConfig(id).catch(() => undefined);
  }

  return { removed, failed };
}
