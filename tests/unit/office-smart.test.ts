// Merged office unit tests — 7 sources
import { afterEach, describe, it, expect, vi } from 'vitest';
import { agent, SMART_AGENTS, smartTeamCore } from '../helpers/office-agents';
import * as officeStore from '../../electron/services/office/store';
import {
  buildSmartTaskKickoffRoomLine,
  SMART_TASK_COMPLETE_MARKERS,
} from '../../electron/services/office/smart-task-prompt';
import {
  endSmartTaskRun,
  findCoordinatorProjectClosureInRoom,
  isSmartTaskMarkedRunning,
  attemptSmartTaskAutoCompletionFromRoom,
  evaluateSmartTaskClosureGate,
  maybeCompleteSmartTaskFromCoordinatorReply,
  registerSmartTaskRun,
} from '../../electron/services/office/smart-task-completion';
import { shouldMarkSmartTaskRunningAfterCoordinatorDispatch } from '../../electron/services/office/smart-task-runner';
import {
  shouldImmediateSmartUserRoomCoordinatorIntervention,
  shouldScheduleSmartBroadcastCoordinatorWatch,
} from '../../src/lib/office-execution-mode-policy';
import {
  buildSmartCoordinatorCompactProgressContext,
  buildSmartMentionProgressContextBlock,
} from '../../src/lib/office-mention-progress-context';
import { buildSmartRoomMentionAgentPrompt } from '../../electron/services/office/room-prompts/smart/mention-prompt';
import {
  applySmartDirectMentionTargets,
} from '../../electron/services/office/room-dispatch-policy';
import {
  classifySmartMemberReportToCoordinator,
  hasCoordinatorDirectAssignmentToRole,
  inferSmartMemberReadinessForMention,
  isSmartCoordinatorProgressSyncReply,
  resolveSmartMemberReadiness,
  resolveSmartMemberReadinessForMentionDispatch,
  smartMemberMentionRoomLine,
  validateSmartMemberRoomReply,
} from '../../src/lib/office-smart-member-reply';
import { isSmartMemberInputValidationFailureReport } from '../../src/lib/office-smart-input-validation';
import {
  validateSmartWorkflowMirrorSections,
} from '../../src/lib/office-workflow-output-sections';
import {
  smartCoordinatorHasDecomposedInRoom,
  smartCoordinatorNeedsDecomposition,
  smartCoordinatorReplyDispatchesMembers,
  isSmartCoordinatorKickoffDecompositionText,
  isSmartCoordKickoffTriggerMessageId,
  shouldSkipStaleSmartKickoffMemberDispatch,
} from '../../electron/services/office/role-assignment-lookup';
import {
  shouldSkipSmartMemberDispatchAfterCompletedReport,
} from '../../src/lib/office-smart-member-dispatch-guard';
import { filterFollowUpMentionTargets } from '../../electron/services/office/room-follow-up-policy';
import { pickRolesDelegatedByCoordinator } from '../../electron/services/office/room-coordinator-delegates';
import {
  validationSectionDocumentsLsForPaths,
} from '../../src/lib/office-deliverable-ls-verify';
import { collectDeliverablePathHintsFromText } from '../../src/lib/office-workflow-project-deliverable';
import { resolveSmartValidationScope } from '../../src/lib/office-smart-validation-scope';
import {
  buildSmartTeamMentionRosterBlock,
  isSmartWorkOrderStepDoneInRoom,
  pendingExecutorsInSmartWorkOrderStep,
  resolveSmartNextExecutorRoleId,
  resolveSmartNextExecutorRoleIds,
  resolveSmartPriorProducerRoleId,
  resolveSmartPriorStepProducerRoleIds,
  resolveSmartWorkOrderSteps,
  roleReportedSubtaskDoneInRoom,
  smartReadyForProjectClosure,
} from '../../src/lib/office-smart-work-order';
import {
  clampSmartCoordinatorDispatchText,
  collectSmartCoordinatorMentionedRoleIds,
  smartCoordinatorAllowedDispatchRoleIds,
  isSmartProjectEngineComplete,
  validateSmartCoordinatorProjectEnd,
  smartCoordinatorReplyIsDispatching,
  smartCoordinatorShouldValidateAssignMentions,
  validateSmartCoordinatorRoomMentions,
  coordinatorRoomReplyClaimsRoleSubtaskComplete,
  findSmartCoordinatorPrematurePeerAcceptanceRoleIds,
  resolveCoordinatorPeerAcceptanceScanText,
} from '../../src/lib/office-smart-coordinator-dispatch';
import {
  asTeamMemberArray,
  normalizeTeamMembers,
  resolveTeamAgentId,
} from '../../src/lib/office-agent-id-resolve';
import { resolveMentionTargets } from '../../src/lib/office-mention-parse';
import { validateRoomMentionStructuredReply } from '../../electron/services/office/room-mention-structured-reply';
import type { OfficeScenario, OfficeTask, RoomMessage } from '../../src/types/office';
import type { SmartWorkOrderStep } from '../../src/lib/office-smart-work-order';
import {
  buildSmartProgressNudgeLine,
  formatSmartProgressElapsedMs,
  planSmartProgressNudge,
  smartAllWorkOrderStepsDoneInRoom,
  smartCoordinatorRepliedSubstantivelySince,
  SMART_ENGINE_NUDGE_INTERVAL_MS,
  SMART_KICKOFF_COORDINATOR_DEADLINE_MS,
  SMART_NUDGE_COOLDOWN_MS,
  SMART_STALL_NUDGE_AFTER_MS,
} from '../../src/lib/office-smart-progress-policy';
import {
  dedupeMentionTargetsByRoleId,
  isSmartMemberInboundCoordinatorDispatch,
  mergeSmartMentionTriggerContent,
  resolveMergedSmartCoordinatorPromptVariant,
  resolveSmartMentionDispatchRoundId,
  resolveSmartMentionRoundId,
  resolveSmartMentionSessionRoundId,
  smartMentionSessionIdempotencyKey,
  SMART_MEMBER_INBOUND_COORDINATOR_INFLIGHT_SUFFIX,
} from '../../src/lib/office-smart-mention-normalize';
import {
  parseSmartJsonOutputDetailed,
  SMART_JSON_DISPATCH_MAX_CHARS,
  SMART_JSON_TASK_UNDERSTANDING_MAX_CHARS,
} from '../../src/lib/office-smart-json-schema';
import { validateSmartRoomJsonStructure } from '../../src/lib/office-smart-json-validate';
import {
  clearSmartMemberReportInboundDedupForTask,
  coordinatorAlreadyAddressedMemberReportInRoom,
  coordinatorReceiptAckExistsForMemberReport,
  isSmartMemberReportHandledByCoordinatorInbound,
  registerSmartMemberReportsHandledByCoordinatorInbound,
  shouldSkipSmartCoordinatorMemberReportInbound,
} from '../../src/lib/office-smart-member-report-inbound-dedup';
import {
  isRoomCoordinatorReceiptAckText,
  isRoomFastAckText,
} from '../../src/lib/office-room-fast-ack';
import {
  clearSmartMentionDispatchInflightForTask,
  isSmartMentionDispatchInflight,
  isStaleSmartMentionDispatchForTesting,
  mergeAllSmartMemberInboundWorkForTesting,
  mergeSmartPendingDispatchForPassForTesting,
  pushSmartMemberInboundWorkForTesting,
  resetSmartMemberInboundQueuesForTesting,
  smartMemberInboundQueueDepthForTesting,
} from '../../electron/services/office/room-mention-dispatch';
import {
  buildSmartCoordinatorFewShotBlock,
  buildSmartCoordinatorRolePromptBlock,
} from '../../electron/services/office/room-prompts/smart/coordinator-role-prompt';
import {
  buildSmartMemberFewShotBlock,
  buildSmartMemberRolePromptBlock,
} from '../../electron/services/office/room-prompts/smart/member-role-prompt';
import { roomMentionFewShotBlock } from '../../electron/services/office/room-prompts/few-shots';

const smartProgressSteps: SmartWorkOrderStep[] = [
  { stepIndex: 1, nodeId: 'n1', title: '需求', roleIds: ['a-pm'] },
  { stepIndex: 2, nodeId: 'n2', title: '开发', roleIds: ['a-dev'] },
];

const smartProgressTeam = smartTeamCore();

function mockSmartRunningProject(opts?: {
  projectId?: string;
  agentIds?: string[];
  groupId?: string;
  title?: string;
}) {
  const projectId = opts?.projectId ?? 't1';
  const agentIds = opts?.agentIds ?? ['a-coord', 'a-qa', 'a-dev'];
  const groupId = opts?.groupId ?? 's1';
  const now = Date.now();
  vi.spyOn(officeStore, 'getTempProject').mockResolvedValue({
    id: projectId,
    title: opts?.title ?? '象棋',
    origin: 'fixed_group',
    parentGroupId: groupId,
    agentIds,
    coordinatorAgentId: 'a-coord',
    lifecycle: 'active',
    featureDescription: '',
    description: '',
    status: 'running',
    executionMode: 'smart',
    nodeRuns: [],
    createdAt: now,
    updatedAt: now,
  });
  vi.spyOn(officeStore, 'listFixedGroups').mockResolvedValue([
    {
      id: groupId,
      name: '场景',
      agentIds,
      coordinatorAgentId: 'a-coord',
      workflow: { mode: 'dag', nodes: [], edges: [] },
      createdAt: now,
      updatedAt: now,
    },
  ]);
  return { now, projectId, agentIds, groupId };
}

async function mockDeliverablesBundlePublish() {
  const bundleMod = await import('../../electron/services/office/project-deliverables-bundle');
  vi.spyOn(bundleMod, 'buildProjectDeliverablesZipArchive').mockResolvedValue(null);
  return vi.spyOn(officeStore, 'appendRoomMessage').mockImplementation(async (msg) => msg);
}

function smartDeliverableDir(roleName: string) {
  const dir = `交付物-${roleName}`;
  const file = `${dir}/deliverable-${roleName}.md`;
  return {
    items: [file],
    outputValidation: [`-rw-r--r-- 1 demo staff 64 May 26 15:28 ${file}`],
  };
}

function smartDispatch(
  _action: 'assign' | 'review' | 'end' | 'help',
  roleTask: Array<{ role: string; task: string }> = [],
) {
  return roleTask;
}

describe("__merged__:office-smart-mention-progress", () => {
  const task: OfficeTask = {
    id: 't-smart',
    scenarioId: 's1',
    title: '智能项目',
    description: '',
    status: 'running',
    executionMode: 'smart',
    assignedRoleIds: [],
    nodeRuns: [],
    createdAt: 0,
    updatedAt: 0,
  };

  describe('office smart mention progress', () => {
    it('includes saved section and room history for the viewer', () => {
      const room: RoomMessage[] = [
        {
          id: 'm1',
          scenarioId: 's1',
          from: 'dev',
          fromAgentId: 'a-dev',
          content: '【开发】模块 A 已完成',
          mentions: [],
          timestamp: 1,
          projectId: 't-smart',
          phase: 'task_deliver',
        },
      ];
      const block = buildSmartMentionProgressContextBlock({
        task,
        roomMessages: room,
        roles: [agent('a-dev', '开发')],
        viewerAgentId: 'a-dev',
        isCoordinator: false,
        savedRoleSections: { 'a-dev': '【开发】近期：编码完成' },
      });
      expect(block).toContain('我的工作进展');
      expect(block).toContain('已保存进展');
      expect(block).toContain('编码完成');
      expect(block).toContain('模块 A 已完成');
      expect(block).toContain('【Smart·进展】');
    });

    it('coordinator compact progress uses one line per role without room bullets', () => {
      const block = buildSmartCoordinatorCompactProgressContext({
        task,
        roles: [
          agent('a-product', '产品'),
          agent('a-dev', '开发'),
        ],
        savedRoleSections: {
          'a-product': '【产品】需求已定稿',
          'a-dev': '尚无',
        },
        coordinatorSummary: '已 @产品 启动',
      });
      expect(block).toContain('【进展摘要】');
      expect(block).toContain('· 产品：');
      expect(block).toContain('· 开发：');
      expect(block).not.toContain('群聊记录：');
      expect(block).not.toContain('功能范围');
    });

    it('coordinator compact progress hides unreported peers when room gate enabled', () => {
      const room: RoomMessage[] = [
        {
          id: 'm1',
          projectId: 't-smart',
          from: 'product',
          fromAgentId: 'a-product',
          content: '**需求文档已完成**',
          smartMemberEnd: true,
          timestamp: 1,
        },
      ];
      const block = buildSmartCoordinatorCompactProgressContext({
        task,
        roles: [
          agent('a-product', '产品'),
          agent('a-dev', '开发'),
        ],
        savedRoleSections: {
          'a-product': '【产品】需求已定稿',
          'a-dev': '【开发】代码已落盘但未汇报',
        },
        roomMessages: room,
      });
      expect(block).toContain('· 产品：');
      expect(block).toContain('需求已定稿');
      expect(block).toContain('· 开发：尚未在群内汇报');
      expect(block).not.toContain('代码已落盘');
    });
  });

  describe('coordinator peer acceptance gate', () => {
    const team = [
      agent('a-coord', 'PM'),
      agent('a-product', '产品'),
      agent('a-dev', '开发'),
    ];

    it('detects premature peer completion claims in roomReply', () => {
      expect(
        coordinatorRoomReplyClaimsRoleSubtaskComplete(
          '**产品需求已完成**，开发实现也已完成，请继续。',
          '开发',
        ),
      ).toBe(true);
      expect(
        coordinatorRoomReplyClaimsRoleSubtaskComplete(
          '产品需求已验收；@开发 请尽快汇报 **开发任务已完成**。',
          '开发',
        ),
      ).toBe(false);
    });

    it('findSmartCoordinatorPrematurePeerAcceptanceRoleIds uses room gate only', () => {
      const room: RoomMessage[] = [
        {
          id: 'm1',
          projectId: 't1',
          from: 'product',
          fromAgentId: 'a-product',
          content: '**需求已完成**',
          smartMemberEnd: true,
          timestamp: 1,
        },
      ];
      expect(
        findSmartCoordinatorPrematurePeerAcceptanceRoleIds({
          roomReplyText: '产品已验收，开发也已完成。',
          coordinatorAgentId: 'a-coord',
          teamRoles: team,
          roomMessages: room,
          projectId: 't1',
        }),
      ).toEqual(['a-dev']);
    });

    it('coerces single roster object (non-array) without teamMembers.map crash', () => {
      const single = { agentId: 'a-dev', displayName: '开发' } as const;
      expect(asTeamMemberArray(single)).toEqual([single]);
      expect(normalizeTeamMembers(single)).toEqual([
        { agentId: 'a-dev', displayName: '开发' },
      ]);
      expect(resolveTeamAgentId(single, '开发')).toBe('a-dev');
      expect(resolveMentionTargets(['开发'], single)).toEqual([
        { agentId: 'a-dev', displayName: '开发' },
      ]);
      expect(
        validateSmartCoordinatorRoomMentions({
          publishText: '请开发推进',
          dispatchText: '@开发 请开始',
          coordinatorAgentId: 'a-coord',
          nextExecutorRoleIds: ['a-dev'],
          teamRoles: single as never,
          raw: '{"action":"assign"}',
        }),
      ).toBe('ok');
    });

    it('peer acceptance scan uses taskUnderstanding only (not dispatch upstream refs)', () => {
      const raw = JSON.stringify({
        role: 'AI-Agent开发专家',
        taskUnderstanding:
          '验收AI-Agent工程专家汇报的《大模型应用问题分析》报告，确认其满足任务要求后，指派下一项并行任务给大模型调优专家。',
        inputValidation: '无',
        action: 'assign',
        deliverable: { items: [], outputValidation: [] },
        dispatch: [
          {
            role: '大模型调优专家',
            task: '以及AI-Agent工程专家已完成的《大模型应用问题分析》报告。',
          },
        ],
      });
      const scan = resolveCoordinatorPeerAcceptanceScanText(raw);
      expect(scan).toContain('验收AI-Agent工程专家');
      expect(scan).not.toContain('已完成的《大模型');
      expect(
        coordinatorRoomReplyClaimsRoleSubtaskComplete(scan, 'AI-Agent工程专家'),
      ).toBe(false);
      expect(
        coordinatorRoomReplyClaimsRoleSubtaskComplete(scan, '大模型调优专家'),
      ).toBe(false);
      const room: RoomMessage[] = [
        {
          id: 'm-eng',
          projectId: 'p1',
          from: 'ai-agent-gong-cheng-zhuan-jia',
          fromAgentId: 'ai-agent-gong-cheng-zhuan-jia',
          content: 'done',
          smartMemberEnd: true,
          timestamp: 1,
        },
      ];
      expect(
        findSmartCoordinatorPrematurePeerAcceptanceRoleIds({
          roomReplyText: scan,
          coordinatorAgentId: 'ai-agent-kai-fa-zhuan-jia',
          teamRoles: team,
          roomMessages: room,
          projectId: 'p1',
        }),
      ).toEqual([]);
    });

    it('peer acceptance scan ignores bracket 群聊回复 that embeds dispatch', () => {
      const raw = JSON.stringify({
        role: 'AI-Agent开发专家',
        taskUnderstanding: '验收AI-Agent工程专家汇报，确认后续派大模型调优专家。',
        action: 'assign',
        inputValidation: '无',
        deliverable: { items: [], outputValidation: [] },
        dispatch: [
          {
            role: '大模型调优专家',
            task: '任务输入：AI-Agent工程专家已完成的报告。',
          },
        ],
      });
      const scan = resolveCoordinatorPeerAcceptanceScanText(raw);
      expect(scan).toBe('验收AI-Agent工程专家汇报，确认后续派大模型调优专家。');
      expect(scan).not.toContain('已完成的报告');
    });

    it('accepts coordinator member-report JSON when dispatch cites upstream completed deliverable', () => {
      const raw = JSON.stringify({
        role: 'AI-Agent开发专家',
        inputValidation:
          '-rw-r--r-- 1 lixingwei 453037844 7160 6 24 14:41 大模型应用问题分析-AI-Agent工程专家.md',
        taskUnderstanding:
          '验收AI-Agent工程专家汇报的《大模型应用问题分析》报告，确认其满足任务要求后，指派下一项并行任务给大模型调优专家。',
        action: 'assign',
        deliverable: { items: [], outputValidation: [] },
        dispatch: [
          {
            role: '大模型调优专家',
            task:
              '任务输入：以及AI-Agent工程专家已完成的《大模型应用问题分析》报告（交付物-AI-Agent工程专家/大模型应用问题分析-AI-Agent工程专家.md）。交付路径：交付物-大模型调优专家/AI-Agent机会分析-大模型调优专家.md',
          },
        ],
      });
      const teamAgents = [
        agent('ai-agent-kai-fa-zhuan-jia', 'AI-Agent开发专家'),
        agent('ai-agent-gong-cheng-zhuan-jia', 'AI-Agent工程专家'),
        agent('da-mo-xing-tiao-you-zhuan-jia', '大模型调优专家'),
      ];
      const room: RoomMessage[] = [
        {
          id: 'm-eng',
          projectId: 'p1',
          from: 'ai-agent-gong-cheng-zhuan-jia',
          fromAgentId: 'ai-agent-gong-cheng-zhuan-jia',
          content: '交付物：大模型应用问题分析-AI-Agent工程专家.md',
          smartMemberEnd: true,
          timestamp: 1,
        },
      ];
      const r = validateRoomMentionStructuredReply({
        raw,
        transportReason: 'empty',
        executionMode: 'smart',
        isCoordinator: true,
        actorRoleName: 'AI-Agent开发专家',
        coordinatorAgentId: 'ai-agent-kai-fa-zhuan-jia',
        promptVariant: 'coordinator_member_report',
        triggerFromMemberAgent: true,
        reporterRoleId: 'ai-agent-gong-cheng-zhuan-jia',
        teamRoles: teamAgents,
        projectId: 'p1',
        roomMessages: room,
        smartNextExecutorRoleIds: ['da-mo-xing-tiao-you-zhuan-jia'],
        needsDecomposition: false,
      });
      expect(r.ok).toBe(true);
    });

    it('structured validation rejects premature peer acceptance on member report', () => {
      const raw = JSON.stringify({
        role: 'PM',
        taskUnderstanding: '产品已汇报；开发实现也已完成，错误提前验收开发。',
        inputValidation: '-rw-r--r-- 1 demo staff 123 交付物-产品/',
        deliverable: { items: [], outputValidation: [] },
        roomReply: '产品需求已验收。',
        action: 'assign',
        dispatch: smartDispatch('assign', [{ role: '开发', task: '请汇报完成。' }]),
      });
      const r = validateRoomMentionStructuredReply({
        raw,
        transportReason: 'empty',
        executionMode: 'smart',
        isCoordinator: true,
        actorRoleName: 'PM',
        coordinatorAgentId: 'a-coord',
        promptVariant: 'coordinator_member_report',
        triggerFromMemberAgent: true,
        reporterRoleId: 'a-product',
        smartWorkSteps: [
          { stepIndex: 1, nodeId: 'n1', title: '并行', roleIds: ['a-product', 'a-dev'] },
        ],
        smartNextExecutorRoleIds: ['a-dev'],
        teamRoles: team,
        projectId: 't1',
        roomMessages: [
          {
            id: 'm1',
            projectId: 't1',
            from: 'product',
            fromAgentId: 'a-product',
            content: '**需求已完成**',
          smartMemberEnd: true,
            timestamp: 1,
          },
        ],
        needsDecomposition: false,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.issues).toContain('smart_coordinator_premature_peer_acceptance');
      }
    });
  });

  describe('smart coordinator mention prompt slimming', () => {
    it('uses compact rules and coordinator output format', () => {
      const body = buildSmartRoomMentionAgentPrompt({
        role: SMART_AGENTS.coord,
        roomLine: '@协调者 请分工',
        scenario: { name: '团队' },
        speakerLabel: '用户',
        isCoordinator: true,
        executionMode: 'smart',
        smartNextExecutorRoleId: 'a-dev',
        smartNextExecutorNames: '开发',
      });
      expect(body).toContain('一.【角色信息】');
      expect(body).toContain('五、强制输出格式');
      expect(body).toContain('inputValidation');
      expect(body).toContain('项目目录(项目根目录，唯一读写根目录)');
      expect(body).toContain('action=assign');
      expect(body).not.toContain('根据团队成员 和 项目目标');
      expect(body).not.toContain('字段说明：');
      expect(body).not.toContain('【格式样例');
      expect(body).not.toContain('【输出】');
      expect(body).not.toContain('【输出格式·必须严格遵守】');
      expect(body).toContain('本轮允许角色：');
    });

    it('filters project directory policy from coordinator prompt progress context', () => {
      const body = buildSmartRoomMentionAgentPrompt({
        role: SMART_AGENTS.coord,
        roomLine: '@协调者 请分工',
        scenario: { name: '团队' },
        speakerLabel: '用户',
        isCoordinator: true,
        executionMode: 'smart',
        taskProgressContext: [
          '【项目目录·唯一】Smart 与 Workflow 所有交付物、校验读取、对外产物生成，均使用下列目录（禁止写入各成员自有 workspace 下的 office/projects）：',
          '- ~/.openclaw/workspace-shang-di/office/projects/股市分析与投资规划-task-1',
          '写入时使用上述绝对路径；`ls -l` / stat / 读取上游产物均只在该目录下查找。',
          '【进展·命名】各角色工作进展由系统写入协调者项目目录下 status-角色名.ndjson（勿使用成员 workspace）。',
          '【交付·命名】文档类：扩展名前加 `-角色显示名`。',
          '',
          '【进展摘要】',
          '项目状态：进行中',
          '· 产品：尚无已保存进展',
        ].join('\n'),
      });
      expect(body).not.toContain('【项目目录·唯一】');
      expect(body).toContain('2.3 项目目录(项目根目录，唯一读写根目录)：~/.openclaw/workspace-shang-di/office/projects/股市分析与投资规划-task-1');
      expect(body).not.toContain('【进展·命名】');
      expect(body).not.toContain('【交付·命名】');
      expect(body).not.toContain('【项目进展·引擎注入】');
      expect(body).not.toContain('【进展摘要】');
    });
  });
});

describe("__merged__:office-smart-task-completion", () => {
  describe('smart task kickoff line', () => {
    it('mentions coordinator and task title for room dispatch', () => {
      const line = buildSmartTaskKickoffRoomLine({ id: 'pm', name: '协调者' }, {
        title: '象棋应用',
        featureDescription: '在线对弈',
        description: '实现对弈',
      });
      expect(line).toContain('功能描述');
      expect(line).toContain('@协调者');
      expect(line).toContain('开始拆解');
      expect(line).toContain('「象棋应用」');
      expect(line).toContain('智能任务启动');
      expect(line).toContain('执行模式：Smart。');
      expect(line).not.toContain('Smart：成员完成后');
    });
  });

  describe('smart task completion markers', () => {
    it('matches coordinator closure phrases', () => {
      expect(SMART_TASK_COMPLETE_MARKERS.test('{"action": "end"}')).toBe(true);
      expect(SMART_TASK_COMPLETE_MARKERS.test('{"end": "true"}')).toBe(false);
      expect(SMART_TASK_COMPLETE_MARKERS.test('【项目结束】')).toBe(false);
      expect(SMART_TASK_COMPLETE_MARKERS.test('仍在进行中')).toBe(false);
    });
  });
});

