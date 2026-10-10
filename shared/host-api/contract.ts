import type {
  AcpChatCancelPayload,
  AcpChatLoadPayload,
  AcpChatOperationResult,
  AcpChatPromptPayload,
  AcpChatRespondPermissionPayload,
  AcpSessionFamilyPayload,
  AcpSessionFamilyResult,
} from '../acp-chat/types';
import type { RawMessage } from '../chat/types';
import type { AgentsSnapshot } from '../types/agent';
import type { CronJob, CronJobCreateInput, CronJobUpdateInput } from '../types/cron';
import type { GatewayHealth, GatewayStatus } from '../types/gateway';
import type { MarketplaceSkill, QuickAccessSkill, Skill } from '../types/skill';
import type { WebBrowserNavigatePayload } from '../web-browser';
export type JsonRecord = Record<string, unknown>;
export type HostSuccess = { success: boolean; error?: string };
export type FeishuLoginResult = HostSuccess & { userInfo?: JsonRecord };
export type GatewayPortConflict = { port: number; externalPids: string[] };
export type OptionalHostSuccess = { success?: boolean; error?: string };
export type LegacyFetchPayload = {
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};
export type LegacyFetchResult = {
  status: number;
  headers: Record<string, string>;
  body?: unknown;
};

export type OpenClawDoctorMode = 'diagnose' | 'fix';
export type OpenClawDoctorResult = HostSuccess & {
  mode: OpenClawDoctorMode;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  command: string;
  cwd: string;
  durationMs: number;
  timedOut?: boolean;
};
export type OpenClawDoctorPayload = { mode: OpenClawDoctorMode };

export type SessionMaintenanceConfig = {
  mode?: 'warn' | 'enforce';
  pruneAfter?: string | number;
  maxEntries?: number;
  maxDiskBytes?: string | number;
  highWaterBytes?: string | number;
  resetArchiveRetention?: string | number | false;
};
export type SessionMaintenancePayload = Partial<Record<keyof SessionMaintenanceConfig, unknown>>;

export type ControlUiEnabledPayload = { enabled: boolean };

export type OpenClawStatusResult = {
  packageExists: boolean;
  isBuilt: boolean;
  entryPath: string;
  dir: string;
  version?: string;
};
export type OpenClawCliCommandResult = HostSuccess & { command?: string };
export type AdminConsoleSessionSendRemotePayload = JsonRecord;
export type AdminConsoleSessionListRemotePayload = JsonRecord;
export type AdminConsoleSessionHistoryRemotePayload = JsonRecord;
export type AdminConsoleSessionStatusRemotePayload = JsonRecord;
export type AdminConsoleSharedWorkspaceSyncPayload = JsonRecord;
export type AdminConsoleRemoteResult = JsonRecord | unknown;
export type VoiceConfigStatusResult = HostSuccess & {
  configured?: { tts: boolean; transcription: boolean; realtime: boolean };
  tts?: boolean;
  transcription?: boolean;
  realtime?: boolean;
};
export type VoiceSelectionsResult = HostSuccess & { selections?: unknown };
export type VoiceTranscribePayload = { audioBase64: string; mimeType?: string; language?: string };
export type VoiceTranscribeResult = HostSuccess & { text?: string };
export type VoiceTtsAudioPayload = { text: string; provider?: string; voiceId?: string; modelId?: string };
export type VoiceTtsAudioResult = HostSuccess & {
  base64?: string;
  mimeType?: string;
  provider?: string;
  outputFormat?: string;
};
export type VoiceAccountPayload = { accountId: string; model?: string };
export type WorkspaceAgentItem = { id: string; name: string; workspace: string; isDefault?: boolean };
export type WorkspaceFileTreeNode = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: WorkspaceFileTreeNode[];
};
export type WorkspaceAgentsResult = HostSuccess & { agents?: WorkspaceAgentItem[] };
export type WorkspaceTreePayload = { agentId?: string; includeHidden?: boolean };
export type WorkspaceTreeResult = HostSuccess & {
  agentId?: string;
  agentName?: string;
  workspace?: string;
  tree?: WorkspaceFileTreeNode[];
};
export type WorkspaceFilePayload = { agentId?: string; path: string };
export type WorkspaceDeleteFileResult = HostSuccess;
export type WorkspaceRebuildPayload = { agentId: string };
export type WorkspaceRebuildResult = HostSuccess;
export type PromptOptimizationSummary = { optimized: number; total: number; percent: number };
export type PromptOptimizationRegisterPayload = { sessionKey: string; runId: string };
export type PromptOptimizationRecordPayload = {
  runId: string;
  before_chars?: number;
  after_chars?: number;
  saved_chars?: number;
};
export type PromptOptimizationSummaryPayload = { runId: string };
export type PromptOptimizationSummaryResult = HostSuccess & { summary?: PromptOptimizationSummary };
export type PromptOptimizationActiveRunResult = HostSuccess & { active?: JsonRecord | null };
export type WorkflowListResult = HostSuccess & { definitions?: unknown[]; runs?: unknown[] };
export type WorkflowStartPayload = { defId: string; input?: unknown };
export type WorkflowStartResult = HostSuccess & { runId?: string; run?: unknown | null };
export type WorkflowRunIdPayload = { runId: string };
export type WorkflowResumeResult = HostSuccess & { resumed?: boolean; run?: JsonRecord | null };
export type WorkflowRetryResult = HostSuccess & { retried?: boolean; run?: JsonRecord | null };
export type WorkflowAbortResult = HostSuccess & { aborted?: boolean; run?: JsonRecord | null };
export type WorkflowStatusResult = HostSuccess & { run?: JsonRecord | null };
export type WorkflowStartDynamicPayload = {
  task?: string;
  definition?: JsonRecord;
  input?: JsonRecord;
  /** Installed workflow-shaped skills, so the generator can defer to one instead of inventing steps. */
  skills?: Array<{ name: string; description?: string }>;
  /**
   * Context of an unfinished run in this conversation. When present, the server's
   * generation call doubles as a resume-vs-new triage: if the model judges the
   * message a "continue this run" request it returns `resume:true` (no new steps).
   */
  resumable?: {
    runId: string;
    title?: string;
    steps?: Array<{ title: string; status?: 'done' | 'failed' | 'pending' }>;
    error?: string;
  };
};
export type WorkflowStartDynamicResult = HostSuccess & {
  routed?: boolean;
  runId?: string;
  title?: string;
  steps?: JsonRecord[];
  run?: JsonRecord | null;
  /** Set when the task matched an installed skill instead of being decomposed. */
  matchedSkill?: string;
  /** Set when `resumable` was provided and the model judged the turn a resume request. */
  resume?: boolean;
};

export type OpenClawCompactionReserveResult = {
  reserveTokensFloor?: number;
};

