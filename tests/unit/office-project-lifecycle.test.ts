import { describe, expect, it } from 'vitest';
import {
  isOfficeFixedGroupProjectAutoArchive,
  isOfficeProjectAwaitingArchive,
  isOfficeStandaloneAwaitingArchivePrompt,
  isOfficeStandaloneDissolvedUpgrade,
  isOfficeStandaloneUpgradeEligible,
} from '@/lib/office-project-lifecycle';

describe('office-project-lifecycle', () => {
  it('detects completed run awaiting user archive decision', () => {
    expect(
      isOfficeProjectAwaitingArchive({ status: 'completed', lifecycle: 'active' }),
    ).toBe(true);
    expect(
      isOfficeProjectAwaitingArchive({ status: 'completed', lifecycle: 'completed' }),
    ).toBe(false);
    expect(
      isOfficeProjectAwaitingArchive({ status: 'running', lifecycle: 'active' }),
    ).toBe(false);
  });

  it('splits completion handling by project origin', () => {
    const completedActive = {
      status: 'completed' as const,
      lifecycle: 'active' as const,
      lastRunCompletedAt: 1_000,
      completionFollowUpHandledAt: undefined,
    };
    expect(
      isOfficeStandaloneAwaitingArchivePrompt({ ...completedActive, origin: 'standalone' }),
    ).toBe(true);
    expect(
      isOfficeFixedGroupProjectAutoArchive({ ...completedActive, origin: 'fixed_group' }),
    ).toBe(true);
    expect(
      isOfficeStandaloneAwaitingArchivePrompt({ ...completedActive, origin: 'fixed_group' }),
    ).toBe(false);
    expect(
      isOfficeFixedGroupProjectAutoArchive({ ...completedActive, origin: 'standalone' }),
    ).toBe(false);
  });

  it('does not prompt or auto-archive after follow-up handled for current run', () => {
    const handled = {
      status: 'completed' as const,
      lifecycle: 'active' as const,
      lastRunCompletedAt: 2_000,
      completionFollowUpHandledAt: 2_000,
    };
    expect(
      isOfficeStandaloneAwaitingArchivePrompt({ ...handled, origin: 'standalone' }),
    ).toBe(false);
    expect(
      isOfficeFixedGroupProjectAutoArchive({ ...handled, origin: 'fixed_group' }),
    ).toBe(false);
  });

  it('detects standalone projects eligible for fixed-group upgrade', () => {
    const base = {
      origin: 'standalone' as const,
      status: 'completed' as const,
    };
    expect(isOfficeStandaloneUpgradeEligible({ ...base, lifecycle: 'active' })).toBe(true);
    expect(isOfficeStandaloneUpgradeEligible({ ...base, lifecycle: 'completed' })).toBe(true);
    expect(
      isOfficeStandaloneUpgradeEligible({
        origin: 'standalone',
        status: 'aborted',
        lifecycle: 'completed',
      }),
    ).toBe(false);
    expect(isOfficeStandaloneUpgradeEligible({ ...base, lifecycle: 'upgraded' })).toBe(false);
    expect(isOfficeStandaloneUpgradeEligible({ ...base, lifecycle: 'dissolved' })).toBe(true);
    expect(
      isOfficeStandaloneUpgradeEligible({
        origin: 'standalone',
        status: 'aborted',
        lifecycle: 'dissolved',
      }),
    ).toBe(true);
    expect(
      isOfficeStandaloneDissolvedUpgrade({
        origin: 'standalone',
        lifecycle: 'dissolved',
      }),
    ).toBe(true);
    expect(
      isOfficeStandaloneDissolvedUpgrade({
        origin: 'standalone',
        lifecycle: 'completed',
      }),
    ).toBe(false);
    expect(
      isOfficeStandaloneUpgradeEligible({
        origin: 'fixed_group',
        status: 'completed',
        lifecycle: 'completed',
      }),
    ).toBe(false);
    expect(
      isOfficeStandaloneUpgradeEligible({
        ...base,
        status: 'failed',
        lifecycle: 'active',
      }),
    ).toBe(false);
  });
});
