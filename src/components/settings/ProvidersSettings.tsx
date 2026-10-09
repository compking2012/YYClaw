/**
 * Providers Settings Component
 * Manage AI provider configurations and API keys
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ModalPortal } from '@/components/ui/modal-portal';
import {
  Plus,
  Trash2,
  Edit,
  Eye,
  EyeOff,
  Check,
  X,
  Loader2,
  Key,
  ExternalLink,
  Copy,
  XCircle,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Combobox, placeholderToOptions } from '@/components/ui/combobox';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  useProviderStore,
  type ProviderAccount,
  type ProviderConfig,
  type ProviderVendorInfo,
} from '@/stores/providers';
import {
  BUILTIN_PROVIDER_TYPES,
  PROVIDER_TYPE_INFO,
  getProviderDocsUrl,
  type ProviderType,
  type BuiltinProviderType,
  type ProviderValidationResult,
  getProviderIconUrl,
  isProviderAvailableForLanguage,
  normalizeProviderApiKeyInput,
  resolveProviderApiKeyForSave,
  resolveProviderModelForSave,
  shouldShowProviderModelId,
  shouldInvertInDark,
  type ModelKind,
  type ProviderTypeInfo,
  normalizeModelTypes,
  pickModelType,
  accountModelKinds,
  getKindParamFields,
  type ModelParamsByKind,
} from '@/lib/providers';
import {
  buildProviderAccountId,
  buildProviderListItems,
  hasConfiguredCredentials,
  type ProviderListItem,
} from '@/lib/provider-accounts';
import { resolveRuntimeProviderKey, splitModelRef } from '@/lib/model-options';
import { scrollTestIdIntoView } from '@/lib/focus-highlight';
import { cn } from '@/lib/utils';
import { toast } from '@/lib/toast';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@/stores/settings';
import { useAgentsStore } from '@/stores/agents';
import { useSettingsModal } from '@/stores/settings-modal';
import { hostApi } from '@/lib/host-api';
import { subscribeHostEvent } from '@/lib/host-events';
import type { OAuthSuccessEvent, OAuthErrorEvent } from '@shared/host-events/contract';
import { KindParamsEditor } from '@/components/settings/KindParamsEditor';

const inputClasses = 'h-[44px] rounded-xl font-mono text-meta bg-transparent border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:border-blue-500 shadow-sm transition-all text-foreground placeholder:text-foreground/40';
const labelClasses = 'text-sm text-foreground/80 font-bold';

// YYClaw: the "set as default" affordance is intentionally hidden on the
// Models page — the default model/provider is managed from the Agents page
// global config. Kept (not deleted) so upstream merges stay conflict-free.
const SHOW_SET_DEFAULT_ON_MODELS_PAGE: boolean = false;

type CodePlanMode = 'apikey' | 'codeplan';

function isZaiProviderType(type: string | undefined): boolean {
  return type === 'zai' || type === 'zai-global';
}

const KIND_COLORS: Record<ModelKind, string> = {
  text: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  image: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  image_generate: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  music_generate: "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300",
  video_generate: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  tts: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  transcription: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  realtime: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
};

export { KIND_COLORS as MODEL_KIND_COLORS };

function normalizeFallbackProviderIds(ids?: string[]): string[] {
  return Array.from(new Set((ids ?? []).filter(Boolean)));
}

function getProtocolBaseUrlPlaceholder(
  apiProtocol: ProviderAccount['apiProtocol'],
): string {
  if (apiProtocol === 'anthropic-messages') {
    return 'https://api.example.com/anthropic';
  }
  return 'https://api.example.com/v1';
}

function fallbackProviderIdsEqual(a?: string[], b?: string[]): boolean {
  const left = normalizeFallbackProviderIds(a).sort();
  const right = normalizeFallbackProviderIds(b).sort();
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function normalizeFallbackModels(models?: string[]): string[] {
  return Array.from(new Set((models ?? []).map((model) => model.trim()).filter(Boolean)));
}

function fallbackModelsEqual(a?: string[], b?: string[]): boolean {
  const left = normalizeFallbackModels(a);
  const right = normalizeFallbackModels(b);
  return left.length === right.length && left.every((model, index) => model === right[index]);
}

/**
 * Parse a stored `account.model` (string | string[] | undefined, possibly
 * comma-joined, possibly containing undefined/sparse slots) into a dense
 * string[] with no holes and no undefined elements. Single source of truth so
 * the per-kind model rows never crash on `.trim()`/`.split()` of undefined.
 */
function parseModelIds(model: string | string[] | undefined): string[] {
  const raw = Array.isArray(model) ? model : [model ?? ''];
  return raw.flatMap((id) => (id ?? '').split(','));
}

/** Safe positional read — out-of-range / negative index yields '' instead of undefined. */
function modelIdAt(modelIds: string[], index: number): string {
  return index >= 0 ? (modelIds[index] ?? '') : '';
}

/**
 * Build the positional, bare model-id array used to seed the edit form. Mirrors
 * the Add flow (which prefills `defaultModelId` for every declared kind):
 *  - strip the runtime `${providerKey}/` prefix so stored refs like
 *    `minimax-portal/MiniMax-M3` show as `MiniMax-M3`;
 *  - align to the provider's kinds and fall back to the catalog default for any
 *    kind the account hasn't persisted, so every model type shows its current
 *    value instead of a blank/hidden row.
 */
function buildEditableModelIds(
  account: ProviderAccount,
  providerKinds: ModelKind[],
  typeInfo?: Pick<ProviderTypeInfo, 'defaultModelId'>,
): string[] {
  const runtimeProviderKey = resolveRuntimeProviderKey(account);
  const prefix = `${runtimeProviderKey}/`;
  const stored = parseModelIds(account.model).map((id) => {
    const trimmed = (id ?? '').trim();
    return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
  });
  const defaults = Array.isArray(typeInfo?.defaultModelId)
    ? typeInfo.defaultModelId
    : [typeInfo?.defaultModelId ?? ''];
  const length = Math.max(providerKinds.length, stored.length);
  const result: string[] = [];
  for (let i = 0; i < length; i++) {
    const value = stored[i]?.trim() ? stored[i].trim() : (defaults[i] ?? '').trim();
    result.push(value);
  }
  return result;
}

/**
 * Model ids for display: show only the bare model id (not "ID/模型ID"). Mirrors
 * buildConfiguredModelOptions — prefer the clean `metadata.customModels` list,
 * otherwise strip the leading `${runtimeProviderKey}/` prefix from stored refs.
 * Multi-kind accounts yield one id per kind.
 */
function displayModelIds(account: ProviderAccount): string[] {
  const configured = (account.metadata?.customModels ?? [])
    .map((id) => id.trim())
    .filter(Boolean);
  if (configured.length > 0) return configured;
  const runtimeProviderKey = resolveRuntimeProviderKey(account);
  const prefix = `${runtimeProviderKey}/`;
  return parseModelIds(account.model)
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => (id.startsWith(prefix) ? id.slice(prefix.length) : id));
}

function getUserAgentHeader(headers?: Record<string, string>): string {
  if (!headers) return '';
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'user-agent') {
      return value;
    }
  }
  return '';
}

function mergeHeadersWithUserAgent(
  headers: Record<string, string> | undefined,
  userAgent: string,
): Record<string, string> {
  const next = Object.fromEntries(
    Object.entries(headers ?? {}).filter(([key]) => key.toLowerCase() !== 'user-agent'),
  );
  const normalizedUserAgent = userAgent.trim();
  if (normalizedUserAgent) {
    next['User-Agent'] = normalizedUserAgent;
  }
  return next;
}

function isCodePlanMode(
  baseUrl: string | undefined,
  modelId: string | undefined,
  codePlanPresetBaseUrl?: string,
  codePlanPresetModelId?: string,
): boolean {
  if (!codePlanPresetBaseUrl || !codePlanPresetModelId) return false;
  return (baseUrl || '').trim() === codePlanPresetBaseUrl && (modelId || '').trim() === codePlanPresetModelId;
}

function shouldShowUserAgentField(account: ProviderAccount): boolean {
  return account.vendorId === 'custom';
}

function shouldShowUserAgentFieldForNewProvider(providerType: ProviderType | null): boolean {
  return providerType === 'custom';
}

function getOAuthErrorMessage(message: string, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (message.startsWith('tokendanceOAuth.exchangeFailed:')) {
    return t('aiProviders.oauth.tokenDanceExchangeFailed', {
      status: message.slice('tokendanceOAuth.exchangeFailed:'.length),
    });
  }
  const keyByCode: Record<string, string> = {
    'tokendanceOAuth.cancelled': 'aiProviders.oauth.tokenDanceCancelled',
    'tokendanceOAuth.callbackUnavailable': 'aiProviders.oauth.tokenDanceCallbackUnavailable',
    'tokendanceOAuth.timedOut': 'aiProviders.oauth.tokenDanceTimedOut',
    'tokendanceOAuth.missingKey': 'aiProviders.oauth.tokenDanceMissingKey',
  };
  const key = keyByCode[message];
  return key ? t(key) : message;
}

function getProviderValidationError(
  result: ProviderValidationResult,
  t: (key: string) => string,
): string {
  switch (result.recoveryAction) {
    case 'top_up_balance':
      return t('aiProviders.recovery.topUpBalance');
    case 'reauthorize_api_key':
      return t('aiProviders.recovery.reauthorizeApiKey');
    case 'api_key_quota':
      return t('aiProviders.recovery.apiKeyQuota');
    default:
      return result.error || t('aiProviders.toast.invalidKey');
  }
}

function getAuthModeLabel(
  authMode: ProviderAccount['authMode'],
  t: (key: string) => string
): string {
  switch (authMode) {
    case 'api_key':
      return t('aiProviders.authModes.apiKey');
    case 'oauth_device':
      return t('aiProviders.authModes.oauthDevice');
    case 'oauth_browser':
      return t('aiProviders.authModes.oauthBrowser');
    case 'local':
      return t('aiProviders.authModes.local');
    default:
      return authMode;
  }
}

