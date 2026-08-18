import { describe, expect, it } from 'vitest';
import { applyOfficeRunTerminalAssistantMessage } from '../../electron/services/office/run-completion';
import {
  appendGatewayTerminalErrorDetail,
  classifyGatewayRunTerminalError,
} from '../../electron/services/office/gateway-run-error';
import {
  applyOfficeRunRuntimeEvent,
  createOfficeRunTracker,
  isGatewayRunPhaseSettleSignal,
  isOfficeRunCompletePhase,
} from '../../electron/services/office/session-run-settle';

describe('gateway-run-error', () => {
  it('classifies non_deliverable_terminal_turn as retryable', () => {
    expect(
      classifyGatewayRunTerminalError({ terminalError: 'non_deliverable_terminal_turn' }).kind,
    ).toBe('retryable');
  });

  it('classifies quota and network errors as non_retryable', () => {
    expect(
      classifyGatewayRunTerminalError({ runError: 'insufficient quota for provider' }).kind,
    ).toBe('non_retryable');
    expect(
      classifyGatewayRunTerminalError({ runError: 'ECONNREFUSED connect failed' }).kind,
    ).toBe('non_retryable');
  });

  it('defaults unknown terminal errors to non_retryable', () => {
    expect(classifyGatewayRunTerminalError({ terminalError: 'mystery_code' }).kind).toBe(
      'non_retryable',
    );
    expect(classifyGatewayRunTerminalError({}).kind).toBe('non_retryable');
  });

  it('appendGatewayTerminalErrorDetail adds gateway terminal suffix', () => {
    expect(appendGatewayTerminalErrorDetail('未收到模型正文', 'non_deliverable_terminal_turn')).toContain(
      'non_deliverable_terminal_turn',
    );
  });

  it('appendGatewayTerminalErrorDetail does not skip when cause is a substring of primary detail', () => {
    expect(appendGatewayTerminalErrorDetail('模型会话调用异常', '异常')).toBe(
      '模型会话调用异常\n模型运行结束但未产出可校验回复：异常',
    );
  });

  it('appendGatewayTerminalErrorDetail is idempotent for exact suffix and equal primary', () => {
    const once = appendGatewayTerminalErrorDetail('未收到模型正文', 'rate_limit');
    expect(appendGatewayTerminalErrorDetail(once, 'rate_limit')).toBe(once);
    expect(appendGatewayTerminalErrorDetail('rate_limit', 'rate_limit')).toBe('rate_limit');
  });
});

describe('applyOfficeRunTerminalAssistantMessage', () => {
  it('marks terminal assistant error even after intermediate state=error set pendingRetry', () => {
    const tracker = createOfficeRunTracker('run-1');
    tracker.pendingRetry = true;
    applyOfficeRunTerminalAssistantMessage(tracker, {
      role: 'assistant',
      stopReason: 'error',
      errorMessage: 'Connection error.',
      content: 'partial',
    });
    expect(tracker.pendingRetry).toBe(false);
    expect(tracker.terminalErrorEnded).toBe(true);
    expect(tracker.runComplete).toBe(true);
    expect(tracker.terminalError).toBe('Connection error.');
  });
});

describe('session-run-settle terminal error phases', () => {
  it('treats lifecycle phase=error as terminal error ended via run.ended', () => {
    const tracker = createOfficeRunTracker('run-1');
    applyOfficeRunRuntimeEvent(tracker, {
      type: 'run.ended',
      runId: 'run-1',
      status: 'error',
      error: 'model provider unavailable',
    });
    expect(tracker.runComplete).toBe(true);
    expect(tracker.terminalErrorEnded).toBe(true);
    expect(tracker.terminalError).toBe('model provider unavailable');
  });

  it('treats run.ended status=aborted as terminal error ended', () => {
    const tracker = createOfficeRunTracker('run-1');
    applyOfficeRunRuntimeEvent(tracker, {
      type: 'run.ended',
      runId: 'run-1',
      status: 'aborted',
      error: 'user cancelled',
    });
    expect(tracker.runComplete).toBe(true);
    expect(tracker.terminalErrorEnded).toBe(true);
  });

  it('treats run.ended status=completed with lifecyclePhase=completed as run complete', () => {
    expect(isOfficeRunCompletePhase('completed')).toBe(true);
    expect(isOfficeRunCompletePhase('end')).toBe(false);
    expect(isGatewayRunPhaseSettleSignal({ phase: 'completed' })).toBe(true);
    expect(isGatewayRunPhaseSettleSignal({ phase: 'end' })).toBe(false);
    const tracker = createOfficeRunTracker('run-1');
    applyOfficeRunRuntimeEvent(tracker, {
      type: 'run.ended',
      runId: 'run-1',
      status: 'completed',
      lifecyclePhase: 'completed',
    });
    expect(tracker.runComplete).toBe(true);
    expect(tracker.terminalErrorEnded).toBe(false);
  });

  it('does not treat run.started as run complete', () => {
    const tracker = createOfficeRunTracker('run-1');
    applyOfficeRunRuntimeEvent(tracker, { type: 'run.started', runId: 'run-1' });
    expect(tracker.runComplete).toBe(false);
  });
});
