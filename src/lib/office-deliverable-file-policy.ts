import {
  deliverableDirNameMatchesRole,
  deliverableFileNameMatchesRole,
  isUnderRoleScopedDeliverableDir,
  roleScopedDeliverableDirName,
  workflowDeliverablePathUnderRoleDir,
} from '@/lib/office-project-file-naming';
import {
  collectDeliverablePathHintsFromText,
  isDeliverableDirPathHint,
} from '@/lib/office-workflow-project-deliverable';
import { isWorkflowPromissoryDeliverable } from '@/lib/office-workflow-promissory';
import { readWorkflowDeliverableConclusionFromMirrorText } from '@/lib/office-workflow-edge-outcome';

/** LLM 回复中与交付相关的信息正文上限（去掉路径后计字；完整文档须在磁盘文件中）。 */
export const OFFICE_DELIVERABLE_MAX_INLINE_CHARS = 500;

/** 【交付产物】段落总字数上限（含绝对路径；Smart 点名 / Workflow 节点结构化输出）。 */
export const OFFICE_DELIVERABLE_SECTION_MAX_CHARS = 200;

/** 【交付产物】段落内去掉路径后的摘要最少字数。 */
export const WORKFLOW_DELIVERABLE_SECTION_MIN_SUMMARY_CHARS = 8;

export type WorkflowDeliverableSectionIssue =
  | 'missing_file_path_in_section'
  | 'summary_too_short'
  | 'section_too_long'
  | 'promissory_only';

const INLINE_PATH_STRIP_RE = [
  /(?:~\/|\/Users\/|\/tmp\/|\/var\/)[^\s\n`'"，,；;。:：]*\.(?:html?|md|json|txt|pdf|ya?ml|tsx?|jsx?|css|csv|zip|cu|h|hpp|cuh|cmake)/giu,
  /~\/[^\s\n`'"，,；;。:：]*\.(?:html?|md|json|txt|pdf|ya?ml|tsx?|jsx?|css|csv|zip|cu|h|hpp|cuh|cmake)/giu,
  /(?:~\/|\/Users\/|\/tmp\/|\/var\/)[^\s\n`'"，,；;。:：]+\/office\/projects\/[^\s\n`'"，,；;。:：]+/giu,
];

function normalizeDeliverableText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/** 统计正文去掉路径提示后的字数（用于 500 字「信息正文」限制）。 */
export function officeDeliverableInlineCharCount(text: string): number {
  let t = text.trim();
  if (!t) return 0;
  for (const re of INLINE_PATH_STRIP_RE) {
    t = t.replace(re, ' ');
  }
  return normalizeDeliverableText(t).length;
}

/** 【交付产物】段落总字数（含路径，用于 200 字段上限）。 */
export function officeDeliverableSectionCharCount(text: string): number {
  return normalizeDeliverableText(text).length;
}

export function isOfficeDeliverableInlineWithinLimit(
  text: string,
  maxChars: number = OFFICE_DELIVERABLE_MAX_INLINE_CHARS,
): boolean {
  return officeDeliverableInlineCharCount(text) <= maxChars;
}

export function isOfficeDeliverableSectionWithinLimit(
  text: string,
  maxChars: number = OFFICE_DELIVERABLE_SECTION_MAX_CHARS,
): boolean {
  return officeDeliverableSectionCharCount(text) <= maxChars;
}

/** 正文是否声明了可落盘核验的交付路径（协调者项目目录下的文件或文件夹）。 */
export function officeDeliverableDeclaresFilePath(
  ...parts: Array<string | null | undefined>
): boolean {
  return collectDeliverablePathHintsFromText(...parts).length > 0;
}

export type OfficeFileDeliverableValidationIssue =
  | 'missing_file_path'
  | 'inline_text_too_long'
  | 'filename_missing_role_suffix';

/** 交付路径 basename 须含 `-角色名`（扩展名前）。 */
export function validateRoleScopedDeliverableFileNames(
  roleName: string,
  ...parts: Array<string | null | undefined>
): boolean {
  const name = roleName.trim();
  if (!name) return true;
  const hints = collectDeliverablePathHintsFromText(...parts);
  if (hints.length === 0) return true;
  return hints.every((hint) => {
    if (isDeliverableDirPathHint(hint)) {
      return deliverableDirNameMatchesRole(hint, name);
    }
    if (isUnderRoleScopedDeliverableDir(hint, name)) return true;
    return deliverableFileNameMatchesRole(hint, name);
  });
}

/** 单条 Workflow 交付路径是否满足角色目录规范。 */
export function validateSingleWorkflowRoleScopedPath(
  pathHint: string,
  roleName: string,
): boolean {
  const norm = pathHint
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+$/u, '');
  if (!norm) return false;
  if (/^(?:\.\/)?target(?:\/|$)/iu.test(norm)) return false;
  if (!workflowDeliverablePathUnderRoleDir(norm, roleName)) return false;
  if (isDeliverableDirPathHint(norm)) {
    return deliverableDirNameMatchesRole(norm, roleName);
  }
  if (isUnderRoleScopedDeliverableDir(norm, roleName)) return true;
  return deliverableFileNameMatchesRole(norm, roleName);
}

/** Smart JSON：deliverable.items 每项须落在 `交付物-角色名/` 下（目录或目录内文件，与 Workflow 一致）。 */
export function validateSmartJsonDeliverableItems(
  roleName: string,
  items: string[],
): boolean {
  const name = roleName.trim();
  if (!name || items.length === 0) return true;
  return items.every((item) => validateSingleWorkflowRoleScopedPath(item.trim(), name));
}

/**
 * Smart 成员 JSON：协调者可能在 dispatch.task 中写错落盘目录，成员照抄 items 时按 basename 在本人目录下校验。
 */
export function validateSmartMemberDeliverableItems(
  roleName: string,
  items: string[],
): boolean {
  if (validateSmartJsonDeliverableItems(roleName, items)) return true;
  const dir = roleScopedDeliverableDirName(roleName);
  return items.every((item) => {
    const trimmed = item.trim().replace(/\\/g, '/').replace(/^\.\/+/, '');
    if (!trimmed) return false;
    const base = trimmed.includes('/') ? trimmed.split('/').pop()! : trimmed;
    if (!deliverableFileNameMatchesRole(base, roleName)) return false;
    return validateSmartJsonDeliverableItems(roleName, [`${dir}/${base}`]);
  });
}

/** Smart 磁盘校验：将 deliverable.items 规范为 `交付物-角色/` 下相对路径。 */
export function normalizeSmartDeliverableItemPath(item: string, roleName: string): string {
  const trimmed = item.trim().replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (!trimmed) return trimmed;
  if (validateSmartJsonDeliverableItems(roleName, [trimmed])) {
    return isDeliverableDirPathHint(trimmed) ? trimmed.replace(/\/+$/u, '') : trimmed;
  }
  const dir = roleScopedDeliverableDirName(roleName);
  if (isDeliverableDirPathHint(trimmed)) {
    return deliverableDirNameMatchesRole(trimmed, roleName)
      ? trimmed.replace(/\/+$/u, '')
      : dir;
  }
  const base = trimmed.includes('/') ? trimmed.split('/').pop()! : trimmed;
  const roleScoped = `${dir}/${base}`;
  if (validateSmartJsonDeliverableItems(roleName, [roleScoped])) {
    return roleScoped;
  }
  return `${dir}/${trimmed}`;
}

/** Workflow JSON：强制校验 deliverable.path（outputValidation 仅作模型提示，运行时不做校验）。 */
export function validateWorkflowJsonExplicitDeliverablePaths(
  roleName: string,
  deliverablePath: string,
): boolean {
  const d = deliverablePath.trim();
  if (!d) return false;
  return validateSingleWorkflowRoleScopedPath(d, roleName);
}

/** Workflow：交付路径须在 `交付物-角色名/` 下（与 Smart 一致）。 */
function filterRedundantDeliverablePathHints(hints: string[]): string[] {
  const normalized = hints.map((h) =>
    h.trim().replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/u, ''),
  );
  return normalized.filter((hint, i) => {
    if (!hint) return false;
    return !normalized.some((other, j) => {
      if (j === i || other.length <= hint.length || !other.includes('/')) return false;
      return other.endsWith(`/${hint}`) || other.includes(hint);
    });
  });
}

