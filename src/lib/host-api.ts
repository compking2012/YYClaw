import type {
  AgentCreatePayload,
  AgentUpdateDefaultModelsPayload,
  AgentUpdateModelPayload,
  AgentUpdateAutoSelectPayload,
  AgentUpdatePayload,
  AcpTraceRecordPayload,
  AttachmentFileRef,
  AttachmentSourceRef,
  ChannelAccountsPayload,
  ChannelSaveConfigPayload,
  ChannelTargetsPayload,
  ClawHubSearchPayload,
  CronSessionHistoryPayload,
  DialogMessagePayload,
  DialogOpenPayload,
  FilePreviewTreeOptions,
  FileReadBinaryOptions,
  ImageGenerationSettingsPayload,
  LegacyFetchPayload,
  LegacyFetchResult,
  MediaThumbnailEntry,
  OpenClawDoctorMode,
  OpenClawDoctorResult,
  OpenAttachmentWithPayload,
  OpenWorkspaceWithPayload,
  ProviderAccount,
  ProviderConfig,
  ProviderOAuthRequestPayload,
  ProviderUpdateWithKeyPayload,
  ProviderValidationPayload,
  ReadAttachmentBinaryPayload,
  ResolveAttachmentPayload,
  SessionMaintenancePayload,
  SaveImagePayload,
  SettingsKey,
  SettingsSnapshot,
  SettingsValue,
  ShellOpenExternalPayload,
  ShellOpenAuthWindowPayload,
  ShellPathPayload,
  SkillQuickAccessPayload,
  SkillUpdateConfigPayload,
  SkillUpdatePayload,
  SkillUiSchemaPayload,
  SkillUiActionPayload,
  SkillUploadMarketplacePayload,
  SkillPublishMetaPayload,
  SkillUnlistPayload,
  SkillCancelReviewPayload,
  FileSaveAsPayload,
  SaveAttachmentAsPayload,
  UpdateChannel,
  WorkspaceContextInput,
  WorkspaceFileRef,
  GatewayControlUiPayload,
  ChatSendWithMediaPayload,
} from '@shared/host-api/contract';
import type { WebBrowserNavigatePayload } from '@shared/web-browser';
import type {
  AcpChatCancelPayload,
  AcpChatLoadPayload,
  AcpChatPromptPayload,
  AcpChatRespondPermissionPayload,
} from '@shared/acp-chat/types';
import type { CronJobCreateInput, CronJobUpdateInput } from '@shared/types/cron';
import { invokeHost } from './host-api-client';

export type {
  ChatSendWithMediaPayload,
  ChatSendWithMediaResult,
  AttachmentAccessError,
  AttachmentFileRef,
  AttachmentOpenHandler,
  AttachmentOpenHandlersResult,
  AttachmentRemoteRef,
  AttachmentReadError,
  AttachmentSourceRef,
  ChannelAccountsResult,
  ChannelCredentialValidationResult,
  ChannelFormValuesResult,
  ChannelGroupItem,
  ChannelSaveConfigResult,
  ChannelTargetOption,
  ChannelTargetsResult,
  ClawHubInstalledSkill,
  ClawHubListResult,
  ClawHubSearchResult,
  CronSessionHistoryResult,
  DeliveryChannelAccount,
  DeliveryChannelGroup,
  DeliveryTargetsResult,
  GatewayHealthSummary,
  ImageGenerationProvidersResult,
  ImageGenerationSettingsResult,
  LocalSkillsResult,
  LogContentResult,
  LogDirResult,
  OpenClawCliCommandResult,
  OpenClawDoctorResult,
  OpenClawStatusResult,
  OpenAttachmentResult,
  ProviderAccountKeyInfo,
  ProviderDefaultAccountResult,
  ProviderValidationResult,
  ReadAttachmentBinaryResult,
  ReadAttachmentTextResult,
  ResolveAttachmentResult,
  SessionHistoryResult,
  SessionLabelSummary,
  SessionSummariesResult,
  SettingsResetResult,
  SettingsSnapshot,
  SkillConfigsResult,
  SkillsStatusResult,
  StagedFileResult,
  UsageHistoryEntry,
  WorkspaceContextInput,
  WorkspaceFileRef,
  WorkspaceNativeFileError,
  WorkspaceNativeFileResult,
  WorkspaceOpenHandlersResult,
} from '@shared/host-api/contract';

