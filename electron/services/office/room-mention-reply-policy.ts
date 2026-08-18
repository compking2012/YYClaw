import {
  extractPublicRoomMirrorText,
  finalizeCoordinatorDispatchReply,
  isIntermediateOnlyRoomMirrorText,
} from '../../../src/lib/office-room-mirror-public';
import { normalizeStrictAtMentionText } from '../../../src/lib/office-mention-parse';
import { isSmartMemberPromiseOnlyReply } from '../../../src/lib/office-smart-member-reply';
import { isWorkflowPromissoryDeliverable } from '../../../src/lib/office-workflow-promissory';
import { isSmartJsonShapeText } from '../../../src/lib/office-smart-json-schema';
import { isRoomFastAckText, ROOM_FAST_ACK_TEXT } from './room-fast-ack';
import type { OfficeRole } from './types';

const MODEL_RUNTIME_ERROR_MAX_LEN = 320;
const SMART_MIRROR_SECTION_RE =
  /【\s*(?:任务理解|输入校验|输出校验|交付产物|群聊回复|分工|指派|交接)\s*】/u;

function looksLikeStructuredAgentOutput(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (isSmartJsonShapeText(t)) return true;
  if (SMART_MIRROR_SECTION_RE.test(t)) return true;
  if (/^```/m.test(t)) return true;
  if (t.length > MODEL_RUNTIME_ERROR_MAX_LEN && /[@＠]/u.test(t)) return true;
  return false;
}

/** 高置信度模型运行时错误检测（短 stub）；结构化 Agent 正文不判。 */
export function isLikelyModelRuntimeError(text: string): boolean {
  const t = text.trim();
  if (!t || looksLikeStructuredAgentOutput(t)) return false;
  if (t.length > MODEL_RUNTIME_ERROR_MAX_LEN) return false;

  const head = t.slice(0, 140);

  if (/^agent failed\b/iu.test(t)) return true;
  if (/^all models failed\b/iu.test(t)) return true;
  if (/^(?:error|failed|failure)\s*[:：]/iu.test(head)) return true;

  const firstLine = (t.split('\n')[0] ?? t).trim();

  if (
    t.length <= 200
    && /^(?:model_not_found|all models failed|authentication failed|invalid api key|no api key configured|api key (?:is )?missing)/iu.test(
      firstLine,
    )
  ) {
    return true;
  }

  if (
    t.length <= 160
    && (
      /^(?:HTTP\s*)?429\b/iu.test(firstLine)
      || (/^(?:rate limit|too many requests)/iu.test(firstLine) && /\b429\b/u.test(t))
    )
  ) {
    return true;
  }

  if (
    t.length <= 200
    && /^HTTP\s+5\d{2}\b/iu.test(t)
    && /error|internal|unavailable|bad gateway|gateway timeout/iu.test(t)
  ) {
    return true;
  }

  if (t.length <= 200 && /^(?:error|status|code)\s*[:#]\s*5\d{2}\b/iu.test(t)) {
    return true;
  }

  return false;
}

/** Legacy workflow wait lines — must not appear on `task_running.progressText`. */
const WORKFLOW_AGENT_WAIT_PROGRESS_RE =
  /等待\s*Agent\s*复述理解并执行|已派发\s*Agent[，,]?\s*等待回复/u;

/** session-new 注入的系统句，不得进入 workflow 群聊进展。 */
const OFFICE_SESSION_NEW_STARTED_RE = /^(?:✅\s*)?New session started\.?\s*$/iu;

export function isOfficeSessionNewStartedSnippet(text: string): boolean {
  return OFFICE_SESSION_NEW_STARTED_RE.test(text.trim());
}

/** 点名结构化输出含可发布段时，【理解】里引用极速 ack 不应整段判为占位。 */
const MENTION_STRUCTURED_ROOM_REPLY_MARK = /【\s*群聊回复\s*】/u;

/** Legacy/system filler lines that must not be mirrored to the team room. */
/** Agent fast-ack / filler only — not coordinator system status lines in the team room. */
const UNMIRRORABLE_REPLY_RE =
  /正在回复|正在群聊同步|群聊同步进展|OK[，,、\s]*待我思考|待我思考|稍后回复|稍后再回复|稍候回复|思考下|思考片刻|已派发\s*\(run:|极速回复|先回复.*稍后|仅.*稍后/iu;

const NO_REPLY_RE = /^(HEARTBEAT_OK|NO_REPLY)\s*$/iu;

/** 模型英文内部推理 / NO_REPLY 决策泄漏，不得镜像到群聊。 */
const ENGLISH_INTERNAL_REASONING_RE =
  /(?:^|\n)\s*(?:Since I (?:just|already)|Actually, wait|Looking at the rules|the appropriate action is|should NOT repeat|I already (?:provided|responded)|prior turn|duplicate context|send NO_REPLY|NO_REPLY to avoid|So when I do respond|must @ 协调者汇报)/iu;
const ENGLISH_OPTIONAL_LEAK_RE = /(?:^|\n)\s*optional:\s*/iu;

/** Trivial ack-only lines (no substance). */
const TRIVIAL_ACK_RE =
  /^(?:收到|好的|ok|okay|明白|了解|知道了)[。.!！…\s]*$/iu;

/**「收到，开始…」类占位：未展开实质工作即声称开始。 */
const FAST_ACK_START_RE =
  /^收到[，,]?\s*(?:开始|马上|这就|立即)/iu;

export function isStructuredMentionSessionReply(text: string): boolean {
  return MENTION_STRUCTURED_ROOM_REPLY_MARK.test(text.trim());
}

/** 英文思考过程 / NO_REPLY 占位，禁止发布到项目群。 */
export function isEnglishInternalReasoning(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (NO_REPLY_RE.test(t)) return true;
  if (ENGLISH_INTERNAL_REASONING_RE.test(t) || ENGLISH_OPTIONAL_LEAK_RE.test(t)) return true;
  const cjk = (t.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const asciiWords = t.match(/\b[a-zA-Z]{4,}\b/g) ?? [];
  if (cjk < 6 && asciiWords.length >= 4) {
    return /(?:since|looking|actually|should not|no_reply|optional|prior turn|substantive reply)/iu.test(
      t,
    );
  }
  return false;
}

export function isUnmirroredRoomSnippet(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (isRoomFastAckText(t) || t === ROOM_FAST_ACK_TEXT) return false;
  if (isStructuredMentionSessionReply(t)) return false;
  if (isEnglishInternalReasoning(t)) return true;
  if (NO_REPLY_RE.test(t)) return true;
  if (TRIVIAL_ACK_RE.test(t) && !isRoomFastAckText(t)) return true;
  if (UNMIRRORABLE_REPLY_RE.test(t)) return true;
  const compact = t.replace(/\s+/g, '');
  if (/^OK[，,]?待我思考/.test(compact)) return true;
  if (/稍后回复/.test(compact) && compact.length < 40) return true;
  return false;
}

/** @deprecated Use {@link isUnmirroredRoomSnippet}. */
export const isRoomPlaceholderReply = isUnmirroredRoomSnippet;

/** Session/history lines that must not count as the substantive @mention LLM reply. */
export function isNonSubstantiveMentionSessionReply(text: string | null | undefined): boolean {
  const t = (text ?? '').trim();
  if (!t) return true;
  if (isStructuredMentionSessionReply(t)) return false;
  if (isRoomFastAckText(t)) return true;
  if (isFastAckOnlyReply(t)) return true;
  if (isUnmirroredRoomSnippet(t)) return true;
  return false;
}

export function isFastAckOnlyReply(text: string): boolean {
  const t = (extractPublicRoomMirrorText(text).trim() || text.trim()).replace(/\s+/g, ' ');
  if (!t) return true;
  if (isRoomFastAckText(t)) return true;
  if (TRIVIAL_ACK_RE.test(t)) return true;
  if (FAST_ACK_START_RE.test(t) && t.length < 120) return true;
  return false;
}

export function isSubstantiveRoomMentionReply(
  text: string,
  opts?: { smartMember?: boolean; workflowMember?: boolean },
): boolean {
  const t = extractPublicRoomMirrorText(text).trim() || text.trim();
  if (isIntermediateOnlyRoomMirrorText(text)) return false;
  if (isFastAckOnlyReply(t)) return false;
  if (opts?.smartMember && isSmartMemberPromiseOnlyReply(t)) return false;
  if (opts?.workflowMember && isWorkflowPromissoryDeliverable(t)) return false;
  return t.length >= 6 && !NO_REPLY_RE.test(t) && !isUnmirroredRoomSnippet(t);
}

/** Agent stream snippets suitable for workflow `task_running` progress (not system wait placeholders). */
export function isSubstantiveWorkflowProgressSnippet(text: string): boolean {
  const t = text.trim();
  if (!t || t.length < 6) return false;
  if (WORKFLOW_AGENT_WAIT_PROGRESS_RE.test(t)) return false;
  if (isOfficeSessionNewStartedSnippet(t)) return false;
  if (isUnmirroredRoomSnippet(t)) return false;
  if (isIntermediateOnlyRoomMirrorText(t)) return false;
  return true;
}

/** Drop 【理解】/中间叙述，仅保留可公开的交付与分工内容. */
export function finalizeRoomMirrorReply(text: string, teamRoles: OfficeRole[] = []): string {
  const body = extractPublicRoomMirrorText(text);
  const normalized = teamRoles.length > 0 ? normalizeStrictAtMentionText(body, teamRoles) : body;
  return isUnmirroredRoomSnippet(normalized) ? '' : normalized;
}

export function roomReplyProgressSnippet(text: string): string | undefined {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t || isUnmirroredRoomSnippet(t)) return undefined;
  return `群聊进展 · ${t.slice(0, 160)}${t.length > 160 ? '…' : ''}`;
}

const FALLBACK_NOTE: Record<'timeout' | 'empty' | 'error', string> = {
  timeout: '（自动生成：回复超时，请再次 @我。）',
  empty: '（自动生成：未收到有效输出。）',
  error: '（自动生成：派发失败。）',
};

export function isCoordinatorMentionFallbackReply(text: string): boolean {
  return /（自动生成：/.test(text);
}

export function buildMandatoryMentionReplyFallback(
  roleName: string,
  speakerMentionRef: string,
  reason: 'timeout' | 'empty' | 'error',
): string {
  const ref = speakerMentionRef.trim();
  return `【${roleName}】@${ref} 已收到点名，将在群内跟进并同步进展直至闭环。${FALLBACK_NOTE[reason]}`;
}

export function coerceSubstantiveRoomReply(
  text: string,
  roleName: string,
  speakerMentionRef: string,
  reason: 'timeout' | 'empty' | 'error',
): string {
  const finalized = finalizeRoomMirrorReply(text);
  if (isSubstantiveRoomMentionReply(finalized || text)) {
    return finalized || text.trim();
  }
  return buildMandatoryMentionReplyFallback(roleName, speakerMentionRef, reason);
}

/** Smart / coordinator dispatch: preserve stage tables and @assignments in the team room. */
export function coerceCoordinatorDispatchRoomReply(
  text: string,
  roleName: string,
  speakerMentionRef: string,
  reason: 'timeout' | 'empty' | 'error',
  teamRoles: OfficeRole[] = [],
): string {
  const body = finalizeCoordinatorDispatchReply(text);
  const normalized = teamRoles.length > 0 ? normalizeStrictAtMentionText(body, teamRoles) : body;
  const candidate = normalized.trim() || body.trim();
  if (candidate.length >= 6 && !isUnmirroredRoomSnippet(candidate)) return candidate;
  return coerceSubstantiveRoomReply(text, roleName, speakerMentionRef, reason);
}
