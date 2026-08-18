import { topologicalSortWorkflowNodes } from '@/lib/office-workflow-edges';
import { workflowNodeRoleIds } from '@/lib/office-workflow-node';
import { workflowEdgeList } from '@/lib/office-workflow-schedule';
import {
  collectDeliverablePathHintsFromText,
  isCarvedWorkspaceRelativePath,
  isProjectSystemArtifactFileName,
  resolveDeliverablePathCandidates,
} from '@/lib/office-workflow-project-deliverable';
import type { NodeRunRecord, WorkflowEdge, WorkflowNode } from '@/types/office';

/** 任务交付物 basename（排除 status-*.ndjson 等系统运行状态记录）。 */
export function isWorkflowTaskDeliverableBasename(name: string): boolean {
  const base = name.trim();
  if (!base || base === '（见项目目录）') return false;
  return !isProjectSystemArtifactFileName(base);
}

function filterWorkflowTaskDeliverableBasenames(names: string[]): string[] {
  const out: string[] = [];
  for (const name of names) {
    if (!isWorkflowTaskDeliverableBasename(name)) continue;
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

export const PRIOR_UPSTREAM_SNIPPET_MAX = 200;
export const PRIOR_CONTEXT_TOTAL_MAX = 2_500;
export const PRIOR_PATH_HINT_MAX = 8;

const PATH_IN_TABLE_RE =
  /\|\s*[^|\n]*\|\s*([^\s|/][^\s|]*\/[^\s|]+\.(?:html?|jsx?|tsx?|css|md|json|txt|pdf|ya?ml))\s*\|/giu;
const PATH_BARE_RE =
  /(?:^|[\s|：:（(])([\w\u4e00-\u9fa5][\w\u4e00-\u9fa5._/-]*(?:\/[\w\u4e00-\u9fa5._/-]+)+\.(?:html?|jsx?|tsx?|css|md|json|txt|pdf|ya?ml))/gimu;
const PATH_DELIVERABLES_RE =
  /(?:deliverables|tax-calculator|workspace[^/\s]*)\/[\w\u4e00-\u9fa5._/-]+\.(?:html?|jsx?|tsx?|css|md|json|txt|pdf|ya?ml)/giu;
/** 工作流图中指向 `nodeId` 的直接前驱节点 id（不含更上游）。 */
export function getDirectPredecessorNodeIds(
  nodeId: string,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): string[] {
  const edgeList = workflowEdgeList(nodes, edges);
  const ids: string[] = [];
  for (const e of edgeList) {
    if (e.to !== nodeId) continue;
    if (!ids.includes(e.from)) ids.push(e.from);
  }
  return ids;
}

/** 正常推进边（不含 on_failure 回滚边）。 */
function forwardIncomingNodeIds(
  nodeId: string,
  edges: WorkflowEdge[],
): string[] {
  const ids: string[] = [];
  for (const e of edges) {
    if (e.to !== nodeId) continue;
    if ((e.when ?? 'on_success') === 'on_failure') continue;
    if (!ids.includes(e.from)) ids.push(e.from);
  }
  return ids;
}

/**
 * DAG 上当前节点之前的**全部前序**节点（沿 on_success 等正向边反向遍历，拓扑序）。
 */
export function getAllUpstreamNodeIds(
  currentNodeId: string,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): string[] {
  const edgeList = workflowEdgeList(nodes, edges);
  const upstream = new Set<string>();
  const queue = forwardIncomingNodeIds(currentNodeId, edgeList);
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (upstream.has(id)) continue;
    upstream.add(id);
    for (const predId of forwardIncomingNodeIds(id, edgeList)) {
      if (!upstream.has(predId)) queue.push(predId);
    }
  }
  const sorted =
    topologicalSortWorkflowNodes(nodes, edgeList, (a, b) =>
      a.localeCompare(b, 'zh-CN'),
    ) ?? nodes;
  return sorted.map((n) => n.id).filter((id) => upstream.has(id));
}

/** 从交付摘要中提取可核验路径提示（含相对 basename，供 projectRoot 解析）。 */
export function extractDeliverablePathHints(text: string): string[] {
  const found = new Set<string>();
  const add = (raw: string) => {
    const p = raw
      .replace(/^[`'"]+|[`'"]+$/g, '')
      .trim()
      .split(/[（(【|，,；;]/u)[0]!
      .trim();
    if (p.length >= 4 && p.length <= 160) found.add(p);
  };

  let m: RegExpExecArray | null;
  const tableRe = new RegExp(PATH_IN_TABLE_RE.source, 'giu');
  while ((m = tableRe.exec(text)) !== null) add(m[1]!);

  const bareRe = new RegExp(PATH_BARE_RE.source, 'gimu');
  while ((m = bareRe.exec(text)) !== null) add(m[1]!);

  const delRe = new RegExp(PATH_DELIVERABLES_RE.source, 'giu');
  while ((m = delRe.exec(text)) !== null) add(m[0]!);

  const deliverableLineRe = /(?:^|\n)交付物[：:]\s*([^\n]+)/gu;
  while ((m = deliverableLineRe.exec(text)) !== null) {
    for (const part of m[1]!.split(/[、,；;]/u)) {
      const p = part.trim().split(/[（(【]/u)[0]!.trim().replace(/\/+$/u, '');
      if (p.length >= 2) add(p);
    }
  }

  const roleScopedRe =
    /(?:^|[^\w\u4e00-\u9fa5./-])(交付物-[\u4e00-\u9fa5A-Za-z]+(?:\/|(?=\s|$))|[\w\u4e00-\u9fa5]+(?:\s+[\w\u4e00-\u9fa5]+)*[\w\u4e00-\u9fa5._-]*-[\u4e00-\u9fa5A-Za-z._-]+\.[\w]+)/gu;
  while ((m = roleScopedRe.exec(text)) !== null) {
    const p = m[1] ?? m[0];
    if (p) add(p.replace(/\/+$/u, ''));
  }

  return [...found].slice(0, PRIOR_PATH_HINT_MAX);
}

function normalizeSlash(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/u, '');
}

const OFFICE_PROJECTS_MARKER = '/office/projects/';

/** 绝对路径中重复出现 `/office/projects/`（正则误切 + 解析叠加）。 */
function hasDuplicatedOfficeProjectsSegment(path: string): boolean {
  const norm = normalizeSlash(path);
  const first = norm.indexOf(OFFICE_PROJECTS_MARKER);
  if (first < 0) return false;
  return norm.indexOf(OFFICE_PROJECTS_MARKER, first + OFFICE_PROJECTS_MARKER.length) >= 0;
}

/**
 * 上游提示词用：路径去重，丢弃误切嵌套段，同一交付物只保留最短合法绝对路径。
 */
export function dedupeUpstreamDeliverablePaths(paths: string[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();

  for (const raw of paths) {
    const p = normalizeSlash(raw.trim());
    if (!p || p.length < 4 || p.length > 320) continue;
    if (isCarvedWorkspaceRelativePath(p)) continue;
    if (hasDuplicatedOfficeProjectsSegment(p)) continue;
    const key = p;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }

  const kept = unique.filter((p) => {
    const pn = normalizeSlash(p);
    return !unique.some((other) => {
      if (other === p) return false;
      const on = normalizeSlash(other);
      if (pn.length > on.length && pn.includes(on)) return true;
      return false;
    });
  });

  return kept.slice(0, PRIOR_PATH_HINT_MAX);
}

const SNIPPET_ABS_OFFICE_PATH_RE =
  /(?:~\/|\/Users\/|\/tmp\/|\/var\/)[^\s\n`'"]*(?:\/office\/projects\/[^\s\n`'"]+)+/giu;

function stripPathsForSnippet(text: string, paths: string[]): string {
  let t = text;
  const sorted = [...paths].sort((a, b) => b.length - a.length);
  for (const p of sorted) {
    t = t.split(p).join(' ');
  }
  t = t.replace(SNIPPET_ABS_OFFICE_PATH_RE, ' ');
  return t.replace(/\|\s*[-—\s|]+\s*\|/gu, ' ').replace(/\s+/g, ' ').trim();
}

function resolveUpstreamPaths(summary: string, projectRoot?: string): string[] {
  const merged: string[] = [...collectDeliverablePathHintsFromText(summary)];
  const root = projectRoot?.trim().replace(/\/+$/u, '');
  if (root) {
    for (const hint of extractDeliverablePathHints(summary)) {
      if (isCarvedWorkspaceRelativePath(hint)) continue;
      for (const abs of resolveDeliverablePathCandidates(hint, [root])) {
        if (abs.startsWith('/') || abs.startsWith('~/')) merged.push(abs);
      }
    }
  }
  return dedupeUpstreamDeliverablePaths(merged);
}

/** 将绝对路径压缩为相对【项目目录】的交付物名（用于上游块「交付物：」行）。 */
export function toProjectRelativeDeliverablePaths(
  paths: string[],
  projectRoot?: string,
): string[] {
  const root = projectRoot?.trim().replace(/\/+$/u, '');
  return paths.map((p) => {
    const normalized = p.trim();
    if (root && normalized.startsWith(`${root}/`)) {
      return normalized.slice(root.length + 1);
    }
    const idx = normalized.indexOf('/office/projects/');
    if (idx >= 0) {
      const tail = normalized.slice(idx + '/office/projects/'.length);
      const slash = tail.indexOf('/');
      return slash >= 0 ? tail.slice(slash + 1) : tail;
    }
    const parts = normalized.split('/');
    return parts[parts.length - 1] ?? normalized;
  });
}

/** 压缩单步上游：交付物相对路径 + ≤200 字关键摘要。 */
export function compactUpstreamDeliverableEntry(params: {
  roleLabel: string;
  stepTitle?: string;
  summary: string;
  snippetMax?: number;
  projectRoot?: string;
}): string {
  const paths = resolveUpstreamPaths(params.summary, params.projectRoot);
  const snippetMax = params.snippetMax ?? PRIOR_UPSTREAM_SNIPPET_MAX;
  const snippet = stripPathsForSnippet(params.summary, paths)
    .replace(/^#+\s*/gm, '')
    .slice(0, snippetMax);
  const relPaths = filterWorkflowTaskDeliverableBasenames(
    toProjectRelativeDeliverablePaths(paths, params.projectRoot),
  );
  const parts: string[] = [`【${params.roleLabel}】`];
  if (params.stepTitle?.trim()) parts.push(`步骤：${params.stepTitle.trim()}`);
  if (relPaths.length > 0) parts.push(`交付物：${relPaths.join('、')}`);
  if (snippet) {
    parts.push(`关键摘要：${snippet}${params.summary.length > snippetMax ? '…' : ''}`);
  }
  parts.push('（完整正文请读项目目录/磁盘文件，勿仅凭摘要臆测。）');
  return parts.join('\n');
}

export type PriorDeliverableRoleRef = { id: string; name: string };

/**
 * 拼接 DAG 上**全部前序**已完成节点的交付（绝对路径 + 关键摘要）。
 */
export type PriorDeliverablesContextScope = 'all_upstream' | 'direct_predecessors';

export function buildPriorDeliverablesContext(params: {
  runs: Map<string, NodeRunRecord>;
  nodes: WorkflowNode[];
  roles: PriorDeliverableRoleRef[];
  currentNodeId: string;
  edges: WorkflowEdge[];
  projectRoot?: string;
  totalMax?: number;
  /** 默认 all_upstream：全部前序节点；direct_predecessors：仅 DAG 直接前驱（供 inputValidation）。 */
  scope?: PriorDeliverablesContextScope;
}): string {
  const predIds =
    params.scope === 'direct_predecessors'
      ? getDirectPredecessorNodeIds(params.currentNodeId, params.nodes, params.edges)
      : getAllUpstreamNodeIds(params.currentNodeId, params.nodes, params.edges);
  if (predIds.length === 0) return '';

  const lines: string[] = [];
  for (const predId of predIds) {
    const n = params.nodes.find((x) => x.id === predId);
    const run = params.runs.get(predId);
    if (!n || run?.status !== 'completed' || !run.summary?.trim()) continue;

    const names = workflowNodeRoleIds(n)
      .map((id) => params.roles.find((r) => r.id === id)?.name ?? id)
      .join(' + ');
    lines.push(
      compactUpstreamDeliverableEntry({
        roleLabel: names || n.agentId || predId,
        stepTitle: n.title?.trim(),
        summary: run.summary.trim(),
        projectRoot: params.projectRoot,
      }),
    );
  }

  const cap = params.totalMax ?? PRIOR_CONTEXT_TOTAL_MAX;
  return lines.join('\n\n').slice(0, cap);
}

/**
 * 从 buildPriorDeliverablesContext 文本提取交付物路径提示（供 inputValidation.targets 示例；须传入 direct_predecessors 范围）。
 */
export function extractWorkflowUpstreamTargetNames(priorDeliverables?: string | null): string[] {
  const trimmed = priorDeliverables?.trim() ?? '';
  if (!trimmed) return [];
  const names: string[] = [];
  /** 行首「交付物：」避免路径 `交付物-开发/` 中的子串误匹配导致 global 游标跳过整行。 */
  const deliverableRe = /(?:^|\n)交付物[：:]([^\n]+)/gu;
  let m: RegExpExecArray | null;
  while ((m = deliverableRe.exec(trimmed)) !== null) {
    for (const part of m[1]!.split(/[、,；;]/u)) {
      let p = part.trim().split(/[（(【\s]/u)[0]!.trim();
      if (!p) continue;
      p = p.replace(/\/+$/u, '');
      if (p.length >= 2 && !names.includes(p)) names.push(p);
    }
  }
  return filterWorkflowTaskDeliverableBasenames(names);
}

/** 从 prior 文本提取交付物路径提示，顿号拼接（用于直接前驱列表与 inputValidation 示例）。 */
export function formatWorkflowUpstreamDeliverableFileList(priorDeliverables?: string | null): string {
  const names = extractWorkflowUpstreamTargetNames(priorDeliverables);
  if (names.length === 0) return '';
  return names.join('、');
}

/** 将 buildPriorDeliverablesContext 块转为任务提示词中的编号列表。 */
export function formatPriorDeliverablesNumberedList(prior: string): string {
  const trimmed = prior.trim();
  if (!trimmed) return '';
  const blocks = trimmed.split(/\n\n+/);
  const items: string[] = [];
  for (const block of blocks) {
    const roleM = block.match(/^【([^】]+)】/u);
    if (!roleM) continue;
    const role = roleM[1]!.trim();
    const deliverableM = block.match(/交付物[：:]([^\n]+)/u);
    const summaryM = block.match(/关键摘要[：:]([^\n]+)/u);
    const path = deliverableM?.[1]?.trim().split(/[、,]/)[0]?.trim() || '（见项目目录）';
    const note = summaryM?.[1]?.replace(/…$/u, '').trim().slice(0, 48) ?? '';
    items.push(`${items.length + 1}. ${role}：${path}${note ? `（${note}）` : ''}`);
  }
  return items.length > 0 ? items.join('\n') : trimmed;
}
