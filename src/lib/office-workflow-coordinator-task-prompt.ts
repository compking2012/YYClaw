import { buildWorkflowNodeTaskPrompt } from '@/lib/office-workflow-node-task-prompt';
import type { WorkflowAgentTaskBriefParams } from '@/lib/office-workflow-task-prompt-shared';

export type WorkflowCoordinatorTaskPromptParams = WorkflowAgentTaskBriefParams & {
  expectedHandoffLines?: string[];
};

export function buildWorkflowCoordinatorAgentTaskPrompt(
  params: WorkflowCoordinatorTaskPromptParams,
): string {
  return buildWorkflowNodeTaskPrompt({
    ...params,
    isCoordinatorRole: true,
  });
}

/** @deprecated 协调者 few-shot 已并入【输出示例】段。 */
export function buildWorkflowCoordinatorFewShotBlock(): string {
  return '';
}

export function buildWorkflowCoordinatorHandoffHintLines(
  expectedHandoffLines: string[] | undefined,
): string {
  if (expectedHandoffLines && expectedHandoffLines.length > 0) {
    const hints = expectedHandoffLines.map((l) => l.replace(/^-\s*/, '').trim()).join('；');
    return `runner 将自动进入后继节点（如 ${hints}）；勿在结构化输出中 @ 指派下一跳。`;
  }
  return '本步为末步或无后继时，后继由 runner 按 DAG 自动推进。';
}

/** @deprecated 规则已并入节点任务提示词各段。 */
export function buildWorkflowCoordinatorRulesBlock(_expectedHandoffLines?: string[]): string {
  return '';
}

export function buildWorkflowCoordinatorRulesBlockForRole(
  _roleName: string,
  _expectedHandoffLines?: string[],
): string {
  return '';
}
