import {
  isSmartValidationSectionExempt,
  resolveSmartValidationScope,
  resolveSmartValidationScopeFromSectionsOnly,
  type SmartValidationScope,
} from '@/lib/office-smart-validation-scope';
import type { SmartWorkOrderStep } from '@/lib/office-smart-work-order';
import type { RoomMessage } from '@/types/office';
import {
  validateOfficeFileDeliverableMessage,
  validateWorkflowDeliverableSection,
  validateWorkflowRoleScopedDeliverablePaths,
} from '@/lib/office-deliverable-file-policy';
/** 复用「行首【任务理解】」检测；Workflow 节点 Agent 另有独立校验，见 workflow-agent-reply。 */
import { hasWorkflowTaskUnderstandingHeading } from '@/lib/office-workflow-agent-structured';
import type { SmartMemberExecutionReadiness } from '@/lib/office-smart-member-reply';
import { isSmartSubtaskDoneBracketTitle } from '@/lib/office-smart-member-reply';

/** Smart 协调者点名回复必选【】段落。 */
export const SMART_WORKFLOW_MIRROR_REQUIRED_SECTIONS = [
  '任务理解',
  '输入校验',
  '输出校验',
  '交付产物',
] as const;

/** Smart 成员点名回复必选【】段落（不做【输入校验】，由协调者验收上游）。 */
export const SMART_MEMBER_MIRROR_REQUIRED_SECTIONS = [
  '任务理解',
  '输出校验',
  '交付产物',
] as const;

const SECTION_HEADING_RE = /(?:^|\n)【\s*([^】]+)\s*】/gu;

const PROMPT_ECHO_SECTION_RE =
  /^(?:成员[·•\s]*可执行|可执行|硬性要求|汇报协调者|依赖未就绪)/u;

/** 协调者/阻塞/验收场景下【交付产物】可无路径的明示写法。 */
const SMART_DELIVERABLE_EXEMPT_RE =
  /^(?:无|暂无|不涉及|无新(?:交付|产出|文件)|沿用上次|验收通知|依赖未就绪)/iu;

export type SmartWorkflowMirrorValidationIssue =
  | 'missing_task_understanding'
  | 'missing_workflow_mirror_section'
  | 'missing_deliverable_section'
  | 'deliverable_too_short'
  | 'deliverable_missing_file_path'
  | 'deliverable_section_too_long'
  | 'deliverable_promissory_only'
  | 'deliverable_inline_too_long'
  | 'missing_member_mirror_section'
  | 'input_validation_section_required'
  | 'output_validation_section_required'
  | 'deliverable_filename_missing_role_suffix';

export function listSmartWorkflowMirrorSectionTitles(raw: string): string[] {
  return [...raw.matchAll(SECTION_HEADING_RE)].map((m) => m[1]!.trim());
}

export function extractOfficeBracketSections(raw: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const matches = [...raw.trim().matchAll(SECTION_HEADING_RE)];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const title = m[1]!.trim();
    if (PROMPT_ECHO_SECTION_RE.test(title)) continue;
    if (isSmartSubtaskDoneBracketTitle(title)) continue;
    const start = m.index! + m[0].length;
    const end = matches[i + 1]?.index ?? raw.length;
    const chunk = raw.slice(start, end).trim();
    if (chunk) sections[title] = chunk;
  }
  return sections;
}

function pickSectionBlob(sections: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const direct = sections[key]?.trim();
    if (direct) return direct;
    const hit = Object.entries(sections).find(
      ([k]) => k === key || (key.length >= 3 && k.includes(key)),
    );
    if (hit?.[1]?.trim()) return hit[1].trim();
  }
  return '';
}

function listMissingMirrorSections(
  raw: string,
  required: readonly string[],
): string[] {
  const titles = listSmartWorkflowMirrorSectionTitles(raw);
  return required.filter(
    (section) =>
      !titles.some(
        (t) => t === section || t.includes(section) || section.includes(t),
      ),
  );
}

