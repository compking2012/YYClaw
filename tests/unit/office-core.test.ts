// Merged office unit tests — core, layout/viewport, sync & polling
import {
  beginOfficeStoreTestIsolation,
  endOfficeStoreTestIsolation,
  seedOfficeRecoveryArtifacts,
} from '../helpers/office-store-test-env.mocks';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  applyOfficeRunGatewayEvent,
  applyOfficeRunRuntimeEvent,
  canAcceptStableSessionReply,
  canStartOfficeSessionSettle,
  createOfficeRunTracker,
  hashSessionReplyText,
  isGatewayRunPhaseSettleSignal,
  isGatewayRunTerminalSignal,
  isOfficeRunCompletePhase,
  isOfficeRunProtocolDischarged,
  isRunLevelProtocolDischargeFromEndedEvent,
  isConclusiveRunStopReason,
  isCompletedRunEndedAsTerminalFailure,
  isCompletedRunEndedAsTerminalAbort,
  isFailureLikeRunStopReason,
  isAbortLikeStopReason,
  livenessStateIndicatesRunIdle,
  livenessStateIndicatesRunStillActive,
  isOfficeRunSettleGateOpen,
  hasPendingToolUseInAssistantMessage,
  reconcileOfficeRunSessionIdle,
  isPendingToolUseStopReason,
  sessionListRowAllowsSuccessSettle,
  sessionListRowAllowsWorkflowHistorySettle,
  sessionListRowIndicatesFailureTerminal,
  decideOfficeSettleHashMismatch,
  scoreOfficeSettleReplyCompleteness,
  sessionHasInFlightToolWork,
  SESSION_STABILITY_INITIAL_DELAY_MS,
  OFFICE_SETTLE_CONSISTENCY_DELAY_MS,
  tryReconcileOfficeRunFromWorkflowHistory,
  shouldUseWorkflowSettleFastPath,
  tryHandoffWorkflowSettleSyntaxParseFailure,
  findLatestParseableWorkflowReplyInRunSegment,
  OFFICE_WORKFLOW_SETTLE_FAST_PATH_DELAY_MS,
} from '../../electron/services/office/session-run-settle';
import {
  bindingsFromChannelAccountOwners,
  bindingsEqual,
  normalizeChannelBindings,
} from '@/lib/office-channel-bindings';
import {
  buildCoordinatorSummaryFromTask,
  buildRoleNotebookSection,
  formatProjectNotebookPromptBlock,
  projectNotebookFileName,
  sanitizeNotebookDirName,
} from '../../src/lib/office-project-notebook';
import {
  coerceCoordinatorDispatchRoomReply,
  isCoordinatorMentionFallbackReply,
} from '../../electron/services/office/room-mention-reply-policy';
import {
  collectAssistantRoomMirrorText,
  extractRoomMirrorTextFromAssistantMessage,
  gatewayEventMatchesRun,
} from '../../electron/services/office/run-completion';
import {
  collectDeliverablePathHintsFromText,
  deliverablePathKind,
  isDeliverableDirPathHint,
  isDeliverableFilePathHint,
  isSubstantiveDeliverableFileName,
  resolveDeliverablePathCandidatesInSearchOrder,
  resolveDeliverablePathCandidatesWithRoleScope,
} from '../../src/lib/office-workflow-project-deliverable';
import {
  collectFinalRoomMirrorText,
  extractDeliverableStatusFromThinking,
  extractFinalAssistantRoomMirror,
  extractFinalTextBlocks,
  findFinalReplyIndexInSegment,
} from '../../src/lib/office-session-final-mirror';
import {
  deliverableDirNameMatchesRole,
  deliverableFileNameMatchesRole,
  isUnderRoleScopedDeliverableDir,
  isRoleStatusArtifactFileName,
  legacyRoleStatusFileName,
  roleScopedDeliverableDirName,
  roleScopedDeliverableFileName,
  roleStatusFileName,
} from '../../src/lib/office-project-file-naming';
import {
  deriveScenarioRoleActivity,
  roleIdsWorkingFromRoom,
  roleIdsWorkingFromTasks,
  scenarioTeamRoles,
  sortScenarioRoleIdsByActivity,
} from '../../src/lib/office-scenario-role-activity';
import {
  enrichMessagesForRoomMirror,
  sanitizeChatHistoryMessages,
  extractMediaRefsFromText,
  readMirrorAttachments,
} from '../../src/lib/office-session-attachments';
import {
  hasSmartMentionRoomReplyMark,
  hasSmartMentionTurnContent,
  isSmartMentionStructuredReady,
  MENTION_CONTENT_DETECT_POLL_MS,
  MENTION_NO_ROOM_REPLY_VALIDATE_MS,
} from '../../electron/services/office/mention-run-settled';
import { applyAgentSkillsAllowlist } from '@electron/services/office/agent-setup';
import { buildOfficeRoster } from '@/lib/office-roster';
import { finalizeCoordinatorDispatchReply } from '../../src/lib/office-room-mirror-public';
import { formatOfficeDateTime } from '@/lib/office-format';
import { join } from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { officeDeliverableDeclaresFilePath } from '../../src/lib/office-deliverable-file-policy';
import { officeProjectRootRelative } from '../../src/lib/office-project-paths';
import { pickBestSmartMentionStructuredRaw } from '../../src/lib/office-mention-structured-score';
import { sessionsSend } from '../../electron/services/office/gateway-rpc';
import { tmpdir } from 'node:os';
import type { AgentSummary } from '@/types/agent';
import type { OfficeFixedGroup, OfficeTempProject, RoomMessage, WorkflowDefinition } from '../../src/types/office';

const syncGetRoomMessages = vi.fn();
const syncListTasks = vi.fn();
const syncReconcileScenarioTaskProgress = vi.fn();

vi.mock('@electron/services/office/scenario-progress-reconcile', () => ({
  reconcileScenarioTaskProgress: (...args: unknown[]) =>
    syncReconcileScenarioTaskProgress(...args),
}));

vi.mock('@electron/services/office/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@electron/services/office/store')>();
  return {
    ...actual,
    appendRoomMessage: vi.fn(),
    listRoles: vi.fn(),
    listProjectAgents: vi.fn(),
    listFixedGroups: vi.fn(),
    listTempProjects: vi.fn(),
    getRoomMessages: (...args: unknown[]) => syncGetRoomMessages(...args),
    listTasks: (...args: unknown[]) => syncListTasks(...args),
  };
});

vi.mock('@electron/services/office/audit', () => ({
  auditLog: vi.fn(),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  return importOriginal<typeof import('node:fs/promises')>();
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
  };
});

describe("__merged__:office-agent-setup", () => {
  describe('applyAgentSkillsAllowlist', () => {
    it('writes skill ids as array', () => {
      const entry: Record<string, unknown> = {};
      applyAgentSkillsAllowlist(entry, ['pdf', 'docx']);
      expect(entry.skills).toEqual(['pdf', 'docx']);
    });

    it('removes skills when allowlist empty', () => {
      const entry: Record<string, unknown> = { skills: { allow: ['pdf'] } };
      applyAgentSkillsAllowlist(entry, []);
      expect(entry.skills).toBeUndefined();
    });

    it('replaces legacy object shape', () => {
      const entry: Record<string, unknown> = { skills: { allow: ['web-search'] } };
      applyAgentSkillsAllowlist(entry, ['web-search', 'find-skills']);
      expect(entry.skills).toEqual(['web-search', 'find-skills']);
    });
  });
});

describe("__merged__:office-channel-bindings", () => {
  describe('office-channel-bindings', () => {
    it('normalizes and dedupes bindings', () => {
      expect(
        normalizeChannelBindings([
          { channelType: 'telegram', accountId: 'default' },
          { channelType: 'telegram', accountId: 'default' },
          { channelType: 'feishu', accountId: 'a1' },
        ]),
      ).toEqual([
        { channelType: 'telegram', accountId: 'default' },
        { channelType: 'feishu', accountId: 'a1' },
      ]);
    });

    it('derives bindings from channel account owners', () => {
      expect(
        bindingsFromChannelAccountOwners('code', {
          'telegram:default': 'code',
          'feishu:alt': 'main',
          'discord:default': 'code',
        }),
      ).toEqual([
        { channelType: 'telegram', accountId: 'default' },
        { channelType: 'discord', accountId: 'default' },
      ]);
    });

    it('compares binding lists', () => {
      const a = [{ channelType: 'telegram', accountId: 'default' }];
      const b = [{ channelType: 'telegram', accountId: 'default' }];
      expect(bindingsEqual(a, b)).toBe(true);
      expect(bindingsEqual(a, [])).toBe(false);
    });
  });
});

describe("__merged__:office-coordinator-dispatch-mirror", () => {
  const COORDINATOR_BREAKDOWN = `任务拆解：五子棋开发
  功能目标：支持人机对战和人人对战

  项目阶段规划：

  阶段	任务	执行者
  M1	项目启动 & 计划	@PM
  M2	需求说明书	@产品
  M3	三方评审	@产品+@开发+@测试
  @产品

  【M2 需求说明书】

  请根据项目目标"支持人机对战和人人对战"，撰写五子棋软件的需求说明书初稿。

  交付物：需求说明书初稿（供后续三方评审使用）
  请开始撰写，完成后同步到群内。`;

  describe('office-coordinator-dispatch-mirror', () => {
    it('keeps stage table preamble with 【M2】 section body', () => {
      const out = finalizeCoordinatorDispatchReply(COORDINATOR_BREAKDOWN);
      expect(out).toContain('任务拆解：五子棋开发');
      expect(out).toContain('M1');
      expect(out).toContain('【M2 需求说明书】');
      expect(out).toContain('需求说明书初稿');
    });

    it('isCoordinatorMentionFallbackReply detects auto-generated placeholders', () => {
      expect(
        isCoordinatorMentionFallbackReply(
          '【PM】@系统 已收到点名，将在群内跟进并同步进展直至闭环。（自动生成：回复超时，请再次 @我。）',
        ),
      ).toBe(true);
      expect(isCoordinatorMentionFallbackReply('任务拆解：五子棋')).toBe(false);
    });

    it('coerceCoordinatorDispatchRoomReply returns full breakdown for publish', () => {
      const out = coerceCoordinatorDispatchRoomReply(
        COORDINATOR_BREAKDOWN,
        'PM',
        '系统',
        'empty',
      );
      expect(out).toContain('任务拆解');
      expect(out).toContain('@产品');
      expect(out).not.toContain('自动生成');
    });
  });
});

describe("__merged__:office-format", () => {
  describe('formatOfficeDateTime', () => {
    it('formats as YYYY-MM-DD HH:mm:ss', () => {
      const ts = new Date(2026, 4, 18, 9, 8, 7).getTime();
      expect(formatOfficeDateTime(ts, 'en-US')).toBe('2026-05-18 09:08:07');
    });

    it('returns empty string for invalid timestamp', () => {
      expect(formatOfficeDateTime(Number.NaN)).toBe('');
    });
  });
});

describe("__merged__:office-gateway-rpc", () => {
  describe('office gateway-rpc sessionsSend', () => {
    it('delivers to target session via chat.send when targetSessionKey is set', async () => {
      const rpc = vi.fn(async (method: string) => {
        if (method === 'office.runtimeToolPolicy.capabilities') {
          return { officeRuntimeToolPolicy: true };
        }
        if (method === 'sessions.send' || method === 'sessions_send') {
          throw new Error(`unknown method: ${method}`);
        }
        return { runId: 'run-1' };
      });
      const gateway = { rpc } as unknown as GatewayManager;

      await sessionsSend(gateway, {
        sessionKey: 'agent:coord:office:room:team-1',
        targetSessionKey: 'agent:pm:office:role:pm:dm:room-team-1',
        message: '[Office Handoff]\nObjective: hi',
        idempotencyKey: 'test-key',
      });

      const methods = rpc.mock.calls.map((c) => c[0] as string);
      expect(methods).not.toContain('sessions.send');
      expect(methods).not.toContain('session.send');
      expect(methods.some((m) => m === 'chat.send' || m === 'agent')).toBe(true);
      const params = rpc.mock.calls.find((c) => c[0] === 'chat.send' || c[0] === 'agent')?.[1] as
        | Record<string, unknown>
        | undefined;
      expect(params?.sessionKey).toBe('agent:pm:office:role:pm:dm:room-team-1');
      expect(params?.message).toContain('Objective: hi');
    });
  });
});

