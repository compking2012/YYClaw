import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProvidersSettings } from '@/components/settings/ProvidersSettings';
import type { ProviderAccount, ProviderWithKeyInfo } from '@/lib/providers';

const providerState = vi.hoisted(() => ({
  statuses: [] as ProviderWithKeyInfo[], accounts: [] as ProviderAccount[], vendors: [], defaultAccountId: null, loading: false,
  refreshProviderSnapshot: vi.fn().mockResolvedValue({ remoteCatalogOk: true }),
  createAccount: vi.fn(), removeAccount: vi.fn(), updateAccount: vi.fn(),
  setDefaultAccount: vi.fn(), validateAccountApiKey: vi.fn(),
}));
const agentState = vi.hoisted(() => ({
  defaultModelRef: null, defaultModelProviderAccountId: null, fetchAgents: vi.fn(),
}));
vi.mock('@/stores/providers', () => ({ useProviderStore: () => providerState }));
vi.mock('@/stores/agents', () => ({ useAgentsStore: (selector: (state: typeof agentState) => unknown) => selector(agentState) }));
vi.mock('@/stores/settings', () => ({ useSettingsStore: (selector: (state: { devModeUnlocked: boolean }) => unknown) => selector({ devModeUnlocked: true }) }));
vi.mock('@/stores/settings-modal', () => ({ useSettingsModal: (selector: (state: { focusItem: null; setFocusItem: () => void }) => unknown) => selector({ focusItem: null, setFocusItem: vi.fn() }) }));
vi.mock('@/lib/host-events', () => ({ subscribeHostEvent: () => () => {} }));
vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

describe('Provider dialog lifecycle', () => {
  beforeEach(() => {
    providerState.accounts = [];
    providerState.statuses = [];
    providerState.validateAccountApiKey.mockReset();
    providerState.updateAccount.mockReset();
  });

  it('retains rejected key validation inline and clears it before validating a replacement', async () => {
    const timestamp = '2026-01-01T00:00:00.000Z';
    providerState.accounts = [{
      id: 'key-test', vendorId: 'moonshot', label: 'Key test', authMode: 'api_key',
      model: 'kimi-k2.6', enabled: true, isDefault: false, createdAt: timestamp, updatedAt: timestamp,
    }];
    providerState.statuses = [{
      id: 'key-test', type: 'moonshot', name: 'Key test', model: 'kimi-k2.6', enabled: true,
      hasKey: true, keyMasked: 'sk-***', createdAt: timestamp, updatedAt: timestamp,
    }];
    providerState.validateAccountApiKey.mockResolvedValueOnce({ valid: false, error: 'Invalid API key' });
    providerState.validateAccountApiKey.mockResolvedValueOnce({ valid: true });
    providerState.updateAccount.mockResolvedValue(undefined);
    const view = render(<ProvidersSettings />);
    try {
      fireEvent.click(screen.getByTestId('provider-edit-key-test'));
      const input = screen.getByTestId('provider-edit-key-input-key-test');
      fireEvent.change(input, { target: { value: 'sk-bad' } });
      fireEvent.click(screen.getByTestId('provider-edit-save-key-test'));
      expect(await screen.findByRole('alert')).toHaveTextContent('Invalid API key');
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(providerState.updateAccount).not.toHaveBeenCalled();
      fireEvent.change(input, { target: { value: ' sk-good ' } });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(input).toHaveAttribute('aria-invalid', 'false');
      fireEvent.click(screen.getByTestId('provider-edit-save-key-test'));
      await waitFor(() => expect(providerState.updateAccount).toHaveBeenCalledWith('key-test', expect.any(Object), 'sk-good'));
      expect(providerState.validateAccountApiKey).toHaveBeenLastCalledWith('key-test', 'sk-good', expect.objectContaining({ modelId: 'kimi-k2.6' }));
    } finally {
      view.unmount();
    }
  });

  it('uses a titled shared dialog and discards the closed form before reopening', async () => {
    const view = render(<ProvidersSettings />);
    try {
      fireEvent.click(screen.getByTestId('providers-add-button'));
      const dialog = await screen.findByTestId('add-provider-dialog');
      expect(dialog).toHaveAttribute('role', 'dialog');
      expect(dialog).toHaveAttribute('data-state', 'open');
      expect(dialog).toHaveClass('clawx-dialog-content');
      expect(dialog).toHaveAccessibleName('aiProviders.dialog.title');
      expect(dialog).toHaveAccessibleDescription('aiProviders.dialog.desc');
      fireEvent.click(screen.getByTestId('add-provider-type-custom'));
      expect(screen.queryByTestId('add-provider-type-custom')).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId('add-provider-close-button'));
      await waitFor(() => expect(screen.queryByTestId('add-provider-dialog')).not.toBeInTheDocument());
      fireEvent.click(screen.getByTestId('providers-add-button'));
      await screen.findByTestId('add-provider-dialog');
      expect(screen.getByTestId('add-provider-type-custom')).toBeVisible();
    } finally {
      view.unmount();
    }
  });
});
