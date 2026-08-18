import { describe, expect, it } from 'vitest';
import {
  filterAuxiliaryRoomHealCandidates,
  workflowRoomMirrorSnippetForProgress,
} from '../../electron/services/office/workflow-room-auxiliary-heal';
import {
  isAuxiliaryValidatedJsonStableForHeal,
  isWorkflowJsonCompletionEvidence,
  isWorkflowRoomJsonReceiptReady,
  stampAuxiliaryRoomHealValidationSuccess,
  tickWorkflowRoomJsonReceipt,
  WORKFLOW_ROOM_JSON_HEAL_AUXILIARY_STABLE_MS,
  WORKFLOW_ROOM_JSON_HEAL_STABLE_MS,
} from '../../src/lib/office-workflow-room-json-heal';
import {
  collectAuxiliaryRoomHealPendingValidation,
  unstuckStaleRunningNodeRuns,
  type WorkflowRoomHealPendingValidation,
} from '../../src/lib/office-workflow-run-heal';
import {
  canonicalWorkflowJsonFingerprint,
  parseWorkflowJsonOutput,
} from '../../src/lib/office-workflow-json-schema';
import type { NodeRunRecord, RoomMessage, WorkflowNode } from '../../src/types/office';

const WORKFLOW_JSON = `{
  "role": "软件测试",
  "step": { "index": 3, "total": 3, "title": "软件测试验收" },
  "inputValidation": { "targets": ["a.md"], "lsResult": [] },
  "execution": "完成",
  "outputValidation": { "targets": ["out.md"], "lsResult": [] },
  "deliverable": { "path": "out.md", "summary": "摘要", "conclusion": "通过" },
  "rollback": "无"
}`;

const NODE: WorkflowNode = {
  id: 'gen-2',
  title: '软件测试验收',
  agentId: 'ruan-jian-ce-shi',
  execution: 'serial',
};

const ROLE = { agentId: 'ruan-jian-ce-shi', displayName: '软件测试' };

function pendingItem(overrides?: Partial<WorkflowRoomHealPendingValidation['receipt']>): WorkflowRoomHealPendingValidation {
  const json = JSON.parse(WORKFLOW_JSON);
  const receipt = {
    raw: WORKFLOW_JSON,
    json,
    fingerprint: 'fp-1',
    roleId: 'ruan-jian-ce-shi',
    ...overrides,
  };
  if (overrides?.json) {
    receipt.json = overrides.json;
  }
  return { nodeId: 'gen-2', roleId: 'ruan-jian-ce-shi', receipt };
}

function roomMsg(content: string, timestamp: number): RoomMessage {
  return {
    id: `m-${timestamp}`,
    projectId: 'task-1',
    from: ROLE.displayName,
    fromAgentId: ROLE.agentId,
    content,
    progressText: content,
    phase: 'task_running',
    timestamp,
    nodeId: NODE.id,
    mentions: [],
  };
}

function runningRun(overrides?: Partial<NodeRunRecord>): NodeRunRecord {
  return {
    nodeId: NODE.id,
    agentId: ROLE.agentId,
    status: 'running',
    ...overrides,
  } as NodeRunRecord;
}

