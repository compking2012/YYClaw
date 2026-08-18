export type WorkflowStepCheckpointInferInput = {
  rawText?: string;
  action?: string;
  description?: string;
  title?: string;
  who?: string;
  userCheckpoint?: boolean;
};

/**
 * 步骤描述中声明「本步需人工/用户审核、校验、干预」等流程约束。
 * 命中后应对该步开启 userCheckpoint（与结构化编排勾选等效）。
 */
export const USER_CHECKPOINT_STEP_CUE_RE =
  /(?:(?:本|此|该|这一)\s*步\s*)(?:(?:需(?:要)?|须|要)\s*)?(?:由?\s*)?(?:人工|用户)\s*(?:审核|校验|干预|确认|复核|把关)|(?:^|[，,；;、\s])(?:人工|用户)\s*(?:审核|校验|干预|确认|复核)(?:\s*(?:环节|节点|步骤|关卡))?|(?:需(?:要)?|须|要)\s*(?:由?\s*)?(?:人工|用户)\s*(?:审核|校验|干预|确认|复核|把关)/u;

const USER_CHECKPOINT_STRIP_RES = [
  /[，,；;、]\s*(?:(?:本|此|该|这一)\s*步\s*)?(?:需(?:要)?|须|要)\s*(?:由?\s*)?(?:人工|用户)\s*(?:审核|校验|干预|确认|复核|把关)(?:\s*(?:环节|节点|步骤|关卡))?/gu,
  /[，,；;、]\s*(?:人工|用户)\s*(?:审核|校验|干预|确认|复核)(?:\s*(?:环节|节点|步骤|关卡))?/gu,
  /^(?:(?:本|此|该|这一)\s*步\s*)?(?:需(?:要)?|须|要)\s*(?:由?\s*)?(?:人工|用户)\s*(?:审核|校验|干预|确认|复核|把关)(?:\s*(?:环节|节点|步骤|关卡))?[，,；;、\s]*/u,
] as const;

export function inferUserCheckpointFromStepText(text: string | null | undefined): boolean {
  const trimmed = text?.trim() ?? '';
  if (!trimmed) return false;
  return USER_CHECKPOINT_STEP_CUE_RE.test(trimmed);
}

/** 去掉步骤正文中的用户审核声明子句，避免重复进入任务描述。 */
export function stripUserCheckpointCueClauses(text: string): string {
  let out = text.trim();
  for (const re of USER_CHECKPOINT_STRIP_RES) {
    out = out.replace(re, '').trim();
  }
  return out.replace(/^[，,；;、\s]+/u, '').replace(/[，,；;、\s]+$/u, '').trim();
}

export function stepTextForUserCheckpointInference(step: WorkflowStepCheckpointInferInput): string {
  return [
    step.rawText,
    step.who,
    step.action,
    step.description,
    step.title,
  ]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join('\n');
}

export function resolveStepUserCheckpoint(step: WorkflowStepCheckpointInferInput): boolean {
  if (step.userCheckpoint === true) return true;
  return inferUserCheckpointFromStepText(stepTextForUserCheckpointInference(step));
}

export function enrichWorkflowGenerationStepUserCheckpoint<
  T extends WorkflowStepCheckpointInferInput,
>(step: T): T {
  if (!resolveStepUserCheckpoint(step)) return step;
  const next = { ...step, userCheckpoint: true as const };
  if (typeof next.action === 'string' && next.action.trim()) {
    next.action = stripUserCheckpointCueClauses(next.action);
  }
  if (typeof next.description === 'string' && next.description.trim()) {
    const stripped = stripUserCheckpointCueClauses(next.description);
    if (stripped) next.description = stripped;
  }
  if (typeof next.title === 'string' && next.title.trim()) {
    const strippedTitle = stripUserCheckpointCueClauses(next.title);
    if (strippedTitle) next.title = strippedTitle;
  }
  return next;
}

export function enrichWorkflowGenerationStepsUserCheckpoint<
  T extends WorkflowStepCheckpointInferInput,
>(steps: T[]): T[] {
  return steps.map(enrichWorkflowGenerationStepUserCheckpoint);
}
