#!/usr/bin/env zx

import 'zx/globals';
import crypto from 'node:crypto';
import os from 'node:os';
import { readFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, cpSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MANIFEST_PATH = join(ROOT, 'resources', 'skills', 'preinstalled-manifest.json');
const OUTPUT_ROOT = join(ROOT, 'build', 'preinstalled-skills');
const TMP_ROOT = join(ROOT, 'build', '.tmp-preinstalled-skills');
const CACHE_FILE = join(OUTPUT_ROOT, '.bundle-cache.json');
const SCRIPT_FILE = join(__dirname, 'bundle-preinstalled-skills.mjs');

// Pinned version of the standalone `skills` CLI (github.com/vercel-labs/skills)
// used to vendor `source: "npx"` entries. Pinning keeps builds reproducible.
const SKILLS_CLI_VERSION = '1.5.20';

function calculateHash() {
  const hash = crypto.createHash('sha256');
  if (existsSync(MANIFEST_PATH)) hash.update(readFileSync(MANIFEST_PATH));
  if (existsSync(SCRIPT_FILE)) hash.update(readFileSync(SCRIPT_FILE));
  return hash.digest('hex');
}

const currentHash = calculateHash();

if (existsSync(CACHE_FILE)) {
  try {
    const cacheData = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
    if (cacheData.hash === currentHash) {
      if (existsSync(join(OUTPUT_ROOT, '.preinstalled-lock.json'))) {
        echo`⚡️ preinstalled-skills bundle cache hit! Skipping fetch.`;
        process.exit(0);
      }
    }
  } catch (e) {
    /* ignore parse errors */
  }
}

function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error(`Missing manifest: ${MANIFEST_PATH}`);
  }
  const raw = readFileSync(MANIFEST_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.skills)) {
    throw new Error('Invalid preinstalled-skills manifest format');
  }
  for (const item of parsed.skills) {
    if (!item.slug) {
      throw new Error(`Invalid manifest entry (missing slug): ${JSON.stringify(item)}`);
    }
    const source = item.source || 'git';
    if (source === 'git') {
      if (!item.repo || !item.repoPath) {
        throw new Error(`Invalid git manifest entry (needs repo + repoPath): ${JSON.stringify(item)}`);
      }
    } else if (source === 'npx') {
      if (!item.url) {
        throw new Error(`Invalid npx manifest entry (needs url): ${JSON.stringify(item)}`);
      }
    } else {
      throw new Error(`Unknown source "${source}" in manifest entry: ${JSON.stringify(item)}`);
    }
  }
  return parsed.skills;
}

function groupByRepoRef(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    const ref = entry.ref || 'main';
    const key = `${entry.repo}#${ref}`;
    if (!grouped.has(key)) grouped.set(key, { repo: entry.repo, ref, entries: [] });
    grouped.get(key).entries.push(entry);
  }
  return [...grouped.values()];
}

function createRepoDirName(repo, ref) {
  return `${repo.replace(/[\\/]/g, '__')}__${ref.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
}

function toGitPath(inputPath) {
  if (process.platform !== 'win32') return inputPath;
  return inputPath.replace(/\\/g, '/');
}

function normalizeRepoPath(repoPath) {
  return repoPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function shouldCopySkillFile(srcPath) {
  const base = basename(srcPath);
  if (base === '.git') return false;
  if (base === '.subset.tar') return false;
  return true;
}

/** Best-effort parse of `version:` from a SKILL.md YAML frontmatter block. */
function readSkillFrontmatterVersion(skillMdPath) {
  try {
    const raw = readFileSync(skillMdPath, 'utf8');
    const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) return '';
    const version = fm[1].match(/^version:\s*['"]?([^'"\r\n]+)['"]?\s*$/m);
    return version ? version[1].trim() : '';
  } catch {
    return '';
  }
}

/**
 * Locate the skill directory produced by `skills add` inside a scratch dir.
 * The CLI writes to `<scratch>/<agent>/skills/<name>` (e.g. `.claude/skills/`);
 * we prefer the conventional `.claude` path, then fall back to scanning any
 * `<agent>/skills/*` so we survive agent -> dir naming differences.
 */
function locateProducedSkill(scratch, skillName) {
  const preferred = join(scratch, '.claude', 'skills', skillName);
  if (existsSync(join(preferred, 'SKILL.md'))) return preferred;

  const agentDirs = readdirSync(scratch, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(scratch, entry.name, 'skills'))
    .filter((skillsDir) => existsSync(skillsDir));

  // Exact name match under any agent dir.
  for (const skillsDir of agentDirs) {
    const candidate = join(skillsDir, skillName);
    if (existsSync(join(candidate, 'SKILL.md'))) return candidate;
  }

  // Otherwise, if exactly one skill was produced, use it.
  const produced = [];
  for (const skillsDir of agentDirs) {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = join(skillsDir, entry.name);
      if (existsSync(join(candidate, 'SKILL.md'))) produced.push(candidate);
    }
  }
  return produced.length === 1 ? produced[0] : null;
}

/**
 * Vendor a `source: "npx"` entry via the standalone `skills` CLI into
 * `build/preinstalled-skills/<slug>/`. Runs in a throwaway scratch dir under
 * the OS temp dir so no `.claude` folder is ever left inside the repo.
 */
