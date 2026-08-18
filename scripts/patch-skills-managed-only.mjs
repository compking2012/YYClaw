#!/usr/bin/env node
/**
 * Patch OpenClaw so skill discovery can be hard-restricted to the "managed"
 * skill sources — ~/.openclaw/skills plus the plugin-contributed skills under
 * ~/.openclaw/plugin-skills — and nothing else.
 *
 * OpenClaw's main workspace skill loader (src/skills/loading/workspace.ts,
 * compiled into dist/workspace-*.js) unconditionally merges skills from many
 * roots — config extraDirs + plugin skills (both labelled "openclaw-extra"),
 * bundled, managed (~/.openclaw/skills), personal (~/.agents/skills), project
 * (<ws>/.agents/skills) and workspace (<ws>/skills). Later roots OVERRIDE
 * earlier ones by skill name, and there is no config to disable individual
 * roots.
 *
 * This applies two coordinated edits, both keyed to CLAWX_SKILLS_MANAGED_ONLY:
 *  1. Split the mixed "extraSkills" list into config-driven `configExtraSkills`
 *     (from skills.load.extraDirs) and `pluginContribSkills` (the plugin skills
 *     under ~/.openclaw/plugin-skills and plugin-contributed dirs), so they can
 *     be gated independently.
 *  2. Gate the final merge: when the env var is truthy, merge only
 *     `pluginContribSkills` + `managedSkills`; otherwise behave exactly like
 *     upstream. Managed still wins over plugin skills on name collision.
 *
 * When the env var is unset the merged set is byte-for-byte identical to
 * upstream. The two-stage post-discovery filtering (skills.entries[].enabled +
 * per-agent agents.list[].skills allowlist) is untouched and keeps working on
 * top of the restricted set.
 *
 * Runs at postinstall to patch node_modules for dev mode. Production builds are
 * separately patched via patchSkillsManagedOnly() called from
 * scripts/bundle-openclaw.mjs. Mirrors scripts/patch-browser-hint.mjs.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// --- Patch 1: split the mixed extraSkills list -----------------------------
// Anchor: OpenClaw 2026.7.x workspace loader uses a local `resolved` binding
// before loadSkills (see node_modules/openclaw/dist/workspace-*.js).
const EXTRA_ANCHOR = [
  '\tconst extraSkills = [...mergedExtraDirs.flatMap((dir) => {',
  '\t\tconst resolved = resolveUserPath(dir);',
  '\t\treturn loadSkills({',
  '\t\t\tdir: resolved,',
  '\t\t\tsource: "openclaw-extra"',
  '\t\t});',
  '\t}), ...loadGeneratedPluginSkillRecords({',
  '\t\tpluginSkillsDir,',
  '\t\tpluginSkillDirs,',
  '\t\tsource: "openclaw-extra",',
  '\t\tlimits',
  '\t})];',
].join('\n');

// Marker present after patch 1; used for idempotency detection.
const EXTRA_MARKER = 'pluginContribSkills';

const EXTRA_REPLACEMENT = [
  '\tconst pluginContribSkills = [...pluginSkillDirs.flatMap((dir) => {',
  '\t\tconst resolved = resolveUserPath(dir);',
  '\t\treturn loadSkills({',
  '\t\t\tdir: resolved,',
  '\t\t\tsource: "openclaw-extra"',
  '\t\t});',
  '\t}), ...loadGeneratedPluginSkillRecords({',
  '\t\tpluginSkillsDir,',
  '\t\tpluginSkillDirs,',
  '\t\tsource: "openclaw-extra",',
  '\t\tlimits',
  '\t})];',
  '\tconst configExtraSkills = extraDirs.flatMap((dir) => {',
  '\t\tconst resolved = resolveUserPath(dir);',
  '\t\treturn loadSkills({',
  '\t\t\tdir: resolved,',
  '\t\t\tsource: "openclaw-extra"',
  '\t\t});',
  '\t});',
  '\tconst extraSkills = [...configExtraSkills, ...pluginContribSkills];',
].join('\n');

// --- Patch 2: gate the six merge loops -------------------------------------
// Anchor: upstream routes merges through mergeRecord() (archived-skill filter).
const MERGE_ANCHOR = [
  '\tfor (const record of extraSkills) mergeRecord(record);',
  '\tfor (const record of bundledSkills) mergeRecord(record);',
  '\tfor (const record of managedSkills) mergeRecord(record);',
  '\tfor (const record of personalAgentsSkills) mergeRecord(record);',
  '\tfor (const record of projectAgentsSkills) mergeRecord(record);',
  '\tfor (const record of workspaceSkills) mergeRecord(record);',
].join('\n');

// Marker present after patch 2.
const MERGE_MARKER = '__clawxManagedOnlyV2';
const MERGE_V1_MARKER = '__clawxManagedOnly';

const MERGE_V1_REPLACEMENT = [
  `\tconst ${MERGE_V1_MARKER} = process.env.CLAWX_SKILLS_MANAGED_ONLY === "1" || process.env.CLAWX_SKILLS_MANAGED_ONLY === "true";`,
  `\tif (${MERGE_V1_MARKER}) { for (const record of pluginContribSkills) mergeRecord(record); }`,
  `\telse { for (const record of extraSkills) mergeRecord(record); for (const record of bundledSkills) mergeRecord(record); }`,
  '\tfor (const record of managedSkills) mergeRecord(record);',
  `\tif (!${MERGE_V1_MARKER}) { for (const record of personalAgentsSkills) mergeRecord(record); for (const record of projectAgentsSkills) mergeRecord(record); for (const record of workspaceSkills) mergeRecord(record); }`,
].join('\n');

const MERGE_REPLACEMENT = [
  `\tconst ${MERGE_MARKER} = process.env.CLAWX_SKILLS_MANAGED_ONLY === "1" || process.env.CLAWX_SKILLS_MANAGED_ONLY === "true";`,
  // P2 bundled plus P3/P4 plugin-contributed skills are fallbacks.
  // P1 managed merges last and wins on name collision.
  `\tif (${MERGE_MARKER}) {`,
  '\t\tfor (const record of pluginContribSkills) mergeRecord(record);',
  '\t\tfor (const record of bundledSkills) if (record.skill.name === "skill-creator") mergeRecord(record);',
  `\t} else {`,
  '\t\tfor (const record of extraSkills) mergeRecord(record);',
  '\t\tfor (const record of bundledSkills) mergeRecord(record);',
  '\t}',
  '\tfor (const record of managedSkills) mergeRecord(record);',
  `\tif (!${MERGE_MARKER}) { for (const record of personalAgentsSkills) mergeRecord(record); for (const record of projectAgentsSkills) mergeRecord(record); for (const record of workspaceSkills) mergeRecord(record); }`,
].join('\n');

const PATCHES = [
  { label: 'extra-split', marker: EXTRA_MARKER, anchor: EXTRA_ANCHOR, replacement: EXTRA_REPLACEMENT },
  { label: 'merge-gate', marker: MERGE_MARKER, anchor: MERGE_ANCHOR, replacement: MERGE_REPLACEMENT },
];

/**
 * Apply the managed-only skill discovery patches to every dist/*.js under
 * `distDir`. Idempotent per patch (skips a patch whose marker is already
 * present). The two patches target the same workspace loader chunk.
 *
 * @param {string} distDir absolute path to an openclaw `dist` directory
 * @param {{ strict?: boolean, log?: (msg: string) => void }} [options]
 *   strict: throw if any patch's anchor is neither found nor already applied
 *   (use for production builds so an upstream change can't silently disable the
 *   guard).
 * @returns {{ filesPatched: number, patchesApplied: number, alreadyPatched: number, missing: string[] }}
 */
