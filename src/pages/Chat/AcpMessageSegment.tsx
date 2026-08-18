import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, Copy, Loader2, Sparkles, Square, Volume2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Streamdown, type Components } from 'streamdown';
import { BrowserLink } from '@/components/common/BrowserLink';
import {
  streamdownAnimation,
  streamdownControls,
  streamdownLinkSafety,
  streamdownPlugins,
  streamdownRehypePlugins,
} from '@/components/markdown/streamdown-config';
import type { MessageSegmentItem, RenderPart } from '@/lib/acp/timeline-types';
import { cn } from '@/lib/utils';
import { synthesizeAndPlay, sanitizeForTts, type TtsPlaybackHandle } from '@/lib/voice/tts';
import { toast } from '@/lib/toast';
import { useSettingsStore } from '@/stores/settings';
import { AcpImagePart, isSafeAcpImageSource } from './AcpImagePart';
import { AcpAttachmentPart } from './AcpAttachmentPart';

type RenderTone = 'assistant' | 'user' | 'process';

const chatRemend = { linkMode: 'text-only' } as const;

function AcpMarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const { t } = useTranslation('chat');
  const imageSource = typeof src === 'string' ? src : '';
  if (!imageSource || !isSafeAcpImageSource(imageSource)) return null;

  return (
    <img
      src={imageSource}
      alt={typeof alt === 'string' ? alt : t('acp.image')}
      className="max-w-full rounded-lg"
    />
  );
}

const chatMarkdownComponents: Components = {
  strong: ({ children }) => (
    <strong className="font-semibold" data-streamdown="strong">
      {children}
    </strong>
  ),
  a: ({ href, children }) => href ? (
    <BrowserLink href={href} className="break-all text-primary hover:underline">
      {children}
    </BrowserLink>
  ) : <>{children}</>,
  img: ({ src, alt }) => (
    <AcpMarkdownImage
      src={typeof src === 'string' ? src : undefined}
      alt={typeof alt === 'string' ? alt : undefined}
    />
  ),
  inlineCode: ({ children }) => (
    <code className="break-all font-mono text-sm">
      {children}
    </code>
  ),
};

function normalizeLatexDelimiters(input: string): string {
  if (!input || (input.indexOf('\\(') === -1 && input.indexOf('\\[') === -1)) return input;

  const parts = input.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part || part.startsWith('```') || part.startsWith('`')) continue;
    let next = part.replace(/\\\[([\s\S]+?)\\\]/g, (_m, body: string) => `\n$$\n${body.trim()}\n$$\n`);
    next = next.replace(/\\\(([\s\S]+?)\\\)/g, (_m, body: string) => `$${body}$`);
    parts[i] = next;
  }
  return parts.join('');
}

function AcpMarkdownPart({ text, isAnimating = false }: { text: string; isAnimating?: boolean }) {
  const { t } = useTranslation('common');
  const containerRef = useRef<HTMLDivElement>(null);
  const translations = useMemo(() => ({
    copyCode: t('markdown.copyCode'),
  }), [t]);

  useEffect(() => {
    if (isAnimating) return;

    for (const element of containerRef.current?.querySelectorAll<HTMLElement>('[data-sd-animate]') ?? []) {
      element.removeAttribute('data-sd-animate');
      element.style.removeProperty('--sd-animation');
      element.style.removeProperty('--sd-duration');
      element.style.removeProperty('--sd-easing');
      element.style.removeProperty('--sd-delay');
      if (!element.style.length) element.removeAttribute('style');
    }
  }, [isAnimating]);

  return (
    <div ref={containerRef} className="contents">
      <Streamdown
        animated={isAnimating ? streamdownAnimation : false}
        className="clawx-markdown clawx-streamdown prose prose-sm max-w-none break-words text-foreground dark:prose-invert"
        components={chatMarkdownComponents}
        controls={streamdownControls}
        isAnimating={isAnimating}
        lineNumbers={false}
        linkSafety={streamdownLinkSafety}
        mode="streaming"
        parseIncompleteMarkdown={isAnimating}
        plugins={streamdownPlugins}
        rehypePlugins={streamdownRehypePlugins}
        remend={isAnimating ? chatRemend : undefined}
        translations={translations}
      >
        {normalizeLatexDelimiters(text)}
      </Streamdown>
    </div>
  );
}

function AcpErrorPart({ message }: { message: string }) {
  const { t } = useTranslation('chat');

  return (
    <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-surface-input px-3 py-2 text-sm text-red-700 dark:text-red-400">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-medium">{t('acp.unsupportedContent')}</p>
        <p className="break-words text-xs opacity-80">{message}</p>
      </div>
    </div>
  );
}

function clipboardTextForPart(part: RenderPart): string {
  return part.kind === 'markdown' ? part.text : '';
}

