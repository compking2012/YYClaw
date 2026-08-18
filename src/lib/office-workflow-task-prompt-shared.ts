import { isDeliverableDirPathHint } from '@/lib/office-workflow-project-deliverable';
import {
  normalizeWorkflowLsTarget,
  WORKFLOW_LS_RESULT_VALIDATION_RULE,
} from '@/lib/office-workflow-output-ls-result';

/** 工作流节点 Agent 输出须出现的【】段落标题（与 validateWorkflowAgentStructuredReply 一致）。 */
export const WORKFLOW_AGENT_OUTPUT_SECTIONS = [
  '项目目录',
  '任务理解',
  '输入校验',
  '执行说明',
  '输出校验',
  '交付产物',
  '用法说明',
  '回滚说明',
] as const;

/** 缺了仍须重试的必选【】段落。 */
export const WORKFLOW_AGENT_REQUIRED_OUTPUT_SECTIONS = [
  '项目目录',
  '任务理解',
  '输入校验',
  '输出校验',
  '交付产物',
  '回滚说明',
] as const;

/** 可选【】段落（提示词中说明，缺失不触发重试）。 */
export const WORKFLOW_AGENT_OPTIONAL_OUTPUT_SECTIONS = ['执行说明', '用法说明'] as const;

/** 【回滚说明】无问题时的唯一合法取值。 */
export const WORKFLOW_ROLLBACK_NONE_VALUE = '无';

/** 须回滚时的严格句式（与 office-workflow-rollback 解析一致）。 */
export const WORKFLOW_ROLLBACK_TRIGGER_SENTENCE =
  '【回滚】：{角色名}在「{步骤/任务名}」的交付物存在{异常简述}（{原因说明}）';

/** 提示词中 rollback 字段填写说明（强制输出规则等）。 */
export const WORKFLOW_ROLLBACK_OUTPUT_RULE =
  `不需要任务回滚则rollback字段填 ${WORKFLOW_ROLLBACK_NONE_VALUE}，需要任务回滚则rollback按如下格式填写：${WORKFLOW_ROLLBACK_TRIGGER_SENTENCE}`;

/** @deprecated 使用 {@link WORKFLOW_ROLLBACK_OUTPUT_RULE} 或 {@link WORKFLOW_ROLLBACK_TRIGGER_SENTENCE} */
export const WORKFLOW_ROLLBACK_TRIGGER_FORMAT_HINT = WORKFLOW_ROLLBACK_OUTPUT_RULE;

const WORKFLOW_NUMBERED_STEP_RE = /^\d+[.、)]/u;

/** 样例用可核验路径（勿照抄到真实项目）。 */
export const WORKFLOW_FEW_SHOT_PROJECT_DIR =
  '/Users/demo/.openclaw/workspace-pm/office/projects/demo-tax-task';

/** 大段提示词统一外壳：【标题】--- + 正文行。 */
export function workflowPromptSection(title: string, bodyLines: string[]): string {
  const lines = bodyLines.filter((l) => l !== '');
  return [`【${title}】---`, ...lines].join('\n');
}

export function workflowFewShotLsLine(path: string, size = 2048): string {
  return `-rw-r--r--  1 demo  staff  ${size} May 26 10:00 ${path}`;
}

/** outputValidation 样例：嵌套 target 时 ls 行末保留完整相对路径（文件名可含空格）。 */
export function workflowProjectRelativeOutputLsForTarget(name: string, size = 100): string {
  const t = normalizeWorkflowLsTarget(name);
  if (!t) return workflowProjectRelativeLsLine(name, size);
  if (isDeliverableDirPathHint(t)) {
    return workflowProjectRelativeLsDirLine(workflowLsLineDisplayName(t));
  }
  const label = t.includes('/') ? t : workflowLsLineDisplayName(t);
  return workflowProjectRelativeLsLine(label, size);
}

/** 项目目录内 `ls -l` 样例行（文件，basename 或完整相对路径）。 */
export function workflowProjectRelativeLsLine(name: string, size = 100): string {
  return `-rw-r--r--  1 demo  staff  ${size} May 28 10:00 ${name}`;
}

/** 项目目录内对文件夹 `ls -l` 样例行（drwx，仅文件夹名）。 */
export function workflowProjectRelativeLsDirLine(name: string): string {
  return `drwxr-xr-x  2 demo  staff  64 May 28 10:00 ${name}`;
}