export function ProvidersSettings() {
  const { t } = useTranslation('settings');
  const devModeUnlocked = useSettingsStore((state) => state.devModeUnlocked);
  const defaultModelRef = useAgentsStore((state) => state.defaultModelRef);
  const defaultModelProviderAccountId = useAgentsStore((state) => state.defaultModelProviderAccountId);
  const fetchAgents = useAgentsStore((state) => state.fetchAgents);
  const {
    statuses,
    accounts,
    vendors,
    defaultAccountId,
    loading,
    refreshProviderSnapshot,
    createAccount,
    removeAccount,
    updateAccount,
    setDefaultAccount,
    validateAccountApiKey,
  } = useProviderStore();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const vendorMap = new Map(vendors.map((vendor) => [vendor.id, vendor]));
  const existingVendorIds = new Set(accounts.map((account) => account.vendorId));
  const displayProviders = useMemo(
    () =>
      // Models page lists providers in add order (createdAt asc), independent of
      // any "default" setting. buildProviderListItems' own default-first ordering
      // is intentionally overridden here.
      buildProviderListItems(accounts, statuses, vendors, null)
        .slice()
        .sort((a, b) => a.account.createdAt.localeCompare(b.account.createdAt)),
    [accounts, statuses, vendors],
  );
  const focusItem = useSettingsModal((state) => state.focusItem);
  const setFocusItem = useSettingsModal((state) => state.setFocusItem);
  const [highlightedAccountId, setHighlightedAccountId] = useState<string | null>(null);
  const focusScrollRef = useRef<null | (() => void)>(null);
  const focusHighlightTimerRef = useRef(0);

  // Cancel the focus scroll/highlight only on unmount — clearing focusItem below
  // must NOT tear it down (that race used to abort the scroll early).
  useEffect(() => () => {
    focusScrollRef.current?.();
    if (focusHighlightTimerRef.current) clearTimeout(focusHighlightTimerRef.current);
  }, []);

  useEffect(() => {
    if (!focusItem || loading) return;
    const parsed = splitModelRef(focusItem);
    setFocusItem(null); // consume the token; the scroll below is not tied to this effect's cleanup
    if (!parsed) return;
    const match = displayProviders.find(
      (item) => resolveRuntimeProviderKey(item.account) === parsed.providerKey,
    );
    if (!match) return;
    const accountId = match.account.id;
    focusScrollRef.current?.(); // cancel any previous in-flight scroll (rapid re-clicks)
    focusScrollRef.current = scrollTestIdIntoView(
      `provider-card-${accountId}`,
      () => {
        setHighlightedAccountId(accountId);
        if (focusHighlightTimerRef.current) clearTimeout(focusHighlightTimerRef.current);
        focusHighlightTimerRef.current = window.setTimeout(() => setHighlightedAccountId(null), 2500);
      },
      { block: 'center' },
    );
  }, [focusItem, setFocusItem, displayProviders, loading]);

  const activeModelProviderId = useMemo(() => {
    if (defaultModelProviderAccountId) {
      return defaultModelProviderAccountId;
    }
    const ref = (defaultModelRef || '').trim();
    const slashIndex = ref.indexOf('/');
    if (slashIndex <= 0) return '';
    return ref.slice(0, slashIndex).trim();
  }, [defaultModelRef, defaultModelProviderAccountId]);

  // Fetch providers on mount
  useEffect(() => {
    refreshProviderSnapshot();
  }, [refreshProviderSnapshot]);

  useEffect(() => {
    const unsub = subscribeHostEvent('providers:snapshot-changed', () => {
      void refreshProviderSnapshot();
    });
    return unsub;
  }, [refreshProviderSnapshot]);

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  const handleAddProvider = async (
    type: ProviderType,
    name: string,
    apiKey: string,
    options?: {
      baseUrl?: string;
      model?: string | string[];
      modelParams?: ModelParamsByKind;
      authMode?: ProviderAccount['authMode'];
      apiProtocol?: ProviderAccount['apiProtocol'];
      headers?: Record<string, string>;
    }
  ) => {
    const vendor = vendorMap.get(type);
    const id = buildProviderAccountId(type, null, vendors);
    const effectiveApiKey = resolveProviderApiKeyForSave(type, apiKey);
    try {
      await createAccount({
        id,
        vendorId: type,
        label: name,
        authMode: options?.authMode || vendor?.defaultAuthMode || (type === 'ollama' ? 'local' : 'api_key'),
        baseUrl: options?.baseUrl,
        apiProtocol: options?.apiProtocol,
        headers: options?.headers,
        model: options?.model,
        modelType: vendor?.modelType,
        modelParams: options?.modelParams,
        enabled: true,
        isDefault: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, effectiveApiKey);

      // Auto-set as default if no default is currently configured.
      // Read from the store after createAccount/refresh — render closure `defaultAccountId` is stale here.
      if (!useProviderStore.getState().defaultAccountId) {
        await setDefaultAccount(id);
        await fetchAgents();
      }

      setShowAddDialog(false);
      toast.success(t('aiProviders.toast.added'));
    } catch (error) {
      toast.error(`${t('aiProviders.toast.failedAdd')}: ${error}`);
    }
  };

  const handleDeleteProvider = async (providerId: string) => {
    try {
      await removeAccount(providerId);
      // Refresh agents so global defaults / per-agent model tags that referenced
      // the deleted provider are pruned (mirrors add/setDefault). The backend
      // prunes stale refs on snapshot read.
      await fetchAgents();
      toast.success(t('aiProviders.toast.deleted'));
    } catch (error) {
      toast.error(`${t('aiProviders.toast.failedDelete')}: ${error}`);
    }
  };

  const handleSetDefault = async (providerId: string) => {
    try {
      await setDefaultAccount(providerId);
      await fetchAgents();
      toast.success(t('aiProviders.toast.defaultUpdated'));
    } catch (error) {
      toast.error(`${t('aiProviders.toast.failedDefault')}: ${error}`);
    }
  };

  return (
    <div data-testid="providers-settings" className="flex h-full flex-col">
      <div className="flex items-center justify-between shrink-0 px-6 pt-6 pb-4 border-b border-black/5 dark:border-white/10">
        <h2 data-testid="providers-settings-title" className="text-3xl font-serif text-foreground font-normal tracking-tight" style={{ fontFamily: 'Georgia, Cambria, "Times New Roman", Times, serif' }}>
          {t('aiProviders.title', 'AI Providers')}
        </h2>
        <Button data-testid="providers-add-button" onClick={() => {
          refreshProviderSnapshot({ notifyOnRemoteFailure: true }).then(({ remoteCatalogOk }) => {
            if (remoteCatalogOk) setShowAddDialog(true);
          });
        }} className="rounded-full px-5 h-9 shadow-none font-medium text-[13px]">
          <Plus className="h-4 w-4 mr-2" />
          {t('aiProviders.add')}
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6">
        {loading && displayProviders.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground bg-black/5 dark:bg-white/5 rounded-3xl border border-transparent border-dashed">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (displayProviders.length === 0) ? (
        <div data-testid="providers-empty-state" className="flex flex-col items-center justify-center py-20 text-muted-foreground bg-black/5 dark:bg-white/5 rounded-3xl border border-transparent border-dashed">
          <Key className="h-12 w-12 mb-4 opacity-50" />
          <h3 className="text-[15px] font-medium mb-1 text-foreground">{t('aiProviders.empty.title')}</h3>
          <p className="text-[13px] text-center mb-6 max-w-sm">
            {t('aiProviders.empty.desc')}
          </p>
          <Button onClick={() => {
            refreshProviderSnapshot({ notifyOnRemoteFailure: true }).then(({ remoteCatalogOk }) => {
              if (remoteCatalogOk) setShowAddDialog(true);
            });
          }} className="rounded-full px-6 h-10 bg-primary hover:bg-primary/90 text-primary-foreground">
            <Plus className="h-4 w-4 mr-2" />
            {t('aiProviders.empty.cta')}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {displayProviders.map((item) => (
            <ProviderCard
              key={item.account.id}
              item={item}
              allProviders={displayProviders}
              isDefault={
                activeModelProviderId
                  ? item.account.id === activeModelProviderId
                  : item.account.id === defaultAccountId
              }
              highlighted={highlightedAccountId === item.account.id}
              isEditing={editingProvider === item.account.id}
              onEdit={() => setEditingProvider(item.account.id)}
              onCancelEdit={() => setEditingProvider(null)}
              onDelete={() => handleDeleteProvider(item.account.id)}
              onSetDefault={() => handleSetDefault(item.account.id)}
              onSaveEdits={async (payload) => {
                const updates: Partial<ProviderAccount> = {};
                if (payload.updates) {
                  if (payload.updates.name !== undefined) updates.label = payload.updates.name;
                  if (payload.updates.baseUrl !== undefined) updates.baseUrl = payload.updates.baseUrl;
                  if (payload.updates.apiProtocol !== undefined) updates.apiProtocol = payload.updates.apiProtocol;
                  if (payload.updates.headers !== undefined) updates.headers = payload.updates.headers;
                  if (payload.updates.model !== undefined) updates.model = payload.updates.model;
                  if (payload.updates.modelType !== undefined) updates.modelType = payload.updates.modelType;
                  if (payload.updates.modelParams !== undefined) updates.modelParams = payload.updates.modelParams;
                  if (payload.updates.fallbackModels !== undefined) updates.fallbackModels = payload.updates.fallbackModels;
                  if (payload.updates.fallbackProviderIds !== undefined) {
                    updates.fallbackAccountIds = payload.updates.fallbackProviderIds;
                  }
                }
                await updateAccount(
                  item.account.id,
                  updates,
                  payload.newApiKey
                );
                setEditingProvider(null);
              }}
              onValidateKey={(key, options) => validateAccountApiKey(item.account.id, key, options)}
              devModeUnlocked={devModeUnlocked}
            />
          ))}
        </div>
      )}
      </div>

      {/* Add Provider Dialog */}
      {showAddDialog && (
        <AddProviderDialog
          existingVendorIds={existingVendorIds}
          vendors={vendors}
          onClose={() => setShowAddDialog(false)}
          onAdd={handleAddProvider}
          onValidateKey={(type, key, options) => validateAccountApiKey(type, key, options)}
          devModeUnlocked={devModeUnlocked}
        />
      )}
    </div>
  );
}

interface ProviderCardProps {
  item: ProviderListItem;
  allProviders: ProviderListItem[];
  isDefault: boolean;
  highlighted: boolean;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
  onSaveEdits: (payload: { newApiKey?: string; updates?: Partial<ProviderConfig> }) => Promise<void>;
  onValidateKey: (
    key: string,
    options?: { baseUrl?: string; apiProtocol?: ProviderAccount['apiProtocol']; modelId?: string }
  ) => Promise<ProviderValidationResult>;
  devModeUnlocked: boolean;
}



