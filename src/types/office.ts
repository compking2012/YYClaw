import type { WorkflowOrchestrationPlan } from '@/lib/office-langgraph-plan-types';

export type { LangGraphOrchestrationPlan, LangGraphPlanNodeKind } from '@/lib/office-langgraph-plan-types';

export type TaskStatus = 'pending' | 'running' | 'blocked' | 'completed' | 'failed' | 'aborted';
/** workflow: DAG/simple workflow runner; smart: coordinator-driven delegation in room chat. */
export type OfficeTaskExecutionMode = 'workflow' | 'smart';
export type OfficeWorkflowEngine = 'dag' | 'langgraph';
export type NodeRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
export type WorkflowEdgeWhen = 'always' | 'on_success' | 'on_partial' | 'on_failure';
export type NodeExecutionMode = 'serial' | 'parallel' | 'subagent';

export type WorkflowStepLinkMode = 'serial' | 'parallel';

/** DAG workflow orchestration: rule-based step table or heuristic LLM generation. */
export type WorkflowOrchestrationMode = 'rule' | 'heuristic';

/** Structured workflow step rows authored in group/project forms. */
export interface WorkflowStepDraftRow {
  /** @deprecated UI 已移除输入行；保留字段以兼容旧数据。 */
  input: string;
  agentIds: string[];
  task: string;
  output: string;
  linkMode: WorkflowStepLinkMode;
  /** 1-based step number to run parallel with (required when linkMode is parallel). */
  parallelWithStep?: number;
  /** 是否启用回滚，默认 false。 */
  rollbackEnabled?: boolean;
  /** 回滚条件（rollbackEnabled 时必填）。 */
  rollbackCondition?: string;
  /** 回滚目标步骤 1..N-1（rollbackEnabled 时必填）。 */
  rollbackStep?: number;
  /** 运行最大耗时（分钟）；未设置时默认 30。 */
  maxRuntimeMinutes?: number;
  /** 节点完成后是否暂停等待用户审核，默认 false。 */
  userCheckpoint?: boolean;
}

export interface WorkflowNode {
  id: string;
  /** Primary agent (first of `agentIds` when multi-agent). */
  agentId: string;
  /** Multiple agents execute this subtask together (parallel). */
  agentIds?: string[];
  title?: string;
  description?: string;
  execution: NodeExecutionMode;
  join?: 'all' | 'any';
  parallelGroup?: string;
  /** Max wall-clock minutes for this step when the project runs (default 30). */
  maxRuntimeMinutes?: number;
  /** When true, pause for human review after all roles complete this step. */
  userCheckpoint?: boolean;
}

export interface WorkflowEdge {
  from: string;
  to: string;
  when?: WorkflowEdgeWhen;
}

export interface WorkflowDefinition {
  mode: 'simple' | 'dag';
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  /** When true, dependency edges are not auto-synced from agent order. */
  edgesCustomized?: boolean;
  orchestrationEngine?: OfficeWorkflowEngine;
  orchestrationPlan?: WorkflowOrchestrationPlan;
}

export type LangGraphWorkflowSource = 'heuristic' | 'custom';

export interface LangGraphWorkflowHeuristicBranch {
  description: string;
  workflow: WorkflowDefinition;
  source?: string;
  savedAt: number;
}

export interface LangGraphWorkflowCustomBranch {
  workflow: WorkflowDefinition;
  savedAt: number;
}

export interface LangGraphWorkflowBundle {
  heuristic?: LangGraphWorkflowHeuristicBranch;
  custom?: LangGraphWorkflowCustomBranch;
  activeSource: LangGraphWorkflowSource;
  activeSavedAt: number;
}

/** 固定项目组 — Agent 编制容器，无群聊与执行。 */
export interface OfficeFixedGroup {
  id: string;
  name: string;
  description?: string;
  agentIds: string[];
  coordinatorAgentId: string;
  /** 固定组默认执行模式：workflow（工作流）或 smart；派出项目继承此模式。 */
  executionMode?: OfficeTaskExecutionMode;
  /** 工作流模板；派出临时项目时默认继承。 */
  workflow: WorkflowDefinition;
  /** 工作流描述（用于生成/维护 workflow 模板）。 */
  workflowDescription?: string;
  /** 结构化工作流步骤草稿（rule 模式主数据）。 */
  workflowStepDrafts?: WorkflowStepDraftRow[];
  /** DAG 编排方式：rule=规则节点表，heuristic=启发式 LLM。 */
  workflowOrchestrationMode?: WorkflowOrchestrationMode;
  /** Last-known display names for agents that may later be deleted/renamed. */
  agentNameHints?: Record<string, string>;
  /** 卡片横向排序（1..n）。 */
  sequence?: number;
  createdAt: number;
  updatedAt: number;
}

export type TempProjectOrigin = 'standalone' | 'fixed_group';

/** 临时项目生命周期（与 TaskStatus 正交）。 */
export type TempProjectLifecycle =
  | 'active'
  | 'completed'
  | 'dissolved'
  | 'upgraded';

