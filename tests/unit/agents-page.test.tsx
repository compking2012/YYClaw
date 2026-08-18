import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Agents } from '../../src/pages/Agents/index';

const channelsAccountsMock = vi.fn();
const subscribeHostEventMock = vi.fn();
const fetchAgentsMock = vi.fn();
const createAgentMock = vi.fn();
const deleteAgentMock = vi.fn();
const updateAgentMock = vi.fn();
const updateAgentIdMock = vi.fn();
const updateAgentModelMock = vi.fn();
const updateAgentAutoSelectMock = vi.fn();
const refreshProviderSnapshotMock = vi.fn();

const { gatewayState, agentsState, providersState, fetchSkillsMock } = vi.hoisted(() => ({
  gatewayState: {
    status: { state: 'running', port: 18789 },
  },
  agentsState: {
    agents: [] as Array<Record<string, unknown>>,
    defaultModelRef: null as string | null,
    defaultImageModelRef: null as string | null,
    defaultImageGenerationModelRef: null as string | null,
    defaultVideoGenerationModelRef: null as string | null,
    defaultMusicGenerationModelRef: null as string | null,
    defaultAgentSkills: [] as string[],
    loading: false,
    error: null as string | null,
  },
  providersState: {
    accounts: [] as Array<Record<string, unknown>>,
    statuses: [] as Array<Record<string, unknown>>,
    vendors: [] as Array<Record<string, unknown>>,
    defaultAccountId: '' as string,
  },
  fetchSkillsMock: vi.fn(),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof gatewayState) => unknown) => selector(gatewayState),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector?: (state: typeof agentsState & {
    fetchAgents: typeof fetchAgentsMock;
    updateAgent: typeof updateAgentMock;
    updateAgentId: typeof updateAgentIdMock;
    updateAgentModel: typeof updateAgentModelMock;
    updateAgentAutoSelect: typeof updateAgentAutoSelectMock;
    createAgent: typeof createAgentMock;
    deleteAgent: typeof deleteAgentMock;
  }) => unknown) => {
    const state = {
      ...agentsState,
      fetchAgents: fetchAgentsMock,
      updateAgent: updateAgentMock,
      updateAgentId: updateAgentIdMock,
      updateAgentModel: updateAgentModelMock,
      updateAgentAutoSelect: updateAgentAutoSelectMock,
      createAgent: createAgentMock,
      deleteAgent: deleteAgentMock,
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

vi.mock('@/stores/providers', () => ({
  useProviderStore: (selector: (state: typeof providersState & {
    refreshProviderSnapshot: typeof refreshProviderSnapshotMock;
  }) => unknown) => {
    const state = {
      ...providersState,
      refreshProviderSnapshot: refreshProviderSnapshotMock,
    };
    return selector(state);
  },
}));

vi.mock('@/stores/skills', () => ({
  useSkillsStore: () => ({
    skills: [],
    fetchSkills: fetchSkillsMock,
  }),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => channelsAccountsMock(...args),
  hostApi: {
    voice: {
      selections: vi.fn().mockResolvedValue({ success: true, selections: {} }),
    },
    channels: {
      accounts: (...args: unknown[]) => channelsAccountsMock(...args),
    },
  },
}));

vi.mock('@/lib/host-events', () => ({
  subscribeHostEvent: (eventName: string, handler: unknown) => subscribeHostEventMock(eventName, handler),
  hostEvents: {
    onGatewayChannelStatus: (handler: unknown) => subscribeHostEventMock('gateway:channel-status', handler),
  },
}));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

describe('Agents page status refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gatewayState.status = { state: 'running', port: 18789 };
    agentsState.agents = [];
    agentsState.defaultModelRef = null;
    agentsState.defaultImageModelRef = null;
    agentsState.defaultImageGenerationModelRef = null;
    agentsState.defaultVideoGenerationModelRef = null;
    agentsState.defaultMusicGenerationModelRef = null;
    agentsState.defaultAgentSkills = [];
    providersState.accounts = [];
    providersState.statuses = [];
    providersState.vendors = [];
    providersState.defaultAccountId = '';
    fetchAgentsMock.mockResolvedValue(undefined);
    createAgentMock.mockResolvedValue(undefined);
    deleteAgentMock.mockResolvedValue(undefined);
    updateAgentMock.mockResolvedValue(undefined);
    updateAgentIdMock.mockResolvedValue(undefined);
    updateAgentModelMock.mockResolvedValue(undefined);
    updateAgentAutoSelectMock.mockResolvedValue(undefined);
    fetchSkillsMock.mockResolvedValue(undefined);
    refreshProviderSnapshotMock.mockResolvedValue(undefined);
    channelsAccountsMock.mockResolvedValue({
      success: true,
      channels: [],
    });
  });

  it('refetches channel accounts when gateway channel-status events arrive', async () => {
    let channelStatusHandler: (() => void) | undefined;
    subscribeHostEventMock.mockImplementation((eventName: string, handler: () => void) => {
      if (eventName === 'gateway:channel-status') {
        channelStatusHandler = handler;
      }
      return vi.fn();
    });

    render(<Agents />);

    await waitFor(() => {
      expect(fetchAgentsMock).toHaveBeenCalledTimes(1);
      expect(channelsAccountsMock).toHaveBeenCalledWith();
    });
    expect(subscribeHostEventMock).toHaveBeenCalledWith('gateway:channel-status', expect.any(Function));

    await act(async () => {
      channelStatusHandler?.();
    });

    await waitFor(() => {
      expect(channelsAccountsMock).toHaveBeenCalledTimes(2);
    });
  });

  it('refetches channel accounts when the gateway transitions to running after mount', async () => {
    gatewayState.status = { state: 'starting', port: 18789 };

    const { rerender } = render(<Agents />);

    await waitFor(() => {
      expect(fetchAgentsMock).toHaveBeenCalledTimes(1);
      expect(channelsAccountsMock).toHaveBeenCalledWith();
    });

    gatewayState.status = { state: 'running', port: 18789 };
    await act(async () => {
      rerender(<Agents />);
    });

    await waitFor(() => {
      expect(channelsAccountsMock).toHaveBeenCalledTimes(2);
    });
  });

  it('does not render the legacy gateway warning during transient stopped status', async () => {
    gatewayState.status = { state: 'stopped', port: 18789 };

    render(<Agents />);

    await waitFor(() => {
      expect(fetchAgentsMock).toHaveBeenCalledTimes(1);
    });

    expect(screen.queryByText('gatewayWarning')).not.toBeInTheDocument();
  });

  it('renders an empty state and opens the add dialog when no agents exist', async () => {
    agentsState.agents = [];

    render(<Agents />);

    await waitFor(() => {
      expect(fetchAgentsMock).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByTestId('agents-empty-state')).toBeInTheDocument();
    expect(screen.getByText('emptyState.title')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('agents-empty-add-button'));

    expect(await screen.findByText('createDialog.title')).toBeInTheDocument();
  });

  it('shows the global default model fallback when the agent has no override', async () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'claude-opus-4.6',
        modelRef: 'openrouter/anthropic/claude-opus-4.6',
        overrideModelRef: null,
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:desk',
        channelTypes: [],
      },
    ];
    agentsState.defaultModelRef = 'openrouter/anthropic/claude-opus-4.6';
    providersState.accounts = [
      {
        id: 'openrouter-default',
        label: 'OpenRouter',
        vendorId: 'openrouter',
        authMode: 'api_key',
        model: 'openrouter/anthropic/claude-opus-4.6',
        enabled: true,
        createdAt: '2026-03-24T00:00:00.000Z',
        updatedAt: '2026-03-24T00:00:00.000Z',
      },
    ];
    providersState.statuses = [{ id: 'openrouter-default', hasKey: true }];
    providersState.vendors = [
      { id: 'openrouter', name: 'OpenRouter', modelIdPlaceholder: 'anthropic/claude-opus-4.6' },
    ];
    providersState.defaultAccountId = 'openrouter-default';

    render(<Agents />);

    await waitFor(() => {
      expect(fetchAgentsMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByTitle('settings'));
    fireEvent.click(screen.getByText('settingsDialog.modelLabel').closest('button') as HTMLButtonElement);

    expect(await screen.findByText('settingsDialog.usingDefaultModel')).toBeInTheDocument();
    const saveButton = screen.getByRole('button', { name: 'common:actions.save' });

    expect(updateAgentModelMock).not.toHaveBeenCalled();
    expect(saveButton).toBeDisabled();
  });

  it('enables model save when an inherited model becomes an explicit override', async () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'claude-opus-4.6',
        modelRef: 'openrouter/anthropic/claude-opus-4.6',
        overrideModelRef: null,
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:desk',
        channelTypes: [],
      },
    ];
    agentsState.defaultModelRef = 'openrouter/anthropic/claude-opus-4.6';
    providersState.accounts = [
      {
        id: 'openrouter-default',
        label: 'OpenRouter',
        vendorId: 'openrouter',
        authMode: 'api_key',
        model: 'openrouter/anthropic/claude-opus-4.6',
        enabled: true,
        createdAt: '2026-03-24T00:00:00.000Z',
        updatedAt: '2026-03-24T00:00:00.000Z',
      },
    ];
    providersState.statuses = [{ id: 'openrouter-default', hasKey: true }];
    providersState.vendors = [
      {
        id: 'openrouter',
        name: 'OpenRouter',
        modelIdPlaceholder: ['anthropic/claude-opus-4.6', 'openai/gpt-5'],
      },
    ];
    providersState.defaultAccountId = 'openrouter-default';

    render(<Agents />);
    await waitFor(() => expect(fetchAgentsMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId('agent-card-settings-main'));
    fireEvent.click(screen.getByText('settingsDialog.modelLabel').closest('button') as HTMLButtonElement);
    fireEvent.click(await screen.findByRole('switch', { name: 'settingsDialog.enableModelType' }));

    const saveButton = screen.getByTestId('agent-model-save');
    expect(saveButton).toBeEnabled();

    fireEvent.click(saveButton);
    expect(updateAgentModelMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('agent-settings-save-all')).toBeEnabled();

    fireEvent.click(screen.getByTestId('agent-settings-save-all'));
    await waitFor(() => {
      expect(updateAgentModelMock).toHaveBeenCalledWith(
        'main',
        'openrouter/anthropic/claude-opus-4.6',
        'model',
      );
    });
  });

  it('enables model save after selecting a different override model', async () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'claude-opus-4.6',
        modelRef: 'openrouter/anthropic/claude-opus-4.6',
        overrideModelRef: 'openrouter/anthropic/claude-opus-4.6',
        inheritedModel: false,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:desk',
        channelTypes: [],
      },
    ];
    agentsState.defaultModelRef = 'openrouter/anthropic/claude-opus-4.6';
    providersState.accounts = [
      {
        id: 'openrouter-default',
        label: 'OpenRouter',
        vendorId: 'openrouter',
        authMode: 'api_key',
        model: 'openrouter/anthropic/claude-opus-4.6',
        enabled: true,
        createdAt: '2026-03-24T00:00:00.000Z',
        updatedAt: '2026-03-24T00:00:00.000Z',
      },
    ];
    providersState.statuses = [{ id: 'openrouter-default', hasKey: true }];
    providersState.vendors = [
      {
        id: 'openrouter',
        name: 'OpenRouter',
        modelIdPlaceholder: ['anthropic/claude-opus-4.6', 'openai/gpt-5'],
      },
    ];
    providersState.defaultAccountId = 'openrouter-default';

    render(<Agents />);
    await waitFor(() => expect(fetchAgentsMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId('agent-card-settings-main'));
    fireEvent.click(screen.getByText('settingsDialog.modelLabel').closest('button') as HTMLButtonElement);

    const saveButton = screen.getByTestId('agent-model-save');
    expect(saveButton).toBeDisabled();

    fireEvent.change(document.querySelector('#agent-model-id') as HTMLInputElement, {
      target: { value: 'openai/gpt-5' },
    });
    expect(saveButton).toBeEnabled();

    fireEvent.click(saveButton);
    expect(updateAgentModelMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('agent-settings-save-all')).toBeEnabled();

    fireEvent.click(screen.getByTestId('agent-settings-save-all'));
    await waitFor(() => {
      expect(updateAgentModelMock).toHaveBeenCalledWith('main', 'openrouter/openai/gpt-5', 'model');
    });
  });

  it('renaming a non-main agent updates only the display name and does not change the id', async () => {
    agentsState.agents = [
      {
        id: 'bot-a',
        name: 'Bot A',
        isDefault: false,
        modelDisplay: 'gpt-5',
        modelRef: 'openai/gpt-5',
        overrideModelRef: null,
        inheritedModel: true,
        workspace: '~/.openclaw/workspace-bot-a',
        agentDir: '~/.openclaw/agents/bot-a/agent',
        mainSessionKey: 'agent:bot-a:main',
        channelTypes: [],
      },
    ];

    render(<Agents />);
    await waitFor(() => expect(fetchAgentsMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId('agent-card-settings-bot-a'));
    const nameInput = await screen.findByLabelText('settingsDialog.nameLabel');
    fireEvent.change(nameInput, { target: { value: 'Bot A Renamed' } });
    fireEvent.click(screen.getByTestId('agent-settings-save-all'));

    await waitFor(() => {
      expect(updateAgentMock).toHaveBeenCalledWith('bot-a', { name: 'Bot A Renamed' });
    });
    expect(updateAgentIdMock).not.toHaveBeenCalled();
    expect(channelsAccountsMock).not.toHaveBeenCalledWith(
      '/api/agents/slugify',
      expect.anything(),
    );
  });

  it('keeps the last agent snapshot visible while a refresh is in flight', async () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'gpt-5',
        modelRef: 'openai/gpt-5',
        overrideModelRef: null,
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
    ];

    const { rerender } = render(<Agents />);

    expect(await screen.findByText('Main')).toBeInTheDocument();

    agentsState.loading = true;
    await act(async () => {
      rerender(<Agents />);
    });

    expect(screen.getByText('Main')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('keeps the blocking spinner during the initial load before any stable snapshot exists', async () => {
    agentsState.loading = true;
    fetchAgentsMock.mockImplementation(() => new Promise(() => {}));
    refreshProviderSnapshotMock.mockImplementation(() => new Promise(() => {}));
    channelsAccountsMock.mockImplementation(() => new Promise(() => {}));

    const { container } = render(<Agents />);

    expect(container.querySelector('svg.animate-spin')).toBeTruthy();
    expect(screen.queryByText('title')).not.toBeInTheDocument();
  });
});
