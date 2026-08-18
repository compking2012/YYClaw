import type { WorkflowNode } from './types';

export {
  defaultEdgesForNodeOrder,
  edgesEqual,
  syncWorkflowEdges,
  validateWorkflowEdges,
} from '../../../src/lib/office-workflow-edges';

export const DEFAULT_NODE_MAX_RUNTIME_MINUTES = 30;

export function nodeMaxRuntimeMinutes(node: Pick<WorkflowNode, 'maxRuntimeMinutes'>): number {
  const v = node.maxRuntimeMinutes;
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.round(v);
  return DEFAULT_NODE_MAX_RUNTIME_MINUTES;
}
