/**
 * Combobox — free-text input backed by a candidate list.
 *
 * Differs from a native <datalist> / <select> in two ways the product needs:
 *  1. The dropdown ALWAYS lists every option (no prefix/substring filtering as
 *     you type), and
 *  2. Any value can be typed, including values NOT in the candidate list.
 *
 * Used for model-id / voice-param candidate inputs (KindParamsEditor, provider
 * model ids, global TTS model). Structural enums keep using a real <select>.
 */
import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

/**
 * Normalize a model-id placeholder (a single string, or a string[] of
 * candidates) into a flat options list. A lone candidate still yields a
 * one-item list so the dropdown opens and the value can be picked — callers
 * that did `Array.isArray(x) ? x : []` previously dropped single-string
 * candidates, leaving an unselectable field.
 */
export function placeholderToOptions(placeholder: string | string[] | undefined | null): string[] {
  if (Array.isArray(placeholder)) {
    return placeholder.filter((opt): opt is string => typeof opt === 'string' && opt.trim().length > 0);
  }
  if (typeof placeholder === 'string' && placeholder.trim().length > 0) {
    return [placeholder];
  }
  return [];
}

export interface ComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  /** Applied to the inner input so callers can reuse their existing field styling. */
  className?: string;
  id?: string;
  disabled?: boolean;
  /** When set, shows a leading item that clears the value (e.g. "Default"). */
  emptyOptionLabel?: string;
  'data-testid'?: string;
}

export function Combobox({
  value,
  onChange,
  options,
  placeholder,
  className,
  id,
  disabled,
  emptyOptionLabel,
  'data-testid': testId,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  const commit = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  const hasMenu = options.length > 0 || emptyOptionLabel !== undefined;

  return (
    <div ref={containerRef} className="relative">
      <Input
        id={id}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
          else if (e.key === 'ArrowDown') setOpen(true);
        }}
        className={cn('pr-9', className)}
        data-testid={testId}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground disabled:opacity-50"
        aria-label="toggle options"
      >
        <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open && hasMenu && (
        <ul
          role="listbox"
          className="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-xl border border-black/10 dark:border-white/10 bg-background text-popover-foreground shadow-lg py-1"
        >
          {emptyOptionLabel !== undefined && (
            <li>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit('')}
                className="w-full text-left px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10"
              >
                {emptyOptionLabel}
              </button>
            </li>
          )}
          {options.map((opt) => (
            <li key={opt}>
              <button
                type="button"
                // Prevent the input from blurring before the click registers.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(opt)}
                className={cn(
                  'w-full text-left px-3 py-1.5 text-[13px] hover:bg-black/5 dark:hover:bg-white/10',
                  opt === value && 'bg-black/5 dark:bg-white/10 font-medium'
                )}
                data-testid={testId ? `${testId}-option-${opt}` : undefined}
              >
                {opt}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