export function clipboardTextForParts(parts: RenderPart[]): string {
  return parts
    .map(clipboardTextForPart)
    .filter((text) => text.trim().length > 0)
    .join('\n\n');
}

export function AcpAssistantHoverBar({ text }: { text: string }) {
  const { t } = useTranslation('chat');
  const [copied, setCopied] = useState(false);

  const copyContent = useCallback(async () => {
    if (!text.trim()) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }, [text]);

  const label = copied ? t('acp.copied') : t('acp.copy');

  return (
    <div className="flex w-full items-center justify-start gap-1 px-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
      <button
        type="button"
        data-testid="acp-assistant-copy"
        aria-label={label}
        title={label}
        onClick={() => void copyContent()}
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:hover:bg-white/10"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-700 dark:text-green-400" aria-hidden="true" />
        ) : (
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
        )}
      </button>
      {text.trim() && <AcpTtsPlayButton text={text} />}
    </div>
  );
}

function AcpTtsPlayButton({ text }: { text: string }) {
  const { t } = useTranslation('chat');
  const ttsConfigured = useSettingsStore((s) => s.voiceCaps?.tts ?? false);
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const handleRef = useRef<TtsPlaybackHandle | null>(null);

  useEffect(() => {
    return () => {
      handleRef.current?.stop();
      handleRef.current = null;
    };
  }, []);

  const toggle = useCallback(async () => {
    if (state === 'playing' || state === 'loading') {
      handleRef.current?.stop();
      handleRef.current = null;
      setState('idle');
      return;
    }
    const speakable = sanitizeForTts(text);
    if (!speakable) return;
    setState('loading');
    try {
      const handle = await synthesizeAndPlay({ text: speakable });
      handleRef.current = handle;
      setState('playing');
      void handle.done.then(() => {
        handleRef.current = null;
        setState('idle');
      });
    } catch (error) {
      setState('idle');
      toast.error(t('voice.ttsFailed', { error: String(error) }));
    }
  }, [state, t, text]);

  const label = !ttsConfigured
    ? t('voice.ttsNotConfigured')
    : state === 'playing'
      ? t('voice.stopPlayback')
      : t('voice.playReply');

  return (
    <button
      type="button"
      data-testid="acp-assistant-speak"
      aria-label={label}
      title={label}
      onClick={() => void toggle()}
      disabled={!ttsConfigured}
      className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/10"
    >
      {state === 'loading' ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      ) : state === 'playing' ? (
        <Square className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true" />
      ) : (
        <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
      )}
    </button>
  );
}

export const AcpRenderPart = memo(function AcpRenderPart({
  part,
  tone = 'assistant',
  isAnimating = false,
}: {
  part: RenderPart;
  tone?: RenderTone;
  isAnimating?: boolean;
}) {
  if (part.kind === 'markdown') {
    if (tone === 'user') {
      return (
        <div className="rounded-2xl bg-primary/10 px-4 py-3 text-foreground shadow-sm">
          <p className="whitespace-pre-wrap break-words">{part.text}</p>
        </div>
      );
    }
    return <AcpMarkdownPart text={part.text} isAnimating={isAnimating} />;
  }

  if (part.kind === 'image') return <AcpImagePart part={part} />;
  if (part.kind === 'attachment') return <AcpAttachmentPart part={part} />;
  return <AcpErrorPart message={part.message} />;
});

export const AcpMessageSegment = memo(function AcpMessageSegment({ item }: { item: MessageSegmentItem }) {
  const isUser = item.role === 'user';
  const clipboardText = useMemo(() => clipboardTextForParts(item.parts), [item.parts]);
  const orderedParts = useMemo(() => isUser
    ? [
      ...item.parts.filter((part) => part.kind !== 'attachment'),
      ...item.parts.filter((part) => part.kind === 'attachment'),
    ]
    : item.parts, [isUser, item.parts]);

  return (
    <div
      data-testid={isUser ? 'acp-user-message' : 'acp-assistant-message'}
      className={cn('group flex w-full gap-3', isUser ? 'justify-end' : 'justify-start')}
    >
      {!isUser && (
        <div className="flex h-6 shrink-0 items-center" data-testid="acp-assistant-avatar" aria-hidden="true">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-black/5 text-foreground dark:bg-white/5">
            <Sparkles className="h-4 w-4" />
          </div>
        </div>
      )}
      <div className={cn('flex min-w-0 flex-col gap-2', isUser ? 'max-w-[80%] items-end' : 'w-full items-start')}>
        {orderedParts.map((part, index) => (
          <AcpRenderPart key={`${part.kind}:${index}`} part={part} tone={item.role} />
        ))}
        {!isUser && clipboardText.trim().length > 0 && <AcpAssistantHoverBar text={clipboardText} />}
      </div>
    </div>
  );
});
