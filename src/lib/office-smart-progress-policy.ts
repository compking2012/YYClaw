import { isRoomFastAckText } from '@/lib/office-room-fast-ack';
import {
  isSmartWorkOrderStepDoneInRoom,
  type SmartWorkOrderStep,
} from '@/lib/office-smart-work-order';
import type { RoomMessage } from '@/types/office';

import { SMART_ASSIGN_DISPATCH_NUDGE_AFTER_MS } from '@/lib/office-smart-mention-stall';

/** 引擎【推进】催办：首次 kickoff 等待上限，与任意两次催办之间的最小间隔（统一 5 分钟）。 */
export const SMART_ENGINE_NUDGE_INTERVAL_MS = 300_000;

/** @deprecated 使用 {@link SMART_ENGINE_NUDGE_INTERVAL_MS} */
export const SMART_KICKOFF_COORDINATOR_DEADLINE_MS = SMART_ENGINE_NUDGE_INTERVAL_MS;

/** 推进器轮询间隔。 */
export const SMART_PROGRESS_POLL_MS = 30_000;

/** 群聊无团队实质活动后触发停滞催办（与 kickoff / 催办间隔统一 5 分钟）。 */
export const SMART_STALL_NUDGE_AFTER_MS = SMART_ENGINE_NUDGE_INTERVAL_MS;

/** 任意【引擎·推进】消息之间的最小间隔。 */
export const SMART_NUDGE_COOLDOWN_MS = SMART_ENGINE_NUDGE_INTERVAL_MS;

export type SmartProgressNudgeKind =
  | 'kickoff_coordinator'
  | 'stall_coordinator'
  | 'stall_next_executor'
  | 'ready_to_complete'
  | 'assign_dispatch_failed';

export type SmartProgressNudgePlan = {
  kind: SmartProgressNudgeKind;
  targetRoleId: string;
  roomLine: string;
};

const ENGINE_PREFIX = '【引擎·推进】';

/** 推进文案中的已耗时（秒/分），基于实际停滞时长而非触发阈值。 */
export function formatSmartProgressElapsedMs(elapsedMs: number): string {
  const totalSec = Math.max(1, Math.round(elapsedMs / 1000));
  if (totalSec < 60) return `${totalSec} 秒`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (sec === 0) return `${min} 分钟`;
  return `${min} 分 ${sec} 秒`;
}

export function resolveSmartStallElapsedMs(params: {
  nowMs: number;
  taskStartedAt: number;
  lastTeamActivityAt: number;
}): number {
  if (params.lastTeamActivityAt > 0) {
    return Math.max(0, params.nowMs - params.lastTeamActivityAt);
  }
  return Math.max(0, params.nowMs - params.taskStartedAt);
}

export function smartRoomLastTeamActivityAt(
  roomMessages: RoomMessage[],
  taskId: string,
  teamRoleIds: Set<string>,
): number {
  let last = 0;
  for (const m of roomMessages) {
    if (m.projectId && m.projectId !== taskId) continue;
    if (m.from === 'system') continue;
    if (!m.fromAgentId || !teamRoleIds.has(m.fromAgentId)) continue;
    const text = (m.progressText ?? m.content ?? '').trim();
    if (text.length < 4) continue;
    if (isRoomFastAckText(text)) continue;
    if (m.timestamp > last) last = m.timestamp;
  }
  return last;
}

export function smartCoordinatorRepliedSubstantivelySince(
  roomMessages: RoomMessage[],
  taskId: string,
  coordinatorRoleId: string,
  sinceTimestamp: number,
): boolean {
  for (const m of roomMessages) {
    if (m.projectId && m.projectId !== taskId) continue;
    if (m.fromAgentId !== coordinatorRoleId) continue;
    if (m.timestamp <= sinceTimestamp) continue;
    const text = (m.progressText ?? m.content ?? '').trim();
    if (text.length < 8) continue;
    if (isRoomFastAckText(text)) continue;
    if (/^(?:收到|OK|好的)[。.!！]?$/iu.test(text)) continue;
    return true;
  }
  return false;
}

/** 工作顺序中每个步骤是否均已 smartMemberEnd 完成（不认群聊 **已完成** 标记）。 */
export function smartAllWorkOrderStepsDoneInRoom(
  steps: SmartWorkOrderStep[],
  roomMessages: RoomMessage[],
  taskId: string,
): boolean {
  if (steps.length === 0) return false;
  for (const step of steps) {
    if (!isSmartWorkOrderStepDoneInRoom(step, roomMessages, taskId)) return false;
  }
  return true;
}