describe('smart coordinator dispatch policy', () => {
  it('classifies prior delivery ack from product', () => {
    expect(
      classifySmartMemberReportToCoordinator(
        JSON.stringify({
          role: '产品',
          action: 'help',
          taskUnderstanding: '已收到，已于之前完成需求文档交付，请 @PM 确认验收',
          deliverable: { items: [], outputValidation: [] },
          dispatch: [{ role: 'PM', task: '请确认验收此前交付。' }],
        }),
      ),
    ).toBe('prior_delivery_ack');
  });

  it('detects decomposition from coordinator room lines when notebook empty', () => {
    const dispatchJson = JSON.stringify({
      role: 'PM',
      action: 'assign',
      taskUnderstanding: '首轮分工。',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: [] },
      dispatch: [
        { role: '开发', task: '今日完成棋盘UI' },
        { role: '产品', task: '今日交付需求文档' },
      ],
    });
    const room: RoomMessage[] = [
      {
        id: 'm1',
        scenarioId: 's1',
        projectId: 't1',
        from: 'agent',
        fromAgentId: 'a-pm',
        content:
          '本轮分工如下。\n\n@开发 今日完成棋盘UI\n@产品 今日交付需求文档',
        smartJsonRaw: dispatchJson,
        mentions: ['dev', 'product'],
        timestamp: 1,
      },
    ];
    expect(smartCoordinatorHasDecomposedInRoom(room, 'a-pm', 't1')).toBe(true);
    expect(
      smartCoordinatorNeedsDecomposition(null, {
        roomMessages: room,
        coordinatorAgentId: 'a-pm',
        projectId: 't1',
      }),
    ).toBe(false);
  });

  it('smartCoordinatorReplyDispatchesMembers detects user-intervention layout assign to 开发', () => {
    const team = [
      SMART_AGENTS.pm,
      SMART_AGENTS.dev,
    ];
    const roomReply =
      '收到反馈，需优化界面布局。@开发 请将棋盘格子从96px再调小至约84px，同时优化整体界面配色、按钮样式、间距排版，提升美观度。修复后重新落盘。';
    const dispatch =
      '@开发 请优化界面布局。要求：将棋盘格子调至约84px；优化配色与间距；落盘 交付物-开发/index.html。';
    expect(
      smartCoordinatorReplyDispatchesMembers(roomReply, 'a-pm', team, { userInitiated: true }),
    ).toBe(false);
    const json = JSON.stringify({
      role: 'PM',
      action: 'assign',
      roomReply,
      dispatch,
      taskUnderstanding: '用户要求优化界面',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: '无' },
    });
    expect(
      smartCoordinatorReplyDispatchesMembers(json, 'a-pm', team, { userInitiated: true }),
    ).toBe(true);
    expect(
      smartCoordinatorReplyDispatchesMembers(dispatch, 'a-pm', team, { userInitiated: true }),
    ).toBe(false);
    expect(
      smartCoordinatorReplyDispatchesMembers('OK，待我思考下', 'a-pm', team, { userInitiated: true }),
    ).toBe(false);
  });

  it('smartCoordinatorReplyDispatchesMembers detects structured dispatch only', () => {
    const team = [
      SMART_AGENTS.pm,
      SMART_AGENTS.product,
    ];
    const json = JSON.stringify({
      role: 'PM',
      action: 'assign',
      roomReply: '请产品编写需求文档。',
      dispatch: [{ role: '产品', task: '请编写 requirements-产品.md，完成后 @PM 汇报。' }],
      taskUnderstanding: '派活',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: '无' },
    });
    expect(smartCoordinatorReplyDispatchesMembers(json, 'a-pm', team)).toBe(true);
    expect(
      smartCoordinatorReplyDispatchesMembers('@产品 请编写 requirements-产品.md', 'a-pm', team),
    ).toBe(false);
    expect(
      smartCoordinatorReplyDispatchesMembers('收到，我先理解一下需求范围。', 'a-pm', team),
    ).toBe(false);
    expect(
      smartCoordinatorReplyDispatchesMembers('@PM 收到', 'a-pm', team),
    ).toBe(false);
  });

  it('shouldMarkSmartTaskRunningAfterCoordinatorDispatch revives terminal states on user intervention', () => {
    expect(shouldMarkSmartTaskRunningAfterCoordinatorDispatch('pending', false)).toBe(true);
    expect(shouldMarkSmartTaskRunningAfterCoordinatorDispatch('failed', false)).toBe(false);
    expect(shouldMarkSmartTaskRunningAfterCoordinatorDispatch('aborted', true)).toBe(true);
    expect(shouldMarkSmartTaskRunningAfterCoordinatorDispatch('failed', true)).toBe(true);
    expect(shouldMarkSmartTaskRunningAfterCoordinatorDispatch('completed', true)).toBe(true);
    expect(shouldMarkSmartTaskRunningAfterCoordinatorDispatch('running', true)).toBe(false);
  });

  it('resolveSmartUserRoomReplyTargets always routes to coordinator only', async () => {
    const { resolveSmartUserRoomReplyTargets, smartUserMentionedNonCoordinatorRoles } =
      await import('../../electron/services/office/room-dispatch-policy');
    const team = [
      SMART_AGENTS.coord,
      SMART_AGENTS.dev,
    ];
    expect(
      resolveSmartUserRoomReplyTargets({
        coordinatorAgentId: 'a-coord',
        targets: [],
        teamRoles: team,
      }).map((r) => r.agentId),
    ).toEqual(['a-coord']);
    expect(
      resolveSmartUserRoomReplyTargets({
        coordinatorAgentId: 'a-coord',
        targets: [team[1]!],
        teamRoles: team,
      }).map((r) => r.agentId),
    ).toEqual(['a-coord']);
    expect(
      smartUserMentionedNonCoordinatorRoles([team[1]!], 'a-coord').map((r) => r.agentId),
    ).toEqual(['a-dev']);
    expect(smartUserMentionedNonCoordinatorRoles([team[0]!], 'a-coord')).toEqual([]);
  });

  it('parsedUserMentionTargets must be captured before Smart reply target rewrite', async () => {
    const { resolveRoomReplyTargets, resolveSmartUserRoomReplyTargets } = await import(
      '../../electron/services/office/room-dispatch-policy'
    );
    const { parseMentions, resolveMentionTargets } = await import(
      '../../electron/services/office/room-mentions'
    );
    const team = [
      SMART_AGENTS.coord,
      SMART_AGENTS.dev,
    ];
    const content = '@开发 请加快进度';
    const tokens = parseMentions(content);
    const parsed = resolveMentionTargets(tokens, team, { coordinatorAgentId: 'a-coord' });
    const afterResolve = resolveRoomReplyTargets({
      mentionTokens: tokens,
      teamRoles: team,
      from: 'user',
      focusTask: { executionMode: 'smart' },
      coordinatorAgentId: 'a-coord',
      content,
    });
    const routed = resolveSmartUserRoomReplyTargets({
      coordinatorAgentId: 'a-coord',
      targets: afterResolve,
      teamRoles: team,
    });
    expect(parsed.map((r) => r.agentId)).toEqual(['a-dev']);
    expect(afterResolve.map((r) => r.agentId)).toEqual(['a-dev']);
    expect(routed.map((r) => r.agentId)).toEqual(['a-coord']);
  });

  it('user room speech uses immediate coordinator intervention not 15s watch', () => {
    expect(
      shouldImmediateSmartUserRoomCoordinatorIntervention({
        executionMode: 'smart',
        from: 'user',
        hasFocusTask: true,
      }),
    ).toBe(true);
    expect(
      shouldScheduleSmartBroadcastCoordinatorWatch({
        executionMode: 'smart',
        kind: 'broadcast',
        replyTargetCount: 0,
        coordinatorAgentId: 'a-coord',
        from: 'user',
        content: '请继续推进',
      }),
    ).toBe(false);
    expect(
      shouldScheduleSmartBroadcastCoordinatorWatch({
        executionMode: 'smart',
        kind: 'broadcast',
        replyTargetCount: 0,
        coordinatorAgentId: 'a-coord',
        from: 'agent',
        content: '成员同步进展',
      }),
    ).toBe(true);
  });

  it('shouldMarkSmartTaskRunningAfterCoordinatorDispatch only revives completed when userInitiated', () => {
    expect(shouldMarkSmartTaskRunningAfterCoordinatorDispatch('completed', false)).toBe(false);
    expect(shouldMarkSmartTaskRunningAfterCoordinatorDispatch('completed', true)).toBe(true);
  });

  it('user-initiated coordinator dispatch requires structured dispatch not roomReply @', () => {
    const team = [
      SMART_AGENTS.pm,
      SMART_AGENTS.product,
    ];
    const sync =
      '收到用户反馈。请 @产品 交付需求。@开发 等待产品交付后开展开发。当前项目状态：⏳ 产品待交付';
    expect(smartCoordinatorReplyDispatchesMembers(sync, 'a-pm', team)).toBe(false);
    expect(
      smartCoordinatorReplyDispatchesMembers(sync, 'a-pm', team, { userInitiated: true }),
    ).toBe(false);
    const json = JSON.stringify({
      role: 'PM',
      action: 'assign',
      roomReply: sync,
      dispatch: [{ role: '产品', task: '请交付需求文档' }],
      taskUnderstanding: '用户介入',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: '无' },
    });
    expect(
      smartCoordinatorReplyDispatchesMembers(json, 'a-pm', team, { userInitiated: true }),
    ).toBe(true);
  });

  it('does not filter coordinator follow-up targets by progress-sync heuristics', () => {
    const sync =
      '收到开发反馈。请 @产品 交付需求。@开发 等待产品交付后开展开发。当前项目状态：⏳ 产品待交付';
    expect(isSmartCoordinatorProgressSyncReply(sync)).toBe(true);
    const dev = SMART_AGENTS.dev;
    expect(
      filterFollowUpMentionTargets({
        executionMode: 'smart',
        coordinatorRoleId: 'a-pm',
        fromRoleId: 'a-pm',
        replyText: sync,
        delegated: [dev],
      }),
    ).toEqual([dev]);
  });

  it('does not treat coordinator assign-after-accept as progress-only sync', () => {
    const dev = SMART_AGENTS.dev;
    const assign = JSON.stringify({
      role: 'PM',
      action: 'assign',
      roomReply: '需求文档已验收通过，请开发实现。',
      dispatch: [
        {
          role: '开发',
          task: '实现五子棋游戏功能，代码工程写入 交付物-开发/。按照 requirements-产品.md 实现，完成后 @PM 汇报。',
        },
      ],
      taskUnderstanding: '派活',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: '无' },
    });
    expect(isSmartCoordinatorProgressSyncReply(assign)).toBe(false);
    expect(
      filterFollowUpMentionTargets({
        executionMode: 'smart',
        coordinatorRoleId: 'a-pm',
        fromRoleId: 'a-pm',
        replyText: assign,
        delegated: [dev],
      }).map((r) => r.agentId),
    ).toEqual(['a-dev']);
  });

  it('allows first coordinator kickoff follow-up to dispatch members', () => {
    const dev = SMART_AGENTS.dev;
    const tune = { id: 'a-tune', agentId: 'a-tune', name: '大模型调优专家' } as const;
    const kickoff =
      '🚀 项目「AI-Agent开发方案探索」正式启动！\n【任务1】@大模型调优专家 撰写《大模型现实问题》\n【任务2】@AI-Agent工程专家 撰写《AI-Agent未来展望》';
    const room: RoomMessage[] = [
      {
        id: 'room-kickoff',
        groupId: 'g1',
        projectId: 't1',
        from: 'a-pm',
        fromAgentId: 'a-pm',
        content: kickoff,
        mentions: ['a-tune', 'a-dev'],
        timestamp: 100,
      },
    ];
    expect(
      filterFollowUpMentionTargets({
        executionMode: 'smart',
        coordinatorRoleId: 'a-pm',
        fromRoleId: 'a-pm',
        replyText: kickoff,
        roomMessages: room,
        taskId: 't1',
        delegated: [dev, tune as never],
      }),
    ).toEqual([dev, tune]);
  });

  it('blocks coordinator assign follow-up when smartLastAssign already dispatched', () => {
    const dev = SMART_AGENTS.dev;
    const tune = { id: 'a-tune', agentId: 'a-tune', name: '大模型调优专家' } as const;
    const assignReply =
      '🚀 项目「AI-Agent开发方案探索」正式启动！\n【任务1】@大模型调优专家 撰写《大模型现实问题》\n【任务2】@AI-Agent工程专家 撰写《AI-Agent未来展望》';
    const assignMessageId = 'room-assign-1';
    expect(
      filterFollowUpMentionTargets({
        executionMode: 'smart',
        coordinatorRoleId: 'a-pm',
        fromRoleId: 'a-pm',
        replyText: assignReply,
        replyMessageId: assignMessageId,
        smartLastAssign: {
          messageId: assignMessageId,
          targetAgentIds: ['a-tune', 'a-dev'],
          at: 100,
          dispatchedAt: 150,
        },
        roomMessages: [],
        taskId: 't1',
        delegated: [dev, tune as never],
      }),
    ).toEqual([]);
  });

  it('does not block coordinator follow-up without smartLastAssign ledger', () => {
    const dev = SMART_AGENTS.dev;
    const tune = { id: 'a-tune', agentId: 'a-tune', name: '大模型调优专家' } as const;
    const kickoff =
      '🚀 项目「AI-Agent开发方案探索」正式启动！\n【任务1】@大模型调优专家 撰写《大模型现实问题》\n【任务2】@AI-Agent工程专家 撰写《AI-Agent未来展望》';
    expect(isSmartCoordinatorKickoffDecompositionText(kickoff)).toBe(true);
    const room: RoomMessage[] = [
      {
        id: 'room-kickoff-1',
        groupId: 'g1',
        projectId: 't1',
        from: 'a-pm',
        fromAgentId: 'a-pm',
        content: kickoff,
        mentions: ['a-tune', 'a-dev'],
        timestamp: 100,
      },
      {
        id: 'room-kickoff-2',
        groupId: 'g1',
        projectId: 't1',
        from: 'a-pm',
        fromAgentId: 'a-pm',
        content: kickoff,
        mentions: ['a-tune', 'a-dev'],
        timestamp: 200,
      },
    ];
    expect(smartCoordinatorHasDecomposedInRoom(room, 'a-pm', 't1')).toBe(true);
    expect(
      filterFollowUpMentionTargets({
        executionMode: 'smart',
        coordinatorRoleId: 'a-pm',
        fromRoleId: 'a-pm',
        replyText: kickoff,
        roomMessages: room,
        taskId: 't1',
        delegated: [dev, tune as never],
      }),
    ).toEqual([dev, tune]);
  });

  it('kickoff trigger message id does not match coordinator mention publish id', () => {
    expect(isSmartCoordKickoffTriggerMessageId('room-1782218948593-smart-coord-kickoff')).toBe(true);
    expect(
      isSmartCoordKickoffTriggerMessageId(
        'room-mention-room-1782218948593-smart-coord-kickoff-ai-agent-kai-fa-zhuan-jia',
      ),
    ).toBe(false);
  });

  it('skips stale kickoff member dispatch when member already reported after kickoff', () => {
    const kickoffId = 'room-123-smart-coord-kickoff';
    const room: RoomMessage[] = [
      {
        id: kickoffId,
        groupId: 'g1',
        projectId: 't1',
        from: 'a-pm',
        fromAgentId: 'a-pm',
        content:
          '🚀 项目正式启动！\n【任务1】@大模型调优专家 撰写《大模型现实问题》',
        mentions: ['a-tune'],
        timestamp: 100,
      },
      {
        id: 'room-member-report',
        groupId: 'g1',
        projectId: 't1',
        from: 'a-tune',
        fromAgentId: 'a-tune',
        content: '《大模型现实问题》已完成交付',
        mentions: ['a-pm'],
        timestamp: 200,
      },
    ];
    expect(
      shouldSkipStaleSmartKickoffMemberDispatch({
        triggerMsgId: kickoffId,
        memberAgentId: 'a-tune',
        roomMessages: room,
        coordinatorAgentId: 'a-pm',
        projectId: 't1',
      }),
    ).toBe(true);
  });

  it('shouldSkipSmartMemberDispatchAfterCompletedReport skips duplicate assign after smartMemberEnd', () => {
    const assignId = 'room-mention-round-coord';
    const room: RoomMessage[] = [
      {
        id: assignId,
        groupId: 'g1',
        projectId: 't1',
        from: 'a-pm',
        fromAgentId: 'a-pm',
        content: '@大模型调优专家 请完成机会分析',
        mentions: ['a-tune'],
        timestamp: 100,
      },
      {
        id: 'room-member-end',
        groupId: 'g1',
        projectId: 't1',
        from: 'a-tune',
        fromAgentId: 'a-tune',
        content: '@AI-Agent开发专家 大模型调优专家已完成交付，请验收。',
        mentions: ['a-pm'],
        timestamp: 200,
        smartMemberEnd: true,
      },
    ];
    expect(
      shouldSkipSmartMemberDispatchAfterCompletedReport({
        memberAgentId: 'a-tune',
        roomMessages: room,
        projectId: 't1',
        triggerMsg: { id: assignId, timestamp: 100 },
      }),
    ).toBe(true);
  });

  it('shouldSkipSmartMemberDispatchAfterCompletedReport allows dispatch for newer assign after end', () => {
    const room: RoomMessage[] = [
      {
        id: 'assign-1',
        groupId: 'g1',
        projectId: 't1',
        from: 'a-pm',
        fromAgentId: 'a-pm',
        content: '@大模型调优专家 第一轮',
        mentions: ['a-tune'],
        timestamp: 100,
      },
      {
        id: 'end-1',
        groupId: 'g1',
        projectId: 't1',
        from: 'a-tune',
        fromAgentId: 'a-tune',
        content: '第一轮已完成',
        mentions: ['a-pm'],
        timestamp: 200,
        smartMemberEnd: true,
      },
      {
        id: 'assign-2',
        groupId: 'g1',
        projectId: 't1',
        from: 'a-pm',
        fromAgentId: 'a-pm',
        content: '@大模型调优专家 请修订',
        mentions: ['a-tune'],
        timestamp: 300,
      },
    ];
    expect(
      shouldSkipSmartMemberDispatchAfterCompletedReport({
        memberAgentId: 'a-tune',
        roomMessages: room,
        projectId: 't1',
        triggerMsg: { id: 'assign-2', timestamp: 300 },
      }),
    ).toBe(false);
  });

  it('uses per-role @ clause instead of full coordinator broadcast in member prompt line', () => {
    const full = [
      '@产品 今日交付需求文档',
      '@开发 需求文档交付后开始开发',
      '@测试 开发完成后测试',
      '当前项目状态：⏳ 产品待交付',
    ].join('\n');
    const devLine = smartMemberMentionRoomLine(full, agent('a-dev', '开发'), full.slice(0, 80));
    expect(devLine).toContain('@开发');
    expect(devLine).not.toContain('@产品');
    expect(devLine.length).toBeLessThan(full.length);
  });

  it('dispatches follow-up when coordinator @member after subtask-done report', () => {
    const dev = SMART_AGENTS.dev;
    const room: RoomMessage[] = [
      {
        id: 'd1',
        scenarioId: 's1',
        projectId: 't1',
        from: 'agent',
        fromAgentId: 'a-dev',
        content: '【棋盘UI与基础落子逻辑已完成】请 @PM 验收',
        mentions: ['pm'],
        timestamp: 100,
      },
    ];
    const delegated = filterFollowUpMentionTargets({
      executionMode: 'smart',
      coordinatorRoleId: 'a-pm',
      fromRoleId: 'a-pm',
      replyText: '@开发 今日完成棋盘UI与基础落子逻辑',
      roomMessages: room,
      projectId: 't1',
      replyTimestamp: 200,
      delegated: [dev],
    });
    expect(delegated.map((r) => r.agentId)).toEqual(['a-dev']);
  });

  it('smart coordinator pickRoles excludes self when members are in dispatch', () => {
    const team = [
      SMART_AGENTS.pm,
      SMART_AGENTS.qa,
    ];
    const json = JSON.stringify({
      role: 'PM',
      action: 'assign',
      roomReply: '@PM 开始拆解',
      dispatch: [{ role: '测试', task: '执行功能测试' }],
      taskUnderstanding: '拆解',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: '无' },
    });
    const picked = pickRolesDelegatedByCoordinator(
      json,
      team,
      'pm',
      'pm',
      { executionMode: 'smart' },
    );
    expect(picked.map((r) => r.agentId)).toEqual(['a-qa']);
  });

  it('smart coordinator pickRoles returns empty for self @ only', () => {
    const team = [
      SMART_AGENTS.pm,
    ];
    const picked = pickRolesDelegatedByCoordinator(
      '@PM 请确认',
      team,
      'pm',
      'pm',
      { executionMode: 'smart' },
    );
    expect(picked).toEqual([]);
  });

  it('clamp keeps @ mentioned rework target', () => {
    const team = [
      SMART_AGENTS.pm,
      SMART_AGENTS.qa,
    ];
    const line = '@测试 请对交付物-开发/ 执行功能测试验证';
    const mentioned = collectSmartCoordinatorMentionedRoleIds({
      text: line,
      coordinatorAgentId: 'a-pm',
      teamRoles: team,
    });
    const clamped = clampSmartCoordinatorDispatchText(line, {
      coordinatorAgentId: 'a-pm',
      allowedRoleIds: smartCoordinatorAllowedDispatchRoleIds({
        nextExecutorRoleIds: ['a-pm'],
        mentionedRoleIds: mentioned,
      }),
      teamRoles: team,
    });
    expect(clamped).toContain('@测试');
  });

  it('dispatches follow-up @测试 after done when work order next is PM', () => {
    const qa = SMART_AGENTS.qa;
    const room: RoomMessage[] = [
      {
        id: 'q1',
        scenarioId: 's1',
        projectId: 't1',
        from: 'agent',
        fromAgentId: 'a-qa',
        content: '【测试用例文档已完成】已写入 测试用例-测试.md',
        mentions: ['pm'],
        timestamp: 100,
      },
    ];
    const line =
      '@测试 请根据 requirements-产品.md 对交付物-开发/ 执行功能测试验证，报告写入 交付物-测试/测试执行报告.md。完成后 @我 汇报。';
    const delegated = filterFollowUpMentionTargets({
      executionMode: 'smart',
      coordinatorRoleId: 'a-pm',
      fromRoleId: 'a-pm',
      replyText: line,
      roomMessages: room,
      projectId: 't1',
      replyTimestamp: 200,
      smartNextExecutorRoleId: 'a-pm',
      delegated: [qa],
    });
    expect(delegated.map((r) => r.agentId)).toEqual(['a-qa']);
  });
});

