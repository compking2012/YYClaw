import { describe, expect, it } from 'vitest';
import {
  buildPublishPendingFromReviewRequests,
  publishPendingIdentity,
  upsertPublishPendingRecord,
} from '../../src/lib/skill-publish-pending';

describe('skill-publish-pending', () => {
  it('uses request id as the primary pending identity key', () => {
    expect(
      publishPendingIdentity({
        requestId: 4,
        skillId: 'enterprise-storage-memory-2_0_0',
        versionBase: 'enterprise-storage-memory',
        displayName: 'enterprise-storage-memory',
      }),
    ).toBe('request:4');
  });

  it('upserts duplicate pending submissions for the same review request', () => {
    let records = upsertPublishPendingRecord({}, {
      reviewNo: 'fanqirong_PF5POQZZ_20260622_4',
      requestId: 4,
      displayName: 'enterprise-storage-memory',
      version: '2.0.0',
      versionBase: 'enterprise-storage-memory',
    });

    records = upsertPublishPendingRecord(records, {
      reviewNo: 'fanqirong_PF5POQZZ_20260622_4',
      requestId: 4,
      displayName: 'enterprise-storage-memory',
    });

    expect(Object.keys(records)).toEqual(['request:4']);
    expect(records['request:4']).toMatchObject({
      reviewNo: 'fanqirong_PF5POQZZ_20260622_4',
      requestId: 4,
      displayName: 'enterprise-storage-memory',
      version: '2.0.0',
      versionBase: 'enterprise-storage-memory',
    });
  });

  it('merges server sync rows without creating duplicate pending cards', () => {
    const records = buildPublishPendingFromReviewRequests([
      {
        id: 4,
        review_no: 'fanqirong_PF5POQZZ_20260622_4',
        request_type: 'publish',
        status: 'pending',
        display_name: 'enterprise-storage-memory',
        version: '2.0.0',
        version_base: 'enterprise-storage-memory',
        published_skill_id: 'enterprise-storage-memory-2_0_0',
      },
    ]);

    expect(Object.keys(records)).toEqual(['request:4']);
  });
});