export type ShellPathPayload = { path: string };
export type ShellOpenExternalPayload = { url: string };
export type ShellOpenAuthWindowPayload = {
  url: string;
  title?: string;
  intent?: 'feishu-credentials' | 'feishu-delete';
};
export type DialogOpenPayload = {
  title?: string;
  defaultPath?: string;
  buttonLabel?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  properties?: Array<
    | 'openFile'
    | 'openDirectory'
    | 'multiSelections'
    | 'showHiddenFiles'
    | 'createDirectory'
    | 'promptToCreate'
    | 'noResolveAliases'
    | 'treatPackageAsDirectory'
    | 'dontAddToRecent'
  >;
  message?: string;
  securityScopedBookmarks?: boolean;
};
export type DialogOpenResult = {
  canceled: boolean;
  filePaths: string[];
  bookmarks?: string[];
};
export type DialogMessagePayload = {
  message: string;
  type?: 'none' | 'info' | 'error' | 'question' | 'warning';
  buttons?: string[];
  defaultId?: number;
  cancelId?: number;
  detail?: string;
  checkboxLabel?: string;
  checkboxChecked?: boolean;
  noLink?: boolean;
  title?: string;
};
export type DialogMessageResult = {
  response: number;
  checkboxChecked?: boolean;
};
export type WindowSyncTrafficLightPayload = { sidebarCollapsed: boolean };
export type UpdateChannel = 'stable' | 'beta' | 'dev';
export type UpdateInfoSnapshot = {
  version: string;
  releaseDate?: string;
  releaseNotes?: string | null;
  forceUpdate?: boolean;
};
export type UpdateProgressSnapshot = {
  total: number;
  delta: number;
  transferred: number;
  percent: number;
  bytesPerSecond: number;
};
export type UpdateStatusSnapshot = {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  info?: UpdateInfoSnapshot;
  progress?: UpdateProgressSnapshot;
  error?: string;
};
export type UpdateCheckResult = HostSuccess & { status?: UpdateStatusSnapshot };
export type UpdateSetChannelPayload = { channel: UpdateChannel };
export type UpdateSetAutoDownloadPayload = { enable: boolean };

export type SettingsSnapshot = Partial<{
  theme: 'light' | 'dark' | 'system';
  language: string;
  startMinimized: boolean;
  launchAtStartup: boolean;
  telemetryEnabled: boolean;
  promptOptimizationEnabled: boolean;
  autoWorkflowEnabled: boolean;
  gatewayAutoStart: boolean;
  computerUseEnabled: boolean;
  gatewayPort: number;
  proxyEnabled: boolean;
  proxyServer: string;
  proxyHttpServer: string;
  proxyHttpsServer: string;
  proxyAllServer: string;
  proxyBypassRules: string;
  updateChannel: 'stable' | 'beta' | 'dev';
  autoCheckUpdate: boolean;
  autoDownloadUpdate: boolean;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  devModeUnlocked: boolean;
  voiceAutoRead: boolean;
  voiceInputMode: 'dictation' | 'conversation';
  isLoggedIn: boolean;
  setupComplete: boolean;
  chatWorkspacePath: string;
  recentWorkspacePaths: string[];
  workspaceLabels: Record<string, string>;
}>;
export type SettingsKey = keyof SettingsSnapshot & string;
export type SettingsValue = SettingsSnapshot[SettingsKey];
export type SettingsGetPayload = { key: SettingsKey };
export type SettingsSetPayload = { key: SettingsKey; value: SettingsValue };
export type SettingsSetManyPayload = { patch: Partial<SettingsSnapshot> };
export type SettingsResetResult = HostSuccess & { settings: SettingsSnapshot };

export interface ComputerUseStatus {
  enabled: boolean;
  supported: boolean;
  running: boolean;
  permissions: { accessibility: boolean; screenRecording: string } | null;
}

export type GatewayControlUiResult = HostSuccess & {
  url?: string;
  token?: string;
  port?: number;
};
export type GatewayHealthPayload = { probe?: boolean };
export type GatewayRpcPayload = {
  method: string;
  params?: unknown;
  timeoutMs?: number;
};

export type LogContentResult = { content: string };
export type LogDirResult = { dir: string | null };
export type LogFilePathResult = { path: string | null };
export type LogRecentPayload = { tailLines?: number };
export type LogMemoryPayload = { count?: number };
export type LogReadFilePayload = { path: string; tailLines?: number };
export type LogFileEntry = {
  path: string;
  name?: string;
  size?: number;
  mtime?: number;
};
export type LogFilesResult = { files: LogFileEntry[] };

export type GatewayHealthSummary = {
  state: 'healthy' | 'degraded' | 'unresponsive';
  reasons: string[];
  consecutiveHeartbeatMisses: number;
  lastAliveAt?: number;
  lastRpcSuccessAt?: number;
  lastRpcFailureAt?: number;
  lastRpcFailureMethod?: string;
  lastChannelsStatusOkAt?: number;
  lastChannelsStatusFailureAt?: number;
  recovery?: GatewayRecoverySnapshot;
};

export type GatewayRecoveryState =
  | 'healthy'
  | 'verifying'
  | 'restart-pending'
  | 'restart-executing'
  | 'external-unavailable';
export type GatewayRecoverySnapshot = {
  state: GatewayRecoveryState;
  lastAliveAt?: number;
  deadlineAt?: number;
  lastDeadlineProbeAt?: number;
  lastDeadlineProbeResult?: 'succeeded' | 'failed';
  lastDeadlineProbeError?: string;
  escalationReason?: string;
  externallyManaged: boolean;
};

export type ChannelRuntimeStatus = 'connected' | 'connecting' | 'degraded' | 'disconnected' | 'error';
export type ChannelAccountItem = {
  accountId: string;
  name: string;
  configured: boolean;
  status: ChannelRuntimeStatus;
  statusReason?: string;
  lastError?: string;
  isDefault: boolean;
  agentId?: string;
};
export type ChannelGroupItem = {
  channelType: string;
  defaultAccountId: string;
  status: ChannelRuntimeStatus;
  statusReason?: string;
  /** i18n key under channels.health.reasons, shown even when connected. */
  statusNote?: string;
  accounts: ChannelAccountItem[];
};
export type ChannelTargetOption = {
  value: string;
  label: string;
  kind: 'user' | 'group' | 'channel';
};
export type ChannelAccountsPayload = {
  mode?: 'config' | 'runtime';
  configOnly?: boolean;
  probe?: boolean;
};
export type ChannelAccountsResult = HostSuccess & {
  channels?: ChannelGroupItem[];
  gatewayHealth?: GatewayHealthSummary;
};
export type ChannelTargetsPayload = {
  channelType: string;
  accountId?: string;
  query?: string;
};
export type ChannelTargetsResult = HostSuccess & {
  channelType?: string;
  accountId?: string;
  targets?: ChannelTargetOption[];
};
export type ChannelTypePayload = { channelType: string };
export type ChannelAccountPayload = ChannelTypePayload & { accountId?: string };
export type ChannelRequiredAccountPayload = ChannelTypePayload & { accountId: string };
export type ChannelBindingSavePayload = ChannelRequiredAccountPayload & { agentId: string };
export type ChannelBindingDeletePayload = ChannelAccountPayload;
export type ChannelSetEnabledPayload = ChannelTypePayload & { enabled: boolean };
export type ChannelFormValuesResult = HostSuccess & {
  values?: Record<string, string>;
};
export type ChannelCredentialValidationPayload = ChannelTypePayload & {
  config: Record<string, unknown>;
  accountId?: string;
};
export type ChannelCredentialValidationErrorCode = {
  code: string;
  params?: Record<string, string>;
};
export type ChannelCredentialValidationResult = HostSuccess & {
  valid: boolean;
  errors?: string[];
  warnings?: string[];
  /** Stable codes for renderer-side localization; `errors` is the English fallback. */
  errorCodes?: ChannelCredentialValidationErrorCode[];
  details?: {
    botUsername?: string;
    guildName?: string;
    channelName?: string;
    /** Discovered Feishu vs Lark origin when the form does not collect `domain`. */
    domain?: string;
  };
};
export type ChannelSaveConfigPayload = ChannelTypePayload & {
  config: Record<string, unknown>;
  accountId?: string;
};
export type ChannelSaveConfigResult = HostSuccess & {
  noChange?: boolean;
  /** Configuration is committed; a guarded Gateway restart is continuing asynchronously. */
  activationPending?: boolean;
  warning?: string;
};
export type DingTalkWorkspaceAuthStatus =
  | 'authorized'
  | 'needs_auth'
  | 'unavailable'
  | 'starting'
  | 'pending'
  | 'error';
