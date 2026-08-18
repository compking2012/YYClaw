import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  buildRoomMentionPickerRoles,
  getActiveMention,
  insertMentionToken,
  isRoomMentionAllRole,
  roleMentionToken,
} from '@/lib/office-mention';

export interface OfficeMentionRole {
  agentId: string;
  displayName: string;
  emoji?: string;
}

interface OfficeRoleMentionInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  roles: OfficeMentionRole[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  multiline?: boolean;
  testId?: string;
  pickerTitle?: string;
  /** Label for @all row in the mention picker (e.g. "所有人"). */
  allMentionLabel?: string;
}

export function OfficeRoleMentionInput({
  value,
  onChange,
  onSubmit,
  roles,
  placeholder,
  disabled,
  className,
  inputClassName,
  multiline = false,
  testId = 'office-room-mention-input',
  pickerTitle,
  allMentionLabel,
}: OfficeRoleMentionInputProps) {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const pickerItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const mentionContextRef = useRef<{ start: number; query: string } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [mentionQuery, setMentionQuery] = useState('');
  const isComposingRef = useRef(false);

  const filteredRoles = useMemo(
    () => buildRoomMentionPickerRoles(roles, mentionQuery),
    [roles, mentionQuery],
  );

  const safeHighlightIndex =
    filteredRoles.length === 0
      ? 0
      : Math.min(highlightIndex, filteredRoles.length - 1);

  const syncMentionState = useCallback(
    (text: string, cursor: number) => {
      const active = getActiveMention(text, cursor);
      if (!active || roles.length === 0) {
        setPickerOpen(false);
        setMentionStart(null);
        setMentionQuery('');
        mentionContextRef.current = null;
        return;
      }
      const prev = mentionContextRef.current;
      const mentionContextChanged =
        !prev || prev.start !== active.start || prev.query !== active.query;
      mentionContextRef.current = { start: active.start, query: active.query };
      setMentionStart(active.start);
      setMentionQuery(active.query);
      setPickerOpen(true);
      if (mentionContextChanged) {
        setHighlightIndex(0);
      }
    },
    [roles.length],
  );

  const applyRoleMention = useCallback(
    (role: OfficeMentionRole) => {
      if (mentionStart === null) return;
      const next = insertMentionToken(value, mentionStart, role);
      onChange(next);
      setPickerOpen(false);
      setMentionStart(null);
      setMentionQuery('');
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (!el) return;
        const pos = mentionStart + roleMentionToken(role).length + 2;
        el.focus();
        el.setSelectionRange(pos, pos);
      });
    },
    [mentionStart, onChange, value],
  );

  const handleChange = useCallback(
    (text: string, cursor: number) => {
      onChange(text);
      syncMentionState(text, cursor);
    },
    [onChange, syncMentionState],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (pickerOpen && filteredRoles.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setHighlightIndex((i) => (i + 1) % filteredRoles.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setHighlightIndex((i) => (i - 1 + filteredRoles.length) % filteredRoles.length);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setPickerOpen(false);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          const nativeEvent = e.nativeEvent as KeyboardEvent;
          if (
            e.key === 'Enter' &&
            (isComposingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229)
          ) {
            return;
          }
          e.preventDefault();
          const role = filteredRoles[safeHighlightIndex];
          if (role) applyRoleMention(role);
          return;
        }
      }

      if (e.key === 'Enter' && !e.shiftKey && onSubmit) {
        const nativeEvent = e.nativeEvent as KeyboardEvent;
        if (isComposingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229) {
          return;
        }
        e.preventDefault();
        onSubmit();
      }
    },
    [applyRoleMention, filteredRoles, safeHighlightIndex, onSubmit, pickerOpen],
  );

  useEffect(() => {
    if (!pickerOpen) return;
    pickerItemRefs.current[safeHighlightIndex]?.scrollIntoView({ block: 'nearest' });
  }, [safeHighlightIndex, pickerOpen]);

  const handleSelectionSync = useCallback(
    (target: HTMLInputElement | HTMLTextAreaElement, key?: string) => {
      if (
        key &&
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Tab', 'Escape'].includes(key)
      ) {
        return;
      }
      syncMentionState(target.value, target.selectionStart ?? target.value.length);
    },
    [syncMentionState],
  );

  const sharedProps = {
    value,
    disabled,
    placeholder,
    'data-testid': testId,
    onCompositionStart: () => {
      isComposingRef.current = true;
    },
    onCompositionEnd: () => {
      isComposingRef.current = false;
    },
    onKeyDown: handleKeyDown,
    className: inputClassName,
  };

  return (
    <div className={cn('relative min-w-0 flex-1', className)}>
      {pickerOpen && filteredRoles.length > 0 ? (
        <div
          className="absolute bottom-full left-0 z-30 mb-1 max-h-48 w-full min-w-[220px] overflow-hidden rounded-xl border border-black/10 bg-background p-1 shadow-xl dark:border-white/10"
          data-testid="office-room-mention-picker"
        >
          {pickerTitle ? (
            <div className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground">{pickerTitle}</div>
          ) : null}
          <div className="max-h-40 overflow-y-auto">
            {filteredRoles.map((role, index) => (
              <button
                key={role.agentId}
                ref={(node) => {
                  pickerItemRefs.current[index] = node;
                }}
                type="button"
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs',
                  index === safeHighlightIndex ? 'bg-primary/10 text-primary' : 'hover:bg-muted/60',
                )}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlightIndex(index)}
                onClick={() => applyRoleMention(role)}
              >
                <span className="text-base leading-none">{role.emoji ?? '🤖'}</span>
                <span className="min-w-0 flex-1 truncate font-medium">
                  {isRoomMentionAllRole(role) ? (allMentionLabel ?? role.displayName) : role.displayName}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">@{roleMentionToken(role)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {multiline ? (
        <Textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          rows={2}
          {...sharedProps}
          onChange={(e) => handleChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onClick={(e) => handleSelectionSync(e.currentTarget)}
          onKeyUp={(e) => handleSelectionSync(e.currentTarget, e.key)}
        />
      ) : (
        <Input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          {...sharedProps}
          onChange={(e) => handleChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onClick={(e) => handleSelectionSync(e.currentTarget)}
          onKeyUp={(e) => handleSelectionSync(e.currentTarget, e.key)}
        />
      )}
    </div>
  );
}
