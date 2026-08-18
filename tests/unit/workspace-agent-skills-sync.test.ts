import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { AgentSummary } from '@/types/agent';
import {
  computePerAgentWorkspaceSkillPatches,
  findWorkspaceSkillDirBySlug,
  getAgentWorkspaceSkillScanRoots,
  inferAgentIdForSkillInstall,
  isPathUnderAnyAgentWorkspaceSkills,
  resolveAgentIdFromWorkspaceSkillsPath,
  verifyWorkspaceSkillInstallConsistency,
} from '@electron/utils/workspace-agent-skills-sync';
import { extractAgentWorkspacesForSkillScan } from '@electron/utils/agent-workspaces';
import { WORKSPACE_DISK_SKILL_RECONCILE_ENABLED } from '@electron/services/skills/skill-scan-policy';

function agent(partial: Pick<AgentSummary, 'id' | 'workspace' | 'skills'>): AgentSummary {
  return {
    id: partial.id,
    name: partial.id,
    workspace: partial.workspace,
    skills: partial.skills || [],
    isDefault: partial.id === 'main',
    modelDisplay: '',
    modelRef: null,
    overrideModelRef: null,
    overrideImageModelRef: null,
    overrideImageGenerationModelRef: null,
    overrideVideoGenerationModelRef: null,
    overrideMusicGenerationModelRef: null,
    inheritedModel: false,
    agentDir: `/agents/${partial.id}`,
    mainSessionKey: partial.id,
    channelTypes: [],
  };
}

