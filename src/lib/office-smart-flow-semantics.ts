import {
  isSmartMemberHelpAction,
  resolveSmartMemberReadiness,
  smartMemberReplyDeclaresEnd,
  type SmartCoordinatorRef,
  type SmartMemberExecutionReadiness,
  validateSmartMemberRoomReply,
} from '@/lib/office-smart-member-reply';
import { agentIdsMatch } from '@/lib/office-agent-id-resolve';
import {
  isSmartProjectEngineComplete,
  parseSmartCoordinatorAction,
  resolveCoordinatorPeerAcceptanceScanText,
  smartCoordinatorKickoffActionMustBeAssign,
  smartCoordinatorReplyIsDispatching,
  smartCoordinatorShouldValidateAssignMentions,
  validateSmartCoordinatorProjectEnd,
  findSmartCoordinatorPrematurePeerAcceptanceRoleIds,
  validateSmartCoordinatorRoomMentions,
} from '@/lib/office-smart-coordinator-dispatch';
import { extractSmartRoomReplyAndDispatch } from '@/lib/office-smart-room-fields';
import {
  resolveSmartCoordinatorDispatchTargets,
  structuredSmartDispatchHasDelegableItems,
} from '@/lib/office-smart-dispatch-targets';
import { parseSmartCoordinatorEndFlag } from '@/lib/office-smart-project-end';
import {
  isSmartJsonShapeText,
  parseSmartMemberJsonOutput,
  SMART_MIN_ROOM_REPLY_CHARS,
  smartDispatchRoleTaskText,
} from '@/lib/office-smart-json-schema';
import type { SmartWorkOrderStep } from '@/lib/office-smart-work-order';
import {
  extractOfficeBracketSections,
  validateSmartWorkflowMirrorSections,
  type SmartWorkflowMirrorValidationIssue,
} from '@/lib/office-workflow-output-sections';
import type { ProjectAgentRef } from '@/lib/office-workflow-node';

/** Smart 结构化校验第 3 层（流程态语义）可产生的 issue。 */
export type SmartFlowSemanticIssue =
  | 'coordinator_missing_dispatch'
  | 'smart_coordinator_missing_mention'
  | 'smart_coordinator_unknown_team_role'
  | 'smart_coordinator_wrong_dispatch_target'
  | 'smart_coordinator_review_has_dispatch'
  | 'smart_coordinator_dispatch_names_reporter'
  | 'smart_coordinator_dispatch_duplicate_role'
  | 'smart_coordinator_premature_peer_acceptance'
  | 'smart_coordinator_kickoff_action_not_assign'
  | 'smart_coordinator_missing_project_end'
  | 'smart_coordinator_premature_project_end'
  | 'smart_dispatch_targets_unresolvable'
  | 'smart_member_missing_coordinator'
  | 'smart_member_mentions_peer'
  | 'smart_member_input_invalid_lazy'
  | 'smart_member_promise_only'
  | 'smart_member_missing_dependency_report'
  | 'smart_member_missing_deliverable'
  | 'smart_member_missing_acceptance_ack'
  | 'smart_member_acceptance_action_help'
  | 'smart_member_in_progress_only'
  | 'smart_member_missing_action_end'
  | 'smart_member_missing_file_deliverable'
  | 'smart_member_deliverable_inline_too_long'
  | 'deliverable_filename_missing_role_suffix'
  | SmartWorkflowMirrorValidationIssue;

/** Smart 流程态语义校验：不因提示词 JSON Schema 的 maxLength 拒绝（仅作模型参考）。 */
export const SMART_JSON_SKIP_FIELD_MAX_LENGTH_ISSUES = new Set<SmartFlowSemanticIssue>([
  'deliverable_section_too_long',
  'deliverable_inline_too_long',
  'smart_member_deliverable_inline_too_long',
]);

const SMART_MEMBER_HELP_DELIVERABLE_ISSUES = new Set<SmartWorkflowMirrorValidationIssue>([
  'missing_member_mirror_section',
  'missing_deliverable_section',
  'deliverable_too_short',
  'deliverable_missing_file_path',
  'deliverable_section_too_long',
  'deliverable_promissory_only',
  'deliverable_inline_too_long',
  'output_validation_section_required',
]);

function coordinatorDispatchIsNone(text: string): boolean {
  const t = text.trim();
  return !t || /^无$/iu.test(t);
}