describe("__merged__:office-roster", () => {
  function agent(id: string, name: string, isDefault = false): AgentSummary {
    return {
      id,
      name,
      isDefault,
      modelDisplay: 'gpt-test',
      modelRef: 'openai/gpt-test',
      overrideModelRef: null,
      inheritedModel: false,
      workspace: '',
      agentDir: '',
      mainSessionKey: '',
      channelTypes: [],
    };
  }

  function member(agentId: string, displayName: string) {
    return { agentId, displayName };
  }

  describe('buildOfficeRoster', () => {
    it('includes agents without office roles', () => {
      const entries = buildOfficeRoster([agent('a1', 'Alpha')], []);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.agentId).toBe('a1');
      expect(entries[0]?.member).toBeNull();
    });

    it('merges role onto matching agent', () => {
      const entries = buildOfficeRoster([agent('a1', 'Alpha')], [member('a1', 'Lead')]);
      expect(entries[0]?.member?.displayName).toBe('Lead');
    });

    it('emits one roster card per member when multiple members share an agent', () => {
      const entries = buildOfficeRoster(
        [agent('planner', '终极股市规划师')],
        [
          member('planner', '终极股市规划师'),
          member('planner', '股市老流氓'),
        ],
      );
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.member?.displayName)).toEqual(
        expect.arrayContaining(['股市老流氓', '终极股市规划师']),
      );
      expect(entries.every((e) => e.agentId === 'planner')).toBe(true);
    });

    it('appends orphan members whose agent is missing from client list', () => {
      const entries = buildOfficeRoster([], [member('ghost', 'Ghost')]);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.agent.id).toBe('ghost');
      expect(entries[0]?.member?.displayName).toBe('Ghost');
    });

    it('sorts default agent first', () => {
      const entries = buildOfficeRoster(
        [agent('b', 'Beta'), agent('a', 'Alpha', true)],
        [],
      );
      expect(entries[0]?.agentId).toBe('a');
    });
  });
});

describe("__merged__:office-scenario-role-activity", () => {
  const workflow: WorkflowDefinition = {
    mode: 'simple',
    nodes: [
      { id: 'n1', agentId: 'product', execution: 'serial' },
      { id: 'n2', agentId: 'dev', execution: 'serial' },
      { id: 'n3', agentId: 'qa', execution: 'serial' },
    ],
    edges: [],
  };

  const group: OfficeFixedGroup = {
    id: 'sc1',
    name: 'Team',
    agentIds: ['product', 'dev', 'qa'],
    coordinatorAgentId: 'product',
    workflow,
    createdAt: 0,
    updatedAt: 0,
  };

  const members = [
    { agentId: 'dev', displayName: '开发' },
    { agentId: 'product', displayName: '产品' },
    { agentId: 'qa', displayName: '测试' },
  ];

  function project(partial: Partial<OfficeTempProject>): OfficeTempProject {
    return {
      id: 't1',
      title: 'Task',
      origin: 'fixed_group',
      parentGroupId: 'sc1',
      agentIds: ['product', 'dev', 'qa'],
      coordinatorAgentId: 'product',
      lifecycle: 'active',
      featureDescription: '',
      description: '',
      status: 'running',
      nodeRuns: [],
      createdAt: 0,
      updatedAt: 0,
      ...partial,
    };
  }

  describe('office-scenario-role-activity', () => {
    it('scenarioTeamRoles lists coordinator first', () => {
      const ordered = scenarioTeamRoles(group, members);
      expect(ordered.map((r) => r.agentId)).toEqual(['product', 'dev', 'qa']);
    });

    it('marks roles on running workflow steps from task sync', () => {
      const projects = [
        project({
          nodeRuns: [
            { nodeId: 'n1', agentId: 'product', status: 'completed' },
            { nodeId: 'n2', agentId: 'dev', status: 'running' },
            { nodeId: 'n3', agentId: 'qa', status: 'pending' },
          ],
        }),
      ];
      const working = roleIdsWorkingFromTasks(group, projects, []);
      expect([...working.keys()]).toEqual(['dev']);
    });

    it('marks roles working from latest room line when phase is in-flight', () => {
      const room: RoomMessage[] = [
        {
          id: 'm1',
          groupId: 'sc1',
          projectId: 't1',
          from: 'qa-agent',
          fromAgentId: 'qa',
          content: '验收进行中',
          mentions: [],
          timestamp: 100,
          phase: 'task_running',
        },
      ];
      const working = roleIdsWorkingFromRoom(new Set(group.agentIds), room);
      expect([...working.keys()]).toEqual(['qa']);
    });

    it('does not mark working when latest room line is deliver', () => {
      const room: RoomMessage[] = [
        {
          id: 'm1',
          groupId: 'sc1',
          projectId: 't1',
          from: 'dev-agent',
          fromAgentId: 'dev',
          content: '进行中',
          mentions: [],
          timestamp: 100,
          phase: 'task_running',
        },
        {
          id: 'm2',
          groupId: 'sc1',
          projectId: 't1',
          from: 'dev-agent',
          fromAgentId: 'dev',
          content: '开发已完成',
          mentions: [],
          timestamp: 200,
          phase: 'task_deliver',
        },
      ];
      expect([...roleIdsWorkingFromRoom(new Set(group.agentIds), room).keys()]).toEqual([]);
    });

    it('sorts working roles to the front', () => {
      const activity = deriveScenarioRoleActivity(
        group,
        [
          project({
            nodeRuns: [{ nodeId: 'n2', agentId: 'dev', status: 'running' }],
          }),
        ],
        [],
      );
      expect(sortScenarioRoleIdsByActivity(group.agentIds, activity)).toEqual([
        'dev',
        'product',
        'qa',
      ]);
    });

    it('merges task and room sources', () => {
      const activity = deriveScenarioRoleActivity(
        group,
        [
          project({
            nodeRuns: [{ nodeId: 'n2', agentId: 'dev', status: 'running' }],
          }),
        ],
        [
          {
            id: 'm1',
            groupId: 'sc1',
            projectId: 't1',
            from: 'qa',
            fromAgentId: 'qa',
            content: '测试中',
            mentions: [],
            timestamp: 1,
            phase: 'task_running',
          },
        ],
      );
      const dev = activity.find((a) => a.agentId === 'dev');
      const qa = activity.find((a) => a.agentId === 'qa');
      expect(dev?.working).toBe(true);
      expect(dev?.source).toBe('task');
      expect(qa?.working).toBe(true);
      expect(qa?.source).toBe('room');
    });
  });
});

describe("__merged__:office-session-attachments", () => {
  describe('office-session-attachments', () => {
    it('extracts media attached refs from assistant text', () => {
      const refs = extractMediaRefsFromText(
        'Done.\n\n[media attached: /tmp/tax-calculator.zip (application/zip) | /tmp/tax-calculator.zip]',
      );
      expect(refs[0]?.filePath).toBe('/tmp/tax-calculator.zip');
    });

    it('sanitizeChatHistoryMessages drops null holes in gateway arrays', () => {
      expect(
        sanitizeChatHistoryMessages([
          { role: 'user', content: 'hi' },
          undefined,
          null,
          { role: 'assistant', content: 'ok' },
        ]).length,
      ).toBe(2);
      expect(() =>
        enrichMessagesForRoomMirror([
          { role: 'user', content: 'hi' },
          undefined as unknown as Record<string, unknown>,
          { role: 'assistant', content: 'done' },
        ]),
      ).not.toThrow();
    });

    it('enrich attaches tool-result file to the next assistant message', () => {
      const enriched = enrichMessagesForRoomMirror([
        { role: 'user', content: 'build zip' },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 't1', input: { file_path: '/out/tax-calculator.zip' } }],
        },
        {
          role: 'tool_result',
          toolCallId: 't1',
          content: 'Wrote /out/tax-calculator.zip (5020 bytes)',
        },
        { role: 'assistant', content: '✅ 已提供更新后的软件，等待用户反馈。' },
      ]);
      const final = enriched[3] as Record<string, unknown>;
      const files = readMirrorAttachments(final);
      expect(files[0]?.fileName).toBe('tax-calculator.zip');
      expect(files[0]?.filePath).toBe('/out/tax-calculator.zip');
    });

    it('collectAssistantRoomMirrorText includes attachment block in room body', () => {
      const startedAt = Date.now() - 10_000;
      const text = collectAssistantRoomMirrorText(
        [
          { role: 'user', content: 'go', timestamp: startedAt + 100 },
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 't1', input: { path: '/out/tax-calculator.zip' } }],
            timestamp: startedAt + 200,
          },
          {
            role: 'tool_result',
            toolCallId: 't1',
            content: 'ok',
            timestamp: startedAt + 300,
          },
          {
            role: 'assistant',
            content: '✅ 已提供更新后的软件，等待用户反馈。',
            timestamp: startedAt + 400,
          },
        ],
        startedAt,
      );
      expect(text).toContain('✅ 已提供更新后的软件');
      expect(text).toContain('📎 tax-calculator.zip');
      expect(text).toContain('/out/tax-calculator.zip');
    });
  });

  describe('office-session-attachments mirror message', () => {
    it('appends formatted attachments when not already in text', () => {
      const body = extractRoomMirrorTextFromAssistantMessage({
        role: 'assistant',
        content: '✅ 已提供软件',
        _mirrorAttachments: [{ fileName: 'tax-calculator.zip', filePath: '/out/tax-calculator.zip' }],
      });
      expect(body).toContain('✅ 已提供软件');
      expect(body).toContain('📎 tax-calculator.zip');
    });
  });
});

describe("__merged__:office-session-final-mirror", () => {
  describe('office-session-final-mirror', () => {
    it('findFinalReplyIndexInSegment picks last assistant with text', () => {
      const segment = [
        { role: 'assistant', content: '先核对链接。' },
        { role: 'assistant', content: [{ type: 'thinking', thinking: 'internal' }] },
        { role: 'assistant', content: '✅ 已交付。' },
      ];
      expect(findFinalReplyIndexInSegment(segment)).toBe(2);
    });

    it('excludes intermediate narration and thinking from collect', () => {
      const startedAt = 1_715_000_100_000;
      const messages = [
        { role: 'user', content: 'go', timestamp: 1_715_000_099_000 },
        { role: 'assistant', content: '先核对下载链接。', timestamp: 1_715_000_102_000 },
        {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'Checking links…' }],
          timestamp: 1_715_000_103_000,
        },
        { role: 'assistant', content: '✅ 已提供软件下载方式。', timestamp: 1_715_000_104_000 },
      ];
      expect(collectFinalRoomMirrorText(messages, startedAt, (t) => Number(t))).toBe(
        '✅ 已提供软件下载方式。',
      );
    });

    it('includes attachments on final row only', () => {
      const startedAt = Date.now() - 10_000;
      const text = collectFinalRoomMirrorText(
        [
          { role: 'user', content: 'go', timestamp: startedAt + 100 },
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 't1', input: { path: '/out/a.zip' } }],
            timestamp: startedAt + 200,
          },
          { role: 'tool_result', toolCallId: 't1', content: 'ok', timestamp: startedAt + 300 },
          {
            role: 'assistant',
            content: '✅ 完成',
            timestamp: startedAt + 400,
          },
        ],
        startedAt,
        (t) => Number(t),
      );
      expect(text).toContain('✅ 完成');
      expect(text).toContain('📎 a.zip');
      expect(text).not.toContain('先核对');
    });

    it('falls back to deliverable status in thinking when no text block', () => {
      const thinking =
        "Reasoning in English.\n\n✅ 已提供更新后的软件，等待用户反馈。\n\ntax-calculator.zip";
      expect(extractDeliverableStatusFromThinking(thinking)).toContain('✅');
      expect(
        extractFinalAssistantRoomMirror({
          role: 'assistant',
          content: [{ type: 'thinking', thinking }],
        }),
      ).toContain('✅');
      expect(extractFinalTextBlocks([{ type: 'thinking', thinking }])).toBe('');
    });

    it('does not mirror English-only thinking', () => {
      expect(
        extractFinalAssistantRoomMirror({
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'Only internal reasoning in English.' }],
        }),
      ).toBe('');
    });
  });
});

