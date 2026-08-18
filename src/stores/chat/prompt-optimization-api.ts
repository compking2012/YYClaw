import { hostApi } from '@/lib/host-api';
import type { TurnPromptOptimizationStats } from './types';

export { resolvePromptOptimizationStatsForMessage } from './prompt-optimization-stats';

const SUMMARY_RETRY_DELAYS_MS = [0, 300, 800];

export async function registerPromptOptimizationRun(sessionKey: string, runId: string): Promise<void> {
  try {
    await hostApi.promptOptimization.registerRun({ sessionKey, runId });
  } catch {
    // Non-fatal: UI stats are best-effort.
  }
}

export async function fetchPromptOptimizationSummary(runId: string): Promise<TurnPromptOptimizationStats | null> {
  try {
    const response = await hostApi.promptOptimization.summary({ runId }) as {
      success?: boolean;
      summary?: TurnPromptOptimizationStats;
    };
    if (!response.summary || response.summary.total <= 0) return null;
    return response.summary;
  } catch {
    return null;
  }
}

export async function fetchPromptOptimizationSummaryWithRetry(
  runId: string,
): Promise<TurnPromptOptimizationStats | null> {
  for (const delayMs of SUMMARY_RETRY_DELAYS_MS) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    const summary = await fetchPromptOptimizationSummary(runId);
    if (summary) return summary;
  }
  return null;
}

