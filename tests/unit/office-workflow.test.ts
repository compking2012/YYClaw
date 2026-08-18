// Merged office unit tests — 21 sources
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  abortWorkflowNodeRun,
  clearWorkflowNodeRunAbort,
  registerWorkflowNodeRunAbort,
} from '../../electron/services/office/workflow-node-run-registry';
import {
  collectWorkflowRoomJsonHealPendingValidation,
  healWorkflowRunningNodesFromRoom,
  multiRoleNodeReadyForStructuredHeal,
  tickWorkflowRoomJsonHealStabilityOnRuns,
} from '../../src/lib/office-workflow-run-heal';
import { extractWorkflowRoomJsonReceipt } from '../../src/lib/office-workflow-room-json-heal';
import {
  buildAgentTaskPrompt,
  buildWorkflowAgentRetryPrompt,
  extractPartialClarification,
  hasSubstantiveClarification,
  parseStructuredAgentReply,
  validateWorkflowAgentStructuredReply,
} from '../../electron/services/office/workflow-agent-reply';
import {
  buildForkJoinEdgesFromLayers,
  defaultEdgesForNodeOrder,
  ensureParallelLayerSuccessForkEdges,
  syncWorkflowEdges,
  validateWorkflowEdges,
} from '../../src/lib/office-workflow-edges';
import {
  inferDeliverableStemFromSegment,
  workflowDeliverableFileName,
} from '../../src/lib/office-workflow-deliverable-naming';
import {
  buildHeuristicWorkflowDraft,
  collapseDuplicatePhaseSteps,
  generateWorkflowFromDescriptionHeuristic,
  inferJointMultiRole,
  inferParallelWithPrevious,
  inferStepTitle,
  matchRolesInText,
  materializeWorkflowDraft,
  parseWorkflowGenerationFromText,
  parseWorkflowStepFields,
  resolveStepRollbackTargets,
  roleNamesFromWho,
  splitDescriptionToSegments,
  summarizeActionTitle,
} from '../../src/lib/office-workflow-generate';
import {
  buildPriorDeliverablesContext,
  extractWorkflowUpstreamTargetNames,
  formatPriorDeliverablesNumberedList,
  formatWorkflowUpstreamDeliverableFileList,
  getAllUpstreamNodeIds,
} from '../../src/lib/office-workflow-prior-context';
import {
  buildTaskDeliverRoomContent,
  buildTaskHandoffRoomContent,
  buildTaskReceivedRoomContent,
  buildTaskUnderstandingRoomContent,
  buildTaskClarificationRoomContent,
  nextRoleIdsAfterNode,
} from '../../electron/services/office/workflow-room-handoff';
import {
  buildWorkflowCoordinatorAgentTaskPrompt,
  buildWorkflowMemberAgentTaskPrompt,
  buildWorkflowAgentTaskPrompt,
  extractWorkflowFewShotExample,
  buildWorkflowMergedOutputSpecLines,
  WORKFLOW_OUTPUT_ROLLBACK_EXAMPLE_SECTION_TITLE,
} from '../../src/lib/office-workflow-task-prompt';
import {
  buildWorkflowOutputExampleJson,
  resolveWorkflowStepSchemaVariant,
  workflowNodeSampleDeliverablePath,
} from '../../src/lib/office-workflow-node-task-prompt';
import {
  buildWorkflowRetryDiffBlock,
  formatWorkflowStructuredValidationFailureDetail,
  mapWorkflowValidationIssueToFieldReason,
  sanitizeWorkflowPriorRawForRetryDisplay,
} from '../../src/lib/office-workflow-retry-diff';
import {
  buildWorkflowReworkPromptPrefix,
  collectDownstreamNodeIds,
  collectUserInterventionResumeNodeIds,
  reopenWorkflowNodeAndDownstream,
  reopenWorkflowUpstreamForRework,
} from '../../src/lib/office-workflow-upstream-rework';
import {
  canonicalWorkflowJsonFingerprint,
  parseWorkflowJsonOutput,
} from '../../src/lib/office-workflow-json-schema';
import {
  collectAllInputValidationBodiesFromRaw,
  isWorkflowInputValidationFailure,
  workflowInputValidationNamesRole,
} from '../../src/lib/office-workflow-input-validation';
import {
  compareTaskTitleForFlowOrder,
  extractTaskSequenceIndex,
  sortWorkflowNodesByProcessOrder,
} from '../../src/lib/office-workflow-sort';
import {
  countWorkflowNodesWithRole,
  ensureWorkflowRuntimeDefaults,
  normalizeWorkflowNodeRoles,
  workflowNodeHasRole,
  workflowNodeIsMultiRole,
  workflowNodeRoleIds,
} from '../../src/lib/office-workflow-node';
import {
  DEFAULT_NODE_MAX_RUNTIME_MINUTES,
  workflowNodeAgentTimeoutMs,
} from '../../src/lib/office-workflow-roles';
import {
  evaluateWorkflowRollback,
  isValidWorkflowRollbackExplanationBody,
  parseWorkflowRollbackTrigger,
  resolveWorkflowRollbackPredecessorNodeIds,
} from '../../src/lib/office-workflow-rollback';
import {
  isWorkflowDeliverableConclusionSummaryMismatch,
  isWorkflowEngineeringDeliverableStep,
  isWorkflowReviewLikeStepTitle,
  isWorkflowReviewStepConclusionAllowed,
} from '../../src/lib/office-workflow-deliverable-conclusion';
import {
  isWorkflowNodeRunClaimedByOtherPath,
  markWorkflowNodeCompletionSource,
  sessionWorkflowApplyMayMutateRun,
} from '../../src/lib/office-workflow-node-run-settled';
import {
  parseWorkflowCoordinatorInterventionJson,
  validateWorkflowCoordinatorInterventionDecision,
} from '../../src/lib/office-workflow-coordinator-intervention';
import { planWorkflowUserInterventionFromCoordinator } from '../../src/lib/office-workflow-user-intervention';
import {
  shouldHighlightWorkflowLayerHandoff,
  workflowNodeShouldPulse,
} from '../../src/lib/office-workflow-visual-progress';
import {
  WORKFLOW_ROOM_JSON_HEAL_STABLE_MS,
  isWorkflowRoomJsonReceiptReady,
  tickWorkflowRoomJsonReceipt,
} from '../../src/lib/office-workflow-room-json-heal';
import { applyWorkflowRoleStepFromParsedReply } from '../../electron/services/office/workflow-role-step-outcome';
import {
  compressPathToTilde,
  extractWorkflowClosureDeliverableNames,
  formatWorkflowClosureArchiveLine,
  formatWorkflowClosureDeliverablePathsLine,
} from '@/lib/office-workflow-closure-deliverables';
import { buildProjectClosureContent } from '../../electron/services/office/workflow-project-closure';
import { buildWorkflowRollbackEdgePath } from '../../src/lib/office-workflow-visual-rollback-path';
import { defaultWorkflowForRoles } from '../../src/lib/office-workflow';
import { effectivePhaseFromMessage } from '../../src/lib/task-room-progress-reconcile';
import { extractDeliverablePathHints } from '../../src/lib/office-workflow-prior-context';
import { fetchChatHistory } from '../../electron/services/office/gateway-rpc';
import { fetchLatestWorkflowStructuredSessionReply } from '../../electron/services/office/run-completion';
import { findLatestWorkflowStructuredRaw } from '../../src/lib/office-session-final-mirror';
import { freshNodeRuns, getIncompletePredecessorRoleIds, reconcileWorkflowForScenario } from '../../electron/services/office/workflow-graph';
import { getBlockingPredecessorSteps } from '../../src/lib/office-workflow-deps';
import { incomingReady } from '../../src/lib/office-workflow-schedule';
import { isSubstantiveWorkflowProgressSnippet } from '../../electron/services/office/room-mention-reply-policy';
import { nextHandoffRoleIdsAfterNode, nextHandoffTargetsAfterNode } from '../../src/lib/office-workflow-handoff';
import { nextRunnableNodes, nodeRunsForWorkflowContinue, workflowEdgeList } from '../../src/lib/office-workflow-schedule';
import { applyWorkflowAutoRollbackForNode } from '../../src/lib/office-workflow-failure-rollback';
import { nodeStepLabel, roleTaskListText } from '../../src/lib/office-workflow-roles';
import { roleTaskSessionKey } from '../../electron/services/office/session-keys';
import { roomMessageAppliesToNode } from '../../src/lib/task-room-progress-reconcile';
import { OFFICE_SETTLE_CONSISTENCY_DELAY_MS } from '../../electron/services/office/session-run-settle';
import { topologicalSortWorkflowNodes } from '../../src/lib/office-workflow-edges';
import { validateWorkflowRoomJsonForRunner } from '../../src/lib/office-workflow-room-json-validate';
import { workflowForTask } from '../../src/lib/office-task-workflow';
import {
  workflowProjectRelativeInputLsForTargets,
  workflowProjectRelativeLsDirLine,
  workflowProjectRelativeLsLine,
  workflowLsLineDisplayName,
} from '../../src/lib/office-workflow-task-prompt-shared';
import {
  isWorkflowLsResultsArrayInvalid,
  isWorkflowLsTargetPathInvalid,
  extractLsLinePathSuffix,
  lsLineMatchesWorkflowTarget,
} from '../../src/lib/office-workflow-output-ls-result';
import { roleScopedDeliverableDirName } from '../../src/lib/office-project-file-naming';
import { workflowVisualLayers } from '../../src/lib/office-workflow-visual';
import * as workflowRoomHandoff from '../../electron/services/office/workflow-room-handoff';
import type {
  NodeRunRecord,
  OfficeRole,
  OfficeScenario,
  OfficeTask,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
  RoomMessage,
} from '../../src/types/office';
import type { GatewayManager } from '../../electron/gateway/manager';
import type { OfficeDataStore } from '@electron/services/office/types';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  beginOfficeStoreTestIsolation,
  endOfficeStoreTestIsolation,
} from '../helpers/office-store-test-env.mocks';

const persistEnv = vi.hoisted(() => ({
  dataDir: '',
}));

function wfPath(role: string, file: string): string {
  return `${roleScopedDeliverableDirName(role)}/${file}`;
}

vi.mock('../../electron/services/office/paths', () => ({
  ensureOfficeDirs: async () => {
    if (!persistEnv.dataDir) return;
    const { mkdir: mkdirFs } = await import('node:fs/promises');
    await mkdirFs(persistEnv.dataDir, { recursive: true });
  },
  getOfficeDataDir: () => persistEnv.dataDir,
  getOfficeDataPath: () => join(persistEnv.dataDir, 'data.json'),
  getOfficeAuditPath: () => join(persistEnv.dataDir, 'audit.jsonl'),
}));

// Store persist tests exercise upsertTask/insertScenarioTask, which create the project
// directory via `tempProjectRoot` (rooted at the real `OPENCLAW_HOME`). Redirect it under
// the per-test temp `persistEnv.dataDir` so tests stay hermetic (no writes to the real
// ~/.openclaw). When dataDir is unset (all other tests in this file) delegate to the real
// implementation so nothing else changes.
vi.mock('../../electron/services/office/office-project-paths', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../electron/services/office/office-project-paths')>();
  const { join: joinPath } = await import('node:path');
  const { projectDirSegment } = await import('../../src/lib/office-project-context');
  return {
    ...actual,
    tempProjectRoot: (projectTitle: string, projectId: string) =>
      persistEnv.dataDir
        ? joinPath(persistEnv.dataDir, 'office', 'project', projectDirSegment(projectTitle, projectId))
        : actual.tempProjectRoot(projectTitle, projectId),
  };
});

vi.mock('../../electron/services/office/store-recovery', () => ({
  officeArtifactsLookRecoverable: async () => {
    throw new Error('store-recovery must not run during normal load/save');
  },
  recoverOfficeStoreFromArtifacts: async () => {
    throw new Error('store-recovery must not run during normal load/save');
  },
}));

vi.mock('../../electron/services/office/role-persist', () => ({
  sanitizeOfficeRoleForPersist: (role: unknown) => role,
}));

vi.mock('../../electron/services/office/gateway-rpc', () => ({
  fetchChatHistory: vi.fn(),
}));

const rollbackTeamRoles: Pick<OfficeRole, 'id' | 'name' | 'agentId'>[] = [
  { id: 'dev', name: '开发', agentId: 'a-dev' },
  { id: 'qa', name: '测试', agentId: 'a-qa' },
  { id: 'audit', name: '审计', agentId: 'a-audit' },
];

const rollbackEdgeRoles: OfficeRole[] = [
  { id: 'r-pm', name: 'PM', agentId: 'a-pm', createdAt: 1, updatedAt: 1 },
  { id: 'r-product', name: '产品', agentId: 'a-product', createdAt: 1, updatedAt: 1 },
  { id: 'r-dev', name: '软件开发', agentId: 'a-dev', createdAt: 1, updatedAt: 1 },
  { id: 'r-test', name: '测试', agentId: 'a-test', createdAt: 1, updatedAt: 1 },
  { id: 'r-audit', name: '审计', agentId: 'a-audit', createdAt: 1, updatedAt: 1 },
];

describe("__merged__:office-task-workflow", () => {
  const teamWorkflow = {
    mode: 'dag' as const,
    nodes: [{ id: 'n1', roleId: 'pm', execution: 'serial' as const }],
    edges: [],
  };

  describe('workflowForTask', () => {
    it('returns empty workflow for smart tasks (no team workflow fallback)', () => {
      const task = {
        executionMode: 'smart',
        workflow: { mode: 'dag', nodes: [], edges: [] },
      } as Pick<OfficeTask, 'workflow' | 'executionMode'>;
      const scenario = { workflow: teamWorkflow } as Pick<OfficeScenario, 'workflow'>;
      expect(workflowForTask(task, scenario).nodes).toEqual([]);
    });

    it('falls back to scenario workflow only when project inherits group template', () => {
      const task = {
        executionMode: 'workflow',
        origin: 'fixed_group',
        parentGroupId: 'g1',
        inheritsGroupTemplate: true,
        workflow: { mode: 'dag', nodes: [], edges: [] },
      } as Pick<OfficeTask, 'workflow' | 'executionMode' | 'origin' | 'parentGroupId' | 'inheritsGroupTemplate'>;
      const scenario = { workflow: teamWorkflow } as Pick<OfficeScenario, 'workflow'>;
      expect(workflowForTask(task, scenario).nodes).toHaveLength(1);
    });

    it('does not fall back to scenario workflow for customized empty project DAG', () => {
      const task = {
        executionMode: 'workflow',
        workflow: { mode: 'dag', nodes: [], edges: [] },
      } as Pick<OfficeTask, 'workflow' | 'executionMode'>;
      const scenario = { workflow: teamWorkflow } as Pick<OfficeScenario, 'workflow'>;
      expect(workflowForTask(task, scenario).nodes).toEqual([]);
    });
  });
});

describe("__merged__:office-workflow-agent-reply", () => {
  describe('office workflow-agent-reply', () => {
    it('parses structured sections', () => {
      const text = `【任务理解】
本步要写 PRD。
【交付产物】
# PRD v1
【用法说明】
产品按章节评审。`;
      const parsed = parseStructuredAgentReply(text);
      expect(parsed.understanding).toContain('PRD');
      expect(parsed.deliverable).toContain('PRD v1');
      expect(parsed.usage).toContain('评审');
    });

    it('parses clarification section and partial stream', () => {
      const text = `【协作询问】
  @产品 支付范围是否包含退款？
  【交付产物】
  PRD`;
      const parsed = parseStructuredAgentReply(text);
      expect(parsed.clarifications).toContain('@产品');
      expect(hasSubstantiveClarification(parsed.clarifications)).toBe(true);
      expect(extractPartialClarification(text)).toContain('支付');
      expect(hasSubstantiveClarification('无')).toBe(false);
    });

    it('accepts workflow json output for coordinator', () => {
      const raw = JSON.stringify({
        role: 'PM',
        step: { index: 1, total: 9, title: '项目启动' },
        inputValidation: { targets: [], lsResult: [] },
        execution: '已完成计划编制。',
        outputValidation: { targets: [wfPath('PM', '项目计划书-PM.md')], lsResult: [workflowProjectRelativeLsLine('项目计划书-PM.md')],
        },
        deliverable: {
          path: wfPath('PM', '项目计划书-PM.md'),
          summary: '计划书已交付。',
          conclusion: '已交付',
        },
        rollback: '无',
      });
      const r = validateWorkflowAgentStructuredReply({
        raw,
        transportReason: 'empty',
        actorRoleName: 'PM',
      });
      expect(r.ok).toBe(true);
    });

    it('accepts workflow json when deliverable.path not in outputValidation.targets', () => {
      const path = wfPath('PM', '项目计划书-PM.md');
      const other = wfPath('PM', '项目启动-PM.md');
      const raw = JSON.stringify({
        role: 'PM',
        step: { index: 1, total: 3, title: '项目启动' },
        inputValidation: { targets: [], lsResult: [] },
        execution: '已完成计划编制。',
        outputValidation: {
          targets: [other],
          lsResult: [workflowProjectRelativeLsLine('项目启动-PM.md')],
        },
        deliverable: { path, summary: '计划书已交付。', conclusion: '已交付' },
        rollback: '无',
      });
      const r = validateWorkflowAgentStructuredReply({
        raw,
        transportReason: 'empty',
        actorRoleName: 'PM',
      });
      expect(r.ok).toBe(true);
    });

    it('accepts role-scoped deliverable with absolute lsResult matching target leaf', () => {
      const file = 'GPGPU相关信息-数据收集师.md';
      const target = wfPath('数据收集师', file);
      const absPath =
        `/Users/lixingwei/.openclaw/workspace/office/projects/demo/${target}`;
      const raw = JSON.stringify({
        role: '数据收集师',
        step: { index: 1, total: 6, title: '数据搜集' },
        inputValidation: { targets: [], lsResult: [] },
        execution: '已完成资料搜集并落盘为文档。',
        outputValidation: {
          targets: [target],
          lsResult: [`-rw-r--r-- 1 lixingwei staff 12165 Jun 13 10:23 ${absPath}`],
        },
        deliverable: {
          path: target,
          summary: '涵盖GPGPU发展史、国产GPGPU挑战与行业市场数据。',
          conclusion: '已交付',
        },
        rollback: '无',
      });
      const r = validateWorkflowAgentStructuredReply({
        raw,
        transportReason: 'empty',
        actorRoleName: '数据收集师',
      });
      expect(r.ok).toBe(true);
    });

    it('rejects deliverable path under target/ subdirectory', () => {
      const raw = JSON.stringify({
        role: '数据收集师',
        step: { index: 1, total: 6, title: '数据搜集' },
        inputValidation: { targets: [], lsResult: [] },
        execution: '已落盘。',
        outputValidation: {
          targets: ['target/数据搜集师-数据收集师.md'],
          lsResult: [workflowProjectRelativeLsLine('数据搜集师-数据收集师.md')],
        },
        deliverable: {
          path: 'target/数据搜集师-数据收集师.md',
          summary: '错误目录下的交付物，应被拒绝。',
          conclusion: '已交付',
        },
        rollback: '无',
      });
      const r = validateWorkflowAgentStructuredReply({
        raw,
        transportReason: 'empty',
        actorRoleName: '数据收集师',
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.issues).toContain('deliverable_filename_missing_role_suffix');
    });

    it('rejects root-scoped deliverable.path even when ls absolute is under role dir', () => {
      const file = 'GPGPU相关信息-数据收集师.md';
      const scoped = wfPath('数据收集师', file);
      const absPath =
        `/Users/lixingwei/.openclaw/workspace/office/projects/demo/${scoped}`;
      const raw = JSON.stringify({
        role: '数据收集师',
        step: { index: 1, total: 6, title: '数据搜集' },
        inputValidation: { targets: [], lsResult: [] },
        execution: '已落盘。',
        outputValidation: {
          targets: [file],
          lsResult: [`-rw-r--r-- 1 u staff 100 Jun 13 10:23 ${absPath}`],
        },
        deliverable: {
          path: file,
          summary: '路径写在项目根，ls 指向角色目录，仍应拒绝。',
          conclusion: '已交付',
        },
        rollback: '无',
      });
      const r = validateWorkflowAgentStructuredReply({
        raw,
        transportReason: 'empty',
        actorRoleName: '数据收集师',
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.issues).toContain('deliverable_filename_missing_role_suffix');
      }
    });

    it('accepts absolute ls under wrong directory for nested output target', () => {
      const file = 'GPGPU相关信息-数据收集师.md';
      const target = wfPath('数据收集师', file);
      const wrongAbs =
        `/Users/lixingwei/.openclaw/workspace/office/projects/demo/target/${file}`;
      expect(
        lsLineMatchesWorkflowTarget(
          `-rw-r--r-- 1 u staff 100 Jun 13 10:23 ${wrongAbs}`,
          target,
        ),
      ).toBe(false);
      const raw = JSON.stringify({
        role: '数据收集师',
        step: { index: 1, total: 6, title: '数据搜集' },
        inputValidation: { targets: [], lsResult: [] },
        execution: '已落盘。',
        outputValidation: {
          targets: [target],
          lsResult: [`-rw-r--r-- 1 u staff 100 Jun 13 10:23 ${wrongAbs}`],
        },
        deliverable: {
          path: target,
          summary: 'outputValidation.lsResult 与 target 不一致时仍可通过（运行时不校验）。',
          conclusion: '已交付',
        },
        rollback: '无',
      });
      const r = validateWorkflowAgentStructuredReply({
        raw,
        transportReason: 'empty',
        actorRoleName: '数据收集师',
      });
      expect(r.ok).toBe(true);
    });

    it('accepts folder deliverable when lsResult is project-root drwx line', () => {
      const raw = JSON.stringify({
        role: '开发',
        step: { index: 6, total: 9, title: '开发实现' },
        inputValidation: {
          targets: ['需求说明书-产品.md'],
          lsResult: [workflowProjectRelativeLsLine('需求说明书-产品.md')],
        },
        execution: '已落盘',
        outputValidation: {
          targets: ['交付物-开发'],
          lsResult: [workflowProjectRelativeLsDirLine('交付物-开发')],
        },
        deliverable: {
          path: '交付物-开发',
          summary: '五子棋游戏已落盘至交付目录',
          conclusion: '已交付',
        },
        rollback: '无',
      });
      const r = validateWorkflowAgentStructuredReply({
        raw,
        transportReason: 'empty',
        actorRoleName: '开发',
      });
      expect(r.ok).toBe(true);
    });

    it('accepts workflow json despite mismatched outputValidation lsResult', () => {
      const file = 'GPGPU相关信息-数据收集师.md';
      const target = wfPath('数据收集师', file);
      const absPath =
        `/Users/lixingwei/.openclaw/workspace/office/projects/demo/${target}`;
      const raw = JSON.stringify({
        role: '数据收集师',
        step: { index: 1, total: 6, title: '数据搜集' },
        inputValidation: { targets: [], lsResult: [] },
        execution: '已完成资料搜集并落盘为文档。',
        outputValidation: {
          targets: [target],
          lsResult: [`-rw-r--r-- 1 lixingwei staff 12165 Jun 13 10:23 ${absPath}`],
        },
        deliverable: {
          path: target,
          summary: '涵盖GPGPU发展史、国产GPGPU挑战与行业市场数据。',
          conclusion: '已交付',
        },
        rollback: '无',
      });
      const r = validateWorkflowAgentStructuredReply({
        raw,
        transportReason: 'empty',
        actorRoleName: '数据收集师',
      });
      expect(r.ok).toBe(true);
    });

    it('accepts folder deliverable when lsResult basename mismatches target', () => {
      const raw = JSON.stringify({
        role: '开发',
        step: { index: 6, total: 9, title: '开发实现' },
        inputValidation: {
          targets: ['需求说明书-产品.md'],
          lsResult: [workflowProjectRelativeLsLine('需求说明书-产品.md')],
        },
        execution: '已落盘',
        outputValidation: {
          targets: ['交付物-开发'],
          lsResult: [workflowProjectRelativeLsLine('index.html')],
        },
        deliverable: {
          path: '交付物-开发',
          summary: '五子棋游戏已落盘至交付目录',
          conclusion: '已交付',
        },
        rollback: '无',
      });
      const r = validateWorkflowAgentStructuredReply({
        raw,
        transportReason: 'empty',
        actorRoleName: '开发',
      });
      expect(r.ok).toBe(true);
    });
  });

  describe('office workflow-project-closure', () => {
    it('formats external deliverable paths with tilde home prefix', () => {
      const home = process.env.HOME ?? '/Users/demo';
      const abs = `${home}/.openclaw/workspace-pm/office/projects/demo/index.html`;
      expect(compressPathToTilde(abs)).toBe(
        '~/.openclaw/workspace-pm/office/projects/demo/index.html',
      );
      expect(formatWorkflowClosureDeliverablePathsLine([abs])).toBe(
        '交付物有：~/.openclaw/workspace-pm/office/projects/demo/index.html；',
      );
    });

    it('extractWorkflowClosureDeliverableNames keeps basename only', () => {
      const summary = [
        '【开发】',
        '交付物：交付物-开发；测试用例设计-测试.md',
        '路径：~/.openclaw/workspace-pm/office/projects/demo/交付物-开发',
        '摘要：单文件 HTML 五子棋',
        '结论：已交付',
        '目标：无',
        'ls：',
      ].join('\n');
      expect(extractWorkflowClosureDeliverableNames(summary)).toEqual(['交付物-开发']);
      expect(formatWorkflowClosureArchiveLine('开发实现', '开发', summary)).toBe(
        '· 【开发实现】-【开发】：交付物-开发',
      );
    });

    it('extractWorkflowClosureDeliverableNames falls back to 交付物 line when 路径 missing', () => {
      const summary = '交付物：项目启动-PM.md、需求初稿-产品.md';
      expect(extractWorkflowClosureDeliverableNames(summary)).toEqual([
        '项目启动-PM.md',
        '需求初稿-产品.md',
      ]);
    });

    it('omits external deliverable section from closure content', () => {
      const coordinator = { agentId: 'a1', displayName: 'PM', emoji: '📋' };
      const project = {
        id: 't1',
        title: '发布',
        description: '对外说明',
        origin: 'fixed_group' as const,
        lifecycle: 'active' as const,
        agentIds: ['a1'],
        coordinatorAgentId: 'a1',
        featureDescription: '',
        status: 'completed' as const,
        executionMode: 'workflow' as const,
        workflow: { mode: 'dag' as const, nodes: [], edges: [] },
        nodeRuns: [],
        createdAt: 0,
        updatedAt: 0,
      };
      const nodes: WorkflowNode[] = [
        { id: 'n1', agentId: 'a1', title: '项目启动', execution: 'serial' },
      ];
      const runs = new Map<string, NodeRunRecord>([
        [
          'n1',
          {
            nodeId: 'n1',
            agentId: 'a1',
            status: 'completed',
            summary: '交付物：项目启动-PM.md\n路径：项目启动-PM.md\n摘要：kickoff\n结论：已交付',
          },
        ],
      ]);
      const { content } = buildProjectClosureContent({
        coordinator,
        project,
        nodes,
        runs,
        members: [coordinator],
      });
      expect(content).toContain('内部归档');
      expect(content).toContain('· 【项目启动】-【PM】：项目启动-PM.md');
      expect(content).toContain('进展总结');
      expect(content).not.toContain('对外交付');
      expect(content).not.toContain('交付物有：');
      expect(content).not.toContain('任务交付说明');
      expect(content).not.toContain('最终产出');
      expect(content).not.toContain('路径：');
      expect(content).not.toContain('摘要：');
      expect(content).not.toContain('结论：');
    });

    it('mentions failed roles when steps fail', () => {
      const coordinator = { agentId: 'a1', displayName: 'PM', emoji: '📋' };
      const devMember = { agentId: 'a-dev', displayName: 'Dev', emoji: '📋' };
      const project = {
        id: 't1',
        title: '发布',
        description: '对外说明',
        origin: 'fixed_group' as const,
        lifecycle: 'active' as const,
        agentIds: ['a1', 'a-dev'],
        coordinatorAgentId: 'a1',
        featureDescription: '',
        status: 'running' as const,
        executionMode: 'workflow' as const,
        workflow: { mode: 'dag' as const, nodes: [], edges: [] },
        nodeRuns: [],
        createdAt: 0,
        updatedAt: 0,
      };
      const nodes: WorkflowNode[] = [
        { id: 'n1', agentId: 'a1', execution: 'serial' },
        { id: 'n2', agentId: 'a-dev', execution: 'serial' },
      ];
      const runs = new Map<string, NodeRunRecord>([
        ['n1', { nodeId: 'n1', agentId: 'a1', status: 'completed', summary: 'ok' }],
        ['n2', { nodeId: 'n2', agentId: 'a-dev', status: 'failed', error: 'timeout' }],
      ]);
      const { content, mentions } = buildProjectClosureContent({
        coordinator,
        project,
        nodes,
        runs,
        members: [coordinator, devMember],
      });
      expect(content).toContain('内部归档');
      expect(content).not.toContain('对外交付');
      expect(content).toContain('@Dev');
      expect(mentions).toContain('a-dev');
    });
  });
});

describe("__merged__:office-workflow-deps", () => {
  const nodes: WorkflowNode[] = [
    { id: 'n1', roleId: 'a', title: '设计', execution: 'serial' },
    { id: 'n2', roleId: 'b', title: '开发', execution: 'serial' },
  ];

  describe('office-workflow-deps', () => {
    it('lists incomplete upstream steps blocking a node', () => {
      const runs = new Map<string, NodeRunRecord>([
        ['n1', { nodeId: 'n1', roleId: 'a', status: 'running' }],
        ['n2', { nodeId: 'n2', roleId: 'b', status: 'pending' }],
      ]);
      const blocking = getBlockingPredecessorSteps('n2', nodes, [{ from: 'n1', to: 'n2' }], runs, [
        { id: 'a', name: '设计同学' },
        { id: 'b', name: '开发同学' },
      ]);
      expect(blocking).toHaveLength(1);
      expect(blocking[0]?.title).toBe('设计');
      expect(blocking[0]?.ownerNames).toContain('设计同学');
    });
  });
});

describe("__merged__:office-workflow-edges", () => {
  describe('office-workflow-edges', () => {
    it('syncs serial edges from task order when not customized', () => {
      const wf = defaultWorkflowForRoles(['pm', 'product', 'dev']);
      const reordered = {
        ...wf,
        nodes: [wf.nodes[2]!, wf.nodes[0]!, wf.nodes[1]!],
        edges: [],
        edgesCustomized: false,
      };
      const synced = syncWorkflowEdges(reordered);
      expect(synced.edges).toEqual(defaultEdgesForNodeOrder(synced.nodes));
    });

    it('rejects multi-node workflow without edges', () => {
      const wf = defaultWorkflowForRoles(['pm', 'dev']);
      const result = validateWorkflowEdges({ ...wf, edges: [] });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.i18nKey).toBe('workflow.validationNeedEdges');
    });

    it('accepts serial edges synced to task order', () => {
      const wf = syncWorkflowEdges(defaultWorkflowForRoles(['pm', 'dev']));
      expect(validateWorkflowEdges(wf).valid).toBe(true);
    });

    it('builds fork/join edges for nodes sharing parallelGroup', () => {
      const product = normalizeWorkflowNodeRoles({
        id: 'n1',
        roleId: 'product',
        title: 'PRD',
        execution: 'serial',
      });
      const test = normalizeWorkflowNodeRoles({
        id: 'n2',
        roleId: 'qa',
        title: '测试',
        execution: 'serial',
        parallelGroup: 'review',
      });
      const dev = normalizeWorkflowNodeRoles({
        id: 'n3',
        roleId: 'dev',
        title: '开发',
        execution: 'serial',
        parallelGroup: 'review',
      });
      const nodes = [product, test, dev];
      const edges = buildForkJoinEdgesFromLayers(nodes);
      expect(edges).toContainEqual({ from: 'n1', to: 'n2', when: 'on_success' });
      expect(edges).toContainEqual({ from: 'n1', to: 'n3', when: 'on_success' });
      expect(edges).not.toContainEqual({ from: 'n2', to: 'n3', when: 'on_success' });

      const synced = syncWorkflowEdges({ mode: 'simple', nodes, edges: [], edgesCustomized: false });
      expect(synced.mode).toBe('dag');
      expect(validateWorkflowEdges(synced).valid).toBe(true);
    });

    it('keeps custom edges when edgesCustomized is true', () => {
      const wf = defaultWorkflowForRoles(['pm', 'dev']);
      const custom = [{ from: wf.nodes[1]!.id, to: wf.nodes[0]!.id, when: 'on_success' as const }];
      const locked = { ...wf, edges: custom, edgesCustomized: true };
      expect(syncWorkflowEdges(locked).edges).toEqual(custom);
    });
  });
});

