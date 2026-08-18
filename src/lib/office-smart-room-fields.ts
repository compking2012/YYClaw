import { roleMatchesMentionToken } from '@/lib/office-mention-parse';
import {
  isSmartJsonShapeText,
  parseSmartCoordinatorJsonOutput,
  parseSmartMemberJsonOutput,
  resolveSmartJsonRoomPublishText,
  smartDispatchRoleTaskText,
  type SmartDispatch,
  type SmartDispatchRoleTask,
} from '@/lib/office-smart-json-schema';
import {
  smartCoordinatorRoomMirrorTextFromJson,
  smartMemberRoomMirrorTextFromJson,
} from '@/lib/office-smart-room-publish';
import { tryParseWorkflowJsonObject } from '@/lib/office-workflow-json-parse';
import type { OfficeRole } from '@/types/office';
import type { ProjectAgentRef } from '@/lib/office-workflow-node';

const DISPATCH_SECTION_RE = /【\s*(?:分工|指派|交接)\s*】/gu;
const ROOM_REPLY_HEADING_RE = /【\s*群聊回复\s*】/u;
const END_SECTION_RE = /【\s*结项\s*】/u;

export type SmartRoomFieldSlice = {
  roomReply: string;
  dispatch: string;
};

type MentionTargetRole = Pick<OfficeRole, 'id' | 'name'>;

function roleRefForMatch(role: MentionTargetRole): ProjectAgentRef {
  const agentId = (role.id ?? '').trim();
  const displayName = (role.name ?? agentId).trim();
  return { agentId, displayName };
}

/** 从成员 JSON / 括号文 lenient 提取群聊可见正文。 */
export function extractSmartMemberRoomReplyFromRaw(raw: string): string {
  const text = raw.trim();
  if (!text) return '';
  if (isSmartJsonShapeText(text)) {
    const member = parseSmartMemberJsonOutput(text);
    if (member) return resolveSmartJsonRoomPublishText(member, false);
    const coord = parseSmartCoordinatorJsonOutput(text);
    if (coord) return resolveSmartJsonRoomPublishText(coord, true);
    const obj = tryParseWorkflowJsonObject(text);
    const legacy = typeof obj?.roomReply === 'string' ? obj.roomReply.trim() : '';
    if (legacy) return legacy;
  }
  return extractSmartRoomReplyAndDispatch(text).roomReply.trim();
}

/** JSON 或【群聊回复】…【分工】括号文：可靠切分 roomReply / dispatch（roomReply 内可含【分工】字样）。 */
export function extractSmartRoomReplyAndDispatch(raw: string): SmartRoomFieldSlice {
  const text = raw.trim();
  if (!text) return { roomReply: '', dispatch: '' };

  if (isSmartJsonShapeText(text)) {
    const coord = parseSmartCoordinatorJsonOutput(text);
    if (coord) {
      const dispatch = smartDispatchRoleTaskText(coord.dispatch) || '无';
      return {
        roomReply: smartCoordinatorRoomMirrorTextFromJson(coord),
        dispatch,
      };
    }
    const member = parseSmartMemberJsonOutput(text);
    if (member) {
      const dispatch = smartDispatchRoleTaskText(member.dispatch) || '无';
      return {
        roomReply: smartMemberRoomMirrorTextFromJson(member),
        dispatch,
      };
    }
  }

  return extractBracketRoomReplyAndDispatch(text);
}

/** 取【群聊回复】后至最后一个【分工|指派|交接】段之间的正文。 */
export function extractBracketRoomReplyAndDispatch(raw: string): SmartRoomFieldSlice {
  const text = raw.trim();
  const roomHeading = text.match(ROOM_REPLY_HEADING_RE);
  if (!roomHeading || roomHeading.index === undefined) {
    return { roomReply: '', dispatch: '' };
  }

  const bodyStart = roomHeading.index + roomHeading[0].length;
  let lastDispatchIdx = -1;
  let lastDispatchLen = 0;
  const dispatchRe = new RegExp(DISPATCH_SECTION_RE.source, 'gu');
  let match: RegExpExecArray | null;
  while ((match = dispatchRe.exec(text)) !== null) {
    if (match.index! >= bodyStart) {
      lastDispatchIdx = match.index!;
      lastDispatchLen = match[0].length;
    }
  }

  if (lastDispatchIdx < 0) {
    return { roomReply: text.slice(bodyStart).trim(), dispatch: '' };
  }

  const dispatchStart = lastDispatchIdx + lastDispatchLen;
  const rest = text.slice(dispatchStart);
  const endHeading = rest.match(END_SECTION_RE);
  const dispatchEnd = endHeading?.index === undefined
    ? text.length
    : dispatchStart + endHeading.index;

  return {
    roomReply: text.slice(bodyStart, lastDispatchIdx).trim(),
    dispatch: text.slice(dispatchStart, dispatchEnd).trim(),
  };
}