/** ls -l 行末展示名（与真实 `ls -l ./target` 输出一致：相对路径文件常用末段名）。 */
export function workflowLsLineDisplayName(target: string): string {
  const t = normalizeWorkflowLsTarget(target);
  if (!t) return '';
  if (isDeliverableDirPathHint(t)) {
    const segments = t.split('/');
    return segments[segments.length - 1] ?? t;
  }
  if (t.includes('/')) {
    return t.split('/').pop() ?? t;
  }
  return t;
}

/** 项目目录下对单个 target 的 ls -l 样例（文件为 -rw，文件夹为 drwx）。 */
export function workflowProjectRelativeInputLsForTarget(name: string, size = 100): string {
  const t = normalizeWorkflowLsTarget(name);
  const label = workflowLsLineDisplayName(t);
  if (isDeliverableDirPathHint(t)) {
    return workflowProjectRelativeLsDirLine(label);
  }
  return workflowProjectRelativeLsLine(label, size);
}

export function workflowProjectRelativeInputLsForTargets(targets: string[]): string[] {
  return targets.map((t) => workflowProjectRelativeInputLsForTarget(t));
}

/** @deprecated 样例请用 {@link workflowProjectRelativeInputLsForTarget} */
export function workflowProjectRelativeLsLineForTarget(
  name: string,
  size = 100,
): string {
  return isDeliverableDirPathHint(name)
    ? workflowProjectRelativeLsDirLine(name)
    : workflowProjectRelativeLsLine(name, size);
}

/** 工作流协调者/成员 few-shot 外壳标题。 */
export const WORKFLOW_FEW_SHOT_SECTION_TITLE = '【输出格式样例·勿照抄路径与任务名】';

/** Workflow 节点提示词段标题。 */
export const WORKFLOW_MODE_HEADER_TITLE = '【Workflow 模式】';

export const WORKFLOW_OUTPUT_SPEC_SECTION_TITLE =
  '【输出规范与严格校验（合并强制规则 + Schema）】';

/** Workflow 节点提示词【输出示例】段标题。 */
export const WORKFLOW_OUTPUT_EXAMPLE_SECTION_TITLE =
  '【输出示例，仅作为格式参考，勿直接抄袭】';

/** Workflow 节点提示词【输出示例】段：.xx 占位符说明（勿原样输出）。 */
export const WORKFLOW_OUTPUT_EXAMPLE_SUFFIX_PLACEHOLDER_DISCLAIMER =
  '示例中 .xx 仅表示「须替换为本步按命名规范推导的真实文件后缀」；输出 JSON 时不得保留 .xx，须填写真实的文件后缀(如 .pdf、.pptx、.md 等)';

/** Workflow 节点【核心执行流程】内嵌的交付物命名规范（成员/协调者共用）。 */
export function buildWorkflowDeliverableNamingSpecLines(roleName: string): string[] {
  const role = roleName.trim();
  const dir = `交付物-${role}/`;
  return [
    '交付物命名规范：',
    '-交付物命名：xxx-当前角色.文件后缀',
    `-文件后缀：文件后缀要根据[本任务]+[项目]中要求推导得到，若[本任务]+[项目]中描述有冲突则以[本任务]中的要求为准(如任务要求PPT交付则后缀为.pptx)；如[本任务]+[项目]中对格式无要求则默认文件后缀为.md(如 xxx-${role}.md)`,
    `-交付物存放路径：所有交付物必须存放于项目根目录下的 交付物-当前角色/ 目录下（如 ${dir}xxx-${role}.<推导后缀>）`,
  ];
}

const WORKFLOW_SCHEMA_OUTPUT_VALIDATION_DOC_RULE =
  'outputValidation.targets 与 lsResult 为等长字符串数组；targets 与 lsResult 须为等长数组、按索引一一对应；每一项须在项目目录下对该 target 执行 ls -l（相对路径如 交付物-角色/文件.<真实后缀>）；lsResult 为完整原始一行，行末路径须与 target 指向同一文件/目录（不可为绝对路径，禁止 target/ 等非标准目录）';

/** 评审/验收步：不通过 + rollback 纠偏片段（可选第二示例）。 */
export const WORKFLOW_OUTPUT_ROLLBACK_EXAMPLE_SECTION_TITLE =
  '【纠偏参考·评审不通过时 rollback 格式（勿照抄）】';

export type WorkflowStepSchemaVariant = {
  reviewLikeStep?: boolean;
  engineeringStep?: boolean;
  entryStep?: boolean;
};

