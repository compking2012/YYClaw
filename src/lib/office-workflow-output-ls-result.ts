import { isDeliverableDirPathHint } from '@/lib/office-workflow-project-deliverable';

/** ls -l 行首权限段（兼容 macOS 扩展属性 `@`、ACL `+`）。 */
export const LS_LINE_PREFIX_RE = /^[-dlnpscb][-rwx@SstT+]{9,10}\s+/u;

export function isLsLine(line: string): boolean {
  return LS_LINE_PREFIX_RE.test(line.trim());
}

export function isRegularFileLsLine(line: string): boolean {
  return /^-/u.test(line.trim());
}

export function isDirectoryLsLine(line: string): boolean {
  return /^d/u.test(line.trim());
}

/** 从 ls -l 原始行解析行末路径（文件名可含空格）。 */
export function extractLsLinePathSuffix(line: string): string {
  const trimmed = line.trim();
  if (!isLsLine(trimmed)) return '';

  const rest = trimmed.replace(LS_LINE_PREFIX_RE, '');

  const monthName = rest.match(
    /^\d+\s+\S+\s+\S+\s+\d+\s+[A-Za-z]{3}\s+\d{1,2}\s+(?:\d{1,2}:\d{2}(?::\d{2})?|\d{4})\s+(.+)$/u,
  );
  if (monthName?.[1]) return normalizeWorkflowLsTarget(monthName[1]);

  const numericMonth = rest.match(
    /^\d+\s+\S+\s+\S+\s+\d+\s+\d{1,2}\s+\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?\s+(.+)$/u,
  );
  if (numericMonth?.[1]) return normalizeWorkflowLsTarget(numericMonth[1]);

  const yearOnly = rest.match(
    /^\d+\s+\S+\s+\S+\s+\d+\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{4}\s+(.+)$/u,
  );
  if (yearOnly?.[1]) return normalizeWorkflowLsTarget(yearOnly[1]);

  const raw = trimmed.split(/\s+/u).pop()?.replace(/\/+$/u, '') ?? '';
  return normalizeWorkflowLsTarget(raw);
}

/** ls -l 行末路径名（去 `./` 前缀，与 {@link normalizeWorkflowLsTarget} 一致）。 */
export function lsLineBasename(line: string): string {
  const path = extractLsLinePathSuffix(line);
  if (!path) return '';
  const segments = path.split('/');
  return normalizeWorkflowLsTarget(segments[segments.length - 1] ?? path);
}

/** 规范化工作流 ls target（去首尾空白、去 `./` 前缀与尾斜杠）。 */
export function normalizeWorkflowLsTarget(target: string): string {
  return target.trim().replace(/^\.\/+/, '').replace(/\/+$/u, '');
}

/** target 是否为非法路径（绝对路径、`..` 等）。 */
export function isWorkflowLsTargetPathInvalid(target: string): boolean {
  const t = normalizeWorkflowLsTarget(target);
  if (!t) return true;
  if (t.startsWith('/') || t.startsWith('~')) return true;
  if (/^[A-Za-z]:[\\/]/u.test(t)) return true;
  if (/(?:^|\/)\.\.(?:\/|$)/u.test(t)) return true;
  return false;
}

/** 路径是否像绝对路径（项目目录外或 ls 行末完整路径）。 */
export function isWorkflowLsResultAbsolutePath(path: string): boolean {
  const p = path.trim().replace(/\\/g, '/');
  return (
    p.startsWith('/')
    || p.startsWith('~')
    || /^[A-Za-z]:\//u.test(p)
  );
}

/** ls 行末路径是否与 target 指向同一交付物（支持相对路径与项目目录绝对路径）。 */
export function lsResultPathMatchesWorkflowTarget(rawPath: string, target: string): boolean {
  const pathNorm = normalizeWorkflowLsTarget(rawPath.replace(/\\/g, '/'));
  const t = normalizeWorkflowLsTarget(target);
  if (!pathNorm || !t) return false;
  if (pathNorm === t) return true;
  if (pathNorm.endsWith(`/${t}`)) return true;
  // 绝对路径 + 含目录的 target：须完整后缀匹配，禁止仅 basename 相同
  if (isWorkflowLsResultAbsolutePath(rawPath) && t.includes('/')) {
    return false;
  }
  const pathBase = pathNorm.split('/').pop() ?? '';
  const targetBase = t.includes('/') ? (t.split('/').pop() ?? t) : t;
  return pathBase.length > 0 && pathBase === targetBase;
}

