import { buildWorkflowNodeTaskPrompt } from '@/lib/office-workflow-node-task-prompt';
import type { WorkflowAgentTaskBriefParams } from '@/lib/office-workflow-task-prompt-shared';

export type WorkflowMemberTaskPromptParams = WorkflowAgentTaskBriefParams;

export function buildWorkflowMemberAgentTaskPrompt(params: WorkflowMemberTaskPromptParams): string {
  return buildWorkflowNodeTaskPrompt({
    ...params,
    isCoordinatorRole: false,
  });
}

/** @deprecated 成员 few-shot 已并入【输出示例】段。 */
export function buildWorkflowMemberFewShotBlock(): string {
  return '';
}

/** @deprecated 规则已并入节点任务提示词各段。 */
export function buildWorkflowMemberRulesBlock(_roleName: string): string {
  return '';
}