export type DingTalkWorkspaceAuthResult = HostSuccess & {
  status: DingTalkWorkspaceAuthStatus;
  verificationUri?: string;
  verificationUriComplete?: string;
  userCode?: string;
  expiresAt?: number;
  /** Stable Main-owned error code; Renderer localizes it. */
  errorCode?: string;
};
export type ChannelConfiguredResult = HostSuccess & { channels?: Array<string | JsonRecord> };
export type FeishuCandidateIcon = { name: string; mimeType: string; base64: string };
export type FeishuCandidateIconsResult = HostSuccess & { candidates?: FeishuCandidateIcon[] };
export type FeishuUserApp = { appId: string; appName: string; avatarUrl: string; status: number | string };
export type FeishuMyAppsResult = HostSuccess & { apps?: FeishuUserApp[] };
export type FeishuAppInfoPayload = { appId: string; appSecret: string };
export type FeishuAppInfoResult = HostSuccess & { appName?: string; avatarUrl?: string };
export type FeishuAutoCreatePayload = { appName: string; iconBase64?: string; iconMimeType?: string };
export type FeishuAutoCreateResult = HostSuccess & {
  app_id?: string;
  app_secret?: string;
  larkCliReady?: boolean;
  larkCliError?: string;
  disabledAppId?: string;
  manageUrl?: string;
};
export type FeishuUpdateAppPayload = FeishuAppInfoPayload & FeishuAutoCreatePayload;
export type FeishuUpdateAppResult = HostSuccess & { larkCliReady?: boolean; larkCliError?: string; recovered?: boolean; manageUrl?: string };
export type FeishuDeleteAppPayload = { appId: string };
export type FeishuDeleteAppResult = HostSuccess & { url?: string; disabled?: boolean; manageUrl?: string };

export type AgentSnapshotResult = AgentsSnapshot & OptionalHostSuccess;
export type AgentModelSlot = 'model' | 'imageModel' | 'imageGenerationModel' | 'videoGenerationModel' | 'musicGenerationModel';
export type AgentCreatePayload = { name: string; id?: string; inheritWorkspace?: boolean; skills?: string[] };
export type AgentUpdatePayload = { id: string; name?: string; skills?: string[] };
export type AgentUpdateIdPayload = { id: string; newId: string };
export type AgentUpdateModelPayload = { id: string; modelRef: string | null; targetSlot?: AgentModelSlot };
export type AgentUpdateDefaultModelsPayload = { models: Partial<Record<AgentModelSlot, string | null>> };
export type AgentUpdateAutoSelectPayload = {
  id: string;
  autoSelectModel?: Partial<Record<AgentModelSlot, boolean>>;
  optimizationProfile?: 'quality' | 'balanced' | 'cost' | 'latency';
  sensitiveMode?: boolean;
};
export type AgentDeleteResult = AgentSnapshotResult & {
  /** Resolved path, present only when Main successfully removed a ClawX-managed workspace directory. */
  removedWorkspacePath?: string;
};
export type AgentIdPayload = { id: string };
export type AgentChannelPayload = { id: string; channelType: string };
export type AgentUpdateGlobalSkillsPayload = { skills: string[] };
export type AgentGenerateTextPayload = {
  agentId?: string;
  system: string;
  input: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
};
export type AgentGenerateTextResult = HostSuccess & { text?: string; modelRef?: string };

export type AcpTraceSource = 'main' | 'renderer';
export type AcpTraceEntry = {
  seq: number;
  timestamp: string;
  source: AcpTraceSource;
  event: string;
  direction?: string;
  sessionKey?: string;
  generation?: number;
  details?: unknown;
};
export type AcpTraceRecordPayload = {
  event: string;
  direction?: string;
  sessionKey?: string;
  generation?: number;
  details?: unknown;
};
export type AcpTraceSnapshot = {
  capturedAt: number;
  maxSize: number;
  size: number;
  entries: AcpTraceEntry[];
};
export type DiagnosticsGatewaySnapshotGateway = Omit<GatewayStatus, 'state'>
  & GatewayHealthSummary
  & { capabilities?: unknown };
export type DiagnosticsGatewaySnapshotResult = {
  capturedAt: number;
  platform: string;
  gateway: DiagnosticsGatewaySnapshotGateway;
  channels: ChannelGroupItem[];
  clawxLogTail: string;
  gatewayLogTail: string;
  gatewayErrLogTail: string;
};
export type IssueReportExportPayload = { sessionKeys: string[] };
export type IssueReportExportResult = HostSuccess & {
  path?: string;
  includedFiles?: string[];
  skippedSessionKeys?: string[];
};

export type ProviderType =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'openrouter'
  | 'tokendance'
  | 'ark'
  | 'moonshot'
  | 'moonshot-global'
  | 'siliconflow'
  | 'deepseek'
  | 'minimax-portal'
  | 'minimax-portal-cn'
  | 'zai'
  | 'zai-global'
  | 'modelstudio'
  | 'ollama'
  | 'custom';
export type ProviderAuthMode = 'api_key' | 'oauth_device' | 'oauth_browser' | 'local';
export type ProviderVendorCategory = 'official' | 'compatible' | 'local' | 'custom';
export type ModelKind = 'text' | 'image' | 'image_generate' | 'music_generate' | 'video_generate' | 'tts' | 'transcription' | 'realtime';
export type ProviderProtocol =
  | 'openai-completions'
  | 'openai-responses'
  | 'openai-chatgpt-responses'
  | 'anthropic-messages'
  | 'google-generative-ai'
  | 'github-copilot'
  | 'bedrock-converse-stream'
  | 'ollama'
  | 'azure-openai-responses';
export type ProviderConfig = {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl?: string;
  apiProtocol?: ProviderProtocol;
  headers?: Record<string, string>;
  model?: string | string[];
  modelType?: ModelKind[];
  modelParams?: Record<string, unknown>;
  fallbackModels?: string[];
  fallbackProviderIds?: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};
export type ProviderWithKeyInfo = ProviderConfig & {
  hasKey: boolean;
  keyMasked: string | null;
};
/**
 * Where the renderer should get the AI provider catalog from. Resolved in Main
 * (see `electron/utils/farm-api-base.ts`) so `YYCLAW_*` env overrides apply at
 * runtime; `local` means the renderer must not make any network call.
 */
