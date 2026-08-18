import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { join } from 'node:path';

describe('renameManagedSkillDirWithRetry', () => {
  let renameSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    renameSpy = vi.spyOn(fs, 'renameSync');
  });

  afterEach(() => {
    renameSpy.mockRestore();
    vi.useRealTimers();
  });

  it('retries EPERM and eventually renames', async () => {
    const busy = Object.assign(new Error('busy'), { code: 'EPERM' });
    renameSpy
      .mockImplementationOnce(() => { throw busy; })
      .mockImplementationOnce(() => { throw busy; })
      .mockImplementationOnce(() => undefined);

    const { renameManagedSkillDirWithRetry } = await import(
      '../../electron/services/skills/skill-fs-mutate'
    );
    const pending = renameManagedSkillDirWithRetry(join('/tmp', 'from'), join('/tmp', 'to'));
    await vi.runAllTimersAsync();
    await pending;

    expect(renameSpy).toHaveBeenCalledTimes(3);
  });

  it('throws SKILL_FILESYSTEM_BUSY after exhausted busy retries', async () => {
    const busy = Object.assign(new Error('busy'), { code: 'EBUSY' });
    renameSpy.mockImplementation(() => {
      throw busy;
    });

    const {
      renameManagedSkillDirWithRetry,
      SKILL_FILESYSTEM_BUSY_CODE,
    } = await import('../../electron/services/skills/skill-fs-mutate');

    const pending = renameManagedSkillDirWithRetry(join('/tmp', 'from'), join('/tmp', 'to'));
    const expectation = expect(pending).rejects.toMatchObject({
      name: 'SkillFilesystemBusyError',
      code: SKILL_FILESYSTEM_BUSY_CODE,
    });
    await vi.runAllTimersAsync();
    await expectation;
    expect(renameSpy.mock.calls.length).toBeGreaterThan(1);
  });
});
