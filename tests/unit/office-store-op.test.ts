import { describe, expect, it, vi } from 'vitest';

/**
 * Regression: archive used to call abortOfficeTaskRun inside withOfficeStoreOp,
 * which queued another store op and deadlocked the whole office store chain.
 */
describe('office store op reentrancy', () => {
  it('allows nested serialized ops when the inner op runs while outer holds the chain', async () => {
    let depth = 0;
    let chain: Promise<unknown> = Promise.resolve();

    const withOfficeStoreOp = <T>(fn: () => Promise<T>): Promise<T> => {
      if (depth > 0) {
        return fn();
      }
      const run = async (): Promise<T> => {
        depth += 1;
        try {
          return await fn();
        } finally {
          depth -= 1;
        }
      };
      const next = chain.then(run, run);
      chain = next.then(() => undefined, () => undefined);
      return next;
    };

    const inner = vi.fn(async () => 'inner-done');
    const outer = vi.fn(async () => {
      await withOfficeStoreOp(inner);
      return 'outer-done';
    });

    await expect(withOfficeStoreOp(outer)).resolves.toBe('outer-done');
    expect(outer).toHaveBeenCalledTimes(1);
    expect(inner).toHaveBeenCalledTimes(1);
  });
});
