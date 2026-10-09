import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Bot, Check, Link2, Plus, RefreshCw, Settings2, Trash2, UserCog, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox, placeholderToOptions } from '@/components/ui/combobox';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Switch } from '@/components/ui/switch';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { useAgentsStore } from '@/stores/agents';
import { useGatewayStore } from '@/stores/gateway';
import { useProviderStore } from '@/stores/providers';
import { useSettingsStore } from '@/stores/settings';
import { useSettingsModal } from '@/stores/settings-modal';
import { useSkillsStore } from '@/stores/skills';
import { hostApi, type ChannelGroupItem } from '@/lib/host-api';
import { subscribeHostEvent } from '@/lib/host-events';
import { scrollTestIdIntoView } from '@/lib/focus-highlight';
import { CHANNEL_ICONS, CHANNEL_NAMES, type ChannelType } from '@/types/channel';
import type { AgentSummary, OptimizationProfile } from '@/types/agent';
import type { Skill } from '@/types/skill';
import { BUILTIN_PROVIDER_TYPES, type ProviderAccount, type ProviderVendorInfo, type ProviderWithKeyInfo, accountModelKinds, type ModelKind } from '@/lib/providers';
import { MODEL_KIND_COLORS } from '@/components/settings/ProvidersSettings';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useTranslation } from 'react-i18next';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import {
  agentSkillsSelectionChanged,
  normalizeSkillsSelectionForPersist,
  resolveAgentSkillSelection,
} from '@/lib/skill-lookup-aliases';
import { SkillAllowlistPicker } from '@/components/skills/SkillAllowlistPicker';
import { PersonaSettingsModal } from '@/components/persona/PersonaSettingsModal';
import telegramIcon from '@/assets/channels/telegram.svg';
import discordIcon from '@/assets/channels/discord.svg';
import whatsappIcon from '@/assets/channels/whatsapp.svg';
import wechatIcon from '@/assets/channels/wechat.svg';
import dingtalkIcon from '@/assets/channels/dingtalk.svg';
import feishuIcon from '@/assets/channels/feishu.svg';
import wecomIcon from '@/assets/channels/wecom.svg';
import qqIcon from '@/assets/channels/qq.svg';

// Module-level cache so channel groups survive route transitions without a re-fetch.
let _channelGroupsCache: ChannelGroupItem[] = [];

// Exposed for tests so the module-level cache doesn't leak between cases.
// eslint-disable-next-line react-refresh/only-export-components
export function __resetAgentsChannelGroupsCacheForTests(): void {
  _channelGroupsCache = [];
}

interface RuntimeProviderOption {
  runtimeProviderKey: string;
  accountId: string;
  label: string;
  modelIdPlaceholder?: string | string[];
  configuredModelId?: string;
}

interface AgentModelDraft {
  overrideModelRef: string | null;
  autoSelectText: boolean;
  optimizationProfile: OptimizationProfile;
  sensitiveMode: boolean;
}

function isUnregisteredProviderType(type: string): boolean {
  if (type === 'custom' || type === 'ollama') return true;
  return !BUILTIN_PROVIDER_TYPES.includes(type as any);
}

function resolveRuntimeProviderKey(account: ProviderAccount): string {
  if (account.authMode === 'oauth_browser') {
    if (account.vendorId === 'google') return 'google-gemini-cli';
    if (account.vendorId === 'openai') return 'openai-codex';
  }

  // 针对所有非内置 Provider (包括 custom / ollama / 第三方插件提供的模型) 拼接后缀
  if (isUnregisteredProviderType(account.vendorId)) {
    const prefix = `${account.vendorId}-`;
    // 如果 account.id 已经是运行时 key，避免重复哈希
    if (account.id.startsWith(prefix)) {
      const tail = account.id.slice(prefix.length);
      if (tail.length === 8 && !tail.includes('-')) {
        return account.id;
      }
    }
    const suffix = account.id.replace(/-/g, '').slice(0, 8);
    return `${account.vendorId}-${suffix}`;
  }

  if (account.vendorId === 'minimax-portal-cn') {
    return 'minimax-portal';
  }

  return account.vendorId;
}

function splitModelRef(modelRef: string | null | undefined): { providerKey: string; modelId: string } | null {
  const value = (modelRef || '').trim();
  if (!value) return null;
  const separatorIndex = value.indexOf('/');
  if (separatorIndex <= 0 || separatorIndex >= value.length - 1) return null;
  return {
    providerKey: value.slice(0, separatorIndex),
    modelId: value.slice(separatorIndex + 1),
  };
}

function hasConfiguredProviderCredentials(
  account: ProviderAccount,
  statusById: Map<string, ProviderWithKeyInfo>,
): boolean {
  if (account.authMode === 'oauth_device' || account.authMode === 'oauth_browser' || account.authMode === 'local') {
    return true;
  }
  return statusById.get(account.id)?.hasKey ?? false;
}