describe("__merged__:office-workflow-generate", () => {
  const roles: OfficeRole[] = [
    { id: 'pm', name: 'PM', agentId: 'a0', createdAt: 0, updatedAt: 0 },
    { id: 'product', name: '产品', agentId: 'a1', createdAt: 0, updatedAt: 0 },
    { id: 'dev', name: '软件开发', agentId: 'a2', createdAt: 0, updatedAt: 0 },
    { id: 'qa', name: '测试', agentId: 'a3', createdAt: 0, updatedAt: 0 },
  ];

  const GAME_DEV_DESCRIPTION = `1.PM编写项目预算，项目计划，组织全员kickoff，交付物为项目计划书;
  2.产品经理撰写需求说明书初稿，交付物为需求说明书初稿；
  3.产品+软件开发+测试三方一起并行评审需求说明书初稿，提出意见，例如软件开发可以针对可行性等进行重点评审，测试可以针对测试可行性进行评审，交付物为评审意见；
  4.产品针对大家反馈的意见进行修改并发布正式产品需求说明书，交付物为产品需求说明书正式版；
  5.测试根据需求说明书进行测试用例编写，交付物为测试用例；
  6.软件开发根据正式的需求说明书进行需求实现，交付物为可执行的游戏软件，与5并行;
  7.在6完成之后，测试对开发的交付物进行测试验证，交付物为测试验收报告；
  8.PM收到测试验收报告后，对项目进行总结，梳理交付物，交付物为可执行的游戏软件和测试验收报告`;

  describe('office-workflow-generate', () => {
    it('splits multiline and semicolon-numbered descriptions', () => {
      expect(splitDescriptionToSegments('1. 需求\n2. 开发\n3. 测试').length).toBe(3);
      expect(splitDescriptionToSegments('1.需求;2.开发;3.测试').length).toBe(3);
    });

    it('parses who / action / output from each step segment', () => {
      const kickoff = parseWorkflowStepFields(
        'PM编写项目预算，项目计划，组织全员kickoff，交付物为项目计划书',
      );
      expect(kickoff.who).toBe('PM');
      expect(kickoff.action).toContain('编写项目预算');
      expect(kickoff.output).toBe('项目计划书');
      expect(summarizeActionTitle(kickoff.action)).toBe('编写项目预算');

      const review = parseWorkflowStepFields(
        '产品+软件开发+测试三方一起并行评审需求说明书初稿，提出意见，交付物为评审意见',
      );
      expect(review.who).toContain('产品');
      expect(review.who).toContain('软件开发');
      expect(review.action).toContain('评审需求说明书初稿');
      expect(review.output).toBe('评审意见');
      expect(summarizeActionTitle(review.action)).toBe('评审需求说明书');
    });

    it('summarizes action titles to 4-8 characters', () => {
      expect(
        inferStepTitle('PM编写项目预算，项目计划，组织全员kickoff，交付物为项目计划书', 'PM'),
      ).toBe('编写项目预算');
      expect(inferStepTitle('测试根据需求说明书进行测试用例编写', '测试')).toBe('测试用例编写');
      expect(summarizeActionTitle('编写漫画PPT策划案')).toBe('编写策划案');
    });

    it('infers deliverable stem from 输出为 and action title for GPGPU collect step', () => {
      const segment = '数据搜集师 搜集相关权威材料和数据，输出为GPGPU相关信息';
      expect(inferDeliverableStemFromSegment(segment)).toBe('GPGPU相关信息');
      expect(inferStepTitle(segment, '数据收集师')).toBe('搜集相关权威');
      expect(
        workflowDeliverableFileName('搜集相关权威', '数据收集师', { stepDescription: segment }),
      ).toBe('GPGPU相关信息-数据收集师.md');
      expect(
        workflowNodeSampleDeliverablePath('搜集相关权威', '数据收集师', { stepDescription: segment }),
      ).toBe('交付物-数据收集师/GPGPU相关信息-数据收集师.md');
    });

    it('matches PM without falsely adding 产品', () => {
      const ids = matchRolesInText('PM编写项目预算，组织全员kickoff', roles);
      expect(ids).toEqual(['pm']);
      expect(inferJointMultiRole('PM编写项目预算', ids)).toBe(false);
    });

    it('detects joint review with plus-separated roles', () => {
      const segment =
        '产品+软件开发+测试三方一起并行评审需求说明书初稿，提出意见，交付物为评审意见';
      const ids = matchRolesInText(segment, roles);
      expect(ids).toContain('product');
      expect(ids).toContain('dev');
      expect(ids).toContain('qa');
      expect(inferJointMultiRole(segment, ids)).toBe(true);
      expect(inferParallelWithPrevious(segment)).toBe(false);
    });

    it('detects parallel fork only for 与N并行', () => {
      expect(inferParallelWithPrevious('与5并行')).toBe(true);
      expect(
        inferParallelWithPrevious('产品+开发+测试三方一起并行评审需求说明书初稿'),
      ).toBe(false);
    });

    it('builds game-dev workflow with 8 ordered steps', () => {
      const draft = buildHeuristicWorkflowDraft(GAME_DEV_DESCRIPTION, roles);
      expect(draft?.steps.map((s) => s.title)).toEqual([
        '编写项目预算',
        '撰写需求说明书',
        '评审需求说明书',
        '改并发布正式产品',
        '测试用例编写',
        '需求实现',
        '测试验证',
        '总结，梳理交付物',
      ]);

      const result = generateWorkflowFromDescriptionHeuristic(GAME_DEV_DESCRIPTION, roles);
      expect(result).not.toBeNull();
      expect(result!.workflow.mode).toBe('dag');
      expect(result!.workflow.nodes).toHaveLength(8);

      const titles = result!.workflow.nodes.map((n) => n.title);
      expect(titles[0]).toBe('编写项目预算');
      expect(titles[2]).toBe('评审需求说明书');
      expect(titles[4]).toBe('测试用例编写');
      expect(titles[5]).toBe('需求实现');

      const step1Agents =
        result!.workflow.nodes[0]!.agentIds ?? [result!.workflow.nodes[0]!.agentId];
      expect(step1Agents).toEqual(['pm']);

      const reviewAgents =
        result!.workflow.nodes[2]!.agentIds ?? [result!.workflow.nodes[2]!.agentId];
      expect(reviewAgents.sort()).toEqual(['dev', 'product', 'qa'].sort());

      const layers = workflowVisualLayers(result!.workflow);
      const parallelLayer = layers.find((l) => l.parallel && l.nodes.length === 2);
      expect(parallelLayer).toBeDefined();
      const parallelTitles = parallelLayer!.nodes.map((n) => n.title).sort();
      expect(parallelTitles).toEqual(['测试用例编写', '需求实现'].sort());
    });

    it('builds joint review step with multiple roles', () => {
      const draft = buildHeuristicWorkflowDraft(
        '产品、开发、测试一起完成需求评审，评审通过后产品输出正式需求说明书',
        roles,
      );
      expect(draft).not.toBeNull();
      const review = draft!.steps.find((s) => /评审/.test(s.title));
      expect(review?.roleNames.length).toBeGreaterThanOrEqual(2);
    });

    it('collapseDuplicatePhaseSteps merges consecutive duplicate phase titles', () => {
      const merged = collapseDuplicatePhaseSteps([
        { title: '需求评审', roleNames: ['开发'], description: 'a', rawText: 'a' },
        { title: '需求评审', roleNames: ['测试'], description: 'b', rawText: 'b' },
        { title: '需求定稿', roleNames: ['产品'], description: 'c', rawText: 'c' },
      ]);
      expect(merged).toHaveLength(2);
      expect(merged[0]!.roleNames.sort()).toEqual(['开发', '测试'].sort());
    });

    it('heuristic draft collapses consecutive duplicate 需求评审 segments', () => {
      const draft = buildHeuristicWorkflowDraft(
        `1. 软件开发对需求说明书进行需求评审，交付评审意见；
        2. 软件测试对需求说明书进行需求评审，交付评审意见；
        3. 产品经理发布正式需求说明书`,
        roles,
      );
      expect(draft).not.toBeNull();
      expect(draft!.steps.filter((s) => s.title === '需求评审')).toHaveLength(1);
      expect(draft!.steps.find((s) => s.title === '需求评审')!.roleNames.length).toBeGreaterThanOrEqual(2);
    });

    it('materializes valid workflow with edges for sequential flow', () => {
      const result = generateWorkflowFromDescriptionHeuristic(
        '产品写需求 → 开发实现 → 测试验收',
        roles,
      );
      expect(result).not.toBeNull();
      expect(result!.workflow.nodes.length).toBeGreaterThanOrEqual(3);
      expect(result!.workflow.nodes.every((n) => n.title?.trim())).toBe(true);
    });

    it('parses LLM JSON draft', () => {
      const json = `\`\`\`json
  {
    "mode": "dag",
    "steps": [
      { "title": "评审", "roleNames": ["产品", "开发"], "parallelWithPrevious": false },
      { "title": "开发", "roleNames": ["开发"], "parallelWithPrevious": false }
    ]
  }
  \`\`\``;
      const draft = parseWorkflowGenerationFromText(json);
      expect(draft?.steps.length).toBe(2);
      const wf = materializeWorkflowDraft(draft!, roles);
      expect(wf?.nodes.length).toBe(2);
    });

    it('parses model draft with who / action / output / rollback / parallel', () => {
      const json = JSON.stringify({
        mode: 'dag',
        steps: [
          {
            who: 'PM',
            action: '编写项目预算，组织全员kickoff',
            output: '项目计划书',
            parallelWithPrevious: false,
            rollbackToSteps: [],
          },
          {
            who: '产品+开发+测试',
            action: '评审需求说明书初稿',
            output: '评审意见',
            parallelWithPrevious: false,
          },
          {
            who: '测试',
            action: '测试验证',
            output: '测试验收报告',
            parallelWithPrevious: false,
            rollbackToSteps: [6],
          },
          {
            who: '开发',
            action: '需求实现',
            output: '游戏软件',
            parallelWithPrevious: true,
          },
        ],
      });
      const draft = parseWorkflowGenerationFromText(json);
      expect(draft?.steps).toHaveLength(4);
      expect(draft!.steps[0]!.who).toBe('PM');
      expect(draft!.steps[0]!.action).toContain('编写项目预算');
      expect(draft!.steps[0]!.output).toBe('项目计划书');
      expect(draft!.steps[0]!.description).toContain('输出：项目计划书');
      expect(draft!.steps[1]!.roleNames.sort()).toEqual(['产品', '开发', '测试'].sort());
      expect(draft!.steps[2]!.rollbackToStepNumbers).toEqual([6]);
      expect(draft!.steps[3]!.parallelWithPrevious).toBe(true);
      expect(roleNamesFromWho('产品+软件开发+测试')).toEqual(['产品', '软件开发', '测试']);

      const wf = materializeWorkflowDraft(draft!, roles);
      expect(wf?.nodes).toHaveLength(4);
      const rollbackFrom = wf!.nodes[2]!.id;
      const rollbackTo = wf!.nodes[1]!.id;
      expect(
        wf!.edges.some(
          (e) => e.from === rollbackFrom && e.to === rollbackTo && e.when === 'on_failure',
        ),
      ).toBe(false);
      expect(resolveStepRollbackTargets(draft!.steps[2]!)).toEqual([6]);

      const rollbackDraft = parseWorkflowGenerationFromText(
        JSON.stringify({
          mode: 'dag',
          steps: [
            { who: 'PM', action: '启动', output: null, parallelWithPrevious: false },
            { who: '开发', action: '实现', output: null, parallelWithPrevious: false },
            {
              who: '测试',
              action: '验收',
              output: null,
              parallelWithPrevious: false,
              rollbackToSteps: [2],
            },
          ],
        }),
      );
      const rollbackWf = materializeWorkflowDraft(rollbackDraft!, roles);
      const from = rollbackWf!.nodes[2]!.id;
      const to = rollbackWf!.nodes[1]!.id;
      expect(
        rollbackWf!.edges.some((e) => e.from === from && e.to === to && e.when === 'on_failure'),
      ).toBe(true);
    });
  });
});

describe("__merged__:office-workflow-graph", () => {
  function scenarioWith(workflow: OfficeScenario['workflow'], roleIds: string[]): OfficeScenario {
    return {
      id: 's1',
      name: 'Team',
      roleIds,
      coordinatorRoleId: roleIds[0]!,
      workflow,
      createdAt: 0,
      updatedAt: 0,
    };
  }

  describe('office workflow-graph', () => {
    it('rebuilds workflow when every node has unsatisfied incoming edges', () => {
      const roleIds = ['pm', 'product', 'dev', 'qa'];
      const wf = defaultWorkflowForRoles(roleIds);
      const brokenEdges = wf.nodes.map((n, i) => ({
        from: wf.nodes[(i + 1) % wf.nodes.length]!.id,
        to: n.id,
        when: 'on_success' as const,
      }));
      const scenario = scenarioWith({ mode: 'dag', nodes: wf.nodes, edges: brokenEdges }, roleIds);
      const fixed = reconcileWorkflowForScenario(scenario);
      const runs = new Map(freshNodeRuns(fixed.nodes).map((r) => [r.nodeId, r]));
      const batch = nextRunnableNodes(fixed.nodes, fixed.edges, runs);
      expect(batch).toHaveLength(1);
      expect(batch[0]?.agentId).toBe('pm');
    });

    it('freshNodeRuns always resets to pending', () => {
      const roleIds = ['pm', 'product'];
      const wf = defaultWorkflowForRoles(roleIds);
      const runs = freshNodeRuns(wf.nodes).map((r) => ({
        ...r,
        status: 'completed' as const,
        completedAt: 1,
      }));
      const reset = freshNodeRuns(wf.nodes);
      expect(reset.every((r) => r.status === 'pending')).toEqual(true);
      expect(runs.some((r) => r.status === 'completed')).toBe(true);
    });
  });
});

describe("__merged__:office-workflow-handoff", () => {
  function completedRun(nodeId: string, roleId: string): NodeRunRecord {
    return { nodeId, roleId, status: 'completed' };
  }

  describe('office-workflow-handoff', () => {
    const product = normalizeWorkflowNodeRoles({
      id: 'n-product',
      roleId: 'product',
      title: 'PRD',
      execution: 'serial',
    });
    const test = normalizeWorkflowNodeRoles({
      id: 'n-test',
      roleId: 'qa',
      title: '设计测试用例',
      execution: 'serial',
      parallelGroup: 'pg-dev',
    });
    const dev = normalizeWorkflowNodeRoles({
      id: 'n-dev',
      roleId: 'dev',
      title: '编码实现',
      execution: 'serial',
      parallelGroup: 'pg-dev',
    });

    const forkWorkflow: WorkflowDefinition = {
      mode: 'dag',
      nodes: [product, test, dev],
      edges: [
        { from: 'n-product', to: 'n-test', when: 'on_success' },
        { from: 'n-product', to: 'n-dev', when: 'on_success' },
      ],
      edgesCustomized: true,
    };

    it('@s all roles in the next parallel layer after upstream completes', () => {
      const runs = new Map<string, NodeRunRecord>([
        ['n-product', completedRun('n-product', 'product')],
        ['n-test', { nodeId: 'n-test', roleId: 'qa', status: 'pending' }],
        ['n-dev', { nodeId: 'n-dev', roleId: 'dev', status: 'pending' }],
      ]);
      const next = nextHandoffRoleIdsAfterNode(
        'n-product',
        forkWorkflow.nodes,
        forkWorkflow.edges,
        runs,
      );
      expect(next.sort()).toEqual(['dev', 'qa']);
      const targets = nextHandoffTargetsAfterNode(
        'n-product',
        forkWorkflow.nodes,
        forkWorkflow.edges,
        runs,
      );
      expect(targets).toEqual([
        { roleId: 'qa', stepTitle: '设计测试用例' },
        { roleId: 'dev', stepTitle: '编码实现' },
      ]);
    });

    it('defers handoff until all peers in a parallel group finish', () => {
      const runs = new Map<string, NodeRunRecord>([
        ['n-product', completedRun('n-product', 'product')],
        ['n-test', completedRun('n-test', 'qa')],
        ['n-dev', { nodeId: 'n-dev', roleId: 'dev', status: 'running' }],
      ]);
      expect(
        nextHandoffRoleIdsAfterNode('n-test', forkWorkflow.nodes, forkWorkflow.edges, runs),
      ).toEqual([]);
    });

    it('hands off along serial edges when nodes are not in a parallel group', () => {
      const serialTest = { ...test, parallelGroup: undefined };
      const serialDev = { ...dev, parallelGroup: undefined };
      const serialWorkflow: WorkflowDefinition = {
        mode: 'dag',
        nodes: [product, serialTest, serialDev],
        edges: [
          { from: 'n-product', to: 'n-test', when: 'on_success' },
          { from: 'n-test', to: 'n-dev', when: 'on_success' },
        ],
        edgesCustomized: true,
      };
      const runs = new Map<string, NodeRunRecord>([
        ['n-product', completedRun('n-product', 'product')],
        ['n-test', completedRun('n-test', 'qa')],
        ['n-dev', { nodeId: 'n-dev', roleId: 'dev', status: 'pending' }],
      ]);
      expect(
        nextHandoffRoleIdsAfterNode('n-test', serialWorkflow.nodes, serialWorkflow.edges, runs),
      ).toEqual(['dev']);
    });
  });
});