export type ProviderCatalogSourceInfo = {
  source: 'local' | 'remote';
  baseUrl: string | null;
};
export type ProviderVendorInfo = {
  id: ProviderType;
  name: string;
  icon: string;
  placeholder: string;
  model?: string | string[];
  modelType?: ModelKind[];
  modelParams?: Record<string, unknown>;
  requiresApiKey: boolean;
  defaultBaseUrl?: string;
  showBaseUrl?: boolean;
  showModelId?: boolean;
  showModelIdInDevModeOnly?: boolean;
  modelIdPlaceholder?: string;
  defaultModelId?: string | string[];
  isOAuth?: boolean;
  supportsApiKey?: boolean;
  apiKeyUrl?: string;
  docsUrl?: string;
  docsUrlZh?: string;
  codePlanPresetBaseUrl?: string;
  codePlanPresetModelId?: string;
  codePlanDocsUrl?: string;
  hidden?: boolean;
  hideOAuthUi?: boolean;
  category: ProviderVendorCategory;
  envVar?: string;
  apiProtocol?: ProviderProtocol;
  headers?: Record<string, string>;
  backendModels?: Array<{ id: string; name?: string }>;
  supportedAuthModes: ProviderAuthMode[];
  defaultAuthMode: ProviderAuthMode;
  supportsMultipleAccounts: boolean;
};
export type ProviderAccount = {
  id: string;
  vendorId: ProviderType | (string & {});
  label: string;
  authMode: ProviderAuthMode;
  baseUrl?: string;
  apiProtocol?: ProviderProtocol;
  headers?: Record<string, string>;
  model?: string | string[];
  modelType?: ModelKind[];
  modelParams?: Partial<Record<ModelKind, Record<string, string | number | boolean>>>;
  fallbackModels?: string[];
  fallbackAccountIds?: string[];
  enabled: boolean;
  isDefault: boolean;
  metadata?: {
    region?: string;
    email?: string;
    resourceUrl?: string;
    customModels?: string[];
  };
  createdAt: string;
  updatedAt: string;
};
export type ProviderAccountKeyInfo = {
  accountId: string;
  hasKey: boolean;
  keyMasked: string | null;
};
export type ProviderDefaultAccountResult = { accountId: string | null };
export type ProviderValidationOptions = {
  baseUrl?: string;
  apiProtocol?: string;
  modelId?: string;
};
export type ProviderValidationPayload = {
  accountId?: string;
  vendorId?: string;
  providerId?: string;
  apiKey: string;
  options?: ProviderValidationOptions;
};
export type ProviderRecoveryAction = 'top_up_balance' | 'reauthorize_api_key' | 'api_key_quota';
export type ProviderValidationResult = {
  valid: boolean;
  error?: string;
  recoveryAction?: ProviderRecoveryAction;
};
export type ProviderIdPayload = { providerId: string };
export type ProviderApiKeyPayload = ProviderIdPayload & { apiKey: string };
export type ProviderSavePayload = { config: ProviderConfig; apiKey?: string };
export type ProviderUpdateWithKeyPayload = {
  providerId: string;
  updates: Partial<ProviderConfig>;
  apiKey?: string;
};
export type ProviderAccountIdPayload = { accountId: string };
export type ProviderCreateAccountPayload = { account: ProviderAccount; apiKey?: string };
export type ProviderUpdateAccountPayload = {
  accountId: string;
  updates: Partial<ProviderAccount>;
  apiKey?: string;
};
export type ProviderOAuthRequestPayload = {
  provider: string;
  region?: 'global' | 'cn';
  accountId?: string;
  label?: string;
};
export type ProviderOAuthSubmitPayload = { code: string };

export type StagedFileResult = {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  stagedPath: string;
  sourceKind: 'path' | 'buffer';
  preview: string | null;
  filePath?: string;
};
export type StagePathsPayload = { filePaths: string[] };
export type StageBufferPayload = { base64: string; fileName: string; mimeType?: string };
export type FilePathPayload = { path: string };
export type WorkspaceFileRef = {
  workspaceRoot: string;
  relativePath: string;
};
export type WorkspaceContextInput = {
  workspaceRoot: string;
  executionCwd: string;
};
export type FileReadBinaryOptions = { maxBytes?: number };
export type AttachmentSourceRef = {
  sessionKey: string;
  generation: number;
  uri: string;
  stagingId?: string;
  transcriptMessageId?: string;
};
export type AttachmentFileRef = AttachmentSourceRef;
export type AttachmentRemoteRef = AttachmentSourceRef;
export type AttachmentAccessError =
  | 'invalidReference'
  | 'staleSession'
  | 'unavailable'
  | 'notFile'
  | 'unsafeUrl'
  | 'operationFailed';
export type AttachmentReadError = AttachmentAccessError | 'tooLarge' | 'binary';
export type ResolveAttachmentPayload = {
  ref: AttachmentSourceRef;
  name?: string;
  mimeType?: string;
  size?: number;
};
export type ResolveAttachmentResult =
  | {
      ok: true;
      identity: string;
      displayName: string;
      displayPath?: string;
      mimeType: string;
      size: number;
      target:
        | {
            kind: 'local';
            scope: 'workspace' | 'openclaw-media' | 'staging';
            entryKind: 'file' | 'directory';
            ref: AttachmentFileRef;
          }
        | { kind: 'remote'; ref: AttachmentRemoteRef; url: string };
    }
  | { ok: false; displayName: string; error: AttachmentAccessError };
export type ReadAttachmentTextResult =
  | { ok: true; content: string; mimeType: string; size: number; readOnly: true }
  | { ok: false; error: AttachmentReadError; size?: number };
export type ReadAttachmentBinaryPayload = { ref: AttachmentFileRef; maxBytes?: number };
export type ReadAttachmentBinaryResult =
  | { ok: true; data: Uint8Array; mimeType: string; size: number; readOnly: true }
  | { ok: false; error: AttachmentReadError; size?: number };
export type OpenAttachmentResult =
  | { ok: true }
  | { ok: false; error: AttachmentAccessError };
export type AttachmentOpenHandler = {
  handlerId: string;
  name: string;
  iconDataUrl?: string;
  isDefault: boolean;
};
export type AttachmentOpenHandlersResult =
  | {
      ok: true;
      platform: 'darwin' | 'win32' | 'linux';
      handlers: AttachmentOpenHandler[];
    }
  | {
      ok: false;
      error: AttachmentAccessError | 'unsupportedPlatform' | 'operationFailed';
    };
export type OpenAttachmentWithPayload = {
  ref: AttachmentFileRef;
  handlerId: string;
};
export type WorkspaceNativeFileError =
  | 'outsideSandbox'
  | 'notFound'
  | 'notFile'
  | 'unsupportedPlatform'
  | 'operationFailed';
export type WorkspaceOpenHandlersResult =
  | {
      ok: true;
      platform: 'darwin' | 'win32' | 'linux';
      handlers: AttachmentOpenHandler[];
    }
  | { ok: false; error: WorkspaceNativeFileError };
export type OpenWorkspaceWithPayload = {
  ref: WorkspaceFileRef;
  handlerId: string;
};
export type WorkspaceNativeFileResult =
  | { ok: true }
  | { ok: false; error: WorkspaceNativeFileError };
export type FilePreviewTreeOptions = {
  maxDepth?: number;
  maxNodes?: number;
  includeHidden?: boolean;
};
export type FileReadBinaryPayload = FilePathPayload & { opts?: FileReadBinaryOptions };
export type FileWriteTextPayload = FilePathPayload & { content: string };
export type FileListTreePayload = FilePathPayload & { opts?: FilePreviewTreeOptions };
export type FilePreviewError =
  | 'outsideSandbox'
  | 'readOnlyRoot'
  | 'tooLarge'
  | 'binary'
  | 'notFound'
  | 'notDirectory'
  | 'invalidContent'
  | 'operationFailed'
  | (string & {});
export type ReadTextFileResult = {
  ok: boolean;
  content?: string;
  mimeType?: string;
  size?: number;
  readOnly?: boolean;
  error?: FilePreviewError;
};
export type ReadBinaryFileResult = {
  ok: boolean;
  data?: Uint8Array;
  mimeType?: string;
  size?: number;
  readOnly?: boolean;
  error?: FilePreviewError;
};
export type WriteTextFileResult = {
  ok: boolean;
  error?: FilePreviewError;
};
export type StatFileResult = {
  ok: boolean;
  size?: number;
  mtime?: number;
  isFile?: boolean;
  isDir?: boolean;
  readOnly?: boolean;
  error?: FilePreviewError;
};
export type FileListDirEntry = {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
};
export type FileListDirResult = {
  ok: boolean;
  entries?: FileListDirEntry[];
  error?: FilePreviewError;
};
export type FilePreviewTreeNode = {
  name: string;
  relPath: string;
  absPath: string;
  isDir: boolean;
  size?: number;
  mtime?: number;
  children?: FilePreviewTreeNode[];
};
export type FileListTreeResult = {
  ok: boolean;
  root?: FilePreviewTreeNode;
  truncated?: boolean;
  error?: FilePreviewError;
};

