import { isSmartJsonShapeText } from '../../../src/lib/office-smart-json-schema';
import {
  runSmartStructuredLayers123,
  type SmartStructuredLayerIssue,
} from '../../../src/lib/office-smart-structured-validation';
import { isRoomFastAckText } from './room-fast-ack';
import { isFastAckOnlyReply } from './room-mention-reply-policy';

/**
 * 模型未写【群聊回复】标题时，为成员 @协调者 的实质正文补上段落头（便于解析与校验）。
 */
export function coerceStructuredMentionRaw(raw: string, isCoordinator: boolean): string {
  const t = raw.trim();
  if (!t) return t;
  if (/【\s*群聊回复\s*】/u.test(t)) return t;
  if (isCoordinator) {
    if (/【\s*(?:理解|分工|判定)\s*】/u.test(t)) return t;
    if (t.length >= 12 && /[@＠]/u.test(t)) return `【群聊回复】\n${t}`;
    return t;
  }
  if (/^【理解】/u.test(t) && !/【\s*群聊回复\s*】/u.test(t)) return t;
  if (t.length >= 12 && /[@＠]/u.test(t) && !isRoomFastAckText(t) && !isFastAckOnlyReply(t)) {
    return `【群聊回复】\n${t}`;
  }
  return t;
}

/** Smart JSON 收稿：校验 schema 后转为【】段落，兼容 legacy bracket 输出。 */
export function normalizeSmartMentionRaw(
  raw: string,
  params: {
    isCoordinator: boolean;
    actorRoleName?: string;
  },
): {
  raw: string;
  jsonInvalid?: boolean;
  jsonIssues?: SmartStructuredLayerIssue[];
  jsonDetail?: string;
} {
  const t = raw.trim();
  if (!t || !isSmartJsonShapeText(t)) {
    return { raw: coerceStructuredMentionRaw(t, params.isCoordinator) };
  }
  const layers = runSmartStructuredLayers123({
    raw: t,
    isCoordinator: params.isCoordinator,
    actorRoleName: params.actorRoleName,
  });
  if (!layers.ok) {
    return {
      raw: t,
      jsonInvalid: true,
      jsonIssues: layers.issues,
      jsonDetail: layers.detail,
    };
  }
  return { raw: coerceStructuredMentionRaw(layers.normalizedRaw, params.isCoordinator) };
}
