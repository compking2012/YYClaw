import type { OfficeTask, OfficeTaskExecutionMode } from '../types';
import {
  buildSmartRoomCoordinatorMissingMentionPrompt,
  buildSmartRoomCoordinatorPrompt,
  buildSmartRoomCoordinatorUnmentionedPrompt,
  buildSmartRoomCoordinatorUserMentionMemberPrompt,
} from './smart/coordinator-prompt';
import {
  buildSmartRoomMentionAgentPrompt,
  type SmartRoomMentionPromptParams,
} from './smart/mention-prompt';
import {
  buildWorkflowRoomCoordinatorMissingMentionPrompt,
  buildWorkflowRoomCoordinatorPrompt,
  buildWorkflowRoomCoordinatorUnmentionedPrompt,
} from './workflow/coordinator-prompt';
import {
  buildWorkflowRoomMentionAgentPrompt,
  type WorkflowRoomMentionPromptParams,
} from './workflow/mention-prompt';

export { roomTaskBlock } from './shared';
export * from './workflow/blocks';
export * from './smart/blocks';
export * from './smart/task-prompt';
export {
  buildWorkflowRoomMentionAgentPrompt,
  buildWorkflowMentionTriggerBlock,
} from './workflow/mention-prompt';
export {
  buildSmartRoomMentionAgentPrompt,
  buildSmartMentionTriggerBlock,
} from './smart/mention-prompt';
export {
  buildSmartCoordinatorRolePromptBlock,
  buildSmartCoordinatorFewShotBlock,
} from './smart/coordinator-role-prompt';
export {
  buildSmartMemberRolePromptBlock,
  buildSmartMemberFewShotBlock,
} from './smart/member-role-prompt';
export { buildSmartMemberRetryPreamble } from './smart/member-retry-prompt';
export { buildSmartCoordinatorRetryPreamble } from './smart/coordinator-retry-prompt';
export {
  buildWorkflowRoomCoordinatorPrompt,
  buildWorkflowRoomCoordinatorUnmentionedPrompt,
  buildWorkflowRoomCoordinatorMissingMentionPrompt,
} from './workflow/coordinator-prompt';
export {
  buildSmartRoomCoordinatorPrompt,
  buildSmartRoomCoordinatorUnmentionedPrompt,
  buildSmartRoomCoordinatorUserMentionMemberPrompt,
  buildSmartRoomCoordinatorMissingMentionPrompt,
} from './smart/coordinator-prompt';

export type RoomMentionPromptParams = (WorkflowRoomMentionPromptParams | SmartRoomMentionPromptParams) & {
  executionMode?: OfficeTaskExecutionMode;
};

function resolveRoomPromptMode(
  executionMode: OfficeTaskExecutionMode | undefined,
  task?: Partial<OfficeTask> | null,
): OfficeTaskExecutionMode {
  if (executionMode === 'smart' || executionMode === 'workflow') return executionMode;
  return task?.executionMode === 'smart' ? 'smart' : 'workflow';
}

export function buildRoomMentionAgentPrompt(params: RoomMentionPromptParams): string {
  const mode = resolveRoomPromptMode(params.executionMode, params.task);
  if (mode === 'smart') return buildSmartRoomMentionAgentPrompt(params as SmartRoomMentionPromptParams);
  return buildWorkflowRoomMentionAgentPrompt(params as WorkflowRoomMentionPromptParams);
}

type CoordinatorPromptParams = Parameters<typeof buildWorkflowRoomCoordinatorPrompt>[0] & {
  executionMode?: OfficeTaskExecutionMode;
};

export function buildRoomCoordinatorUnmentionedPrompt(
  params: Parameters<typeof buildWorkflowRoomCoordinatorUnmentionedPrompt>[0] & {
    executionMode?: OfficeTaskExecutionMode;
    task?: Pick<OfficeTask, 'title' | 'description' | 'status'> | null;
  },
): string {
  const mode = resolveRoomPromptMode(params.executionMode, params.task);
  if (mode === 'smart') {
    return buildSmartRoomCoordinatorUnmentionedPrompt(
      params as Parameters<typeof buildSmartRoomCoordinatorUnmentionedPrompt>[0],
    );
  }
  return buildWorkflowRoomCoordinatorUnmentionedPrompt(params);
}

export function buildRoomCoordinatorUserMentionMemberPrompt(
  params: Parameters<typeof buildSmartRoomCoordinatorUserMentionMemberPrompt>[0] & {
    executionMode?: OfficeTaskExecutionMode;
    task?: Pick<OfficeTask, 'title' | 'description' | 'status'> | null;
  },
): string {
  const mode = resolveRoomPromptMode(params.executionMode, params.task);
  if (mode === 'smart') return buildSmartRoomCoordinatorUserMentionMemberPrompt(params);
  return buildWorkflowRoomCoordinatorUnmentionedPrompt({
    ...params,
    waitSeconds: 0,
    triggerFromUser: true,
  } as Parameters<typeof buildWorkflowRoomCoordinatorUnmentionedPrompt>[0]);
}

export function buildRoomCoordinatorMissingMentionPrompt(
  params: Parameters<typeof buildWorkflowRoomCoordinatorMissingMentionPrompt>[0] & {
    executionMode?: OfficeTaskExecutionMode;
  },
): string {
  const mode = resolveRoomPromptMode(params.executionMode, params.task);
  if (mode === 'smart') {
    return buildSmartRoomCoordinatorMissingMentionPrompt(
      params as Parameters<typeof buildSmartRoomCoordinatorMissingMentionPrompt>[0],
    );
  }
  return buildWorkflowRoomCoordinatorMissingMentionPrompt(params);
}

export function buildRoomCoordinatorPrompt(params: CoordinatorPromptParams): string {
  const mode = resolveRoomPromptMode(params.executionMode, params.task);
  if (mode === 'smart') {
    return buildSmartRoomCoordinatorPrompt(params as Parameters<typeof buildSmartRoomCoordinatorPrompt>[0]);
  }
  return buildWorkflowRoomCoordinatorPrompt(params);
}