describe('office smart work order and dispatch rules', () => {
  const scenario: Pick<OfficeScenario, 'workflow'> = {
    workflow: {
      mode: 'dag',
      nodes: [
        { id: 'n1', agentId: 'a-pm', execution: 'serial', title: '需求' },
        { id: 'n2', agentId: 'a-dev', execution: 'serial', title: '开发' },
      ],
      edges: [{ from: 'n1', to: 'n2' }],
    },
  };
  const roles = [
    agent('a-pm', 'PM'),
    agent('a-dev', '开发'),
  ];

  it('resolves next executor from work order and room completion markers', () => {
    const steps = resolveSmartWorkOrderSteps(scenario, '', roles);
    expect(steps).toHaveLength(2);
    const room: RoomMessage[] = [];
    expect(resolveSmartNextExecutorRoleId({ steps, roomMessages: room, projectId: 't1' })).toBe('a-pm');
    room.push({
      id: 'm1',
      scenarioId: 's1',
      projectId: 't1',
      from: 'pm',
      fromAgentId: 'a-pm',
      content: '【需求文档已完成】路径 /tmp/a.md',
      smartMemberEnd: true,
      mentions: [],
      timestamp: 1,
    });
    expect(roleReportedSubtaskDoneInRoom(room, 't1', 'a-pm')).toBe(true);
    expect(resolveSmartNextExecutorRoleId({ steps, roomMessages: room, projectId: 't1' })).toBe('a-dev');
    expect(resolveSmartNextExecutorRoleIds({ steps, roomMessages: room, projectId: 't1' })).toEqual(['a-dev']);
  });

  it('resolveSmartNextExecutorRoleIds returns all pending roles in parallel step', () => {
    const parallelScenario: Pick<OfficeScenario, 'workflow'> = {
      workflow: {
        mode: 'dag',
        nodes: [
          {
            id: 'n-parallel',
            roleIds: ['a-cn', 'a-us'],
            execution: 'serial',
            title: '并行市场分析',
          },
          { id: 'n-dev', agentId: 'a-dev', execution: 'serial', title: '开发' },
        ],
        edges: [{ from: 'n-parallel', to: 'n-dev' }],
      },
    };
    const team = [
      agent('a-cn', 'A股分析'),
      agent('a-us', '美股分析'),
      agent('a-dev', '开发'),
    ];
    const steps = resolveSmartWorkOrderSteps(parallelScenario, '', team);
    const parallelStep = steps[0]!;
    expect(parallelStep.roleIds).toEqual(['a-cn', 'a-us']);
    const room: RoomMessage[] = [];
    expect(resolveSmartNextExecutorRoleIds({ steps, roomMessages: room, projectId: 't1' })).toEqual([
      'a-cn',
      'a-us',
    ]);
    expect(pendingExecutorsInSmartWorkOrderStep(parallelStep, room, 't1')).toEqual(['a-cn', 'a-us']);
    room.push({
      id: 'm-cn',
      scenarioId: 's1',
      projectId: 't1',
      from: 'cn',
      fromAgentId: 'a-cn',
      content: '**A股市场分析已完成** 路径 /tmp/cn.md',
      smartMemberEnd: true,
      mentions: [],
      timestamp: 1,
    });
    expect(resolveSmartNextExecutorRoleIds({ steps, roomMessages: room, projectId: 't1' })).toEqual(['a-us']);
    expect(isSmartWorkOrderStepDoneInRoom(parallelStep, room, 't1')).toBe(false);
    room.push({
      id: 'm-us',
      scenarioId: 's1',
      projectId: 't1',
      from: 'us',
      fromAgentId: 'a-us',
      content: '**美股市场分析已完成** 路径 /tmp/us.md',
      smartMemberEnd: true,
      mentions: [],
      timestamp: 2,
    });
    expect(isSmartWorkOrderStepDoneInRoom(parallelStep, room, 't1')).toBe(true);
    expect(resolveSmartNextExecutorRoleIds({ steps, roomMessages: room, projectId: 't1' })).toEqual(['a-dev']);
    expect(resolveSmartPriorStepProducerRoleIds('a-dev', steps)).toEqual(['a-cn', 'a-us']);
  });

  it('smartReadyForProjectClosure waits until parallel stage fully done', () => {
    const parallelScenario: Pick<OfficeScenario, 'workflow'> = {
      workflow: {
        mode: 'dag',
        nodes: [
          { id: 'n1', roleIds: ['a-cn', 'a-us'], execution: 'serial', title: '分析' },
        ],
        edges: [],
      },
    };
    const steps = resolveSmartWorkOrderSteps(parallelScenario, '', [
      agent('a-cn', 'A股'),
      agent('a-us', '美股'),
    ]);
    const room: RoomMessage[] = [
      {
        id: 'm1',
        scenarioId: 's1',
        projectId: 't1',
        from: 'cn',
        fromAgentId: 'a-cn',
        content: '**A股已完成**',
        smartMemberEnd: true,
        mentions: [],
        timestamp: 1,
      },
    ];
    expect(smartReadyForProjectClosure(steps, room, 't1', 'pm')).toBe(false);
    room.push({
      id: 'm2',
      scenarioId: 's1',
      projectId: 't1',
      from: 'us',
      fromAgentId: 'a-us',
      content: '**美股已完成**',
        smartMemberEnd: true,
      mentions: [],
      timestamp: 2,
    });
    expect(smartReadyForProjectClosure(steps, room, 't1', 'pm')).toBe(true);
  });

  it('smartCoordinatorReplyIsDispatching detects dispatch vs closure-only replies', () => {
    expect(
      smartCoordinatorReplyIsDispatching({
        roomBody: '任务拆解完成，@A股分析师 请开始分析。',
        dispatch: '@A股分析师 子任务说明',
      }),
    ).toBe(true);
    expect(
      smartCoordinatorReplyIsDispatching({
        roomBody: '全部子任务已验收，感谢协作。',
        dispatch: '无',
      }),
    ).toBe(false);
    expect(
      smartCoordinatorReplyIsDispatching({
        roomBody: '任务拆解完成，@A股分析师 请开始分析。',
        dispatch: '无',
      }),
    ).toBe(false);
  });

  it('validateSmartCoordinatorRoomMentions allows parallel @ in same stage', () => {
    const team = [
      SMART_AGENTS.pm,
      agent('a-cn', 'A股分析师'),
      agent('a-us', '美股分析'),
      SMART_AGENTS.dev,
    ];
    expect(
      validateSmartCoordinatorRoomMentions({
        publishText: '@A股分析 请分析中国股票市场；@美股分析 请分析美国股市。',
        dispatchText: '@A股分析 中国；@美股分析 美国',
        coordinatorAgentId: 'a-pm',
        nextExecutorRoleIds: ['a-cn', 'a-us'],
        teamRoles: team,
      }),
    ).toBe('ok');
    expect(
      validateSmartCoordinatorRoomMentions({
        publishText: '@开发 请等待上游分析完成',
        dispatchText: '@开发 请等待上游分析完成',
        coordinatorAgentId: 'a-pm',
        nextExecutorRoleIds: ['a-cn', 'a-us'],
        teamRoles: team,
      }),
    ).toBe('mentions_non_next_executor');
  });

  it('requires assign dispatch when coordinator continues after acceptance', () => {
    const team = [
      SMART_AGENTS.pm,
      agent('a-cn', 'A股分析师'),
      { id: 'hk', name: '港股分析师', agentId: 'a-hk', createdAt: 0, updatedAt: 0 },
      agent('a-us', '美股分析'),
    ];
    expect(
      validateSmartCoordinatorRoomMentions({
        publishText:
          '【第一阶段进展】美股分析师已完成交付，验收通过。A股和港股报告仍等待后续完成汇报。',
        dispatchText: '无',
        coordinatorAgentId: 'a-pm',
        nextExecutorRoleIds: ['a-cn', 'a-hk'],
        teamRoles: team,
        raw: JSON.stringify({
          role: 'PM',
          taskUnderstanding: '验收美股并等待 A股/港股。',
          inputValidation: '-rw-r--r-- 1 demo staff 123 美股分析报告-美股分析师.md',
          deliverable: { items: [], outputValidation: [] },
          roomReply:
          '【第一阶段进展】美股分析师已完成交付，验收通过。A股和港股报告仍等待后续完成汇报。',
          action: 'assign',
          dispatch: [],
      }),
      }),
    ).toBe('missing_mention');
  });

  it('rejects coordinator dispatch naming reporter after member report', () => {
    const team = [
      SMART_AGENTS.pm,
      agent('a-us', '美股分析'),
      agent('a-cn', 'A股分析师'),
    ];
    expect(
      validateSmartCoordinatorRoomMentions({
        publishText: '美股分析师报告已验收，请继续完善摘要。',
        dispatchText: '@美股分析师 请补充摘要',
        coordinatorAgentId: 'a-pm',
        nextExecutorRoleIds: ['a-cn'],
        reporterRoleId: 'a-us',
        teamRoles: team,
        raw: JSON.stringify({
          role: 'PM',
          taskUnderstanding: '验收美股分析师汇报。',
          inputValidation: '-rw-r--r-- 1 demo staff 123 美股分析报告-美股分析师.md',
          deliverable: { items: [], outputValidation: [] },
          roomReply: '美股分析师报告已验收，请继续完善摘要。',
          action: 'assign',
          dispatch: [{ role: '美股分析师', task: '请补充摘要' }],
        }),
      }),
    ).toBe('dispatch_names_reporter');
  });

  it('rejects coordinator dispatch with duplicate role in same round', () => {
    const team = [
      SMART_AGENTS.pm,
      agent('a-eng', 'AI-Agent工程专家'),
      agent('a-tune', '大模型调优专家'),
    ];
    expect(
      validateSmartCoordinatorRoomMentions({
        publishText: '并行派活',
        dispatchText: '@AI-Agent工程专家 任务1\n@AI-Agent工程专家 任务2',
        coordinatorAgentId: 'a-pm',
        teamRoles: team,
        raw: JSON.stringify({
          role: 'PM',
          taskUnderstanding: '拆解',
          inputValidation: '无',
          deliverable: { items: [], outputValidation: [] },
          roomReply: '并行派活',
          action: 'assign',
          dispatch: [
            { role: 'AI-Agent工程专家', task: '任务1' },
            { role: 'AI-Agent工程专家', task: '任务2' },
          ],
        }),
      }),
    ).toBe('dispatch_duplicate_role');
  });

  it('structured validation rejects coordinator action=review', () => {
    const raw = JSON.stringify({
      role: 'PM',
      taskUnderstanding: '验收美股分析师汇报。',
      inputValidation: '-rw-r--r-- 1 demo staff 123 美股分析报告-美股分析师.md',
      deliverable: { items: [], outputValidation: [] },
      roomReply: '美股分析师已完成交付，验收通过。',
      action: 'review',
      dispatch: smartDispatch('review'),
    });
    const r = validateRoomMentionStructuredReply({
      raw,
      transportReason: 'empty',
      executionMode: 'smart',
      isCoordinator: true,
      actorRoleName: 'PM',
      coordinatorAgentId: 'a-pm',
      teamRoles: [
        { id: 'pm', name: 'PM', agentId: 'a' },
        { id: 'us', name: '美股分析师', agentId: 'b' },
      ],
      projectId: 't1',
      roomMessages: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues).toContain('invalid_json_value');
  });

  it('ignores legacy end field and validates by top-level action only', () => {
    const raw = JSON.stringify({
      role: 'PM',
      taskUnderstanding: '顶层 action 才是当前协议结项标识。',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: [] },
      roomReply: '需求已验收通过，请开发按分工继续实现下一阶段功能模块。',
      action: 'assign',
      dispatch: smartDispatch('assign', [{ role: '开发', task: '@开发 继续实现。' }]),
      end: 'true',
    });
    const r = validateRoomMentionStructuredReply({
      raw,
      transportReason: 'empty',
      executionMode: 'smart',
      isCoordinator: true,
      actorRoleName: 'PM',
      coordinatorAgentId: 'a-pm',
      smartNextExecutorRoleId: 'a-dev',
      teamRoles: [
        { id: 'pm', name: 'PM', agentId: 'a' },
        { id: 'dev', name: '开发', agentId: 'b' },
      ],
      projectId: 't1',
      roomMessages: [],
    });
    expect(r.ok).toBe(true);
  });

  it('keeps Smart JSON validation in syntax, missing-fields, value layers', () => {
    const syntax = parseSmartJsonOutputDetailed(
      '{"role":"PM","taskUnderstanding":"语法错误","inputValidation":"无","outputValidation":"无","deliverable":[],"roomReply":"语法错误正文","dispatch":',
      true,
    );
    expect(syntax.ok).toBe(false);
    if (!syntax.ok) expect(syntax.issues).toContain('invalid_json_syntax');

    const missing = parseSmartJsonOutputDetailed(
      JSON.stringify({
        role: 'PM',
        taskUnderstanding: '缺少 dispatch.action。',
        inputValidation: '无',
        deliverable: { items: [], outputValidation: '无' },
        roomReply: '仅测试字段缺失。',
        dispatch: [{ role: '开发' }],
        }),
      true,
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.issues).toContain('invalid_json_missing_fields');
      expect(missing.detail).toContain('action');
      expect(missing.detail).toContain('dispatch[0].task');
    }

    const value = parseSmartJsonOutputDetailed(
      JSON.stringify({
        role: 'PM',
        taskUnderstanding: 'dispatch 类型错误。',
        inputValidation: '无',
        action: 'review',
        deliverable: { items: [], outputValidation: '无' },
        roomReply: '仅测试字段类型。',
        dispatch: '无',
      }),
      true,
    );
    expect(value.ok).toBe(false);
    if (!value.ok) expect(value.issues).toContain('invalid_json_value');
  });

  it('structured validation rejects end action with non-empty dispatch', () => {
    const team = [
      { id: 'pm', name: 'PM', agentId: 'a' },
      { id: 'planner', name: '投资规划师', agentId: 'b' },
    ];
      const raw = JSON.stringify({
        role: 'PM',
      taskUnderstanding: '错误结项并继续派活。',
        inputValidation: '无',
      deliverable: { items: [], outputValidation: [] },
      roomReply: '项目已全部完成，正式结项。',
      action: 'end',
      dispatch: smartDispatch('end', [{ role: '投资规划师', task: '汇总三份报告并输出PPT。' }]),
      });
      const r = validateRoomMentionStructuredReply({
        raw,
        transportReason: 'empty',
        executionMode: 'smart',
        isCoordinator: true,
        actorRoleName: 'PM',
      coordinatorAgentId: 'a-pm',
        teamRoles: team,
      projectId: 't1',
        roomMessages: [],
      });
      expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues).toContain('invalid_json_value');
  });

  it('rejects end action when dispatch is not none', () => {
    expect(
      validateSmartCoordinatorRoomMentions({
        publishText: '项目已全部完成，正式结项。',
        dispatchText: '@投资规划师 继续输出PPT',
        coordinatorAgentId: 'a-pm',
        nextExecutorRoleIds: ['a-planner'],
        teamRoles: [
          agent('a-pm', 'PM'),
          { id: 'planner', name: '投资规划师' },
        ],
        raw: JSON.stringify({
          role: 'PM',
          taskUnderstanding: '错误地在结项时继续派活。',
          inputValidation: '无',
          deliverable: { items: [], outputValidation: '无' },
          roomReply: '项目已全部完成，正式结项。',
          action: 'end',
          dispatch: smartDispatch('end'),
            }),
      }),
    ).toBe('end_has_dispatch');
  });

  it('allows coordinator assign with parallel urge to waiting members', () => {
    const team = [
      SMART_AGENTS.pm,
      agent('a-cn', 'A股分析师'),
      { id: 'hk', name: '港股分析师', agentId: 'a-hk', createdAt: 0, updatedAt: 0 },
      agent('a-us', '美股分析'),
    ];
    expect(
      validateSmartCoordinatorRoomMentions({
        publishText:
          '美股分析师已完成交付，验收通过。请尽快完成分析报告并提交完成汇报。',
        dispatchText: '@A股分析师 请完成A股分析；@港股分析师 请完成港股分析',
        coordinatorAgentId: 'a-pm',
        nextExecutorRoleIds: ['a-cn', 'a-hk'],
        reporterRoleId: 'a-us',
        teamRoles: team,
        raw: JSON.stringify({
          role: 'PM',
          taskUnderstanding: '验收美股分析师汇报，并行催办 A股/港股。',
          inputValidation: '-rw-r--r-- 1 demo staff 123 美股分析报告-美股分析师.md',
          deliverable: { items: [], outputValidation: [] },
          roomReply:
            '美股分析师已完成交付，验收通过。请尽快完成分析报告并提交完成汇报。',
          action: 'assign',
          dispatch: [
            { role: 'A股分析师', task: '请完成A股分析报告并汇报。' },
            { role: '港股分析师', task: '请完成港股分析报告并汇报。' },
          ],
            }),
      }),
    ).toBe('ok');
  });

  it('smartCoordinatorShouldValidateAssignMentions only true for assign paths', () => {
    expect(
      smartCoordinatorShouldValidateAssignMentions({
        publishText: '项目已全部完成，感谢各位。',
        dispatchText: '无',
        raw: JSON.stringify({
          role: 'PM',
          taskUnderstanding: '全部步骤已完成，正式结项。',
          inputValidation: '无',
          deliverable: { items: [], outputValidation: '无' },
          roomReply: '项目已全部完成，感谢各位。',
          action: 'end',
          dispatch: smartDispatch('end'),
            }),
      }),
    ).toBe(false);
    expect(
      smartCoordinatorShouldValidateAssignMentions({
        publishText: '请按分工推进。',
        dispatchText: '@开发 请完成实现',
        raw: JSON.stringify({
          role: 'PM',
          roomReply: '请按分工推进。',
          action: 'assign',
          dispatch: smartDispatch('assign', [{ role: '开发', task: '请完成实现' }]),
            }),
      }),
    ).toBe(true);
    expect(
      smartCoordinatorShouldValidateAssignMentions({
        publishText: '请按分工推进。',
        dispatchText: '@开发 请完成实现',
        raw: JSON.stringify({
          role: 'PM',
          roomReply: '请按分工推进。',
          action: 'assign',
          dispatch: smartDispatch('assign', [{ role: '开发', task: '请完成实现' }]),
            }),
        projectComplete: true,
      }),
    ).toBe(false);
  });

  it('rejects coordinator action=assign without @', () => {
    expect(
      validateSmartCoordinatorRoomMentions({
        publishText: '请按分工推进子任务。',
        dispatchText: '开发同学请完成实现',
        coordinatorAgentId: 'a-pm',
        nextExecutorRoleId: 'a-dev',
        teamRoles: smartProgressTeam,
        raw: JSON.stringify({
          role: 'PM',
          roomReply: '请按分工推进子任务。',
          action: 'assign',
          dispatch: smartDispatch('assign', [{ role: '无', task: '开发同学请完成实现' }]),
            }),
      }),
    ).toBe('missing_mention');
  });

  it('structured validation rejects assign dispatch naming reporter on member report path', () => {
    const raw = JSON.stringify({
      role: 'PM',
      taskUnderstanding: '成员已汇报，错误地点名汇报者续派。',
      inputValidation: '-rw-r--r-- 1 demo staff 123 交付物-开发/',
      deliverable: { items: [], outputValidation: [] },
      roomReply: '模块 A 已验收，请继续模块 B。',
      action: 'assign',
      dispatch: smartDispatch('assign', [{ role: '开发', task: '请完成模块 B。' }]),
    });
    const r = validateRoomMentionStructuredReply({
      raw,
      transportReason: 'empty',
      executionMode: 'smart',
      isCoordinator: true,
      actorRoleName: 'PM',
      coordinatorAgentId: 'a-coord',
      promptVariant: 'coordinator_member_report',
      triggerFromMemberAgent: true,
      reporterRoleId: 'a-dev',
      smartWorkSteps: [{ stepIndex: 1, nodeId: 'n1', title: '开发', roleIds: ['a-dev'] }],
      smartNextExecutorRoleId: 'a-dev',
      teamRoles: smartProgressTeam,
      projectId: 't1',
      roomMessages: [],
      needsDecomposition: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues).toContain('smart_coordinator_dispatch_names_reporter');
    }
  });

  it('member validation scope has no input paths and only output ls on deliverable', () => {
    const own = '/Users/demo/project/requirements-产品.md';
    const steps = resolveSmartWorkOrderSteps(
      { workflow: { nodes: [], edges: [] } },
      '1.PM\n2.产品\n3.开发',
      [
        agent('a-pm', 'PM'),
        agent('a-product', '产品'),
        agent('a-dev', '开发'),
      ],
    );
    const scope = resolveSmartValidationScope({
      raw: JSON.stringify({
        role: '产品',
        taskUnderstanding: '产品写需求。',
        action: 'end',
        deliverable: {
          items: [own],
          outputValidation: [`-rw-r--r-- 1 u 1 20 ${own}`],
        },
        dispatch: [{ role: 'PM', task: '请验收。' }],
      }),
      viewerRoleId: 'a-product',
      steps,
      roomMessages: [],
      taskId: 't1',
    });
    expect(scope.inputPaths).toEqual([]);
    expect(scope.outputPaths).toEqual([own]);
    const devBlocked = [
      '【任务理解】开发实现，上游 requirements-产品.md 未就绪。',
      '【输出校验】无',
      '【交付产物】无',
      '【群聊回复】阻塞，请 @PM 协调。',
    ].join('\n');
    expect(
      validateSmartWorkflowMirrorSections(devBlocked, {
        smartMemberReadiness: 'blocked',
        viewerAgentId: 'a-dev',
        projectId: 't1',
        smartWorkSteps: steps,
        roomMessages: [],
      }),
    ).not.toContain('input_validation_section_required');
  });

  it('member with deliverable [] and dependency report passes when readiness is ready (mis-dispatch)', () => {
    const json = JSON.stringify({
      role: '开发',
      taskUnderstanding:
        '协调者误派：上游需求文档尚未交付，本步无可交付物，须向协调者说明阻塞。',
      deliverable: { items: [], outputValidation: '无' },
      roomReply:
        '上游 requirements-产品.md 未就绪，无法开工。需要协调产品先交付后再派工。',
      action: 'help',
      dispatch: smartDispatch('help', [
        { role: 'PM', task: '请协调产品先交付 requirements-产品.md 后再派工。' },
      ]),
    });
    const r = validateRoomMentionStructuredReply({
      raw: json,
      transportReason: 'empty',
      executionMode: 'smart',
      isCoordinator: false,
      actorRoleName: '开发',
      smartMemberReadiness: 'ready',
      coordinatorRole: agent('a-pm', 'PM'),
      teamRoles: [
        { id: 'pm', name: 'PM', agentId: 'a' },
        { id: 'dev', name: '开发', agentId: 'b' },
        { id: 'product', name: '产品', agentId: 'c' },
      ],
      projectId: 't1',
      roomMessages: [],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) {
      expect(r.issues).not.toContain('deliverable_missing_file_path');
      expect(r.issues).not.toContain('smart_member_missing_file_deliverable');
      expect(r.issues).not.toContain('smart_member_missing_action_end');
    }
  });

  it('runSmartStructuredLayers123 reports syntax stage for non-json smart output', async () => {
    const { runSmartStructuredLayers123 } = await import('../../src/lib/office-smart-structured-validation');
    const r = runSmartStructuredLayers123({
      raw: '【群聊回复】仅 bracket 无 JSON',
      isCoordinator: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.stage).toBe('syntax');
  });

  it('shouldSkipSmartStructuredDiskLayer skips member help and coordinator end', async () => {
    const {
      shouldSkipSmartStructuredDiskLayer,
      resolveSmartMemberHelpAction,
    } = await import('../../src/lib/office-smart-structured-validation');
    const { smartJsonToBracketText } = await import('../../src/lib/office-smart-json-schema');
    const helpJson = {
      role: '成员A',
      taskUnderstanding: '上游未就绪。',
      action: 'help' as const,
      deliverable: { items: [], outputValidation: [] as string[] },
      roomReply: '请协调者确认上游交付物。',
      dispatch: [{ role: '协调者', task: '请确认上游。' }],
    };
    const helpRaw = JSON.stringify(helpJson);
    const helpBracket = smartJsonToBracketText(helpJson, false);
    expect(resolveSmartMemberHelpAction(helpRaw, helpBracket, false)).toBe(true);
    expect(
      shouldSkipSmartStructuredDiskLayer({
        isCoordinator: false,
        inputRaw: helpRaw,
        normalizedRaw: helpBracket,
      }),
    ).toBe(true);

    const endJson = {
      role: '协调者',
      taskUnderstanding: '全部子任务完成，结项。',
      action: 'end' as const,
      deliverable: { items: [], outputValidation: [] as string[] },
      roomReply: '项目已全部完成，感谢各位。**项目结项**',
      dispatch: [] as Array<{ role: string; task: string }>,
    };
    const endBracket = smartJsonToBracketText(endJson, true);
    expect(
      shouldSkipSmartStructuredDiskLayer({
        isCoordinator: true,
        inputRaw: JSON.stringify(endJson),
        normalizedRaw: endBracket,
      }),
    ).toBe(true);
  });

  it('validateSmartMentionReply skips disk for help and omits disk stage without verifyDisk', async () => {
    const { validateSmartMentionReply } = await import(
      '../../electron/services/office/room-mention-smart-validation'
    );
    const helpJson = JSON.stringify({
      role: '算子性能优化工程师',
      taskUnderstanding: '上游未就绪，向协调者求助。',
      action: 'help',
      deliverable: { items: [], outputValidation: [] },
      roomReply: '依赖未就绪，请协调者确认上游交付物路径与验收状态后再派工。',
      dispatch: [{ role: '算子leader', task: '请确认上游是否已交付。' }],
    });
    const diskSpy = vi.fn(async () => ({ ok: false, detail: '不应调用落盘' }));
    const helpResult = await validateSmartMentionReply({
      raw: helpJson,
      transportReason: 'empty',
      isCoordinator: false,
      actorRoleName: '算子性能优化工程师',
      coordinatorRole: { id: 'leader', name: '算子leader' },
      teamRoles: [{ id: 'leader', name: '算子leader', agentId: 'a' }],
      verifyDisk: diskSpy,
    });
    expect(helpResult.ok).toBe(true);
    expect(diskSpy).not.toHaveBeenCalled();
    expect(helpResult.structuredStage).not.toBe('disk');

    const helpNoDisk = await validateSmartMentionReply({
      raw: helpJson,
      transportReason: 'empty',
      isCoordinator: false,
      actorRoleName: '算子性能优化工程师',
      coordinatorRole: { id: 'leader', name: '算子leader' },
      teamRoles: [{ id: 'leader', name: '算子leader', agentId: 'a' }],
    });
    expect(helpNoDisk.ok).toBe(true);
    expect(helpNoDisk.structuredStage).toBe('semantics');
  });

  it('isSmartMemberHelpAction detects help from JSON only', async () => {
    const { isSmartMemberHelpAction } = await import('../../src/lib/office-smart-member-reply');
    const { smartJsonToBracketText } = await import('../../src/lib/office-smart-json-schema');
    const json = {
      role: '算子性能优化工程师',
      taskUnderstanding: '上游未就绪，向协调者求助。',
      action: 'help' as const,
      deliverable: { items: [], outputValidation: [] as string[] },
      roomReply: '依赖未就绪，请协调者确认上游交付物。',
      dispatch: [{ role: '算子leader', task: '请确认上游是否已交付。' }],
    };
    const rawJson = JSON.stringify(json);
    expect(isSmartMemberHelpAction(rawJson)).toBe(true);
    const bracket = smartJsonToBracketText(json, false);
    expect(isSmartMemberHelpAction(bracket)).toBe(false);
  });

  it('resolveValidatedMentionJsonRaw returns input JSON not bracket mirror for Smart dispatch', async () => {
    const { resolveValidatedMentionJsonRaw } = await import(
      '../../electron/services/office/room-mention-llm'
    );
    const {
      isSmartJsonShapeText,
      parseSmartCoordinatorJsonOutput,
      smartJsonToBracketText,
    } = await import('../../src/lib/office-smart-json-schema');
    const inputJson = JSON.stringify({
      role: 'AI-Agent开发专家',
      inputValidation: '无',
      taskUnderstanding: 'kickoff 并行指派两位成员调研。',
      roomReply: '项目 kickoff：并行指派两位成员开展第一阶段调研。',
      action: 'assign',
      deliverable: { items: [], outputValidation: [] },
      dispatch: [
        { role: 'AI-Agent工程专家', task: '调研优秀方案与案例。' },
        { role: '大模型调优专家', task: '调研机会与未来展望。' },
      ],
    });
    const coordJson = parseSmartCoordinatorJsonOutput(inputJson);
    expect(coordJson).not.toBeNull();
    const bracketMirror = smartJsonToBracketText(coordJson!, true);
    expect(isSmartJsonShapeText(bracketMirror)).toBe(false);
    expect(isSmartJsonShapeText(inputJson)).toBe(true);
    const validated = {
      ok: true as const,
      roomText: '群聊展示正文',
      raw: inputJson,
      parsed: {
        understanding: '',
        judgment: '',
        roomReply: '',
        dispatch: '',
        raw: bracketMirror,
      },
    };
    expect(resolveValidatedMentionJsonRaw(validated)).toBe(inputJson);
  });

  it('verifySmartMentionStructuredPathsOnDisk skips deliverable check for help JSON', async () => {
    const { verifySmartMentionStructuredPathsOnDisk } = await import(
      '../../electron/services/office/room-mention-disk-verify'
    );
    const json = {
      role: '算子性能优化工程师',
      taskUnderstanding: '上游未就绪，向协调者求助。',
      action: 'help' as const,
      deliverable: { items: [], outputValidation: [] as string[] },
      roomReply:
        '依赖未就绪：算子开发工程师的交付物尚未落盘，无法开展性能优化，请确认上游状态。',
      dispatch: [{ role: '算子leader', task: '请确认上游交付物是否已完成。' }],
    };
    const rawJson = JSON.stringify(json);
    const result = await verifySmartMentionStructuredPathsOnDisk({
      raw: rawJson,
      task: { id: 't-cuda', title: 'cuda', coordinatorRoleId: 'leader' },
      scenario: { coordinatorRoleId: 'leader', roleIds: ['leader', 'perf'] },
      role: { id: 'perf', agentId: 'a-perf', name: '算子性能优化工程师' },
      teamRoles: [
        { id: 'leader', agentId: 'a-leader', name: '算子leader' },
        { id: 'perf', agentId: 'a-perf', name: '算子性能优化工程师' },
      ],
      requireDeliverableFile: true,
      isCoordinator: false,
    });
    expect(result.ok).toBe(true);
  });

  it('verifySmartMentionStructuredPathsOnDisk reads deliverable.items from member JSON', async () => {
    const { verifySmartMentionStructuredPathsOnDisk } = await import(
      '../../electron/services/office/room-mention-disk-verify'
    );
    const { declaredDeliverablePathsFromSmartMemberJson } = await import(
      '@/lib/office-deliverable-disk-resolve'
    );
    const json = {
      role: '大模型调优专家',
      taskUnderstanding: '完成调研报告并落盘。',
      action: 'end' as const,
      deliverable: {
        items: ['交付物-大模型调优专家/机会与未来展望调研-大模型调优专家.md'],
        outputValidation: ['-rw-r--r-- 1 user group 20531 Jun 25 report.md'],
      },
      dispatch: [{ role: '协调者', task: '请验收交付物。' }],
    };
    const rawJson = JSON.stringify(json);
    expect(
      declaredDeliverablePathsFromSmartMemberJson(rawJson),
    ).toEqual(['交付物-大模型调优专家/机会与未来展望调研-大模型调优专家.md']);
    const result = await verifySmartMentionStructuredPathsOnDisk({
      raw: rawJson,
      task: { id: 't-agent', title: 'AI-Agent', coordinatorRoleId: 'coord' },
      scenario: { coordinatorRoleId: 'coord', roleIds: ['coord', 'tune'] },
      role: { id: 'tune', agentId: 'a-tune', name: '大模型调优专家' },
      teamRoles: [
        { id: 'coord', agentId: 'a-coord', name: '协调者' },
        { id: 'tune', agentId: 'a-tune', name: '大模型调优专家' },
      ],
      requireDeliverableFile: true,
      isCoordinator: false,
    });
    expect(result.detail).not.toContain('deliverable.items 为空');
  });

  it('member help action skips deliverable value validation for dependency requests', () => {
    const json = JSON.stringify({
      role: '算子性能优化工程师',
      taskUnderstanding:
        '上游算子功能原型与性能目标尚未提供，本轮只能向协调者求助确认输入。',
      deliverable: { items: [], outputValidation: [] },
      roomReply:
        '【依赖阻塞】上游算子功能原型与性能目标尚未提供，无法制定具体优化方案，请协调者确认上游输入。',
      action: 'help',
      dispatch: smartDispatch('help', [
        {
          role: '算子leader',
          task: '请提供算子功能原型与具体性能目标，以便制定性能优化方案。',
        },
      ]),
    });

    const structure = validateSmartRoomJsonStructure(json, {
      isCoordinator: false,
      actorRoleName: '算子性能优化工程师',
    });
    expect(structure.ok).toBe(true);

    const r = validateRoomMentionStructuredReply({
      raw: json,
      transportReason: 'empty',
      executionMode: 'smart',
      isCoordinator: false,
      actorRoleName: '算子性能优化工程师',
      smartMemberReadiness: 'ready',
      coordinatorRole: { id: 'leader', name: '算子leader' },
      teamRoles: [
        { id: 'leader', name: '算子leader', agentId: 'a' },
        { id: 'perf', name: '算子性能优化工程师', agentId: 'b' },
      ],
      projectId: 't1',
      roomMessages: [],
    });
    expect(r.ok).toBe(true);
  });

  it('member help without roomReply passes when taskUnderstanding explains missing assignment', () => {
    const json = JSON.stringify({
      role: 'AI-Agent工程专家',
      taskUnderstanding:
        '项目为AI-Agent优秀方案探索，但当前未收到本次点名分配的具体任务内容，需协调者明确任务指派',
      action: 'help',
      deliverable: { items: [], outputValidation: [] },
      dispatch: [
        {
          role: 'AI-Agent开发专家',
          task: '请提供本次点名的具体任务内容（见本次点名），以便我方开展执行工作',
        },
      ],
    });

    const r = validateRoomMentionStructuredReply({
      raw: json,
      transportReason: 'empty',
      executionMode: 'smart',
      isCoordinator: false,
      actorRoleName: 'AI-Agent工程专家',
      smartMemberReadiness: 'ready',
      coordinatorRole: { id: 'coord', name: 'AI-Agent开发专家' },
      teamRoles: [
        { id: 'coord', name: 'AI-Agent开发专家', agentId: 'a' },
        { id: 'eng', name: 'AI-Agent工程专家', agentId: 'b' },
      ],
      projectId: 't1',
      roomMessages: [],
    });
    expect(r.ok).toBe(true);
  });

  it('rejects coordinator help action', () => {
    const json = JSON.stringify({
      role: '算子leader',
      inputValidation: '无',
      taskUnderstanding: '协调者不能使用 help 动作。',
      action: 'help',
      deliverable: { items: [], outputValidation: '无' },
      roomReply: '请成员继续推进。',
      dispatch: [{ role: '算子开发工程师', task: '请确认上游输入。' }],
    });
    const r = validateSmartRoomJsonStructure(json, {
      isCoordinator: true,
      actorRoleName: '算子leader',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toContain('help 仅允许 Smart 成员');
  });

  it('rejects member review action', () => {
    const json = JSON.stringify({
      role: '算子性能优化工程师',
      taskUnderstanding: '成员不能使用 review 动作。',
      action: 'review',
      deliverable: { items: [], outputValidation: '无' },
      roomReply: '我已收到协调者通知。',
      dispatch: [],
    });
    const r = validateSmartRoomJsonStructure(json, {
      isCoordinator: false,
      actorRoleName: '算子性能优化工程师',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toContain('禁止使用 review');
  });

  it('rejects member assign action', () => {
    const json = JSON.stringify({
      role: '算子开发工程师',
      taskUnderstanding:
        '完成CUDA power算子源码和优化思路文档，错误地使用 assign 表示请求验收。',
      action: 'assign',
      deliverable: {
        items: ['operation_power.cu', 'optimization_notes.md'],
        outputValidation: [
          '-rw-r--r-- 1 demo staff 4896 Jun 12 13:18 operation_power.cu',
          '-rw-r--r-- 1 demo staff 4865 Jun 12 13:18 optimization_notes.md',
        ],
      },
      roomReply:
        '**CUDA power算子源码及优化思路文档已完成**，交付物包括 operation_power.cu 和 optimization_notes.md。',
      dispatch: smartDispatch('assign', [
        { role: '算子leader', task: '请验收CUDA power算子源码和优化思路文档。' },
      ]),
    });
    const r = validateSmartRoomJsonStructure(json, {
      isCoordinator: false,
      actorRoleName: '算子开发工程师',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toContain('成员 action 仅允许 "end" 或 "help"');
  });

  it('uses member action=end as completion basis with done marker', () => {
    const deliverable = smartDeliverableDir('A股分析师');
    const json = JSON.stringify({
      role: 'A股分析师',
      taskUnderstanding:
        '基于协调者指派，收集A股市场2021-2025年历史数据，完成主要指数涨跌幅、关键行业表现、市场特征总结等分析，交付物为A股市场分析报告',
      deliverable,
      roomReply:
        '**A股市场分析已完成**：交付 交付物-A股分析师/，包含2021-2025年上证指数、深证成指、创业板指涨跌幅，以及关键行业表现和市场特征总结',
      action: 'end',
      dispatch: smartDispatch('end', [
        { role: '上帝', task: '请验收 A股市场分析报告。' },
      ]),
    });
    const r = validateRoomMentionStructuredReply({
      raw: json,
      transportReason: 'empty',
      executionMode: 'smart',
      isCoordinator: false,
      actorRoleName: 'A股分析师',
      coordinatorRole: { id: 'god', name: '上帝' },
      smartMemberReadiness: 'ready',
      teamRoles: [
        { id: 'god', name: '上帝', agentId: 'a' },
        { id: 'cn', name: 'A股分析师', agentId: 'b' },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.roomText).toContain('@上帝');
    }
  });

  it('accepts member action=end without done marker in roomReply', () => {
    const deliverable = smartDeliverableDir('A股分析师');
    const json = JSON.stringify({
      role: 'A股分析师',
      taskUnderstanding:
        '基于协调者指派完成A股市场分析，报告文件已写入项目目录。',
      deliverable,
      roomReply:
        '请查看本轮材料 交付物-A股分析师/，内容已放入指定目录，后续可继续安排。',
      action: 'end',
      dispatch: smartDispatch('end', [
        { role: '上帝', task: '请查看 交付物-A股分析师/。' },
      ]),
    });
    const r = validateRoomMentionStructuredReply({
      raw: json,
      transportReason: 'empty',
      executionMode: 'smart',
      isCoordinator: false,
      actorRoleName: 'A股分析师',
      coordinatorRole: { id: 'god', name: '上帝' },
      smartMemberReadiness: 'ready',
      teamRoles: [
        { id: 'god', name: '上帝', agentId: 'a' },
        { id: 'cn', name: 'A股分析师', agentId: 'b' },
      ],
      taskId: 't-a',
      roomMessages: [],
    });
    expect(r.ok).toBe(true);
  });

  it('accepts member deliverable name array when outputValidation contains ls lines', () => {
    const json = JSON.stringify({
      role: '算子开发工程师',
      taskUnderstanding:
        '实现CUDA算子原型，包含完整CUDA kernel实现，支持基本加法功能并编译通过。',
      deliverable: smartDeliverableDir('算子开发工程师'),
      roomReply:
        '**CUDA算子原型实现已完成**：交付 交付物-算子开发工程师/，包含完整CUDA kernel实现，支持基本加法功能。',
      action: 'end',
      dispatch: smartDispatch('end', [
        { role: '算子leader', task: '请验收CUDA算子原型实现交付物。' },
      ]),
    });
    const r = validateRoomMentionStructuredReply({
      raw: json,
      transportReason: 'empty',
      executionMode: 'smart',
      isCoordinator: false,
      actorRoleName: '算子开发工程师',
      coordinatorRole: { id: 'leader', name: '算子leader' },
      smartMemberReadiness: 'ready',
      teamRoles: [
        { id: 'leader', name: '算子leader', agentId: 'a' },
        { id: 'dev', name: '算子开发工程师', agentId: 'b' },
      ],
      taskId: 't-cuda',
      roomMessages: [],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) {
      expect(r.issues).not.toContain('deliverable_missing_file_path');
    }
  });

  it('requires ls -l stat line when paths are declared in validation sections', () => {
    const path = '/Users/demo/project/out.md';
    const statLine = `-rw-r--r-- 1 user staff 100 May 26 10:00 ${path}`;
    expect(
      validationSectionDocumentsLsForPaths('文件已存在', [path]),
    ).toBe(false);
    expect(
      validationSectionDocumentsLsForPaths(`ls -l ${path}`, [path]),
    ).toBe(false);
    expect(
      validationSectionDocumentsLsForPaths(statLine, [path]),
    ).toBe(true);
    expect(
      validationSectionDocumentsLsForPaths(
        `【输入校验】 ${statLine}`,
        [path],
      ),
    ).toBe(true);
    expect(
      validationSectionDocumentsLsForPaths(
        `ls -l ${path}\n${statLine}`,
        [path],
      ),
    ).toBe(true);
  });

  it('trims trailing Chinese prose after deliverable path hints', () => {
    const text =
      '/Users/lixingwei/.openclaw/workspace-pm/office/projects/象棋游戏开发-task-1780146825928-mw04mq/需求文档-产品.md。文档包含象棋规则与交互说明';
    expect(collectDeliverablePathHintsFromText(text)).toEqual([
      '/Users/lixingwei/.openclaw/workspace-pm/office/projects/象棋游戏开发-task-1780146825928-mw04mq/需求文档-产品.md',
    ]);
  });

  it('coordinator dispatch allows any @ team member (rework / fix)', () => {
    const team = [
      SMART_AGENTS.pm,
      SMART_AGENTS.dev,
    ];
    expect(
      validateSmartCoordinatorRoomMentions({
        publishText: '@开发 请开始实现',
        dispatchText: '@开发 实现模块',
        coordinatorAgentId: 'a-pm',
        nextExecutorRoleId: 'a-dev',
        teamRoles: smartProgressTeam,
      }),
    ).toBe('ok');
    const teamWithQa = [
      ...team,
      SMART_AGENTS.qa,
    ];
    expect(
      validateSmartCoordinatorRoomMentions({
        publishText: '@开发 请开始',
        dispatchText: '@开发 实现模块；@测试 请先准备环境',
        coordinatorAgentId: 'a-pm',
        nextExecutorRoleIds: ['a-dev', 'a-qa'],
        teamRoles: teamWithQa,
      }),
    ).toBe('ok');
    expect(
      validateSmartCoordinatorRoomMentions({
        publishText: '@PM 开始拆解任务',
        dispatchText: '',
        coordinatorAgentId: 'a-pm',
        nextExecutorRoleId: 'a-dev',
        teamRoles: smartProgressTeam,
      }),
    ).toBe('missing_mention');
    expect(
      validateSmartCoordinatorRoomMentions({
        publishText: '@开发 交付路径无效请修正',
        dispatchText: '@开发 交付路径无效请修正',
        coordinatorAgentId: 'a-pm',
        nextExecutorRoleId: 'a-dev',
        teamRoles: smartProgressTeam,
        allowReporterFixRoleId: 'a-dev',
      }),
    ).toBe('ok');
  });

  it('allows coordinator to @ upstream producer when member input validation failed', () => {
    const team = [
      SMART_AGENTS.pm,
      SMART_AGENTS.product,
      SMART_AGENTS.dev,
    ];
    const steps = resolveSmartWorkOrderSteps(scenario, '', roles);
    expect(resolveSmartPriorProducerRoleId('a-dev', steps)).toBe('a-pm');
    expect(resolveSmartPriorStepProducerRoleIds('a-dev', steps)).toEqual(['a-pm']);
    expect(
      validateSmartCoordinatorRoomMentions({
        publishText: '@产品 请补交付 requirements-产品.md',
        dispatchText: '@产品 补全上游交付物',
        coordinatorAgentId: 'a-pm',
        nextExecutorRoleId: 'a-dev',
        teamRoles: team,
        allowUpstreamProducerRoleId: 'a-product',
      }),
    ).toBe('ok');
  });

  it('coordinator @ next executor in dispatch only passes mention check', () => {
    expect(
      validateSmartCoordinatorRoomMentions({
        publishText: '请按分工推进子任务。',
        dispatchText: '@开发 请完成开发实现并写入项目目录',
        coordinatorAgentId: 'a-pm',
        nextExecutorRoleId: 'a-dev',
        teamRoles: smartProgressTeam,
      }),
    ).toBe('ok');
    expect(
      validateSmartCoordinatorRoomMentions({
        publishText: '请按分工推进子任务。',
        dispatchText: '无',
        coordinatorAgentId: 'a-pm',
        nextExecutorRoleId: 'a-dev',
        teamRoles: smartProgressTeam,
      }),
    ).toBe('missing_mention');
  });

  it('member @ coordinator in dispatch only passes mention check', () => {
    const coord = agent('a-pm', 'PM');
    expect(
      validateSmartMemberRoomReply('**需求规格说明书已完成** 请验收。', coord, 'ready', {
        teamRoles: smartProgressTeam,
        dispatchText: '无',
      }),
    ).toContain('smart_member_missing_coordinator');
    expect(
      validateSmartMemberRoomReply('**需求规格说明书已完成** 请验收。', coord, 'ready', {
        teamRoles: smartProgressTeam,
        dispatchText: '请 @PM 验收 requirements-产品.md',
      }),
    ).not.toContain('smart_member_missing_coordinator');
  });

  it('member action=end JSON with dispatch @coordinator agentId passes structured validation', async () => {
    const { runSmartStructuredLayers123 } = await import(
      '../../src/lib/office-smart-structured-validation'
    );
    const { trySalvageMemberMentionRoomReply } = await import(
      '../../electron/services/office/room-mention-structured-reply'
    );
    const coord = { agentId: 'ai-agent-kai-fa-zhuan-jia', displayName: 'AI-Agent开发专家' };
    const memberRole = '大模型调优专家';
    const deliverable = smartDeliverableDir('大模型调优专家');
    const userJson = JSON.stringify({
      role: memberRole,
      taskUnderstanding:
        '输入资源为无（首轮独立调研），核心目标是调研大模型在实际运用中遇到的现实问题，最终交付物为《大模型运用问题-大模型调优专家.md》文档，涵盖技术瓶颈、工程化落地、业务场景适配三大类问题，每类不少于3个具体问题点并配真实案例或数据支撑',
      action: 'end',
      deliverable,
      roomReply:
        '大模型运用问题-大模型调优专家已完成，交付物《交付物-大模型调优专家/大模型运用问题-大模型调优专家.md》已落盘。文档涵盖三大类问题：技术瓶颈（幻觉、上下文限制、推理成本、知识实时性、可解释性）、工程化落地（部署监控、迭代优化、多模型编排）、业务场景适配（准确性合规、领域知识融入、用户体验、多语言跨文化），共14个具体问题点，均配有真实案例或行业数据引用，请协调者验收。',
      dispatch: [
        {
          role: 'AI-Agent开发专家',
          task: '请验收交付物 交付物-大模型调优专家/',
        },
      ],
    });
    const structured = runSmartStructuredLayers123({
      raw: userJson,
      isCoordinator: false,
      actorRoleName: memberRole,
      flow: {
        coordinatorRole: coord,
        smartMemberReadiness: 'ready',
        teamRoles: [coord, { agentId: 'da-mo-xing-tiao-you-zhuan-jia', displayName: memberRole }],
        actorRoleName: memberRole,
      },
    });
    expect(structured.ok, structured.ok ? '' : JSON.stringify(structured)).toBe(true);
    const { validateSmartRoomMentionSync } = await import(
      '../../electron/services/office/room-mention-smart-validation'
    );
    const sync = validateSmartRoomMentionSync({
      raw: userJson,
      transportReason: 'empty',
      executionMode: 'smart',
      isCoordinator: false,
      coordinatorRole: coord,
      smartMemberReadiness: 'ready',
      actorRoleName: memberRole,
      teamRoles: [coord, { agentId: 'da-mo-xing-tiao-you-zhuan-jia', displayName: memberRole }],
    });
    expect(sync.ok, sync.ok ? '' : JSON.stringify(sync)).toBe(true);
    const salvaged = trySalvageMemberMentionRoomReply({
      raw: userJson,
      coordinator: coord,
      smartMemberReadiness: 'ready',
      actorRoleName: memberRole,
    });
    expect(salvaged).toBeTruthy();
  });

  it('JSON validation accepts roomReply with done marker and short summary (no 72-char rule)', async () => {
    const { isSmartMemberDeliverableReply, isSmartMemberJsonRoomReplyDeliverableComplete } =
      await import('../../src/lib/office-smart-member-reply');
    const coord = agent('a-pm', 'PM');
    const roomReply =
      '**需求规格说明书已完成**，文件已落盘至项目根目录，包含游戏功能描述、界面交互说明、胜利播报规则。详细内容请查看文件。@PM';
    const deliverablePath =
      '-rw-r--r-- 1 u 1 1790 6 3 10:35 /Users/demo/project/需求规格说明书-产品.md';
    expect(isSmartMemberDeliverableReply(roomReply)).toBe(false);
    expect(isSmartMemberJsonRoomReplyDeliverableComplete(roomReply)).toBe(true);
    expect(
      validateSmartMemberRoomReply(roomReply, coord, 'ready', {
        deliverablePathText: `需求规格说明书-产品.md：摘要\n${deliverablePath}`,
        dispatchText: '无',
        memberEnd: true,
      }),
    ).not.toContain('smart_member_missing_deliverable');
  });

  it('rejects member lazy reply when input validation failed', () => {
    const coord = agent('a-pm', 'PM');
    const team = [
      coord,
      agent('a-dev', '开发'),
    ];
    expect(
      validateSmartMemberRoomReply(
        JSON.stringify({
          role: '开发',
          action: 'end',
          taskUnderstanding: '开发模块已完成。',
          deliverable: { items: ['交付物-开发/out.md'], outputValidation: [] },
          dispatch: [{ role: 'PM', task: '请验收。' }],
        }),
        coord,
        'blocked',
        {
        teamRoles: smartProgressTeam,
        inputValidationFailed: true,
          dispatchText: '@PM 请验收',
        },
      ),
    ).toContain('smart_member_input_invalid_lazy');
    expect(
      validateSmartMemberRoomReply(
        JSON.stringify({
          role: '开发',
          action: 'help',
          taskUnderstanding: '上游 requirements-产品.md 不存在，无法开工。请 @PM 协调补交付。',
          deliverable: { items: [], outputValidation: [] },
          dispatch: [{ role: 'PM', task: '请协调补交付。' }],
        }),
        coord,
        'blocked',
        { teamRoles: team, inputValidationFailed: true, dispatchText: '@PM 请协调补交付。' },
      ),
    ).not.toContain('smart_member_input_invalid_lazy');
  });

  it('ignores member @ peer in room reply for routing validation', () => {
    const coord = agent('a-pm', 'PM');
    expect(
      validateSmartMemberRoomReply('请 @开发 先交付接口文档，我再实现。请 @PM 知悉。', coord, 'blocked', {
        teamRoles: smartProgressTeam,
        dispatchText: '@PM 请协调接口文档依赖。',
      }),
    ).not.toContain('smart_member_mentions_peer');
  });

  it('classifies input validation failure reports', () => {
    const failureJson = JSON.stringify({
      role: '开发',
      action: 'help',
      taskUnderstanding: '【输入校验】上游路径不存在，无法开工。请 @PM 协调。',
      deliverable: { items: [], outputValidation: [] },
      dispatch: [{ role: 'PM', task: '请协调上游补交付。' }],
    });
    expect(classifySmartMemberReportToCoordinator(failureJson)).toBe(
      'input_validation_failed',
    );
    expect(isSmartMemberInputValidationFailureReport(failureJson)).toBe(true);
  });

  it('requires coordinator input section when scoped input paths exist', () => {
    const path = '/Users/demo/.openclaw/workspace-pm/office/projects/demo-task/out-dev.md';
    const scope = { inputPaths: [path], outputPaths: [] as string[] };
    const bad = [
      '【任务理解】本步验收开发侧交付物是否已写入协调者项目目录。',
      '【输入校验】',
      '【输出校验】无',
      '【交付产物】无',
      '【群聊回复】@开发 请修正。',
    ].join('\n');
    expect(
      validateSmartWorkflowMirrorSections(bad, {
        isCoordinator: true,
        smartValidationScope: scope,
      }),
    ).toContain('input_validation_section_required');
    const good = [
      '【任务理解】本步验收开发侧交付物是否已写入协调者项目目录。',
      `【输入校验】已核查上一跳交付物 ${path}`,
      '【输出校验】无',
      '【交付产物】无',
    ].join('\n');
    expect(
      validateSmartWorkflowMirrorSections(good, {
        isCoordinator: true,
        smartValidationScope: scope,
      }),
    ).not.toContain('input_validation_section_required');
  });

  it('PM @产品 负责需求分析 推断为 ready', () => {
    const product = agent('a-product', '产品');
    const line = JSON.stringify({
      role: 'PM',
      action: 'assign',
      roomReply: '请产品负责需求分析。',
      dispatch: [
        {
          role: '产品',
          task: '负责需求分析，输出需求文档 requirements-产品.md',
        },
      ],
      taskUnderstanding: '派活',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: '无' },
    });
    expect(hasCoordinatorDirectAssignmentToRole(line, product)).toBe(true);
    expect(
      inferSmartMemberReadinessForMention({
        coordinatorRoomLine: line,
        mentionTargetRole: product,
      }),
    ).toBe('ready');
  });

  it('resolveSmartMemberReadiness 保留 hinted ready（空任务理解不降级）', () => {
    expect(resolveSmartMemberReadiness('ready', '')).toBe('ready');
    expect(resolveSmartMemberReadiness('ready', '【任务理解】')).toBe('ready');
  });

  it('dispatch：仅协调者 dispatch 推断 ready，不读磁盘分工', () => {
    const product = agent('a-product', '产品');
    const line = JSON.stringify({
      role: 'PM',
      action: 'assign',
      roomReply: '请产品输出需求文档。',
      dispatch: [{ role: '产品', task: '负责需求分析，输出需求文档 requirements-产品.md' }],
      taskUnderstanding: '派活',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: '无' },
    });
    expect(
      resolveSmartMemberReadinessForMentionDispatch({
        coordinatorRoomLine: line,
        mentionTargetRole: { id: 'a-product', name: '产品' },
      }),
    ).toBe('ready');
    expect(
      resolveSmartMemberReadinessForMentionDispatch({
        coordinatorRoomLine: '@产品 负责需求分析，输出需求文档 requirements-产品.md',
        mentionTargetRole: product,
      }),
    ).toBe('blocked');
  });

  it('resolveSmartMemberReadinessForMentionDispatch accepts id/name without agentId', () => {
    const line = JSON.stringify({
      role: 'PM',
      action: 'assign',
      roomReply: '@工程 调研方案',
      dispatch: [{ role: '工程', task: '输出调研报告' }],
      taskUnderstanding: '派活',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: '无' },
    });
    expect(
      resolveSmartMemberReadinessForMentionDispatch({
        coordinatorRoomLine: line,
        mentionTargetRole: { id: 'a-eng', name: '工程' },
      }),
    ).toBe('ready');
  });

  it('协调者 dispatch 无派活给该角色时 blocked（roomReply @ 不计）', () => {
    const product = agent('a-product', '产品');
    expect(
      resolveSmartMemberReadinessForMentionDispatch({
        coordinatorRoomLine: '@产品 请看下需求目录并补充说明',
        mentionTargetRole: product,
      }),
    ).toBe('blocked');
  });

  it('Smart PM 结构化 dispatch 派活时直接点名产品，不转协调者', () => {
    const team = [
      agent('a-pm', 'PM'),
      agent('a-coord', '协调者'),
      agent('a-product', '产品'),
    ];
    const product = team[2]!;
    const content = JSON.stringify({
      role: 'PM',
      action: 'assign',
      roomReply: '请产品负责需求分析。',
      dispatch: [{ role: '产品', task: '输出需求文档 requirements-产品.md' }],
      taskUnderstanding: '派活',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: '无' },
    });
    const out = applySmartDirectMentionTargets({
      executionMode: 'smart',
      coordinatorAgentId: 'a-coord',
      fromAgentId: 'a-pm',
      content,
      targets: [product],
      teamRoles: smartProgressTeam,
    });
    expect(out.map((r) => r.agentId)).toEqual(['a-product']);
  });

  it('Smart 成员互 @ 仍仅派协调者', () => {
    const team = [
      agent('a-coord', '协调者'),
      agent('a-dev', '开发'),
      agent('a-product', '产品'),
    ];
    const out = applySmartDirectMentionTargets({
      executionMode: 'smart',
      coordinatorAgentId: 'a-coord',
      fromAgentId: 'a-dev',
      content: '@产品 你看下这个接口行不行？',
      targets: [team[2]!],
      teamRoles: smartProgressTeam,
    });
    expect(out.map((r) => r.agentId)).toEqual(['a-coord']);
  });

  it('rejects coordinator @ invented team role', () => {
    expect(
      validateSmartCoordinatorRoomMentions({
        publishText: '【群聊回复】@前端开发A 请开始子任务1',
        dispatchText: '【分工】@前端开发A 搭建框架',
        coordinatorAgentId: 'a-pm',
        nextExecutorRoleId: 'a-product',
        teamRoles: smartProgressTeam,
      }),
    ).toBe('mentions_unknown_team_role');
  });

  it('accepts coordinator action=end only when all work-order steps are done in room', () => {
    const rawWithClosure = JSON.stringify({
      role: 'PM',
      inputValidation: '无',
      taskUnderstanding: '全部子任务已验收，现结项广播。',
      action: 'end',
      deliverable: { items: [], outputValidation: '无' },
      roomReply: '全部子任务已验收，项目正式结束，感谢各位参与。',
      dispatch: [],
    });
    expect(
      validateSmartCoordinatorProjectEnd({
        raw: rawWithClosure,
        allStepsComplete: true,
      }),
    ).toBe('ok');
    expect(
      validateSmartCoordinatorProjectEnd({
        raw: rawWithClosure,
        allStepsComplete: false,
      }),
    ).toBe('premature_project_end');
  });

  it('isSmartProjectEngineComplete is false when work order steps are empty and no assign history', () => {
    expect(
      isSmartProjectEngineComplete({
        steps: [],
        roomMessages: [],
        projectId: 't1',
        coordinatorAgentId: 'a-coord',
        teamRoles: [{ agentId: 'a-coord', displayName: '协调者' }],
      }),
    ).toBe(false);
  });

  it('isSmartProjectEngineComplete when member steps done and next is coordinator', () => {
    const steps: SmartWorkOrderStep[] = [
      { stepIndex: 1, nodeId: 'n1', title: '测试', roleIds: ['a-qa'] },
      { stepIndex: 2, nodeId: 'n2', title: '开发', roleIds: ['a-dev'] },
      { stepIndex: 3, nodeId: 'n3', title: '结项', roleIds: ['a-coord'] },
    ];
    const room: RoomMessage[] = [
      {
        id: 'm1',
        scenarioId: 's1',
        projectId: 't1',
        from: 'agent',
        fromAgentId: 'a-qa',
        content: '**测试计划已完成**',
        smartMemberEnd: true,
        mentions: [],
        timestamp: 100,
      },
      {
        id: 'm2',
        scenarioId: 's1',
        projectId: 't1',
        from: 'agent',
        fromAgentId: 'a-dev',
        content: '**开发已完成**',
        smartMemberEnd: true,
        mentions: [],
        timestamp: 200,
      },
    ];
    expect(
      isSmartProjectEngineComplete({
        steps,
        roomMessages: room,
        projectId: 't1',
        coordinatorAgentId: 'a-coord',
      }),
    ).toBe(true);
  });

  it('accepts coordinator action=end when members done and coordinator owns last step', () => {
    const steps: SmartWorkOrderStep[] = [
      { stepIndex: 1, nodeId: 'n1', title: '测试', roleIds: ['a-qa'] },
      { stepIndex: 2, nodeId: 'n2', title: '开发', roleIds: ['a-dev'] },
      { stepIndex: 3, nodeId: 'n3', title: '结项', roleIds: ['a-coord'] },
    ];
    const room: RoomMessage[] = [
      {
        id: 'm1',
        scenarioId: 's1',
        projectId: 't1',
        from: 'agent',
        fromAgentId: 'a-qa',
        content: '**测试计划已完成**',
        smartMemberEnd: true,
        mentions: [],
        timestamp: 100,
      },
      {
        id: 'm2',
        scenarioId: 's1',
        projectId: 't1',
        from: 'agent',
        fromAgentId: 'a-dev',
        content: '**开发已完成**',
        smartMemberEnd: true,
        mentions: [],
        timestamp: 200,
      },
    ];
    const raw = JSON.stringify({
      role: '协调者',
      inputValidation: '无',
      taskUnderstanding: '成员步骤均已验收，协调者结项广播。',
      action: 'end',
      deliverable: { items: [], outputValidation: '无' },
      roomReply: '全部子任务已验收，项目正式结束，感谢各位参与。',
      dispatch: [],
    });
    const r = validateRoomMentionStructuredReply({
      raw,
      transportReason: 'empty',
      executionMode: 'smart',
      isCoordinator: true,
      coordinatorAgentId: 'a-coord',
      smartWorkSteps: steps,
      smartNextExecutorRoleId: 'a-coord',
      teamRoles: [
        agent('a-coord', '协调者'),
        agent('a-qa', '测试'),
        agent('a-dev', '开发'),
      ],
      projectId: 't1',
      roomMessages: room,
    });
    expect(r.ok).toBe(true);
    expect(
      evaluateSmartTaskClosureGate({
        steps,
        roomMessages: room,
        projectId: 't1',
        coordinatorAgentId: 'a-coord',
      }),
    ).toBe(true);
  });

  it('rejects coordinator **项目结项** JSON when smartWorkSteps is empty (premature end)', () => {
    const json = JSON.stringify({
      role: '上帝',
      taskUnderstanding: '无结构化工作顺序，协调者结项广播。',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: '无' },
      roomReply:
        '最终整合报告已验收通过，感谢各位协作。项目正式结束。',
      action: 'end',
      dispatch: smartDispatch('end'),
    });
    const r = validateRoomMentionStructuredReply({
      raw: json,
      transportReason: 'empty',
      executionMode: 'smart',
      isCoordinator: true,
      actorRoleName: '上帝',
      coordinatorAgentId: 'a-god',
      smartWorkSteps: [],
      smartNextExecutorRoleId: null,
      teamRoles: [
        { id: 'god', name: '上帝', agentId: 'a' },
        { id: 'a', name: 'A股分析师', agentId: 'b' },
      ],
      projectId: 't1',
      roomMessages: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues).toContain('smart_coordinator_premature_project_end');
    }
  });

  it('accepts coordinator kickoff dispatch JSON when smartWorkSteps is empty (no false project-end)', () => {
    const json = JSON.stringify({
      role: '上帝',
      taskUnderstanding:
        '本回合为项目首轮任务拆解，需将分析任务并行派给三位市场分析师。',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: '无' },
      roomReply:
        '项目「股市分析与投资规划」任务拆解完成。第一阶段可并行执行。',
      action: 'assign',
      dispatch: smartDispatch('assign', [
        { role: 'A股分析师', task: '子任务：分析过去5年A股表现并预测半年走势，交付 文件名-A股分析师.md。' },
        { role: '港股分析师', task: '子任务：分析港股。' },
        { role: '美股分析师', task: '子任务：分析美股。' },
      ]),
    });
    const team = [
      { id: 'god', name: '上帝', agentId: 'a-god' },
      { id: 'cn', name: 'A股分析师', agentId: 'a-cn' },
      { id: 'hk', name: '港股分析师', agentId: 'a-hk' },
      { id: 'us', name: '美股分析师', agentId: 'a-us' },
    ];
    const r = validateRoomMentionStructuredReply({
      raw: json,
      transportReason: 'empty',
      executionMode: 'smart',
      isCoordinator: true,
      actorRoleName: '上帝',
      coordinatorAgentId: 'a-god',
      smartWorkSteps: [],
      smartNextExecutorRoleIds: [],
      teamRoles: team,
      taskId: 't-stock',
      roomMessages: [],
      needsDecomposition: true,
      promptVariant: 'coordinator_kickoff_decompose',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) {
      expect(r.issues).not.toContain('smart_coordinator_missing_project_end');
    }
  });

  it('rejects coordinator kickoff when action is not assign', () => {
    const team = [
      { id: 'god', name: '上帝', agentId: 'a-god' },
      { id: 'cn', name: 'A股分析师', agentId: 'a-cn' },
      { id: 'hk', name: '港股分析师', agentId: 'a-hk' },
      { id: 'us', name: '美股分析师', agentId: 'a-us' },
    ];
    const base = {
      role: '上帝',
      taskUnderstanding: '本回合为项目首轮任务拆解，需将分析任务并行派给三位市场分析师。',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: '无' },
      roomReply:
        '项目「股市分析与投资规划」任务拆解完成。请并行启动分析。',
    };
    for (const action of ['review', 'end'] as const) {
      const json = JSON.stringify({
        ...base,
        action,
        dispatch: smartDispatch(
          action,
          action === 'end'
            ? []
            : [
                { role: 'A股分析师', task: '子任务：分析A股。' },
                { role: '港股分析师', task: '子任务：分析港股。' },
                { role: '美股分析师', task: '子任务：分析美股。' },
              ],
        ),
      });
      const r = validateRoomMentionStructuredReply({
        raw: json,
        transportReason: 'empty',
        executionMode: 'smart',
        isCoordinator: true,
        actorRoleName: '上帝',
        coordinatorAgentId: 'a-god',
        smartWorkSteps: [],
        teamRoles: team,
        taskId: 't-stock',
        roomMessages: [],
        needsDecomposition: true,
        promptVariant: 'coordinator_kickoff_decompose',
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(
          r.issues.some((issue) =>
            issue === 'smart_coordinator_kickoff_action_not_assign'
            || issue === 'invalid_json_value',
          ),
        ).toBe(true);
      }
    }
  });

  it('does not require kickoff assign action when promptVariant is not kickoff decompose', () => {
    const json = JSON.stringify({
      role: '上帝',
      taskUnderstanding:
        'A股分析师已完成任务，校验交付物合规；港股分析师与美股分析师待提交，继续催办',
      inputValidation: 'drwxr-xr-x 交付物-A股分析师/',
      deliverable: { items: [], outputValidation: [] },
      roomReply:
        '【进展汇总】\n\n✅ A股分析师已完成分析报告，验收通过。\n\n⏳ 请港股、美股分析师尽快提交。',
      action: 'assign',
      dispatch: [
        { role: '港股分析师', task: '请完成港股分析报告并汇报。' },
        { role: '美股分析师', task: '请完成美股分析报告并汇报。' },
      ],
    });
    const team = [
      { id: 'god', name: '上帝', agentId: 'a-god' },
      { id: 'cn', name: 'A股分析师', agentId: 'a-cn' },
      { id: 'hk', name: '港股分析师', agentId: 'a-hk' },
      { id: 'us', name: '美股分析师', agentId: 'a-us' },
    ];
    const r = validateRoomMentionStructuredReply({
      raw: json,
      transportReason: 'empty',
      executionMode: 'smart',
      isCoordinator: true,
      actorRoleName: '上帝',
      coordinatorAgentId: 'a-god',
      smartWorkSteps: [
        { stepIndex: 1, nodeId: 'n1', title: '分析', roleIds: ['cn', 'hk', 'us'] },
      ],
      teamRoles: team,
      taskId: 't-stock',
      roomMessages: [
        {
          id: 'm-cn-done',
          projectId: 't-stock',
          from: 'agent',
          fromAgentId: 'a-cn',
          content: '**A股分析报告已完成**',
          smartMemberEnd: true,
          timestamp: 1,
        },
      ],
      needsDecomposition: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) {
      expect(r.issues).not.toContain('smart_coordinator_kickoff_action_not_assign');
    }
  });

  it('accepts coordinator action=end when needsDecomposition still true at project closure', () => {
    const json = JSON.stringify({
      role: '上帝',
      taskUnderstanding: '投资规划师提交项目完成汇报，所有交付物齐全，项目流程终结',
      inputValidation: 'drwxr-xr-x project files',
      deliverable: { items: [], outputValidation: '无' },
      roomReply:
        '项目已全部完成！第一阶段由A股、港股、美股三位分析师分别完成市场分析报告；第二阶段由投资规划师汇总产出股市投资规划指南及项目完成汇报。所有交付物已落盘，感谢各位的辛勤工作！',
      action: 'end',
      dispatch: smartDispatch('end'),
    });
    const team = [
      { id: 'god', name: '上帝', agentId: 'a-god' },
      { id: 'cn', name: 'A股分析师', agentId: 'a-cn' },
      { id: 'hk', name: '港股分析师', agentId: 'a-hk' },
      { id: 'us', name: '美股分析师', agentId: 'a-us' },
      { id: 'plan', name: '投资规划师', agentId: 'a-plan' },
    ];
    const steps: SmartWorkOrderStep[] = [
      { stepIndex: 1, nodeId: 'n1', title: '分析', roleIds: ['a-cn', 'a-hk', 'a-us'] },
      { stepIndex: 2, nodeId: 'n2', title: '规划', roleIds: ['a-plan'] },
    ];
    const roomMessages: RoomMessage[] = [
      {
        id: 'm-cn',
        scenarioId: 's1',
        projectId: 't-stock',
        from: 'agent',
        fromAgentId: 'a-cn',
        content: '**A股分析已完成**',
        mentions: [],
        timestamp: 100,
        smartMemberEnd: true,
      },
      {
        id: 'm-hk',
        scenarioId: 's1',
        projectId: 't-stock',
        from: 'agent',
        fromAgentId: 'a-hk',
        content: '**港股分析已完成**',
        mentions: [],
        timestamp: 110,
        smartMemberEnd: true,
      },
      {
        id: 'm-us',
        scenarioId: 's1',
        projectId: 't-stock',
        from: 'agent',
        fromAgentId: 'a-us',
        content: '**美股分析已完成**',
        mentions: [],
        timestamp: 120,
        smartMemberEnd: true,
      },
      {
        id: 'm-plan',
        scenarioId: 's1',
        projectId: 't-stock',
        from: 'agent',
        fromAgentId: 'a-plan',
        content: '**投资规划已完成**',
        mentions: [],
        timestamp: 130,
        smartMemberEnd: true,
      },
    ];
    const r = validateRoomMentionStructuredReply({
      raw: json,
      transportReason: 'empty',
      executionMode: 'smart',
      isCoordinator: true,
      actorRoleName: '上帝',
      coordinatorAgentId: 'a-god',
      smartWorkSteps: steps,
      smartNextExecutorRoleIds: [],
      teamRoles: team,
      projectId: 't-stock',
      roomMessages,
      needsDecomposition: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.roomText).toContain('项目已全部完成');
      expect(r.roomText).toContain('【结项】');
    } else {
      expect(r.issues).not.toContain('coordinator_missing_dispatch');
    }
  });

  it('accepts coordinator assign progress summary when needsDecomposition true', () => {
    const json = JSON.stringify({
      role: '上帝',
      taskUnderstanding:
        'A股分析师已完成任务，校验交付物合规；港股分析师与美股分析师待提交，继续催办',
      inputValidation: 'drwxr-xr-x 交付物-A股分析师/',
      deliverable: { items: [], outputValidation: [] },
      roomReply:
        '【进展汇总】\n\n✅ A股分析师已完成分析报告，验收通过。\n\n⏳ 请港股、美股分析师继续推进并提交完成汇报。',
      action: 'assign',
      dispatch: [
        { role: '港股分析师', task: '请完成港股分析报告并汇报。' },
        { role: '美股分析师', task: '请完成美股分析报告并汇报。' },
      ],
    });
    const team = [
      { id: 'god', name: '上帝', agentId: 'a-god' },
      { id: 'cn', name: 'A股分析师', agentId: 'a-cn' },
      { id: 'hk', name: '港股分析师', agentId: 'a-hk' },
      { id: 'us', name: '美股分析师', agentId: 'a-us' },
    ];
    const r = validateRoomMentionStructuredReply({
      raw: json,
      transportReason: 'empty',
      executionMode: 'smart',
      isCoordinator: true,
      actorRoleName: '上帝',
      coordinatorAgentId: 'a-god',
      smartWorkSteps: [
        { stepIndex: 1, nodeId: 'n1', title: '分析', roleIds: ['cn', 'hk', 'us'] },
      ],
      teamRoles: team,
      taskId: 't-stock',
      roomMessages: [
        {
          id: 'm-cn-done',
          projectId: 't-stock',
          from: 'agent',
          fromAgentId: 'a-cn',
          content: '**A股分析报告已完成**',
          smartMemberEnd: true,
          timestamp: 1,
        },
      ],
      needsDecomposition: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) {
      expect(r.issues).not.toContain('coordinator_missing_dispatch');
    }
  });

  it('keeps minimum roomReply length check for Smart coordinator JSON', () => {
    const json = JSON.stringify({
      role: 'PM',
      taskUnderstanding: '派',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: '无' },
      roomReply: '@开发',
      action: 'assign',
      dispatch: smartDispatch('assign', [{ role: '开发', task: '实现核心功能。' }]),
    });
    const r = validateRoomMentionStructuredReply({
      raw: json,
      transportReason: 'empty',
      executionMode: 'smart',
      isCoordinator: true,
      actorRoleName: 'PM',
      coordinatorAgentId: 'a-pm',
      smartNextExecutorRoleId: 'a-dev',
      teamRoles: [
        { id: 'pm', name: 'PM', agentId: 'a' },
        { id: 'dev', name: '开发', agentId: 'b' },
      ],
      projectId: 't1',
      roomMessages: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues).toContain('room_reply_too_short');
    }
  });

  it('excludes internal end section from extracted coordinator dispatch', async () => {
    const { extractSmartRoomReplyAndDispatch } = await import(
      '../../src/lib/office-smart-room-fields'
    );
    const fields = extractSmartRoomReplyAndDispatch(
      [
        '【任务理解】派开发继续执行',
        '【输入校验】无',
        '【输出校验】无',
        '【交付产物】无',
        '【群聊回复】@开发',
        '【分工】无',
        '【结项】false',
      ].join('\n'),
    );
    expect(fields.roomReply).toBe('@开发');
    expect(fields.dispatch).toBe('无');
  });

  it('does not show visible closure marker when coordinator end is false', () => {
    const json = JSON.stringify({
      role: 'PM',
      taskUnderstanding: '派开发继续执行。',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: '无' },
      roomReply: '请继续实现核心功能，并在完成后提交可验收交付物。',
      action: 'assign',
      dispatch: smartDispatch('assign', [{ role: '开发', task: '请继续实现核心功能，并在完成后提交可验收交付物。' }]),
    });
    const r = validateRoomMentionStructuredReply({
      raw: json,
      transportReason: 'empty',
      executionMode: 'smart',
      isCoordinator: true,
      actorRoleName: 'PM',
      coordinatorAgentId: 'a-pm',
      smartNextExecutorRoleId: 'a-dev',
      teamRoles: [
        { id: 'pm', name: 'PM', agentId: 'a' },
        { id: 'dev', name: '开发', agentId: 'b' },
      ],
      projectId: 't1',
      roomMessages: [],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.roomText).not.toContain('【结项】');
    }
  });

  it('does not require **项目结项** on kickoff retry when steps empty and needsDecomposition false', () => {
    const json = JSON.stringify({
      role: '上帝',
      taskUnderstanding: '首轮拆解，并行派活给三位分析师。',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: '无' },
      roomReply: '拆解完成：请三位分析师分别完成各市场分析报告并汇报。',
      action: 'assign',
      dispatch: smartDispatch('assign', [
        { role: 'A股分析师', task: 'A股任务。' },
        { role: '港股分析师', task: '港股任务。' },
        { role: '美股分析师', task: '美股任务。' },
      ]),
    });
    const r = validateRoomMentionStructuredReply({
      raw: json,
      transportReason: 'empty',
      executionMode: 'smart',
      isCoordinator: true,
      actorRoleName: '上帝',
      coordinatorAgentId: 'a-god',
      smartWorkSteps: [],
      smartNextExecutorRoleIds: [],
      teamRoles: [
        { id: 'god', name: '上帝', agentId: 'a-god' },
        { id: 'cn', name: 'A股分析师', agentId: 'a-cn' },
        { id: 'hk', name: '港股分析师', agentId: 'a-hk' },
        { id: 'us', name: '美股分析师', agentId: 'a-us' },
      ],
      taskId: 't-stock',
      roomMessages: [],
      needsDecomposition: false,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) {
      expect(r.issues).not.toContain('smart_coordinator_missing_project_end');
    }
  });

  it('still rejects **项目结项** when steps exist but room lacks done markers', () => {
    const steps: SmartWorkOrderStep[] = [
      { stepIndex: 1, nodeId: 'n1', title: '开发', roleIds: ['a-dev'] },
    ];
    const raw = JSON.stringify({
      role: 'PM',
      inputValidation: '无',
      taskUnderstanding: '开发尚未在群内汇报完成，协调者误判可结项。',
      action: 'end',
      deliverable: { items: [], outputValidation: '无' },
      roomReply: '全部子任务已验收，项目正式结束，感谢各位参与。',
      dispatch: [],
    });
    const r = validateRoomMentionStructuredReply({
      raw,
      transportReason: 'empty',
      executionMode: 'smart',
      isCoordinator: true,
      coordinatorAgentId: 'a-pm',
      smartWorkSteps: steps,
      smartNextExecutorRoleId: 'a-dev',
      teamRoles: [
        { id: 'pm', name: 'PM', agentId: 'a' },
        { id: 'dev', name: '开发', agentId: 'b' },
      ],
      projectId: 't1',
      roomMessages: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues).toContain('smart_coordinator_premature_project_end');
    }
  });

  it('detects project end when @all precedes **项目结项** (lenient completion only)', async () => {
    const { coordinatorReplyMayCloseProject } = await import(
      '../../src/lib/office-smart-project-end'
    );
    expect(
      coordinatorReplyMayCloseProject(
        JSON.stringify({
          role: 'PM',
          taskUnderstanding: '结项',
          inputValidation: '无',
          deliverable: { items: [], outputValidation: '无' },
          roomReply: '项目已完成，全部交付物已验盘通过。',
          action: 'end',
          dispatch: smartDispatch('end'),
            }),
        true,
      ),
    ).toBe(true);
  });

  it('appendSmartProjectEndRoomMarker appends 【结项】 once for end publish text', async () => {
    const { appendSmartProjectEndRoomMarker } = await import(
      '../../src/lib/office-smart-project-end'
    );
    const body = '全部子任务已验收，项目正式结束。';
    expect(appendSmartProjectEndRoomMarker(body)).toBe(`${body}\n\n【结项】`);
    expect(appendSmartProjectEndRoomMarker(`${body}\n\n【结项】`)).toBe(
      `${body}\n\n【结项】`,
    );
  });

  it('accepts Smart coordinator JSON and converts to bracket validation', async () => {
    const { validateRoomMentionStructuredReply } = await import(
      '../../electron/services/office/room-mention-structured-reply'
    );
    const json = JSON.stringify({
      role: 'PM',
      taskUnderstanding: '验收测试汇报并派产品写需求文档。',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: '无' },
      roomReply: '测试策略已验收通过。下一步请产品编写需求文档并落盘。',
      action: 'assign',
      dispatch: smartDispatch('assign', [{ role: '产品', task: '编写需求文档 requirements-产品.md。' }]),
    });
    const r = validateRoomMentionStructuredReply({
      raw: json,
      transportReason: 'empty',
      executionMode: 'smart',
      isCoordinator: true,
      actorRoleName: 'PM',
      coordinatorAgentId: 'a-pm',
      smartNextExecutorRoleId: 'product',
      teamRoles: [
        { id: 'pm', name: 'PM', agentId: 'a' },
        { id: 'product', name: '产品', agentId: 'b' },
        { id: 'dev', name: '开发', agentId: 'c' },
      ],
      triggerFromMemberAgent: true,
    });
    expect(r.ok).toBe(true);
  });

  it('rejects Smart JSON with wrong role', async () => {
    const { validateRoomMentionStructuredReply } = await import(
      '../../electron/services/office/room-mention-structured-reply'
    );
    const json = JSON.stringify({
      role: '开发',
      taskUnderstanding: 'x',
      deliverable: { items: [], outputValidation: '无' },
      roomReply: '请验收。',
      action: 'assign',
      dispatch: smartDispatch('assign', [{ role: 'PM', task: '请验收。' }]),
    });
    const r = validateRoomMentionStructuredReply({
      raw: json,
      transportReason: 'empty',
      executionMode: 'smart',
      isCoordinator: false,
      actorRoleName: '产品',
      coordinatorRole: agent('a-pm', 'PM'),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.issues.some((i) => i === 'invalid_json_schema' || i === 'invalid_json_value'),
      ).toBe(true);
    }
  });

  it('rejects legacy 【结项】 section and premature closure before dev', () => {
    const team = [
      agent('a-pm', 'PM'),
      agent('a-qa', '测试'),
      agent('a-product', '产品'),
      agent('a-dev', '开发'),
    ];
    const publish = [
      '需求规格说明书已验收通过，功能范围已明确。',
      '经审视工作顺序，三步骤均已完成，现进入开发阶段。',
    ].join('');
    expect(
      validateSmartCoordinatorRoomMentions({
        publishText: publish,
        dispatchText: '【分工】 @all 象棋游戏开发项目需求分析阶段已完成。下一步可启动开发实现。',
        coordinatorAgentId: 'a-pm',
        nextExecutorRoleId: 'a-dev',
        teamRoles: team,
        projectComplete: false,
      }),
    ).toBe('broadcast_before_project_complete');

    const rawWithPrematureEndFlag = [
      '【任务理解】误判格式。',
      '【输入校验】无',
      '【输出校验】无',
      '【交付产物】无',
      '【群聊回复】全部子任务已验收。',
      '【分工】无',
      '【结项】true',
    ].join('\n');
    expect(
      validateSmartCoordinatorProjectEnd({
        raw: rawWithPrematureEndFlag,
        allStepsComplete: false,
      }),
    ).toBe('ok');

    const rawWithPrematureEnd = [
      '【任务理解】误判全部完成，提前结项。',
      '【输入校验】无',
      '【输出校验】无',
      '【交付产物】无',
      '【群聊回复】',
      '全部子任务已验收，项目正式结束，感谢各位参与。',
      '【分工】无',
      '【结项】true',
    ].join('\n');
    expect(
      validateSmartCoordinatorProjectEnd({
        raw: rawWithPrematureEnd,
        allStepsComplete: false,
      }),
    ).toBe('ok');

    const steps: SmartWorkOrderStep[] = [
      { stepIndex: 1, nodeId: 'n1', title: '测试计划', roleIds: ['a-qa'] },
      { stepIndex: 2, nodeId: 'n2', title: '需求规格', roleIds: ['a-product'] },
      { stepIndex: 3, nodeId: 'n3', title: 'PM评审', roleIds: ['a-pm'] },
      { stepIndex: 4, nodeId: 'n4', title: '开发实现', roleIds: ['a-dev'] },
    ];
    const roomMessages: RoomMessage[] = [
      {
        id: '1',
        scenarioId: 's1',
        projectId: 't1',
        from: 'agent',
        fromAgentId: 'a-qa',
        content: '【测试计划已完成】',
        mentions: [],
        timestamp: 1,
      },
      {
        id: '2',
        scenarioId: 's1',
        projectId: 't1',
        from: 'agent',
        fromAgentId: 'a-product',
        content: '【需求规格说明书已完成】',
        mentions: [],
        timestamp: 2,
      },
    ];
    const raw = JSON.stringify({
      role: 'PM',
      taskUnderstanding:
        '本步处理产品【需求规格说明书已完成】汇报：已用 ls 确认 requirements-产品.md 存在，验收通过。',
      inputValidation: '-rw-r--r-- 1 demo staff 1726 requirements-产品.md',
      deliverable: { items: [], outputValidation: [] },
      roomReply: publish,
      action: 'end',
      dispatch: smartDispatch('end'),
    });
    const r = validateRoomMentionStructuredReply({
      raw,
      transportReason: 'empty',
      executionMode: 'smart',
      isCoordinator: true,
      actorRoleName: 'PM',
      coordinatorAgentId: 'a-pm',
      smartNextExecutorRoleId: 'a-dev',
      smartWorkSteps: steps,
      roomMessages,
      projectId: 't1',
      teamRoles: team,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues).toContain('smart_coordinator_premature_project_end');
      expect(r.detail).toContain('开发');
      expect(r.detail).toContain('步骤4');
      expect(r.detail).toContain('开发实现');
    }
  });

  it('coordinator kickoff_decompose prompt lists real team roster', () => {
    const prompt = buildSmartRoomMentionAgentPrompt({
      role: { id: 'pm', name: 'PM', agentId: 'a', createdAt: 0, updatedAt: 0 },
      roomLine: '@PM 开始拆解任务',
      scenario: { name: '五子棋' },
      task: { title: '五子棋开发', description: '', status: 'running' },
      speakerLabel: 'PM',
      isCoordinator: true,
      promptVariant: 'coordinator_kickoff_decompose',
      coordinatorAgentId: 'a-pm',
      smartNextExecutorRoleId: 'product',
      smartNextExecutorNames: '产品',
      teamRoles: [
        agent('a-pm', 'PM'),
        agent('a-product', '产品'),
        agent('a-dev', '开发'),
      ],
    });
    expect(prompt).toContain('一.【角色信息】');
    expect(prompt).toContain('三.【历史记录与本轮任务】');
    expect(prompt).not.toContain('【项目启动·拆解】');
    expect(prompt).toContain('1.1 我是:PM（协调者）');
    expect(prompt).toContain('1.2 团队成员:产品、开发');
    expect(prompt).toContain('3.3 【本回合触发】');
    expect(prompt).toContain('@PM 开始拆解任务');
    expect(prompt).toContain('本回合为项目 kickoff');
  });

  it('buildSmartTeamMentionRosterBlock forbids invented roles in copy', () => {
    const block = buildSmartTeamMentionRosterBlock({
      teamRoles: [
        agent('a-pm', 'PM'),
        agent('a-product', '产品'),
      ],
      coordinatorAgentId: 'a-pm',
      nextExecutorRoleIds: ['a-product'],
    });
    expect(block).toContain('产品');
    expect(block).toContain('禁止编造');
  });

  it('buildSmartTeamMentionRosterBlock lists parallel stage executors', () => {
    const block = buildSmartTeamMentionRosterBlock({
      teamRoles: [
        agent('a-pm', 'PM'),
        agent('a-cn', 'A股分析'),
        agent('a-us', '美股分析'),
      ],
      coordinatorAgentId: 'a-pm',
      nextExecutorRoleIds: ['a-cn', 'a-us'],
    });
    expect(block).toContain('可并行 @');
    expect(block).toContain('A股分析');
    expect(block).toContain('美股分析');
  });

  it('clamp removes @ on non-next executors before publish', () => {
    const out = clampSmartCoordinatorDispatchText(
      '【群聊回复】@开发 请实现；@测试 先别动',
      {
        coordinatorAgentId: 'a-pm',
        allowedRoleIds: smartCoordinatorAllowedDispatchRoleIds({
          nextExecutorRoleIds: ['a-dev'],
        }),
        teamRoles: smartProgressTeam,
      },
    );
    expect(out).toContain('@开发');
    expect(out).not.toContain('@测试');
    expect(out).toContain('测试');
  });
});

describe('smart member dispatch keys', () => {
  it('smart follow-up uses task-scoped dispatch key when taskId present', async () => {
    const { smartMentionDispatchKey } = await import(
      '../../electron/services/office/room-mention-dispatch'
    );
    const taskId = 'task-1780459688436-2bhasd';
    const coordId = 'a-god';
    const keyA = smartMentionDispatchKey({ id: 'room-mention-round-a-cn', taskId }, coordId);
    const keyB = smartMentionDispatchKey({ id: 'room-mention-round-b-hk', taskId }, coordId);
    const keyNoTask = smartMentionDispatchKey({ id: 'room-mention-round-b-hk' }, coordId);
    const keyFromFocus = smartMentionDispatchKey({ id: 'room-mention-round-b-hk' }, coordId, taskId);
    expect(keyA).toBe(`smart:${taskId}:${coordId}`);
    expect(keyB).toBe(keyA);
    expect(keyNoTask).toBe(`room-mention-round-b-hk:${coordId}`);
    expect(keyFromFocus).toBe(`smart:${taskId}:${coordId}`);
  });

  it('smartMentionDispatchKey uses agentId when delegated pick has no id field', async () => {
    const { smartMentionDispatchKey } = await import(
      '../../electron/services/office/room-mention-dispatch'
    );
    const taskId = 'project-parallel-1';
    const keyA = smartMentionDispatchKey({ id: 'room-trigger', projectId: taskId }, 'role-a', taskId);
    const keyB = smartMentionDispatchKey({ id: 'room-trigger', projectId: taskId }, 'role-b', taskId);
    expect(keyA).toBe(`smart:${taskId}:role-a`);
    expect(keyB).toBe(`smart:${taskId}:role-b`);
    expect(keyA).not.toBe(keyB);
  });

  it('member end=true room publish delegates coordinator for follow-up', () => {
    const memberEndJson = JSON.stringify({
      role: 'A股分析师',
      action: 'end',
      roomReply:
        'A股市场分析已完成，文件已落盘至 交付物-A股分析师/A股.md，包含指数与行业分析',
      dispatch: [{ role: '上帝', task: '请验收 A股市场分析交付物' }],
      taskUnderstanding: '完成汇报',
      deliverable: { items: ['交付物-A股分析师/A股.md'], outputValidation: ['无'] },
    });
    const team = [
      { id: 'god', name: '上帝', agentId: 'a-god', createdAt: 0, updatedAt: 0 },
      { id: 'cn', name: 'A股分析师', agentId: 'a-cn', createdAt: 0, updatedAt: 0 },
    ];
    const delegated = pickRolesDelegatedByCoordinator(
      memberEndJson,
      team,
      'cn',
      'god',
      { executionMode: 'smart' },
    );
    expect(delegated.map((x) => x.agentId)).toEqual(['a-god']);
    expect(
      filterFollowUpMentionTargets({
        executionMode: 'smart',
        coordinatorRoleId: 'a-god',
        fromRoleId: 'a-cn',
        delegated,
      }).map((r) => r.agentId),
    ).toEqual(['a-god']);
  });

  it('member dispatch @ coordinator keeps coordinator when delegated only has agentId', () => {
    const memberJson = JSON.stringify({
      role: 'AI-Agent工程专家',
      action: 'end',
      roomReply: '交付已完成',
      dispatch: [
        {
          role: 'AI-Agent开发专家',
          task: '请验收交付：AI-Agent机会与方案案例-AI-Agent工程专家.md',
        },
      ],
      taskUnderstanding: '汇报',
      deliverable: { items: ['交付物-AI-Agent工程专家/案例.md'], outputValidation: ['无'] },
    });
    const team = [
      { agentId: 'ai-agent-kai-fa-zhuan-jia', displayName: 'AI-Agent开发专家' },
      { agentId: 'ai-agent-gong-cheng-zhuan-jia', displayName: 'AI-Agent工程专家' },
    ];
    const picked = pickRolesDelegatedByCoordinator(
      memberJson,
      team,
      'ai-agent-gong-cheng-zhuan-jia',
      'ai-agent-kai-fa-zhuan-jia',
      { executionMode: 'smart' },
    );
    expect(picked).toEqual([
      { agentId: 'ai-agent-kai-fa-zhuan-jia', displayName: 'AI-Agent开发专家' },
    ]);
    expect(picked[0]).not.toHaveProperty('id');
    const followUp = filterFollowUpMentionTargets({
      executionMode: 'smart',
      coordinatorRoleId: 'ai-agent-kai-fa-zhuan-jia',
      fromRoleId: 'ai-agent-gong-cheng-zhuan-jia',
      delegated: picked as never,
    });
    expect(followUp.map((r) => r.agentId)).toEqual(['ai-agent-kai-fa-zhuan-jia']);
  });
});

describe("__merged__:office-smart-closure-gate-parity", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const memberDoneClosureFixture = () => {
    const steps: SmartWorkOrderStep[] = [
      { stepIndex: 1, nodeId: 'n1', title: '测试', roleIds: ['a-qa'] },
      { stepIndex: 2, nodeId: 'n2', title: '开发', roleIds: ['a-dev'] },
      { stepIndex: 3, nodeId: 'n3', title: '结项', roleIds: ['a-coord'] },
    ];
    const room: RoomMessage[] = [
      {
        id: 'm1',
        scenarioId: 's1',
        projectId: 't1',
        from: 'agent',
        fromAgentId: 'a-qa',
        content: '**测试计划已完成**',
        smartMemberEnd: true,
        mentions: [],
        timestamp: 100,
      },
      {
        id: 'm2',
        scenarioId: 's1',
        projectId: 't1',
        from: 'agent',
        fromAgentId: 'a-dev',
        content: '**开发已完成**',
        smartMemberEnd: true,
        mentions: [],
        timestamp: 200,
      },
      {
        id: 'c1',
        scenarioId: 's1',
        projectId: 't1',
        from: 'agent',
        fromAgentId: 'a-coord',
        content: '全部子任务已验收，项目正式结束，感谢各位参与。\n\n【结项】',
        smartCoordinatorEnd: true,
        mentions: [],
        timestamp: 300,
      },
    ];
    const raw = JSON.stringify({
      role: '协调者',
      inputValidation: '无',
      taskUnderstanding: '成员步骤均已验收，协调者结项广播。',
      action: 'end',
      deliverable: { items: [], outputValidation: '无' },
      roomReply: '全部子任务已验收，项目正式结束，感谢各位参与。',
      dispatch: [],
    });
    return { steps, room, raw };
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('publish validation ok implies closure gate open (no publish/complete deadlock)', () => {
    const { steps, room, raw } = memberDoneClosureFixture();
    const validation = validateRoomMentionStructuredReply({
      raw,
      transportReason: 'empty',
      executionMode: 'smart',
      isCoordinator: true,
      coordinatorAgentId: 'a-coord',
      smartWorkSteps: steps,
      smartNextExecutorRoleId: 'a-coord',
      teamRoles: [
        agent('a-coord', '协调者'),
        agent('a-qa', '测试'),
        agent('a-dev', '开发'),
      ],
      projectId: 't1',
      roomMessages: room,
    });
    expect(validation.ok).toBe(true);
    if (validation.ok) {
      expect(validation.roomText).toContain('【结项】');
    }
    expect(
      isSmartProjectEngineComplete({
        steps,
        roomMessages: room,
        projectId: 't1',
        coordinatorAgentId: 'a-coord',
      }),
    ).toBe(true);
    expect(
      evaluateSmartTaskClosureGate({
        steps,
        roomMessages: room,
        projectId: 't1',
        coordinatorAgentId: 'a-coord',
      }),
    ).toBe(true);
  });

  it('publish validation premature implies closure gate closed', () => {
    const steps: SmartWorkOrderStep[] = [
      { stepIndex: 1, nodeId: 'n1', title: '开发', roleIds: ['a-dev'] },
    ];
    const room: RoomMessage[] = [];
    const raw = JSON.stringify({
      role: 'PM',
      inputValidation: '无',
      taskUnderstanding: '误判可结项。',
      action: 'end',
      deliverable: { items: [], outputValidation: '无' },
      roomReply: '全部子任务已验收，项目正式结束，感谢各位参与。',
      dispatch: [],
    });
    const validation = validateRoomMentionStructuredReply({
      raw,
      transportReason: 'empty',
      executionMode: 'smart',
      isCoordinator: true,
      coordinatorAgentId: 'a-pm',
      smartWorkSteps: steps,
      smartNextExecutorRoleId: 'a-dev',
      teamRoles: [
        agent('a-pm', 'PM'),
        agent('a-dev', '开发'),
      ],
      projectId: 't1',
      roomMessages: room,
    });
    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.issues).toContain('smart_coordinator_premature_project_end');
    }
    expect(
      evaluateSmartTaskClosureGate({
        steps,
        roomMessages: room,
        projectId: 't1',
        coordinatorAgentId: 'a-pm',
      }),
    ).toBe(false);
  });

  it('maybeComplete returns true when publish gate passes and store room is fresh', async () => {
    const { steps, room, raw } = memberDoneClosureFixture();
    const validation = validateRoomMentionStructuredReply({
      raw,
      transportReason: 'empty',
      executionMode: 'smart',
      isCoordinator: true,
      coordinatorAgentId: 'a-coord',
      smartWorkSteps: steps,
      smartNextExecutorRoleId: 'a-coord',
      teamRoles: [
        agent('a-coord', '协调者'),
        agent('a-qa', '测试'),
        agent('a-dev', '开发'),
      ],
      projectId: 't1',
      roomMessages: room,
    });
    expect(validation.ok).toBe(true);

    mockSmartRunningProject();
    const getRoomSpy = vi.spyOn(officeStore, 'getRoomMessages').mockResolvedValue(room);
    const completedSpy = vi
      .spyOn(officeStore, 'markProjectRunCompleted')
      .mockImplementation(async (id) => ({
        id,
        title: '象棋',
        origin: 'fixed_group',
        parentGroupId: 's1',
        agentIds: ['a-coord', 'a-qa', 'a-dev'],
        coordinatorAgentId: 'a-coord',
        lifecycle: 'completed',
        featureDescription: '',
        description: '',
        status: 'completed',
        executionMode: 'smart',
        nodeRuns: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }));
    await mockDeliverablesBundlePublish();

    const done = await maybeCompleteSmartTaskFromCoordinatorReply('t1', raw, {
      coordinatorAgentId: 'a-coord',
      steps,
    });
    expect(done).toBe(true);
    expect(getRoomSpy).toHaveBeenCalledWith('t1');
    expect(completedSpy).toHaveBeenCalledWith('t1');
  });

  it('maybeComplete uses fresh getRoomMessages even when dispatch snapshot lacked member done', async () => {
    const { steps, raw } = memberDoneClosureFixture();
    const staleRoom: RoomMessage[] = [];
    const freshRoom: RoomMessage[] = [
      {
        id: 'm1',
        scenarioId: 's1',
        projectId: 't1',
        from: 'agent',
        fromAgentId: 'a-dev',
        content: '**开发已完成**',
        smartMemberEnd: true,
        mentions: [],
        timestamp: 100,
      },
      {
        id: 'm2',
        scenarioId: 's1',
        projectId: 't1',
        from: 'agent',
        fromAgentId: 'a-qa',
        content: '**测试计划已完成**',
        smartMemberEnd: true,
        mentions: [],
        timestamp: 200,
      },
      {
        id: 'c1',
        scenarioId: 's1',
        projectId: 't1',
        from: 'agent',
        fromAgentId: 'a-coord',
        content: '全部子任务已验收，项目正式结束，感谢各位参与。\n\n【结项】',
        smartCoordinatorEnd: true,
        mentions: [],
        timestamp: 300,
      },
    ];
    expect(
      evaluateSmartTaskClosureGate({
        steps,
        roomMessages: staleRoom,
        projectId: 't1',
        coordinatorAgentId: 'a-coord',
      }),
    ).toBe(false);

    mockSmartRunningProject();
    vi.spyOn(officeStore, 'getRoomMessages').mockResolvedValue(freshRoom);
    const completedSpy = vi
      .spyOn(officeStore, 'markProjectRunCompleted')
      .mockImplementation(async (id) => ({
        id,
        title: '象棋',
        origin: 'fixed_group',
        parentGroupId: 's1',
        agentIds: ['a-coord', 'a-qa', 'a-dev'],
        coordinatorAgentId: 'a-coord',
        lifecycle: 'completed',
        featureDescription: '',
        description: '',
        status: 'completed',
        executionMode: 'smart',
        nodeRuns: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }));
    await mockDeliverablesBundlePublish();

    const done = await maybeCompleteSmartTaskFromCoordinatorReply('t1', raw, {
      coordinatorAgentId: 'a-coord',
      steps,
    });
    expect(done).toBe(true);
    expect(completedSpy).toHaveBeenCalledWith('t1');
  });
});

