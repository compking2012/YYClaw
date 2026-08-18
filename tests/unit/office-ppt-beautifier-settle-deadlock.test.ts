/**
 * PPT美化师（gen-2 / 共享 workflowRunId）收稿路径 UT。
 *
 * 1. 主路径 Model B：settle 使用 bare run tail 匹配 Gateway lifecycle；
 *    sessions.list 若 hasActiveRun 长期为 true 仍可能超时。
 * 2. 辅路径 room_heal：先完整校验通过 → 指纹再稳定 120s → 应用前再验（不与 Session 指纹比对；失败不 abort 主路径）。
 * 3. 主路径卡住时，辅路径仍可开门；超时恢复仍依赖 idle 闸门。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GatewayManager } from '../../electron/gateway/manager';
import { fetchChatHistory, fetchGatewaySessionListRow } from '../../electron/services/office/gateway-rpc';
import { gatewayEventMatchesRun, waitForSessionReply } from '../../electron/services/office/run-completion';
import {
  applyOfficeRunRuntimeEvent,
  createOfficeRunTracker,
  isOfficeRunProtocolDischarged,
} from '../../electron/services/office/session-run-settle';
import { tryRecoverWorkflowSessionStructuredReply } from '../../electron/services/office/workflow-agent-llm';
import { filterAuxiliaryRoomHealCandidates } from '../../electron/services/office/workflow-room-auxiliary-heal';
import {
  officeWorkflowNodeDispatchRunId,
  resolveWorkflowSettleRunId,
} from '@/lib/office-workflow-dispatch-run';
import {
  canonicalWorkflowJsonFingerprint,
  parseWorkflowJsonOutput,
} from '@/lib/office-workflow-json-schema';
import {
  collectAuxiliaryRoomHealPendingValidation,
} from '@/lib/office-workflow-run-heal';
import {
  extractWorkflowRoomJsonReceipt,
  WORKFLOW_ROOM_JSON_HEAL_AUXILIARY_STABLE_MS,
} from '@/lib/office-workflow-room-json-heal';
import type { NodeRunRecord, RoomMessage, WorkflowNode } from '@/types/office';
import type { WorkflowRoomHealPendingValidation } from '@/lib/office-workflow-run-heal';

vi.mock('../../electron/services/office/gateway-rpc', () => ({
  fetchChatHistory: vi.fn(),
  fetchGatewaySessionListRow: vi.fn(),
  invalidateGatewaySessionListRowCache: vi.fn(),
}));

const TASK_ID = 'project-1783334065252-zgya8y';
const SHARED_BARE_RUN = 'run-1783345495879';
const NODE_ID = 'gen-2';
const DISPATCH_RUN_ID = officeWorkflowNodeDispatchRunId(SHARED_BARE_RUN, NODE_ID, TASK_ID);
const SETTLE_RUN_ID = resolveWorkflowSettleRunId(SHARED_BARE_RUN, DISPATCH_RUN_ID)!;
const SESSION = `agent:ppt-mei-hua-shi:office:task:${TASK_ID}:role:ppt-mei-hua-shi:node:${NODE_ID}:${SHARED_BARE_RUN}`;
const ROLE = { agentId: 'ppt-mei-hua-shi', displayName: 'PPT美化师' };
const startedAt = 1783345500_000;

const PPT_SESSION_FINAL = JSON.stringify({
  role: 'PPT美化师',
  step: { index: 3, total: 4, title: 'PPT制作' },
  inputValidation: { targets: ['交付物-数据抓取师/report.md'], lsResult: ['ok'] },
  execution: '已完成 PPT 美化与版式统一，输出最终演示稿。',
  outputValidation: {
    targets: ['交付物-PPT美化师/美化后的PPT报告-PPT美化师.pptx'],
    lsResult: ['-rw-r--r-- 1 u staff 567506 交付物-PPT美化师/美化后的PPT报告-PPT美化师.pptx'],
  },
  deliverable: {
    path: '交付物-PPT美化师/美化后的PPT报告-PPT美化师.pptx',
    summary: 'PPT 已美化交付。',
    conclusion: '已交付',
  },
  usage: '打开 pptx 即可演示。',
  rollback: '无',
});

const PPT_ROOM_MIRROR = JSON.stringify({
  role: 'PPT美化师',
  step: { index: 3, total: 4, title: 'PPT制作' },
  inputValidation: { targets: ['交付物-数据抓取师/report.md'], lsResult: ['ok'] },
  execution: '完成 PPT 美化。',
  outputValidation: {
    targets: ['交付物-PPT美化师/美化后的PPT报告-PPT美化师.pptx'],
    lsResult: ['-rw-r--r-- 1 u staff 567506 交付物-PPT美化师/美化后的PPT报告-PPT美化师.pptx'],
  },
  deliverable: {
    path: '交付物-PPT美化师/美化后的PPT报告-PPT美化师.pptx',
    summary: 'ok',
    conclusion: '已交付',
  },
  usage: '打开 pptx 即可演示。',
  rollback: '无',
});

const PPT_NODE: WorkflowNode = {
  id: NODE_ID,
  title: 'PPT制作',
  agentIds: ['ppt-mei-hua-shi'],
};

type Listener = (data: unknown) => void;

function createEmitterGateway(): GatewayManager & {
  emitAgentNotification: (params: Record<string, unknown>) => void;
} {
  const listeners = new Map<string, Set<Listener>>();
  return {
    on(event: string, fn: Listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
    },
    off(event: string, fn: Listener) {
      listeners.get(event)?.delete(fn);
    },
    emitAgentNotification(params: Record<string, unknown>) {
      const payload = { method: 'agent', params };
      for (const fn of listeners.get('notification') ?? []) fn(payload);
    },
  } as GatewayManager & { emitAgentNotification: (params: Record<string, unknown>) => void };
}

function roomMessage(text: string, timestamp: number): RoomMessage {
  return {
    id: `m-${timestamp}`,
    projectId: TASK_ID,
    fromAgentId: ROLE.agentId,
    content: '',
    progressText: text,
    phase: 'task_running',
    timestamp,
    nodeId: NODE_ID,
  };
}

function runningNodeRun(stableSinceMs: number, fingerprint: string): NodeRunRecord {
  return {
    nodeId: NODE_ID,
    agentId: ROLE.agentId,
    status: 'running',
    startedAt: startedAt,
    roomHealJsonFingerprint: fingerprint,
    roomHealJsonStableSinceMs: stableSinceMs,
  };
}

function pptRoomPending(): WorkflowRoomHealPendingValidation {
  const roomJson = parseWorkflowJsonOutput(PPT_ROOM_MIRROR)!;
  const roomFp = canonicalWorkflowJsonFingerprint(roomJson);
  return {
    nodeId: NODE_ID,
    roleId: ROLE.agentId,
    receipt: {
      raw: PPT_ROOM_MIRROR,
      json: roomJson,
      fingerprint: roomFp,
      roleId: ROLE.agentId,
    },
  };
}

describe('PPT美化师 settle paths (gen-2 shared workflowRunId)', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('resolveWorkflowSettleRunId maps node-scoped dispatch to scoped settle id', () => {
    expect(DISPATCH_RUN_ID).toBe(`${SHARED_BARE_RUN}@gen-2`);
    expect(SETTLE_RUN_ID).toBe(DISPATCH_RUN_ID);
    expect(resolveWorkflowSettleRunId(SHARED_BARE_RUN, DISPATCH_RUN_ID)).toBe(DISPATCH_RUN_ID);
  });

  it('gateway bare and scoped lifecycle match scoped settle run id', () => {
    expect(gatewayEventMatchesRun(SETTLE_RUN_ID, SHARED_BARE_RUN)).toBe(true);
    expect(gatewayEventMatchesRun(SETTLE_RUN_ID, `${SHARED_BARE_RUN}@gen-0`)).toBe(false);
    expect(gatewayEventMatchesRun(SETTLE_RUN_ID, DISPATCH_RUN_ID)).toBe(true);
  });

  it('bare run.ended opens settle gate (tracker) for PPT gen-2', () => {
    const tracker = createOfficeRunTracker(SETTLE_RUN_ID);
    applyOfficeRunRuntimeEvent(tracker, {
      type: 'run.ended',
      runId: SHARED_BARE_RUN,
      status: 'completed',
      lifecyclePhase: 'end',
      stopReason: 'stop',
    });
    expect(isOfficeRunProtocolDischarged(tracker)).toBe(true);
  });

  it('主路径：bare run.ended 可匹配；hasActiveRun 仍为 true 时 wait 仍可能超时', async () => {
    vi.useFakeTimers();
    vi.mocked(fetchChatHistory).mockResolvedValue({
      messages: [
        { role: 'user', content: 'go', timestamp: startedAt + 1 },
        { role: 'assistant', content: PPT_SESSION_FINAL, timestamp: startedAt + 400_000 },
      ],
    });
    vi.mocked(fetchGatewaySessionListRow).mockResolvedValue({
      key: SESSION,
      hasActiveRun: true,
      status: 'running',
      updatedAt: startedAt + 400_000,
    });

    const gateway = createEmitterGateway();
    const promise = waitForSessionReply(gateway, {
      sessionKey: SESSION,
      startedAtMs: startedAt,
      runId: SETTLE_RUN_ID,
      timeoutMs: 5_000,
      pollIntervalMs: 1_000,
      requireWorkflowStructuredReply: true,
      requireFreshUserTurn: true,
      minWaitBeforeAcceptMs: 0,
    });

    gateway.emitAgentNotification({
      runId: SHARED_BARE_RUN,
      sessionKey: SESSION,
      stream: 'lifecycle',
      data: { phase: 'end', stopReason: 'stop' },
    });

    await vi.advanceTimersByTimeAsync(6_000);
    const result = await promise;

    expect(result.completed).toBe(false);
    expect(result.timedOut).toBe(true);

    const tracker = createOfficeRunTracker(SETTLE_RUN_ID);
    applyOfficeRunRuntimeEvent(tracker, {
      type: 'run.ended',
      runId: SHARED_BARE_RUN,
      status: 'completed',
      lifecyclePhase: 'end',
      stopReason: 'stop',
    });
    expect(isOfficeRunProtocolDischarged(tracker)).toBe(true);
  });

  it('辅路径：Session 与群聊指纹不同仍可通过 filter（不与 Session 比对）', () => {
    const sessionFp = canonicalWorkflowJsonFingerprint(parseWorkflowJsonOutput(PPT_SESSION_FINAL)!);
    const roomFp = canonicalWorkflowJsonFingerprint(parseWorkflowJsonOutput(PPT_ROOM_MIRROR)!);
    expect(sessionFp).not.toBe(roomFp);

    const filtered = filterAuxiliaryRoomHealCandidates([pptRoomPending()]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.receipt.fingerprint).toBe(roomFp);
  });

  it('辅路径：群聊完成语义 JSON 无需先满稳定窗即可进入待校验收集', () => {
    const now = startedAt + 500_000;
    const roomJson = parseWorkflowJsonOutput(PPT_ROOM_MIRROR)!;
    const roomFp = canonicalWorkflowJsonFingerprint(roomJson);
    const runs = new Map<string, NodeRunRecord>([
      [NODE_ID, runningNodeRun(now, roomFp)],
    ]);
    const room = [roomMessage(PPT_ROOM_MIRROR, now - 60_000)];

    const pending = collectAuxiliaryRoomHealPendingValidation(
      [PPT_NODE],
      runs,
      room,
      TASK_ID,
      {
        roles: [ROLE],
        edges: [],
        teamRoles: [ROLE],
        jsonStableMs: WORKFLOW_ROOM_JSON_HEAL_AUXILIARY_STABLE_MS,
        onlyNodeId: NODE_ID,
        nowMs: now,
      },
    );

    expect(pending).toHaveLength(1);
    expect(filterAuxiliaryRoomHealCandidates(pending)).toHaveLength(1);
    expect(runs.get(NODE_ID)?.status).toBe('running');
  });

  it('辅路径：extractWorkflowRoomJsonReceipt 要求 phase=task_running + role 精确匹配', () => {
    const receiptOk = extractWorkflowRoomJsonReceipt(
      [roomMessage(PPT_ROOM_MIRROR, startedAt + 100_000)],
      PPT_NODE,
      [PPT_NODE],
      ROLE,
    );
    expect(receiptOk?.json.deliverable?.conclusion).toBe('已交付');

    const wrongPhase = extractWorkflowRoomJsonReceipt(
      [{ ...roomMessage(PPT_ROOM_MIRROR, startedAt + 100_000), phase: 'task_deliver' }],
      PPT_NODE,
      [PPT_NODE],
      ROLE,
    );
    expect(wrongPhase).toBeNull();

    const wrongRole = extractWorkflowRoomJsonReceipt(
      [roomMessage(PPT_ROOM_MIRROR.replace('PPT美化师', '报告美化师'), startedAt + 100_000)],
      PPT_NODE,
      [PPT_NODE],
      ROLE,
    );
    expect(wrongRole).toBeNull();
  });

  it('超时恢复：hasActiveRun 仍为 true 时 tryRecoverWorkflowSessionStructuredReply 拒绝（闸门未开）', async () => {
    const gateway = {} as GatewayManager;
    vi.mocked(fetchGatewaySessionListRow).mockResolvedValue({
      key: SESSION,
      hasActiveRun: true,
      status: 'running',
      updatedAt: startedAt + 400_000,
    });

    const result = await tryRecoverWorkflowSessionStructuredReply(gateway, {
      sessionKey: SESSION,
      startedAtMs: startedAt,
      runId: SETTLE_RUN_ID,
      validateWithDisk: async () => ({
        ok: true,
        parsed: {
          ...parseWorkflowJsonOutput(PPT_SESSION_FINAL)!,
          raw: PPT_SESSION_FINAL,
        },
      }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.validation.detail).toContain('idle');
    }
    expect(fetchChatHistory).not.toHaveBeenCalled();
  });

  it('主路径闸门未开时辅路径仍可准入（先完整校验再计 120s 稳定）', async () => {
    vi.useFakeTimers();
    vi.mocked(fetchGatewaySessionListRow).mockResolvedValue({
      key: SESSION,
      hasActiveRun: true,
      status: 'running',
      updatedAt: startedAt + 400_000,
    });

    const gateway = createEmitterGateway();
    const waitPromise = waitForSessionReply(gateway, {
      sessionKey: SESSION,
      startedAtMs: startedAt,
      runId: SETTLE_RUN_ID,
      timeoutMs: 3_000,
      pollIntervalMs: 500,
      requireWorkflowStructuredReply: true,
      requireFreshUserTurn: true,
      minWaitBeforeAcceptMs: 0,
    });

    gateway.emitAgentNotification({
      runId: SHARED_BARE_RUN,
      sessionKey: SESSION,
      stream: 'lifecycle',
      data: { phase: 'end', stopReason: 'stop' },
    });

    const now = startedAt + 400_000;
    const roomJson = parseWorkflowJsonOutput(PPT_ROOM_MIRROR)!;
    const roomFp = canonicalWorkflowJsonFingerprint(roomJson);
    const runs = new Map<string, NodeRunRecord>([
      [NODE_ID, runningNodeRun(now - WORKFLOW_ROOM_JSON_HEAL_AUXILIARY_STABLE_MS - 5_000, roomFp)],
    ]);
    const room = [roomMessage(PPT_ROOM_MIRROR, now - 60_000)];

    const pending = collectAuxiliaryRoomHealPendingValidation(
      [PPT_NODE],
      runs,
      room,
      TASK_ID,
      {
        roles: [ROLE],
        edges: [],
        teamRoles: [ROLE],
        nowMs: now,
        jsonStableMs: WORKFLOW_ROOM_JSON_HEAL_AUXILIARY_STABLE_MS,
        onlyNodeId: NODE_ID,
      },
    );
    expect(pending).toHaveLength(1);
    expect(filterAuxiliaryRoomHealCandidates(pending)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(4_000);
    const waitResult = await waitPromise;
    expect(waitResult.completed).toBe(false);
    expect(waitResult.timedOut).toBe(true);
  });
});