function workflowSchemaConclusionEnum(options?: WorkflowStepSchemaVariant): string {
  return options?.reviewLikeStep ? '["通过","不通过"]' : '["通过","不通过","已交付"]';
}

function workflowSchemaDeliverableDescription(
  roleName: string,
  options?: WorkflowStepSchemaVariant,
): string {
  const dir = `交付物-${roleName}/`;
  if (options?.engineeringStep) {
    return `交付物须落在 ${dir} 目录（deliverable.path 与 outputValidation.targets 均为 交付物-${roleName} 或目录内相对路径）`;
  }
  return `交付物须落在 ${dir} 下（deliverable.path 须与 outputValidation.targets 中某项一致；禁止 target/ 或项目根散落文件）`;
}

function workflowSchemaInputValidationDescription(options?: WorkflowStepSchemaVariant): string {
  if (options?.entryStep) {
    return '入口节点：inputValidation.targets 与 lsResult 均必须为 []';
  }
  return `inputValidation.targets 建议仅列 DAG 直接前驱交付物（可为 basename 或 交付物-角色/相对路径；系统校验 ls 格式与路径合法性）；lsResult 为等长字符串数组：${WORKFLOW_LS_RESULT_VALIDATION_RULE}`;
}

function workflowSchemaOutputValidationDescription(options?: WorkflowStepSchemaVariant): string {
  if (options?.engineeringStep) {
    return `outputValidation.targets 与 lsResult 为等长字符串数组（如 targets:["交付物-开发"]）；${WORKFLOW_LS_RESULT_VALIDATION_RULE}`;
  }
  return WORKFLOW_SCHEMA_OUTPUT_VALIDATION_DOC_RULE;
}

/** @deprecated 使用 {@link WORKFLOW_OUTPUT_EXAMPLE_SECTION_TITLE} */
export const WORKFLOW_OUTPUT_EXAMPLE_LEGACY_TITLE_V2 = '【输出示例，仅作为示例，勿抄】';

/** @deprecated 使用 {@link WORKFLOW_OUTPUT_EXAMPLE_SECTION_TITLE} */
export const WORKFLOW_OUTPUT_EXAMPLE_LEGACY_TITLE = '【输出示例（关键片段）】';

/** 从 few-shot / 输出示例块提取 JSON 样例正文（供单测校验）。 */
export function extractWorkflowFewShotExample(block: string): string {
  const legacy = '--- 样例 1 ---';
  const idxLegacy = block.indexOf(legacy);
  if (idxLegacy >= 0) return block.slice(idxLegacy + legacy.length).trim();
  const idxExample = block.indexOf(WORKFLOW_OUTPUT_EXAMPLE_SECTION_TITLE);
  if (idxExample >= 0) {
    let slice = block.slice(idxExample + WORKFLOW_OUTPUT_EXAMPLE_SECTION_TITLE.length);
    const rollbackIdx = slice.indexOf(WORKFLOW_OUTPUT_ROLLBACK_EXAMPLE_SECTION_TITLE);
    if (rollbackIdx >= 0) slice = slice.slice(0, rollbackIdx);
    const trimmed = slice.trim();
    const jsonStart = trimmed.indexOf('{');
    return jsonStart >= 0 ? trimmed.slice(jsonStart).trim() : trimmed;
  }
  const idxLegacyExample = block.indexOf(WORKFLOW_OUTPUT_EXAMPLE_LEGACY_TITLE);
  if (idxLegacyExample >= 0) {
    return block.slice(idxLegacyExample + WORKFLOW_OUTPUT_EXAMPLE_LEGACY_TITLE.length).trim();
  }
  const idxLegacyV2 = block.indexOf(WORKFLOW_OUTPUT_EXAMPLE_LEGACY_TITLE_V2);
  if (idxLegacyV2 >= 0) {
    return block.slice(idxLegacyV2 + WORKFLOW_OUTPUT_EXAMPLE_LEGACY_TITLE_V2.length).trim();
  }
  const legacyModeHeader = '【Workflow模式】';
  if (block.includes(legacyModeHeader)) {
    const idxLegacySpec = block.indexOf('【JSON Schema（严格校验）】');
    if (idxLegacySpec >= 0) {
      const afterSpec = block.slice(idxLegacySpec);
      const exampleMarkers = [
        WORKFLOW_OUTPUT_EXAMPLE_SECTION_TITLE,
        WORKFLOW_OUTPUT_EXAMPLE_LEGACY_TITLE_V2,
        WORKFLOW_OUTPUT_EXAMPLE_LEGACY_TITLE,
      ];
      for (const marker of exampleMarkers) {
        const i = afterSpec.indexOf(marker);
        if (i >= 0) return afterSpec.slice(i + marker.length).trim();
      }
    }
  }
  const titleSuffix = `${WORKFLOW_FEW_SHOT_SECTION_TITLE}---`;
  const idx = block.indexOf(titleSuffix);
  if (idx >= 0) return block.slice(idx + titleSuffix.length).trim();
  return block.trim();
}

