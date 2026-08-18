import { deliverableDiskLookupAbsPaths } from '@/lib/office-deliverable-disk-resolve';
import {
  isRoleScopedDeliverableDirBasename,
  roleScopedDeliverableDirName,
  roleScopedDeliverableFileName,
} from '@/lib/office-project-file-naming';
import { sanitizeNotebookDirName } from '@/lib/office-project-notebook';
import { extractDeliverablePathHints } from '@/lib/office-workflow-prior-context';

export const PROJECT_SYSTEM_ARTIFACT_NAMES = new Set([
  'manifest.json',
  'progress.json',
  'definition.json',
  'room.jsonl',
]);

/** 结项自动打包 zip 文件名后缀（历史数据，扫描时排除）。 */
export const PROJECT_DELIVERABLES_BUNDLE_SUFFIX = '-交付物.zip';

export function projectBundleZipBaseName(projectTitle: string): string {
  return sanitizeNotebookDirName(projectTitle) || 'untitled';
}

export function projectBundleZipFileName(projectTitle: string): string {
  return `${projectBundleZipBaseName(projectTitle)}.zip`;
}

export function isProjectDeliverablesBundleFileName(name: string, projectTitle?: string): boolean {
  if (projectTitle?.trim()) {
    return name === projectBundleZipFileName(projectTitle);
  }
  if (name.endsWith(PROJECT_DELIVERABLES_BUNDLE_SUFFIX)) return true;
  return /^[^/\\]+\.zip$/iu.test(name) && !name.includes('-status');
}

const DELIVERABLE_FILE_EXT_PARTS = [
  'html?',
  'md',
  'markdown',
  'txt',
  'rtf',
  'pdf',
  'docx?',
  'odt',
  'pptx?',
  'xlsx?',
  'csv',
  'tsv',
  'json',
  'jsonl',
  'ndjson',
  'ya?ml',
  'toml',
  'xml',
  'zip',
  'tar',
  'tgz',
  'gz',
  'mp3',
  'wav',
  'flac',
  'm4a',
  'aac',
  'ogg',
  'oga',
  'opus',
  'mid',
  'midi',
  'wma',
  'aiff?',
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'css',
  'scss',
  'sass',
  'less',
  'vue',
  'svelte',
  'py',
  'ipynb',
  'java',
  'kt',
  'kts',
  'go',
  'rs',
  'swift',
  'rb',
  'php',
  'r',
  'sql',
  'sh',
  'bash',
  'zsh',
  'fish',
  'ps1',
  'bat',
  'cmd',
  'c',
  'cc',
  'cpp',
  'cxx',
  'h',
  'hh',
  'hpp',
  'cu',
  'cuh',
] as const;

const SUBSTANTIVE_DELIVERABLE_BASENAMES = new Set([
  'makefile',
  'gnumakefile',
  'cmakelists.txt',
  'dockerfile',
]);

const DELIVERABLE_FILE_EXT = DELIVERABLE_FILE_EXT_PARTS.join('|');

export const DELIVERABLE_FILE_EXT_RE = new RegExp(
  `\\.(?:${DELIVERABLE_FILE_EXT})$`,
  'iu',
);

const DELIVERABLE_EXT_RE = DELIVERABLE_FILE_EXT_RE;

export function isProjectSystemArtifactFileName(name: string): boolean {
  const base = name.trim().toLowerCase();
  if (!base) return true;
  if (PROJECT_SYSTEM_ARTIFACT_NAMES.has(base)) return true;
  if (base.startsWith('status-') && base.endsWith('.ndjson')) return true;
  if (base.endsWith('-status.ndjson')) return true;
  return false;
}

export function isSubstantiveDeliverableFileName(name: string): boolean {
  const base = name.trim().toLowerCase();
  if (isProjectSystemArtifactFileName(base)) return false;
  return SUBSTANTIVE_DELIVERABLE_BASENAMES.has(base) || DELIVERABLE_EXT_RE.test(base);
}

