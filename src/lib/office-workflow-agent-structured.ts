/** 是否含行首完整【任务理解】或【理解】标题（非正文中的【PM】等）。 */
export function hasWorkflowTaskUnderstandingHeading(text: string): boolean {
  return /(?:^|\n)【\s*(?:任务理解|理解)\s*】/u.test(text.trim());
}

function isWorkflowJsonShapeText(text: string): boolean {
  const trimmed = text.trim();
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
    && /"step"\s*:/u.test(slice)
    && /"inputValidation"\s*:/u.test(slice)
    && /"outputValidation"\s*:/u.test(slice)
    && /"deliverable"\s*:/u.test(slice)
    && /"rollback"\s*:/u.test(slice)
  );
}

/** 工作流节点 Agent 最终回复：JSON schema 或 legacy【】段落。 */
export function isWorkflowStructuredAgentText(text: string): boolean {
  const t = text.trim();
  if (!t || t.length < 20) return false;
  if (isWorkflowJsonShapeText(t)) return true;
  const hasUnderstanding = hasWorkflowTaskUnderstandingHeading(t);
  const hasDeliverable =
    /【\s*(?:交付产物|产物|交付)\s*】/u.test(t)
    || /【\s*[^】]*交付产物/u.test(t);
  return hasUnderstanding && hasDeliverable;
}

/** 工具/目录探查过程 narration，不能当作节点最终交付。 */
export function isWorkflowInterimAgentNarration(text: string): boolean {
  const t = text.trim();
  if (!t || isWorkflowStructuredAgentText(t)) return false;
  return /让我(?:先|检查|看看|确认|查)|我看到已(?:经)?有|(?:checking|let me check)/iu.test(t);
}
