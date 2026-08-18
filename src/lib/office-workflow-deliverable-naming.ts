import { roleScopedDeliverableDirName, roleScopedDeliverableFileName } from '@/lib/office-project-file-naming';
import { isWorkflowEngineeringDeliverableStep } from '@/lib/office-workflow-deliverable-conclusion';

const DELIVERABLE_STEM_PATTERNS = [
  /[，,]?\s*输出为\s*([^，,。；;]+)/u,
  /[，,]?\s*交付物[为是：:]\s*([^，,。；;]+)/u,
  /[，,]?\s*产出为\s*([^，,。；;]+)/u,
] as const;

/** 从步骤原文提取交付物主题（如「输出为GPGPU相关信息」→ GPGPU相关信息）。 */
export function inferDeliverableStemFromSegment(segment: string): string | null {
  for (const re of DELIVERABLE_STEM_PATTERNS) {
    const m = segment.match(re);
    if (!m?.[1]) continue;
    const stem = m[1]
      .trim()
      .replace(/[。.]\s*$/u, '')
      .replace(/\s*与\s*\d+\s*并行\s*$/u, '')
      .trim();
    if (stem.length >= 2 && stem.length <= 80) return stem;
  }
  return null;
}

/** 去掉交付/输出子句，保留动作描述供 step.title 推断。 */
export function stripWorkflowStepDeliveryClauses(segment: string): string {
  return segment
    .replace(/[，,]?\s*交付物[为是：:]\s*[^；;]+/u, '')
    .replace(/[，,]?\s*输出为\s*[^，,。；;]+/u, '')
    .replace(/[，,]?\s*产出为\s*[^，,。；;]+/u, '')
    .replace(/[；;]\s*与\s*\d+\s*并行\s*$/u, '')
    .trim();
}

export function resolveWorkflowDeliverableFileStem(
  stepTitle: string,
  options?: { stepDescription?: string; rawText?: string },
): string {
  const fromText =
    (options?.rawText && inferDeliverableStemFromSegment(options.rawText))
    || (options?.stepDescription && inferDeliverableStemFromSegment(options.stepDescription));
  if (fromText) return fromText;
  return stepTitle.trim();
}

/** 提示词样例用占位后缀（须替换为本步推导的真实扩展名，勿原样落盘）。 */
export const WORKFLOW_PROMPT_SAMPLE_SUFFIX_PLACEHOLDER = 'xx';

/** 提示词样例 basename 主题：去掉尾部括号补充说明。 */
export function normalizeWorkflowPromptDeliverableStem(stem: string): string {
  const trimmed = stem.trim();
  const withoutParen = trimmed.replace(/（[^）]*）\s*$/u, '').trim();
  return withoutParen || trimmed;
}

/** 提示词【输出示例】用 basename：`{主题}-{角色}.xx`（不写死 .md）。 */
export function workflowPromptSampleDeliverableBasename(
  stepTitle: string,
  roleName: string,
  options?: { stepDescription?: string; rawText?: string },
): string {
  const stem = normalizeWorkflowPromptDeliverableStem(
    resolveWorkflowDeliverableFileStem(stepTitle, options),
  );
  const stemWithoutExt = stem.replace(/\.[a-z0-9]{1,8}$/i, '');
  return roleScopedDeliverableFileName(
    `${stemWithoutExt}.${WORKFLOW_PROMPT_SAMPLE_SUFFIX_PLACEHOLDER}`,
    roleName,
  );
}

/** 提示词【输出示例】用 path：`交付物-{角色}/{basename}.xx`；工程步为目录。 */
export function workflowPromptSampleDeliverablePath(
  stepTitle: string,
  roleName: string,
  options?: { stepDescription?: string; rawText?: string },
): string {
  const dir = roleScopedDeliverableDirName(roleName);
  if (isWorkflowEngineeringDeliverableStep(stepTitle)) {
    return dir;
  }
  return `${dir}/${workflowPromptSampleDeliverableBasename(stepTitle, roleName, options)}`;
}

/** 本步文档类交付物 basename（`{主题}-{角色}.md`，主题优先取自「输出为/交付物为」子句）。 */
export function workflowDeliverableFileName(
  stepTitle: string,
  roleName: string,
  options?: { stepDescription?: string; rawText?: string },
): string {
  const stem = resolveWorkflowDeliverableFileStem(stepTitle, options);
  const base = stem.endsWith('.md') ? stem : `${stem}.md`;
  return roleScopedDeliverableFileName(base, roleName);
}