export function buildWorkflowAgentOutputFormatLines(): string[] {
  return [
    '仅输出 1 个 JSON 对象（UTF-8），禁止 markdown 代码块与额外解释。',
    'role：必须等于当前执行角色；step：包含 index/total/title。',
    'understanding：2-4 句，说明你以当前角色对“本步骤目标/约束/完成判据”的理解，禁止空话。',
    `inputValidation：targets 与 lsResult 均为字符串数组且等长；${WORKFLOW_LS_RESULT_VALIDATION_RULE}；禁止更上游产物、只列文件名/ok/绝对路径；禁止 @ 或点名角色。`,
    'execution：只写本轮已执行动作与结果（落盘/修改/验收结论），不得写“将会/准备/待处理”；建议 ≤100 字。',
    'outputValidation.targets 与 outputValidation.lsResult：均为字符串数组且等长；target 为项目目录下相对路径（如 交付物-开发/index.html 或 交付物-产品/需求-产品.md），在项目目录执行 ls -l ./target；lsResult 为完整 ls 行（行末须为项目目录相对路径、不可为绝对路径，须与 target 同一文件/目录）。',
    `校验规则：${WORKFLOW_LS_RESULT_VALIDATION_RULE}；禁止只列文件名/ok。`,
    'deliverable.summary：必须为关键信息且 ≤100 字；禁止「已发布/已完成」空话；须与 deliverable.conclusion 语义一致。',
    'deliverable.conclusion：通过/不通过/已交付；评审/验收/审计步 conclusion=不通过 时 rollback 须按格式填写，禁止写「无」。',
    'usage：仅写如何复用本轮交付物（命令/入口/下一步建议）；无额外说明时写「无」。',
    `rollback：${WORKFLOW_ROLLBACK_OUTPUT_RULE}（系统将严格匹配后自动回滚，勿用其它措辞）。`,
  ];
}

/** JSON Schema 提示词中的 execution 上限（结构化校验同步）。 */
export const WORKFLOW_JSON_EXECUTION_MAX_CHARS = 100;
/** JSON Schema 提示词中的 summary 上限（结构化校验同步）。 */
export const WORKFLOW_JSON_DELIVERABLE_SUMMARY_MAX_CHARS = 150;

export function buildWorkflowJsonSchemaLines(
  roleName: string,
  options?: WorkflowStepSchemaVariant,
): string[] {
  const conclusionEnum = workflowSchemaConclusionEnum(options);
  const roleConst = JSON.stringify(roleName);
  return [
    '{',
    '  "type": "object",',
    '  "additionalProperties": false,',
    '  "required": ["role","step","inputValidation","execution","outputValidation","deliverable","rollback"],',
    '  "properties": {',
    `    "role": {"const":${roleConst}},`,
    '    "step": {"required":["index","total","title"]},',
    '    "inputValidation": {"required":["targets","lsResult"]},',
    `    "execution": {"type":"string","maxLength":${WORKFLOW_JSON_EXECUTION_MAX_CHARS}},`,
    '    "outputValidation": {"required":["targets","lsResult"]},',
    `    "deliverable": {"required":["path","summary","conclusion"],"properties":{"summary":{"maxLength":${WORKFLOW_JSON_DELIVERABLE_SUMMARY_MAX_CHARS}},"conclusion":{"enum":${conclusionEnum}}}},`,
    '    "rollback": {"type":"string"}',
    '  }',
    '}',
  ];
}

