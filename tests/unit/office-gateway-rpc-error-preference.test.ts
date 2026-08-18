import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayManager } from '@electron/gateway/manager';
import {
  isGatewayRpcParamShapeError,
  preferGatewayRpcError,
  callAgentMessage,
} from '@electron/services/office/gateway-rpc';
import { resetOfficeInflightLlmRegistryForTests } from '@electron/services/office/office-inflight-llm-registry';
import { resetTaskAbortRegistryForTests } from '@electron/services/office/task-run-abort-registry';
import { resetAbortQuiesceLocksForTests } from '@electron/services/office/project-abort-quiesce';

vi.mock('@electron/services/office/office-session-new', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@electron/services/office/office-session-new')>();
  return {
    ...actual,
    ensureProjectAgentSessionNew: vi.fn(async () => undefined),
  };
});

vi.mock('@electron/services/office/office-spawn-policy', () => ({
  assertOfficeSpawnRpcDisabled: vi.fn(),
  resolveAgentIdFromOfficeSessionKey: () => 'wen-dang-zhuan-xie-shi',
  withOfficeSpawnToolDeny: async (_agentId: string, fn: () => Promise<unknown>) => fn(),
}));

describe('gateway-rpc tryRpc error preference (quota vs key mask)', () => {
  beforeEach(() => {
    resetOfficeInflightLlmRegistryForTests();
    resetTaskAbortRegistryForTests();
    resetAbortQuiesceLocksForTests();
  });

  it('classifies INVALID_REQUEST param-shape errors', () => {
    expect(
      isGatewayRpcParamShapeError(
        new Error("invalid agent params: at root: unexpected property 'key'"),
      ),
    ).toBe(true);
    expect(
      isGatewayRpcParamShapeError(
        new Error(
          "invalid chat.send params: must have required property 'sessionKey'; at root: unexpected property 'key'",
        ),
      ),
    ).toBe(true);
    // Real AJV sessionKey type errors must NOT be treated as discardable shape noise.
    expect(
      isGatewayRpcParamShapeError(
        new Error('invalid chat.send params: /sessionKey: must be string'),
      ),
    ).toBe(false);
    expect(
      isGatewayRpcParamShapeError(
        new Error(
          '⚠️ All models are temporarily rate-limited. Please try again in a few minutes.',
        ),
      ),
    ).toBe(false);
  });

  it('preferGatewayRpcError keeps rate-limit over later key param-shape error', () => {
    const rateLimited = new Error(
      '⚠️ All models are temporarily rate-limited. Please try again in a few minutes.',
    );
    const keyShape = new Error("invalid agent params: at root: unexpected property 'key'");
    expect(preferGatewayRpcError(rateLimited, keyShape).message).toContain('rate-limited');
    expect(preferGatewayRpcError(keyShape, rateLimited).message).toContain('rate-limited');
  });

  it('preferGatewayRpcError keeps rate-limit over later unknown-method noise', () => {
    const rateLimited = new Error(
      '⚠️ All models are temporarily rate-limited. Please try again in a few minutes.',
    );
    const unknownMethod = new Error('unknown method: agent');
    expect(preferGatewayRpcError(rateLimited, unknownMethod).message).toContain('rate-limited');
  });

  it('HOLE: callAgentMessage must surface quota/rate-limit, not unexpected property key', async () => {
    const rpc = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if ('key' in params && !('sessionKey' in params)) {
        throw new Error(
          method === 'agent'
            ? "invalid agent params: at root: unexpected property 'key'"
            : "invalid chat.send params: must have required property 'sessionKey'; at root: unexpected property 'key'",
        );
      }
      if (method === 'chat.send') {
        throw new Error(
          '⚠️ All models are temporarily rate-limited. Please try again in a few minutes.',
        );
      }
      if (method === 'agent') {
        throw new Error(
          'FailoverError: ⚠️ You exceeded your current quota, please check your plan and billing details.',
        );
      }
      throw new Error(`unexpected method ${method}`);
    });
    const gateway = { rpc } as unknown as GatewayManager;

    await expect(
      callAgentMessage(
        gateway,
        'agent:wen-dang-zhuan-xie-shi:office:task:project-1:role:wen-dang-zhuan-xie-shi:node:gen-1',
        'write doc',
        'idem-quota',
        { projectId: 'project-1', agentId: 'wen-dang-zhuan-xie-shi' },
      ),
    ).rejects.toThrow(/rate-limited|quota/i);

    const calls = rpc.mock.calls as Array<[string, Record<string, unknown>]>;
    expect(calls.length).toBeGreaterThan(0);
    // Must never send root-level `key` as session id for chat.send/agent.
    expect(calls.every(([, p]) => !('key' in p))).toBe(true);
    expect(calls.every(([, p]) => typeof p.sessionKey === 'string')).toBe(true);
  });
});