function parseSmartMemberEndFlagFromNormalizedRaw(raw: string, jsonRaw?: string): boolean {
  const structural = jsonRaw?.trim();
  if (structural && smartMemberReplyDeclaresEnd(structural)) return true;
  const action = extractOfficeBracketSections(raw)['动作']?.trim();
  return action === 'end';
}

export type SmartFlowSemanticsParams = {
  raw: string;
  /** 模型原始 JSON；流程态语义（action/dispatch/deliverable/提前验收）仅认此字段。 */
  jsonRaw?: string;
  isCoordinator: boolean;
  needsDecomposition?: boolean;
  minRoomReplyChars?: number;
  allowCoordinatorSilentNoReply?: boolean;
  coordinatorRole?: SmartCoordinatorRef;
  smartMemberReadiness?: SmartMemberExecutionReadiness;
  promptVariant?: string;
  triggerFromMemberAgent?: boolean;
  coordinatorAgentId?: string;
  coordinatorRoleId?: string;
  smartNextExecutorRoleIds?: string[];
  smartNextExecutorRoleId?: string | null;
  teamRoles?: Array<Pick<ProjectAgentRef, 'agentId' | 'displayName'>>;
  smartAllowReporterFixRoleId?: string | null;
  smartAllowUpstreamProducerRoleId?: string | null;
  smartInputValidationFailed?: boolean;
  viewerRoleId?: string;
  taskId?: string;
  projectId?: string;
  smartWorkSteps?: SmartWorkOrderStep[];
  roomMessages?: import('@/types/office').RoomMessage[];
  memberReportRaw?: string;
  reporterRoleId?: string;
  memberHelpAction?: boolean;
  actorRoleName?: string;
  /** 结项冲突第 2 轮坚持 end：仅跳过 premature 工作顺序闸门（B1）。 */
  forceCoordinatorProjectEnd?: boolean;
};

