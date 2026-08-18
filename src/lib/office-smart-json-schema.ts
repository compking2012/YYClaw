import {
  buildSmartRoomPublishText,
  smartCoordinatorRoomMirrorTextFromJson,
  smartMemberRoomMirrorTextFromJson,
} from '@/lib/office-smart-room-publish';
import { parseWorkflowJsonObjectDetailed, tryParseWorkflowJsonObject } from '@/lib/office-workflow-json-parse';

/** Smart 群聊可见正文最短字数（由 taskUnderstanding 等合成）。 */
export const SMART_MIN_ROOM_REPLY_CHARS = 20;

/** Smart 协调者 JSON 输出（群聊点名；不发 runner）。 */
export type SmartDispatchAction = 'assign' | 'review' | 'end' | 'help';

export type SmartDispatchRoleTask = {
  role: string;
  task: string;
};

export type SmartDispatch = SmartDispatchRoleTask[];

export type SmartDeliverable = {
  items: string[];
  outputValidation: string[];
};

export type SmartCoordinatorJsonOutput = {
  role: string;
  inputValidation: string;
  taskUnderstanding: string;
  action: SmartDispatchAction;
  deliverable: SmartDeliverable;
  /** @deprecated 仅兼容旧 Session；新协议由 taskUnderstanding + dispatch 合成群聊正文 */
  roomReply?: string;
  dispatch: SmartDispatch;
};

/** Smart 成员 JSON 输出（无 inputValidation）。 */
export type SmartMemberJsonOutput = {
  role: string;
  taskUnderstanding: string;
  action: SmartDispatchAction;
  deliverable: SmartDeliverable;
  /** @deprecated 仅兼容旧 Session */
  roomReply?: string;
  dispatch: SmartDispatch;
};

export type SmartJsonOutput = SmartCoordinatorJsonOutput | SmartMemberJsonOutput;
export type SmartJsonParseIssue =
  | 'invalid_json_syntax'
  | 'invalid_json_missing_fields'
  | 'invalid_json_value';

export type SmartJsonParseResult =
  | { ok: true; json: SmartJsonOutput; raw: string; repaired: boolean }
  | {
      ok: false;
      stage: 'syntax' | 'fields' | 'values';
      issues: SmartJsonParseIssue[];
      detail: string;
      raw: string;
    };

export const SMART_JSON_DELIVERABLE_MAX_CHARS = 100;
export const SMART_JSON_TASK_UNDERSTANDING_MAX_CHARS = 100;
/** @deprecated 新协议无 roomReply 字段 */
export const SMART_JSON_ROOM_REPLY_MAX_CHARS = 200;
export const SMART_JSON_DISPATCH_MAX_CHARS = 250;

function readString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === 'string' ? v : null;
}

function readSmartDispatch(obj: Record<string, unknown>): SmartDispatch | null {
  const dispatch = obj.dispatch;
  if (!Array.isArray(dispatch)) return null;
  const tasks: SmartDispatchRoleTask[] = [];
  for (const item of dispatch) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const rec = item as Record<string, unknown>;
    if (typeof rec.role !== 'string' || typeof rec.task !== 'string') return null;
    tasks.push({ role: rec.role, task: rec.task });
  }
  return tasks;
}

function readSmartAction(obj: Record<string, unknown>): SmartDispatchAction | null {
  const action = typeof obj.action === 'string' ? obj.action.trim() : '';
  if (action !== 'assign' && action !== 'review' && action !== 'end' && action !== 'help') return null;
  return action;
}

function readSmartDeliverable(obj: Record<string, unknown>): SmartDeliverable | null {
  const deliverable = obj.deliverable;
  if (deliverable && typeof deliverable === 'object' && !Array.isArray(deliverable)) {
    const d = deliverable as Record<string, unknown>;
    if (!Array.isArray(d.items)) return null;
    if (!Array.isArray(d.outputValidation) && typeof d.outputValidation !== 'string') return null;
    const names: string[] = [];
    for (const item of d.items) {
      if (typeof item !== 'string') return null;
      names.push(item);
    }
    const outputValidation =
      typeof d.outputValidation === 'string'
        ? (names.length === 0 && /^无$/iu.test(d.outputValidation.trim()) ? [] : [d.outputValidation])
        : d.outputValidation;
    for (const item of outputValidation) {
      if (typeof item !== 'string') return null;
    }
    return {
      items: names,
      outputValidation,
    };
  }
  return null;
}