describe("__merged__:office-store-recovery", () => {
  let testRoot = '';

  beforeEach(async () => {
    testRoot = await beginOfficeStoreTestIsolation();
    const fs = await import('node:fs');
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
    vi.mocked(fs.existsSync).mockImplementation(actual.existsSync);
    vi.resetModules();
  });

  afterEach(async () => {
    vi.resetModules();
    const fs = await import('node:fs');
    vi.mocked(fs.existsSync).mockImplementation(() => false);
    if (testRoot) {
      await endOfficeStoreTestIsolation(testRoot);
      testRoot = '';
    }
  });

  describe('office store recovery', () => {
    it('builds roles/scenarios/tasks from local artifacts when present', async () => {
      await seedOfficeRecoveryArtifacts(testRoot);
      const { recoverOfficeStoreFromArtifacts } = await import('@electron/services/office/store-recovery');
      const recovered = await recoverOfficeStoreFromArtifacts();
      expect(recovered).not.toBeNull();
      if (!recovered) return;
      expect(recovered.version).toBe(2);
      expect(recovered.fixedGroups.length).toBeGreaterThan(0);
    });

    it('officeArtifactsLookRecoverable is true for seeded artifacts', async () => {
      await seedOfficeRecoveryArtifacts(testRoot);
      const { officeArtifactsLookRecoverable } = await import('@electron/services/office/store-recovery');
      expect(await officeArtifactsLookRecoverable()).toBe(true);
    });

    it('persists recovered snapshot to isolated test data.json only', async () => {
      await seedOfficeRecoveryArtifacts(testRoot);
      const { recoverOfficeStoreFromArtifacts } = await import('@electron/services/office/store-recovery');
      const store = await vi.importActual<typeof import('@electron/services/office/store')>(
        '@electron/services/office/store',
      );
      const { getOfficeDataPath } = await import('@electron/services/office/paths');
      store.clearOfficeStoreCacheForTests();
      const recovered = await recoverOfficeStoreFromArtifacts();
      if (!recovered) return;
      await store.saveStore(recovered);
      await store.drainOfficeStoreOpsForTests();
      const dataPath = getOfficeDataPath();
      expect(dataPath).toContain(testRoot);
      const raw = await readFile(dataPath, 'utf8');
      const parsed = JSON.parse(raw) as { fixedGroups: unknown[]; tempProjects: unknown[]; version: number };
    expect(parsed.version).toBe(2);
    expect(parsed.fixedGroups.length).toBeGreaterThan(0);
    });
  });
});

describe('mention-run-settled helpers', () => {
  it('gatewayEventMatchesRun requires matching runId when provided', () => {
    expect(gatewayEventMatchesRun('run-a', 'run-a')).toBe(true);
    expect(gatewayEventMatchesRun('run-a', 'run-b')).toBe(false);
    expect(gatewayEventMatchesRun('run-a', '')).toBe(false);
    expect(gatewayEventMatchesRun(undefined, 'run-a')).toBe(true);
    expect(
      gatewayEventMatchesRun(
        'office-task-project-t1-gen-0-pm-run-1783301434350',
        'run-1783301434350',
      ),
    ).toBe(true);
    expect(
      gatewayEventMatchesRun(
        'office-task-project-t1-gen-0-pm-run-1783301434350@gen-0',
        'run-1783301434350',
      ),
    ).toBe(true);
    expect(
      gatewayEventMatchesRun(
        'office-task-project-t1-gen-0-pm-run-1783301434350@gen-0',
        'run-1783301434350@gen-0',
      ),
    ).toBe(true);
  });

  it('hasSmartMentionTurnContent accepts intermediate non-empty text', () => {
    expect(hasSmartMentionTurnContent('')).toBe(false);
    expect(hasSmartMentionTurnContent('让我先执行 ls -l')).toBe(true);
    expect(hasSmartMentionRoomReplyMark('让我先执行 ls -l')).toBe(false);
    expect(
      hasSmartMentionRoomReplyMark(
        '{"role":"PM","taskUnderstanding":"拆解","outputValidation":"无","deliverable":[],"roomReply":"@产品 请执行","dispatch":[{"role":"产品","task":"请执行"}],"end":"false"}',
      ),
    ).toBe(true);
    expect(
      isSmartMentionStructuredReady('【群聊回复】\n【需求已完成】请 @PM 验收。'),
    ).toBe(true);
  });

  it('structured validation timing constants match spec', () => {
    expect(OFFICE_SETTLE_CONSISTENCY_DELAY_MS).toBe(5_000);
    expect(SESSION_STABILITY_INITIAL_DELAY_MS).toBe(5_000);
    expect(MENTION_NO_ROOM_REPLY_VALIDATE_MS).toBe(30_000);
    expect(MENTION_CONTENT_DETECT_POLL_MS).toBe(3_000);
  });

  it('pickBest prefers structured mention over intermediate narration', () => {
    const intermediate = '让我先执行 ls -l 验证这个文件。';
    const structured = [
      '【任务理解】本步验收需求文档。',
      '【输入校验】-rw-r--r-- 1 u 1 100 /tmp/requirements-产品.md',
      '【输出校验】无',
      '【交付产物】无',
      '【群聊回复】@开发 请按文档实现。',
    ].join('\n');
    const best = pickBestSmartMentionStructuredRaw(intermediate, structured);
    expect(best).toContain('【群聊回复】');
    expect(best).not.toBe(intermediate);
  });
});