function ProviderCard({
  item,
  allProviders,
  isDefault,
  highlighted,
  isEditing,
  onEdit,
  onCancelEdit,
  onDelete,
  onSetDefault,
  onSaveEdits,
  onValidateKey,
  devModeUnlocked,
}: ProviderCardProps) {
  const { t, i18n } = useTranslation('settings');
  const { account, vendor, status } = item;
  const [newKey, setNewKey] = useState('');
  const [label, setLabel] = useState(account.label || '');
  const [baseUrl, setBaseUrl] = useState(account.baseUrl || '');
  const [apiProtocol, setApiProtocol] = useState<ProviderAccount['apiProtocol']>(account.apiProtocol || 'openai-completions');
  const [userAgent, setUserAgent] = useState(getUserAgentHeader(account.headers));
  const typeInfo = PROVIDER_TYPE_INFO.find((t) => t.id === account.vendorId);
  const providerKinds = accountModelKinds(account, vendor, typeInfo);
  const [modelIds, setModelIds] = useState<string[]>(() => buildEditableModelIds(account, providerKinds, typeInfo));
  const [modelParams, setModelParams] = useState<ModelParamsByKind>(account.modelParams ?? {});
  const [fallbackModelsText, setFallbackModelsText] = useState(
    normalizeFallbackModels(account.fallbackModels).join('\n')
  );
  const [fallbackProviderIds, setFallbackProviderIds] = useState<string[]>(
    normalizeFallbackProviderIds(account.fallbackAccountIds)
  );
  const [showKey, setShowKey] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [codePlanMode, setCodePlanMode] = useState<CodePlanMode>('apikey');

  // Surface every declared kind so multi-kind providers (e.g. MiniMax) show one
  // pre-filled model-id row per type, matching the Add flow.
  const [activeKinds, setActiveKinds] = useState<ModelKind[]>(() =>
    providerKinds.length > 0 ? providerKinds : ['text']
  );
  const providerDocsUrl = getProviderDocsUrl(typeInfo, i18n.language);
  const showModelIdField = shouldShowProviderModelId(typeInfo, devModeUnlocked);
  const codePlanPreset = typeInfo?.codePlanPresetBaseUrl && typeInfo?.codePlanPresetModelId
    ? {
      baseUrl: typeInfo.codePlanPresetBaseUrl,
      modelId: typeInfo.codePlanPresetModelId,
    }
    : null;
  const effectiveDocsUrl = codePlanMode === 'codeplan'
    ? (typeInfo?.codePlanDocsUrl || providerDocsUrl)
    : providerDocsUrl;
  // Some kinds expose extra params (voice/format/speed …) even when the model id
  // field is hidden (showModelId=false). Keep the model section available so the
  // user can still configure those params.
  const hasKindParams = activeKinds.some((k) => getKindParamFields(vendor ?? typeInfo, k).length > 0);
  const canEditModelConfig = Boolean(typeInfo?.showBaseUrl || showModelIdField || hasKindParams);
  const showUserAgentField = shouldShowUserAgentField(account);

  useEffect(() => {
    if (isEditing) {
      setNewKey('');
      setShowKey(false);
      setLabel(account.label || '');
      setBaseUrl(account.baseUrl || '');
      setApiProtocol(account.apiProtocol || 'openai-completions');
      setUserAgent(getUserAgentHeader(account.headers));
      const newModelIds = buildEditableModelIds(account, providerKinds, typeInfo);
      setModelIds(newModelIds);
      setModelParams(account.modelParams ?? {});
      setActiveKinds(providerKinds.length > 0 ? providerKinds : ['text']);
      setFallbackModelsText(normalizeFallbackModels(account.fallbackModels).join('\n'));
      setFallbackProviderIds(normalizeFallbackProviderIds(account.fallbackAccountIds));
      setCodePlanMode(
        isCodePlanMode(
          account.baseUrl,
          modelIds[0],
          typeInfo?.codePlanPresetBaseUrl,
          typeInfo?.codePlanPresetModelId,
        ) ? 'codeplan' : 'apikey'
      );
    }
  }, [isEditing, account.label, account.baseUrl, account.headers, account.fallbackModels, account.fallbackAccountIds, account.model, account.apiProtocol, account.vendorId, typeInfo?.codePlanPresetBaseUrl, typeInfo?.codePlanPresetModelId]);

  const fallbackOptions = allProviders.filter((candidate) => candidate.account.id !== account.id);

  const toggleFallbackProvider = (providerId: string) => {
    setFallbackProviderIds((current) => (
      current.includes(providerId)
        ? current.filter((id) => id !== providerId)
        : [...current, providerId]
    ));
  };

  const handleSaveEdits = async () => {
    setSaving(true);
    try {
      const payload: { newApiKey?: string; updates?: Partial<ProviderConfig> } = {};
      const normalizedFallbackModels = normalizeFallbackModels(fallbackModelsText.split('\n'));
      const normalizedNewKey = normalizeProviderApiKeyInput(newKey);

      if (normalizedNewKey) {
        setValidating(true);
        const result = await onValidateKey(normalizedNewKey, {
          baseUrl: baseUrl.trim() || undefined,
          apiProtocol: (account.vendorId === 'custom' || account.vendorId === 'ollama') ? apiProtocol : undefined,
          modelId: modelIds[0]?.trim() || undefined,
        });
        setValidating(false);
        if (!result.valid) {
          toast.error(getProviderValidationError(result, t));
          setSaving(false);
          return;
        }
        payload.newApiKey = normalizedNewKey;
      }

      {
        if (showModelIdField && modelIds.every((id) => !id?.trim())) {
          toast.error(t('aiProviders.toast.modelRequired'));
          setSaving(false);
          return;
        }

        const updates: Partial<ProviderConfig> = {};
        const isCustomProvider = !BUILTIN_PROVIDER_TYPES.includes(account.vendorId as BuiltinProviderType);
        const trimmedLabel = label.trim();
        if (trimmedLabel && trimmedLabel !== account.label) {
          updates.name = trimmedLabel;
        }
        if ((typeInfo?.showBaseUrl || isCustomProvider) && (baseUrl.trim() || undefined) !== (account.baseUrl || undefined)) {
          updates.baseUrl = baseUrl.trim() || undefined;
        }
        if ((account.vendorId === 'custom' || account.vendorId === 'ollama') && apiProtocol !== account.apiProtocol) {
          updates.apiProtocol = apiProtocol;
        }
        if (showModelIdField || isCustomProvider) {
          const resolved = resolveProviderModelForSave(account.vendorId, typeInfo, modelIds, devModeUnlocked);
          updates.model = resolved;
        }
        // Persist modelType so the backend can resolve remote-catalog providers
        // (whose definition isn't in the bundled registry) and backfill existing
        // accounts on re-save.
        const resolvedModelType = pickModelType(account.modelType, vendor?.modelType, typeInfo?.modelType);
        if (resolvedModelType && JSON.stringify(resolvedModelType) !== JSON.stringify(account.modelType)) {
          updates.modelType = resolvedModelType;
        }
        if (JSON.stringify(modelParams) !== JSON.stringify(account.modelParams ?? {})) {
          updates.modelParams = modelParams;
        }
        const existingUserAgent = getUserAgentHeader(account.headers).trim();
        const nextUserAgent = userAgent.trim();
        if (nextUserAgent !== existingUserAgent) {
          updates.headers = mergeHeadersWithUserAgent(account.headers, nextUserAgent);
        }
        if (!fallbackModelsEqual(normalizedFallbackModels, account.fallbackModels)) {
          updates.fallbackModels = normalizedFallbackModels;
        }
        if (!fallbackProviderIdsEqual(fallbackProviderIds, account.fallbackAccountIds)) {
          updates.fallbackProviderIds = normalizeFallbackProviderIds(fallbackProviderIds);
        }
        if (Object.keys(updates).length > 0) {
          payload.updates = updates;
        }
      }

      // Keep Ollama key optional in UI, but persist a placeholder when
      // editing legacy configs that have no stored key.
      if (account.vendorId === 'ollama' && !status?.hasKey && !payload.newApiKey) {
        payload.newApiKey = resolveProviderApiKeyForSave(account.vendorId, '') as string;
      }

      if (!payload.newApiKey && !payload.updates) {
        onCancelEdit();
        setSaving(false);
        return;
      }

      await onSaveEdits(payload);
      setNewKey('');
      toast.success(t('aiProviders.toast.updated'));
    } catch (error) {
      toast.error(`${t('aiProviders.toast.failedUpdate')}: ${error}`);
    } finally {
      setSaving(false);
      setValidating(false);
    }
  };

  const currentInputClasses = isDefault
    ? "h-[40px] rounded-xl font-mono text-[13px] bg-white dark:bg-card border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-primary/50 shadow-sm"
    : inputClasses;

  const currentLabelClasses = isDefault ? "text-[13px] text-muted-foreground" : labelClasses;
  const currentSectionLabelClasses = isDefault ? "text-[14px] font-bold text-foreground/80" : labelClasses;

  // 标签展示 provider 声明的能力类型（providerKinds 已账号优先、去重且非空），
  // 不按"已配置 model id 的位置"过滤——否则单串/少配的账号会丢能力标签。
  const kinds = providerKinds;

  return (
    <div
      data-testid={`provider-card-${account.id}`}
      data-highlighted={highlighted ? 'true' : undefined}
      className={cn(
        'group flex flex-col p-4 rounded-2xl transition-all relative overflow-hidden hover:bg-black/5 dark:hover:bg-white/5 bg-transparent border border-transparent',
        highlighted && 'ring-2 ring-primary/60',
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="h-[42px] w-[42px] shrink-0 flex items-center justify-center text-foreground border border-black/5 dark:border-white/10 rounded-full bg-black/5 dark:bg-white/5 shadow-sm group-hover:scale-105 transition-transform">
            {getProviderIconUrl(account.vendorId) ? (
              <img src={getProviderIconUrl(account.vendorId)} alt={typeInfo?.name || account.vendorId} className={cn('h-5 w-5', shouldInvertInDark(account.vendorId) && 'dark:invert')} />
            ) : (
              <span className="text-xl">{vendor?.icon || typeInfo?.icon || '⚙️'}</span>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-[15px]">{account.label}</span>
              {isDefault && (
                <Badge
                  variant="secondary"
                  className="flex items-center gap-1 font-mono text-[10px] font-medium px-2 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.08] border-0 shadow-none text-foreground/70"
                >
                  <Check className="h-3 w-3" />
                  {t('aiProviders.card.default')}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5 text-[13px] text-muted-foreground">
              <span>{getAuthModeLabel(account.authMode, t)}</span>
              {account.model && (() => {
                const ids = displayModelIds(account);
                if (ids.length === 0) return null;
                return (
                  <>
                    <span className="w-1 h-1 rounded-full bg-black/20 dark:bg-white/20" />
                    <span className="truncate max-w-[200px]" title={ids.join('\n')}>{ids.join(', ')}</span>
                  </>
                );
              })()}
              {(() => {
                const ids = displayModelIds(account);
                const meta = ids
                  .map((id) => vendor?.models?.[id] ?? typeInfo?.models?.[id])
                  .find(Boolean);
                if (!meta) return null;
                const price = meta.pricing?.outputPerM != null ? `$${meta.pricing.outputPerM}/M` : null;
                const ctx = meta.contextWindow ? `${Math.round(meta.contextWindow / 1000)}K` : null;
                const topStrength = meta.strengths
                  ? Object.entries(meta.strengths).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0]
                  : null;
                const parts = [price, ctx, topStrength].filter(Boolean) as string[];
                if (parts.length === 0) return null;
                return (
                  <>
                    <span className="w-1 h-1 rounded-full bg-black/20 dark:bg-white/20" />
                    <span className="text-[11px] text-foreground/50" title={t('aiProviders.card.modelMeta', '模型元数据（价格/上下文/擅长）')}>
                      {parts.join(' · ')}
                    </span>
                  </>
                );
              })()}
              {kinds.map((kind) => (
                <span key={kind} className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap", KIND_COLORS[kind])}>
                  {t(`aiProviders.modelKind.${kind}`, kind)}
                </span>
              ))}
              <span className="w-1 h-1 rounded-full bg-black/20 dark:bg-white/20" />
              <span className="flex items-center gap-1">
                {hasConfiguredCredentials(account, status) ? (
                  <><div className="w-1.5 h-1.5 rounded-full bg-green-500" /> {t('aiProviders.card.configured')}</>
                ) : (
                  <><div className="w-1.5 h-1.5 rounded-full bg-red-500" /> {t('aiProviders.dialog.apiKeyMissing')}</>
                )}
              </span>
              {((account.fallbackModels?.length ?? 0) > 0 || (account.fallbackAccountIds?.length ?? 0) > 0) && (
                <>
                  <span className="w-1 h-1 rounded-full bg-black/20 dark:bg-white/20" />
                  <span className="truncate max-w-[150px]" title={t('aiProviders.sections.fallback')}>
                    {t('aiProviders.sections.fallback')}: {[
                      ...normalizeFallbackModels(account.fallbackModels),
                      ...normalizeFallbackProviderIds(account.fallbackAccountIds)
                        .map((fallbackId) => allProviders.find((candidate) => candidate.account.id === fallbackId)?.account.label)
                        .filter(Boolean),
                    ].join(', ')}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {!isEditing && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {SHOW_SET_DEFAULT_ON_MODELS_PAGE && !isDefault && (
              <Button
                data-testid={`provider-set-default-${account.id}`}
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full text-muted-foreground hover:text-primary hover:bg-white dark:hover:bg-card shadow-sm"
                onClick={onSetDefault}
                title={t('aiProviders.card.setDefault')}
              >
                <Check className="h-4 w-4" />
              </Button>
            )}
            <Button
              data-testid={`provider-edit-${account.id}`}
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-surface-modal shadow-sm"
              onClick={onEdit}
              title={t('aiProviders.card.editKey')}
            >
              <Edit className="h-4 w-4" />
            </Button>
            <Button
              data-testid={`provider-delete-${account.id}`}
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full text-muted-foreground hover:text-destructive hover:bg-surface-modal shadow-sm"
              onClick={onDelete}
              title={t('aiProviders.card.delete')}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {isEditing && (
        <div className="space-y-6 mt-4 pt-4 border-t border-black/5 dark:border-white/5">
          {effectiveDocsUrl && (
            <div className="flex justify-end -mt-2 mb-2">
              <a
                href={effectiveDocsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[12px] text-primary hover:text-primary/80 font-medium inline-flex items-center gap-1"
              >
                {t('aiProviders.dialog.customDoc')}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
          <div className="space-y-1.5">
            <Label className={currentLabelClasses}>{t('aiProviders.dialog.displayName')}</Label>
            <Input
              data-testid={`provider-name-input-${account.id}`}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={typeInfo?.name || account.vendorId}
              className={currentInputClasses}
            />
          </div>
          {canEditModelConfig && (
            <div className="space-y-3">
              <p className={currentSectionLabelClasses}>{t('aiProviders.sections.model')}</p>
              {typeInfo?.showBaseUrl && (
                <div className="space-y-1.5">
                  <Label className={currentLabelClasses}>{t('aiProviders.dialog.baseUrl')}</Label>
                  <Input
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder={getProtocolBaseUrlPlaceholder(apiProtocol)}
                    className={currentInputClasses}
                  />
                </div>
              )}
              {(showModelIdField || hasKindParams) && (
                <div className="space-y-3 pt-2">
                  {showModelIdField && (
                    <div className="flex items-center justify-between">
                      <Label className={currentLabelClasses}>{t('aiProviders.dialog.modelId')}</Label>
                    </div>
                  )}
                  {activeKinds.map((kind) => {
                    const originalIndex = providerKinds.indexOf(kind);
                    const isOnly = activeKinds.length === 1;
                        const availableModels = Array.isArray(typeInfo?.modelIdPlaceholder)
                          ? placeholderToOptions(typeInfo.modelIdPlaceholder[originalIndex] as string | string[] | undefined)
                          : placeholderToOptions(typeInfo?.modelIdPlaceholder as string | undefined);
                        
                        let placeholderText = 'provider/model-id';
                        if (Array.isArray(typeInfo?.modelIdPlaceholder)) {
                          const pd = typeInfo.modelIdPlaceholder[originalIndex];
                          placeholderText = Array.isArray(pd) ? (pd[0] || placeholderText) : (pd || placeholderText);
                        } else if (typeInfo?.modelIdPlaceholder) {
                          placeholderText = typeInfo.modelIdPlaceholder as string;
                        }

                        return (
                      <div key={kind} className="space-y-2">
                      {showModelIdField && (
                      <div className="flex gap-2">
                        <select
                          className={cn(currentInputClasses, "px-3 min-w-[120px] cursor-pointer appearance-none")}
                          value={kind}
                          onChange={(e) => {
                            const newKind = e.target.value as ModelKind;
                            const newIndex = providerKinds.indexOf(newKind);
                            if (newIndex < 0) return;

                            const newIds = [...modelIds];
                            newIds[newIndex] = modelIdAt(modelIds, originalIndex);
                            if (originalIndex >= 0) newIds[originalIndex] = '';
                            setModelIds(newIds);
                            setModelParams(prev => {
                              if (!prev[kind]) return prev;
                              const next = { ...prev };
                              next[newKind] = next[kind];
                              delete next[kind];
                              return next;
                            });

                            setActiveKinds(prev => prev.map(k => k === kind ? newKind : k));
                          }}
                        >
                          {providerKinds.map(availableKind => {
                            const isSelected = availableKind === kind;
                            const isUsed = activeKinds.includes(availableKind);
                            if (isUsed && !isSelected) return null;
                            return (
                              <option key={availableKind} value={availableKind}>
                                {t(`aiProviders.modelKind.${availableKind}`, availableKind)}
                              </option>
                            );
                          })}
                        </select>
                        <div className="flex-1">
                          <Combobox
                            value={modelIdAt(modelIds, originalIndex)}
                            onChange={(v) => {
                              const newIds = [...modelIds];
                              newIds[originalIndex] = v;
                              setModelIds(newIds);
                            }}
                            options={availableModels}
                            placeholder={placeholderText}
                            className={cn(currentInputClasses, "w-full")}
                          />
                        </div>
                        {!isOnly && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setActiveKinds(prev => prev.filter(k => k !== kind));
                              const newIds = [...modelIds];
                              newIds[originalIndex] = '';
                              setModelIds(newIds);
                              setModelParams(prev => {
                                if (!prev[kind]) return prev;
                                const next = { ...prev };
                                delete next[kind];
                                return next;
                              });
                            }}
                            className={cn(
                              "shrink-0 text-muted-foreground hover:text-red-500 hover:bg-red-500/10",
                              isDefault ? "h-[40px] w-[40px]" : "h-[44px] w-[44px]"
                            )}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      )}
                      <KindParamsEditor
                        kind={kind}
                        info={vendor ?? typeInfo}
                        values={modelParams[kind]}
                        onChange={(next) => setModelParams(prev => ({ ...prev, [kind]: next }))}
                        inputClasses={currentInputClasses}
                      />
                      </div>
                    );
                  })}
                  {showModelIdField && activeKinds.length < providerKinds.length && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        const nextAvailable = providerKinds.find(k => !activeKinds.includes(k));
                        if (nextAvailable) {
                          setActiveKinds([...activeKinds, nextAvailable]);
                        }
                      }}
                      className={cn(
                        "w-full border border-dashed border-black/20 dark:border-white/20 text-muted-foreground hover:text-foreground bg-transparent hover:bg-black/5 dark:hover:bg-white/5",
                        isDefault ? "h-[40px] rounded-xl" : "h-[44px] rounded-xl"
                      )}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      {t('aiProviders.dialog.addModelType', 'Add Type')}
                    </Button>
                  )}
                </div>
              )}
              {codePlanPreset && (
                <div className="space-y-1.5 pt-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label className={currentLabelClasses}>{t('aiProviders.dialog.codePlanPreset')}</Label>
                    {typeInfo?.codePlanDocsUrl && (
                      <a
                        href={typeInfo.codePlanDocsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[12px] text-primary hover:text-primary/80 font-medium inline-flex items-center gap-1"
                      >
                        {t('aiProviders.dialog.codePlanDoc')}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  <div className="flex gap-2 text-[13px]">
                    <button
                      type="button"
                      data-testid={`provider-edit-codeplan-apikey-${account.id}`}
                      disabled
                      onClick={() => {
                        setCodePlanMode('apikey');
                        setBaseUrl(typeInfo?.defaultBaseUrl || '');
                        if (modelIds[0]?.trim() === codePlanPreset.modelId) {
                          setModelIds([typeInfo?.defaultModelId as string || '']);
                        }
                      }}
                      className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", codePlanMode === 'apikey' ? "bg-surface-modal border-black/20 dark:border-white/20 shadow-sm font-medium" : "border-transparent bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10")}
                    >
                      {t('aiProviders.authModes.apiKey')}
                    </button>
                    <button
                      type="button"
                      data-testid={`provider-edit-codeplan-mode-${account.id}`}
                      disabled
                      onClick={() => {
                        setCodePlanMode('codeplan');
                        setBaseUrl(codePlanPreset.baseUrl);
                        setModelIds([codePlanPreset.modelId]);
                      }}
                      className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", codePlanMode === 'codeplan' ? "bg-surface-modal border-black/20 dark:border-white/20 shadow-sm font-medium" : "border-transparent bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10")}
                    >
                      {t('aiProviders.dialog.codePlanMode')}
                    </button>
                  </div>
                  {codePlanMode === 'codeplan' && (
                    <p className="text-xs text-muted-foreground">
                      {t('aiProviders.dialog.codePlanPresetDesc', {
                        baseUrl: codePlanPreset.baseUrl,
                        modelId: codePlanPreset.modelId,
                      })}
                    </p>
                  )}
                </div>
              )}
              {account.vendorId === 'custom' && (
                <div className="space-y-1.5 pt-2">
                  <Label className={currentLabelClasses}>{t('aiProviders.dialog.protocol', 'Protocol')}</Label>
                  <div className="flex gap-2 text-[13px]">
                    <button
                      type="button"
                      onClick={() => setApiProtocol('openai-completions')}
                      className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", apiProtocol === 'openai-completions' ? "bg-surface-modal border-black/20 dark:border-white/20 shadow-sm font-medium" : "border-transparent bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10")}
                    >
                      {t('aiProviders.protocols.openaiCompletions', 'OpenAI Completions')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setApiProtocol('openai-responses')}
                      className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", apiProtocol === 'openai-responses' ? "bg-surface-modal border-black/20 dark:border-white/20 shadow-sm font-medium" : "border-transparent bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10")}
                    >
                      {t('aiProviders.protocols.openaiResponses', 'OpenAI Responses')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setApiProtocol('anthropic-messages')}
                      className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", apiProtocol === 'anthropic-messages' ? "bg-surface-modal border-black/20 dark:border-white/20 shadow-sm font-medium" : "border-transparent bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10")}
                    >
                      {t('aiProviders.protocols.anthropic', 'Anthropic')}
                    </button>
                  </div>
                </div>
              )}
              {showUserAgentField && (
                <div className="space-y-1.5 pt-2">
                  <Label className={currentLabelClasses}>{t('aiProviders.dialog.userAgent')}</Label>
                  <Input
                    value={userAgent}
                    onChange={(e) => setUserAgent(e.target.value)}
                    placeholder={t('aiProviders.dialog.userAgentPlaceholder')}
                    className={currentInputClasses}
                  />
                </div>
              )}
            </div>
          )}
          <div className="space-y-3">
            <button
              onClick={() => setShowFallback(!showFallback)}
              className="flex items-center justify-between w-full text-[14px] font-bold text-foreground/80 hover:text-foreground transition-colors"
            >
              <span>{t('aiProviders.sections.fallback')}</span>
              <ChevronDown className={cn("h-4 w-4 transition-transform", showFallback && "rotate-180")} />
            </button>
            {showFallback && (
              <div className="space-y-3 pt-2">
                <div className="space-y-1.5">
                  <Label className={currentLabelClasses}>{t('aiProviders.dialog.fallbackModelIds')}</Label>
                  <textarea
                    value={fallbackModelsText}
                    onChange={(e) => setFallbackModelsText(e.target.value)}
                    placeholder={t('aiProviders.dialog.fallbackModelIdsPlaceholder')}
                    className={isDefault
                      ? "min-h-24 w-full rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-card px-3 py-2 text-[13px] font-mono outline-none focus-visible:ring-2 focus-visible:ring-primary/50 shadow-sm"
                      : "min-h-24 w-full rounded-xl border border-black/10 dark:border-white/10 bg-transparent px-3 py-2 text-[13px] font-mono outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary shadow-sm transition-all text-foreground placeholder:text-foreground/40"}
                  />
                  <p className="text-[12px] text-muted-foreground">
                    {t('aiProviders.dialog.fallbackModelIdsHelp')}
                  </p>
                </div>
                <div className="space-y-2 pt-1">
                  <Label className={currentLabelClasses}>{t('aiProviders.dialog.fallbackProviders')}</Label>
                  {fallbackOptions.length === 0 ? (
                    <p className="text-[13px] text-muted-foreground">{t('aiProviders.dialog.noFallbackOptions')}</p>
                  ) : (
                    <div className={cn("space-y-2 rounded-xl border border-black/10 dark:border-white/10 p-3 shadow-sm", isDefault ? "bg-white dark:bg-card" : "bg-surface-input")}>
                      {fallbackOptions.map((candidate) => (
                        <label key={candidate.account.id} className="flex items-center gap-3 text-[13px] cursor-pointer group/label">
                          <input
                            type="checkbox"
                            checked={fallbackProviderIds.includes(candidate.account.id)}
                            onChange={() => toggleFallbackProvider(candidate.account.id)}
                            className="rounded border-black/20 dark:border-white/20 text-primary focus:ring-primary/50"
                          />
                          <span className="font-medium group-hover/label:text-primary transition-colors">{candidate.account.label}</span>
                          <span className="text-[12px] text-muted-foreground">
                            {candidate.account.model || candidate.vendor?.name || candidate.account.vendorId}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className={currentSectionLabelClasses}>{t('aiProviders.dialog.apiKey')}</Label>
                <p className="text-[12px] text-muted-foreground">
                  {hasConfiguredCredentials(account, status)
                    ? t('aiProviders.dialog.apiKeyConfigured')
                    : t('aiProviders.dialog.apiKeyMissing')}
                </p>
              </div>
              {hasConfiguredCredentials(account, status) ? (
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-green-600 dark:text-green-500 bg-green-500/10 px-2 py-1 rounded-md">
                  <div className="w-1.5 h-1.5 rounded-full bg-current" />
                  {t('aiProviders.card.configured')}
                </div>
              ) : null}
            </div>
            {typeInfo?.apiKeyUrl && (
              <div className="flex justify-start">
                <a
                  href={typeInfo.apiKeyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[13px] text-primary hover:text-primary/80 hover:underline flex items-center gap-1"
                  tabIndex={-1}
                >
                  {t('aiProviders.oauth.getApiKey')} <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
            <div className="space-y-1.5 pt-1">
              <Label className={currentLabelClasses}>{t('aiProviders.dialog.replaceApiKey')}</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showKey ? 'text' : 'password'}
                    placeholder={typeInfo?.requiresApiKey ? typeInfo?.placeholder : (typeInfo?.id === 'ollama' ? t('aiProviders.notRequired') : t('aiProviders.card.editKey'))}
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                    className={cn(currentInputClasses, 'pr-10')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <Button
                  variant="outline"
                  data-testid={`provider-edit-save-${account.id}`}
                  onClick={handleSaveEdits}
                  className={cn(
                    "rounded-xl px-4 border-black/10 dark:border-white/10",
                    isDefault
                      ? "h-[40px] bg-white dark:bg-card hover:bg-black/5 dark:hover:bg-white/10"
                      : "h-[44px] bg-surface-input hover:bg-black/5 dark:hover:bg-white/10 shadow-sm"
                  )}
                  disabled={
                    validating
                    || saving
                    || (
                      !newKey.trim()
                      && (!label.trim() || label.trim() === (account.label || ''))
                      && (baseUrl.trim() || undefined) === (account.baseUrl || undefined)
                      && apiProtocol === (account.apiProtocol || 'openai-completions')
                      && userAgent.trim() === getUserAgentHeader(account.headers).trim()
                      && modelIds.map(id => (id ?? '').trim()).join(',') === buildEditableModelIds(account, providerKinds, typeInfo).join(',')
                      && JSON.stringify(modelParams) === JSON.stringify(account.modelParams ?? {})
                      && fallbackModelsEqual(normalizeFallbackModels(fallbackModelsText.split('\n')), account.fallbackModels)
                      && fallbackProviderIdsEqual(fallbackProviderIds, account.fallbackAccountIds)
                    )
                    || Boolean(showModelIdField && modelIds.every(id => !id?.trim()))
                  }
                >
                  {validating || saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4 text-green-500" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  onClick={onCancelEdit}
                  className={cn(
                    "p-0 rounded-xl",
                    isDefault
                      ? "h-[40px] w-[40px] hover:bg-black/5 dark:hover:bg-white/10"
                      : "h-[44px] w-[44px] bg-surface-input border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 shadow-sm text-muted-foreground hover:text-foreground"
                  )}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-[12px] text-muted-foreground">
                {t('aiProviders.dialog.replaceApiKeyHelp')}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface AddProviderDialogProps {
  existingVendorIds: Set<string>;
  vendors: ProviderVendorInfo[];
  onClose: () => void;
  onAdd: (
    type: ProviderType,
    name: string,
    apiKey: string,
    options?: {
      baseUrl?: string;
      model?: string | string[];
      modelParams?: ModelParamsByKind;
      authMode?: ProviderAccount['authMode'];
      apiProtocol?: ProviderAccount['apiProtocol'];
      headers?: Record<string, string>;
    }
  ) => Promise<void>;
  onValidateKey: (
    type: string,
    apiKey: string,
    options?: { baseUrl?: string; apiProtocol?: ProviderAccount['apiProtocol']; modelId?: string }
  ) => Promise<ProviderValidationResult>;
  devModeUnlocked: boolean;
}

function AddProviderDialog({
  existingVendorIds,
  vendors,
  onClose,
  onAdd,
  onValidateKey,
  devModeUnlocked,
}: AddProviderDialogProps) {
  const { t, i18n } = useTranslation('settings');
  const [selectedType, setSelectedType] = useState<ProviderType | null>(null);
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [modelIds, setModelIds] = useState<string[]>([]);
  const [modelParams, setModelParams] = useState<ModelParamsByKind>({});
  const [activeKinds, setActiveKinds] = useState<ModelKind[]>([]);
  const [apiProtocol, setApiProtocol] = useState<ProviderAccount['apiProtocol']>('openai-completions');
  const [showAdvancedConfig, setShowAdvancedConfig] = useState(false);
  const [userAgent, setUserAgent] = useState('');
  const [codePlanMode, setCodePlanMode] = useState<CodePlanMode>('apikey');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // OAuth Flow State
  const [oauthFlowing, setOauthFlowing] = useState(false);
  const [oauthData, setOauthData] = useState<{
    mode: 'device';
    verificationUri: string;
    userCode: string;
    expiresIn: number;
  } | {
    mode: 'manual';
    authorizationUrl: string;
    message?: string;
  } | null>(null);
  const [manualCodeInput, setManualCodeInput] = useState('');
  const [oauthError, setOauthError] = useState<string | null>(null);
  // For providers that support both OAuth and API key, let the user choose.
  // Default to the vendor's declared auth mode instead of hard-coding OAuth.
  const [authMode, setAuthMode] = useState<'oauth' | 'apikey'>('apikey');

  const typeInfo = PROVIDER_TYPE_INFO.find((t) => t.id === selectedType);
  const providerDocsUrl = getProviderDocsUrl(typeInfo, i18n.language);
  const showModelIdField = shouldShowProviderModelId(typeInfo, devModeUnlocked);
  const codePlanPreset = typeInfo?.codePlanPresetBaseUrl && typeInfo?.codePlanPresetModelId
    ? {
      baseUrl: typeInfo.codePlanPresetBaseUrl,
      modelId: typeInfo.codePlanPresetModelId,
    }
    : null;
  const effectiveDocsUrl = codePlanMode === 'codeplan'
    ? (typeInfo?.codePlanDocsUrl || providerDocsUrl)
    : providerDocsUrl;
  const isOAuth = typeInfo?.isOAuth ?? false;
  const supportsApiKey = typeInfo?.supportsApiKey ?? false;
  const vendorMap = new Map(vendors.map((vendor) => [vendor.id, vendor]));
  const selectedVendor = selectedType ? vendorMap.get(selectedType) : undefined;
  const showUserAgentInAddDialog = shouldShowUserAgentFieldForNewProvider(selectedType);
  const preferredOAuthMode = selectedVendor?.supportedAuthModes.includes('oauth_browser')
    ? 'oauth_browser'
    : (selectedVendor?.supportedAuthModes.includes('oauth_device')
      ? 'oauth_device'
      : (selectedType === 'google' ? 'oauth_browser' : null));
  // Effective OAuth mode: pure OAuth providers, or dual-mode with oauth selected
  const useOAuthFlow = isOAuth && (!supportsApiKey || authMode === 'oauth');
  const providerKinds = normalizeModelTypes(typeInfo?.modelType);
  // Some kinds expose extra params (voice/format/speed …) even when the model id
  // field is hidden (showModelId=false); keep them configurable in that case.
  const hasKindParams = activeKinds.some((k) => getKindParamFields(vendorMap.get(selectedType!) ?? typeInfo, k).length > 0);

  useEffect(() => {
    if (!selectedVendor || !isOAuth || !supportsApiKey) {
      return;
    }
    setAuthMode(selectedVendor.defaultAuthMode === 'api_key' ? 'apikey' : 'oauth');
  }, [selectedVendor, isOAuth, supportsApiKey]);

  useEffect(() => {
    if (!typeInfo?.codePlanPresetBaseUrl || !typeInfo?.codePlanPresetModelId) {
      setCodePlanMode('apikey');
      return;
    }
    setCodePlanMode(
      isCodePlanMode(
        baseUrl,
        modelIds[0],
        typeInfo?.codePlanPresetBaseUrl,
        typeInfo?.codePlanPresetModelId,
      ) ? 'codeplan' : 'apikey'
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedType]);

  // Keep refs to the latest values so event handlers see the current dialog state.
  const latestRef = React.useRef({ selectedType, typeInfo, onAdd, onClose, t });
  const pendingOAuthRef = React.useRef<{ accountId: string; label: string } | null>(null);
  useEffect(() => {
    latestRef.current = { selectedType, typeInfo, onAdd, onClose, t };
  });

  // Manage OAuth events
  useEffect(() => {
    const handleCode = (data: unknown) => {
      const payload = data as Record<string, unknown>;
      if (payload?.mode === 'manual') {
        setOauthData({
          mode: 'manual',
          authorizationUrl: String(payload.authorizationUrl || ''),
          message: typeof payload.message === 'string' ? payload.message : undefined,
        });
      } else {
        setOauthData({
          mode: 'device',
          verificationUri: String(payload.verificationUri || ''),
          userCode: String(payload.userCode || ''),
          expiresIn: Number(payload.expiresIn || 300),
        });
      }
      setOauthError(null);
    };

    const handleSuccess = async (data: OAuthSuccessEvent) => {
      setOauthFlowing(false);
      setOauthData(null);
      setManualCodeInput('');
      setValidationError(null);

      const { onClose: close, t: translate } = latestRef.current;
      const payload = (data as { accountId?: string } | undefined) || undefined;
      const accountId = payload?.accountId || pendingOAuthRef.current?.accountId;
      pendingOAuthRef.current = null;

      // The Main process only emits success after credentials are persisted.
      // Close immediately so runtime synchronization does not make a successful
      // browser OAuth flow appear stuck in the UI.
      close();
      toast.success(translate('aiProviders.toast.added'));

      // device-oauth.ts already saved the provider config to the backend,
      // including the dynamically resolved baseUrl for the region (e.g. CN vs Global).
      // Refresh and select it without delaying success feedback.
      void (async () => {
        try {
          const store = useProviderStore.getState();
          await store.refreshProviderSnapshot();

          if (accountId) {
            await store.setDefaultAccount(accountId);
          }
        } catch (err) {
          console.error('Failed to refresh providers after OAuth:', err);
          toast.error(translate('aiProviders.toast.failedDefault'));
        }
      })();
    };

    const handleError = (data: OAuthErrorEvent) => {
      setOauthError(getOAuthErrorMessage(data.message, latestRef.current.t));
      setOauthData(null);
      pendingOAuthRef.current = null;
    };

    const offCode = subscribeHostEvent('oauth:code', handleCode);
    const offSuccess = subscribeHostEvent('oauth:success', handleSuccess);
    const offError = subscribeHostEvent('oauth:error', handleError);

    return () => {
      offCode();
      offSuccess();
      offError();
      if (pendingOAuthRef.current) {
        pendingOAuthRef.current = null;
        void hostApi.providers.cancelOAuth();
      }
    };
  }, []);

  const handleStartOAuth = async () => {
    if (!selectedType) return;

    const hasMinimax = existingVendorIds.has('minimax-portal') || existingVendorIds.has('minimax-portal-cn');
    if ((selectedType === 'minimax-portal' || selectedType === 'minimax-portal-cn') && hasMinimax) {
      toast.error(t('aiProviders.toast.minimaxConflict'));
      return;
    }
    const hasZai = existingVendorIds.has('zai') || existingVendorIds.has('zai-global');
    if (isZaiProviderType(selectedType) && hasZai) {
      toast.error(t('aiProviders.toast.zaiConflict'));
      return;
    }

    setOauthFlowing(true);
    setOauthData(null);
    setManualCodeInput('');
    setOauthError(null);

    try {
      const vendor = vendorMap.get(selectedType);
      const supportsMultipleAccounts = vendor?.supportsMultipleAccounts ?? selectedType === 'custom';
      const accountId = supportsMultipleAccounts ? `${selectedType}-${crypto.randomUUID()}` : selectedType;
      const label = name || (typeInfo?.id === 'custom' ? t('aiProviders.custom') : typeInfo?.name) || selectedType;
      pendingOAuthRef.current = { accountId, label };
      const result = await hostApi.providers.requestOAuth({ provider: selectedType, accountId, label });
      if (!result.success) {
        setOauthError(result.error || 'OAuth request failed');
        setOauthFlowing(false);
        pendingOAuthRef.current = null;
      }
    } catch (e) {
      setOauthError(String(e));
      setOauthFlowing(false);
      pendingOAuthRef.current = null;
    }
  };

  const handleCancelOAuth = async () => {
    setOauthFlowing(false);
    setOauthData(null);
    setManualCodeInput('');
    setOauthError(null);
    pendingOAuthRef.current = null;
    await hostApi.providers.cancelOAuth();
  };

  const handleSubmitManualOAuthCode = async () => {
    const value = manualCodeInput.trim();
    if (!value) return;
    try {
      const result = await hostApi.providers.submitOAuth({ code: value });
      if (!result.success) {
        setOauthError(result.error || 'OAuth submit failed');
      } else {
        setOauthError(null);
      }
    } catch (error) {
      setOauthError(String(error));
    }
  };

  const availableTypes = PROVIDER_TYPE_INFO.filter((type) => {
    // Skip providers that are temporarily hidden or unavailable in this UI language.
    if (type.hidden) return false;
    if (!isProviderAvailableForLanguage(type, i18n.resolvedLanguage || i18n.language)) return false;

    // MiniMax portal variants are mutually exclusive — hide BOTH variants
    // when either one already exists (account may have vendorId of either variant).
    const hasMinimax = existingVendorIds.has('minimax-portal') || existingVendorIds.has('minimax-portal-cn');
    if ((type.id === 'minimax-portal' || type.id === 'minimax-portal-cn') && hasMinimax) return false;

    // Z.AI CN/Global both map to OpenClaw key `zai` — mutually exclusive in the UI.
    const hasZai = existingVendorIds.has('zai') || existingVendorIds.has('zai-global');
    if (isZaiProviderType(type.id) && hasZai) return false;

    const vendor = vendorMap.get(type.id);
    const allowedByVendor = vendor
      ? vendor.supportsMultipleAccounts || !existingVendorIds.has(type.id)
      : !existingVendorIds.has(type.id) || type.id === 'custom';
    if (!allowedByVendor) return false;

    return true;
  });

  const handleAdd = async () => {
    if (!selectedType) return;

    const hasMinimax = existingVendorIds.has('minimax-portal') || existingVendorIds.has('minimax-portal-cn');
    if ((selectedType === 'minimax-portal' || selectedType === 'minimax-portal-cn') && hasMinimax) {
      toast.error(t('aiProviders.toast.minimaxConflict'));
      return;
    }
    const hasZai = existingVendorIds.has('zai') || existingVendorIds.has('zai-global');
    if (isZaiProviderType(selectedType) && hasZai) {
      toast.error(t('aiProviders.toast.zaiConflict'));
      return;
    }

    setSaving(true);
    setValidationError(null);

    try {
      // Validate key first if the provider requires one and a key was entered
      const requiresKey = typeInfo?.requiresApiKey ?? false;
      const normalizedApiKey = normalizeProviderApiKeyInput(apiKey);
      if (requiresKey && !normalizedApiKey) {
        setValidationError(t('aiProviders.toast.invalidKey')); // reusing invalid key msg or should add 'required' msg? null checks
        setSaving(false);
        return;
      }
      if (requiresKey && normalizedApiKey) {
        const result = await onValidateKey(selectedType, normalizedApiKey, {
          baseUrl: baseUrl.trim() || undefined,
          apiProtocol: (selectedType === 'custom' || selectedType === 'ollama') ? apiProtocol : undefined,
          modelId: modelIds[0]?.trim() || undefined,
        });
        if (!result.valid) {
          setValidationError(getProviderValidationError(result, t));
          setSaving(false);
          return;
        }
      }

      const requiresModel = showModelIdField;
      if (requiresModel && modelIds.every((id) => !id?.trim())) {
        setValidationError(t('aiProviders.toast.modelRequired'));
        setSaving(false);
        return;
      }

      await onAdd(
        selectedType,
        name || (typeInfo?.id === 'custom' ? t('aiProviders.custom') : typeInfo?.name) || selectedType,
        normalizedApiKey,
        {
          baseUrl: baseUrl.trim() || undefined,
          apiProtocol: (selectedType === 'custom' || selectedType === 'ollama') ? apiProtocol : undefined,
          headers: userAgent.trim() ? { 'User-Agent': userAgent.trim() } : undefined,
          model: resolveProviderModelForSave(selectedType, typeInfo, modelIds, devModeUnlocked),
          modelParams: Object.keys(modelParams).length > 0 ? modelParams : undefined,
          authMode: useOAuthFlow ? (preferredOAuthMode || 'oauth_device') : selectedType === 'ollama'
            ? 'local'
            : (isOAuth && supportsApiKey && authMode === 'apikey')
              ? 'api_key'
              : vendorMap.get(selectedType)?.defaultAuthMode || 'api_key',
        }
      );
    } catch {
      // error already handled via toast in parent
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalPortal>
    <div data-testid="add-provider-dialog" className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl h-[650px] flex flex-col rounded-3xl border-0 shadow-2xl bg-background overflow-hidden">
        <CardHeader className="relative pb-2 shrink-0">
          <CardTitle className="text-2xl font-serif font-normal">{t('aiProviders.dialog.title')}</CardTitle>
          <CardDescription className="text-[15px] mt-1 text-foreground/70">
            {t('aiProviders.dialog.desc')}
          </CardDescription>
          <Button
            data-testid="add-provider-close-button"
            variant="ghost"
            size="icon"
            className="absolute right-4 top-4 rounded-full h-8 w-8 -mr-2 -mt-2 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="overflow-y-auto flex-1 p-6">
          {!selectedType ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {availableTypes.map((type) => {
                  const vendor = vendors.find(v => v.id === type.id);
                  const kinds = normalizeModelTypes(pickModelType(vendor?.modelType, type.modelType));
                  return (
                    <button
                      data-testid={`add-provider-type-${type.id}`}
                      key={type.id}
                      onClick={() => {
                        setSelectedType(type.id);
                        setName(type.id === 'custom' ? t('aiProviders.custom') : type.name);
                        setBaseUrl(type.defaultBaseUrl || '');
                        const defaultModelIds = Array.isArray(type.defaultModelId) ? type.defaultModelId : [type.defaultModelId || ''];
                        setModelIds(defaultModelIds);
                        setModelParams({});
                        const kinds = normalizeModelTypes(pickModelType(vendor?.modelType, type.modelType));
                        // Show ALL declared kinds so the visible model-id boxes match what
                        // gets serialized to openclaw.json. The previous "[kinds[0]]" only
                        // rendered the first kind while `modelIds` was prefilled with the
                        // full `defaultModelId` array, so hidden defaults (image/voice) were
                        // silently written. Surfacing every kind lets the user see/edit/remove them.
                        setActiveKinds(kinds);
                        setApiKey(type.defaultApiKey || '');
                        setUserAgent('');
                        setShowAdvancedConfig(false);
                        setCodePlanMode('apikey');
                      }}
                      className="p-4 rounded-2xl border border-black/5 dark:border-white/5 hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-center group flex flex-col items-center"
                    >
                      <div className="h-12 w-12 mb-3 flex items-center justify-center bg-black/5 dark:bg-white/5 rounded-xl shadow-sm border border-black/5 dark:border-white/5 group-hover:scale-105 transition-transform">
                        {getProviderIconUrl(type.id) ? (
                          <img src={getProviderIconUrl(type.id)} alt={type.name} className={cn('h-6 w-6', shouldInvertInDark(type.id) && 'dark:invert')} />
                        ) : (
                          <span className="text-2xl">{type.icon}</span>
                        )}
                      </div>
                      <p className="font-medium text-[13px] mb-2">{type.id === 'custom' ? t('aiProviders.custom') : type.name}</p>
                      <div className="flex flex-wrap justify-center gap-1 mt-auto">
                        {kinds.map((kind) => (
                          <span key={kind} className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap", KIND_COLORS[kind])}>
                            {t(`aiProviders.modelKind.${kind}`, kind)}
                          </span>
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center gap-3 p-4 rounded-2xl bg-white dark:bg-card border border-black/5 dark:border-white/5 shadow-sm">
                <div className="h-10 w-10 shrink-0 flex items-center justify-center bg-black/5 dark:bg-white/5 rounded-xl">
                  {getProviderIconUrl(selectedType!) ? (
                    <img src={getProviderIconUrl(selectedType!)} alt={typeInfo?.name} className={cn('h-6 w-6', shouldInvertInDark(selectedType!) && 'dark:invert')} />
                  ) : (
                    <span className="text-xl">{typeInfo?.icon}</span>
                  )}
                </div>
                <div>
                  <p className="font-semibold text-[15px]">{typeInfo?.id === 'custom' ? t('aiProviders.custom') : typeInfo?.name}</p>
                  <button
                  data-testid="add-provider-change-type"
                  onClick={() => {
                    setSelectedType(null);
                    setValidationError(null);
                    setBaseUrl('');
                    setModelIds([]);
                    setModelParams({});
                    setActiveKinds([]);
                    setApiKey('');
                    setUserAgent('');
                    setShowAdvancedConfig(false);
                    setCodePlanMode('apikey');
                  }}
                  className="text-[13px] text-primary hover:text-primary/80 font-medium"
                >
                    {t('aiProviders.dialog.change')}
                  </button>
                  {effectiveDocsUrl && (
                    <>
                      <span className="mx-2 text-foreground/20">|</span>
                      <a
                        href={effectiveDocsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[13px] text-primary hover:text-primary/80 font-medium inline-flex items-center gap-1"
                      >
                        {t('aiProviders.dialog.customDoc')}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </>
                  )}
                </div>
              </div>

              <div className="space-y-6 bg-transparent p-0">
                <div className="space-y-2.5">
                  <Label htmlFor="name" className={labelClasses}>{t('aiProviders.dialog.displayName')}</Label>
                  <Input
                    data-testid="add-provider-name-input"
                    id="name"
                    placeholder={typeInfo?.id === 'custom' ? t('aiProviders.custom') : typeInfo?.name}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className={inputClasses}
                  />
                </div>

                {/* Auth mode toggle for providers supporting both */}
                {isOAuth && supportsApiKey && (
                  <div className="flex rounded-xl border border-black/10 dark:border-white/10 overflow-hidden text-[13px] font-medium shadow-sm bg-surface-input p-1 gap-1">
                    <button
                      onClick={() => setAuthMode('oauth')}
                      className={cn(
                        'flex-1 py-2 px-3 rounded-lg transition-colors',
                        authMode === 'oauth' ? 'bg-black/5 dark:bg-white/10 text-foreground' : 'text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5'
                      )}
                    >
                      {t('aiProviders.oauth.loginMode')}
                    </button>
                    <button
                      onClick={() => setAuthMode('apikey')}
                      className={cn(
                        'flex-1 py-2 px-3 rounded-lg transition-colors',
                        authMode === 'apikey' ? 'bg-black/5 dark:bg-white/10 text-foreground' : 'text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5'
                      )}
                    >
                      {t('aiProviders.oauth.apikeyMode')}
                    </button>
                  </div>
                )}

                {/* API Key input — shown for non-OAuth providers or when apikey mode is selected */}
                {(!isOAuth || (supportsApiKey && authMode === 'apikey')) && (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="apiKey" className={labelClasses}>{t('aiProviders.dialog.apiKey')}</Label>
                      {typeInfo?.apiKeyUrl && (
                        <a
                          href={typeInfo.apiKeyUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[13px] text-primary hover:text-primary/80 font-medium flex items-center gap-1"
                          tabIndex={-1}
                        >
                          {t('aiProviders.oauth.getApiKey')} <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    <div className="relative">
                      <Input
                        data-testid="add-provider-api-key-input"
                        id="apiKey"
                        type={showKey ? 'text' : 'password'}
                        placeholder={typeInfo?.id === 'ollama' ? t('aiProviders.notRequired') : typeInfo?.placeholder}
                        value={apiKey}
                        onChange={(e) => {
                          setApiKey(e.target.value);
                          setValidationError(null);
                        }}
                        className={inputClasses}
                      />
                      <button
                        type="button"
                        onClick={() => setShowKey(!showKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {validationError && (
                      <p className="text-[13px] text-red-500 font-medium">{validationError}</p>
                    )}
                    <p className="text-[12px] text-muted-foreground">
                      {t('aiProviders.dialog.apiKeyStored')}
                    </p>
                  </div>
                )}

                {typeInfo?.showBaseUrl && (
                  <div className="space-y-2.5">
                    <Label htmlFor="baseUrl" className={labelClasses}>{t('aiProviders.dialog.baseUrl')}</Label>
                    <Input
                      data-testid="add-provider-base-url-input"
                      id="baseUrl"
                      placeholder={getProtocolBaseUrlPlaceholder(apiProtocol)}
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      className={inputClasses}
                    />
                  </div>
                )}

              {(showModelIdField || hasKindParams) && (
                <div className="space-y-3">
                  {showModelIdField && (
                    <div className="flex items-center justify-between">
                      <Label className={labelClasses}>{t('aiProviders.dialog.modelId')}</Label>
                    </div>
                  )}
                  {activeKinds.map((kind) => {
                    const originalIndex = providerKinds.indexOf(kind);
                    const isOnly = activeKinds.length === 1;
                        const availableModels = Array.isArray(typeInfo?.modelIdPlaceholder)
                          ? placeholderToOptions(typeInfo.modelIdPlaceholder[originalIndex] as string | string[] | undefined)
                          : placeholderToOptions(typeInfo?.modelIdPlaceholder as string | undefined);
                        
                        let placeholderText = 'provider/model-id';
                        if (Array.isArray(typeInfo?.modelIdPlaceholder)) {
                          const pd = typeInfo.modelIdPlaceholder[originalIndex];
                          placeholderText = Array.isArray(pd) ? (pd[0] || placeholderText) : (pd || placeholderText);
                        } else if (typeInfo?.modelIdPlaceholder) {
                          placeholderText = typeInfo.modelIdPlaceholder as string;
                        }

                        return (
                      <div key={kind} className="space-y-2">
                      {showModelIdField && (
                      <div className="flex gap-2">
                        <select
                          className={cn(inputClasses, "px-3 min-w-[120px] cursor-pointer appearance-none")}
                          value={kind}
                          onChange={(e) => {
                            const newKind = e.target.value as ModelKind;
                            const newIndex = providerKinds.indexOf(newKind);
                            if (newIndex < 0) return;

                            const newIds = [...modelIds];
                            newIds[newIndex] = modelIdAt(modelIds, originalIndex);
                            if (originalIndex >= 0) newIds[originalIndex] = '';
                            setModelIds(newIds);
                            setModelParams(prev => {
                              if (!prev[kind]) return prev;
                              const next = { ...prev };
                              next[newKind] = next[kind];
                              delete next[kind];
                              return next;
                            });

                            setActiveKinds(prev => prev.map(k => k === kind ? newKind : k));
                            setValidationError(null);
                          }}
                        >
                          {providerKinds.map(availableKind => {
                            const isSelected = availableKind === kind;
                            const isUsed = activeKinds.includes(availableKind);
                            if (isUsed && !isSelected) return null;
                            return (
                              <option key={availableKind} value={availableKind}>
                                {t(`aiProviders.modelKind.${availableKind}`, availableKind)}
                              </option>
                            );
                          })}
                        </select>
                        <div className="flex-1">
                          <Combobox
                            data-testid={`add-provider-model-id-input-${kind}`}
                            id={`modelId-${kind}`}
                            placeholder={placeholderText}
                            value={modelIdAt(modelIds, originalIndex)}
                            onChange={(v) => {
                              const newIds = [...modelIds];
                              newIds[originalIndex] = v;
                              setModelIds(newIds);
                              setValidationError(null);
                            }}
                            options={availableModels}
                            className={cn(inputClasses, "w-full")}
                          />
                        </div>
                        {!isOnly && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setActiveKinds(prev => prev.filter(k => k !== kind));
                              const newIds = [...modelIds];
                              newIds[originalIndex] = '';
                              setModelIds(newIds);
                              setModelParams(prev => {
                                if (!prev[kind]) return prev;
                                const next = { ...prev };
                                delete next[kind];
                                return next;
                              });
                              setValidationError(null);
                            }}
                            className="h-[44px] w-[44px] shrink-0 text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      )}
                      <KindParamsEditor
                        kind={kind}
                        info={vendorMap.get(selectedType!) ?? typeInfo}
                        values={modelParams[kind]}
                        onChange={(next) => setModelParams(prev => ({ ...prev, [kind]: next }))}
                        inputClasses={inputClasses}
                      />
                      </div>
                    );
                  })}
                  {showModelIdField && activeKinds.length < providerKinds.length && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        const nextAvailable = providerKinds.find(k => !activeKinds.includes(k));
                        if (nextAvailable) {
                          setActiveKinds([...activeKinds, nextAvailable]);
                        }
                      }}
                      className="h-[44px] w-full rounded-xl border border-dashed border-black/20 dark:border-white/20 text-muted-foreground hover:text-foreground bg-transparent hover:bg-black/5 dark:hover:bg-white/5"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      {t('aiProviders.dialog.addModelType', 'Add Type')}
                    </Button>
                  )}
                </div>
              )}
              {selectedType === 'ark' && codePlanPreset && (
                <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label className={labelClasses}>{t('aiProviders.dialog.codePlanPreset')}</Label>
                      {typeInfo?.codePlanDocsUrl && (
                        <a
                          href={typeInfo.codePlanDocsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[13px] text-primary hover:text-primary/80 font-medium inline-flex items-center gap-1"
                          tabIndex={-1}
                        >
                          {t('aiProviders.dialog.codePlanDoc')}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    <div className="flex gap-2 text-[13px]">
                      <button
                        type="button"
                        data-testid="add-provider-codeplan-apikey-tab"
                        onClick={() => {
                          setCodePlanMode('apikey');
                          setBaseUrl(typeInfo?.defaultBaseUrl || '');
                          if (modelIds[0]?.trim() === codePlanPreset.modelId) {
                            setModelIds([typeInfo?.defaultModelId as string || '']);
                          }
                          setValidationError(null);
                        }}
                        className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", codePlanMode === 'apikey' ? "bg-surface-modal border-black/20 dark:border-white/20 shadow-sm font-medium" : "border-transparent bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10")}
                      >
                        {t('aiProviders.authModes.apiKey')}
                      </button>
                      <button
                        type="button"
                        data-testid="add-provider-codeplan-mode-tab"
                        onClick={() => {
                          setCodePlanMode('codeplan');
                          setBaseUrl(codePlanPreset.baseUrl);
                          setModelIds([codePlanPreset.modelId]);
                          setValidationError(null);
                        }}
                        className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", codePlanMode === 'codeplan' ? "bg-surface-modal border-black/20 dark:border-white/20 shadow-sm font-medium" : "border-transparent bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10")}
                      >
                        {t('aiProviders.dialog.codePlanMode')}
                      </button>
                    </div>
                    {codePlanMode === 'codeplan' && (
                      <p className="text-xs text-muted-foreground">
                        {t('aiProviders.dialog.codePlanPresetDesc', {
                          baseUrl: codePlanPreset.baseUrl,
                          modelId: codePlanPreset.modelId,
                        })}
                      </p>
                    )}
                  </div>
                )}
                {selectedType === 'custom' && (
                <div className="space-y-2.5">
                  <Label className={labelClasses}>{t('aiProviders.dialog.protocol', 'Protocol')}</Label>
                  <div className="flex gap-2 text-[13px]">
                    <button
                      type="button"
                        onClick={() => setApiProtocol('openai-completions')}
                        className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", apiProtocol === 'openai-completions' ? "bg-surface-modal border-black/20 dark:border-white/20 shadow-sm font-medium" : "border-transparent bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10")}
                    >
                      {t('aiProviders.protocols.openaiCompletions', 'OpenAI Completions')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setApiProtocol('openai-responses')}
                      className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", apiProtocol === 'openai-responses' ? "bg-surface-modal border-black/20 dark:border-white/20 shadow-sm font-medium" : "border-transparent bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10")}
                    >
                      {t('aiProviders.protocols.openaiResponses', 'OpenAI Responses')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setApiProtocol('anthropic-messages')}
                      className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", apiProtocol === 'anthropic-messages' ? "bg-surface-modal border-black/20 dark:border-white/20 shadow-sm font-medium" : "border-transparent bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10")}
                      >
                        {t('aiProviders.protocols.anthropic', 'Anthropic')}
                      </button>
                    </div>
                  </div>
                )}
                {showUserAgentInAddDialog && (
                  <div className="space-y-2.5">
                    <button
                      type="button"
                      onClick={() => setShowAdvancedConfig((value) => !value)}
                      className="flex items-center justify-between w-full text-[14px] font-bold text-foreground/80 hover:text-foreground transition-colors"
                    >
                      <span>{t('aiProviders.dialog.advancedConfig')}</span>
                      <ChevronDown className={cn("h-4 w-4 transition-transform", showAdvancedConfig && "rotate-180")} />
                    </button>
                    {showAdvancedConfig && (
                      <div className="space-y-2.5 pt-1">
                        <Label htmlFor="userAgent" className={labelClasses}>{t('aiProviders.dialog.userAgent')}</Label>
                        <Input
                          id="userAgent"
                          placeholder={t('aiProviders.dialog.userAgentPlaceholder')}
                          value={userAgent}
                          onChange={(e) => setUserAgent(e.target.value)}
                          className={inputClasses}
                        />
                      </div>
                    )}
                  </div>
                )}
                {/* Device OAuth Trigger — only shown when in OAuth mode */}
                {useOAuthFlow && (
                  <div className="space-y-4 pt-2">
                    <div className="rounded-xl bg-blue-500/10 border border-blue-500/20 p-5 text-center">
                      <p className="text-[13px] font-medium text-blue-600 dark:text-blue-400 mb-4 block">
                        {t('aiProviders.oauth.loginPrompt')}
                      </p>
                      <Button
                        onClick={handleStartOAuth}
                        disabled={oauthFlowing}
                        className="w-full rounded-full h-[42px] font-semibold bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm"
                      >
                        {oauthFlowing ? (
                          <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{t('aiProviders.oauth.waiting')}</>
                        ) : (
                          t('aiProviders.oauth.loginButton')
                        )}
                      </Button>
                    </div>

                    {/* OAuth Active State Modal / Inline View */}
                    {oauthFlowing && (
                      <div className="mt-4 p-5 border border-black/10 dark:border-white/10 rounded-2xl bg-surface-modal shadow-sm relative overflow-hidden">
                        {/* Background pulse effect */}
                        <div className="absolute inset-0 bg-blue-500/5 animate-pulse" />

                        <div className="relative z-10 flex flex-col items-center justify-center text-center space-y-5">
                          {oauthError ? (
                            <div className="text-red-500 space-y-3">
                              <XCircle className="h-10 w-10 mx-auto" />
                              <p className="font-semibold text-[15px]">{t('aiProviders.oauth.authFailed')}</p>
                              <p className="text-[13px] opacity-80">{oauthError}</p>
                              <Button variant="outline" size="sm" onClick={handleCancelOAuth} className="mt-2 rounded-full px-6 h-9">
                                {t('aiProviders.oauth.tryAgain')}
                              </Button>
                            </div>
                          ) : !oauthData ? (
                            <div className="space-y-4 py-6">
                              <Loader2 className="h-10 w-10 animate-spin text-blue-500 mx-auto" />
                              <p className="text-[13px] font-medium text-muted-foreground animate-pulse">{t('aiProviders.oauth.requestingCode')}</p>
                            </div>
                          ) : oauthData.mode === 'manual' ? (
                            <div className="space-y-4 w-full">
                              <div className="space-y-2">
                                <h3 className="font-semibold text-base text-foreground">{t('aiProviders.oauth.completeBrowserLogin')}</h3>
                                <p className="text-meta text-muted-foreground text-left bg-black/5 dark:bg-white/5 p-4 rounded-xl">
                                  {oauthData.message || t('aiProviders.oauth.manualCallbackHelp')}
                                </p>
                              </div>

                              <Button
                                variant="secondary"
                                className="w-full rounded-full h-[42px] font-semibold"
                                onClick={() => hostApi.shell.openExternal(oauthData.authorizationUrl)}
                              >
                                <ExternalLink className="h-4 w-4 mr-2" />
                                {t('aiProviders.oauth.openAuthorizationPage')}
                              </Button>

                              <Input
                                placeholder={t('aiProviders.oauth.callbackPlaceholder')}
                                value={manualCodeInput}
                                onChange={(e) => setManualCodeInput(e.target.value)}
                                className={inputClasses}
                              />

                              <Button
                                className="w-full rounded-full h-[42px] font-semibold bg-primary hover:bg-primary/90 text-primary-foreground"
                                onClick={handleSubmitManualOAuthCode}
                                disabled={!manualCodeInput.trim()}
                              >
                                {t('aiProviders.oauth.submitCode')}
                              </Button>

                              <Button variant="ghost" className="w-full rounded-full h-[42px] font-semibold text-muted-foreground" onClick={handleCancelOAuth}>
                                {t('aiProviders.oauth.cancel')}
                              </Button>
                            </div>
                          ) : (
                            <div className="space-y-5 w-full">
                              <div className="space-y-2">
                                <h3 className="font-semibold text-[16px] text-foreground">{t('aiProviders.oauth.approveLogin')}</h3>
                                <div className="text-[13px] text-muted-foreground text-left mt-2 space-y-1.5 bg-black/5 dark:bg-white/5 p-4 rounded-xl">
                                  <p>1. {t('aiProviders.oauth.step1')}</p>
                                  <p>2. {t('aiProviders.oauth.step2')}</p>
                                  <p>3. {t('aiProviders.oauth.step3')}</p>
                                </div>
                              </div>

                              <div className="flex items-center justify-center gap-3 p-4 bg-surface-input border border-black/5 dark:border-white/5 rounded-xl shadow-inner">
                                <code className="text-3xl font-mono tracking-[0.2em] font-bold text-foreground">
                                  {oauthData.userCode}
                                </code>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-10 w-10 rounded-full hover:bg-black/5 dark:hover:bg-white/10"
                                  onClick={() => {
                                    navigator.clipboard.writeText(oauthData.userCode);
                                    toast.success(t('aiProviders.oauth.codeCopied'));
                                  }}
                                >
                                  <Copy className="h-5 w-5" />
                                </Button>
                              </div>

                              <Button
                                variant="secondary"
                                className="w-full rounded-full h-[42px] font-semibold"
                                onClick={() => hostApi.shell.openExternal(oauthData.verificationUri)}
                              >
                                <ExternalLink className="h-4 w-4 mr-2" />
                                {t('aiProviders.oauth.openLoginPage')}
                              </Button>

                              <div className="flex items-center justify-center gap-2 text-[13px] font-medium text-muted-foreground pt-2">
                                <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                                <span>{t('aiProviders.oauth.waitingApproval')}</span>
                              </div>

                              <Button variant="ghost" className="w-full rounded-full h-[42px] font-semibold text-muted-foreground" onClick={handleCancelOAuth}>
                                {t('aiProviders.oauth.cancel')}
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <Separator className="bg-black/10 dark:bg-white/10" />

              <div className="flex justify-end gap-3">
                <Button
                  data-testid="add-provider-submit-button"
                  onClick={handleAdd}
                  className={cn("rounded-full px-8 h-[42px] text-[13px] font-semibold bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm", useOAuthFlow && "hidden")}
                  disabled={!selectedType || saving || (showModelIdField && modelIds.every(id => !id?.trim()))}
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  {t('aiProviders.dialog.add')}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
    </ModalPortal>
  );
}
