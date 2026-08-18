import {
  workflowNodeIsMultiRole,
  workflowNodePrimaryRoleId,
  workflowNodeRoleIds,
} from '@/lib/office-workflow-node';
import { roomMessageAppliesToNode } from '@/lib/task-room-progress-reconcile';
import {
  canonicalWorkflowJsonFingerprint,
  parseWorkflowJsonOutput,
  type WorkflowJsonOutput,
} from '@/lib/office-workflow-json-schema';
import type { ProjectAgentRef } from '@/lib/office-workflow-node';
import type { NodeRunRecord, RoomMessage, WorkflowNode } from '@/types/office';
import { agentIdsMatch, roomMessageFromAgentId } from '@/lib/office-agent-id-resolve';

/** 群聊 JSON 内容连续不变多久后才允许进入「结构化校验」阶段（毫秒）。主循环空闲兜底用。 */
export const WORKFLOW_ROOM_JSON_HEAL_STABLE_MS = 5 * 60_000;

/** Session 收稿失败后的群聊自愈稳定窗口（兜底，非主路径）。 */
export const WORKFLOW_ROOM_JSON_HEAL_FALLBACK_STABLE_MS = 180_000;

/**
 * 收稿辅助路径：完整校验通过后，同一 JSON 指纹须再连续不变多久才可交付（毫秒）。
 * 业务规则：先结构化/落盘校验通过 → 开表 → 指纹不变满本窗口 → 应用前再验一次 ≈ 终稿。
 * 主路径仍为 Session Model B 收稿闸门；本常量仅用于辅助路径（room_heal）。
 */
export const WORKFLOW_ROOM_JSON_HEAL_AUXILIARY_STABLE_MS = 120_000;

/** @deprecated 使用 {@link WORKFLOW_ROOM_JSON_HEAL_AUXILIARY_STABLE_MS} */
export const WORKFLOW_ROOM_JSON_HEAL_SESSION_WAIT_STABLE_MS = WORKFLOW_ROOM_JSON_HEAL_AUXILIARY_STABLE_MS;

/** @deprecated 使用 {@link WORKFLOW_ROOM_JSON_HEAL_FALLBACK_STABLE_MS} */
export const WORKFLOW_ROOM_JSON_HEAL_ACTIVE_BATCH_STABLE_MS = WORKFLOW_ROOM_JSON_HEAL_FALLBACK_STABLE_MS;

/** 群聊/Session 自愈：Workflow JSON 是否表达「步骤完成」语义（非 Smart `action:end`）。 */
export function isWorkflowJsonCompletionEvidence(json: WorkflowJsonOutput): boolean {
  const conclusion = (json.deliverable?.conclusion ?? '').trim();
  if (conclusion.length > 0) return true;
  const execution = (json.execution ?? '').trim();
  return execution.length >= 4;
}

/** 收稿阶段：已从群聊提取、可用于指纹计时的 JSON 快照。 */
export type WorkflowRoomJsonReceipt = {
  raw: string;
  json: WorkflowJsonOutput;
  fingerprint: string;
  roleId: string;
};

const ROOM_JSON_RECEIPT_PHASES = new Set<RoomMessage['phase']>(['task_running']);

function messageText(m: RoomMessage): string {
  return (m.progressText ?? m.content ?? '').trim();
}

export type ExtractWorkflowRoomJsonReceiptOptions = {
  /**
   * Ignore room messages with `timestamp < minTimestampMs`.
   * Used by session-wait auxiliary heal so prior-run progressText JSON cannot be reapplied.
   */
  minTimestampMs?: number;
};

/** True when the room message is at/after the current attempt floor (if any). */
export function isRoomMessageAtOrAfterHealFloor(
  message: Pick<RoomMessage, 'timestamp'>,
  minTimestampMs: number | undefined,
): boolean {
  if (minTimestampMs == null || !Number.isFinite(minTimestampMs) || minTimestampMs <= 0) {
    return true;
  }
  return Number(message.timestamp) >= minTimestampMs;
}

/**
 * 收稿（第 1 步）：仅要求可解析 schema + 群聊角色匹配，不做业务/回滚/结论等严格校验。
 */
export function extractWorkflowRoomJsonReceipt(
  taskRoom: RoomMessage[],
  node: WorkflowNode,
  workflowNodes: WorkflowNode[],
  role: Pick<ProjectAgentRef, 'agentId' | 'displayName'>,
  opts?: ExtractWorkflowRoomJsonReceiptOptions,
): WorkflowRoomJsonReceipt | null {
  if (workflowNodeIsMultiRole(node)) return null;

  let best: { raw: string; len: number; json: WorkflowJsonOutput } | null = null;

  for (const m of taskRoom) {
    if (!isRoomMessageAtOrAfterHealFloor(m, opts?.minTimestampMs)) continue;
    if (!roomMessageAppliesToNode(m, node, workflowNodes)) continue;
    if (!m.phase || !ROOM_JSON_RECEIPT_PHASES.has(m.phase)) continue;
    const fromId = roomMessageFromAgentId(m);
    if (fromId && !agentIdsMatch([role], fromId, role.agentId)) continue;

    const text = messageText(m);
    if (!text) continue;
    const json = parseWorkflowJsonOutput(text);
    if (!json) continue;
    const roleName = (
      role.displayName
      ?? (role as { name?: string }).name
      ?? ''
    ).trim();
    if (roleName && json.role.trim() !== roleName) continue;

    if (!best || text.length > best.len) {
      best = { raw: text, len: text.length, json };
    }
  }

  if (!best) return null;
  return {
    raw: best.raw,
    json: best.json,
    fingerprint: canonicalWorkflowJsonFingerprint(best.json),
    roleId: role.agentId,
  };
}

