import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { roomMessageHeaderLine, roomMessageProgressText } from '@/lib/office-room-message';
import {
  displayRoomMessageBody,
  stripRoomAgentIconFromContent,
  stripRoomAgentIconPrefix,
} from '@/lib/office-room-reply-format';
import { cn } from '@/lib/utils';
import type { RoomMessage } from '@/types/office';

export function OfficeRoomMessageBody({
  message,
  className,
}: {
  message: RoomMessage;
  className?: string;
}) {
  const { t } = useTranslation('office');
  const scrollRef = useRef<HTMLDivElement>(null);
  const progress = roomMessageProgressText(message);

  useEffect(() => {
    if (message.phase !== 'task_running' || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [message.phase, progress]);

  if (message.phase === 'deliverable_bundle') {
    return (
      <div
        className={cn(
          'whitespace-pre-wrap break-words font-medium leading-relaxed text-foreground',
          className,
        )}
        data-testid="office-deliverables-bundle-body"
      >
        {stripRoomAgentIconFromContent(displayRoomMessageBody(message))}
      </div>
    );
  }

  if (message.phase === 'task_running') {
    return (
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">
          {stripRoomAgentIconPrefix(roomMessageHeaderLine(message))}
        </p>
        <div
          ref={scrollRef}
          className="max-h-28 overflow-y-auto rounded-lg border border-border/40 bg-background/80 p-2.5 text-xs leading-relaxed whitespace-pre-wrap break-words"
          data-testid="office-room-running-log"
        >
          {progress || t('roomRunningEmpty')}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('whitespace-pre-wrap break-words', className)}>
      {stripRoomAgentIconFromContent(displayRoomMessageBody(message))}
    </div>
  );
}