function normalizeDeliverablePathHint(raw: string): string {
  let p = raw
    .trim()
    .replace(/^[`'"]+|[`'"]+$/g, '')
    .replace(/[）)】，,；;]+$/u, '')
    // Stop at common prose punctuation to avoid swallowing trailing Chinese descriptions
    // like "/foo/bar.md。这里是说明..." into a fake path. Do not split on whitespace — filenames may contain spaces.
    .split(/[（(【|，,；;。！？]/u)[0]!
    .trim();

  // Truncate after the first substantive file extension (e.g. ls 行「path：-rw-r--r-- … path」).
  const extBoundary = new RegExp(
    `^(.+?\\.(?:${DELIVERABLE_FILE_EXT}))(?:[：:\\s].*|$)`,
    'iu',
  );
  const extMatch = p.match(extBoundary);
  if (extMatch?.[1]) {
    p = extMatch[1].trim();
  } else if (/[：:]/.test(p) && (p.includes('/') || DELIVERABLE_EXT_RE.test(p))) {
    p = p.split(/[：:]/u)[0]!.trim();
  }
  return p;
}

/** 去掉裸文件名、以及已有子文件时的角色目录前缀。 */
function refineDeliverablePathHints(hints: string[]): string[] {
  const refined = hints
    .map((h) => normalizeDeliverablePathHint(h))
    .filter((h) => h.length >= 4);
  const withoutBareDupes = refined.filter((hint) => {
    if (hint.includes('/')) return true;
    const exactScoped = refined.some((other) => other.includes('/') && other.endsWith(`/${hint}`));
    if (exactScoped) return false;
    const partialCarve = refined.some((other) => {
      if (!other.includes('/')) return false;
      const base = other.split('/').pop() ?? '';
      return base !== hint && base.includes(hint);
    });
    return !partialCarve;
  });
  const withoutDirDupes = withoutBareDupes.filter((hint) => {
    if (!isDeliverableDirPathHint(hint)) return true;
    const dir = hint.replace(/\/+$/u, '');
    return !withoutBareDupes.some((other) => other !== hint && other.startsWith(`${dir}/`));
  });
  return dedupeNestedDeliverablePathHints(withoutDirDupes);
}

/** 从正文提取可核验的绝对文件路径（系统仅 stat 这些路径）。 */
const ABS_DELIVERABLE_FILE_PATH_RE = new RegExp(
  `(\\/(?:[^/\\s\\n]+\\/)*[^/\\s\\n]+\\.(?:${DELIVERABLE_FILE_EXT}))`,
  'giu',
);
const TILDE_DELIVERABLE_FILE_PATH_RE = new RegExp(
  `(~\\/(?:[^/\\s\\n]+\\/)*[^/\\s\\n]+\\.(?:${DELIVERABLE_FILE_EXT}))`,
  'giu',
);
const BARE_DELIVERABLE_FILE_NAME_RE = new RegExp(
  `(?:^|[^\\w\\u4e00-\\u9fa5./\\\\-])((?:[\\w\\u4e00-\\u9fa5]+(?:\\s+[\\w\\u4e00-\\u9fa5]+)*|[\\w\\u4e00-\\u9fa5][\\w\\u4e00-\\u9fa5._\\s-]*)\\.(?:${DELIVERABLE_FILE_EXT}))(?=$|[^\\w\\u4e00-\\u9fa5._-])`,
  'giu',
);
/** `交付物-角色/` 下含空格文件名的相对路径（镜像层从【交付产物】抽取）。 */
const ROLE_SCOPED_DELIVERABLE_FILE_PATH_RE = new RegExp(
  `(交付物-[\\w\\u4e00-\\u9fa5._-]+/(?:[^/\\n]+/)*[^/\\n]+\\.(?:${DELIVERABLE_FILE_EXT}))(?=$|[^\\w\\u4e00-\\u9fa5._-])`,
  'giu',
);

/** 绝对路径被正则误切的 workspace-xxx/office/projects 相对片段。 */
export function isCarvedWorkspaceRelativePath(hint: string): boolean {
  const p = normalizeDeliverablePathHint(hint);
  if (p.startsWith('/') || p.startsWith('~/') || /^[A-Za-z]:[\\/]/u.test(p)) return false;
  return /^workspace-[\w-]+\/office\/projects\//iu.test(p);
}

function isAbsoluteDeliverablePathHint(hint: string): boolean {
  const p = normalizeDeliverablePathHint(hint);
  return p.startsWith('/') || p.startsWith('~/') || /^[A-Za-z]:[\\/]/u.test(p);
}

/** 丢弃绝对路径被误切成的 workspace-…/office/… 相对片段。 */
function isUsableRelativeDeliverablePathHint(hint: string): boolean {
  const p = normalizeDeliverablePathHint(hint);
  if (p.length < 4 || p.length > 260) return false;
  if (/^\d+\s+\S/u.test(p)) return false;
  if (isCarvedWorkspaceRelativePath(p)) return false;
  if (isAbsoluteDeliverablePathHint(p)) return false;
  return true;
}

function isPlausibleAbsoluteDeliverablePath(p: string): boolean {
  const norm = normalizeSlash(p);
  if (norm.startsWith('~/')) {
    return norm.split('/').filter(Boolean).length >= 4;
  }
  if (!norm.startsWith('/')) return false;
  const segments = norm.split('/').filter(Boolean);
  if (segments.length < 3) return false;
  if (norm.includes('/office/projects/')) {
    return (
      norm.includes('/.openclaw/workspace-')
      || norm.startsWith('/Users/')
      || norm.startsWith('/tmp/')
      || norm.startsWith('/var/')
    );
  }
  return segments.length >= 4;
}

/** 去掉更长绝对路径末尾误切出的 /office/projects/… 子串。 */
function canonicalizeAbsoluteDeliverablePaths(paths: string[]): string[] {
  const normed = paths.map((p) => normalizeSlash(p));
  return paths.filter((_path, i) => {
    const pn = normed[i]!;
    return !normed.some(
      (other, j) => j !== i && other.length > pn.length && other.includes(pn),
    );
  });
}

function collectAbsoluteDeliverablePaths(text: string): string[] {
  const found = new Set<string>();
  for (const re of [ABS_DELIVERABLE_FILE_PATH_RE, TILDE_DELIVERABLE_FILE_PATH_RE]) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const p = normalizeDeliverablePathHint(m[1]!);
      if (p.length >= 8 && isPlausibleAbsoluteDeliverablePath(p)) found.add(p);
    }
  }
  return canonicalizeAbsoluteDeliverablePaths([...found]);
}

