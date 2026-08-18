import type { GatewayManager } from '../../gateway/manager';
import { normalizeStrictAtMentionText } from '../../../src/lib/office-mention-parse';
import { compactOfficeDeliverableForRoomMirror } from '../../../src/lib/office-deliverable-file-policy';
import { isWorkflowDeliverableConclusionFailure } from '../../../src/lib/office-workflow-edge-outcome';
import {
  evaluateWorkflowRollback,
  parseWorkflowRollbackTrigger,
} from '../../../src/lib/office-workflow-rollback';
import { memberHandoffCoversExpected } from '../../../src/lib/office-workflow-handoff-compliance';
import type { WorkflowHandoffTarget } from '../../../src/lib/office-workflow-handoff';
import { extractPublicRoomMirrorText } from '../../../src/lib/office-room-mirror-public';
import {
  buildWorkflowOutputRetryError,
  isFatalWorkflowTransportFailure,
  isRecoverableWorkflowOutputFailure,
  WORKFLOW_NODE_OUTPUT_RETRY_MAX,
} from '../../../src/lib/office-workflow-agent-recovery';
import { isGatewayInterruptTransportError } from './gateway-office-resume';
import type { WorkflowAgentValidationIssue } from '../../../src/lib/office-workflow-agent-validation-issues';
import { canonicalWorkflowJsonFingerprint } from '../../../src/lib/office-workflow-json-schema';
import {
  hasSubstantiveClarification,
  validateWorkflowAgentStructuredReply,
  type ParsedAgentTaskReply,
} from './workflow-agent-reply';
import {
  beginTaskNodeRoomPhases,
  deliverWorkflowNodeRoomDeliver,
  announceWorkflowNodeDeliverableAbsolutePaths,
  resolveWorkflowDeliverableAbsolutePaths,
  type TaskHandoffNextMember,
  type TaskNodeRoomProgress,
} from './workflow-room-handoff';
import {
  declaredDeliverablePathsFromWorkflowJson,
  normalizeDeliverablePathForDisk,
} from '../../../src/lib/office-deliverable-disk-resolve';
import { verifyWorkflowNodeDeliverableOnDisk } from './workflow-project-deliverable-fs';
import type {
  NodeRunStatus,
  OfficeExecutionMember,
  OfficeFixedGroup,
  OfficeTempProject,
  WorkflowDefinition,
  WorkflowNode,
} from './types';

export type WorkflowRoleStepResult = {
  roleId: string;
  status: NodeRunStatus;
  failureOutcome?: boolean;
  summary?: string;
  deliverablePath?: string;
  error?: string;
  sessionKey?: string;
  runId?: string;
  memberHandoffOk?: boolean;
  upstreamRework?: {
    predecessorNodeIds: string[];
    mentionedRoleIds: string[];
    reason: string;
  };
  outputRetry?: boolean;
  outputRetryAttempts?: number;
};

const FATAL_VALIDATION_ISSUES: ReadonlySet<WorkflowAgentValidationIssue> = new Set([
  'transport_timeout',
  'transport_error',
  'model_error',
]);

export type WorkflowRoomJsonSessionValidation = {
  ok: true;
  parsed: ParsedAgentTaskReply;
  raw: string;
  fingerprint: string;
};

/** 与 Session 收稿相同的结构化 + 磁盘校验（供群聊自愈第 2 步）。 */
export async function validateWorkflowRoomJsonLikeSession(params: {
  raw: string;
  roleName: string;
  project: OfficeTempProject;
  group: OfficeFixedGroup;
  member: Pick<OfficeExecutionMember, 'agentId' | 'displayName'>;
  teamMembers: Pick<OfficeExecutionMember, 'agentId' | 'displayName'>[];
  requireMemberHandoff?: boolean;
  expectedHandoff?: WorkflowHandoffTarget[];
}): Promise<
  | WorkflowRoomJsonSessionValidation
  | { ok: false; issues: WorkflowAgentValidationIssue[]; detail: string; raw: string }
