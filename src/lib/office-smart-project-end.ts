import { extractOfficeBracketSections } from '@/lib/office-workflow-output-sections';
import { extractSmartRoomReplyAndDispatch } from '@/lib/office-smart-room-fields';
import { isSmartJsonShapeText } from '@/lib/office-smart-json-schema';
import { tryParseWorkflowJsonObject } from '@/lib/office-workflow-json-parse';

/** 群聊可见结项标记：引擎在协调者 `action==="end"` 发布时追加，供用户观察进展。 */
export const SMART_PROJECT_END_ROOM_MARKER = '【结项】';

/** @deprecated Smart 结项改由 JSON `action=end` 标识，不再使用正文 **项目结项**。 */
export const SMART_PROJECT_CLOSURE_MARK = '**项目结项**';

/** @deprecated */
export const SMART_PROJECT_CLOSURE_MARK_RE = /\*\*项目结项\*\*\s*$/u;

/** @deprecated */
export const SMART_PROJECT_CLOSURE_ANYWHERE_RE = /\*\*项目结项\*\*/u;

/** @deprecated */
export const SMART_LEGACY_PROJECT_CLOSURE_SECTION_RE = /【\s*项目结项\s*】/u;

/** @deprecated 保留导出兼容；结项扫描请用 {@link parseSmartCoordinatorEndFlag}。 */
export const SMART_TASK_COMPLETE_MARKERS = /"action"\s*:\s*"end"/u;

/** @deprecated */
export const SMART_PROJECT_END_SECTION_MARK = SMART_TASK_COMPLETE_MARKERS;

export function extractSmartCoordinatorRoomReplyBody(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const fromSmart = extractSmartRoomReplyAndDispatch(trimmed).roomReply.trim();
  if (fromSmart) return fromSmart;
  const sections = extractOfficeBracketSections(trimmed);
  const fromSection =
    sections['群聊回复']?.trim()
    ?? sections['回复']?.trim()
    ?? sections['交付']?.trim()
    ?? '';
  if (fromSection) return fromSection;
  const m = trimmed.match(
    /【\s*群聊回复\s*】\s*([\s\S]*?)(?=【\s*(?:分工|指派|交接)\s*】\s*|$)/iu,
  );
  if (m?.[1]?.trim()) return m[1].trim();
  if (!/【\s*(?:任务理解|输入校验|输出校验|交付产物|分工|指派|交接|结项)\s*】/u.test(trimmed)) {
    return trimmed;
  }
  return '';
}

/** 从协调者 JSON 顶层 action 或【结项】段读取结项；无法解析时视为 false。 */
export function parseSmartCoordinatorEndFlag(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;

  if (isSmartJsonShapeText(trimmed)) {
    const obj = tryParseWorkflowJsonObject(trimmed);
    const action = obj?.action;
    if (typeof action === 'string') return action.trim() === 'end';
  }
  const sections = extractOfficeBracketSections(trimmed);
  if (sections['动作']?.trim() === 'end') return true;

  return false;
}

/** @deprecated 结项唯一标识为 JSON `action==="end"`。 */
export function roomReplyHasProjectClosureMarker(_roomBody: string): boolean {
  return false;
}

/** @deprecated 结项唯一标识为 JSON `action==="end"`。 */
export function roomReplyContainsProjectClosureMarker(_roomBody: string): boolean {
  return false;
}

/** @deprecated */
export function stripSmartProjectClosureMarker(roomBody: string): string {
  return roomBody.trim();
}

/** @deprecated */
export function hasLooseProjectClosureText(_roomBody: string): boolean {
  return false;
}

export function isSmartProjectEndSectionExempt(body: string): boolean {
  const t = body.trim();
  return !t || /^无$/iu.test(t);
}

/** @deprecated */
export function hasLegacyProjectClosureSection(_raw: string): boolean {
  return false;
}

/** 协调者 JSON 是否声明结项（`action=end` 为唯一标识）。 */
export function coordinatorReplyDeclaresProjectEnd(raw: string): boolean {
  return parseSmartCoordinatorEndFlag(raw);
}

/** 引擎闸门通过且协调者 `action=end` 时方可结项。 */
export function coordinatorReplyMayCloseProject(
  raw: string,
  allStepsComplete: boolean,
  _minChars = 8,
): boolean {
  return allStepsComplete && parseSmartCoordinatorEndFlag(raw);
}

/** 协调者结项时发群的【群聊回复】正文。 */
export function extractSmartProjectClosureRoomPublishText(raw: string): string {
  const body = extractSmartCoordinatorRoomReplyBody(raw);
  return (body || raw).trim();
}

/** `action=end` 发布到群聊时追加可见结项标记（已含则跳过）。 */
export function appendSmartProjectEndRoomMarker(publishText: string): string {
  const base = publishText.trim();
  if (!base) return SMART_PROJECT_END_ROOM_MARKER;
  if (base.includes(SMART_PROJECT_END_ROOM_MARKER)) return base;
  return `${base}\n\n${SMART_PROJECT_END_ROOM_MARKER}`;
}
