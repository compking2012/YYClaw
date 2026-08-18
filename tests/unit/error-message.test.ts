import { describe, expect, it } from 'vitest';

import { AppError, toUserMessage } from '@/lib/error-message';

describe('error-message', () => {
  it('returns user-facing message for permission error', () => {
    const msg = toUserMessage(new AppError('PERMISSION', 'forbidden'));
    expect(msg.toLowerCase()).toContain('permission');
  });

  it('returns user-facing message for auth invalid error', () => {
    const msg = toUserMessage(new AppError('AUTH_INVALID', 'Invalid Authentication'));
    expect(msg).toContain('API key');
  });

  it('returns user-facing message for channel unavailable error', () => {
    const msg = toUserMessage(new AppError('CHANNEL_UNAVAILABLE', 'Invalid IPC channel'));
    expect(msg.toLowerCase()).toContain('service channel');
  });
});
