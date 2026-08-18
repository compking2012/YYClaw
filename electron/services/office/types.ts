import type { WorkflowOrchestrationPlan } from '../../../src/lib/office-langgraph-plan-types';
import type { ProjectAgentRef } from '../../../src/lib/office-workflow-node';
import type { WorkflowStepDraftRow } from '../../../src/types/office';

export type TaskStatus = 'pending' | 'running' | 'blocked' | 'completed' | 'failed' | 'aborted';
export type OfficeTaskExecutionMode = 'workflow' | 'smart';
export type OfficeWorkflowEngine = 'dag' | 'langgraph';
export type WorkflowOrchestrationMode = 'rule' | 'heuristic';
export type NodeRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
export type WorkflowEdgeWhen = 'always' | 'on_success' | 'on_partial' | 'on_failure';
export type NodeExecutionMode = 'serial' | 'parallel' | 'subagent';

export interface WorkflowNode {
  id: string;
  agentId: string;
  agentIds?: string[];
  title?: string;
  description?: string;
  execution: NodeExecutionMode;
  join?: 'all' | 'any';
  parallelGroup?: string;
  maxRuntimeMinutes?: number;
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

export interface OfficeFixedGroup {
  id: string;
  name: string;
  description?: string;
  agentIds: string[];
  coordinatorAgentId: string;
  /** 固定组默认执行模式：workflow 或 smart；派出项目继承。 */
  executionMode?: OfficeTaskExecutionMode;
  workflow: WorkflowDefinition;
  workflowDescription?: string;
  workflowStepDrafts?: WorkflowStepDraftRow[];
  workflowOrchestrationMode?: WorkflowOrchestrationMode;
  sequence?: number;
  createdAt: number;
  updatedAt: number;
}

export type TempProjectOrigin = 'standalone' | 'fixed_group';

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
  parallelGroup: string | '__serial__';
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
  reviewSnapshot?: {
    paths: string[];
    roleNames: string[];
    capturedAt: number;
  };
}

export interface OfficeTempProject {
  id: string;
  title: string;
  origin: TempProjectOrigin;
  parentGroupId?: string;
  agentIds: string[];
  coordinatorAgentId: string;
  lifecycle: TempProjectLifecycle;
  upgradedToGroupId?: string;
  /** 从已归档项目重启时写入。 */
  archivedRestartedAt?: number;
  /** 最近一次执行成功（status→completed）的时间戳。 */
  lastRunCompletedAt?: number;
  /** 本轮完成后的后续处理已处理的时间戳。 */
  completionFollowUpHandledAt?: number;
  sequence?: number;
  featureDescription: string;
  description: string;
  workflowStepDrafts?: WorkflowStepDraftRow[];
  workflowOrchestrationMode?: WorkflowOrchestrationMode;
  status: TaskStatus;
  executionMode?: OfficeTaskExecutionMode;
  workflowEngine?: OfficeWorkflowEngine;
  smartRevivedAt?: number;
  smartLastAssign?: SmartLastAssignRecord;
  kickoffError?: string;
  kickoffFailCount?: number;
  workflowStall?: WorkflowStallRecord;
  workflow?: WorkflowDefinition;
  langGraphWorkflowBundle?: LangGraphWorkflowBundle;
  inheritsGroupTemplate?: boolean;
  /** No-own terminal freeze snapshot; not ownership. Cleared before rerun/continue. */
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

export interface AgentBindingRecord {
  agentId: string;
  kind: AgentBindingKind;
  entityId: string;
  entityName: string;
  parentGroupId?: string;
  updatedAt: number;
}

/** Workflow/Smart 执行期成员（Agent 身份 + 展示名）。 */
export interface OfficeExecutionMember {
  agentId: string;
  displayName: string;
  emoji?: string;
}

/** @deprecated v2 agent pool：保留类型别名供尚未迁移的调用方编译。 */
export type OfficeRole = ProjectAgentRef & {
  id: string;
  name: string;
  emoji?: string;
  description?: string;
  laneContract?: string;
  createdAt?: number;
  updatedAt?: number;
};

/** @deprecated */
export type OfficeTask = OfficeTempProject & {
  scenarioId?: string;
  /** @deprecated legacy role-model field，仅供 store-legacy 兼容转换使用 */
  coordinatorRoleId?: string;
  /** @deprecated legacy role-model field，仅供 store-legacy 兼容转换使用 */
  assignedRoleIds?: string[];
};

/** @deprecated */
export type OfficeScenario = OfficeFixedGroup & {
  roleIds?: string[];
  coordinatorRoleId?: string;
};
