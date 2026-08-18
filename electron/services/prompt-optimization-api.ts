import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import {
  getActivePromptOptimizationRun,
  getPromptOptimizationSummary,
  recordPromptOptimizationDelta,
  registerPromptOptimizationRun,
} from '../api/prompt-optimization-store';
import { writePromptOptimizationActiveRunFile } from '../api/prompt-optimization-active-run-file';

export function createPromptOptimizationApi(): CompleteHostServiceRegistry['promptOptimization'] {
  return {
    activeRun: () => ({ success: true, active: getActivePromptOptimizationRun() }),
    registerRun: (payload) => {
      const sessionKey = payload?.sessionKey?.trim() ?? '';
      const runId = payload?.runId?.trim() ?? '';
      if (!sessionKey || !runId) {
        return { success: false, error: 'sessionKey and runId are required' };
      }
      registerPromptOptimizationRun(sessionKey, runId);
      try {
        writePromptOptimizationActiveRunFile(sessionKey, runId);
      } catch (error) {
        console.warn('[prompt-optimization] Failed to write active_run.json:', error);
      }
      return { success: true };
    },
    record: (payload) => {
      const runId = payload?.runId?.trim() ?? '';
      if (!runId) return { success: false, error: 'runId is required' };
      recordPromptOptimizationDelta(runId, payload);
      return { success: true };
    },
    summary: (payload) => {
      const runId = payload?.runId?.trim() ?? '';
      if (!runId) return { success: false, error: 'runId is required' };
      const summary = getPromptOptimizationSummary(runId);
      if (!summary) return { success: false, error: 'No stats for runId' };
      return { success: true, summary };
    },
  };
}
