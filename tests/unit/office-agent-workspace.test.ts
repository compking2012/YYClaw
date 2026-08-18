import { describe, expect, it } from 'vitest';
import {
  agentDefaultWorkspaceDirName,
  legacyRoleScopedWorkspaceDirName,
  officeProjectRootDisplayPath,
  roleWorkspaceDirName,
  sanitizeWorkspaceRoleDirSuffix,
} from '../../src/lib/office-agent-workspace';
import { projectDirSegment } from '../../src/lib/office-project-context';

describe('office-agent-workspace (1 agent = 1 role)', () => {
  const roles = [
    { agentId: 'pm', name: '产品' },
    { agentId: 'dev-only', name: '开发' },
  ];

  it('always uses workspace-<agentId> regardless of roster size', () => {
    expect(roleWorkspaceDirName(roles, { agentId: 'pm', name: '产品' })).toBe('workspace-pm');
    expect(roleWorkspaceDirName(roles, { agentId: 'dev-only', name: '开发' })).toBe(
      'workspace-dev-only',
    );
  });

  it('agentDefaultWorkspaceDirName matches roleWorkspaceDirName', () => {
    expect(agentDefaultWorkspaceDirName('shang-di')).toBe('workspace-shang-di');
    expect(roleWorkspaceDirName(roles, { agentId: 'shang-di', name: '上帝' })).toBe(
      'workspace-shang-di',
    );
  });

  it('officeProjectRootDisplayPath uses office project root', () => {
    const path = officeProjectRootDisplayPath(
      '/home/u/.openclaw',
      { agentId: 'pm', name: '产品' },
      roles,
      '需求',
      'task-pm',
      projectDirSegment,
      '/home/u',
    );
    expect(path).toBe('~/.openclaw/office/project/task-pm');
  });

  it('legacyRoleScopedWorkspaceDirName preserves old suffix for migration', () => {
    expect(legacyRoleScopedWorkspaceDirName('x', 'A/B')).toBe('workspace-x-A_B');
    expect(sanitizeWorkspaceRoleDirSuffix('A/B')).toBe('A_B');
  });
});