describe('session-run-settle', () => {
  it('tracks run complete and retry from gateway phase', () => {
    const tracker = createOfficeRunTracker('run-1');
    applyOfficeRunGatewayEvent(tracker, { runId: 'run-1', phase: 'started' });
    expect(tracker.runComplete).toBe(false);

    applyOfficeRunGatewayEvent(tracker, { runId: 'run-1', phase: 'retrying same model' });
    expect(tracker.pendingRetry).toBe(true);

    applyOfficeRunRuntimeEvent(tracker, {
      type: 'run.ended',
      runId: 'run-1',
      status: 'completed',
      lifecyclePhase: 'completed',
    });
    expect(tracker.runComplete).toBe(true);
    expect(tracker.pendingRetry).toBe(false);
  });

  it('ignores events for other run ids', () => {
    const tracker = createOfficeRunTracker('run-a');
    applyOfficeRunRuntimeEvent(tracker, {
      type: 'run.ended',
      runId: 'run-b',
      status: 'completed',
    });
    expect(tracker.runComplete).toBe(false);
  });

  it('treats same-run completed error as terminal with assistant texts via run.ended', () => {
    const tracker = createOfficeRunTracker('run-1');
    applyOfficeRunRuntimeEvent(tracker, {
      type: 'run.ended',
      runId: 'run-1',
      status: 'error',
      error: 'non_deliverable_terminal_turn',
    });
    tracker.terminalAssistantTexts = ['partial final text'];
    expect(tracker.runComplete).toBe(true);
    expect(tracker.pendingRetry).toBe(false);
    expect(tracker.terminalErrorEnded).toBe(true);
    expect(tracker.terminalError).toBe('non_deliverable_terminal_turn');
    expect(tracker.terminalAssistantTexts).toEqual(['partial final text']);
  });

  it('treats run.ended status=aborted as terminal error ended', () => {
    const tracker = createOfficeRunTracker('run-1');
    applyOfficeRunRuntimeEvent(tracker, {
      type: 'run.ended',
      runId: 'run-1',
      status: 'aborted',
      error: 'user cancelled',
    });
    expect(tracker.runComplete).toBe(true);
    expect(tracker.terminalErrorEnded).toBe(true);
  });

  it('does not discharge protocol on run.ended completed with tool_use stopReason (round end)', () => {
    expect(isPendingToolUseStopReason('tool_use')).toBe(true);
    const tracker = createOfficeRunTracker('run-1');
    applyOfficeRunRuntimeEvent(tracker, {
      type: 'run.ended',
      runId: 'run-1',
      status: 'completed',
      lifecyclePhase: 'end',
      stopReason: 'tool_use',
    });
    expect(tracker.runComplete).toBe(false);
    expect(isOfficeRunProtocolDischarged(tracker)).toBe(false);

    const startedAt = Date.now();
    const inFlight = [
      { role: 'user', content: 'go', timestamp: startedAt },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'read' }],
        stop_reason: 'tool_use',
        timestamp: startedAt + 100,
      },
    ];
    expect(canStartOfficeSessionSettle(tracker, inFlight, startedAt, { hasRunningTool: false })).toBe(false);

    const settled = [
      ...inFlight,
      { role: 'assistant', content: [{ type: 'text', text: 'done' }], timestamp: startedAt + 300 },
    ];
    expect(canStartOfficeSessionSettle(tracker, settled, startedAt, { hasRunningTool: false })).toBe(false);
  });

  it('discharges protocol on run-level lifecyclePhase=completed', () => {
    const tracker = createOfficeRunTracker('run-1');
    applyOfficeRunRuntimeEvent(tracker, {
      type: 'run.ended',
      runId: 'run-1',
      status: 'completed',
      lifecyclePhase: 'completed',
    });
    expect(tracker.runComplete).toBe(true);
    expect(isOfficeRunProtocolDischarged(tracker)).toBe(true);
  });

  it('treats completed + stopReason=aborted as terminal error, not success discharge', () => {
    const tracker = createOfficeRunTracker('run-abort');
    applyOfficeRunRuntimeEvent(tracker, {
      type: 'run.ended',
      runId: 'run-abort',
      status: 'completed',
      lifecyclePhase: 'end',
      stopReason: 'aborted',
      error: 'LLM idle timeout (120s)',
    });
    expect(tracker.terminalErrorEnded).toBe(true);
    expect(tracker.terminalError).toContain('LLM idle timeout');
    expect(tracker.runComplete).toBe(true);
    expect(tracker.pendingRetry).toBe(false);
    // Protocol may look discharged (runComplete), but success settle stays blocked.
    expect(canStartOfficeSessionSettle(tracker, [], Date.now(), { hasRunningTool: false })).toBe(false);
    expect(canAcceptStableSessionReply(tracker)).toBe(false);
    expect(isCompletedRunEndedAsTerminalFailure({
      type: 'run.ended',
      runId: 'run-abort',
      status: 'completed',
      lifecyclePhase: 'end',
      stopReason: 'aborted',
    })).toBe(true);
    expect(isCompletedRunEndedAsTerminalAbort({
      type: 'run.ended',
      runId: 'run-abort',
      status: 'completed',
      lifecyclePhase: 'end',
      stopReason: 'aborted',
    })).toBe(true);
    expect(isRunLevelProtocolDischargeFromEndedEvent({
      type: 'run.ended',
      runId: 'run-abort',
      status: 'completed',
      lifecyclePhase: 'end',
      stopReason: 'aborted',
      livenessState: 'idle',
    })).toBe(false);
    expect(isFailureLikeRunStopReason('cancelled')).toBe(true);
    expect(isAbortLikeStopReason('canceled')).toBe(true);
  });

  it('treats completed + failure stopReason (timeout/error) as terminal, not success idle', () => {
    for (const stopReason of ['timeout', 'timed_out', 'error', 'killed'] as const) {
      const tracker = createOfficeRunTracker(`run-${stopReason}`);
      applyOfficeRunRuntimeEvent(tracker, {
        type: 'run.ended',
        runId: `run-${stopReason}`,
        status: 'completed',
        lifecyclePhase: 'end',
        stopReason,
        livenessState: 'idle',
      });
      expect(tracker.terminalErrorEnded).toBe(true);
      expect(tracker.terminalError).toBe(`stopReason=${stopReason}`);
      expect(isRunLevelProtocolDischargeFromEndedEvent({
        type: 'run.ended',
        runId: `run-${stopReason}`,
        status: 'completed',
        lifecyclePhase: 'end',
        stopReason,
        livenessState: 'idle',
      })).toBe(false);
    }
  });

  it('does not treat unknown/intermediate phase + failure stopReason as terminal yet', () => {
    expect(isCompletedRunEndedAsTerminalFailure({
      type: 'run.ended',
      runId: 'r1',
      status: 'completed',
      lifecyclePhase: 'finishing',
      stopReason: 'aborted',
    })).toBe(false);
    expect(isCompletedRunEndedAsTerminalFailure({
      type: 'run.ended',
      runId: 'r1',
      status: 'completed',
      lifecyclePhase: 'tool',
      stopReason: 'aborted',
    })).toBe(false);
    const tracker = createOfficeRunTracker('run-finishing-abort');
    applyOfficeRunRuntimeEvent(tracker, {
      type: 'run.ended',
      runId: 'run-finishing-abort',
      status: 'completed',
      lifecyclePhase: 'finishing',
      stopReason: 'aborted',
    });
    expect(tracker.terminalErrorEnded).toBe(false);
    expect(tracker.runComplete).toBe(false);
  });

  it('terminal failure clears prior success-idle reconcile markers', () => {
    const tracker = createOfficeRunTracker('run-clear');
    tracker.sessionIdleReconciled = true;
    tracker.workflowHistoryReconciled = true;
    applyOfficeRunRuntimeEvent(tracker, {
      type: 'run.ended',
      runId: 'run-clear',
      status: 'completed',
      lifecyclePhase: 'end',
      stopReason: 'aborted',
      error: 'aborted after idle reconcile',
    });
    expect(tracker.terminalErrorEnded).toBe(true);
    expect(tracker.sessionIdleReconciled).toBe(false);
    expect(tracker.workflowHistoryReconciled).toBe(false);
  });

  it('isRunLevelProtocolDischargeFromEndedEvent respects stopReason and livenessState', () => {
    expect(isRunLevelProtocolDischargeFromEndedEvent({
      type: 'run.ended',
      runId: 'r1',
      status: 'completed',
      lifecyclePhase: 'end',
      stopReason: 'tool_use',
    })).toBe(false);
    expect(isRunLevelProtocolDischargeFromEndedEvent({
      type: 'run.ended',
      runId: 'r1',
      status: 'completed',
      lifecyclePhase: 'end',
      stopReason: 'end_turn',
    })).toBe(true);
    expect(isRunLevelProtocolDischargeFromEndedEvent({
      type: 'run.ended',
      runId: 'r1',
      status: 'completed',
      lifecyclePhase: 'end',
      livenessState: 'active',
    })).toBe(false);
    expect(isRunLevelProtocolDischargeFromEndedEvent({
      type: 'run.ended',
      runId: 'r1',
      status: 'completed',
      lifecyclePhase: 'end',
      livenessState: 'idle',
    })).toBe(true);
    expect(isConclusiveRunStopReason('end_turn')).toBe(true);
    expect(livenessStateIndicatesRunStillActive('running')).toBe(true);
    expect(livenessStateIndicatesRunIdle('idle')).toBe(true);
  });

  it('workflow history reconcile does NOT open gate on JSON alone; promotes after gateway idle (Model B)', async () => {
    const startedAt = 5_000;
    const workflowJson = `{
  "role": "文档撰写师",
  "step": { "index": 2, "total": 3, "title": "撰写" },
  "inputValidation": { "targets": [], "lsResult": [] },
  "execution": "完成",
  "outputValidation": { "targets": ["out.md"], "lsResult": [] },
  "deliverable": { "path": "out.md", "summary": "摘要", "conclusion": "通过" },
  "rollback": "无"
}`;
    const messages = [
      { role: 'user', content: 'go', timestamp: startedAt },
      {
        role: 'assistant',
        content: workflowJson,
        timestamp: startedAt + 1_000,
      },
    ];
    expect(findLatestParseableWorkflowReplyInRunSegment(messages, startedAt, workflowJson).kind).toBe(
      'ok',
    );
    expect(
      findLatestParseableWorkflowReplyInRunSegment(messages, startedAt, workflowJson),
    ).toMatchObject({ kind: 'ok', raw: workflowJson });
    expect(shouldUseWorkflowSettleFastPath(messages, startedAt, workflowJson)).toBe(true);
    // Workflow success settle always performs the 5s consistency re-pull (no 0ms bypass).
    expect(OFFICE_WORKFLOW_SETTLE_FAST_PATH_DELAY_MS).toBe(OFFICE_SETTLE_CONSISTENCY_DELAY_MS);

    const tracker = createOfficeRunTracker('run-wf');
    // Model B: no gateway terminal yet → history-JSON must NOT open the gate.
    expect(tryReconcileOfficeRunFromWorkflowHistory(tracker, messages, startedAt, {
      replyText: workflowJson,
    })).toBe(false);
    expect(isOfficeRunProtocolDischarged(tracker)).toBe(false);
    expect(tracker.workflowHistoryReconciled).toBe(false);

    // Gateway idle opens the gate; history-JSON then promotes workflowHistoryReconciled.
    tracker.sessionIdleReconciled = true;
    const promoted = tryReconcileOfficeRunFromWorkflowHistory(tracker, messages, startedAt, {
      replyText: workflowJson,
    });
    expect(promoted).toBe(true);
    expect(isOfficeRunProtocolDischarged(tracker)).toBe(true);
    expect(tracker.workflowHistoryReconciled).toBe(true);
  });

  it('workflow history reconcile promotes on JSON with macOS path backslashes after gateway idle (Model B)', async () => {
    const startedAt = 6_000;
    const workflowJson = `{
  "role": "稿件审查师",
  "step": { "index": 3, "total": 5, "title": "稿件审查" },
  "inputValidation": { "targets": ["a.md"], "lsResult": [] },
  "execution": "完成",
  "outputValidation": {
    "targets": ["交付物-稿件审查师/稿件审查-稿件审查师.md"],
    "lsResult": ["-rw-  YYCLAW-AI\\Domain Users  5378 Jul  6 14:39 交付物-稿件审查师/稿件审查-稿件审查师.md"]
  },
  "deliverable": { "path": "交付物-稿件审查师/稿件审查-稿件审查师.md", "summary": "摘要", "conclusion": "通过" },
  "rollback": "无"
}`;
    const messages = [
      { role: 'user', content: 'go', timestamp: startedAt },
      { role: 'assistant', content: workflowJson, timestamp: startedAt + 500 },
    ];
    const parsed = findLatestParseableWorkflowReplyInRunSegment(messages, startedAt, workflowJson);
    expect(parsed.kind).toBe('ok');
    if (parsed.kind === 'ok') expect(parsed.repaired).toBe(true);

    const tracker = createOfficeRunTracker('run-wf-bs');
    tracker.sessionIdleReconciled = true;
    const opened = tryReconcileOfficeRunFromWorkflowHistory(tracker, messages, startedAt, {
      replyText: workflowJson,
    });
    expect(opened).toBe(true);
    expect(tracker.workflowHistoryReconciled).toBe(true);
    expect(isOfficeRunProtocolDischarged(tracker)).toBe(true);
  });

  it('findLatestParseableWorkflowReplyInRunSegment returns parse_failed for unrecoverable workflow-shaped JSON', () => {
    const startedAt = 6_500;
    const brokenJson = `{
  "role": "稿件审查师",
  "step": { "index": 3, "total": 5, "title": "稿件审查" },
  "inputValidation": { "targets": ["a.md"], "lsResult": [] },
  "execution": "完成",
  "outputValidation": { "targets": ["out.md"], "lsResult": [] },
  "deliverable": { "path": "out.md", "summary": "摘要", "conclusion": "通过" },
  "rollback": "无
}`;
    const messages = [
      { role: 'user', content: 'go', timestamp: startedAt },
      { role: 'assistant', content: brokenJson, timestamp: startedAt + 500 },
    ];
    const result = findLatestParseableWorkflowReplyInRunSegment(messages, startedAt);
    expect(result.kind).toBe('parse_failed');
    if (result.kind === 'parse_failed') {
      expect(result.raw).toBe(brokenJson);
      expect(result.detail).toBeTruthy();
    }
    const tracker = createOfficeRunTracker('run-wf-broken');
    // Model B: gate must be opened by gateway idle before history promotes.
    expect(tryReconcileOfficeRunFromWorkflowHistory(tracker, messages, startedAt)).toBe(false);
    tracker.sessionIdleReconciled = true;
    expect(tryReconcileOfficeRunFromWorkflowHistory(tracker, messages, startedAt)).toBe(true);
    expect(isOfficeRunProtocolDischarged(tracker)).toBe(true);
    expect(tracker.workflowHistoryReconciled).toBe(true);
  });

  it('shouldUseWorkflowSettleFastPath is true when syntax parse fails after repair', () => {
    const startedAt = 6_600;
    const brokenJson = `{
  "role": "稿件审查师",
  "step": { "index": 3, "total": 5, "title": "稿件审查" },
  "inputValidation": { "targets": ["a.md"], "lsResult": [] },
  "execution": "完成",
  "outputValidation": { "targets": ["out.md"], "lsResult": [] },
  "deliverable": { "path": "out.md", "summary": "摘要", "conclusion": "通过" },
  "rollback": "无
}`;
    const messages = [
      { role: 'user', content: 'go', timestamp: startedAt },
      { role: 'assistant', content: brokenJson, timestamp: startedAt + 500 },
    ];
    expect(shouldUseWorkflowSettleFastPath(messages, startedAt, brokenJson)).toBe(true);
    expect(tryHandoffWorkflowSettleSyntaxParseFailure(messages, startedAt, brokenJson)).toBe(brokenJson);
  });

  it('workflow history reconcile promotes workflowHistoryReconciled after main-path session idle', () => {
    const startedAt = 6_700;
    const workflowJson = `{
  "role": "稿件审查师",
  "step": { "index": 3, "total": 5, "title": "稿件审查" },
  "inputValidation": { "targets": ["a.md"], "lsResult": [] },
  "execution": "完成",
  "outputValidation": { "targets": ["out.md"], "lsResult": [] },
  "deliverable": { "path": "out.md", "summary": "摘要", "conclusion": "通过" },
  "rollback": "无"
}`;
    const messages = [
      { role: 'user', content: 'go', timestamp: startedAt },
      { role: 'assistant', content: workflowJson, timestamp: startedAt + 500 },
    ];
    const tracker = createOfficeRunTracker('run-wf-main-idle-first');
    tracker.sessionIdleReconciled = true;
    expect(tracker.workflowHistoryReconciled).toBe(false);
    expect(tryReconcileOfficeRunFromWorkflowHistory(tracker, messages, startedAt)).toBe(true);
    expect(tracker.workflowHistoryReconciled).toBe(true);
  });

  it('workflow history reconcile ignores stale JSON when a newer assistant line exists', () => {
    const startedAt = 7_500;
    const staleJson = `{
  "role": "稿件审查师",
  "step": { "index": 3, "total": 5, "title": "稿件审查" },
  "inputValidation": { "targets": [], "lsResult": [] },
  "execution": "旧稿",
  "outputValidation": { "targets": ["a.md"], "lsResult": [] },
  "deliverable": { "path": "a.md", "summary": "旧", "conclusion": "通过" },
  "rollback": "无"
}`;
    const messages = [
      { role: 'user', content: 'go', timestamp: startedAt },
      { role: 'assistant', content: staleJson, timestamp: startedAt + 200 },
      { role: 'assistant', content: '继续核对目录与字数…', timestamp: startedAt + 400 },
    ];
    expect(findLatestParseableWorkflowReplyInRunSegment(messages, startedAt, staleJson).kind).toBe(
      'pending',
    );
    const tracker = createOfficeRunTracker('run-wf-stale');
    expect(
      tryReconcileOfficeRunFromWorkflowHistory(tracker, messages, startedAt, { replyText: staleJson }),
    ).toBe(false);
  });

  it('workflow history reconcile opens on narration + fenced JSON with macOS lsResult backslashes', () => {
    const startedAt = 8_000;
    const workflowJson = `文档已撰写完成，字数约 5000 字。现在输出结果 JSON：

\`\`\`json
{
  "role": "文档撰写师",
  "step": { "index": 2, "total": 5, "title": "文档撰写" },
  "inputValidation": {
    "targets": ["交付物-数据挖掘师/行业相关信息文字版-数据挖掘师.md", "交付物-数据挖掘师"],
    "lsResult": ["-rw- YYCLAW-AI\\\\Domain Users 15265 交付物-数据挖掘师/a.md", "drwx YYCLAW-AI\\\\Domain Users 96 交付物-数据挖掘师"]
  },
  "execution": "完成",
  "outputValidation": {
    "targets": ["交付物-文档撰写师/GPGPU发展与展望-文档撰写师.md"],
    "lsResult": ["-rw- YYCLAW-AI\\\\Domain Users 21196 交付物-文档撰写师/GPGPU发展与展望-文档撰写师.md"]
  },
  "deliverable": { "path": "交付物-文档撰写师/GPGPU发展与展望-文档撰写师.md", "summary": "摘要", "conclusion": "已交付" },
  "rollback": "无"
}
\`\`\``;
    const messages = [
      { role: 'user', content: 'go', timestamp: startedAt },
      { role: 'assistant', content: workflowJson, stopReason: 'stop', timestamp: startedAt + 120_000 },
    ];
    expect(findLatestParseableWorkflowReplyInRunSegment(messages, startedAt, null, { hasRunningTool: true }).kind).toBe(
      'ok',
    );
    const tracker = createOfficeRunTracker('run-wf-narration');
    tracker.sessionIdleReconciled = true;
    expect(tryReconcileOfficeRunFromWorkflowHistory(tracker, messages, startedAt, {
      runtimeToolSnapshot: { hasRunningTool: true },
    })).toBe(true);
    expect(tracker.workflowHistoryReconciled).toBe(true);
    expect(isOfficeRunProtocolDischarged(tracker)).toBe(true);
  });

  it('sessionListRowAllowsWorkflowHistorySettle permits hasActiveRun after history reconcile', () => {
    const startedAt = Date.now();
    const row = { key: 's', hasActiveRun: true, updatedAt: startedAt + 1_000 };
    expect(sessionListRowAllowsSuccessSettle(row, startedAt)).toBe(false);
    expect(sessionListRowAllowsWorkflowHistorySettle(row, startedAt)).toBe(true);
  });

  it('workflow history reconcile rejects while tool work is in flight', () => {
    const startedAt = 7_000;
    const messages = [
      { role: 'user', content: 'go', timestamp: startedAt },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'read' }],
        stopReason: 'tool_use',
        timestamp: startedAt + 200,
      },
    ];
    const tracker = createOfficeRunTracker('run-wf-tool');
    const opened = tryReconcileOfficeRunFromWorkflowHistory(tracker, messages, startedAt);
    expect(opened).toBe(false);
    expect(isOfficeRunProtocolDischarged(tracker)).toBe(false);
  });

  it('reconcile idle maps sessions.list error status to terminal error, not success gate', () => {
    const tracker = createOfficeRunTracker('run-1');
    const startedAt = Date.now();
    expect(
      sessionListRowIndicatesFailureTerminal({ key: 's', status: 'error', hasActiveRun: false }),
    ).toBe(true);
    expect(
      sessionListRowAllowsSuccessSettle(
        { key: 's', status: 'error', hasActiveRun: false },
        startedAt,
      ),
    ).toBe(false);
    expect(
      sessionListRowAllowsSuccessSettle(
        { key: 's', hasActiveRun: false, updatedAt: startedAt + 1_000 },
        startedAt,
      ),
    ).toBe(true);
    const reconciled = reconcileOfficeRunSessionIdle(
      tracker,
      { key: 's', status: 'error', hasActiveRun: false, updatedAt: startedAt + 1_000 },
      startedAt,
    );
    expect(reconciled).toBe(false);
    expect(tracker.sessionIdleReconciled).toBe(false);
    expect(tracker.terminalErrorEnded).toBe(true);
  });

  it('reconcile idle maps sessions.list timeout to terminal error, not success-idle', () => {
    const tracker = createOfficeRunTracker('run-timeout');
    const startedAt = Date.now();
    expect(
      sessionListRowIndicatesFailureTerminal({ key: 's', status: 'timeout', hasActiveRun: false }),
    ).toBe(true);
    expect(
      sessionListRowAllowsSuccessSettle(
        { key: 's', status: 'timeout', hasActiveRun: false, updatedAt: startedAt + 1_000 },
        startedAt,
      ),
    ).toBe(false);
    const reconciled = reconcileOfficeRunSessionIdle(
      tracker,
      { key: 's', status: 'timeout', hasActiveRun: false, updatedAt: startedAt + 1_000 },
      startedAt,
    );
    expect(reconciled).toBe(false);
    expect(tracker.sessionIdleReconciled).toBe(false);
    expect(tracker.terminalErrorEnded).toBe(true);
    expect(tracker.terminalError).toMatch(/timeout/i);
  });

  it('reconcile idle maps sessions.list killed to terminal error, not success-idle', () => {
    const tracker = createOfficeRunTracker('run-killed');
    const startedAt = Date.now();
    expect(
      sessionListRowIndicatesFailureTerminal({ key: 's', status: 'killed', hasActiveRun: false }),
    ).toBe(true);
    expect(
      sessionListRowAllowsSuccessSettle(
        { key: 's', status: 'killed', hasActiveRun: false, updatedAt: startedAt + 1_000 },
        startedAt,
      ),
    ).toBe(false);
    const reconciled = reconcileOfficeRunSessionIdle(
      tracker,
      { key: 's', status: 'killed', hasActiveRun: false, updatedAt: startedAt + 1_000 },
      startedAt,
    );
    expect(reconciled).toBe(false);
    expect(tracker.terminalErrorEnded).toBe(true);
    expect(tracker.terminalError).toBe('killed');
  });

  it('decideOfficeSettleHashMismatch accepts longer confirm and rejects weaker confirm', () => {
    const baseline = '{"role":"a","step":{},"inputValidation":{},"execution":"","outputValidation":{},"deliverable":{},"rollback":""}';
    const longer = `${baseline.slice(0, -1)},"extra":"more complete"}`;
    const weaker = '{"role":"a"}';
    expect(decideOfficeSettleHashMismatch(baseline, longer, 0).decision).toBe('accept');
    expect(decideOfficeSettleHashMismatch(baseline, weaker, 0).decision).toBe('reject_retry');
    expect(scoreOfficeSettleReplyCompleteness(longer)).toBeGreaterThan(
      scoreOfficeSettleReplyCompleteness(weaker),
    );
  });

  it('does not treat transient state=error as terminal ended', () => {
    const tracker = createOfficeRunTracker('run-1');
    applyOfficeRunGatewayEvent(tracker, { runId: 'run-1', state: 'error' });
    expect(tracker.runComplete).toBe(false);
    expect(tracker.pendingRetry).toBe(true);
    expect(tracker.terminalErrorEnded).toBe(false);
  });

  it('detects in-flight tool_use without tool_result', () => {
    const startedAt = Date.now();
    const messages = [
      { role: 'user', content: 'go', timestamp: startedAt },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'read' }],
        timestamp: startedAt + 100,
      },
    ];
    expect(sessionHasInFlightToolWork(messages, startedAt)).toBe(true);
  });

  it('clears in-flight after tool_result', () => {
    const startedAt = Date.now();
    const messages = [
      { role: 'user', content: 'go', timestamp: startedAt },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'read' }],
        timestamp: startedAt + 100,
      },
      { role: 'tool_result', toolCallId: 't1', content: 'ok', timestamp: startedAt + 200 },
      { role: 'assistant', content: [{ type: 'text', text: 'done' }], timestamp: startedAt + 300 },
    ];
    expect(sessionHasInFlightToolWork(messages, startedAt)).toBe(false);
  });

  it('hashSessionReplyText is stable for same body', () => {
    expect(hashSessionReplyText(' hello ')).toBe(hashSessionReplyText('hello'));
  });

  it('isOfficeRunCompletePhase accepts completed aliases', () => {
    expect(isOfficeRunCompletePhase('completed')).toBe(true);
    expect(isOfficeRunCompletePhase('final')).toBe(false);
  });

  it('does not mark run complete on state=final alone', () => {
    const tracker = createOfficeRunTracker('run-1');
    applyOfficeRunGatewayEvent(tracker, {
      runId: 'run-1',
      state: 'final',
      message: { role: 'assistant', content: 'done' },
    });
    expect(tracker.runComplete).toBe(false);
    expect(tracker.sessionIdleReconciled).toBe(false);
    expect(tracker.pendingRetry).toBe(false);
  });

  it('clears idle reconcile when same run restarts after state=final', () => {
    const tracker = createOfficeRunTracker('run-1');
    tracker.sessionIdleReconciled = true;
    applyOfficeRunGatewayEvent(tracker, { runId: 'run-1', state: 'started' });
    expect(tracker.runComplete).toBe(false);
    expect(tracker.sessionIdleReconciled).toBe(false);
    expect(tracker.pendingRetry).toBe(true);
  });

  it('does not mark run complete on state=final during retry phase', () => {
    const tracker = createOfficeRunTracker('run-1');
    applyOfficeRunGatewayEvent(tracker, { runId: 'run-1', phase: 'retrying same model' });
    applyOfficeRunGatewayEvent(tracker, {
      runId: 'run-1',
      state: 'final',
      phase: 'retrying same model',
      message: { role: 'assistant', content: 'partial' },
    });
    expect(tracker.runComplete).toBe(false);
    expect(tracker.pendingRetry).toBe(true);
  });

  it('isGatewayRunPhaseSettleSignal accepts only run-level lifecycle phase terminals', () => {
    expect(isGatewayRunPhaseSettleSignal({ phase: 'completed' })).toBe(true);
    expect(isGatewayRunPhaseSettleSignal({ phase: 'error' })).toBe(true);
    expect(isGatewayRunPhaseSettleSignal({ phase: 'failed' })).toBe(true);
    expect(isGatewayRunPhaseSettleSignal({ phase: 'aborted' })).toBe(true);
    expect(isGatewayRunPhaseSettleSignal({ phase: 'end' })).toBe(false);
    expect(isGatewayRunPhaseSettleSignal({ phase: 'finishing' })).toBe(false);
    expect(isGatewayRunPhaseSettleSignal({ phase: undefined })).toBe(false);
  });

  it('isGatewayRunTerminalSignal accepts phase completed and state final', () => {
    expect(isGatewayRunTerminalSignal({ phase: 'completed' })).toBe(true);
    expect(isGatewayRunTerminalSignal({ phase: 'error' })).toBe(true);
    expect(isGatewayRunTerminalSignal({ state: 'final' })).toBe(true);
    expect(isGatewayRunTerminalSignal({ state: 'delta' })).toBe(false);
    expect(isGatewayRunTerminalSignal({ phase: 'end' })).toBe(false);
    expect(isGatewayRunTerminalSignal({ state: 'final', phase: 'started' })).toBe(false);
    expect(isGatewayRunTerminalSignal({ state: 'final', phase: 'retrying same model' })).toBe(false);
  });

  it('canAcceptStableSessionReply accepts sessionIdleReconciled', () => {
    const tracker = createOfficeRunTracker('run-1');
    tracker.sessionIdleReconciled = true;
    expect(isOfficeRunSettleGateOpen(tracker)).toBe(true);
    expect(canAcceptStableSessionReply(tracker)).toBe(true);
  });

  it('reconcileOfficeRunSessionIdle respects startedAtMs guard', () => {
    const tracker = createOfficeRunTracker('run-1');
    const startedAt = Date.now();
    expect(
      reconcileOfficeRunSessionIdle(
        tracker,
        { key: 's1', hasActiveRun: false, updatedAt: startedAt - 1_000 },
        startedAt,
      ),
    ).toBe(false);
    expect(
      reconcileOfficeRunSessionIdle(
        tracker,
        { key: 's1', hasActiveRun: false, updatedAt: startedAt + 1_000 },
        startedAt,
      ),
    ).toBe(true);
    expect(tracker.sessionIdleReconciled).toBe(true);
  });

  it('hasPendingToolUseInAssistantMessage detects tool_use stop reason', () => {
    expect(
      hasPendingToolUseInAssistantMessage({
        role: 'assistant',
        stopReason: 'tool_use',
        content: [{ type: 'text', text: 'calling tool' }],
      }),
    ).toBe(true);
    expect(
      hasPendingToolUseInAssistantMessage({
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'read' }],
      }),
    ).toBe(true);
  });

  it('canAcceptStableSessionReply rejects terminal error ended', () => {
    const tracker = createOfficeRunTracker('run-1');
    tracker.runComplete = true;
    tracker.terminalErrorEnded = true;
    expect(canAcceptStableSessionReply(tracker)).toBe(false);
  });
});
// --- merged from office-project.test.ts ---