export function listMissingSmartWorkflowMirrorSections(raw: string): string[] {
  return listMissingMirrorSections(raw, SMART_WORKFLOW_MIRROR_REQUIRED_SECTIONS);
}

export function listMissingSmartMemberMirrorSections(raw: string): string[] {
  return listMissingMirrorSections(raw, SMART_MEMBER_MIRROR_REQUIRED_SECTIONS);
}

/** 同步校验：有待核验路径时校验段须非空且非「无」；存在性由引擎在磁盘执行。 */
function validateScopedValidationSectionPresent(
  sectionText: string,
  requiredPaths: string[],
): boolean {
  if (requiredPaths.length === 0) return true;
  if (isSmartValidationSectionExempt(sectionText)) return false;
  return sectionText.trim().length > 0;
}

function resolveValidationScopeForMirror(
  raw: string,
  options?: {
    smartValidationScope?: SmartValidationScope;
    viewerRoleId?: string;
    taskId?: string;
    smartWorkSteps?: SmartWorkOrderStep[];
    roomMessages?: RoomMessage[];
    isCoordinator?: boolean;
    memberReportRaw?: string;
  },
): SmartValidationScope {
  if (options?.smartValidationScope) return options.smartValidationScope;
  if (
    options?.viewerRoleId
    && options.taskId
    && options.smartWorkSteps
    && options.roomMessages
  ) {
    return resolveSmartValidationScope({
      raw,
      viewerRoleId: options.viewerRoleId,
      steps: options.smartWorkSteps,
      roomMessages: options.roomMessages,
      taskId: options.taskId,
      isCoordinator: options.isCoordinator,
      memberReportRaw: options.memberReportRaw,
    });
  }
  return resolveSmartValidationScopeFromSectionsOnly(raw, {
    forMember: options?.isCoordinator !== true,
  });
}

