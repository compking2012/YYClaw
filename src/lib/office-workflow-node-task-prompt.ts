import {
  extractWorkflowUpstreamTargetNames,
  formatWorkflowUpstreamDeliverableFileList,
} from '@/lib/office-workflow-prior-context';
import {
  isWorkflowEngineeringDeliverableStep,
  isWorkflowReviewLikeStepTitle,
} from '@/lib/office-workflow-deliverable-conclusion';
import { roleScopedDeliverableDirName } from '@/lib/office-project-file-naming';
import {
  workflowDeliverableFileName,
  workflowPromptSampleDeliverablePath,
} from '@/lib/office-workflow-deliverable-naming';
import {
  buildWorkflowDeliverableNamingSpecLines,
  buildWorkflowMergedOutputSpecLines,
  extractWorkflowProjectRootFromLines,
  formatWorkflowFeatureDescriptionForPrompt,
  WORKFLOW_MODE_HEADER_TITLE,
  WORKFLOW_OUTPUT_EXAMPLE_SECTION_TITLE,
  WORKFLOW_OUTPUT_EXAMPLE_SUFFIX_PLACEHOLDER_DISCLAIMER,
  WORKFLOW_OUTPUT_ROLLBACK_EXAMPLE_SECTION_TITLE,
  WORKFLOW_ROLLBACK_TRIGGER_SENTENCE,
  workflowProjectRelativeInputLsForTargets,
  workflowProjectRelativeLsDirLine,
  workflowProjectRelativeOutputLsForTarget,
  type WorkflowAgentTaskBriefParams,
  type WorkflowStepSchemaVariant,
} from '@/lib/office-workflow-task-prompt-shared';

export {
  WORKFLOW_JSON_DELIVERABLE_SUMMARY_MAX_CHARS,
  WORKFLOW_JSON_EXECUTION_MAX_CHARS,
} from '@/lib/office-workflow-task-prompt-shared';

export type WorkflowNodeTaskPromptParams = WorkflowAgentTaskBriefParams & {
  isCoordinatorRole?: boolean;
  expectedHandoffLines?: string[];
};

export type WorkflowOutputExampleParams = {
  roleName: string;
  stepIndex?: number;
  totalSteps?: number;
  stepTitle: string;
  sampleDeliverable: string;
  sampleConclusion?: '通过' | '不通过' | '已交付';
  sampleRollback?: string;
  sampleTargets?: string[];
};

export type WorkflowOutputExampleJson = {
  role: string;
  step: { index: number; total: number; title: string };
  inputValidation: { targets: string[]; lsResult: string[] };
  execution: string;
  outputValidation: { targets: string[]; lsResult: string[] };
  deliverable: { path: string; summary: string; conclusion: '通过' | '不通过' | '已交付' };
  rollback: string;
};

function buildWorkflowSampleInputValidation(targets: string[]): {
  targets: string[];
  lsResult: string[];
} {
  if (targets.length === 0) {
    return { targets: [], lsResult: [] };
  }
  return {
    targets,
    lsResult: workflowProjectRelativeInputLsForTargets(targets),
  };
}

function buildWorkflowSampleExecution(stepTitle: string, sampleDeliverable: string): string {
  if (isWorkflowEngineeringDeliverableStep(stepTitle)) {
    return `编写 HTML 程序实现五子棋核心功能，已落盘至${sampleDeliverable}目录。`;
  }
  if (isWorkflowReviewLikeStepTitle(stepTitle)) {
    return `已完成${stepTitle.trim()}并落盘评审结论。`;
  }
  return '已完成本步执行并落盘。';
}

function buildWorkflowSampleDeliverableSummary(stepTitle: string): string {
  if (isWorkflowEngineeringDeliverableStep(stepTitle)) {
    return '包含完整游戏逻辑与交互界面的可执行程序。';
  }
  if (isWorkflowReviewLikeStepTitle(stepTitle)) {
    return '评审结论与关键风险已落盘。';
  }
  return '关键结论摘要。';
}

function buildWorkflowSampleOutputValidation(
  stepTitle: string,
  sampleDeliverable: string,
): { targets: string[]; lsResult: string[] } {
  if (isWorkflowEngineeringDeliverableStep(stepTitle)) {
    return {
      targets: [sampleDeliverable],
      lsResult: [workflowProjectRelativeLsDirLine(sampleDeliverable)],
    };
  }
  return {
    targets: [sampleDeliverable],
    lsResult: [workflowProjectRelativeOutputLsForTarget(sampleDeliverable)],
  };
}

/** 构建与校验一致的完整 JSON 样例对象（供提示词与单测复用）。 */
export function buildWorkflowOutputExampleJson(
  params: WorkflowOutputExampleParams,
): WorkflowOutputExampleJson {
  const idx = params.stepIndex ?? 1;
  const total = params.totalSteps ?? 9;
  const targets = params.sampleTargets ?? [];
  return {
    role: params.roleName,
    step: { index: idx, total, title: params.stepTitle },
    inputValidation: buildWorkflowSampleInputValidation(targets),
    execution: buildWorkflowSampleExecution(params.stepTitle, params.sampleDeliverable),
    outputValidation: buildWorkflowSampleOutputValidation(params.stepTitle, params.sampleDeliverable),
    deliverable: {
      path: params.sampleDeliverable,
      summary: buildWorkflowSampleDeliverableSummary(params.stepTitle),
      conclusion: params.sampleConclusion ?? '通过',
    },
    rollback: params.sampleRollback ?? '无',
  };
}