> {
  const raw = params.raw.trim();
  const structural = validateWorkflowAgentStructuredReply({
    raw,
    transportReason: 'empty',
    actorRoleName: params.roleName,
    requireMemberHandoff: params.requireMemberHandoff,
    expectedHandoff: params.expectedHandoff,
    teamRoles: params.teamMembers.map((m) => ({ agentId: m.agentId, displayName: m.displayName })),
  });
  if (!structural.ok) {
    return {
      ok: false,
      issues: structural.issues,
      detail: structural.detail,
      raw: structural.raw,
    };
  }
  const parsed = structural.parsed;
  const deliverablePaths = declaredDeliverablePathsFromWorkflowJson(parsed.jsonOutput);
  if (deliverablePaths.length === 0) {
    return {
      ok: false,
      issues: ['deliverable_paths_missing_on_disk'],
      detail: 'deliverable.path 未声明，无法落盘校验',
      raw,
    };
  }
  const disk = await verifyWorkflowNodeDeliverableOnDisk({
    project: params.project,
    group: params.group,
    member: params.member,
    teamMembers: params.teamMembers,
    deliverablePaths,
  });
  if (!disk.ok) {
    return {
      ok: false,
      issues: ['deliverable_paths_missing_on_disk'],
      detail: disk.detail,
      raw,
    };
  }
  const fingerprint = parsed.jsonOutput
    ? canonicalWorkflowJsonFingerprint(parsed.jsonOutput)
    : raw.slice(0, 500);
  return { ok: true, parsed, raw, fingerprint };
}

type LegacyWorkflowMember = Pick<OfficeExecutionMember, 'agentId' | 'displayName'> & {
  id?: string;
  name?: string;
};

function resolveApplyStepMembers(
  options: ApplyWorkflowRoleStepOptions,
): Pick<OfficeExecutionMember, 'agentId' | 'displayName'>[] {
  const legacy = options.allRoles ?? options.teamRoles ?? [];
  const primary = options.allMembers ?? options.teamMembers ?? [];
  const source: LegacyWorkflowMember[] = primary.length > 0 ? primary : legacy;
  return source.map((member) => ({
    agentId: (member.agentId ?? member.id ?? '').trim(),
    displayName: (member.displayName ?? member.name ?? member.agentId ?? member.id ?? '').trim(),
  })).filter((member) => member.agentId);
}

export type ApplyWorkflowRoleStepOptions = {
  coRoleNames?: string[];
  isCoordinatorRole?: boolean;
  expectedHandoff?: WorkflowHandoffTarget[];
  outputRetryAttempts?: number;
  allMembers?: Pick<OfficeExecutionMember, 'agentId' | 'displayName'>[];
  teamMembers?: Pick<OfficeExecutionMember, 'agentId' | 'displayName'>[];
  /** @deprecated use allMembers */
  allRoles?: LegacyWorkflowMember[];
  /** @deprecated use teamMembers */
  teamRoles?: LegacyWorkflowMember[];
  /** 已有 executing 中的 room phases（Session）；自愈可传 null 走 deliver-only */
  roomPhases?: TaskNodeRoomProgress | null;
};

/**
 * Resolve the parsed reply's declared deliverable paths (project-root relative) to absolute
 * on-disk paths and post them to the room. No-op when the project root or paths are unknown.
 */
export async function announceDeliverableAbsolutePaths(
  roomPhases: TaskNodeRoomProgress,
  project: Pick<OfficeTempProject, 'id' | 'title' | 'projectRootPath'>,
  parsed: ParsedAgentTaskReply,
): Promise<void> {
  const absolute = await resolveWorkflowDeliverableAbsolutePaths(project, parsed);
  if (absolute.length === 0) return;
  await roomPhases.announceDeliverablePaths(absolute);
}

/**
 * 与 Session `agentResult.ok` 分支一致：回滚 / completed / 群聊交付 / 交接。
 */