export function patchSkillsManagedOnly(distDir, options = {}) {
  const { strict = false, log = () => {} } = options;

  let files;
  try {
    files = readdirSync(distDir);
  } catch {
    if (strict) {
      throw new Error(`[patch-skills-managed-only] dist directory not found: ${distDir}`);
    }
    return { filesPatched: 0, patchesApplied: 0, alreadyPatched: 0, missing: PATCHES.map((patch) => patch.label) };
  }

  const seen = new Map(PATCHES.map((patch) => [patch.label, false]));
  let filesPatched = 0;
  let patchesApplied = 0;
  let alreadyPatched = 0;

  for (const file of files) {
    if (!file.endsWith('.js')) continue;
    const filePath = join(distDir, file);
    let content;
    try {
      content = readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    let next = content;
    let changedHere = false;
    for (const patch of PATCHES) {
      if (next.includes(patch.marker)) {
        seen.set(patch.label, true);
        alreadyPatched += 1;
        continue;
      }
      if (
        patch.label === 'merge-gate'
        && next.includes(MERGE_V1_MARKER)
        && next.includes(MERGE_V1_REPLACEMENT)
      ) {
        next = next.replace(MERGE_V1_REPLACEMENT, MERGE_REPLACEMENT);
        seen.set(patch.label, true);
        patchesApplied += 1;
        changedHere = true;
        log(`[patch-skills-managed-only] Upgraded ${patch.label} in ${file}`);
        continue;
      }
      if (!next.includes(patch.anchor)) continue;
      next = next.replace(patch.anchor, patch.replacement);
      seen.set(patch.label, true);
      patchesApplied += 1;
      changedHere = true;
      log(`[patch-skills-managed-only] Applied ${patch.label} in ${file}`);
    }

    if (changedHere) {
      writeFileSync(filePath, next, 'utf8');
      filesPatched += 1;
    }
  }

  const missing = PATCHES.filter((patch) => !seen.get(patch.label)).map((patch) => patch.label);
  if (missing.length > 0 && strict) {
    throw new Error(
      `[patch-skills-managed-only] anchor(s) not found: ${missing.join(', ')}. ` +
        'OpenClaw skill loader likely changed shape — update the anchors before shipping.',
    );
  }

  return { filesPatched, patchesApplied, alreadyPatched, missing };
}

// CLI entry: patch node_modules/openclaw/dist for dev (non-strict, quiet skip).
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const nodeModulesDir = join(process.cwd(), 'node_modules');
  const directDistDir = join(nodeModulesDir, 'openclaw', 'dist');
  let distDir = directDistDir;
  try {
    if (readdirSync(directDistDir).length === 0) throw new Error('missing direct OpenClaw dist');
  } catch {
    try {
      const pnpmDir = join(nodeModulesDir, '.pnpm');
      const candidate = readdirSync(pnpmDir)
        .filter((entry) => entry.startsWith('openclaw@'))
        .map((entry) => join(pnpmDir, entry, 'node_modules', 'openclaw', 'dist'))
        .find((candidateDir) => {
          try {
            return readdirSync(candidateDir).length > 0;
          } catch {
            return false;
          }
        });
      if (candidate) distDir = candidate;
    } catch {
      // patchSkillsManagedOnly reports a quiet no-op in non-strict dev mode.
    }
  }
  const result = patchSkillsManagedOnly(distDir, {
    strict: false,
    log: (msg) => console.log(msg),
  });
  if (result.missing.length > 0) {
    console.error(`[patch-skills-managed-only] Missing patch anchor(s): ${result.missing.join(', ')}.`);
    process.exitCode = 1;
  } else if (result.patchesApplied === 0 && result.alreadyPatched > 0) {
    console.log('[patch-skills-managed-only] Already patched, skipping.');
  }
}