/** 协调者发群：先 roomReply 再 dispatch（去重空白；dispatch 已含于 roomReply 时不重复拼接）。 */
export function buildSmartCoordinatorRoomPublishText(
  roomReply: string,
  dispatch: string,
): string {
  const room = roomReply.trim();
  const disp = dispatch.trim();
  if (!disp || /^无$/iu.test(disp)) return room;
  if (!room) return disp;
  if (room === disp) return room;
  if (smartDispatchTextAlreadyInRoomReply(room, disp)) return room;
  return [room, disp].filter(Boolean).join('\n\n').trim();
}

function smartDispatchTextAlreadyInRoomReply(roomReply: string, dispatch: string): boolean {
  if (roomReply.includes(dispatch)) return true;
  const blocks = dispatch
    .split(/\n+/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (blocks.length === 0) return false;
  return blocks.every((block) => roomReply.includes(block));
}

const DISPATCH_ASSIGNMENT_LINE_RE =
  /^[@＠]([\w\u4e00-\u9fa5][\w\u4e00-\u9fa5.-]*)\s+(.+)$/u;
const NUMBERED_DISPATCH_LINE_RE =
  /^\d+[.、)]\s*[@＠]([\w\u4e00-\u9fa5][\w\u4e00-\u9fa5.-]*)\s+(.+)$/u;

/**
 * 从 dispatch 段纯文本（`@角色 任务` 行）解析结构化分工。
 * @deprecated Smart 运行时仅认 JSON dispatch[]；保留供展示/迁移测试。
 */
export function parseDispatchTextToRoleTasks(dispatchText: string): SmartDispatch {
  const items: SmartDispatchRoleTask[] = [];
  const body = dispatchText.trim();
  if (!body || /^无$/iu.test(body)) return items;
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const numbered = trimmed.match(NUMBERED_DISPATCH_LINE_RE);
    if (numbered) {
      items.push({ role: numbered[1]!, task: numbered[2]!.trim() });
      continue;
    }
    const direct = trimmed.match(DISPATCH_ASSIGNMENT_LINE_RE);
    if (direct) {
      items.push({ role: direct[1]!, task: direct[2]!.trim() });
    }
  }
  return items;
}

/**
 * 从协调者 JSON 解析 `dispatch[{role,task}]`。
 * 存在结构化 dispatch 时，跟进派发须仅以此为准（禁止从群聊正文/括号文解析）。
 */
export function parseStructuredSmartDispatch(
  raw: string,
  options?: { routingOnly?: boolean },
): SmartDispatch | null {
  void options;
  const text = raw.trim();
  if (!text || !isSmartJsonShapeText(text)) return null;

  const coord = parseSmartCoordinatorJsonOutput(text);
  if (coord?.dispatch.length) return coord.dispatch;
  const member = parseSmartMemberJsonOutput(text);
  if (member?.dispatch.length) return member.dispatch;
  const obj = tryParseWorkflowJsonObject(text);
  if (obj && typeof obj.dispatch === 'string') {
    const fromStringDispatch = parseDispatchTextToRoleTasks(obj.dispatch);
    if (fromStringDispatch.length > 0) return fromStringDispatch;
  }
  return null;
}

/** Smart 协调者：是否存在可派活的结构化 dispatch（roomReply @ 不计）。 */
export function hasSmartCoordinatorStructuredDispatch(raw: string): boolean {
  return (parseStructuredSmartDispatch(raw, { routingOnly: true })?.length ?? 0) > 0;
}

/** Smart 协调者：仅取 dispatch 段正文（JSON dispatch[] 序列化；禁止从群聊括号文解析）。 */
export function extractSmartCoordinatorDispatchOnlyText(raw: string): string {
  const structured = parseStructuredSmartDispatch(raw, { routingOnly: true });
  if (structured?.length) {
    const dispatch = smartDispatchRoleTaskText(structured).trim();
    if (dispatch && !/^无$/iu.test(dispatch)) return dispatch;
  }
  return '';
}

/** 按 dispatch.role 取该成员全部 `@角色 任务`（同一角色可有多条 dispatch 项）。 */
export function smartDispatchAssignmentTextForRole(
  dispatch: SmartDispatch,
  role: MentionTargetRole,
): string | null {
  const roleRef = roleRefForMatch(role);
  const hits = dispatch.filter((item) => {
    const roleName = item.role.trim();
    if (!roleName || /^无$/iu.test(roleName)) return false;
    return roleMatchesMentionToken(roleRef, roleName);
  });
  if (hits.length === 0) return null;
  const parts = hits.map((hit) => {
    const roleLabel = hit.role.trim();
    const task = hit.task.trim();
    if (!task || /^无$/iu.test(task)) return `@${roleLabel}`;
    return `@${roleLabel} ${task}`.trim();
  });
  return parts.join('\n\n').trim();
}