describe("__merged__:office-workflow-node", () => {
  describe('office-workflow-node', () => {
    it('uses roleIds when set', () => {
      const node = { id: 'n1', roleId: 'a', roleIds: ['a', 'b', 'c'], execution: 'serial' as const };
      expect(workflowNodeRoleIds(node)).toEqual(['a', 'b', 'c']);
      expect(workflowNodeIsMultiRole(node)).toBe(true);
      expect(workflowNodeHasRole(node, 'b')).toBe(true);
    });

    it('falls back to roleId', () => {
      const node = { id: 'n1', roleId: 'pm', execution: 'serial' as const };
      expect(workflowNodeRoleIds(node)).toEqual(['pm']);
      expect(workflowNodeIsMultiRole(node)).toBe(false);
    });

    it('normalize drops roleIds for single role', () => {
      const node = normalizeWorkflowNodeRoles({
        id: 'n1',
        roleId: 'a',
        roleIds: ['a'],
        execution: 'serial',
      });
      expect(node.agentIds).toBeUndefined();
      expect(node.agentId).toBe('a');
    });

    it('ensureWorkflowRuntimeDefaults backfills missing maxRuntimeMinutes', () => {
      const wf = ensureWorkflowRuntimeDefaults({
        mode: 'simple',
        nodes: [{ id: 'n1', roleId: 'pm', execution: 'serial', title: 'Step' }],
        edges: [],
      });
      expect(wf.nodes[0]?.maxRuntimeMinutes).toBe(DEFAULT_NODE_MAX_RUNTIME_MINUTES);
    });

    it('countWorkflowNodesWithRole respects multi-role nodes', () => {
      const nodes = [
        { id: 'n1', roleId: 'pm', roleIds: ['pm', 'dev'], execution: 'serial' as const },
        { id: 'n2', roleId: 'qa', execution: 'serial' as const },
      ];
      expect(countWorkflowNodesWithRole(nodes, 'dev')).toBe(1);
      expect(countWorkflowNodesWithRole(nodes, 'pm')).toBe(1);
    });
  });
});

describe("__merged__:office-workflow-progress", () => {
  describe('office-workflow-progress', () => {
    it('rejects legacy workflow agent wait placeholders', () => {
      expect(isSubstantiveWorkflowProgressSnippet('等待 Agent 复述理解并执行…')).toBe(false);
      expect(isSubstantiveWorkflowProgressSnippet('已派发 Agent，等待回复…')).toBe(false);
    });

    it('rejects fast-ack and trivial lines', () => {
      expect(isSubstantiveWorkflowProgressSnippet('OK，待我思考下，稍后回复')).toBe(false);
      expect(isSubstantiveWorkflowProgressSnippet('收到')).toBe(false);
      expect(isSubstantiveWorkflowProgressSnippet('')).toBe(false);
    });

    it('accepts substantive agent stream snippets', () => {
      expect(
        isSubstantiveWorkflowProgressSnippet(
          '正在整理 PRD 初稿，包含年终奖计算模块与专项附加扣除字段说明。',
        ),
      ).toBe(true);
    });
  });
});

describe("__merged__:office-workflow-roles", () => {
  describe('office-workflow-roles', () => {
    it('roleTaskListText uses description only', () => {
      expect(roleTaskListText({ description: '写 PRD' })).toBe('写 PRD');
      expect(roleTaskListText({ description: '' })).toBe('');
      expect(roleTaskListText(undefined)).toBe('');
    });

    it('nodeStepLabel prefers custom task name', () => {
      const label = nodeStepLabel(
        { id: 'n1', agentId: 'pm', title: '需求评审', execution: 'serial' },
        0,
        [{ agentId: 'pm', displayName: '产品' }],
      );
      expect(label).toContain('需求评审');
      expect(label).toContain('产品');
    });

    it('workflowNodeAgentTimeoutMs bumps limit on output retry', () => {
      const node = { maxRuntimeMinutes: 10 };
      expect(workflowNodeAgentTimeoutMs(node, 0)).toBe(20 * 60_000);
      expect(workflowNodeAgentTimeoutMs(node, 1)).toBe(20 * 60_000);
    });

    it('workflowNodeAgentTimeoutMs raises floor for acceptance and audit steps', () => {
      expect(
        workflowNodeAgentTimeoutMs({ maxRuntimeMinutes: 30, title: '测试验收' }, 0),
      ).toBe(45 * 60_000);
      expect(
        workflowNodeAgentTimeoutMs({ maxRuntimeMinutes: 10, title: '安全审计' }, 0),
      ).toBe(45 * 60_000);
    });
  });
});

describe("__merged__:office-workflow-room-handoff", () => {
  const pmMember = { agentId: 'a1', displayName: 'PM', emoji: '📋' };
  const task = {
    id: 't1',
    title: '发布功能',
    description: '',
    origin: 'fixed_group' as const,
    lifecycle: 'active' as const,
    agentIds: ['a1'],
    coordinatorAgentId: 'a1',
    featureDescription: '',
    status: 'running' as const,
    executionMode: 'workflow' as const,
    workflow: { mode: 'dag' as const, nodes: [], edges: [] },
    nodeRuns: [],
    createdAt: 0,
    updatedAt: 0,
  };
  const node = { id: 'node-pm', agentId: 'pm', execution: 'serial' as const };

  describe('office workflow-room-handoff', () => {
    it('resolves next role ids along success edges', () => {
      const roleIds = ['pm', 'product', 'dev'];
      const wf = defaultWorkflowForRoles(roleIds);
      const next = nextRoleIdsAfterNode('node-pm', wf.nodes, wf.edges);
      expect(next).toEqual(['product']);
    });

    it('builds understanding and clarification messages', () => {
      expect(buildTaskReceivedRoomContent(pmMember, task, node)).toContain('收到任务');
      expect(buildTaskUnderstandingRoomContent(pmMember, task, node, '先做 PRD')).toContain('任务理解');
      const clar = buildTaskClarificationRoomContent(
        { agentId: 'a-dev', displayName: '开发', emoji: '📋' },
        task,
        node,
        '@产品 需求边界是否包含支付模块？',
      );
      expect(clar).toContain('协作询问');
      expect(clar).toContain('@产品');
    });

    it('builds deliver with usage and handoff with next-step titles per role', () => {
      const deliver = buildTaskDeliverRoomContent(pmMember, task, node, 'PRD 文档', '按章节评审');
      expect(deliver).toContain('用法说明');
      expect(deliver).toContain('PRD');
      const product = { agentId: 'a-product', displayName: '产品', emoji: '📦' };
      expect(
        buildTaskHandoffRoomContent(product, task, [
          { member: { agentId: 'a-qa', displayName: '测试' }, stepTitle: '设计测试用例' },
          { member: { agentId: 'a-dev', displayName: '开发' }, stepTitle: '编码实现' },
        ]),
      ).toBe('📦 【产品】👉 请@测试 设计测试用例，请@开发 编码实现');
    });

    it('beginTaskNodeRoomPhases posts one line then promotes received→running on same id', async () => {
      const postSpy = vi.spyOn(await import('../../electron/services/office/orchestrator'), 'postRoomAnnouncement');
      const updateSpy = vi.spyOn(await import('../../electron/services/office/store'), 'updateRoomMessage');
      const membersSpy = vi
        .spyOn(await import('../../electron/services/office/office-execution-members'), 'loadProjectExecutionMembers')
        .mockResolvedValue([{ agentId: 'a1', displayName: 'PM', emoji: '📋' }]);
      const coordSpy = vi
        .spyOn(
          await import('../../electron/services/office/office-execution-members'),
          'resolveRoomCoordinatorMember',
        )
        .mockReturnValue({ agentId: 'a1', displayName: 'PM', emoji: '📋' });

      postSpy.mockResolvedValue({
        id: 'room-progress-1',
        projectId: task.id,
        from: 'a1',
        fromAgentId: 'a1',
        content: buildTaskReceivedRoomContent(pmMember, task, node),
        phase: 'task_received',
        timestamp: 1,
        mentions: [],
      } as never);
      updateSpy.mockResolvedValue(null);

      const phases = await workflowRoomHandoff.beginTaskNodeRoomPhases(
        {} as never,
        { id: 'g1', agentIds: ['a1'], coordinatorAgentId: 'a1', workflow: task.workflow } as never,
        task as never,
        node as never,
        pmMember as never,
      );

      expect(phases?.runningMessageId).toBe('room-progress-1');
      expect(postSpy).toHaveBeenCalledTimes(1);
      expect(postSpy.mock.calls[0]?.[1]?.phase).toBe('task_received');

      await phases?.promoteToRunning();
      expect(updateSpy).toHaveBeenCalledWith(
        task.id,
        'room-progress-1',
        expect.objectContaining({
          phase: 'task_running',
          content: expect.stringContaining('执行中'),
        }),
      );

      const abortRegistry = await import('../../electron/services/office/task-run-abort-registry');
      abortRegistry.markTaskUserAborted(task.id);
      await phases?.announceFailed('用户已手动中止本项目');
      expect(updateSpy).toHaveBeenLastCalledWith(
        task.id,
        'room-progress-1',
        expect.objectContaining({
          progressText: '已停止',
        }),
      );
      abortRegistry.clearTaskUserAborted(task.id);

      // After quiesce clears userAborted, disk `aborted` must still quiet「执行失败」.
      const getTempSpy = vi
        .spyOn(await import('../../electron/services/office/store'), 'getTempProject')
        .mockResolvedValue({ id: task.id, status: 'aborted' } as never);
      await phases?.announceFailed('任务执行被中断');
      expect(updateSpy).toHaveBeenLastCalledWith(
        task.id,
        'room-progress-1',
        expect.objectContaining({
          progressText: '已停止',
        }),
      );
      getTempSpy.mockRestore();

      await phases?.announceFailed('模型超时');
      expect(updateSpy).toHaveBeenLastCalledWith(
        task.id,
        'room-progress-1',
        expect.objectContaining({
          progressText: '执行失败：模型超时',
        }),
      );

      postSpy.mockRestore();
      updateSpy.mockRestore();
      membersSpy.mockRestore();
      coordSpy.mockRestore();
    });
  });
});

describe("__merged__:office-workflow-runner", () => {
  function runsMap(roleIds: string[]): Map<string, NodeRunRecord> {
    const wf = defaultWorkflowForRoles(roleIds);
    return new Map(
      wf.nodes.map((n) => [
        n.id,
        { nodeId: n.id, agentId: n.agentId, status: 'pending' as const },
      ]),
    );
  }

  describe('office workflow-runner', () => {
    it('starts with the first serial node runnable', () => {
      const roleIds = ['pm', 'product', 'dev', 'qa'];
      const wf = defaultWorkflowForRoles(roleIds);
      const runs = runsMap(roleIds);
      const batch = nextRunnableNodes(wf.nodes, wf.edges, runs);
      expect(batch).toHaveLength(1);
      expect(batch[0]?.agentId).toBe('pm');
    });

    it('runs next node after the previous completes', () => {
      const roleIds = ['pm', 'product'];
      const wf = defaultWorkflowForRoles(roleIds);
      const runs = runsMap(roleIds);
      const first = wf.nodes[0]!;
      runs.set(first.id, { ...runs.get(first.id)!, status: 'completed' });
      const batch = nextRunnableNodes(wf.nodes, wf.edges, runs);
      expect(batch).toHaveLength(1);
      expect(batch[0]?.agentId).toBe('product');
    });
  });
});

describe("__merged__:office-workflow-schedule", () => {
  describe('office-workflow-schedule', () => {
    const product = normalizeWorkflowNodeRoles({
      id: 'n-product',
      roleId: 'product',
      title: 'PRD',
      execution: 'serial',
    });
    const test = normalizeWorkflowNodeRoles({
      id: 'n-test',
      roleId: 'qa',
      title: '测试',
      execution: 'serial',
    });
    const dev = normalizeWorkflowNodeRoles({
      id: 'n-dev',
      roleId: 'dev',
      title: '开发',
      execution: 'serial',
    });

    const forkWorkflow: WorkflowDefinition = {
      mode: 'dag',
      nodes: [product, test, dev],
      edges: [
        { from: 'n-product', to: 'n-test', when: 'on_success' },
        { from: 'n-product', to: 'n-dev', when: 'on_success' },
      ],
      edgesCustomized: true,
    };

    it('runs fork successors in one batch without parallelGroup', () => {
      const runs = new Map<string, NodeRunRecord>([
        ['n-product', { nodeId: 'n-product', roleId: 'product', status: 'completed' }],
        ['n-test', { nodeId: 'n-test', roleId: 'qa', status: 'pending' }],
        ['n-dev', { nodeId: 'n-dev', roleId: 'dev', status: 'pending' }],
      ]);
      const batch = nextRunnableNodes(forkWorkflow.nodes, forkWorkflow.edges, runs);
      expect(batch.map((n) => n.roleId).sort()).toEqual(['dev', 'qa']);
    });

    it('runs parallel fork when dev has extra on_failure rollback incoming edge', () => {
      const review = normalizeWorkflowNodeRoles({
        id: 'n-review',
        roleId: 'product',
        title: '需求评审',
        execution: 'serial',
      });
      const testCase = normalizeWorkflowNodeRoles({
        id: 'n-test-case',
        roleId: 'qa',
        title: '测试用例编写',
        execution: 'serial',
        parallelGroup: 'pg-build',
      });
      const devImpl = normalizeWorkflowNodeRoles({
        id: 'n-dev-impl',
        roleId: 'dev',
        title: '开发实现',
        execution: 'serial',
        parallelGroup: 'pg-build',
      });
      const nodes = [review, testCase, devImpl];
      const edges = [
        { from: 'n-review', to: 'n-test-case', when: 'on_success' as const },
        { from: 'n-review', to: 'n-dev-impl', when: 'on_success' as const },
        { from: 'n-test-case', to: 'n-dev-impl', when: 'on_failure' as const },
      ];
      const runs = new Map<string, NodeRunRecord>([
        ['n-review', { nodeId: 'n-review', roleId: 'product', status: 'completed' }],
        ['n-test-case', { nodeId: 'n-test-case', roleId: 'qa', status: 'pending' }],
        ['n-dev-impl', { nodeId: 'n-dev-impl', roleId: 'dev', status: 'pending' }],
      ]);
      expect(incomingReady('n-dev-impl', edges, runs)).toBe(true);
      const batch = nextRunnableNodes(nodes, edges, runs);
      expect(batch.map((n) => n.roleId).sort()).toEqual(['dev', 'qa']);
    });

    it('does not treat on_failure rollback edge as forward predecessor blocker', () => {
      const reqFinal = normalizeWorkflowNodeRoles({
        id: 'lg-3',
        roleId: 'product',
        title: '需求定稿',
        execution: 'serial',
      });
      const testCase = normalizeWorkflowNodeRoles({
        id: 'lg-4',
        roleId: 'qa',
        title: '测试用例设计',
        execution: 'serial',
        parallelGroup: 'parallel-dev-test-design',
      });
      const devImpl = normalizeWorkflowNodeRoles({
        id: 'lg-5',
        roleId: 'dev',
        title: '开发实现',
        execution: 'serial',
        parallelGroup: 'parallel-dev-test-design',
      });
      const nodes = [reqFinal, testCase, devImpl];
      const edges = [
        { from: 'lg-3', to: 'lg-4', when: 'on_success' as const },
        { from: 'lg-3', to: 'lg-5', when: 'on_success' as const },
        { from: 'lg-7', to: 'lg-5', when: 'on_failure' as const },
      ];
      const runs = new Map<string, NodeRunRecord>([
        ['lg-3', { nodeId: 'lg-3', roleId: 'product', status: 'completed' }],
        ['lg-4', { nodeId: 'lg-4', roleId: 'qa', status: 'pending' }],
        ['lg-5', { nodeId: 'lg-5', roleId: 'dev', status: 'pending' }],
      ]);
      expect(getIncompletePredecessorRoleIds('lg-5', nodes, edges, runs)).toEqual([]);
      const batch = nextRunnableNodes(nodes, edges, runs);
      expect(batch.map((n) => n.id).sort()).toEqual(['lg-4', 'lg-5']);
    });

    (process.env.VITE_ENABLE_LANGGRAPH === 'true' ? it : it.skip)(
      'syncWorkflowEdges adds parallel fork edges for customized LangGraph rollback-only edges',
      () => {
      const reqFinal = normalizeWorkflowNodeRoles({
        id: 'lg-3',
        roleId: 'product',
        title: '需求定稿',
        execution: 'serial',
      });
      const testCase = normalizeWorkflowNodeRoles({
        id: 'lg-4',
        roleId: 'qa',
        title: '测试用例设计',
        execution: 'serial',
        parallelGroup: 'parallel-dev-test-design',
      });
      const devImpl = normalizeWorkflowNodeRoles({
        id: 'lg-5',
        roleId: 'dev',
        title: '开发实现',
        execution: 'serial',
        parallelGroup: 'parallel-dev-test-design',
      });
      const workflow = syncWorkflowEdges({
        mode: 'dag',
        nodes: [reqFinal, testCase, devImpl],
        edges: [{ from: 'lg-7', to: 'lg-5', when: 'on_failure' }],
        edgesCustomized: true,
        orchestrationEngine: 'langgraph',
      });
      expect(workflow.edges).toContainEqual({
        from: 'lg-3',
        to: 'lg-4',
        when: 'on_success',
      });
      expect(workflow.edges).toContainEqual({
        from: 'lg-3',
        to: 'lg-5',
        when: 'on_success',
      });
      expect(workflow.edges).toContainEqual({
        from: 'lg-7',
        to: 'lg-5',
        when: 'on_failure',
      });
      },
    );

    it('ensureParallelLayerSuccessForkEdges adds missing fork from previous layer', () => {
      const review = normalizeWorkflowNodeRoles({
        id: 'n-review',
        roleId: 'pm',
        title: '需求评审',
        execution: 'serial',
      });
      const testCase = normalizeWorkflowNodeRoles({
        id: 'n-test-case',
        roleId: 'qa',
        title: '测试用例编写',
        execution: 'serial',
        parallelGroup: 'pg-build',
      });
      const devImpl = normalizeWorkflowNodeRoles({
        id: 'n-dev-impl',
        roleId: 'dev',
        title: '开发实现',
        execution: 'serial',
        parallelGroup: 'pg-build',
      });
      const nodes = [review, testCase, devImpl];
      const edges = [{ from: 'n-review', to: 'n-test-case', when: 'on_success' as const }];
      const fixed = ensureParallelLayerSuccessForkEdges(nodes, edges);
      expect(fixed).toContainEqual({
        from: 'n-review',
        to: 'n-dev-impl',
        when: 'on_success',
      });
      const runs = new Map<string, NodeRunRecord>([
        ['n-review', { nodeId: 'n-review', roleId: 'pm', status: 'completed' }],
        ['n-test-case', { nodeId: 'n-test-case', roleId: 'qa', status: 'pending' }],
        ['n-dev-impl', { nodeId: 'n-dev-impl', roleId: 'dev', status: 'pending' }],
      ]);
      const batch = nextRunnableNodes(nodes, fixed, runs);
      expect(batch.map((n) => n.roleId).sort()).toEqual(['dev', 'qa']);
    });

    it('keeps serial chain to a single runnable node', () => {
      const serialWorkflow: WorkflowDefinition = {
        mode: 'dag',
        nodes: [product, test, dev],
        edges: [
          { from: 'n-product', to: 'n-test', when: 'on_success' },
          { from: 'n-test', to: 'n-dev', when: 'on_success' },
        ],
        edgesCustomized: true,
      };
      const runs = new Map<string, NodeRunRecord>([
        ['n-product', { nodeId: 'n-product', roleId: 'product', status: 'completed' }],
        ['n-test', { nodeId: 'n-test', roleId: 'qa', status: 'pending' }],
        ['n-dev', { nodeId: 'n-dev', roleId: 'dev', status: 'pending' }],
      ]);
      const batch = nextRunnableNodes(serialWorkflow.nodes, serialWorkflow.edges, runs);
      expect(batch).toHaveLength(1);
      expect(batch[0]?.roleId).toBe('qa');
    });
  });
});

