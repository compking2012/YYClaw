import { describe, expect, it } from 'vitest';
import {
  buildCoordinatorSummaryFromTask,
  buildRoleNotebookSection,
  buildSmartCoordinatorSummaryFromRoom,
  buildSmartRoleNotebookSection,
  emptyProjectNotebook,
  formatProjectNotebookPromptBlock,
  projectNotebookFileName,
  sanitizeNotebookDirName,
} from '../../src/lib/office-project-notebook';
import type { OfficeTempProject, RoomMessage, WorkflowNode } from '../../electron/services/office/types';

const task: OfficeTempProject = {
  id: 't1',
  title: '五子棋',
  origin: 'standalone',
  agentIds: ['agent-dev', 'agent-pm'],
  coordinatorAgentId: 'agent-pm',
  lifecycle: 'active',
  status: 'running',
  featureDescription: 'feat',
  description: 'desc',
  executionMode: 'workflow',
  nodeRuns: [{ nodeId: 'n1', agentId: 'agent-dev', status: 'running' }],
  createdAt: 1,
  updatedAt: 2,
};

const nodes: WorkflowNode[] = [
  { id: 'n1', title: '开发', agentIds: ['agent-dev'] },
  { id: 'n2', title: '测试', agentIds: ['agent-qa'] },
];

const roles = [
  { agentId: 'agent-dev', displayName: '开发' },
  { agentId: 'agent-pm', displayName: 'PM' },
];

function room(partial: Partial<RoomMessage> & Pick<RoomMessage, 'id'>): RoomMessage {
  return {
    groupId: 'g1',
    projectId: 't1',
    from: 'agent',
    mentions: [],
    timestamp: Date.now(),
    content: '进展',
    ...partial,
  };
}

describe('office-project-notebook', () => {
  it('sanitizes notebook dir and file names', () => {
    expect(sanitizeNotebookDirName('  五子棋/游戏  ')).toBe('五子棋_游戏');
    expect(projectNotebookFileName('t1')).toContain('t1');
  });

  it('builds coordinator summary from workflow nodes', () => {
    const summary = buildCoordinatorSummaryFromTask({
      task,
      workflowNodes: nodes,
      roomMessages: [
        room({ id: 'm1', fromAgentId: 'agent-dev', nodeId: 'n1', timestamp: 100 }),
      ],
      roles,
    });
    expect(summary).toContain('开发');
    expect(summary).toContain('任务1');
  });

  it('builds role notebook section for assigned steps', () => {
    const section = buildRoleNotebookSection({
      roleName: '开发',
      task,
      workflowNodes: nodes,
      roomMessages: [],
      roleId: 'agent-dev',
      latestReplySnippet: '模块已完成',
    });
    expect(section).toContain('开发');
    expect(section).toContain('最近回复');
  });

  it('formats notebook prompt block for coordinator and member', () => {
    const notebook = {
      ...emptyProjectNotebook('t1', '五子棋'),
      coordinatorSummary: '整体进展正常',
      roles: { 'agent-dev': '开发步骤进行中' },
    };
    const coord = formatProjectNotebookPromptBlock(notebook, {
      isCoordinator: true,
      viewerRoleId: 'agent-pm',
      roleStatusLines: { 'agent-dev': '开发中' },
    });
    const member = formatProjectNotebookPromptBlock(notebook, {
      isCoordinator: false,
      viewerRoleId: 'agent-dev',
    });
    expect(coord).toContain('整体进展正常');
    expect(member).toContain('本角色工作状态');
  });

  it('builds smart coordinator and role summaries from room', () => {
    const messages = [
      room({ id: 'm1', fromAgentId: 'agent-dev', content: '开发完成第一版', timestamp: 2 }),
      room({ id: 'm2', fromAgentId: 'agent-pm', content: '请继续推进', timestamp: 1 }),
    ];
    const coord = buildSmartCoordinatorSummaryFromRoom({
      task,
      roomMessages: messages,
      roles,
    });
    const role = buildSmartRoleNotebookSection({
      roleName: '开发',
      task,
      roomMessages: messages,
      roleId: 'agent-dev',
      latestReplySnippet: '已提交',
    });
    expect(coord).toContain('开发');
    expect(role).toContain('开发');
  });
});
