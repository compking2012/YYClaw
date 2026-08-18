import type { ProjectAgentRef } from '@/lib/office-workflow-node';
import type { OfficeTempProject, WorkflowNode } from '@/types/office';

/** Max deliverable body chars per room message (usage appended on the last chunk only). */
export const ROOM_DELIVER_BODY_CHUNK_CHARS = 12_000;

export const ROOM_DELIVER_USAGE_MAX_CHARS = 2_000;

function stepLabel(task: OfficeTempProject, node: WorkflowNode): string {
  return node.title?.trim() || task.title;
}

function splitTextChunks(text: string, maxLen: number): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxLen) return [trimmed];
  const chunks: string[] = [];
  let offset = 0;
  while (offset < trimmed.length) {
    chunks.push(trimmed.slice(offset, offset + maxLen));
    offset += maxLen;
  }
  return chunks;
}

/**
 * Build one or more room messages for a sub-task deliverable (full text, chunked when long).
 */
export function buildTaskDeliverRoomContents(
  role: ProjectAgentRef,
  task: OfficeTempProject,
  node: WorkflowNode,
  deliverable: string,
  usage: string,
): string[] {
  const bodyChunks = splitTextChunks(
    deliverable.trim() || '（无文本产物）',
    ROOM_DELIVER_BODY_CHUNK_CHARS,
  );
  const usageText = (usage.trim() || '见上文产物。').slice(0, ROOM_DELIVER_USAGE_MAX_CHARS);
  const step = stepLabel(task, node);
  const prefix = `🤖 【${role.displayName}】`;

  if (bodyChunks.length === 0) {
    return [
      [
        `${prefix}📦 交付产物 · ${step}`,
        '（无文本产物）',
        '',
        '📖 用法说明',
        usageText,
      ].join('\n'),
    ];
  }

  return bodyChunks.map((chunk, index) => {
    const isLast = index === bodyChunks.length - 1;
    const title =
      bodyChunks.length === 1
        ? `${prefix}📦 交付产物 · ${step}`
        : `${prefix}📦 交付产物 · ${step}（${index + 1}/${bodyChunks.length}）`;
    const lines = [title, chunk];
    if (isLast) {
      lines.push('', '📖 用法说明', usageText);
    }
    return lines.join('\n');
  });
}

/**
 * System message posted to the room right after an agent's deliver/report and before the next
 * node is dispatched: lists the agent's current deliverable(s) by their COMPLETE (absolute) path
 * so downstream roles and the user have the exact on-disk location.
 */
export function buildDeliverablePathsRoomContent(
  role: Pick<ProjectAgentRef, 'displayName'>,
  absolutePaths: string[],
): string | null {
  const paths = Array.from(
    new Set(absolutePaths.map((p) => p.trim()).filter((p) => p.length > 0)),
  );
  if (paths.length === 0) return null;
  const prefix = `🤖 【${role.displayName}】📎 交付物完整路径`;
  return [prefix, ...paths].join('\n');
}

/** Single-message builder (first chunk only); prefer buildTaskDeliverRoomContents for posting. */
export function buildTaskDeliverRoomContent(
  role: ProjectAgentRef,
  task: OfficeTempProject,
  node: WorkflowNode,
  deliverable: string,
  usage: string,
): string {
  return buildTaskDeliverRoomContents(role, task, node, deliverable, usage)[0]!;
}
