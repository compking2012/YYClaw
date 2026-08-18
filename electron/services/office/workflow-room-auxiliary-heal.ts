/**
 * Workflow 收稿辅助路径：先完整校验 → 指纹稳定 120s → 应用前再验 ≈ 终稿。
 * 主路径仍为 Session Model B 收稿闸门（run.ended / sessions.list idle → settle）。
 */
import {
  parseWorkflowJsonOutput,
} from '../../../src/lib/office-workflow-json-schema';
import {
  isWorkflowJsonCompletionEvidence,
  WORKFLOW_ROOM_JSON_HEAL_AUXILIARY_STABLE_MS,
} from '../../../src/lib/office-workflow-room-json-heal';
import type { WorkflowRoomHealPendingValidation } from '../../../src/lib/office-workflow-run-heal';
import { isSubstantiveWorkflowProgressSnippet } from './room-mention-reply-policy';

/** 辅助路径轮询间隔（Session 主路径等待期间并行扫描群聊；同指纹失败可按此节奏重试）。 */
export const WORKFLOW_ROOM_AUXILIARY_HEAL_POLL_MS = 20_000;

export { WORKFLOW_ROOM_JSON_HEAL_AUXILIARY_STABLE_MS };

/** 流式镜像：优先把含完成语义的 Workflow JSON 写入群聊 progressText。 */
export function workflowRoomMirrorSnippetForProgress(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const snippet = trimmed.length > 4_000 ? trimmed.slice(-4_000) : trimmed;
  const json = parseWorkflowJsonOutput(snippet);
  if (json && isWorkflowJsonCompletionEvidence(json)) return snippet;
  if (isSubstantiveWorkflowProgressSnippet(snippet)) return snippet;
  return null;
}

export type WorkflowRoomAuxiliaryHealContext = {
  sessionKey: string;
  sessionStartedAtMs: number;
};

/**
 * 辅助路径准入：仅过滤无完成语义的 JSON。
 * 稳定窗在完整校验通过后才计时；不依赖 Gateway lifecycle / sessions.list idle。
 */
export function filterAuxiliaryRoomHealCandidates(
  pending: WorkflowRoomHealPendingValidation[],
): WorkflowRoomHealPendingValidation[] {
  return pending.filter((item) => isWorkflowJsonCompletionEvidence(item.receipt.json));
}