export async function applyWorkflowRoleStepFromParsedReply(
  gateway: GatewayManager,
  group: OfficeFixedGroup,
  project: OfficeTempProject,
  node: WorkflowNode,
  member: Pick<OfficeExecutionMember, 'agentId' | 'displayName' | 'emoji'>,
  workflow: WorkflowDefinition,
  parsed: ParsedAgentTaskReply,
  raw: string,
  options: ApplyWorkflowRoleStepOptions,
): Promise<WorkflowRoleStepResult> {
  const members = resolveApplyStepMembers(options);
  const teamMembers: LegacyWorkflowMember[] = (options.teamMembers?.length ? options.teamMembers : options.teamRoles?.length
    ? options.teamRoles
    : members) ?? members;
  const step: WorkflowRoleStepResult = {
    roleId: member.agentId ?? (member as LegacyWorkflowMember).id ?? '',
    status: 'running',
    outputRetryAttempts: options.outputRetryAttempts,
  };

  const teamRefs = teamMembers.map((m) => ({
    agentId: (m.agentId ?? m.id ?? '').trim(),
    displayName: (m.displayName ?? m.name ?? m.agentId ?? m.id ?? '').trim(),
  }));
  const rollbackTrigger = parseWorkflowRollbackTrigger(parsed.rollbackExplanation);
  const rollbackDecision = rollbackTrigger
    ? evaluateWorkflowRollback({
        rollbackExplanation: parsed.rollbackExplanation,
        currentNodeId: node.id,
        nodes: workflow.nodes,
        edges: workflow.edges,
        teamRoles: teamRefs as never,
      })
    : { rollback: false, reason: '', predecessorNodeIds: [], mentionedRoles: [] };

  if (rollbackTrigger && rollbackDecision.rollback) {
    const roomPhases = options.roomPhases;
    if (roomPhases) {
      const clarifyBody = [parsed.clarifications, parsed.inputValidation, parsed.rollbackExplanation]
        .map((s) => s.trim())
        .filter(Boolean)
        .join('\n\n');
      if (clarifyBody) {
        await roomPhases.announceClarification(clarifyBody);
      }
      await roomPhases.announceUpstreamReworkProgress();
    }
    step.status = 'pending';
    step.error = rollbackDecision.predecessorNodeIds.length > 0
      ? '【回滚说明】已触发工作流回滚'
      : '【回滚说明】已记录但无可回滚前驱节点';
    step.upstreamRework = {
      predecessorNodeIds: rollbackDecision.predecessorNodeIds,
      mentionedRoleIds: rollbackDecision.mentionedRoles.map((r) => (r as { agentId?: string; id?: string }).agentId ?? (r as { id: string }).id),
      reason: rollbackDecision.reason,
    };
    return step;
  }

  if (rollbackTrigger) {
    step.status = 'pending';
    step.error = '【回滚说明】格式未通过系统解析，不得按完成处理';
    return step;
  }

  const failureOutcome = isWorkflowDeliverableConclusionFailure(
    parsed.jsonOutput?.deliverable?.conclusion,
  );
  step.status = 'completed';
  step.failureOutcome = failureOutcome;
  const deliverRaw = compactOfficeDeliverableForRoomMirror({
    deliverable: parsed.deliverable,
    outputValidation: parsed.inputValidation,
    usage: parsed.usage,
  });
  const deliverForRoom = normalizeStrictAtMentionText(
    deliverRaw
      || extractPublicRoomMirrorText(
        parsed.deliverable.trim()
          || [parsed.execution, parsed.raw].filter((s) => s.trim()).join('\n\n').trim()
          || raw,
      ),
    members.map((m) => ({ agentId: m.agentId, displayName: m.displayName })) as never,
  );
  step.summary = deliverForRoom.slice(0, 800) || raw.slice(0, 500);
  step.deliverablePath =
    normalizeDeliverablePathForDisk(parsed.jsonOutput?.deliverable?.path ?? '') || undefined;

  const roomPhases = options.roomPhases;
  if (roomPhases) {
    if (parsed.understanding.trim()) {
      await roomPhases.announceUnderstanding(parsed.understanding);
    }
    await roomPhases.announceDeliver(deliverForRoom, parsed.usage || parsed.handoffNote);
    // Right after the deliver/report and before the next node dispatches, sync the agent's
    // deliverable COMPLETE (absolute) paths into the room.
    await announceDeliverableAbsolutePaths(roomPhases, project, parsed);
    if (hasSubstantiveClarification(parsed.clarifications)) {
      await roomPhases.announceClarification(parsed.clarifications);
    }
    if (
      options.isCoordinatorRole
      && options.expectedHandoff
      && options.expectedHandoff.length > 0
    ) {
      const handoffText = parsed.handoffNote.trim();
      if (memberHandoffCoversExpected(handoffText, options.expectedHandoff, teamRefs as never)) {
        const next: TaskHandoffNextMember[] = [];
        for (const t of options.expectedHandoff) {
          const m = members.find((x) => x.agentId === t.roleId);
          if (m) next.push({ member: m, stepTitle: t.stepTitle });
        }
        if (next.length > 0) {
          await roomPhases.announceHandoff(next);
          step.memberHandoffOk = true;
        }
      }
    }
  } else {
    await deliverWorkflowNodeRoomDeliver(
      gateway,
      group,
      project,
      node,
      { agentId: member.agentId, displayName: member.displayName, emoji: member.emoji },
      deliverForRoom,
      parsed.usage || parsed.handoffNote,
    );
    await announceWorkflowNodeDeliverableAbsolutePaths(
      gateway,
      group,
      project,
      node,
      { agentId: member.agentId, displayName: member.displayName, emoji: member.emoji },
      parsed,
    );
  }

  return step;
}

