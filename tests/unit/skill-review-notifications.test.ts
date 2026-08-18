import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  collectMissedReviewNotifications,
  markReviewOutcomeNotified,
  readNotifiedReviewOutcomes,
  readTrackedPendingReviewRequestIds,
  reviewOutcomeKey,
  trackPendingReviewRequestId,
  writeNotifiedReviewOutcomes,
  writeTrackedPendingReviewRequestIds,
} from '@/lib/skill-review-notifications';

describe('skill-review-notifications', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      store: {} as Record<string, string>,
      getItem(key: string) {
        return this.store[key] ?? null;
      },
      setItem(key: string, value: string) {
        this.store[key] = value;
      },
      removeItem(key: string) {
        delete this.store[key];
      },
      clear() {
        this.store = {};
      },
    });
    writeTrackedPendingReviewRequestIds(new Set());
    writeNotifiedReviewOutcomes(new Set());
  });

  it('collects missed notifications only for tracked pending requests', () => {
    trackPendingReviewRequestId(7);
    const { notifications } = collectMissedReviewNotifications(
      [
        { id: 7, request_type: 'publish', status: 'approved', display_name: 'demo', version: '1.0.0' },
        { id: 8, request_type: 'publish', status: 'approved', display_name: 'other' },
      ],
      readTrackedPendingReviewRequestIds(),
      readNotifiedReviewOutcomes(),
    );

    expect(notifications).toEqual([
      {
        requestId: 7,
        status: 'approved',
        requestType: 'publish',
        displayName: 'demo',
        skillId: undefined,
        version: '1.0.0',
        comments: undefined,
      },
    ]);
  });

  it('tracks pending requests discovered during sync', () => {
    const { notifications, nextTrackedPendingIds } = collectMissedReviewNotifications(
      [{ id: 9, request_type: 'unlist', status: 'pending', target_skill_id: 'demo-skill' }],
      new Set(),
      new Set(),
    );

    expect(notifications).toEqual([]);
    expect([...nextTrackedPendingIds]).toEqual([9]);
  });

  it('marks outcomes as notified and untracks pending ids', () => {
    trackPendingReviewRequestId(11);
    markReviewOutcomeNotified(11, 'rejected');

    expect(readNotifiedReviewOutcomes().has(reviewOutcomeKey(11, 'rejected'))).toBe(true);
    expect(readTrackedPendingReviewRequestIds().has(11)).toBe(false);
  });
});