describe("__merged__:office-project-notebook", () => {
  const task = {
    id: 'task-abc',
    scenarioId: 's1',
    title: '象棋项目',
    description: '',
    status: 'running' as const,
    assignedRoleIds: [],
    nodeRuns: [{ nodeId: 'n1', status: 'running' as const, startedAt: 1 }],
    createdAt: 0,
    updatedAt: 0,
  };

  describe('office-project-notebook', () => {
    it('sanitizes dir name and builds file name with taskId', () => {
      expect(sanitizeNotebookDirName('象棋/项目?')).toBe('象棋_项目_');
      expect(projectNotebookFileName('task-abc')).toBe('项目进度汇报-task-abc.json');
    });

    it('builds coordinator summary lines with owner and status', () => {
      const summary = buildCoordinatorSummaryFromTask({
        task,
        workflowNodes: [
          { id: 'n1', roleId: 'dev', title: '编码', execution: 'serial' },
        ],
        roomMessages: [
          {
            id: 'm1',
            scenarioId: 's1',
            from: 'a1',
            fromRoleId: 'dev',
            content: '进行中',
            mentions: [],
            timestamp: 1_700_000_000_000,
            taskId: 'task-abc',
            nodeId: 'n1',
            phase: 'task_running',
          },
        ],
        roles: [{ id: 'dev', name: '开发' }],
      });
      expect(summary).toContain('任务1:编码');
      expect(summary).toContain('owner:开发');
      expect(summary).toContain('进行中');
    });

    it('formatProjectNotebookPromptBlock includes role section for non-coordinator', () => {
      const block = formatProjectNotebookPromptBlock(
        {
          taskId: 'task-abc',
          taskTitle: '象棋',
          coordinatorSummary: '任务1:编码，owner:开发，时间(—)：进行中',
          updatedAt: 1,
          roles: { dev: '【开发】步骤状态' },
        },
        { isCoordinator: false, viewerRoleId: 'dev' },
      );
      expect(block).toContain('项目进度汇报');
      expect(block).toContain('本角色工作状态');
      expect(block).toContain('【开发】');
    });

    it('role section builder caps content', () => {
      const section = buildRoleNotebookSection({
        roleName: '开发',
        task,
        workflowNodes: [{ id: 'n1', roleId: 'dev', title: '编码', execution: 'serial' }],
        roomMessages: [],
        roleId: 'dev',
        latestReplySnippet: '关于你提到接口问题，方案如下',
      });
      expect(section).toContain('开发');
      expect(section).toContain('关于你提到');
    });
  });

  describe('office-project-notebook-fs', () => {
    const prevHome = process.env.HOME;
    const prevOpenClawHome = process.env.OPENCLAW_HOME;
    let tempHome = '';

    afterEach(async () => {
      if (tempHome) await rm(tempHome, { recursive: true, force: true });
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      if (prevOpenClawHome === undefined) delete process.env.OPENCLAW_HOME;
      else process.env.OPENCLAW_HOME = prevOpenClawHome;
    });

    it('writes and reads notebook via coordinator workspace', async () => {
      tempHome = await mkdtemp(join(tmpdir(), 'openclaw-notebook-'));
      process.env.HOME = tempHome;
      process.env.OPENCLAW_HOME = join(tempHome, '.openclaw');
      vi.resetModules();

      const { PROJECT_PROGRESS_FILE, projectDirSegment } = await import(
        '../../src/lib/office-project-context'
      );
      const { buildCoordinatorPathContext } = await import(
        '../../electron/services/office/project-context-paths'
      );
      const {
        clearProjectNotebook,
        readProjectNotebook,
        writeProjectNotebook,
      } = await import('../../electron/services/office/project-notebook-fs');
      const teamRoles = [{ id: 'coord', agentId: 'main', name: '协调者' }];
      const pathCtx = buildCoordinatorPathContext(
        { coordinatorRoleId: 'coord', coordinatorAgentId: 'main' },
        teamRoles,
      );

      const notebook = {
        taskId: task.id,
        taskTitle: task.title,
        coordinatorSummary: '任务1:编码，owner:开发，时间(—)：尚未开展',
        updatedAt: Date.now(),
        roles: {},
      };
      await writeProjectNotebook(notebook, pathCtx);

      const progressPath = join(
        process.env.OPENCLAW_HOME!,
        'office',
        'project',
        projectDirSegment(task.title, task.id),
        PROJECT_PROGRESS_FILE,
      );
      const raw = await readFile(progressPath, 'utf8');
      expect(JSON.parse(raw).coordinatorSummary).toContain('任务1');

      const readBack = await readProjectNotebook(task.title, task.id, pathCtx);
      expect(readBack?.taskId).toBe(task.id);

      await clearProjectNotebook(task.title, task.id, pathCtx);
      const cleared = await readProjectNotebook(task.title, task.id, pathCtx);
      expect(cleared?.coordinatorSummary).toBe('');
    });
  });
});

