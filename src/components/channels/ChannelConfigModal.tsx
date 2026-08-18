import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  Loader2,
  QrCode,
  ExternalLink,
  BookOpen,
  Eye,
  EyeOff,
  Check,
  AlertCircle,
  CheckCircle,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useChannelsStore } from '@/stores/channels';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';

import { hostApi, hostApiFetch } from '@/lib/host-api';
import { subscribeHostEvent } from '@/lib/host-events';
import { cn } from '@/lib/utils';
import { ModalPortal } from '@/components/ui/modal-portal';
import {
  CHANNEL_ICONS,
  CHANNEL_NAMES,
  CHANNEL_META,
  getPrimaryChannels,
  type ChannelType,
  type ChannelMeta,
  type ChannelConfigField,
} from '@/types/channel';
import {
  buildQrChannelEventName,
  isCanonicalOpenClawAccountId,
  usesPluginManagedQrAccounts,
} from '@/lib/channel-alias';
import { toast } from '@/lib/toast';
import { useTranslation } from 'react-i18next';
import telegramIcon from '@/assets/channels/telegram.svg';
import discordIcon from '@/assets/channels/discord.svg';
import whatsappIcon from '@/assets/channels/whatsapp.svg';
import wechatIcon from '@/assets/channels/wechat.svg';
import dingtalkIcon from '@/assets/channels/dingtalk.svg';
import feishuIcon from '@/assets/channels/feishu.svg';
import wecomIcon from '@/assets/channels/wecom.svg';
import qqIcon from '@/assets/channels/qq.svg';

interface ChannelConfigModalProps {
  initialSelectedType?: ChannelType | null;
  configuredTypes?: string[];
  showChannelName?: boolean;
  allowExistingConfig?: boolean;
  allowEditAccountId?: boolean;
  existingAccountIds?: string[];
  initialConfigValues?: Record<string, string>;
  agentId?: string;
  accountId?: string;
  onClose: () => void;
  onChannelSaved?: (channelType: ChannelType) => void | Promise<void>;
}

// 暂时隐藏频道文档入口（各频道配置弹窗中的"查看文档"按钮），保留相关逻辑以便后续恢复
const SHOW_CHANNEL_DOCS_BUTTON = false;

const inputClasses = 'h-[44px] rounded-xl font-mono text-[13px] bg-transparent border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary shadow-sm transition-all text-foreground placeholder:text-foreground/40';
const labelClasses = 'text-[14px] text-foreground/80 font-bold';
const outlineButtonClasses = 'h-9 text-[13px] font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground';
const primaryButtonClasses = 'h-9 text-[13px] font-medium rounded-full px-4 shadow-none';