function buildWorkflowOutputExampleBlock(params: WorkflowOutputExampleParams): string {
  const example = JSON.stringify(buildWorkflowOutputExampleJson(params), null, 2);
  return [
    WORKFLOW_OUTPUT_EXAMPLE_SECTION_TITLE,
    WORKFLOW_OUTPUT_EXAMPLE_SUFFIX_PLACEHOLDER_DISCLAIMER,
    example,
  ].join('\n');
}

function buildWorkflowReviewRollbackCorrectionBlock(params: {
  roleName: string;
  stepTitle: string;
  upstreamRole?: string;
  upstreamStep?: string;
}): string {
  const upstreamRole = params.upstreamRole?.trim() || '产品';
  const upstreamStep = params.upstreamStep?.trim() || '需求初稿';
  const fragment = {
    deliverable: {
      path: workflowPromptSampleDeliverablePath(params.stepTitle, params.roleName),
      summary: '关键标准缺失，不满足进入下一阶段条件。',
      conclusion: '不通过',
    },
    rollback: `【回滚】：${upstreamRole}在「${upstreamStep}」的交付物存在关键缺陷（具体原因说明）`,
  };
  return [
    WORKFLOW_OUTPUT_ROLLBACK_EXAMPLE_SECTION_TITLE,
    '当 conclusion 为「不通过」时，rollback 不能为「无」，须严格匹配如下格式（仅展示 deliverable 与 rollback 字段）：',
    JSON.stringify(fragment, null, 2),
    `完整句式参考：${WORKFLOW_ROLLBACK_TRIGGER_SENTENCE}`,
  ].join('\n');
}

export function resolveWorkflowStepSchemaVariant(params: {
  stepTitle: string;
  sampleTargets: string[];
}): WorkflowStepSchemaVariant {
  const stepTitle = params.stepTitle.trim();
  const reviewLike = isWorkflowReviewLikeStepTitle(stepTitle);
  return {
    reviewLikeStep: reviewLike,
    engineeringStep: isWorkflowEngineeringDeliverableStep(stepTitle),
    entryStep: !reviewLike && params.sampleTargets.length === 0,
  };
}

function formatProjectProgressLine(
  params: Pick<
    WorkflowNodeTaskPromptParams,
    'taskTitle' | 'taskDescription' | 'featureDescription' | 'stepIndex' | 'totalSteps'
  >,
): string {
  const featureDesc = formatWorkflowFeatureDescriptionForPrompt(params.featureDescription);
  const progress =
    params.stepIndex != null && params.totalSteps != null && params.totalSteps > 0
      ? `，当前 ${params.stepIndex}/${params.totalSteps}步`
      : '';
  return `项目："${params.taskTitle}"，功能描述："${featureDesc}"${progress}`;
}

function formatCurrentTaskLine(stepTitle: string, stepDescription?: string): string {
  const desc = stepDescription?.trim() || stepTitle.trim();
  return `本任务(我此次要完成的任务)：${desc}`;
}

function buildWorkflowHeaderBlock(params: {
  roleName: string;
  teammateNames?: string[];
  includeTeammateRoster?: boolean;
  projectDirectoryLines?: string[];
}): string {
  const lines = [WORKFLOW_MODE_HEADER_TITLE, `当前角色：${params.roleName}`];
  if (
    params.includeTeammateRoster
    && params.teammateNames
    && params.teammateNames.length > 0
  ) {
    lines.push(`团队成员：${params.teammateNames.join('、')}`);
  }
  const root = extractWorkflowProjectRootFromLines(params.projectDirectoryLines);
  if (root) {
    lines.push(
      `项目目录（唯一落盘与校验目录，所有角色交付 / 读取 / 对外产物）：${root}`,
    );
  }
  return lines.join('\n');
}

/** 【任务信息】读盘提示：不枚举全部上游文件名，仅提醒从项目目录读取。 */
export const WORKFLOW_READ_UPSTREAM_FROM_PROJECT_DIR_HINT =
  '上游所有交付物请从项目目录中读取，勿仅凭直接前驱交付物信息臆测';

function buildWorkflowTaskInfoBlock(
  params: Omit<WorkflowNodeTaskPromptParams, 'roleName' | 'teammateNames' | 'projectDirectoryLines'>,
): string {
  const directPriorTrimmed = params.directPredecessorDeliverables?.trim() ?? '';
  const directTargetList = formatWorkflowUpstreamDeliverableFileList(directPriorTrimmed);
  const directLine = directTargetList
    ? `直接前驱交付物：\n${directTargetList}`
    : '直接前驱交付物：无（inputValidation.targets 与 lsResult 均为 []）';

  const body = [
    '【任务信息】',
    formatProjectProgressLine(params),
    formatCurrentTaskLine(params.stepTitle, params.stepDescription),
    directLine,
    WORKFLOW_READ_UPSTREAM_FROM_PROJECT_DIR_HINT,
  ];
  return body.join('\n');
}

