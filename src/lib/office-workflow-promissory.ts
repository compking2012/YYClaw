import { isSmartMemberPromiseOnlyReply } from './office-smart-member-reply';

/** 工作流【交付产物】/群聊回复须含可核验正文，不能仅为计划/承诺/虚假完成声明。 */
const WORKFLOW_ARTIFACT_BODY_RE =
  /(?:^|\n)\s*(?:#{1,6}\s|\*\*[^*]+\*\*|```|[-*]\s+\S|\d+\.\s+\S|\|.+\|)/u;
const WORKFLOW_PROMISSORY_DELIVERABLE_RE =
  /正在(?:编写|整理|进行|推进|定稿|开发)|预计.{0,24}前(?:完成|发布|提交|交付)|稍(?:后|候)(?:提交|发布|完成|交付)|即将(?:发布|提交|完成|交付)|待我思考|开始(?:编写|整理|开发)|功能开发正式启动|用例编写正式启动/iu;
const WORKFLOW_FALSE_DONE_RE =
  /已(?:发布|完成|交付).{0,48}(?:评审|定稿|整合|收集)/u;

const TRIVIAL_ACK_RE =
  /^(?:收到|好的|ok|okay|明白|了解|知道了)[。.!！…\s]*$/iu;
const FAST_ACK_START_RE =
  /^收到[，,]?\s*(?:开始|马上|这就|立即)/iu;

function isTrivialWorkflowFastAck(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (TRIVIAL_ACK_RE.test(t)) return true;
  if (FAST_ACK_START_RE.test(t) && t.length < 120) return true;
  return false;
}

export function isWorkflowPromissoryDeliverable(text: string): boolean {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t || isTrivialWorkflowFastAck(t)) return true;
  if (isSmartMemberPromiseOnlyReply(t)) return true;
  const hasArtifactBody = WORKFLOW_ARTIFACT_BODY_RE.test(t) || t.length >= 180;
  if (WORKFLOW_PROMISSORY_DELIVERABLE_RE.test(t) && !hasArtifactBody) return true;
  if (WORKFLOW_FALSE_DONE_RE.test(t) && !hasArtifactBody) return true;
  return false;
}
