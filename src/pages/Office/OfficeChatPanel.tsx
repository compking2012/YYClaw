import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStickToBottom } from 'use-stick-to-bottom';
import { CornerDownRight, X } from 'lucide-react';
import { useChatStore } from '@/stores/chat';
import { DEFAULT_SESSION_KEY } from '@/stores/chat/types';
import { useGatewayStore } from '@/stores/gateway';
import { ChatInput } from '@/pages/Chat/ChatInput';
import { ChatMessage } from '@/pages/Chat/ChatMessage';
import { extractText } from '@/pages/Chat/message-utils';
import { useTranslation } from 'react-i18next';
import { formatOfficeDateTime } from '@/lib/office-format';
import {
  OfficeRoleMentionInput,
  type OfficeMentionRole,
} from '@/components/office/OfficeRoleMentionInput';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  roomMessageAuthorPlainLabel,
  roomMessageReplyPreview,
  roomMessageFromCoordinator,
  type RoomAuthorMember,
} from '@/lib/office-room-reply';
import { roomMessageProjectId } from '@/lib/office-agent-id-resolve';
import { useOfficeStore } from '@/stores/office';
import { resolveOfficeRoomBubbleLight } from '@/lib/office-scenario-role-activity';
import {
  officeProjectStatusLightBubbleStyle,
} from '@/lib/office-project-status-light';
import { isUserAbortRoomMessage } from '@/lib/office-workflow-abort';
import type { RoomMessage } from '@/types/office';
import { OfficeRoomMessageAttachments } from './OfficeRoomMessageAttachments';
import { OfficeRoomMessageBody } from './OfficeRoomMessageBody';

export type RoomPostOptions = { replyToId?: string };

interface OfficeChatPanelProps {
  sessionKey: string | null;
  title: string;
  onClose: () => void;
  /** When set, panel shows team room history and sends via office API (with @mentions). */
  roomGroupId?: string | null;
  roomProjectId?: string | null;
  /** @deprecated Use roomGroupId */
  roomScenarioId?: string | null;
  /** @deprecated Use roomProjectId */
  roomTaskId?: string | null;
  mentionRoles?: OfficeMentionRole[];
  roomMessages?: RoomMessage[];
  roomMembers?: RoomAuthorMember[];
  /** @deprecated Use roomMembers */
  roles?: RoomAuthorMember[];
  onPostRoom?: (content: string, opts?: RoomPostOptions) => Promise<void>;
  /** Bottom-right floating panel: no side border, optional hide close. */
  embedded?: boolean;
  hideClose?: boolean;
  compact?: boolean;
  /** Hide title bar when nested under a project room row in the sidebar. */
  hideHeader?: boolean;
  /** Archived project rooms: show history only, no new messages. */
  roomReadOnly?: boolean;
}

type ReplyTarget = {
  id: string;
  preview: string;
  authorLabel: string;
};