export const hostApi = {
  app: {
    openClawDoctor: async (mode: OpenClawDoctorMode): Promise<OpenClawDoctorResult> => ({
      ...(await invokeHost('app', 'openClawDoctor', { mode })),
      mode,
    }),
    sessionMaintenance: () => invokeHost('app', 'sessionMaintenance'),
    saveSessionMaintenance: (patch: SessionMaintenancePayload) => (
      invokeHost('app', 'saveSessionMaintenance', patch)
    ),
    controlUiEnabled: () => invokeHost('app', 'controlUiEnabled'),
    setControlUiEnabled: (enabled: boolean) => (
      invokeHost('app', 'setControlUiEnabled', { enabled })
    ),
    openclawVersion: () => invokeHost('app', 'openclawVersion'),
  },
  openclaw: {
    status: () => invokeHost('openclaw', 'status'),
    getSkillsDir: () => invokeHost('openclaw', 'getSkillsDir'),
    getCliCommand: () => invokeHost('openclaw', 'getCliCommand'),
  },
  shell: {
    openExternal: (url: string) => invokeHost('shell', 'openExternal', { url } satisfies ShellOpenExternalPayload),
    openAuthWindow: (url: string, title?: string, intent?: 'feishu-credentials' | 'feishu-delete') =>
      invokeHost('shell', 'openAuthWindow', { url, title, intent } satisfies ShellOpenAuthWindowPayload),
    showItemInFolder: (path: string) => invokeHost('shell', 'showItemInFolder', { path } satisfies ShellPathPayload),
    openPath: (path: string) => invokeHost('shell', 'openPath', { path } satisfies ShellPathPayload),
    readClipboardText: () => invokeHost('shell', 'readClipboardText'),
  },
  webBrowser: {
    navigate: (url: string) => invokeHost('webBrowser', 'navigate', { url } satisfies WebBrowserNavigatePayload),
    openExternal: (url: string) => (
      invokeHost('webBrowser', 'openExternal', { url } satisfies WebBrowserNavigatePayload)
    ),
  },
  dialog: {
    open: (input: DialogOpenPayload) => invokeHost('dialog', 'open', input),
    message: (input: DialogMessagePayload) => invokeHost('dialog', 'message', input),
  },
  window: {
    syncTrafficLightPosition: (sidebarCollapsed: boolean) => (
      invokeHost('window', 'syncTrafficLightPosition', { sidebarCollapsed })
    ),
    minimize: () => invokeHost('window', 'minimize'),
    maximize: () => invokeHost('window', 'maximize'),
    close: () => invokeHost('window', 'close'),
    isMaximized: () => invokeHost('window', 'isMaximized'),
    ensureKeyboardFocus: () => invokeHost('window', 'ensureKeyboardFocus'),
  },
  updates: {
    status: () => invokeHost('updates', 'status'),
    version: () => invokeHost('updates', 'version'),
    check: () => invokeHost('updates', 'check'),
    download: () => invokeHost('updates', 'download'),
    install: () => invokeHost('updates', 'install'),
    setChannel: (channel: UpdateChannel) => invokeHost('updates', 'setChannel', { channel }),
    setAutoDownload: (enable: boolean) => invokeHost('updates', 'setAutoDownload', { enable }),
    cancelAutoInstall: () => invokeHost('updates', 'cancelAutoInstall'),
  },
  uv: {
    installAll: () => invokeHost('uv', 'installAll'),
  },
  settings: {
    getAll: () => invokeHost('settings', 'getAll'),
    get: (key: SettingsKey) => invokeHost('settings', 'get', { key }),
    set: (key: SettingsKey, value: SettingsValue) => invokeHost('settings', 'set', { key, value }),
    setMany: (patch: Partial<SettingsSnapshot>) => (
      invokeHost('settings', 'setMany', { patch })
    ),
    reset: () => invokeHost('settings', 'reset'),
  },
  gateway: {
    status: () => invokeHost('gateway', 'status'),
    start: () => invokeHost('gateway', 'start'),
    stop: () => invokeHost('gateway', 'stop'),
    restart: () => invokeHost('gateway', 'restart'),
    health: (probe = false) => invokeHost('gateway', 'health', { probe }),
    controlUi: (view?: GatewayControlUiPayload['view']) => invokeHost('gateway', 'controlUi', { view }),
    rpc: <T = unknown>(method: string, params?: unknown, timeoutMs?: number) => (
      invokeHost('gateway', 'rpc', { method, params, timeoutMs }) as Promise<T>
    ),
  },
  logs: {
    recent: (tailLines = 100) => invokeHost('logs', 'recent', { tailLines }),
    dir: () => invokeHost('logs', 'dir'),
    listFiles: () => invokeHost('logs', 'listFiles'),
    readFile: (path: string, tailLines?: number) => (
      invokeHost('logs', 'readFile', { path, tailLines })
    ),
  },
  channels: {
    accounts: (options?: ChannelAccountsPayload) => (
      invokeHost('channels', 'accounts', options)
    ),
    targets: (input: ChannelTargetsPayload) => (
      invokeHost('channels', 'targets', input)
    ),
    configured: () => invokeHost('channels', 'configured'),
    formValues: (channelType: string, accountId?: string) => (
      invokeHost('channels', 'formValues', { channelType, accountId })
    ),
    saveConfig: (input: ChannelSaveConfigPayload) => invokeHost('channels', 'saveConfig', input),
    deleteConfig: (channelType: string, accountId?: string) => (
      invokeHost('channels', 'deleteConfig', { channelType, accountId })
    ),
    validateCredentials: (channelType: string, config: Record<string, unknown>) => (
      invokeHost('channels', 'validateCredentials', { channelType, config })
    ),
    saveBinding: (input: { channelType: string; accountId: string; agentId: string }) => (
      invokeHost('channels', 'bindingSave', input)
    ),
    deleteBinding: (input: { channelType: string; accountId?: string }) => (
      invokeHost('channels', 'bindingDelete', input)
    ),
    startLogin: (channelType: string, input?: { accountId?: string }) => (
      invokeHost('channels', 'startLogin', { channelType, ...input })
    ),
    cancelLogin: (channelType: string, input?: { accountId?: string }) => (
      invokeHost('channels', 'cancelLogin', { channelType, ...input })
    ),
    feishuCandidateIcons: () => invokeHost('channels', 'feishuCandidateIcons'),
    feishuMyApps: () => invokeHost('channels', 'feishuMyApps'),
    feishuAppInfo: (input: { appId: string; appSecret: string }) => (
      invokeHost('channels', 'feishuAppInfo', input)
    ),
    feishuAutoCreate: (input: { appName: string; iconBase64?: string; iconMimeType?: string }) => (
      invokeHost('channels', 'feishuAutoCreate', input)
    ),
    feishuUpdateApp: (input: { appId: string; appSecret: string; appName: string; iconBase64?: string; iconMimeType?: string }) => (
      invokeHost('channels', 'feishuUpdateApp', input)
    ),
    feishuDeleteApp: (input: { appId: string }) => invokeHost('channels', 'feishuDeleteApp', input),
    feishuRetryLarkCli: (input: { appId: string; appSecret: string }) => (
      invokeHost('channels', 'feishuRetryLarkCli', input)
    ),
  },
  agents: {
    list: (opts?: { reconcile?: boolean }) =>
      invokeHost('agents', 'list', opts?.reconcile === false ? { reconcile: false } : {}),
    create: (input: AgentCreatePayload) => invokeHost('agents', 'create', input),
    update: (id: string, input: Omit<AgentUpdatePayload, 'id'>) => (
      invokeHost('agents', 'update', {
        id,
        ...input,
      })
    ),
    updateId: (id: string, newId: string) => invokeHost('agents', 'updateId', { id, newId }),
    updateModel: (id: string, modelRef: string | null, targetSlot?: AgentUpdateModelPayload['targetSlot']) => (
      invokeHost('agents', 'updateModel', { id, modelRef, targetSlot })
    ),
    updateDefaultModels: (models: AgentUpdateDefaultModelsPayload['models']) => (
      invokeHost('agents', 'updateDefaultModels', { models })
    ),
    updateAutoSelect: (
      id: string,
      update: { autoSelectModel?: AgentUpdateAutoSelectPayload['autoSelectModel']; optimizationProfile?: AgentUpdateAutoSelectPayload['optimizationProfile']; sensitiveMode?: boolean },
    ) => (
      invokeHost('agents', 'updateAutoSelect', { id, ...update })
    ),
    setDefault: (id: string) => invokeHost('agents', 'setDefault', { id }),
    delete: (id: string) => invokeHost('agents', 'delete', { id }),
    assignChannel: (id: string, channelType: string) => (
      invokeHost('agents', 'assignChannel', { id, channelType })
    ),
    removeChannel: (id: string, channelType: string) => (
      invokeHost('agents', 'removeChannel', { id, channelType })
    ),
    updateGlobalSkills: (skills: string[]) => invokeHost('agents', 'updateGlobalSkills', { skills }),
    generateText: (input: {
      agentId?: string;
      system: string;
      input: string;
      temperature?: number;
      maxOutputTokens?: number;
      timeoutMs?: number;
    }) => invokeHost('agents', 'generateText', input),
  },
  diagnostics: {
    gatewaySnapshot: () => invokeHost('diagnostics', 'gatewaySnapshot'),
    acpTrace: () => invokeHost('diagnostics', 'acpTrace'),
    recordAcpTrace: (input: AcpTraceRecordPayload) => invokeHost('diagnostics', 'recordAcpTrace', input),
  },
  providers: {
    list: () => invokeHost('providers', 'list'),
    get: (providerId: string) => invokeHost('providers', 'get', { providerId }),
    getDefault: () => invokeHost('providers', 'getDefault'),
    hasApiKey: (providerId: string) => (
      invokeHost('providers', 'hasApiKey', { providerId })
    ),
    getApiKey: (providerId: string) => (
      invokeHost('providers', 'getApiKey', { providerId })
    ),
    validateKey: (input: ProviderValidationPayload) => invokeHost('providers', 'validateKey', input),
    save: (input: { config: ProviderConfig; apiKey?: string }) => invokeHost('providers', 'save', input),
    delete: (providerId: string) => invokeHost('providers', 'delete', { providerId }),
    setApiKey: (providerId: string, apiKey: string) => (
      invokeHost('providers', 'setApiKey', { providerId, apiKey })
    ),
    updateWithKey: (input: ProviderUpdateWithKeyPayload) => invokeHost('providers', 'updateWithKey', input),
    deleteApiKey: (providerId: string) => (
      invokeHost('providers', 'deleteApiKey', { providerId })
    ),
    setDefault: (providerId: string) => (
      invokeHost('providers', 'setDefault', { providerId })
    ),
    accounts: () => invokeHost('providers', 'accounts'),
    vendors: () => invokeHost('providers', 'vendors'),
    accountKeyInfo: () => invokeHost('providers', 'accountKeyInfo'),
    getDefaultAccount: () => invokeHost('providers', 'getDefaultAccount'),
    getAccount: (accountId: string) => (
      invokeHost('providers', 'getAccount', { accountId })
    ),
    getAccountApiKey: (accountId: string) => (
      invokeHost('providers', 'getAccountApiKey', { accountId })
    ),
    hasAccountApiKey: (accountId: string) => (
      invokeHost('providers', 'hasAccountApiKey', { accountId })
    ),
    createAccount: (input: { account: ProviderAccount; apiKey?: string }) => (
      invokeHost('providers', 'createAccount', input)
    ),
    updateAccount: (accountId: string, updates: Partial<ProviderAccount>, apiKey?: string) => (
      invokeHost('providers', 'updateAccount', { accountId, updates, apiKey })
    ),
    deleteAccount: (accountId: string) => (
      invokeHost('providers', 'deleteAccount', { accountId })
    ),
    deleteAccountApiKey: (accountId: string) => (
      invokeHost('providers', 'deleteAccountApiKey', { accountId })
    ),
    setDefaultAccount: (accountId: string) => (
      invokeHost('providers', 'setDefaultAccount', { accountId })
    ),
    requestOAuth: (input: ProviderOAuthRequestPayload) => invokeHost('providers', 'requestOAuth', input),
    cancelOAuth: () => invokeHost('providers', 'cancelOAuth'),
    submitOAuth: (input: { code: string }) => invokeHost('providers', 'submitOAuth', input),
  },
  files: {
    stagePaths: (input: { filePaths: string[] }) => invokeHost('files', 'stagePaths', input),
    stageBuffer: (input: { base64: string; fileName: string; mimeType?: string }) => (
      invokeHost('files', 'stageBuffer', input)
    ),
    readText: (path: string) => invokeHost('files', 'readText', { path }),
    readBinary: (path: string, opts?: FileReadBinaryOptions) => (
      invokeHost('files', 'readBinary', { path, opts })
    ),
    writeText: (path: string, content: string) => (
      invokeHost('files', 'writeText', { path, content })
    ),
    stat: (path: string) => invokeHost('files', 'stat', { path }),
    listDir: (path: string) => invokeHost('files', 'listDir', { path }),
    listTree: (path: string, opts?: FilePreviewTreeOptions) => (
      invokeHost('files', 'listTree', { path, opts })
    ),
    saveAs: (input: FileSaveAsPayload) => invokeHost('files', 'saveAs', input),
    saveAttachmentAs: (input: SaveAttachmentAsPayload) => invokeHost('files', 'saveAttachmentAs', input),
    resolveWorkspaceContext: (input: WorkspaceContextInput) => (
      invokeHost('files', 'resolveWorkspaceContext', input)
    ),
    readWorkspaceText: (ref: WorkspaceFileRef) => invokeHost('files', 'readWorkspaceText', ref),
    readWorkspaceBinary: (input: WorkspaceFileRef & { maxBytes?: number }) => (
      invokeHost('files', 'readWorkspaceBinary', input)
    ),
    statWorkspaceFile: (ref: WorkspaceFileRef) => invokeHost('files', 'statWorkspaceFile', ref),
    listWorkspaceOpenHandlers: (ref: WorkspaceFileRef) => (
      invokeHost('files', 'listWorkspaceOpenHandlers', ref)
    ),
    openWorkspaceWith: (input: OpenWorkspaceWithPayload) => (
      invokeHost('files', 'openWorkspaceWith', input)
    ),
    revealWorkspaceFile: (ref: WorkspaceFileRef) => invokeHost('files', 'revealWorkspaceFile', ref),
    resolveAttachment: (input: ResolveAttachmentPayload) => invokeHost('files', 'resolveAttachment', input),
    readAttachmentText: (ref: AttachmentFileRef) => invokeHost('files', 'readAttachmentText', ref),
    readAttachmentBinary: (input: ReadAttachmentBinaryPayload) => (
      invokeHost('files', 'readAttachmentBinary', input)
    ),
    openAttachment: (ref: AttachmentSourceRef) => invokeHost('files', 'openAttachment', ref),
    listAttachmentOpenHandlers: (ref: AttachmentFileRef) => (
      invokeHost('files', 'listAttachmentOpenHandlers', ref)
    ),
    openAttachmentWith: (input: OpenAttachmentWithPayload) => (
      invokeHost('files', 'openAttachmentWith', input)
    ),
    revealAttachment: (ref: AttachmentFileRef) => invokeHost('files', 'revealAttachment', ref),
  },
  media: {
    thumbnails: (input: { paths: MediaThumbnailEntry[] }) => invokeHost('media', 'thumbnails', input),
    saveImage: (input: SaveImagePayload) => invokeHost('media', 'saveImage', input),
    imageGenerationSettings: () => invokeHost('media', 'imageGenerationSettings'),
    saveImageGenerationSettings: (input: ImageGenerationSettingsPayload) => (
      invokeHost('media', 'saveImageGenerationSettings', input)
    ),
    imageGenerationProviders: () => invokeHost('media', 'imageGenerationProviders'),
    testImageGeneration: (input: { agentId?: string; prompt?: string; model?: string }) => (
      invokeHost('media', 'testImageGeneration', input)
    ),
  },
  sessions: {
    delete: (id: string, workflowRunIds?: string[]) => (
      invokeHost('sessions', 'delete', { id, ...(workflowRunIds?.length ? { workflowRunIds } : {}) })
    ),
    rename: (id: string, title: string) => (
      invokeHost('sessions', 'rename', { id, title })
    ),
    summaries: (input?: { sessionKeys?: string[]; limit?: number }) => invokeHost('sessions', 'summaries', input),
    history: (input: { sessionKey?: string; agentId?: string; sessionId?: string; limit?: number }) => (
      invokeHost('sessions', 'history', input)
    ),
    turnTimings: (input: { sessionKey: string; limit?: number }) => (
      invokeHost('sessions', 'turnTimings', input)
    ),
  },
  chat: {
    sendWithMedia: (input: ChatSendWithMediaPayload) => invokeHost('chat', 'sendWithMedia', input),
    loadAcpSession: (input: AcpChatLoadPayload) => invokeHost('chat', 'loadAcpSession', input),
    sendAcpPrompt: (input: AcpChatPromptPayload) => invokeHost('chat', 'sendAcpPrompt', input),
    cancelAcpSession: (input: AcpChatCancelPayload) => invokeHost('chat', 'cancelAcpSession', input),
    respondAcpPermission: (input: AcpChatRespondPermissionPayload) => (
      invokeHost('chat', 'respondAcpPermission', input)
    ),
  },
  cron: {
    list: () => invokeHost('cron', 'list'),
    create: (input: CronJobCreateInput) => invokeHost('cron', 'create', input),
    update: (id: string, input: CronJobUpdateInput) => invokeHost('cron', 'update', { id, input }),
    delete: (id: string) => invokeHost('cron', 'delete', { id }),
    toggle: (id: string, enabled: boolean) => invokeHost('cron', 'toggle', { id, enabled }),
    trigger: (id: string) => invokeHost('cron', 'trigger', { id }),
    sessionHistory: (input: CronSessionHistoryPayload) => invokeHost('cron', 'sessionHistory', input),
    deliveryTargets: () => invokeHost('cron', 'deliveryTargets'),
  },
  skills: {
    local: () => invokeHost('skills', 'local'),
    configs: () => invokeHost('skills', 'configs'),
    allConfigs: () => invokeHost('skills', 'allConfigs'),
    getConfig: (skillKey: string) => invokeHost('skills', 'getConfig', { skillKey }),
    updateConfig: (input: SkillUpdateConfigPayload) => invokeHost('skills', 'updateConfig', input),
    updateConfigs: (updates: SkillUpdateConfigPayload[]) => invokeHost('skills', 'updateConfigs', { updates }),
    status: () => invokeHost('skills', 'status'),
    update: (input: SkillUpdatePayload) => invokeHost('skills', 'update', input),
    quickAccess: (input: SkillQuickAccessPayload) => invokeHost('skills', 'quickAccess', input),
    clawhubCapability: () => invokeHost('skills', 'clawhubCapability'),
    clawhubList: () => invokeHost('skills', 'clawhubList'),
    clawhubSearch: (input: ClawHubSearchPayload) => invokeHost('skills', 'clawhubSearch', input),
    clawhubInstall: (input: {
      slug: string;
      version?: string;
      baseDir?: string;
      workspace?: string;
      sessionAgentId?: string;
    }) => invokeHost('skills', 'clawhubInstall', input),
    clawhubUninstall: (input: { slug: string }) => invokeHost('skills', 'clawhubUninstall', input),
    clawhubOpenSkillReadme: (input: { skillKey?: string; slug?: string; baseDir?: string }) => (
      invokeHost('skills', 'clawhubOpenSkillReadme', input)
    ),
    clawhubOpenSkillPath: (input: { skillKey?: string; slug?: string; baseDir?: string }) => (
      invokeHost('skills', 'clawhubOpenSkillPath', input)
    ),
    marketplaceList: (input?: { query?: string; limit?: number; category?: string }) => (
      invokeHost('skills', 'marketplaceList', input)
    ),
    marketplaceSearch: (input: { query?: string; limit?: number; category?: string }) => (
      invokeHost('skills', 'marketplaceSearch', input)
    ),
    marketplaceInstall: (input: {
      slug?: string;
      name?: string;
      version?: string;
      archiveHash?: string;
      listingRevision?: string;
      versionBase?: string;
      category?: string;
      baseDir?: string;
      workspace?: string;
      sessionAgentId?: string;
      overwriteSameName?: boolean;
    }) => invokeHost('skills', 'marketplaceInstall', input),
    marketplaceUninstall: (input: { slug?: string; name?: string; baseDir?: string }) => (
      invokeHost('skills', 'marketplaceUninstall', input)
    ),
    updateAgentsMappingBatch: (updates: Array<{ skillId: string; agentIds: string[] }>) => (
      invokeHost('skills', 'updateAgentsMappingBatch', { updates })
    ),
    getUiSchema: (input: SkillUiSchemaPayload) => invokeHost('skills', 'getUiSchema', input),
    executeUiAction: (input: SkillUiActionPayload) => invokeHost('skills', 'executeUiAction', input),
    listPublishedMarketplace: () => invokeHost('skills', 'listPublishedMarketplace'),
    getPublishMeta: (input: SkillPublishMetaPayload) => invokeHost('skills', 'getPublishMeta', input),
    uploadMarketplaceZip: (input: SkillUploadMarketplacePayload) => (
      invokeHost('skills', 'uploadMarketplaceZip', input)
    ),
    listMarketplaceReviewRequests: () => invokeHost('skills', 'listMarketplaceReviewRequests'),
    requestMarketplaceUnlist: (input: SkillUnlistPayload) => (
      invokeHost('skills', 'requestMarketplaceUnlist', input)
    ),
    cancelMarketplaceReviewRequest: (input: SkillCancelReviewPayload) => (
      invokeHost('skills', 'cancelMarketplaceReviewRequest', input)
    ),
  },
  usage: {
    recentTokenHistory: (limit?: number) => (
      invokeHost('usage', 'recentTokenHistory', { limit })
    ),
  },
  adminConsole: {
    sessionSendRemote: (input: Record<string, unknown>) => (
      invokeHost('adminConsole', 'sessionSendRemote', input)
    ),
    sessionListRemote: (input: Record<string, unknown>) => (
      invokeHost('adminConsole', 'sessionListRemote', input)
    ),
    sessionHistoryRemote: (input: Record<string, unknown>) => (
      invokeHost('adminConsole', 'sessionHistoryRemote', input)
    ),
    sessionStatusRemote: (input: Record<string, unknown>) => (
      invokeHost('adminConsole', 'sessionStatusRemote', input)
    ),
    sharedWorkspaceSync: (input: Record<string, unknown>) => (
      invokeHost('adminConsole', 'sharedWorkspaceSync', input)
    ),
  },
  voice: {
    configStatus: () => invokeHost('voice', 'configStatus'),
    selections: () => invokeHost('voice', 'selections'),
    transcribe: (input: { audioBase64: string; mimeType?: string; language?: string }) => (
      invokeHost('voice', 'transcribe', input)
    ),
    ttsAudio: (input: { text: string; provider?: string; voiceId?: string; modelId?: string }) => (
      invokeHost('voice', 'ttsAudio', input)
    ),
    setTtsAccount: (input: { accountId: string; model?: string }) => invokeHost('voice', 'setTtsAccount', input),
    clearTtsAccount: () => invokeHost('voice', 'clearTtsAccount'),
    setTranscriptionAccount: (input: { accountId: string; model?: string }) => (
      invokeHost('voice', 'setTranscriptionAccount', input)
    ),
    clearTranscriptionAccount: () => invokeHost('voice', 'clearTranscriptionAccount'),
  },
  workspace: {
    agents: () => invokeHost('workspace', 'agents'),
    tree: (input: { agentId?: string; includeHidden?: boolean }) => invokeHost('workspace', 'tree', input),
    rebuild: (input: { agentId: string }) => invokeHost('workspace', 'rebuild', input),
    deleteFile: (input: { agentId?: string; path: string }) => invokeHost('workspace', 'deleteFile', input),
  },
  promptOptimization: {
    activeRun: () => invokeHost('promptOptimization', 'activeRun'),
    registerRun: (input: { sessionKey: string; runId: string }) => (
      invokeHost('promptOptimization', 'registerRun', input)
    ),
    record: (input: { runId: string; before_chars?: number; after_chars?: number; saved_chars?: number }) => (
      invokeHost('promptOptimization', 'record', input)
    ),
    summary: (input: { runId: string }) => invokeHost('promptOptimization', 'summary', input),
  },
  workflow: {
    list: () => invokeHost('workflow', 'list'),
    start: (input: { defId: string; input?: unknown }) => invokeHost('workflow', 'start', input),
    resume: (input: { runId: string }) => invokeHost('workflow', 'resume', input),
    retry: (input: { runId: string }) => invokeHost('workflow', 'retry', input),
    abort: (input: { runId: string }) => invokeHost('workflow', 'abort', input),
    status: (input: { runId: string }) => invokeHost('workflow', 'status', input),
    startDynamic: (input: { task?: string; definition?: Record<string, unknown>; input?: Record<string, unknown>; skills?: Array<{ name: string; description?: string }> }) => (
      invokeHost('workflow', 'startDynamic', input)
    ),
  },
};

export type HostApi = typeof hostApi;

export async function hostApiFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  if (init?.headers instanceof Headers) {
    init.headers.forEach((value, key) => {
      headers[key] = value;
    });
  } else if (Array.isArray(init?.headers)) {
    for (const [key, value] of init.headers) {
      headers[key] = value;
    }
  } else if (init?.headers) {
    Object.assign(headers, init.headers as Record<string, string>);
  }

  const payload: LegacyFetchPayload = {
    path,
    method: init?.method,
    headers,
    body: typeof init?.body === 'string' ? init.body : undefined,
  };
  const response = await invokeHost('legacy', 'fetch', payload) as LegacyFetchResult;
  if (response.status < 200 || response.status >= 300) {
    const body = response.body;
    const message = body && typeof body === 'object' && 'error' in body
      ? String((body as { error?: unknown }).error)
      : `Host API request failed: ${response.status}`;
    throw new Error(message);
  }
  if (response.status === 204 || response.body === undefined) {
    return undefined as T;
  }
  return response.body as T;
}
