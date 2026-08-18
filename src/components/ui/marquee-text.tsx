/**
 * MarqueeText
 *
 * Single-line text that truncates with an ellipsis by default and scrolls
 * ("marquee") on hover only when the content actually overflows. Overflow is
 * measured on pointer enter, so rows whose text already fits never animate.
 *
 * Styling lives in `src/styles/globals.css` (`.clawx-marquee*`), which also
 * disables the animation under `prefers-reduced-motion: reduce`.
 */
import * as React from 'react';
import { cn } from '@/lib/utils';

/** Ignore sub-pixel overflow caused by rounding. */
const MIN_OVERFLOW_PX = 2;
/** Scroll speed of the travelling portion of the animation. */
const SPEED_PX_PER_SECOND = 45;
/** Fraction of the keyframe timeline spent travelling (rest is the end holds). */
const TRAVEL_RATIO = 0.72;
const MIN_DURATION_SECONDS = 1.4;
const MAX_DURATION_SECONDS = 12;

interface MarqueeTextProps extends React.HTMLAttributes<HTMLSpanElement> {
  children: React.ReactNode;
}

export function MarqueeText({ children, className, ...props }: MarqueeTextProps) {
  const trackRef = React.useRef<HTMLSpanElement>(null);
  const frameRef = React.useRef<number | null>(null);
  const [shiftPx, setShiftPx] = React.useState(0);

  const cancelPendingMeasure = React.useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  React.useEffect(() => cancelPendingMeasure, [cancelPendingMeasure]);

  const handleMouseEnter = React.useCallback(() => {
    cancelPendingMeasure();
    // Defer one frame: hovering the row can reveal action buttons that shrink
    // the available width, so measure the hovered layout, not the idle one.
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const track = trackRef.current;
      if (!track) return;
      const overflow = track.scrollWidth - track.clientWidth;
      setShiftPx(overflow > MIN_OVERFLOW_PX ? overflow : 0);
    });
  }, [cancelPendingMeasure]);

  const handleMouseLeave = React.useCallback(() => {
    cancelPendingMeasure();
    setShiftPx(0);
  }, [cancelPendingMeasure]);

  const active = shiftPx > 0;
  const durationSeconds = active
    ? Math.min(
        MAX_DURATION_SECONDS,
        Math.max(MIN_DURATION_SECONDS, shiftPx / SPEED_PX_PER_SECOND / TRAVEL_RATIO),
      )
    : 0;

  return (
    <span
      {...props}
      className={cn('clawx-marquee', className)}
      data-marquee={active ? 'on' : 'off'}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={active
        ? {
            ...props.style,
            '--clawx-marquee-shift': `-${shiftPx}px`,
            '--clawx-marquee-duration': `${durationSeconds.toFixed(2)}s`,
          } as React.CSSProperties
        : props.style}
    >
      <span ref={trackRef} className="clawx-marquee-track">
        {children}
      </span>
    </span>
  );
}
