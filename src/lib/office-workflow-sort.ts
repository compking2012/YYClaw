import {
  syncWorkflowEdges,
  topologicalSortWorkflowNodes,
} from '@/lib/office-workflow-edges';
import type { WorkflowDefinition, WorkflowNode } from '@/types/office';

/**
 * Leading sequence in task title (e.g. `1. 需求`, `第2步 开发`, `步骤3`).
 * Used for process order — not locale A–Z sorting.
 */
export function extractTaskSequenceIndex(title: string): number | null {
  const t = title.trim();
  if (!t) return null;

  const patterns = [
    /^\s*(\d+)\s*[.、:：)\]】]\s*/,
    /^\s*第\s*(\d+)\s*(?:步|阶段|章|节|轮)?/,
    /^\s*步骤\s*(\d+)/i,
    /^\s*task\s*(\d+)/i,
    /^\s*\((\d+)\)/,
    /^\s*（(\d+)）/,
  ];

  for (const re of patterns) {
    const m = t.match(re);
    if (m?.[1]) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/** Compare task titles for workflow process order (sequence index first). */
export function compareTaskTitleForFlowOrder(
  titleA: string,
  titleB: string,
  stableTieBreaker = 0,
): number {
  const a = titleA.trim();
  const b = titleB.trim();
  const ia = extractTaskSequenceIndex(a);
  const ib = extractTaskSequenceIndex(b);

  if (ia != null && ib != null && ia !== ib) return ia - ib;
  if (ia != null && ib == null) return -1;
  if (ia == null && ib != null) return 1;

  if (ia == null && ib == null) return stableTieBreaker;

  if (a !== b) {
    return a.localeCompare(b, 'zh-CN', { numeric: true, sensitivity: 'base' });
  }
  return stableTieBreaker;
}

function sortNodesByTitleProcessOrder(nodes: WorkflowNode[]): WorkflowNode[] {
  return [...nodes]
    .map((node, index) => ({ node, index }))
    .sort((a, b) => {
      const cmp = compareTaskTitleForFlowOrder(
        a.node.title ?? '',
        b.node.title ?? '',
        a.index - b.index,
      );
      return cmp !== 0 ? cmp : a.index - b.index;
    })
    .map(({ node }) => node);
}

/**
 * Reorder workflow tasks for process flow:
 * - If dependency edges form a valid DAG → topological order (flow), tie-break by title sequence.
 * - Else → order by explicit sequence in task names (1./第N步…), not plain A–Z.
 * Serial mode also regenerates edges to match the new list order.
 */
export function sortWorkflowNodesByProcessOrder(workflow: WorkflowDefinition): WorkflowDefinition {
  const { nodes, edges } = workflow;
  if (nodes.length < 2) return workflow;

  const titleCmp = (ta: string, tb: string) => compareTaskTitleForFlowOrder(ta, tb, 0);

  let ordered: WorkflowNode[];
  if (edges.length > 0) {
    const topo = topologicalSortWorkflowNodes(nodes, edges, titleCmp);
    ordered = topo ?? sortNodesByTitleProcessOrder(nodes);
  } else {
    ordered = sortNodesByTitleProcessOrder(nodes);
  }

  const next = { ...workflow, nodes: ordered };
  return workflow.edgesCustomized ? next : syncWorkflowEdges(next);
}

/** @deprecated Use sortWorkflowNodesByProcessOrder */
export const sortWorkflowNodesByTitle = sortWorkflowNodesByProcessOrder;
