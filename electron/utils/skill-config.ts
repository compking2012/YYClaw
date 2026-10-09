/**
 * Skill Config Utilities
 * Skill configuration reads and coordinated mutations for openclaw.json.
 */
import { readFile, writeFile, mkdir, cp, readdir, rm, lstat, mkdtemp, rename } from 'fs/promises';
import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { getOpenClawResolvedDir, getResourcesDir } from './paths';
import { logger } from './logger';
import { cpAsyncSafe } from './plugin-install';
import { mutateOpenClawConfig, readOpenClawConfigSnapshot } from '../gateway/config-delivery';

const BUNDLED_OPENCLAW_SKILL_ALLOWLIST = new Set(['skill-creator']);

export interface SkillConfigUpdates {
    enabled?: boolean;
    apiKey?: string;
    env?: Record<string, string>;
}

type SkillEntry = SkillConfigUpdates;

interface OpenClawConfig {
    skills?: {
        entries?: Record<string, SkillEntry>;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

type PreinstalledSkillSource = 'git' | 'npx';

interface PreinstalledSkillSpec {
    slug: string;
    source?: PreinstalledSkillSource;
    version?: string;
    autoEnable?: boolean;
    /** Platforms this skill should be deployed on; omitted = all platforms. */
    platform?: NodeJS.Platform[];
    // git source
    repo?: string;
    repoPath?: string;
    ref?: string;
    // npx source (standalone `skills` CLI)
    url?: string;
    skill?: string;
}

interface PreinstalledManifest {
    skills?: PreinstalledSkillSpec[];
}

interface PreinstalledLockEntry {
    slug: string;
    version?: string;
}

interface PreinstalledLockFile {
    skills?: PreinstalledLockEntry[];
}

interface PreinstalledMarker {
    source: 'clawx-preinstalled';
    slug: string;
    version: string;
    installedAt: string;
    /** Origin of the preinstalled skill (git repo vs npx `skills` CLI). */
    origin?: PreinstalledSkillSource;
    /** For npx-sourced skills, the `skills add` argument used at build time. */
    url?: string;
}

/**
 * Read the current OpenClaw config
 */
async function readConfig(): Promise<OpenClawConfig> {
    try {
        return (await readOpenClawConfigSnapshot()).config as OpenClawConfig;
    } catch (err) {
        console.error('Failed to read openclaw config:', err);
        return {};
    }
}

async function setSkillsEnabled(skillKeys: string[], enabled: boolean): Promise<void> {
  if (skillKeys.length === 0) {
    return;
  }
  const { applyBulkSkillEnabledState } = await import('./agent-config');
  await applyBulkSkillEnabledState(skillKeys, enabled);
}

/**
 * Get skill config
 */
export async function getSkillConfig(skillKey: string): Promise<SkillEntry | undefined> {
    const config = await readConfig();
    return config.skills?.entries?.[skillKey];
}

/**
 * Update skill config (apiKey and env)
 */
function isEmptySkillEntry(entry: SkillEntry | undefined): boolean {
    if (!entry) return true;
    const hasEnabled = typeof entry.enabled === 'boolean';
    const hasApiKey = typeof entry.apiKey === 'string' && entry.apiKey.trim().length > 0;
    const hasEnv = !!entry.env && Object.keys(entry.env).length > 0;
    return !hasEnabled && !hasApiKey && !hasEnv;
}

async function applySkillConfigUpdates(
    config: OpenClawConfig,
    updates: Array<{ skillKey: string; remove?: boolean } & SkillConfigUpdates>,
): Promise<void> {
    if (!config.skills) {
        config.skills = {};
    }
    if (!config.skills.entries) {
        config.skills.entries = {};
    }

    for (const update of updates) {
        const skillKey = update.skillKey.trim();
        if (!skillKey) continue;

        if (update.remove) {
            delete config.skills.entries[skillKey];
            continue;
        }

        const entry = config.skills.entries[skillKey] || {};

        // skills.entries[].enabled is derived from agents.list[].skills; ignore direct writes.
        if (update.apiKey !== undefined) {
            const trimmed = update.apiKey.trim();
            if (trimmed) {
                entry.apiKey = trimmed;
            } else {
                delete entry.apiKey;
            }
        }

        if (update.env !== undefined) {
            const newEnv: Record<string, string> = {};

            for (const [key, value] of Object.entries(update.env)) {
                const trimmedKey = key.trim();
                if (!trimmedKey) continue;

                const trimmedVal = value.trim();
                if (trimmedVal) {
                    newEnv[trimmedKey] = trimmedVal;
                }
            }

            if (Object.keys(newEnv).length > 0) {
                entry.env = newEnv;
            } else {
                delete entry.env;
            }
        }

        if (isEmptySkillEntry(entry)) {
            delete config.skills.entries[skillKey];
        } else {
            config.skills.entries[skillKey] = entry;
        }
    }

    if (config.skills.entries && Object.keys(config.skills.entries).length === 0) {
        delete config.skills.entries;
    }
    if (config.skills && Object.keys(config.skills).length === 0) {
        delete config.skills;
    }
}

export async function updateSkillConfig(
    skillKey: string,
    updates: SkillConfigUpdates,
): Promise<{ success: boolean; error?: string }> {
    return updateSkillConfigs([{ skillKey, ...updates }]);
}

export async function updateSkillConfigs(
    updates: Array<{ skillKey: string } & SkillConfigUpdates>,
): Promise<{ success: boolean; error?: string }> {
    try {
        await mutateOpenClawConfig(async (config) => {
            await applySkillConfigUpdates(config as OpenClawConfig, updates);
        });
        return { success: true };
    } catch (err) {
        console.error('Failed to update skill config:', err);
        return { success: false, error: String(err) };
    }
}

export async function removeSkillConfig(skillKey: string): Promise<{ success: boolean; error?: string }> {
    return removeSkillConfigs([skillKey]);
}

export async function removeSkillConfigs(skillKeys: string[]): Promise<{ success: boolean; removed: number; error?: string }> {
    try {
        const normalizedSkillKeys = skillKeys
            .map((skillKey) => skillKey.trim())
            .filter(Boolean);
        let removed = 0;

        await mutateOpenClawConfig(async (config) => {
            const skillConfig = config as OpenClawConfig;
            const existingEntries = skillConfig.skills?.entries || {};
            removed = normalizedSkillKeys.filter((skillKey) => Object.prototype.hasOwnProperty.call(existingEntries, skillKey)).length;
            if (removed === 0) {
                return;
            }

            await applySkillConfigUpdates(
                skillConfig,
                normalizedSkillKeys.map((skillKey) => ({ skillKey, remove: true })),
            );
        });
        return { success: true, removed };
    } catch (err) {
        console.error('Failed to remove skill configs:', err);
        return { success: false, removed: 0, error: String(err) };
    }
}

/**
 * Get all skill configs (for syncing to frontend)
 */
export async function getAllSkillConfigs(): Promise<Record<string, SkillEntry>> {
    const config = await readConfig();
    return config.skills?.entries || {};
}

function getDisallowedBundledOpenClawSkillSlugs(bundledSkillSlugs: string[]): string[] {
    return bundledSkillSlugs.filter((slug) => !BUNDLED_OPENCLAW_SKILL_ALLOWLIST.has(slug));
}

export async function trimBundledOpenClawSkills(options?: { bundledSkillsRoot?: string }): Promise<{ removed: number; removedSlugs: string[]; kept: string[] }> {
    const bundledSkillsRoot = options?.bundledSkillsRoot || join(getOpenClawResolvedDir(), 'skills');
    if (!existsSync(bundledSkillsRoot)) {
        return { removed: 0, removedSlugs: [], kept: Array.from(BUNDLED_OPENCLAW_SKILL_ALLOWLIST) };
    }

    try {
        const entries = await readdir(bundledSkillsRoot, { withFileTypes: true });
        const disallowed = getDisallowedBundledOpenClawSkillSlugs(
            entries
                .filter((entry) => entry.isDirectory())
                .map((entry) => entry.name),
        );

        let removed = 0;
        const removedSlugs: string[] = [];
        for (const slug of disallowed) {
            const skillDir = join(bundledSkillsRoot, slug);
            if (!existsSync(join(skillDir, 'SKILL.md'))) {
                continue;
            }
            await rm(skillDir, { recursive: true, force: true });
            removed += 1;
            removedSlugs.push(slug);
        }

        return { removed, removedSlugs, kept: Array.from(BUNDLED_OPENCLAW_SKILL_ALLOWLIST) };
    } catch (error) {
        logger.warn('Failed to trim bundled OpenClaw skills:', error);
        return { removed: 0, removedSlugs: [], kept: Array.from(BUNDLED_OPENCLAW_SKILL_ALLOWLIST) };
    }
}

export async function trimBundledOpenClawSkillsAndConfigs(
    options?: { bundledSkillsRoot?: string },
): Promise<{ removed: number; removedSlugs: string[]; removedConfigs: number; kept: string[] }> {
    const trimResult = await trimBundledOpenClawSkills(options);
    const removeResult = trimResult.removedSlugs.length > 0
        ? await removeSkillConfigs(trimResult.removedSlugs)
        : { success: true, removed: 0 };

    if (!removeResult.success) {
        logger.warn(`Failed to prune stale bundled skill configs: ${removeResult.error || 'unknown error'}`);
    }

    return {
        ...trimResult,
        removedConfigs: removeResult.removed,
    };
}

/**
 * Built-in skills bundled with ClawX that should be pre-deployed to
 * ~/.openclaw/skills/ on first launch. First-party sources live in resources/skills
 * and ship unchanged in both dev and packaged builds, without network fetching.
 */
const BUILTIN_SKILLS = ['computer-use'] as const;

async function computerUseBundleHash(directory: string): Promise<string | undefined> {
    try {
        // The shipped bundle is flat. Links or additional directories cannot match it.
        if (!(await lstat(directory)).isDirectory()) return undefined;
        const entries = await readdir(directory, { withFileTypes: true });
        if (entries.some((entry) => !entry.isFile())) return undefined;
        const hash = createHash('sha256');
        for (const name of entries.map((entry) => entry.name).sort()) {
            const bytes = await readFile(join(directory, name));
            hash.update(`${name}\0${createHash('sha256').update(bytes).digest('hex')}\n`);
        }
        return hash.digest('hex');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
    }
}

/**
 * Ensure built-in skills are deployed to ~/.openclaw/skills/<slug>/.
 * computer-use is fully managed: same-name edits and extras are replaced by the bundle.
 * Runs at app startup; all errors are logged and swallowed so they never
 * block the normal startup flow.
 */
export async function ensureBuiltinSkillsInstalled(): Promise<void> {
    const skillsRoot = join(homedir(), '.openclaw', 'skills');

    for (const slug of BUILTIN_SKILLS) {
        const targetDir = join(skillsRoot, slug);

        const sourceDir = join(getResourcesDir(), 'skills', slug);

        if (!existsSync(join(sourceDir, 'SKILL.md'))) {
            logger.warn(`Built-in skill source not found, skipping: ${sourceDir}`);
            continue;
        }

        let stagingDir: string | undefined;
        try {
            const sourceHash = await computerUseBundleHash(sourceDir);
            if (!sourceHash) throw new Error('Invalid bundled computer-use directory');
            if (await computerUseBundleHash(targetDir) === sourceHash) continue;

            await mkdir(skillsRoot, { recursive: true });
            // Stage outside discovery for fresh installs as well as replacements.
            stagingDir = await mkdtemp(join(skillsRoot, '..', '.computer-use-'));
            const stagedBundle = join(stagingDir, 'bundle');
            const previous = join(stagingDir, 'previous');
            await cpAsyncSafe(sourceDir, stagedBundle);
            if (await computerUseBundleHash(stagedBundle) !== sourceHash) {
                throw new Error('Staged computer-use bundle integrity mismatch');
            }
            let movedPrevious = false;
            try {
                // Rename the entry itself, including dangling links, without following it.
                await rename(targetDir, previous);
                movedPrevious = true;
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            }
            try {
                await rename(stagedBundle, targetDir);
            } catch (error) {
                if (movedPrevious) await rename(previous, targetDir);
                throw error;
            }
            if (movedPrevious) await rm(previous, { recursive: true, force: true });
            logger.info(`Installed built-in skill: ${slug} -> ${targetDir}`);
        } catch (error) {
            logger.warn(`Failed to install built-in skill ${slug}:`, error);
        } finally {
            if (stagingDir) {
                // Never delete the old bundle if publication rollback also failed.
                const hasPrevious = await lstat(join(stagingDir, 'previous')).then(
                    () => true,
                    (error: NodeJS.ErrnoException) => error.code !== 'ENOENT',
                );
                if (hasPrevious) {
                    logger.warn(`Retained previous built-in skill for recovery: ${stagingDir}`);
                } else {
                    await rm(stagingDir, { recursive: true, force: true }).catch((error) => {
                        logger.warn(`Failed to remove built-in skill staging directory ${stagingDir}:`, error);
                    });
                }
            }
        }
    }
}

const PREINSTALLED_MANIFEST_NAME = 'preinstalled-manifest.json';
const PREINSTALLED_MARKER_NAME = '.clawx-preinstalled.json';

/** Whether a preinstalled spec applies to the current OS (empty/omitted = all). */
function matchesCurrentPlatform(platform?: NodeJS.Platform[]): boolean {
    if (!Array.isArray(platform) || platform.length === 0) {
        return true;
    }
    return platform.includes(process.platform);
}

async function readPreinstalledManifest(): Promise<PreinstalledSkillSpec[]> {
    const candidates = [
        join(getResourcesDir(), 'skills', PREINSTALLED_MANIFEST_NAME),
        join(process.cwd(), 'resources', 'skills', PREINSTALLED_MANIFEST_NAME),
    ];

    const manifestPath = candidates.find((p) => existsSync(p));
    if (!manifestPath) {
        return [];
    }

    try {
        const raw = await readFile(manifestPath, 'utf-8');
        const parsed = JSON.parse(raw) as PreinstalledManifest;
        if (!Array.isArray(parsed.skills)) {
            return [];
        }
        return parsed.skills
            .filter((s): s is PreinstalledSkillSpec => Boolean(s?.slug))
            .filter((s) => matchesCurrentPlatform(s.platform));
    } catch (error) {
        logger.warn('Failed to read preinstalled-skills manifest:', error);
        return [];
    }
}

function resolvePreinstalledSkillsSourceRoot(): string | null {
    const candidates = [
        join(getResourcesDir(), 'preinstalled-skills'),
        join(process.cwd(), 'build', 'preinstalled-skills'),
        join(__dirname, '../../build/preinstalled-skills'),
    ];

    const root = candidates.find((dir) => existsSync(dir));
    return root || null;
}

async function readPreinstalledLockVersions(sourceRoot: string): Promise<Map<string, string>> {
    const lockPath = join(sourceRoot, '.preinstalled-lock.json');
    if (!existsSync(lockPath)) {
        return new Map();
    }
    try {
        const raw = await readFile(lockPath, 'utf-8');
        const parsed = JSON.parse(raw) as PreinstalledLockFile;
        const versions = new Map<string, string>();
        for (const entry of parsed.skills || []) {
            const slug = entry.slug?.trim();
            const version = entry.version?.trim();
            if (slug && version) {
                versions.set(slug, version);
            }
        }
        return versions;
    } catch (error) {
        logger.warn('Failed to read preinstalled-skills lock file:', error);
        return new Map();
    }
}

async function tryReadMarker(markerPath: string): Promise<PreinstalledMarker | null> {
    if (!existsSync(markerPath)) {
        return null;
    }
    try {
        const raw = await readFile(markerPath, 'utf-8');
        const parsed = JSON.parse(raw) as PreinstalledMarker;
        if (!parsed?.slug || !parsed?.version) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

async function writeBundledSkillMarker(
    targetDir: string,
    slug: string,
    version = 'bundled',
    extra?: { origin?: PreinstalledSkillSource; url?: string },
): Promise<void> {
    const markerPayload: PreinstalledMarker = {
        source: 'clawx-preinstalled',
        slug,
        version,
        installedAt: new Date().toISOString(),
        ...(extra?.origin ? { origin: extra.origin } : {}),
        ...(extra?.url ? { url: extra.url } : {}),
    };
    await writeFile(
        join(targetDir, PREINSTALLED_MARKER_NAME),
        `${JSON.stringify(markerPayload, null, 2)}\n`,
        'utf-8',
    );
}

/** Tag shipped skills as built-in unless the user installed them from the server marketplace. */
async function ensureBundledSkillMarker(
    targetDir: string,
    slug: string,
    version = 'bundled',
    extra?: { origin?: PreinstalledSkillSource; url?: string },
): Promise<void> {
    const markerPath = join(targetDir, PREINSTALLED_MARKER_NAME);
    if (existsSync(markerPath)) {
        return;
    }
    if (existsSync(join(targetDir, '.clawx-server-marketplace.json'))) {
        return;
    }
    await writeBundledSkillMarker(targetDir, slug, version, extra);
}

/**
 * Ensure third-party preinstalled skills (bundled in app resources) are
 * deployed to ~/.openclaw/skills/<slug>/ as full directories.
 *
 * Policy:
 * - If skill is missing locally, install it.
 * - If local skill exists without our marker, backfill the marker when it is not a server marketplace install.
 * - If marker exists with same version, skip.
 * - If marker exists with a different version, skip by default to avoid overwriting edits.
 */
export async function ensurePreinstalledSkillsInstalled(): Promise<void> {
    const skills = await readPreinstalledManifest();
    if (skills.length === 0) {
        return;
    }

    const sourceRoot = resolvePreinstalledSkillsSourceRoot();
    if (!sourceRoot) {
        logger.warn('Preinstalled skills source root not found; skipping preinstall.');
        return;
    }
    const lockVersions = await readPreinstalledLockVersions(sourceRoot);

    const targetRoot = join(homedir(), '.openclaw', 'skills');
    await mkdir(targetRoot, { recursive: true });
    const toEnable: string[] = [];

    for (const spec of skills) {
        const sourceDir = join(sourceRoot, spec.slug);
        const sourceManifest = join(sourceDir, 'SKILL.md');
        if (!existsSync(sourceManifest)) {
            logger.warn(`Preinstalled skill source missing SKILL.md, skipping: ${sourceDir}`);
            continue;
        }

        const targetDir = join(targetRoot, spec.slug);
        const targetManifest = join(targetDir, 'SKILL.md');
        const markerPath = join(targetDir, PREINSTALLED_MARKER_NAME);
        const desiredVersion = lockVersions.get(spec.slug)
            || (spec.version || 'unknown').trim()
            || 'unknown';
        const marker = await tryReadMarker(markerPath);

        if (existsSync(targetManifest)) {
            if (!marker) {
                await ensureBundledSkillMarker(targetDir, spec.slug, desiredVersion, {
                    origin: spec.source,
                    url: spec.url,
                });
                logger.info(`Backfilled bundled marker for preinstalled skill: ${spec.slug}`);
                continue;
            }
            if (marker.version === desiredVersion) {
                continue;
            }
            logger.info(`Skipping preinstalled skill update for ${spec.slug} (local marker version=${marker.version}, desired=${desiredVersion})`);
            continue;
        }

        try {
            await mkdir(targetDir, { recursive: true });
            await cpAsyncSafe(sourceDir, targetDir);
            await writeBundledSkillMarker(targetDir, spec.slug, desiredVersion, {
                origin: spec.source,
                url: spec.url,
            });
            if (spec.autoEnable) {
                toEnable.push(spec.slug);
            }
            logger.info(`Installed preinstalled skill: ${spec.slug} -> ${targetDir}`);
        } catch (error) {
            logger.warn(`Failed to install preinstalled skill ${spec.slug}:`, error);
        }
    }

    if (toEnable.length > 0) {
        try {
            await setSkillsEnabled(toEnable, true);
        } catch (error) {
            logger.warn('Failed to auto-enable preinstalled skills:', error);
        }
    }
}

function normalizeBootstrapSkillKey(value?: string): string {
    return (value || '').trim().toLowerCase();
}

function isSkillKeyInAllowlist(
    skillKey: string,
    allowlistedKeys: Iterable<string>,
    aliasToId: Map<string, string>,
): boolean {
    const canonical = aliasToId.get(normalizeBootstrapSkillKey(skillKey))
        || normalizeBootstrapSkillKey(skillKey);
    for (const key of allowlistedKeys) {
        const candidate = aliasToId.get(normalizeBootstrapSkillKey(key))
            || normalizeBootstrapSkillKey(key);
        if (candidate === canonical) {
            return true;
        }
    }
    return false;
}

type AgentsAllowlistConfig = {
    defaults?: { skills?: unknown };
    list?: Array<Record<string, unknown> & { skills?: unknown }>;
};

function collectConfiguredSkillAllowlistKeys(config: OpenClawConfig): string[] {
    const keys: string[] = [];
    const agents = (config.agents && typeof config.agents === 'object'
        ? config.agents
        : {}) as AgentsAllowlistConfig;
    const defaults = agents.defaults;
    if (defaults && typeof defaults === 'object' && Array.isArray(defaults.skills)) {
        keys.push(...defaults.skills.filter((skill): skill is string => typeof skill === 'string'));
    }
    const list = agents.list;
    if (Array.isArray(list)) {
        for (const agent of list) {
            if (!agent || typeof agent !== 'object' || !Array.isArray(agent.skills)) {
                continue;
            }
            keys.push(...agent.skills.filter((skill): skill is string => typeof skill === 'string'));
        }
    }
    return keys;
}

/** Preinstall bootstrap disable must not strip user-configured global/per-agent allowlists. */
export function filterPreinstallSlugsForBootstrapDisable(
    slugs: string[],
    allowlistedKeys: string[],
    aliasToId: Map<string, string>,
): string[] {
    return slugs
        .filter((slug) => !slug.startsWith('lark-'))
        .filter((slug) => !isSkillKeyInAllowlist(slug, allowlistedKeys, aliasToId));
}

/** Whether the user (or migration) has already established the allowlist-based skills model. */
export function hasEstablishedSkillsAllowlist(config: OpenClawConfig): boolean {
    const agents = (config.agents && typeof config.agents === 'object'
        ? config.agents
        : {}) as AgentsAllowlistConfig;
    const defaults = agents.defaults;
    if (defaults && typeof defaults === 'object' && Array.isArray(defaults.skills)) {
        return true;
    }
    const list = agents.list;
    if (!Array.isArray(list)) {
        return false;
    }
    return list.some(
        (agent) => agent && typeof agent === 'object'
            && Object.prototype.hasOwnProperty.call(agent, 'skills'),
    );
}

/** Seed bundled lark skills into global defaults on first bootstrap only. */
export async function ensureLarkSkillsInGlobalDefaults(larkSlugs: string[]): Promise<void> {
    const normalized = [...new Set(
        larkSlugs.map((slug) => slug.trim().toLowerCase()).filter(Boolean),
    )];
    if (normalized.length === 0) {
        return;
    }

    const config = await readConfig();
    if (hasEstablishedSkillsAllowlist(config)) {
        return;
    }

    const { setDefaultAgentSkills } = await import('./global-agent-skills');
    await setDefaultAgentSkills(normalized);
}

/**
 * Disable all pre-installed built-in skills in openclaw.json except lark-* skills,
 * and ensure lark-* skills are enabled. Used at app startup.
 */
export async function disableAllBuiltinSkillsExceptLark(): Promise<void> {
    const [skills, config] = await Promise.all([
        readPreinstalledManifest(),
        readConfig(),
    ]);
    const { listLocalSkills } = await import('../services/skills/local-skill-service');
    const { buildSkillAliasToCanonicalIdMap } = await import('./skill-entries-sync');
    const { extractAgentWorkspacesFromEntries } = await import('./agent-workspaces');
    const agents = (config.agents && typeof config.agents === 'object'
        ? config.agents
        : {}) as AgentsAllowlistConfig;
    const agentEntries = Array.isArray(agents.list) ? agents.list : [];
    const localSkills = await listLocalSkills({
        agentWorkspaces: extractAgentWorkspacesFromEntries(agentEntries),
    });
    const aliasToId = buildSkillAliasToCanonicalIdMap(localSkills);
    const slugsToDisable = filterPreinstallSlugsForBootstrapDisable(
        skills.map((spec) => spec.slug).filter(Boolean),
        collectConfiguredSkillAllowlistKeys(config),
        aliasToId,
    );
    if (slugsToDisable.length > 0) {
        await setSkillsEnabled(slugsToDisable, false);
    }
    
    // Enable all bundled lark skills
    const bundledDir = join(getResourcesDir(), 'skills-bundled');
    if (existsSync(bundledDir)) {
        const { readdir } = await import('fs/promises');
        try {
            const entries = await readdir(bundledDir, { withFileTypes: true });
            const larkSlugs = entries
                .filter(e => e.isDirectory() && e.name.startsWith('lark-'))
                .map(e => e.name);
            if (larkSlugs.length > 0) {
                await ensureLarkSkillsInGlobalDefaults(larkSlugs);
            }
        } catch (e) {
            logger.warn('Failed to read bundled skills directory:', e);
        }
    }
}

/**
 * Deploy the bundled lark skills from resources/skills-bundled/
 * to ~/.openclaw/skills/. Idempotent; overwrites with bundled content when present.
 */
export async function ensureBundledLarkCliInstalled(): Promise<void> {
    const bundledDir = join(getResourcesDir(), 'skills-bundled');
    if (!existsSync(bundledDir)) {
        logger.info('Bundled skills directory not found, skipping install:', bundledDir);
        return;
    }
    
    const targetRoot = join(homedir(), '.openclaw', 'skills');
    await mkdir(targetRoot, { recursive: true });
    
    const { readdir } = await import('fs/promises');
    try {
        const entries = await readdir(bundledDir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const sourceDir = join(bundledDir, entry.name);
                const sourceManifest = join(sourceDir, 'SKILL.md');
                if (!existsSync(sourceManifest)) {
                    continue;
                }
                
                const targetDir = join(targetRoot, entry.name);
                await cp(sourceDir, targetDir, { recursive: true, force: true });
                await ensureBundledSkillMarker(targetDir, entry.name);
                logger.info(`Installed bundled skill: ${entry.name} ->`, targetDir);
            }
        }
    } catch (error) {
        logger.warn('Failed to install bundled skills:', error);
    }
}
