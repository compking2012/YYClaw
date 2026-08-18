export type PublishPendingReview = {
  reviewNo: string;
  requestId?: number;
  skillId?: string;
  displayName?: string;
  version?: string;
  versionBase?: string;
};

export type PublishPendingIdentityInput = {
  skillId?: string;
  displayName?: string;
  versionBase?: string;
  requestId?: number;
};

function normalizeText(value?: string): string {
  return String(value || '').trim().toLowerCase();
}

/** Stable map key for a pending publish review (one row per review request / skill identity). */
export function publishPendingIdentity(input: PublishPendingIdentityInput): string {
  if (typeof input.requestId === 'number' && Number.isFinite(input.requestId)) {
    return `request:${input.requestId}`;
  }
  const versionBase = normalizeText(input.versionBase);
  if (versionBase) return `base:${versionBase}`;
  const displayName = normalizeText(input.displayName);
  if (displayName) return `name:${displayName}`;
  const skillId = input.skillId?.trim();
  if (skillId) return `skill:${skillId}`;
  return `local:${Date.now()}`;
}

export function findPublishPendingKey(
  records: Record<string, PublishPendingReview>,
  input: PublishPendingIdentityInput,
): string | undefined {
  if (typeof input.requestId === 'number') {
    const byRequest = Object.entries(records).find(([, record]) => record.requestId === input.requestId)?.[0];
    if (byRequest) return byRequest;
  }

  const versionBase = normalizeText(input.versionBase);
  if (versionBase) {
    const byBase = Object.entries(records).find(([, record]) => normalizeText(record.versionBase) === versionBase)?.[0];
    if (byBase) return byBase;
  }

  const displayName = normalizeText(input.displayName);
  if (displayName) {
    const byName = Object.entries(records).find(([, record]) => normalizeText(record.displayName) === displayName)?.[0];
    if (byName) return byName;
  }

  const skillId = input.skillId?.trim();
  if (skillId) {
    return Object.entries(records).find(([key, record]) => record.skillId === skillId || key === `skill:${skillId}`)?.[0];
  }

  return undefined;
}

function mergePublishPendingRecord(
  existing: PublishPendingReview | undefined,
  incoming: PublishPendingReview,
): PublishPendingReview {
  return {
    reviewNo: incoming.reviewNo || existing?.reviewNo || '—',
    requestId: incoming.requestId ?? existing?.requestId,
    skillId: incoming.skillId || existing?.skillId,
    displayName: incoming.displayName || existing?.displayName,
    version: incoming.version || existing?.version,
    versionBase: incoming.versionBase || existing?.versionBase,
  };
}

export function upsertPublishPendingRecord(
  records: Record<string, PublishPendingReview>,
  incoming: PublishPendingReview,
): Record<string, PublishPendingReview> {
  const identityInput: PublishPendingIdentityInput = {
    requestId: incoming.requestId,
    versionBase: incoming.versionBase,
    displayName: incoming.displayName,
    skillId: incoming.skillId,
  };
  const existingKey = findPublishPendingKey(records, identityInput);
  const nextKey = publishPendingIdentity(identityInput);
  const merged = mergePublishPendingRecord(existingKey ? records[existingKey] : undefined, incoming);
  const next = { ...records };
  if (existingKey && existingKey !== nextKey) {
    delete next[existingKey];
  }
  next[nextKey] = merged;
  return next;
}

export function buildPublishPendingFromReviewRequests(
  requests: Array<{
    id: number;
    review_no?: string;
    request_type?: string;
    status?: string;
    display_name?: string;
    version?: string;
    version_base?: string;
    published_skill_id?: string;
  }>,
): Record<string, PublishPendingReview> {
  let next: Record<string, PublishPendingReview> = {};
  const pendingPublish = requests
    .filter((request) => (request.request_type || 'publish') === 'publish' && request.status === 'pending')
    .sort((a, b) => a.id - b.id);

  for (const request of pendingPublish) {
    next = upsertPublishPendingRecord(next, {
      reviewNo: request.review_no || String(request.id),
      requestId: request.id,
      skillId: request.published_skill_id?.trim(),
      displayName: request.display_name,
      version: request.version,
      versionBase: request.version_base,
    });
  }
  return next;
}
