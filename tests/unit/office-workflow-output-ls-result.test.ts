import { describe, expect, it } from 'vitest';
import {
  extractLsLinePathSuffix,
  isDirectoryLsLine,
  isLsLine,
  isRegularFileLsLine,
  isWorkflowLsResultAbsolutePath,
  isWorkflowLsTargetPathInvalid,
  lsLineBasename,
  lsResultPathMatchesWorkflowTarget,
  normalizeWorkflowLsTarget,
} from '../../src/lib/office-workflow-output-ls-result';

describe('office-workflow-output-ls-result', () => {
  const fileLine =
    '-rw-r--r--  1 user  staff  2048 Mar  9 10:00 ./交付物-开发/report-开发.html';
  const dirLine = 'drwxr-xr-x  2 user  staff    64 Mar  9 10:00 ./交付物-开发';

  it('classifies ls lines', () => {
    expect(isLsLine(fileLine)).toBe(true);
    expect(isRegularFileLsLine(fileLine)).toBe(true);
    expect(isDirectoryLsLine(dirLine)).toBe(true);
    expect(isLsLine('not ls')).toBe(false);
  });

  it('extracts path suffix and basename', () => {
    expect(extractLsLinePathSuffix(fileLine)).toContain('report-开发.html');
    expect(lsLineBasename(fileLine)).toBe('report-开发.html');
    expect(normalizeWorkflowLsTarget('./交付物-开发/')).toBe('交付物-开发');
  });

  it('validates ls targets and absolute paths', () => {
    expect(isWorkflowLsTargetPathInvalid('../escape')).toBe(true);
    expect(isWorkflowLsTargetPathInvalid('交付物-开发/a.html')).toBe(false);
    expect(isWorkflowLsResultAbsolutePath('/tmp/x')).toBe(true);
    expect(isWorkflowLsResultAbsolutePath('交付物-开发/a.html')).toBe(false);
  });

  it('matches ls result paths to workflow targets', () => {
    expect(
      lsResultPathMatchesWorkflowTarget(
        './交付物-开发/report-开发.html',
        '交付物-开发/report-开发.html',
      ),
    ).toBe(true);
  });
});

describe('office-workflow-output-ls-result · validation helpers', () => {
  it('runtime lsResult validators are disabled (always valid)', async () => {
    const {
      isInputValidationLsResultInvalid,
    } = await import('../../src/lib/office-workflow-input-validation');
    const {
      isOutputValidationLsResultInvalid,
      isWorkflowLsResultsArrayInvalid,
      isWorkflowTargetLsResultEntryInvalid,
      lsLineMatchesWorkflowTarget,
      workflowLsResultArraysAligned,
    } = await import('../../src/lib/office-workflow-output-ls-result');
    const line =
      '-rw-r--r--  1 u  staff  10 Mar  9 10:00 ./交付物-开发/report-开发.html';
    const winLine =
      '-a----         2026/7/14     17:51           3854 report-开发.html';
    expect(lsLineMatchesWorkflowTarget(line, '交付物-开发/report-开发.html')).toBe(true);
    expect(workflowLsResultArraysAligned(['a'], ['b'])).toBe(true);
    expect(isWorkflowTargetLsResultEntryInvalid('交付物-开发/report-开发.html', line)).toBe(false);
    expect(isWorkflowLsResultsArrayInvalid(['交付物-开发/report-开发.html'], [winLine])).toBe(false);
    expect(isOutputValidationLsResultInvalid(['交付物-开发/report-开发.html'], [])).toBe(false);
    expect(isInputValidationLsResultInvalid(['a.md'], ['ok'])).toBe(false);
    expect(isInputValidationLsResultInvalid([], ['noise'])).toBe(false);
  });
});