describe("__merged__:office-smart-task-lifecycle", () => {
  describe('smart task lifecycle registry', () => {
    it('tracks running smart tasks until ended', () => {
      const ac = new AbortController();
      registerSmartTaskRun('task-a', ac);
      expect(isSmartTaskMarkedRunning('task-a')).toBe(true);
      endSmartTaskRun('task-a');
      expect(isSmartTaskMarkedRunning('task-a')).toBe(false);
    });

    it('maybeCompleteSmartTaskFromCoordinatorReply returns false without store task', async () => {
      const done = await maybeCompleteSmartTaskFromCoordinatorReply(
        'missing',
        [
          '【群聊回复】',
          '全部子任务已验收通过，项目正式结项。**项目结项**',
        ].join('\n'),
      );
      expect(done).toBe(false);
    });

    it('evaluateSmartTaskClosureGate requires member done markers before closure', () => {
      const steps: SmartWorkOrderStep[] = [
        { stepIndex: 1, nodeId: 'n1', title: '开发', roleIds: ['a-dev'] },
      ];
      const closureOnly: RoomMessage[] = [
        {
          id: 'c1',
          scenarioId: 's1',
          projectId: 't1',
          from: 'agent',
          fromAgentId: 'a-coord',
          content: '项目结束，感谢协作。', smartCoordinatorEnd: true,
          mentions: [],
          timestamp: 300,
        },
      ];
      expect(
        evaluateSmartTaskClosureGate({
          steps,
          roomMessages: closureOnly,
          projectId: 't1',
          coordinatorAgentId: 'a-coord',
        }),
      ).toBe(false);

      const withDevDone: RoomMessage[] = [
        {
          id: 'd1',
          scenarioId: 's1',
          projectId: 't1',
          from: 'agent',
          fromAgentId: 'a-dev',
          content: '**开发已完成** 路径 /tmp/app.html',
          smartMemberEnd: true,
          mentions: [],
          timestamp: 100,
        },
        ...closureOnly,
      ];
      expect(
        evaluateSmartTaskClosureGate({
          steps,
          roomMessages: withDevDone,
          projectId: 't1',
          coordinatorAgentId: 'a-coord',
        }),
      ).toBe(true);
    });

    it('attemptSmartTaskAutoCompletionFromRoom returns false when gate is closed', async () => {
      const steps: SmartWorkOrderStep[] = [
        { stepIndex: 1, nodeId: 'n1', title: '开发', roleIds: ['a-dev'] },
      ];
      const room: RoomMessage[] = [
        {
          id: 'c1',
          scenarioId: 's1',
          projectId: 't1',
          from: 'agent',
          fromAgentId: 'a-coord',
          content: '全部完成。', smartCoordinatorEnd: true,
          mentions: [],
          timestamp: 1,
        },
      ];
      await expect(
        attemptSmartTaskAutoCompletionFromRoom({
          projectId: 't1',
          scenarioId: 's1',
          coordinatorAgentId: 'a-coord',
          steps,
          roomMessages: room,
        }),
      ).resolves.toBe(false);
    });

    it('attemptSmartTaskAutoCompletionFromRoom completes from smartCoordinatorEnd metadata', async () => {
      const steps: SmartWorkOrderStep[] = [
        { stepIndex: 1, nodeId: 'n1', title: '开发', roleIds: ['a-dev'] },
      ];
      const room: RoomMessage[] = [
        {
          id: 'd1',
          scenarioId: 's1',
          projectId: 't1',
          from: 'agent',
          fromAgentId: 'a-dev',
          content: '**开发已完成** 路径 /tmp/app.html',
          smartMemberEnd: true,
          mentions: [],
          timestamp: 100,
        },
        {
          id: 'c1',
          scenarioId: 's1',
          projectId: 't1',
          from: 'agent',
          fromAgentId: 'a-coord',
          content: '全部完成，感谢协作。\n\n【结项】',
          smartCoordinatorEnd: true,
          mentions: [],
          timestamp: 200,
        },
      ];
      mockSmartRunningProject({ agentIds: ['a-coord', 'a-dev'] });
      vi.spyOn(officeStore, 'getRoomMessages').mockResolvedValue(room);
      const completedSpy = vi
        .spyOn(officeStore, 'markProjectRunCompleted')
        .mockImplementation(async (id) => ({
          id,
          title: '示例',
          origin: 'fixed_group',
          parentGroupId: 's1',
          agentIds: ['a-coord', 'a-dev'],
          coordinatorAgentId: 'a-coord',
          lifecycle: 'completed',
          featureDescription: '',
          description: '',
          status: 'completed',
          executionMode: 'smart',
          nodeRuns: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }));
      const bundleMod = await import('../../electron/services/office/project-deliverables-bundle');
      vi.spyOn(bundleMod, 'buildProjectDeliverablesZipArchive').mockResolvedValue(null);
      vi.spyOn(officeStore, 'appendRoomMessage').mockImplementation(async (msg) => msg);

      await expect(
        attemptSmartTaskAutoCompletionFromRoom({
          projectId: 't1',
          coordinatorAgentId: 'a-coord',
          steps,
          roomMessages: room,
        }),
      ).resolves.toBe(true);
      expect(completedSpy).toHaveBeenCalledWith('t1');
    });
  });
});

