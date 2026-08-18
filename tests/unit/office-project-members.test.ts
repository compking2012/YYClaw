import { describe, expect, it } from 'vitest';
import {
  agentMentionToken,
  projectMembersForProject,
  projectMembersFromIds,
  projectRoomParticipantIds,
  projectRoomParticipants,
  resolveProjectRoomParticipants,
} from '@/lib/office-project-members';

describe('office-project-members', () => {
  it('projectMembersFromIds uses lookup fallback to agentId', () => {
    const members = projectMembersFromIds(['a1', 'a2'], (id) =>
      id === 'a1' ? '  PM  ' : undefined,
    );
    expect(members).toEqual([
      { agentId: 'a1', displayName: 'PM' },
      { agentId: 'a2', displayName: 'a2' },
    ]);
  });

  it('projectMembersForProject and agentMentionToken', () => {
    const members = projectMembersForProject({ agentIds: ['dev'] }, () => '开发');
    expect(members[0]?.displayName).toBe('开发');
    expect(agentMentionToken({ agentId: 'dev', displayName: '开发' })).toBe('开发');
    expect(agentMentionToken({ agentId: 'dev', displayName: '  ' })).toBe('dev');
  });

  it('projectRoomParticipantIds scopes to project members + coordinator only', () => {
    expect(projectRoomParticipantIds(null)).toEqual([]);
    expect(
      projectRoomParticipantIds({
        agentIds: ['dev', 'qa', 'dev'],
        coordinatorAgentId: 'pm',
      }),
    ).toEqual(['dev', 'qa', 'pm']);
    expect(
      projectRoomParticipantIds({
        agentIds: ['pm', 'dev'],
        coordinatorAgentId: 'pm',
      }),
    ).toEqual(['pm', 'dev']);
  });

  it('projectRoomParticipants does not include agents from other projects', () => {
    const participants = projectRoomParticipants(
      { agentIds: ['only-this'], coordinatorAgentId: 'coord' },
      (id) => (id === 'only-this' ? '仅本项目' : id === 'coord' ? '协调者' : '其他'),
    );
    expect(participants.map((p) => p.agentId)).toEqual(['only-this', 'coord']);
    expect(participants.map((p) => p.displayName)).toEqual(['仅本项目', '协调者']);
  });

  it('projectRoomParticipantIds skips blank ids and empty coordinator', () => {
    expect(
      projectRoomParticipantIds({
        agentIds: [' ', 'dev', ''],
        coordinatorAgentId: '  ',
      }),
    ).toEqual(['dev']);
  });

  it('projectRoomParticipantIds dedupes coordinator by normalizeAgentId casing', () => {
    // Edit-page pool canonicalizes by normalizeAgentId; room must not list PM and pm twice.
    expect(
      projectRoomParticipantIds({
        agentIds: ['PM', 'dev'],
        coordinatorAgentId: 'pm',
      }),
    ).toEqual(['PM', 'dev']);
  });

  it('projectRoomParticipantIds tolerates missing agentIds array', () => {
    expect(
      projectRoomParticipantIds({
        agentIds: undefined as unknown as string[],
        coordinatorAgentId: 'pm',
      }),
    ).toEqual(['pm']);
  });

  it('resolveProjectRoomParticipants falls back to project roster when inherited group is missing', () => {
    const participants = resolveProjectRoomParticipants(
      {
        agentIds: ['copied-dev', 'copied-qa'],
        coordinatorAgentId: 'copied-pm',
        origin: 'fixed_group',
        parentGroupId: 'deleted-group',
        inheritsGroupTemplate: true,
        executionMode: 'workflow',
        workflow: { mode: 'dag', nodes: [], edges: [] },
      },
      null,
      (id) => id,
    );
    expect(participants.map((p) => p.agentId)).toEqual([
      'copied-dev',
      'copied-qa',
      'copied-pm',
    ]);
  });

  it('resolveProjectRoomParticipants uses inherited fixed-group roster on edit page', () => {
    const participants = resolveProjectRoomParticipants(
      {
        agentIds: [],
        coordinatorAgentId: '',
        origin: 'fixed_group',
        parentGroupId: 'g1',
        inheritsGroupTemplate: true,
        executionMode: 'workflow',
        workflow: { mode: 'dag', nodes: [], edges: [] },
      },
      {
        agentIds: ['group-dev', 'group-qa'],
        coordinatorAgentId: 'group-pm',
      },
      (id) => id,
    );
    expect(participants.map((p) => p.agentId)).toEqual(['group-dev', 'group-qa', 'group-pm']);
  });

  it('resolveProjectRoomParticipants stays on project roster after inheritance break', () => {
    const participants = resolveProjectRoomParticipants(
      {
        agentIds: ['proj-dev'],
        coordinatorAgentId: 'proj-pm',
        origin: 'fixed_group',
        parentGroupId: 'g1',
        inheritsGroupTemplate: false,
        executionMode: 'workflow',
        workflow: {
          mode: 'dag',
          nodes: [{ id: 'n1', name: 'step', agentId: 'proj-dev' }],
          edges: [],
        },
      },
      {
        agentIds: ['group-dev', 'group-qa'],
        coordinatorAgentId: 'group-pm',
      },
      (id) => id,
    );
    expect(participants.map((p) => p.agentId)).toEqual(['proj-dev', 'proj-pm']);
  });
});
