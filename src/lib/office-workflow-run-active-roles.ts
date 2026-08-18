import { workflowNodeRoleIds } from '@/lib/office-workflow-node';
import type { NodeRunRecord, WorkflowDefinition, WorkflowNode } from '@/types/office';

/** 当前 status=running 的工作流节点上分配的角色（runner 正在节点会话中执行）。 */
export function roleIdsOnRunningWorkflowNodes(
  nodeRuns: NodeRunRecord[] | undefined,
  workflow: Pick<WorkflowDefinition, 'nodes'> | null | undefined,
): Set<string> {
  const ids = new Set<string>();
  if (!nodeRuns?.length || !workflow?.nodes?.length) return ids;
  const runByNode = new Map(nodeRuns.map((r) => [r.nodeId, r]));
  for (const node of workflow.nodes as WorkflowNode[]) {
    const run = runByNode.get(node.id);
    if (run?.status !== 'running') continue;
    for (const roleId of workflowNodeRoleIds(node)) {
      if (roleId) ids.add(roleId);
    }
  }
  return ids;
}