/** Untitled-6：合并强制规则 + 带 description 的 JSON Schema。 */
export function buildWorkflowMergedOutputSpecLines(
  roleName: string,
  options?: WorkflowStepSchemaVariant,
): string[] {
  const conclusionEnum = workflowSchemaConclusionEnum(options);
  const deliverableDesc = workflowSchemaDeliverableDescription(roleName, options);
  const inputValidationDesc = workflowSchemaInputValidationDescription(options);
  const outputValidationDesc = workflowSchemaOutputValidationDescription(options);
  const roleConst = JSON.stringify(roleName);
  return [
    '必须严格输出以下结构的 JSON，不允许额外字段，所有必填字段不能为空：',
    'json',
    '{',
    ' "type": "object",',
    ' "additionalProperties": false,',
    ' "required": ["role","step","inputValidation","execution","outputValidation","deliverable","rollback"],',
    ' "properties": {',
    `    "role": {"const":${roleConst}},`,
    '    "step": {',
    '      "required":["index","total","title"],',
    `      "description":"当前任务步骤信息，如index:6, total:9, title:\\"开发实现\\""`,
    '    },',
    '    "inputValidation": {',
    '      "required":["targets","lsResult"],',
    `      "description":${JSON.stringify(inputValidationDesc)}`,
    '    },',
    '    "execution": {',
    '      "type":"string",',
    `      "maxLength":${WORKFLOW_JSON_EXECUTION_MAX_CHARS},`,
    '      "description":"实际完成的工作和结果，禁止使用“将会/准备/待处理”等未来时态"',
    '    },',
    '    "outputValidation": {',
    '      "required":["targets","lsResult"],',
    `      "description":${JSON.stringify(outputValidationDesc)}`,
    '    },',
    '    "deliverable": {',
    '      "required":["path","summary","conclusion"],',
    '      "properties":{',
    `        "summary":{"maxLength":${WORKFLOW_JSON_DELIVERABLE_SUMMARY_MAX_CHARS},"description":"交付物核心摘要，语义不可与conclusion矛盾"},`,
    `        "conclusion":{"enum":${conclusionEnum},"description":"仅允许这三个值"}`,
    '      },',
    `      "description":${JSON.stringify(deliverableDesc)}`,
    '    },',
    '    "rollback": {',
    '      "type":"string",',
    `      "description":"无需回滚填「无」；需回滚格式：${WORKFLOW_ROLLBACK_TRIGGER_SENTENCE}"`,
    '    }',
    ' }',
    '}',
  ];
}

/** Workflow 提示词【任务信息】中的功能描述正文（来自任务表单 featureDescription）。 */
export function formatWorkflowFeatureDescriptionForPrompt(
  featureDescription?: string | null,
): string {
  const raw = featureDescription?.trim() ?? '';
  if (!raw) return '（未填写功能描述）';
  return raw.replace(/\s*\n+\s*/g, '；');
}

export function extractProjectGoal(taskDescription: string | undefined | null): string | null {
  const raw = (taskDescription ?? '').trim();
  if (!raw) return null;
  const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (WORKFLOW_NUMBERED_STEP_RE.test(line)) continue;
    if (line.length >= 4 && line.length <= 200) return line;
  }
  return null;
}

export function compactWorkflowTaskOverview(params: {
  taskTitle: string;
  taskDescription?: string | null;
  featureDescription?: string | null;
  stepIndex: number;
  totalSteps: number;
}): string {
  const goal =
    extractProjectGoal(params.featureDescription) ??
    extractProjectGoal(params.taskDescription) ??
    params.taskTitle.trim();
  return `项目共 ${params.totalSteps} 步，当前第 ${params.stepIndex}/${params.totalSteps} 步。项目目标：${goal}`;
}

export type WorkflowAgentTaskBriefParams = {
  roleName: string;
  taskTitle: string;
  /** @deprecated 仅兼容调用方；不再写入【任务说明】 */
  taskDescription?: string;
  /** 任务表单「功能描述」 */
  featureDescription?: string;
  stepTitle: string;
  stepDescription?: string;
  teammateNames?: string[];
  priorDeliverables?: string;
  /** 直接前驱节点交付摘要（供 inputValidation 示例 targets）。 */
  directPredecessorDeliverables?: string;
  stepIndex?: number;
  totalSteps?: number;
  projectDirectoryLines?: string[];
};

/** 【团队说明】段。成员 roster 仅协调者节点写入（`includeTeammateRoster`）。 */
export function buildWorkflowTeamBriefBlock(params: {
  roleName: string;
  teammateNames?: string[];
  /** 为 true 时写入「团队成员有：…」（工作流协调者专用）。 */
  includeTeammateRoster?: boolean;
}): string {
  const roster =
    params.includeTeammateRoster
    && params.teammateNames
    && params.teammateNames.length > 0
      ? `团队成员有：${params.teammateNames.join('、')}`
      : '';
  return workflowPromptSection('团队说明', [
    `我是办公团队中的【${params.roleName}】（以该角色身份执行，勿用「扮演」口吻）。`,
    roster,
  ]);
}

