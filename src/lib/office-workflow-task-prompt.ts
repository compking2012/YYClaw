/**
 * 工作流节点提示词入口：协调者与成员分轨拼装。
 * 共享段落见 `office-workflow-task-prompt-shared.ts`。
 */
export {
  WORKFLOW_AGENT_OUTPUT_SECTIONS,
  WORKFLOW_AGENT_OPTIONAL_OUTPUT_SECTIONS,
  WORKFLOW_AGENT_REQUIRED_OUTPUT_SECTIONS,
  WORKFLOW_FEW_SHOT_PROJECT_DIR,
  buildWorkflowAgentOutputFormatLines,
  buildWorkflowJsonSchemaLines,
  buildWorkflowMergedOutputSpecLines,
  buildWorkflowAgentTaskBriefBlock,
  buildWorkflowProjectDirectoryBlock,
  buildWorkflowTaskDescriptionBlock,
  buildWorkflowTeamBriefBlock,
  compactWorkflowTaskOverview,
  extractProjectGoal,
  formatWorkflowFeatureDescriptionForPrompt,
  extractWorkflowFewShotExample,
  normalizeWorkflowProjectDirectoryLine,
  WORKFLOW_FEW_SHOT_SECTION_TITLE,
  WORKFLOW_ROLLBACK_OUTPUT_RULE,
  WORKFLOW_ROLLBACK_TRIGGER_SENTENCE,
  WORKFLOW_ROLLBACK_TRIGGER_FORMAT_HINT,
  workflowFewShotLsLine,
  workflowProjectDirectoryDeclaresRoot,
  workflowPromptSection,
  type WorkflowAgentTaskBriefParams,
  type WorkflowStepSchemaVariant,
  WORKFLOW_OUTPUT_ROLLBACK_EXAMPLE_SECTION_TITLE,
} from '@/lib/office-workflow-task-prompt-shared';

export {
  buildWorkflowCoordinatorAgentTaskPrompt,
  buildWorkflowCoordinatorFewShotBlock,
  buildWorkflowCoordinatorHandoffHintLines,
  buildWorkflowCoordinatorRulesBlock,
  type WorkflowCoordinatorTaskPromptParams,
} from '@/lib/office-workflow-coordinator-task-prompt';

export {
  buildWorkflowMemberAgentTaskPrompt,
  buildWorkflowMemberFewShotBlock,
  buildWorkflowMemberRulesBlock,
  type WorkflowMemberTaskPromptParams,
} from '@/lib/office-workflow-member-task-prompt';

import type { WorkflowAgentTaskBriefParams } from '@/lib/office-workflow-task-prompt-shared';
import {
  buildWorkflowCoordinatorAgentTaskPrompt,
  buildWorkflowCoordinatorFewShotBlock,
  buildWorkflowCoordinatorHandoffHintLines,
  buildWorkflowCoordinatorRulesBlock,
} from '@/lib/office-workflow-coordinator-task-prompt';
import {
  buildWorkflowMemberAgentTaskPrompt,
  buildWorkflowMemberRulesBlock,
} from '@/lib/office-workflow-member-task-prompt';

export type WorkflowAgentTaskPromptParams = WorkflowAgentTaskBriefParams & {
  isCoordinatorRole?: boolean;
  expectedHandoffLines?: string[];
};

/** 按是否协调者分轨拼装完整提示词。 */
export function buildWorkflowAgentTaskPrompt(params: WorkflowAgentTaskPromptParams): string {
  if (params.isCoordinatorRole) {
    return buildWorkflowCoordinatorAgentTaskPrompt({
      roleName: params.roleName,
      taskTitle: params.taskTitle,
      taskDescription: params.taskDescription,
      featureDescription: params.featureDescription,
      stepTitle: params.stepTitle,
      stepDescription: params.stepDescription,
      teammateNames: params.teammateNames,
      priorDeliverables: params.priorDeliverables,
      directPredecessorDeliverables: params.directPredecessorDeliverables,
      stepIndex: params.stepIndex,
      totalSteps: params.totalSteps,
      projectDirectoryLines: params.projectDirectoryLines,
      expectedHandoffLines: params.expectedHandoffLines,
    });
  }
  return buildWorkflowMemberAgentTaskPrompt({
    roleName: params.roleName,
    taskTitle: params.taskTitle,
    taskDescription: params.taskDescription,
    featureDescription: params.featureDescription,
    stepTitle: params.stepTitle,
    stepDescription: params.stepDescription,
    teammateNames: params.teammateNames,
    priorDeliverables: params.priorDeliverables,
    directPredecessorDeliverables: params.directPredecessorDeliverables,
    stepIndex: params.stepIndex,
    totalSteps: params.totalSteps,
    projectDirectoryLines: params.projectDirectoryLines,
  });
}

/** @deprecated 使用分轨 rules */
export function buildWorkflowAgentRulesBlock(params: {
  isCoordinatorRole?: boolean;
  expectedHandoffLines?: string[];
}): string {
  return params.isCoordinatorRole
    ? buildWorkflowCoordinatorRulesBlock(params.expectedHandoffLines)
    : buildWorkflowMemberRulesBlock('成员');
}

/** @deprecated 使用 {@link buildWorkflowCoordinatorFewShotBlock} */
export function buildWorkflowAgentFewShotBlock(): string {
  return buildWorkflowCoordinatorFewShotBlock();
}

/** @deprecated */
export function buildWorkflowAgentCompactRulesBlock(params: {
  isCoordinatorRole?: boolean;
  expectedHandoffLines?: string[];
}): string {
  return buildWorkflowAgentRulesBlock(params);
}

/** @deprecated 使用 {@link buildWorkflowCoordinatorHandoffHintLines} */
export function buildWorkflowHandoffHintLines(
  expectedHandoffLines: string[] | undefined,
  isCoordinatorRole?: boolean,
): string {
  if (!isCoordinatorRole) {
    return 'workflow runner 按 DAG 自动调度下一节点；【交接】必须写「无」，勿 @ 指派下一跳。';
  }
  return buildWorkflowCoordinatorHandoffHintLines(expectedHandoffLines);
}
