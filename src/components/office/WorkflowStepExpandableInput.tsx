import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { officeFormFieldClass } from '@/lib/office-form-field-styles';
import { cn } from '@/lib/utils';

interface WorkflowStepExpandableInputProps {
  inputId: string;
  expandedId: string | null;
  onExpandChange: (id: string | null) => void;
  value: string;
  disabled?: boolean;
  placeholder?: string;
  testId?: string;
  compactClassName?: string;
  /** 紧凑态已占满整列（如输出行），溢出时直接多行而非先扩宽 */
  compactFullWidth?: boolean;
  onChange: (value: string) => void;
}

const SINGLE_LINE_CLASS = officeFormFieldClass(
  'box-border h-8 min-h-8 max-h-8 w-full text-xs leading-normal',
);
const MULTILINE_CLASS = officeFormFieldClass(
  'box-border min-h-8 w-full resize-none overflow-hidden py-1.5 text-xs leading-normal md:text-xs',
);

function fieldOverflows(el: HTMLInputElement | HTMLTextAreaElement): boolean {
  return el.scrollWidth > el.clientWidth + 1;
}

function resizeTextarea(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${Math.max(32, el.scrollHeight)}px`;
}

/** 内容超出可见宽度时才扩至整行；整行仍不够则自动增高为多行。 */
export function WorkflowStepExpandableInput({
  inputId,
  expandedId,
  onExpandChange,
  value,
  disabled = false,
  placeholder,
  testId,
  compactClassName = 'min-w-0 flex-1',
  compactFullWidth = false,
  onChange,
}: WorkflowStepExpandableInputProps) {
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const focusedRef = useRef(false);
  const expandedIdRef = useRef(expandedId);

  useEffect(() => {
    expandedIdRef.current = expandedId;
  }, [expandedId]);

  const [widthExpanded, setWidthExpanded] = useState(false);
  const [multiline, setMultiline] = useState(false);

  const notifyExpanded = useCallback(
    (next: boolean) => {
      if (next) {
        if (expandedIdRef.current !== inputId) onExpandChange(inputId);
        return;
      }
      if (expandedIdRef.current === inputId) onExpandChange(null);
    },
    [inputId, onExpandChange],
  );

  const resetLayout = useCallback(() => {
    setMultiline(false);
    if (!compactFullWidth) setWidthExpanded(false);
    notifyExpanded(false);
  }, [compactFullWidth, notifyExpanded]);

  const applyLayout = useCallback(() => {
    const el = fieldRef.current;
    if (!el || !focusedRef.current) return;

    if (value.includes('\n')) {
      setMultiline(true);
      if (!compactFullWidth) setWidthExpanded(true);
      notifyExpanded(true);
      return;
    }

    if (el instanceof HTMLTextAreaElement) {
      resizeTextarea(el);
      return;
    }

    if (!fieldOverflows(el)) return;

    if (compactFullWidth) {
      setMultiline(true);
      notifyExpanded(true);
      return;
    }

    if (widthExpanded) {
      setMultiline(true);
      notifyExpanded(true);
      return;
    }

    setWidthExpanded(true);
    notifyExpanded(true);
  }, [compactFullWidth, notifyExpanded, value, widthExpanded]);

  /** 扩宽后 DOM 已更新，再测一次是否需多行 */
  useLayoutEffect(() => {
    if (!focusedRef.current || !widthExpanded || multiline || compactFullWidth) return;
    const el = fieldRef.current;
    if (!el || el instanceof HTMLTextAreaElement) return;
    if (!fieldOverflows(el)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- measure overflow after width expand
    setMultiline(true);
    notifyExpanded(true);
  }, [compactFullWidth, multiline, notifyExpanded, widthExpanded]);

  useLayoutEffect(() => {
    if (!multiline) return;
    const el = fieldRef.current;
    if (!(el instanceof HTMLTextAreaElement)) return;
    resizeTextarea(el);
  }, [multiline, value]);

  const scheduleLayout = useCallback(() => {
    requestAnimationFrame(() => applyLayout());
  }, [applyLayout]);

  const handleBlur = useCallback(() => {
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.dataset.workflowStepInputGroup === inputId) {
        return;
      }
      focusedRef.current = false;
      resetLayout();
    });
  }, [inputId, resetLayout]);

  const handleFocus = useCallback(() => {
    focusedRef.current = true;
    scheduleLayout();
  }, [scheduleLayout]);

  const handleChange = useCallback(
    (next: string) => {
      onChange(next);
      scheduleLayout();
    },
    [onChange, scheduleLayout],
  );

  const visuallyExpanded = widthExpanded || multiline;
  const activeRing = visuallyExpanded ? 'border-primary/40 ring-1 ring-primary/20' : undefined;

  return (
    <div
      data-workflow-step-input-group={inputId}
      className={cn(
        'min-w-0 shrink transition-[width,flex-basis] duration-150 ease-out',
        visuallyExpanded ? 'w-full basis-full' : compactClassName,
      )}
    >
      {multiline ? (
        <Textarea
          ref={fieldRef as RefObject<HTMLTextAreaElement>}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          rows={1}
          data-testid={testId}
          className={cn(MULTILINE_CLASS, activeRing)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onChange={(e) => handleChange(e.target.value)}
        />
      ) : (
        <Input
          ref={fieldRef as RefObject<HTMLInputElement>}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          data-testid={testId}
          className={cn(SINGLE_LINE_CLASS, activeRing)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onChange={(e) => handleChange(e.target.value)}
        />
      )}
    </div>
  );
}
