import {
  smartDispatchRoleTaskText,
  type SmartCoordinatorJsonOutput,
  type SmartJsonOutput,
  type SmartMemberJsonOutput,
} from '@/lib/office-smart-json-schema';

/** 交付物路径数组 → 群聊可见摘要（basename 列表）。 */
export function formatSmartDeliverableItemsRoomSummary(items: string[]): string {
  const paths = items.map((p) => p.trim()).filter(Boolean);
  if (paths.length === 0) return '';
  const labels = paths.map((p) => {
    const norm = p.replace(/\\/g, '/').replace(/\/+$/u, '');
    const base = norm.includes('/') ? norm.split('/').pop()! : norm;
    return base || norm;
  });
  return `交付物：${labels.join('、')}`;
}

/** 成员发群：taskUnderstanding + deliverable 路径摘要 + dispatch(@协调者)。 */
export function buildSmartMemberRoomPublishText(json: SmartMemberJsonOutput): string {
  const parts: string[] = [];
  const understanding = json.taskUnderstanding.trim();
  if (understanding) parts.push(understanding);
  const deliverableSummary = formatSmartDeliverableItemsRoomSummary(json.deliverable.items);
  if (deliverableSummary) parts.push(deliverableSummary);
  const dispatchText = smartDispatchRoleTaskText(json.dispatch);
  if (dispatchText) parts.push(dispatchText);
  return parts.join('\n\n').trim();
}

/** 协调者发群：taskUnderstanding + dispatch(@成员+任务)。 */
export function buildSmartCoordinatorRoomPublishTextFromJson(
  json: SmartCoordinatorJsonOutput,
): string {
  const parts: string[] = [];
  const understanding = json.taskUnderstanding.trim();
  if (understanding) parts.push(understanding);
  const dispatchText = smartDispatchRoleTaskText(json.dispatch);
  if (dispatchText) parts.push(dispatchText);
  return parts.join('\n\n').trim();
}

/** 协调者【群聊回复】镜像段：不含 dispatch（dispatch 独占【分工】）。 */
export function smartCoordinatorRoomMirrorTextFromJson(
  json: SmartCoordinatorJsonOutput,
): string {
  const legacy = json.roomReply?.trim();
  if (legacy) return legacy;
  return json.taskUnderstanding.trim();
}

/** 成员【群聊回复】镜像段：taskUnderstanding + 交付物摘要，不含 dispatch。 */
export function smartMemberRoomMirrorTextFromJson(json: SmartMemberJsonOutput): string {
  const legacy = json.roomReply?.trim();
  if (legacy) return legacy;
  const parts: string[] = [];
  const understanding = json.taskUnderstanding.trim();
  if (understanding) parts.push(understanding);
  const deliverableSummary = formatSmartDeliverableItemsRoomSummary(json.deliverable.items);
  if (deliverableSummary) parts.push(deliverableSummary);
  return parts.join('\n\n').trim();
}

/** Smart JSON → 写入群聊的正文（无 roomReply 字段）。 */
export function buildSmartRoomPublishText(
  json: SmartJsonOutput,
  isCoordinator: boolean,
): string {
  return isCoordinator
    ? buildSmartCoordinatorRoomPublishTextFromJson(json as SmartCoordinatorJsonOutput)
    : buildSmartMemberRoomPublishText(json as SmartMemberJsonOutput);
}
