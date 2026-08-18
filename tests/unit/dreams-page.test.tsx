import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemorySettings } from '@/pages/Dreams';

const rpcMock = vi.fn();
const tMock = (key: string) => key;

const { gatewayState, hostApiMock } = vi.hoisted(() => ({
  gatewayState: {
    status: { state: 'running', port: 18789, gatewayReady: true } as {
      state: string;
      port: number;
      gatewayReady?: boolean;
    },
  },
  hostApiMock: {
    gateway: {
      status: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      restart: vi.fn(),
      health: vi.fn(),
      controlUi: vi.fn(),
      rpc: vi.fn(),
    },
    settings: {
      getAll: vi.fn(),
      get: vi.fn(),
      set: vi.fn(),
      setMany: vi.fn(),
      reset: vi.fn(),
    },
    logs: {
      recent: vi.fn(),
      dir: vi.fn(),
      listFiles: vi.fn(),
      readFile: vi.fn(),
    },
  },
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof gatewayState & { rpc: typeof rpcMock }) => unknown) => selector({
    ...gatewayState,
    rpc: rpcMock,
  }),
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: hostApiMock,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: tMock,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    appError: vi.fn(),
  },
}));

describe('Dreams page gateway readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gatewayState.status = { state: 'running', port: 18789, gatewayReady: true };
    rpcMock.mockImplementation(async (method: string) => {
      if (method === 'doctor.memory.status') {
        return {
          dreaming: {
            enabled: true,
            shortTermCount: 1,
            groundedSignalCount: 0,
            totalSignalCount: 1,
            promotedToday: 0,
            shortTermEntries: [],
            promotedEntries: [],
          },
        };
      }
      if (method === 'doctor.memory.dreamDiary') {
        return { found: true, content: '' };
      }
      return {};
    });
  });

  it('does not call memory doctor RPCs until gatewayReady is true', async () => {
    gatewayState.status = { state: 'running', port: 18789, gatewayReady: false };
    const { rerender } = render(<MemorySettings />);

    expect(screen.getByTestId('dreams-refresh')).toBeDisabled();
    expect(screen.getByTestId('dreams-enable')).toBeDisabled();
    expect(screen.getByText('gatewayNotReady')).toBeVisible();
    await waitFor(() => {
      expect(rpcMock).not.toHaveBeenCalled();
    });

    gatewayState.status = { state: 'running', port: 18789, gatewayReady: true };
    await act(async () => {
      rerender(<MemorySettings />);
    });

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith('doctor.memory.status', {}, 12_000);
      expect(rpcMock).toHaveBeenCalledWith('doctor.memory.dreamDiary', {}, 12_000);
    });
    expect(screen.getByTestId('dreams-refresh')).toBeEnabled();
  });

  it('shows the enabled toggle from persisted config even when runtime status reports disabled', async () => {
    // Regression: after enabling dreaming, doctor.memory.status (runtime) can still
    // report enabled:false until the plugin reloads. The toggle must reflect the
    // persisted config value (config.get) so it survives re-mounting the page.
    rpcMock.mockImplementation(async (method: string) => {
      if (method === 'doctor.memory.status') {
        return { dreaming: { enabled: false, shortTermEntries: [], promotedEntries: [] } };
      }
      if (method === 'doctor.memory.dreamDiary') {
        return { found: true, content: '' };
      }
      if (method === 'config.get') {
        return {
          hash: 'abc',
          config: { plugins: { entries: { 'memory-core': { config: { dreaming: { enabled: true } } } } } },
        };
      }
      return {};
    });

    render(<MemorySettings />);

    await waitFor(() => {
      expect(screen.getByTestId('dreams-disable')).toBeInTheDocument();
    });
    const badge = screen.getByTestId('dreams-enabled-badge');
    expect(badge).toHaveTextContent('common:status.enabled');
    expect(screen.queryByTestId('dreams-enable')).not.toBeInTheDocument();
  });
});