export type MediaThumbnailEntry = {
  filePath?: string;
  gatewayUrl?: string;
  attachmentFileRef?: AttachmentFileRef;
  key?: string;
  mimeType?: string;
};
export type MediaThumbnailsPayload = { paths: MediaThumbnailEntry[] };
export type MediaThumbnailResult = Record<string, { preview: string | null; fileSize: number }>;
export type SaveImagePayload = {
  base64?: string;
  mimeType?: string;
  filePath?: string;
  defaultFileName?: string;
};
export type ImageGenerationModelConfig = {
  primary: string | null;
  fallbacks: string[];
  timeoutMs: number | null;
};
export type ImageGenerationAgentAuthRow = {
  id: string;
  name: string;
  isDefault: boolean;
  provider: string | null;
  configured: boolean;
};
export type OpenAiImageRelayConfig = {
  enabled: boolean;
  baseUrl: string;
  model: string;
  providerKey?: string;
  apiKeyConfigured: boolean;
};
export type ImageGenerationSettingsSnapshot = {
  config: ImageGenerationModelConfig;
  autoProviderFallback: boolean;
  defaultAgentId: string;
  agents: ImageGenerationAgentAuthRow[];
  openAiRelay: OpenAiImageRelayConfig;
};
export type ImageGenerationProviderRow = {
  id: string;
  label: string;
  defaultModel: string;
  configured: boolean;
  available: boolean;
  selected: boolean;
  models: string[];
};
export type ImageGenerationSettingsPayload = {
  primary?: string | null;
  fallbacks?: string[];
  timeoutMs?: number | null;
  openAiRelayEnabled?: boolean;
  openAiRelayBaseUrl?: string | null;
  openAiRelayModel?: string | null;
  openAiRelayApiKey?: string;
};
export type ImageGenerationSettingsResult = OptionalHostSuccess & ImageGenerationSettingsSnapshot;
export type ImageGenerationProvidersResult = OptionalHostSuccess & {
  providers?: ImageGenerationProviderRow[];
};
export type ImageGenerationTestPayload = {
  agentId?: string;
  prompt?: string;
  model?: string;
};
export type ImageGenerationTestResult = {
  success: boolean;
  agentId: string;
  command: string;
  durationMs: number;
  error?: string;
  stdout?: string;
  stderr?: string;
  result?: unknown;
};

export type SessionHistoryPayload = {
  sessionKey?: string;
  agentId?: string;
  sessionId?: string;
  limit?: number;
};
export type SessionHistoryResult = OptionalHostSuccess & {
  messages?: RawMessage[];
};
export type SessionTurnTimingsPayload = { sessionKey: string; limit?: number };
export type SessionTurnTimingCandidate = {
  normalizedUserText: string;
  userOccurrenceFromTail: number;
  durationMs: number;
};
export type SessionTurnTimingsResult = OptionalHostSuccess & {
  timings?: SessionTurnTimingCandidate[];
};
export type SessionSummariesPayload = { sessionKeys?: string[]; limit?: number };
export type SessionLabelSummary = {
  sessionKey: string;
  firstUserText: string | null;
  lastTimestamp: number | null;
  workspacePath: string | null;
  heartbeatOnly?: boolean;
};
export type SessionSummariesResult = HostSuccess & {
  summaries?: SessionLabelSummary[];
};
export type SessionDeletePayload = { id: string; workflowRunIds?: string[] };
export type SessionDeleteResult = HostSuccess & { warnings?: string[] };
export type SessionRenamePayload = { id: string; title: string };

/** Which OpenClaw control-UI view to open. */
export type GatewayControlUiPayload = { view?: 'dreams' };
export type ChatMediaItem = { filePath: string; mimeType?: string; fileName?: string };
export type ChatSendWithMediaPayload = {
  sessionKey: string;
  message?: string;
  deliver?: boolean;
  idempotencyKey: string;
  media?: ChatMediaItem[];
};
export type ChatSendWithMediaResult = HostSuccess & {
  result?: { runId?: string };
};

export type CronUpdatePayload = { id: string; input: CronJobUpdateInput };
export type CronIdPayload = { id: string };
export type CronTogglePayload = CronIdPayload & { enabled: boolean };
export type CronSessionHistoryPayload = { sessionKey: string; limit?: number };
export type CronSessionHistoryResult = {
  messages?: RawMessage[];
};

export type SkillsStatusResult = {
  skills?: {
    skillKey: string;
    slug?: string;
    name?: string;
    description?: string;
    disabled?: boolean;
    emoji?: string;
    version?: string;
    author?: string;
    config?: Record<string, unknown>;
    bundled?: boolean;
    always?: boolean;
    source?: string;
    baseDir?: string;
    filePath?: string;
  }[];
};
export type LocalSkillsResult = HostSuccess & { skills?: Skill[] };
export type SkillConfigsResult = Record<string, { enabled?: boolean; apiKey?: string; env?: Record<string, string> }>;
export type SkillKeyPayload = { skillKey: string };
export type SkillUpdateConfigPayload = SkillKeyPayload & {
  enabled?: boolean;
  apiKey?: string;
  env?: Record<string, string>;
};
export type SkillUpdateConfigsPayload = { updates: SkillUpdateConfigPayload[] };
export type SkillUpdatePayload = SkillKeyPayload & { enabled?: boolean };
export type SkillQuickAccessPayload = { workspace?: string };
export type SkillMarketplaceFetchPayload = { query?: string; limit?: number; category?: string };
export type SkillMarketplaceInstallPayload = {
  slug?: string;
  name?: string;
  version?: string;
  installedVersion?: string;
  archiveHash?: string;
  archive_hash?: string;
  listingRevision?: string;
  listing_revision?: string;
  versionBase?: string;
  version_base?: string;
  category?: string;
  baseDir?: string;
  workspace?: string;
  sessionAgentId?: string;
  /** When true, overwrite same-name managed skills after UI confirm. */
  overwriteSameName?: boolean;
};
export type SkillAgentsMappingBatchPayload = {
  updates: Array<{ skillId: string; agentIds: string[] }>;
};
export type ClawHubInstalledSkill = {
  slug: string;
  version?: string;
  source?: string;
  baseDir?: string;
};
export type ClawHubCapabilityResult = HostSuccess & { capability?: JsonRecord };
export type ClawHubListResult = HostSuccess & {
  results?: ClawHubInstalledSkill[];
};
export type ClawHubSearchPayload = { query?: string };
export type ClawHubSearchResult = HostSuccess & {
  results?: MarketplaceSkill[];
};
export type ClawHubInstallPayload = {
  slug: string;
  version?: string;
  baseDir?: string;
  workspace?: string;
  sessionAgentId?: string;
};
export type ClawHubUninstallPayload = { slug: string };
export type ClawHubOpenPayload = {
  skillKey?: string;
  slug?: string;
  baseDir?: string;
};

export type UsageHistoryEntry = {
  timestamp: string;
  sessionId: string;
  agentId: string;
  model?: string;
  provider?: string;
  content?: string;
  usageStatus?: 'available' | 'missing' | 'error';
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd?: number;
};
export type UsageHistoryPayload = { limit?: number };

export type DeliveryChannelAccount = {
  accountId: string;
  name: string;
  isDefault: boolean;
};
export type DeliveryChannelGroup = {
  channelType: string;
  defaultAccountId: string;
  accounts: DeliveryChannelAccount[];
};
export type DeliveryTargetsResult = HostSuccess & { targets: DeliveryChannelGroup[] };

