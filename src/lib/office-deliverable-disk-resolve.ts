import { roleScopedDeliverableDirName } from '@/lib/office-project-file-naming';
import {
  isSmartJsonShapeText,
  parseSmartMemberJsonOutput,
} from '@/lib/office-smart-json-schema';

/** 落盘校验用的 deliverable.path：仅 trim 与去掉首部 `./`，不做正则挖掘或路径拼凑变体。 */
export function normalizeDeliverablePathForDisk(deliverablePath: string): string {
  return deliverablePath.trim().replace(/^\.[/\\]/u, '').replace(/\\/g, '/');
}

function joinUnderProjectRoot(projectRoot: string, ...relSegments: string[]): string {
  const root = projectRoot.replace(/\\/g, '/').replace(/\/+$/u, '');
  const parts = [root];
  for (const seg of relSegments) {
    const s = normalizeDeliverablePathForDisk(seg);
    if (!s) continue;
    parts.push(s);
  }
  return parts.join('/');
}

/**
 * 固定两处查找顺序（相对项目根）：
 * 1. `{projectRoot}/{deliverable.path}`
 * 2. `{projectRoot}/交付物-{role}/{deliverable.path}`
 */
export function deliverableDiskLookupAbsPaths(
  projectRoot: string,
  deliverablePath: string,
  roleName: string | null | undefined,
): string[] {
  const rel = normalizeDeliverablePathForDisk(deliverablePath);
  if (!rel) return [];
  const ordered: string[] = [joinUnderProjectRoot(projectRoot, rel)];
  const role = roleName?.trim();
  if (role) {
    const roleDir = roleScopedDeliverableDirName(role);
    ordered.push(joinUnderProjectRoot(projectRoot, roleDir, rel));
  }
  return ordered;
}

/** Workflow JSON 声明的 deliverable.path（唯一落盘校验路径）。 */
export function declaredDeliverablePathsFromWorkflowJson(
  json?: { deliverable?: { path?: string } } | null,
): string[] {
  const path = normalizeDeliverablePathForDisk(json?.deliverable?.path ?? '');
  return path ? [path] : [];
}

/** Smart JSON deliverable.items 即 deliverable.path 列表。 */
export function declaredDeliverablePathsFromSmartItems(items?: string[] | null): string[] {
  const out: string[] = [];
  for (const item of items ?? []) {
    const path = normalizeDeliverablePathForDisk(item);
    if (path && !out.includes(path)) out.push(path);
  }
  return out;
}

/** Smart 成员落盘路径：仅从原始 JSON 的 deliverable.items 解析（禁止读 bracket/群聊正文）。 */
export function declaredDeliverablePathsFromSmartMemberJson(raw: string): string[] {
  const text = raw.trim();
  if (!text || !isSmartJsonShapeText(text)) return [];
  return declaredDeliverablePathsFromSmartItems(
    parseSmartMemberJsonOutput(text)?.deliverable.items,
  );
}

/** @deprecated 使用 deliverableDiskLookupAbsPaths；保留别名供过渡引用。 */
export function resolveDeliverablePathCandidatesInSearchOrder(
  deliverablePath: string,
  projectRoots: string[],
  roleName?: string | null,
): string[] {
  const root = projectRoots[0]?.trim();
  if (!root) return [];
  return deliverableDiskLookupAbsPaths(root, deliverablePath, roleName ?? null);
}
