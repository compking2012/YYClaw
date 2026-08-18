import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
  OFFICE_ROOM_MAX_WIDTH_PCT,
  OFFICE_ROOM_MIN_WIDTH_PCT,
} from '@/lib/office-layout';
import { useOfficeWorkspaceSplit } from '@/stores/office-workspace-split';

export interface OfficeWorkspaceResizeDividerProps {
  containerRef: React.RefObject<HTMLElement | null>;
  className?: string;
}

export function OfficeWorkspaceResizeDivider({
  containerRef,
  className,
}: OfficeWorkspaceResizeDividerProps) {
  const { t } = useTranslation('office');
  const setRoomWidthPct = useOfficeWorkspaceSplit((s) => s.setRoomWidthPct);
  const moveHandlerRef = useRef<((e: PointerEvent) => void) | null>(null);
  const upHandlerRef = useRef<((e: PointerEvent) => void) | null>(null);

  const stopDragging = useCallback(() => {
    if (moveHandlerRef.current) {
      window.removeEventListener('pointermove', moveHandlerRef.current);
      moveHandlerRef.current = null;
    }
    if (upHandlerRef.current) {
      window.removeEventListener('pointerup', upHandlerRef.current);
      upHandlerRef.current = null;
    }
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // window listeners below are sufficient.
      }

      const onMove = (ev: PointerEvent) => {
        const node = containerRef.current;
        if (!node) return;
        const rect = node.getBoundingClientRect();
        if (rect.width <= 0) return;
        const rightWidth = rect.right - ev.clientX;
        const pct = (rightWidth / rect.width) * 100;
        setRoomWidthPct(pct);
      };
      const onUp = () => stopDragging();

      moveHandlerRef.current = onMove;
      upHandlerRef.current = onUp;
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [containerRef, setRoomWidthPct, stopDragging],
  );

  useEffect(() => stopDragging, [stopDragging]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuemin={OFFICE_ROOM_MIN_WIDTH_PCT}
      aria-valuemax={OFFICE_ROOM_MAX_WIDTH_PCT}
      data-testid="office-workspace-resize-divider"
      onPointerDown={handlePointerDown}
      className={cn(
        'group relative z-10 hidden w-1.5 shrink-0 cursor-col-resize select-none lg:block',
        className,
      )}
      title={t('resizeWorkspaceSplit')}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-black/5 transition-colors group-hover:bg-primary/40 dark:bg-white/10"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 rounded-full opacity-0 transition-opacity group-hover:bg-primary/40 group-hover:opacity-100"
      />
    </div>
  );
}