export function smartDeliverableNamesText(deliverable: string[]): string {
  return deliverable.map((item) => item.trim()).filter(Boolean).join('\n');
}

export function smartDeliverableOutputValidationText(outputValidation: string[]): string {
  return outputValidation.map((item) => item.trim()).filter(Boolean).join('\n');
}

export function smartDispatchRoleTaskText(dispatch: SmartDispatch): string {
  return dispatch
    .map((item) => {
      const role = item.role.trim();
      const task = item.task.trim();
      if (!role || /^无$/iu.test(role)) return '';
      if (!task || /^无$/iu.test(task)) return '';
      return `@${role} ${task}`.trim();
    })
    .filter(Boolean)
    .join('\n\n');
}

function requiredSmartFields(isCoordinator: boolean): string[] {
  return isCoordinator
    ? ['role', 'inputValidation', 'taskUnderstanding', 'deliverable', 'dispatch']
    : ['role', 'taskUnderstanding', 'deliverable', 'dispatch'];
}

function missingSmartFields(obj: Record<string, unknown>, isCoordinator: boolean): string[] {
  const missing = requiredSmartFields(isCoordinator).filter((key) => !(key in obj));
  if (!('action' in obj)) missing.push('action');
  if (!('dispatch' in obj)) return missing;

  const dispatch = obj.dispatch;
  if (!Array.isArray(dispatch)) return missing;
  dispatch.forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    const rec = item as Record<string, unknown>;
    if (!('role' in rec)) missing.push(`dispatch[${index}].role`);
    if (!('task' in rec)) missing.push(`dispatch[${index}].task`);
  });
  const deliverable = obj.deliverable;
  if (deliverable && typeof deliverable === 'object' && !Array.isArray(deliverable)) {
    const d = deliverable as Record<string, unknown>;
    if (!('items' in d)) missing.push('deliverable.items');
    if (!('outputValidation' in d)) missing.push('deliverable.outputValidation');
  }
  return missing;
}

function smartJsonFromObject(
  obj: Record<string, unknown>,
  isCoordinator: boolean,
): SmartJsonOutput | null {
  return isCoordinator
    ? smartCoordinatorJsonFromObject(obj)
    : smartMemberJsonFromObject(obj);
}

export function isSmartJsonShapeText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 24) return false;
  const body = (() => {
    const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
    if (fence?.[1]) return fence[1].trim();
    return trimmed;
  })();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return false;
  const slice = body.slice(start, end + 1);
  return (
    /"role"\s*:/u.test(slice)
    && /"taskUnderstanding"\s*:/u.test(slice)
    && /"deliverable"\s*:/u.test(slice)
    && /"dispatch"\s*:/u.test(slice)
  );
}

export function parseSmartCoordinatorJsonOutput(raw: string): SmartCoordinatorJsonOutput | null {
  const obj = tryParseWorkflowJsonObject(raw);
  if (!obj) return null;
  return smartCoordinatorJsonFromObject(obj);
}

function smartCoordinatorJsonFromObject(obj: Record<string, unknown>): SmartCoordinatorJsonOutput | null {
  const role = readString(obj, 'role');
  const inputValidation = readString(obj, 'inputValidation');
  const taskUnderstanding = readString(obj, 'taskUnderstanding');
  const action = readSmartAction(obj);
  const deliverable = readSmartDeliverable(obj);
  const dispatch = readSmartDispatch(obj);
  const legacyRoomReply = readString(obj, 'roomReply');
  if (
    !role
    || taskUnderstanding === null
    || inputValidation === null
    || action === null
    || deliverable === null
    || !dispatch
  ) {
    return null;
  }
  return {
    role,
    inputValidation,
    taskUnderstanding,
    action,
    deliverable,
    ...(legacyRoomReply !== null ? { roomReply: legacyRoomReply } : {}),
    dispatch,
  };
}

export function parseSmartMemberJsonOutput(raw: string): SmartMemberJsonOutput | null {
  const obj = tryParseWorkflowJsonObject(raw);
  if (!obj) return null;
  return smartMemberJsonFromObject(obj);
}

