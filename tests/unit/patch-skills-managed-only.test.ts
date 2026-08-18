// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { patchSkillsManagedOnly } from '../../scripts/patch-skills-managed-only.mjs';

/** Mirrors OpenClaw 2026.7.x workspace skill loader shape (mergeRecord + resolved). */
const upstreamWorkspaceLoader = [
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
  '\tconst managedSkills = loadSkills({ dir: managedSkillsDir });',
  '\tconst personalAgentsSkills = loadSkills({ dir: personalAgentsSkillsDir });',
  '\tconst projectAgentsSkills = loadSkills({ dir: projectAgentsSkillsDir });',
  '\tconst workspaceSkills = loadSkills({ dir: workspaceSkillsDir });',
  '\tconst merged = new Map();',
  '\tconst mergeRecord = (record) => { merged.set(record.skill.name, record); };',
  '\tfor (const record of extraSkills) mergeRecord(record);',
  '\tfor (const record of bundledSkills) mergeRecord(record);',
  '\tfor (const record of managedSkills) mergeRecord(record);',
  '\tfor (const record of personalAgentsSkills) mergeRecord(record);',
  '\tfor (const record of projectAgentsSkills) mergeRecord(record);',
  '\tfor (const record of workspaceSkills) mergeRecord(record);',
].join('\n');

describe('patch-skills-managed-only', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('patches current mergeRecord loader shape and excludes P5–P8', () => {
    const distDir = mkdtempSync(join(tmpdir(), 'clawx-managed-only-dist-'));
    dirs.push(distDir);
    const filePath = join(distDir, 'workspace-test.js');
    writeFileSync(filePath, upstreamWorkspaceLoader, 'utf8');

    const result = patchSkillsManagedOnly(distDir, { strict: true });
    const patched = readFileSync(filePath, 'utf8');

    expect(result.patchesApplied).toBe(2);
    expect(patched).toContain('__clawxManagedOnlyV2');
    expect(patched).toContain('pluginContribSkills');
    expect(patched).toContain('for (const record of bundledSkills) mergeRecord(record);');
    expect(patched).toContain('if (!__clawxManagedOnlyV2) { for (const record of personalAgentsSkills)');
    expect(patched).toContain('if (!__clawxManagedOnlyV2) {');
    expect(patched).toContain('record.skill.name === "skill-creator"');
  });

  it('upgrades a partially patched v1 runtime to the P2 allowlisted v2 merge', () => {
    const distDir = mkdtempSync(join(tmpdir(), 'clawx-managed-only-v1-dist-'));
    dirs.push(distDir);
    const filePath = join(distDir, 'workspace-test.js');
    const v1 = upstreamWorkspaceLoader
      .replace(
        [
          '\tfor (const record of extraSkills) mergeRecord(record);',
          '\tfor (const record of bundledSkills) mergeRecord(record);',
          '\tfor (const record of managedSkills) mergeRecord(record);',
          '\tfor (const record of personalAgentsSkills) mergeRecord(record);',
          '\tfor (const record of projectAgentsSkills) mergeRecord(record);',
          '\tfor (const record of workspaceSkills) mergeRecord(record);',
        ].join('\n'),
        [
          '\tconst __clawxManagedOnly = process.env.CLAWX_SKILLS_MANAGED_ONLY === "1" || process.env.CLAWX_SKILLS_MANAGED_ONLY === "true";',
          '\tif (__clawxManagedOnly) { for (const record of pluginContribSkills) mergeRecord(record); }',
          '\telse { for (const record of extraSkills) mergeRecord(record); for (const record of bundledSkills) mergeRecord(record); }',
          '\tfor (const record of managedSkills) mergeRecord(record);',
          '\tif (!__clawxManagedOnly) { for (const record of personalAgentsSkills) mergeRecord(record); for (const record of projectAgentsSkills) mergeRecord(record); for (const record of workspaceSkills) mergeRecord(record); }',
        ].join('\n'),
      )
      .replace(
        [
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
        ].join('\n'),
        [
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
        ].join('\n'),
      );
    writeFileSync(filePath, v1, 'utf8');

    expect(patchSkillsManagedOnly(distDir, { strict: true }).patchesApplied).toBe(1);
    expect(readFileSync(filePath, 'utf8')).toContain('__clawxManagedOnlyV2');
  });
});