/** ls -l 行是否对应该 target（支持 `B/b` 与行末 `b` 或 `B/b`；绝对路径取末段匹配）。 */
export function lsLineMatchesWorkflowTarget(line: string, target: string): boolean {
  if (!isLsLine(line)) return false;
  const t = normalizeWorkflowLsTarget(target);
  if (!t) return false;
  const rawPath = extractLsLinePathSuffix(line);
  if (!rawPath) return false;
  return lsResultPathMatchesWorkflowTarget(rawPath, t);
}

function lsResultLines(lsResult: string): string[] {
  return lsResult
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function isMissingOrErrorLsResult(ls: string): boolean {
  return /(?:不存在|No such file|cannot access|not found|无法访问|ls:\s|未生成|未找到|未落盘|目录不存在)/iu.test(
    ls,
  );
}

/** lsResult 是否仅为文件名/占位符（非 ls -l 原始行）。 */
export function isWorkflowLsResultFilenameListOnly(lsResult: string): boolean {
  const t = lsResult.trim();
  if (!t || /^无上游$/u.test(t) || /^无$/iu.test(t)) return false;
  if (/^ok$/iu.test(t)) return true;
  const lines = lsResultLines(t);
  if (lines.length === 0) return true;
  return lines.every((line) => !isLsLine(line));
}

/** targets 与 lsResult 数组长度是否一致。 */
export function workflowLsResultArraysAligned(
  targets: string[],
  lsResults: string[],
): boolean {
  return targets.length === lsResults.length;
}

/** 单项 target 在项目目录下 ls -l 的 lsResult 条目是否无效。 */
export function isWorkflowTargetLsResultEntryInvalid(
  target: string,
  lsEntry: string,
): boolean {
  const t = normalizeWorkflowLsTarget(target);
  const ls = lsEntry.trim();
  if (!t) return true;
  if (isWorkflowLsTargetPathInvalid(t)) return true;
  if (!ls) return true;
  if (/^ok$/iu.test(ls)) return true;
  if (isMissingOrErrorLsResult(ls)) return false;
  if (isWorkflowLsResultFilenameListOnly(ls)) return true;

  const matchLine = lsResultLines(ls).find((line) => lsLineMatchesWorkflowTarget(line, t));
  if (!matchLine) return true;

  if (isDeliverableDirPathHint(t)) {
    return !isDirectoryLsLine(matchLine);
  }
  return isDirectoryLsLine(matchLine);
}

/**
 * Runtime no longer validates lsResult content/alignment (see {@link isInputValidationLsResultInvalid}).
 * Helpers below remain for prompt examples / path utilities only.
 */
export function isWorkflowLsResultsArrayInvalid(
  _targets: string[],
  _lsResults: string[],
): boolean {
  return false;
}

/** @deprecated 使用 {@link isWorkflowLsResultsArrayInvalid} */
export function isWorkflowLsResultTargetMismatch(
  targets: string[],
  lsResult: string | string[],
): boolean {
  const lsResults = Array.isArray(lsResult) ? lsResult : [lsResult];
  if (targets.length !== lsResults.length && !Array.isArray(lsResult)) {
    return isWorkflowLsResultsArrayInvalid(targets, [lsResult]);
  }
  return isWorkflowLsResultsArrayInvalid(targets, lsResults);
}

/** outputValidation：lsResult 运行时不再校验内容（类型须为 string[] 仍由 schema 保证）。 */
export function isOutputValidationLsResultInvalid(
  _targets: string[],
  _lsResults: string[],
): boolean {
  return false;
}

/** deliverable.path 须与 outputValidation.targets 中某项一致（规范化后比较）。 */
export function workflowDeliverablePathMatchesOutputTargets(
  deliverablePath: string,
  outputTargets: string[],
): boolean {
  const path = normalizeWorkflowLsTarget(deliverablePath);
  if (!path || outputTargets.length === 0) return true;
  return outputTargets.some((t) => normalizeWorkflowLsTarget(t) === path);
}

/** 文件类 target 的 lsResult 是否误用了目录行（drwx）。 */
export function isFileDeliverableDirLsResult(
  lsResult: string,
  fileTarget: string,
): boolean {
  const target = normalizeWorkflowLsTarget(fileTarget);
  if (!target || isDeliverableDirPathHint(target)) return false;
  const lines = lsResultLines(lsResult);
  return lines.some((line) => isDirectoryLsLine(line));
}

/** 工作流 lsResult 校验规则（提示词/重试文案共用）。 */
export const WORKFLOW_LS_RESULT_VALIDATION_RULE =
  'targets 与 lsResult 须为等长数组、按索引一一对应；每一项须在项目目录下对该 target 执行 ls -l（相对路径如 交付物-角色/文件.md）；lsResult 为完整原始一行，行末路径须与 target 指向同一文件/目录（不可为绝对路径，禁止 target/ 等非标准目录）';