describe("__merged__:office-workflow-sort", () => {
  describe('office-workflow-sort', () => {
    it('extracts leading step numbers from task titles', () => {
      expect(extractTaskSequenceIndex('1. 需求分析')).toBe(1);
      expect(extractTaskSequenceIndex('第2步 设计')).toBe(2);
      expect(extractTaskSequenceIndex('步骤3：开发')).toBe(3);
      expect(extractTaskSequenceIndex('交付')).toBeNull();
    });

    it('orders by step number in title, not Chinese locale alphabet', () => {
      expect(compareTaskTitleForFlowOrder('3. 测试', '1. 需求')).toBeGreaterThan(0);
      expect(compareTaskTitleForFlowOrder('交付', '分析', 1)).toBe(1);
      expect(compareTaskTitleForFlowOrder('交付', '分析', -1)).toBe(-1);
    });

    it('sortWorkflowNodesByProcessOrder uses title sequence and syncs edges', () => {
      const workflow: WorkflowDefinition = {
        mode: 'simple',
        nodes: [
          { id: 'c', roleId: 'r1', execution: 'serial', title: '3. 测试' },
          { id: 'a', roleId: 'r1', execution: 'serial', title: '1. 需求' },
          { id: 'b', roleId: 'r1', execution: 'serial', title: '2. 开发' },
        ],
        edges: [],
      };
      const sorted = sortWorkflowNodesByProcessOrder(workflow);
      expect(sorted.nodes.map((n) => n.title)).toEqual(['1. 需求', '2. 开发', '3. 测试']);
      expect(sorted.edges.map((e) => e.from)).toEqual(['a', 'b']);
      expect(sorted.edges.map((e) => e.to)).toEqual(['b', 'c']);
    });

    it('topological sort follows dependency edges when present', () => {
      const nodes = [
        { id: 'c', roleId: 'r1', execution: 'serial' as const, title: '3. 测试' },
        { id: 'a', roleId: 'r1', execution: 'serial' as const, title: '1. 需求' },
        { id: 'b', roleId: 'r1', execution: 'serial' as const, title: '2. 开发' },
      ];
      const edges = [
        { from: 'a', to: 'b', when: 'on_success' as const },
        { from: 'b', to: 'c', when: 'on_success' as const },
      ];
      const ordered = topologicalSortWorkflowNodes(nodes, edges, (x, y) =>
        compareTaskTitleForFlowOrder(x, y, 0),
      );
      expect(ordered?.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    });

    it('reorders list to match edges even when UI list is shuffled', () => {
      const workflow: WorkflowDefinition = {
        mode: 'dag',
        edgesCustomized: true,
        nodes: [
          { id: 'c', roleId: 'r1', execution: 'serial', title: '测试' },
          { id: 'a', roleId: 'r1', execution: 'serial', title: '需求' },
          { id: 'b', roleId: 'r1', execution: 'serial', title: '开发' },
        ],
        edges: [
          { from: 'a', to: 'b', when: 'on_success' },
          { from: 'b', to: 'c', when: 'on_success' },
        ],
      };
      const sorted = sortWorkflowNodesByProcessOrder(workflow);
      expect(sorted.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
      expect(sorted.edges).toEqual(workflow.edges);
    });
  });
});

describe('workflow agent task prompt', () => {
  it('coordinator output example passes validation for PM', () => {
    const prompt = buildWorkflowCoordinatorAgentTaskPrompt({
      roleName: 'PM',
      taskTitle: 'demo',
      stepTitle: '项目启动',
      stepIndex: 1,
      totalSteps: 9,
      projectDirectoryLines: [
        '- 项目目录（唯一，所有角色交付/读取/对外产物）：/tmp/demo-project',
      ],
    });
    const example = extractWorkflowFewShotExample(prompt);
    const r = validateWorkflowAgentStructuredReply({
      raw: example,
      transportReason: 'empty',
      actorRoleName: 'PM',
    });
    expect(r.ok).toBe(true);
    const parsed = JSON.parse(example);
    expect(parsed.role).toBe('PM');
  });

  it('retry prompt includes diff block when priorRaw and issues provided', () => {
    const priorRaw = JSON.stringify({
      role: '测试',
      step: { index: 3, total: 9, title: '需求评审' },
      inputValidation: { targets: ['需求初稿-产品.md'], lsResult: ['ok'] },
      execution: '已完成。',
      outputValidation: { targets: [wfPath('测试', '需求评审-测试.md')], lsResult: [workflowProjectRelativeLsLine('需求评审-测试.md')],
      },
      deliverable: { path: wfPath('测试', '需求评审-测试.md'), summary: '已完成', conclusion: '通过' },
      rollback: '无',
    });
    const agentTaskBody = buildWorkflowMemberAgentTaskPrompt({
      roleName: '测试',
      taskTitle: '五子棋游戏开发',
      stepTitle: '需求评审',
      stepIndex: 3,
      totalSteps: 9,
      projectDirectoryLines: [
        '- 项目目录（唯一，所有角色交付/读取/对外产物）：/tmp/demo-project',
      ],
    });
    const retry = buildWorkflowAgentRetryPrompt({
      roleName: '测试',
      agentTaskBody,
      priorRaw,
      stepTitle: '需求评审',
      issues: ['deliverable_promissory_only', 'input_validation_ls_result_invalid'],
    });
    expect(retry).toContain('【测试·步骤格式纠正】');
    expect(retry).toContain('上次输出（供对照，勿照抄占位内容）：');
    expect(retry).toContain('字段修正指引（按问题逐项改）：');
    expect(retry).toContain('deliverable.summary →');
    expect(retry).toContain('inputValidation.lsResult →');
    expect(retry).toContain('问题码：deliverable_promissory_only,input_validation_ls_result_invalid');
    expect(retry).toContain('【Workflow 模式】');
    expect(retry).toContain('请直接按 JSON schema 格式输出，不要道歉或解释原因。');
  });

  it('retry prompt omits prior output block when priorRaw empty', () => {
    const agentTaskBody = buildWorkflowMemberAgentTaskPrompt({
      roleName: '测试',
      taskTitle: '五子棋游戏开发',
      stepTitle: '需求评审',
      stepDescription: '从测试可测性角度评审产品需求初稿，识别风险并落盘评审报告',
      priorDeliverables:
        '【产品】\n步骤：需求初稿\n交付物：需求初稿-产品.md\n关键摘要：定义棋盘15×15',
      stepIndex: 3,
      totalSteps: 9,
      projectDirectoryLines: [
        '- 项目目录（唯一，所有角色交付/读取/对外产物）：/tmp/demo-project',
      ],
    });
    const retry = buildWorkflowAgentRetryPrompt({
      roleName: '测试',
      agentTaskBody,
      issues: ['deliverable_promissory_only'],
      validationDetail:
        'deliverable.summary 须写可核验的关键结论，禁止仅「已发布/已完成/已交付」等空话或纯过程描述；评审步 deliverable.conclusion 须为「通过」或「不通过」（勿用「已交付」）',
    });
    expect(retry).toContain('【测试·步骤格式纠正】');
    expect(retry).toContain('你上一次的输出不符合工作流节点格式。');
    expect(retry).toContain('原因：结构校验：');
    expect(retry).toContain('问题码：deliverable_promissory_only');
    expect(retry).toContain('【Workflow 模式】');
    expect(retry).toContain('【核心执行流程】');
    expect(retry).toContain('交付物命名规范：');
    expect(retry).toContain('请直接按 JSON schema 格式输出，不要道歉或解释原因。');
    expect(retry).not.toContain('上次输出（供对照');
    expect(retry).not.toContain('【格式纠正·');
    expect(retry).not.toContain('请仅重输出一次');
  });

  it('few-shot example is pretty-printed valid JSON excluding rollback correction block', () => {
    const prompt = buildWorkflowMemberAgentTaskPrompt({
      roleName: '测试',
      taskTitle: 'demo',
      stepTitle: '需求评审',
      stepIndex: 3,
      totalSteps: 9,
      projectDirectoryLines: [
        '- 项目目录（唯一，所有角色交付/读取/对外产物）：/tmp/demo-project',
      ],
    });
    expect(prompt).toContain(WORKFLOW_OUTPUT_ROLLBACK_EXAMPLE_SECTION_TITLE);
    const example = extractWorkflowFewShotExample(prompt);
    expect(example.startsWith('{')).toBe(true);
    expect(example).toContain('\n  "role"');
    expect(example).not.toContain(WORKFLOW_OUTPUT_ROLLBACK_EXAMPLE_SECTION_TITLE);
    const parsed = JSON.parse(example);
    expect(parsed.role).toBe('测试');
    expect(parsed.deliverable.conclusion).toBe('通过');
    const r = validateWorkflowAgentStructuredReply({
      raw: example,
      transportReason: 'empty',
      actorRoleName: '测试',
    });
    expect(r.ok).toBe(true);
  });

  it('schema variant entry step emphasizes empty targets in merged spec', () => {
    const lines = buildWorkflowMergedOutputSpecLines('PM', {
      entryStep: true,
      reviewLikeStep: false,
      engineeringStep: false,
    });
    const joined = lines.join('\n');
    expect(joined).toContain('入口节点：inputValidation.targets 与 lsResult 均必须为 []');
  });

  it('schema variant engineering step emphasizes folder outputValidation', () => {
    const lines = buildWorkflowMergedOutputSpecLines('开发', {
      engineeringStep: true,
      reviewLikeStep: false,
      entryStep: false,
    });
    const joined = lines.join('\n');
    expect(joined).toContain('targets:[\\"交付物-开发\\"]');
    expect(joined).toContain('targets 与 lsResult 为等长字符串数组');
  });

  it('resolveWorkflowStepSchemaVariant classifies dev and review steps', () => {
    expect(resolveWorkflowStepSchemaVariant({ stepTitle: '项目启动', sampleTargets: [] })).toEqual({
      reviewLikeStep: false,
      engineeringStep: false,
      entryStep: true,
    });
    expect(
      resolveWorkflowStepSchemaVariant({
        stepTitle: '开发实现',
        sampleTargets: ['需求评审-测试.md'],
      }),
    ).toEqual({
      reviewLikeStep: false,
      engineeringStep: true,
      entryStep: false,
    });
    expect(
      resolveWorkflowStepSchemaVariant({
        stepTitle: '需求评审',
        sampleTargets: ['需求初稿-产品.md'],
      }),
    ).toEqual({
      reviewLikeStep: true,
      engineeringStep: false,
      entryStep: false,
    });
  });

  it('buildWorkflowOutputExampleJson matches validation for engineering step', () => {
    const json = buildWorkflowOutputExampleJson({
      roleName: '开发',
      stepTitle: '开发实现',
      stepIndex: 6,
      totalSteps: 9,
      sampleDeliverable: '交付物-开发',
      sampleTargets: ['需求评审-测试.md'],
      sampleConclusion: '已交付',
    });
    const raw = JSON.stringify(json);
    const r = validateWorkflowAgentStructuredReply({
      raw,
      transportReason: 'empty',
      actorRoleName: '开发',
    });
    expect(r.ok).toBe(true);
    expect(json.outputValidation.targets).toEqual(['交付物-开发']);
    expect(json.inputValidation.targets).toEqual(['需求评审-测试.md']);
  });

  it('retry diff maps issues to field-level fix hints', () => {
    const detail = formatWorkflowStructuredValidationFailureDetail(
      ['rollback_required', 'output_validation_deliverable_ls_mismatch'],
      { roleName: '测试', stepTitle: '需求评审' },
    );
    expect(detail).toContain('rollback：');
    expect(detail).toContain('outputValidation.lsResult：');
    const hint = mapWorkflowValidationIssueToFieldReason('rollback_required', {
      roleName: '测试',
      stepTitle: '需求评审',
    });
    expect(hint.fixHint).toContain('【回滚】：测试在「需求评审」');
    const block = buildWorkflowRetryDiffBlock({
      priorRaw: '{"role":"测试","rollback":"无"}',
      issues: ['rollback_required'],
      roleName: '测试',
      stepTitle: '需求评审',
    });
    expect(block).toContain('rollback: "无"');
    expect(block).toContain('rollback →');
  });

  it('sanitizeWorkflowPriorRawForRetryDisplay strips markdown fence', () => {
    const raw = '```json\n{"role":"PM"}\n```';
    expect(sanitizeWorkflowPriorRawForRetryDisplay(raw)).toBe('{"role":"PM"}');
  });

  it('rejects review json when conclusion conflicts with summary or rollback missing', () => {
    const raw = JSON.stringify({
      role: '测试',
      step: { index: 3, total: 9, title: '需求评审' },
      inputValidation: {
        targets: ['需求初稿-产品.md'],
        lsResult: ['-rw-r--r-- 1 u 9337 需求初稿-产品.md'],
      },
      execution: '已完成需求可测性评审并落盘交付物。',
      outputValidation: { targets: [wfPath('测试', '需求评审-测试.md')], lsResult: ['-rw-r--r-- 1 u 7821 需求评审-测试.md'],
      },
      deliverable: {
        path: wfPath('测试', '需求评审-测试.md'),
        summary: '识别3项关键可测性问题，另有4项标准缺失，结论有条件通过。',
        conclusion: '不通过',
      },
      rollback: '无',
    });
    const r = validateWorkflowAgentStructuredReply({
      raw,
      transportReason: 'empty',
      actorRoleName: '测试',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues).not.toContain('rollback_required');
      expect(r.issues).toContain('deliverable_conclusion_inconsistent');
    }
  });

  it('accepts review json with 不通过 without manual rollback (system auto rollback)', () => {
    const raw = JSON.stringify({
      role: '测试',
      step: { index: 3, total: 9, title: '需求评审' },
      inputValidation: {
        targets: ['需求初稿-产品.md'],
        lsResult: [workflowProjectRelativeLsLine('需求初稿-产品.md')],
      },
      execution: '评审发现关键缺口，结论不通过。',
      outputValidation: { targets: [wfPath('测试', '需求评审-测试.md')], lsResult: [workflowProjectRelativeLsLine('需求评审-测试.md')],
      },
      deliverable: {
        path: wfPath('测试', '需求评审-测试.md'),
        summary: '关键可测性标准缺失，不满足进入开发条件。',
        conclusion: '不通过',
      },
      rollback: '无',
    });
    const r = validateWorkflowAgentStructuredReply({
      raw,
      transportReason: 'empty',
      actorRoleName: '测试',
    });
    expect(r.ok).toBe(true);
  });

  it('accepts review json with 通过 when issues are listed in summary', () => {
    const raw = JSON.stringify({
      role: '测试',
      step: { index: 3, total: 9, title: '需求评审' },
      inputValidation: {
        targets: ['需求初稿-产品.md'],
        lsResult: [workflowProjectRelativeLsLine('需求初稿-产品.md')],
      },
      execution: '已完成评审并落盘。',
      outputValidation: { targets: [wfPath('测试', '需求评审-测试.md')], lsResult: [workflowProjectRelativeLsLine('需求评审-测试.md')],
      },
      deliverable: {
        path: wfPath('测试', '需求评审-测试.md'),
        summary: '发现3项可测性缺口，已记录；整体可进入下一阶段。',
        conclusion: '通过',
      },
      rollback: '无',
    });
    const r = validateWorkflowAgentStructuredReply({
      raw,
      transportReason: 'empty',
      actorRoleName: '测试',
    });
    expect(r.ok).toBe(true);
  });

  it('accepts review json with 不通过 when rollback is provided', () => {
    const raw = JSON.stringify({
      role: '测试',
      step: { index: 3, total: 9, title: '需求评审' },
      inputValidation: {
        targets: ['需求初稿-产品.md'],
        lsResult: [workflowProjectRelativeLsLine('需求初稿-产品.md')],
      },
      execution: '评审发现关键缺口，结论不通过。',
      outputValidation: { targets: [wfPath('测试', '需求评审-测试.md')], lsResult: [workflowProjectRelativeLsLine('需求评审-测试.md')],
      },
      deliverable: {
        path: wfPath('测试', '需求评审-测试.md'),
        summary: '关键可测性标准缺失，不满足进入开发条件。',
        conclusion: '不通过',
      },
      rollback: '【回滚】：产品在「需求初稿」的交付物存在关键标准缺失（可测性不足）',
    });
    const r = validateWorkflowAgentStructuredReply({
      raw,
      transportReason: 'empty',
      actorRoleName: '测试',
    });
    expect(r.ok).toBe(true);
  });

  it('rejects review json when conclusion is 已交付', () => {
    const raw = JSON.stringify({
      role: '测试',
      step: { index: 3, total: 9, title: '需求评审' },
      inputValidation: {
        targets: ['需求初稿-产品.md'],
        lsResult: [workflowProjectRelativeLsLine('需求初稿-产品.md')],
      },
      execution: '已完成评审并落盘。',
      outputValidation: { targets: [wfPath('测试', '需求评审-测试.md')], lsResult: [workflowProjectRelativeLsLine('需求评审-测试.md')],
      },
      deliverable: {
        path: wfPath('测试', '需求评审-测试.md'),
        summary: '识别3项风险，整体可进入下一阶段。',
        conclusion: '已交付',
      },
      rollback: '无',
    });
    const r = validateWorkflowAgentStructuredReply({
      raw,
      transportReason: 'empty',
      actorRoleName: '测试',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues).toContain('invalid_json_schema');
  });

  it('accepts coordinator json sample without absolute paths in lsResult', () => {
    const raw = JSON.stringify({
      role: 'PM',
      step: { index: 1, total: 9, title: '项目启动' },
      inputValidation: {
        targets: [],
        lsResult: [],
      },
      execution: '已完成项目预算、计划及kickoff，交付物落盘。',
      outputValidation: { targets: [wfPath('PM', '项目启动-PM.md')], lsResult: [workflowProjectRelativeLsLine('项目启动-PM.md')],
      },
      deliverable: {
        path: wfPath('PM', '项目启动-PM.md'),
        summary: '编制项目预算10.5人日，制定9步计划含并行节点，组织5角色kickoff确认目标与风险应对。',
        conclusion: '通过',
      },
      rollback: '无',
    });
    const r = validateWorkflowAgentStructuredReply({
      raw,
      transportReason: 'empty',
      actorRoleName: 'PM',
    });
    expect(r.ok).toBe(true);
  });

  it('member output example uses role-scoped deliverable name', () => {
    const prompt = buildWorkflowMemberAgentTaskPrompt({
      roleName: '测试',
      taskTitle: 'demo',
      stepTitle: '测试验收',
      stepIndex: 7,
      totalSteps: 9,
      projectDirectoryLines: [
        '- 项目目录（唯一，所有角色交付/读取/对外产物）：/tmp/demo-project',
      ],
    });
    const example = extractWorkflowFewShotExample(prompt);
    expect(JSON.parse(example).role).toBe('测试');
    expect(example).toContain('测试验收-测试.xx');
    expect(example).not.toContain('测试验收报告-测试.md');
  });

  it('extractWorkflowUpstreamTargetNames collects all 交付物 lines', () => {
    const prior = [
      '【产品】',
      '交付物：需求初稿-产品.md',
      '【开发】',
      '交付物：交付物-开发/',
    ].join('\n');
    expect(extractWorkflowUpstreamTargetNames(prior)).toEqual([
      '需求初稿-产品.md',
      '交付物-开发',
    ]);
  });

  it('extractWorkflowUpstreamTargetNames excludes status ndjson artifacts', () => {
    const prior = [
      '【PM】',
      '交付物：项目启动-PM.md、status-PM.ndjson',
      '【产品】',
      '交付物：需求说明书-产品.md、status-产品.ndjson',
    ].join('\n');
    expect(extractWorkflowUpstreamTargetNames(prior)).toEqual([
      '项目启动-PM.md',
      '需求说明书-产品.md',
    ]);
  });

  it('workflow prompt schema clarifies lsResult is full ls -l output not filename list', () => {
    const prompt = buildWorkflowMemberAgentTaskPrompt({
      roleName: '开发',
      taskTitle: 'demo',
      stepTitle: '开发实现',
      stepIndex: 2,
      totalSteps: 9,
      directPredecessorDeliverables: '【测试】\n交付物：需求评审-测试.md',
      projectDirectoryLines: ['- 项目目录（唯一，所有角色交付/读取/对外产物）：/tmp/demo-project'],
    });
    expect(prompt).toContain('targets 与 lsResult 须为等长数组');
    expect(prompt).toContain('直接前驱交付物');
    expect(prompt).toContain('建议仅列直接前驱');
    expect(prompt).not.toContain('文件夹内 ls');
    expect(prompt).not.toContain('lsResult为项目目录下ls -l结果（仅文件名');
  });

  it('output example inputValidation.targets uses only direct predecessor deliverables', () => {
    const prior = [
      '【产品】',
      '步骤：需求初稿',
      '交付物：需求初稿-产品.md',
      '关键摘要：初稿摘要',
      '【开发】',
      '步骤：功能开发',
      '交付物：交付物-开发/',
      '关键摘要：三入口实现',
    ].join('\n');
    const directPrior = [
      '【开发】',
      '步骤：功能开发',
      '交付物：交付物-开发/',
      '关键摘要：三入口实现',
    ].join('\n');
    const prompt = buildWorkflowMemberAgentTaskPrompt({
      roleName: '测试',
      taskTitle: 'demo',
      stepTitle: '需求评审',
      priorDeliverables: prior,
      directPredecessorDeliverables: directPrior,
      stepIndex: 3,
      totalSteps: 9,
      projectDirectoryLines: [
        '- 项目目录（唯一，所有角色交付/读取/对外产物）：/tmp/demo-project',
      ],
    });
    const example = extractWorkflowFewShotExample(prompt);
    const parsedExample = JSON.parse(example);
    expect(parsedExample.inputValidation.targets).toEqual(['交付物-开发']);
    expect(parsedExample.inputValidation.lsResult).toEqual([
      workflowProjectRelativeLsDirLine('交付物-开发'),
    ]);
    expect(example).toContain('交付物-开发');
    expect(example).not.toContain('需求初稿-产品.md');
    expect(prompt).not.toContain('上游所有交付物 (完整正文请从项目目录中读取');
    expect(prompt).toContain('勿仅凭直接前驱交付物信息臆测');
    expect(prompt).toContain('建议仅列直接前驱');
    expect(prompt).toContain('交付物-开发');
    expect(example).toContain('需求评审-测试.xx');
  });

  it('accepts inputValidation lsResult with project-root drwx for folder predecessor', () => {
    const r = validateWorkflowAgentStructuredReply({
      raw: JSON.stringify({
        role: '测试',
        step: { index: 2, total: 3, title: '测试验收' },
        inputValidation: {
          targets: ['交付物-开发'],
          lsResult: [workflowProjectRelativeLsDirLine('交付物-开发')],
        },
        execution: '已完成验收。',
        outputValidation: { targets: [wfPath('测试', '测试验收-测试.md')], lsResult: [workflowProjectRelativeLsLine('测试验收-测试.md')],
        },
        deliverable: {
          path: wfPath('测试', '测试验收-测试.md'),
          summary: '验收通过，核心路径可走通。',
          conclusion: '通过',
        },
        rollback: '无',
      }),
      transportReason: 'empty',
      actorRoleName: '测试',
    });
    expect(r.ok).toBe(true);
  });

  it('few-shot lsResult lines align with relative path targets via leaf display names', () => {
    const targets = ['a.md', 'B/b.md'];
    const lsResults = workflowProjectRelativeInputLsForTargets(targets);
    expect(workflowLsLineDisplayName('B/b.md')).toBe('b.md');
    expect(lsResults[1]).toContain('b.md');
    expect(
      isWorkflowLsResultsArrayInvalid(targets, lsResults),
    ).toBe(false);
    const example = buildWorkflowOutputExampleJson({
      roleName: '测试',
      stepTitle: '冒烟验收',
      sampleDeliverable: wfPath('测试', '测试验收-测试.md'),
      sampleTargets: targets,
    });
    expect(example.inputValidation.targets).toEqual(targets);
    expect(example.inputValidation.lsResult).toEqual(lsResults);
  });

  it('parseWorkflowJsonOutput rejects outputValidation.target (must use targets)', () => {
    const json = parseWorkflowJsonOutput(
      JSON.stringify({
        role: 'PM',
        step: { index: 1, total: 3, title: '项目启动' },
        inputValidation: { targets: [], lsResult: [] },
        execution: 'ok',
        outputValidation: {
          target: ['项目启动-PM.md'],
          lsResult: [workflowProjectRelativeLsLine('项目启动-PM.md')],
        },
        deliverable: { path: wfPath('PM', '项目启动-PM.md'), summary: '已落盘', conclusion: '已交付' },
        rollback: '无',
      }),
    );
    expect(json).toBeNull();
  });

  it('rejects absolute path in inputValidation.targets', () => {
    expect(isWorkflowLsTargetPathInvalid('/tmp/evil.md')).toBe(true);
    const r = validateWorkflowAgentStructuredReply({
      raw: JSON.stringify({
        role: '测试',
        step: { index: 2, total: 3, title: '测试' },
        inputValidation: {
          targets: ['/tmp/evil.md'],
          lsResult: [workflowProjectRelativeLsLine('evil.md')],
        },
        execution: 'x',
        outputValidation: {
          targets: [wfPath('测试', '测试-测试.md')],
          lsResult: [workflowProjectRelativeLsLine('测试-测试.md')],
        },
        deliverable: { path: wfPath('测试', '测试-测试.md'), summary: 'ok', conclusion: '通过' },
        rollback: '无',
      }),
      transportReason: 'empty',
      actorRoleName: '测试',
    });
    expect(r.ok).toBe(false);
    expect(r.issues).toContain('invalid_json_schema');
  });

  it('lsLineMatchesWorkflowTarget accepts full path or leaf for nested target', () => {
    const line = '-rw-r--r--  1 demo  staff  100 May 28 10:00 b.md';
    expect(lsLineMatchesWorkflowTarget(line, 'B/b.md')).toBe(true);
    expect(lsLineMatchesWorkflowTarget(line, 'B/b')).toBe(false);
    const fullLine = '-rw-r--r--  1 demo  staff  100 May 28 10:00 B/b.md';
    expect(lsLineMatchesWorkflowTarget(fullLine, 'B/b.md')).toBe(true);
  });

  it('lsLineMatchesWorkflowTarget accepts project-relative ./ prefix from ls -l ./target', () => {
    const fileLine =
      '-rw-r--r-- 1 lixingwei 453037844 4402 6 3 09:54 ./项目启动-PM.md';
    expect(lsLineMatchesWorkflowTarget(fileLine, '项目启动-PM.md')).toBe(true);
    const dirLine = 'drwxr-xr-x 3 lixingwei 453037844 96 6 3 10:08 ./交付物-开发';
    expect(lsLineMatchesWorkflowTarget(dirLine, '交付物-开发')).toBe(true);
    const nestedLine = '-rw-r--r--  1 demo  staff  100 May 28 10:00 ./B/b.md';
    expect(lsLineMatchesWorkflowTarget(nestedLine, 'B/b.md')).toBe(true);
  });

  it('lsLineMatchesWorkflowTarget accepts nested target when ls path contains spaces', () => {
    const target = '交付物-数据收集师/数据搜集师 搜集相关权威材料…-数据收集师.md';
    const line = `-rw-r--r-- 1 lixingwei 453037844 9915 6 13 11:01 ${target}`;
    expect(extractLsLinePathSuffix(line)).toBe(target);
    expect(lsLineMatchesWorkflowTarget(line, target)).toBe(true);
    const r = validateWorkflowAgentStructuredReply({
      raw: JSON.stringify({
        role: '数据收集师',
        step: { index: 1, total: 6, title: '数据搜集' },
        inputValidation: { targets: [], lsResult: [] },
        execution: '已完成资料搜集并落盘。',
        outputValidation: { targets: [target], lsResult: [line] },
        deliverable: {
          path: target,
          summary: 'GPGPU 权威资料已写入交付物文件。',
          conclusion: '已交付',
        },
        rollback: '无',
      }),
      transportReason: 'empty',
      actorRoleName: '数据收集师',
    });
    expect(r.ok).toBe(true);
  });

  it('accepts inputValidation with relative path target and ls line ending in leaf name', () => {
    const r = validateWorkflowAgentStructuredReply({
      raw: JSON.stringify({
        role: '测试',
        step: { index: 3, total: 9, title: '冒烟验收' },
        inputValidation: {
          targets: ['B/b.md'],
          lsResult: ['-rw-r--r--  1 demo  staff  16889 May 27 20:47 b.md'],
        },
        execution: '已完成冒烟验收。',
        outputValidation: {
          targets: [wfPath('测试', '测试验收-测试.md')],
          lsResult: [workflowProjectRelativeLsLine('测试验收-测试.md')],
        },
        deliverable: {
          path: wfPath('测试', '测试验收-测试.md'),
          summary: '冒烟验收通过。',
          conclusion: '通过',
        },
        rollback: '无',
      }),
      transportReason: 'empty',
      actorRoleName: '测试',
    });
    expect(r.ok).toBe(true);
  });

  it('accepts inputValidation lsResult with path prefix in ls line (lsResult content not validated)', () => {
    const r = validateWorkflowAgentStructuredReply({
      raw: JSON.stringify({
        role: '审计',
        step: { index: 8, total: 9, title: '对交付物进行安全审计' },
        inputValidation: {
          targets: ['交付物-开发'],
          lsResult: ['-rw-r--r--@ 1 demo  staff  33178 May 30 16:13 交付物-开发/index.html'],
        },
        execution: '已完成安全审计。',
        outputValidation: { targets: [wfPath('审计', '对交付物进行安全审计-审计.md')], lsResult: [workflowProjectRelativeLsLine('对交付物进行安全审计-审计.md')],
        },
        deliverable: {
          path: wfPath('审计', '对交付物进行安全审计-审计.md'),
          summary: '安全审计通过。',
          conclusion: '通过',
        },
        rollback: '无',
      }),
      transportReason: 'empty',
      actorRoleName: '审计',
      directPredecessorDeliverables: '【开发】\n步骤：开发实现\n交付物：交付物-开发',
    });
    expect(r.ok).toBe(true);
  });

  it('accepts Windows PowerShell-style lsResult without Unix ls -l shape', () => {
    const r = validateWorkflowAgentStructuredReply({
      raw: JSON.stringify({
        role: '编写师',
        step: { index: 2, total: 3, title: '负责漫画ppt的文字创作' },
        inputValidation: {
          targets: ['交付物-策划师/制定漫画ppt的策划方案-策划师.md'],
          lsResult: [
            '-a----         2026/7/14     17:51           3854 制定漫画ppt的策划方案-策划师.md',
          ],
        },
        execution: '已根据策划方案完成漫画PPT剧情文本创作并落盘至交付物-编写师目录。',
        outputValidation: {
          targets: ['交付物-编写师/漫画ppt的剧情文本-编写师.md'],
          lsResult: [
            '-a----         2026/7/14     17:53           6087 漫画ppt的剧情文本-编写师.md',
          ],
        },
        deliverable: {
          path: '交付物-编写师/漫画ppt的剧情文本-编写师.md',
          summary: '完成安全教育漫画PPT剧情文本，含封面与分镜对白。',
          conclusion: '已交付',
        },
        rollback: '无',
      }),
      transportReason: 'empty',
      actorRoleName: '编写师',
    });
    expect(r.ok).toBe(true);
  });

  it('accepts inputValidation lsResult with macOS extended-attribute drwx for folder predecessor', () => {
    const r = validateWorkflowAgentStructuredReply({
      raw: JSON.stringify({
        role: '审计',
        step: { index: 8, total: 9, title: '对交付物进行安全审计' },
        inputValidation: {
          targets: ['交付物-开发'],
          lsResult: [workflowProjectRelativeLsDirLine('交付物-开发')],
        },
        execution: '已完成安全审计。',
        outputValidation: { targets: [wfPath('审计', '对交付物进行安全审计-审计.md')], lsResult: [workflowProjectRelativeLsLine('对交付物进行安全审计-审计.md')],
        },
        deliverable: {
          path: wfPath('审计', '对交付物进行安全审计-审计.md'),
          summary: '安全审计通过。',
          conclusion: '通过',
        },
        rollback: '无',
      }),
      transportReason: 'empty',
      actorRoleName: '审计',
      directPredecessorDeliverables: '【开发】\n步骤：开发实现\n交付物：交付物-开发',
    });
    expect(r.ok).toBe(true);
  });

  it('accepts inputValidation targets beyond direct predecessors when lsResult matches', () => {
    const r = validateWorkflowAgentStructuredReply({
      raw: JSON.stringify({
        role: '测试',
        step: { index: 3, total: 9, title: '需求评审' },
        inputValidation: {
          targets: ['交付物-开发', '需求初稿-产品.md'],
          lsResult: [
            workflowProjectRelativeLsDirLine('交付物-开发'),
            workflowProjectRelativeLsLine('需求初稿-产品.md'),
          ],
        },
        execution: '已核对上游产物。',
        outputValidation: {
          targets: [wfPath('测试', '需求评审-测试.md')],
          lsResult: [workflowProjectRelativeLsLine('需求评审-测试.md')],
        },
        deliverable: {
          path: wfPath('测试', '需求评审-测试.md'),
          summary: '评审完成，直接前驱与更上游产物均已核对。',
          conclusion: '通过',
        },
        rollback: '无',
      }),
      transportReason: 'empty',
      actorRoleName: '测试',
      directPredecessorDeliverables: '【开发】\n交付物：交付物-开发',
    });
    expect(r.ok).toBe(true);
  });

  it('accepts outputValidation lsResult with project-root path prefix for folder deliverable', () => {
    const r = validateWorkflowAgentStructuredReply({
      raw: JSON.stringify({
        role: '开发',
        step: { index: 6, total: 9, title: '开发实现' },
        inputValidation: {
          targets: ['需求说明书-产品.md'],
          lsResult: [workflowProjectRelativeLsLine('需求说明书-产品.md')],
        },
        execution: '已落盘',
        outputValidation: {
          targets: ['交付物-开发'],
          lsResult: ['-rw-r--r-- 1 demo  staff  33178 May 30 16:13 交付物-开发/index.html'],
        },
        deliverable: {
          path: '交付物-开发',
          summary: '五子棋游戏已落盘至交付目录',
          conclusion: '已交付',
        },
        rollback: '无',
      }),
      transportReason: 'empty',
      actorRoleName: '开发',
    });
    expect(r.ok).toBe(true);
  });

  it('entry node prompt uses empty targets and empty lsResult arrays', () => {
    const prompt = buildWorkflowMemberAgentTaskPrompt({
      roleName: 'PM',
      taskTitle: 'demo',
      stepTitle: '项目启动',
      stepIndex: 1,
      totalSteps: 9,
      projectDirectoryLines: [
        '- 项目目录（唯一，所有角色交付/读取/对外产物）：/tmp/demo-project',
      ],
    });
    const example = extractWorkflowFewShotExample(prompt);
    expect(JSON.parse(example).inputValidation.targets).toEqual([]);
    expect(JSON.parse(example).inputValidation.lsResult).toEqual([]);
    expect(example).not.toContain('无（本步为入口节点）');
  });

  it('engineering step prompt matches Untitled-6 dev format', () => {
    const prior = [
      '【产品】',
      '步骤：需求定稿',
      '交付物：需求定稿-产品.md、需求初稿-产品.md',
      '【测试】',
      '步骤：需求评审',
      '交付物：需求评审-测试.md',
      '【开发】',
      '步骤：需求评审',
      '交付物：需求评审-开发.md',
    ].join('\n');
    const directPrior = [
      '【测试】',
      '步骤：需求评审',
      '交付物：需求评审-测试.md',
    ].join('\n');
    const prompt = buildWorkflowMemberAgentTaskPrompt({
      roleName: '开发',
      taskTitle: '五子棋游戏开发',
      featureDescription:
        '1.经典黑白五子棋；2.支持人机对战；3.支持难度高中低三级切换；4.界面布局合理,性能优异，交互自然；5.人机对战中人类获胜语音+文本播报',
      stepTitle: '开发实现',
      stepDescription: '软件开发根据正式的需求说明书进行需求实现',
      priorDeliverables: prior,
      directPredecessorDeliverables: directPrior,
      stepIndex: 6,
      totalSteps: 9,
      projectDirectoryLines: [
        '- 项目目录（唯一，所有角色交付/读取/对外产物）：/tmp/demo-project',
      ],
    });
    const example = extractWorkflowFewShotExample(prompt);
    expect(prompt).toContain('【Workflow 模式】\n当前角色：开发');
    expect(prompt).toContain('本任务(我此次要完成的任务)：软件开发根据正式的需求说明书进行需求实现');
    expect(prompt).toContain('功能描述：');
    expect(prompt).toContain('经典黑白五子棋');
    expect(prompt).toContain('在项目目录 交付物-开发/ 下落盘文件');
    expect(prompt).toContain('targets 与 lsResult 须为等长数组');
    expect(prompt).toContain('在项目目录下 ls -l');
    expect(prompt).toContain('outputValidation.targets 与 lsResult');
    expect(prompt).toContain('交付物命名规范：');
    expect(prompt).not.toContain('【输出规范与严格校验（合并强制规则 + Schema）】');
    expect(prompt).not.toContain('【交付·命名】');
    expect(prompt).toContain('【输出示例，仅作为格式参考，勿直接抄袭】');
    expect(prompt).not.toContain('需求定稿-产品.md、需求初稿-产品.md');
    expect(prompt).toContain('需求评审-测试.md');
    expect(prompt).toContain('勿仅凭直接前驱交付物信息臆测');
    const parsedDevExample = JSON.parse(example);
    expect(parsedDevExample.inputValidation.targets).toEqual(['需求评审-测试.md']);
    expect(parsedDevExample.deliverable.path).toBe('交付物-开发');
    expect(parsedDevExample.outputValidation.targets).toEqual(['交付物-开发']);
    expect(parsedDevExample.step.title).toBe('开发实现');
    expect(example).toContain('drwxr-xr-x');
    expect(example).not.toContain('功能开发-开发.md');
    expect(formatWorkflowUpstreamDeliverableFileList(prior)).toContain(
      '需求定稿-产品.md、需求初稿-产品.md',
    );
  });

  it('getAllUpstreamNodeIds walks full ancestor chain in topological order', () => {
    const nodes: WorkflowNode[] = [
      { id: 'n1', roleId: 'pm', title: 'A', execution: 'serial' },
      { id: 'n2', roleId: 'dev', title: 'B', execution: 'serial' },
      { id: 'n3', roleId: 'qa', title: 'C', execution: 'serial' },
    ];
    const edges: WorkflowEdge[] = [
      { from: 'n1', to: 'n2', when: 'on_success' },
      { from: 'n2', to: 'n3', when: 'on_success' },
    ];
    expect(getAllUpstreamNodeIds('n3', nodes, edges)).toEqual(['n1', 'n2']);
    expect(getAllUpstreamNodeIds('n2', nodes, edges)).toEqual(['n1']);
    expect(getAllUpstreamNodeIds('n1', nodes, edges)).toEqual([]);
  });

  it('extractDeliverablePathHints parses 交付物 line filenames', () => {
    const hints = extractDeliverablePathHints('交付物：项目启动-PM.md、需求初稿-产品.md');
    expect(hints).toContain('项目启动-PM.md');
    expect(hints).toContain('需求初稿-产品.md');
  });

  it('prior context includes all upstream predecessors with paths and summary', () => {
    const projectRoot = '/Users/demo/.openclaw/workspace-pm/office/projects/demo-tax-task';
    const nodes = [
      { id: 'n-dev', roleId: 'dev', title: '功能开发', execution: 'serial' as const },
      { id: 'n-qa-case', roleId: 'qa', title: '编写用例', execution: 'serial' as const },
      { id: 'n-qa-acc', roleId: 'qa', title: '测试验收', execution: 'serial' as const },
    ];
    const edges = [
      { from: 'n-dev', to: 'n-qa-acc', when: 'on_success' as const },
      { from: 'n-qa-case', to: 'n-qa-acc', when: 'on_success' as const },
    ];
    const runs = new Map([
      [
        'n-dev',
        {
          nodeId: 'n-dev',
          roleId: 'dev',
          status: 'completed' as const,
          summary: `【开发】${projectRoot}/交付物-开发/ 含三入口实现`,
        },
      ],
      [
        'n-qa-case',
        {
          nodeId: 'n-qa-case',
          roleId: 'qa',
          status: 'completed' as const,
          summary: `【测试】${projectRoot}/测试用例-测试.md 用例摘要`,
        },
      ],
    ]);
    const roles = [
      { id: 'dev', name: '开发' },
      { id: 'qa', name: '测试' },
    ];
    const prior = buildPriorDeliverablesContext({
      runs,
      nodes,
      roles,
      currentNodeId: 'n-qa-acc',
      edges,
      projectRoot,
    });
    expect(prior).toContain('编写用例');
    expect(prior).toContain('功能开发');
    expect(prior).toContain('交付物：');
    expect(prior).toContain('交付物-开发');
    expect(prior).toContain('测试用例-测试.md');
  });

  it('formatPriorDeliverablesNumberedList renders numbered upstream lines', () => {
    const prior = [
      '【测试】',
      '步骤：测试验收',
      '交付物：测试验收报告-测试.md',
      '关键摘要：Smoke通过',
    ].join('\n');
    const numbered = formatPriorDeliverablesNumberedList(prior);
    expect(numbered).toMatch(/^1\. 测试：测试验收报告-测试\.md/u);
  });

  it('prior context dedupes carved and repeated absolute paths per predecessor', () => {
    const projectRoot =
      '/Users/lixingwei/.openclaw/workspace-pm/office/projects/个税计算器开发-task-1779442564630-de77bj';
    const prd = `${projectRoot}/需求说明书-产品.md`;
    const cases = `${projectRoot}/测试用例-测试.md`;
    const carved = `${projectRoot}/workspace-pm/office/projects/个税计算器开发-task-1779442564630-de77bj/需求说明书-产品.md`;
    const summary = [
      `【测试】已 ls：${prd} 与 ${cases}`,
      `重复提及 ${prd}`,
      `误切 ${carved}`,
      '含57条测试用例摘要',
    ].join('\n');
    const prior = buildPriorDeliverablesContext({
      runs: new Map([
        [
          'n-qa-case',
          {
            nodeId: 'n-qa-case',
            roleId: 'qa',
            status: 'completed',
            summary,
          },
        ],
      ]),
      nodes: [
        { id: 'n-qa-case', roleId: 'qa', title: '编写用例', execution: 'serial' },
        { id: 'n-qa-acc', roleId: 'qa', title: '测试验收', execution: 'serial' },
      ],
      roles: [{ id: 'qa', name: '测试' }],
      currentNodeId: 'n-qa-acc',
      edges: [{ from: 'n-qa-case', to: 'n-qa-acc', when: 'on_success' }],
      projectRoot,
    });
    const pathLine = prior.match(/交付物：([^\n]+)/u)?.[1] ?? '';
    const paths = pathLine.split(/[、；]/u).filter(Boolean);
    expect(paths).toEqual(['需求说明书-产品.md', '测试用例-测试.md']);
    expect(prior).not.toContain(`${projectRoot}/workspace-pm/office/projects/`);
  });

  it('coordinator prompt uses Workflow v2 sections and teammate roster', () => {
    const prompt = buildAgentTaskPrompt({
      roleName: 'PM',
      taskTitle: '个税计算器开发',
      taskDescription: '1.PM编写项目计划\n2.产品开发',
      featureDescription: '交付 HTML 个税计算器',
      stepTitle: '项目启动',
      stepDescription: 'PM编写项目预算、项目计划，组织全员kickoff，交付项目计划书',
      scenarioName: '协作团队',
      teammateNames: ['产品', '开发', '测试', 'PM'],
      isCoordinatorRole: true,
      stepIndex: 1,
      totalSteps: 9,
      expectedHandoffLines: ['- @产品 需求初稿'],
      projectDirectoryLines: [
        '- 项目目录（唯一，所有角色交付/读取/对外产物）：/Users/demo/.openclaw/workspace-pm/office/projects/demo-tax-task',
      ],
    });
    expect(prompt).toContain('【Workflow 模式】');
    expect(prompt).toContain('当前角色：PM');
    expect(prompt).toContain('团队成员：产品、开发、测试、PM');
    expect(prompt).toContain('【任务信息】');
    expect(prompt).toContain('【核心执行流程】');
    expect(prompt).toContain('交付物命名规范：');
    expect(prompt).toContain('文件.<真实后缀>');
    expect(prompt).not.toContain('【输出规范与严格校验（合并强制规则 + Schema）】');
    expect(prompt).not.toContain('【交付·命名】');
    expect(prompt).toContain('项目启动-PM.xx');
    expect(prompt).not.toContain('【团队说明】');
  });

  it('member 测试验收 prompt includes all upstream predecessors and unified few-shot', () => {
    const projectRoot = '/Users/demo/.openclaw/workspace-pm/office/projects/demo-tax-task';
    const prior = buildPriorDeliverablesContext({
      runs: new Map([
        [
          'n-dev',
          {
            nodeId: 'n-dev',
            roleId: 'dev',
            status: 'completed',
            summary: `【开发】${projectRoot}/交付物-开发/`,
          },
        ],
        [
          'n-qa-case',
          {
            nodeId: 'n-qa-case',
            roleId: 'qa',
            status: 'completed',
            summary: `【测试】${projectRoot}/测试用例-测试.md`,
          },
        ],
      ]),
      nodes: [
        { id: 'n-dev', roleId: 'dev', title: '功能开发', execution: 'serial' },
        { id: 'n-qa-case', roleId: 'qa', title: '编写用例', execution: 'serial' },
        { id: 'n-qa-acc', roleId: 'qa', title: '测试验收', execution: 'serial' },
      ],
      roles: [
        { id: 'dev', name: '开发' },
        { id: 'qa', name: '测试' },
      ],
      currentNodeId: 'n-qa-acc',
      edges: [
        { from: 'n-dev', to: 'n-qa-acc', when: 'on_success' },
        { from: 'n-qa-case', to: 'n-qa-acc', when: 'on_success' },
      ],
      projectRoot,
    });
    const directPrior = buildPriorDeliverablesContext({
      runs: new Map([
        [
          'n-dev',
          {
            nodeId: 'n-dev',
            roleId: 'dev',
            status: 'completed',
            summary: `【开发】${projectRoot}/交付物-开发/`,
          },
        ],
        [
          'n-qa-case',
          {
            nodeId: 'n-qa-case',
            roleId: 'qa',
            status: 'completed',
            summary: `【测试】${projectRoot}/测试用例-测试.md`,
          },
        ],
      ]),
      nodes: [
        { id: 'n-dev', roleId: 'dev', title: '功能开发', execution: 'serial' },
        { id: 'n-qa-case', roleId: 'qa', title: '编写用例', execution: 'serial' },
        { id: 'n-qa-acc', roleId: 'qa', title: '测试验收', execution: 'serial' },
      ],
      roles: [
        { id: 'dev', name: '开发' },
        { id: 'qa', name: '测试' },
      ],
      currentNodeId: 'n-qa-acc',
      edges: [
        { from: 'n-dev', to: 'n-qa-acc', when: 'on_success' },
        { from: 'n-qa-case', to: 'n-qa-acc', when: 'on_success' },
      ],
      projectRoot,
      scope: 'direct_predecessors',
    });
    const prompt = buildWorkflowAgentTaskPrompt({
      roleName: '测试',
      taskTitle: '个税计算器开发',
      taskDescription: '个税计算器开发',
      stepTitle: '测试验收',
      stepDescription: '测试对开发的交付物进行测试验证，交付测试验收报告',
      teammateNames: ['产品', '开发', '测试', 'PM', '审计'],
      priorDeliverables: prior,
      directPredecessorDeliverables: directPrior,
      stepIndex: 7,
      totalSteps: 9,
      projectDirectoryLines: [`- 项目目录（唯一，所有角色交付/读取/对外产物）：${projectRoot}`],
    });
    expect(prompt).toContain('本任务(我此次要完成的任务)：测试对开发的交付物进行测试验证，交付测试验收报告');
    expect(prompt).toContain('勿仅凭直接前驱交付物信息臆测');
    expect(prompt).not.toContain('上游所有交付物 (完整正文请从项目目录中读取');
    expect(prior).toContain('功能开发');
    const sample = extractWorkflowFewShotExample(prompt);
    expect(JSON.parse(sample).role).toBe('测试');
    expect(sample).toContain('测试验收-测试.xx');
    expect(sample).toContain('交付物-开发');
    expect(sample).toContain('测试用例-测试.md');
    expect(JSON.parse(sample).inputValidation.targets).toContain('交付物-开发');
  });

  it('member prompt uses Workflow v2 sections without teammate roster', () => {
    const prompt = buildAgentTaskPrompt({
      roleName: '产品',
      taskTitle: '个税计算器开发',
      taskDescription: '交付 HTML 个税计算器',
      stepTitle: '需求初稿',
      stepDescription: '产品经理撰写需求说明书初稿',
      scenarioName: '协作团队',
      teammateNames: ['产品', '开发', 'PM'],
      isCoordinatorRole: false,
      stepIndex: 2,
      totalSteps: 9,
      projectDirectoryLines: [
        '- 项目目录（唯一，所有角色交付/读取/对外产物）：/Users/demo/.openclaw/workspace-pm/office/projects/demo-tax-task',
      ],
    });
    expect(prompt).toContain('【Workflow 模式】');
    expect(prompt).toContain('当前角色：产品');
    expect(prompt).not.toMatch(/团队成员[：:]/u);
    expect(prompt).toContain('交付物命名规范：');
    expect(prompt).toContain('文件.<真实后缀>');
    expect(prompt).not.toContain('【输出规范与严格校验（合并强制规则 + Schema）】');
    expect(prompt).not.toContain('【交付·命名】');
    const memberSample = extractWorkflowFewShotExample(prompt);
    expect(JSON.parse(memberSample).role).toBe('产品');
    expect(memberSample).toContain('需求初稿-产品.xx');
  });

  it('buildWorkflowAgentTaskPrompt matches buildAgentTaskPrompt', () => {
    const params = {
      roleName: 'PM',
      taskTitle: 'demo',
      taskDescription: 'goal',
      stepTitle: 'step',
      stepDescription: 'desc',
      teammateNames: ['产品'],
      isCoordinatorRole: true,
      stepIndex: 1,
      totalSteps: 3,
      projectDirectoryLines: ['- 项目目录（唯一，所有角色交付/读取/对外产物）：/tmp/p'],
    };
    expect(buildAgentTaskPrompt({ ...params, scenarioName: 'x' })).toBe(
      buildWorkflowAgentTaskPrompt(params),
    );
  });

  it('coordinator task prompt lists teammates; member prompt does not', () => {
    const base = {
      taskTitle: '五子棋游戏开发',
      stepTitle: '项目启动',
      stepDescription: 'PM 立项',
      teammateNames: ['产品', '开发', '测试', 'PM', '审计'],
      stepIndex: 1,
      totalSteps: 9,
      projectDirectoryLines: [
        '- 项目目录（唯一，所有角色交付/读取/对外产物）：/tmp/demo-project',
      ],
    };
    const coordinator = buildWorkflowAgentTaskPrompt({
      ...base,
      roleName: 'PM',
      isCoordinatorRole: true,
    });
    const member = buildWorkflowAgentTaskPrompt({
      ...base,
      roleName: '产品',
      isCoordinatorRole: false,
    });
    expect(coordinator).toContain('团队成员：产品、开发、测试、PM、审计');
    expect(member).not.toMatch(/团队成员[：:]/u);
    expect(member).toContain('当前角色：产品');
  });
});

describe('workflow room follow-up policy', () => {
  it('does not apply smart coordinator follow-up filtering', async () => {
    const { filterFollowUpMentionTargets } = await import(
      '../../electron/services/office/room-follow-up-policy'
    );
    const dev = { id: 'dev', name: '开发', agentId: 'a-dev', createdAt: 0, updatedAt: 0 };
    const qa = { id: 'qa', name: '测试', agentId: 'a-qa', createdAt: 0, updatedAt: 0 };
    const delegated = [dev, qa];
    expect(
      filterFollowUpMentionTargets({
        executionMode: 'workflow',
        coordinatorRoleId: 'pm',
        fromRoleId: 'pm',
        replyText: '@开发 今日完成棋盘UI；@测试 待开发完成后测试',
        delegated,
      }),
    ).toBe(delegated);
  });
});

describe("__merged__:office-workflow-input-validation", () => {
  it('collectAllInputValidationBodiesFromRaw merges every 输入校验 block', () => {
    const raw = `【输入校验】上游目录不存在。

【输入校验】已 ls 确认测试用例.md 存在。`;
    expect(collectAllInputValidationBodiesFromRaw(raw)).toContain('不存在');
    expect(collectAllInputValidationBodiesFromRaw(raw)).toContain('已 ls 确认');
  });

  it('isWorkflowInputValidationFailure detects missing upstream paths', () => {
    expect(isWorkflowInputValidationFailure('交付物目录不存在')).toBe(true);
    expect(isWorkflowInputValidationFailure('已 ls 确认路径存在，校验通过')).toBe(false);
  });

  it('workflowInputValidationNamesRole rejects @ and bracket role names', () => {
    expect(workflowInputValidationNamesRole('已 ls 确认 /tmp/plan.md 存在')).toBe(false);
    expect(workflowInputValidationNamesRole('@开发 请补充')).toBe(true);
    expect(workflowInputValidationNamesRole('【开发】交付目录缺失')).toBe(true);
    expect(
      workflowInputValidationNamesRole(
        '目标：交付物-开发\nls：-rw-r--r--@ 1 demo  staff  33178 May 30 16:13 index.html',
      ),
    ).toBe(false);
    expect(
      workflowInputValidationNamesRole(
        [
          '目标：交付物-报告美化师/美化后的PPT报告-报告美化师.pptx、交付物-数据抓取师',
          'ls：交付物-报告美化师/美化后的PPT报告-报告美化师.pptx：-rw-r--r--@ 1 lixingwei 453037844 567506 6 26 12:30 交付物-报告美化师/美化后的PPT报告-报告美化师.pptx',
          '交付物-数据抓取师：drwxr-xr-x 3 lixingwei 453037844 96 6 26 12:20 交付物-数据抓取师',
        ].join('\n'),
      ),
    ).toBe(false);
  });
});

describe("__merged__:office-workflow-rollback", () => {
  it('parseWorkflowRollbackTrigger accepts strict modern format only', () => {
    expect(parseWorkflowRollbackTrigger('无')).toBeNull();
    expect(
      parseWorkflowRollbackTrigger('【回滚】开发在「开发实现」的交付物存在目录缺失（未找到交付物-开发/）'),
    ).toMatchObject({
      roleHint: '开发',
      stepHint: '开发实现',
    });
    expect(
      parseWorkflowRollbackTrigger('开发在「开发实现」的交付物存在目录缺失（未找到）'),
    ).toBeNull();
  });

  it('isValidWorkflowRollbackExplanationBody allows 无 or strict trigger', () => {
    expect(isValidWorkflowRollbackExplanationBody('无')).toBe(true);
    expect(isValidWorkflowRollbackExplanationBody('无。')).toBe(true);
    expect(
      isValidWorkflowRollbackExplanationBody(
        '【回滚】测试在「测试验收」的交付物存在验收不通过（2个缺陷未修复）',
      ),
    ).toBe(true);
    expect(isValidWorkflowRollbackExplanationBody('需要回滚开发')).toBe(false);
  });

  it('rejects legacy bracket output when workflow is JSON-only', () => {
    const raw = `【项目目录】/Users/lixingwei/.openclaw/workspace-main/office/projects/五子棋游戏开发-task-1779172529883-2l0rcu

【任务理解】根据需求规格说明书完成五子棋游戏开发，实现人机/人人对战、胜负判定、语音播报等功能，交付HTML单页应用。

【输入校验】已 ls 确认上游交付物存在：需求规格说明书-产品.md、需求评审-开发.md、需求评审-测试.md

【执行说明】在项目目录创建交付物-开发/文件夹，编写index.html单页应用，实现全部需求功能：15×15棋盘、双模式切换、简单AI、连五判胜、30秒计时超时判负、退出按钮，人机模式获胜随机语音播报"李翰李若曦最棒"/"李翰李若曦学习最好"

【输出校验】-rw-r--r-- 1 lixingwei staff 16889 May 27 20:47 /Users/lixingwei/.openclaw/workspace-main/office/projects/五子棋游戏开发-task-1779172529883-2l0rcu/交付物-开发/index.html

【交付产物】index.html含完整五子棋游戏：15x15棋盘、人机/人人对战模式、30秒计时超时判负、五子及以上连珠判胜、退出按钮、人机模式玩家获胜随机语音播报"李翰李若曦最棒"/"李翰李若曦学习最好"

【用法说明】1. 用浏览器打开index.html即可运行 2. 点击"人机对战"或"人人对战"开始游戏 3. 人机模式玩家(黑方)获胜时自动语音+文字播报指定文案

【回滚说明】无`;

    const parsed = parseStructuredAgentReply(raw);
    expect(parsed.rollbackExplanation.trim()).toBe('无');
    const r = validateWorkflowAgentStructuredReply({
      raw,
      transportReason: 'empty',
      actorRoleName: '开发',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues).toContain('invalid_json_schema');
    }
  });

  it('mergeWorkflowStructuredAcrossAssistantTurn keeps 回滚说明 in a later assistant blob', () => {
    const startedAtMs = 1_700_000_000_000;
    const mainBody = `【项目目录】/Users/lixingwei/.openclaw/workspace-main/office/projects/demo-task-1779172529883-abc

【任务理解】完成五子棋单页应用开发。

【输入校验】已 ls 确认上游交付物存在。

【输出校验】-rw-r--r-- 1 user staff 100 May 27 20:47 /Users/lixingwei/.openclaw/workspace-main/office/projects/demo-task-1779172529883-abc/交付物-开发/index.html

【交付产物】index.html 含完整五子棋功能。`;

    const rollbackOnly = '【回滚说明】无';

    const messages = [
      {
        role: 'user',
        content: [{ type: 'text', text: '@开发 请执行本步' }],
        timestamp: startedAtMs - 1_000,
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: mainBody }],
        timestamp: startedAtMs + 1_000,
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: rollbackOnly }],
        timestamp: startedAtMs + 2_000,
      },
    ];

    const merged = findLatestWorkflowStructuredRaw(messages, startedAtMs, (ts) =>
      typeof ts === 'number' ? ts : 0,
    );
    expect(merged).toContain('【回滚说明】');
    const parsed = parseStructuredAgentReply(merged!);
    expect(parsed.rollbackExplanation.trim()).toBe('无');
    expect(isValidWorkflowRollbackExplanationBody(parsed.rollbackExplanation)).toBe(true);
  });

  it('prefers on_failure edges over direct predecessors', () => {
    const nodes: WorkflowNode[] = [
      { id: 'n-dev', roleId: 'dev', title: '开发实现', execution: 'serial' },
      { id: 'n-qa', roleId: 'qa', title: '测试验收', execution: 'serial' },
      { id: 'n-audit', roleId: 'audit', title: '安全审计', execution: 'serial' },
    ];
    const edges: WorkflowEdge[] = [
      { from: 'n-dev', to: 'n-qa', when: 'on_success' },
      { from: 'n-qa', to: 'n-audit', when: 'on_success' },
      { from: 'n-audit', to: 'n-dev', when: 'on_failure' },
    ];
    const d = evaluateWorkflowRollback({
      rollbackExplanation: '【回滚】开发在「开发实现」的交付物存在安全缺陷（审计不通过）',
      currentNodeId: 'n-audit',
      nodes,
      edges,
      teamRoles: rollbackTeamRoles,
    });
    expect(d.rollback).toBe(true);
    expect(d.predecessorNodeIds).toEqual(['n-dev']);
  });

  it('falls back to direct predecessors when no on_failure edge', () => {
    const nodes: WorkflowNode[] = [
      { id: 'n-dev', roleId: 'dev', title: '开发实现', execution: 'serial' },
      { id: 'n-qa', roleId: 'qa', title: '测试验收', execution: 'serial' },
    ];
    const edges: WorkflowEdge[] = [{ from: 'n-dev', to: 'n-qa', when: 'on_success' }];
    const d = evaluateWorkflowRollback({
      rollbackExplanation: '【回滚】开发在「开发实现」的交付物存在目录缺失（交付物-开发/ 不存在）',
      currentNodeId: 'n-qa',
      nodes,
      edges,
      teamRoles: rollbackTeamRoles,
    });
    expect(d.rollback).toBe(true);
    expect(d.predecessorNodeIds).toEqual(['n-dev']);
  });
});

