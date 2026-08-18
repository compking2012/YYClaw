import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SkillsSettings } from '@/pages/Skills';

const fetchSkillsMock = vi.fn();
const enableSkillMock = vi.fn();
const disableSkillMock = vi.fn();
const setSkillsEnabledMock = vi.fn();
const searchSkillsMock = vi.fn();
const installSkillMock = vi.fn();
const uninstallSkillMock = vi.fn();
const clawhubCapabilityMock = vi.fn();
const clawhubOpenSkillPathMock = vi.fn();
const openclawGetSkillsDirMock = vi.fn();
const shellOpenExternalMock = vi.fn();

const { gatewayState, skillsState } = vi.hoisted(() => ({
  gatewayState: {
    status: { state: 'running', port: 18789, gatewayReady: true } as {
      state: string;
      port: number;
      gatewayReady?: boolean;
    },
  },
  skillsState: {
    skills: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock('@/stores/skills', () => ({
  useSkillsStore: () => ({
    skills: skillsState.skills,
    loading: false,
    error: null,
    fetchSkills: fetchSkillsMock,
    enableSkill: enableSkillMock,
    disableSkill: disableSkillMock,
    setSkillsEnabled: setSkillsEnabledMock,
    searchResults: [],
    searchSkills: searchSkillsMock,
    installSkill: installSkillMock,
    uninstallSkill: uninstallSkillMock,
    searching: false,
    searchError: null,
    installing: {},
  }),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof gatewayState) => unknown) => selector(gatewayState),
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    openclaw: {
      getSkillsDir: () => openclawGetSkillsDirMock(),
    },
    shell: {
      openExternal: (...args: unknown[]) => shellOpenExternalMock(...args),
    },
    skills: {
      clawhubCapability: () => clawhubCapabilityMock(),
      clawhubOpenSkillPath: (...args: unknown[]) => clawhubOpenSkillPathMock(...args),
    },
  },
}));

vi.mock('@/lib/telemetry', () => ({
  trackUiEvent: vi.fn(),
}));

vi.mock('@/extensions/registry', () => ({
  rendererExtensionRegistry: {
    getSkillDetailMetaComponents: () => [],
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
  // Skills transitively imports `@/lib/api-client`, which imports `@/i18n`
  // (calls `.use(initReactI18next)` at module load). Provide a no-op plugin
  // stub so the i18next singleton initializes without a real react binding.
  initReactI18next: {
    type: '3rdParty',
    init: () => {},
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

describe('Skills page gateway readiness', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    gatewayState.status = { state: 'running', port: 18789, gatewayReady: true };
    skillsState.skills = [];
    openclawGetSkillsDirMock.mockResolvedValue('/tmp/.openclaw/skills');
    shellOpenExternalMock.mockResolvedValue(undefined);
    clawhubCapabilityMock.mockResolvedValue({ success: true, capability: { canSearch: false, canInstall: false } });
    clawhubOpenSkillPathMock.mockResolvedValue({ success: true });
    fetchSkillsMock.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps loading skills while gatewayReady is false and hides the banner once local skills fetch succeeds', async () => {
    gatewayState.status = { state: 'running', port: 18789, gatewayReady: false };
    render(<SkillsSettings />);

    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1_600);
    });

    expect(fetchSkillsMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('skills-gateway-banner')).not.toBeInTheDocument();
  });

  it('keeps startup readiness feedback out of the Skills page banner', async () => {
    fetchSkillsMock.mockResolvedValue(false);
    gatewayState.status = { state: 'running', port: 18789, gatewayReady: false };
    render(<SkillsSettings />);

    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1_600);
    });

    expect(fetchSkillsMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('skills-gateway-banner')).not.toBeInTheDocument();
  });

  it('still fetches local skills when the gateway is stopped', async () => {
    gatewayState.status = { state: 'stopped', port: 18789 };
    render(<SkillsSettings />);

    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1_600);
    });

    expect(fetchSkillsMock).toHaveBeenCalledTimes(1);
    // The install affordance stays available regardless of gateway state.
    expect(screen.getByText('actions.installSkill')).toBeInTheDocument();
  });
});