export function OfficeChatPanel({
  sessionKey,
  title,
  onClose,
  roomGroupId = null,
  roomProjectId = null,
  roomScenarioId = null,
  roomTaskId = null,
  mentionRoles = [],
  roomMessages = [],
  roomMembers = [],
  roles: rolesProp,
  onPostRoom,
  embedded = false,
  hideClose = false,
  compact = false,
  hideHeader = false,
  roomReadOnly = false,
}: OfficeChatPanelProps) {
  const members = roomMembers.length > 0 ? roomMembers : (rolesProp ?? []);
  const effectiveGroupId = roomGroupId ?? roomScenarioId;
  const effectiveProjectId = roomProjectId ?? roomTaskId;
  // Per-message status light: each bubble tints from its own task phase/node, not the agent's
  // latest project-wide state (prior completed steps stay blue when the agent starts a new step).
  const lightProject = useOfficeStore((s) =>
    effectiveProjectId ? s.tempProjects.find((p) => p.id === effectiveProjectId) : undefined,
  );
  const lightGroup = useOfficeStore((s) =>
    effectiveGroupId ? s.fixedGroups.find((g) => g.id === effectiveGroupId) : undefined,
  );
  const coordinatorAgentId = useMemo(
    () =>
      lightProject?.coordinatorAgentId?.trim()
      || lightGroup?.coordinatorAgentId?.trim()
      || '',
    [lightProject, lightGroup],
  );
  const { t, i18n } = useTranslation(['chat', 'office']);
  const sk = sessionKey?.trim() ?? '';
  const isRoomMode = Boolean(onPostRoom && (effectiveProjectId || effectiveGroupId));
  const messages = useChatStore((s) => s.messages);
  const loading = useChatStore((s) => s.loading);
  const sending = useChatStore((s) => s.sending);
  const error = useChatStore((s) => s.error);
  const switchSession = useChatStore((s) => s.switchSession);
  const clearError = useChatStore((s) => s.clearError);
  const gatewayStatus = useGatewayStore((s) => s.status);
  const restoreSessionKeyRef = useRef<string | null>(null);
  const [roomDraft, setRoomDraft] = useState('');
  const [roomSending, setRoomSending] = useState(false);
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const p2pScrollRef = useRef<HTMLDivElement>(null);
  const {
    scrollRef: roomScrollRef,
    contentRef: roomContentRef,
    scrollToBottom: scrollRoomToBottom,
  } = useStickToBottom({
    initial: 'instant',
    resize: 'smooth',
  });
  const lastRoomScenarioRef = useRef<string | null>(null);

  const authorLabels = useMemo(
    () => ({
      user: t('office:roomFromYou', { defaultValue: 'You' }),
      system: t('office:roomFromSystem', { defaultValue: 'System' }),
    }),
    [t],
  );

  useEffect(() => {
    if (isRoomMode || !sk) return;

    const prior = useChatStore.getState().currentSessionKey;
    restoreSessionKeyRef.current = prior !== sk ? prior : null;
    switchSession(sk);

    return () => {
      const current = useChatStore.getState().currentSessionKey;
      if (current !== sk) return;
      const restore = restoreSessionKeyRef.current;
      switchSession(restore && restore !== sk ? restore : DEFAULT_SESSION_KEY);
    };
  }, [isRoomMode, sk, switchSession]);

  const visibleMessages = messages.filter((m) => m.role === 'user' || m.role === 'assistant');

  const handleSend = useCallback((text: string) => {
    void useChatStore.getState().sendMessage(text);
  }, []);

  const handlePostRoom = useCallback(async () => {
    const text = roomDraft.trim();
    if (!text || !onPostRoom || roomSending) return;
    const replyToId = replyTo?.id;
    setRoomDraft('');
    setReplyTo(null);
    setRoomSending(true);
    try {
      await onPostRoom(text, replyToId ? { replyToId } : undefined);
      void scrollRoomToBottom({ animation: 'smooth' });
    } catch {
      setRoomDraft(text);
      if (replyToId && replyTo) setReplyTo(replyTo);
    } finally {
      setRoomSending(false);
    }
  }, [onPostRoom, replyTo, roomDraft, roomSending, scrollRoomToBottom]);

  const handleClose = useCallback(() => {
    if (!isRoomMode && sk && useChatStore.getState().currentSessionKey === sk) {
      const restore = restoreSessionKeyRef.current;
      switchSession(restore && restore !== sk ? restore : DEFAULT_SESSION_KEY);
    }
    clearError();
    setRoomDraft('');
    setReplyTo(null);
    onClose();
  }, [isRoomMode, sk, switchSession, clearError, onClose]);

  const resolvePlainRoomLabel = useCallback(
    (m: RoomMessage) => roomMessageAuthorPlainLabel(m, members, authorLabels),
    [authorLabels, members],
  );

  const startReply = useCallback(
    (message: RoomMessage) => {
      setReplyTo({
        id: message.id,
        preview: roomMessageReplyPreview(message),
        authorLabel: resolvePlainRoomLabel(message),
      });
    },
    [resolvePlainRoomLabel],
  );

  const visibleRoomMessages = useMemo(() => {
    let list = roomMessages;
    if (effectiveProjectId) {
      list = list.filter((m) => roomMessageProjectId(m) === effectiveProjectId);
    } else if (effectiveGroupId) {
      list = list.filter((m) => !m.groupId || m.groupId === effectiveGroupId);
    }
    return [...list].sort((a, b) => a.timestamp - b.timestamp);
  }, [roomMessages, effectiveGroupId, effectiveProjectId]);

  const roomMessageById = useMemo(() => {
    const map = new Map<string, RoomMessage>();
    for (const m of visibleRoomMessages) map.set(m.id, m);
    return map;
  }, [visibleRoomMessages]);

  /** Changes when list grows or the latest line updates (e.g. task_running progress). */
  const roomScrollSignature = useMemo(() => {
    const last = visibleRoomMessages[visibleRoomMessages.length - 1];
    if (!last) return `empty:${visibleRoomMessages.length}`;
    return [
      visibleRoomMessages.length,
      last.id,
      last.timestamp,
      last.progressText ?? '',
      last.content.length,
    ].join(':');
  }, [visibleRoomMessages]);

  useEffect(() => {
    if (!isRoomMode || visibleRoomMessages.length === 0) return;
    const groupChanged = lastRoomScenarioRef.current !== effectiveGroupId;
    lastRoomScenarioRef.current = effectiveGroupId;
    void scrollRoomToBottom(
      groupChanged ? { animation: 'instant' } : { preserveScrollPosition: true },
    );
  }, [
    isRoomMode,
    effectiveGroupId,
    roomScrollSignature,
    visibleRoomMessages.length,
    scrollRoomToBottom,
  ]);

  const gatewayDown = gatewayStatus.state !== 'running';
  const roomDisabled = gatewayDown || roomSending || roomReadOnly;

  if (!sk) {
    return (
      <div
        className={cn(
          'flex h-full items-center justify-center p-4 text-sm text-muted-foreground',
          !embedded && 'border-l bg-muted/30',
        )}
      >
        {t('office:selectScenario')}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex min-h-0 flex-col bg-background',
        compact ? 'h-full' : 'h-full',
        !embedded && 'border-l',
      )}
      data-testid="office-chat-panel"
    >
      {!hideHeader ? (
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border/50 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{title}</div>
            {!embedded ? (
              <div className="truncate font-mono text-[10px] text-muted-foreground">{sk}</div>
            ) : null}
            {isRoomMode && members.length > 0 ? (
              <div
                className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5"
                data-testid="office-room-member-strip"
              >
                {members.map((mem) => (
                  <span
                    key={mem.agentId}
                    className="inline-flex max-w-[6rem] items-center truncate text-[10px] text-muted-foreground"
                    title={mem.displayName}
                  >
                    {mem.displayName}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          {!hideClose ? (
            <button type="button" onClick={handleClose} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </header>
      ) : null}
      {error && !isRoomMode ? (
        <div className="shrink-0 bg-destructive/10 px-3 py-1 text-xs text-destructive">{error}</div>
      ) : null}
      <div ref={isRoomMode ? roomScrollRef : p2pScrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3" data-testid="office-room-messages">
        {isRoomMode ? (
          visibleRoomMessages.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('office:roomChatEmpty')}</p>
          ) : (
            <div ref={roomContentRef} className="space-y-2.5">
            {visibleRoomMessages.map((m) => {
              const isDeliverablesBundle = m.phase === 'deliverable_bundle';
              const isSystemMessage = m.from === 'system';
              const isUserAbortTerminal = isUserAbortRoomMessage(m);
              const useDeliverablesBundleGreen = isDeliverablesBundle && !isSystemMessage;
              const quotedSource = m.replyToId ? roomMessageById.get(m.replyToId) : undefined;
              const quoted =
                m.replyToId && (quotedSource || m.replyPreview)
                  ? {
                      author: quotedSource
                        ? resolvePlainRoomLabel(quotedSource)
                        : t('office:roomReplyUnknown', { defaultValue: '历史消息' }),
                      preview:
                        m.replyPreview ??
                        (quotedSource ? roomMessageReplyPreview(quotedSource) : ''),
                    }
                  : null;
              const agentLight = isUserAbortTerminal
                ? 'failed'
                : resolveOfficeRoomBubbleLight({
                    message: m,
                    isCoordinatorMessage: roomMessageFromCoordinator(m, coordinatorAgentId),
                    project: lightProject,
                    group: lightGroup,
                    projectRoomMessages: visibleRoomMessages,
                  });
              const senderName = resolvePlainRoomLabel(m);
              return (
                <div
                  key={m.id}
                  data-room-msg-id={m.id}
                  data-agent-light={agentLight ?? undefined}
                  data-testid={
                    isUserAbortTerminal
                      ? 'office-user-abort-room-message'
                      : useDeliverablesBundleGreen
                        ? 'office-deliverables-bundle-message'
                        : undefined
                  }
                  className={cn(
                    'group rounded-xl border p-2.5 text-sm shadow-sm',
                    useDeliverablesBundleGreen
                      ? 'border-emerald-500/45 bg-emerald-500/10 ring-1 ring-emerald-500/25'
                      : isUserAbortTerminal
                        ? 'border-red-500/35 bg-red-500/10 ring-1 ring-red-500/15 text-red-700 dark:text-red-400'
                        : 'border-border/40',
                  )}
                  style={
                    m.from === 'user'
                      ? {
                          backgroundColor: 'hsl(var(--primary) / 0.08)',
                          borderColor: 'hsl(var(--primary) / 0.25)',
                        }
                      : agentLight && !isUserAbortTerminal
                        ? officeProjectStatusLightBubbleStyle(agentLight)
                        : undefined
                  }
                >
                  <div className="mb-1.5 flex items-baseline justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        className={cn(
                          'truncate text-[11px] font-medium',
                          isUserAbortTerminal
                            ? 'text-red-700 dark:text-red-400'
                            : 'text-foreground',
                        )}
                      >
                        {senderName}
                      </span>
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      {m.from !== 'system' ? (
                        <button
                          type="button"
                          className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted/80 hover:text-foreground group-hover:opacity-100"
                          title={t('office:roomReply')}
                          data-testid={`office-room-reply-${m.id}`}
                          onClick={() => startReply(m)}
                        >
                          <CornerDownRight className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                      <time
                        className="text-[10px] tabular-nums text-muted-foreground"
                        dateTime={new Date(m.timestamp).toISOString()}
                      >
                        {formatOfficeDateTime(m.timestamp, i18n.language)}
                      </time>
                    </div>
                  </div>
                  {quoted?.preview ? (
                    <div
                      className="mb-1.5 rounded-md border-l-2 border-primary/30 bg-muted/30 py-1 pl-2.5 text-[11px] text-muted-foreground"
                      data-testid="office-room-quote"
                    >
                      <div className="font-medium text-foreground/80">{quoted.author}</div>
                      <p className="line-clamp-3 whitespace-pre-wrap break-words">{quoted.preview}</p>
                    </div>
                  ) : null}
                  <OfficeRoomMessageBody message={m} />
                  {m.attachments?.length ? (
                    <OfficeRoomMessageAttachments attachments={m.attachments} />
                  ) : null}
                </div>
              );
            })}
            </div>
          )
        ) : loading && visibleMessages.length === 0 ? (
          <div className="text-sm text-muted-foreground">{t('chat:loadingHistory', { defaultValue: 'Loading…' })}</div>
        ) : visibleMessages.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('office:roomChatEmpty')}</p>
        ) : (
          visibleMessages.map((msg, idx) => (
            <ChatMessage
              key={msg.id ?? idx}
              message={msg}
              textOverride={extractText(msg)}
            />
          ))
        )}
      </div>
      <div className="shrink-0 border-t border-border/50 bg-background/80 p-2.5 backdrop-blur-sm">
        {isRoomMode ? (
          roomReadOnly ? (
            <p
              className="text-center text-xs text-muted-foreground"
              data-testid="office-room-archived-readonly"
            >
              {t('office:archivedReadOnly')}
            </p>
          ) : (
          <div className="space-y-2">
            {replyTo ? (
              <div
                className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-2 text-xs"
                data-testid="office-room-reply-banner"
              >
                <CornerDownRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-foreground">
                    {t('office:roomReplyingTo', { name: replyTo.authorLabel })}
                  </div>
                  <p className="line-clamp-2 text-muted-foreground">{replyTo.preview}</p>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded p-0.5 hover:bg-muted"
                  aria-label={t('office:roomCancelReply')}
                  onClick={() => setReplyTo(null)}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : null}
            <div className="flex gap-2">
              <OfficeRoleMentionInput
                value={roomDraft}
                onChange={setRoomDraft}
                onSubmit={() => void handlePostRoom()}
                roles={mentionRoles}
                placeholder={t('office:roomPlaceholder')}
                disabled={roomDisabled}
                multiline
                pickerTitle={t('office:roomMentionPicker')}
                allMentionLabel={t('office:roomMentionAll')}
                inputClassName="min-h-[52px] rounded-lg text-sm"
              />
              <Button
                size="sm"
                className="self-end"
                disabled={roomDisabled || !roomDraft.trim()}
                onClick={() => void handlePostRoom()}
                data-testid="office-room-send"
              >
                {t('office:send')}
              </Button>
            </div>
          </div>
          )
        ) : (
          <ChatInput onSend={handleSend} disabled={gatewayDown || !sk} sending={sending} />
        )}
      </div>
    </div>
  );
}
