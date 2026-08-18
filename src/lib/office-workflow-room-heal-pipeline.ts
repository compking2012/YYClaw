import { isWorkflowDeliverableConclusionFailure } from '@/lib/office-workflow-edge-outcome';
import { isWorkflowReviewLikeStepTitle } from '@/lib/office-workflow-deliverable-conclusion';
import { isWorkflowInputValidationFailure } from '@/lib/office-workflow-input-validation';
import {
  evaluateWorkflowRollback,
  parseWorkflowRollbackTrigger,
  type WorkflowRollbackDecision,
} from '@/lib/office-workflow-rollback';
import type { WorkflowJsonOutput } from '@/lib/office-workflow-json-schema';
import type { NodeRunRecord, WorkflowEdge, WorkflowNode } from '@/types/office';
import type { OfficeRole } from '@/types/office';

export type WorkflowRoomHealRunnerIntent =
  | {
      kind: 'complete';
      edgeOutcome: 'success' | 'failure';
      summary: string;
    }
  | {
      kind: 'rollback';
      decision: WorkflowRollbackDecision;
      summary: string;
      roleId: string;
    };

function formatInputValidation(json: WorkflowJsonOutput): string {
  const { targets, lsResult } = json.inputValidation;
  const lsBody =
    targets.length > 0
      ? targets.map((t, i) => `${t}：${lsResult[i] ?? ''}`).join('\n')
      : '无';
  return [
    targets.length > 0 ? `目标：${targets.join('、')}` : '目标：无',
    `ls：${lsBody}`,
  ].join('\n');
}

function jsonImpliesFailureOutcome(json: WorkflowJsonOutput): boolean {
  return isWorkflowDeliverableConclusionFailure(json.deliverable.conclusion);
}

/** 校验通过后：决定 completed / failure / 回滚（不在此步做磁盘校验）。 */
export function planWorkflowRoomHealRunnerIntent(
  json: WorkflowJsonOutput,
  raw: string,
  node: WorkflowNode,
  workflowNodes: WorkflowNode[],
  roleId: string,
  edges: WorkflowEdge[],
  teamRoles: Pick<OfficeRole, 'id' | 'name' | 'agentId'>[],
): WorkflowRoomHealRunnerIntent | null {
  const inputFail = isWorkflowInputValidationFailure(formatInputValidation(json));
  const acceptanceFail =
    isWorkflowReviewLikeStepTitle(json.step.title) && json.deliverable.conclusion === '不通过';
  const rollbackTrigger = parseWorkflowRollbackTrigger(json.rollback);
  if ((inputFail || acceptanceFail) && !rollbackTrigger) {
    return null;
  }

  const summary = raw.slice(0, 2000);
  if (rollbackTrigger) {
    const decision = evaluateWorkflowRollback({
      rollbackExplanation: json.rollback,
      currentNodeId: node.id,
      nodes: workflowNodes,
      edges,
      teamRoles,
    });
    if (decision.rollback) {
      return { kind: 'rollback', decision, summary, roleId };
    }
  }

  return {
    kind: 'complete',
    edgeOutcome: jsonImpliesFailureOutcome(json) ? 'failure' : 'success',
    summary,
  };
}

export function applyWorkflowRoomHealRunnerIntent(
  run: NodeRunRecord,
  intent: WorkflowRoomHealRunnerIntent,
  nowMs: number = Date.now(),
): NodeRunRecord {
  const cleared = {
    roomHealJsonFingerprint: undefined,
    roomHealJsonStableSinceMs: undefined,
    roomHealValidatedFingerprint: undefined,
  };

  if (intent.kind === 'rollback') {
    return {
      ...run,
      ...cleared,
      status: 'pending',
      edgeOutcome: undefined,
      error:
        intent.decision.reason.slice(0, 500) || '【回滚说明】群聊自愈检测到回滚信号',
      summary: intent.summary,
      completedAt: undefined,
    };
  }

  return {
    ...run,
    ...cleared,
    status: 'completed',
    edgeOutcome: intent.edgeOutcome,
    completedAt: run.completedAt ?? nowMs,
    summary: intent.summary,
    error: undefined,
  };
}
