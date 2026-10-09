/**
 * Chat Input Component
 * Textarea with send button and universal file upload support.
 * Enter to send, Shift+Enter for new line.
 * Supports: native file picker, clipboard paste, drag & drop.
 * Files are staged through the typed Host API and included as local media
 * references in the ACP session/prompt request.
 */
import {
  useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo,
  type SetStateAction,
} from 'react';
import { SendHorizontal, Square, X, Paperclip, FileText, Film, Music, FileArchive, File, FolderOpen, Loader2, AtSign, Search, ChevronDown, Mic, Check, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { hostApi } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import { useGatewayStore } from '@/stores/gateway';
import { useSettingsStore } from '@/stores/settings';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useArtifactPanel } from '@/stores/artifact-panel';
import { buildPreviewTarget } from '@/components/file-preview/build-preview-target';
import { useProviderStore } from '@/stores/providers';
import { buildConfiguredModelOptions, formatModelRefLabel, resolveConfiguredModelRef } from '@/lib/model-options';
import { buildEnhancePromptGenPrompt } from '@/lib/enhance-prompt';
import type { AgentSummary } from '@/types/agent';
import type { QuickAccessSkill } from '@/types/skill';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { toast as appToast } from '@/lib/toast';
import { rendererExtensionRegistry } from '@/extensions/registry';
import { collectDroppedFiles } from '@/lib/collect-dropped-files';
import { fetchQuickAccessSkills } from '@/lib/quick-access-skills';
import { useSkillWorkflowStore } from '@/stores/skill-workflow';
import { startDictation, type DictationHandle } from '@/lib/voice/dictation';
import { TalkOverlay } from './TalkOverlay';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DEFAULT_WORKSPACE_CWD, isDefaultWorkspacePath, normalizeWorkspacePath } from '@/lib/workspace-context';
import type { AcpCurrentPlan } from '@/lib/acp/current-plan';
import { MicrophonePermissionDialog } from '@/components/voice/MicrophonePermissionDialog';
import type { AsrMicrophoneAccessResult } from '@shared/host-api/contract';
import { AcpSessionPlan } from './AcpSessionPlan';
import { AcpSubagentSessions, type AcpSubagentSession } from './AcpSubagentSessions';

// Sensitive-task origin gate (mirrors electron/shared/model-routing/select-model —
// kept local to avoid coupling the renderer to the electron project boundary).
const SENSITIVE_RE = /机密|保密|涉密|绝密|秘密|内部(资料|文件|使用|文档)?|不(得|要)?外传|仅(限)?内部|商业机密|敏感(信息|数据)|隐私|\b(confidential|secret|classified|proprietary|sensitive|nda|internal[- ]only|do not share)\b/i;
type ModelOrigin = 'private' | 'domestic' | 'overseas';
function sensitiveOriginOrder(language?: string): ModelOrigin[] {
  return (language ?? '').toLowerCase().startsWith('zh')
    ? ['private', 'domestic', 'overseas']
    : ['private', 'overseas', 'domestic'];
}
function originLabel(origin: ModelOrigin, language?: string): string {
  const zh = (language ?? '').toLowerCase().startsWith('zh');
  const map: Record<ModelOrigin, [string, string]> = {
    private: ['私有', 'private'],
    domestic: ['国内', 'domestic'],
    overseas: ['海外', 'overseas'],
  };
  return map[origin][zh ? 0 : 1];
}

// ── Types ────────────────────────────────────────────────────────

export interface FileAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  stagedPath: string;        // Host-authorized source or buffer-staging path included in ACP prompt media
  sourceKind: 'path' | 'buffer';
  preview: string | null;    // data URL for images, null for others
  status: 'staging' | 'ready' | 'error';
  error?: string;
}

export interface ChatWorkspaceOption {
  path: string;
  label: string;
}

type ComposerExpandedPanel = 'subagents' | 'plan' | null;

interface ChatInputProps {
  onSend: (text: string, attachments?: FileAttachment[], targetAgentId?: string | null) => void;
  onStop?: () => void;
  draft?: string;
  draftKey?: string;
  onDraftChange?: (update: SetStateAction<string>) => void;
  disabled?: boolean;
  sending?: boolean;
  statusOnly?: boolean;
  imageGenerating?: boolean;
  workspaceLabel?: string;
  workspacePath?: string;
  workspaceOptions?: ChatWorkspaceOption[];
  workspaceReadOnly?: boolean;
  onSelectWorkspace?: (path: string) => void;
  /** This-conversation-only model override (not persisted to the agent's config). */
  sessionModelOverride?: string | null;
  /** Switch (or clear, when `modelRef` is null) the temporary per-conversation model override. */
  onSelectModel?: (modelRef: string | null) => void | Promise<void>;
  contextUsage?: unknown;
  currentPlan?: AcpCurrentPlan | null;
  subagentSessions?: AcpSubagentSession[];
  onSelectSubagent?: (sessionKey: string) => void;
}

// ── Helpers ──────────────────────────────────────────────────────

const DIRECTORY_MIME_TYPE = 'application/x-directory';

type ContextUsage = {
  used: number;
  size: number;
  percent: number;
};

function getContextUsage(value: unknown, modelContextWindow?: number): ContextUsage | null {
  if (!value || typeof value !== 'object') return null;
  const { used, size: reportedSize } = value as Record<string, unknown>;
  if (
    typeof used !== 'number'
    || typeof reportedSize !== 'number'
    || !Number.isFinite(used)
    || !Number.isFinite(reportedSize)
    || used < 0
    || reportedSize <= 0
  ) return null;

  const size = typeof modelContextWindow === 'number'
    && Number.isFinite(modelContextWindow)
    && modelContextWindow > 0
    ? Math.floor(modelContextWindow)
    : reportedSize;
  return {
    used,
    size,
    percent: Math.min(100, Math.max(0, (used / size) * 100)),
  };
}