export function Agents() {
  const { t } = useTranslation('agents');
  const gatewayStatus = useGatewayStore((state) => state.status);
  const refreshProviderSnapshot = useProviderStore((state) => state.refreshProviderSnapshot);
  const lastGatewayStateRef = useRef(gatewayStatus.state);
  const {
    agents,
    loading,
    error,
    focusAgentId,
    setFocusAgentId,
    fetchAgents,
    createAgent,
    deleteAgent,
  } = useAgentsStore();
  const [channelGroups, setChannelGroups] = useState<ChannelGroupItem[]>(_channelGroupsCache);
  const [hasCompletedInitialLoad, setHasCompletedInitialLoad] = useState(() => agents.length > 0);

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showGlobalModelModal, setShowGlobalModelModal] = useState(false);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [bindingAgentId, setBindingAgentId] = useState<string | null>(null);
  const [agentToDelete, setAgentToDelete] = useState<AgentSummary | null>(null);
  const [personaAgentId, setPersonaAgentId] = useState<string | null>(null);
  const [highlightedAgentId, setHighlightedAgentId] = useState<string | null>(null);
  const focusScrollRef = useRef<null | (() => void)>(null);
  const focusHighlightTimerRef = useRef(0);

  // Cancel the focus scroll/highlight only on unmount — clearing focusAgentId
  // below must NOT tear it down (that race used to abort the scroll early).
  useEffect(() => () => {
    focusScrollRef.current?.();
    if (focusHighlightTimerRef.current) clearTimeout(focusHighlightTimerRef.current);
  }, []);

  useEffect(() => {
    if (!focusAgentId || !hasCompletedInitialLoad) return;
    const targetId = focusAgentId;
    setFocusAgentId(null); // consume the token; the scroll below is not tied to this effect's cleanup
    focusScrollRef.current?.(); // cancel any previous in-flight scroll (rapid re-clicks)
    focusScrollRef.current = scrollTestIdIntoView(
      `agent-card-${targetId}`,
      () => {
        setHighlightedAgentId(targetId);
        if (focusHighlightTimerRef.current) clearTimeout(focusHighlightTimerRef.current);
        focusHighlightTimerRef.current = window.setTimeout(() => setHighlightedAgentId(null), 2500);
      },
      { block: 'center' },
    );
  }, [focusAgentId, setFocusAgentId, hasCompletedInitialLoad]);

  // Use shared skills store for consistent skill data with Skills page
  const { skills: availableSkills, fetchSkills: fetchSkillsPool } = useSkillsStore();

  const fetchChannelAccounts = useCallback(async () => {
    try {
      const response = await hostApi.channels.accounts();
      const groups = response.channels || [];
      _channelGroupsCache = groups;
      setChannelGroups(groups);
    } catch {
      // Keep the last rendered snapshot when channel account refresh fails.
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const hasData = agents.length > 0;

    if (hasData) {
      // Store already has data from a previous visit — hasCompletedInitialLoad is
      // already true (initialised from agents.length > 0), and channelGroups is
      // warm from the module cache. Silently refresh agents and channel accounts
      // in the background to pick up live status (e.g. channels that connected
      // while the page was unmounted and whose gateway:channel-status events were
      // missed). Deferred via .then() to satisfy react-hooks/set-state-in-effect.
      void fetchAgents({ silent: true });
      void fetchSkillsPool();
      void refreshProviderSnapshot();
      void Promise.resolve().then(() => fetchChannelAccounts());
    } else {
      // Cold start — load everything in parallel, then reveal the page.
      // fetchChannelAccounts is called inside .then() to satisfy react-hooks/set-state-in-effect.
      void Promise.all([fetchSkillsPool(), fetchAgents(), refreshProviderSnapshot()])
        .then(() => fetchChannelAccounts())
        .finally(() => {
          if (mounted) setHasCompletedInitialLoad(true);
        });
    }

    return () => {
      mounted = false;
    };
  }, [fetchAgents, fetchChannelAccounts, fetchSkillsPool, refreshProviderSnapshot]);

  useEffect(() => {
    const unsubscribe = subscribeHostEvent('gateway:channel-status', () => {
      void fetchChannelAccounts();
    });
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [fetchChannelAccounts]);

  // Cross-page linkage: when the Channels page mutates a channel's accounts,
  // bindings, or config, the backend broadcasts this event so the agents list
  // refreshes its channel binding badges without waiting for a gateway restart.
  useEffect(() => {
    const unsubscribe = subscribeHostEvent('channels:accounts-changed', () => {
      void fetchChannelAccounts();
    });
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [fetchChannelAccounts]);

  useEffect(() => {
    const previousGatewayState = lastGatewayStateRef.current;
    lastGatewayStateRef.current = gatewayStatus.state;

    if (previousGatewayState !== 'running' && gatewayStatus.state === 'running') {

      void fetchChannelAccounts();
    }
  }, [fetchChannelAccounts, gatewayStatus.state]);

  const activeAgent = useMemo(
    () => agents.find((agent) => agent.id === activeAgentId) ?? null,
    [activeAgentId, agents],
  );

  const bindingAgent = useMemo(
    () => agents.find((agent) => agent.id === bindingAgentId) ?? null,
    [bindingAgentId, agents],
  );

  const visibleAgents = agents;
  const visibleChannelGroups = channelGroups;
  const isUsingStableValue = loading && hasCompletedInitialLoad;
  const handleRefresh = () => {
    void Promise.all([fetchAgents(), fetchChannelAccounts()]);
  };

  // Global speech-synthesis (TTS) selection — lives in OpenClaw messages.tts, not in
  // agents defaults, so it's the same for every agent. Refetched when the Global
  // Config modal closes (where it can be changed) and whenever the provider
  // snapshot changes (e.g. a voice model is deleted/edited in Settings).
  const [globalTtsModelRef, setGlobalTtsModelRef] = useState<string>('');
  // Global speech-transcription (STT) selection — lives in the voice-call plugin's
  // streaming config; same for every agent. Refetched alongside TTS.
  const [globalTranscriptionModelRef, setGlobalTranscriptionModelRef] = useState<string>('');
  const refreshVoiceSelections = useCallback(() => {
    hostApi.voice.selections()
      .then((res) => {
        const selections = (res as { selections?: { tts?: { provider?: string; config?: { model?: string } }; transcription?: { provider?: string; config?: { model?: string } } } })?.selections;
        const sel = selections?.tts;
        setGlobalTtsModelRef(sel?.provider ? (sel?.config?.model || sel.provider) : '');
        const stt = selections?.transcription;
        setGlobalTranscriptionModelRef(stt?.provider ? (stt?.config?.model || stt.provider) : '');
      })
      .catch(() => { /* gateway may be down */ });
  }, []);
  useEffect(() => {
    if (showGlobalModelModal) return;
    refreshVoiceSelections();
  }, [showGlobalModelModal, refreshVoiceSelections]);
  // Provider changes in Settings (delete/edit a voice model) don't toggle the
  // modal, so subscribe to the snapshot event to keep the voice badges in sync.
  useEffect(() => {
    const unsubscribe = subscribeHostEvent('providers:snapshot-changed', () => {
      refreshVoiceSelections();
    });
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [refreshVoiceSelections]);



  if (loading && !hasCompletedInitialLoad) {
    return (
      <div className="flex flex-col -m-6 dark:bg-background min-h-[calc(100vh-2.5rem)] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div
      data-testid="agents-page"
      className="flex flex-col -m-6 dark:bg-background h-[calc(100vh-2.5rem)] overflow-hidden"
    >
      <div className="w-full max-w-5xl mx-auto flex flex-col h-full p-10 pt-16 pb-0">
        <div className="flex flex-col md:flex-row md:items-start justify-between mb-12 shrink-0 gap-4">
          <div>
            <h1
              className="text-3xl md:text-4xl font-serif text-foreground mb-3 font-normal tracking-tight"
              style={{ fontFamily: 'Georgia, Cambria, "Times New Roman", Times, serif' }}
            >
              {t('title')}
            </h1>
            <p className="text-[17px] text-foreground/70 font-medium">{t('subtitle')}</p>
          </div>
          <div className="flex items-center gap-3 md:mt-2">
            <Button
              variant="outline"
              onClick={() => setShowGlobalModelModal(true)}
              className="h-9 text-[13px] font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground transition-colors"
            >
              <Settings2 className="h-3.5 w-3.5 mr-2" />
              {t('globalModels', 'Global Models')}
            </Button>
            <Button
              variant="outline"
              onClick={handleRefresh}
              className="h-9 text-[13px] font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground transition-colors"
            >
              <RefreshCw className={cn('h-3.5 w-3.5 mr-2', isUsingStableValue && 'animate-spin')} />
              {t('refresh')}
            </Button>
            <Button
              data-testid="agents-add-button"
              onClick={() => setShowAddDialog(true)}
              className="h-9 text-[13px] font-medium rounded-full px-4 shadow-none"
            >
              <Plus className="h-3.5 w-3.5 mr-2" />
              {t('addAgent')}
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pr-2 pb-10 min-h-0 -mr-2">
          {error && (
            <div className="mb-8 p-4 rounded-xl border border-destructive/50 bg-destructive/10 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <span className="text-destructive text-sm font-medium">{error}</span>
            </div>
          )}

          {visibleAgents.length === 0 ? (
            <Card data-testid="agents-empty-state" className="border-dashed border-black/10 dark:border-white/10 bg-surface-modal shadow-none rounded-3xl">
              <CardContent className="flex flex-col items-center justify-center text-center px-6 py-16">
                <div className="h-12 w-12 rounded-full bg-black/5 dark:bg-white/10 flex items-center justify-center mb-5">
                  <Bot className="h-6 w-6 text-foreground/60" />
                </div>
                <h2 className="font-serif font-normal tracking-tight text-2xl text-foreground mb-2">
                  {t('emptyState.title')}
                </h2>
                <p className="text-[15px] text-foreground/60 max-w-md mb-6">
                  {t('emptyState.description')}
                </p>
                <Button
                  data-testid="agents-empty-add-button"
                  onClick={() => setShowAddDialog(true)}
                  className="h-9 text-[13px] font-medium rounded-full px-4 shadow-none"
                >
                  <Plus className="h-3.5 w-3.5 mr-2" />
                  {t('emptyState.addFirst')}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {visibleAgents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  channelGroups={visibleChannelGroups}
                  ttsModelRef={globalTtsModelRef}
                  transcriptionModelRef={globalTranscriptionModelRef}
                  highlighted={highlightedAgentId === agent.id}
                  onOpenSettings={() => setActiveAgentId(agent.id)}
                  onOpenPersona={() => setPersonaAgentId(agent.id)}
                  onOpenChannelBinding={() => setBindingAgentId(agent.id)}
                  onDelete={() => setAgentToDelete(agent)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {showAddDialog && (
        <AddAgentDialog
          availableSkills={availableSkills}
          onClose={() => setShowAddDialog(false)}
          onCreate={async (name, options) => {
            await createAgent(name, options);
            await fetchSkillsPool();
            setShowAddDialog(false);
            toast.success(t('toast.agentCreated'));
          }}
        />
      )}

      {activeAgent && (
        <AgentSettingsModal
          agent={activeAgent}
          availableSkills={availableSkills}
          channelGroups={visibleChannelGroups}
          onClose={() => setActiveAgentId(null)}
          onIdChange={setActiveAgentId}
        />
      )}

      {bindingAgent && (
        <AgentChannelBindingModal
          agent={bindingAgent}
          agents={visibleAgents}
          channelGroups={visibleChannelGroups}
          onClose={() => setBindingAgentId(null)}
          onChanged={fetchChannelAccounts}
        />
      )}

      {showGlobalModelModal && (
        <GlobalModelModal onClose={() => setShowGlobalModelModal(false)} />
      )}

      <ConfirmDialog
        open={!!agentToDelete}
        title={t('deleteDialog.title')}
        message={agentToDelete
          ? t(visibleAgents.length <= 1 ? 'deleteDialog.messageLast' : 'deleteDialog.message', { name: agentToDelete.name })
          : ''}
        confirmLabel={t('common:actions.delete')}
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        onConfirm={async () => {
          if (!agentToDelete) return;
          try {
            await deleteAgent(agentToDelete.id);
            const deletedId = agentToDelete.id;
            setAgentToDelete(null);
            if (activeAgentId === deletedId) {
              setActiveAgentId(null);
            }
            toast.success(t('toast.agentDeleted'));
          } catch (error) {
            toast.error(t('toast.agentDeleteFailed', { error: String(error) }));
          }
        }}
        onCancel={() => setAgentToDelete(null)}
      />

      <PersonaSettingsModal
        agentId={personaAgentId}
        open={!!personaAgentId}
        onClose={() => setPersonaAgentId(null)}
      />
    </div>
  );
}

function AgentCard({
  agent,
  channelGroups,
  ttsModelRef,
  transcriptionModelRef,
  highlighted,
  onOpenSettings,
  onOpenPersona,
  onOpenChannelBinding,
  onDelete,
}: {
  agent: AgentSummary;
  channelGroups: ChannelGroupItem[];
  ttsModelRef?: string;
  transcriptionModelRef?: string;
  highlighted: boolean;
  onOpenSettings: () => void;
  onOpenPersona: (agentId: string) => void;
  onOpenChannelBinding: (agentId: string) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation('agents');
  const openSettings = useSettingsModal((s) => s.openSettings);
  const { defaultModelRef, defaultImageModelRef, defaultImageGenerationModelRef, defaultVideoGenerationModelRef, defaultMusicGenerationModelRef } = useAgentsStore();

  const boundChannelAccounts = channelGroups.flatMap((group) =>
    group.accounts
      .filter((account) => account.agentId === agent.id)
      .map((account) => {
        const channelName = CHANNEL_NAMES[group.channelType as ChannelType] || group.channelType;
        const accountLabel =
          account.accountId === 'default' ? t('settingsDialog.mainAccount') : account.name || account.accountId;
        return `${channelName} · ${accountLabel}`;
      }),
  );
  const channelsText = boundChannelAccounts.length > 0 ? boundChannelAccounts.join(', ') : t('none');

  const configuredModels = [
    { type: 'text', ref: agent.overrideModelRef || defaultModelRef, isOverride: !!agent.overrideModelRef },
    { type: 'image', ref: agent.overrideImageModelRef || defaultImageModelRef, isOverride: !!agent.overrideImageModelRef },
    { type: 'image_generate', ref: agent.overrideImageGenerationModelRef || defaultImageGenerationModelRef, isOverride: !!agent.overrideImageGenerationModelRef },
    { type: 'music_generate', ref: agent.overrideMusicGenerationModelRef || defaultMusicGenerationModelRef, isOverride: !!agent.overrideMusicGenerationModelRef },
    { type: 'video_generate', ref: agent.overrideVideoGenerationModelRef || defaultVideoGenerationModelRef, isOverride: !!agent.overrideVideoGenerationModelRef },
    { type: 'tts', ref: ttsModelRef, isOverride: false },
    { type: 'transcription', ref: transcriptionModelRef, isOverride: false },
  ].filter(m => !!m.ref);

  const getBadgeColor = (type: string) => {
    return MODEL_KIND_COLORS[type as ModelKind] || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
  };

  const stripProviderPrefix = (ref: string) => {
    const parts = ref.split('/');
    return parts.length > 1 ? parts.slice(1).join('/') : ref;
  };

  return (
    <div
      data-testid={`agent-card-${agent.id}`}
      data-highlighted={highlighted ? 'true' : undefined}
      className={cn(
        'group flex items-start gap-4 p-4 rounded-2xl transition-all text-left border relative overflow-hidden bg-transparent border-transparent hover:bg-black/5 dark:hover:bg-white/5',
        // Inset ring: the scroll container (overflow-y-auto, no top/left padding)
        // clips an outset ring's box-shadow at its edges, so draw the highlight
        // inside the card box where it can never be clipped or occluded.
        highlighted && 'ring-2 ring-inset ring-primary/60',
        agent.isDefault && 'bg-black/[0.04] dark:bg-white/[0.06]',
      )}
    >
      <div className="h-[46px] w-[46px] shrink-0 flex items-center justify-center text-primary bg-primary/10 rounded-full shadow-sm mb-3">
        <Bot className="h-[22px] w-[22px]" />
      </div>
      <div className="flex flex-col flex-1 min-w-0 py-0.5 mt-1">
        <div className="flex items-center justify-between gap-3 mb-1">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-[16px] font-semibold text-foreground truncate">{agent.name}</h2>
            {agent.isDefault && (
              <Badge
                variant="secondary"
                className="flex items-center gap-1 font-mono text-[10px] font-medium px-2 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.08] border-0 shadow-none text-foreground/70"
              >
                <Check className="h-3 w-3" />
                {t('defaultBadge')}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              data-testid={`agent-card-persona-${agent.id}`}
              className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-all"
              onClick={() => onOpenPersona(agent.id)}
              title={t('personaSettings')}
            >
              <UserCog className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              data-testid={`agent-card-bind-channels-${agent.id}`}
              className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-all"
              onClick={() => onOpenChannelBinding(agent.id)}
              title={t('bindChannels')}
            >
              <Link2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              data-testid={`agent-card-settings-${agent.id}`}
              className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-all"
              onClick={onOpenSettings}
              title={t('settings')}
            >
              <Settings2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              data-testid={`agent-card-delete-${agent.id}`}
              className="opacity-0 group-hover:opacity-100 h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
              onClick={onDelete}
              title={t('deleteAgent')}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-1 mb-2">
          {configuredModels.map((m, i) => (
            <Badge
              key={i}
              variant="secondary"
              role="button"
              tabIndex={0}
              data-testid={`agent-card-model-tag-${agent.id}-${i}`}
              className={cn(
                "font-mono text-[10px] font-medium px-2 py-0 border-0 shadow-none cursor-pointer transition-all hover:brightness-95 dark:hover:brightness-110 focus-visible:ring-2 focus-visible:ring-primary/50 focus:outline-none",
                getBadgeColor(m.type)
              )}
              title={t('goToModels')}
              aria-label={t('goToModels')}
              onClick={() => openSettings('models', m.ref as string)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSettings('models', m.ref as string); } }}
            >
              <span className="opacity-70 mr-1">{t(`settingsDialog.slotKind.${m.type}`, m.type)}:</span>
              {stripProviderPrefix(m.ref as string)}
            </Badge>
          ))}
        </div>
        <p className="text-[13.5px] text-muted-foreground line-clamp-2 leading-[1.5]">
          {t('channelsLine', { channels: channelsText })}
        </p>
      </div>
    </div>
  );
}

const inputClasses =
  'h-[44px] rounded-xl font-mono text-meta bg-transparent border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:border-blue-500 shadow-sm transition-all text-foreground placeholder:text-foreground/40';
const selectClasses =
  'h-[44px] w-full rounded-xl font-mono text-meta bg-background border border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:border-blue-500 shadow-sm transition-all text-foreground px-3';
const labelClasses = 'text-sm text-foreground/80 font-bold';

function AgentSkillSelector({
  availableSkills,
  selectedSkills,
  onChange,
  title,
  description,
  searchPlaceholder,
  emptyText,
  testIdPrefix,
}: {
  availableSkills: Skill[];
  selectedSkills: string[];
  onChange: (skills: string[]) => void;
  title: string;
  description: string;
  searchPlaceholder: string;
  emptyText: string;
  testIdPrefix: string;
}) {
  const { t } = useTranslation('agents');
  const { defaultAgentSkills } = useAgentsStore();
  const skillsLoading = useSkillsStore((state) => state.loading);

  return (
    <SkillAllowlistPicker
      availableSkills={availableSkills}
      selectedSkills={selectedSkills}
      onChange={onChange}
      title={title}
      description={description}
      searchPlaceholder={searchPlaceholder}
      emptyText={emptyText}
      testIdPrefix={testIdPrefix}
      globalSkillIds={defaultAgentSkills}
      globalSectionTitle={t('skills.globalSection')}
      globalSectionDescription={t('skills.globalSectionHint')}
      otherSectionTitle={t('skills.otherSection')}
      otherSectionDescription={t('skills.otherSectionHint')}
      pageSectionLayout
      isLoading={skillsLoading}
    />
  );
}

function ChannelLogo({ type }: { type: ChannelType }) {
  switch (type) {
    case 'telegram':
      return <img src={telegramIcon} alt="Telegram" className="w-[20px] h-[20px] dark:invert" />;
    case 'discord':
      return <img src={discordIcon} alt="Discord" className="w-[20px] h-[20px] dark:invert" />;
    case 'whatsapp':
      return <img src={whatsappIcon} alt="WhatsApp" className="w-[20px] h-[20px] dark:invert" />;
    case 'wechat':
      return <img src={wechatIcon} alt="WeChat" className="w-[20px] h-[20px] dark:invert" />;
    case 'dingtalk':
      return <img src={dingtalkIcon} alt="DingTalk" className="w-[20px] h-[20px] dark:invert" />;
    case 'feishu':
      return <img src={feishuIcon} alt="Feishu" className="w-[20px] h-[20px] dark:invert" />;
    case 'wecom':
      return <img src={wecomIcon} alt="WeCom" className="w-[20px] h-[20px] dark:invert" />;
    case 'qqbot':
      return <img src={qqIcon} alt="QQ" className="w-[20px] h-[20px] dark:invert" />;
    default:
      return <span className="text-[20px] leading-none">{CHANNEL_ICONS[type] || '💬'}</span>;
  }
}

function AddAgentDialog({
  availableSkills,
  onClose,
  onCreate,
}: {
  availableSkills: Skill[];
  onClose: () => void;
  onCreate: (name: string, options: { id?: string; inheritWorkspace: boolean; skills: string[] }) => Promise<void>;
}) {
  const { t } = useTranslation('agents');
  const { defaultAgentSkills } = useAgentsStore();
  const [name, setName] = useState('');
  const [inheritWorkspace, setInheritWorkspace] = useState(false);
  const [selectedSkills, setSelectedSkills] = useState<string[]>(() =>
    resolveAgentSkillSelection(defaultAgentSkills, availableSkills),
  );
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      // Let the backend derive a unique agent id from the name. Forwarding a
      // pre-slugified id here would take the explicit-id path in createAgent,
      // which skips uniqueness suffixing — e.g. the name "main" collapses to the
      // reserved-name fallback id "agent" and fails with "already exists".
      await onCreate(name.trim(), {
        inheritWorkspace,
        skills: normalizeSkillsSelectionForPersist(selectedSkills, availableSkills),
      });
      onClose();
    } catch (error) {
      toast.error(t('toast.agentCreateFailed', { error: String(error) }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        asChild
        className="w-[calc(100%-2rem)] max-w-2xl max-h-[90vh] flex flex-col rounded-3xl border-0 shadow-2xl bg-surface-modal overflow-hidden"
      >
        <Card data-testid="add-agent-dialog">
          <CardHeader className="pb-2 shrink-0">
            <DialogTitle asChild>
              <CardTitle className="text-2xl font-serif font-normal tracking-tight">
                {t('createDialog.title')}
              </CardTitle>
            </DialogTitle>
            <DialogDescription asChild>
              <CardDescription className="text-sm mt-1 text-foreground/70">
                {t('createDialog.description')}
              </CardDescription>
            </DialogDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-4 p-6 overflow-y-auto flex-1">
            <div className="space-y-2.5">
              <Label htmlFor="agent-name" className={labelClasses}>
                {t('createDialog.nameLabel')}
              </Label>
              <Input
                id="agent-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('createDialog.namePlaceholder')}
                className={inputClasses}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="inherit-workspace" className={labelClasses}>
                  {t('createDialog.inheritWorkspaceLabel')}
                </Label>
                <p className="text-meta text-foreground/60">{t('createDialog.inheritWorkspaceDescription')}</p>
              </div>
              <Switch id="inherit-workspace" checked={inheritWorkspace} onCheckedChange={setInheritWorkspace} />
            </div>

            <AgentSkillSelector
              availableSkills={availableSkills}
              selectedSkills={selectedSkills}
              onChange={setSelectedSkills}
              title={t('createDialog.skillsTitle')}
              description={t('createDialog.skillsDescription')}
              searchPlaceholder={t('skills.searchPlaceholder')}
              emptyText={t('skills.empty')}
              testIdPrefix="agent-create-skills"
            />

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={onClose}
                data-testid="agent-create-exit"
                className="h-9 text-meta font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground"
              >
                {t('common:actions.cancel')}
              </Button>
              <Button
                onClick={() => void handleSubmit()}
                disabled={saving || !name.trim()}
                data-testid="agent-create-save"
                className="h-9 text-meta font-medium rounded-full px-4 shadow-none"
              >
                {saving ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    {t('creating')}
                  </>
                ) : (
                  t('common:actions.save')
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </DialogContent>
    </Dialog>
  );
}

function AgentSettingsModal({
  agent,
  availableSkills,
  channelGroups,
  onClose,
  onIdChange,
}: {
  agent: AgentSummary;
  availableSkills: Skill[];
  channelGroups: ChannelGroupItem[];
  onClose: () => void;
  onIdChange: (newId: string) => void;
}) {
  const { t } = useTranslation('agents');
  const {
    updateAgent,
    updateAgentModel,
    updateAgentAutoSelect,
    defaultModelRef,
    setDefaultAgent,
  } = useAgentsStore();
  const { fetchSkills: fetchSkillsPool } = useSkillsStore();
  const [name, setName] = useState(agent.name);
  const [selectedSkills, setSelectedSkills] = useState<string[]>(() =>
    resolveAgentSkillSelection(agent.skills || [], availableSkills),
  );
  const [saving, setSaving] = useState(false);
  const [settingDefault, setSettingDefault] = useState(false);
  const [showModelModal, setShowModelModal] = useState(false);
  const [showIdModal, setShowIdModal] = useState(false);
  const [modelDraft, setModelDraft] = useState<AgentModelDraft>(() => ({
    overrideModelRef: agent.overrideModelRef || null,
    autoSelectText: !!agent.autoSelectModel?.model,
    optimizationProfile: agent.optimizationProfile ?? 'balanced',
    sensitiveMode: !!agent.sensitiveMode,
  }));

  useEffect(() => {
     
    setName(agent.name);
  }, [agent.name]);
  useEffect(() => {
     
    setSelectedSkills(resolveAgentSkillSelection(agent.skills || [], availableSkills));
  }, [agent.skills, availableSkills]);

  const configuredModels = [
    { type: 'text', ref: modelDraft.overrideModelRef || defaultModelRef, isOverride: !!modelDraft.overrideModelRef },
  ].filter(m => !!m.ref);

  const hasNameChanges = name.trim() !== agent.name;
  const hasSkillsChanges = agentSkillsSelectionChanged(
    selectedSkills,
    agent.skills || [],
    availableSkills,
  );
  const hasModelOverrideChanges =
    (modelDraft.overrideModelRef || '').trim() !== (agent.overrideModelRef || '').trim();
  const hasModelOptionsChanges =
    modelDraft.autoSelectText !== !!agent.autoSelectModel?.model ||
    modelDraft.optimizationProfile !== (agent.optimizationProfile ?? 'balanced') ||
    modelDraft.sensitiveMode !== !!agent.sensitiveMode;
  const hasModelChanges = hasModelOverrideChanges || hasModelOptionsChanges;
  const hasChanges = hasNameChanges || hasSkillsChanges || hasModelChanges;

  const handleSaveAll = async () => {
    if (!hasChanges) return;
    setSaving(true);
    try {
      const updates: { name?: string; skills?: string[] } = {};
      if (hasNameChanges && name.trim()) {
        updates.name = name.trim();
      }
      if (hasSkillsChanges) {
        updates.skills = normalizeSkillsSelectionForPersist(selectedSkills, availableSkills);
      }

      if (hasNameChanges || hasSkillsChanges) {
        await updateAgent(agent.id, updates);
      }
      if (hasModelOverrideChanges) {
        await updateAgentModel(agent.id, modelDraft.overrideModelRef, 'model');
      }
      if (hasModelOptionsChanges) {
        await updateAgentAutoSelect(agent.id, {
          autoSelectModel: { model: modelDraft.autoSelectText },
          optimizationProfile: modelDraft.optimizationProfile,
          sensitiveMode: modelDraft.sensitiveMode,
        });
      }
      toast.success(t('toast.agentUpdated'));

      // Refresh skills to update skill-agent mappings in Skills page
      if (hasSkillsChanges) {
        await fetchSkillsPool();
      }

      onClose();
    } catch (error) {
      toast.error(t('toast.agentUpdateFailed', { error: String(error) }));
    } finally {
      setSaving(false);
    }
  };

  const assignedChannels = channelGroups.flatMap((group) =>
    group.accounts
      .filter((account) => account.agentId === agent.id)
      .map((account) => ({
        channelType: group.channelType as ChannelType,
        accountId: account.accountId,
        name: account.accountId === 'default' ? t('settingsDialog.mainAccount') : account.name || account.accountId,
        error: account.lastError,
      })),
  );

  return (
    <Dialog open onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        asChild
        className="w-[calc(100%-2rem)] max-w-2xl max-h-[90vh] flex flex-col rounded-3xl border-0 shadow-2xl bg-surface-modal overflow-hidden"
      >
        <Card>
          <CardHeader className="flex flex-row items-start justify-between pb-2 shrink-0">
            <div>
              <DialogTitle asChild>
                <CardTitle className="text-2xl font-serif font-normal tracking-tight">
                  {t('settingsDialog.title', { name: agent.name })}
                </CardTitle>
              </DialogTitle>
              <DialogDescription asChild>
                <CardDescription className="text-sm mt-1 text-foreground/70">
                  {t('settingsDialog.description')}
                </CardDescription>
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2 -mr-1 -mt-1">
              <Button
                data-testid="agent-settings-save-all"
                onClick={() => void handleSaveAll()}
                disabled={!hasChanges || saving}
                className="h-9 text-meta font-medium rounded-full px-4 shadow-none text-white"
              >
                {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : t('common:actions.save')}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                data-testid="agent-settings-exit"
                onClick={onClose}
                className="rounded-full h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6 pt-4 overflow-y-auto flex-1 p-6">
            <div className="space-y-4">
              <div className="space-y-2.5">
                <Label htmlFor="agent-settings-name" className={labelClasses}>
                  {t('settingsDialog.nameLabel')}
                </Label>
                <Input
                  id="agent-settings-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className={inputClasses}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setShowIdModal(true)}
                  disabled={agent.id === 'main'}
                  className={cn(
                    "space-y-1 rounded-2xl bg-black/5 dark:bg-white/5 border border-transparent p-4 text-left transition-colors",
                    agent.id !== 'main' && "hover:bg-black/10 dark:hover:bg-white/10"
                  )}
                >
                  <p className="text-tiny uppercase tracking-[0.08em] text-muted-foreground/80 font-medium">
                    {t('settingsDialog.agentIdLabel')}
                  </p>
                  <p className="font-mono text-meta text-foreground">{agent.id}</p>
                </button>
                <button
                  type="button"
                  data-testid="agent-settings-model"
                  onClick={() => setShowModelModal(true)}
                  className="space-y-2 rounded-2xl bg-black/5 dark:bg-white/5 border border-transparent p-4 text-left hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                >
                  <p className="text-tiny uppercase tracking-[0.08em] text-muted-foreground/80 font-medium">
                    {t('settingsDialog.modelLabel')}
                  </p>
                  {configuredModels.length > 0 ? (
                    <div className="space-y-1.5">
                      {configuredModels.map((m, i) => (
                        <div key={i} className="flex flex-col">
                          <div className="flex items-center gap-1.5">
                            <span className="text-meta font-medium text-foreground/80">
                              {t(`settingsDialog.slotKind.${m.type}`, m.type)}
                            </span>
                            {!m.isOverride && (
                              <span className="text-tiny text-muted-foreground">({t('inherited')})</span>
                            )}
                          </div>
                          <p className="font-mono text-xs text-foreground/70 break-all">
                            {m.ref}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="font-mono text-xs text-foreground/70 break-all">-</p>
                  )}
                </button>
              </div>
            </div>

            {!agent.isDefault && (
              <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.04] p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">{t('settingsDialog.setAsDefaultButton')}</p>
                  <p className="text-meta text-muted-foreground mt-1">{t('settingsDialog.setAsDefaultHint')}</p>
                </div>
                <Button
                  variant="outline"
                  disabled={settingDefault}
                  onClick={() => {
                    void (async () => {
                      setSettingDefault(true);
                      try {
                        await setDefaultAgent(agent.id);
                        toast.success(t('toast.defaultAgentUpdated'));
                        onClose();
                      } catch (error) {
                        toast.error(t('toast.defaultAgentUpdateFailed', { error: String(error) }));
                      } finally {
                        setSettingDefault(false);
                      }
                    })();
                  }}
                  className="h-9 shrink-0 text-meta font-medium rounded-full px-4 border-black/10 dark:border-white/10"
                >
                  {settingDefault ? <RefreshCw className="h-4 w-4 animate-spin" /> : t('settingsDialog.setAsDefaultButton')}
                </Button>
              </div>
            )}

            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-xl font-serif text-foreground font-normal tracking-tight">
                    {t('settingsDialog.channelsTitle')}
                  </h3>
                  <p className="text-sm text-foreground/70 mt-1">{t('settingsDialog.channelsDescription')}</p>
                </div>
              </div>

              {assignedChannels.length === 0 && agent.channelTypes.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 p-4 text-sm text-muted-foreground">
                  {t('settingsDialog.noChannels')}
                </div>
              ) : (
                <div className="space-y-3">
                  {assignedChannels.map((channel) => (
                    <div
                      key={`${channel.channelType}-${channel.accountId}`}
                      className="flex items-center justify-between rounded-2xl bg-black/5 dark:bg-white/5 border border-transparent p-4"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-[40px] w-[40px] shrink-0 flex items-center justify-center text-foreground bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-full shadow-sm">
                          <ChannelLogo type={channel.channelType} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground">{channel.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {CHANNEL_NAMES[channel.channelType]} ·{' '}
                            {channel.accountId === 'default' ? t('settingsDialog.mainAccount') : channel.accountId}
                          </p>
                          {channel.error && <p className="text-xs text-destructive mt-1">{channel.error}</p>}
                        </div>
                      </div>
                      <div className="shrink-0" />
                    </div>
                  ))}
                  {assignedChannels.length === 0 && agent.channelTypes.length > 0 && (
                    <div className="rounded-2xl border border-dashed border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 p-4 text-sm text-muted-foreground">
                      {t('settingsDialog.channelsManagedInChannels')}
                    </div>
                  )}
                </div>
              )}
            </div>

            <AgentSkillSelector
              availableSkills={availableSkills}
              selectedSkills={selectedSkills}
              onChange={setSelectedSkills}
              title={t('settingsDialog.skillsTitle')}
              description={t('settingsDialog.skillsDescription')}
              searchPlaceholder={t('skills.searchPlaceholder')}
              emptyText={t('skills.empty')}
              testIdPrefix="agent-settings-skills"
            />
          </CardContent>
        </Card>
      </DialogContent>
      {showModelModal && (
        <AgentModelModal
          agent={{
            ...agent,
            overrideModelRef: modelDraft.overrideModelRef,
            autoSelectModel: {
              ...agent.autoSelectModel,
              model: modelDraft.autoSelectText,
            },
            optimizationProfile: modelDraft.optimizationProfile,
            sensitiveMode: modelDraft.sensitiveMode,
          }}
          onSave={setModelDraft}
          onClose={() => setShowModelModal(false)}
        />
      )}
      {showIdModal && (
        <AgentIdModal
          agent={agent}
          onClose={() => setShowIdModal(false)}
          onIdChange={onIdChange}
        />
      )}
    </Dialog>
  );
}


function AgentChannelBindingModal({
  agent,
  agents,
  channelGroups,
  onClose,
  onChanged,
}: {
  agent: AgentSummary;
  agents: AgentSummary[];
  channelGroups: ChannelGroupItem[];
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const { t } = useTranslation('agents');
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const agentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of agents) map.set(item.id, item.name);
    return map;
  }, [agents]);

  const accountKey = (channelType: string, accountId: string) => `${channelType}:${accountId}`;
  const totalAccounts = channelGroups.reduce((sum, group) => sum + group.accounts.length, 0);

  const handleToggle = async (channelType: string, accountId: string, nextBound: boolean) => {
    const key = accountKey(channelType, accountId);
    const channelLabel = CHANNEL_NAMES[channelType as ChannelType] || channelType;
    setPendingKey(key);
    try {
      if (nextBound) {
        await hostApi.channels.saveBinding({ channelType, accountId, agentId: agent.id });
        toast.success(t('toast.channelAssigned', { channel: channelLabel }));
      } else {
        await hostApi.channels.deleteBinding({ channelType, accountId });
        toast.success(t('toast.channelUnassigned', { channel: channelLabel }));
      }
      await onChanged();
    } catch (error) {
      toast.error(t('toast.channelAssignFailed', { error: String(error) }));
    } finally {
      setPendingKey(null);
    }
  };

  return (
    <Dialog open onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        asChild
        className="w-[calc(100%-2rem)] max-w-2xl max-h-[90vh] flex flex-col rounded-3xl border-0 shadow-2xl bg-surface-modal overflow-hidden"
      >
        <Card>
          <CardHeader className="flex flex-row items-start justify-between pb-2 shrink-0">
            <div>
              <DialogTitle asChild>
                <CardTitle className="text-2xl font-serif font-normal tracking-tight">
                  {t('channelBindingDialog.title', { name: agent.name })}
                </CardTitle>
              </DialogTitle>
              <DialogDescription asChild>
                <CardDescription className="text-sm mt-1 text-foreground/70">
                  {t('channelBindingDialog.description')}
                </CardDescription>
              </DialogDescription>
            </div>
            <Button
              variant="ghost"
              size="icon"
              data-testid="agent-channel-binding-exit"
              onClick={onClose}
              className="rounded-full h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5"
            >
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent
            data-testid="agent-channel-binding-content"
            className="space-y-6 pt-4 overflow-y-auto flex-1 p-6"
          >
            {totalAccounts === 0 ? (
              <div className="rounded-2xl border border-dashed border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 p-6 text-center">
                <p className="text-sm font-semibold text-foreground">{t('channelBindingDialog.emptyTitle')}</p>
                <p className="text-sm text-muted-foreground mt-1">{t('channelBindingDialog.emptyDescription')}</p>
              </div>
            ) : (
              channelGroups.map((group) => (
                <div key={group.channelType} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="h-[32px] w-[32px] shrink-0 flex items-center justify-center text-foreground bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-full shadow-sm">
                      <ChannelLogo type={group.channelType as ChannelType} />
                    </div>
                    <h3 className="text-lg font-serif text-foreground font-normal tracking-tight">
                      {CHANNEL_NAMES[group.channelType as ChannelType] || group.channelType}
                    </h3>
                  </div>
                  <div className="space-y-2">
                    {group.accounts.map((account) => {
                      const key = accountKey(group.channelType, account.accountId);
                      const boundToThis = account.agentId === agent.id;
                      const boundToOther = !!account.agentId && account.agentId !== agent.id;
                      const ownerName = boundToOther
                        ? agentNameById.get(account.agentId as string) || (account.agentId as string)
                        : '';
                      const accountLabel =
                        account.accountId === 'default'
                          ? t('settingsDialog.mainAccount')
                          : account.name || account.accountId;
                      const pending = pendingKey === key;
                      return (
                        <div
                          key={key}
                          data-testid={`agent-channel-binding-account-${group.channelType}-${account.accountId}`}
                          className={cn(
                            'flex items-center justify-between gap-3 rounded-2xl bg-black/5 dark:bg-white/5 border border-transparent p-4',
                            pending && 'opacity-60',
                          )}
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-foreground truncate">{accountLabel}</p>
                            {boundToOther && (
                              <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-1">
                                {t('channelBindingDialog.boundToOther', { agent: ownerName })}
                              </p>
                            )}
                          </div>
                          <Switch
                            data-testid={`agent-channel-binding-toggle-${group.channelType}-${account.accountId}`}
                            checked={boundToThis}
                            disabled={pending}
                            onCheckedChange={(checked) => {
                              void handleToggle(group.channelType, account.accountId, checked);
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </DialogContent>
    </Dialog>
  );
}


function AgentIdModal({
  agent,
  onClose,
  onIdChange,
}: {
  agent: AgentSummary;
  onClose: () => void;
  onIdChange: (newId: string) => void;
}) {
  const { t } = useTranslation('agents');
  const { updateAgentId } = useAgentsStore();
  const [agentId, setAgentId] = useState(agent.id);
  const [savingId, setSavingId] = useState(false);

  const handleSaveId = async () => {
    const newId = agentId.trim().toLowerCase();
    if (!newId || newId === agent.id) return;
    setSavingId(true);
    try {
      await updateAgentId(agent.id, newId);
      onIdChange(newId);
      toast.success(t('toast.agentIdUpdated'));
      onClose();
    } catch (error) {
      toast.error(t('toast.agentIdUpdateFailed', { error: String(error) }));
      setSavingId(false);
    }
  };

  return (
    <Dialog open onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        asChild
        className="z-[60] w-[calc(100%-2rem)] max-w-md rounded-3xl border-0 shadow-2xl bg-surface-modal overflow-hidden"
      >
        <Card>
          <CardHeader className="flex flex-row items-start justify-between pb-2 shrink-0">
            <DialogTitle asChild>
              <CardTitle className="text-2xl font-serif font-normal tracking-tight">
                {t('settingsDialog.agentIdLabel')}
              </CardTitle>
            </DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="rounded-full h-8 w-8 -mr-2 -mt-2 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5"
            >
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-4 p-6 pt-2">
            <div className="space-y-2">
              <Input
                value={agentId}
                onChange={(event) => setAgentId(event.target.value)}
                className="h-10 text-sm font-mono bg-surface-input border-black/10 dark:border-white/10"
                placeholder={t('settingsDialog.agentIdLabel')}
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={onClose}
                className="h-9 text-meta font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground"
              >
                {t('common:actions.cancel')}
              </Button>
              <Button
                onClick={() => void handleSaveId()}
                disabled={savingId || !agentId.trim() || agentId.trim().toLowerCase() === agent.id}
                className="h-9 text-meta font-medium rounded-full px-4 shadow-none"
              >
                {savingId ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  t('common:actions.save')
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </DialogContent>
    </Dialog>
  );
}

type TargetSlot = 'model' | 'imageModel' | 'imageGenerationModel' | 'videoGenerationModel' | 'musicGenerationModel';

function AgentModelModal({
  agent,
  onSave,
  onClose,
}: {
  agent: AgentSummary;
  onSave: (draft: AgentModelDraft) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('agents');
  const providerAccounts = useProviderStore((state) => state.accounts);
  const providerStatuses = useProviderStore((state) => state.statuses);
  const providerVendors = useProviderStore((state) => state.vendors);
  const providerDefaultAccountId = useProviderStore((state) => state.defaultAccountId);

  const { defaultModelRef } = useAgentsStore();

  const [slotState, setSlotState] = useState<{ providerKey: string, modelId: string }>({ providerKey: '', modelId: '' });
  const [slotStatesInitialized, setSlotStatesInitialized] = useState(false);
  const [slotEnabled, setSlotEnabled] = useState<boolean>(!!agent.overrideModelRef);
  const [autoSelectText, setAutoSelectText] = useState<boolean>(!!agent.autoSelectModel?.model);
  const [optimizationProfile, setOptimizationProfile] = useState<'quality' | 'balanced' | 'cost' | 'latency'>(
    agent.optimizationProfile ?? 'balanced',
  );
  const [sensitiveMode, setSensitiveMode] = useState<boolean>(!!agent.sensitiveMode);

  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  const runtimeProviderOptions = useMemo<RuntimeProviderOption[]>(() => {
    const vendorMap = new Map<string, ProviderVendorInfo>(providerVendors.map((vendor) => [vendor.id, vendor]));
    const statusById = new Map<string, ProviderWithKeyInfo>(providerStatuses.map((status) => [status.id, status]));

    const currentKind: ModelKind = 'text';

    const entries = providerAccounts
      .filter((account) => {
        if (!account.enabled || !hasConfiguredProviderCredentials(account, statusById)) return false;
        const vendor = vendorMap.get(account.vendorId);
        const kinds = accountModelKinds(account, vendor);
        return kinds.includes(currentKind);
      })
      .sort((left, right) => {
        if (left.id === providerDefaultAccountId) return -1;
        if (right.id === providerDefaultAccountId) return 1;
        return right.updatedAt.localeCompare(left.updatedAt);
      });

    const deduped = new Map<string, RuntimeProviderOption>();
    for (const account of entries) {
      const runtimeProviderKey = resolveRuntimeProviderKey(account);
      if (!runtimeProviderKey || deduped.has(runtimeProviderKey)) continue;
      const vendor = vendorMap.get(account.vendorId);
      const label = `${account.label} (${vendor?.name || account.vendorId})`;
      const normalizedTypes = accountModelKinds(account, vendor);
      const kindIndex = normalizedTypes.indexOf(currentKind);
      const modelArray = (Array.isArray(account.model) ? account.model : [account.model || '']).flatMap(id => id.split(','));
      // Pick the model id sitting at this kind's position in the account's
      // positional model array (text/image/music/video/tts) — NOT always index 0,
      // otherwise selecting a music/video provider would surface the chat model.
      const positionalRaw = (kindIndex >= 0 ? modelArray[kindIndex] : modelArray[0]) || '';
      const positionalModel = positionalRaw.startsWith(`${runtimeProviderKey}/`)
        ? positionalRaw.slice(runtimeProviderKey.length + 1)
        : positionalRaw;

      let currentPlaceholder: string | string[] | undefined;
      if (vendor?.modelIdPlaceholder) {
        if (Array.isArray(vendor.modelIdPlaceholder) && vendor.modelType && Array.isArray(vendor.modelType)) {
          if (kindIndex !== -1 && vendor.modelIdPlaceholder[kindIndex] !== undefined) {
            currentPlaceholder = vendor.modelIdPlaceholder[kindIndex] as string | string[];
          } else {
            currentPlaceholder = vendor.modelIdPlaceholder as string | string[];
          }
        } else {
          currentPlaceholder = vendor.modelIdPlaceholder as string | string[];
        }
      }

      // When the account hasn't persisted a model for this kind (e.g. OAuth
      // providers that only store the chat model), fall back to the kind's
      // recommended default so the picker pre-selects e.g. music-2.6 / Hailuo.
      const placeholderDefault = Array.isArray(currentPlaceholder)
        ? (currentPlaceholder[0] || '')
        : (typeof currentPlaceholder === 'string' ? currentPlaceholder : '');
      const configuredModelId = positionalModel.trim() || placeholderDefault;

      deduped.set(runtimeProviderKey, {
        runtimeProviderKey,
        accountId: account.id,
        label,
        modelIdPlaceholder: currentPlaceholder,
        configuredModelId,
      });
    }

    return [...deduped.values()];
  }, [providerAccounts, providerDefaultAccountId, providerStatuses, providerVendors]);

  useEffect(() => {
    if (slotStatesInitialized) return;

    const vendorMap = new Map<string, ProviderVendorInfo>(providerVendors.map((vendor) => [vendor.id, vendor]));

    const getSupportedKinds = (providerKey: string): ModelKind[] => {
      const account = providerAccounts.find(a => resolveRuntimeProviderKey(a) === providerKey);
      if (!account) return [];
      const vendor = vendorMap.get(account.vendorId);
      return accountModelKinds(account, vendor);
    };


    let keyToSelect = '';
    let idToSet = '';

    const override = splitModelRef(agent.overrideModelRef);
    const effective = override || splitModelRef(defaultModelRef);

    if (effective) {
      keyToSelect = effective.providerKey;
      idToSet = effective.modelId;
    }

    if (keyToSelect) {
      const accountExists = providerAccounts.some(a => resolveRuntimeProviderKey(a) === keyToSelect);
      if (!accountExists) {
        const fallbackAccount = providerAccounts.find(a => resolveRuntimeProviderKey(a).startsWith(`${keyToSelect}-`));
        if (fallbackAccount) {
          keyToSelect = resolveRuntimeProviderKey(fallbackAccount);
        }
      }
    }

    const supportedKinds = getSupportedKinds(keyToSelect);
    const requiredKind: ModelKind = 'text';
    const isSupported = supportedKinds.includes(requiredKind);

    if (!isSupported) {
      keyToSelect = '';
      idToSet = '';
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSlotState({
      providerKey: keyToSelect,
      modelId: idToSet,
    });

    setSlotEnabled(prevEnabled => {
      if (agent.overrideModelRef && !isSupported) {
        return false;
      }
      return prevEnabled;
    });

    setSlotStatesInitialized(true);
  }, [
    agent.overrideModelRef,
    defaultModelRef,
    providerAccounts, providerVendors, slotStatesInitialized
  ]);

  const currentSlotState = slotState;
  const selectedProvider = runtimeProviderOptions.find((option) => option.runtimeProviderKey === currentSlotState.providerKey) || null;
  const trimmedModelId = currentSlotState.modelId.trim();
  const nextModelRef = currentSlotState.providerKey && trimmedModelId
    ? `${currentSlotState.providerKey}/${trimmedModelId}`
    : '';

  const getDefRefForActiveTab = () => {
    return defaultModelRef;
  };

  const hasAnyChange = (() => {
    const persistedOverrideRef = (agent.overrideModelRef || '').trim();
    const pendingOverrideRef = slotEnabled ? nextModelRef : '';

    // Dirty state must compare the value that Save will persist, rather than the
    // effective global default shown while inheritance is active. An explicit
    // override remains a real change even when it selects the global default.
    return pendingOverrideRef !== persistedOverrideRef;
  })();

  const autoSelectChanged =
    autoSelectText !== !!agent.autoSelectModel?.model ||
    optimizationProfile !== (agent.optimizationProfile ?? 'balanced') ||
    sensitiveMode !== !!agent.sensitiveMode;

  const handleRequestClose = () => {
    if (hasAnyChange || autoSelectChanged) {
      setShowCloseConfirm(true);
      return;
    }
    onClose();
  };

  const handleSaveModel = () => {
    let overrideModelRef: string | null = null;
    if (slotEnabled) {
      const st = slotState;
      if (!st.providerKey) {
        toast.error(t('toast.agentModelProviderRequired'));
        return;
      }
      if (!st.modelId.trim()) {
        toast.error(t('toast.agentModelIdRequired'));
        return;
      }

      overrideModelRef = `${st.providerKey}/${st.modelId.trim()}`;
      if (!overrideModelRef.includes('/')) {
        toast.error(t('toast.agentModelInvalid'));
        return;
      }
    }

    onSave({
      overrideModelRef,
      autoSelectText,
      optimizationProfile,
      sensitiveMode,
    });
    onClose();
  };



  return (
    <Dialog open onOpenChange={(nextOpen) => !nextOpen && handleRequestClose()}>
      <DialogContent
        asChild
        data-testid="agent-model-modal"
        className="z-[60] w-[calc(100%-2rem)] max-w-xl max-h-[90vh] flex flex-col rounded-3xl border-0 shadow-2xl bg-surface-modal overflow-hidden"
      >
        <Card>
          <CardHeader className="flex flex-row items-start justify-between pb-2 shrink-0">
            <div>
              <DialogTitle asChild>
                <CardTitle className="text-2xl font-serif font-normal tracking-tight">
                  {t('settingsDialog.modelLabel')}
                </CardTitle>
              </DialogTitle>
              <DialogDescription asChild>
                <CardDescription className="text-sm mt-1 text-foreground/70">
                  {t('settingsDialog.modelOverrideDescription', { defaultModel: getDefRefForActiveTab() || '-' })}
                </CardDescription>
              </DialogDescription>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleRequestClose}
              className="rounded-full h-8 w-8 -mr-2 -mt-2 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5"
            >
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-4 p-6 pt-2 overflow-y-auto flex-1">
            <div className="flex items-center justify-between py-2">
              <div className="space-y-0.5">
                <Label htmlFor="auto-select-model" className="text-sm font-medium text-foreground">
                  {t('settingsDialog.autoSelectLabel', '自动选择模型')}
                </Label>
                <p className="text-meta text-foreground/60">
                  {t('settingsDialog.autoSelectDesc', '运行时按任务特征自动挑选最合适的文本模型（成本/性能综合最优）。')}
                </p>
              </div>
              <Switch
                id="auto-select-model"
                checked={autoSelectText}
                onCheckedChange={(checked) => setAutoSelectText(checked)}
              />
            </div>

            {autoSelectText && (
              <div className="space-y-2">
                <Label htmlFor="auto-select-profile" className="text-xs text-foreground/70">
                  {t('settingsDialog.optimizationProfileLabel', '优化偏好')}
                </Label>
                <select
                  id="auto-select-profile"
                  value={optimizationProfile}
                  onChange={(event) => setOptimizationProfile(event.target.value as 'quality' | 'balanced' | 'cost' | 'latency')}
                  className={selectClasses}
                >
                  <option value="balanced">{t('settingsDialog.profile.balanced', '均衡')}</option>
                  <option value="quality">{t('settingsDialog.profile.quality', '质量优先')}</option>
                  <option value="cost">{t('settingsDialog.profile.cost', '成本优先')}</option>
                  <option value="latency">{t('settingsDialog.profile.latency', '低延迟')}</option>
                </select>
                <p className="text-xs text-foreground/60">
                  {t('settingsDialog.autoSelectHint', '开启后，下方手动模型作为兜底默认；每轮由路由器覆盖。')}
                </p>
                <div className="flex items-center justify-between pt-1">
                  <div className="space-y-0.5">
                    <Label htmlFor="auto-select-sensitive" className="text-meta font-medium text-foreground">
                      {t('settingsDialog.sensitiveModeLabel', '敏感/合规模式')}
                    </Label>
                    <p className="text-xs text-foreground/60">
                      {t('settingsDialog.sensitiveModeHint', '机密任务按来源优先级路由：私有 > 国内 > 海外（英文界面为 私有 > 海外 > 国内）。')}
                    </p>
                  </div>
                  <Switch
                    id="auto-select-sensitive"
                    checked={sensitiveMode}
                    onCheckedChange={(checked) => setSensitiveMode(checked)}
                  />
                </div>
              </div>
            )}

            <div className="h-px bg-black/10 dark:bg-white/10" />

            <div className="flex items-center justify-between py-2">
              <div className="space-y-0.5">
                <Label htmlFor="enable-custom-model" className="text-sm font-medium text-foreground">{t('settingsDialog.enableModelType')}</Label>
                <p className="text-meta text-foreground/60">{t('settingsDialog.enableModelTypeDesc')}</p>
              </div>
              <Switch
                id="enable-custom-model"
                checked={slotEnabled}
                onCheckedChange={(checked) => setSlotEnabled(checked)}
              />
            </div>

            {slotEnabled ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="agent-model-provider" className="text-xs text-foreground/70">{t('settingsDialog.modelProviderLabel')}</Label>
                  <select
                    id="agent-model-provider"
                    value={currentSlotState.providerKey}
                    onChange={(event) => {
                      const nextProvider = event.target.value;
                      const option = runtimeProviderOptions.find((candidate) => candidate.runtimeProviderKey === nextProvider);
                      setSlotState(prev => ({
                        ...prev,
                        providerKey: nextProvider,
                        modelId: option?.configuredModelId || ''
                      }));
                    }}
                    className={selectClasses}
                  >
                    <option value="">{t('settingsDialog.modelProviderPlaceholder')}</option>
                    {runtimeProviderOptions.map((option) => (
                      <option key={option.runtimeProviderKey} value={option.runtimeProviderKey}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="agent-model-id" className="text-xs text-foreground/70">{t('settingsDialog.modelIdLabel')}</Label>
                  <Combobox
                    id="agent-model-id"
                    value={currentSlotState.modelId}
                    onChange={(v) => setSlotState(prev => ({ ...prev, modelId: v }))}
                    options={placeholderToOptions(selectedProvider?.modelIdPlaceholder)}
                    placeholder={
                      (Array.isArray(selectedProvider?.modelIdPlaceholder)
                        ? selectedProvider.modelIdPlaceholder[0]
                        : selectedProvider?.modelIdPlaceholder) as string ||
                      selectedProvider?.configuredModelId ||
                      t('settingsDialog.modelIdPlaceholder')
                    }
                    className={inputClasses}
                  />
                </div>
                {!!nextModelRef && (
                  <p className="text-xs font-mono text-foreground/70 break-all">
                    {t('settingsDialog.modelPreview')}: {nextModelRef}
                  </p>
                )}
                {runtimeProviderOptions.length === 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    {t('settingsDialog.modelProviderEmpty')}
                  </p>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 p-4 text-sm text-muted-foreground">
                {t('settingsDialog.usingDefaultModel')}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="outline"
                data-testid="agent-model-cancel"
                onClick={handleRequestClose}
                className="h-9 text-meta font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground"
              >
                {t('common:actions.cancel')}
              </Button>
              <Button
                data-testid="agent-model-save"
                onClick={handleSaveModel}
                disabled={!hasAnyChange && !autoSelectChanged}
                className="h-9 text-meta font-medium rounded-full px-4 shadow-none text-white"
              >
                {t('common:actions.save')}
              </Button>
            </div>
          </CardContent>
        </Card>
      </DialogContent>
      <ConfirmDialog
        open={showCloseConfirm}
        title={t('settingsDialog.unsavedChangesTitle')}
        message={t('settingsDialog.unsavedChangesMessage')}
        confirmLabel={t('settingsDialog.closeWithoutSaving')}
        cancelLabel={t('common:actions.cancel')}
        // Raise above the model modal's own z-[60] DialogContent so the unsaved-
        // changes confirm isn't rendered behind (and hidden by) the modal.
        className="z-[70]"
        overlayClassName="z-[70]"
        onConfirm={() => {
          setShowCloseConfirm(false);
          onClose();
        }}
        onCancel={() => setShowCloseConfirm(false)}
      />
    </Dialog>
  );
}

function GlobalModelModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const { t } = useTranslation('agents');
  const providerAccounts = useProviderStore((state) => state.accounts);
  const providerStatuses = useProviderStore((state) => state.statuses);
  const providerVendors = useProviderStore((state) => state.vendors);
  const providerDefaultAccountId = useProviderStore((state) => state.defaultAccountId);

  const { updateDefaultModels, defaultModelRef, defaultImageModelRef, defaultImageGenerationModelRef, defaultVideoGenerationModelRef, defaultMusicGenerationModelRef } = useAgentsStore();

  const [activeTab, setActiveTab] = useState<TargetSlot | 'tts' | 'transcription'>('model');

  // Global speech-synthesis (TTS) selection. The user picks an *account*; on save
  // that account's runtime id + endpoint config become messages.tts.provider/providers.
  const [ttsAccountId, setTtsAccountId] = useState<string>('');
  const [ttsAccountIdInitial, setTtsAccountIdInitial] = useState<string>('');
  // Model used for the global TTS provider — maps to messages.tts.providers[<id>].model.
  const [ttsModel, setTtsModel] = useState<string>('');
  const [ttsModelInitial, setTtsModelInitial] = useState<string>('');
  // Raw persisted selection (runtime provider id + endpoint), resolved to an account below.
  const [ttsSelection, setTtsSelection] = useState<{ provider: string; baseUrl: string; model: string } | null>(null);
  const [ttsInitialized, setTtsInitialized] = useState(false);
  // Whether global speech synthesis is enabled — mirrors the per-slot enable toggle
  // pattern. Initialized from whether a TTS provider is already persisted.
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [ttsEnabledInitial, setTtsEnabledInitial] = useState(false);

  // Global speech-transcription (STT) selection — mirrors the TTS state above. On save
  // the chosen account becomes plugins.entries["voice-call"].config.streaming.provider/providers.
  const [sttAccountId, setSttAccountId] = useState<string>('');
  const [sttAccountIdInitial, setSttAccountIdInitial] = useState<string>('');
  const [sttModel, setSttModel] = useState<string>('');
  const [sttModelInitial, setSttModelInitial] = useState<string>('');
  const [sttSelection, setSttSelection] = useState<{ provider: string; baseUrl: string; model: string } | null>(null);
  const [sttInitialized, setSttInitialized] = useState(false);
  const [sttEnabled, setSttEnabled] = useState(false);
  const [sttEnabledInitial, setSttEnabledInitial] = useState(false);

  useEffect(() => {
    let cancelled = false;
    hostApi.voice.selections()
      .then((res) => {
        if (cancelled) return;
        const selections = (res as { selections?: { tts?: { provider?: string; config?: { model?: string; baseUrl?: string } }; transcription?: { provider?: string; config?: { model?: string; baseUrl?: string } } } })?.selections;
        setTtsSelection({
          provider: selections?.tts?.provider ?? '',
          baseUrl: selections?.tts?.config?.baseUrl ?? '',
          model: selections?.tts?.config?.model ?? '',
        });
        setSttSelection({
          provider: selections?.transcription?.provider ?? '',
          baseUrl: selections?.transcription?.config?.baseUrl ?? '',
          model: selections?.transcription?.config?.model ?? '',
        });
      })
      .catch(() => {
        if (cancelled) return;
        setTtsSelection({ provider: '', baseUrl: '', model: '' });
        setSttSelection({ provider: '', baseUrl: '', model: '' });
      });
    return () => { cancelled = true; };
  }, []);

  const [slotStates, setSlotStates] = useState<Record<TargetSlot, { providerKey: string, modelId: string }>>({
    model: { providerKey: '', modelId: '' },
    imageModel: { providerKey: '', modelId: '' },
    imageGenerationModel: { providerKey: '', modelId: '' },
    musicGenerationModel: { providerKey: '', modelId: '' },
    videoGenerationModel: { providerKey: '', modelId: '' },
  });

  const [slotStatesInitialized, setSlotStatesInitialized] = useState(false);

  const [slotEnabled, setSlotEnabled] = useState<Record<TargetSlot, boolean>>({
    model: !!defaultModelRef,
    imageModel: !!defaultImageModelRef,
    imageGenerationModel: !!defaultImageGenerationModelRef,
    musicGenerationModel: !!defaultMusicGenerationModelRef,
    videoGenerationModel: !!defaultVideoGenerationModelRef,
  });

  const [savingModel, setSavingModel] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  const runtimeProviderOptions = useMemo<RuntimeProviderOption[]>(() => {
    const vendorMap = new Map<string, ProviderVendorInfo>(providerVendors.map((vendor) => [vendor.id, vendor]));
    const statusById = new Map<string, ProviderWithKeyInfo>(providerStatuses.map((status) => [status.id, status]));

    // Map TargetSlot to ModelKind
    const kindMap: Record<TargetSlot, ModelKind> = {
      model: 'text',
      imageModel: 'image',
      imageGenerationModel: 'image_generate',
      musicGenerationModel: 'music_generate',
      videoGenerationModel: 'video_generate',
    };
    const currentKind: ModelKind = activeTab === 'tts' ? 'tts' : activeTab === 'transcription' ? 'transcription' : kindMap[activeTab];

    const entries = providerAccounts
      .filter((account) => {
        if (!account.enabled || !hasConfiguredProviderCredentials(account, statusById)) return false;
        const vendor = vendorMap.get(account.vendorId);
        const kinds = accountModelKinds(account, vendor);
        return kinds.includes(currentKind);
      })
      .sort((left, right) => {
        if (left.id === providerDefaultAccountId) return -1;
        if (right.id === providerDefaultAccountId) return 1;
        return right.updatedAt.localeCompare(left.updatedAt);
      });

    const deduped = new Map<string, RuntimeProviderOption>();
    for (const account of entries) {
      const runtimeProviderKey = resolveRuntimeProviderKey(account);
      if (!runtimeProviderKey || deduped.has(runtimeProviderKey)) continue;
      const vendor = vendorMap.get(account.vendorId);
      const label = `${account.label} (${vendor?.name || account.vendorId})`;
      const normalizedTypes = accountModelKinds(account, vendor);
      const kindIndex = normalizedTypes.indexOf(currentKind);
      const modelArray = (Array.isArray(account.model) ? account.model : [account.model || '']).flatMap(id => id.split(','));
      // Pick the model id sitting at this kind's position in the account's
      // positional model array (text/image/music/video/tts) — NOT always index 0,
      // otherwise selecting a music/video provider would surface the chat model.
      const positionalRaw = (kindIndex >= 0 ? modelArray[kindIndex] : modelArray[0]) || '';
      const positionalModel = positionalRaw.startsWith(`${runtimeProviderKey}/`)
        ? positionalRaw.slice(runtimeProviderKey.length + 1)
        : positionalRaw;

      let currentPlaceholder: string | string[] | undefined;
      if (vendor?.modelIdPlaceholder) {
        if (Array.isArray(vendor.modelIdPlaceholder) && vendor.modelType && Array.isArray(vendor.modelType)) {
          if (kindIndex !== -1 && vendor.modelIdPlaceholder[kindIndex] !== undefined) {
            currentPlaceholder = vendor.modelIdPlaceholder[kindIndex] as string | string[];
          } else {
            currentPlaceholder = vendor.modelIdPlaceholder as string | string[];
          }
        } else {
          currentPlaceholder = vendor.modelIdPlaceholder as string | string[];
        }
      }

      // When the account hasn't persisted a model for this kind (e.g. OAuth
      // providers that only store the chat model), fall back to the kind's
      // recommended default so the picker pre-selects e.g. music-2.6 / Hailuo.
      const placeholderDefault = Array.isArray(currentPlaceholder)
        ? (currentPlaceholder[0] || '')
        : (typeof currentPlaceholder === 'string' ? currentPlaceholder : '');
      const configuredModelId = positionalModel.trim() || placeholderDefault;

      deduped.set(runtimeProviderKey, {
        runtimeProviderKey,
        accountId: account.id,
        label,
        modelIdPlaceholder: currentPlaceholder,
        configuredModelId,
      });
    }

    return [...deduped.values()];
  }, [providerAccounts, providerDefaultAccountId, providerStatuses, providerVendors, activeTab]);

  // Accounts that expose a `tts` kind. Listed per-account (NOT deduped by runtime id),
  // because several OpenAI-compatible accounts can share runtime id 'openai' yet have
  // different endpoints — the user must be able to pick a specific one.
  type TtsAccountOption = { accountId: string; runtimeProviderId: string; label: string; baseUrl: string; modelIdPlaceholder?: string | string[]; configuredModelId?: string };
  const ttsProviderOptions = useMemo<TtsAccountOption[]>(() => {
    const vendorMap = new Map<string, ProviderVendorInfo>(providerVendors.map((vendor) => [vendor.id, vendor]));
    const statusById = new Map<string, ProviderWithKeyInfo>(providerStatuses.map((status) => [status.id, status]));
    const options: TtsAccountOption[] = [];
    for (const account of providerAccounts) {
      if (!account.enabled || !hasConfiguredProviderCredentials(account, statusById)) continue;
      const vendor = vendorMap.get(account.vendorId);
      const kinds = accountModelKinds(account, vendor);
      if (!kinds.includes('tts')) continue;
      const runtimeProviderId = vendor?.voiceRuntimeProviderId || 'openai';

      // The tts model id sits at the tts position of the account's positional model array.
      const ttsIndex = kinds.indexOf('tts');
      const modelArray = (Array.isArray(account.model) ? account.model : [account.model || '']).flatMap(id => id.split(','));
      const configuredModelId = ttsIndex >= 0 ? (modelArray[ttsIndex] || '') : '';

      let modelIdPlaceholder: string | string[] | undefined;
      if (Array.isArray(vendor?.modelIdPlaceholder)) {
        modelIdPlaceholder = ttsIndex >= 0 ? (vendor!.modelIdPlaceholder[ttsIndex] as string | string[] | undefined) : undefined;
      } else {
        modelIdPlaceholder = vendor?.modelIdPlaceholder as string | string[] | undefined;
      }

      options.push({
        accountId: account.id,
        runtimeProviderId,
        label: `${account.label} (${vendor?.name || account.vendorId})`,
        baseUrl: account.baseUrl || vendor?.defaultBaseUrl || '',
        modelIdPlaceholder,
        configuredModelId,
      });
    }
    return options;
  }, [providerAccounts, providerStatuses, providerVendors]);

  // Resolve the persisted runtime selection back to a concrete account once options load.
  // Match by endpoint (baseUrl) first — it uniquely identifies the account and is reliable
  // even when the persisted runtime provider id (e.g. 'minimax') doesn't line up with the
  // catalog's voiceRuntimeProviderId — then fall back to the first same-runtime account.
  useEffect(() => {
    if (ttsInitialized || ttsSelection === null) return;
    // A persisted selection but no options yet means accounts are still loading — wait,
    // so we don't prematurely finalize the selection to empty.
    if ((ttsSelection.provider || ttsSelection.baseUrl) && ttsProviderOptions.length === 0) return;
    let accountId = '';
    let model = ttsSelection.model;
    if (ttsSelection.provider || ttsSelection.baseUrl) {
      const sameRuntime = ttsProviderOptions.filter((o) => o.runtimeProviderId === ttsSelection.provider);
      const exact = sameRuntime.find((o) => o.baseUrl === ttsSelection.baseUrl);
      const byBaseUrl = ttsSelection.baseUrl ? ttsProviderOptions.find((o) => o.baseUrl === ttsSelection.baseUrl) : undefined;
      const chosen = exact ?? byBaseUrl ?? sameRuntime[0];
      if (chosen) {
        accountId = chosen.accountId;
        if (!model) model = chosen.configuredModelId || '';
      }
    }
     
    setTtsAccountId(accountId);
    setTtsAccountIdInitial(accountId);
    setTtsModel(model);
    setTtsModelInitial(model);
    // Speech synthesis counts as enabled when a provider was already persisted
    // (an account resolved, or a runtime provider id is on record).
    const enabled = Boolean(accountId || ttsSelection.provider);
    setTtsEnabled(enabled);
    setTtsEnabledInitial(enabled);
    setTtsInitialized(true);
  }, [ttsInitialized, ttsSelection, ttsProviderOptions]);

  // Accounts that expose a `transcription` kind — mirrors ttsProviderOptions. Listed
  // per-account (NOT deduped by runtime id) so the user can pick a specific endpoint.
  const sttProviderOptions = useMemo<TtsAccountOption[]>(() => {
    const vendorMap = new Map<string, ProviderVendorInfo>(providerVendors.map((vendor) => [vendor.id, vendor]));
    const statusById = new Map<string, ProviderWithKeyInfo>(providerStatuses.map((status) => [status.id, status]));
    const options: TtsAccountOption[] = [];
    for (const account of providerAccounts) {
      if (!account.enabled || !hasConfiguredProviderCredentials(account, statusById)) continue;
      const vendor = vendorMap.get(account.vendorId);
      const kinds = accountModelKinds(account, vendor);
      if (!kinds.includes('transcription')) continue;
      const runtimeProviderId = vendor?.voiceRuntimeProviderId || 'openai';

      // The transcription model id sits at the transcription position of the account's array.
      const transcriptionIndex = kinds.indexOf('transcription');
      const modelArray = (Array.isArray(account.model) ? account.model : [account.model || '']).flatMap(id => id.split(','));
      const configuredModelId = transcriptionIndex >= 0 ? (modelArray[transcriptionIndex] || '') : '';

      let modelIdPlaceholder: string | string[] | undefined;
      if (Array.isArray(vendor?.modelIdPlaceholder)) {
        modelIdPlaceholder = transcriptionIndex >= 0 ? (vendor!.modelIdPlaceholder[transcriptionIndex] as string | string[] | undefined) : undefined;
      } else {
        modelIdPlaceholder = vendor?.modelIdPlaceholder as string | string[] | undefined;
      }

      options.push({
        accountId: account.id,
        runtimeProviderId,
        label: `${account.label} (${vendor?.name || account.vendorId})`,
        baseUrl: account.baseUrl || vendor?.defaultBaseUrl || '',
        modelIdPlaceholder,
        configuredModelId,
      });
    }
    return options;
  }, [providerAccounts, providerStatuses, providerVendors]);

  // Resolve the persisted transcription selection back to a concrete account — mirrors the TTS effect above.
  useEffect(() => {
    if (sttInitialized || sttSelection === null) return;
    if ((sttSelection.provider || sttSelection.baseUrl) && sttProviderOptions.length === 0) return;
    let accountId = '';
    let model = sttSelection.model;
    if (sttSelection.provider || sttSelection.baseUrl) {
      const sameRuntime = sttProviderOptions.filter((o) => o.runtimeProviderId === sttSelection.provider);
      const exact = sameRuntime.find((o) => o.baseUrl === sttSelection.baseUrl);
      const byBaseUrl = sttSelection.baseUrl ? sttProviderOptions.find((o) => o.baseUrl === sttSelection.baseUrl) : undefined;
      const chosen = exact ?? byBaseUrl ?? sameRuntime[0];
      if (chosen) {
        accountId = chosen.accountId;
        if (!model) model = chosen.configuredModelId || '';
      }
    }
     
    setSttAccountId(accountId);
    setSttAccountIdInitial(accountId);
    setSttModel(model);
    setSttModelInitial(model);
    const enabled = Boolean(accountId || sttSelection.provider);
    setSttEnabled(enabled);
    setSttEnabledInitial(enabled);
    setSttInitialized(true);
  }, [sttInitialized, sttSelection, sttProviderOptions]);

  useEffect(() => {
    if (slotStatesInitialized) return;

    const vendorMap = new Map<string, ProviderVendorInfo>(providerVendors.map((vendor) => [vendor.id, vendor]));

    const getSupportedKinds = (providerKey: string): ModelKind[] => {
      const account = providerAccounts.find(a => resolveRuntimeProviderKey(a) === providerKey);
      if (!account) return [];
      const vendor = vendorMap.get(account.vendorId);
      return accountModelKinds(account, vendor);
    };

    const kindMap: Record<TargetSlot, ModelKind> = {
      model: 'text',
      imageModel: 'image',
      imageGenerationModel: 'image_generate',
      musicGenerationModel: 'music_generate',
      videoGenerationModel: 'video_generate',
    };

     
    setSlotStates(prev => {
      const newSlotStates = { ...prev };

      const slots: Array<{ slot: TargetSlot, defRef?: string | null }> = [
        { slot: 'model', defRef: defaultModelRef },
        { slot: 'imageModel', defRef: defaultImageModelRef },
        { slot: 'imageGenerationModel', defRef: defaultImageGenerationModelRef },
        { slot: 'musicGenerationModel', defRef: defaultMusicGenerationModelRef },
        { slot: 'videoGenerationModel', defRef: defaultVideoGenerationModelRef },
      ];

      for (const { slot, defRef } of slots) {
        let keyToSelect = '';
        let idToSet = '';

        const effective = splitModelRef(defRef);

        if (effective) {
          keyToSelect = effective.providerKey;
          idToSet = effective.modelId;
        }

        if (keyToSelect) {
          const accountExists = providerAccounts.some(a => resolveRuntimeProviderKey(a) === keyToSelect);
          if (!accountExists) {
            const fallbackAccount = providerAccounts.find(a => resolveRuntimeProviderKey(a).startsWith(`${keyToSelect}-`));
            if (fallbackAccount) {
              keyToSelect = resolveRuntimeProviderKey(fallbackAccount);
            }
          }
        }

        const supportedKinds = getSupportedKinds(keyToSelect);
        const requiredKind = kindMap[slot];
        const isSupported = supportedKinds.includes(requiredKind);

        if (!isSupported) {
          keyToSelect = '';
          idToSet = '';
        }

        newSlotStates[slot] = {
          providerKey: keyToSelect,
          modelId: idToSet,
        };
      }

      setSlotEnabled(prevEnabled => {
        const newEnabled = { ...prevEnabled };
        for (const { slot, defRef } of slots) {
          const keyToSelect = newSlotStates[slot].providerKey;
          const supportedKinds = getSupportedKinds(keyToSelect);
          const requiredKind = kindMap[slot];
          const isSupported = supportedKinds.includes(requiredKind);
          if (defRef && !isSupported) {
            newEnabled[slot] = false;
          }
        }
        return newEnabled;
      });

      return newSlotStates as Record<TargetSlot, { providerKey: string, modelId: string }>;
    });

    setSlotStatesInitialized(true);
  }, [
    defaultModelRef, defaultImageModelRef, defaultImageGenerationModelRef, defaultVideoGenerationModelRef, defaultMusicGenerationModelRef,
    providerAccounts, providerVendors, slotStatesInitialized
  ]);

  const currentSlotState = (activeTab === 'tts' || activeTab === 'transcription') ? { providerKey: '', modelId: '' } : slotStates[activeTab];
  const selectedProvider = runtimeProviderOptions.find((option) => option.runtimeProviderKey === currentSlotState.providerKey) || null;
  const trimmedModelId = currentSlotState.modelId.trim();
  const nextModelRef = currentSlotState.providerKey && trimmedModelId
    ? `${currentSlotState.providerKey}/${trimmedModelId}`
    : '';

  const hasAnyChange = (['model', 'imageModel', 'imageGenerationModel', 'musicGenerationModel', 'videoGenerationModel'] as TargetSlot[]).some(slot => {
    const defRef = ({
      model: defaultModelRef,
      imageModel: defaultImageModelRef,
      imageGenerationModel: defaultImageGenerationModelRef,
      musicGenerationModel: defaultMusicGenerationModelRef,
      videoGenerationModel: defaultVideoGenerationModelRef
    })[slot] || '';

    const isEnabled = slotEnabled[slot];
    const currentlyHasOverride = !!defRef.trim();

    if (!isEnabled) {
      return currentlyHasOverride;
    }

    const st = slotStates[slot];
    const nmr = st.providerKey && st.modelId.trim() ? `${st.providerKey}/${st.modelId.trim()}` : '';
    return nmr !== defRef.trim();
  }) || ttsEnabled !== ttsEnabledInitial || ttsAccountId !== ttsAccountIdInitial || ttsModel.trim() !== ttsModelInitial.trim()
    || sttEnabled !== sttEnabledInitial || sttAccountId !== sttAccountIdInitial || sttModel.trim() !== sttModelInitial.trim();

  const handleRequestClose = () => {
    if (savingModel || hasAnyChange) {
      setShowCloseConfirm(true);
      return;
    }
    onClose();
  };

  const handleSaveModel = async () => {
    // Validate all enabled slots first
    const slotsToUpdate: Record<string, string | null> = {};

    for (const slot of ['model', 'imageModel', 'imageGenerationModel', 'musicGenerationModel', 'videoGenerationModel'] as TargetSlot[]) {
      const isEnabled = slotEnabled[slot];
      const defRef = ({
        model: defaultModelRef,
        imageModel: defaultImageModelRef,
        imageGenerationModel: defaultImageGenerationModelRef,
        musicGenerationModel: defaultMusicGenerationModelRef,
        videoGenerationModel: defaultVideoGenerationModelRef
      })[slot] || '';

      if (!isEnabled) {
        if (defRef.trim()) {
          slotsToUpdate[slot] = null;
        }
        continue;
      }

      const st = slotStates[slot];
      if (!st.providerKey) {
        setActiveTab(slot);
        toast.error(t('toast.agentModelProviderRequired'));
        return;
      }
      if (!st.modelId.trim()) {
        setActiveTab(slot);
        toast.error(t('toast.agentModelIdRequired'));
        return;
      }

      const nextModelRef = `${st.providerKey}/${st.modelId.trim()}`;
      if (!nextModelRef.includes('/')) {
        setActiveTab(slot);
        toast.error(t('toast.agentModelInvalid'));
        return;
      }

      if (nextModelRef !== defRef.trim()) {
        slotsToUpdate[slot] = nextModelRef;
      }
    }

    const ttsChanged = ttsEnabled !== ttsEnabledInitial || ttsAccountId !== ttsAccountIdInitial || ttsModel.trim() !== ttsModelInitial.trim();
    const sttChanged = sttEnabled !== sttEnabledInitial || sttAccountId !== sttAccountIdInitial || sttModel.trim() !== sttModelInitial.trim();
    if (Object.keys(slotsToUpdate).length === 0 && !ttsChanged && !sttChanged) return;

    setSavingModel(true);
    try {
      if (Object.keys(slotsToUpdate).length > 0) {
        await updateDefaultModels(slotsToUpdate);
      }
      if (ttsChanged) {
        if (ttsEnabled && ttsAccountId) {
          // Push the chosen account as the global TTS provider. The backend resolves
          // its runtime id + apiKey and rewrites messages.tts.provider/providers[<id>].
          await hostApi.voice.setTtsAccount({ accountId: ttsAccountId, model: ttsModel.trim() || undefined });
        } else if (!ttsEnabled && (ttsEnabledInitial || ttsAccountIdInitial || ttsSelection?.provider)) {
          // Speech synthesis turned off (was previously configured) — clear only the
          // messages.tts section; transcription/realtime are left untouched.
          await hostApi.voice.clearTtsAccount();
          setTtsAccountId('');
          setTtsModel('');
        }
        setTtsAccountIdInitial(ttsEnabled ? ttsAccountId : '');
        setTtsModelInitial(ttsEnabled ? ttsModel : '');
        setTtsEnabledInitial(ttsEnabled);
        // messages.tts just changed — refresh the voice capability flags so the
        // chat 🔊 button reflects the new state immediately.
        void useSettingsStore.getState().refreshVoiceCapabilities();
      }
      if (sttChanged) {
        if (sttEnabled && sttAccountId) {
          // Push the chosen account as the global transcription provider. The backend
          // resolves its runtime id + apiKey and rewrites voice-call streaming config.
          await hostApi.voice.setTranscriptionAccount({ accountId: sttAccountId, model: sttModel.trim() || undefined });
        } else if (!sttEnabled && (sttEnabledInitial || sttAccountIdInitial || sttSelection?.provider)) {
          // Speech transcription turned off (was previously configured) — clear only the
          // voice-call streaming section; tts/realtime are left untouched.
          await hostApi.voice.clearTranscriptionAccount();
          setSttAccountId('');
          setSttModel('');
        }
        setSttAccountIdInitial(sttEnabled ? sttAccountId : '');
        setSttModelInitial(sttEnabled ? sttModel : '');
        setSttEnabledInitial(sttEnabled);
      }
      toast.success(t('toast.defaultModelsUpdated', 'Global models updated'));
      onClose();
    } catch (error) {
      toast.error(t('toast.defaultModelsUpdateFailed', { error: String(error) }));
    } finally {
      setSavingModel(false);
    }
  };



  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl h-[560px] max-h-[90vh] rounded-3xl border-0 shadow-2xl bg-background overflow-hidden flex flex-col">
        <CardHeader className="flex flex-row items-start justify-between pb-2 shrink-0">
          <div>
            <CardTitle className="text-2xl font-serif font-normal tracking-tight">
              {t('settingsDialog.globalModelsTitle', 'Global Models')}
            </CardTitle>
            <CardDescription className="text-[15px] mt-1 text-foreground/70">
              {t('settingsDialog.globalModelsDescription', 'Configure the default models used by all agents.')}
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRequestClose}
            className="rounded-full h-8 w-8 -mr-2 -mt-2 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5"
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4 p-6 pt-2 flex-1 min-h-0 overflow-y-auto">
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
            {(['model', 'imageModel', 'imageGenerationModel', 'musicGenerationModel', 'videoGenerationModel'] as TargetSlot[]).map((slot) => {
              // Map TargetSlot to ModelKind for translation strings
              const kindMap: Record<TargetSlot, string> = {
                model: 'text',
                imageModel: 'image',
                imageGenerationModel: 'image_generate',
                musicGenerationModel: 'music_generate',
                videoGenerationModel: 'video_generate',
              };
              const kind = kindMap[slot];
              return (
                <button
                  key={slot}
                  onClick={() => setActiveTab(slot)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-[13px] font-medium whitespace-nowrap transition-colors",
                    activeTab === slot
                      ? "bg-foreground text-background"
                      : "bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10"
                  )}
                >
                  {t(`settingsDialog.slotKind.${kind}`, kind)}
                </button>
              );
            })}
            <button
              key="tts"
              onClick={() => setActiveTab('tts')}
              className={cn(
                "px-3 py-1.5 rounded-full text-[13px] font-medium whitespace-nowrap transition-colors",
                activeTab === 'tts'
                  ? "bg-foreground text-background"
                  : "bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10"
              )}
            >
              {t('settingsDialog.slotKind.tts', 'Speech Synthesis')}
            </button>
            <button
              key="transcription"
              onClick={() => setActiveTab('transcription')}
              className={cn(
                "px-3 py-1.5 rounded-full text-[13px] font-medium whitespace-nowrap transition-colors",
                activeTab === 'transcription'
                  ? "bg-foreground text-background"
                  : "bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10"
              )}
            >
              {t('settingsDialog.slotKind.transcription', 'Speech Transcription')}
            </button>
          </div>

          <div className="flex items-center justify-between py-2">
            <div className="space-y-0.5">
              <Label htmlFor="enable-custom-model" className="text-[14px] font-medium text-foreground">{t('settingsDialog.enableModelType')}</Label>
              <p className="text-[13px] text-foreground/60">{t('settingsDialog.enableModelTypeDesc')}</p>
            </div>
            <Switch
              id="enable-custom-model"
              checked={activeTab === 'tts' ? ttsEnabled : activeTab === 'transcription' ? sttEnabled : slotEnabled[activeTab]}
              onCheckedChange={(checked) => {
                if (activeTab === 'tts') {
                  setTtsEnabled(checked);
                } else if (activeTab === 'transcription') {
                  setSttEnabled(checked);
                } else {
                  setSlotEnabled(prev => ({ ...prev, [activeTab]: checked }));
                }
              }}
            />
          </div>

          {activeTab === 'tts' ? (
            ttsEnabled ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="global-tts-provider" className="text-[12px] text-foreground/70">{t('settingsDialog.modelProviderLabel')}</Label>
                  <select
                    id="global-tts-provider"
                    value={ttsAccountId}
                    onChange={(event) => {
                      const next = event.target.value;
                      setTtsAccountId(next);
                      const option = ttsProviderOptions.find((candidate) => candidate.accountId === next);
                      setTtsModel(option?.configuredModelId || '');
                    }}
                    className={selectClasses}
                  >
                    <option value="">{t('settingsDialog.modelProviderPlaceholder')}</option>
                    {ttsProviderOptions.map((option) => (
                      <option key={option.accountId} value={option.accountId}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                {ttsAccountId && (() => {
                  const selectedTtsOption = ttsProviderOptions.find((option) => option.accountId === ttsAccountId);
                  const placeholder = (Array.isArray(selectedTtsOption?.modelIdPlaceholder)
                    ? selectedTtsOption?.modelIdPlaceholder[0]
                    : selectedTtsOption?.modelIdPlaceholder) as string
                    || selectedTtsOption?.configuredModelId
                    || t('settingsDialog.modelIdPlaceholder');
                  return (
                    <div className="space-y-2">
                      <Label htmlFor="global-tts-model" className="text-[12px] text-foreground/70">{t('settingsDialog.modelIdLabel')}</Label>
                      <Combobox
                        id="global-tts-model"
                        value={ttsModel}
                        onChange={setTtsModel}
                        options={placeholderToOptions(selectedTtsOption?.modelIdPlaceholder)}
                        placeholder={placeholder}
                        className={inputClasses}
                      />
                    </div>
                  );
                })()}
                {ttsProviderOptions.length === 0 && (
                  <p className="text-[12px] text-amber-600 dark:text-amber-400">
                    {t('settingsDialog.ttsProviderEmpty', 'No provider with speech synthesis configured. Add one in Settings → AI Providers.')}
                  </p>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 p-4 text-[13.5px] text-muted-foreground">
                {t('settingsDialog.modelDisabled', 'This model type is disabled globally.')}
              </div>
            )
          ) : activeTab === 'transcription' ? (
            sttEnabled ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="global-stt-provider" className="text-[12px] text-foreground/70">{t('settingsDialog.modelProviderLabel')}</Label>
                  <select
                    id="global-stt-provider"
                    value={sttAccountId}
                    onChange={(event) => {
                      const next = event.target.value;
                      setSttAccountId(next);
                      const option = sttProviderOptions.find((candidate) => candidate.accountId === next);
                      setSttModel(option?.configuredModelId || '');
                    }}
                    className={selectClasses}
                  >
                    <option value="">{t('settingsDialog.modelProviderPlaceholder')}</option>
                    {sttProviderOptions.map((option) => (
                      <option key={option.accountId} value={option.accountId}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                {sttAccountId && (() => {
                  const selectedSttOption = sttProviderOptions.find((option) => option.accountId === sttAccountId);
                  const placeholder = (Array.isArray(selectedSttOption?.modelIdPlaceholder)
                    ? selectedSttOption?.modelIdPlaceholder[0]
                    : selectedSttOption?.modelIdPlaceholder) as string
                    || selectedSttOption?.configuredModelId
                    || t('settingsDialog.modelIdPlaceholder');
                  return (
                    <div className="space-y-2">
                      <Label htmlFor="global-stt-model" className="text-[12px] text-foreground/70">{t('settingsDialog.modelIdLabel')}</Label>
                      <Combobox
                        id="global-stt-model"
                        value={sttModel}
                        onChange={setSttModel}
                        options={placeholderToOptions(selectedSttOption?.modelIdPlaceholder)}
                        placeholder={placeholder}
                        className={inputClasses}
                      />
                    </div>
                  );
                })()}
                {sttProviderOptions.length === 0 && (
                  <p className="text-[12px] text-amber-600 dark:text-amber-400">
                    {t('settingsDialog.transcriptionProviderEmpty', 'No provider with speech transcription configured. Add one in Settings → AI Providers.')}
                  </p>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 p-4 text-[13.5px] text-muted-foreground">
                {t('settingsDialog.modelDisabled', 'This model type is disabled globally.')}
              </div>
            )
          ) : slotEnabled[activeTab] ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="agent-model-provider" className="text-[12px] text-foreground/70">{t('settingsDialog.modelProviderLabel')}</Label>
                <select
                  id="agent-model-provider"
                  value={currentSlotState.providerKey}
                  onChange={(event) => {
                    const nextProvider = event.target.value;
                    const option = runtimeProviderOptions.find((candidate) => candidate.runtimeProviderKey === nextProvider);
                    setSlotStates(prev => ({
                      ...prev,
                      [activeTab]: {
                        providerKey: nextProvider,
                        modelId: option?.configuredModelId || ''
                      }
                    }));
                  }}
                  className={selectClasses}
                >
                  <option value="">{t('settingsDialog.modelProviderPlaceholder')}</option>
                  {runtimeProviderOptions.map((option) => (
                    <option key={option.runtimeProviderKey} value={option.runtimeProviderKey}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="agent-model-id" className="text-[12px] text-foreground/70">{t('settingsDialog.modelIdLabel')}</Label>
                <Combobox
                  id="agent-model-id"
                  value={currentSlotState.modelId}
                  onChange={(v) => setSlotStates(prev => ({ ...prev, [activeTab]: { ...prev[activeTab], modelId: v } }))}
                  options={placeholderToOptions(selectedProvider?.modelIdPlaceholder)}
                  placeholder={
                    (Array.isArray(selectedProvider?.modelIdPlaceholder)
                      ? selectedProvider.modelIdPlaceholder[0]
                      : selectedProvider?.modelIdPlaceholder) as string ||
                    selectedProvider?.configuredModelId ||
                    t('settingsDialog.modelIdPlaceholder')
                  }
                  className={inputClasses}
                />
              </div>
              {!!nextModelRef && (
                <p className="text-[12px] font-mono text-foreground/70 break-all">
                  {t('settingsDialog.modelPreview')}: {nextModelRef}
                </p>
              )}
              {runtimeProviderOptions.length === 0 && (
                <p className="text-[12px] text-amber-600 dark:text-amber-400">
                  {t('settingsDialog.modelProviderEmpty')}
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 p-4 text-[13.5px] text-muted-foreground">
              {t('settingsDialog.modelDisabled', 'This model type is disabled globally.')}
            </div>
          )}
        </CardContent>
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-black/5 dark:border-white/10 shrink-0">
          <Button
            variant="outline"
            onClick={handleRequestClose}
            className="h-9 text-[13px] font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground"
          >
            {t('common:actions.cancel')}
          </Button>
          <Button
            onClick={() => void handleSaveModel()}
            disabled={savingModel || !hasAnyChange}
            className="h-9 text-[13px] font-medium rounded-full px-4 shadow-none"
          >
            {savingModel ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              t('common:actions.save')
            )}
          </Button>
        </div>
      </Card>
      <ConfirmDialog
        open={showCloseConfirm}
        title={t('settingsDialog.unsavedChangesTitle')}
        message={t('settingsDialog.unsavedChangesMessage')}
        confirmLabel={t('settingsDialog.closeWithoutSaving')}
        cancelLabel={t('common:actions.cancel')}
        // Raise above the global model modal's own z-[60] container so the
        // unsaved-changes confirm isn't rendered behind (and hidden by) the modal.
        className="z-[70]"
        overlayClassName="z-[70]"
        onConfirm={() => {
          setShowCloseConfirm(false);
          onClose();
        }}
        onCancel={() => setShowCloseConfirm(false)}
      />
    </div>
  );
}

export default Agents;
