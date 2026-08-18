import {
  officeProjectStatusLightDotStyle,
  type OfficeProjectLight,
} from '@/lib/office-project-status-light';
import { cn } from '@/lib/utils';

type OfficeProjectStatusDotProps = {
  light: OfficeProjectLight;
  size?: 'sm' | 'md';
  className?: string;
  'data-testid'?: string;
};

const sizeClass = {
  sm: 'h-1.5 w-1.5',
  md: 'h-2 w-2',
} as const;

export function OfficeProjectStatusDot({
  light,
  size = 'md',
  className,
  'data-testid': testId,
}: OfficeProjectStatusDotProps) {
  const style = officeProjectStatusLightDotStyle(light);

  return (
    <span
      className={cn('relative flex shrink-0', sizeClass[size], className)}
      data-testid={testId}
    >
      {style.pulse ? (
        <span
          className={cn(
            'absolute inline-flex h-full w-full animate-ping rounded-full opacity-60',
            style.pingClass,
          )}
        />
      ) : null}
      <span
        className={cn('relative inline-flex h-full w-full rounded-full', style.dotClass)}
      />
    </span>
  );
}
