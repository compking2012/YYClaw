import { describe, expect, it } from 'vitest';
import {
  completionFollowUpDismissStamp,
  completionFollowUpForArchivedCompletedReopen,
  isCompletionFollowUpPending,
  mergeCompletionFollowUpFields,
} from '@/lib/office-project-completion-follow-up';
import {
  isOfficeFixedGroupProjectAutoArchive,
  isOfficeStandaloneAwaitingArchivePrompt,
} from '@/lib/office-project-lifecycle';

describe('office-project-completion-follow-up', () => {
  it('stamps lastRunCompletedAt when status transitions to completed', () => {
    const merged = mergeCompletionFollowUpFields(
      { status: 'running', lastRunCompletedAt: undefined, completionFollowUpHandledAt: undefined },
      { status: 'completed', lastRunCompletedAt: undefined, completionFollowUpHandledAt: undefined },
    );
    expect(merged.lastRunCompletedAt).toBeGreaterThan(0);
    expect(merged.completionFollowUpHandledAt).toBeUndefined();
  });

  it('clears stamps when leaving completed', () => {
    const merged = mergeCompletionFollowUpFields(
      {
        status: 'completed',
        lastRunCompletedAt: 100,
        completionFollowUpHandledAt: 100,
      },
      { status: 'pending', lastRunCompletedAt: 100, completionFollowUpHandledAt: 100 },
    );
    expect(merged.lastRunCompletedAt).toBeUndefined();
    expect(merged.completionFollowUpHandledAt).toBeUndefined();
  });

  it('treats handledAt >= lastRunCompletedAt as no longer pending', () => {
    const base = {
      status: 'completed' as const,
      lifecycle: 'active' as const,
      lastRunCompletedAt: 1_000,
      completionFollowUpHandledAt: 1_000,
    };
    expect(isCompletionFollowUpPending(base)).toBe(false);
    expect(
      isOfficeStandaloneAwaitingArchivePrompt({ ...base, origin: 'standalone' }),
    ).toBe(false);
    expect(
      isOfficeFixedGroupProjectAutoArchive({ ...base, origin: 'fixed_group' }),
    ).toBe(false);
  });

  it('pending again when a new completion epoch is newer than handledAt', () => {
    expect(
      isCompletionFollowUpPending({
        status: 'completed',
        lifecycle: 'active',
        lastRunCompletedAt: 2_000,
        completionFollowUpHandledAt: 1_000,
      }),
    ).toBe(true);
  });

  it('dismiss stamp prefers lastRunCompletedAt', () => {
    expect(
      completionFollowUpDismissStamp({ lastRunCompletedAt: 42 }),
    ).toBe(42);
  });

  it('archived completed reopen marks follow-up handled without new completion', () => {
    const reopened = completionFollowUpForArchivedCompletedReopen(
      { lastRunCompletedAt: 9_000 },
      10_000,
    );
    expect(reopened).toEqual({
      lastRunCompletedAt: 9_000,
      completionFollowUpHandledAt: 9_000,
    });
    expect(
      isOfficeFixedGroupProjectAutoArchive({
        origin: 'fixed_group',
        status: 'completed',
        lifecycle: 'active',
        ...reopened,
      }),
    ).toBe(false);
    expect(
      isOfficeStandaloneAwaitingArchivePrompt({
        origin: 'standalone',
        status: 'completed',
        lifecycle: 'active',
        ...reopened,
      }),
    ).toBe(false);
  });
});
