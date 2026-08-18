import { describe, expect, it, vi } from 'vitest';
import { logger } from '../../electron/utils/logger';
import {
  logOfficeGatewaySettle,
  officeSettleGateStateDetail,
} from '../../electron/services/office/office-settle-gate-log';
import { createOfficeRunTracker } from '../../electron/services/office/session-run-settle';

describe('office-settle-gate-log', () => {
  it('officeSettleGateStateDetail reflects gate flags', () => {
    const tracker = createOfficeRunTracker('run-ts@gen-2');
    tracker.runComplete = true;
    const detail = officeSettleGateStateDetail(tracker);
    expect(detail.runComplete).toBe(true);
    expect(detail.gateOpen).toBe(true);
    expect(detail.runId).toBe('run-ts@gen-2');
  });

  it('logOfficeGatewaySettle prefixes gateway-settle tag', () => {
    const spy = vi.spyOn(logger, 'info').mockImplementation(() => {});
    logOfficeGatewaySettle('info', 'test event', { sessionKey: 'sk-1' });
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('[office][gateway-settle] test event'),
    );
    spy.mockRestore();
  });
});
