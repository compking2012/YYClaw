/**
 * 办公模块覆盖率补充（第二批）：prompt 共享、run-heal、store、recovery、member-reply 分支。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  workflowPromptSection,
  workflowFewShotLsLine,
  workflowProjectRelativeLsLine,
  workflowProjectRelativeLsDirLine,
  workflowLsLineDisplayName,
  workflowProjectRelativeInputLsForTarget,
  workflowProjectRelativeInputLsForTargets,
  buildWorkflowAgentOutputFormatLines,
  buildWorkflowJsonSchemaLines,
  buildWorkflowMergedOutputSpecLines,
  formatWorkflowFeatureDescriptionForPrompt,
  extractProjectGoal,
  compactWorkflowTaskOverview,
  buildWorkflowTeamBriefBlock,
  extractWorkflowProjectRootFromLines,
  normalizeWorkflowProjectDirectoryLine,
  buildWorkflowProjectDirectoryBlock,
  buildWorkflowTaskDescriptionBlock,
  buildWorkflowAgentTaskBriefBlock,
  buildWorkflowFewShotWrapper,
  workflowProjectDirectoryDeclaresRoot,
  extractWorkflowFewShotExample,
} from '@/lib/office-workflow-task-prompt-shared';
import {
  clearWorkflowRoomJsonHealTracking,
  combinedStructuredHealSummary,
  healWorkflowRunningNodesFromRoom,
  markWorkflowRoomJsonHealValidated,
  multiRoleNodeReadyForStructuredHeal,
  nodeHasExplicitRoomDeliver,
  nodeHasRoomExecutionFinishedMarker,
  unstuckStaleRunningNodeRuns,
  workflowStallIdleRoundLimit,
} from '@/lib/office-workflow-run-heal';
import {
  inferStepTitle,
  matchRolesInText,
  splitDescriptionToSegments,
} from '@/lib/office-workflow-generate';
import {
  isSmartCoordinatorProgressSyncReply,
  isSmartMemberAcceptanceAckReply,
  isSmartMemberJsonRoomReplyDeliverableComplete,
  smartCoordinatorReplyHasDirectMemberAssignment,
  validateSmartMemberRoomReply,
} from '@/lib/office-smart-member-reply';
import type { NodeRunRecord, OfficeDataStore, OfficeRole, RoomMessage } from '@/types/office';

const persistEnv = vi.hoisted(() => ({
  dataDir: '',
}));

vi.mock('@electron/services/office/paths', () => ({
  ensureOfficeDirs: async () => {
    if (!persistEnv.dataDir) return;
    const { mkdir: mkdirFs } = await import('node:fs/promises');
    await mkdirFs(persistEnv.dataDir, { recursive: true });
  },
  getOfficeDataDir: () => persistEnv.dataDir,
  getOfficeDataPath: () => join(persistEnv.dataDir, 'data.json'),
  getOfficeAuditPath: () => join(persistEnv.dataDir, 'audit.jsonl'),
}));

vi.mock('@electron/services/office/store-recovery', () => ({
  officeArtifactsLookRecoverable: async () => false,
  recoverOfficeStoreFromArtifacts: async () => null,
}));

vi.mock('@electron/services/office/role-persist', () => ({
  sanitizeOfficeRoleForPersist: (role: unknown) => role,
}));

const roles: Pick<OfficeRole, 'id' | 'name'>[] = [
  { id: 'pm', name: 'PM' },
  { id: 'dev', name: '开发' },
  { id: 'qa', name: '测试' },
];

describe('office coverage part2 · workflow task prompt shared', () => {
  it('builds prompt sections and ls lines', () => {
    expect(workflowPromptSection('标题', ['行1'])).toContain('标题');
    expect(workflowFewShotLsLine('/tmp/x.md')).toContain('2048');
    expect(workflowProjectRelativeLsLine('交付物-开发')).toContain('100');
    expect(workflowProjectRelativeLsDirLine('交付物-开发')).toContain('交付物-开发');
    expect(workflowLsLineDisplayName('交付物-开发/a.md')).toContain('a.md');
    expect(workflowProjectRelativeInputLsForTarget('上游.md')).toContain('100');
    expect(workflowProjectRelativeInputLsForTargets(['a.md', 'b.md'])).toHaveLength(2);
    expect(buildWorkflowAgentOutputFormatLines().length).toBeGreaterThan(3);
    expect(buildWorkflowJsonSchemaLines('dev').join('\n')).toContain('role');
    expect(buildWorkflowMergedOutputSpecLines('dev', 'simple').length).toBeGreaterThan(2);
    expect(formatWorkflowFeatureDescriptionForPrompt('  scope  ')).toContain('scope');
    expect(extractProjectGoal('项目目标：五子棋\n1. 开发')).toContain('五子棋');
    expect(
      compactWorkflowTaskOverview({
        taskTitle: 'T',
        featureDescription: 'F',
        taskDescription: 'D',
      }),
    ).toContain('T');
    expect(buildWorkflowTeamBriefBlock({ roleName: 'PM', teammateNames: ['开发'], includeTeammateRoster: true })).toContain('PM');
    const rootLine = '项目目录：~/.openclaw/workspace-pm/office/projects/任务-task-1';
    expect(extractWorkflowProjectRootFromLines([rootLine])).toContain('projects');
    expect(normalizeWorkflowProjectDirectoryLine(rootLine)).toContain('office/projects');
    expect(buildWorkflowProjectDirectoryBlock([rootLine])).toContain('office/projects');
    expect(
      buildWorkflowTaskDescriptionBlock({
        taskTitle: 'T',
        featureDescription: 'F',
        taskDescription: '1. 开发\n2. 测试',
      }),
    ).toContain('功能描述');
    expect(
      buildWorkflowAgentTaskBriefBlock({
        taskTitle: 'T',
        featureDescription: 'F',
        taskDescription: 'D',
        roleName: '开发',
        teammateNames: ['PM'],
        projectDirectoryLines: [rootLine],
      }),
    ).toContain('开发');
    const example = '【任务理解】示例\n【交付产物】无';
    expect(buildWorkflowFewShotWrapper(example)).toContain('示例');
    expect(workflowProjectDirectoryDeclaresRoot(rootLine)).toBe(true);
    expect(extractWorkflowFewShotExample(buildWorkflowFewShotWrapper(example))).toContain('任务理解');
  });
});

describe('office coverage part2 · workflow run heal', () => {
  const node = { id: 'n1', agentId: 'a-dev', title: '开发', execution: 'serial' as const };
  const nodes = [node];
  const run: NodeRunRecord = { nodeId: 'n1', agentId: 'a-dev', status: 'running' };
  const room: RoomMessage[] = [
    {
      id: 'm1',
      groupId: 's1',
      projectId: 't1',
      from: 'agent',
      fromAgentId: 'a-dev',
      content: '【执行完成】交付 /tmp/out.html',
      mentions: [],
      timestamp: 1,
      nodeId: 'n1',
      phase: 'task_running',
    },
  ];
  const deliverRoom: RoomMessage[] = [
    {
      id: 'm2',
      groupId: 's1',
      projectId: 't1',
      from: 'agent',
      fromAgentId: 'a-dev',
      content: '交付完成',
      mentions: [],
      timestamp: 2,
      nodeId: 'n1',
      phase: 'task_deliver',
    },
  ];
  const healOpts = {
    roles: [{ agentId: 'a-dev', displayName: '开发' }],
    edges: [],
    teamRoles: [{ agentId: 'a-dev', displayName: '开发' }],
  };

  it('detects room execution markers and deliver', () => {
    expect(nodeHasRoomExecutionFinishedMarker(room, node, nodes)).toBe(true);
    expect(nodeHasExplicitRoomDeliver(deliverRoom, node, nodes)).not.toBeNull();
    expect(combinedStructuredHealSummary(deliverRoom, node, nodes, healOpts.roles)).toBeDefined();
  });

  it('heals running nodes and clears tracking', () => {
    const runs = new Map([['n1', { ...run }]]);
    const result = healWorkflowRunningNodesFromRoom(nodes, runs, deliverRoom, 't1', healOpts);
    expect(result.pendingValidation).toBeDefined();
    const tracked = markWorkflowRoomJsonHealValidated(run, 'fp-1');
    expect(tracked.roomHealValidatedFingerprint).toBe('fp-1');
    expect(clearWorkflowRoomJsonHealTracking(tracked).roomHealValidatedFingerprint).toBeUndefined();
    expect(multiRoleNodeReadyForStructuredHeal(deliverRoom, node, nodes)).toBe(true);
    const runs2 = new Map([['n1', { ...run, startedAt: Date.now() - 999_999 }]]);
    expect(
      unstuckStaleRunningNodeRuns(nodes, runs2, deliverRoom, 't1', Date.now()),
    ).toBeDefined();
    expect(workflowStallIdleRoundLimit(nodes, runs2)).toBeGreaterThan(0);
  });
});

describe('office coverage part2 · workflow generate helpers', () => {
  it('splits description and matches roles', () => {
    const segs = splitDescriptionToSegments('1. 开发实现\n2. 测试验收');
    expect(segs.length).toBe(2);
    expect(matchRolesInText('开发', roles as OfficeRole[])).toContain('dev');
    expect(inferStepTitle('开发 API 模块', '开发')).toBeTruthy();
  });
});

describe('office coverage part2 · smart member reply validation branches', () => {
  const pm = { id: 'pm', name: 'PM' };
  const dev = { id: 'dev', name: '开发' };

  it('covers blocked / acceptance / ready validation paths', () => {
    expect(isSmartCoordinatorProgressSyncReply('当前进度清晰，有变化及时同步')).toBe(true);
    expect(
      smartCoordinatorReplyHasDirectMemberAssignment(
        JSON.stringify({
          role: 'PM',
          action: 'assign',
          taskUnderstanding: '派活',
          inputValidation: '无',
          deliverable: { items: [], outputValidation: '无' },
          dispatch: [{ role: '开发', task: '@开发 请完成模块' }],
        }),
      ),
    ).toBe(true);
    expect(isSmartMemberAcceptanceAckReply('@PM 已确认收到并已知悉，谢谢')).toBe(true);
    expect(
      isSmartMemberJsonRoomReplyDeliverableComplete(
        '{"roomReply":"@PM **开发已完成** /tmp/a.html"}',
      ),
    ).toBe(true);
    expect(
      validateSmartMemberRoomReply('@PM 好的', pm, 'blocked'),
    ).toContain('smart_member_missing_dependency_report');
    expect(
      validateSmartMemberRoomReply('@PM 收到，马上开始', pm, 'ready'),
    ).toContain('smart_member_promise_only');
    expect(
      validateSmartMemberRoomReply('@PM 撰写中，预计明日交付', pm, 'ready'),
    ).toContain('smart_member_in_progress_only');
    expect(
      validateSmartMemberRoomReply('@PM 已确认', pm, 'acceptance'),
    ).toContain('smart_member_missing_acceptance_ack');
    expect(
      validateSmartMemberRoomReply('@PM **开发已完成** /tmp/out.html', pm, 'ready', {
        deliverablePathText: '/tmp/out.html',
        teamRoles: [pm, dev],
      }).length,
    ).toBeGreaterThan(0);
  });
});

describe('office coverage part2 · store persist isolation', () => {
  beforeEach(async () => {
    persistEnv.dataDir = await mkdtemp(join(tmpdir(), 'office-cov-store-'));
    await mkdir(persistEnv.dataDir, { recursive: true });
    const { clearOfficeStoreCacheForTests, drainOfficeStoreOpsForTests } = await import(
      '@electron/services/office/store'
    );
    clearOfficeStoreCacheForTests();
    await drainOfficeStoreOpsForTests();
  });

  afterEach(async () => {
    const { clearOfficeStoreCacheForTests, drainOfficeStoreOpsForTests } = await import(
      '@electron/services/office/store'
    );
    clearOfficeStoreCacheForTests();
    await drainOfficeStoreOpsForTests();
    await rm(persistEnv.dataDir, { recursive: true, force: true });
  });

  it('saveStore and upsertTask persist smart fields', async () => {
    const { saveStore, createTaskDraft, upsertTask, listTasks, drainOfficeStoreOpsForTests } =
      await import('@electron/services/office/store');
    const store: OfficeDataStore = {
      version: 1,
      roles: [{ id: 'dev', name: '开发', agentId: 'main', createdAt: 1, updatedAt: 1 }],
      scenarios: [
        {
          id: 'sc-1',
          name: 'S',
          roleIds: ['dev'],
          coordinatorRoleId: 'dev',
          workflow: { nodes: [], edges: [] },
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      tasks: [],
      roomMessages: {},
      settings: { agentToAgentEnabled: false, agentToAgentAllow: [] },
    };
    await saveStore(store);
    const draft = createTaskDraft({
      scenarioId: 'sc-1',
      title: 'Cov task',
      featureDescription: 'F',
      assignedRoleIds: ['dev'],
      executionMode: 'smart',
    });
    await upsertTask(draft);
    await drainOfficeStoreOpsForTests();
    const tasks = await listTasks('sc-1');
    expect(tasks[0]?.executionMode).toBe('smart');
    const raw = await readFile(join(persistEnv.dataDir, 'data.json'), 'utf8');
    expect(raw).toContain('Cov task');
  });
});