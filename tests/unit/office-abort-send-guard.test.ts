import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearTaskUserAborted,
  issueTaskAbortClearPermit,
  isTaskUserAborted,
  markTaskUserAborted,
  resetTaskAbortRegistryForTests,
} from '@electron/services/office/task-run-abort-registry';
import {
  isAbortQuiescing,
  resetAbortQuiesceLocksForTests,
} from '@electron/services/office/project-abort-quiesce';
import {
  assertOfficeLlmSendAllowed,
  OfficeLlmSendAbortedError,
  shouldBlockOfficeLlmSend,
} from '@electron/services/office/office-llm-send-guard';
import { installAbortQuiesceLock } from '@electron/services/office/project-gateway-abort';

describe('office llm send guard + abort clear permit', () => {
  beforeEach(() => {
    resetTaskAbortRegistryForTests();
    resetAbortQuiesceLocksForTests();
  });

  afterEach(() => {
    resetTaskAbortRegistryForTests();
    resetAbortQuiesceLocksForTests();
  });

  it('blocks send when user-aborted or abort-quiescing', () => {
    expect(shouldBlockOfficeLlmSend('p1')).toBe(false);
    markTaskUserAborted('p1');
    expect(shouldBlockOfficeLlmSend('p1')).toBe(true);
    expect(() => assertOfficeLlmSendAllowed('p1')).toThrow(OfficeLlmSendAbortedError);

    clearTaskUserAborted('p1');
    expect(shouldBlockOfficeLlmSend('p1')).toBe(false);

    installAbortQuiesceLock({
      projectId: 'p1',
      generation: 1,
      startedAt: 1,
      staticSessionKeys: [],
      inflightSessionKeys: [],
    });
    expect(isAbortQuiescing('p1')).toBe(true);
    expect(shouldBlockOfficeLlmSend('p1')).toBe(true);
  });

  it('clear permit: concurrent abort wins over stale run clear', () => {
    const permit = issueTaskAbortClearPermit('p1');
    expect(permit).toBe(0);
    markTaskUserAborted('p1'); // seq → 1
    expect(isTaskUserAborted('p1')).toBe(true);
    expect(clearTaskUserAborted('p1', { onlyIfAbortSeq: permit })).toBe(false);
    expect(isTaskUserAborted('p1')).toBe(true);

    const permit2 = issueTaskAbortClearPermit('p1');
    expect(permit2).toBe(1);
    expect(clearTaskUserAborted('p1', { onlyIfAbortSeq: permit2 })).toBe(true);
    expect(isTaskUserAborted('p1')).toBe(false);
  });
});

describe('withOfficeProjectDirLock ALS reentrancy', () => {
  it('queues concurrent callers while allowing nested re-entry', async () => {
    vi.resetModules();
    const { withOfficeProjectDirLock, resetOfficeProjectDirLocksForTests } = await import(
      '@electron/services/office/office-project-dir-lock'
    );
    resetOfficeProjectDirLocksForTests();

    const order: string[] = [];
    let releaseA!: () => void;
    const aHold = new Promise<void>((r) => {
      releaseA = r;
    });
    let signalAEntered!: () => void;
    const aEntered = new Promise<void>((r) => {
      signalAEntered = r;
    });

    const a = withOfficeProjectDirLock('proj', async () => {
      order.push('a-enter');
      signalAEntered();
      const nested = await withOfficeProjectDirLock('proj', async () => {
        order.push('a-nested');
        return 'nested';
      });
      expect(nested).toBe('nested');
      await aHold;
      order.push('a-exit');
    });

    await aEntered;
    const bStarted = withOfficeProjectDirLock('proj', async () => {
      order.push('b');
    });

    // Yield so B would have run if the old depth-bypass bug were present.
    await new Promise((r) => setTimeout(r, 30));
    expect(order).toEqual(['a-enter', 'a-nested']);
    releaseA();
    await Promise.all([a, bStarted]);
    expect(order).toEqual(['a-enter', 'a-nested', 'a-exit', 'b']);
  });
});
