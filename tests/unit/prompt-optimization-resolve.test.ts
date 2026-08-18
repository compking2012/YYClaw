import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fetchPromptOptimizationSummaryWithRetry } from '@/stores/chat/prompt-optimization-api';
import { resolvePromptOptimizationStatsForMessage } from '@/stores/chat/prompt-optimization-stats';
import { hostApi } from '@/lib/host-api';

describe('prompt-optimization resolve + retry', () => {
  beforeEach(() => {
    vi.spyOn(hostApi.promptOptimization, 'summary').mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolvePromptOptimizationStatsForMessage matches runId and run- prefix', () => {
    const stats = {
      'uuid-run': { optimized: 10, total: 100, percent: 10 },
    };
    expect(resolvePromptOptimizationStatsForMessage({ id: 'uuid-run' }, stats)).toEqual(stats['uuid-run']);
    expect(resolvePromptOptimizationStatsForMessage({ id: 'run-uuid-run' }, stats)).toEqual(stats['uuid-run']);
    expect(resolvePromptOptimizationStatsForMessage({ id: 'other' }, stats)).toBeNull();
  });

  it('fetchPromptOptimizationSummaryWithRetry retries until data appears', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(hostApi.promptOptimization, 'summary');
    fetchMock
      .mockResolvedValueOnce({ summary: { optimized: 0, total: 0, percent: 0 } })
      .mockResolvedValueOnce({ summary: { optimized: 0, total: 0, percent: 0 } })
      .mockResolvedValueOnce({ summary: { optimized: 5, total: 50, percent: 10 } });

    const promise = fetchPromptOptimizationSummaryWithRetry('run-1');
    await vi.runAllTimersAsync();
    const summary = await promise;

    expect(summary).toEqual({ optimized: 5, total: 50, percent: 10 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});