describe('office project paths', () => {
  it('builds coordinator-only project root under office/projects', () => {
    const rel = officeProjectRootRelative(
      { agentId: 'coord-agent', name: '协调者' },
      [{ agentId: 'coord-agent', name: '协调者' }],
      '五子棋',
      'task-1',
      '/tmp/.openclaw',
    );
    expect(rel).toBe('/tmp/.openclaw/office/project/task-1');
  });

  it('uses coordinator agent workspace for project root', () => {
    const team = [{ agentId: 'pm', name: '产品' }];
    const rel = officeProjectRootRelative(
      { agentId: 'pm', name: '产品' },
      team,
      '指南',
      'task-9',
      '/home/u/.openclaw',
    );
    expect(rel).toBe('/home/u/.openclaw/office/project/task-9');
  });
});

const ROOT =
  '/Users/coord/.openclaw/workspace-agent-1/office/projects/五子棋-task-abc';
const PRD = `${ROOT}/requirements-产品.md`;
const CODE_DIR = `${ROOT}/交付物-开发`;

describe("__merged__:office-deliverable-path", () => {
  it('collects file and folder paths under coordinator project', () => {
    const text = `【交付产物】\n${PRD}\n工程目录：${CODE_DIR}`;
    const hints = collectDeliverablePathHintsFromText(text);
    expect(hints).toContain(PRD);
    expect(hints).toContain(CODE_DIR);
    expect(isDeliverableFilePathHint(PRD)).toBe(true);
    expect(isDeliverableDirPathHint(CODE_DIR)).toBe(true);
    expect(officeDeliverableDeclaresFilePath(text)).toBe(true);
  });

  it('does not treat project root alone as folder deliverable', () => {
    expect(isDeliverableDirPathHint(ROOT)).toBe(false);
    expect(isDeliverableDirPathHint('交付物-开发')).toBe(true);
    expect(isDeliverableDirPathHint('交付物-开发/')).toBe(true);
    const hints = collectDeliverablePathHintsFromText(`路径：${ROOT}`);
    expect(hints).not.toContain(ROOT);
  });

  it('dedupeUpstreamDeliverablePaths drops nested office/projects duplicates', async () => {
    const { dedupeUpstreamDeliverablePaths } = await import(
      '../../src/lib/office-workflow-prior-context'
    );
    const root =
      '/Users/lixingwei/.openclaw/workspace-pm/office/projects/个税计算器开发-task-1779442564630-de77bj';
    const prd = `${root}/需求说明书-产品.md`;
    const cases = `${root}/测试用例-测试.md`;
    const carvedPrd = `${root}/workspace-pm/office/projects/个税计算器开发-task-1779442564630-de77bj/需求说明书-产品.md`;
    const out = dedupeUpstreamDeliverablePaths([prd, cases, prd, carvedPrd, cases]);
    expect(out).toEqual([prd, cases]);
  });

  it('prefers full coordinator paths and ignores carved /office/projects fragments', () => {
    const text = `${PRD}\nworkspace-agent-1/office/projects/五子棋-task-abc/requirements.md`;
    const hints = collectDeliverablePathHintsFromText(text);
    expect(hints).toContain(PRD);
    expect(hints.some((h) => h.startsWith('/office/projects/'))).toBe(false);
  });

  it('treats text, audio, and program files as substantive deliverables', () => {
    expect(isSubstantiveDeliverableFileName('requirements.docx')).toBe(true);
    expect(isSubstantiveDeliverableFileName('voice-over.mp3')).toBe(true);
    expect(isSubstantiveDeliverableFileName('kernel_template.cu')).toBe(true);
    expect(isSubstantiveDeliverableFileName('kernel.cuh')).toBe(true);
    expect(isSubstantiveDeliverableFileName('analysis.py')).toBe(true);
    expect(isSubstantiveDeliverableFileName('Makefile')).toBe(true);
    expect(isSubstantiveDeliverableFileName('CMakeLists.txt')).toBe(true);
    expect(isSubstantiveDeliverableFileName('Dockerfile')).toBe(true);
    expect(isSubstantiveDeliverableFileName('progress.json')).toBe(false);
  });
});