export function validateSmartWorkflowMirrorSections(
  raw: string,
  options?: {
    isCoordinator?: boolean;
    smartMemberReadiness?: SmartMemberExecutionReadiness;
    minTaskUnderstandingChars?: number;
    smartValidationScope?: SmartValidationScope;
    viewerRoleId?: string;
    taskId?: string;
    smartWorkSteps?: SmartWorkOrderStep[];
    roomMessages?: RoomMessage[];
    memberReportRaw?: string;
    actorRoleName?: string;
  },
): SmartWorkflowMirrorValidationIssue[] {
  const text = raw.trim();
  const issues: SmartWorkflowMirrorValidationIssue[] = [];
  const forMember = options?.isCoordinator !== true;

  if (!text) {
    return [
      'missing_task_understanding',
      forMember ? 'missing_member_mirror_section' : 'missing_workflow_mirror_section',
      'missing_deliverable_section',
    ];
  }

  /** 协调者：须有四段标题 + 【任务理解】；输入/输出/交付可为「无」。 */
  if (options?.isCoordinator) {
    const titles = listSmartWorkflowMirrorSectionTitles(text);
    for (const required of SMART_WORKFLOW_MIRROR_REQUIRED_SECTIONS) {
      const hasTitle = titles.some(
        (t) => t === required || t.includes(required) || required.includes(t),
      );
      if (!hasTitle) issues.push('missing_workflow_mirror_section');
    }
    if (!hasWorkflowTaskUnderstandingHeading(text)) {
      issues.push('missing_task_understanding');
    } else {
      const sections = extractOfficeBracketSections(text);
      const body =
        pickSectionBlob(sections, ['任务理解', '理解'])
        || pickSectionBlob(sections, ['理解']);
      if (!body.trim()) issues.push('missing_task_understanding');
    }
    const sections = extractOfficeBracketSections(text);
    const inputCheck = pickSectionBlob(sections, ['输入校验', '输入检查']);
    const scope = resolveValidationScopeForMirror(text, options);
    if (!validateScopedValidationSectionPresent(inputCheck, scope.inputPaths)) {
      issues.push('input_validation_section_required');
    }
    return [...new Set(issues)];
  }

  if (!hasWorkflowTaskUnderstandingHeading(text)) {
    issues.push('missing_task_understanding');
  } else {
    const sections = extractOfficeBracketSections(text);
    const body =
      pickSectionBlob(sections, ['任务理解', '理解'])
      || pickSectionBlob(sections, ['理解']);
    const min = options?.minTaskUnderstandingChars ?? 12;
    if (body.length < min) issues.push('missing_task_understanding');
  }

  const missing = listMissingSmartMemberMirrorSections(text);
  if (missing.length > 0) {
    issues.push('missing_member_mirror_section');
    if (missing.includes('交付产物')) issues.push('missing_deliverable_section');
  }

  const sections = extractOfficeBracketSections(text);
  const deliverable = pickSectionBlob(sections, ['交付产物', '产物']);

  /** 【交付产物】为「无」等明示无产出：成员（含误派 ready）与协调者阻塞/验收场景均跳过路径/篇幅硬性校验。 */
  const deliverableExempt =
    !!deliverable.trim() && SMART_DELIVERABLE_EXEMPT_RE.test(deliverable.trim());

  if (!deliverable.trim() && !issues.includes('missing_deliverable_section')) {
    issues.push('missing_deliverable_section');
  }

  if (deliverable.trim() && !deliverableExempt) {
    for (const si of validateWorkflowDeliverableSection(deliverable)) {
      if (si === 'missing_file_path_in_section') {
        issues.push('deliverable_missing_file_path');
      }
      if (si === 'summary_too_short') issues.push('deliverable_too_short');
      if (si === 'promissory_only') issues.push('deliverable_promissory_only');
    }
    const fileIssues = validateOfficeFileDeliverableMessage(deliverable);
    if (
      fileIssues.includes('missing_file_path')
      && !issues.includes('deliverable_missing_file_path')
    ) {
      issues.push('deliverable_missing_file_path');
    }
    const actorRole = options?.actorRoleName?.trim();
    if (
      actorRole
      && !validateWorkflowRoleScopedDeliverablePaths(actorRole, deliverable)
    ) {
      issues.push('deliverable_filename_missing_role_suffix');
    }
  }

  return [...new Set(issues)];
}

export function formatSmartWorkflowMirrorIssue(
  issue: SmartWorkflowMirrorValidationIssue,
): string {
  const map: Record<SmartWorkflowMirrorValidationIssue, string> = {
    missing_task_understanding:
      'taskUnderstanding 不能为空（须完整标题 + 有效正文）',
    missing_workflow_mirror_section:
      '缺少必填 JSON 字段（协调者：role/inputValidation/taskUnderstanding/action/deliverable/dispatch）',
    missing_member_mirror_section:
      '缺少必填 JSON 字段（成员：role/taskUnderstanding/action/deliverable/dispatch）',
    missing_deliverable_section: 'deliverable.items 不能为空（须声明交付物目录）',
    deliverable_too_short: 'deliverable.items 对应摘要过短',
    deliverable_missing_file_path:
      'deliverable.items 须声明 交付物-角色名/ 目录；详情写入该目录内文件',
    deliverable_section_too_long: 'deliverable 内联摘要不得超过 200 字',
    deliverable_promissory_only:
      'deliverable 禁止仅「已发布/已完成」等空话；须目录路径 + 关键摘要',
    deliverable_inline_too_long:
      'deliverable 内联摘要与 taskUnderstanding 合计信息正文不得超过 500 字',
    input_validation_section_required:
      'inputValidation 须写明上一跳交付物路径或写「无」；系统会校验文件/文件夹是否存在',
    output_validation_section_required:
      'deliverable.outputValidation 须写明本轮 deliverable.items 目录的 ls -l 结果或写「无」',
    deliverable_filename_missing_role_suffix:
      'deliverable.items 须落在 交付物-角色名/ 下（目录或目录内文件），禁止 target/ 或项目根散落文件',
  };
  return map[issue] ?? issue;
}