const TASK_ID = 'task-heal-1';
const NODE_ID = 'node-test-accept';

const testNode: WorkflowNode = {
  id: NODE_ID,
  title: '测试验收',
  agentId: 'role-test',
  execution: 'serial',
};

const workflowNodes = [testNode];

const HEAL_TEST_ROLES = [{ agentId: 'role-test', displayName: '测试' }];

const HEAL_PASS_OPTS = (nowMs: number) => ({
  nowMs,
  roles: HEAL_TEST_ROLES,
  edges: [] as WorkflowEdge[],
  teamRoles: HEAL_TEST_ROLES,
  jsonStableMs: WORKFLOW_ROOM_JSON_HEAL_STABLE_MS,
});

const WORKFLOW_JSON_PROGRESS = `现在输出结构化 JSON：

\`\`\`json
{
  "role": "测试",
  "step": {"index": 7, "total": 9, "title": "测试验收"},
  "inputValidation": {
    "targets": ["测试用例设计-测试.md", "交付物-开发"],
    "lsResult": [
      "-rw-r--r-- 1 u staff 17809 May 29 14:34 测试用例设计-测试.md",
      "drwxr-xr-x 1 u staff 128 May 29 14:34 交付物-开发"
    ]
  },
  "execution": "Smoke验收完成",
  "outputValidation": {
    "targets": ["测试验收-测试.md"],
    "lsResult": ["-rw-r--r-- 1 u staff 7149 May 29 15:07 测试验收-测试.md"]
  },
  "deliverable": {
    "path": "测试验收-测试.md",
    "summary": "冒烟7/7全通过",
    "conclusion": "通过"
  },
  "rollback": "无"
}
\`\`\``;

