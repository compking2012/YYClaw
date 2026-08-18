/**
 * SubagentTurnBlock — the in-conversation representation of one COMPLETED
 * subagent (Task-tool delegation), placed at its completion-event position by
 * {@link buildConversationBlocks}.
 *
 * The subagent runs in an internal `subagent:` session that is filtered out of
 * the sidebar, so this card is its only entry point in the parent conversation.
 * A compact link (mirroring {@link WorkflowInlineCard}) expands in place to a
 * lazily-loaded, read-only transcript fetched via `sessions.history` — the same
 * fetch path the workflow node drill-down uses.
 *
 * Render-only: nothing here mutates the ACP timeline store.
 */
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import type { AcpSubagentCard } from '@/lib/acp/subagent-projection';
import type { RawMessage } from '@shared/chat/types';
import { loadSessionTranscriptFallback } from '@/stores/chat/history-transcript-fallback';
import { extractText } from './message-utils';
import { cn } from '@/lib/utils';

export function SubagentTurnBlock({ card }: { card: AcpSubagentCard }) {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<RawMessage[] | null>(null);

  const title = card.task || card.agentId || t('subagent.taskFallback');

  const toggle = useCallback(() => {
    const next = !open;
    setOpen(next);
    if (next && messages === null && !loading) {
      setLoading(true);
      void loadSessionTranscriptFallback(card.sessionKey)
        .then((loaded) => setMessages(loaded))
        .finally(() => setLoading(false));
    }
  }, [open, messages, loading, card.sessionKey]);

  const rows = (messages ?? [])
    .map((message) => ({ role: message.role, text: extractText(message).trim() }))
    .filter((row) => row.text.length > 0);

  return (
    <div className="ml-11 flex flex-col gap-2" data-testid="subagent-turn-block">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={t('subagent.viewTranscript')}
        className={cn(
          'inline-flex max-w-md items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs transition-colors hover:bg-black/5 dark:hover:bg-white/10',
        )}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        <Bot className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {t('subagent.badge')}
        </span>
        <span className="truncate font-medium" title={title}>
          {title}
        </span>
      </button>

      {open && (
        <div className="max-w-2xl rounded-lg border border-border bg-muted/30 p-3 text-sm" data-testid="subagent-transcript">
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('subagent.loading')}
            </div>
          ) : rows.length === 0 ? (
            <div className="text-muted-foreground">{t('subagent.empty')}</div>
          ) : (
            <div className="flex flex-col gap-3">
              {rows.map((row, index) => (
                <div key={index} className="flex flex-col gap-0.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {row.role}
                  </span>
                  <div className="whitespace-pre-wrap break-words text-foreground">{row.text}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
