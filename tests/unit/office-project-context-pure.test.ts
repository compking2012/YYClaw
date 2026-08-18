import { describe, expect, it } from 'vitest';
import {
  appendNdjsonLine,
  filterRecordsByEpoch,
  formatRoleStatusForPrompt,
  formatStatusTimeSeconds,
  isLegacyProjectDirName,
  lastRecordForEpoch,
  legacyProjectDirSegment,
  parseNdjsonLines,
  projectDirSegment,
} from '@/lib/office-project-context';

describe('office-project-context pure helpers', () => {
  it('projectDirSegment and legacyProjectDirSegment', () => {
    expect(projectDirSegment('标题', 'proj-1')).toBe('proj-1');
    expect(legacyProjectDirSegment('五子棋', 'proj-1')).toContain('proj-1');
    expect(isLegacyProjectDirName('五子棋-proj-1', 'proj-1')).toBe(true);
    expect(isLegacyProjectDirName('proj-1', 'proj-1')).toBe(false);
  });

  it('formatStatusTimeSeconds pads date parts', () => {
    const ms = new Date(2026, 0, 2, 3, 4, 5).getTime();
    const formatted = formatStatusTimeSeconds(ms);
    expect(formatted).toMatch(/^2026-01-02 03:04:05$/);
  });

  it('parseNdjsonLines skips blank and corrupt lines', () => {
    const raw = ['{"a":1}', '', 'bad', '{"b":2}'].join('\n');
    expect(parseNdjsonLines<{ a?: number; b?: number }>(raw)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('appendNdjsonLine appends with trailing newline', () => {
    expect(appendNdjsonLine('', { x: 1 })).toBe('{"x":1}\n');
    expect(appendNdjsonLine('{"a":1}\n', { b: 2 })).toBe('{"a":1}\n{"b":2}\n');
  });

  it('filterRecordsByEpoch and lastRecordForEpoch', () => {
    const records = [
      { epoch: 1, v: 'a' },
      { epoch: 2, v: 'b' },
      { epoch: 2, v: 'c' },
    ];
    expect(filterRecordsByEpoch(records, 2)).toEqual([
      { epoch: 2, v: 'b' },
      { epoch: 2, v: 'c' },
    ]);
    expect(lastRecordForEpoch(records, 2)).toEqual({ epoch: 2, v: 'c' });
    expect(lastRecordForEpoch(records, 9)).toBeNull();
  });

  it('formatRoleStatusForPrompt renders role line', () => {
    expect(
      formatRoleStatusForPrompt({
        任务: 't',
        role: '开发',
        roleId: 'dev',
        time: '2026-01-01',
        工作进展: '模块完成',
        epoch: 1,
      }),
    ).toBe('【开发】2026-01-01：模块完成');
  });
});
