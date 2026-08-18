import { describe, expect, it, beforeEach } from 'vitest';
import {
  getPromptOptimizationSummary,
  recordPromptOptimizationDelta,
  registerPromptOptimizationRun,
  resetPromptOptimizationStore,
} from '../../electron/api/prompt-optimization-store';

describe('prompt-optimization-store', () => {
  beforeEach(() => {
    resetPromptOptimizationStore();
  });

  it('accumulates stats across multiple LLM calls in one run', () => {
    registerPromptOptimizationRun('agent:main:main', 'run-1');
    recordPromptOptimizationDelta('run-1', {
      before_chars: 1000,
      after_chars: 800,
      saved_chars: 200,
    });
    recordPromptOptimizationDelta('run-1', {
      before_chars: 500,
      after_chars: 400,
      saved_chars: 100,
    });

    const summary = getPromptOptimizationSummary('run-1');
    expect(summary).toEqual({
      optimized: 300,
      total: 1500,
      percent: 20,
    });
  });

  it('returns null summary when run was never recorded', () => {
    expect(getPromptOptimizationSummary('missing-run')).toBeNull();
  });

  it('computes zero percent when before_chars is zero', () => {
    registerPromptOptimizationRun('agent:main:main', 'run-empty');
    recordPromptOptimizationDelta('run-empty', { before_chars: 0, after_chars: 0, saved_chars: 0 });
    expect(getPromptOptimizationSummary('run-empty')).toEqual({
      optimized: 0,
      total: 0,
      percent: 0,
    });
  });
});
