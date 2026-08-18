import { describe, it, expect } from 'vitest';
import { buildDeliverablePathsRoomContent } from '../../src/lib/office-room-deliver';

describe('buildDeliverablePathsRoomContent (req ③: sync full deliverable paths to room)', () => {
  const role = { displayName: '稿件审查师' };

  it('lists absolute paths under a labelled header', () => {
    const out = buildDeliverablePathsRoomContent(role, [
      '/Users/x/.openclaw/office/project/GPGPU-p1/交付物-稿件审查师/稿件审查-稿件审查师.md',
    ]);
    expect(out).toBe(
      '🤖 【稿件审查师】📎 交付物完整路径\n/Users/x/.openclaw/office/project/GPGPU-p1/交付物-稿件审查师/稿件审查-稿件审查师.md',
    );
  });

  it('dedupes and trims paths, preserving order', () => {
    const out = buildDeliverablePathsRoomContent(role, [
      '  /abs/a.md  ',
      '/abs/b',
      '/abs/a.md',
    ]);
    expect(out).toBe('🤖 【稿件审查师】📎 交付物完整路径\n/abs/a.md\n/abs/b');
  });

  it('returns null when there are no non-empty paths', () => {
    expect(buildDeliverablePathsRoomContent(role, [])).toBeNull();
    expect(buildDeliverablePathsRoomContent(role, ['   ', ''])).toBeNull();
  });
});
