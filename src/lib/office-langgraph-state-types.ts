/** LangGraph workflow state fields shared between runner compile and UI/codegen. */

export type LangGraphPendingRework = {
  currentNodeId: string;
  predecessorNodeIds: string[];
  reworkReason: string;
  mentionedRoleIds: string[];
};

export type LangGraphUserInterventionRequest = {
  nodeId: string;
  request: string;
};

export type LangGraphInterruptPayload = {
  type: 'user_intervention';
  nodeId: string;
  activeNodeId: string;
};
