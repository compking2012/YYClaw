const TRACKED_PENDING_REVIEW_REQUEST_IDS_KEY = 'skills.marketplace.trackedPendingReviewRequestIds.v1';
const NOTIFIED_REVIEW_OUTCOMES_KEY = 'skills.marketplace.notifiedReviewOutcomes.v1';

export type ReviewRequestSnapshot = {
  id: number;
  request_type?: 'publish' | 'unlist' | string;
  status?: 'pending' | 'approved' | 'rejected' | string;
  display_name?: string;
  target_skill_id?: string;
  published_skill_id?: string;
  version?: string;
  review_comments?: string;
};

export type MissedReviewNotification = {
  requestId: number;
  status: 'approved' | 'rejected';
  requestType: 'publish' | 'unlist';
  displayName?: string;
  skillId?: string;
  version?: string;
  comments?: string;
};

function readNumberSet(key: string): Set<number> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || '[]') as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)));
  } catch {
    return new Set();
  }
}

function writeNumberSet(key: string, ids: ReadonlySet<number>): void {
  try {
    window.localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    // Ignore localStorage failures.
  }
}

function readStringSet(key: string): Set<string> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || '[]') as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === 'string' && value.length > 0));
  } catch {
    return new Set();
  }
}

function writeStringSet(key: string, values: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(key, JSON.stringify([...values]));
  } catch {
    // Ignore localStorage failures.
  }
}

export function reviewOutcomeKey(requestId: number, status: string): string {
  return `${requestId}:${status}`;
}

export function readTrackedPendingReviewRequestIds(): Set<number> {
  return readNumberSet(TRACKED_PENDING_REVIEW_REQUEST_IDS_KEY);
}

export function writeTrackedPendingReviewRequestIds(ids: ReadonlySet<number>): void {
  writeNumberSet(TRACKED_PENDING_REVIEW_REQUEST_IDS_KEY, ids);
}

export function readNotifiedReviewOutcomes(): Set<string> {
  return readStringSet(NOTIFIED_REVIEW_OUTCOMES_KEY);
}

export function writeNotifiedReviewOutcomes(values: ReadonlySet<string>): void {
  writeStringSet(NOTIFIED_REVIEW_OUTCOMES_KEY, values);
}

export function trackPendingReviewRequestId(requestId: number): void {
  if (!Number.isFinite(requestId)) return;
  const next = readTrackedPendingReviewRequestIds();
  next.add(requestId);
  writeTrackedPendingReviewRequestIds(next);
}

export function isReviewOutcomeNotified(requestId: number, status: string): boolean {
  return readNotifiedReviewOutcomes().has(reviewOutcomeKey(requestId, status));
}

export function markReviewOutcomeNotified(requestId: number, status: string): void {
  if (!Number.isFinite(requestId)) return;
  const notified = readNotifiedReviewOutcomes();
  notified.add(reviewOutcomeKey(requestId, status));
  writeNotifiedReviewOutcomes(notified);

  const tracked = readTrackedPendingReviewRequestIds();
  tracked.delete(requestId);
  writeTrackedPendingReviewRequestIds(tracked);
}

export function shouldNotifyReviewOutcome(requestId: number | undefined, status: string | undefined): requestId is number {
  if (typeof requestId !== 'number' || !Number.isFinite(requestId)) return false;
  if (status !== 'approved' && status !== 'rejected') return false;
  return !isReviewOutcomeNotified(requestId, status);
}

export function collectMissedReviewNotifications(
  requests: ReviewRequestSnapshot[],
  trackedPendingIds: ReadonlySet<number>,
  notifiedOutcomes: ReadonlySet<string>,
): { notifications: MissedReviewNotification[]; nextTrackedPendingIds: Set<number> } {
  const nextTrackedPendingIds = new Set(trackedPendingIds);
  const notifications: MissedReviewNotification[] = [];

  for (const request of requests) {
    if (!Number.isFinite(request.id)) continue;

    if (request.status === 'pending') {
      nextTrackedPendingIds.add(request.id);
      continue;
    }
    if (request.status !== 'approved' && request.status !== 'rejected') continue;

    const outcomeKey = reviewOutcomeKey(request.id, request.status);
    if (notifiedOutcomes.has(outcomeKey)) continue;
    if (!nextTrackedPendingIds.has(request.id)) continue;

    notifications.push({
      requestId: request.id,
      status: request.status,
      requestType: request.request_type === 'unlist' ? 'unlist' : 'publish',
      displayName: request.display_name,
      skillId: request.target_skill_id?.trim() || request.published_skill_id?.trim(),
      version: request.version,
      comments: request.review_comments?.trim(),
    });
    nextTrackedPendingIds.delete(request.id);
  }

  return { notifications, nextTrackedPendingIds };
}

export function persistMissedReviewNotificationState(
  notifications: MissedReviewNotification[],
  nextTrackedPendingIds: ReadonlySet<number>,
): void {
  writeTrackedPendingReviewRequestIds(nextTrackedPendingIds);
  if (notifications.length === 0) return;
  const notified = readNotifiedReviewOutcomes();
  for (const notification of notifications) {
    notified.add(reviewOutcomeKey(notification.requestId, notification.status));
  }
  writeNotifiedReviewOutcomes(notified);
}