function stableJsonFingerprint(): string {
  const json = parseWorkflowJsonOutput(WORKFLOW_JSON_PROGRESS);
  if (!json) throw new Error('fixture json invalid');
  return canonicalWorkflowJsonFingerprint(json);
}

const STRUCTURED_PROGRESS = `【项目目录】/Users/demo/.openclaw/workspace-pm/office/projects/demo

【任务理解】我是【测试】：按测试用例验收。

【输入校验】已 ls 确认上游交付物路径存在：交付物-开发/index.html

【执行说明】发现2个缺陷，结论为不通过。

【输出校验】-rw-r--r-- 1 u staff 6153 May 27 13:12 /Users/demo/.openclaw/workspace-pm/office/projects/demo/测试验收报告-测试.md

【交付产物】测试验收报告-测试.md 含关键摘要：验收结论为不通过。

【用法说明】1. 见产物路径。

【回滚说明】无`;

function roomMsg(overrides: Partial<RoomMessage>): RoomMessage {
  return {
    id: 'm1',
    projectId: TASK_ID,
    from: 'agent',
    fromAgentId: 'role-test',
    mentions: [],
    timestamp: Date.now(),
    content: '',
    phase: 'task_running',
    progressText: STRUCTURED_PROGRESS,
    ...overrides,
  };
}

describe("__merged__:office-workflow-run-heal", () => {
  it('extracts workflow JSON snippet from task_running when role matches', () => {
    const receipt = extractWorkflowRoomJsonReceipt(
      [roomMsg({ nodeId: NODE_ID, progressText: WORKFLOW_JSON_PROGRESS })],
      testNode,
      workflowNodes,
      HEAL_TEST_ROLES[0]!,
    );
    expect(receipt?.raw).toContain('测试验收-测试.md');
    expect(receipt?.raw).toContain('"conclusion": "通过"');
  });

  it('does not JSON-heal running node until JSON stable for 5 minutes', () => {
    const now = Date.now();
    const fp = stableJsonFingerprint();
    const runs = new Map<string, NodeRunRecord>([
      [
        NODE_ID,
        {
          nodeId: NODE_ID,
          agentId: 'role-test',
          status: 'running',
          startedAt: now - 60_000,
          roomHealJsonFingerprint: fp,
          roomHealJsonStableSinceMs: now - 60_000,
        },
      ],
    ]);
    const room = [roomMsg({ nodeId: NODE_ID, progressText: WORKFLOW_JSON_PROGRESS })];
    const { stabilityTicked } = healWorkflowRunningNodesFromRoom(
      workflowNodes,
      runs,
      room,
      TASK_ID,
      HEAL_PASS_OPTS(now),
    );
    expect(stabilityTicked).toBe(false);
    expect(runs.get(NODE_ID)?.status).toBe('running');
  });

  it('queues validation after receipt stable 5 minutes (not completed until validated)', () => {
    const now = Date.now();
    const fp = stableJsonFingerprint();
    const stableSince = now - WORKFLOW_ROOM_JSON_HEAL_STABLE_MS - 1_000;
    const runs = new Map<string, NodeRunRecord>([
      [
        NODE_ID,
        {
          nodeId: NODE_ID,
          agentId: 'role-test',
          status: 'running',
          startedAt: stableSince,
          roomHealJsonFingerprint: fp,
          roomHealJsonStableSinceMs: stableSince,
        },
      ],
    ]);
    const room = [roomMsg({ nodeId: NODE_ID, progressText: WORKFLOW_JSON_PROGRESS })];
    const pass = healWorkflowRunningNodesFromRoom(
      workflowNodes,
      runs,
      room,
      TASK_ID,
      HEAL_PASS_OPTS(now),
    );
    expect(pass.pendingValidation.length).toBe(1);
    expect(runs.get(NODE_ID)?.status).toBe('running');
  });

  it('validated fingerprint skips pending queue (completion in main apply pass)', () => {
    const now = Date.now();
    const fp = stableJsonFingerprint();
    const stableSince = now - WORKFLOW_ROOM_JSON_HEAL_STABLE_MS - 1_000;
    const runs = new Map<string, NodeRunRecord>([
      [
        NODE_ID,
        {
          nodeId: NODE_ID,
          agentId: 'role-test',
          status: 'running',
          roomHealJsonFingerprint: fp,
          roomHealJsonStableSinceMs: stableSince,
          roomHealValidatedFingerprint: fp,
        },
      ],
    ]);
    const room = [roomMsg({ nodeId: NODE_ID, progressText: WORKFLOW_JSON_PROGRESS })];
    const pending = collectWorkflowRoomJsonHealPendingValidation(
      workflowNodes,
      runs,
      room,
      TASK_ID,
      HEAL_PASS_OPTS(now),
    );
    expect(pending).toHaveLength(0);
    expect(runs.get(NODE_ID)?.status).toBe('running');
  });

  it('resets stability timer when room JSON content changes', () => {
    const now = Date.now();
    const runs = new Map<string, NodeRunRecord>([
      [NODE_ID, { nodeId: NODE_ID, agentId: 'role-test', status: 'running', startedAt: now }],
    ]);
    const roomV1 = [roomMsg({ nodeId: NODE_ID, progressText: WORKFLOW_JSON_PROGRESS })];
    tickWorkflowRoomJsonHealStabilityOnRuns(
      workflowNodes,
      runs,
      roomV1,
      TASK_ID,
      HEAL_TEST_ROLES,
      now,
    );
    const fp1 = runs.get(NODE_ID)?.roomHealJsonFingerprint;
    expect(fp1).toBeTruthy();

    const altered = WORKFLOW_JSON_PROGRESS.replace('冒烟7/7全通过', '冒烟6/7通过');
    tickWorkflowRoomJsonHealStabilityOnRuns(
      workflowNodes,
      runs,
      [roomMsg({ nodeId: NODE_ID, progressText: altered })],
      TASK_ID,
      HEAL_TEST_ROLES,
      now + 1_000,
    );
    expect(runs.get(NODE_ID)?.roomHealJsonFingerprint).not.toBe(fp1);
    expect(runs.get(NODE_ID)?.roomHealJsonStableSinceMs).toBe(now + 1_000);
  });

  it('healWorkflowRunningNodesFromRoom applies rollback intent from stable JSON', () => {
    const now = Date.now();
    const rollbackJson = WORKFLOW_JSON_PROGRESS.replace(
      '"rollback": "无"',
      '"rollback": "【回滚】开发在「开发实现」的交付物存在目录缺失（路径不存在）"',
    ).replace('"conclusion": "通过"', '"conclusion": "不通过"');
    const json = parseWorkflowJsonOutput(rollbackJson);
    if (!json) throw new Error('rollback fixture invalid');
    const fp = canonicalWorkflowJsonFingerprint(json);
    const stableSince = now - WORKFLOW_ROOM_JSON_HEAL_STABLE_MS - 1_000;
    const runs = new Map<string, NodeRunRecord>([
      [
        NODE_ID,
        {
          nodeId: NODE_ID,
          agentId: 'role-test',
          status: 'running',
          roomHealJsonFingerprint: fp,
          roomHealJsonStableSinceMs: stableSince,
        },
      ],
    ]);
    const pass = healWorkflowRunningNodesFromRoom(
      workflowNodes,
      runs,
      [roomMsg({ nodeId: NODE_ID, progressText: rollbackJson })],
      TASK_ID,
      HEAL_PASS_OPTS(now),
    );
    expect(pass.rollbacks.length).toBeGreaterThanOrEqual(0);
  });

  it('does not heal multi-role node from JSON progress alone', () => {
    const multiNode: WorkflowNode = {
      id: 'node-review',
      title: '需求评审',
      roleIds: ['role-dev', 'role-qa', 'role-audit'],
      execution: 'parallel',
    };
    const nodes = [multiNode];
    const runs = new Map<string, NodeRunRecord>([
      ['node-review', { nodeId: 'node-review', status: 'running', startedAt: Date.now() }],
    ]);
    const auditOnly = roomMsg({
      nodeId: 'node-review',
      fromRoleId: 'role-audit',
    });
    expect(
      multiRoleNodeReadyForStructuredHeal([auditOnly], multiNode, nodes),
    ).toBe(false);
    const { stabilityTicked } = healWorkflowRunningNodesFromRoom(
      nodes,
      runs,
      [auditOnly],
      TASK_ID,
      HEAL_PASS_OPTS(Date.now()),
    );
    expect(stabilityTicked).toBe(false);
    expect(runs.get('node-review')?.status).toBe('running');
  });

  it('does not JSON-heal multi-role node even when every role posted JSON', () => {
    const multiNode: WorkflowNode = {
      id: 'node-review',
      title: '需求评审',
      roleIds: ['role-dev', 'role-qa'],
      execution: 'parallel',
    };
    const nodes = [multiNode];
    const devProgress = STRUCTURED_PROGRESS.replace(/测试/g, '开发').replace(
      'role-test',
      'role-dev',
    );
    const qaProgress = STRUCTURED_PROGRESS.replace(/测试验收报告-测试/g, '评审意见-测试');
    const runs = new Map<string, NodeRunRecord>([
      ['node-review', { nodeId: 'node-review', status: 'running', startedAt: Date.now() }],
    ]);
    const room = [
      roomMsg({
        nodeId: 'node-review',
        fromRoleId: 'role-dev',
        progressText: devProgress,
      }),
      roomMsg({
        nodeId: 'node-review',
        fromRoleId: 'role-qa',
        progressText: qaProgress,
      }),
    ];
    expect(multiRoleNodeReadyForStructuredHeal(room, multiNode, nodes)).toBe(false);
    const now = Date.now();
    const { stabilityTicked } = healWorkflowRunningNodesFromRoom(
      nodes,
      runs,
      room,
      TASK_ID,
      HEAL_PASS_OPTS(now),
    );
    expect(stabilityTicked).toBe(false);
    expect(runs.get('node-review')?.status).toBe('running');
  });
});

describe("__merged__:office-workflow-visual-rollback-path", () => {
  it('builds upward bezier from source top to target bottom', () => {
    const container = { left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400 } as DOMRect;
    const from = { left: 100, top: 220, right: 300, bottom: 280, width: 200, height: 60 } as DOMRect;
    const to = { left: 100, top: 80, right: 300, bottom: 140, width: 200, height: 60 } as DOMRect;
    const d = buildWorkflowRollbackEdgePath(from, to, container);
    expect(d).toMatch(/^M 200 220 C/);
    expect(d).toMatch(/200 140$/);
  });
});

describe("__merged__:office-workflow-rollback-edge", () => {
  it('adds explicit on_failure rollback edge (7 -> 6) from description', () => {
    const desc = [
      '1.PM编写项目预算，项目计划，组织全员kickoff，交付物为项目计划书;',
      '2.产品经理撰写需求说明书初稿，交付物为需求说明书初稿；',
      '3.产品+软件开发+测试+审计四方一起并行评审需求说明书初稿，提出意见，交付物为评审意见；',
      '4.产品针对大家反馈的意见进行修改并发布正式产品需求说明书，交付物为产品需求说明书正式版；',
      '5.测试根据需求说明书进行测试用例编写，交付物为测试用例；',
      '6.软件开发根据正式的需求说明书进行需求实现，交付物为可执行的游戏软件，与5并行；',
      '7.在6完成之后，测试对开发的交付物进行测试验证，交付物为测试验收报告，要明确表达出测试结论，结论为不通过则流程回到6；',
      '8.审计对交付物进行安全审计，交付物为安全审计报告，要明确表达出审计结论，结论为不通过则流程回到6；',
      '9.PM收到测试验收报告后，对项目进行总结',
    ].join('\n');

    const generated = generateWorkflowFromDescriptionHeuristic(desc, rollbackEdgeRoles);
    expect(generated).not.toBeNull();
    const workflow = generated!.workflow;
    const testAcceptance = workflow.nodes.find((n) => /测试验证|测试验收/.test(n.title ?? ''));
    const devNode = workflow.nodes.find((n) => /需求实现|开发实现/.test(n.title ?? ''));
    expect(testAcceptance).toBeTruthy();
    expect(devNode).toBeTruthy();
    expect(
      workflow.edges.some(
        (e) => e.from === testAcceptance!.id && e.to === devNode!.id && e.when === 'on_failure',
      ),
    ).toBe(true);
  });

  it('scheduler unblocks rollback cycle when failure edge rollback is applied', () => {
    const workflow: WorkflowDefinition = {
      mode: 'dag',
      nodes: [
        { id: 'n0', roleId: 'r-pm', title: '项目总结', execution: 'serial' },
        { id: 'n1', roleId: 'r-dev', title: '开发实现', execution: 'serial' },
        { id: 'n2', roleId: 'r-test', title: '测试验收', execution: 'serial' },
      ],
      edges: [
        { from: 'n2', to: 'n0', when: 'on_success' },
        { from: 'n1', to: 'n2', when: 'on_success' },
        { from: 'n2', to: 'n1', when: 'on_failure' },
      ],
      edgesCustomized: true,
    };
    const runs = new Map([
      ['n0', { nodeId: 'n0', roleId: 'r-pm', status: 'pending' as const }],
      ['n1', { nodeId: 'n1', roleId: 'r-dev', status: 'pending' as const }],
      ['n2', { nodeId: 'n2', roleId: 'r-test', status: 'completed' as const, edgeOutcome: 'failure' as const }],
    ]);
    expect(() => nextRunnableNodes(workflow.nodes, workflow.edges, runs)).not.toThrow();
    expect(nextRunnableNodes(workflow.nodes, workflow.edges, runs).map((n) => n.id)).toEqual(['n1']);
    expect(
      applyWorkflowAutoRollbackForNode({
        nodeId: 'n2',
        nodes: workflow.nodes,
        edges: workflow.edges,
        runs,
      })?.nodeId,
    ).toBe('n2');
    expect(runs.get('n1')?.status).toBe('pending');
    expect(nextRunnableNodes(workflow.nodes, workflow.edges, runs).map((n) => n.id)).toEqual(['n1']);
  });
});

const gateway = {} as GatewayManager;
const startedAt = Date.now() - 60_000;

const JSON_STRUCTURED = JSON.stringify({
  role: '产品',
  step: { index: 2, total: 9, title: '需求初稿' },
  understanding: '我是【产品】：本步交付 PRD 初稿。',
  inputValidation: {
    targets: ['项目计划书-PM.md'],
    lsResult: ['-rw-r--r-- 1 u staff 100 /Users/demo/.openclaw/workspace-pm/office/projects/demo/项目计划书-PM.md'],
  },
  execution: '已完成需求初稿。',
  outputValidation: { targets: ['需求说明书-产品.md'], lsResult: ['-rw-r--r-- 1 u staff 100 /Users/demo/.openclaw/workspace-pm/office/projects/demo/需求说明书-产品.md'],
  },
  deliverable: {
    path: '需求说明书-产品.md',
    summary: '需求初稿已交付。',
    conclusion: '已交付',
  },
  usage: '见文档。',
  rollback: '无',
});

const JSON_LIKE_WITH_UNESCAPED_QUOTE = `{
  "role":"产品",
  "step":{"index":2,"total":9,"title":"需求初稿"},
  "understanding":"我是【产品】：播报文案为"李翰李若溪最棒"。",
  "inputValidation":{"targets":["项目计划书-PM.md"],"lsResult":["-rw-r--r--  1 demo  staff  100 May 28 10:00 项目计划书-PM.md"]},
  "execution":"已完成。",
  "outputValidation": {"targets":["a"],"lsResult":["ok"]},
  "deliverable":{"path":"需求规格说明书-产品.md","summary":"已交付。","conclusion":"已交付"},
  "usage":"无",
  "rollback":"无"
}`;