function buildWorkflowExecuteStepLine(stepTitle: string, roleName: string): string {
  const title = stepTitle.trim();
  const role = roleName.trim();
  const dir = roleScopedDeliverableDirName(role);
  if (isWorkflowEngineeringDeliverableStep(title)) {
    return `执行任务：真实完成本任务的执行，在项目目录 ${dir}/ 下落盘文件`;
  }
  return `执行任务：真实完成本任务的执行，在项目目录 ${dir}/ 下落盘本步交付物`;
}

function buildWorkflowOutputValidationStepLine(_stepTitle: string): string {
  return '输出校验：outputValidation.targets 与 lsResult 为等长数组；deliverable.path 须与 targets 中某项一致；每项在项目目录下 ls -l ./target 校验';
}

function buildWorkflowCoreExecutionFlowBlock(
  params: Pick<WorkflowNodeTaskPromptParams, 'roleName' | 'stepTitle'>,
): string {
  return [
    '【核心执行流程】',
    '输入校验：inputValidation.targets 与 lsResult 为等长数组；每项在项目目录下 ls -l ./target 校验，不存在则 rollback（targets 建议仅列直接前驱）',
    buildWorkflowExecuteStepLine(params.stepTitle, params.roleName),
    ...buildWorkflowDeliverableNamingSpecLines(params.roleName),
    buildWorkflowOutputValidationStepLine(params.stepTitle),
    '交付结论：如果是验收 / 审计 / 评审类任务，需要明确输出结论，结论为不通过则任务回滚',
    '输出结果：仅输出符合规范的 JSON',
  ].join('\n');
}

/** 本步文档类交付物 basename（校验/重试等仍用 `.md` 推断；提示词样例见 workflowPromptSampleDeliverableBasename）。 */
export function workflowNodeSampleDeliverableFileName(
  stepTitle: string,
  roleName: string,
  options?: { stepDescription?: string; rawText?: string },
): string {
  return workflowDeliverableFileName(stepTitle, roleName, options);
}

/** 本步样例交付物 path/target（统一为 `交付物-{角色}/…`，与 Smart 一致）。 */
export function workflowNodeSampleDeliverablePath(
  stepTitle: string,
  roleName: string,
  options?: { stepDescription?: string; rawText?: string },
): string {
  const dir = roleScopedDeliverableDirName(roleName);
  if (isWorkflowEngineeringDeliverableStep(stepTitle)) {
    return dir;
  }
  return `${dir}/${workflowNodeSampleDeliverableFileName(stepTitle, roleName, options)}`;
}

/** Workflow 节点任务提示词（成员/协调者共用骨架；协调者多「团队成员」行）。 */
export function buildWorkflowNodeTaskPrompt(params: WorkflowNodeTaskPromptParams): string {
  const stepTitle = params.stepTitle.trim();
  const deliverableOptions = { stepDescription: params.stepDescription };
  const sampleDeliverable = workflowPromptSampleDeliverablePath(
    stepTitle,
    params.roleName,
    deliverableOptions,
  );
  const sampleTargets = extractWorkflowUpstreamTargetNames(
    params.directPredecessorDeliverables?.trim() ?? '',
  );
  const reviewLike = isWorkflowReviewLikeStepTitle(stepTitle);
  const engineering = isWorkflowEngineeringDeliverableStep(stepTitle);
  const sampleConclusion: '通过' | '不通过' | '已交付' = reviewLike
    ? '通过'
    : engineering || sampleTargets.length === 0
      ? '已交付'
      : '通过';
  const schemaVariant = resolveWorkflowStepSchemaVariant({ stepTitle, sampleTargets });
  const exampleParams: WorkflowOutputExampleParams = {
    roleName: params.roleName,
    stepIndex: params.stepIndex,
    totalSteps: params.totalSteps,
    stepTitle,
    sampleDeliverable,
    sampleTargets,
    sampleConclusion,
  };

  const blocks = [
    buildWorkflowHeaderBlock({
      roleName: params.roleName,
      teammateNames: params.teammateNames,
      includeTeammateRoster: params.isCoordinatorRole,
      projectDirectoryLines: params.projectDirectoryLines,
    }),
    buildWorkflowTaskInfoBlock(params),
    buildWorkflowCoreExecutionFlowBlock(params),
    buildWorkflowMergedOutputSpecLines(params.roleName, schemaVariant).join('\n'),
    buildWorkflowOutputExampleBlock(exampleParams),
  ];
  if (reviewLike) {
    blocks.push(
      buildWorkflowReviewRollbackCorrectionBlock({
        roleName: params.roleName,
        stepTitle,
      }),
    );
  }
  return blocks.join('\n\n');
}
