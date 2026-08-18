/**
 * QuestionDirectoryPopover — the "问题目录" list, anchored to the toolbar
 * toggle button as a Radix Popover with an arrow pointing back at it, instead
 * of a persistent sidebar that shares layout space with the message column.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import * as Popover from '@radix-ui/react-popover';
import { cn } from '@/lib/utils';

export type QuestionDirectoryItem = {
  itemId: string;
  anchorId: string;
  title: string;
};

const QUESTION_DIRECTORY_RENDER_LIMIT = 300;

function handleJumpToMessage(anchorId: string) {
  document.getElementById(anchorId)?.scrollIntoView({
    behavior: 'smooth',
    block: 'start',
  });
}

export function QuestionDirectoryPopover({
  open,
  onOpenChange,
  items,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: QuestionDirectoryItem[];
  children: ReactNode;
}) {
  const { t } = useTranslation('chat');
  const scrollRef = useRef<HTMLElement | null>(null);
  const visibleItems =
    items.length > QUESTION_DIRECTORY_RENDER_LIMIT
      ? items.slice(-QUESTION_DIRECTORY_RENDER_LIMIT)
      : items;
  const hiddenCount = Math.max(0, items.length - visibleItems.length);
  const lastItemKey = visibleItems.at(-1)?.itemId ?? '';

  useEffect(() => {
    if (!open) return;
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    const scrollToEnd = () => {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    };

    scrollToEnd();
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(scrollToEnd);
    });

    if (typeof ResizeObserver === 'undefined') {
      return () => cancelAnimationFrame(frame);
    }

    const observer = new ResizeObserver(scrollToEnd);
    observer.observe(scrollEl);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [open, lastItemKey, visibleItems.length]);

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Anchor asChild>{children}</Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          id="chat-question-directory"
          data-testid="chat-question-directory"
          align="end"
          sideOffset={8}
          aria-label={t('questionDirectory.title')}
          className={cn(
            'no-drag z-50 flex max-h-[60vh] w-72 flex-col rounded-2xl border border-border bg-popover p-3 text-popover-foreground shadow-lg',
            'animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
            'data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2',
          )}
        >
          <div className="mb-2 flex shrink-0 items-center justify-between gap-2 px-1">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('questionDirectory.title')}
            </h2>
            <span className="rounded-full bg-black/5 px-2 py-0.5 text-2xs font-medium text-muted-foreground dark:bg-white/10">
              {items.length}
            </span>
          </div>
          <nav ref={scrollRef} className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pr-1">
            {visibleItems.map((item) => (
              <button
                key={item.itemId}
                type="button"
                data-testid={`chat-question-directory-item-${item.itemId}`}
                onClick={() => handleJumpToMessage(item.anchorId)}
                className={cn(
                  'group flex w-full items-start gap-2 rounded-xl px-2 py-2 text-left transition-colors',
                  'text-foreground/70 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10',
                )}
                title={item.title}
              >
                <span className="line-clamp-2 min-w-0 text-xs leading-5">
                  {item.title}
                </span>
              </button>
            ))}
            {hiddenCount > 0 && (
              <div className="px-2 py-2 text-xs leading-5 text-muted-foreground">
                {t('questionDirectory.moreHint', { count: hiddenCount })}
              </div>
            )}
          </nav>
          <Popover.Arrow className="fill-popover" width={14} height={7} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