export type SkillUiSchemaPayload = { skillKey?: string; baseDir?: string };
export type SkillUiActionPayload = { command: string; interceptOAuth?: boolean };
export type SkillUiActionResult = { success: boolean; output?: string; error?: string };
export type SkillUploadMarketplacePayload = {
  filePath?: string;
  confirmUnsafe?: boolean;
  overwriteSameName?: boolean;
  author?: string;
  version?: string;
  category?: string;
};
export type SkillPublishedMarketplaceResult = HostSuccess & { skills?: JsonRecord[] };
export type SkillPublishMetaPayload = { filePath: string };
export type SkillPublishMetaResult = HostSuccess & {
  meta?: {
    /** OS username of the current client, used as the default author. */
    username?: string;
    /** Skill name parsed from the zip's SKILL.md (best-effort). */
    skillName?: string;
    /** Current published version for this skill on the marketplace, if any. */
    remoteVersion?: string;
  };
};
export type SkillUploadMarketplaceResult = HostSuccess & {
  result?: JsonRecord;
  pickedPath?: string;
  cancelled?: boolean;
};
export type SkillMarketplaceReviewRequestsResult = HostSuccess & { requests?: JsonRecord[] };
export type SkillUnlistPayload = { skillId: string };
export type SkillUnlistResult = HostSuccess & { result?: JsonRecord };
export type SkillCancelReviewPayload = { requestId: number };
export type SkillCancelReviewResult = HostSuccess & { result?: JsonRecord };
export type FileSaveAsPayload = { filePath: string; defaultFileName?: string };
export type FileSaveAsResult = HostSuccess & { savedPath?: string; cancelled?: boolean };
export type SaveAttachmentAsPayload = { ref: AttachmentSourceRef; defaultFileName?: string };
export type AsrPreset = 'openai' | 'groq' | 'siliconflow' | 'bailian' | 'custom';
export type AsrProtocol = 'transcriptions' | 'chat';
export type AsrConfig = {
  preset: AsrPreset;
  protocol?: AsrProtocol;
  baseUrl: string;
  model: string;
  language?: string;
};
export type AsrConfigPayload = { config: AsrConfig; apiKey?: string };
export type AsrMicrophoneAccessResult = {
  platform: 'darwin' | 'win32' | 'other';
  status: 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown';
  canOpenSettings: boolean;
};
export type AsrConfigResult = { configured: boolean; config: AsrConfig | null; hasApiKey: boolean };
export type AsrTranscribePayload = { wav: Uint8Array };
export type AsrTranscribeResult = { text: string };