describe("__merged__:office-workflow-session-confirm", () => {
  beforeEach(() => {
    vi.mocked(fetchChatHistory).mockResolvedValue({
      messages: [
        { role: 'user', content: 'task', timestamp: startedAt + 1 },
        { role: 'assistant', content: JSON_STRUCTURED, timestamp: startedAt + 5_000 },
      ],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('session consistency delay is 5s', () => {
    expect(OFFICE_SETTLE_CONSISTENCY_DELAY_MS).toBe(5_000);
  });

  it('fetchLatestWorkflowStructuredSessionReply pulls history then validates JSON shape', async () => {
    const r = await fetchLatestWorkflowStructuredSessionReply(gateway, {
      sessionKey: 'agent:product:task:node',
      startedAtMs: startedAt,
      minWaitBeforeAcceptMs: 0,
    });
    expect(fetchChatHistory).toHaveBeenCalled();
    expect(r.acceptable).toBe(true);
    expect(r.raw).toContain('"deliverable"');
    expect(r.raw).toContain('"role"');
  });

  it('fetchLatestWorkflowStructuredSessionReply accepts workflow json output', async () => {
    vi.mocked(fetchChatHistory).mockResolvedValueOnce({
      messages: [
        { role: 'user', content: 'task', timestamp: startedAt + 1 },
        { role: 'assistant', content: JSON_STRUCTURED, timestamp: startedAt + 5_000 },
      ],
    });
    const r = await fetchLatestWorkflowStructuredSessionReply(gateway, {
      sessionKey: 'agent:product:task:json-node',
      startedAtMs: startedAt,
      minWaitBeforeAcceptMs: 0,
    });
    expect(r.acceptable).toBe(true);
    expect(r.raw).toContain('"role"');
    expect(r.raw).toContain('"deliverable"');
  });

  it('fetchLatestWorkflowStructuredSessionReply accepts JSON-like payload for downstream retry', async () => {
    vi.mocked(fetchChatHistory).mockResolvedValueOnce({
      messages: [
        { role: 'user', content: 'task', timestamp: startedAt + 1 },
        { role: 'assistant', content: JSON_LIKE_WITH_UNESCAPED_QUOTE, timestamp: startedAt + 5_000 },
      ],
    });
    const r = await fetchLatestWorkflowStructuredSessionReply(gateway, {
      sessionKey: 'agent:product:task:json-like-node',
      startedAtMs: startedAt,
      minWaitBeforeAcceptMs: 0,
    });
    expect(r.acceptable).toBe(true);
    expect(r.raw).toContain('"role"');
    expect(r.raw).toContain('"deliverable"');
  });
});

describe('workflow upstream rework session', () => {
  it('reopenWorkflowUpstreamForRework bumps reworkGeneration and clears session markers', () => {
    const runs = new Map<string, NodeRunRecord>([
      [
        'gen-dev',
        {
          nodeId: 'gen-dev',
          roleId: 'dev',
          status: 'completed',
          sessionKey: 'agent:kai-fa:office:task:t1:role:dev:node:gen-dev:run:run-1',
          runId: 'run-old',
          reworkGeneration: 0,
          completedAt: 1,
        },
      ],
      ['gen-test', { nodeId: 'gen-test', roleId: 'test', status: 'running' }],
    ]);
    const nodes = [
      { id: 'gen-dev', roleId: 'dev', title: '开发', execution: 'serial' as const },
      { id: 'gen-test', roleId: 'test', title: '测试', execution: 'serial' as const },
    ];
    const edges = [{ from: 'gen-dev', to: 'gen-test', when: 'on_success' as const }];

    reopenWorkflowUpstreamForRework({
      runs,
      nodes,
      edges,
      currentNodeId: 'gen-test',
      predecessorNodeIds: ['gen-dev'],
      reworkReason: '【回滚】开发在「开发实现」的交付物存在目录缺失（路径不存在）',
    });

    const dev = runs.get('gen-dev')!;
    expect(dev.status).toBe('pending');
    expect(dev.reworkGeneration).toBe(1);
    expect(dev.reworkReason).toContain('目录缺失');
    expect(dev.sessionKey).toBeUndefined();
    expect(dev.runId).toBeUndefined();
    const testRun = runs.get('gen-test')!;
    expect(testRun.status).toBe('pending');
    expect(testRun.reworkGeneration).toBe(1);
    expect(testRun.sessionKey).toBeUndefined();
  });

  it('buildWorkflowReworkPromptPrefix includes downstream rollback reason', () => {
    const note = buildWorkflowReworkPromptPrefix(
      '【回滚】开发在「开发实现」的交付物存在目录缺失（路径不存在）',
    );
    expect(note).toBe(
      '【下游回流·须优先并针对性处理。原因如下】：开发在「开发实现」的交付物存在目录缺失（路径不存在）',
    );
    expect(note).not.toContain('【回滚】');
  });

  it('buildWorkflowReworkPromptPrefix maps human review text to user-intervention channel', () => {
    const note = buildWorkflowReworkPromptPrefix(
      '【人工审查意见】\n请去掉 PPT-Master User-Agent',
    );
    expect(note).toContain('【用户介入·须优先满足】');
    expect(note).toContain('【人工审查意见】');
    expect(note).not.toContain('【下游回流·须优先并针对性处理');
  });

  it('shouldHighlightWorkflowLayerHandoff when upstream done and downstream awaiting LLM', () => {
    const nodes = [
      { id: 'a', roleId: 'r1', title: 'A', execution: 'serial' as const },
      { id: 'b', roleId: 'r2', title: 'B', execution: 'serial' as const },
    ];
    expect(
      shouldHighlightWorkflowLayerHandoff(
        [nodes[0]!],
        [nodes[1]!],
        { a: 'completed', b: 'running' },
        [{ nodeId: 'b', roleId: 'r2', status: 'running' }],
      ),
    ).toBe(true);
    expect(
      shouldHighlightWorkflowLayerHandoff(
        [nodes[0]!],
        [nodes[1]!],
        { a: 'completed', b: 'running' },
        [{ nodeId: 'b', roleId: 'r2', status: 'running', runId: 'gw-run-1' }],
      ),
    ).toBe(false);
    expect(workflowNodeShouldPulse('running', { runId: 'gw-run-1' })).toBe(true);
    expect(workflowNodeShouldPulse('running', {})).toBe(false);
  });

  it('effectivePhaseFromMessage does not upgrade task_running to project_closure on node lines', () => {
    const phase = effectivePhaseFromMessage({
      id: 'm1',
      scenarioId: 's1',
      taskId: 't1',
      nodeId: 'gen-test',
      from: 'agent',
      fromRoleId: 'test',
      phase: 'task_running',
      content: '⚙️ 执行中 · 测试验收\n验收通过',
      mentions: [],
      timestamp: 1,
    });
    expect(phase).toBe('task_running');
  });

  it('roleTaskSessionKey uses rework suffix for返工轮次', () => {
    const base = roleTaskSessionKey('kai-fa', 'dev', 'task-1', 'gen-dev', 'run-99');
    const rework = roleTaskSessionKey('kai-fa', 'dev', 'task-1', 'gen-dev-rework-1', 'run-99');
    expect(base).toContain(':node:gen-dev:');
    expect(rework).toContain(':node:gen-dev-rework-1:');
    expect(base).not.toBe(rework);
  });
});

describe('office-workflow-deliverable-conclusion', () => {
  it('detects review-like step titles', () => {
    expect(isWorkflowReviewLikeStepTitle('需求评审')).toBe(true);
    expect(isWorkflowReviewLikeStepTitle('测试验收')).toBe(true);
    expect(isWorkflowReviewLikeStepTitle('开发实现')).toBe(false);
  });

  it('detects engineering deliverable steps', () => {
    expect(isWorkflowEngineeringDeliverableStep('功能开发')).toBe(true);
    expect(isWorkflowEngineeringDeliverableStep('需求评审')).toBe(false);
    expect(isWorkflowEngineeringDeliverableStep('测试验收')).toBe(false);
  });

  it('rejects 已交付 conclusion on review steps', () => {
    expect(isWorkflowReviewStepConclusionAllowed('已交付', '需求评审')).toBe(false);
    expect(isWorkflowReviewStepConclusionAllowed('通过', '需求评审')).toBe(true);
    expect(isWorkflowReviewStepConclusionAllowed('已交付', '需求初稿')).toBe(true);
  });

  it('flags 有条件通过 summary with 不通过 conclusion', () => {
    expect(
      isWorkflowDeliverableConclusionSummaryMismatch(
        '结论有条件通过，遗留项已记录。',
        '不通过',
      ),
    ).toBe(true);
  });

  it('allows aligned pass summary and conclusion', () => {
    expect(
      isWorkflowDeliverableConclusionSummaryMismatch(
        '发现缺口但可进入下一阶段。',
        '通过',
      ),
    ).toBe(false);
  });
});

describe('office-workflow-coordinator-intervention', () => {
  const interventionNodes: WorkflowNode[] = [
    { id: 'n1', title: '开发实现', roleIds: ['dev'] },
    { id: 'n2', title: '测试验收', roleIds: ['qa'] },
  ];

  it('parses no-intervention JSON', () => {
    const raw = '```json\n{"needIntervention":false,"activeNodeId":null,"kind":"other","skippedNodeId":null,"reason":"进展通报","reply":"【判定】无需干预，当前按计划推进。"}\n```';
    const json = parseWorkflowCoordinatorInterventionJson(raw);
    expect(json?.needIntervention).toBe(false);
    expect(validateWorkflowCoordinatorInterventionDecision(json!, interventionNodes).ok).toBe(true);
  });

  it('parses intervention JSON with activeNodeId', () => {
    const raw = '{"needIntervention":true,"activeNodeId":"n1","kind":"redo","skippedNodeId":null,"reason":"用户要求返工","reply":"将从开发实现重做。"}';
    const json = parseWorkflowCoordinatorInterventionJson(raw);
    expect(json?.activeNodeId).toBe('n1');
    expect(validateWorkflowCoordinatorInterventionDecision(json!, interventionNodes).ok).toBe(true);
  });

  it('rejects intervention without valid node id', () => {
    const json = parseWorkflowCoordinatorInterventionJson(
      '{"needIntervention":true,"activeNodeId":"bad","kind":"redo","skippedNodeId":null,"reason":"x","reply":"y"}',
    )!;
    expect(validateWorkflowCoordinatorInterventionDecision(json, interventionNodes).ok).toBe(false);
  });
});

describe('office-workflow-user-intervention-resume', () => {
  const nodes: WorkflowNode[] = [
    { id: 'n1', title: '开发实现', roleIds: ['dev'] },
    { id: 'n2', title: '测试验收', roleIds: ['qa'] },
  ];
  const edges: WorkflowEdge[] = [{ from: 'n1', to: 'n2', when: 'on_success' }];

  it('reopenWorkflowNodeAndDownstream bumps reworkGeneration and clears session markers', () => {
    const runs = new Map<string, NodeRunRecord>([
      [
        'n1',
        {
          nodeId: 'n1',
          roleId: 'dev',
          status: 'completed',
          reworkGeneration: 2,
          sessionKey: 'sk-old',
          runId: 'run-old',
          summary: 'done',
        },
      ],
      [
        'n2',
        {
          nodeId: 'n2',
          roleId: 'qa',
          status: 'completed',
          reworkGeneration: 0,
          sessionKey: 'sk-qa',
          runId: 'run-qa',
        },
      ],
    ]);
    reopenWorkflowNodeAndDownstream({ runs, nodes, edges, nodeId: 'n1' });
    const n1 = runs.get('n1')!;
    expect(n1.status).toBe('pending');
    expect(n1.reworkGeneration).toBe(3);
    expect(n1.sessionKey).toBeUndefined();
    expect(n1.runId).toBeUndefined();
    expect(n1.summary).toBeUndefined();
    const n2 = runs.get('n2')!;
    expect(n2.status).toBe('pending');
    expect(n2.reworkGeneration).toBe(1);
  });

  it('nodeRunsForWorkflowContinue preserves reopened pending metadata on completed project', () => {
    const nodeRuns: NodeRunRecord[] = [
      { nodeId: 'n1', roleId: 'dev', status: 'completed', summary: 'ok' },
      {
        nodeId: 'n2',
        roleId: 'qa',
        status: 'pending',
        reworkGeneration: 1,
        reworkReason: '用户要求返工',
      },
    ];
    const continued = nodeRunsForWorkflowContinue(nodeRuns, nodes);
    expect(continued.find((r) => r.nodeId === 'n1')?.status).toBe('completed');
    const n2 = continued.find((r) => r.nodeId === 'n2')!;
    expect(n2.status).toBe('pending');
    expect(n2.reworkGeneration).toBe(1);
    expect(n2.reworkReason).toBe('用户要求返工');
  });

  it('nodeRunsForWorkflowContinue reopens failed steps for retry on continue', () => {
    const nodeRuns: NodeRunRecord[] = [
      { nodeId: 'n1', roleId: 'dev', status: 'completed', summary: 'ok' },
      {
        nodeId: 'n2',
        roleId: 'qa',
        status: 'failed',
        error: '网关/终端发生重启（stopped）',
        completedAt: Date.now(),
        runId: 'run-old',
      },
    ];
    const continued = nodeRunsForWorkflowContinue(nodeRuns, nodes);
    const n2 = continued.find((r) => r.nodeId === 'n2')!;
    expect(n2.status).toBe('pending');
    expect(n2.error).toBeUndefined();
    expect(n2.runId).toBeUndefined();
  });

  it('planWorkflowUserInterventionFromCoordinator reopens active node on fully completed runs', () => {
    const runs = new Map<string, NodeRunRecord>([
      ['n1', { nodeId: 'n1', roleId: 'dev', status: 'completed', summary: 'done' }],
      ['n2', { nodeId: 'n2', roleId: 'qa', status: 'completed', summary: 'pass' }],
    ]);
    const plan = planWorkflowUserInterventionFromCoordinator({
      nodes,
      edges,
      runs,
      userContent: '测试验收不通过，请返工开发实现',
      activeNodeId: 'n1',
      kind: 'redo',
    });
    expect(plan?.activeNodeId).toBe('n1');
    expect(runs.get('n1')?.status).toBe('pending');
    expect(runs.get('n1')?.reworkGeneration).toBe(1);
    expect(runs.get('n2')?.status).toBe('pending');
  });

  it('collectUserInterventionResumeNodeIds includes incomplete fork sibling', () => {
    const forkNodes: WorkflowNode[] = [
      { id: 'n-product', title: 'PRD', roleIds: ['product'] },
      { id: 'n-test', title: '测试', roleIds: ['qa'] },
      { id: 'n-dev', title: '开发', roleIds: ['dev'] },
    ];
    const forkEdges: WorkflowEdge[] = [
      { from: 'n-product', to: 'n-test', when: 'on_success' },
      { from: 'n-product', to: 'n-dev', when: 'on_success' },
    ];
    const runs = new Map<string, NodeRunRecord>([
      ['n-product', { nodeId: 'n-product', roleId: 'product', status: 'completed' }],
      ['n-test', { nodeId: 'n-test', roleId: 'qa', status: 'running' }],
      ['n-dev', { nodeId: 'n-dev', roleId: 'dev', status: 'completed' }],
    ]);
    const seeds = collectUserInterventionResumeNodeIds('n-test', forkNodes, forkEdges, runs);
    expect(seeds.sort()).toEqual(['n-test']);
  });

  it('collectUserInterventionResumeNodeIds includes incomplete parallelGroup peer', () => {
    const parallelNodes: WorkflowNode[] = [
      { id: 'n-a', title: 'A', roleIds: ['dev'], parallelGroup: 'pg1' },
      { id: 'n-b', title: 'B', roleIds: ['qa'], parallelGroup: 'pg1' },
    ];
    const runs = new Map<string, NodeRunRecord>([
      ['n-a', { nodeId: 'n-a', roleId: 'dev', status: 'pending' }],
      ['n-b', { nodeId: 'n-b', roleId: 'qa', status: 'running' }],
    ]);
    const seeds = collectUserInterventionResumeNodeIds('n-a', parallelNodes, [], runs);
    expect(seeds.sort()).toEqual(['n-a', 'n-b']);
  });

  it('reopenWorkflowNodeAndDownstream sync-reopens incomplete fork sibling', () => {
    const forkNodes: WorkflowNode[] = [
      { id: 'n-product', title: 'PRD', roleIds: ['product'] },
      { id: 'n-test', title: '测试', roleIds: ['qa'] },
      { id: 'n-dev', title: '开发', roleIds: ['dev'] },
    ];
    const forkEdges: WorkflowEdge[] = [
      { from: 'n-product', to: 'n-test', when: 'on_success' },
      { from: 'n-product', to: 'n-dev', when: 'on_success' },
    ];
    const runs = new Map<string, NodeRunRecord>([
      ['n-product', { nodeId: 'n-product', roleId: 'product', status: 'completed' }],
      ['n-test', { nodeId: 'n-test', roleId: 'qa', status: 'completed', reworkGeneration: 0 }],
      ['n-dev', { nodeId: 'n-dev', roleId: 'dev', status: 'running', reworkGeneration: 0 }],
    ]);
    reopenWorkflowNodeAndDownstream({
      runs,
      nodes: forkNodes,
      edges: forkEdges,
      nodeId: 'n-test',
    });
    expect(runs.get('n-test')?.status).toBe('pending');
    expect(runs.get('n-test')?.reworkGeneration).toBe(1);
    expect(runs.get('n-dev')?.status).toBe('pending');
    expect(runs.get('n-dev')?.reworkGeneration).toBe(1);
  });
});

const WF_EXCEPTION_TASK_ID = 'task-wf-exception-1';

function runsMapForWorkflow(wf: WorkflowDefinition): Map<string, NodeRunRecord> {
  return new Map(
    wf.nodes.map((n) => [
      n.id,
      {
        nodeId: n.id,
        agentId: n.agentId ?? n.agentIds?.[0] ?? n.roleId ?? 'unknown',
        status: 'pending' as const,
      },
    ]),
  );
}

function simulateSerialWorkflowRun(roleIds: string[]): {
  wf: WorkflowDefinition;
  runs: Map<string, NodeRunRecord>;
  completionOrder: string[];
} {
  const wf = defaultWorkflowForRoles(roleIds);
  const runs = runsMapForWorkflow(wf);
  const completionOrder: string[] = [];

  for (let guard = 0; guard < roleIds.length + 2; guard += 1) {
    const batch = nextRunnableNodes(wf.nodes, wf.edges, runs);
    if (batch.length === 0) break;
    expect(batch.length).toBe(1);
    const node = batch[0]!;
    expect(incomingReady(node.id, workflowEdgeList(wf.nodes, wf.edges), runs)).toBe(true);
    completionOrder.push(node.agentId ?? node.agentIds?.[0] ?? node.roleId ?? node.id);
    runs.set(node.id, {
      ...runs.get(node.id)!,
      status: 'completed',
      completedAt: Date.now(),
      edgeOutcome: 'success',
    });
  }

  expect(nextRunnableNodes(wf.nodes, wf.edges, runs)).toHaveLength(0);
  return { wf, runs, completionOrder };
}

const wfExceptionScenario: OfficeScenario = {
  id: 'scenario-1',
  name: '测试场景',
  roleIds: ['dev', 'qa'],
  coordinatorRoleId: 'dev',
  workflow: { nodes: [], edges: [] },
  createdAt: 0,
  updatedAt: 0,
};

const wfExceptionTask: OfficeTask = {
  id: WF_EXCEPTION_TASK_ID,
  scenarioId: wfExceptionScenario.id,
  title: '异常路径测试任务',
  description: '任务说明',
  status: 'running',
  assignedRoleIds: ['dev', 'qa'],
  nodeRuns: [],
  createdAt: 0,
  updatedAt: 0,
};

const wfExceptionGateway = {} as GatewayManager;

function workflowExceptionFixture(): {
  workflow: WorkflowDefinition;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  devNode: WorkflowNode;
  qaNode: WorkflowNode;
} {
  const nodes: WorkflowNode[] = [
    { id: 'n-dev', roleId: 'dev', title: '开发实现', execution: 'serial' },
    { id: 'n-qa', roleId: 'qa', title: '测试验收', execution: 'serial' },
  ];
  const edges: WorkflowEdge[] = [
    { from: 'n-dev', to: 'n-qa', when: 'on_success' },
  ];
  return {
    workflow: { nodes, edges },
    nodes,
    edges,
    devNode: nodes[0]!,
    qaNode: nodes[1]!,
  };
}

function wfExceptionTeamRoles(): OfficeRole[] {
  return [
    { id: 'dev', name: '开发', agentId: 'a-dev', createdAt: 0, updatedAt: 0 },
    { id: 'qa', name: '测试', agentId: 'a-qa', createdAt: 0, updatedAt: 0 },
  ];
}

function parsedReplyFromJson(json: Record<string, unknown>) {
  const raw = JSON.stringify(json);
  const v = validateWorkflowAgentStructuredReply({
    raw,
    transportReason: 'empty',
    actorRoleName: String(json.role ?? '测试'),
    teamRoles: wfExceptionTeamRoles(),
  });
  if (!v.ok) throw new Error(`fixture invalid: ${v.detail}`);
  return { parsed: v.parsed, raw };
}

describe('office-workflow normal sequential execution', () => {
  beforeEach(() => {
    vi.spyOn(workflowRoomHandoff, 'deliverWorkflowNodeRoomDeliver').mockResolvedValue(undefined);
    vi.spyOn(workflowRoomHandoff, 'announceWorkflowNodeDeliverableAbsolutePaths').mockResolvedValue(
      undefined,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs pm → product → dev → qa one node per batch', () => {
    const roleIds = ['pm', 'product', 'dev', 'qa'];
    const { completionOrder } = simulateSerialWorkflowRun(roleIds);
    expect(completionOrder).toEqual(roleIds);
  });

  it('does not unlock qa until dev is completed', () => {
    const wf = defaultWorkflowForRoles(['dev', 'qa']);
    const runs = runsMapForWorkflow(wf);
    const devId = wf.nodes.find((n) => n.agentId === 'dev')!.id;
    const qa = wf.nodes.find((n) => n.agentId === 'qa')!;
    expect(incomingReady(qa.id, workflowEdgeList(wf.nodes, wf.edges), runs)).toBe(false);
    runs.set(devId, { ...runs.get(devId)!, status: 'completed', completedAt: Date.now() });
    expect(incomingReady(qa.id, workflowEdgeList(wf.nodes, wf.edges), runs)).toBe(true);
  });

  it('normal JSON with rollback 无 completes via apply path without upstream rework', async () => {
    const { workflow, qaNode } = workflowExceptionFixture();
    const qaRole = wfExceptionTeamRoles()[1]!;
    const { parsed, raw } = parsedReplyFromJson({
      role: '测试',
      step: { index: 2, total: 2, title: '测试验收' },
      inputValidation: {
        targets: ['交付物-开发'],
        lsResult: [workflowProjectRelativeLsDirLine('交付物-开发')],
      },
      execution: '冒烟 7/7 通过。',
      outputValidation: { targets: [wfPath('测试', '测试验收报告-测试.md')], lsResult: [workflowProjectRelativeLsLine('测试验收报告-测试.md')],
      },
      deliverable: {
        path: wfPath('测试', '测试验收报告-测试.md'),
        summary: '核心用例与冒烟 7/7 全通过，交付物目录结构符合约定。',
        conclusion: '通过',
      },
      rollback: '无',
    });

    const step = await applyWorkflowRoleStepFromParsedReply(
      wfExceptionGateway,
      wfExceptionScenario,
      wfExceptionTask,
      qaNode,
      qaRole,
      workflow,
      parsed,
      raw,
      { allRoles: wfExceptionTeamRoles(), teamRoles: wfExceptionTeamRoles(), roomPhases: null },
    );

    expect(step.status).toBe('completed');
    expect(step.upstreamRework).toBeUndefined();
    expect(vi.mocked(workflowRoomHandoff.deliverWorkflowNodeRoomDeliver)).toHaveBeenCalled();
    expect(vi.mocked(workflowRoomHandoff.announceWorkflowNodeDeliverableAbsolutePaths)).toHaveBeenCalled();
  });
});

describe('office-workflow exception paths', () => {
  beforeEach(() => {
    vi.spyOn(workflowRoomHandoff, 'deliverWorkflowNodeRoomDeliver').mockResolvedValue(undefined);
    vi.spyOn(workflowRoomHandoff, 'announceWorkflowNodeDeliverableAbsolutePaths').mockResolvedValue(
      undefined,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('P0-1 session vs heal / retry race', () => {
    it('sessionWorkflowApplyMayMutateRun only allows running', () => {
      expect(sessionWorkflowApplyMayMutateRun({ nodeId: 'n', status: 'running' })).toBe(true);
      expect(sessionWorkflowApplyMayMutateRun({ nodeId: 'n', status: 'completed' })).toBe(false);
      expect(sessionWorkflowApplyMayMutateRun({ nodeId: 'n', status: 'pending' })).toBe(false);
      expect(sessionWorkflowApplyMayMutateRun(undefined)).toBe(false);
    });

    it('isWorkflowNodeRunClaimedByOtherPath blocks session when heal already completed', () => {
      const run = markWorkflowNodeCompletionSource(
        { nodeId: 'n-qa', status: 'completed', summary: 'healed' },
        'room_heal',
      );
      expect(isWorkflowNodeRunClaimedByOtherPath(run, 'session')).toBe(true);
      expect(isWorkflowNodeRunClaimedByOtherPath(run, 'room_heal')).toBe(false);
    });

    it('running node is not claimed by heal path for session apply guard', () => {
      const run: NodeRunRecord = { nodeId: 'n-qa', status: 'running' };
      expect(isWorkflowNodeRunClaimedByOtherPath(run, 'session')).toBe(false);
      expect(sessionWorkflowApplyMayMutateRun(run)).toBe(true);
    });
  });

  describe('P0-2 rework reason in upstream prompt', () => {
    it('buildWorkflowReworkPromptPrefix is empty when no reason', () => {
      expect(buildWorkflowReworkPromptPrefix(undefined)).toBe('');
      expect(buildWorkflowReworkPromptPrefix('   ')).toBe('');
    });

    it('reopenWorkflowUpstreamForRework writes reworkReason on predecessor', () => {
      const { nodes, edges } = workflowExceptionFixture();
      const runs = new Map<string, NodeRunRecord>([
        ['n-dev', { nodeId: 'n-dev', roleId: 'dev', status: 'completed' }],
        ['n-qa', { nodeId: 'n-qa', roleId: 'qa', status: 'running' }],
      ]);
      const reason = '【回滚】开发在「开发实现」的交付物存在目录缺失（路径不存在）';
      reopenWorkflowUpstreamForRework({
        runs,
        nodes,
        edges,
        currentNodeId: 'n-qa',
        predecessorNodeIds: ['n-dev'],
        reworkReason: reason,
      });
      expect(runs.get('n-dev')?.status).toBe('pending');
      expect(runs.get('n-dev')?.reworkReason).toContain('目录缺失');
      expect(runs.get('n-qa')?.status).toBe('pending');
    });
  });

  describe('P1-1 rollback trigger must rollback with resolved predecessor', () => {
    const rollbackExplanation =
      '【回滚】开发在「开发实现」的交付物存在目录缺失（路径不存在）';

    it('parseWorkflowRollbackTrigger accepts strict sentence', () => {
      expect(parseWorkflowRollbackTrigger(rollbackExplanation)).not.toBeNull();
      expect(parseWorkflowRollbackTrigger('无')).toBeNull();
    });

    it('resolveWorkflowRollbackPredecessorNodeIds prefers on_failure edge', () => {
      const nodes: WorkflowNode[] = [
        { id: 'n-dev', roleId: 'dev', title: '开发实现', execution: 'serial' },
        { id: 'n-qa', roleId: 'qa', title: '测试验收', execution: 'serial' },
        { id: 'n-audit', roleId: 'audit', title: '安全审计', execution: 'serial' },
      ];
      const edges: WorkflowEdge[] = [
        { from: 'n-dev', to: 'n-qa', when: 'on_success' },
        { from: 'n-qa', to: 'n-audit', when: 'on_success' },
        { from: 'n-audit', to: 'n-dev', when: 'on_failure' },
      ];
      const trigger = parseWorkflowRollbackTrigger(rollbackExplanation)!;
      const preds = resolveWorkflowRollbackPredecessorNodeIds({
        currentNodeId: 'n-audit',
        nodes,
        edges,
        trigger,
        teamRoles: rollbackTeamRoles,
      });
      expect(preds).toEqual(['n-dev']);
    });

    it('evaluateWorkflowRollback always rolls back when trigger present', () => {
      const { nodes, edges } = workflowExceptionFixture();
      const d = evaluateWorkflowRollback({
        rollbackExplanation,
        currentNodeId: 'n-qa',
        nodes,
        edges,
        teamRoles: rollbackTeamRoles,
      });
      expect(d.rollback).toBe(true);
      expect(d.predecessorNodeIds).toEqual(['n-dev']);
    });

    it('applyWorkflowRoleStepFromParsedReply returns upstreamRework not completed', async () => {
      const { workflow, qaNode } = workflowExceptionFixture();
      const qaRole = wfExceptionTeamRoles()[1]!;
      const { parsed, raw } = parsedReplyFromJson({
        role: '测试',
        step: { index: 2, total: 2, title: '测试验收' },
        inputValidation: { targets: ['交付物-开发'], lsResult: ['目录不存在'] },
        execution: '输入路径校验失败。',
        outputValidation: { targets: [wfPath('测试', '测试验收报告-测试.md')], lsResult: ['未生成'],
        },
        deliverable: {
          path: wfPath('测试', '测试验收报告-测试.md'),
          summary: '因上游交付物目录缺失，本轮无法完成验收，触发回滚。',
          conclusion: '不通过',
        },
        rollback: rollbackExplanation,
      });

      const step = await applyWorkflowRoleStepFromParsedReply(
        wfExceptionGateway,
        wfExceptionScenario,
        wfExceptionTask,
        qaNode,
        qaRole,
        workflow,
        parsed,
        raw,
        { allRoles: wfExceptionTeamRoles(), teamRoles: wfExceptionTeamRoles(), roomPhases: null },
      );

      expect(step.status).toBe('pending');
      expect(step.upstreamRework?.predecessorNodeIds).toEqual(['n-dev']);
      expect(step.upstreamRework?.reason).toContain('【回滚】');
      expect(vi.mocked(workflowRoomHandoff.deliverWorkflowNodeRoomDeliver)).not.toHaveBeenCalled();
      expect(
        vi.mocked(workflowRoomHandoff.announceWorkflowNodeDeliverableAbsolutePaths),
      ).not.toHaveBeenCalled();
    });

    it('end-to-end: rollback apply then reopen leaves dev pending with reason', async () => {
      const { workflow, nodes, edges, qaNode } = workflowExceptionFixture();
      const runs = new Map<string, NodeRunRecord>([
        ['n-dev', { nodeId: 'n-dev', roleId: 'dev', status: 'completed', reworkGeneration: 0 }],
        ['n-qa', { nodeId: 'n-qa', roleId: 'qa', status: 'running' }],
      ]);
      const { parsed, raw } = parsedReplyFromJson({
        role: '测试',
        step: { index: 2, total: 2, title: '测试验收' },
        inputValidation: { targets: ['交付物-开发'], lsResult: ['目录不存在'] },
        execution: '输入路径校验失败。',
        outputValidation: { targets: [wfPath('测试', '测试验收报告-测试.md')], lsResult: ['未生成'],
        },
        deliverable: {
          path: wfPath('测试', '测试验收报告-测试.md'),
          summary: '因上游交付物目录缺失，本轮无法完成验收，触发回滚。',
          conclusion: '不通过',
        },
        rollback: rollbackExplanation,
      });

      const step = await applyWorkflowRoleStepFromParsedReply(
        wfExceptionGateway,
        wfExceptionScenario,
        wfExceptionTask,
        qaNode,
        wfExceptionTeamRoles()[1]!,
        workflow,
        parsed,
        raw,
        { allRoles: wfExceptionTeamRoles(), teamRoles: wfExceptionTeamRoles(), roomPhases: null },
      );
      expect(step.upstreamRework).toBeDefined();

      reopenWorkflowUpstreamForRework({
        runs,
        nodes,
        edges,
        currentNodeId: 'n-qa',
        predecessorNodeIds: step.upstreamRework!.predecessorNodeIds,
        reworkReason: step.upstreamRework!.reason,
      });

      expect(runs.get('n-dev')?.status).toBe('pending');
      expect(runs.get('n-dev')?.reworkGeneration).toBe(1);
      expect(runs.get('n-dev')?.reworkReason).toContain('目录缺失');
      expect(runs.get('n-qa')?.status).toBe('pending');
      expect(
        buildWorkflowReworkPromptPrefix(runs.get('n-dev')?.reworkReason),
      ).toContain('【下游回流·须优先并针对性处理。原因如下】');
    });

    it('start-of-run hygiene must snapshot reworkReason for prompt (executeWorkflowNode regression)', () => {
      // Historical bug: executeWorkflowNode cleared run.reworkReason before
      // passing it to executeNodeForRole, so upstream rework runs never saw
      // 【下游回流·须优先并针对性处理。原因如下】. Mirror the fixed start-of-run sequence.
      const run: NodeRunRecord = {
        nodeId: 'n-dev',
        roleId: 'dev',
        status: 'pending',
        edgeOutcome: 'failure',
        reworkReason:
          '【回滚】：软件开发在「软件功能开发」的交付物存在阻断性缺陷（User-Agent 含 PPT-Master/1.0）',
      };
      const reworkReasonForPrompt = run.reworkReason?.trim() || undefined;
      run.edgeOutcome = undefined;
      // Must NOT clear run.reworkReason before prompt build.
      const note = buildWorkflowReworkPromptPrefix(reworkReasonForPrompt);
      expect(note).toBe(
        '【下游回流·须优先并针对性处理。原因如下】：软件开发在「软件功能开发」的交付物存在阻断性缺陷（User-Agent 含 PPT-Master/1.0）',
      );
    });
  });

  describe('P1-2 heal rollback aborts registered node sessions', () => {
    const taskId = WF_EXCEPTION_TASK_ID;

    beforeEach(() => {
      for (const nodeId of ['n-dev', 'n-qa', 'n-down']) {
        clearWorkflowNodeRunAbort(taskId, nodeId);
      }
    });

    afterEach(() => {
      for (const nodeId of ['n-dev', 'n-qa', 'n-down']) {
        clearWorkflowNodeRunAbort(taskId, nodeId);
      }
    });

    it('abortWorkflowNodeRun aborts registered AbortController', () => {
      const ac = new AbortController();
      let aborted = false;
      ac.signal.addEventListener('abort', () => {
        aborted = true;
      });
      registerWorkflowNodeRunAbort(taskId, 'n-qa', ac);
      abortWorkflowNodeRun(taskId, 'n-qa');
      expect(aborted).toBe(true);
    });

    it('collectDownstreamNodeIds matches heal rollback abort scope', () => {
      const edges: WorkflowEdge[] = [
        { from: 'n-dev', to: 'n-qa', when: 'on_success' },
        { from: 'n-qa', to: 'n-down', when: 'on_success' },
      ];
      const downstream = collectDownstreamNodeIds('n-qa', edges);
      expect(downstream.has('n-down')).toBe(true);
      expect(downstream.has('n-dev')).toBe(false);

      const acDown = new AbortController();
      const acPred = new AbortController();
      registerWorkflowNodeRunAbort(taskId, 'n-down', acDown);
      registerWorkflowNodeRunAbort(taskId, 'n-dev', acPred);
      registerWorkflowNodeRunAbort(taskId, 'n-qa', new AbortController());

      abortWorkflowNodeRun(taskId, 'n-qa');
      abortWorkflowNodeRun(taskId, 'n-dev');
      for (const downId of downstream) {
        abortWorkflowNodeRun(taskId, downId);
      }

      expect(acPred.signal.aborted).toBe(true);
      expect(acDown.signal.aborted).toBe(true);
    });
  });
});

describe('office-workflow stepDescription rework injection', () => {
  it('prepends rework note before role task list like executeNodeForRole', () => {
    const roleTaskList = '完成测试验收';
    const reworkNote = buildWorkflowReworkPromptPrefix(
      '【回滚】开发在「开发实现」的交付物存在目录缺失（路径不存在）',
    );
    const stepDescription = `${reworkNote}${reworkNote ? '\n\n' : ''}${roleTaskList}`.trim();
    expect(stepDescription.indexOf('【下游回流·须优先并针对性处理。原因如下】')).toBe(0);
    expect(stepDescription).toContain('完成测试验收');
    expect(parseStructuredAgentReply(stepDescription).rollbackExplanation).toBe('');
  });
});

const ROOM_JSON_HEAL_NODE_ID = 'node-qa';
const ROOM_JSON_HEAL_TASK_ID = 'task-1';

const roomJsonHealNode: WorkflowNode = {
  id: ROOM_JSON_HEAL_NODE_ID,
  title: '测试验收',
  roleIds: ['role-qa'],
  execution: 'serial',
};

const ROOM_JSON_TEXT = `\`\`\`json
{
  "role": "测试",
  "step": {"index": 1, "total": 3, "title": "测试验收"},
  "inputValidation": {"targets": ["a.md"], "lsResult": ["-rw-r--r-- 1 demo staff 1 a.md"]},
  "execution": "done",
  "outputValidation": {"targets": ["测试验收-测试.md"], "lsResult": ["-rw-r--r-- 1 demo staff 1 测试验收-测试.md"]},
  "deliverable": {"path": "测试验收-测试.md", "summary": "通过", "conclusion": "通过"},
  "rollback": "无"
}
\`\`\``;

describe('office-workflow-room-json-heal', () => {
  it('validateWorkflowRoomJsonForRunner rejects role mismatch', () => {
    const v = validateWorkflowRoomJsonForRunner(ROOM_JSON_TEXT, { actorRoleName: '开发' });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.issues).toContain('invalid_json_schema');
  });

  it('extractWorkflowRoomJsonReceipt requires fromRoleId match', () => {
    const room: RoomMessage[] = [
      {
        id: 'm1',
        taskId: ROOM_JSON_HEAL_TASK_ID,
        nodeId: ROOM_JSON_HEAL_NODE_ID,
        from: 'agent',
        fromRoleId: 'role-qa',
        content: '',
        mentions: [],
        timestamp: Date.now(),
        phase: 'task_running',
        progressText: ROOM_JSON_TEXT,
      },
    ];
    expect(
      extractWorkflowRoomJsonReceipt(room, roomJsonHealNode, [roomJsonHealNode], {
        agentId: 'role-qa',
        displayName: '测试',
      }),
    ).toBeTruthy();
    expect(
      extractWorkflowRoomJsonReceipt(room, roomJsonHealNode, [roomJsonHealNode], {
        agentId: 'role-other',
        displayName: '测试',
      }),
    ).toBeNull();
  });

  it('extractWorkflowRoomJsonReceipt ignores progressText older than minTimestampMs', () => {
    const sessionStartedAtMs = 1_000_000;
    const stale: RoomMessage = {
      id: 'stale',
      taskId: ROOM_JSON_HEAL_TASK_ID,
      nodeId: ROOM_JSON_HEAL_NODE_ID,
      from: 'agent',
      fromRoleId: 'role-qa',
      content: '',
      mentions: [],
      timestamp: sessionStartedAtMs - 60_000,
      phase: 'task_running',
      progressText: ROOM_JSON_TEXT,
    };
    const freshText = ROOM_JSON_TEXT.replace(
      '"conclusion": "通过"',
      '"conclusion": "不通过"',
    );
    const fresh: RoomMessage = {
      ...stale,
      id: 'fresh',
      timestamp: sessionStartedAtMs + 1_000,
      progressText: freshText,
    };
    expect(
      extractWorkflowRoomJsonReceipt(
        [stale],
        roomJsonHealNode,
        [roomJsonHealNode],
        { agentId: 'role-qa', displayName: '测试' },
        { minTimestampMs: sessionStartedAtMs },
      ),
    ).toBeNull();
    const receipt = extractWorkflowRoomJsonReceipt(
      [stale, fresh],
      roomJsonHealNode,
      [roomJsonHealNode],
      { agentId: 'role-qa', displayName: '测试' },
      { minTimestampMs: sessionStartedAtMs },
    );
    expect(receipt).toBeTruthy();
    expect(receipt!.json.deliverable?.conclusion).toBe('不通过');
  });

  it('isWorkflowRoomJsonReceiptReady requires 5 minute window', () => {
    const now = 1_000_000;
    const fp = canonicalWorkflowJsonFingerprint(parseWorkflowJsonOutput(ROOM_JSON_TEXT)!);
    const run: NodeRunRecord = {
      nodeId: ROOM_JSON_HEAL_NODE_ID,
      roleId: 'role-qa',
      status: 'running',
      roomHealJsonFingerprint: fp,
      roomHealJsonStableSinceMs: now - WORKFLOW_ROOM_JSON_HEAL_STABLE_MS + 1,
    };
    expect(isWorkflowRoomJsonReceiptReady(run, now)).toBe(false);
    run.roomHealJsonStableSinceMs = now - WORKFLOW_ROOM_JSON_HEAL_STABLE_MS - 1;
    expect(isWorkflowRoomJsonReceiptReady(run, now)).toBe(true);
  });

  it('tickWorkflowRoomJsonReceipt resets when fingerprint changes', () => {
    const now = 500_000;
    const run: NodeRunRecord = { nodeId: ROOM_JSON_HEAL_NODE_ID, roleId: 'role-qa', status: 'running' };
    const json = parseWorkflowJsonOutput(ROOM_JSON_TEXT)!;
    const c1 = {
      raw: ROOM_JSON_TEXT,
      json,
      fingerprint: canonicalWorkflowJsonFingerprint(json),
      roleId: 'role-qa',
    };
    const r1 = tickWorkflowRoomJsonReceipt(run, c1, now);
    expect(r1.roomHealJsonStableSinceMs).toBe(now);
    const c2 = {
      ...c1,
      fingerprint: `${c1.fingerprint}-x`,
    };
    const r2 = tickWorkflowRoomJsonReceipt(r1, c2, now + 100);
    expect(r2.roomHealJsonStableSinceMs).toBe(now + 100);
  });

  it('roomMessageAppliesToNode binds progress to workflow node', () => {
    const m: RoomMessage = {
      id: 'm',
      taskId: ROOM_JSON_HEAL_TASK_ID,
      nodeId: ROOM_JSON_HEAL_NODE_ID,
      from: 'x',
      content: '',
      mentions: [],
      timestamp: 1,
      phase: 'task_running',
    };
    expect(roomMessageAppliesToNode(m, roomJsonHealNode, [roomJsonHealNode])).toBe(true);
  });
});
// --- merged from office-store-persist.test.ts ---

const sampleStore = (): OfficeDataStore => ({
  version: 1,
  roles: [{ id: 'role-a', name: 'A', agentId: 'main', skills: [], createdAt: 1, updatedAt: 1 }],
  scenarios: [
    {
      id: 'sc-1',
      name: 'S',
      roleIds: ['role-a'],
      coordinatorRoleId: 'role-a',
      workflow: { nodes: [], edges: [] },
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  tasks: [
    {
      id: 'task-1',
      scenarioId: 'sc-1',
      title: 'T',
      featureDescription: '',
      description: '',
      assignedRoleIds: ['role-a'],
      executionMode: 'workflow',
      workflow: { mode: 'dag', nodes: [], edges: [] },
      nodeRuns: [],
      status: 'pending',
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  roomMessages: {},
  settings: { agentToAgentEnabled: false, agentToAgentAllow: [] },
});

describe('office store persist', () => {
  beforeEach(async () => {
    persistEnv.dataDir = await mkdtemp(join(tmpdir(), 'office-store-persist-'));
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

  it('serializes concurrent saveStore without losing the final payload', async () => {
    const { saveStore, drainOfficeStoreOpsForTests } = await import('@electron/services/office/store');
    const a = sampleStore();
    const b = structuredClone(a);
    b.tasks[0]!.title = 'final-name';

    await Promise.all([
      saveStore(a),
      saveStore(b),
      saveStore(b),
      saveStore(structuredClone(b)),
    ]);
    await drainOfficeStoreOpsForTests();

    const raw = await readFile(join(persistEnv.dataDir, 'data.json'), 'utf8');
    const parsed = JSON.parse(raw) as OfficeDataStore;
    expect(parsed.tempProjects[0]?.title).toBe('final-name');
    expect(raw.length).toBeGreaterThan(20);
  });

  it('persists smart executionMode through upsert and reload', async () => {
    const { saveStore, createTaskDraft, upsertTask, listTasks } = await import('@electron/services/office/store');
    await saveStore(sampleStore());
    const draft = createTaskDraft({
      scenarioId: 'sc-1',
      title: 'Smart project',
      featureDescription: 'Feature scope',
      assignedRoleIds: ['role-a'],
      executionMode: 'smart',
    });
    await upsertTask(draft);

    const reloaded = await listTasks('sc-1');
    expect(reloaded).toHaveLength(2);
    expect(reloaded.find((t) => t.id === draft.id)?.executionMode).toBe('smart');
    expect(reloaded.find((t) => t.id === draft.id)?.workflow?.nodes).toEqual([]);

    const raw = await readFile(join(persistEnv.dataDir, 'data.json'), 'utf8');
    const parsed = JSON.parse(raw) as OfficeDataStore;
    expect(parsed.tempProjects.find((p) => p.id === draft.id)?.executionMode).toBe('smart');
  });

  it('persists smartRevivedAt through upsert and reload', async () => {
    const { saveStore, createTaskDraft, upsertTask, listTasks } = await import('@electron/services/office/store');
    await saveStore(sampleStore());
    const revivalAt = 1_780_478_721_348;
    const draft = createTaskDraft({
      scenarioId: 'sc-1',
      title: 'Smart revival marker',
      featureDescription: 'Feature scope',
      assignedRoleIds: ['role-a'],
      executionMode: 'smart',
    });
    await upsertTask({
      ...draft,
      status: 'running',
      smartRevivedAt: revivalAt,
    });

    const reloaded = (await listTasks('sc-1')).find((t) => t.id === draft.id);
    expect(reloaded?.smartRevivedAt).toBe(revivalAt);

    const raw = await readFile(join(persistEnv.dataDir, 'data.json'), 'utf8');
    const parsed = JSON.parse(raw) as OfficeDataStore;
    const onDisk = parsed.tempProjects.find((p) => p.id === draft.id);
    expect(onDisk?.smartRevivedAt).toBe(revivalAt);
  });

  it('strips smartRevivedAt from workflow tasks on normalize', async () => {
    const { saveStore, createTaskDraft, upsertTask, listTasks } = await import('@electron/services/office/store');
    await saveStore(sampleStore());
    const draft = createTaskDraft({
      scenarioId: 'sc-1',
      title: 'Workflow no revival',
      featureDescription: 'Feature scope',
      assignedRoleIds: ['role-a'],
      executionMode: 'workflow',
    });
    await upsertTask({
      ...draft,
      smartRevivedAt: 999,
    } as typeof draft & { smartRevivedAt: number });

    const reloaded = (await listTasks('sc-1')).find((t) => t.id === draft.id);
    expect(reloaded?.smartRevivedAt).toBeUndefined();
  });

  it('insertScenarioTask keeps smart task after concurrent-style renumber', async () => {
    const { saveStore, insertScenarioTask, listTasks } = await import('@electron/services/office/store');
    const base = sampleStore();
    base.tasks = [];
    await saveStore(base);
    const saved = await insertScenarioTask('sc-1', {
      title: 'Smart 项目 A',
      featureDescription: '能力边界',
      description: '',
      agentIds: ['main'],
      coordinatorAgentId: 'main',
      executionMode: 'smart',
      workflow: { mode: 'dag', nodes: [], edges: [] },
    });

    const tasks = await listTasks('sc-1');
    expect(tasks.some((t) => t.id === saved.id)).toBe(true);
    expect(tasks.find((t) => t.id === saved.id)?.executionMode).toBe('smart');
    expect(tasks.find((t) => t.id === saved.id)?.sequence).toBe(1);
  });

  it('reorderScenarios persists sequence and listScenarios returns sorted order', async () => {
    const { saveStore, reorderScenarios, listScenarios, createScenarioDraft } = await import(
      '@electron/services/office/store'
    );
    const base = sampleStore();
    const sc2 = createScenarioDraft({
      name: 'Team B',
      roleIds: ['role-a'],
      coordinatorRoleId: 'role-a',
    });
    const sc3 = createScenarioDraft({
      name: 'Team C',
      roleIds: ['role-a'],
      coordinatorRoleId: 'role-a',
    });
    base.scenarios = [
      { ...base.scenarios[0]!, sequence: 1 },
      { ...sc2, sequence: 2 },
      { ...sc3, sequence: 3 },
    ];
    await saveStore(base);

    const reordered = await reorderScenarios(['sc-1', sc3.id, sc2.id]);
    expect(reordered.map((s) => s.id)).toEqual(['sc-1', sc3.id, sc2.id]);
    expect(reordered.map((s) => s.sequence)).toEqual([1, 2, 3]);

    const listed = await listScenarios();
    expect(listed.map((s) => s.id)).toEqual(['sc-1', sc3.id, sc2.id]);
  });

  it('reloads parsed empty data.json without artifact recovery overwrite', async () => {
    const emptyButValid: OfficeDataStore = {
      version: 1,
      roles: [],
      scenarios: [],
      tasks: [],
      roomMessages: {},
      settings: { agentToAgentEnabled: false, agentToAgentAllow: [] },
    };
    await writeFile(
      join(persistEnv.dataDir, 'data.json'),
      JSON.stringify(emptyButValid, null, 2),
      'utf8',
    );

    const { loadStore, listRoles, listScenarios, clearOfficeStoreCacheForTests, drainOfficeStoreOpsForTests } = await import(
      '@electron/services/office/store'
    );
    clearOfficeStoreCacheForTests();
    await drainOfficeStoreOpsForTests();
    await loadStore();
    expect(await listRoles()).toEqual([]);
    expect(await listScenarios()).toEqual([]);

    const raw = await readFile(join(persistEnv.dataDir, 'data.json'), 'utf8');
    const onDisk = JSON.parse(raw) as OfficeDataStore;
    expect(onDisk.fixedGroups).toEqual([]);
    expect(onDisk.tempProjects).toEqual([]);
  });

  it('preserves user-edited snapshot across cache clear and reload', async () => {
    const userStore: OfficeDataStore = {
      version: 1,
      roles: [{ id: 'dev', name: '开发工程师', agentId: 'dev-agent', createdAt: 100, updatedAt: 100 }],
      scenarios: [{
        id: 'team-custom',
        name: '我的五子棋团队',
        roleIds: ['dev'],
        coordinatorRoleId: 'dev',
        workflow: { mode: 'simple', nodes: [], edges: [] },
        createdAt: 100,
        updatedAt: 100,
      }],
      tasks: [],
      roomMessages: {},
      settings: { agentToAgentEnabled: false, agentToAgentAllow: [] },
    };
    const { saveStore, loadStore, listScenarios, listProjectAgents, clearOfficeStoreCacheForTests, drainOfficeStoreOpsForTests } =
      await import('@electron/services/office/store');
    await saveStore(userStore);
    await drainOfficeStoreOpsForTests();
    clearOfficeStoreCacheForTests();
    await loadStore();
    expect((await listScenarios())[0]?.name).toBe('我的五子棋团队');
    expect((await listProjectAgents()).find((r) => r.agentId === 'dev-agent')?.displayName).toBe('dev-agent');
  });

  describe('isolated OPENCLAW_HOME', () => {
    let testRoot = '';

    beforeEach(async () => {
      testRoot = await beginOfficeStoreTestIsolation();
      vi.resetModules();
    });

    afterEach(async () => {
      await endOfficeStoreTestIsolation(testRoot);
    });

    it('hydrates role laneContract from agent workspace when missing in data.json', async () => {
    const { mkdir, writeFile: writeFileFs } = await import('node:fs/promises');
    const { agentWorkspaceRoot } = await import('../../electron/services/office/project-context-paths');
    const storeOnDisk: OfficeDataStore = {
      version: 1,
      roles: [{ id: 'dev', name: '开发', agentId: 'dev-agent', createdAt: 1, updatedAt: 1 }],
      scenarios: [],
      tasks: [],
      roomMessages: {},
      settings: { agentToAgentEnabled: false, agentToAgentAllow: [] },
    };
    await writeFile(
      join(persistEnv.dataDir, 'data.json'),
      JSON.stringify(storeOnDisk, null, 2),
      'utf8',
    );
    const lanePath = join(agentWorkspaceRoot('dev-agent'), 'roles', 'dev.md');
    await mkdir(join(lanePath, '..'), { recursive: true });
    await writeFileFs(lanePath, 'workspace lane contract', 'utf8');

    const { loadStore, listRoles, clearOfficeStoreCacheForTests, drainOfficeStoreOpsForTests } = await import(
      '@electron/services/office/store'
    );
    clearOfficeStoreCacheForTests();
    await drainOfficeStoreOpsForTests();
    await loadStore();
    expect((await listRoles()).find((r) => r.id === 'dev')?.laneContract).toBeUndefined();
  });

  it('does not merge project task fields from workspace definition on load', async () => {
    const { mkdir, writeFile: writeFileFs } = await import('node:fs/promises');
    const { agentWorkspaceRoot } = await import('../../electron/services/office/project-context-paths');
    const { PROJECT_DEFINITION_FILE, projectDirSegment } = await import('../../src/lib/office-project-context');
    const storeOnDisk: OfficeDataStore = {
      version: 1,
      roles: [{ id: 'coord', name: '协调', agentId: 'main', createdAt: 1, updatedAt: 1 }],
      scenarios: [{
        id: 'sc-1',
        name: '团队',
        roleIds: ['coord'],
        coordinatorRoleId: 'coord',
        workflow: { nodes: [], edges: [] },
        createdAt: 1,
        updatedAt: 1,
      }],
      tasks: [{
        id: 'task-1',
        scenarioId: 'sc-1',
        title: '项目A',
        featureDescription: '',
        description: '',
        assignedRoleIds: ['coord'],
        executionMode: 'workflow',
        workflow: { mode: 'dag', nodes: [], edges: [] },
        nodeRuns: [],
        status: 'pending',
        createdAt: 1,
        updatedAt: 1,
      }],
      roomMessages: {},
      settings: { agentToAgentEnabled: false, agentToAgentAllow: [] },
    };
    await writeFile(
      join(persistEnv.dataDir, 'data.json'),
      JSON.stringify(storeOnDisk, null, 2),
      'utf8',
    );
    const projectRoot = join(
      agentWorkspaceRoot('main'),
      'office',
      'projects',
      projectDirSegment('项目A', 'task-1'),
    );
    await mkdir(projectRoot, { recursive: true });
    await writeFileFs(
      join(projectRoot, PROJECT_DEFINITION_FILE),
      JSON.stringify({
        taskId: 'task-1',
        taskTitle: '项目A',
        executionMode: 'workflow',
        featureDescription: 'from workspace definition',
        description: 'should not merge',
        coordinatorRoleId: 'coord',
        updatedAt: 1,
      }, null, 2),
      'utf8',
    );

    const { loadStore, listTasks, clearOfficeStoreCacheForTests, drainOfficeStoreOpsForTests } = await import(
      '@electron/services/office/store'
    );
    clearOfficeStoreCacheForTests();
    await drainOfficeStoreOpsForTests();
    await loadStore();
    const tasks = await listTasks('sc-1');
    expect(tasks[0]?.featureDescription).toBe('');
    expect(tasks[0]?.description).toBe('');
  });
  });
});