describe("__merged__:office-smart-progress", () => {
  it('engine nudge interval is 5 minutes (kickoff deadline + cooldown)', () => {
    expect(SMART_ENGINE_NUDGE_INTERVAL_MS).toBe(300_000);
    expect(SMART_NUDGE_COOLDOWN_MS).toBe(SMART_ENGINE_NUDGE_INTERVAL_MS);
    expect(SMART_KICKOFF_COORDINATOR_DEADLINE_MS).toBe(SMART_ENGINE_NUDGE_INTERVAL_MS);
  });

  it('detects all steps done via smartMemberEnd metadata', () => {
    const room: RoomMessage[] = [
      {
        id: 'm1',
        scenarioId: 's1',
        projectId: 't1',
        from: 'agent',
        fromAgentId: 'a-pm',
        content: '【需求文档已完成】路径 /tmp/a.md',
        smartMemberEnd: true,
        mentions: [],
        timestamp: 100,
      },
    ];
    expect(smartAllWorkOrderStepsDoneInRoom(smartProgressSteps, room, 't1')).toBe(false);
    room.push({
      id: 'm2',
      scenarioId: 's1',
      projectId: 't1',
      from: 'agent',
      fromAgentId: 'a-dev',
      content: '【开发模块已完成】路径 /tmp/b.md',
      smartMemberEnd: true,
      mentions: [],
      timestamp: 200,
    });
    expect(smartAllWorkOrderStepsDoneInRoom(smartProgressSteps, room, 't1')).toBe(true);
  });

  it('treats coordinator-owned last step as satisfied when member steps are done', () => {
    const steps: SmartWorkOrderStep[] = [
      { stepIndex: 1, nodeId: 'n1', title: '测试', roleIds: ['a-qa'] },
      { stepIndex: 2, nodeId: 'n2', title: '开发', roleIds: ['a-dev'] },
      { stepIndex: 3, nodeId: 'n3', title: '结项', roleIds: ['a-coord'] },
    ];
    const room: RoomMessage[] = [
      {
        id: 'm1',
        scenarioId: 's1',
        projectId: 't1',
        from: 'agent',
        fromAgentId: 'a-qa',
        content: '【测试计划已完成】路径 /tmp/test.md',
        smartMemberEnd: true,
        mentions: [],
        timestamp: 100,
      },
      {
        id: 'm2',
        scenarioId: 's1',
        projectId: 't1',
        from: 'agent',
        fromAgentId: 'a-dev',
        content: '【开发已完成】路径 /tmp/dev.html',
        smartMemberEnd: true,
        mentions: [],
        timestamp: 200,
      },
    ];
    expect(smartAllWorkOrderStepsDoneInRoom(steps, room, 't1')).toBe(false);
    expect(smartReadyForProjectClosure(steps, room, 't1', 'a-coord')).toBe(true);
  });

  it('roleReportedSubtaskDoneInRoom requires smartMemberEnd metadata', () => {
    const room: RoomMessage[] = [
      {
        id: 'm1',
        scenarioId: 's1',
        projectId: 't1',
        from: 'agent',
        fromAgentId: 'a-dev',
        content: '**象棋开发已完成** 路径 /tmp/game.html',
        progressText: '进行中…',
        smartMemberEnd: true,
        mentions: [],
        timestamp: 1,
      },
    ];
    expect(roleReportedSubtaskDoneInRoom(room, 't1', 'a-dev')).toBe(true);
    expect(roleReportedSubtaskDoneInRoom(
      [{ ...room[0]!, smartMemberEnd: undefined }],
      't1',
      'a-dev',
    )).toBe(false);
  });

  it('does not kickoff-nudge before 5 minutes', () => {
    const now = 400_000;
    const plan = planSmartProgressNudge({
      nowMs: now,
      taskStartedAt: now - 120_000,
      lastTeamActivityAt: 0,
      lastNudgeAtMs: null,
      coordinatorAgentId: 'a-coord',
      coordinatorHasDecomposed: false,
      nextExecutorRoleId: 'a-pm',
      allStepsDoneInRoom: false,
      deliverablePathsVerified: false,
      coordinatorRepliedSinceKickoff: false,
      teamRoles: smartProgressTeam,
    });
    expect(plan).toBeNull();
  });

  it('plans kickoff coordinator nudge when no coordinator reply', () => {
    const now = 100_000;
    const plan = planSmartProgressNudge({
      nowMs: now,
      taskStartedAt: now - SMART_KICKOFF_COORDINATOR_DEADLINE_MS - 1,
      lastTeamActivityAt: 0,
      lastNudgeAtMs: null,
      coordinatorAgentId: 'a-coord',
      coordinatorHasDecomposed: false,
      nextExecutorRoleId: 'a-pm',
      allStepsDoneInRoom: false,
      deliverablePathsVerified: false,
      coordinatorRepliedSinceKickoff: false,
      teamRoles: smartProgressTeam,
    });
    expect(plan?.kind).toBe('kickoff_coordinator');
    expect(plan?.targetRoleId).toBe('a-coord');
    expect(plan?.roomLine).toContain('【引擎·推进】');
  });

  it('plans ready_to_complete when all steps done and paths verified', () => {
    const now = 200_000;
    const plan = planSmartProgressNudge({
      nowMs: now,
      taskStartedAt: now - 300_000,
      lastTeamActivityAt: now - 10_000,
      lastNudgeAtMs: null,
      coordinatorAgentId: 'a-coord',
      coordinatorHasDecomposed: true,
      nextExecutorRoleId: null,
      allStepsDoneInRoom: true,
      deliverablePathsVerified: true,
      coordinatorRepliedSinceKickoff: true,
      teamRoles: smartProgressTeam,
    });
    expect(plan?.kind).toBe('ready_to_complete');
    expect(plan?.roomLine).toContain('action 设为 "end"');
  });

  it('respects global 5m nudge cooldown after any engine nudge', () => {
    const now = 300_000;
    const plan = planSmartProgressNudge({
      nowMs: now,
      taskStartedAt: now - 500_000,
      lastTeamActivityAt: now - SMART_STALL_NUDGE_AFTER_MS - 5_000,
      lastNudgeAtMs: now - 60_000,
      coordinatorAgentId: 'a-coord',
      coordinatorHasDecomposed: true,
      nextExecutorRoleId: 'a-dev',
      allStepsDoneInRoom: false,
      deliverablePathsVerified: false,
      coordinatorRepliedSinceKickoff: true,
      teamRoles: smartProgressTeam,
    });
    expect(plan).toBeNull();
  });

  it('fast ack does not count as coordinator substantive reply', () => {
    const kickoffAt = 50_000;
    const room: RoomMessage[] = [
      {
        id: 'a',
        scenarioId: 's1',
        projectId: 't1',
        from: 'agent',
        fromAgentId: 'a-coord',
        content: 'OK，待我思考下',
        mentions: [],
        timestamp: kickoffAt + 1_000,
      },
    ];
    expect(
      smartCoordinatorRepliedSubstantivelySince(room, 't1', 'a-coord', kickoffAt),
    ).toBe(false);
  });

  it('detects coordinator substantive reply after kickoff', () => {
    const kickoffAt = 50_000;
    const room: RoomMessage[] = [
      {
        id: 'k',
        scenarioId: 's1',
        projectId: 't1',
        from: 'system',
        content: '@协调者 请拆解',
        mentions: [],
        timestamp: kickoffAt,
      },
      {
        id: 'c1',
        scenarioId: 's1',
        projectId: 't1',
        from: 'agent',
        fromAgentId: 'a-coord',
        content: '@PM 请先完成需求文档并 @我 汇报',
        mentions: [],
        timestamp: kickoffAt + 5_000,
      },
    ];
    expect(
      smartCoordinatorRepliedSubstantivelySince(room, 't1', 'a-coord', kickoffAt),
    ).toBe(true);
  });

  it('plans stall nudge to coordinator only (not next executor)', () => {
    const now = 400_000;
    const plan = planSmartProgressNudge({
      nowMs: now,
      taskStartedAt: now - 500_000,
      lastTeamActivityAt: now - SMART_STALL_NUDGE_AFTER_MS - 1,
      lastNudgeAtMs: now - SMART_NUDGE_COOLDOWN_MS - 1,
      coordinatorAgentId: 'a-coord',
      coordinatorHasDecomposed: true,
      nextExecutorRoleId: 'a-dev',
      allStepsDoneInRoom: false,
      deliverablePathsVerified: false,
      coordinatorRepliedSinceKickoff: true,
      teamRoles: smartProgressTeam,
    });
    expect(plan?.kind).toBe('stall_coordinator');
    expect(plan?.targetRoleId).toBe('a-coord');
    expect(plan?.roomLine).toContain('@协调者');
    expect(plan?.roomLine).not.toMatch(/@开发/u);
  });

  it('does not nudge when coordinator already declared **项目结项** in room', () => {
    const now = 400_000;
    const plan = planSmartProgressNudge({
      nowMs: now,
      taskStartedAt: now - 500_000,
      lastTeamActivityAt: now - SMART_STALL_NUDGE_AFTER_MS - 1,
      lastNudgeAtMs: now - SMART_NUDGE_COOLDOWN_MS - 1,
      coordinatorAgentId: 'a-coord',
      coordinatorHasDecomposed: true,
      nextExecutorRoleId: 'a-dev',
      allStepsDoneInRoom: false,
      deliverablePathsVerified: false,
      coordinatorRepliedSinceKickoff: true,
      teamRoles: smartProgressTeam,
      coordinatorClosureInRoom: true,
    });
    expect(plan).toBeNull();
  });

  it('findCoordinatorProjectClosureInRoom detects PM closure broadcast', async () => {
    const { coordinatorReplyDeclaresProjectEnd } = await import(
      '../../src/lib/office-smart-project-end'
    );
    const closureBody = '象棋游戏开发项目已全部完成，感谢各位协作。';
    const closureRaw = JSON.stringify({
      role: '协调者',
      action: 'end',
      taskUnderstanding: '结项广播',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: '无' },
      roomReply: closureBody,
      dispatch: '无',
    });
    expect(coordinatorReplyDeclaresProjectEnd(closureRaw)).toBe(true);
    const room: RoomMessage[] = [
      {
        id: 'audit',
        scenarioId: 's1',
        projectId: 't1',
        from: 'agent',
        fromAgentId: 'a-qa',
        content: '【象棋游戏代码审计已完成】',
        mentions: [],
        timestamp: 100,
      },
      {
        id: 'pm-close',
        scenarioId: 's1',
        projectId: 't1',
        from: 'agent',
        fromAgentId: 'a-coord',
        content: closureBody,
        smartCoordinatorEnd: true,
        mentions: [],
        timestamp: 200,
      },
    ];
    expect(findCoordinatorProjectClosureInRoom(room, 't1', 'a-coord')).toBe(closureBody);
  });

  it('findCoordinatorProjectClosureInRoom ignores closure before smartRevivedAt', () => {
    const closureBody = '象棋游戏全部验收通过，感谢协作。';
    const room: RoomMessage[] = [
      {
        id: 'pm-close',
        scenarioId: 's1',
        projectId: 't1',
        from: 'agent',
        fromAgentId: 'a-coord',
        content: closureBody,
        smartCoordinatorEnd: true,
        mentions: [],
        timestamp: 200,
      },
    ];
    expect(findCoordinatorProjectClosureInRoom(room, 't1', 'a-coord')).toBe(closureBody);
    expect(findCoordinatorProjectClosureInRoom(room, 't1', 'a-coord', 500)).toBeNull();
    expect(findCoordinatorProjectClosureInRoom(room, 't1', 'a-coord', 200)).toBe(closureBody);
  });

  it('findCoordinatorProjectClosureInRoom prefers full content over truncated progressText', () => {
    const closureBody = '象棋游戏全部验收通过，感谢协作。';
    const room: RoomMessage[] = [
      {
        id: 'pm-close',
        scenarioId: 's1',
        projectId: 't1',
        from: 'agent',
        fromAgentId: 'a-coord',
        content: closureBody,
        smartCoordinatorEnd: true,
        progressText: '象棋游戏全部验收通过。',
        mentions: [],
        timestamp: 200,
      },
    ];
    expect(findCoordinatorProjectClosureInRoom(room, 't1', 'a-coord')).toBe(closureBody);
  });

  it('stall nudge line uses actual stall duration not fixed 90s threshold', () => {
    const stalledMs = 210_000;
    const line = buildSmartProgressNudgeLine({
      kind: 'stall_coordinator',
      targetRoleName: '协调者',
      nextExecutorName: '开发',
      elapsedMs: stalledMs,
    });
    expect(line).toContain(formatSmartProgressElapsedMs(stalledMs));
    expect(line).not.toContain('90 秒');
    expect(line).toContain('3 分 30 秒');
    expect(line).toContain('开发');
    expect(line).toContain('@协调者');
    expect(line).not.toMatch(/@开发/u);
  });
});