export type HostApiContract = {
  app: {
    quit: () => void;
    feishuConfig: () => { appId: string };
    feishuLogin: (payload: { tmpCode: string }) => FeishuLoginResult;
    openClawDoctor: (payload: OpenClawDoctorPayload) => Omit<OpenClawDoctorResult, 'mode'>;
    sessionMaintenance: () => SessionMaintenanceConfig;
    saveSessionMaintenance: (payload: SessionMaintenancePayload) => SessionMaintenanceConfig;
    controlUiEnabled: () => boolean;
    setControlUiEnabled: (payload: ControlUiEnabledPayload) => boolean;
    openclawVersion: () => string;
  };
  openclaw: {
    status: () => OpenClawStatusResult;
    getConfigPath: () => string;
    getSkillsDir: () => string;
    getCliCommand: () => OpenClawCliCommandResult;
    getCompactionReserve: () => OpenClawCompactionReserveResult;
  };
  shell: {
    openExternal: (payload: ShellOpenExternalPayload) => void;
    openAuthWindow: (payload: ShellOpenAuthWindowPayload) => void;
    showItemInFolder: (payload: ShellPathPayload) => void;
    openPath: (payload: ShellPathPayload) => string;
    readClipboardText: () => string;
  };
  webBrowser: {
    navigate: (payload: WebBrowserNavigatePayload) => void;
    openExternal: (payload: WebBrowserNavigatePayload) => void;
  };
  dialog: {
    open: (payload: DialogOpenPayload) => DialogOpenResult;
    message: (payload: DialogMessagePayload) => DialogMessageResult;
  };
  window: {
    syncTrafficLightPosition: (payload: WindowSyncTrafficLightPayload) => void;
    minimize: () => void;
    maximize: () => void;
    close: () => void;
    isMaximized: () => boolean;
    /** Win32: blur→focus when our window is already focused but document.hasFocus() is false. Returns false if skipped. */
    ensureKeyboardFocus: () => boolean;
  };
  updates: {
    status: () => UpdateStatusSnapshot;
    version: () => string;
    check: () => UpdateCheckResult;
    download: () => HostSuccess;
    install: () => HostSuccess;
    setChannel: (payload: UpdateSetChannelPayload) => HostSuccess;
    setAutoDownload: (payload: UpdateSetAutoDownloadPayload) => HostSuccess;
    cancelAutoInstall: () => HostSuccess;
  };
  uv: {
    installAll: () => HostSuccess;
  };
  settings: {
    getAll: () => SettingsSnapshot;
    get: (payload: SettingsGetPayload) => SettingsValue;
    set: (payload: SettingsSetPayload) => HostSuccess;
    setMany: (payload: SettingsSetManyPayload) => HostSuccess;
    reset: () => SettingsResetResult;
  };
  computerUse: {
    status: () => ComputerUseStatus;
    setEnabled: (payload: { enabled: boolean }) => ComputerUseStatus;
    requestPermissions: () => ComputerUseStatus;
  };
  gateway: {
    pendingPortConflict: () => GatewayPortConflict | null;
    resolvePortConflict: (payload: { forceKill: boolean }) => void;
    status: () => GatewayStatus;
    start: () => HostSuccess;
    stop: () => HostSuccess;
    restart: () => HostSuccess;
    health: (payload?: GatewayHealthPayload) => GatewayHealth;
    controlUi: (payload?: GatewayControlUiPayload) => GatewayControlUiResult;
    rpc: (payload: GatewayRpcPayload) => unknown;
  };
  logs: {
    recent: (payload?: LogRecentPayload) => LogContentResult;
    memory: (payload?: LogMemoryPayload) => string[];
    dir: () => LogDirResult;
    filePath: () => LogFilePathResult;
    listFiles: () => LogFilesResult;
    readFile: (payload: LogReadFilePayload) => LogContentResult;
  };
  channels: {
    configured: () => ChannelConfiguredResult;
    accounts: (payload?: ChannelAccountsPayload) => ChannelAccountsResult;
    targets: (payload: ChannelTargetsPayload) => ChannelTargetsResult;
    setDefaultAccount: (payload: ChannelRequiredAccountPayload) => HostSuccess;
    bindingSave: (payload: ChannelBindingSavePayload) => HostSuccess;
    bindingDelete: (payload: ChannelBindingDeletePayload) => HostSuccess;
    validateConfig: (payload: ChannelTypePayload) => HostSuccess;
    validateCredentials: (payload: ChannelCredentialValidationPayload) => ChannelCredentialValidationResult;
    saveConfig: (payload: ChannelSaveConfigPayload) => ChannelSaveConfigResult;
    setEnabled: (payload: ChannelSetEnabledPayload) => HostSuccess;
    formValues: (payload: ChannelAccountPayload) => ChannelFormValuesResult;
    deleteConfig: (payload: ChannelAccountPayload) => HostSuccess;
    startLogin: (payload: ChannelAccountPayload) => HostSuccess;
    cancelLogin: (payload: ChannelAccountPayload) => HostSuccess;
    feishuCandidateIcons: () => FeishuCandidateIconsResult;
    feishuMyApps: () => FeishuMyAppsResult;
    feishuAppInfo: (payload: FeishuAppInfoPayload) => FeishuAppInfoResult;
    feishuAutoCreate: (payload: FeishuAutoCreatePayload) => FeishuAutoCreateResult;
    feishuUpdateApp: (payload: FeishuUpdateAppPayload) => FeishuUpdateAppResult;
    feishuDeleteApp: (payload: FeishuDeleteAppPayload) => FeishuDeleteAppResult;
    feishuRetryLarkCli: (payload: FeishuAppInfoPayload) => HostSuccess;
    dingtalkWorkspaceAuthStart: (payload: ChannelAccountPayload) => DingTalkWorkspaceAuthResult;
    dingtalkWorkspaceAuthStatus: (payload: ChannelAccountPayload) => DingTalkWorkspaceAuthResult;
    dingtalkWorkspaceAuthCancel: (payload: ChannelAccountPayload) => DingTalkWorkspaceAuthResult;
    dingtalkWorkspaceAuthReset: (payload: ChannelAccountPayload) => DingTalkWorkspaceAuthResult;
  };
  agents: {
    list: (payload?: { reconcile?: boolean }) => AgentSnapshotResult;
    create: (payload: AgentCreatePayload) => AgentSnapshotResult;
    update: (payload: AgentUpdatePayload) => AgentSnapshotResult;
    updateId: (payload: AgentUpdateIdPayload) => AgentSnapshotResult;
    updateModel: (payload: AgentUpdateModelPayload) => AgentSnapshotResult;
    updateDefaultModels: (payload: AgentUpdateDefaultModelsPayload) => AgentSnapshotResult;
    updateAutoSelect: (payload: AgentUpdateAutoSelectPayload) => AgentSnapshotResult;
    setDefault: (payload: AgentIdPayload) => AgentSnapshotResult;
    delete: (payload: AgentIdPayload) => AgentDeleteResult;
    assignChannel: (payload: AgentChannelPayload) => AgentSnapshotResult;
    removeChannel: (payload: AgentChannelPayload) => AgentSnapshotResult;
    updateGlobalSkills: (payload: AgentUpdateGlobalSkillsPayload) => AgentSnapshotResult;
    generateText: (payload: AgentGenerateTextPayload) => AgentGenerateTextResult;
  };
  diagnostics: {
    gatewaySnapshot: () => DiagnosticsGatewaySnapshotResult;
    acpTrace: () => AcpTraceSnapshot;
    recordAcpTrace: (payload: AcpTraceRecordPayload) => HostSuccess;
    exportIssueReport: (payload: IssueReportExportPayload) => IssueReportExportResult;
  };
  providers: {
    list: () => ProviderWithKeyInfo[];
    get: (payload: ProviderIdPayload) => ProviderConfig | null;
    getDefault: () => string | undefined;
    hasApiKey: (payload: ProviderIdPayload) => boolean;
    getApiKey: (payload: ProviderIdPayload) => string | null;
    validateKey: (payload: ProviderValidationPayload) => ProviderValidationResult;
    save: (payload: ProviderSavePayload) => HostSuccess;
    delete: (payload: ProviderIdPayload) => HostSuccess;
    setApiKey: (payload: ProviderApiKeyPayload) => HostSuccess;
    updateWithKey: (payload: ProviderUpdateWithKeyPayload) => HostSuccess;
    deleteApiKey: (payload: ProviderIdPayload) => HostSuccess;
    setDefault: (payload: ProviderIdPayload) => HostSuccess;
    accounts: () => ProviderAccount[];
    vendors: () => ProviderVendorInfo[];
    catalogSource: () => ProviderCatalogSourceInfo;
    accountKeyInfo: () => ProviderAccountKeyInfo[];
    getDefaultAccount: () => ProviderDefaultAccountResult;
    getAccount: (payload: ProviderAccountIdPayload) => ProviderAccount | null;
    getAccountApiKey: (payload: ProviderAccountIdPayload) => string | null;
    hasAccountApiKey: (payload: ProviderAccountIdPayload) => boolean;
    createAccount: (payload: ProviderCreateAccountPayload) => HostSuccess;
    updateAccount: (payload: ProviderUpdateAccountPayload) => HostSuccess;
    deleteAccount: (payload: ProviderAccountIdPayload) => HostSuccess;
    deleteAccountApiKey: (payload: ProviderAccountIdPayload) => HostSuccess;
    setDefaultAccount: (payload: ProviderAccountIdPayload) => HostSuccess;
    requestOAuth: (payload: ProviderOAuthRequestPayload) => HostSuccess;
    cancelOAuth: () => HostSuccess;
    submitOAuth: (payload: ProviderOAuthSubmitPayload) => HostSuccess;
  };
  files: {
    stagePaths: (payload: StagePathsPayload) => StagedFileResult[];
    stageBuffer: (payload: StageBufferPayload) => StagedFileResult;
    readText: (payload: FilePathPayload) => ReadTextFileResult;
    readBinary: (payload: FileReadBinaryPayload) => ReadBinaryFileResult;
    writeText: (payload: FileWriteTextPayload) => WriteTextFileResult;
    stat: (payload: FilePathPayload) => StatFileResult;
    listDir: (payload: FilePathPayload) => FileListDirResult;
    listTree: (payload: FileListTreePayload) => FileListTreeResult;
    saveAs: (payload: FileSaveAsPayload) => FileSaveAsResult;
    saveAttachmentAs: (payload: SaveAttachmentAsPayload) => FileSaveAsResult;
    resolveWorkspaceContext: (input: WorkspaceContextInput) => Promise<{
      ok: boolean;
      workspaceRoot?: string;
      executionCwd?: string;
      error?: FilePreviewError;
    }>;
    readWorkspaceText: (ref: WorkspaceFileRef) => Promise<ReadTextFileResult>;
    readWorkspaceBinary: (input: WorkspaceFileRef & { maxBytes?: number }) => Promise<ReadBinaryFileResult>;
    statWorkspaceFile: (ref: WorkspaceFileRef) => Promise<StatFileResult>;
    listWorkspaceOpenHandlers: (ref: WorkspaceFileRef) => Promise<WorkspaceOpenHandlersResult>;
    openWorkspaceWith: (payload: OpenWorkspaceWithPayload) => Promise<WorkspaceNativeFileResult>;
    revealWorkspaceFile: (ref: WorkspaceFileRef) => Promise<WorkspaceNativeFileResult>;
    resolveAttachment: (payload: ResolveAttachmentPayload) => ResolveAttachmentResult;
    readAttachmentText: (ref: AttachmentFileRef) => ReadAttachmentTextResult;
    readAttachmentBinary: (payload: ReadAttachmentBinaryPayload) => ReadAttachmentBinaryResult;
    openAttachment: (ref: AttachmentSourceRef) => OpenAttachmentResult;
    listAttachmentOpenHandlers: (ref: AttachmentFileRef) => Promise<AttachmentOpenHandlersResult>;
    openAttachmentWith: (payload: OpenAttachmentWithPayload) => Promise<OpenAttachmentResult>;
    revealAttachment: (ref: AttachmentFileRef) => Promise<OpenAttachmentResult>;
  };
  media: {
    thumbnails: (payload: MediaThumbnailsPayload) => MediaThumbnailResult;
    saveImage: (payload: SaveImagePayload) => JsonRecord;
    imageGenerationSettings: () => ImageGenerationSettingsResult;
    saveImageGenerationSettings: (payload: ImageGenerationSettingsPayload) => ImageGenerationSettingsResult;
    imageGenerationProviders: () => ImageGenerationProvidersResult;
    testImageGeneration: (payload: ImageGenerationTestPayload) => ImageGenerationTestResult;
  };
  sessions: {
    delete: (payload: SessionDeletePayload) => SessionDeleteResult;
    rename: (payload: SessionRenamePayload) => HostSuccess;
    summaries: (payload?: SessionSummariesPayload) => SessionSummariesResult;
    history: (payload: SessionHistoryPayload) => SessionHistoryResult;
    turnTimings: (payload: SessionTurnTimingsPayload) => SessionTurnTimingsResult;
  };
  chat: {
    sendWithMedia: (payload: ChatSendWithMediaPayload) => ChatSendWithMediaResult;
    getAcpSessionFamily: (payload: AcpSessionFamilyPayload) => AcpSessionFamilyResult;
    loadAcpSession: (payload: AcpChatLoadPayload) => AcpChatOperationResult;
    sendAcpPrompt: (payload: AcpChatPromptPayload) => AcpChatOperationResult;
    cancelAcpSession: (payload: AcpChatCancelPayload) => AcpChatOperationResult;
    respondAcpPermission: (payload: AcpChatRespondPermissionPayload) => AcpChatOperationResult;
  };
  cron: {
    list: () => CronJob[];
    create: (payload: CronJobCreateInput) => CronJob;
    update: (payload: CronUpdatePayload) => CronJob;
    delete: (payload: CronIdPayload) => HostSuccess;
    toggle: (payload: CronTogglePayload) => HostSuccess;
    trigger: (payload: CronIdPayload) => HostSuccess;
    sessionHistory: (payload: CronSessionHistoryPayload) => CronSessionHistoryResult;
    deliveryTargets: () => DeliveryTargetsResult;
  };
  skills: {
    local: () => LocalSkillsResult;
    configs: () => SkillConfigsResult;
    allConfigs: () => SkillConfigsResult;
    getConfig: (payload: SkillKeyPayload) => JsonRecord | undefined;
    updateConfig: (payload: SkillUpdateConfigPayload) => HostSuccess;
    updateConfigs: (payload: SkillUpdateConfigsPayload) => HostSuccess;
    status: () => SkillsStatusResult;
    update: (payload: SkillUpdatePayload) => HostSuccess;
    quickAccess: (payload: SkillQuickAccessPayload) => HostSuccess & { skills?: QuickAccessSkill[] };
    clawhubCapability: () => ClawHubCapabilityResult;
    clawhubList: () => ClawHubListResult;
    clawhubSearch: (payload: ClawHubSearchPayload) => ClawHubSearchResult;
    clawhubInstall: (payload: ClawHubInstallPayload) => HostSuccess;
    clawhubUninstall: (payload: ClawHubUninstallPayload) => HostSuccess;
    clawhubOpenSkillReadme: (payload: ClawHubOpenPayload) => HostSuccess;
    clawhubOpenSkillPath: (payload: ClawHubOpenPayload) => HostSuccess;
    marketplaceList: (payload?: SkillMarketplaceFetchPayload) => HostSuccess & { results?: MarketplaceSkill[] };
    marketplaceSearch: (payload: SkillMarketplaceFetchPayload) => HostSuccess & { results?: MarketplaceSkill[] };
    marketplaceInstall: (payload: SkillMarketplaceInstallPayload) => HostSuccess;
    marketplaceUninstall: (payload: SkillMarketplaceInstallPayload) => HostSuccess;
    updateAgentsMappingBatch: (payload: SkillAgentsMappingBatchPayload) => HostSuccess;
    getUiSchema: (payload: SkillUiSchemaPayload) => JsonRecord | null;
    executeUiAction: (payload: SkillUiActionPayload) => SkillUiActionResult;
    listPublishedMarketplace: () => SkillPublishedMarketplaceResult;
    getPublishMeta: (payload: SkillPublishMetaPayload) => SkillPublishMetaResult;
    uploadMarketplaceZip: (payload: SkillUploadMarketplacePayload) => SkillUploadMarketplaceResult;
    listMarketplaceReviewRequests: () => SkillMarketplaceReviewRequestsResult;
    requestMarketplaceUnlist: (payload: SkillUnlistPayload) => SkillUnlistResult;
    cancelMarketplaceReviewRequest: (payload: SkillCancelReviewPayload) => SkillCancelReviewResult;
  };
  usage: {
    recentTokenHistory: (payload?: UsageHistoryPayload) => UsageHistoryEntry[];
  };
  adminConsole: {
    sessionSendRemote: (payload: AdminConsoleSessionSendRemotePayload) => AdminConsoleRemoteResult;
    sessionListRemote: (payload: AdminConsoleSessionListRemotePayload) => AdminConsoleRemoteResult;
    sessionHistoryRemote: (payload: AdminConsoleSessionHistoryRemotePayload) => AdminConsoleRemoteResult;
    sessionStatusRemote: (payload: AdminConsoleSessionStatusRemotePayload) => AdminConsoleRemoteResult;
    sharedWorkspaceSync: (payload: AdminConsoleSharedWorkspaceSyncPayload) => AdminConsoleRemoteResult;
  };
  voice: {
    configStatus: () => VoiceConfigStatusResult;
    selections: () => VoiceSelectionsResult;
    transcribe: (payload: VoiceTranscribePayload) => VoiceTranscribeResult;
    ttsAudio: (payload: VoiceTtsAudioPayload) => VoiceTtsAudioResult;
    setTtsAccount: (payload: VoiceAccountPayload) => HostSuccess;
    clearTtsAccount: () => HostSuccess;
    setTranscriptionAccount: (payload: VoiceAccountPayload) => HostSuccess;
    clearTranscriptionAccount: () => HostSuccess;
  };
  workspace: {
    agents: () => WorkspaceAgentsResult;
    tree: (payload: WorkspaceTreePayload) => WorkspaceTreeResult;
    rebuild: (payload: WorkspaceRebuildPayload) => WorkspaceRebuildResult;
    deleteFile: (payload: WorkspaceFilePayload) => WorkspaceDeleteFileResult;
  };
  promptOptimization: {
    activeRun: () => PromptOptimizationActiveRunResult;
    registerRun: (payload: PromptOptimizationRegisterPayload) => HostSuccess;
    record: (payload: PromptOptimizationRecordPayload) => HostSuccess;
    summary: (payload: PromptOptimizationSummaryPayload) => PromptOptimizationSummaryResult;
  };
  workflow: {
    list: () => WorkflowListResult;
    start: (payload: WorkflowStartPayload) => WorkflowStartResult;
    resume: (payload: WorkflowRunIdPayload) => WorkflowResumeResult;
    retry: (payload: WorkflowRunIdPayload) => WorkflowRetryResult;
    abort: (payload: WorkflowRunIdPayload) => WorkflowAbortResult;
    status: (payload: WorkflowRunIdPayload) => WorkflowStatusResult;
    startDynamic: (payload: WorkflowStartDynamicPayload) => WorkflowStartDynamicResult;
  };
  legacy: {
    fetch: (payload: LegacyFetchPayload) => LegacyFetchResult;
  };
  asr: {
    getMicrophoneAccess: () => AsrMicrophoneAccessResult;
    openMicrophoneSettings: () => { opened: boolean };
    getConfig: () => AsrConfigResult;
    saveConfig: (payload: AsrConfigPayload) => AsrConfigResult;
    transcribe: (payload: AsrTranscribePayload) => AsrTranscribeResult;
  };
};

export type HostApiModule = keyof HostApiContract & string;
export type HostApiAction<M extends HostApiModule> = keyof HostApiContract[M] & string;
export type HostApiFunction<
  M extends HostApiModule,
  A extends HostApiAction<M>,
> = HostApiContract[M][A] extends (...args: infer Args) => infer Result
  ? (...args: Args) => Result
  : never;
export type HostApiPayload<
  M extends HostApiModule,
  A extends HostApiAction<M>,
> = Parameters<HostApiFunction<M, A>> extends []
  ? undefined
  : Parameters<HostApiFunction<M, A>>[0];
export type HostApiResult<
  M extends HostApiModule,
  A extends HostApiAction<M>,
> = Awaited<ReturnType<HostApiFunction<M, A>>>;
export type HostApiPayloadArgs<
  M extends HostApiModule,
  A extends HostApiAction<M>,
> = Parameters<HostApiFunction<M, A>> extends []
  ? []
  : undefined extends HostApiPayload<M, A>
    ? [payload?: HostApiPayload<M, A>]
    : [payload: HostApiPayload<M, A>];
