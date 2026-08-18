export type PromptOptimizationAccumulator = {
  sessionKey: string;
  before_chars: number;
  after_chars: number;
  saved_chars: number;
};

export type PromptOptimizationSummary = {
  optimized: number;
  total: number;
  percent: number;
};

export type ActivePromptOptimizationRun = {
  sessionKey: string;
  runId: string;
};

const accumulators = new Map<string, PromptOptimizationAccumulator>();
let activeRun: ActivePromptOptimizationRun | null = null;

export function registerPromptOptimizationRun(sessionKey: string, runId: string): void {
  if (!sessionKey || !runId) return;
  activeRun = { sessionKey, runId };
  accumulators.set(runId, {
    sessionKey,
    before_chars: 0,
    after_chars: 0,
    saved_chars: 0,
  });
}

export function getActivePromptOptimizationRun(): ActivePromptOptimizationRun | null {
  return activeRun;
}

export function recordPromptOptimizationDelta(
  runId: string,
  delta: { before_chars?: number; after_chars?: number; saved_chars?: number },
): void {
  if (!runId) return;
  const existing = accumulators.get(runId);
  const sessionKey = existing?.sessionKey ?? activeRun?.sessionKey ?? '';
  const acc: PromptOptimizationAccumulator = existing ?? {
    sessionKey,
    before_chars: 0,
    after_chars: 0,
    saved_chars: 0,
  };
  acc.before_chars += Math.max(0, Number(delta.before_chars) || 0);
  acc.after_chars += Math.max(0, Number(delta.after_chars) || 0);
  acc.saved_chars += Math.max(0, Number(delta.saved_chars) || 0);
  if (!acc.saved_chars && acc.before_chars > acc.after_chars) {
    acc.saved_chars = acc.before_chars - acc.after_chars;
  }
  accumulators.set(runId, acc);
}

export function getPromptOptimizationSummary(runId: string): PromptOptimizationSummary | null {
  const acc = accumulators.get(runId);
  if (!acc) return null;
  const total = acc.before_chars;
  const optimized = acc.saved_chars > 0 ? acc.saved_chars : Math.max(0, acc.before_chars - acc.after_chars);
  const percent = total > 0 ? Math.round((optimized / total) * 100) : 0;
  return { optimized, total, percent };
}

export function clearPromptOptimizationForSession(sessionKey: string): void {
  for (const [runId, acc] of accumulators.entries()) {
    if (acc.sessionKey === sessionKey) {
      accumulators.delete(runId);
    }
  }
  if (activeRun?.sessionKey === sessionKey) {
    activeRun = null;
  }
}

/** @internal test helper */
export function resetPromptOptimizationStore(): void {
  accumulators.clear();
  activeRun = null;
}