export function validateWorkflowRoleScopedDeliverablePaths(
  roleName: string,
  ...parts: Array<string | null | undefined>
): boolean {
  const name = roleName.trim();
  if (!name) return true;
  const hints = filterRedundantDeliverablePathHints(
    collectDeliverablePathHintsFromText(...parts),
  );
  if (hints.length === 0) return true;
  return hints.every((hint) => validateSingleWorkflowRoleScopedPath(hint, name));
}

/**
 * 校验工作流节点【交付产物】段落：关键信息 + 篇幅；路径可在【输出校验】/【项目目录】声明。
 */
export function validateWorkflowAgentDeliverableSection(
  deliverableSection: string | null | undefined,
  ...pathFallbackParts: Array<string | null | undefined>
): WorkflowDeliverableSectionIssue[] {
  const text = deliverableSection?.trim() ?? '';
  const issues: WorkflowDeliverableSectionIssue[] = [];
  if (!text) {
    return ['missing_file_path_in_section', 'summary_too_short', 'promissory_only'];
  }
  if (!officeDeliverableDeclaresFilePath(text, ...pathFallbackParts)) {
    issues.push('missing_file_path_in_section');
  }
  const summaryChars = officeDeliverableInlineCharCount(text);
  if (summaryChars < WORKFLOW_DELIVERABLE_SECTION_MIN_SUMMARY_CHARS) {
    issues.push('summary_too_short');
  }
  if (!isOfficeDeliverableSectionWithinLimit(text)) {
    issues.push('section_too_long');
  }
  if (isWorkflowPromissoryDeliverable(text)) {
    issues.push('promissory_only');
  }
  return issues;
}

