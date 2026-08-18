import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayManager } from '@electron/gateway/manager';
import {
  listOfficeInflightLlmSessionKeys,
  resetOfficeInflightLlmRegistryForTests,
} from '@electron/services/office/office-inflight-llm-registry';

vi.mock('@electron/services/office/office-session-new', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@electron/services/office/office-session-new')>();
  return {
    ...actual,
    ensureProjectAgentSessionNew: vi.fn(
      async (
        _gateway: unknown,
        _params: unknown,
        send: (
          gw: unknown,
          key: string,
          text: string,
          idem?: string,
          opts?: unknown,
        ) => Promise<unknown>,
      ) => {
        // no-op before real send
        void send;
      },
    ),
  };
});

vi.mock('@electron/services/office/office-spawn-policy', () => ({
  assertOfficeSpawnRpcDisabled: vi.fn(),
  resolveAgentIdFromOfficeSessionKey: () => 'agent-a',
  withOfficeSpawnToolDeny: async (_agentId: string, fn: () => Promise<unknown>) => fn(),
}));

import { callAgentMessage, sessionsSend } from '@electron/services/office/gateway-rpc';
import { resetTaskAbortRegistryForTests, markTaskUserAborted } from '@electron/services/office/task-run-abort-registry';
import { resetAbortQuiesceLocksForTests } from '@electron/services/office/project-abort-quiesce';
import { OfficeLlmSendAbortedError } from '@electron/services/office/office-llm-send-guard';

describe('office inflight llm registration on send', () => {
  beforeEach(() => {
    resetOfficeInflightLlmRegistryForTests();
    resetTaskAbortRegistryForTests();
    resetAbortQuiesceLocksForTests();
  });

  it('registers project session after chat.send via callAgentMessage', async () => {
    const gateway = {
      rpc: vi.fn().mockResolvedValue({ runId: 'run-1' }),
    } as unknown as GatewayManager;

    await callAgentMessage(gateway, 'agent:a:task-room:proj-1', 'hello', 'idem-1', {
      projectId: 'proj-1',
      agentId: 'agent-a',
    });

    expect(listOfficeInflightLlmSessionKeys('proj-1')).toEqual(['agent:a:task-room:proj-1']);
  });

  it('registers target session after sessionsSend', async () => {
    const gateway = {
      rpc: vi.fn().mockResolvedValue({ runId: 'run-2' }),
    } as unknown as GatewayManager;

    await sessionsSend(gateway, {
      sessionKey: 'agent:coord:task-room:proj-2',
      targetSessionKey: 'agent:dev:dm:proj-2',
      message: 'go',
      projectId: 'proj-2',
      targetAgentId: 'dev',
    });

    expect(listOfficeInflightLlmSessionKeys('proj-2')).toEqual(['agent:dev:dm:proj-2']);
  });

  it('skips registration when projectId cannot be inferred from session key', async () => {
    const gateway = {
      rpc: vi.fn().mockResolvedValue({ runId: 'run-3' }),
    } as unknown as GatewayManager;

    // Non-office key → no parseable projectId → no inflight registration.
    await callAgentMessage(gateway, 'agent:a:plain-session', 'hello', 'idem-3');
    expect(listOfficeInflightLlmSessionKeys('x')).toEqual([]);
    expect(listOfficeInflightLlmSessionKeys('plain-session')).toEqual([]);
  });

  it('registers from inferred office session projectId when options omit it', async () => {
    const gateway = {
      rpc: vi.fn().mockResolvedValue({ runId: 'run-inferred' }),
    } as unknown as GatewayManager;

    await callAgentMessage(
      gateway,
      'agent:a:office:task-room:inferred-1',
      'hello',
      'idem-inferred',
    );
    expect(listOfficeInflightLlmSessionKeys('inferred-1')).toEqual([
      'agent:a:office:task-room:inferred-1',
    ]);
  });

  it('rejects chat.send when project is user-aborted', async () => {
    markTaskUserAborted('proj-abort');
    const gateway = {
      rpc: vi.fn().mockResolvedValue({ runId: 'run-x' }),
    } as unknown as GatewayManager;

    await expect(
      callAgentMessage(gateway, 'agent:a:task-room:proj-abort', 'hello', 'idem-x', {
        projectId: 'proj-abort',
      }),
    ).rejects.toBeInstanceOf(OfficeLlmSendAbortedError);
    expect(gateway.rpc).not.toHaveBeenCalled();
    expect(listOfficeInflightLlmSessionKeys('proj-abort')).toEqual([]);
  });
});