function smartMemberJsonFromObject(obj: Record<string, unknown>): SmartMemberJsonOutput | null {
  const role = readString(obj, 'role');
  const taskUnderstanding = readString(obj, 'taskUnderstanding');
  const action = readSmartAction(obj);
  const deliverable = readSmartDeliverable(obj);
  const dispatch = readSmartDispatch(obj);
  const legacyRoomReply = readString(obj, 'roomReply');
  if (
    !role
    || taskUnderstanding === null
    || action === null
    || deliverable === null
    || !dispatch
  ) {
    return null;
  }
  return {
    role,
    taskUnderstanding,
    action,
    deliverable,
    ...(legacyRoomReply !== null ? { roomReply: legacyRoomReply } : {}),
    dispatch,
  };
}

export function parseSmartJsonOutput(
  raw: string,
  isCoordinator: boolean,
): SmartJsonOutput | null {
  return isCoordinator
    ? parseSmartCoordinatorJsonOutput(raw)
    : parseSmartMemberJsonOutput(raw);
}

export function parseSmartJsonOutputDetailed(
  raw: string,
  isCoordinator: boolean,
): SmartJsonParseResult {
  const parsedObject = parseWorkflowJsonObjectDetailed(raw);
  if (!parsedObject.ok) {
    return {
      ok: false,
      stage: 'syntax',
      issues: ['invalid_json_syntax'],
      detail: parsedObject.detail,
      raw,
    };
  }
  const missing = missingSmartFields(parsedObject.object, isCoordinator);
  if (missing.length > 0) {
    return {
      ok: false,
      stage: 'fields',
      issues: ['invalid_json_missing_fields'],
      detail: `Smart JSON 缺少必填字段：${missing.join(', ')}`,
      raw,
    };
  }
  const json = smartJsonFromObject(parsedObject.object, isCoordinator);
  if (!json) {
    return {
      ok: false,
      stage: 'values',
      issues: ['invalid_json_value'],
      detail: 'Smart JSON 字段值类型不符合预期（role/taskUnderstanding/action 等须符合协议，deliverable 须为 {items, outputValidation[]} 对象，dispatch 须为数组 [{role, task}]）',
      raw,
    };
  }
  return { ok: true, json, raw, repaired: parsedObject.repaired };
}

/** 解析或合成群聊可见正文（优先 legacy roomReply，否则按新协议合成）。 */
export function resolveSmartJsonRoomPublishText(
  json: SmartJsonOutput,
  isCoordinator: boolean,
): string {
  const legacy = json.roomReply?.trim();
  if (legacy) return legacy;
  return buildSmartRoomPublishText(json, isCoordinator);
}

/** JSON → 既有【】段落格式，复用 Smart 镜像/群聊校验链路。 */
export function smartJsonToBracketText(json: SmartJsonOutput, isCoordinator: boolean): string {
  const roomMirror = isCoordinator
    ? smartCoordinatorRoomMirrorTextFromJson(json as SmartCoordinatorJsonOutput)
    : smartMemberRoomMirrorTextFromJson(json as SmartMemberJsonOutput);
  const lines = [
    `【任务理解】${json.taskUnderstanding.trim()}`,
  ];
  if (isCoordinator && 'inputValidation' in json) {
    lines.push(`【动作】${json.action}`);
    lines.push(`【输入校验】${json.inputValidation.trim()}`);
  } else if (!isCoordinator && 'action' in json) {
    lines.push(`【动作】${json.action}`);
  }
  const dispatchText = smartDispatchRoleTaskText(json.dispatch) || '无';
  const deliverableText = (() => {
    const names = smartDeliverableNamesText(json.deliverable.items);
    return names ? `${names}\n关键摘要：见群聊回复` : '';
  })();
  lines.push(
    `【输出校验】${smartDeliverableOutputValidationText(json.deliverable.outputValidation)}`,
    `【交付产物】${deliverableText}`,
    `【群聊回复】${roomMirror}`,
    `【分工】${dispatchText}`,
  );
  return lines.join('\n');
}

export function canonicalSmartJsonFingerprint(json: SmartJsonOutput): string {
  return JSON.stringify(json);
}