const OFFICE_PROJECTS_MARKER = '/office/projects/';

function segmentsAfterOfficeProjects(p: string): string[] {
  const norm = normalizeSlash(p);
  const idx = norm.indexOf(OFFICE_PROJECTS_MARKER);
  if (idx < 0) return [];
  return norm.slice(idx + OFFICE_PROJECTS_MARKER.length).split('/').filter(Boolean);
}

/** 路径末段是否为交付用文件（含扩展名且非系统工件）。 */
export function isDeliverableFilePathHint(hint: string): boolean {
  const base = normalizeDeliverablePathHint(hint).split('/').pop() ?? '';
  if (!base || isProjectSystemArtifactFileName(base)) return false;
  return DELIVERABLE_EXT_RE.test(base);
}

/** 路径末段是否为交付用文件夹（项目目录下、无扩展名、非系统工件）。 */
export function isDeliverableDirPathHint(hint: string): boolean {
  const norm = normalizeDeliverablePathHint(hint).replace(/\/+$/u, '');
  const base = norm.split('/').pop() ?? '';
  if (!base || isProjectSystemArtifactFileName(base)) return false;
  if (DELIVERABLE_EXT_RE.test(base)) return false;
  if (isRoleScopedDeliverableDirBasename(base)) return true;
  const segs = segmentsAfterOfficeProjects(norm);
  return segs.length >= 2;
}

/** 从正文提取协调者项目目录下的绝对文件夹路径。 */
const ABS_DELIVERABLE_DIR_UNDER_PROJECT_RE = new RegExp(
  `(\\/(?:[^/\\s\\n]+\\/)+office\\/projects\\/[^/\\s\\n]+(?:\\/[^/\\s\\n]+)+)`,
  'giu',
);