export interface SmartLastAssignRecord {
  messageId: string;
  targetAgentIds: string[];
  at: number;
  dispatchedAt?: number;
  error?: string;
}

export interface WorkflowStallRecord {
  at: number;
  diagnosis: string;
  pendingNodeIds: string[];
  suggestedAction: string;
}

export interface NodeRunRecord {
  nodeId: string;
  agentId: string;
  status: NodeRunStatus;
  edgeOutcome?: 'success' | 'failure';
  sessionKey?: string;
  runId?: string;
  summary?: string;
  deliverablePath?: string;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  outputRetryAttempts?: number;
  completedAgentIds?: string[];
  reworkGeneration?: number;
  reworkReason?: string;
  roomHealJsonFingerprint?: string;
  roomHealJsonStableSinceMs?: number;
  roomHealValidatedFingerprint?: string;
  completionSource?: 'session' | 'room_heal';
  roomHealValidationFailFingerprint?: string;
  /** Captured deliverable paths when entering user review (for edited-continue validation). */
  reviewSnapshot?: {
    paths: string[];
    roleNames: string[];
    capturedAt: number;
  };
}

export type WorkflowReviewAction =
  | { kind: 'approve' }
  | { kind: 'edited_continue'; note?: string }
  | { kind: 'redo'; comment: string }
  | { kind: 'rollback'; targetNodeId: string; comment: string };

export type WorkflowReviewItemState =
  | 'awaiting_execution'
  | 'awaiting_decision'
  | 'submitted';

export type WorkflowReviewBatchPhase =
  | 'collecting'
  | 'ready_to_settle'
  | 'deferred'
  | 'closed';

export interface WorkflowReviewItem {
  nodeId: string;
  state: WorkflowReviewItemState;
  decision?: WorkflowReviewAction;
  submittedAt?: number;
}

export interface WorkflowReviewBatch {
  id: string;
  settleGeneration: number;
  parallelGroup: string;
  expectedNodeIds: string[];
  phase: WorkflowReviewBatchPhase;
  items: Record<string, WorkflowReviewItem>;
  carriedDecisions?: Record<string, WorkflowReviewAction>;
  deferredReason?: 'rollback_without_common_ancestor';
  createdAt: number;
  updatedAt: number;
}

export type WorkflowCheckpointOverride = {
  userCheckpoint?: boolean;
};

/** 临时项目 — 群聊、执行、交付物与归档。 */
export interface OfficeTempProject {
  id: string;
  title: string;
  origin: TempProjectOrigin;
  /** origin=fixed_group 时必填。 */
  parentGroupId?: string;
  agentIds: string[];
  coordinatorAgentId: string;
  lifecycle: TempProjectLifecycle;
  /** lifecycle=upgraded 时记录目标固定组 id。 */
  upgradedToGroupId?: string;
  /** 从已归档项目重启时写入；活跃期内展示「归档重启」标签，再次归档或删除前保留。 */
  archivedRestartedAt?: number;
  /** 最近一次执行成功（status→completed）的时间戳，用于区分每一轮完成后的后续处理。 */
  lastRunCompletedAt?: number;
  /** 本轮完成后的后续处理已处理（稍后/自动归档失败放弃等）的时间戳。 */
  completionFollowUpHandledAt?: number;
  /** Display order (1-based). */
  sequence?: number;
  featureDescription: string;
  description: string;
  /** 结构化工作流步骤草稿（rule 模式主数据）。 */
  workflowStepDrafts?: WorkflowStepDraftRow[];
  /** DAG 编排方式：rule=规则节点表，heuristic=启发式 LLM。 */
  workflowOrchestrationMode?: WorkflowOrchestrationMode;
  status: TaskStatus;
  executionMode?: OfficeTaskExecutionMode;
  workflowEngine?: OfficeWorkflowEngine;
  smartRevivedAt?: number;
  /** Smart：最近一次协调者 assign 派活记录（发布校验与 follow-up 追踪）。 */
  smartLastAssign?: SmartLastAssignRecord;
  kickoffError?: string;
  kickoffFailCount?: number;
  /** Workflow：DAG stall 诊断与续跑提示。 */
  workflowStall?: WorkflowStallRecord;
  workflow?: WorkflowDefinition;
  langGraphWorkflowBundle?: LangGraphWorkflowBundle;
  /** Last-known display names for agents that may later be deleted/renamed. */
  agentNameHints?: Record<string, string>;
  /** 派出项目为 true 时工作流/成员/描述展示与运行时均继承 parent 固定组。 */
  inheritsGroupTemplate?: boolean;
  /**
   * No-own spawned project terminal freeze of the fixed-group workflow.
   * Does NOT mean the project owns its workflow; cleared before rerun/continue.
   */
  workflowFreezeSnapshot?: {
    workflow: WorkflowDefinition;
    description: string;
    workflowStepDrafts?: WorkflowStepDraftRow[];
    workflowOrchestrationMode?: WorkflowOrchestrationMode;
    langGraphWorkflowBundle?: LangGraphWorkflowBundle;
    agentIds: string[];
    coordinatorAgentId: string;
    frozenAt: number;
    sourceGroupUpdatedAt?: number;
  };
  workflowRunId?: string;
  nodeRuns: NodeRunRecord[];
  workflowCheckpointOverrides?: Record<string, WorkflowCheckpointOverride>;
  workflowReviewBatch?: WorkflowReviewBatch;
  workflowUserIntervention?: {
    activeNodeId: string;
    request: string;
    startedAt: number;
    kind: 'redo' | 'skip_to' | 'other';
    skippedNodeId?: string;
  };
  roomSessionKey?: string;
  /** 项目启动后记录的项目根目录绝对路径。 */
  projectRootPath?: string;
  /**
   * Gateway LLM stop not yet confirmed. While true, re-run is blocked even if
   * status is already `aborted`.
   */
  abortQuiescing?: boolean;
  /** Abort generation aligned with in-process quiesce lock / gateway abort work. */
  abortGeneration?: number;
  /** When abortQuiescing became true. */
  abortQuiesceStartedAt?: number;
  createdAt: number;
  updatedAt: number;
}

