/**
 * Office 进页 / 轮询相关的纯逻辑（可单测，不依赖 React）。
 */

/** 进页 snapshot 就绪后，解析默认展开与 pending 自动展开状态。 */
export function resolveOfficeEnterActiveProject(
  preferredId: string | null,
  isFullyPrefetched: (projectId: string) => boolean,
): { activeProjectId: string | null; pendingAutoExpandId: string | null } {
  if (!preferredId) {
    return { activeProjectId: null, pendingAutoExpandId: null };
  }
  if (isFullyPrefetched(preferredId)) {
    return { activeProjectId: preferredId, pendingAutoExpandId: null };
  }
  return { activeProjectId: null, pendingAutoExpandId: preferredId };
}

/** 等待默认项目预取完成期间，轮询不应抢先展开其它项目群聊。 */
export function shouldDeferPollRoomAutoExpand(pendingAutoExpandId: string | null): boolean {
  return pendingAutoExpandId !== null;
}

/** 预取完成后是否应自动展开默认项目。 */
export function shouldAutoExpandPreferredProject(
  preferredId: string | null,
  expandedProjectId: string | null,
  isFullyPrefetched: (projectId: string) => boolean,
): boolean {
  if (!preferredId || expandedProjectId) return false;
  return isFullyPrefetched(preferredId);
}
