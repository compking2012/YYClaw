import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelsSettings, UsageSettings } from '@/pages/Models/index';

const hostApiFetchMock = vi.fn();
const trackUiEventMock = vi.fn();

const { gatewayState, settingsState } = vi.hoisted(() => ({
  gatewayState: {
    status: { state: 'running', port: 18789, connectedAt: 1, pid: 1234 },
  },
  settingsState: {
    devModeUnlocked: false,
  },
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof gatewayState) => unknown) => selector(gatewayState),
}));

vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
  hostApi: {
    usage: {
      recentTokenHistory: () => hostApiFetchMock('/api/usage/recent-token-history'),
    },
  },
}));

vi.mock('@/lib/telemetry', () => ({
  trackUiEvent: (...args: unknown[]) => trackUiEventMock(...args),
}));

vi.mock('@/components/settings/ProvidersSettings', () => ({
  ProvidersSettings: () => <div data-testid="providers-settings-panel" />,
}));

vi.mock('@/components/settings/ImageGenerationSettings', () => ({
  ImageGenerationSettings: () => <div data-testid="image-generation-settings-panel" />,
}));

vi.mock('@/components/settings/AsrSettings', () => ({
  AsrSettings: () => <div data-testid="asr-settings-panel" />,
}));

vi.mock('@/components/common/FeedbackState', () => ({
  FeedbackState: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | { count?: number }) => {
      if (typeof fallback === 'string') return fallback;
      return key;
    },
  }),
}));

function createUsageEntry(totalTokens: number) {
  return {
    timestamp: '2026-04-01T12:00:00.000Z',
    sessionId: `session-${totalTokens}`,
    agentId: 'main',
    model: 'gpt-5',
    provider: 'openai',
    inputTokens: totalTokens,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens,
  };
}

describe('Models page auto refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    settingsState.devModeUnlocked = false;
    gatewayState.status = { state: 'running', port: 18789, connectedAt: 1, pid: 1234 };
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    hostApiFetchMock.mockResolvedValue([createUsageEntry(27)]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('refreshes token usage while the page stays open', async () => {
    render(<UsageSettings />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(hostApiFetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(15_000);
      await Promise.resolve();
    });

    expect(hostApiFetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps provider management in the local Models settings tab', () => {
    render(<ModelsSettings />);

    expect(screen.getByTestId('models-tab')).toBeInTheDocument();
    expect(screen.getByTestId('providers-settings-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('asr-settings-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('image-generation-settings-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('usage-tab')).not.toBeInTheDocument();
    expect(trackUiEventMock).toHaveBeenCalledWith('models.page_viewed');
  });

  it('keeps usage separate from provider and media management in developer mode', async () => {
    settingsState.devModeUnlocked = true;
    render(<UsageSettings />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('usage-tab')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Token Usage History' })).toBeInTheDocument();
    expect(screen.queryByTestId('providers-settings-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('asr-settings-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('image-generation-settings-panel')).not.toBeInTheDocument();
  });
});
