/** 回滚边 SVG 路径：从源节点顶边连到目标节点底边，侧向贝塞尔曲线。 */
export function buildWorkflowRollbackEdgePath(
  fromRect: DOMRect,
  toRect: DOMRect,
  containerRect: DOMRect,
): string {
  const x1 = fromRect.left + fromRect.width / 2 - containerRect.left;
  const y1 = fromRect.top - containerRect.top;
  const x2 = toRect.left + toRect.width / 2 - containerRect.left;
  const y2 = toRect.bottom - containerRect.top;

  const spanY = Math.max(24, y1 - y2);
  const bulge = Math.max(48, spanY * 0.35, Math.abs(x1 - x2) * 0.45 + 28);
  const side = x1 >= x2 ? 1 : -1;
  const cx = (x1 + x2) / 2 + side * bulge;

  return `M ${x1} ${y1} C ${cx} ${y1 - spanY * 0.15}, ${cx} ${y2 + spanY * 0.15}, ${x2} ${y2}`;
}

export type WorkflowRollbackEdgePath = {
  id: string;
  d: string;
};

export function computeWorkflowRollbackEdgePaths(
  edges: { from: string; to: string }[],
  nodeElements: Map<string, HTMLElement>,
  container: HTMLElement,
): WorkflowRollbackEdgePath[] {
  const containerRect = container.getBoundingClientRect();
  const out: WorkflowRollbackEdgePath[] = [];

  for (const edge of edges) {
    const fromEl = nodeElements.get(edge.from);
    const toEl = nodeElements.get(edge.to);
    if (!fromEl || !toEl) continue;
    out.push({
      id: `${edge.from}->${edge.to}`,
      d: buildWorkflowRollbackEdgePath(
        fromEl.getBoundingClientRect(),
        toEl.getBoundingClientRect(),
        containerRect,
      ),
    });
  }

  return out;
}
