import type { SmartLastAssignRecord } from './types';
import { getTempProject, upsertTempProject } from './store';

export async function recordSmartAssignPublished(
  projectId: string,
  messageId: string,
  targetAgentIds: string[],
): Promise<void> {
  const project = await getTempProject(projectId);
  if (!project) return;
  const record: SmartLastAssignRecord = {
    messageId: messageId.trim(),
    targetAgentIds: [...new Set(targetAgentIds.map((id) => id.trim()).filter(Boolean))],
    at: Date.now(),
  };
  await upsertTempProject({
    ...project,
    smartLastAssign: record,
    kickoffError: undefined,
    kickoffFailCount: 0,
  });
}

export async function recordSmartAssignDispatched(projectId: string, messageId: string): Promise<void> {
  const project = await getTempProject(projectId);
  if (!project?.smartLastAssign) return;
  if (project.smartLastAssign.messageId !== messageId.trim()) return;
  await upsertTempProject({
    ...project,
    smartLastAssign: {
      ...project.smartLastAssign,
      dispatchedAt: Date.now(),
      error: undefined,
    },
  });
}

export async function recordSmartAssignFollowUpError(
  projectId: string,
  messageId: string,
  error: string,
): Promise<void> {
  const project = await getTempProject(projectId);
  if (!project) return;
  const prev = project.smartLastAssign;
  const base: SmartLastAssignRecord =
    prev?.messageId === messageId.trim()
      ? prev
      : {
          messageId: messageId.trim(),
          targetAgentIds: [],
          at: Date.now(),
        };
  await upsertTempProject({
    ...project,
    smartLastAssign: {
      ...base,
      error: error.slice(0, 500),
    },
  });
}

export function smartAssignFollowUpAlreadyDispatched(
  record: SmartLastAssignRecord | undefined,
  replyMessageId: string,
): boolean {
  if (!record) return false;
  return record.messageId === replyMessageId.trim() && typeof record.dispatchedAt === 'number';
}