function collectAbsoluteDeliverableDirPaths(text: string): string[] {
  const found = new Set<string>();
  ABS_DELIVERABLE_DIR_UNDER_PROJECT_RE.lastIndex = 0;
  for (const m of text.matchAll(ABS_DELIVERABLE_DIR_UNDER_PROJECT_RE)) {
    const p = normalizeDeliverablePathHint(m[1]!).replace(/\/+$/u, '');
    if (!isDeliverableDirPathHint(p)) continue;
    if (!isPlausibleAbsoluteDeliverablePath(p)) continue;
    found.add(p);
  }
  return canonicalizeAbsoluteDeliverablePaths([...found]);
}

/** 从交付正文中收集须在磁盘核验的路径提示（文件或文件夹）；有绝对路径时仅校验绝对路径。 */
export function collectDeliverablePathHintsFromText(...parts: Array<string | undefined | null>): string[] {
  const absolute = new Set<string>();
  const relative = new Set<string>();

  for (const part of parts) {
    const t = part?.trim();
    if (!t) continue;
    for (const p of collectAbsoluteDeliverablePaths(t)) absolute.add(p);
    for (const p of collectAbsoluteDeliverableDirPaths(t)) absolute.add(p);
    ROLE_SCOPED_DELIVERABLE_FILE_PATH_RE.lastIndex = 0;
    for (const m of t.matchAll(ROLE_SCOPED_DELIVERABLE_FILE_PATH_RE)) {
      const p = normalizeDeliverablePathHint(m[1]!);
      if (isUsableRelativeDeliverablePathHint(p)) relative.add(p);
    }
    BARE_DELIVERABLE_FILE_NAME_RE.lastIndex = 0;
    for (const m of t.matchAll(BARE_DELIVERABLE_FILE_NAME_RE)) {
      const p = normalizeDeliverablePathHint(m[1]!);
      if (isUsableRelativeDeliverablePathHint(p)) relative.add(p);
    }
    for (const hint of extractDeliverablePathHints(t)) {
      const p = normalizeDeliverablePathHint(hint);
      if (isAbsoluteDeliverablePathHint(p)) {
        if (isDeliverableFilePathHint(p) || isDeliverableDirPathHint(p)) {
          absolute.add(p.replace(/\/+$/u, ''));
        }
        continue;
      }
      if (isUsableRelativeDeliverablePathHint(p)) relative.add(p);
    }
  }

  if (absolute.size > 0) {
    return refineDeliverablePathHints(
      canonicalizeAbsoluteDeliverablePaths([...absolute]),
    );
  }
  return refineDeliverablePathHints([...relative]);
}

/** 去掉被更长 `交付物-角色/…` 路径包含的裸文件名碎片（文件名可含空格）。 */
function dedupeNestedDeliverablePathHints(hints: string[]): string[] {
  const normalized = hints.map((h) =>
    h.trim().replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/u, ''),
  );
  return normalized.filter((hint, i) => {
    if (!hint) return false;
    return !normalized.some((other, j) => {
      if (j === i || other.length <= hint.length) return false;
      if (!hint.includes('/') && other.includes('/')) {
        return other.endsWith(`/${hint}`);
      }
      return false;
    });
  });
}