describe("__merged__:office-smart-mention-normalize", () => {
  it('resolveSmartMentionRoundId prefers replyToId thread root', () => {
    expect(
      resolveSmartMentionRoundId({ id: 'm2', replyToId: 'm1' }),
    ).toBe('m1');
    expect(resolveSmartMentionRoundId({ id: 'm1' })).toBe('m1');
  });

  it('resolveSmartMentionSessionRoundId uses batch key when coalesced', () => {
    expect(
      resolveSmartMentionSessionRoundId(
        { id: 'm3', replyToId: 'm2' },
        ['room-a', 'room-b', 'room-c'],
      ),
    ).toBe('batch:room-a+room-b+room-c');
    expect(
      resolveSmartMentionSessionRoundId({ id: 'm3', replyToId: 'm2' }, ['room-a']),
    ).toBe('m2');
  });

  it('resolveSmartMentionDispatchRoundId distinguishes member reports on same replyToId', () => {
    const sharedReplyTo = 'room-coord-assign';
    const us = resolveSmartMentionDispatchRoundId(
      { id: 'room-mention-round-us-coord', replyToId: sharedReplyTo },
      undefined,
      { memberInboundCoordinator: true },
    );
    const hk = resolveSmartMentionDispatchRoundId(
      { id: 'room-mention-round-hk-coord', replyToId: sharedReplyTo },
      undefined,
      { memberInboundCoordinator: true },
    );
    expect(us).toBe('room-mention-round-us-coord');
    expect(hk).toBe('room-mention-round-hk-coord');
    expect(us).not.toBe(hk);
    expect(
      resolveSmartMentionDispatchRoundId(
        { id: 'ignored', replyToId: sharedReplyTo },
        ['room-mention-round-us-coord', 'room-mention-round-hk-coord'],
        { memberInboundCoordinator: true },
      ),
    ).toBe('batch:room-mention-round-hk-coord+room-mention-round-us-coord');
  });

  it('isSmartMemberInboundCoordinatorDispatch detects member @ coordinator report', () => {
    expect(
      isSmartMemberInboundCoordinatorDispatch({
        coordinatorAgentId: 'a-coord',
        targetRoleId: 'a-coord',
        userMsg: { from: 'agent', fromAgentId: 'a-dev' },
      }),
    ).toBe(true);
    expect(
      isSmartMemberInboundCoordinatorDispatch({
        coordinatorAgentId: 'a-coord',
        targetRoleId: 'a-coord',
        promptVariant: 'coordinator_member_report',
        userMsg: { from: 'system' },
      }),
    ).toBe(true);
    expect(
      isSmartMemberInboundCoordinatorDispatch({
        coordinatorAgentId: 'a-coord',
        targetRoleId: 'a-dev',
        userMsg: { from: 'agent', fromAgentId: 'a-dev' },
      }),
    ).toBe(false);
  });

  it('resolveMergedSmartCoordinatorPromptVariant prefers member_report when coalescing kickoff + member', () => {
    expect(
      resolveMergedSmartCoordinatorPromptVariant(
        'coordinator_kickoff_decompose',
        undefined,
        false,
        true,
      ),
    ).toBe('coordinator_member_report');
    expect(
      resolveMergedSmartCoordinatorPromptVariant(
        'coordinator_kickoff_decompose',
        undefined,
        false,
        false,
      ),
    ).toBe('coordinator_kickoff_decompose');
  });

  it('mergeSmartMentionTriggerContent appends distinct instructions', () => {
    const merged = mergeSmartMentionTriggerContent(
      '@开发 修正目录 A',
      '@开发 修正目录 B',
    );
    expect(merged).toContain('目录 A');
    expect(merged).toContain('目录 B');
    expect(merged).toContain('---');
  });

  it('dedupeMentionTargetsByRoleId keeps first occurrence', () => {
    const roles = [
      agent('a-dev', '开发'),
      agent('a-dev', '开发'),
      agent('a-pm', 'PM'),
    ];
    expect(dedupeMentionTargetsByRoleId(roles)).toHaveLength(2);
  });

  it('smartMentionSessionIdempotencyKey is stable per round and role', () => {
    expect(smartMentionSessionIdempotencyKey('round-1', 'dev', false)).toBe(
      'room-mention-smart-round-1-dev',
    );
    expect(smartMentionSessionIdempotencyKey('round-1', 'dev', true)).toContain('retry');
  });
});