describe("__merged__:office-project-file-naming", () => {
  it('builds status file name from role display name', () => {
    expect(roleStatusFileName('产品')).toBe('status-产品.ndjson');
    expect(legacyRoleStatusFileName('pm')).toBe('pm-status.ndjson');
  });

  it('scopes deliverable basename with role suffix', () => {
    expect(roleScopedDeliverableFileName('requirements.md', '产品')).toBe(
      'requirements-产品.md',
    );
    expect(roleScopedDeliverableFileName('requirements-产品.md', '产品')).toBe(
      'requirements-产品.md',
    );
    expect(roleScopedDeliverableFileName('deliverables/api-v2.json', '开发')).toBe(
      'api-v2-开发.json',
    );
  });

  it('matches role suffix in deliverable names', () => {
    expect(deliverableFileNameMatchesRole('requirements-产品.md', '产品')).toBe(true);
    expect(deliverableFileNameMatchesRole('requirements-产品-正式版.md', '产品')).toBe(true);
    expect(deliverableFileNameMatchesRole('requirements.md', '产品')).toBe(false);
    expect(
      isUnderRoleScopedDeliverableDir(
        '/proj/交付物-测试/测试验收报告.md',
        '测试',
      ),
    ).toBe(true);
  });

  it('uses fixed 交付物-角色名 for folder deliverables', () => {
    expect(roleScopedDeliverableDirName('开发')).toBe('交付物-开发');
    expect(deliverableDirNameMatchesRole('交付物-开发', '开发')).toBe(true);
    expect(deliverableDirNameMatchesRole('代码实现-开发', '开发')).toBe(false);
  });

  it('treats status ndjson as system artifact', () => {
    expect(isRoleStatusArtifactFileName('status-PM.ndjson')).toBe(true);
    expect(isRoleStatusArtifactFileName('pm-status.ndjson')).toBe(true);
    expect(isRoleStatusArtifactFileName('requirements-产品.md')).toBe(false);
  });

  it('expands path candidates with role-scoped file name', () => {
    const root = '/tmp/proj';
    const candidates = resolveDeliverablePathCandidatesWithRoleScope(
      `${root}/requirements.md`,
      [root],
      '产品',
    );
    expect(candidates).toContain(`${root}/requirements.md`);
    expect(candidates).toContain(`${root}/requirements-产品.md`);
  });

  it('expands path candidates with role-scoped folder name', () => {
    const root = '/Users/u/.openclaw/workspace-pm/office/projects/demo-task';
    const candidates = resolveDeliverablePathCandidatesWithRoleScope(
      `${root}/代码实现-开发`,
      [root],
      '开发',
    );
    expect(candidates).toContain(`${root}/代码实现-开发`);
    expect(candidates).toContain(`${root}/交付物-开发`);
  });

  it('deliverablePathKind distinguishes file and folder hints', () => {
    expect(deliverablePathKind('requirements-产品.md')).toBe('file');
    expect(deliverablePathKind('交付物-开发')).toBe('dir');
    expect(deliverablePathKind('交付物-开发/')).toBe('dir');
    expect(deliverablePathKind(CODE_DIR)).toBe('dir');
    expect(deliverablePathKind(PRD)).toBe('file');
  });

  it('resolveDeliverablePathCandidatesInSearchOrder prefers 交付物-角色 before project root', () => {
    const root = '/tmp/proj';
    const ordered = resolveDeliverablePathCandidatesInSearchOrder(
      'chinese-chess.html',
      [root],
      '开发',
    );
    expect(ordered).toContain(`${root}/chinese-chess.html`);
    expect(ordered).toContain(`${root}/交付物-开发/chinese-chess.html`);
    const rootIdx = ordered.indexOf(`${root}/chinese-chess.html`);
    const scopedIdx = ordered.indexOf(`${root}/交付物-开发/chinese-chess.html`);
    expect(rootIdx).toBeGreaterThanOrEqual(0);
    expect(scopedIdx).toBeGreaterThanOrEqual(0);
    expect(scopedIdx).toBeLessThan(rootIdx);
    expect(ordered[0]).toBe(`${root}/交付物-开发/chinese-chess.html`);
  });

  it('formatLsLongLinesForDeliverableHints finds file under 交付物-角色 when missing at project root', async () => {
    const { mkdir, writeFile } = await import('fs/promises');
    const { formatLsLongLinesForDeliverableHints } = await import(
      '../../electron/services/office/workflow-project-deliverable-fs'
    );
    const root = await mkdtemp(join(tmpdir(), 'sc-ls-scoped-'));
    try {
      const scopedDir = join(root, '交付物-开发');
      await mkdir(scopedDir, { recursive: true });
      const filePath = join(scopedDir, 'chinese-chess.html');
      await writeFile(filePath, '<html>'.repeat(20), 'utf8');
      const { lines, resolvedPaths, missingHints } = await formatLsLongLinesForDeliverableHints(
        ['chinese-chess.html'],
        { projectRoot: root, roleName: '开发' },
      );
      expect(missingHints).toEqual([]);
      expect(resolvedPaths).toEqual([filePath]);
      expect(lines[0]).toMatch(/^-rw-r--r--/);
      expect(lines[0]).toContain('chinese-chess.html');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('formatLsLongLinesForDeliverableHints treats 交付物-开发 as folder not file', async () => {
    const { mkdir, writeFile } = await import('fs/promises');
    const { formatLsLongLinesForDeliverableHints } = await import(
      '../../electron/services/office/workflow-project-deliverable-fs'
    );
    const root = await mkdtemp(join(tmpdir(), 'sc-ls-dir-'));
    try {
      const scopedDir = join(root, '交付物-开发');
      await mkdir(scopedDir, { recursive: true });
      await writeFile(join(scopedDir, 'index.html'), '<html>'.repeat(20), 'utf8');
      const { lines, resolvedPaths, missingHints } = await formatLsLongLinesForDeliverableHints(
        ['交付物-开发'],
        { projectRoot: root, roleName: '开发' },
      );
      expect(missingHints).toEqual([]);
      expect(resolvedPaths).toEqual([scopedDir]);
      expect(lines[0]).toMatch(/^d\w+-r--r--/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('formatLsLongLinesForDeliverableHints resolves basename under project root', async () => {
    const { writeFile } = await import('fs/promises');
    const { formatLsLongLinesForDeliverableHints } = await import(
      '../../electron/services/office/workflow-project-deliverable-fs'
    );
    const root = await mkdtemp(join(tmpdir(), 'sc-ls-'));
    try {
      const filePath = join(root, 'test-测试.md');
      await writeFile(filePath, '#'.repeat(40), 'utf8');
      const { lines, resolvedPaths, missingHints } = await formatLsLongLinesForDeliverableHints(
        ['test-测试.md'],
        { projectRoot: root, roleName: '测试' },
      );
      expect(missingHints).toEqual([]);
      expect(resolvedPaths).toEqual([filePath]);
      expect(lines[0]).toMatch(/^-rw-r--r--/);
      expect(lines[0]).toContain('test-测试.md');
      expect(lines[0]).not.toMatch(/cannot access/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('office workspace layout', () => {
  it('defaults to 65:35 zone vs project rooms split', async () => {
    const {
      OFFICE_ROOM_DEFAULT_WIDTH_PCT,
      OFFICE_ZONE_DEFAULT_WIDTH_PCT,
      OFFICE_ROOM_MIN_WIDTH_PCT,
      OFFICE_ROOM_MAX_WIDTH_PCT,
    } = await import('@/lib/office-layout');
    expect(OFFICE_ZONE_DEFAULT_WIDTH_PCT).toBe(65);
    expect(OFFICE_ROOM_DEFAULT_WIDTH_PCT).toBe(35);
    expect(OFFICE_ROOM_MIN_WIDTH_PCT).toBeLessThan(OFFICE_ROOM_DEFAULT_WIDTH_PCT);
    expect(OFFICE_ROOM_MAX_WIDTH_PCT).toBeGreaterThan(OFFICE_ROOM_DEFAULT_WIDTH_PCT);
  });

  it('clamps persisted project room width', async () => {
    const { useOfficeWorkspaceSplit } = await import('@/stores/office-workspace-split');
    const { OFFICE_ROOM_MIN_WIDTH_PCT, OFFICE_ROOM_MAX_WIDTH_PCT } = await import(
      '@/lib/office-layout'
    );
    useOfficeWorkspaceSplit.getState().setRoomWidthPct(5);
    expect(useOfficeWorkspaceSplit.getState().roomWidthPct).toBe(OFFICE_ROOM_MIN_WIDTH_PCT);
    useOfficeWorkspaceSplit.getState().setRoomWidthPct(90);
    expect(useOfficeWorkspaceSplit.getState().roomWidthPct).toBe(OFFICE_ROOM_MAX_WIDTH_PCT);
    useOfficeWorkspaceSplit.getState().setRoomWidthPct(35);
  });
});

describe('isOfficeCompactViewport', () => {
  beforeEach(() => {
    vi.stubGlobal('innerWidth', 1400);
    vi.stubGlobal('innerHeight', 900);
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is not compact when viewport is large and not fullscreen-forced', async () => {
    const {
      isOfficeCompactViewport,
      OFFICE_COMPACT_MAX_WIDTH,
      OFFICE_COMPACT_MAX_HEIGHT,
    } = await import('@/hooks/use-office-viewport-chrome');
    vi.stubGlobal('innerWidth', OFFICE_COMPACT_MAX_WIDTH + 100);
    vi.stubGlobal('innerHeight', OFFICE_COMPACT_MAX_HEIGHT + 100);
    expect(isOfficeCompactViewport()).toBe(false);
  });

  it('is compact when width is below threshold', async () => {
    const { isOfficeCompactViewport, OFFICE_COMPACT_MAX_WIDTH } = await import(
      '@/hooks/use-office-viewport-chrome'
    );
    vi.stubGlobal('innerWidth', OFFICE_COMPACT_MAX_WIDTH - 1);
    expect(isOfficeCompactViewport()).toBe(true);
  });

  it('is compact when height is below threshold', async () => {
    const { isOfficeCompactViewport, OFFICE_COMPACT_MAX_HEIGHT } = await import(
      '@/hooks/use-office-viewport-chrome'
    );
    vi.stubGlobal('innerHeight', OFFICE_COMPACT_MAX_HEIGHT - 1);
    expect(isOfficeCompactViewport()).toBe(true);
  });

  it('is not compact in fullscreen even when dimensions are small', async () => {
    const { isOfficeCompactViewport } = await import('@/hooks/use-office-viewport-chrome');
    vi.stubGlobal('innerWidth', 800);
    vi.stubGlobal('innerHeight', 600);
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: document.documentElement,
    });
    expect(isOfficeCompactViewport()).toBe(false);
  });
});

describe('OfficeSyncRuntime', () => {
  beforeEach(() => {
    syncGetRoomMessages.mockReset();
    syncListTasks.mockReset();
    syncReconcileScenarioTaskProgress.mockReset();
    syncGetRoomMessages.mockResolvedValue([]);
    syncListTasks.mockResolvedValue([]);
  });

  afterEach(async () => {
    const { resetOfficeSyncRuntimeForTest } = await import(
      '../../electron/services/office/office-sync-runtime'
    );
    resetOfficeSyncRuntimeForTest();
  });

  it('ref-counts execution leases for sync active state', async () => {
    vi.useFakeTimers();
    const {
      acquireOfficeExecutionSync,
      isOfficeExecutionSyncActive,
      notifyOfficeProjectRunStarted,
      notifyOfficeProjectRunStopped,
      releaseOfficeExecutionSync,
      resetOfficeSyncRuntimeForTest,
    } = await import('../../electron/services/office/office-sync-runtime');
    resetOfficeSyncRuntimeForTest();
    expect(isOfficeExecutionSyncActive()).toBe(false);
    acquireOfficeExecutionSync();
    expect(isOfficeExecutionSyncActive()).toBe(true);
    acquireOfficeExecutionSync();
    releaseOfficeExecutionSync();
    expect(isOfficeExecutionSyncActive()).toBe(true);
    releaseOfficeExecutionSync();
    expect(isOfficeExecutionSyncActive()).toBe(false);

    notifyOfficeProjectRunStarted('p1');
    notifyOfficeProjectRunStarted('p2');
    expect(isOfficeExecutionSyncActive()).toBe(true);
    notifyOfficeProjectRunStopped('p1');
    expect(isOfficeExecutionSyncActive()).toBe(true);
    notifyOfficeProjectRunStopped('p2');
    expect(isOfficeExecutionSyncActive()).toBe(false);

    notifyOfficeProjectRunStarted('p-overlap');
    notifyOfficeProjectRunStarted('p-overlap');
    expect(isOfficeExecutionSyncActive()).toBe(true);
    notifyOfficeProjectRunStopped('p-overlap');
    expect(isOfficeExecutionSyncActive()).toBe(true);
    notifyOfficeProjectRunStopped('p-overlap');
    expect(isOfficeExecutionSyncActive()).toBe(false);
    vi.useRealTimers();
  });

  it('refresh does not stop polling for live in-memory project runs', async () => {
    const { listTempProjects } = await import('../../electron/services/office/store');
    const {
      isOfficeExecutionSyncActive,
      notifyOfficeProjectRunStarted,
      refreshOfficeExecutionSyncPolling,
      resetOfficeSyncRuntimeForTest,
    } = await import('../../electron/services/office/office-sync-runtime');
    resetOfficeSyncRuntimeForTest();
    vi.mocked(listTempProjects).mockResolvedValue([]);
    notifyOfficeProjectRunStarted('live-run');
    expect(isOfficeExecutionSyncActive()).toBe(true);
    await refreshOfficeExecutionSyncPolling();
    expect(isOfficeExecutionSyncActive()).toBe(true);
  });

  it('rejects scheduled room reads when polling is inactive', async () => {
    const { scheduleOfficeRoomMessages } = await import(
      '../../electron/services/office/office-project-room-sync'
    );
    const { OfficeSyncPollingInactiveError } = await import(
      '../../electron/services/office/office-sync-polling-error'
    );
    const { resetOfficeSyncRuntimeForTest } = await import(
      '../../electron/services/office/office-sync-runtime'
    );
    resetOfficeSyncRuntimeForTest();
    await expect(scheduleOfficeRoomMessages('task-a')).rejects.toBeInstanceOf(
      OfficeSyncPollingInactiveError,
    );
  });

  it('allows urgent room reads when polling is inactive', async () => {
    const { scheduleOfficeRoomMessages } = await import(
      '../../electron/services/office/office-project-room-sync'
    );
    const { resetOfficeSyncRuntimeForTest } = await import(
      '../../electron/services/office/office-sync-runtime'
    );
    resetOfficeSyncRuntimeForTest();
    await expect(scheduleOfficeRoomMessages('task-a', { urgent: true })).resolves.toEqual([]);
    expect(syncGetRoomMessages).toHaveBeenCalledTimes(1);
  });

  it('isOfficeExecutionSyncActiveForPolling reflects persisted executing tasks', async () => {
    const { listTempProjects } = await import('../../electron/services/office/store');
    const {
      isOfficeExecutionSyncActive,
      isOfficeExecutionSyncActiveForPolling,
      resetOfficeSyncRuntimeForTest,
    } = await import('../../electron/services/office/office-sync-runtime');
    resetOfficeSyncRuntimeForTest();
    vi.mocked(listTempProjects).mockResolvedValue([
      { id: 't1', status: 'running', nodeRuns: [], lifecycle: 'active' } as never,
    ]);
    expect(isOfficeExecutionSyncActive()).toBe(false);
    await expect(isOfficeExecutionSyncActiveForPolling()).resolves.toBe(true);
  });

  it('isOfficeExecutionSyncActiveForPolling ignores archived executing tasks', async () => {
    const { listTempProjects } = await import('../../electron/services/office/store');
    const {
      isOfficeExecutionSyncActiveForPolling,
      resetOfficeSyncRuntimeForTest,
    } = await import('../../electron/services/office/office-sync-runtime');
    resetOfficeSyncRuntimeForTest();
    vi.mocked(listTempProjects).mockResolvedValue([
      {
        id: 't-archived',
        status: 'running',
        nodeRuns: [{ nodeId: 'n1', agentId: 'a1', status: 'running' }],
        lifecycle: 'completed',
      } as never,
    ]);
    await expect(isOfficeExecutionSyncActiveForPolling()).resolves.toBe(false);
  });

  it('keeps batch polling enabled after refresh when persisted task is still running', async () => {
    const { scheduleOfficeRoomMessages } = await import(
      '../../electron/services/office/office-project-room-sync'
    );
    const { listTempProjects } = await import('../../electron/services/office/store');
    const {
      refreshOfficeExecutionSyncPolling,
      resetOfficeSyncRuntimeForTest,
    } = await import('../../electron/services/office/office-sync-runtime');
    resetOfficeSyncRuntimeForTest();
    vi.mocked(listTempProjects).mockResolvedValue([
      { id: 't1', status: 'running', nodeRuns: [], lifecycle: 'active' } as never,
    ]);
    await refreshOfficeExecutionSyncPolling();
    await expect(scheduleOfficeRoomMessages('task-a')).resolves.toEqual([]);
  });
});

describe('OfficeProjectRoomSync', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    const {
      acquireOfficeExecutionSync,
      resetOfficeSyncRuntimeForTest,
    } = await import('../../electron/services/office/office-sync-runtime');
    const { resetOfficeProjectRoomSyncForTest } = await import(
      '../../electron/services/office/office-project-room-sync'
    );
    resetOfficeSyncRuntimeForTest();
    resetOfficeProjectRoomSyncForTest();
    acquireOfficeExecutionSync();
    syncGetRoomMessages.mockReset();
    syncReconcileScenarioTaskProgress.mockReset();
    syncListTasks.mockReset();
    syncGetRoomMessages.mockResolvedValue([{ id: 'm1', taskId: 'task-a', content: 'hi' }]);
    syncReconcileScenarioTaskProgress.mockResolvedValue(0);
    syncListTasks.mockResolvedValue([{ id: 'task-a', scenarioId: 'scenario-1' }]);
  });

  afterEach(async () => {
    vi.useRealTimers();
    const { resetOfficeSyncRuntimeForTest } = await import(
      '../../electron/services/office/office-sync-runtime'
    );
    resetOfficeSyncRuntimeForTest();
  });

  it('coalesces normal requests for the same task within one tick', async () => {
    const { scheduleOfficeRoomMessages } = await import(
      '../../electron/services/office/office-project-room-sync'
    );
    const first = scheduleOfficeRoomMessages('task-a');
    const second = scheduleOfficeRoomMessages('task-a');

    await vi.advanceTimersByTimeAsync(3_000);
    await Promise.all([first, second]);

    expect(syncGetRoomMessages).toHaveBeenCalledTimes(1);
    expect(syncGetRoomMessages).toHaveBeenCalledWith('task-a');
    expect(syncReconcileScenarioTaskProgress).toHaveBeenCalledTimes(1);
    expect(syncReconcileScenarioTaskProgress).toHaveBeenCalledWith('scenario-1');
  });

  it('flushes different tasks on the same tick with one read each', async () => {
    const { scheduleOfficeRoomMessages } = await import(
      '../../electron/services/office/office-project-room-sync'
    );
    syncListTasks.mockResolvedValue([
      { id: 'task-a', scenarioId: 'scenario-1' },
      { id: 'task-b', scenarioId: 'scenario-1' },
    ]);

    const a = scheduleOfficeRoomMessages('task-a');
    const b = scheduleOfficeRoomMessages('task-b');

    await vi.advanceTimersByTimeAsync(3_000);
    await Promise.all([a, b]);

    expect(syncGetRoomMessages).toHaveBeenCalledTimes(2);
    expect(syncReconcileScenarioTaskProgress).toHaveBeenCalledTimes(1);
  });

  it('urgent bypasses the tick for that task', async () => {
    const { scheduleOfficeRoomMessages } = await import(
      '../../electron/services/office/office-project-room-sync'
    );
    const urgent = scheduleOfficeRoomMessages('task-a', { urgent: true });
    await urgent;

    expect(syncGetRoomMessages).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(syncGetRoomMessages).toHaveBeenCalledTimes(1);
  });
});

describe('OfficeSessionHistorySync', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    const {
      acquireOfficeExecutionSync,
      resetOfficeSyncRuntimeForTest,
    } = await import('../../electron/services/office/office-sync-runtime');
    const { resetOfficeSessionHistorySyncForTest } = await import(
      '../../electron/services/office/office-session-history-sync'
    );
    resetOfficeSyncRuntimeForTest();
    resetOfficeSessionHistorySyncForTest();
    acquireOfficeExecutionSync();
  });

  afterEach(async () => {
    vi.useRealTimers();
    const { resetOfficeSyncRuntimeForTest } = await import(
      '../../electron/services/office/office-sync-runtime'
    );
    resetOfficeSyncRuntimeForTest();
  });

  it('coalesces normal requests for the same session within one tick', async () => {
    const { scheduleOfficeChatHistory } = await import(
      '../../electron/services/office/office-session-history-sync'
    );
    const rpc = vi.fn().mockResolvedValue({ messages: [{ role: 'assistant' }] });
    const gateway = { rpc } as unknown as import('../../electron/gateway/manager').GatewayManager;

    const first = scheduleOfficeChatHistory(gateway, 'agent:office:a', 80);
    const second = scheduleOfficeChatHistory(gateway, 'agent:office:a', 80);

    await vi.advanceTimersByTimeAsync(3_000);
    await Promise.all([first, second]);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      'chat.history',
      { sessionKey: 'agent:office:a', limit: 80 },
      60_000,
    );
  });

  it('flushes different sessions on the same tick with one RPC each', async () => {
    const { scheduleOfficeChatHistory } = await import(
      '../../electron/services/office/office-session-history-sync'
    );
    const rpc = vi.fn().mockResolvedValue({ messages: [] });
    const gateway = { rpc } as unknown as import('../../electron/gateway/manager').GatewayManager;

    const a = scheduleOfficeChatHistory(gateway, 'agent:office:a', 80);
    const b = scheduleOfficeChatHistory(gateway, 'agent:office:b', 80);

    await vi.advanceTimersByTimeAsync(3_000);
    await Promise.all([a, b]);

    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('urgent bypasses the tick for that session', async () => {
    const { scheduleOfficeChatHistory } = await import(
      '../../electron/services/office/office-session-history-sync'
    );
    const rpc = vi.fn().mockResolvedValue({ messages: [{ role: 'assistant', content: 'ok' }] });
    const gateway = { rpc } as unknown as import('../../electron/gateway/manager').GatewayManager;

    const urgent = scheduleOfficeChatHistory(gateway, 'agent:office:u', 80, { urgent: true });
    await urgent;

    expect(rpc).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('reuses cached chat.history param style after first successful RPC', async () => {
    const { scheduleOfficeChatHistory } = await import(
      '../../electron/services/office/office-session-history-sync'
    );
    const rpc = vi.fn().mockResolvedValue({ messages: [] });
    const gateway = { rpc } as unknown as import('../../electron/gateway/manager').GatewayManager;

    await scheduleOfficeChatHistory(gateway, 'agent:office:cached', 80, { urgent: true });
    await scheduleOfficeChatHistory(gateway, 'agent:office:cached', 80, { urgent: true });

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      'chat.history',
      { sessionKey: 'agent:office:cached', limit: 80 },
      60_000,
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      'chat.history',
      { sessionKey: 'agent:office:cached', limit: 80 },
      60_000,
    );
  });
});