describe('workflow room auxiliary heal path', () => {
  it('auxiliary stable window is 120 seconds after validation', () => {
    expect(WORKFLOW_ROOM_JSON_HEAL_AUXILIARY_STABLE_MS).toBe(120_000);
  });

  it('isWorkflowJsonCompletionEvidence accepts deliverable.conclusion', () => {
    expect(isWorkflowJsonCompletionEvidence(JSON.parse(WORKFLOW_JSON))).toBe(true);
  });

  it('workflowRoomMirrorSnippetForProgress prefers completion JSON', () => {
    const snippet = workflowRoomMirrorSnippetForProgress(`\`\`\`json\n${WORKFLOW_JSON}\n\`\`\``);
    expect(snippet).toContain('"conclusion": "通过"');
  });

  it('filterAuxiliaryRoomHealCandidates keeps completion JSON regardless of session transcript', () => {
    const filtered = filterAuxiliaryRoomHealCandidates([pendingItem()]);
    expect(filtered).toHaveLength(1);
  });

  it('filterAuxiliaryRoomHealCandidates drops JSON without completion evidence', () => {
    const incomplete = JSON.parse(WORKFLOW_JSON) as Record<string, unknown>;
    (incomplete.deliverable as Record<string, string>).conclusion = '';
    incomplete.execution = '';
    const out = filterAuxiliaryRoomHealCandidates(
      [pendingItem({ json: incomplete as never })],
    );
    expect(out).toHaveLength(0);
  });

  it('collectAuxiliaryRoomHealPendingValidation does not require stable window first', () => {
    const now = 1_000_000;
    const runs = new Map<string, NodeRunRecord>([
      [NODE.id, runningRun({ roomHealJsonFingerprint: 'old', roomHealJsonStableSinceMs: now })],
    ]);
    const pending = collectAuxiliaryRoomHealPendingValidation(
      [NODE],
      runs,
      [roomMsg(WORKFLOW_JSON, now)],
      'task-1',
      { nowMs: now, roles: [ROLE], edges: [], teamRoles: [ROLE] },
    );
    expect(pending).toHaveLength(1);
    expect(pending[0]?.receipt.raw).toContain('"conclusion": "通过"');
  });

  it('collectAuxiliaryRoomHealPendingValidation drops room JSON older than sessionStartedAtMs', () => {
    const sessionStartedAtMs = 2_000_000;
    const runs = new Map<string, NodeRunRecord>([
      [NODE.id, runningRun({ startedAt: sessionStartedAtMs, roomHealJsonFingerprint: 'old' })],
    ]);
    const pending = collectAuxiliaryRoomHealPendingValidation(
      [NODE],
      runs,
      [roomMsg(WORKFLOW_JSON, sessionStartedAtMs - 90_000)],
      'task-1',
      {
        nowMs: sessionStartedAtMs + 30_000,
        roles: [ROLE],
        edges: [],
        teamRoles: [ROLE],
        minRoomMessageTimestampMs: sessionStartedAtMs,
      },
    );
    expect(pending).toHaveLength(0);
  });

  it('resolveRoomHealMinTimestampMs must not raise floor above run.startedAt (room card is stamped before sessionStartedAt)', async () => {
    const { resolveRoomHealMinTimestampMs } = await import('../../src/lib/office-workflow-run-heal');
    const { extractWorkflowRoomJsonReceipt } = await import('../../src/lib/office-workflow-room-json-heal');
    // Production order: run.startedAt → beginTaskNodeRoomPhases (room.timestamp) → sessionStartedAt.
    // progressText is later patched onto the same message without bumping timestamp.
    const runStartedAt = 1_000_000;
    const roomCardAt = 1_000_050;
    const sessionStartedAt = 1_000_200;
    const floor = resolveRoomHealMinTimestampMs(
      { minRoomMessageTimestampMs: sessionStartedAt },
      { startedAt: runStartedAt },
    );
    expect(floor).toBe(runStartedAt);
    const receipt = extractWorkflowRoomJsonReceipt(
      [roomMsg(WORKFLOW_JSON, roomCardAt)],
      NODE,
      [NODE],
      ROLE,
      { minTimestampMs: floor },
    );
    expect(receipt).toBeTruthy();
    expect(receipt!.json.deliverable?.conclusion).toBe('通过');
  });

  it('collectAuxiliaryRoomHealPendingValidation skips fingerprint already validated', () => {
    const json = parseWorkflowJsonOutput(WORKFLOW_JSON)!;
    const fp = canonicalWorkflowJsonFingerprint(json);
    const now = 1_000_000;
    const runs = new Map<string, NodeRunRecord>([
      [
        NODE.id,
        runningRun({
          roomHealJsonFingerprint: fp,
          roomHealJsonStableSinceMs: now - 60_000,
          roomHealValidatedFingerprint: fp,
        }),
      ],
    ]);
    const pending = collectAuxiliaryRoomHealPendingValidation(
      [NODE],
      runs,
      [roomMsg(WORKFLOW_JSON, now)],
      'task-1',
      { nowMs: now, roles: [ROLE], edges: [], teamRoles: [ROLE] },
    );
    expect(pending).toHaveLength(0);
  });

  it('collectAuxiliaryRoomHealPendingValidation retries same fingerprint after soft fail (no validated)', () => {
    const json = parseWorkflowJsonOutput(WORKFLOW_JSON)!;
    const fp = canonicalWorkflowJsonFingerprint(json);
    const now = 1_000_000;
    const runs = new Map<string, NodeRunRecord>([
      [
        NODE.id,
        runningRun({
          roomHealJsonFingerprint: fp,
          roomHealJsonStableSinceMs: undefined,
          roomHealValidatedFingerprint: undefined,
          roomHealValidationFailFingerprint: fp,
        }),
      ],
    ]);
    const pending = collectAuxiliaryRoomHealPendingValidation(
      [NODE],
      runs,
      [roomMsg(WORKFLOW_JSON, now)],
      'task-1',
      { nowMs: now, roles: [ROLE], edges: [], teamRoles: [ROLE] },
    );
    expect(pending).toHaveLength(1);
  });

  describe('auxiliary post-validation stable clock', () => {
    const stableMs = WORKFLOW_ROOM_JSON_HEAL_AUXILIARY_STABLE_MS;
    const fp = 'fp-aux-1';

    it('UT reproduce: stamping sync-start after slow validation shortens the 120s window', () => {
      const syncStartMs = 1_000_000;
      const validateDoneMs = syncStartMs + 50_000;
      const buggy = stampAuxiliaryRoomHealValidationSuccess(
        runningRun({ roomHealJsonFingerprint: fp }),
        fp,
        syncStartMs,
      );
      // 距真实校验完成仅 70s，却已满「从 syncStart 起算」的 120s → 过早可应用
      expect(
        isAuxiliaryValidatedJsonStableForHeal(buggy, validateDoneMs + 70_000, stableMs),
      ).toBe(true);
      expect(validateDoneMs + 70_000 - syncStartMs).toBeGreaterThanOrEqual(stableMs);
      expect(validateDoneMs + 70_000 - validateDoneMs).toBeLessThan(stableMs);
    });

    it('correct stamp at validation completion keeps full 120s after pass', () => {
      const syncStartMs = 1_000_000;
      const validateDoneMs = syncStartMs + 50_000;
      const stamped = stampAuxiliaryRoomHealValidationSuccess(
        runningRun({ roomHealJsonFingerprint: fp }),
        fp,
        validateDoneMs,
      );
      expect(
        isAuxiliaryValidatedJsonStableForHeal(stamped, validateDoneMs + 70_000, stableMs),
      ).toBe(false);
      expect(
        isAuxiliaryValidatedJsonStableForHeal(stamped, validateDoneMs + stableMs, stableMs),
      ).toBe(true);
    });

    it('isAuxiliaryValidatedJsonStableForHeal requires validated fingerprint match', () => {
      const now = 2_000_000;
      const stamped = stampAuxiliaryRoomHealValidationSuccess(runningRun(), fp, now - stableMs);
      expect(isAuxiliaryValidatedJsonStableForHeal(stamped, now, stableMs)).toBe(true);
      expect(
        isAuxiliaryValidatedJsonStableForHeal(
          { ...stamped, roomHealValidatedFingerprint: undefined },
          now,
          stableMs,
        ),
      ).toBe(false);
      expect(
        isAuxiliaryValidatedJsonStableForHeal(
          { ...stamped, roomHealJsonFingerprint: 'other' },
          now,
          stableMs,
        ),
      ).toBe(false);
      // plain receipt-ready without validated must not satisfy auxiliary apply gate
      expect(
        isWorkflowRoomJsonReceiptReady(
          {
            ...runningRun({
              roomHealJsonFingerprint: fp,
              roomHealJsonStableSinceMs: now - stableMs,
            }),
          },
          now,
          stableMs,
        ),
      ).toBe(true);
      expect(
        isAuxiliaryValidatedJsonStableForHeal(
          runningRun({
            roomHealJsonFingerprint: fp,
            roomHealJsonStableSinceMs: now - stableMs,
          }),
          now,
          stableMs,
        ),
      ).toBe(false);
    });

    it('tick clears validated when receipt fingerprint changes after stamp', () => {
      const validatedAt = 4_000_000;
      const stamped = stampAuxiliaryRoomHealValidationSuccess(
        runningRun({ roomHealJsonFingerprint: fp }),
        fp,
        validatedAt,
      );
      const next = tickWorkflowRoomJsonReceipt(
        stamped,
        {
          raw: '{}',
          json: {} as never,
          fingerprint: 'fp-changed',
          roleId: ROLE.agentId,
        },
        validatedAt + 10_000,
      );
      expect(next.roomHealValidatedFingerprint).toBeUndefined();
      expect(next.roomHealJsonFingerprint).toBe('fp-changed');
      expect(
        isAuxiliaryValidatedJsonStableForHeal(next, validatedAt + 10_000 + stableMs, stableMs),
      ).toBe(false);
    });

    it('JSON fingerprint change after validation clears apply gate (re-validate + reset)', () => {
      const validatedAt = 3_000_000;
      const stamped = stampAuxiliaryRoomHealValidationSuccess(
        runningRun({ roomHealJsonFingerprint: fp }),
        fp,
        validatedAt,
      );
      expect(
        isAuxiliaryValidatedJsonStableForHeal(stamped, validatedAt + stableMs, stableMs),
      ).toBe(true);
      const afterChange = {
        ...stamped,
        roomHealJsonFingerprint: 'fp-new',
        roomHealJsonStableSinceMs: validatedAt + 1_000,
        roomHealValidatedFingerprint: undefined,
      };
      expect(
        isAuxiliaryValidatedJsonStableForHeal(afterChange, validatedAt + stableMs + 1_000, stableMs),
      ).toBe(false);
    });

    it('fingerprint-only match is not enough for auxiliary apply (<120s)', () => {
      const now = 5_000_000;
      const stamped = stampAuxiliaryRoomHealValidationSuccess(
        runningRun({ roomHealJsonFingerprint: fp }),
        fp,
        now,
      );
      // 主路径 apply 只看 validated===jsonFp；辅路径还必须满 120s
      expect(stamped.roomHealValidatedFingerprint === stamped.roomHealJsonFingerprint).toBe(true);
      expect(isAuxiliaryValidatedJsonStableForHeal(stamped, now + 20_000, stableMs)).toBe(false);
    });
  });

  describe('concurrency / unstuck edge notes (not default critical paths)', () => {
    it('characterizes stale-snapshot stamp overwrite (tickInFlight normally prevents aux tick race)', () => {
      // 若在 await 期间另有写入改了指纹，用旧快照 stamp 会回滚；辅路径 ticker 有 tickInFlight，
      // 单次 sync 内不会并行 tick，故默认路径难触发。本例仅刻画「缺守卫时的写回形态」。
      const t0 = 6_000_000;
      const runAtValidateStart = runningRun({
        roomHealJsonFingerprint: 'fp-A',
        roomHealJsonStableSinceMs: t0,
      });
      const afterJsonChanged = tickWorkflowRoomJsonReceipt(
        runAtValidateStart,
        {
          raw: '{"x":1}',
          json: { x: 1 } as never,
          fingerprint: 'fp-B',
          roleId: ROLE.agentId,
        },
        t0 + 5_000,
      );
      expect(afterJsonChanged.roomHealJsonFingerprint).toBe('fp-B');
      expect(afterJsonChanged.roomHealValidatedFingerprint).toBeUndefined();

      const overwriteWithStaleSnapshot = stampAuxiliaryRoomHealValidationSuccess(
        runAtValidateStart,
        'fp-A',
        t0 + 30_000,
      );
      expect(overwriteWithStaleSnapshot.roomHealJsonFingerprint).toBe('fp-A');
      expect(overwriteWithStaleSnapshot.roomHealValidatedFingerprint).toBe('fp-A');
      expect(overwriteWithStaleSnapshot.roomHealJsonFingerprint).not.toBe(
        afterJsonChanged.roomHealJsonFingerprint,
      );
    });

    it('soft-fail clear leaves receipt not 5min-ready (continuous fail never unlocks main collect)', () => {
      const now = 7_000_000;
      const afterSoftFail = runningRun({
        roomHealJsonFingerprint: 'fp-soft',
        roomHealJsonStableSinceMs: undefined,
        roomHealValidatedFingerprint: undefined,
        roomHealValidationFailFingerprint: undefined,
        startedAt: now - 60_000,
      });
      expect(
        isWorkflowRoomJsonReceiptReady(afterSoftFail, now, WORKFLOW_ROOM_JSON_HEAL_STABLE_MS),
      ).toBe(false);
      expect(
        isAuxiliaryValidatedJsonStableForHeal(
          afterSoftFail,
          now,
          WORKFLOW_ROOM_JSON_HEAL_AUXILIARY_STABLE_MS,
        ),
      ).toBe(false);
    });

    it('unstuck on short maxRuntime can fire while auxiliary validated clock is still young', () => {
      // unstuck 的「有 heal 证据」= 默认 5min receipt-ready；辅路径 stamp 后稳定钟从校验完成起算。
      // 短 maxRuntime（如 5min）+ 偏晚 stamp 时，可能在 120s 窗未满/刚过时打回 pending。
      // 默认 30min 节点：早 stamp 后满 5min receipt-ready 会跳过 unstuck，此窗很小。
      // 清 fp 后若再变 running，下一次 tick(undefined→fp) 会清掉残留 validated。
      const startedAt = 8_000_000;
      const maxMin = 5;
      const node: WorkflowNode = { ...NODE, maxRuntimeMinutes: maxMin };
      const stampedAt = startedAt + 3.5 * 60_000;
      const now = startedAt + maxMin * 60_000;
      const runs = new Map<string, NodeRunRecord>([
        [
          node.id,
          stampAuxiliaryRoomHealValidationSuccess(
            runningRun({ startedAt, roomHealJsonFingerprint: 'fp-u' }),
            'fp-u',
            stampedAt,
          ),
        ],
      ]);
      expect(isWorkflowRoomJsonReceiptReady(runs.get(node.id)!, now)).toBe(false);
      expect(unstuckStaleRunningNodeRuns([node], runs, [], 'task-1', now)).toBe(true);
      const after = runs.get(node.id)!;
      expect(after.status).toBe('pending');
      expect(after.roomHealJsonFingerprint).toBeUndefined();
      expect(after.roomHealJsonStableSinceMs).toBeUndefined();
      expect(after.roomHealValidatedFingerprint).toBe('fp-u');
      const retick = tickWorkflowRoomJsonReceipt(
        { ...after, status: 'running' },
        {
          raw: WORKFLOW_JSON,
          json: JSON.parse(WORKFLOW_JSON),
          fingerprint: 'fp-u',
          roleId: ROLE.agentId,
        },
        now + 1_000,
      );
      expect(retick.roomHealValidatedFingerprint).toBeUndefined();
      expect(retick.roomHealJsonFingerprint).toBe('fp-u');
    });
  });
});