export function buildSmartProgressNudgeLine(params: {
  kind: SmartProgressNudgeKind;
  targetRoleName: string;
  nextExecutorName?: string | null;
  /** 本条催办对应的实际已耗时（非触发阈值）。 */
  elapsedMs: number;
  assignErrorDetail?: string | null;
}): string {
  const at = `@${params.targetRoleName.trim() || '协调者'}`;
  const elapsed = formatSmartProgressElapsedMs(params.elapsedMs);
  switch (params.kind) {
    case 'kickoff_coordinator':
      return `${ENGINE_PREFIX} 任务已启动超过 ${elapsed}，尚未见协调者首轮分工。请 ${at} 根据任务说明拆解子任务，并在【分工】中 @ 工作顺序中的下一执行者。`;
    case 'stall_coordinator': {
      const nextHint = params.nextExecutorName?.trim()
        ? `（工作顺序下一跳：${params.nextExecutorName}，由你在【分工】中 @ 指派，引擎不直接点名成员）`
        : '';
      return `${ENGINE_PREFIX} 项目群聊已超过 ${elapsed} 无团队实质进展。请 ${at} 根据【工作顺序】验收上一跳或在【分工】中 @ 下一执行者继续推进${nextHint}。`;
    }
    case 'stall_next_executor':
      // 已废弃：停滞催办统一由协调者接力，不直接 @ 成员（保留 kind 供历史 cooldown 键兼容）。
      return buildSmartProgressNudgeLine({
        kind: 'stall_coordinator',
        targetRoleName: params.targetRoleName,
        nextExecutorName: params.nextExecutorName,
        elapsedMs: params.elapsedMs,
      });
    case 'ready_to_complete':
      return `${ENGINE_PREFIX} 全部子任务已在群内 action=end（smartMemberEnd）且关键交付路径已通过引擎验盘。请 ${at} 判断若可结项，则将 JSON action 设为 "end"（dispatch=[]）。`;
    case 'assign_dispatch_failed':
      return `${ENGINE_PREFIX} 协调者 assign 后成员派活未成功（${params.elapsedMs > 0 ? `已等待 ${formatSmartProgressElapsedMs(params.elapsedMs)}，` : ''}原因：${params.assignErrorDetail ?? '未知'}）。请 ${at} 检查 JSON dispatch 中的 role 是否与团队成员显示名一致后重新 assign。`;
    default:
      return `${ENGINE_PREFIX} 请 ${at} 继续推进本项目。`;
  }
}