describe("__merged__:office-smart-role-prompt", () => {
  it('coordinator prompt uses six-section task format with team roster and coordinator schema', () => {
    const guide = buildSmartCoordinatorRolePromptBlock();
    expect(guide).toContain('一.【角色信息】');
    expect(guide).toContain('1.2 团队成员:');
    expect(guide).toContain('1.1 我是:PM（协调者）');
    expect(guide).toContain('三.【历史记录与本轮任务】');
    expect(guide).toContain('无上下游依赖');
    expect(guide).toContain('并行');
    expect(guide).toContain('4.2 交付物规范');
    expect(guide).toContain('五、强制输出格式');
    expect(guide).toContain('inputValidation');
    expect(guide).toContain('"action"');
    expect(guide).toContain('dispatch');
    expect(guide).not.toContain('字段说明：');
    expect(guide).toContain('本轮允许角色：');
    const few = buildSmartCoordinatorFewShotBlock();
    expect(few).toContain('正向 1');
    expect(few).toContain('正向 2');
    expect(few).toContain('反例');
    expect(few).toContain('不得点名汇报者');
  });

  it('member prompt uses five-section task format and JSON schema', () => {
    const guide = buildSmartMemberRolePromptBlock();
    expect(guide).toContain('一.【角色信息】');
    expect(guide).toContain('二.【项目信息】');
    expect(guide).not.toContain('三、历史群聊记录');
    expect(guide).toContain('四.【执行与交付规范】');
    expect(guide).toContain('五、输出格式规范');
    const few = buildSmartMemberFewShotBlock();
    expect(few).toContain('正向 1');
    expect(few).toContain('正向 2');
    expect(few).toContain('交付物-开发');
    expect(few).toContain('反例');
    expect(few).toContain('缺必填字段');
  });

  it('positive member few-shot passes engine validation', () => {
    const few = buildSmartMemberFewShotBlock();
    const chunk = few.split('--- 正向 1')[1]!.split('--- 正向 2')[0]!.trim();
    const jsonStart = chunk.indexOf('{');
    const body = chunk.slice(jsonStart);
    const r = validateRoomMentionStructuredReply({
      raw: body,
      transportReason: 'empty',
      executionMode: 'smart',
      isCoordinator: false,
      actorRoleName: '产品',
      coordinatorRole: agent('a-pm', 'PM'),
      smartMemberReadiness: 'ready',
      teamRoles: [
        { id: 'pm', name: 'PM', agentId: 'a', createdAt: 0, updatedAt: 0 },
        { id: 'product', name: '产品', agentId: 'b', createdAt: 0, updatedAt: 0 },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it('mention agent prompt is five-section task prompt only (no few-shot or extra blocks)', () => {
    const coord = buildSmartRoomMentionAgentPrompt({
      role: { id: 'pm', name: 'PM', agentId: 'a', createdAt: 0, updatedAt: 0 },
      roomLine: '@PM 请分工',
      scenario: { name: '团队' },
      speakerLabel: '系统',
      isCoordinator: true,
      executionMode: 'smart',
    });
    expect(coord).toContain('一.【角色信息】');
    expect(coord).toContain('五、强制输出格式');
    expect(coord).toContain('1.2 团队成员:');
    expect(coord).toContain('inputValidation');
    expect(coord).not.toContain('【格式样例');
    expect(coord).not.toContain('【输出】');

    const member = buildSmartRoomMentionAgentPrompt({
      role: { id: 'product', name: '产品', agentId: 'b', createdAt: 0, updatedAt: 0 },
      roomLine: '@产品 请写需求',
      scenario: { name: '团队' },
      speakerLabel: 'PM',
      isCoordinator: false,
      coordinatorAgentId: 'a-pm',
      coordinatorName: 'PM',
      executionMode: 'smart',
      smartMemberReadiness: 'ready',
    });
    expect(member).toContain('一.【角色信息】');
    expect(member).toContain('五、输出格式规范');
    expect(member).not.toContain('【可执行·协调者要求】');
    expect(member).not.toContain('【格式样例·成员】');
    expect(member).not.toContain('【输出】');
  });

  it('member prompt does not inject readiness branches (strict template)', () => {
    const base = {
      role: { id: 'audit', name: '审计', agentId: 'c', createdAt: 0, updatedAt: 0 },
      roomLine: '@审计 请复核交付物',
      scenario: { name: '团队' },
      speakerLabel: 'PM',
      isCoordinator: false as const,
      coordinatorAgentId: 'a-pm',
      coordinatorName: 'PM',
      executionMode: 'smart' as const,
    };
    const ready = buildSmartRoomMentionAgentPrompt({ ...base, smartMemberReadiness: 'ready' });
    expect(ready).toContain('4.1 任务接收：以最新指令为执行基准');
    expect(ready).not.toContain('本回合可执行：');
    expect(ready).not.toContain('本回合依赖未就绪：');
    expect(ready).not.toContain('本回合为验收确认：');
    expect(ready).not.toContain('仅服从协调者指派');
  });

  it('coordinator prompt omits duplicate 功能描述 from current trigger', async () => {
    const { buildSmartCoordinatorAgentTaskPrompt } = await import(
      '../../src/lib/office-smart-coordinator-task-prompt'
    );
    const { buildSmartTaskKickoffRoomLine } = await import(
      '../../electron/services/office/smart-task-prompt'
    );
    const feature = '1.经典象棋；2.人机对战；3.三档难度';
    const kickoff = buildSmartTaskKickoffRoomLine(
      agent('a-pm', 'PM'),
      { title: '象棋游戏开发', featureDescription: feature, description: '' },
    );
    const prompt = buildSmartCoordinatorAgentTaskPrompt({
      roleName: 'PM',
      coordinatorAgentId: 'a-pm',
      teammateNames: ['测试', '开发'],
      task: { title: '象棋游戏开发', featureDescription: feature },
      currentTrigger: kickoff,
    });
    expect(prompt).toContain(`2.2 项目目标：${feature}`);
    expect(prompt).not.toMatch(/2\. 当前协调任务[\s\S]*功能描述：/u);
    expect(prompt).toContain('开始拆解任务');
  });

  it('coordinator prompt injects dispatch protocol without engine suggestion', async () => {
    const { buildSmartCoordinatorAgentTaskPrompt } = await import(
      '../../src/lib/office-smart-coordinator-task-prompt'
    );
    const prompt = buildSmartCoordinatorAgentTaskPrompt({
      roleName: 'PM',
      coordinatorAgentId: 'a-pm',
      teamRoles: [
        agent('a-pm', 'PM'),
        agent('a-dev', '开发'),
        agent('a-qa', '测试'),
      ],
      task: { title: '示例', featureDescription: '目标' },
      taskProgressContext: '【智能任务 · 各角色工作进展】\n项目状态：进行中',
      currentTrigger: '开始拆解任务',
    });
    expect(prompt).not.toContain('动态上下文（引擎注入）');
    expect(prompt).toContain('4.2 交付物规范');
    expect(prompt).toContain('本轮允许角色');
    expect(prompt).toContain('每名成员最多1个子任务');
    expect(prompt).not.toContain('同一 role 可重复出现多项');
    expect(prompt).not.toContain('引擎建议本回合优先 @');
  });

  it('coordinator prompt includes user-request rules when triggerFromUser', async () => {
    const { buildSmartCoordinatorAgentTaskPrompt } = await import(
      '../../src/lib/office-smart-coordinator-task-prompt'
    );
    const prompt = buildSmartCoordinatorAgentTaskPrompt({
      roleName: 'PM',
      coordinatorAgentId: 'a-pm',
      teamRoles: [agent('a-pm', 'PM'), agent('a-dev', '开发')],
      task: { title: '象棋游戏开发', featureDescription: '象棋 HTML 游戏' },
      currentTrigger: '用户：请再加一个悔棋功能',
      triggerFromUser: true,
    });
    expect(prompt).toContain('本回合为用户新诉求');
  });

  it('coordinator member_report prompt keeps only dispatch in 3.3 trigger', async () => {
    const { buildSmartCoordinatorAgentTaskPrompt } = await import(
      '../../src/lib/office-smart-coordinator-task-prompt'
    );
    const dispatchLine =
      '@AI-Agent开发专家 请验收交付物「交付物-AI-Agent工程专家/大模型现实问题与Agent机会-AI-Agent工程专家.md」，内容涵盖大模型五大现实问题（幻觉、上下文窗口、推理成本、工具调用可靠性、持续学习）以及AI Agent的五大机会方向（主动规划、工具整合、多Agent协作、质量保障、成本优化），每个模块均超过1500字并包含具体案例支撑。';
    const jsonTrigger = JSON.stringify({
      role: 'AI-Agent开发专家',
      action: 'assign',
      taskUnderstanding:
        '本任务基于公开技术报告与行业案例，从工程实践角度研究大模型应用的五大现实痛点。',
      inputValidation:
        '-rw-r--r-- 1 lixingwei 13771 交付物-AI-Agent工程专家/大模型现实问题与Agent机会-AI-Agent工程专家.md',
      deliverable: {
        items: ['交付物-AI-Agent工程专家/大模型现实问题与Agent机会-AI-Agent工程专家.md'],
        outputValidation: [
          '-rw-r--r-- 1 lixingwei 13771 交付物-AI-Agent工程专家/大模型现实问题与Agent机会-AI-Agent工程专家.md',
        ],
      },
      roomReply:
        '本任务基于公开技术报告与行业案例，从工程实践角度研究大模型应用的五大现实痛点。交付物：大模型现实问题与Agent机会-AI-Agent工程专家.md',
      dispatch: [
        {
          role: 'AI-Agent开发专家',
          task: dispatchLine.replace(/^@[^\s]+\s+/u, ''),
        },
      ],
    });
    const prompt = buildSmartCoordinatorAgentTaskPrompt({
      roleName: 'AI-Agent开发专家',
      coordinatorAgentId: 'ai-agent-kai-fa-zhuan-jia',
      teamRoles: [
        agent('ai-agent-kai-fa-zhuan-jia', 'AI-Agent开发专家'),
        agent('ai-agent-gong-cheng-zhuan-jia', 'AI-Agent工程专家'),
      ],
      task: { title: 'AI-Agent开发方案探索', featureDescription: '研究大模型现实问题与 Agent 机会' },
      currentTrigger: jsonTrigger,
      promptVariant: 'coordinator_member_report',
      memberReportKind: 'subtask_done',
    });
    const triggerSection = prompt.split('3.3 【本回合触发】')[1]?.split('四.【执行与交付规范】')[0] ?? '';
    expect(triggerSection.trim()).toBe(dispatchLine);
    expect(triggerSection).not.toContain('【任务理解】');
    expect(triggerSection).not.toContain('【群聊回复】');
    expect(triggerSection).not.toContain('【输出校验】');
    expect(prompt).toContain('本回合为处理成员汇报');
  });

  it('coordinator prompt omits user-request rules for member trigger', async () => {
    const { buildSmartCoordinatorAgentTaskPrompt } = await import(
      '../../src/lib/office-smart-coordinator-task-prompt'
    );
    const prompt = buildSmartCoordinatorAgentTaskPrompt({
      roleName: 'PM',
      coordinatorAgentId: 'a-pm',
      task: { title: '示例', featureDescription: '目标' },
      currentTrigger: '【测试已完成】请验收',
      triggerFromUser: false,
    });
    expect(prompt).not.toContain('本回合为用户新诉求');
  });

  it('member prompt omits dynamic context and room history sections', async () => {
    const { buildSmartMemberAgentTaskPrompt } = await import(
      '../../src/lib/office-smart-member-task-prompt'
    );
    const prompt = buildSmartMemberAgentTaskPrompt({
      roleName: '开发',
      coordinatorName: 'PM',
      task: { title: '示例' },
      taskProgressContext: '【智能任务 · 我的工作进展】\n项目状态：进行中',
      currentAssignment: '@开发 请实现',
    });
    expect(prompt).not.toContain('动态上下文（引擎注入）');
    expect(prompt).not.toContain('三、历史群聊记录');
  });

  it('extractProjectRoot preserves spaces in office/project policy line', async () => {
    const { extractProjectRootFromProgressContext } = await import(
      '../../src/lib/office-smart-task-prompt-common'
    );
    const ctx = [
      '【项目目录·唯一】…',
      '- ~/.openclaw/office/project/AI Agent开发方案探索-project-1782122458038-0bg3o3',
    ].join('\n');
    expect(extractProjectRootFromProgressContext(ctx)).toBe(
      '~/.openclaw/office/project/AI Agent开发方案探索-project-1782122458038-0bg3o3',
    );
  });

  it('projectRootDisplay overrides truncated path in member prompt', async () => {
    const { buildSmartMemberAgentTaskPrompt } = await import(
      '../../src/lib/office-smart-member-task-prompt'
    );
    const prompt = buildSmartMemberAgentTaskPrompt({
      roleName: '开发',
      coordinatorName: 'PM',
      projectRootDisplay:
        '~/.openclaw/office/project/AI-Agent开发方案探索-project-1782122458038-0bg3o3',
      taskProgressContext: '- ~/.openclaw/office/project/AI',
      currentAssignment: '@开发 请实现',
    });
    expect(prompt).toContain(
      '~/.openclaw/office/project/AI-Agent开发方案探索-project-1782122458038-0bg3o3',
    );
    expect(prompt).not.toContain('office/project/AI\n');
  });

  it('follow-up from coordinator JSON publish targets 产品 only', () => {
    const userJson = JSON.stringify({
      role: 'PM',
      action: 'assign',
      roomReply: '@产品 请先编写 PRD',
      dispatch: [{ role: '产品', task: '子任务：编写 PRD' }],
      taskUnderstanding: '拆解',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: '无' },
    });
    const team = [
      agent('a-pm', 'PM'),
      agent('a-product', '产品'),
    ];
    const pickedFromRaw = pickRolesDelegatedByCoordinator(
      userJson,
      team,
      'a-pm',
      'a-pm',
      { executionMode: 'smart' },
    );
    expect(pickedFromRaw.map((r) => r.agentId)).toEqual(['a-product']);
  });

  it('parallel coordinator follow-up delegates only dispatch JSON roles, not roomReply @', async () => {
    const { buildSmartCoordinatorRoomPublishText } = await import(
      '../../src/lib/office-smart-room-fields'
    );
    const { parseRoomMentionStructuredReply } = await import(
      '../../electron/services/office/room-mention-structured-reply'
    );
    const { buildSmartMemberDispatchAssignment } = await import(
      '../../src/lib/office-smart-room-fields'
    );
    const raw = JSON.stringify({
      role: '协调者',
      action: 'assign',
      roomReply: '🚀 并行启动\n@专家A 任务A\n@专家B 任务B',
      dispatch: [{ role: '专家A', task: '任务A细节' }],
      taskUnderstanding: '拆解',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: [] },
    });
    const parsed = parseRoomMentionStructuredReply(raw);
    const combined = buildSmartCoordinatorRoomPublishText(parsed.roomReply, parsed.dispatch);
    const team = [agent('coord', '协调者'), agent('a', '专家A'), agent('b', '专家B')];
    const pickedDispatchOnly = pickRolesDelegatedByCoordinator(
      raw,
      team,
      'coord',
      'coord',
      { executionMode: 'smart' },
    );
    expect(pickedDispatchOnly.map((r) => r.agentId)).toEqual(['a']);
    const pickedCombined = pickRolesDelegatedByCoordinator(
      combined,
      team,
      'coord',
      'coord',
      { executionMode: 'smart' },
    );
    expect(pickedCombined.map((r) => r.agentId)).toEqual([]);
    const engAssignment = buildSmartMemberDispatchAssignment(
      raw,
      { id: 'b', name: '专家B' },
      '',
    );
    expect(engAssignment).not.toContain('@专家A');
    expect(engAssignment).not.toContain('任务A');
    expect(engAssignment).toBe('');
    const tuneAssignment = buildSmartMemberDispatchAssignment(
      raw,
      { id: 'a', name: '专家A' },
      '',
    );
    expect(tuneAssignment).toContain('@专家A');
    expect(tuneAssignment).toContain('任务A细节');
  });

  it('coordinator JSON→bracket→publish does not duplicate dispatch assignment', async () => {
    const { smartJsonToBracketText } = await import('../../src/lib/office-smart-json-schema');
    const {
      buildSmartCoordinatorRoomPublishText,
      extractSmartRoomReplyAndDispatch,
    } = await import('../../src/lib/office-smart-room-fields');
    const dispatchTask =
      '任务目标：调研大模型运用遇到的现实问题；落盘路径：交付物-AI-Agent工程专家/大模型现实问题-AI-Agent工程专家.md';
    const json = {
      role: 'AI-Agent开发专家',
      action: 'assign',
      taskUnderstanding:
        '项目Kickoff，需将项目目标拆解为可执行子任务并指派给团队成员。',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: [] },
      dispatch: [{ role: 'AI-Agent工程专家', task: dispatchTask }],
    };
    const raw = JSON.stringify(json);
    for (const text of [raw, smartJsonToBracketText(json as never, true)]) {
      const parsed = extractSmartRoomReplyAndDispatch(text);
      const published = buildSmartCoordinatorRoomPublishText(
        parsed.roomReply,
        parsed.dispatch,
      );
      expect((published.match(/@AI-Agent工程专家/gu) ?? []).length).toBe(1);
      expect(published).toContain(dispatchTask);
      expect(published).toContain('项目Kickoff');
    }
  });

  it('smartDispatchRoleTaskText separates parallel role assignments with blank line', async () => {
    const { smartDispatchRoleTaskText } = await import('../../src/lib/office-smart-json-schema');
    const text = smartDispatchRoleTaskText([
      { role: 'AI-Agent工程专家', task: '任务A' },
      { role: '大模型调优专家', task: '任务B' },
    ]);
    expect(text).toBe('@AI-Agent工程专家 任务A\n\n@大模型调优专家 任务B');
  });

  it('progress nudge dispatches only dispatch.role target with matching task text', async () => {
    const { buildSmartMemberDispatchAssignment } = await import(
      '../../src/lib/office-smart-room-fields'
    );
    const raw = JSON.stringify({
      role: 'AI-Agent开发专家',
      action: 'assign',
      roomReply: '各成员请按分工推进。',
      dispatch: [
        {
          role: '大模型调优专家',
          task: '【进度催促】检测到您的交付物「大模型运用问题-大模型调优专家.md」已落盘',
        },
      ],
      taskUnderstanding: '催促',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: [] },
    });
    const team = [
      agent('coord', 'AI-Agent开发专家'),
      agent('eng', 'AI-Agent工程专家'),
      agent('tune', '大模型调优专家'),
    ];
    const picked = pickRolesDelegatedByCoordinator(raw, team, 'coord', 'coord', {
      executionMode: 'smart',
    });
    expect(picked.map((r) => r.agentId)).toEqual(['tune']);
    const engAssignment = buildSmartMemberDispatchAssignment(
      raw,
      { id: 'eng', name: 'AI-Agent工程专家' },
      '',
    );
    expect(engAssignment).not.toContain('大模型调优专家');
    expect(engAssignment).not.toContain('进度催促');
    const tuneAssignment = buildSmartMemberDispatchAssignment(
      raw,
      { id: 'tune', name: '大模型调优专家' },
      '',
    );
    expect(tuneAssignment).toContain('@大模型调优专家');
    expect(tuneAssignment).toContain('进度催促');
  });

  it('aggregates multiple dispatch items for the same role into member assignment', async () => {
    const { buildSmartMemberDispatchAssignment } = await import(
      '../../src/lib/office-smart-room-fields'
    );
    const raw = JSON.stringify({
      role: '协调者',
      action: 'assign',
      roomReply: '并行启动调研',
      dispatch: [
        { role: 'AI-Agent工程专家', task: '【任务1】案例调研' },
        { role: 'AI-Agent工程专家', task: '【任务2】未来展望' },
        { role: '大模型调优专家', task: '【任务3】现实问题' },
        { role: '大模型调优专家', task: '【任务4】机会分析' },
      ],
      taskUnderstanding: '拆解',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: [] },
    });
    const eng = buildSmartMemberDispatchAssignment(
      raw,
      { id: 'eng', name: 'AI-Agent工程专家' },
      '',
    );
    expect(eng).toContain('【任务1】');
    expect(eng).toContain('【任务2】');
    expect(eng).not.toContain('【任务3】');
  });

  it('extracts multi-line dispatch @ blocks per role for member assignment', async () => {
    const { buildSmartMemberDispatchAssignment } = await import(
      '../../src/lib/office-smart-room-fields'
    );
    const raw = JSON.stringify({
      role: '协调者',
      action: 'assign',
      roomReply: '并行派活',
      dispatch: [
        { role: 'AI-Agent工程专家', task: '【任务1】案例调研\n\n【任务2】未来展望' },
        { role: '大模型调优专家', task: '【任务3】现实问题' },
      ],
      taskUnderstanding: '拆解',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: [] },
    });
    const eng = buildSmartMemberDispatchAssignment(
      raw,
      { id: 'eng', name: 'AI-Agent工程专家' },
      '',
    );
    expect(eng).toContain('【任务1】');
    expect(eng).toContain('【任务2】');
    const tune = buildSmartMemberDispatchAssignment(
      raw,
      { id: 'tune', name: '大模型调优专家' },
      '',
    );
    expect(tune).toContain('【任务3】');
    expect(tune).not.toContain('【任务1】');
    expect(
      buildSmartMemberDispatchAssignment(raw, { id: 'eng', name: 'AI-Agent工程专家' }, ''),
    ).toContain('【任务1】');
  });

  it('parallel kickoff delegates only dispatch JSON roles, not roomReply @', () => {
    const raw = JSON.stringify({
      role: '协调者',
      action: 'assign',
      roomReply: '🚀 并行\n@专家A 任务A\n@专家B 任务B',
      dispatch: [{ role: '专家A', task: '任务A细节' }],
      taskUnderstanding: '拆解',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: [] },
    });
    const team = [agent('coord', '协调者'), agent('a', '专家A'), agent('b', '专家B')];
    const picked = pickRolesDelegatedByCoordinator(raw, team, 'coord', 'coord', {
      executionMode: 'smart',
    });
    expect(picked.map((r) => r.agentId)).toEqual(['a']);
  });

  it('verifySmartUpstreamDeliverablePathsOnDisk accepts task-shaped verify params', async () => {
    const { verifySmartUpstreamDeliverablePathsOnDisk } = await import(
      '../../electron/services/office/room-mention-disk-verify'
    );
    await expect(
      verifySmartUpstreamDeliverablePathsOnDisk(['missing-file.md'], {
        task: { id: 't1', title: '测试项目', coordinatorRoleId: 'coord' },
        scenario: { coordinatorRoleId: 'coord', roleIds: ['coord', 'a'] },
        role: { id: 'a', name: '专家A', agentId: 'a' },
        teamRoles: [{ id: 'a', name: '专家A', agentId: 'a' }],
      }),
    ).resolves.toMatchObject({ ok: expect.any(Boolean) });
  });

  it('collectDeliverablePathHints keeps spaces inside role-scoped filenames', async () => {
    const { collectDeliverablePathHintsFromText } = await import(
      '../../src/lib/office-workflow-project-deliverable'
    );
    const hints = collectDeliverablePathHintsFromText(
      '交付物：AI Agent开发框架与优秀案例研究-AI-Agent工程专家.md',
    );
    expect(hints).toContain('AI Agent开发框架与优秀案例研究-AI-Agent工程专家.md');
    expect(hints).not.toContain('Agent开发框架与优秀案例研究-AI-Agent工程专家.md');
  });

  it('accepts coordinator kickoff JSON with @产品 dispatch for publish', () => {
    const userJson = JSON.stringify({
      role: 'PM',
      taskUnderstanding:
        '作为协调者，需要将「象棋游戏开发」项目拆解为子任务并指派给团队成员。首轮需产出需求文档，由产品角色负责编写PRD。',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: '无' },
      roomReply:
        '【象棋游戏开发】项目已启动，我来拆解任务并指派执行。',
      action: 'assign',
      dispatch: smartDispatch('assign', [
        {
          role: '产品',
          task: '子任务：编写《需求规格说明书-PRD.md》。验收标准：功能列表与交互流程。输出路径：需求规格说明书-产品.md',
        },
      ]),
    });
    const team = [
      agent('a-pm', 'PM'),
      agent('a-product', '产品'),
      agent('a-dev', '开发'),
    ];
    const r = validateRoomMentionStructuredReply({
      raw: userJson,
      transportReason: 'empty',
      executionMode: 'smart',
      isCoordinator: true,
      needsDecomposition: true,
      coordinatorAgentId: 'a-pm',
      actorRoleName: 'PM',
      teamRoles: team,
      smartNextExecutorRoleId: 'a-product',
      projectId: 't1',
      roomMessages: [],
      smartWorkSteps: [
        { roleIds: ['a-product'], title: '需求' },
        { roleIds: ['a-dev'], title: '开发' },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.roomText).toMatch(/@产品/u);
      const picked = pickRolesDelegatedByCoordinator(
        userJson,
        team,
        'a-pm',
        'a-pm',
        { executionMode: 'smart' },
      );
      expect(picked.map((x) => x.agentId)).toEqual(['a-product']);
      expect(picked.some((x) => x.agentId === 'pm')).toBe(false);
    }
  });

  it('roomMentionFewShotBlock delegates to role few-shots', () => {
    expect(roomMentionFewShotBlock('smart', 'coordinator')).toContain('正向 2');
    expect(roomMentionFewShotBlock('smart', 'member')).toContain('缺必填字段');
  });
});

