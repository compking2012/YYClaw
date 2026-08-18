import { describe, expect, it } from 'vitest';
import {
  classifyWorkflowPostWaitFailure,
  normalizeRuntimePostWaitFailureIssues,
} from '@/lib/office-workflow-post-wait-failure';
import { buildWorkflowRoleStepFromValidationFailure } from '../../electron/services/office/workflow-role-step-outcome';

describe('classifyWorkflowPostWaitFailure', () => {
  it('routes terminal + empty body to runtime (output-retry)', () => {
    expect(
      classifyWorkflowPostWaitFailure({
        terminalErrorEnded: true,
        terminalError: 'LLM idle timeout (120s)',
        issues: ['empty'],
        raw: '',
      }),
    ).toBe('runtime');
  });

  it('routes terminal + invalid JSON body to format (format-retry)', () => {
    expect(
      classifyWorkflowPostWaitFailure({
        terminalErrorEnded: true,
        terminalError: 'stopReason=aborted',
        issues: ['invalid_json_syntax'],
        raw: '{not-json',
      }),
    ).toBe('format');
    expect(
      classifyWorkflowPostWaitFailure({
        terminalErrorEnded: true,
        issues: ['invalid_json_schema'],
        raw: 'not-json',
      }),
    ).toBe('format');
  });

  it('routes auth/quota terminal to fatal', () => {
    expect(
      classifyWorkflowPostWaitFailure({
        terminalErrorEnded: true,
        terminalError: 'invalid api key / unauthorized',
        issues: ['empty'],
        raw: '',
      }),
    ).toBe('fatal');
  });

  it('keeps non-terminal validation failures on format path', () => {
    expect(
      classifyWorkflowPostWaitFailure({
        terminalErrorEnded: false,
        issues: ['deliverable_paths_missing_on_disk'],
        raw: '{"role":"x"}',
      }),
    ).toBe('format');
  });

  it('normalizes runtime issues so node outputRetry can fire', () => {
    expect(normalizeRuntimePostWaitFailureIssues(['model_error', 'empty'])).toEqual(['empty']);
    expect(normalizeRuntimePostWaitFailureIssues(['model_error'])).toEqual(['empty']);
    const step = buildWorkflowRoleStepFromValidationFailure({
      roleId: 'qa',
      issues: normalizeRuntimePostWaitFailureIssues(['empty']),
      detail: 'LLM idle timeout',
      outputRetryAttempts: 0,
      transportReason: 'empty',
    });
    expect(step.outputRetry).toBe(true);
    expect(step.status).toBe('pending');
  });
});