/**
 * 校验【交付产物】段落本身：须含（项目目录相对）路径 + 关键信息，本段总字数 ≤200；禁止空话/承诺。
 * @deprecated Smart 等仍要求路径写在【交付产物】内；Workflow 节点请用 validateWorkflowAgentDeliverableSection。
 */
export function validateWorkflowDeliverableSection(
  deliverableSection: string | null | undefined,
): WorkflowDeliverableSectionIssue[] {
  const text = deliverableSection?.trim() ?? '';
  const issues: WorkflowDeliverableSectionIssue[] = [];
  if (!text) {
    return ['missing_file_path_in_section', 'summary_too_short', 'promissory_only'];
  }
  if (!officeDeliverableDeclaresFilePath(text)) {
    issues.push('missing_file_path_in_section');
  }
  const summaryChars = officeDeliverableInlineCharCount(text);
  if (summaryChars < WORKFLOW_DELIVERABLE_SECTION_MIN_SUMMARY_CHARS) {
    issues.push('summary_too_short');
  }
  if (!isOfficeDeliverableSectionWithinLimit(text)) {
    issues.push('section_too_long');
  }
  if (isWorkflowPromissoryDeliverable(text)) {
    issues.push('promissory_only');
  }
  return issues;
}

/** 校验整条回复中与交付相关的信息正文（去路径后 ≤500）。 */
export function validateOfficeFileDeliverableMessage(
  ...parts: Array<string | null | undefined>
): OfficeFileDeliverableValidationIssue[] {
  const blob = parts
    .map((p) => p?.trim())
    .filter(Boolean)
    .join('\n');
  const issues: OfficeFileDeliverableValidationIssue[] = [];
  if (!officeDeliverableDeclaresFilePath(...parts)) {
    issues.push('missing_file_path');
  }
  if (!isOfficeDeliverableInlineWithinLimit(blob)) {
    issues.push('inline_text_too_long');
  }
  return issues;
}

/** 群聊镜像用：保留路径 + 摘要，信息正文不超过 inline 上限。 */
export function compactOfficeDeliverableForRoomMirror(params: {
  deliverable?: string | null;
  outputValidation?: string | null;
  usage?: string | null;
  maxChars?: number;
}): string {
  const max = params.maxChars ?? OFFICE_DELIVERABLE_MAX_INLINE_CHARS;
  // Business pass/fail is only deliverable.conclusion — never drop the 结论 line when truncating.
  const conclusion =
    readWorkflowDeliverableConclusionFromMirrorText(params.deliverable ?? undefined)
    ?? readWorkflowDeliverableConclusionFromMirrorText(params.outputValidation ?? undefined);
  const conclusionLine = conclusion ? `结论：${conclusion}` : '';
  const conclusionReserve = conclusionLine
    ? officeDeliverableInlineCharCount(conclusionLine) + 1
    : 0;
  const bodyMax = Math.max(40, max - conclusionReserve);

  const paths = collectDeliverablePathHintsFromText(
    params.outputValidation,
    params.deliverable,
  );
  const pathLine =
    paths.length > 0 ? `交付物：${paths.join('；')}` : '';

  let deliverableNote = stripMirrorConclusionLines(params.deliverable?.trim() ?? '');
  if (
    deliverableNote
    && !isOfficeDeliverableSectionWithinLimit(deliverableNote)
  ) {
    deliverableNote = `${deliverableNote.slice(0, OFFICE_DELIVERABLE_SECTION_MAX_CHARS - 1)}…`;
  }

  const noteParts = [
    deliverableNote,
    stripMirrorConclusionLines(params.outputValidation?.trim() ?? ''),
    params.usage?.trim(),
  ]
    .filter(Boolean)
    .join('\n');

  let note = noteParts;
  if (officeDeliverableInlineCharCount(note) > bodyMax) {
    note = `${note.slice(0, Math.max(0, bodyMax - 1))}…`;
  }

  const combined = [pathLine, note, conclusionLine].filter(Boolean).join('\n\n').trim();
  if (officeDeliverableInlineCharCount(combined) <= max) return combined;

  if (pathLine) {
    const roomForNote = Math.max(
      40,
      max - officeDeliverableInlineCharCount(pathLine) - 2 - conclusionReserve,
    );
    const shortNote = noteParts.slice(0, roomForNote);
    return [pathLine, shortNote ? `${shortNote}…` : '', conclusionLine]
      .filter(Boolean)
      .join('\n\n');
  }
  const body = note.slice(0, Math.max(0, max - conclusionReserve));
  return [body, conclusionLine].filter(Boolean).join('\n').trim();
}

function stripMirrorConclusionLines(text: string): string {
  if (!text.trim()) return '';
  return text
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith('结论：') && !trimmed.startsWith('结论:');
    })
    .join('\n')
    .trim();
}