function ContextUsageIndicator({
  usage,
  label,
  percentageLabel,
}: {
  usage: ContextUsage;
  label: string;
  percentageLabel: string;
}) {
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const roundedPercent = Math.round(usage.percent);
  const strokeDashoffset = circumference * (1 - usage.percent / 100);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="progressbar"
          tabIndex={0}
          data-testid="chat-composer-context-usage"
          data-percent={roundedPercent}
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={roundedPercent}
          aria-valuetext={label}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        >
          <svg viewBox="0 0 20 20" className="h-3 w-3 text-primary" aria-hidden="true">
            <circle cx="10" cy="10" r={radius} fill="none" stroke="currentColor" strokeWidth="2" className="text-black/10 dark:text-white/15" />
            <circle
              cx="10"
              cy="10"
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              transform="rotate(-90 10 10)"
            />
          </svg>
          <span aria-hidden="true" className="text-tiny font-medium tabular-nums">
            {percentageLabel}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getSkillPrefix(skillName: string): string {
  return `/${skillName}  `;
}

function needsLeadingSkillSpace(value: string, position: number): boolean {
  return position > 0 && !/\s/.test(value[position - 1] ?? '');
}

type SkillTokenRange = { start: number; end: number };

function findSkillTokenRange(value: string, skillName: string): SkillTokenRange | null {
  const token = getSkillPrefix(skillName);
  const start = value.indexOf(token);
  if (start === -1) return null;
  return { start, end: start + token.length };
}

function findSkillTokenRanges(value: string): SkillTokenRange[] {
  const ranges: SkillTokenRange[] = [];
  const skillTokenPattern = /\/[^\s]+ {2}/g;
  let match: RegExpExecArray | null;
  while ((match = skillTokenPattern.exec(value)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return ranges;
}

function removeSkillToken(value: string, skillName: string): string {
  const range = findSkillTokenRange(value, skillName);
  if (!range) return value;
  return `${value.slice(0, range.start)}${value.slice(range.end)}`;
}

const SKILL_TOKEN_CLASS =
  'clawx-skill-token-overlay pointer-events-auto cursor-pointer rounded-md text-skill-fg underline-offset-2 hover:underline [-webkit-box-decoration-break:clone] [box-decoration-break:clone] [text-shadow:0_0_10px_rgba(47,107,255,0.38)] dark:text-skill-fg-dark dark:[text-shadow:0_0_12px_rgba(37,99,235,0.42)]';

function renderHighlightedComposerText(
  value: string,
  tokenRanges: SkillTokenRange[],
  options: { onPreviewSkill: (skillName: string) => void; previewTooltip: string },
) {
  if (tokenRanges.length === 0) {
    return <>{value}{value.endsWith('\n') ? '\n' : '\u200b'}</>;
  }

  const chunks: React.ReactNode[] = [];
  let cursor = 0;

  for (const tokenRange of tokenRanges) {
    const token = value.slice(tokenRange.start, tokenRange.end);
    const tokenLabel = token.trimEnd();
    const tokenTrailingSpace = token.slice(tokenLabel.length);
    const skillName = tokenLabel.startsWith('/') ? tokenLabel.slice(1) : tokenLabel;

    if (tokenRange.start > cursor) {
      chunks.push(value.slice(cursor, tokenRange.start));
    }
    chunks.push(
      <span
        key={`skill-token-${tokenRange.start}`}
        data-testid="chat-composer-skill-token"
        data-skill-name={skillName}
        title={options.previewTooltip}
        className={SKILL_TOKEN_CLASS}
        onMouseDown={(event) => {
          // Keep focus in the textarea while still receiving the click.
          event.preventDefault();
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          options.onPreviewSkill(skillName);
        }}
      >
        {tokenLabel}
      </span>,
      tokenTrailingSpace,
    );
    cursor = tokenRange.end;
  }

  if (cursor < value.length) {
    chunks.push(value.slice(cursor));
  }
  chunks.push(value.endsWith('\n') ? '\n' : '\u200b');

  return <>{chunks}</>;
}

function FileIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  if (mimeType === DIRECTORY_MIME_TYPE) return <FolderOpen className={className} />;
  if (mimeType.startsWith('video/')) return <Film className={className} />;
  if (mimeType.startsWith('audio/')) return <Music className={className} />;
  if (mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/xml') return <FileText className={className} />;
  if (mimeType.includes('zip') || mimeType.includes('compressed') || mimeType.includes('archive') || mimeType.includes('tar') || mimeType.includes('rar') || mimeType.includes('7z')) return <FileArchive className={className} />;
  if (mimeType === 'application/pdf') return <FileText className={className} />;
  return <File className={className} />;
}

/**
 * Read a browser File object as base64 string (without the data URL prefix).
 */
function readFileAsBase64(file: globalThis.File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (!dataUrl || !dataUrl.includes(',')) {
        reject(new Error(`Invalid data URL from FileReader for ${file.name}`));
        return;
      }
      const base64 = dataUrl.split(',')[1];
      if (!base64) {
        reject(new Error(`Empty base64 data for ${file.name}`));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

// ── Component ────────────────────────────────────────────────────

export function ChatInput({
  onSend,
  onStop,
  draft,
  draftKey,
  onDraftChange,
  disabled = false,
  sending = false,
  statusOnly = false,
  imageGenerating = false,
  workspaceLabel,
  workspacePath,
  workspaceOptions = [],
  workspaceReadOnly = false,
  onSelectWorkspace,
  sessionModelOverride = null,
  onSelectModel,
  contextUsage,
  currentPlan,
  subagentSessions = [],
  onSelectSubagent,
}: ChatInputProps) {
  const { t, i18n } = useTranslation('chat');
  const [uncontrolledInput, setUncontrolledInput] = useState('');
  const input = onDraftChange ? (draft ?? '') : uncontrolledInput;
  const setInput = useCallback((update: SetStateAction<string>) => {
    if (onDraftChange) onDraftChange(update);
    else setUncontrolledInput(update);
  }, [onDraftChange]);
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [targetAgentId, setTargetAgentId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState('');
  const [quickSkills, setQuickSkills] = useState<QuickAccessSkill[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<QuickAccessSkill | null>(null);
  const [switchingModelRef, setSwitchingModelRef] = useState<string | null>(null);
  const [enhancingPrompt, setEnhancingPrompt] = useState(false);
  // Actual model the gateway used for the latest turn (from usage/transcript —
  // reflects per-turn auto-select overrides, unlike the configured model above).
  const [micState, setMicState] = useState<'idle' | 'starting' | 'recording' | 'transcribing'>('idle');
  const [talkOpen, setTalkOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const draftSelectionsRef = useRef(new Map<string, {
    start: number;
    end: number;
    direction: 'forward' | 'backward' | 'none';
  }>());
  const pickerRef = useRef<HTMLDivElement>(null);
  const skillPickerRef = useRef<HTMLDivElement>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);
  const contextUsageSourceRef = useRef<{ value: unknown; modelRef: string | null } | undefined>(undefined);
  const isComposingRef = useRef(false);
  const dictationHandleRef = useRef<DictationHandle | null>(null);
  const dictationBaseRef = useRef('');
  const gatewayStatus = useGatewayStore((s) => s.status);
  const agents = useAgentsStore((s) => s.agents);
  const defaultModelRef = useAgentsStore((s) => s.defaultModelRef);
  // Same action the Agents page uses for its auto-select toggle, so the picker
  // and that page stay one source of truth.
  const updateAgentAutoSelect = useAgentsStore((s) => s.updateAgentAutoSelect);
  const providerAccounts = useProviderStore((s) => s.accounts);
  const providerStatuses = useProviderStore((s) => s.statuses);
  const providerDefaultAccountId = useProviderStore((s) => s.defaultAccountId);
  const providerVendors = useProviderStore((s) => s.vendors);
  const refreshProviderSnapshot = useProviderStore((s) => s.refreshProviderSnapshot);
  const voiceInputMode = useSettingsStore((s) => s.voiceInputMode);
  const language = useSettingsStore((s) => s.language);
  const voiceTranscriptionCap = useSettingsStore((s) => s.voiceCaps?.transcription ?? false);
  const voiceRealtimeCap = useSettingsStore((s) => s.voiceCaps?.realtime ?? false);
  const refreshVoiceCapabilities = useSettingsStore((s) => s.refreshVoiceCapabilities);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const currentAgent = useMemo(
    () => (agents ?? []).find((agent) => agent.id === currentAgentId) ?? null,
    [agents, currentAgentId],
  );
  const currentAgentName = useMemo(
    () => currentAgent?.name ?? currentAgentId,
    [currentAgent, currentAgentId],
  );
  // ── Sensitive-task origin gate state ──────────────────────────────────────
  const sensitiveConfirmedRef = useRef(false);
  const sensitiveResolveRef = useRef<((ok: boolean) => void) | null>(null);
  const [sensitivePrompt, setSensitivePrompt] = useState<{ tierLabel: string } | null>(null);
  useEffect(() => {
    sensitiveConfirmedRef.current = false;
  }, [currentAgentId]);
  /** Origins among the user's enabled provider accounts (from catalog ModelMeta). */
  const availableOrigins = useMemo(() => {
    const set = new Set<ModelOrigin>();
    const vendorById = new Map(providerVendors.map((v) => [v.id, v]));
    for (const acc of providerAccounts) {
      if (acc.enabled === false) continue;
      const vendor = vendorById.get(acc.vendorId);
      for (const m of Object.values(vendor?.models ?? {})) {
        const o = (m as { origin?: ModelOrigin } | undefined)?.origin;
        if (o) set.add(o);
      }
    }
    return set;
  }, [providerAccounts, providerVendors]);
  const modelOptions = useMemo(
    () => buildConfiguredModelOptions(
      providerAccounts,
      providerStatuses,
      providerVendors,
      providerDefaultAccountId,
    ),
    [providerAccounts, providerDefaultAccountId, providerStatuses, providerVendors],
  );
  // Text-capable subset for the this-conversation-only picker below the
  // composer — voice/image-generation-only accounts don't make sense there,
  // but vision-capable chat models (text + image) must stay listed.
  const textModelOptions = useMemo(
    () => buildConfiguredModelOptions(
      providerAccounts,
      providerStatuses,
      providerVendors,
      providerDefaultAccountId,
      { includeKinds: ['text'] },
    ),
    [providerAccounts, providerDefaultAccountId, providerStatuses, providerVendors],
  );
  const configuredModelRef = useMemo(
    () => resolveConfiguredModelRef(currentAgent?.modelRef, defaultModelRef, modelOptions),
    [currentAgent?.modelRef, defaultModelRef, modelOptions],
  );
  // The temporary, this-conversation-only override (if any) always wins over
  // the agent's configured model, but is never persisted to openclaw.json.
  const effectiveModelRef = sessionModelOverride || configuredModelRef;
  const currentModelLabel = useMemo(() => {
    const matchedOption = modelOptions.find((option) => option.modelRef === effectiveModelRef);
    return matchedOption?.label || formatModelRefLabel(effectiveModelRef);
  }, [effectiveModelRef, modelOptions]);
  // Whether this agent routes each turn through the model router instead of
  // pinning one model. Toggled from the composer's model picker — unlike the
  // per-conversation override above, this is persisted on the agent.
  const autoSelectOn = !!currentAgent?.autoSelectModel?.model;
  const mentionableAgents = useMemo(
    () => (agents ?? []).filter((agent) => agent.id !== currentAgentId),
    [agents, currentAgentId],
  );
  const selectedTarget = useMemo(
    () => (agents ?? []).find((agent) => agent.id === targetAgentId) ?? null,
    [agents, targetAgentId],
  );
  const filteredQuickSkills = useMemo(() => {
    const query = skillQuery.trim().toLowerCase();
    if (!query) return quickSkills;
    return quickSkills.filter((skill) =>
      skill.name.toLowerCase().includes(query)
      || skill.description.toLowerCase().includes(query)
      || skill.sourceLabel.toLowerCase().includes(query),
    );
  }, [quickSkills, skillQuery]);
  const showAgentPicker = mentionableAgents.length > 0;
  const chatComposerStatusComponents = rendererExtensionRegistry.getChatComposerStatusComponents();
  const isGatewayUsable = gatewayStatus.state === 'running' && gatewayStatus.gatewayReady !== false;
  const hasAgents = (agents ?? []).length > 0;
  const showModelPicker = hasAgents && textModelOptions.length > 0;
  const inputDisabled = disabled || !isGatewayUsable || !hasAgents || !!switchingModelRef;
  const attachmentsLocked = inputDisabled;
  const workspaceSelectorDisabled = workspaceReadOnly || inputDisabled || sending || !onSelectWorkspace;
  const skillTokenRanges = useMemo(() => findSkillTokenRanges(input), [input]);
  const openArtifactPreview = useArtifactPanel((s) => s.openPreview);
  const [microphoneAccess, setMicrophoneAccess] = useState<AsrMicrophoneAccessResult | null>(null);
  if (!contextUsageSourceRef.current || contextUsageSourceRef.current.value !== contextUsage) {
    contextUsageSourceRef.current = { value: contextUsage, modelRef: effectiveModelRef };
  }
  const selectedModelOption = modelOptions.find((option) => option.modelRef === effectiveModelRef);
  const selectedModelAccount = providerAccounts.find((account) => account.id === selectedModelOption?.accountId);
  const selectedModelVendor = providerVendors.find((vendor) => vendor.id === selectedModelAccount?.vendorId);
  const selectedModelContextWindow = selectedModelOption
    ? selectedModelVendor?.models?.[selectedModelOption.modelId]?.contextWindow
    : undefined;
  const contextWindowOverride = contextUsageSourceRef.current.modelRef === effectiveModelRef
    ? undefined
    : effectiveModelRef === currentAgent?.modelRef
      ? currentAgent.contextWindow
      : selectedModelContextWindow;
  const activeContextUsage = getContextUsage(contextUsage, contextWindowOverride);
  const contextUsagePercentage = activeContextUsage
    ? new Intl.NumberFormat(i18n.resolvedLanguage, { style: 'percent', maximumFractionDigits: 0 }).format(activeContextUsage.percent / 100)
    : null;
  const contextUsageLabel = activeContextUsage && contextUsagePercentage
    ? t('composer.contextUsage', {
      percentage: contextUsagePercentage,
      used: new Intl.NumberFormat(i18n.resolvedLanguage).format(activeContextUsage.used),
      total: new Intl.NumberFormat(i18n.resolvedLanguage).format(activeContextUsage.size),
    })
    : null;
  useEffect(() => {
    void refreshProviderSnapshot();
  }, [refreshProviderSnapshot]);

  useEffect(() => {
    if (isGatewayUsable) void refreshVoiceCapabilities();
  }, [isGatewayUsable, refreshVoiceCapabilities]);

  useEffect(() => {
    if (gatewayStatus.state === 'running') return;
    let cancelled = false;
    hostApi.gateway.status()
      .then((status) => {
        if (cancelled) return;
        if (status.state === 'running') {
          void refreshProviderSnapshot();
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [gatewayStatus.state, refreshProviderSnapshot]);

  useEffect(() => {
    if (workspaceSelectorDisabled) {
      setWorkspaceMenuOpen(false);
    }
  }, [workspaceSelectorDisabled]);

  useEffect(() => {
    if (!inputDisabled) return;
    setPickerOpen(false);
    setSkillPickerOpen(false);
    setModelPickerOpen(false);
    setWorkspaceMenuOpen(false);
  }, [inputDisabled]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 240)}px`;
    }
  }, [input]);

  const rememberDraftSelection = useCallback((textarea = textareaRef.current) => {
    if (!draftKey || !textarea) return;
    draftSelectionsRef.current.set(draftKey, {
      start: textarea.selectionStart ?? 0,
      end: textarea.selectionEnd ?? 0,
      direction: textarea.selectionDirection ?? 'none',
    });
  }, [draftKey]);

  // Focus the composer when it becomes available. When changing conversations,
  // restore that conversation's last selection instead of leaving the controlled
  // textarea at the position produced while React swapped its value.
  useLayoutEffect(() => {
    if (inputDisabled || !textareaRef.current) return;
    const textarea = textareaRef.current;
    textarea.focus();
    if (!draftKey) return;

    const savedSelection = draftSelectionsRef.current.get(draftKey);
    const fallbackPosition = textarea.value.length;
    const start = Math.min(savedSelection?.start ?? fallbackPosition, fallbackPosition);
    const end = Math.max(start, Math.min(savedSelection?.end ?? start, fallbackPosition));
    textarea.setSelectionRange(start, end, savedSelection?.direction ?? 'none');
  }, [draftKey, inputDisabled]);

  useEffect(() => {
    if (!targetAgentId) return;
    if (targetAgentId === currentAgentId) {
      setTargetAgentId(null);
      setPickerOpen(false);
      return;
    }
    if (!(agents ?? []).some((agent) => agent.id === targetAgentId)) {
      setTargetAgentId(null);
      setPickerOpen(false);
    }
  }, [agents, currentAgentId, targetAgentId]);

  useEffect(() => {
    if (!pickerOpen && !skillPickerOpen && !modelPickerOpen && !workspaceMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const insideAgentPicker = pickerRef.current?.contains(target);
      const insideSkillPicker = skillPickerRef.current?.contains(target);
      const insideModelPicker = modelPickerRef.current?.contains(target);
      const insideWorkspaceMenu = workspaceMenuRef.current?.contains(target);
      if (!insideAgentPicker && !insideSkillPicker && !insideModelPicker && !insideWorkspaceMenu) {
        setPickerOpen(false);
        setSkillPickerOpen(false);
        setModelPickerOpen(false);
        setWorkspaceMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [modelPickerOpen, pickerOpen, skillPickerOpen, workspaceMenuOpen]);

  useEffect(() => {
    if (!pickerOpen && !skillPickerOpen && !modelPickerOpen && !workspaceMenuOpen) return;
    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setPickerOpen(false);
      setSkillPickerOpen(false);
      setModelPickerOpen(false);
      setWorkspaceMenuOpen(false);
    };
    document.addEventListener('keydown', handleDocumentKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleDocumentKeyDown, true);
    };
  }, [modelPickerOpen, pickerOpen, skillPickerOpen, workspaceMenuOpen]);

  useEffect(() => {
    setSelectedSkill((prev) => {
      if (prev) {
        setInput((currentInput) => removeSkillToken(currentInput, prev.name));
      }
      return null;
    });
    setSkillPickerOpen(false);
    setWorkspaceMenuOpen(false);
    setSkillQuery('');
    setQuickSkills([]);
    setSkillsError(null);
  }, [currentAgentId, setInput]);

  useEffect(() => {
    if (!selectedSkill) return;
    const tokenRange = findSkillTokenRange(input, selectedSkill.name);
    if (!tokenRange) {
      setSelectedSkill(null);
    }
  }, [input, selectedSkill]);

  const handleInputChange = useCallback((value: string) => {
    setInput(value);
  }, [setInput]);

  const moveCaretTo = useCallback((position: number) => {
    const move = () => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(position, position);
      rememberDraftSelection();
    };
    move();
    requestAnimationFrame(move);
  }, [rememberDraftSelection]);

  const handleComposerSelection = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const selectionStart = textarea.selectionStart ?? 0;
    const selectionEnd = textarea.selectionEnd ?? 0;
    if (selectionStart === selectionEnd) {
      const tokenRange = skillTokenRanges.find((range) => selectionStart > range.start && selectionStart < range.end);
      if (tokenRange) {
        moveCaretTo(tokenRange.end);
        return;
      }
    }
    rememberDraftSelection(textarea);
  }, [moveCaretTo, rememberDraftSelection, skillTokenRanges]);

  const loadQuickSkills = useCallback(async (): Promise<QuickAccessSkill[]> => {
    if (!currentAgent) {
      setQuickSkills([]);
      setSkillsError(null);
      return [];
    }
    setSkillsLoading(true);
    setSkillsError(null);
    try {
      const result = await fetchQuickAccessSkills({
        workspace: currentAgent.workspace,
        agentDir: currentAgent.agentDir,
      });
      if (!result.success) {
        throw new Error(result.error || 'Failed to load skills');
      }
      const list = result.skills || [];
      setQuickSkills(list);
      useSkillWorkflowStore.getState().ingest(list);
      return list;
    } catch (error) {
      setQuickSkills([]);
      setSkillsError(String(error));
      return [];
    } finally {
      setSkillsLoading(false);
    }
  }, [currentAgent]);

  const handleSkillTokenPreview = useCallback(async (skillName: string) => {
    let list = quickSkills;
    if (list.length === 0 && currentAgent) {
      list = await loadQuickSkills();
    }
    const skill = list.find((entry) => entry.name === skillName);
    if (!skill) {
      toast.error(
        t('composer.skillPreviewNotFound', 'Could not find this skill. Open the skill picker to refresh the list.'),
      );
      return;
    }
    openArtifactPreview(buildPreviewTarget(skill.manifestPath));
  }, [quickSkills, currentAgent, loadQuickSkills, openArtifactPreview, t]);

  useEffect(() => {
    if (!skillPickerOpen) return;
    void loadQuickSkills();
  }, [skillPickerOpen, loadQuickSkills]);

  // Proactively cache workflow-shape skill metadata so the implicit path (model
  // auto-invokes a skill) can decide whether to show an observed-workflow card
  // even if the user never opens the skill picker.
  useEffect(() => {
    if (!currentAgent) return;
    void useSkillWorkflowStore.getState().refresh({
      workspace: currentAgent.workspace,
      agentDir: currentAgent.agentDir,
    });
  }, [currentAgent]);

  const handleSelectModel = useCallback((modelRef: string | null) => {
    if (!currentAgent || switchingModelRef) return;
    if ((modelRef ?? null) === (sessionModelOverride ?? null) && !autoSelectOn) {
      setModelPickerOpen(false);
      textareaRef.current?.focus();
      return;
    }

    setModelPickerOpen(false);
    setSwitchingModelRef(modelRef || '__default__');
    void Promise.resolve()
      // Picking a concrete model means "use exactly this one", so auto-select
      // has to come off first — otherwise the router would re-route the next
      // turn and silently override the choice.
      .then(() => (autoSelectOn
        ? updateAgentAutoSelect(currentAgent.id, { autoSelectModel: { model: false } })
        : undefined))
      .then(() => onSelectModel?.(modelRef))
      .catch((error) => {
        toast.error(t('composer.modelSwitchFailed', { error: String(error) }));
      })
      .finally(() => {
        setSwitchingModelRef(null);
        textareaRef.current?.focus();
      });
  }, [autoSelectOn, currentAgent, onSelectModel, sessionModelOverride, switchingModelRef, t, updateAgentAutoSelect]);

  /**
   * Hand model choice back to the agent's own router (Agents → model →
   * auto-select). Persisted on the agent, so it also drops the temporary
   * per-conversation override — leaving it in place would pin the session to one
   * model and defeat the router.
   */
  const handleSelectAutoModel = useCallback(() => {
    if (!currentAgent || switchingModelRef) return;
    if (autoSelectOn && !sessionModelOverride) {
      setModelPickerOpen(false);
      textareaRef.current?.focus();
      return;
    }

    setModelPickerOpen(false);
    setSwitchingModelRef('__auto__');
    void Promise.resolve()
      .then(() => (sessionModelOverride ? onSelectModel?.(null) : undefined))
      .then(() => updateAgentAutoSelect(currentAgent.id, { autoSelectModel: { model: true } }))
      .catch((error) => {
        toast.error(t('composer.modelSwitchFailed', { error: String(error) }));
      })
      .finally(() => {
        setSwitchingModelRef(null);
        textareaRef.current?.focus();
      });
  }, [autoSelectOn, currentAgent, onSelectModel, sessionModelOverride, switchingModelRef, t, updateAgentAutoSelect]);

  const handleEnhancePrompt = useCallback(async () => {
    const draft = input.trim();
    if (!draft || enhancingPrompt) return;
    const agentId = targetAgentId ?? currentAgentId ?? undefined;
    setEnhancingPrompt(true);
    try {
      const { system, input: promptInput } = buildEnhancePromptGenPrompt(draft);
      const res = await hostApi.agents.generateText({ agentId, system, input: promptInput }) as {
        success: boolean;
        text?: string;
        error?: string;
      };
      if (!res.success || !res.text) throw new Error(res.error || 'Generation failed');
      setInput(res.text);
    } catch (error) {
      toast.error(t('composer.enhancePromptFailed', { error: String(error) }));
    } finally {
      setEnhancingPrompt(false);
    }
  }, [currentAgentId, enhancingPrompt, input, setInput, t, targetAgentId]);

  const handleWorkspaceButtonClick = useCallback(() => {
    if (workspaceSelectorDisabled) return;
    setPickerOpen(false);
    setSkillPickerOpen(false);
    setModelPickerOpen(false);
    setWorkspaceMenuOpen((open) => !open);
  }, [workspaceSelectorDisabled]);

  const handleWorkspaceKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    setWorkspaceMenuOpen(false);
    event.stopPropagation();
  }, []);

  const handleSelectWorkspace = useCallback((path: string) => {
    if (workspaceSelectorDisabled || !onSelectWorkspace) return;
    onSelectWorkspace(path);
    setWorkspaceMenuOpen(false);
    textareaRef.current?.focus();
  }, [onSelectWorkspace, workspaceSelectorDisabled]);

  const handleSelectDefaultWorkspace = useCallback(() => {
    handleSelectWorkspace(DEFAULT_WORKSPACE_CWD);
  }, [handleSelectWorkspace]);

  const handleChooseOtherWorkspace = useCallback(async () => {
    if (workspaceSelectorDisabled || !onSelectWorkspace) return;
    setWorkspaceMenuOpen(false);
    try {
      const result = await hostApi.dialog.open({
        title: t('composer.workspacePickerTitle'),
        buttonLabel: t('composer.workspacePickerButton'),
        defaultPath: workspacePath,
        properties: ['openDirectory', 'createDirectory'],
      });
      const selected = result.filePaths[0]?.trim();
      if (!result.canceled && selected) onSelectWorkspace(selected);
    } catch {
      toast.error(t('composer.workspacePickerFailed'));
    } finally {
      textareaRef.current?.focus();
    }
  }, [onSelectWorkspace, t, workspacePath, workspaceSelectorDisabled]);

  // ── File staging via native dialog / Electron drag-drop paths ──

  const stagePathFiles = useCallback(async (filePaths: string[]) => {
    if (attachmentsLocked || filePaths.length === 0) return;

    const tempIds: string[] = [];
    for (const filePath of filePaths) {
      const tempId = crypto.randomUUID();
      tempIds.push(tempId);
      const fileName = filePath.split(/[\\/]/).pop() || 'file';
      setAttachments(prev => [...prev, {
        id: tempId,
        fileName,
        mimeType: '',
        fileSize: 0,
        stagedPath: '',
        sourceKind: 'path',
        preview: null,
        status: 'staging' as const,
      }]);
    }

    try {
      console.log('[stagePathFiles] Staging files:', filePaths);
      const staged = await hostApi.files.stagePaths({ filePaths });
      console.log('[stagePathFiles] Stage result:', staged?.map(s => ({ id: s?.id, fileName: s?.fileName, mimeType: s?.mimeType, fileSize: s?.fileSize, stagedPath: s?.stagedPath, hasPreview: !!s?.preview })));

      setAttachments(prev => {
        let updated = [...prev];
        for (let i = 0; i < tempIds.length; i++) {
          const tempId = tempIds[i];
          const data = staged[i];
          if (data) {
            updated = updated.map(a =>
              a.id === tempId
                ? { ...data, status: 'ready' as const }
                : a,
            );
          } else {
            console.warn(`[stagePathFiles] No staged data for tempId=${tempId} at index ${i}`);
            updated = updated.map(a =>
              a.id === tempId
                ? { ...a, status: 'error' as const, error: 'Staging failed' }
                : a,
            );
          }
        }
        return updated;
      });
    } catch (err) {
      console.error('[stagePathFiles] Failed to stage files:', err);
      appToast.appError(err);
      setAttachments(prev => prev.map(a =>
        a.status === 'staging'
          ? { ...a, status: 'error' as const, error: String(err) }
          : a,
      ));
    }
  }, [attachmentsLocked]);

  const pickFiles = useCallback(async () => {
    if (attachmentsLocked) return;
    try {
      const result = await hostApi.dialog.open({
        properties: ['openFile', 'multiSelections'],
      });
      if (result.canceled || !result.filePaths?.length) return;
      await stagePathFiles(result.filePaths);
    } catch (err) {
      console.error('[pickFiles] Failed to open file dialog:', err);
    }
  }, [attachmentsLocked, stagePathFiles]);

  // ── Stage browser File objects (paste / drag-drop) ─────────────

  const stageBufferFiles = useCallback(async (files: globalThis.File[]) => {
    if (attachmentsLocked) return;
    for (const file of files) {
      const tempId = crypto.randomUUID();
      setAttachments(prev => [...prev, {
        id: tempId,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        fileSize: file.size,
        stagedPath: '',
        sourceKind: 'buffer',
        preview: null,
        status: 'staging' as const,
      }]);

      try {
        console.log(`[stageBuffer] Reading file: ${file.name} (${file.type}, ${file.size} bytes)`);
        const base64 = await readFileAsBase64(file);
        console.log(`[stageBuffer] Base64 length: ${base64?.length ?? 'null'}`);
        const staged = await hostApi.files.stageBuffer({
          base64,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
        });
        console.log(`[stageBuffer] Staged: id=${staged?.id}, path=${staged?.stagedPath}, size=${staged?.fileSize}`);
        setAttachments(prev => prev.map(a =>
          a.id === tempId ? { ...staged, status: 'ready' as const } : a,
        ));
      } catch (err) {
        console.error(`[stageBuffer] Error staging ${file.name}:`, err);
        appToast.appError(err);
        setAttachments(prev => prev.map(a =>
          a.id === tempId
            ? { ...a, status: 'error' as const, error: String(err) }
            : a,
        ));
      }
    }
  }, [attachmentsLocked]);

  // ── Attachment management ──────────────────────────────────────

  const removeAttachment = useCallback((id: string) => {
    if (attachmentsLocked) return;
    setAttachments(prev => prev.filter(a => a.id !== id));
  }, [attachmentsLocked]);

  const allReady = attachments.length === 0 || attachments.every(a => a.status === 'ready');
  const hasFailedAttachments = attachments.some((a) => a.status === 'error');
  const canSend = (input.trim() || attachments.length > 0)
    && allReady
    && !inputDisabled
    && !sending
    && !imageGenerating;
  const canStop = sending && !inputDisabled && !!onStop;

  const handleSend = useCallback(async () => {
    if (!canSend) return;
    const readyAttachments = attachments.filter(a => a.status === 'ready');
    const textToSend = input.trim();
    const attachmentsToSend = readyAttachments.length > 0 ? readyAttachments : undefined;

    if (rendererExtensionRegistry.hasChatBeforeSendHooks()) {
      const guard = await rendererExtensionRegistry.runChatBeforeSend({
        text: textToSend,
        attachments: attachmentsToSend,
        targetAgentId,
      });
      if (!guard.ok) {
        if (guard.message) {
          toast.error(guard.message);
        }
        return;
      }
    }

    // Sensitive-task origin gate: when auto-select is on and the task is sensitive
    // but no private-origin model is configured, confirm before sending elsewhere.
    if (currentAgent?.autoSelectModel?.model) {
      const sensitive = !!currentAgent.sensitiveMode || SENSITIVE_RE.test(textToSend);
      if (
        sensitive
        && !sensitiveConfirmedRef.current
        && availableOrigins.size > 0
        && !availableOrigins.has('private')
      ) {
        const nextTier = sensitiveOriginOrder(language).find((o) => availableOrigins.has(o));
        const proceed = await new Promise<boolean>((resolve) => {
          sensitiveResolveRef.current = resolve;
          setSensitivePrompt({ tierLabel: nextTier ? originLabel(nextTier, language) : '' });
        });
        setSensitivePrompt(null);
        sensitiveResolveRef.current = null;
        if (!proceed) return;
        sensitiveConfirmedRef.current = true;
      }
    }

    // Capture values before clearing — clear input immediately for snappy UX,
    // but keep attachments available for the async send
    console.log(`[handleSend] text="${textToSend.substring(0, 50)}", attachments=${attachments.length}, ready=${readyAttachments.length}, sending=${!!attachmentsToSend}`);
    if (attachmentsToSend) {
      console.log('[handleSend] Attachment details:', attachmentsToSend.map(a => ({
        id: a.id, fileName: a.fileName, mimeType: a.mimeType, fileSize: a.fileSize,
        stagedPath: a.stagedPath, status: a.status, hasPreview: !!a.preview,
      })));
    }
    setInput('');
    setAttachments([]);
    setSelectedSkill(null);
    setSkillQuery('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    onSend(textToSend, attachmentsToSend, targetAgentId);
    setTargetAgentId(null);
    setPickerOpen(false);
    setSkillPickerOpen(false);
    setWorkspaceMenuOpen(false);
  }, [input, attachments, canSend, onSend, setInput, targetAgentId, currentAgent, availableOrigins, language]);

  const handleStop = useCallback(() => {
    if (!canStop) return;
    onStop?.();
  }, [canStop, onStop]);

  const startDictationCapture = useCallback(async () => {
    dictationBaseRef.current = input.trim() ? `${input.trimEnd()} ` : '';
    setMicState('starting');
    try {
      const access = await hostApi.asr.getMicrophoneAccess();
      if (access.status === 'denied' || access.status === 'restricted') {
        setMicrophoneAccess(access);
        setMicState('idle');
        return;
      }
      const handle = await startDictation({
        onState: (state) => setMicState(state),
        onFinal: (text) => {
          if (text) setInput(`${dictationBaseRef.current}${text}`);
          setMicState('idle');
          dictationHandleRef.current = null;
        },
        onError: (error) => {
          toast.error(t('voice.dictationError', { error: String(error) }));
          setMicState('idle');
          dictationHandleRef.current = null;
        },
      });
      dictationHandleRef.current = handle;
    } catch (error) {
      setMicState('idle');
      dictationHandleRef.current = null;
      if (error instanceof Error && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
        const access = await hostApi.asr.getMicrophoneAccess().catch(() => null);
        if (access && (access.status === 'denied' || access.status === 'restricted')) {
          setMicrophoneAccess(access);
          return;
        }
      }
      toast.error(t('voice.dictationStartFailed', { error: String(error) }));
    }
  }, [input, setInput, t]);

  const handleMicClick = useCallback(() => {
    if (inputDisabled || sending) return;
    if (voiceInputMode === 'conversation') {
      void hostApi.asr.getMicrophoneAccess().then((access) => {
        if (access.status === 'denied' || access.status === 'restricted') {
          setMicrophoneAccess(access);
        } else {
          setTalkOpen(true);
        }
      }).catch((error) => {
        toast.error(t('voice.dictationStartFailed', { error: String(error) }));
      });
      return;
    }
    if (micState === 'recording') {
      void dictationHandleRef.current?.stop();
    } else if (micState === 'idle') {
      void startDictationCapture();
    }
  }, [inputDisabled, micState, sending, startDictationCapture, t, voiceInputMode]);

  useEffect(() => {
    return () => {
      dictationHandleRef.current?.cancel();
      dictationHandleRef.current = null;
    };
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Backspace') {
        const textarea = textareaRef.current;
        const selectionStart = textarea?.selectionStart ?? 0;
        const selectionEnd = textarea?.selectionEnd ?? 0;
        const tokenRange = skillTokenRanges.find((range) =>
          selectionStart === selectionEnd
          && selectionStart > range.start
          && selectionStart <= range.end,
        );

        if (
          tokenRange
        ) {
          e.preventDefault();
          const valueWithoutToken = `${input.slice(0, tokenRange.start)}${input.slice(tokenRange.end)}`;
          setInput(valueWithoutToken);
          setSelectedSkill(null);
          moveCaretTo(tokenRange.start);
          return;
        }

        if (!input) {
          if (selectedSkill) {
            setSelectedSkill(null);
            return;
          }
          setTargetAgentId(null);
          return;
        }
      }
      if (e.key === 'ArrowLeft' && skillTokenRanges.length > 0) {
        const textarea = textareaRef.current;
        const selectionStart = textarea?.selectionStart ?? 0;
        const selectionEnd = textarea?.selectionEnd ?? 0;
        const tokenRange = skillTokenRanges.find((range) => selectionStart === selectionEnd && selectionStart === range.end);
        if (tokenRange) {
          e.preventDefault();
          moveCaretTo(tokenRange.start);
          return;
        }
      }
      if (e.key === 'ArrowRight' && skillTokenRanges.length > 0) {
        const textarea = textareaRef.current;
        const selectionStart = textarea?.selectionStart ?? 0;
        const selectionEnd = textarea?.selectionEnd ?? 0;
        const tokenRange = skillTokenRanges.find((range) => selectionStart === selectionEnd && selectionStart === range.start);
        if (tokenRange) {
          e.preventDefault();
          moveCaretTo(tokenRange.end);
          return;
        }
      }
      if (e.key === 'Escape') {
        setPickerOpen(false);
        setSkillPickerOpen(false);
        setModelPickerOpen(false);
        setWorkspaceMenuOpen(false);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        const nativeEvent = e.nativeEvent as KeyboardEvent;
        if (isComposingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229) {
          return;
        }
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, input, moveCaretTo, selectedSkill, setInput, skillTokenRanges],
  );

  // Handle paste (Ctrl/Cmd+V with files)
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const pastedFiles: globalThis.File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) pastedFiles.push(file);
        }
      }
      if (pastedFiles.length > 0) {
        if (attachmentsLocked) return;
        e.preventDefault();
        stageBufferFiles(pastedFiles);
      }
    },
    [attachmentsLocked, stageBufferFiles],
  );

  // Handle drag & drop
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (attachmentsLocked) return;
    setDragOver(true);
  }, [attachmentsLocked]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      if (attachmentsLocked) return;
      if (!e.dataTransfer) return;

      const { pathFiles, bufferFiles } = collectDroppedFiles(e.dataTransfer);
      if (pathFiles.length === 0 && bufferFiles.length === 0) {
        toast.error(t('composer.folderDropUnsupported'));
        return;
      }
      if (pathFiles.length > 0) void stagePathFiles(pathFiles);
      if (bufferFiles.length > 0) void stageBufferFiles(bufferFiles);
    },
    [attachmentsLocked, stageBufferFiles, stagePathFiles, t],
  );

  const hasWorkingSubagents = subagentSessions.some((session) => session.busy);
  const composerSessionKey = draftKey ?? '';
  const [expandedComposerPanel, setExpandedComposerPanel] = useState<{
    sessionKey: string;
    panel: ComposerExpandedPanel;
  }>({ sessionKey: composerSessionKey, panel: null });
  const activeComposerPanel = expandedComposerPanel.sessionKey === composerSessionKey
    ? expandedComposerPanel.panel
    : null;
  const showWorkingIndicator = sending || hasWorkingSubagents;
  const showSubagentControl = typeof onSelectSubagent === 'function' && subagentSessions.length > 0;
  const showStatusRow = showWorkingIndicator || showSubagentControl || currentPlan != null;
  const workingLabel = sending ? t('composer.thinking') : t('composer.subagentsWorking');

  if (statusOnly) {
    return (
      <div className="relative mx-auto w-full max-w-3xl shrink-0 p-4 pb-6">
        <div
          data-testid="chat-composer-working-indicator"
          role="status"
          aria-live="polite"
          aria-label={workingLabel}
          className="mb-2 flex min-h-5 items-center justify-between gap-2 text-sm text-muted-foreground"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span
              data-testid="chat-composer-dot-pulse"
              aria-hidden="true"
              className="clawx-chat-thinking-dot-pulse"
            >
              <span className="clawx-chat-thinking-dot-pulse-inner">
                <span className="clawx-chat-thinking-dot-pulse-dot" />
              </span>
            </span>
            <span>{workingLabel}</span>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'relative mx-auto w-full max-w-3xl shrink-0 p-4 pb-6',
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="w-full">
        {showStatusRow && (
          <div
            data-testid="chat-composer-working-indicator"
            role={showWorkingIndicator ? 'status' : undefined}
            aria-live={showWorkingIndicator ? 'polite' : undefined}
            aria-label={showWorkingIndicator ? workingLabel : undefined}
            className="mb-2 flex min-h-5 items-center justify-between gap-2 text-sm text-muted-foreground"
          >
            {showWorkingIndicator ? (
              <span className="flex min-w-0 items-center gap-2">
                <span
                  data-testid="chat-composer-dot-pulse"
                  aria-hidden="true"
                  className="clawx-chat-thinking-dot-pulse"
                >
                  <span className="clawx-chat-thinking-dot-pulse-inner">
                    <span className="clawx-chat-thinking-dot-pulse-dot" />
                  </span>
                </span>
                <span>{workingLabel}</span>
              </span>
            ) : <span aria-hidden="true" />}
            <div className="flex shrink-0 items-center gap-2">
              {showSubagentControl && typeof onSelectSubagent === 'function' && (
                <AcpSubagentSessions
                  sessions={subagentSessions}
                  sessionKey={composerSessionKey}
                  onSelectSession={onSelectSubagent}
                  isExpanded={activeComposerPanel === 'subagents'}
                  onExpandedChange={(isExpanded) => setExpandedComposerPanel({
                    sessionKey: composerSessionKey,
                    panel: isExpanded ? 'subagents' : null,
                  })}
                />
              )}
              <AcpSessionPlan
                plan={currentPlan}
                sessionKey={composerSessionKey}
                isExpanded={activeComposerPanel === 'plan'}
                onExpandedChange={(isExpanded) => setExpandedComposerPanel({
                  sessionKey: composerSessionKey,
                  panel: isExpanded ? 'plan' : null,
                })}
              />
            </div>
          </div>
        )}

        {!sending && imageGenerating && (
          <div
            data-testid="chat-composer-image-generation-indicator"
            role="status"
            aria-live="polite"
            aria-label={t('imageGeneration.generating')}
            className="mb-2 flex h-5 items-center gap-2 text-sm text-muted-foreground"
          >
            <span
              data-testid="chat-composer-image-generation-dot-pulse"
              aria-hidden="true"
              className="clawx-chat-thinking-dot-pulse"
            >
              <span className="clawx-chat-thinking-dot-pulse-inner">
                <span className="clawx-chat-thinking-dot-pulse-dot" />
              </span>
            </span>
            <span>{t('imageGeneration.generating')}</span>
          </div>
        )}

        {/* Attachment Previews */}
        {attachments.length > 0 && (
          <div className="flex gap-2 mb-3 flex-wrap">
            {attachments.map((att) => (
              <AttachmentPreview
                key={att.id}
                attachment={att}
                onRemove={() => removeAttachment(att.id)}
                disabled={attachmentsLocked}
              />
            ))}
          </div>
        )}

        {/* Input Container */}
        <div
          data-testid="chat-composer-box"
          className={`relative bg-surface-modal rounded-2xl shadow-sm border px-3 pt-2.5 pb-1.5 transition-all ${dragOver ? 'border-primary ring-1 ring-primary' : 'border-black/10 dark:border-white/10'}`}
        >
          {selectedTarget && (
            <div className="flex flex-wrap gap-2 pb-1.5">
              <button
                type="button"
                onClick={() => setTargetAgentId(null)}
                disabled={inputDisabled}
                className="inline-flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-1 text-meta font-medium text-foreground transition-colors hover:bg-primary/10"
                title={t('composer.clearTarget')}
              >
                <span>{t('composer.targetChip', { agent: selectedTarget.name })}</span>
                <X className="h-3 w-3 text-muted-foreground" />
              </button>
            </div>
          )}

          {/* Text Row — flush-left */}
          <div className="relative min-h-[48px]">
            {skillTokenRanges.length > 0 && (
              <div
                aria-hidden="true"
                data-testid="chat-composer-highlight"
                className="pointer-events-none absolute inset-0 z-20 overflow-hidden whitespace-pre-wrap break-words text-sm leading-relaxed text-transparent"
              >
                {renderHighlightedComposerText(input, skillTokenRanges, {
                  onPreviewSkill: (name) => {
                    void handleSkillTokenPreview(name);
                  },
                  previewTooltip: t('composer.skillPreviewTooltip', 'Preview SKILL.md'),
                })}
              </div>
            )}
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                handleInputChange(e.target.value);
                rememberDraftSelection(e.currentTarget);
              }}
              onKeyDown={handleKeyDown}
              onSelect={handleComposerSelection}
              onClick={handleComposerSelection}
              onBlur={(e) => rememberDraftSelection(e.currentTarget)}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              onPaste={handlePaste}
              placeholder={
                !hasAgents
                  ? t('composer.noAgentPlaceholder')
                  : inputDisabled
                    ? t('composer.gatewayDisconnectedPlaceholder')
                    : ''
              }
              disabled={inputDisabled}
              data-testid="chat-composer-input"
              className={cn(
                'relative z-10 min-h-[48px] max-h-[240px] resize-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none bg-transparent p-0 text-sm leading-relaxed placeholder:text-muted-foreground/60',
                skillTokenRanges.length > 0 && 'selection:bg-primary/20',
              )}
              rows={1}
            />
          </div>

          {/* Action Row — icons on their own line */}
          <div className="mt-1.5 flex items-center gap-1">
            {/* Attach Button */}
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 h-8 w-8 rounded-lg text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10 hover:text-foreground transition-colors"
              onClick={pickFiles}
              disabled={inputDisabled || sending}
              title={t('composer.attachFiles')}
            >
              <Paperclip className="h-3.5 w-3.5" />
            </Button>

            {showAgentPicker && (
              <div ref={pickerRef} className="relative shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  data-testid="chat-composer-agent"
                  className={cn(
                    'h-8 w-8 rounded-lg text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10 hover:text-foreground transition-colors',
                    (pickerOpen || selectedTarget) && 'bg-primary/10 text-primary hover:bg-primary/20'
                  )}
                  onClick={() => {
                    setSkillPickerOpen(false);
                    setModelPickerOpen(false);
                    setWorkspaceMenuOpen(false);
                    setPickerOpen((open) => !open);
                  }}
                  disabled={inputDisabled || sending}
                  title={t('composer.pickAgent')}
                >
                  <AtSign className="h-3.5 w-3.5" />
                </Button>
                {pickerOpen && (
                  <div className="absolute left-0 bottom-full z-20 mb-2 w-72 overflow-hidden rounded-2xl border border-black/10 bg-background p-1.5 shadow-xl dark:border-white/10">
                    <div className="px-3 py-2 text-tiny font-medium text-muted-foreground/80">
                      {t('composer.agentPickerTitle', { currentAgent: currentAgentName })}
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {mentionableAgents.map((agent) => (
                        <AgentPickerItem
                          key={agent.id}
                          agent={agent}
                          selected={agent.id === targetAgentId}
                          onSelect={() => {
                            setTargetAgentId(agent.id);
                            setPickerOpen(false);
                            textareaRef.current?.focus();
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div ref={skillPickerRef} className="relative shrink-0">
              <button
                type="button"
                data-testid="chat-composer-skill"
                className={cn(
                  'inline-flex h-8 items-center gap-1 rounded-lg px-1.5 text-meta font-medium text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground focus-visible:outline-none focus-visible:ring-0 disabled:pointer-events-none disabled:opacity-50',
                  (skillPickerOpen || selectedSkill) && 'text-foreground',
                )}
                onClick={() => {
                  setPickerOpen(false);
                  setModelPickerOpen(false);
                  setWorkspaceMenuOpen(false);
                  setSkillPickerOpen((open) => !open);
                }}
                disabled={inputDisabled || sending}
                title={t('composer.pickSkill')}
              >
                <span className="text-meta font-medium leading-none">{t('composer.skillButton')}</span>
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', skillPickerOpen && 'rotate-180')} />
              </button>
              {skillPickerOpen && (
                <div className="absolute left-0 bottom-full z-20 mb-2 w-80 overflow-hidden rounded-2xl border border-black/10 bg-background p-1.5 shadow-xl dark:border-white/10">
                  <div className="flex items-center gap-2 rounded-xl border border-black/10 bg-black/[0.03] px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                    <Search className="h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      value={skillQuery}
                      onChange={(event) => setSkillQuery(event.target.value)}
                      placeholder={t('composer.skillSearchPlaceholder')}
                      className="w-full bg-transparent text-meta outline-none placeholder:text-muted-foreground/70"
                      autoFocus
                    />
                  </div>
                  <div className="px-3 py-2 text-tiny font-medium text-muted-foreground/80">
                    {t('composer.skillPickerTitle', { agent: currentAgentName })}
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {skillsLoading ? (
                      <div className="px-3 py-4 text-xs text-muted-foreground">
                        {t('composer.skillLoading')}
                      </div>
                    ) : skillsError ? (
                      <div className="px-3 py-4 text-xs text-destructive">
                        {skillsError}
                      </div>
                    ) : filteredQuickSkills.length === 0 ? (
                      <div className="px-3 py-4 text-xs text-muted-foreground">
                        {t('composer.skillEmpty')}
                      </div>
                    ) : (
                      filteredQuickSkills.map((skill) => (
                        <SkillPickerItem
                          key={`${skill.source}:${skill.name}`}
                          skill={skill}
                          selected={false}
                          onSelect={() => {
                            const textarea = textareaRef.current;
                            const nextToken = getSkillPrefix(skill.name);
                            const selectionStart = textarea?.selectionStart ?? input.length;
                            const selectionEnd = textarea?.selectionEnd ?? input.length;
                            let nextValue = input;
                            let adjustedStart = selectionStart;
                            let adjustedEnd = selectionEnd;

                            const leadingSpace = needsLeadingSkillSpace(nextValue, adjustedStart) ? ' ' : '';
                            nextValue = `${nextValue.slice(0, adjustedStart)}${leadingSpace}${nextToken}${nextValue.slice(adjustedEnd)}`;
                            setSelectedSkill(null);
                            setInput(nextValue);
                            setSkillPickerOpen(false);
                            setSkillQuery('');
                            requestAnimationFrame(() => {
                              textareaRef.current?.focus();
                              const cursorPosition = adjustedStart + leadingSpace.length + nextToken.length;
                              textareaRef.current?.setSelectionRange(cursorPosition, cursorPosition);
                            });
                          }}
                        />
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {showModelPicker && (
              <div ref={modelPickerRef} className="relative shrink-0">
                <button
                  type="button"
                  data-testid="chat-model-picker-button"
                  className={cn(
                    'inline-flex h-8 max-w-[220px] items-center gap-1 rounded-lg px-1.5 text-meta font-medium text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground focus-visible:outline-none focus-visible:ring-0 disabled:pointer-events-none disabled:opacity-50',
                    (modelPickerOpen || switchingModelRef) && 'text-foreground',
                  )}
                  onClick={() => {
                    setPickerOpen(false);
                    setSkillPickerOpen(false);
                    setWorkspaceMenuOpen(false);
                    setModelPickerOpen((open) => !open);
                  }}
                  disabled={inputDisabled || sending || !currentAgent || !!switchingModelRef}
                  title={t('composer.pickModel')}
                >
                  {switchingModelRef ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  ) : null}
                  {/* Same span classes as the skill button's label: `text-meta`
                      on the button itself is dropped by tailwind-merge (the
                      later `text-*` colour class wins), so the 13px size has to
                      be re-applied here or the model name renders at 16px. */}
                  <span className="truncate text-meta font-medium leading-none">
                    {autoSelectOn ? t('composer.autoModelShort') : currentModelLabel}
                  </span>
                  <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform', modelPickerOpen && 'rotate-180')} />
                </button>
                {modelPickerOpen && (
                  <div
                    className="absolute left-0 bottom-full z-20 mb-2 w-72 overflow-hidden rounded-2xl border border-black/10 bg-background p-1.5 shadow-xl dark:border-white/10"
                    data-testid="chat-model-picker-menu"
                  >
                    <div className="px-3 py-2 text-tiny font-medium text-muted-foreground/80">
                      {t('composer.modelPickerTitle')}
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {/* Hand routing back to the agent — sits above the
                          concrete models because it overrides all of them. */}
                      <button
                        type="button"
                        onClick={handleSelectAutoModel}
                        className={cn(
                          'flex w-full items-start justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors',
                          autoSelectOn ? 'bg-primary/10 text-foreground' : 'hover:bg-black/5 dark:hover:bg-white/5',
                        )}
                        data-testid="chat-model-picker-option-auto"
                      >
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="flex items-center gap-2">
                            <Sparkles className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate">{t('composer.autoModelOption')}</span>
                          </span>
                          <span className="text-tiny font-normal text-muted-foreground/80">
                            {t('composer.autoModelOptionHint')}
                          </span>
                        </span>
                        {autoSelectOn && (
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                        )}
                      </button>
                      {textModelOptions.map((option) => (
                        <button
                          key={option.modelRef}
                          type="button"
                          onClick={() => handleSelectModel(option.modelRef)}
                          className={cn(
                            'flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors',
                            !autoSelectOn && option.modelRef === effectiveModelRef ? 'bg-primary/10 text-foreground' : 'hover:bg-black/5 dark:hover:bg-white/5'
                          )}
                          data-testid={`chat-model-picker-option-${option.label}`}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate">{option.label}</span>
                            {option.modelRef === configuredModelRef && (
                              <span className="shrink-0 rounded-full border border-black/10 px-1.5 py-0.5 text-2xs font-medium text-muted-foreground dark:border-white/10">
                                {t('composer.defaultModel')}
                              </span>
                            )}
                            {/* Only worth calling out as "temporary" when it
                                actually differs from the agent's default —
                                otherwise the row already reads "default". */}
                            {sessionModelOverride
                              && option.modelRef === sessionModelOverride
                              && sessionModelOverride !== configuredModelRef && (
                              <span className="shrink-0 rounded-full border border-primary/30 px-1.5 py-0.5 text-2xs font-medium text-primary">
                                {t('composer.temporaryModel')}
                              </span>
                            )}
                          </span>
                          {!autoSelectOn && option.modelRef === effectiveModelRef && (
                            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                          )}
                        </button>
                      ))}
                    </div>
                    {sessionModelOverride && (
                      <button
                        type="button"
                        onClick={() => handleSelectModel(null)}
                        data-testid="chat-model-picker-reset-default"
                        className="mt-1 flex w-full items-center gap-2 rounded-xl border-t border-black/5 px-3 py-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:border-white/5 dark:hover:bg-white/5"
                      >
                        {t('composer.resetToDefaultModel')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Right-hand action group: voice input, enhance prompt, send.
                `ml-auto` sits on the first of the group so all three stay
                pinned to the right edge of the action row. */}
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'ml-auto shrink-0 h-8 w-8 rounded-lg transition-colors',
                micState === 'recording'
                  ? 'text-red-500 bg-red-500/10 hover:bg-red-500/20'
                  : 'text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10 hover:text-foreground',
              )}
              onClick={handleMicClick}
              disabled={inputDisabled || sending || (voiceInputMode === 'conversation' ? !voiceRealtimeCap : !voiceTranscriptionCap)}
              title={
                (voiceInputMode === 'conversation' ? !voiceRealtimeCap : !voiceTranscriptionCap)
                  ? (voiceInputMode === 'conversation'
                    ? t('voice.realtimeNotConfigured')
                    : t('voice.transcriptionNotConfigured'))
                  : voiceInputMode === 'conversation'
                    ? t('voice.startTalk')
                    : micState === 'recording'
                      ? t('voice.stopDictation')
                      : micState === 'transcribing'
                        ? t('voice.transcribing')
                        : t('voice.startDictation')
              }
              data-testid="chat-composer-mic"
            >
              {micState === 'starting' || micState === 'transcribing' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Mic className="h-3.5 w-3.5" />
              )}
            </Button>

            {/* Enhance Prompt */}
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 h-8 w-8 rounded-lg text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10 hover:text-foreground transition-colors"
              onClick={() => void handleEnhancePrompt()}
              disabled={inputDisabled || sending || enhancingPrompt || !input.trim()}
              title={t('composer.enhancePrompt')}
              data-testid="chat-composer-enhance-prompt"
            >
              {enhancingPrompt ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
            </Button>

            <div className="flex items-center gap-1">

              {/* Send Button */}
              <Button
                onClick={sending ? handleStop : handleSend}
                disabled={sending ? !canStop : !canSend}
                size="icon"
                data-testid="chat-composer-send"
                className={`shrink-0 h-8 w-8 rounded-lg transition-colors ${
                  (sending || canSend)
                    ? 'bg-black/5 dark:bg-white/10 text-foreground hover:bg-black/10 dark:hover:bg-white/20'
                    : 'text-muted-foreground/50 hover:bg-transparent bg-transparent'
                }`}
                variant="ghost"
                title={sending ? t('composer.stop') : t('composer.send')}
              >
                {sending ? (
                  <Square className="h-3.5 w-3.5" fill="currentColor" />
                ) : (
                  <SendHorizontal className="h-4 w-4" strokeWidth={2} />
                )}
              </Button>
            </div>
          </div>
        </div>
        <div
          data-testid="chat-composer-footer"
          className="mt-2.5 flex min-w-0 items-center justify-between gap-2 text-tiny text-muted-foreground/60"
        >
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {workspaceLabel && workspacePath && (
              <div ref={workspaceMenuRef} className="relative min-w-0 shrink" onKeyDown={handleWorkspaceKeyDown}>
                <button
                  type="button"
                  data-testid="chat-workspace-selector"
                  title={workspacePath}
                  aria-disabled={workspaceSelectorDisabled ? 'true' : undefined}
                  aria-expanded={!workspaceSelectorDisabled ? workspaceMenuOpen : undefined}
                  tabIndex={workspaceSelectorDisabled ? -1 : undefined}
                  onClick={workspaceSelectorDisabled ? undefined : handleWorkspaceButtonClick}
                  className={cn(
                    'inline-flex min-w-0 max-w-[260px] items-center gap-1 rounded-full border px-2 py-0.5',
                    'bg-black/[0.02] text-tiny font-medium text-foreground/75 transition-colors dark:bg-white/[0.04]',
                    workspaceSelectorDisabled
                      ? 'cursor-default border-transparent opacity-80'
                      : 'border-black/10 hover:bg-black/5 hover:text-foreground dark:border-white/10 dark:hover:bg-white/10',
                  )}
                >
                  <FolderOpen className="h-3 w-3 shrink-0" />
                  <span className="min-w-0 truncate">
                    {t('composer.workspacePrefix', { workspace: workspaceLabel })}
                  </span>
                  {!workspaceSelectorDisabled && (
                    <ChevronDown className={cn('h-3 w-3 shrink-0 transition-transform', workspaceMenuOpen && 'rotate-180')} />
                  )}
                </button>
                {workspaceMenuOpen && !workspaceSelectorDisabled && (
                  <div
                    data-testid="chat-workspace-menu"
                    className="absolute bottom-full left-0 z-20 mb-2 max-h-80 w-64 overflow-y-auto rounded-2xl border border-black/10 bg-surface-modal p-1.5 shadow-xl dark:border-white/10"
                  >
                    <button
                      type="button"
                      data-testid="chat-workspace-default"
                      aria-current={isDefaultWorkspacePath(workspacePath) ? 'true' : undefined}
                      onClick={handleSelectDefaultWorkspace}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-black/5 dark:hover:bg-white/10',
                        isDefaultWorkspacePath(workspacePath) && 'bg-black/5 dark:bg-white/10',
                      )}
                    >
                      <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{t('composer.defaultWorkspaceOption')}</span>
                      {isDefaultWorkspacePath(workspacePath) && <Check className="h-3.5 w-3.5 shrink-0" />}
                    </button>
                    {workspaceOptions.map((option) => {
                      const optionPath = normalizeWorkspacePath(option.path);
                      if (!optionPath || isDefaultWorkspacePath(optionPath)) return null;
                      const selected = optionPath === normalizeWorkspacePath(workspacePath);
                      return (
                        <button
                          key={optionPath}
                          type="button"
                          data-testid={`chat-workspace-option-${encodeURIComponent(optionPath)}`}
                          title={optionPath}
                          aria-current={selected ? 'true' : undefined}
                          onClick={() => handleSelectWorkspace(optionPath)}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-black/5 dark:hover:bg-white/10',
                            selected && 'bg-black/5 dark:bg-white/10',
                          )}
                        >
                          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate">{option.label}</span>
                          {selected && <Check className="h-3.5 w-3.5 shrink-0" />}
                        </button>
                      );
                    })}
                    <div className="my-1 border-t border-black/5 dark:border-white/10" />
                    <button
                      type="button"
                      data-testid="chat-workspace-choose-other"
                      onClick={() => void handleChooseOtherWorkspace()}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                    >
                      <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{t('composer.chooseOtherWorkspaceOption')}</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 overflow-hidden text-right">
            <div className="flex min-w-0 items-center justify-end gap-2 overflow-hidden">
              {activeContextUsage && contextUsageLabel && contextUsagePercentage && (
                <ContextUsageIndicator
                  usage={activeContextUsage}
                  label={contextUsageLabel}
                  percentageLabel={contextUsagePercentage}
                />
              )}
            <div data-testid="chat-composer-gateway-status" className="flex min-w-0 items-center justify-end gap-1.5 overflow-hidden">
              <div className={cn(
                'h-1.5 w-1.5 shrink-0 rounded-full',
                isGatewayUsable ? 'bg-green-500/80' : 'bg-red-500/80',
              )} />
              <span className="min-w-0 truncate">
                {t('composer.gatewayStatus', {
                  state: isGatewayUsable
                    ? t('composer.gatewayConnected')
                    : gatewayStatus.state === 'running'
                      ? t('common:status.starting')
                      : t(`common:status.${gatewayStatus.state}`),
                  port: gatewayStatus.port,
                  pid: gatewayStatus.pid ? `| pid: ${gatewayStatus.pid}` : '',
                })}
              </span>
              {chatComposerStatusComponents.map((Component, index) => (
                <Component key={`${index}`} gatewayStatus={gatewayStatus} />
              ))}
              </div>
            </div>
            {hasFailedAttachments && (
              <Button
                variant="link"
                size="sm"
                className="h-auto shrink-0 p-0 text-tiny"
                onClick={() => {
                  if (attachmentsLocked) return;
                  setAttachments((prev) => prev.filter((att) => att.status !== 'error'));
                  void pickFiles();
                }}
                disabled={attachmentsLocked}
              >
                {t('composer.retryFailedAttachments')}
              </Button>
            )}
          </div>
        </div>
      </div>
      {talkOpen && <TalkOverlay onClose={() => setTalkOpen(false)} />}
      <ConfirmDialog
        open={!!sensitivePrompt}
        title={t('composer.sensitiveConfirmTitle', '敏感任务提醒')}
        message={t('composer.sensitiveConfirmMessage', {
          tier: sensitivePrompt?.tierLabel ?? '',
          defaultValue: '未配置私有模型。此为敏感/机密任务，是否继续发送到「{{tier}}」来源的模型？',
        })}
        confirmLabel={t('composer.sensitiveConfirmContinue', '继续发送')}
        cancelLabel={t('composer.sensitiveConfirmAbort', '中止')}
        variant="destructive"
        onConfirm={() => sensitiveResolveRef.current?.(true)}
        onCancel={() => sensitiveResolveRef.current?.(false)}
      />
      {microphoneAccess && <MicrophonePermissionDialog access={microphoneAccess} onClose={() => setMicrophoneAccess(null)} />}
    </div>
  );
}

// ── Attachment Preview ───────────────────────────────────────────

function AttachmentPreview({
  attachment,
  onRemove,
  disabled,
}: {
  attachment: FileAttachment;
  onRemove: () => void;
  disabled: boolean;
}) {
  const { t } = useTranslation('chat');
  const isImage = attachment.mimeType.startsWith('image/') && attachment.preview;

  return (
    <div className="relative group">
      <div className="relative rounded-lg overflow-hidden border border-border">
        {isImage ? (
          // Image thumbnail
          <div className="w-16 h-16">
            <img
              src={attachment.preview!}
              alt={attachment.fileName}
              className="w-full h-full object-cover"
            />
          </div>
        ) : (
          // Generic file card
          <div className="flex items-center gap-2 px-3 py-2 bg-surface-input/50 max-w-[200px]">
            <FileIcon mimeType={attachment.mimeType} className="h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 overflow-hidden">
              <p className="text-xs font-medium truncate">{attachment.fileName}</p>
              <p className="text-2xs text-muted-foreground">
                {attachment.mimeType === DIRECTORY_MIME_TYPE
                  ? t('composer.folderAttachment')
                  : attachment.fileSize > 0
                    ? formatFileSize(attachment.fileSize)
                    : '...'}
              </p>
            </div>
          </div>
        )}

        {/* Staging overlay */}
        {attachment.status === 'staging' && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
            <Loader2 className="h-4 w-4 text-white animate-spin" />
          </div>
        )}

        {/* Error overlay */}
        {attachment.status === 'error' && (
          <div
            className="absolute inset-0 bg-destructive/20 flex items-center justify-center"
            title={attachment.error}
          >
            <span className="text-2xs text-destructive font-medium px-1">Error</span>
          </div>
        )}
      </div>

      {/* Remove button */}
      <button
        type="button"
        data-testid="chat-attachment-remove"
        onClick={onRemove}
        disabled={disabled}
        className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function AgentPickerItem({
  agent,
  selected,
  onSelect,
}: {
  agent: AgentSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full flex-col items-start rounded-xl px-3 py-2 text-left transition-colors',
        selected ? 'bg-primary/10 text-foreground' : 'hover:bg-black/5 dark:hover:bg-white/5'
      )}
    >
      <span className="text-sm font-medium text-foreground">{agent.name}</span>
      <span className="text-tiny text-muted-foreground">
        {agent.modelDisplay}
      </span>
    </button>
  );
}

function SkillPickerItem({
  skill,
  selected,
  onSelect,
}: {
  skill: QuickAccessSkill;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid={`chat-composer-skill-option-${skill.name}`}
          onClick={onSelect}
          className={cn(
            'flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition-colors',
            selected ? 'bg-primary/10 text-foreground' : 'hover:bg-black/5 dark:hover:bg-white/5',
          )}
        >
          <div className="min-w-0">
            <div className="truncate text-meta font-semibold text-foreground">
              <span className="font-mono">/{skill.name}</span>
            </div>
            <div className="truncate text-tiny text-muted-foreground">
              {skill.sourceLabel}
            </div>
          </div>
          <span className="rounded-full border border-black/10 bg-black/[0.03] px-2 py-0.5 text-2xs font-medium text-muted-foreground dark:border-white/10 dark:bg-white/[0.04]">
            {skill.sourceLabel}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-xs text-xs leading-relaxed">
        {skill.description}
      </TooltipContent>
    </Tooltip>
  );
}
