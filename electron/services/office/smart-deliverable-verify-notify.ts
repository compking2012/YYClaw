import { roleMentionToken } from '../../../src/lib/office-mention';
import { appendRoomMessage } from './store';
import type { OfficeRole } from './types';

/** Smart：交付物磁盘校验失败时，在群内告知并 @ 协调者。 */
export async function postSmartDeliverableVerifyFailureToRoom(params: {
  scenarioId: string;
  taskId: string;
  coordinator: Pick<OfficeRole, 'id' | 'name'>;
  failedRoleName: string;
  detail: string;
}): Promise<void> {
  const at = `@${roleMentionToken({ id: params.coordinator.id, name: params.coordinator.name })}`;
  const excerpt = params.detail.trim().slice(0, 500);
  await appendRoomMessage({
    id: `room-${Date.now()}-smart-disk-verify-fail`,
    scenarioId: params.scenarioId,
    taskId: params.taskId,
    from: 'system',
    content: [
      `【引擎·交付核验】${params.failedRoleName} 输入/输出交付物校验未通过：${excerpt}`,
      `${at} 请处理（补交付、打回修正或重新 @ 执行者）。`,
    ].join('\n'),
    mentions: [params.coordinator.id],
    timestamp: Date.now(),
  });
}