describe('__merged__:office-smart-member-inbound-queue', () => {
  afterEach(() => {
    resetSmartMemberInboundQueuesForTesting();
  });

  function mockMemberInboundWork(input: {
    id: string;
    content: string;
    fromRoleId?: string;
    timestamp?: number;
  }) {
    return {
      gateway: {} as import('../../electron/gateway/manager').GatewayManager,
      params: {
        scenarioId: 'sc-1',
        coordinatorAgentId: 'a-coord',
        content: input.content,
        scenarioName: 'test',
        focusTask: {
          id: 'task-1',
          executionMode: 'smart',
        } as OfficeTask,
        scenario: null,
        replyQuote: null,
        roomContext: null,
        promptVariant: 'coordinator_member_report' as const,
      },
      userMsg: {
        id: input.id,
        scenarioId: 'sc-1',
        taskId: 'task-1',
        from: 'agent',
        fromRoleId: input.fromRoleId ?? 'dev',
        content: input.content,
        mentions: ['coord'],
        timestamp: input.timestamp ?? 1,
      } as RoomMessage,
      roles: [{ id: 'coord', name: '协调者', agentId: 'agent-coord', createdAt: 0, updatedAt: 0 }],
      role: { id: 'coord', name: '协调者', agentId: 'agent-coord', createdAt: 0, updatedAt: 0 },
      options: { initialTimeoutMs: 0, allowSupplementary: true },
      hooks: {},
      coalescedFromUserMsgIds: [input.id],
    };
  }

  it('mergeAllSmartMemberInboundWork merges FIFO batch with latest userMsg and coalesced ids', () => {
    const batch = mergeAllSmartMemberInboundWorkForTesting([
      mockMemberInboundWork({ id: 'm-us', content: 'US 汇报 A', timestamp: 100 }),
      mockMemberInboundWork({ id: 'm-hk', content: 'HK 汇报 B', fromAgentId: 'a-hk', timestamp: 200 }),
    ]);
    expect(batch?.userMsg.id).toBe('m-hk');
    expect(batch?.coalescedFromUserMsgIds).toEqual(['m-us', 'm-hk']);
    expect(batch?.params.content).toContain('US 汇报 A');
    expect(batch?.params.content).toContain('HK 汇报 B');
    expect(batch?.params.promptVariant).toBe('coordinator_member_report');
  });

  it('mergeAllSmartMemberInboundWork prefers newest trigger even when enqueued out of order', () => {
    const batch = mergeAllSmartMemberInboundWorkForTesting([
      mockMemberInboundWork({ id: 'm-ppt', content: 'PPT 已完成', timestamp: 500 }),
      mockMemberInboundWork({ id: 'm-old', content: '旧汇报', timestamp: 100 }),
    ]);
    expect(batch?.userMsg.id).toBe('m-ppt');
    expect(batch?.coalescedFromUserMsgIds.sort()).toEqual(['m-old', 'm-ppt']);
  });

  it('ordinary Smart coalesce sends pending alone after the first batch was dispatched', () => {
    const first = mockMemberInboundWork({ id: 'm-a', content: 'A 汇报' });
    const pending = mockMemberInboundWork({ id: 'm-b', content: 'B 汇报', fromRoleId: 'b' });

    const beforeFirstSend = mergeSmartPendingDispatchForPassForTesting(first, pending, false);
    expect(beforeFirstSend.coalescedFromUserMsgIds).toEqual(['m-a', 'm-b']);
    expect(beforeFirstSend.params.content).toContain('A 汇报');
    expect(beforeFirstSend.params.content).toContain('B 汇报');

    const afterFirstSend = mergeSmartPendingDispatchForPassForTesting(first, pending, true);
    expect(afterFirstSend.coalescedFromUserMsgIds).toEqual(['m-b']);
    expect(afterFirstSend.params.content).toBe('B 汇报');
    expect(afterFirstSend.userMsg.id).toBe('m-b');
  });

  it('clearSmartMentionDispatchInflightForTask clears member-inbound queue state', () => {
    const queueKey = `smart:task-1:coord${SMART_MEMBER_INBOUND_COORDINATOR_INFLIGHT_SUFFIX}`;
    pushSmartMemberInboundWorkForTesting(
      queueKey,
      'task-1',
      mockMemberInboundWork({ id: 'm1', content: '汇报' }),
    );
    expect(smartMemberInboundQueueDepthForTesting(queueKey)).toBe(1);
    expect(isSmartMentionDispatchInflight('task-1', 'coord')).toBe(true);
    clearSmartMentionDispatchInflightForTask('task-1');
    expect(smartMemberInboundQueueDepthForTesting(queueKey)).toBe(0);
    expect(isSmartMentionDispatchInflight('task-1', 'coord')).toBe(false);
  });

  it('marks captured smart dispatch generation stale after fresh/abort bump', () => {
    expect(isStaleSmartMentionDispatchForTesting('task-epoch', 0)).toBe(false);
    clearSmartMentionDispatchInflightForTask('task-epoch');
    expect(isStaleSmartMentionDispatchForTesting('task-epoch', 0)).toBe(true);
  });
});

describe('__merged__:office-smart-member-report-inbound-dedup', () => {
  afterEach(() => {
    clearSmartMemberReportInboundDedupForTask('task-dedup');
  });

  it('skips follow-up when coordinator already accepted member in merged batch reply', () => {
    const usReport = {
      id: 'room-us-report',
      from: 'agent',
      fromAgentId: 'a-us',
      content: '美股分析报告已完成 @上帝',
      timestamp: 100,
    } as const;
    const coordReply = {
      id: 'room-coord-review',
      from: 'agent',
      fromAgentId: 'a-coord',
      content: '✅ 美股分析报告也已提交并通过验收。请 A股分析师 尽快完成。',
      timestamp: 200,
      replyToId: 'room-hk-report',
    } as const;
    const roomMessages = [usReport, coordReply];

    expect(
      coordinatorAlreadyAddressedMemberReportInRoom({
        roomMessages,
        memberReport: usReport,
        coordinatorAgentId: 'a-coord',
        memberRoleName: '美股分析师',
      }).skip,
    ).toBe(true);

    expect(
      shouldSkipSmartCoordinatorMemberReportInbound({
        taskId: 'task-dedup',
        triggerMsgId: usReport.id,
        memberReport: usReport,
        roomMessages,
        coordinatorAgentId: 'a-coord',
        memberRoleName: '美股分析师',
      }).skip,
    ).toBe(true);
  });

  it('does not skip when coordinator only urged member without accepting their report', () => {
    const aReport = {
      id: 'room-a-report',
      from: 'agent',
      fromRoleId: 'a-stock',
      content: 'A股分析报告已完成 @上帝',
      timestamp: 500,
    } as const;
    const coordUrge = {
      id: 'room-coord-urge',
      from: 'agent',
      fromAgentId: 'a-coord',
      content: '请 A股分析师 尽快完成分析报告提交。',
      timestamp: 400,
    } as const;

    expect(
      coordinatorAlreadyAddressedMemberReportInRoom({
        roomMessages: [coordUrge, aReport],
        memberReport: aReport,
        coordinatorAgentId: 'a-coord',
        memberRoleName: 'A股分析师',
      }).skip,
    ).toBe(false);
  });

  it('registry marks handled triggers after successful coordinator inbound', () => {
    registerSmartMemberReportsHandledByCoordinatorInbound('task-dedup', [
      'room-hk-report',
      'room-us-report',
    ]);
    expect(isSmartMemberReportHandledByCoordinatorInbound('task-dedup', 'room-us-report')).toBe(
      true,
    );
    expect(isSmartMemberReportHandledByCoordinatorInbound('task-dedup', 'room-a-report')).toBe(
      false,
    );
  });

  it('coordinatorReceiptAckExistsForMemberReport matches postsend receipt ack', () => {
    const report: RoomMessage = {
      id: 'room-report-1',
      groupId: 'g1',
      projectId: 'task-dedup',
      from: 'a-dev',
      fromAgentId: 'a-dev',
      content: 'PPT 交付完成',
      mentions: ['a-coord'],
      timestamp: 100,
    };
    const postsendAck: RoomMessage = {
      id: 'room-ack-postsend-room-report-1-a-coord',
      groupId: 'g1',
      projectId: 'task-dedup',
      from: 'a-coord',
      fromAgentId: 'a-coord',
      content: '【已收到】协调者处理中…',
      mentions: [],
      timestamp: 101,
      replyToId: 'room-report-1',
    };
    expect(
      coordinatorReceiptAckExistsForMemberReport({
        roomMessages: [report, postsendAck],
        coordinatorAgentId: 'a-coord',
        triggerMsgId: 'room-report-1',
      }),
    ).toBe(true);
  });
});

describe('__merged__:office-room-coordinator-receipt-ack', () => {
  it('distinguishes coordinator receipt ack from member fast ack', () => {
    expect(isRoomCoordinatorReceiptAckText('【已收到】协调者处理中…')).toBe(true);
    expect(isRoomFastAckText('OK，待我思考下')).toBe(true);
    expect(isRoomFastAckText('【已收到】协调者处理中…')).toBe(false);
    expect(isRoomCoordinatorReceiptAckText('OK，待我思考下')).toBe(false);
  });
});

const PRODUCT_SAMPLE = `【任务理解】本步为产品角色首轮任务：根据五子棋开发任务说明，产出需求文档并向协调者汇报。输入为 definition.json 中的功能描述"支持人人对战和人机对战"，输出为需求规格说明书。

【动作】end

【输出校验】-rw-r--r-- 1 lixingwei 453037844 1180 May 26 15:28 /Users/lixingwei/.openclaw/workspace-pm/office/projects/五子棋开发-task-1779333189657-jnpxof/交付物-产品/requirements-产品.md

【交付产物】交付物-产品/requirements-产品.md
关键摘要：需求文档含人人对战/人机对战模式说明、15×15棋盘、Minimax+Alpha-Beta AI算法、界面功能清单、验收标准。

【群聊回复】 【需求规格说明书已完成】已产出五子棋游戏需求文档，包含：人人对战（15×15棋盘、胜负判定）、人机对战（Minimax+Alpha-Beta剪枝算法）、界面功能清单。 请 @PM 验收并安排开发阶段。

【分工】@PM 请验收需求规格说明书。

【完成】true`;

describe("__merged__:office-smart-product-reply-sample", () => {
  it('passes structured validation when sections are complete', () => {
    const deliverable = smartDeliverableDir('产品');
    const json = JSON.stringify({
      role: '产品',
      taskUnderstanding:
        '本步为产品角色首轮任务：根据五子棋开发任务说明，产出需求文档并向协调者汇报。',
      action: 'end',
      deliverable,
      roomReply:
        '【需求规格说明书已完成】已产出五子棋游戏需求文档，包含人人对战与人机对战模式说明。',
      dispatch: smartDispatch('end', [
        { role: 'PM', task: '请验收需求规格说明书 交付物-产品/。' },
      ]),
    });
    const mirror = validateSmartWorkflowMirrorSections(PRODUCT_SAMPLE, {
      smartMemberReadiness: 'ready',
      actorRoleName: '产品',
    });
    expect(mirror).toEqual([]);

    const r = validateRoomMentionStructuredReply({
      raw: json,
      transportReason: 'empty',
      executionMode: 'smart',
      isCoordinator: false,
      actorRoleName: '产品',
      coordinatorRole: agent('a-pm', 'PM'),
      smartMemberReadiness: 'ready',
      teamRoles: [
        SMART_AGENTS.pm,
        { id: 'product', name: '产品', agentId: 'a-p', createdAt: 0, updatedAt: 0 },
      ],
    });
    expect(r.ok).toBe(true);
  });
});

describe('__merged__:office-smart-role-scoped-deliverables', () => {
  it('buildSmartDeliverableSpecLines requires 交付物-角色/ prefix', async () => {
    const { buildSmartDeliverableSpecLines } = await import(
      '../../src/lib/office-smart-task-prompt-common'
    );
    const lines = buildSmartDeliverableSpecLines('大模型调优专家');
    expect(lines.join('\n')).toContain('交付物-大模型调优专家/');
    expect(lines.join('\n')).not.toContain('落盘至项目根目录');
  });

  it('validateSmartRoomJsonStructure rejects deliverable basename without role suffix', () => {
    const json = JSON.stringify({
      role: 'AI-Agent工程专家',
      taskUnderstanding: '产出机会分析。',
      action: 'end',
      deliverable: {
        items: ['交付物-AI-Agent开发专家/bad-report.md'],
        outputValidation: ['-rw-r--r-- 1 demo staff 1180 bad-report.md'],
      },
      roomReply: '**机会分析已完成**',
      dispatch: smartDispatch('end', [{ role: 'AI-Agent开发专家', task: '请验收。' }]),
    });
    const r = validateSmartRoomJsonStructure(json, {
      isCoordinator: false,
      actorRoleName: 'AI-Agent工程专家',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues).toContain('deliverable_filename_missing_role_suffix');
  });

  it('validateSmartRoomJsonStructure accepts coordinator-misassigned dir when basename matches member', () => {
    const json = JSON.stringify({
      role: 'AI-Agent工程专家',
      taskUnderstanding: '产出机会分析。',
      action: 'end',
      deliverable: {
        items: ['交付物-AI-Agent开发专家/AI-Agent机会分析-AI-Agent工程专家.md'],
        outputValidation: [
          '-rw-r--r-- 1 demo staff 1180 交付物-AI-Agent开发专家/AI-Agent机会分析-AI-Agent工程专家.md',
        ],
      },
      roomReply: '**机会分析已完成**',
      dispatch: smartDispatch('end', [{ role: 'AI-Agent开发专家', task: '请验收。' }]),
    });
    const r = validateSmartRoomJsonStructure(json, {
      isCoordinator: false,
      actorRoleName: 'AI-Agent工程专家',
    });
    expect(r.ok).toBe(true);
  });

  it('validateSmartRoomJsonStructure accepts scoped deliverable file paths', () => {
    const json = JSON.stringify({
      role: '产品',
      taskUnderstanding: '产出需求文档。',
      action: 'end',
      deliverable: {
        items: ['交付物-产品/requirements-产品.md'],
        outputValidation: [
          '-rw-r--r-- 1 demo staff 1180 May 26 15:28 交付物-产品/requirements-产品.md',
        ],
      },
      roomReply: '**需求规格说明书已完成** 已写入 交付物-产品/requirements-产品.md。',
      dispatch: smartDispatch('end', [{ role: 'PM', task: '请验收。' }]),
    });
    const r = validateSmartRoomJsonStructure(json, {
      isCoordinator: false,
      actorRoleName: '产品',
    });
    expect(r.ok).toBe(true);
  });

  it('validateSmartRoomJsonStructure accepts scoped deliverable directory items', () => {
    const json = JSON.stringify({
      role: '产品',
      taskUnderstanding: '产出需求文档。',
      action: 'end',
      deliverable: {
        items: ['交付物-产品'],
        outputValidation: [
          'drwxr-xr-x  2 demo staff   64 May 26 15:28 交付物-产品',
        ],
      },
      roomReply: '**需求规格说明书已完成** 已写入 交付物-产品/。',
      dispatch: smartDispatch('end', [{ role: 'PM', task: '请验收。' }]),
    });
    const r = validateSmartRoomJsonStructure(json, {
      isCoordinator: false,
      actorRoleName: '产品',
    });
    expect(r.ok).toBe(true);
  });

  it('normalizeSmartDeliverableItemPath prefixes bare filenames', async () => {
    const { normalizeSmartDeliverableItemPath } = await import(
      '../../src/lib/office-deliverable-file-policy'
    );
    expect(normalizeSmartDeliverableItemPath('requirements-产品.md', '产品')).toBe(
      '交付物-产品/requirements-产品.md',
    );
    expect(normalizeSmartDeliverableItemPath('交付物-开发/', '开发')).toBe('交付物-开发');
  });

  it('accepts deliverable outputValidation without ls stat lines', () => {
    const json = JSON.stringify({
      role: '产品',
      taskUnderstanding: '产出需求文档。',
      action: 'end',
      deliverable: {
        items: ['交付物-产品'],
        outputValidation: ['交付物-产品'],
      },
      roomReply: '请验收。',
      dispatch: smartDispatch('end', [{ role: 'PM', task: '请验收。' }]),
    });
    const r = validateSmartRoomJsonStructure(json, {
      isCoordinator: false,
      actorRoleName: '产品',
    });
    expect(r.ok).toBe(true);
  });

  it('validateSmartRoomJsonStructure ignores prompt schema maxLength on JSON fields', () => {
    const longUnderstanding = '理'.repeat(SMART_JSON_TASK_UNDERSTANDING_MAX_CHARS + 50);
    const longTask = '派'.repeat(SMART_JSON_DISPATCH_MAX_CHARS + 50);
    const json = JSON.stringify({
      role: 'PM',
      taskUnderstanding: longUnderstanding,
      inputValidation: '无',
      deliverable: { items: [], outputValidation: [] },
      action: 'assign',
      dispatch: [{ role: '开发', task: longTask }],
    });
    const r = validateSmartRoomJsonStructure(json, {
      isCoordinator: true,
      actorRoleName: 'PM',
    });
    expect(r.ok).toBe(true);
  });

  it('Smart mirror validation ignores deliverable inline max length', () => {
    const deliverablePath = '交付物-开发/demo-开发.md';
    const longInline = `${deliverablePath}\n${'摘'.repeat(600)}`;
    const mirror = [
      '【任务理解】已完成开发任务并写入交付物目录。',
      '【动作】end',
      `【输出校验】-rw-r--r-- 1 user group 1234 Jan 1 00:00 ${deliverablePath}`,
      `【交付产物】${longInline}`,
      '关键摘要：见群聊回复',
      `【群聊回复】已完成 ${deliverablePath}，详见目录内文件。`,
      '【分工】@PM 请验收交付物。',
    ].join('\n');
    const issues = validateSmartWorkflowMirrorSections(mirror, {
      actorRoleName: '开发',
    });
    expect(issues).not.toContain('deliverable_inline_too_long');
    expect(issues).not.toContain('deliverable_section_too_long');
  });
});

describe('__merged__:office-smart-progress-notebook-roles', () => {
  it('persists and reads role assignment lines in progress.json', async () => {
    const { writeProjectProgress, readProjectProgress } = await import(
      '../../electron/services/office/coordinator-project-fs'
    );
    const { buildCoordinatorPathContext } = await import(
      '../../electron/services/office/project-context-paths'
    );
    const ctx = buildCoordinatorPathContext(
      { coordinatorAgentId: 'coord-a' },
      [{ agentId: 'dev-a', displayName: '开发' }],
    );
    const taskId = `progress-roles-test-${Date.now()}`;
    const taskTitle = '进度笔记本测试';
    await writeProjectProgress(ctx, {
      taskId,
      taskTitle,
      coordinatorSummary: '已拆解',
      updatedAt: Date.now(),
      roles: { 'dev-a': '@开发 请实现核心功能' },
    });
    const loaded = await readProjectProgress(ctx, taskTitle, taskId);
    expect(loaded?.roles?.['dev-a']).toContain('@开发');
  });
});

describe('__merged__:office-smart-validation-messages', () => {
  it('mapValidationIssueToFieldReason uses action=end for completion (not roomReply marker)', async () => {
    const { mapValidationIssueToFieldReason, mapValidationIssueFixHint } = await import(
      '../../src/lib/office-mention-validation-detail'
    );
    const mapped = mapValidationIssueToFieldReason('smart_member_missing_action_end');
    expect(mapped.field).toBe('action');
    expect(mapped.reason).toContain('action="end"');
    expect(mapped.reason).toMatch(/勿用.*roomReply/);
    expect(mapped.reason).not.toMatch(/roomReply 仍须/);
    const hint = mapValidationIssueFixHint('smart_member_missing_action_end');
    expect(hint).toContain('action="end"');
    expect(hint).toMatch(/勿写 roomReply 或 \*\*…已完成\*\*/);
  });

  it('legacy subtask_done_marker issue code aliases to action_end copy', async () => {
    const { mapValidationIssueToFieldReason } = await import(
      '../../src/lib/office-mention-validation-detail'
    );
    const legacy = mapValidationIssueToFieldReason('smart_member_missing_subtask_done_marker');
    const current = mapValidationIssueToFieldReason('smart_member_missing_action_end');
    expect(legacy).toEqual(current);
  });

  it('coordinator dispatch_names_reporter reason references taskUnderstanding not roomReply', async () => {
    const { mapValidationIssueToFieldReason } = await import(
      '../../src/lib/office-mention-validation-detail'
    );
    const mapped = mapValidationIssueToFieldReason('smart_coordinator_dispatch_names_reporter');
    expect(mapped.reason).toContain('taskUnderstanding');
    expect(mapped.reason).not.toContain('roomReply');
  });
});

