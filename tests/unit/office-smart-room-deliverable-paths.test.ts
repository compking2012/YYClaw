import { describe, expect, it, vi } from 'vitest';

vi.mock('../../electron/services/office/project-context-paths', () => ({
  resolveRecordedProjectRoot: vi.fn(async () => '/proj'),
}));

vi.mock('../../electron/services/office/workflow-project-deliverable-fs', () => ({
  resolveDeliverablePathOnDisk: vi.fn(
    async (_root: string, rel: string) => `/proj/${rel.replace(/\/+$/u, '')}`,
  ),
}));

describe('resolveSmartMemberVerifiedDeliverableAbsolutePaths', () => {
  it('normalizes basename-only items before disk lookup (not naive project-root join)', async () => {
    const { resolveSmartMemberVerifiedDeliverableAbsolutePaths } = await import(
      '../../electron/services/office/smart-room-deliverable-paths'
    );
    const json = JSON.stringify({
      role: '开发',
      taskUnderstanding: '完成',
      action: 'end',
      deliverable: {
        items: ['report-开发.md'],
        outputValidation: ['-rw-r--r-- report-开发.md'],
      },
      dispatch: [{ role: '协调者', task: '验收' }],
    });
    const paths = await resolveSmartMemberVerifiedDeliverableAbsolutePaths({
      project: { id: 't1', title: 'demo' },
      memberDisplayName: '开发',
      raw: json,
    });
    expect(paths).toEqual(['/proj/交付物-开发/report-开发.md']);
    expect(paths).not.toContain('/proj/report-开发.md');
  });

  it('returns empty when JSON has no deliverable.items', async () => {
    const { resolveSmartMemberVerifiedDeliverableAbsolutePaths } = await import(
      '../../electron/services/office/smart-room-deliverable-paths'
    );
    const json = JSON.stringify({
      role: '开发',
      taskUnderstanding: '阻塞',
      action: 'help',
      deliverable: { items: [], outputValidation: [] },
      dispatch: [{ role: '协调者', task: '请确认上游' }],
    });
    expect(
      await resolveSmartMemberVerifiedDeliverableAbsolutePaths({
        project: { id: 't1', title: 'demo' },
        memberDisplayName: '开发',
        raw: json,
      }),
    ).toEqual([]);
  });
});