export function ChannelConfigModal({
  initialSelectedType = null,
  configuredTypes = [],
  showChannelName = true,
  allowExistingConfig = true,
  allowEditAccountId = false,
  existingAccountIds = [],
  initialConfigValues,
  agentId,
  accountId,
  onClose,
  onChannelSaved,
}: ChannelConfigModalProps) {
  const { t } = useTranslation(['channels', 'common']);
  const { channels, addChannel, fetchChannels } = useChannelsStore();
  const [selectedType, setSelectedType] = useState<ChannelType | null>(initialSelectedType);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [channelName, setChannelName] = useState('');
  const [accountIdInput, setAccountIdInput] = useState(accountId || '');
  const [accountIdError, setAccountIdError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [isExistingConfig, setIsExistingConfig] = useState(false);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const [validationResult, setValidationResult] = useState<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  } | null>(null);

  const [showAutoCreateFeishu, setShowAutoCreateFeishu] = useState(false);
  const [feishuCreateMode, setFeishuCreateMode] = useState<'create' | 'edit' | null>(null);
  const [feishuAppInfo, setFeishuAppInfo] = useState<{ appName: string; avatarUrl: string } | null>(null);
  const [autoCreateFeishuData, setAutoCreateFeishuData] = useState<{
    appName: string;
    iconBase64?: string;
    iconMimeType?: string;
  }>({
    appName: t('common:appName'),
  });
  const [isAutoCreatingFeishu, setIsAutoCreatingFeishu] = useState(false);
  const [isFetchingFeishuAppInfo, setIsFetchingFeishuAppInfo] = useState(false);

  const [showFeishuAppSelect, setShowFeishuAppSelect] = useState(false);
  const [feishuApps, setFeishuApps] = useState<{ appId: string; appName: string; avatarUrl: string; status: number }[]>([]);
  const [isLoadingFeishuApps, setIsLoadingFeishuApps] = useState(false);
  const [feishuAppsError, setFeishuAppsError] = useState<string | null>(null);
  const [needsFeishuConfig, setNeedsFeishuConfig] = useState(false);
  // Set when the user clicks "Get Secret" (opens the Feishu console). While true,
  // focusing the App Secret input auto-pastes a freshly-copied secret from the
  // OS clipboard so the user doesn't have to paste it manually after closing the window.
  const [awaitingSecretPaste, setAwaitingSecretPaste] = useState(false);

  const [candidateIcons, setCandidateIcons] = useState<{ name: string; mimeType: string; base64: string }[]>([]);
  const feishuIconInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showAutoCreateFeishu && candidateIcons.length === 0) {
      hostApi.channels.feishuCandidateIcons()
        .then((res) => {
          const result = res as { success?: boolean; candidates?: any[] };
          if (result.success && result.candidates) {
            setCandidateIcons(result.candidates);
          }
        })
        .catch(() => {});
    }
  }, [showAutoCreateFeishu, candidateIcons.length]);

  useEffect(() => {
    if (showFeishuAppSelect && feishuApps.length === 0) {
      setIsLoadingFeishuApps(true);
      setFeishuAppsError(null);
      hostApi.channels.feishuMyApps()
        .then((res) => {
          const result = res as { success?: boolean; apps?: any[]; error?: string };
          if (result.success && result.apps) {
            setFeishuApps(result.apps);
          } else {
            setFeishuAppsError(result.error || t('autoCreateFeishu.fetchAppsFailed'));
          }
        })
        .catch((err) => {
          setFeishuAppsError(String(err));
        })
        .finally(() => {
          setIsLoadingFeishuApps(false);
        });
    }
  }, [showFeishuAppSelect, feishuApps.length, t]);

  useEffect(() => {
    if (selectedType !== 'feishu') {
      setFeishuAppInfo(null);
      setIsFetchingFeishuAppInfo(false);
      return;
    }
    const appId = configValues.appId;
    const appSecret = configValues.appSecret;
    if (!appId || !appSecret || appId.length < 10 || appSecret.length < 10) {
      setFeishuAppInfo(null);
      setIsFetchingFeishuAppInfo(false);
      return;
    }

    setIsFetchingFeishuAppInfo(true);
    const timeout = setTimeout(async () => {
      try {
        const res = await hostApi.channels.feishuAppInfo({ appId, appSecret }) as { success?: boolean; appName?: string; avatarUrl?: string };
        if (res.success && res.appName) {
          setFeishuAppInfo({ appName: res.appName, avatarUrl: res.avatarUrl || '' });
          // If already editing, update the name to match fetched one
          setAutoCreateFeishuData(prev => ({ ...prev, appName: res.appName! }));
        } else {
          setFeishuAppInfo(null);
        }
      } catch {
        setFeishuAppInfo(null);
      } finally {
        setIsFetchingFeishuAppInfo(false);
      }
    }, 500);

    return () => {
      clearTimeout(timeout);
    };
  }, [selectedType, configValues.appId, configValues.appSecret]);

  const meta: ChannelMeta | null = selectedType ? CHANNEL_META[selectedType] : null;
  const shouldUseCredentialValidation = selectedType !== 'feishu';
  const usesManagedQrAccounts = usesPluginManagedQrAccounts(selectedType);
  const showAccountIdEditor = allowEditAccountId && !usesManagedQrAccounts;
  const resolvedAccountId = usesManagedQrAccounts
    ? (accountId ?? undefined)
    : showAccountIdEditor
      ? accountIdInput.trim()
      : (accountId ?? (agentId ? (agentId === 'main' ? 'default' : agentId) : undefined));
  const shouldLoadExistingConfig = Boolean(
    selectedType && allowExistingConfig && configuredTypes.includes(selectedType)
  );
  const accountIdForConfigLoad = shouldLoadExistingConfig ? resolvedAccountId : undefined;

  useEffect(() => {
    setSelectedType(initialSelectedType);
  }, [initialSelectedType]);

  useEffect(() => {
    setAccountIdInput(accountId || '');
    setAccountIdError(null);
  }, [accountId]);

  useEffect(() => {
    if (!selectedType) {
      setConfigValues({});
      setChannelName('');
      setIsExistingConfig(false);
      setValidationResult(null);
      setQrCode(null);
      setConnecting(false);
      setAccountIdError(null);
      return;
    }

    if (!shouldLoadExistingConfig) {
      setConfigValues({});
      setIsExistingConfig(false);
      setLoadingConfig(false);
      setChannelName(showChannelName ? CHANNEL_NAMES[selectedType] : '');
      return;
    }

    if (initialConfigValues) {
      setConfigValues(initialConfigValues);
      setIsExistingConfig(Object.keys(initialConfigValues).length > 0);
      setLoadingConfig(false);
      setChannelName(showChannelName ? CHANNEL_NAMES[selectedType] : '');
      return;
    }

    let cancelled = false;
    setLoadingConfig(true);
    setChannelName(showChannelName ? CHANNEL_NAMES[selectedType] : '');

    (async () => {
      try {
        const accountParam = accountIdForConfigLoad ? `?accountId=${encodeURIComponent(accountIdForConfigLoad)}` : '';
        const result = await hostApiFetch<{ success: boolean; values?: Record<string, string> }>(
          `/api/channels/config/${encodeURIComponent(selectedType)}${accountParam}`
        );
        if (cancelled) return;

        if (result.success && result.values && Object.keys(result.values).length > 0) {
          setConfigValues(result.values);
          setIsExistingConfig(true);
        } else {
          setConfigValues({});
          setIsExistingConfig(false);
        }
      } catch {
        if (!cancelled) {
          setConfigValues({});
          setIsExistingConfig(false);
        }
      } finally {
        if (!cancelled) setLoadingConfig(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accountIdForConfigLoad, initialConfigValues, selectedType, shouldLoadExistingConfig, showChannelName]);

  useEffect(() => {
    if (selectedType && !loadingConfig && showChannelName && firstInputRef.current) {
      firstInputRef.current.focus();
    }
  }, [selectedType, loadingConfig, showChannelName]);

  const finishSave = useCallback(async (channelType: ChannelType) => {
    const displayName = showChannelName && channelName.trim()
      ? channelName.trim()
      : CHANNEL_NAMES[channelType];
    const existingChannel = channels.find((channel) => channel.type === channelType);

    if (!existingChannel) {
      await addChannel({
        type: channelType,
        name: displayName,
        token: meta?.configFields[0]?.key ? configValues[meta.configFields[0].key] : undefined,
      });
    } else {
      await fetchChannels();
    }

    await onChannelSaved?.(channelType);
  }, [addChannel, channelName, channels, configValues, fetchChannels, meta?.configFields, onChannelSaved, showChannelName]);

  const finishSaveRef = useRef(finishSave);
  const onCloseRef = useRef(onClose);
  const translateRef = useRef(t);

  useEffect(() => {
    finishSaveRef.current = finishSave;
  }, [finishSave]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    translateRef.current = t;
  }, [t]);

  function normalizeQrImageSource(data: { qr?: string; raw?: string }): string | null {
    const qr = typeof data.qr === 'string' ? data.qr.trim() : '';
    if (qr) {
      if (qr.startsWith('data:image') || qr.startsWith('http://') || qr.startsWith('https://')) {
        return qr;
      }
      return `data:image/png;base64,${qr}`;
    }

    const raw = typeof data.raw === 'string' ? data.raw.trim() : '';
    if (!raw) return null;
    if (raw.startsWith('data:image') || raw.startsWith('http://') || raw.startsWith('https://')) {
      return raw;
    }
    return null;
  }

  useEffect(() => {
    if (!selectedType || meta?.connectionType !== 'qr') return;
    const channelType = selectedType;

    const onQr = (...args: unknown[]) => {
      const data = args[0] as { qr?: string; raw?: string };
      const nextQr = normalizeQrImageSource(data);
      if (!nextQr) return;
      setQrCode(nextQr);
      setConnecting(false);
    };

    const onSuccess = async (...args: unknown[]) => {
      const data = args[0] as { accountId?: string } | undefined;
      void data?.accountId;
      toast.success(translateRef.current('toast.qrConnected', { name: CHANNEL_NAMES[channelType] }));
      try {
        if (channelType === 'whatsapp') {
          const saveResult = await hostApiFetch<{ success?: boolean; error?: string }>('/api/channels/config', {
            method: 'POST',
            body: JSON.stringify({ channelType: 'whatsapp', config: { enabled: true }, accountId: resolvedAccountId }),
          });
          if (!saveResult?.success) {
            throw new Error(saveResult?.error || 'Failed to save WhatsApp config');
          }
        }

        try {
          await finishSaveRef.current(channelType);
        } catch (postSaveError) {
          toast.warning(translateRef.current('toast.savedButRefreshFailed'));
          console.warn('Channel saved but post-save refresh failed:', postSaveError);
        }
        onCloseRef.current();
      } catch (error) {
        toast.error(translateRef.current('toast.configFailed', { error: String(error) }));
        setConnecting(false);
      }
    };

    const onError = (...args: unknown[]) => {
      const err = typeof args[0] === 'string'
        ? args[0]
        : String((args[0] as { message?: string } | undefined)?.message || args[0]);
      toast.error(translateRef.current('toast.qrFailed', { name: CHANNEL_NAMES[channelType], error: err }));
      setQrCode(null);
      setConnecting(false);
    };

    const removeQrListener = subscribeHostEvent(buildQrChannelEventName(channelType, 'qr'), onQr);
    const removeSuccessListener = subscribeHostEvent(buildQrChannelEventName(channelType, 'success'), onSuccess);
    const removeErrorListener = subscribeHostEvent(buildQrChannelEventName(channelType, 'error'), onError);

    return () => {
      removeQrListener();
      removeSuccessListener();
      removeErrorListener();
      hostApiFetch(`/api/channels/${encodeURIComponent(channelType)}/cancel`, {
        method: 'POST',
        body: JSON.stringify(resolvedAccountId ? { accountId: resolvedAccountId } : {}),
      }).catch(() => { });
    };
  }, [meta?.connectionType, resolvedAccountId, selectedType]);

  const handleAutoCreateFeishu = async () => {
    if (!autoCreateFeishuData.appName) {
      toast.error(t('autoCreateFeishu.missingRequired'));
      return;
    }

    setIsAutoCreatingFeishu(true);
    try {
      if (feishuCreateMode === 'edit') {
        const result = await hostApi.channels.feishuUpdateApp({
          appId: configValues.appId,
          appSecret: configValues.appSecret,
          appName: autoCreateFeishuData.appName,
          iconBase64: autoCreateFeishuData.iconBase64,
          iconMimeType: autoCreateFeishuData.iconMimeType,
        }) as {
          success: boolean;
          error?: string;
          recovered?: boolean;
          larkCliReady?: boolean;
        };

        if (!result.success) {
          // On failure the backend already restored name/avatar to the pre-edit state.
          // Surface the underlying Feishu error detail so failures are diagnosable
          // instead of hidden behind the generic "restored" message.
          console.error('[feishu] updateApp failed:', result);
          const detail = result.error ? `（${result.error}）` : '';
          toast.error(
            result.recovered
              ? `${t('autoCreateFeishu.updateFailedRestored')}${detail}`
              : (result.error || t('autoCreateFeishu.updateFailed'))
          );
          return;
        }

        toast.success(t('autoCreateFeishu.updateSuccess'));
        setFeishuAppInfo(prev => prev ? { ...prev, appName: autoCreateFeishuData.appName } : null);
        setShowAutoCreateFeishu(false);
        setFeishuCreateMode(null);
        setNeedsFeishuConfig(false);
      } else {
        const result = await hostApi.channels.feishuAutoCreate(autoCreateFeishuData) as {
          success: boolean;
          app_id?: string;
          app_secret?: string;
          error?: string;
          disabledAppId?: string;
          manageUrl?: string;
          larkCliReady?: boolean;
        };

        if (!result.success) {
          if (result.manageUrl) {
            // The app was created then disabled for cleanup; point the user to the console.
            const manageUrl = result.manageUrl;
            toast.error(t('autoCreateFeishu.createFailedDisabled'), {
              duration: 10000,
              action: {
                label: t('autoCreateFeishu.openConsole'),
                onClick: () => openExternalUrl(manageUrl),
              },
            });
          } else {
            toast.error(result.error || t('autoCreateFeishu.createFailed'));
          }
          return;
        }

        toast.success(t('autoCreateFeishu.success'));

        if (result.app_id && result.app_secret) {
          setConfigValues((prev) => ({
            ...prev,
            appId: result.app_id!,
            appSecret: result.app_secret!,
          }));
        }

        setShowAutoCreateFeishu(false);
        setFeishuCreateMode(null);
        setNeedsFeishuConfig(false);
      }
    } catch (error) {
      toast.appError(error);
    } finally {
      setIsAutoCreatingFeishu(false);
    }
  };

  const handleValidate = async () => {
    if (!selectedType || !shouldUseCredentialValidation) return;

    setValidating(true);
    setValidationResult(null);

    try {
      const result = await hostApiFetch<{
        success: boolean;
        valid?: boolean;
        errors?: string[];
        warnings?: string[];
        details?: Record<string, string>;
      }>('/api/channels/credentials/validate', {
        method: 'POST',
        body: JSON.stringify({ channelType: selectedType, config: configValues }),
      });

      const warnings = result.warnings || [];
      if (result.valid && result.details) {
        const details = result.details;
        if (details.botUsername) warnings.push(`Bot: @${details.botUsername}`);
        if (details.guildName) warnings.push(`Server: ${details.guildName}`);
        if (details.channelName) warnings.push(`Channel: #${details.channelName}`);
      }

      setValidationResult({
        valid: result.valid || false,
        errors: result.errors || [],
        warnings,
      });
    } catch (error) {
      setValidationResult({
        valid: false,
        errors: [String(error)],
        warnings: [],
      });
    } finally {
      setValidating(false);
    }
  };

  const handleConnect = async () => {
    if (!selectedType || !meta) return;

    setConnecting(true);
    setValidationResult(null);

    try {
      if (showAccountIdEditor) {
        const nextAccountId = accountIdInput.trim();
        if (!nextAccountId) {
          const message = t('account.invalidId');
          setAccountIdError(message);
          toast.error(message);
          setConnecting(false);
          return;
        }
        if (!isCanonicalOpenClawAccountId(nextAccountId)) {
          const message = t('account.invalidCanonicalId');
          setAccountIdError(message);
          toast.error(message);
          setConnecting(false);
          return;
        }
        const duplicateExists = existingAccountIds.some((id) => id === nextAccountId && id !== (accountId || '').trim());
        if (duplicateExists) {
          const message = t('account.accountIdExists', { accountId: nextAccountId });
          setAccountIdError(message);
          toast.error(message);
          setConnecting(false);
          return;
        }
        setAccountIdError(null);
      }

      if (meta.connectionType === 'qr') {
        await hostApiFetch(`/api/channels/${encodeURIComponent(selectedType)}/start`, {
          method: 'POST',
          body: JSON.stringify(resolvedAccountId ? { accountId: resolvedAccountId } : {}),
        });
        return;
      }

      if (meta.connectionType === 'token' && shouldUseCredentialValidation) {
        const validationResponse = await hostApiFetch<{
          success: boolean;
          valid?: boolean;
          errors?: string[];
          warnings?: string[];
          details?: Record<string, string>;
        }>('/api/channels/credentials/validate', {
          method: 'POST',
          body: JSON.stringify({ channelType: selectedType, config: configValues }),
        });

        if (!validationResponse.valid) {
          setValidationResult({
            valid: false,
            errors: validationResponse.errors || ['Validation failed'],
            warnings: validationResponse.warnings || [],
          });
          setConnecting(false);
          return;
        }

        const warnings = validationResponse.warnings || [];
        if (validationResponse.details) {
          const details = validationResponse.details;
          if (details.botUsername) warnings.push(`Bot: @${details.botUsername}`);
          if (details.guildName) warnings.push(`Server: ${details.guildName}`);
          if (details.channelName) warnings.push(`Channel: #${details.channelName}`);
        }

        setValidationResult({
          valid: true,
          errors: [],
          warnings,
        });
      }

      const config: Record<string, unknown> = { ...configValues };
      const saveResult = await hostApiFetch<{
        success?: boolean;
        error?: string;
        warning?: string;
      }>('/api/channels/config', {
        method: 'POST',
        body: JSON.stringify({ channelType: selectedType, config, accountId: resolvedAccountId }),
      });
      if (!saveResult?.success) {
        throw new Error(saveResult?.error || 'Failed to save channel config');
      }
      if (typeof saveResult.warning === 'string' && saveResult.warning) {
        toast.warning(saveResult.warning);
      }

      try {
        await finishSave(selectedType);
      } catch (postSaveError) {
        toast.warning(t('toast.savedButRefreshFailed'));
        console.warn('Channel saved but post-save refresh failed:', postSaveError);
      }

      toast.success(t('toast.channelSaved', { name: meta.name }));
      toast.success(t('toast.channelConnecting', { name: meta.name }));
      onClose();
    } catch (error) {
      toast.error(t('toast.configFailed', { error: String(error) }));
      setConnecting(false);
    }
  };

  const openExternalUrl = (url: string) => {
    try {
      if (window.electron?.openExternal) {
        window.electron.openExternal(url);
      } else {
        window.open(url, '_blank');
      }
    } catch {
      window.open(url, '_blank');
    }
  };

  const openDocs = () => {
    if (!meta?.docsUrl) return;
    const url = t(meta.docsUrl);
    try {
      if (window.electron?.openExternal) {
        window.electron.openExternal(url);
      } else {
        window.open(url, '_blank');
      }
    } catch {
      window.open(url, '_blank');
    }
  };

  const isFormValid = () => {
    if (!meta) return false;
    return meta.configFields
      .filter((field) => field.required)
      .every((field) => configValues[field.key]?.trim());
  };

  const updateConfigValue = (key: string, value: string) => {
    setConfigValues((prev) => ({ ...prev, [key]: value }));
    if (selectedType === 'feishu' && key === 'appId') {
      setNeedsFeishuConfig(false);
    }
  };

  const toggleSecretVisibility = (key: string) => {
    setShowSecrets((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <ModalPortal>
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <Card
        className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-3xl border-0 shadow-2xl bg-background overflow-hidden"
      >
        <CardHeader className="flex flex-row items-start justify-between pb-2 shrink-0">
          <div>
            <CardTitle className="text-2xl font-serif font-normal tracking-tight">
              {selectedType
                ? isExistingConfig
                  ? t('dialog.updateTitle', { name: CHANNEL_NAMES[selectedType] })
                  : t('dialog.configureTitle', { name: CHANNEL_NAMES[selectedType] })
                : t('dialog.addTitle')}
            </CardTitle>
            <CardDescription className="text-[15px] mt-1 text-foreground/70">
              {selectedType && isExistingConfig
                ? t('dialog.existingDesc')
                : meta ? t(meta.description.replace('channels:', '')) : t('dialog.selectDesc')}
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            data-testid="channel-config-close"
            className="rounded-full h-8 w-8 -mr-2 -mt-2 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5"
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-6 pt-4 overflow-y-auto flex-1 p-6">
          {!selectedType ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {getPrimaryChannels().map((type) => {
                const channelMeta = CHANNEL_META[type];
                const isConfigured = configuredTypes.includes(type);
                return (
                  <button
                    key={type}
                    onClick={() => setSelectedType(type)}
                    className={cn(
                      'group flex items-start gap-4 p-4 rounded-2xl transition-all text-left border relative overflow-hidden bg-surface-input shadow-sm',
                      isConfigured
                        ? 'border-green-500/40 bg-green-500/5 dark:bg-green-500/10'
                        : 'border-black/5 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5'
                    )}
                  >
                    <div className="h-[46px] w-[46px] shrink-0 flex items-center justify-center text-foreground bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-full shadow-sm">
                      <ChannelLogo type={type} />
                    </div>
                    <div className="flex flex-col flex-1 min-w-0 py-0.5 mt-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-[16px] font-semibold text-foreground truncate">{channelMeta.name}</p>
                        {channelMeta.isPlugin && (
                          <Badge
                            variant="secondary"
                            className="font-mono text-[10px] font-medium px-2 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.08] border-0 shadow-none text-foreground/70"
                          >
                            {t('pluginBadge')}
                          </Badge>
                        )}
                      </div>
                      <p className="text-[13.5px] text-muted-foreground line-clamp-2 leading-[1.5]">
                        {t(channelMeta.description.replace('channels:', ''))}
                      </p>
                      <p className="text-[12px] font-medium text-muted-foreground/80 mt-2">
                        {channelMeta.connectionType === 'qr' ? t('dialog.qrCode') : t('dialog.token')}
                      </p>
                    </div>
                    {isConfigured && (
                      <Badge className="absolute top-3 right-3 text-[10px] font-medium rounded-full bg-green-600 hover:bg-green-600">
                        {t('configuredBadge')}
                      </Badge>
                    )}
                  </button>
                );
              })}
            </div>
          ) : qrCode ? (
            <div className="text-center space-y-6">
              <div className="bg-surface-input p-4 rounded-3xl inline-block shadow-sm border border-black/10 dark:border-white/10">
                {qrCode.startsWith('data:image') || qrCode.startsWith('http://') || qrCode.startsWith('https://') ? (
                  <img src={qrCode} alt="Scan QR Code" className="w-64 h-64 object-contain rounded-2xl" />
                ) : (
                  <div className="w-64 h-64 bg-surface-modal rounded-2xl flex items-center justify-center">
                    <QrCode className="h-32 w-32 text-muted-foreground" />
                  </div>
                )}
              </div>
              <p className="text-[14px] text-muted-foreground">
                {t('dialog.scanQR', { name: meta?.name })}
              </p>
              <div className="flex justify-center gap-2">
                <Button
                  variant="outline"
                  className={outlineButtonClasses}
                  onClick={() => {
                    setQrCode(null);
                    void handleConnect();
                  }}
                >
                  {t('dialog.refreshCode')}
                </Button>
              </div>
            </div>
          ) : loadingConfig ? (
            <div className="flex items-center justify-center py-10 rounded-2xl bg-surface-input border border-black/10 dark:border-white/10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-[14px] text-muted-foreground">{t('dialog.loadingConfig')}</span>
            </div>
          ) : (
            <div className="space-y-6">
              {isExistingConfig && (
                <div className="bg-blue-500/10 text-blue-600 dark:text-blue-400 p-4 rounded-2xl text-[13.5px] flex items-center gap-2 border border-blue-500/20">
                  <CheckCircle className="h-4 w-4 shrink-0" />
                  <span>{t('dialog.existingHint')}</span>
                </div>
              )}

              <div className="bg-surface-input p-4 rounded-2xl space-y-4 shadow-sm border border-black/10 dark:border-white/10">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className={labelClasses}>{t('dialog.howToConnect')}</p>
                    <p className="text-[13px] text-muted-foreground mt-1">
                      {meta ? t(meta.description.replace('channels:', '')) : ''}
                    </p>
                  </div>
                  {SHOW_CHANNEL_DOCS_BUTTON && (
                    <Button
                      variant="outline"
                      className={cn(outlineButtonClasses, 'h-8 px-3 shrink-0')}
                      onClick={openDocs}
                    >
                      <BookOpen className="h-3 w-3 mr-1" />
                      {t('dialog.viewDocs')}
                      <ExternalLink className="h-3 w-3 ml-1" />
                    </Button>
                  )}
                </div>
                <ol className="list-decimal pl-5 text-[13px] text-muted-foreground leading-relaxed space-y-1.5">
                  {meta?.instructions.map((instruction, index) => (
                    <li key={index}>{t(instruction)}</li>
                  ))}
                </ol>
              </div>

              {showChannelName && (
                <div className="space-y-2.5">
                  <Label htmlFor="name" className={labelClasses}>{t('dialog.channelName')}</Label>
                  <Input
                    ref={firstInputRef}
                    id="name"
                    placeholder={t('dialog.channelNamePlaceholder', { name: meta?.name })}
                    value={channelName}
                    onChange={(event) => setChannelName(event.target.value)}
                    className={inputClasses}
                  />
                </div>
              )}

              {showAccountIdEditor && (
                <div className="space-y-2.5">
                  <Label htmlFor="account-id" className={labelClasses}>{t('account.customIdLabel')}</Label>
                  <Input
                    id="account-id"
                    value={accountIdInput}
                    onChange={(event) => {
                      let val = event.target.value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
                      setAccountIdInput(val);
                      if (accountIdError) {
                        setAccountIdError(null);
                      }
                    }}
                    placeholder={t('account.customIdPlaceholder')}
                    className={cn(inputClasses, accountIdError && 'border-destructive/50 focus-visible:ring-destructive/30')}
                  />
                  {accountIdError ? (
                    <p className="text-[12px] text-destructive">{accountIdError}</p>
                  ) : (
                    <p className="text-[12px] text-muted-foreground">{t('account.customIdHint')}</p>
                  )}
                </div>
              )}

              <div className="space-y-4">
                {meta?.configFields.map((field) => (
                  <ConfigField
                    key={field.key}
                    field={field}
                    value={configValues[field.key] || ''}
                    onChange={(value) => updateConfigValue(field.key, value)}
                    showSecret={showSecrets[field.key] || false}
                    onToggleSecret={() => toggleSecretVisibility(field.key)}
                    onFocus={
                      field.key === 'appSecret' && selectedType === 'feishu'
                        ? async () => {
                            // Only auto-paste right after the user opened the Feishu
                            // console via "Get Secret" — never read the clipboard blindly.
                            if (!awaitingSecretPaste) return;
                            try {
                              const text = (await hostApi.shell.readClipboardText())?.trim() ?? '';
                              // Feishu App Secrets are short alphanumeric tokens; skip
                              // anything that doesn't look like one to avoid mis-pasting.
                              if (/^[A-Za-z0-9_-]{16,64}$/.test(text)) {
                                updateConfigValue('appSecret', text);
                                setAwaitingSecretPaste(false);
                                toast.success(t('autoCreateFeishu.autoSecretPasted'));
                              }
                            } catch {
                              /* clipboard read is best-effort */
                            }
                          }
                        : undefined
                    }
                    actionNode={
                      field.key === 'appId' &&
                      selectedType === 'feishu' ? (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setShowFeishuAppSelect(true)}
                          className={cn(outlineButtonClasses, "h-[44px] shrink-0")}
                        >
                          {t('autoCreateFeishu.selectExisting')}
                        </Button>
                      ) : field.key === 'appSecret' &&
                        selectedType === 'feishu' &&
                        configValues['appId'] ? (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              const url = `https://open.feishu.cn/app/${configValues['appId']}/baseinfo?lang=zh_cn`;
                              void hostApi.shell.openAuthWindow(url, t('autoCreateFeishu.getSecret'), 'feishu-credentials');
                              setAwaitingSecretPaste(true);
                              toast.info(t('autoCreateFeishu.copySecretPrompt'));
                            }}
                            className={cn(outlineButtonClasses, "h-[44px] shrink-0")}
                          >
                            {t('autoCreateFeishu.getSecret')}
                          </Button>
                      ) : undefined
                    }
                  />
                ))}
              </div>

              {validationResult && (
                <div
                  className={cn(
                    'p-4 rounded-2xl text-sm border',
                    validationResult.valid
                      ? 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20'
                      : 'bg-destructive/10 text-destructive border-destructive/20'
                  )}
                >
                  <div className="flex items-start gap-2">
                    {validationResult.valid ? (
                      <CheckCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    ) : (
                      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <h4 className="font-medium mb-1">
                        {validationResult.valid ? t('dialog.credentialsVerified') : t('dialog.validationFailed')}
                      </h4>
                      {validationResult.errors.length > 0 && (
                        <ul className="list-disc list-inside space-y-0.5">
                          {validationResult.errors.map((err, index) => (
                            <li key={index}>{err}</li>
                          ))}
                        </ul>
                      )}
                      {validationResult.valid && validationResult.warnings.length > 0 && (
                        <div className="mt-1 text-green-600 dark:text-green-400 space-y-0.5">
                          {validationResult.warnings.map((info, index) => (
                            <p key={index} className="text-xs">{info}</p>
                          ))}
                        </div>
                      )}
                      {!validationResult.valid && validationResult.warnings.length > 0 && (
                        <div className="mt-2 text-yellow-600 dark:text-yellow-500">
                          <p className="font-medium text-xs uppercase mb-1">{t('dialog.warnings')}</p>
                          <ul className="list-disc list-inside space-y-0.5">
                            {validationResult.warnings.map((warn, index) => (
                              <li key={index}>{warn}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <Separator className="bg-black/10 dark:bg-white/10" />

              {showAutoCreateFeishu && (
                <div className="p-4 rounded-2xl bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30 space-y-4">
                  <h4 className="text-[14px] font-bold text-foreground/80 flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-blue-500" />
                    {feishuCreateMode === 'edit' ? t('autoCreateFeishu.editTitle') : t('autoCreateFeishu.title')}
                  </h4>
                  <div className="space-y-3">
                    <div>
                      <Label className={labelClasses}>{t('autoCreateFeishu.appName')}</Label>
                      <Input
                        value={autoCreateFeishuData.appName}
                        onChange={(e) => setAutoCreateFeishuData({ ...autoCreateFeishuData, appName: e.target.value })}
                        placeholder={t('common:appName')}
                        className={cn(inputClasses, "mt-1")}
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label className={labelClasses}>{t('autoCreateFeishu.iconLabel')}</Label>
                      <div className="flex gap-4 items-start mt-1">
                        <div
                          className="w-20 h-20 shrink-0 rounded-2xl border-2 border-dashed border-black/20 dark:border-white/20 flex items-center justify-center cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors overflow-hidden relative"
                          onClick={() => feishuIconInputRef.current?.click()}
                        >
                          {autoCreateFeishuData.iconBase64 ? (
                            <img src={`data:${autoCreateFeishuData.iconMimeType};base64,${autoCreateFeishuData.iconBase64}`} alt="App Icon" className="w-full h-full object-cover" />
                          ) : feishuCreateMode === 'edit' && feishuAppInfo?.avatarUrl ? (
                            <img src={feishuAppInfo.avatarUrl} alt="App Icon" className="w-full h-full object-cover" />
                          ) : (
                            <div className="text-black/30 dark:text-white/30 flex flex-col items-center justify-center">
                              <span className="text-2xl font-light leading-none">+</span>
                            </div>
                          )}
                          <input
                            ref={feishuIconInputRef}
                            type="file"
                            accept="image/jpeg,image/png,image/svg+xml,image/bmp"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (!file) {
                                setAutoCreateFeishuData({ ...autoCreateFeishuData, iconBase64: undefined, iconMimeType: undefined });
                                return;
                              }
                              if (file.size > 2 * 1024 * 1024) {
                                toast.error(t('autoCreateFeishu.iconTooLarge'));
                                e.target.value = '';
                                return;
                              }
                              const reader = new FileReader();
                              reader.onload = (event) => {
                                const result = event.target?.result;
                                if (typeof result === 'string') {
                                  const base64Data = result.split(',')[1];
                                  setAutoCreateFeishuData({
                                    ...autoCreateFeishuData,
                                    iconBase64: base64Data,
                                    iconMimeType: file.type,
                                  });
                                }
                              };
                              reader.readAsDataURL(file);
                            }}
                          />
                        </div>
                        
                        {candidateIcons.length > 0 && (
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] text-muted-foreground font-medium mb-1.5">{t('autoCreateFeishu.candidateIcons')}</p>
                            <div className="flex flex-wrap gap-2">
                              {candidateIcons.map((icon, idx) => (
                                <button
                                  key={idx}
                                  title={icon.name}
                                  onClick={() => setAutoCreateFeishuData({ ...autoCreateFeishuData, iconBase64: icon.base64, iconMimeType: icon.mimeType })}
                                  className="w-10 h-10 rounded-xl overflow-hidden border border-black/10 dark:border-white/10 hover:ring-2 hover:ring-primary/50 transition-all shrink-0 bg-white dark:bg-background"
                                >
                                  <img src={`data:${icon.mimeType};base64,${icon.base64}`} alt={icon.name} className="w-full h-full object-cover" />
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{t('autoCreateFeishu.iconRequirement')}</p>
                    </div>
                    <Button
                      onClick={handleAutoCreateFeishu}
                      disabled={isAutoCreatingFeishu}
                      className={cn(primaryButtonClasses, "w-full mt-2 bg-primary hover:bg-primary/90 text-primary-foreground")}
                    >
                      {isAutoCreatingFeishu ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          {feishuCreateMode === 'edit' ? t('common:actions.saving') : t('autoCreateFeishu.creating')}
                        </>
                      ) : (
                        <>
                          <Check className="h-4 w-4 mr-2" />
                          {feishuCreateMode === 'edit' ? t('common:actions.save') : t('autoCreateFeishu.confirm')}
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:justify-between items-center gap-3 pt-2">
                {selectedType === 'feishu' ? (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setFeishuCreateMode('create');
                        setShowAutoCreateFeishu(true);
                      }}
                      disabled={isFetchingFeishuAppInfo}
                      className={cn(outlineButtonClasses, "min-w-[120px]")}
                    >
                      <Sparkles className="h-4 w-4 mr-2 text-blue-500" />
                      {t('autoCreateFeishu.button')}
                    </Button>
                    {feishuAppInfo && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          setFeishuCreateMode('edit');
                          setAutoCreateFeishuData({
                            appName: feishuAppInfo.appName,
                            iconBase64: undefined,
                            iconMimeType: undefined,
                          });
                          setShowAutoCreateFeishu(true);
                        }}
                        disabled={isFetchingFeishuAppInfo}
                        className={cn(outlineButtonClasses, "min-w-[120px]")}
                      >
                        <BookOpen className="h-4 w-4 mr-2" />
                        {t('autoCreateFeishu.editButton')}
                      </Button>
                    )}
                  </div>
                ) : (
                  <div />
                )}
                <div className="flex flex-col sm:flex-row gap-2">
                  {meta?.connectionType === 'token' && shouldUseCredentialValidation && (
                    <Button
                      variant="outline"
                      onClick={handleValidate}
                      disabled={validating}
                      className={outlineButtonClasses}
                    >
                      {validating ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          {t('dialog.validating')}
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="h-4 w-4 mr-2" />
                          {t('dialog.validateConfig')}
                        </>
                      )}
                    </Button>
                  )}
                  <Button
                    onClick={() => {
                      void handleConnect();
                    }}
                    disabled={connecting || !isFormValid() || (showAccountIdEditor && !accountIdInput.trim()) || (selectedType === 'feishu' && needsFeishuConfig && feishuCreateMode !== 'edit')}
                    className={primaryButtonClasses}
                  >
                    {selectedType === 'feishu' && needsFeishuConfig && feishuCreateMode !== 'edit' ? (
                      t('autoCreateFeishu.needsConfig')
                    ) : connecting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        {meta?.connectionType === 'qr' ? t('dialog.generatingQR') : t('dialog.validatingAndSaving')}
                      </>
                    ) : meta?.connectionType === 'qr' ? (
                      t('dialog.generateQRCode')
                    ) : (
                      <>
                        <Check className="h-4 w-4 mr-2" />
                        {isExistingConfig ? t('dialog.updateAndReconnect') : t('dialog.saveAndConnect')}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {showFeishuAppSelect && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
          <Card className="w-full max-w-lg max-h-[80vh] flex flex-col rounded-3xl border-0 shadow-2xl bg-background overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between pb-2 shrink-0">
              <CardTitle className="text-xl font-serif font-normal">{t('autoCreateFeishu.selectExistingTitle')}</CardTitle>
              <Button variant="ghost" size="icon" onClick={() => setShowFeishuAppSelect(false)} className="rounded-full h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5">
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto p-6 pt-2 space-y-4">
              {isLoadingFeishuApps ? (
                <div className="flex flex-col items-center justify-center py-10 space-y-3">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">{t('autoCreateFeishu.loadingApps')}</p>
                </div>
              ) : feishuAppsError ? (
                <div className="bg-destructive/10 text-destructive p-4 rounded-2xl border border-destructive/20 text-sm">
                  <p>{t('autoCreateFeishu.fetchAppsFailed')}</p>
                  <p className="text-xs opacity-80 mt-1">{feishuAppsError}</p>
                </div>
              ) : feishuApps.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">
                  <p className="text-sm">{t('autoCreateFeishu.noAppsFound')}</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2">
                  {feishuApps.map(app => (
                    <div key={app.appId} className="flex items-center gap-2">
                      <button
                        className="flex items-center gap-3 p-3 rounded-2xl text-left border border-black/5 dark:border-white/10 bg-surface-input hover:bg-black/5 dark:hover:bg-white/5 transition-all flex-1"
                        onClick={() => {
                          updateConfigValue('appId', app.appId);
                          updateConfigValue('appSecret', '');
                          setNeedsFeishuConfig(true);
                          setShowFeishuAppSelect(false);
                          toast.success(t('autoCreateFeishu.appSelected'));
                        }}
                      >
                        <img src={app.avatarUrl || feishuIcon} alt={app.appName} className="w-10 h-10 rounded-xl bg-white dark:bg-background border border-black/10 dark:border-white/10" />
                        <div className="flex flex-col flex-1 min-w-0">
                          <span className="font-semibold text-[14px] text-foreground truncate">{app.appName}</span>
                          <span className="text-[12px] text-muted-foreground mt-0.5">App ID: <span className="font-mono">{app.appId}</span></span>
                        </div>
                        <div>
                          {app.status === 1 ? (
                            <Badge className="bg-green-500/10 text-green-700 dark:text-green-400 border-0">{t('autoCreateFeishu.statusEnabled')}</Badge>
                          ) : app.status === 0 ? (
                            <Badge variant="secondary" className="border-0 opacity-70">{t('autoCreateFeishu.statusDisabled')}</Badge>
                          ) : (
                            <Badge variant="secondary" className="border-0 opacity-70">{t('autoCreateFeishu.statusUnpublished')}</Badge>
                          )}
                        </div>
                      </button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0 h-12 w-12 rounded-2xl"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (confirm(t('autoCreateFeishu.confirmDelete', { appName: app.appName }))) {
                            try {
                              const res = await hostApi.channels.feishuDeleteApp({ appId: app.appId }) as { success: boolean; url?: string; error?: string };
                              if (res.success && res.url) {
                                toast.success(t('autoCreateFeishu.deleteSuccess'));
                                setFeishuApps(prev => prev.filter(a => a.appId !== app.appId));
                                if (res.url) {
                                  void hostApi.shell.openAuthWindow(res.url, t('autoCreateFeishu.deleteApp'), 'feishu-delete');
                                }
                              } else {
                                throw new Error(res.error || 'Failed to delete app');
                              }
                            } catch (err) {
                              toast.appError(err);
                            }
                          }
                        }}
                        title={t('autoCreateFeishu.deleteApp')}
                      >
                        <Trash2 className="h-5 w-5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
    </ModalPortal>
  );
}

interface ConfigFieldProps {
  field: ChannelConfigField;
  value: string;
  onChange: (value: string) => void;
  showSecret: boolean;
  onToggleSecret: () => void;
  actionNode?: React.ReactNode;
  onFocus?: () => void;
}

function ChannelLogo({ type }: { type: ChannelType }) {
  switch (type) {
    case 'telegram':
      return <img src={telegramIcon} alt="Telegram" className="w-[22px] h-[22px] dark:invert" />;
    case 'discord':
      return <img src={discordIcon} alt="Discord" className="w-[22px] h-[22px] dark:invert" />;
    case 'whatsapp':
      return <img src={whatsappIcon} alt="WhatsApp" className="w-[22px] h-[22px] dark:invert" />;
    case 'wechat':
      return <img src={wechatIcon} alt="WeChat" className="w-[22px] h-[22px] dark:invert" />;
    case 'dingtalk':
      return <img src={dingtalkIcon} alt="DingTalk" className="w-[22px] h-[22px] dark:invert" />;
    case 'feishu':
      return <img src={feishuIcon} alt="Feishu" className="w-[22px] h-[22px] dark:invert" />;
    case 'wecom':
      return <img src={wecomIcon} alt="WeCom" className="w-[22px] h-[22px] dark:invert" />;
    case 'qqbot':
      return <img src={qqIcon} alt="QQ" className="w-[22px] h-[22px] dark:invert" />;
    default:
      return <span className="text-[22px]">{CHANNEL_ICONS[type] || '💬'}</span>;
  }
}

function ConfigField({ field, value, onChange, showSecret, onToggleSecret, actionNode, onFocus }: ConfigFieldProps) {
  const { t } = useTranslation('channels');
  const isPassword = field.type === 'password';

  return (
    <div className="space-y-2.5">
      <Label htmlFor={field.key} className={labelClasses}>
        {t(field.label)}
        {field.required && <span className="text-destructive ml-1">*</span>}
      </Label>
      <div className="flex gap-2">
        <Input
          id={field.key}
          type={isPassword && !showSecret ? 'password' : 'text'}
          placeholder={field.placeholder ? t(field.placeholder) : undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={onFocus}
          className={inputClasses}
        />
        {isPassword && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onToggleSecret}
            className="h-[44px] w-[44px] rounded-xl bg-surface-input border-black/10 dark:border-white/10 text-muted-foreground hover:text-foreground shrink-0 shadow-sm"
          >
            {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        )}
        {actionNode}
      </div>
      {field.description && (
        <p className="text-[13px] text-muted-foreground leading-relaxed">
          {t(field.description)}
        </p>
      )}
      {field.envVar && (
        <p className="text-[12px] text-muted-foreground/70 font-mono">
          {t('dialog.envVar', { var: field.envVar })}
        </p>
      )}
    </div>
  );
}
