/** 验收/审计/评审类步骤标题。 */
export function isWorkflowReviewLikeStepTitle(title: string): boolean {
  return /验收|审计|评审/u.test(title.trim());
}

/** 工程类落盘步骤（目录 `交付物-{角色}/`）；评审/验收/审计步优先按文档报告处理。 */
export function isWorkflowEngineeringDeliverableStep(stepTitle: string): boolean {
  const t = stepTitle.trim();
  if (isWorkflowReviewLikeStepTitle(t)) return false;
  return /开发|实现|编码|构建/u.test(t);
}

/** 评审/验收/审计步仅允许 conclusion 为 通过 / 不通过。 */
export function isWorkflowReviewStepConclusionAllowed(
  conclusion: '通过' | '不通过' | '已交付',
  stepTitle: string,
): boolean {
  if (!isWorkflowReviewLikeStepTitle(stepTitle)) return true;
  return conclusion === '通过' || conclusion === '不通过';
}

const SUMMARY_PASS_HINT_RE =
  /有条件通过|基本通过|准予通过|评审通过|验收通过|审计通过|整体通过|结论通过|可通过/u;
const SUMMARY_FAIL_HINT_RE =
  /不通过|未通过|评审失败|验收失败|审计失败|不合格|结论不通过/u;

/**
 * deliverable.summary 与 deliverable.conclusion 语义是否矛盾。
 * 例：summary 写「有条件通过」但 conclusion 为「不通过」。
 */
export function isWorkflowDeliverableConclusionSummaryMismatch(
  summary: string,
  conclusion: '通过' | '不通过' | '已交付',
): boolean {
  const s = summary.trim();
  if (!s) return false;
  const passHint = SUMMARY_PASS_HINT_RE.test(s);
  const failHint = SUMMARY_FAIL_HINT_RE.test(s);
  if (conclusion === '不通过' && passHint && !failHint) return true;
  if ((conclusion === '通过' || conclusion === '已交付') && failHint && !passHint) return true;
  return false;
}