const ROLE_MENTION_HEADER_RE =
  /^[@＠]([\w\u4e00-\u9fa5][\w\u4e00-\u9fa5.-]*)\s*(.*)$/u;

/**
 * roomReply 中同一角色多次 @ 的多段任务（@ 可独占一行，任务正文在后续行直至下一个 @）。
 */
export function extractRoleAssignmentBlocksFromText(
  text: string,
  role: MentionTargetRole,
): string[] {
  const body = text.trim();
  if (!body) return [];
  const roleRef = roleRefForMatch(role);
  const blocks: string[] = [];
  let current: string[] | null = null;

  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    const header = trimmed.match(ROLE_MENTION_HEADER_RE);
    if (header) {
      const token = header[1]!;
      const rest = header[2]?.trim() ?? '';
      if (roleMatchesMentionToken(roleRef, token)) {
        if (current?.length) blocks.push(current.join('\n').trim());
        current = rest ? [`@${token} ${rest}`] : [`@${token}`];
        continue;
      }
      if (current?.length) {
        blocks.push(current.join('\n').trim());
        current = null;
      }
      continue;
    }
    if (current) current.push(line);
  }
  if (current?.length) blocks.push(current.join('\n').trim());
  return blocks.filter(Boolean);
}

function extractMentionLineForRole(text: string, role: MentionTargetRole): string | null {
  const roleRef = roleRefForMatch(role);
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!/[@＠]/u.test(trimmed)) continue;
    const tokens = trimmed.match(/[@＠]([\w\u4e00-\u9fa5][\w\u4e00-\u9fa5.-]*)/gu) ?? [];
    for (const mention of tokens) {
      const token = mention.replace(/^[@＠]/u, '');
      if (roleMatchesMentionToken(roleRef, token)) return trimmed;
    }
  }
  return null;
}

/** 从点名触发消息解析 Smart 原始 JSON（派活/校验用；群聊 content 仅展示）。 */
export function resolveSmartJsonRawFromMentionTrigger(
  userMsg: Pick<{ content?: string; smartJsonRaw?: string }, 'content' | 'smartJsonRaw'>,
  paramsContent?: string | null,
  paramsSmartJsonRaw?: string | null,
): string {
  for (const candidate of [
    paramsSmartJsonRaw,
    userMsg.smartJsonRaw,
    paramsContent,
    userMsg.content,
  ]) {
    const text = candidate?.trim();
    if (text && isSmartJsonShapeText(text)) return text;
  }
  return '';
}

/** 从 RoomMessage 解析 Smart 原始 JSON（群聊 content 仅展示，不参与运行时解析）。 */
export function resolveSmartStructuredRawFromRoomMessage(
  message: Pick<{ content?: string; progressText?: string; smartJsonRaw?: string }, 'content' | 'progressText' | 'smartJsonRaw'>,
  fallbackRaw?: string | null,
): string {
  return resolveSmartJsonRawFromMentionTrigger(
    { content: message.content, smartJsonRaw: message.smartJsonRaw },
    fallbackRaw ?? message.progressText ?? undefined,
    message.smartJsonRaw,
  );
}

/**
 * 成员任务 prompt：仅从协调者/上游原始 JSON 的 dispatch[{role,task}] 取指派。
 * 禁止解析 roomReply、括号文或群聊展示正文。
 */
export function buildSmartMemberDispatchAssignment(
  jsonRaw: string,
  role: MentionTargetRole,
  triggerPreview?: string,
): string {
  const trigger = jsonRaw.trim();
  if (trigger && isSmartJsonShapeText(trigger)) {
    const coord = parseSmartCoordinatorJsonOutput(trigger);
    if (coord?.dispatch.length) {
      const text = smartDispatchAssignmentTextForRole(coord.dispatch, role);
      if (text) return text;
    }

    const member = parseSmartMemberJsonOutput(trigger);
    if (member?.dispatch.length) {
      const text = smartDispatchAssignmentTextForRole(member.dispatch, role);
      if (text) return text;
    }
  }

  const preview = triggerPreview?.trim();
  if (!preview) return '';
  const blocks = extractRoleAssignmentBlocksFromText(preview, role);
  if (blocks.length > 0) return blocks.join('\n\n');
  return extractMentionLineForRole(preview, role) ?? '';
}