async function vendorNpxSkill(entry, lock) {
  const skillName = entry.skill || entry.slug;
  const scratch = mkdtempSync(join(os.tmpdir(), `clawx-npx-${entry.slug}-`));
  try {
    const prevCwd = $.cwd;
    $.cwd = scratch;
    try {
      // Each clawhub per-skill URL exposes exactly one skill via its
      // /.well-known/agent-skills/index.json, so we let the CLI install
      // whatever it discovers and locate it afterwards (no fragile `-s`
      // filter that must match the skill's internal name).
      await $`npx --yes skills@${SKILLS_CLI_VERSION} add ${entry.url} --copy -y -a claude-code`;
    } finally {
      $.cwd = prevCwd;
    }

    const producedDir = locateProducedSkill(scratch, skillName);
    if (!producedDir) {
      throw new Error(`npx skills add produced no skill dir for ${entry.slug} (url=${entry.url})`);
    }

    const targetDir = join(OUTPUT_ROOT, entry.slug);
    rmSync(targetDir, { recursive: true, force: true });
    cpSync(producedDir, targetDir, { recursive: true, dereference: true, filter: shouldCopySkillFile });

    const skillManifest = join(targetDir, 'SKILL.md');
    if (!existsSync(skillManifest)) {
      throw new Error(`Skill ${entry.slug} is missing SKILL.md after npx install`);
    }

    const resolvedVersion = readSkillFrontmatterVersion(skillManifest)
      || (entry.version || '').trim()
      || 'latest';
    lock.skills.push({
      slug: entry.slug,
      source: 'npx',
      version: resolvedVersion,
      url: entry.url,
      skill: skillName,
      skillsCliVersion: SKILLS_CLI_VERSION,
    });

    echo`   OK ${entry.slug} (npx)`;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function extractArchive(archiveFileName, cwd) {
  const prevCwd = $.cwd;
  $.cwd = cwd;
  try {
    try {
      await $`tar -xf ${archiveFileName}`;
      return;
    } catch (tarError) {
      if (process.platform === 'win32') {
        await $`bsdtar -xf ${archiveFileName}`;
        return;
      }
      throw tarError;
    }
  } finally {
    $.cwd = prevCwd;
  }
}

async function fetchSparseRepo(repo, ref, paths, checkoutDir) {
  const remote = `https://github.com/${repo}.git`;
  mkdirSync(checkoutDir, { recursive: true });
  const gitCheckoutDir = toGitPath(checkoutDir);
  const archiveFileName = '.subset.tar';
  const archivePath = join(checkoutDir, archiveFileName);
  const archivePaths = [...new Set(paths.map(normalizeRepoPath))];

  await $`git init ${gitCheckoutDir}`;
  await $`git -C ${gitCheckoutDir} remote add origin ${remote}`;
  await $`git -C ${gitCheckoutDir} fetch --depth 1 origin ${ref}`;
  await $`git -C ${gitCheckoutDir} archive --format=tar --output ${archiveFileName} FETCH_HEAD ${archivePaths}`;
  await extractArchive(archiveFileName, checkoutDir);
  rmSync(archivePath, { force: true });

  const commit = (await $`git -C ${gitCheckoutDir} rev-parse FETCH_HEAD`).stdout.trim();
  return commit;
}

echo`Bundling preinstalled skills...`;

if (process.env.SKIP_PREINSTALLED_SKILLS === '1') {
  echo`⏭  SKIP_PREINSTALLED_SKILLS=1 set, skipping skills fetch.`;
  process.exit(0);
}

const manifestSkills = loadManifest();

rmSync(OUTPUT_ROOT, { recursive: true, force: true });
mkdirSync(OUTPUT_ROOT, { recursive: true });
rmSync(TMP_ROOT, { recursive: true, force: true });
mkdirSync(TMP_ROOT, { recursive: true });

const lock = {
  generatedAt: new Date().toISOString(),
  skills: [],
};

const groups = groupByRepoRef(manifestSkills.filter((entry) => (entry.source || 'git') === 'git'));
for (const group of groups) {
  const repoDir = join(TMP_ROOT, createRepoDirName(group.repo, group.ref));
  const sparsePaths = [...new Set(group.entries.map((entry) => entry.repoPath))];

  echo`Fetching ${group.repo} @ ${group.ref}`;
  const commit = await fetchSparseRepo(group.repo, group.ref, sparsePaths, repoDir);
  echo`   commit ${commit}`;

  for (const entry of group.entries) {
    const sourceDir = join(repoDir, entry.repoPath);
    const targetDir = join(OUTPUT_ROOT, entry.slug);

    if (!existsSync(sourceDir)) {
      throw new Error(`Missing source path in repo checkout: ${entry.repoPath}`);
    }

    rmSync(targetDir, { recursive: true, force: true });
    cpSync(sourceDir, targetDir, { recursive: true, dereference: true, filter: shouldCopySkillFile });

    const skillManifest = join(targetDir, 'SKILL.md');
    if (!existsSync(skillManifest)) {
      throw new Error(`Skill ${entry.slug} is missing SKILL.md after copy`);
    }

    const requestedVersion = (entry.version || '').trim();
    const resolvedVersion = !requestedVersion || requestedVersion === 'main'
      ? commit
      : requestedVersion;
    lock.skills.push({
      slug: entry.slug,
      source: 'git',
      version: resolvedVersion,
      repo: entry.repo,
      repoPath: entry.repoPath,
      ref: group.ref,
      commit,
    });

    echo`   OK ${entry.slug}`;
  }
}

for (const entry of manifestSkills.filter((item) => item.source === 'npx')) {
  echo`Installing via npx skills: ${entry.slug} <- ${entry.url}`;
  await vendorNpxSkill(entry, lock);
}

writeFileSync(join(OUTPUT_ROOT, '.preinstalled-lock.json'), `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
writeFileSync(CACHE_FILE, JSON.stringify({ hash: currentHash, timestamp: Date.now() }, null, 2), 'utf8');
rmSync(TMP_ROOT, { recursive: true, force: true });
echo`Preinstalled skills ready: ${OUTPUT_ROOT}`;