/** 从 runner 注入的项目目录行提取绝对路径。 */
export function extractWorkflowProjectRootFromLines(
  projectDirectoryLines?: string[],
): string {
  if (!projectDirectoryLines?.length) return '';
  const line = projectDirectoryLines[0]!.trim().replace(/^-\s*/, '');
  return normalizeWorkflowProjectDirectoryLine(line).match(/[：:]\s*(.+)$/u)?.[1]?.trim() ?? '';
}

/** 将 runner 注入的目录行规范为【项目目录】段正文。 */
export function normalizeWorkflowProjectDirectoryLine(line: string): string {
  const trimmed = line.trim().replace(/^-\s*/, '');
  const pathMatch = trimmed.match(/[：:]\s*(.+)$/u);
  const path = pathMatch?.[1]?.trim() ?? trimmed;
  if (/^（唯一落盘/u.test(trimmed)) return trimmed;
  if (trimmed.includes('项目目录') && pathMatch) {
    return `（Smart/Workflow 唯一落盘与校验目录，所有角色交付/读取/对外产物）：${path}`;
  }
  return `（Smart/Workflow 唯一落盘与校验目录，所有角色交付/读取/对外产物）：${path}`;
}

/** 【项目目录】段。 */
export function buildWorkflowProjectDirectoryBlock(
  projectDirectoryLines?: string[],
): string {
  if (!projectDirectoryLines?.length) return '';
  return workflowPromptSection(
    '项目目录',
    projectDirectoryLines.map(normalizeWorkflowProjectDirectoryLine),
  );
}

/** 【任务说明】段（任务/步骤/上游，不含团队与项目目录）。 */
export function buildWorkflowTaskDescriptionBlock(
  params: Omit<WorkflowAgentTaskBriefParams, 'roleName' | 'teammateNames' | 'projectDirectoryLines'>,
): string {
  const featureDesc = params.featureDescription?.trim() ?? '';

  const taskOverview =
    params.stepIndex != null && params.totalSteps != null && params.totalSteps > 0
      ? compactWorkflowTaskOverview({
          taskTitle: params.taskTitle,
          featureDescription: featureDesc,
          stepIndex: params.stepIndex,
          totalSteps: params.totalSteps,
        })
      : '';

  const upstreamBlock = params.priorDeliverables?.trim()
    ? `上游直接前驱交付（DAG 全部直接前驱；含交付物与关键摘要，完整正文请读磁盘）：\n${params.priorDeliverables.trim()}`
    : '';

  const bodyLines = [
    '执行模式：Workflow（DAG + runner 自动推进；非 Smart 群聊点名驱动）。',
    `项目：${params.taskTitle}`,
    featureDesc ? `功能描述：${featureDesc}` : '',
    taskOverview,
    `本步骤：${params.stepTitle}`,
    params.stepDescription?.trim() ? `步骤说明：${params.stepDescription.trim()}` : '',
    upstreamBlock,
  ];

  return workflowPromptSection('任务说明', bodyLines);
}

/** @deprecated 使用 buildWorkflowTeamBriefBlock + buildWorkflowProjectDirectoryBlock + buildWorkflowTaskDescriptionBlock */
export function buildWorkflowAgentTaskBriefBlock(params: WorkflowAgentTaskBriefParams): string {
  return [
    buildWorkflowTeamBriefBlock({
      roleName: params.roleName,
      teammateNames: params.teammateNames,
    }),
    buildWorkflowProjectDirectoryBlock(params.projectDirectoryLines),
    buildWorkflowTaskDescriptionBlock(params),
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildWorkflowFewShotWrapper(exampleBody: string): string {
  return [`${WORKFLOW_FEW_SHOT_SECTION_TITLE}---`, exampleBody].join('\n');
}

/** 【项目目录】段落是否声明了协调者 workspace 下的 office/projects/… 路径。 */
export function workflowProjectDirectoryDeclaresRoot(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return /(?:~\/|\/Users\/|\/tmp\/|\/var\/)[^\s\n]*\/office\/projects\/[^\s\n]+/iu.test(t);
}
