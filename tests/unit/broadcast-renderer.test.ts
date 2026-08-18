/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebContents } from 'electron';

const debugMock = vi.fn();

vi.mock('../../electron/utils/logger', () => ({
  logger: {
    debug: (...args: unknown[]) => debugMock(...args),
  },
}));

function mockWebContents(opts: {
  destroyed?: boolean;
  frameDestroyed?: boolean;
  frameMissing?: boolean;
}): WebContents {
  const send = vi.fn();
  const mainFrame = opts.frameMissing
    ? null
    : { isDestroyed: () => opts.frameDestroyed ?? false };
  return {
    isDestroyed: () => opts.destroyed ?? false,
    get mainFrame() {
      if (opts.frameMissing) return null;
      return mainFrame;
    },
    send,
  } as unknown as WebContents;
}

describe('broadcast-renderer guards', () => {
  afterEach(() => {
    debugMock.mockClear();
  });

  it('canSendToWebContents rejects destroyed webContents', async () => {
    const { canSendToWebContents } = await import('../../electron/utils/broadcast-renderer');
    expect(canSendToWebContents(mockWebContents({ destroyed: true }))).toBe(false);
  });

  it('canSendToWebContents rejects disposed main frame', async () => {
    const { canSendToWebContents } = await import('../../electron/utils/broadcast-renderer');
    expect(canSendToWebContents(mockWebContents({ frameDestroyed: true }))).toBe(false);
  });

  it('sendToWebContents skips send and logs when frame is not ready', async () => {
    const { resetRendererSendSkipLogForTest, sendToWebContents } = await import(
      '../../electron/utils/broadcast-renderer'
    );
    resetRendererSendSkipLogForTest();
    const wc = mockWebContents({ frameDestroyed: true });
    sendToWebContents(wc, 'test:channel', { ok: true });
    expect(wc.send).not.toHaveBeenCalled();
    expect(debugMock).toHaveBeenCalledWith(
      '[renderer-ipc] skipped test:channel: mainFrame disposed',
    );
  });

  it('sendToWebContents delivers when frame is ready', async () => {
    const { sendToWebContents } = await import('../../electron/utils/broadcast-renderer');
    const wc = mockWebContents({});
    sendToWebContents(wc, 'test:channel', { ok: true });
    expect(wc.send).toHaveBeenCalledWith('test:channel', { ok: true });
    expect(debugMock).not.toHaveBeenCalled();
  });
});
