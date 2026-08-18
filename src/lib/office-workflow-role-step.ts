import { roomMessageAppliesToNode } from '@/lib/task-room-progress-reconcile';
import type { RoomMessage, WorkflowNode } from '@/types/office';

/** 该角色是否已在群聊对本步骤发过正式交付（task_deliver）。 */
export function roleHasWorkflowNodeDeliverable(
  room: RoomMessage[],
  node: WorkflowNode,
  roleId: string,
  workflowNodes: WorkflowNode[],
): boolean {
  return room.some(
    (m) =>
      m.fromRoleId === roleId
      && m.phase === 'task_deliver'
      && roomMessageAppliesToNode(m, node, workflowNodes),
  );
}

/** 从群聊交付帖提取摘要，供跳过重跑时写入 node summary。 */
export function workflowRoleDeliverSummaryFromRoom(
  room: RoomMessage[],
  node: WorkflowNode,
  roleId: string,
  workflowNodes: WorkflowNode[],
): string | undefined {
  const hits = room
    .filter(
      (m) =>
        m.fromRoleId === roleId
        && m.phase === 'task_deliver'
        && roomMessageAppliesToNode(m, node, workflowNodes),
    )
    .sort((a, b) => b.timestamp - a.timestamp);
  const last = hits[0];
  if (!last) return undefined;
  const body = (last.progressText ?? last.content ?? '').trim();
  return body ? body.slice(0, 800) : undefined;
}