/** 收稿计时：指纹变化则重置 stableSince。 */
export function tickWorkflowRoomJsonReceipt(
  run: NodeRunRecord,
  receipt: WorkflowRoomJsonReceipt | null,
  nowMs: number,
): NodeRunRecord {
  if (!receipt) {
    if (!run.roomHealJsonFingerprint && !run.roomHealJsonStableSinceMs) return run;
    return {
      ...run,
      roomHealJsonFingerprint: undefined,
      roomHealJsonStableSinceMs: undefined,
      roomHealValidatedFingerprint: undefined,
    };
  }

  if (run.roomHealJsonFingerprint !== receipt.fingerprint) {
    return {
      ...run,
      roomHealJsonFingerprint: receipt.fingerprint,
      roomHealJsonStableSinceMs: nowMs,
      roomHealValidatedFingerprint: undefined,
    };
  }

  if (!run.roomHealJsonStableSinceMs) {
    return { ...run, roomHealJsonStableSinceMs: nowMs };
  }
  return run;
}

/** 收稿是否已满稳定窗口（第 1 步通过）。 */
export function isWorkflowRoomJsonReceiptReady(
  run: NodeRunRecord,
  nowMs: number,
  stableMs: number = WORKFLOW_ROOM_JSON_HEAL_STABLE_MS,
): boolean {
  if (run.status !== 'running') return false;
  if (!run.roomHealJsonFingerprint || run.roomHealJsonStableSinceMs == null) return false;
  return nowMs - run.roomHealJsonStableSinceMs >= stableMs;
}

/**
 * 辅助路径：完整校验刚通过时写入 fingerprint + 开表时刻。
 * `validatedAtMs` 必须是校验完成当下的墙钟时间（不可用 sync 开头的 nowMs，否则 await 落盘会缩短 120s 窗）。
 */
export function stampAuxiliaryRoomHealValidationSuccess(
  run: NodeRunRecord,
  fingerprint: string,
  validatedAtMs: number,
): NodeRunRecord {
  return {
    ...run,
    roomHealJsonFingerprint: fingerprint,
    roomHealValidatedFingerprint: fingerprint,
    roomHealJsonStableSinceMs: validatedAtMs,
    roomHealValidationFailFingerprint: undefined,
  };
}

/** 辅助路径：校验通过后的指纹须再连续不变满稳定窗，才允许进入应用再验。 */
export function isAuxiliaryValidatedJsonStableForHeal(
  run: NodeRunRecord,
  nowMs: number,
  stableMs: number = WORKFLOW_ROOM_JSON_HEAL_AUXILIARY_STABLE_MS,
): boolean {
  if (run.status !== 'running') return false;
  const fp = run.roomHealValidatedFingerprint?.trim();
  if (!fp || fp !== run.roomHealJsonFingerprint) return false;
  if (run.roomHealJsonStableSinceMs == null) return false;
  return nowMs - run.roomHealJsonStableSinceMs >= stableMs;
}

export function workflowRoomJsonHealRoleForNode(
  node: WorkflowNode,
  run: NodeRunRecord,
  roles: Pick<ProjectAgentRef, 'agentId' | 'displayName'>[],
): Pick<ProjectAgentRef, 'agentId' | 'displayName'> | null {
  const legacyRoleId = (run as NodeRunRecord & { roleId?: string }).roleId?.trim();
  const roleId = run.agentId?.trim() || legacyRoleId || workflowNodePrimaryRoleId(node);
  const role = roles.find((r) => r.agentId === roleId);
  if (role) return role;
  const assigned = workflowNodeRoleIds(node);
  if (assigned.length === 1) {
    return roles.find((r) => r.agentId === assigned[0]!) ?? null;
  }
  return null;
}

/** @deprecated 使用 {@link extractWorkflowRoomJsonReceipt} */
export const extractWorkflowRoomJsonHealCandidate = extractWorkflowRoomJsonReceipt;

/** @deprecated 使用 {@link tickWorkflowRoomJsonReceipt} */
export const tickWorkflowRoomJsonHealStability = tickWorkflowRoomJsonReceipt;

/** @deprecated 使用 {@link isWorkflowRoomJsonReceiptReady} */
export const isWorkflowRoomJsonStableForHeal = isWorkflowRoomJsonReceiptReady;