export function planSmartProgressNudge(params: {
  nowMs: number;
  taskStartedAt: number;
  lastTeamActivityAt: number;
  /** 上一次任意引擎催办发出时间（全局间隔，不按 kind 分开）。 */
  lastNudgeAtMs: number | null;
  /** @deprecated 仅测试兼容；优先 {@link lastNudgeAtMs} */
  lastNudgeAtByKind?: Partial<Record<SmartProgressNudgeKind, number>>;
  coordinatorAgentId?: string;
  coordinatorRoleId?: string;
  coordinatorHasDecomposed: boolean;
  nextExecutorRoleId: string | null;
  /** 本阶段并行执行者（用于催办文案） */
  nextExecutorRoleIds?: string[];
  allStepsDoneInRoom: boolean;
  deliverablePathsVerified: boolean;
  coordinatorRepliedSinceKickoff: boolean;
  teamRoles: Array<{ id?: string; name?: string; agentId?: string; displayName?: string }>;
  /** 群聊已有协调者 `end==="true"` 结项时不再发【引擎·推进】。 */
  coordinatorClosureInRoom?: boolean;
  smartAssignDispatchError?: string | null;
  smartAssignDispatchErrorAt?: number | null;
}): SmartProgressNudgePlan | null {
  if (params.coordinatorClosureInRoom) return null;

  const legacyLast =
    params.lastNudgeAtByKind && Object.keys(params.lastNudgeAtByKind).length > 0
      ? Math.max(
          ...Object.values(params.lastNudgeAtByKind).filter((t) => typeof t === 'number'),
        )
      : null;
  const resolvedLastNudge = params.lastNudgeAtMs ?? legacyLast;
  const nudgeCooldownOk = () =>
    resolvedLastNudge == null
    || resolvedLastNudge <= 0
    || params.nowMs - resolvedLastNudge >= SMART_NUDGE_COOLDOWN_MS;

  const coordId = (params.coordinatorAgentId ?? params.coordinatorRoleId)?.trim();
  const coord = params.teamRoles.find(
    (r) => (r.agentId ?? r.id ?? '').trim() === coordId,
  );
  if (!coord) return null;
  const coordLabel = (coord.displayName ?? coord.name ?? coord.agentId ?? '协调者').trim();
  const coordTargetId = (coord.agentId ?? coord.id ?? coordId ?? '').trim();
  if (!coordTargetId) return null;

  const kickoffElapsedMs = Math.max(0, params.nowMs - params.taskStartedAt);
  const stallElapsedMs = resolveSmartStallElapsedMs({
    nowMs: params.nowMs,
    taskStartedAt: params.taskStartedAt,
    lastTeamActivityAt: params.lastTeamActivityAt,
  });

  const memberLabel = (id: string): string => {
    const hit = params.teamRoles.find((r) => (r.agentId ?? r.id) === id);
    return (hit?.displayName ?? hit?.name ?? id).trim() || id;
  };

  if (!params.coordinatorRepliedSinceKickoff) {
    if (
      kickoffElapsedMs >= SMART_KICKOFF_COORDINATOR_DEADLINE_MS
      && nudgeCooldownOk()
    ) {
      return {
        kind: 'kickoff_coordinator',
        targetRoleId: coordTargetId,
        roomLine: buildSmartProgressNudgeLine({
          kind: 'kickoff_coordinator',
          targetRoleName: coordLabel,
          elapsedMs: kickoffElapsedMs,
        }),
      };
    }
    return null;
  }

  const assignErr = params.smartAssignDispatchError?.trim();
  const assignErrAt = params.smartAssignDispatchErrorAt ?? 0;
  if (
    assignErr
    && assignErrAt > 0
    && params.nowMs - assignErrAt >= SMART_ASSIGN_DISPATCH_NUDGE_AFTER_MS
    && nudgeCooldownOk()
  ) {
    return {
      kind: 'assign_dispatch_failed',
      targetRoleId: coordTargetId,
      roomLine: buildSmartProgressNudgeLine({
        kind: 'assign_dispatch_failed',
        targetRoleName: coordLabel,
        elapsedMs: params.nowMs - assignErrAt,
        assignErrorDetail: assignErr,
      }),
    };
  }

  if (
    params.allStepsDoneInRoom
    && params.deliverablePathsVerified
    && nudgeCooldownOk()
  ) {
    return {
      kind: 'ready_to_complete',
      targetRoleId: coordTargetId,
      roomLine: buildSmartProgressNudgeLine({
        kind: 'ready_to_complete',
        targetRoleName: coordLabel,
        elapsedMs: stallElapsedMs,
      }),
    };
  }

  const stalled =
    params.lastTeamActivityAt > 0
      ? params.nowMs - params.lastTeamActivityAt >= SMART_STALL_NUDGE_AFTER_MS
      : params.nowMs - params.taskStartedAt >= SMART_STALL_NUDGE_AFTER_MS;
  if (!stalled) return null;

  const resolveNextExecutorLabel = (): string | null => {
    const nextIds = [
      ...(params.nextExecutorRoleIds ?? []),
      ...(params.nextExecutorRoleId ? [params.nextExecutorRoleId] : []),
    ].filter(Boolean);
    const uniqueNext = [...new Set(nextIds)];
    if (uniqueNext.length === 0) return null;
    if (uniqueNext.length === 1) {
      return memberLabel(uniqueNext[0]!);
    }
    return uniqueNext.map((id) => memberLabel(id)).join('、');
  };

  if (!params.coordinatorHasDecomposed && nudgeCooldownOk()) {
    return {
      kind: 'stall_coordinator',
      targetRoleId: coordTargetId,
      roomLine: buildSmartProgressNudgeLine({
        kind: 'stall_coordinator',
        targetRoleName: coordLabel,
        nextExecutorName: resolveNextExecutorLabel(),
        elapsedMs: stallElapsedMs,
      }),
    };
  }

  if (nudgeCooldownOk()) {
    const nextName = resolveNextExecutorLabel();
    return {
      kind: 'stall_coordinator',
      targetRoleId: coordTargetId,
      roomLine: buildSmartProgressNudgeLine({
        kind: 'stall_coordinator',
        targetRoleName: coordLabel,
        nextExecutorName: nextName,
        elapsedMs: stallElapsedMs,
      }),
    };
  }

  return null;
}
