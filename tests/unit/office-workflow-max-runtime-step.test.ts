import { describe, expect, it } from 'vitest';
import {
  bumpMaxRuntimeMinutes,
  clampMaxRuntimeMinutes,
  maxRuntimeStepDelta,
  MAX_NODE_MAX_RUNTIME_MINUTES,
  MIN_NODE_MAX_RUNTIME_MINUTES,
} from '@/lib/office-workflow-max-runtime-step';

describe('office-workflow-max-runtime-step', () => {
  it('clamps to 1..10 days in minutes', () => {
    expect(clampMaxRuntimeMinutes(0)).toBe(MIN_NODE_MAX_RUNTIME_MINUTES);
    expect(clampMaxRuntimeMinutes(99999)).toBe(MAX_NODE_MAX_RUNTIME_MINUTES);
  });

  it('uses tiered step deltas', () => {
    expect(maxRuntimeStepDelta(55)).toBe(10);
    expect(maxRuntimeStepDelta(60)).toBe(30);
    expect(maxRuntimeStepDelta(120)).toBe(60);
    expect(maxRuntimeStepDelta(24 * 60)).toBe(24 * 60);
  });

  it('bumps below 60 minutes by 10', () => {
    expect(bumpMaxRuntimeMinutes(55, 'down')).toBe(45);
    expect(bumpMaxRuntimeMinutes(55, 'up')).toBe(65);
  });

  it('bumps from 65 to 95 by 30', () => {
    expect(bumpMaxRuntimeMinutes(65, 'up')).toBe(95);
  });

  it('does not go below minimum or above maximum', () => {
    expect(bumpMaxRuntimeMinutes(1, 'down')).toBe(1);
    expect(bumpMaxRuntimeMinutes(MAX_NODE_MAX_RUNTIME_MINUTES, 'up')).toBe(
      MAX_NODE_MAX_RUNTIME_MINUTES,
    );
  });
});
