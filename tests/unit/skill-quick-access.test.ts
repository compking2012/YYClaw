import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectQuickAccessSkills, filterEnabledQuickAccessSkills, type QuickAccessSkill } from '@electron/utils/skill-quick-access';

const testRoot = join(tmpdir(), 'clawx-tests', 'skill-quick-access');

function writeSkill(baseDir: string, skillName: string, content: string): void {
  const skillDir = join(baseDir, skillName);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), content, 'utf8');
}

describe('collectQuickAccessSkills', () => {
  beforeEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
    mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  it('scans only openclaw + bundled roots and ignores workspace/.agents', async () => {
    const workspaceDir = join(testRoot, 'workspace');
    const openClawDir = join(testRoot, 'openclaw');
    const personalAgentsDir = join(testRoot, 'personal-agents');

    writeSkill(
      join(workspaceDir, 'skill'),
      'create-skill',
      "---\ndescription: Workspace copy must not appear.\n---\n# Workspace Skill\n",
    );
    writeSkill(
      join(openClawDir, 'skills'),
      'create-skill',
      "---\ndescription: Managed OpenClaw skill.\n---\n# OpenClaw Skill\n",
    );
    writeSkill(
      join(personalAgentsDir, '.agents', 'skills'),
      'create-skill',
      "---\ndescription: Agents copy must not appear.\n---\n# Agents Skill\n",
    );
    writeSkill(
      join(openClawDir, 'skills'),
      'summarize',
      "---\ndescription: Summarize files and URLs.\n---\n# Summarize\n",
    );

    const skills = await collectQuickAccessSkills({
      agentsRoots: [join(personalAgentsDir, '.agents', 'skills')],
      legacyRoots: [],
      openClawRoots: [join(openClawDir, 'skills')],
      workspace: workspaceDir,
      openClawDir,
    });

    expect(skills.map((skill) => `${skill.source}:${skill.name}`).sort()).toEqual([
      'openclaw:create-skill',
      'openclaw:summarize',
    ]);
    expect(skills.find((skill) => skill.name === 'create-skill')).toMatchObject({
      source: 'openclaw',
      description: 'Managed OpenClaw skill.',
    });
  });

  it('prefers managed openclaw roots over bundled/legacy duplicates', async () => {
    const managedDir = join(testRoot, 'managed');
    const bundledDir = join(testRoot, 'bundled');

    writeSkill(
      managedDir,
      'shared-skill',
      "---\ndescription: Managed wins.\n---\n# Shared\n",
    );
    writeSkill(
      bundledDir,
      'shared-skill',
      "---\ndescription: Bundled fallback.\n---\n# Shared\n",
    );

    const skills = await collectQuickAccessSkills({
      openClawRoots: [managedDir],
      legacyRoots: [bundledDir],
      workspace: join(testRoot, 'workspace'),
      openClawDir: join(testRoot, 'openclaw'),
    });

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      name: 'shared-skill',
      source: 'openclaw',
      description: 'Managed wins.',
    });
  });

  it('loads bundled/extension legacy roots when openclaw roots are empty', async () => {
    const openClawDir = join(testRoot, 'openclaw');
    const extensionDir = join(testRoot, 'extensions');

    writeSkill(
      join(openClawDir, 'skills'),
      'apple-notes',
      "---\ndescription: Legacy OpenClaw built-in skill.\n---\n# Apple Notes\n",
    );
    writeSkill(
      join(extensionDir, 'wecom', 'skills'),
      'wecom-meeting-manage',
      "---\ndescription: Extension-provided skill.\n---\n# WeCom Meeting Manage\n",
    );

    const skills = await collectQuickAccessSkills({
      legacyRoots: [
        join(openClawDir, 'skills'),
        join(extensionDir, 'wecom', 'skills'),
      ],
      openClawRoots: [],
      workspace: join(testRoot, 'workspace'),
    });

    expect(skills.map((skill) => `${skill.source}:${skill.name}`)).toEqual([
      'legacy:apple-notes',
      'legacy:wecom-meeting-manage',
    ]);
  });

  it('filters out disabled skills from runtime/config state', () => {
    const skills: QuickAccessSkill[] = [
      {
        name: 'apple-notes',
        description: 'Legacy OpenClaw built-in skill.',
        source: 'legacy',
        sourceLabel: 'Bundled',
        manifestPath: '/tmp/openclaw/skills/apple-notes/SKILL.md',
        baseDir: '/tmp/openclaw/skills/apple-notes',
      },
      {
        name: 'wecom-meeting-manage',
        description: 'Extension skill.',
        source: 'legacy',
        sourceLabel: 'Bundled',
        manifestPath: '/tmp/extensions/wecom/skills/wecom-meeting-manage/SKILL.md',
        baseDir: '/tmp/extensions/wecom/skills/wecom-meeting-manage',
      },
      {
        name: 'managed-skill',
        description: 'Managed skill.',
        source: 'openclaw',
        sourceLabel: 'OpenClaw',
        manifestPath: '/tmp/.openclaw/skills/managed-skill/SKILL.md',
        baseDir: '/tmp/.openclaw/skills/managed-skill',
      },
    ];

    const filtered = filterEnabledQuickAccessSkills(
      skills,
      [
        { skillKey: 'apple-notes', disabled: false, baseDir: '/tmp/openclaw/skills/apple-notes' },
        { skillKey: 'wecom-meeting-manage', disabled: true, baseDir: '/tmp/extensions/wecom/skills/wecom-meeting-manage' },
      ],
      {
        'managed-skill': { enabled: true },
      },
    );

    expect(filtered.map((skill) => skill.name)).toEqual([
      'apple-notes',
      'managed-skill',
    ]);
  });
});
