/**
 * Talk Overlay — continuous voice conversation (realtime) UI.
 *
 * Renders the listen → think → speak state machine over the realtime Talk
 * session (see src/lib/voice/conversation.ts). Live transcripts are shown here;
 * the kernel persists the turn to session history, which the chat view refreshes
 * separately. Closing the overlay tears down the session.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Mic } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from '@/lib/toast';
import { startConversation, type ConversationHandle, type ConversationPhase } from '@/lib/voice/conversation';

interface TranscriptLine {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  final: boolean;
}

export function TalkOverlay({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('chat');
  const [phase, setPhase] = useState<ConversationPhase>('listening');
  const [level, setLevel] = useState(0);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const handleRef = useRef<ConversationHandle | null>(null);
  const lineSeq = useRef(0);

  useEffect(() => {
    let disposed = false;
    startConversation({
      onPhase: (p) => {
        if (!disposed) setPhase(p);
      },
      onLevel: (rms) => {
        if (!disposed) setLevel(rms);
      },
      onTranscript: (role, text, final) => {
        if (disposed) return;
        setLines((prev) => {
          const next = [...prev];
          const lastIdx = next.length - 1;
          // Coalesce consecutive interim deltas for the same role into one line.
          if (lastIdx >= 0 && next[lastIdx].role === role && !next[lastIdx].final) {
            next[lastIdx] = { ...next[lastIdx], text, final };
            return next;
          }
          lineSeq.current += 1;
          next.push({ id: lineSeq.current, role, text, final });
          return next;
        });
      },
      onError: (error) => {
        if (!disposed) toast.error(t('voice.talkError', { error: String(error) }));
      },
    })
      .then((handle) => {
        if (disposed) {
          void handle.stop();
          return;
        }
        handleRef.current = handle;
      })
      .catch((error) => {
        if (!disposed) {
          toast.error(t('voice.talkStartFailed', { error: String(error) }));
          onClose();
        }
      });

    return () => {
      disposed = true;
      void handleRef.current?.stop();
      handleRef.current = null;
    };
    // Mount once; onClose/t are stable enough for this lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const phaseLabel =
    phase === 'speaking'
      ? t('voice.phaseSpeaking')
      : phase === 'thinking'
        ? t('voice.phaseThinking')
        : t('voice.phaseListening');

  return createPortal(
    // Transparent full-screen layer only to catch outside clicks; it does NOT
    // dim/cover the window. Clicking the blank area exits the realtime session.
    <div
      className="fixed inset-0 z-50 flex items-end justify-center pb-28"
      onClick={onClose}
      data-testid="talk-overlay-backdrop"
    >
      <div
        className="w-72 rounded-2xl border border-black/10 bg-background p-4 shadow-2xl dark:border-white/10"
        onClick={(e) => e.stopPropagation()}
        data-testid="talk-overlay"
      >
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-medium text-muted-foreground">{phaseLabel}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
            onClick={onClose}
            title={t('voice.exitTalk')}
            data-testid="talk-overlay-close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex flex-col items-center gap-3 py-3">
          <div
            className={cn(
              'flex h-16 w-16 items-center justify-center rounded-full transition-all',
              phase === 'speaking' && 'bg-rose-500/20 text-rose-600 dark:text-rose-400',
              phase === 'thinking' && 'bg-amber-500/20 text-amber-600 dark:text-amber-400',
              phase === 'listening' && 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400',
            )}
            style={phase === 'listening' ? { transform: `scale(${1 + Math.min(level * 1.5, 0.4)})` } : undefined}
            data-testid="talk-overlay-orb"
          >
            <Mic className="h-6 w-6" />
          </div>
        </div>

        {lines.length > 0 && (
          <div className="max-h-32 overflow-y-auto border-t border-black/5 pt-2 dark:border-white/5">
            {lines.slice(-4).map((line) => (
              <div
                key={line.id}
                className={cn('mb-1.5 text-[13px] leading-snug', line.role === 'user' ? 'text-foreground' : 'text-muted-foreground')}
              >
                <span className="mr-1.5 text-2xs uppercase tracking-wide text-muted-foreground/50">
                  {line.role === 'user' ? t('voice.you') : t('voice.assistant')}
                </span>
                {line.text}
              </div>
            ))}
          </div>
        )}

        <p className="mt-2 text-center text-2xs text-muted-foreground/50">{t('voice.tapOutsideToExit')}</p>
      </div>
    </div>,
    document.body,
  );
}