/** Smart 结构化校验第 3 层：流程态语义（@ 执行者、结项、成员汇报规则、镜像段业务约束）。 */
export function validateSmartFlowSemantics(params: SmartFlowSemanticsParams): SmartFlowSemanticIssue[] {
  const raw = params.raw.trim();
  const structuralRaw = params.jsonRaw?.trim() || raw;
  const smartFields = extractSmartRoomReplyAndDispatch(raw);
  const roomBody = smartFields.roomReply.trim();
  const dispatchText = smartFields.dispatch.trim();
  const minLen = params.minRoomReplyChars ?? SMART_MIN_ROOM_REPLY_CHARS;

  const issues: SmartFlowSemanticIssue[] = [];
  const coordinatorPeerAcceptanceText = params.isCoordinator
    ? resolveCoordinatorPeerAcceptanceScanText(structuralRaw)
    : '';
  const smartMemberHelpAction =
    params.memberHelpAction
    ?? (!params.isCoordinator && isSmartMemberHelpAction(structuralRaw));

  const coordinatorId = (params.coordinatorAgentId ?? params.coordinatorRoleId)?.trim();
  const scopeId = (params.projectId ?? params.taskId ?? '').trim();

  const steps = params.smartWorkSteps ?? [];
  const smartWorkOrderMaterialized = steps.length > 0;
  const projectEngineComplete =
    params.isCoordinator
    && Boolean(
      scopeId
      && params.roomMessages
      && isSmartProjectEngineComplete({
        steps,
        roomMessages: params.roomMessages,
        projectId: scopeId,
        coordinatorAgentId: coordinatorId,
        teamRoles: params.teamRoles,
      }),
    );
  /** 工作单尚未物化时 kickoff 放宽 assign @ 校验，但不视为引擎已完成。 */
  const kickoffMentionRelaxed = params.isCoordinator && !smartWorkOrderMaterialized;

  const declaresProjectEnd = parseSmartCoordinatorEndFlag(structuralRaw) || parseSmartCoordinatorEndFlag(raw);
  const closureIntent = params.isCoordinator && declaresProjectEnd;

  const coordinatorAction = params.isCoordinator
    ? (parseSmartCoordinatorAction(structuralRaw) ?? parseSmartCoordinatorAction(raw))
    : null;

  if (params.isCoordinator && coordinatorAction === 'end') {
    if (
      params.promptVariant === 'coordinator_kickoff_decompose'
      && !smartCoordinatorKickoffActionMustBeAssign(coordinatorAction)
    ) {
      issues.push('smart_coordinator_kickoff_action_not_assign');
      return issues;
    }
    if (!coordinatorDispatchIsNone(dispatchText)) {
      issues.push('smart_coordinator_review_has_dispatch');
    }
    const endCheck = validateSmartCoordinatorProjectEnd({
      raw,
      minChars: minLen,
      allStepsComplete: projectEngineComplete,
    });
    if (endCheck === 'missing_project_end') {
      issues.push('smart_coordinator_missing_project_end');
    } else if (endCheck === 'premature_project_end' && !params.forceCoordinatorProjectEnd) {
      issues.push('smart_coordinator_premature_project_end');
    }
    if (
      coordinatorId
      && params.teamRoles
      && scopeId
      && params.roomMessages
      && findSmartCoordinatorPrematurePeerAcceptanceRoleIds({
        roomReplyText: coordinatorPeerAcceptanceText,
        coordinatorAgentId: coordinatorId,
        teamRoles: params.teamRoles,
        roomMessages: params.roomMessages,
        projectId: scopeId,
      }).length > 0
    ) {
      issues.push('smart_coordinator_premature_peer_acceptance');
    }
    return issues;
  }

  const shouldValidateAssignMentions = smartCoordinatorShouldValidateAssignMentions({
    publishText: roomBody,
    dispatchText,
    raw,
    projectComplete: projectEngineComplete || kickoffMentionRelaxed,
  });

  if (
    params.isCoordinator
    && params.promptVariant === 'coordinator_kickoff_decompose'
    && !smartCoordinatorKickoffActionMustBeAssign(coordinatorAction)
  ) {
    issues.push('smart_coordinator_kickoff_action_not_assign');
  }

  if (
    params.isCoordinator
    && coordinatorAction === 'assign'
    && params.teamRoles
    && coordinatorId
    && structuredSmartDispatchHasDelegableItems(raw)
  ) {
    const targets = resolveSmartCoordinatorDispatchTargets(
      raw,
      params.teamRoles,
      coordinatorId,
    );
    if (targets.length === 0) {
      issues.push('smart_dispatch_targets_unresolvable');
    }
  }

  const skipDecompositionCheck =
    params.promptVariant === 'coordinator_member_failure'
    || params.promptVariant === 'coordinator_member_supervision'
    || params.promptVariant === 'coordinator_member_report'
    || params.triggerFromMemberAgent === true;

  if (
    params.isCoordinator
    && params.needsDecomposition
    && !skipDecompositionCheck
    && shouldValidateAssignMentions
    && !/[@＠]/u.test(dispatchText)
  ) {
    issues.push('coordinator_missing_dispatch');
  }

  if (
    params.isCoordinator
    && !params.allowCoordinatorSilentNoReply
    && coordinatorId
    && params.teamRoles
  ) {
    if (closureIntent) {
      const endCheck = validateSmartCoordinatorProjectEnd({
        raw,
        minChars: minLen,
        allStepsComplete: projectEngineComplete,
      });
      if (endCheck === 'missing_project_end') {
        issues.push('smart_coordinator_missing_project_end');
      } else if (endCheck === 'premature_project_end' && !params.forceCoordinatorProjectEnd) {
        issues.push('smart_coordinator_premature_project_end');
      }
    } else if (
      projectEngineComplete
      && !smartCoordinatorReplyIsDispatching({ roomBody, dispatch: dispatchText })
      && !shouldValidateAssignMentions
    ) {
      const endCheck = validateSmartCoordinatorProjectEnd({
        raw,
        minChars: minLen,
        allStepsComplete: true,
      });
      if (endCheck === 'missing_project_end') {
        issues.push('smart_coordinator_missing_project_end');
      }
    } else {
      const stageRoleIds = [
        ...(params.smartNextExecutorRoleIds ?? []),
        ...(params.smartNextExecutorRoleId ? [params.smartNextExecutorRoleId] : []),
      ].filter(Boolean);
      const mentionCheck = validateSmartCoordinatorRoomMentions({
        publishText: roomBody,
        dispatchText,
        coordinatorAgentId: coordinatorId,
        nextExecutorRoleIds: [...new Set(stageRoleIds)],
        teamRoles: params.teamRoles,
        projectComplete: projectEngineComplete,
        kickoffMentionRelaxed,
        allowReporterFixRoleId: params.smartAllowReporterFixRoleId,
        allowUpstreamProducerRoleId: params.smartAllowUpstreamProducerRoleId,
        reporterRoleId: params.reporterRoleId,
        raw,
      });
      if (mentionCheck === 'missing_mention') {
        issues.push('smart_coordinator_missing_mention');
      } else if (mentionCheck === 'mentions_unknown_team_role') {
        issues.push('smart_coordinator_unknown_team_role');
      } else if (mentionCheck === 'mentions_non_next_executor') {
        issues.push('smart_coordinator_wrong_dispatch_target');
      } else if (mentionCheck === 'end_has_dispatch') {
        issues.push('smart_coordinator_review_has_dispatch');
      } else if (mentionCheck === 'dispatch_names_reporter') {
        issues.push('smart_coordinator_dispatch_names_reporter');
      } else if (mentionCheck === 'dispatch_duplicate_role') {
        issues.push('smart_coordinator_dispatch_duplicate_role');
      } else if (mentionCheck === 'broadcast_before_project_complete') {
        issues.push('smart_coordinator_premature_project_end');
      } else if (mentionCheck === 'premature_project_end') {
        issues.push('smart_coordinator_premature_project_end');
      }
    }

    if (
      !closureIntent
      && coordinatorId
      && params.teamRoles
      && scopeId
      && params.roomMessages
    ) {
      const prematureIds = findSmartCoordinatorPrematurePeerAcceptanceRoleIds({
        roomReplyText: coordinatorPeerAcceptanceText,
        coordinatorAgentId: coordinatorId,
        teamRoles: params.teamRoles,
        roomMessages: params.roomMessages,
        projectId: scopeId,
      });
      const team = params.teamRoles ?? [];
      const offending = params.reporterRoleId
        ? prematureIds.filter(
            (id) => !agentIdsMatch(team, id, params.reporterRoleId!),
          )
        : prematureIds;
      if (offending.length > 0) {
        issues.push('smart_coordinator_premature_peer_acceptance');
      }
    }
  }

  const skipCoordinatorMirror =
    params.promptVariant === 'coordinator_member_failure'
    || params.allowCoordinatorSilentNoReply;
  const mirrorValidationContext = {
    viewerRoleId: params.viewerRoleId,
    taskId: params.taskId,
    smartWorkSteps: params.smartWorkSteps,
    roomMessages: params.roomMessages,
    memberReportRaw: params.memberReportRaw,
    isCoordinator: params.isCoordinator,
  };
  if (!params.isCoordinator) {
    const mirrorIssues = validateSmartWorkflowMirrorSections(raw, {
      smartMemberReadiness: params.smartMemberReadiness,
      actorRoleName: params.actorRoleName,
      ...mirrorValidationContext,
    });
    issues.push(
      ...(smartMemberHelpAction
        ? mirrorIssues.filter((issue) => !SMART_MEMBER_HELP_DELIVERABLE_ISSUES.has(issue))
        : mirrorIssues),
    );
  } else if (!skipCoordinatorMirror) {
    issues.push(
      ...validateSmartWorkflowMirrorSections(raw, {
        smartMemberReadiness: 'blocked',
        actorRoleName: params.actorRoleName,
        ...mirrorValidationContext,
        isCoordinator: true,
      }),
    );
  }

  if (!params.isCoordinator && params.coordinatorRole) {
    const memberJson = isSmartJsonShapeText(structuralRaw)
      ? parseSmartMemberJsonOutput(structuralRaw)
      : null;
    const deliverableSection = memberJson?.deliverable.items.join('\n') ?? '';
    const deliverablePathText = memberJson
      ? [...memberJson.deliverable.items, ...memberJson.deliverable.outputValidation]
          .filter(Boolean)
          .join('\n')
      : '';
    const memberDispatchText = memberJson
      ? smartDispatchRoleTaskText(memberJson.dispatch).trim()
      : dispatchText;
    const readiness = resolveSmartMemberReadiness(
      params.smartMemberReadiness,
      memberJson?.taskUnderstanding,
    );
    const memberEnd = parseSmartMemberEndFlagFromNormalizedRaw(raw, structuralRaw);
    issues.push(
      ...validateSmartMemberRoomReply(roomBody, params.coordinatorRole, readiness, {
        deliverableSection,
        deliverablePathText,
        actorRoleName: params.actorRoleName,
        teamRoles: params.teamRoles,
        inputValidationFailed: params.smartInputValidationFailed === true,
        dispatchText: memberDispatchText,
        memberEnd,
        memberHelp: smartMemberHelpAction,
      }),
    );
  }

  return issues.filter((issue) => !SMART_JSON_SKIP_FIELD_MAX_LENGTH_ISSUES.has(issue));
}
