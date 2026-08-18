export const MIN_NODE_MAX_RUNTIME_MINUTES = 1;
export const MAX_NODE_MAX_RUNTIME_MINUTES = 10 * 24 * 60;

const ONE_DAY_MINUTES = 24 * 60;

/** 当前值所在区间的单次增减幅度（分钟）。 */
export function maxRuntimeStepDelta(currentMinutes: number): number {
  const v = Math.round(currentMinutes);
  if (v >= ONE_DAY_MINUTES) return ONE_DAY_MINUTES;
  if (v >= 120) return 60;
  if (v >= 60) return 30;
  return 10;
}

export function clampMaxRuntimeMinutes(raw: number): number {
  if (!Number.isFinite(raw)) return MIN_NODE_MAX_RUNTIME_MINUTES;
  const rounded = Math.round(raw);
  return Math.min(MAX_NODE_MAX_RUNTIME_MINUTES, Math.max(MIN_NODE_MAX_RUNTIME_MINUTES, rounded));
}

export function bumpMaxRuntimeMinutes(
  currentMinutes: number,
  direction: 'up' | 'down',
): number {
  const v = clampMaxRuntimeMinutes(currentMinutes);
  const delta = maxRuntimeStepDelta(v);
  if (direction === 'up') {
    return clampMaxRuntimeMinutes(v + delta);
  }
  return clampMaxRuntimeMinutes(v - delta);
}
