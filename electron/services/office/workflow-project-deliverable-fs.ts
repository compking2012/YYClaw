import { readdir, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import { expandPath } from '../../utils/paths';
import {
  deliverableDiskLookupAbsPaths,
  normalizeDeliverablePathForDisk,
} from '../../../src/lib/office-deliverable-disk-resolve';
import { isPathInsideProjectRoot } from '../../../src/lib/office-deliverable-path-scope';
import {
  isRoleScopedDeliverableDirBasename,
  roleScopedDeliverableDirName,
} from '../../../src/lib/office-project-file-naming';
import {
  isProjectDeliverablesBundleFileName,
  isSubstantiveDeliverableFileName,
} from '../../../src/lib/office-workflow-project-deliverable';
import { workflowNodeRoleIds } from '../../../src/lib/office-workflow-node';
import {
  resolveRecordedProjectRoot,
} from './project-context-paths';
import type {
  NodeRunRecord,
  OfficeExecutionMember,
  OfficeFixedGroup,
  OfficeTempProject,
  WorkflowNode,
} from './types';

const MIN_DELIVERABLE_BYTES = 24;
const SCAN_MAX_DEPTH = 5;

export type WorkflowDeliverableDiskVerifyResult = {
  ok: boolean;
  detail: string;
  missingHints: string[];
  resolvedPaths: string[];
};

async function pathExistsAtAbsPath(absPath: string): Promise<boolean> {
  try {
    const expanded = expandPath(absPath);
    const st = await stat(expanded);
    if (st.isFile()) return st.size >= MIN_DELIVERABLE_BYTES;
    if (st.isDirectory()) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * 固定两处查找：项目根 + deliverable.path；再 项目根/交付物-角色/ + deliverable.path。
 */
export async function resolveDeliverablePathOnDisk(
  projectRoot: string,
  deliverablePath: string,
  roleName: string | null,
): Promise<string | null> {
  const rel = normalizeDeliverablePathForDisk(deliverablePath);
  if (!rel) return null;
  const root = expandPath(projectRoot);
  for (const candidate of deliverableDiskLookupAbsPaths(root, rel, roleName)) {
    if (!(await pathExistsAtAbsPath(candidate))) continue;
    if (!isPathInsideProjectRoot(candidate, root)) continue;
    return candidate;
  }
  return null;
}

function formatMissingDeliverableDetail(
  projectRoot: string,
  deliverablePath: string,
  roleName: string | null,
  sectionLabel: string,
): string {
  const rel = normalizeDeliverablePathForDisk(deliverablePath);
  const roleDir = roleName?.trim() ? roleScopedDeliverableDirName(roleName) : null;
  const locations = roleDir
    ? `${projectRoot}/${rel} 或 ${projectRoot}/${roleDir}/${rel}`
    : `${projectRoot}/${rel}`;
  return `【${sectionLabel}】交付物未落盘（须在以下位置之一存在）：${locations}`;
}

/** 批量校验 deliverable.path 是否已落盘（Smart / Workflow 共用）。 */
export async function verifyDeliverablePathHintsExistOnDisk(params: {
  project: Pick<OfficeTempProject, 'id' | 'title' | 'projectRootPath'>;
  member: Pick<OfficeExecutionMember, 'agentId' | 'displayName'>;
  teamMembers: Pick<OfficeExecutionMember, 'agentId' | 'displayName'>[];
  pathHints: string[];
  sectionLabel?: string;
  /** 落盘第二查找路径用的角色名（默认取 member 展示名）。 */
  submittingRoleName?: string | null;
}): Promise<WorkflowDeliverableDiskVerifyResult> {
  const root = await resolveProjectRootAccessible(params.project);
  if (!root) {
    return {
      ok: false,
      detail:
        '无法解析项目根目录；项目启动后须将交付物写入已记录的项目目录 office/project/<projectId>/',
      missingHints: [],
      resolvedPaths: [],
    };
  }

  const unique = [...new Set(params.pathHints.map((p) => normalizeDeliverablePathForDisk(p)).filter(Boolean))];
  if (unique.length === 0) {
    return { ok: true, detail: '', missingHints: [], resolvedPaths: [] };
  }

  const roleName =
    params.submittingRoleName?.trim()
    || params.teamMembers.find((m) => m.agentId === params.member.agentId)?.displayName?.trim()
    || params.member.displayName?.trim()
    || null;
  const label = params.sectionLabel?.trim() || '交付物';
  const missingHints: string[] = [];
  const resolvedPaths: string[] = [];
  const details: string[] = [];

  for (const deliverablePath of unique) {
    const hit = await resolveDeliverablePathOnDisk(root, deliverablePath, roleName);
    if (hit) {
      resolvedPaths.push(hit);
    } else {
      missingHints.push(deliverablePath);
      details.push(formatMissingDeliverableDetail(root, deliverablePath, roleName, label));
    }
  }

  if (missingHints.length === 0) {
    return { ok: true, detail: '', missingHints: [], resolvedPaths };
  }
  return {
    ok: false,
    detail: details.join('；'),
    missingHints,
    resolvedPaths,
  };
}

/** 将 stat 结果格式化为 `ls -l` 风格一行（供【输入校验】/【输出校验】对照）。 */
export function formatDeliverableLsLongLine(
  absPath: string,
  st: Awaited<ReturnType<typeof stat>> | null,
): string {
  const p = expandPath(absPath);
  if (!st) {
    return `ls: cannot access '${p}': No such file or directory`;
  }
  const kind = st.isDirectory() ? 'd' : '-';
  const mode = `${kind}rw-r--r--`;
  const size = String(st.size).padStart(8, ' ');
  const when = st.mtime.toISOString().replace('T', ' ').slice(0, 19);
  return `${mode}  1 user  staff ${size} ${when} ${p}`;
}

export async function formatLsLongLinesForPaths(
  paths: string[],
): Promise<string[]> {
  const lines: string[] = [];
  for (const hint of paths) {
    const abs = expandPath(hint);
    try {
      const st = await stat(abs);
      if (st.isFile() && st.size >= MIN_DELIVERABLE_BYTES) {
        lines.push(formatDeliverableLsLongLine(hint, st));
      } else if (st.isFile()) {
        lines.push(
          `${formatDeliverableLsLongLine(hint, st)}  # 文件过小（<${MIN_DELIVERABLE_BYTES}B），视为未交付`,
        );
      } else if (st.isDirectory()) {
        lines.push(formatDeliverableLsLongLine(hint, st));
      } else {
        lines.push(`ls: '${abs}' is not a regular file or directory`);
      }
    } catch {
      lines.push(formatDeliverableLsLongLine(hint, null));
    }
  }
  return lines;
}

const CLOSURE_SCAN_MAX_FILES = 12;
const BUNDLE_SCAN_MAX_FILES = 500;

/** 结项 zip 不纳入的顶层目录（如 session 落盘）。 */
const BUNDLE_EXCLUDED_TOP_LEVEL_DIRS = new Set(['.session']);

async function collectSubstantiveFiles(
  dir: string,
  depth: number,
  out: string[],
  maxFiles = CLOSURE_SCAN_MAX_FILES,
  excludeAbsPaths?: Set<string>,
): Promise<void> {
  if (depth > SCAN_MAX_DEPTH || out.length >= maxFiles) return;
  let entries: Dirent<string>[];
  try {
    entries = await readdir(expandPath(dir), { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      await collectSubstantiveFiles(full, depth + 1, out, maxFiles, excludeAbsPaths);
      continue;
    }
    if (!ent.isFile() || !isSubstantiveDeliverableFileName(ent.name)) continue;
    const expanded = expandPath(full);
    if (excludeAbsPaths?.has(expanded)) continue;
    if (await pathExistsAtAbsPath(full)) out.push(expanded);
    if (out.length >= maxFiles) return;
  }
}

/** 结项打包：仅收集 `交付物-Agent/` 目录下实质交付物（排除 session、系统工件与 zip 自身）。 */
export async function collectAllSubstantiveDeliverableFiles(
  projectRoot: string,
  options?: { maxFiles?: number; excludeAbsPaths?: Set<string>; projectTitle?: string },
): Promise<string[]> {
  const out: string[] = [];
  const exclude = new Set(options?.excludeAbsPaths ?? []);
  const root = expandPath(projectRoot);
  const maxFiles = options?.maxFiles ?? BUNDLE_SCAN_MAX_FILES;

  let entries: Dirent<string>[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
    if (BUNDLE_EXCLUDED_TOP_LEVEL_DIRS.has(ent.name)) continue;
    if (!isRoleScopedDeliverableDirBasename(ent.name)) continue;
    await collectSubstantiveFiles(join(root, ent.name), 0, out, maxFiles, exclude);
    if (out.length >= maxFiles) break;
  }

  return out.filter((p) => {
    const base = p.split('/').pop() ?? '';
    return !isProjectDeliverablesBundleFileName(base, options?.projectTitle);
  });
}

export type ProjectDeliverableDiskContext = {
  project: Pick<OfficeTempProject, 'id' | 'title' | 'projectRootPath'>;
  group?: Pick<OfficeFixedGroup, 'coordinatorAgentId' | 'agentIds'> | null;
  member: Pick<OfficeExecutionMember, 'agentId' | 'displayName'>;
  teamMembers: Pick<OfficeExecutionMember, 'agentId' | 'displayName'>[];
};

async function resolveProjectRootAccessible(
  project: Pick<OfficeTempProject, 'id' | 'title' | 'projectRootPath'>,
): Promise<string | null> {
  return resolveRecordedProjectRoot(project);
}

/** 解析任务协调者项目目录（Smart ls 须在项目根下执行）。 */
export async function resolveTaskCoordinatorProjectRoot(
  params: ProjectDeliverableDiskContext,
): Promise<string | null> {
  void params.group;
  void params.member;
  void params.teamMembers;
  return resolveProjectRootAccessible(params.project);
}

/**
 * 对 deliverable.path 在项目根下解析后生成 ls -l 结果行。
 */
export async function formatLsLongLinesForDeliverableHints(
  deliverablePaths: string[],
  params: {
    projectRoot: string;
    roleName?: string | null;
  },
): Promise<{ lines: string[]; resolvedPaths: string[]; missingHints: string[] }> {
  const root = expandPath(params.projectRoot);
  const unique = [...new Set(deliverablePaths.map((p) => normalizeDeliverablePathForDisk(p)).filter(Boolean))];
  const lines: string[] = [];
  const resolvedPaths: string[] = [];
  const missingHints: string[] = [];

  for (const deliverablePath of unique) {
    const hit = await resolveDeliverablePathOnDisk(root, deliverablePath, params.roleName ?? null);
    if (hit) {
      resolvedPaths.push(hit);
      try {
        const st = await stat(expandPath(hit));
        if (st.isFile() && st.size < MIN_DELIVERABLE_BYTES) {
          lines.push(
            `${formatDeliverableLsLongLine(hit, st)}  # 文件过小（<${MIN_DELIVERABLE_BYTES}B），视为未交付`,
          );
        } else {
          lines.push(formatDeliverableLsLongLine(hit, st));
        }
      } catch {
        lines.push(formatDeliverableLsLongLine(hit, null));
      }
      continue;
    }
    missingHints.push(deliverablePath);
    const primary = deliverableDiskLookupAbsPaths(root, deliverablePath, params.roleName ?? null)[0]
      ?? join(root, deliverablePath);
    lines.push(formatDeliverableLsLongLine(primary, null));
  }

  return { lines, resolvedPaths, missingHints };
}

export async function verifyWorkflowNodeDeliverableOnDisk(params: {
  project: Pick<OfficeTempProject, 'id' | 'title' | 'projectRootPath'>;
  group?: Pick<OfficeFixedGroup, 'coordinatorAgentId' | 'agentIds'> | null;
  member: Pick<OfficeExecutionMember, 'agentId' | 'displayName'>;
  teamMembers: Pick<OfficeExecutionMember, 'agentId' | 'displayName'>[];
  deliverablePaths: string[];
  submittingRoleName?: string | null;
}): Promise<WorkflowDeliverableDiskVerifyResult> {
  void params.group;
  return verifyDeliverablePathHintsExistOnDisk({
    project: params.project,
    member: params.member,
    teamMembers: params.teamMembers,
    pathHints: params.deliverablePaths,
    sectionLabel: '输出校验',
    submittingRoleName: params.submittingRoleName,
  });
}

const CLOSURE_DELIVERABLE_PATH_LIMIT = 12;

function sortWorkflowClosureDeliverablePaths(paths: string[]): string[] {
  const score = (p: string): number => {
    const name = p.split('/').pop()?.toLowerCase() ?? '';
    if (name === 'index.html') return 0;
    if (/\.html?$/iu.test(name)) return 1;
    if (/\/交付物-[^/]+/u.test(p) || /^交付物-/u.test(name)) return 2;
    return 3;
  };
  return [...paths].sort((a, b) => score(a) - score(b) || a.localeCompare(b));
}

/**
 * 工作流全部步骤完成后，解析对外交付物的磁盘绝对路径（供协调者群聊收尾帖）。
 * 仅使用各节点 deliverable.path 与固定两处查找顺序。
 */
export async function resolveWorkflowClosureDeliverablePaths(params: {
  project: Pick<OfficeTempProject, 'id' | 'title' | 'projectRootPath'>;
  teamMembers: Pick<OfficeExecutionMember, 'agentId' | 'displayName'>[];
  nodes: WorkflowNode[];
  runs: Map<string, NodeRunRecord>;
}): Promise<string[]> {
  const root = await resolveProjectRootAccessible(params.project);
  if (!root) return [];

  const pathEntries: { deliverablePath: string; roleName: string | null }[] = [];
  const seenPaths = new Set<string>();

  for (let i = params.nodes.length - 1; i >= 0; i -= 1) {
    const node = params.nodes[i]!;
    const run = params.runs.get(node.id);
    if (!run || (run.status !== 'completed' && run.status !== 'skipped')) continue;
    const deliverablePath = run.deliverablePath?.trim();
    if (!deliverablePath || seenPaths.has(deliverablePath)) continue;
    seenPaths.add(deliverablePath);
    const agentId = workflowNodeRoleIds(node)[0] ?? node.agentId;
    const roleName =
      params.teamMembers.find((m) => m.agentId === agentId)?.displayName?.trim() ?? null;
    pathEntries.push({ deliverablePath, roleName });
  }

  const resolved: string[] = [];
  const seenAbs = new Set<string>();

  for (const { deliverablePath, roleName } of pathEntries) {
    if (resolved.length >= CLOSURE_DELIVERABLE_PATH_LIMIT) break;
    const hit = await resolveDeliverablePathOnDisk(root, deliverablePath, roleName);
    if (!hit || seenAbs.has(hit)) continue;
    seenAbs.add(hit);
    resolved.push(hit);
  }

  return sortWorkflowClosureDeliverablePaths(resolved).slice(0, CLOSURE_DELIVERABLE_PATH_LIMIT);
}

/** @deprecated 运行期间请用 resolveRecordedProjectRoot（只读）。 */
export async function ensureProjectRootRecorded(
  project: Pick<OfficeTempProject, 'id' | 'title' | 'projectRootPath'>,
): Promise<string | null> {
  return resolveRecordedProjectRoot(project);
}