function normalizeSlash(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * 将交付正文中的相对/绝对路径解析为候选绝对路径（需在主进程 expandPath 后 stat）。
 */
export function resolveDeliverablePathCandidates(
  hint: string,
  projectRoots: string[],
): string[] {
  const raw = hint.trim().replace(/^[`'"]+|[`'"]+$/g, '');
  if (!raw) return [];

  const norm = normalizeSlash(raw);
  const out = new Set<string>();

  if (
    norm.startsWith('/')
    || norm.startsWith('~/')
    || /^[A-Za-z]:\//.test(norm)
  ) {
    out.add(norm);
    return [...out];
  }

  for (const root of projectRoots) {
    const rootNorm = normalizeSlash(root).replace(/\/+$/, '');
    if (!rootNorm) continue;

    if (norm.startsWith('office/projects/')) {
      const workspaceRoot = rootNorm.replace(/\/office\/projects\/[^/]+$/, '');
      if (workspaceRoot && workspaceRoot !== rootNorm) {
        out.add(`${workspaceRoot}/${norm}`);
      }
      out.add(`${rootNorm}/${norm.split('/').pop() ?? norm}`);
      continue;
    }

    const rel = norm.replace(/^\.\//, '');
    out.add(`${rootNorm}/${rel}`);
  }

  return [...out];
}

/** 在候选路径上追加「原文件名-角色名」变体（便于校验与读盘）。 */
export function resolveDeliverablePathCandidatesWithRoleScope(
  hint: string,
  projectRoots: string[],
  roleName?: string | null,
): string[] {
  const base = resolveDeliverablePathCandidates(hint, projectRoots);
  const name = roleName?.trim();
  if (!name) return base;
  const extra: string[] = [];
  for (const p of base) {
    const norm = p.replace(/\\/g, '/');
    const slash = norm.lastIndexOf('/');
    const dir = slash >= 0 ? norm.slice(0, slash + 1) : '';
    const file = slash >= 0 ? norm.slice(slash + 1) : norm;
    if (!file) continue;
    if (isDeliverableDirPathHint(p)) {
      const scopedDir = roleScopedDeliverableDirName(name);
      if (scopedDir !== file) extra.push(`${dir}${scopedDir}`);
      continue;
    }
    const scoped = roleScopedDeliverableFileName(file, name);
    if (scoped !== file) extra.push(`${dir}${scoped}`);
    const scopedDir = roleScopedDeliverableDirName(name);
    if (!file.includes('.') && scopedDir !== file) {
      extra.push(`${dir}${scopedDir}`);
    }
  }
  return [...new Set([...base, ...extra])];
}

export type DeliverablePathKind = 'file' | 'dir';

/** 推断路径提示为文件或文件夹（Smart/Workflow 磁盘校验共用）。 */
export function deliverablePathKind(hint: string): DeliverablePathKind {
  return isDeliverableDirPathHint(hint) ? 'dir' : 'file';
}

/**
 * Smart 磁盘校验查找顺序：先 `项目根/deliverable.path`，再 `项目根/交付物-角色/deliverable.path`。
 * @deprecated 实现已迁至 office-deliverable-disk-resolve.ts
 */
export function resolveDeliverablePathCandidatesInSearchOrder(
  hint: string,
  projectRoots: string[],
  roleName?: string | null,
): string[] {
  const root = projectRoots[0]?.trim();
  if (!root) return [];
  const paths = deliverableDiskLookupAbsPaths(root, hint, roleName ?? null);
  const rel = hint.trim().replace(/^\.[/\\]/u, '').replace(/\\/g, '/');
  const role = roleName?.trim();
  // Bare file names (no path segments) prefer role-scoped deliverable dir first.
  if (role && paths.length === 2 && !rel.includes('/') && !rel.startsWith('交付物-')) {
    return [paths[1]!, paths[0]!];
  }
  return paths;
}

export type DeliverableDiskExpectation =
  | { mode: 'paths'; hints: string[] }
  | { mode: 'any_substantive_file' };

/** Workflow JSON 中声明的交付路径（仅 deliverable.path）。 */
export function collectWorkflowJsonDeliverablePathHints(json?: {
  deliverable?: { path?: string };
} | null): string[] {
  if (!json) return [];
  const path = normalizeDeliverablePathHint(json.deliverable?.path ?? '');
  return path ? refineDeliverablePathHints([path]) : [];
}

/** 根据交付正文推断磁盘校验策略。 */
export function inferDeliverableDiskExpectation(
  deliverableText: string,
  inputValidationText?: string,
  jsonDeliverableHints?: string[],
): DeliverableDiskExpectation {
  const jsonHints = jsonDeliverableHints?.length
    ? refineDeliverablePathHints(
        jsonDeliverableHints.map((h) => normalizeDeliverablePathHint(h)).filter(Boolean),
      )
    : [];
  if (jsonHints.length > 0) return { mode: 'paths', hints: jsonHints };

  const hints = collectDeliverablePathHintsFromText(deliverableText, inputValidationText);
  if (hints.length > 0) return { mode: 'paths', hints };
  return { mode: 'any_substantive_file' };
}
