import { describe, expect, it } from 'vitest';
import {
  declaredDeliverablePathsFromSmartItems,
  declaredDeliverablePathsFromSmartMemberJson,
  declaredDeliverablePathsFromWorkflowJson,
  deliverableDiskLookupAbsPaths,
  normalizeDeliverablePathForDisk,
} from '@/lib/office-deliverable-disk-resolve';
import { smartJsonToBracketText } from '@/lib/office-smart-json-schema';

describe('office-deliverable-disk-resolve', () => {
  const root = '/tmp/project-root';
  const role = '产品经理';

  it('lookup order: project root first, then role-scoped dir', () => {
    const rel = '需求设计-产品经理.md';
    expect(deliverableDiskLookupAbsPaths(root, rel, role)).toEqual([
      `${root}/${rel}`,
      `${root}/交付物-产品经理/${rel}`,
    ]);
  });

  it('keeps deliverable.path with role dir prefix unchanged for first lookup', () => {
    const rel = '交付物-产品经理/需求设计-产品经理.md';
    expect(deliverableDiskLookupAbsPaths(root, rel, role)).toEqual([
      `${root}/${rel}`,
      `${root}/交付物-产品经理/${rel}`,
    ]);
  });

  it('workflow json uses deliverable.path only', () => {
    expect(
      declaredDeliverablePathsFromWorkflowJson({
        deliverable: { path: '交付物-产品经理/需求设计-产品经理.md' },
      }),
    ).toEqual(['交付物-产品经理/需求设计-产品经理.md']);
  });

  it('smart items map to deliverable paths without rewriting', () => {
    expect(
      declaredDeliverablePathsFromSmartItems([
        '交付物-AI-Agent工程专家/方案.md',
        '  ',
      ]),
    ).toEqual(['交付物-AI-Agent工程专家/方案.md']);
  });

  it('normalize trims and strips leading ./ only', () => {
    expect(normalizeDeliverablePathForDisk('./foo/bar.md')).toBe('foo/bar.md');
  });

  it('declaredDeliverablePathsFromSmartMemberJson reads JSON deliverable.items only', () => {
    const json = JSON.stringify({
      role: '大模型调优专家',
      taskUnderstanding: '落盘',
      action: 'end',
      deliverable: {
        items: ['交付物-大模型调优专家/机会与未来展望调研-大模型调优专家.md'],
        outputValidation: ['-rw-r--r-- report.md'],
      },
      dispatch: [{ role: '协调者', task: '验收' }],
    });
    expect(declaredDeliverablePathsFromSmartMemberJson(json)).toEqual([
      '交付物-大模型调优专家/机会与未来展望调研-大模型调优专家.md',
    ]);
    const bracket = smartJsonToBracketText(JSON.parse(json), false);
    expect(declaredDeliverablePathsFromSmartMemberJson(bracket)).toEqual([]);
  });
});