/** Session 校验失败时的 role 步结果（与 executeNodeForRole else 分支一致）。 */
export function buildWorkflowRoleStepFromValidationFailure(params: {
  roleId: string;
  issues: WorkflowAgentValidationIssue[];
  detail: string;
  outputRetryAttempts?: number;
  transportReason?: 'timeout' | 'error' | 'empty';
}): WorkflowRoleStepResult {
  const failDetail = params.detail;
  const hasFatalIssue = params.issues.some((i) => FATAL_VALIDATION_ISSUES.has(i));
  const gatewayInterrupted = isGatewayInterruptTransportError(failDetail);
  const recoverable =
    !hasFatalIssue
    && (!isFatalWorkflowTransportFailure(params.transportReason) || gatewayInterrupted)
    && (gatewayInterrupted || isRecoverableWorkflowOutputFailure(params.issues));
  const step: WorkflowRoleStepResult = {
    roleId: params.roleId,
    status: 'running',
    outputRetryAttempts: params.outputRetryAttempts,
  };
  if (recoverable) {
    const attempt = (params.outputRetryAttempts ?? 0) + 1;
    step.outputRetryAttempts = attempt;
    if (attempt >= WORKFLOW_NODE_OUTPUT_RETRY_MAX) {
      step.status = 'failed';
      step.error = `${failDetail}（已自动重试 ${WORKFLOW_NODE_OUTPUT_RETRY_MAX} 次仍不合格）`;
    } else {
      step.status = 'pending';
      step.outputRetry = true;
      step.error = buildWorkflowOutputRetryError(failDetail, attempt, WORKFLOW_NODE_OUTPUT_RETRY_MAX);
    }
  } else {
    step.status = 'failed';
    step.error = failDetail;
  }
  return step;
}

export async function announceWorkflowRoleStepFailureProgress(
  gateway: GatewayManager,
  group: OfficeFixedGroup,
  project: OfficeTempProject,
  node: WorkflowNode,
  member: Pick<OfficeExecutionMember, 'agentId' | 'displayName' | 'emoji'>,
  error: string,
  kind: 'failed' | 'outputRetry',
): Promise<void> {
  const phases = await beginTaskNodeRoomPhases(gateway, group, project, node, {
    agentId: member.agentId,
    displayName: member.displayName,
    emoji: member.emoji,
  });
  if (!phases) return;
  if (kind === 'outputRetry') {
    await phases.announceOutputRetry(error);
  } else {
    await phases.announceFailed(error);
  }
}