/** @deprecated v2 agent pool：保留类型别名供尚未迁移的调用方编译（与 electron 侧 types.ts 对齐）。 */
export type OfficeRole = {
  agentId: string;
  displayName: string;
  id: string;
  name: string;
  emoji?: string;
  createdAt?: number;
  updatedAt?: number;
};

/** @deprecated 使用 OfficeTempProject；保留别名供尚未迁移的调用方编译。 */
export type OfficeTask = OfficeTempProject & { scenarioId?: string };

/** @deprecated 使用 OfficeFixedGroup；保留别名供尚未迁移的调用方编译（与 electron 侧 types.ts 对齐）。 */
export type OfficeScenario = OfficeFixedGroup & {
  roleIds?: string[];
  coordinatorRoleId?: string;
};

export type RoomMessagePhase =
  | 'task_received'
  | 'task_understanding'
  | 'task_team_review'
  | 'task_clarification'
  | 'task_running'
  | 'task_deliver'
  | 'task_handoff'
  | 'project_closure'
  | 'deliverable_bundle';

export interface RoomMessageAttachment {
  absPath: string;
  displayName: string;
  kind: 'zip';
  fileCount?: number;
  sizeBytes?: number;
}

export interface RoomMessage {
  id: string;
  /** 固定组 id（可选，便于过滤）。 */
  groupId?: string;
  projectId: string;
  from: 'user' | 'system' | string;
  fromAgentId?: string;
  content: string;
  mentions: string[];
  timestamp: number;
  runIds?: string[];
  phase?: RoomMessagePhase;
  progressText?: string;
  nodeId?: string;
  replyToId?: string;
  replyPreview?: string;
  attachments?: RoomMessageAttachment[];
  smartCoordinatorEnd?: boolean;
  smartMemberEnd?: boolean;
  /** Smart：模型原始 JSON 输出（派活/落盘/校验仅读此字段，content 仅群聊展示）。 */
  smartJsonRaw?: string;
  /** @deprecated 使用 fromAgentId；仅供读取历史持久化消息（迁移前写入）。 */
  fromRoleId?: string;
  /** @deprecated 使用 projectId；仅供读取历史持久化消息（迁移前写入）。 */
  taskId?: string;
  /** @deprecated 使用 groupId/projectId；仅供读取历史持久化消息（迁移前写入）。 */
  scenarioId?: string;
}

export interface OfficeDataStore {
  version: 2;
  fixedGroups: OfficeFixedGroup[];
  tempProjects: OfficeTempProject[];
  agentBindings: Record<string, AgentBindingRecord>;
  roomMessages: Record<string, RoomMessage[]>;
  settings: {
    agentToAgentEnabled: boolean;
    agentToAgentAllow: string[];
  };
}

export interface OfficeSnapshot {
  fixedGroups: OfficeFixedGroup[];
  tempProjects: OfficeTempProject[];
  agentBindings: Record<string, AgentBindingRecord>;
  settings: OfficeDataStore['settings'];
}

export type AgentBindingKind = 'fixed_group' | 'temp_project';

/** Agent 绑定登记表（每 Agent 至多一行，由 store 持久化并随组织变更同步）。 */
export interface AgentBindingRecord {
  agentId: string;
  kind: AgentBindingKind;
  entityId: string;
  entityName: string;
  parentGroupId?: string;
  updatedAt: number;
}

export type OfficeAgentStatus = 'idle' | 'working' | 'offline';

/** UI：Agent 在工作区中的展示项。 */
export interface OfficeProjectAgentView {
  agentId: string;
  agentName: string;
  status: OfficeAgentStatus;
  sessionCount: number;
  color: string;
}