describe('workspace-agent-skills-sync', () => {
  const entries = [
    agent({ id: 'main', workspace: '/tmp/workspace-main', skills: [] }),
    agent({ id: 'writer', workspace: '/tmp/workspace-writer', skills: ['pdf'] }),
  ];

  it('keeps workspace-disk reconcile disabled under the P1–P4 scan policy', () => {
    expect(WORKSPACE_DISK_SKILL_RECONCILE_ENABLED).toBe(false);
  });

  it('resolves agent from workspace skills path', () => {
    expect(resolveAgentIdFromWorkspaceSkillsPath('/tmp/workspace-writer/skills/demo', entries)).toBe('writer');
    expect(resolveAgentIdFromWorkspaceSkillsPath('/tmp/workspace-writer/skills', entries)).toBe('writer');
    expect(resolveAgentIdFromWorkspaceSkillsPath('/tmp/.openclaw/skills/demo', entries)).toBeNull();
  });

  it('infers agent with baseDir priority over session agent', () => {
    expect(inferAgentIdForSkillInstall(entries, {
      baseDir: '/tmp/workspace-main/skills/demo',
      sessionAgentId: 'writer',
    })).toBe('main');

    expect(inferAgentIdForSkillInstall(entries, {
      sessionAgentId: 'writer',
    })).toBe('writer');
  });

  it('verifies install consistency only when path matches inferred agent', () => {
    expect(verifyWorkspaceSkillInstallConsistency(
      '/tmp/workspace-writer/skills/demo',
      'writer',
      entries,
    )).toBe(true);

    expect(verifyWorkspaceSkillInstallConsistency(
      '/tmp/workspace-main/skills/demo',
      'writer',
      entries,
    )).toBe(false);
  });

  it('does not forward-fill or prune allowlists from workspace skill dirs (P5 disabled)', () => {
    const cleanEntries = [
      agent({ id: 'main', workspace: '/tmp/workspace-main', skills: [] }),
      agent({ id: 'writer', workspace: '/tmp/workspace-writer', skills: [] }),
    ];
    const diskByAgent = new Map([
      ['writer', new Set(['docx'])],
    ]);
    const forwardFill = computePerAgentWorkspaceSkillPatches(
      cleanEntries,
      diskByAgent,
      [],
      new Set(),
      new Set(),
    );
    expect(forwardFill).toEqual([]);

    const writerWithDocx = [
      agent({ id: 'main', workspace: '/tmp/workspace-main', skills: [] }),
      agent({ id: 'writer', workspace: '/tmp/workspace-writer', skills: ['docx'] }),
    ];
    const pruneMissing = computePerAgentWorkspaceSkillPatches(
      writerWithDocx,
      new Map([
        ['writer', new Set<string>()],
        ['main', new Set<string>()],
      ]),
      [],
      new Set(),
      new Set(),
    );
    expect(pruneMissing).toEqual([]);
  });

  it('keeps helper semantics for path/agent resolution without applying disk patches', () => {
    const diskByAgent = new Map([
      ['writer', new Set<string>()],
      ['main', new Set<string>()],
    ]);
    const writerWithPdf = [
      agent({ id: 'main', workspace: '/tmp/workspace-main', skills: [] }),
      agent({ id: 'writer', workspace: '/tmp/workspace-writer', skills: ['pdf'] }),
    ];
    const patches = computePerAgentWorkspaceSkillPatches(
      writerWithPdf,
      diskByAgent,
      [],
      new Set(['pdf']),
      new Set(),
    );

    expect(patches).toEqual([]);
  });

  it('legacy workspace-disk patch algorithm remains inert while P5 reconcile is disabled', () => {
    const diskByAgent = new Map([
      ['writer', new Set<string>()],
      ['main', new Set<string>()],
    ]);
    const writerWithDocx = [
      agent({ id: 'main', workspace: '/tmp/workspace-main', skills: [] }),
      agent({ id: 'writer', workspace: '/tmp/workspace-writer', skills: ['docx'] }),
    ];
    const patches = computePerAgentWorkspaceSkillPatches(
      writerWithDocx,
      diskByAgent,
      [],
      new Set(),
      new Set(),
    );

    // Previously removed workspace-only skills; with P5 disabled this must be a no-op.
    expect(patches).toEqual([]);
  });

  it('does not remove shared manual assignments when only one agent lost workspace copy', () => {
    const diskByAgent = new Map([
      ['writer', new Set<string>()],
      ['main', new Set<string>()],
    ]);
    const sharedManual = [
      agent({ id: 'main', workspace: '/tmp/workspace-main', skills: ['docx'] }),
      agent({ id: 'writer', workspace: '/tmp/workspace-writer', skills: ['docx'] }),
    ];
    const patches = computePerAgentWorkspaceSkillPatches(
      sharedManual,
      diskByAgent,
      [],
      new Set(),
      new Set(),
    );

    expect(patches).toEqual([]);
  });

  it('does not remove skills protected by agents.defaults.skills', () => {
    const diskByAgent = new Map([
      ['writer', new Set<string>()],
    ]);
    const writerWithDocx = [
      agent({ id: 'writer', workspace: '/tmp/workspace-writer', skills: ['docx'] }),
    ];
    const patches = computePerAgentWorkspaceSkillPatches(
      writerWithDocx,
      diskByAgent,
      [],
      new Set(),
      new Set(['docx']),
    );

    expect(patches).toEqual([]);
  });

  it('treats only workspace skills roots as valid install targets', () => {
    const agents = [
      agent({ id: 'writer', workspace: '/tmp/workspace-writer', skills: [] }),
    ];
    expect(isPathUnderAnyAgentWorkspaceSkills('/tmp/workspace-writer/skills/demo', agents)).toBe(true);
    expect(isPathUnderAnyAgentWorkspaceSkills('/tmp/.openclaw/skills/demo', agents)).toBe(false);
    expect(isPathUnderAnyAgentWorkspaceSkills('/tmp/workspace-writer/.agents/skills/demo', agents)).toBe(false);
  });

  it('includes legacy workspace-main scan root for default main workspace', () => {
    const mainWorkspace = join(homedir(), '.openclaw', 'workspace');
    const legacySkillDir = join(homedir(), '.openclaw', 'workspace-main', 'skills', 'demo');
    const mainEntry = agent({ id: 'main', workspace: mainWorkspace, skills: [] });
    const roots = getAgentWorkspaceSkillScanRoots(mainEntry);
    expect(roots).toEqual([
      join(mainWorkspace, 'skills'),
      join(homedir(), '.openclaw', 'workspace-main', 'skills'),
    ]);
    expect(resolveAgentIdFromWorkspaceSkillsPath(legacySkillDir, [mainEntry])).toBe('main');
    expect(isPathUnderAnyAgentWorkspaceSkills(legacySkillDir, [mainEntry])).toBe(true);
  });

  it('finds slug under legacy workspace-main skills root for default main workspace', () => {
    const mainWorkspace = join(homedir(), '.openclaw', 'workspace');
    const legacySkillDir = join(homedir(), '.openclaw', 'workspace-main', 'skills', 'official-yyclaw-ppt');
    const mainEntry = agent({ id: 'main', workspace: mainWorkspace, skills: [] });
    const exists = (path: string) => path === legacySkillDir;

    expect(findWorkspaceSkillDirBySlug(mainEntry, 'official-yyclaw-ppt', exists)).toBe(legacySkillDir);
    expect(findWorkspaceSkillDirBySlug(mainEntry, 'missing-skill', exists)).toBeNull();
  });

  it('includes legacy main workspace in listLocalSkills scan roots', () => {
    const mainWorkspace = join(homedir(), '.openclaw', 'workspace');
    const workspaces = extractAgentWorkspacesForSkillScan([
      { id: 'main', workspace: mainWorkspace },
      { id: 'writer', workspace: join(homedir(), '.openclaw', 'workspace-writer') },
    ]);
    expect(workspaces).toHaveLength(3);
    expect(workspaces).toEqual(expect.arrayContaining([
      mainWorkspace,
      join(homedir(), '.openclaw', 'workspace-main'),
      join(homedir(), '.openclaw', 'workspace-writer'),
    ]));
  });
});
