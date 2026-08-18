/**
 * CollapsibleErrorNotice — friendly, classified, localized error display that
 * stays collapsed to a single low-key line until clicked.
 *
 * Many run failures this surfaces aren't actually fatal (e.g. a cleanup step
 * erroring after the real work already succeeded), so it intentionally
 * avoids a loud destructive-red treatment even when expanded — severity is
 * hinted only through the small icon accent, not a saturated card.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, ChevronDown, ChevronRight, Copy, Lightbulb } from 'lucide-react';
import { presentError } from '@/lib/error-present';
import { copyText } from '@/lib/clipboard';
import { cn } from '@/lib/utils';

export interface CollapsibleErrorNoticeProps {
  error: unknown;
  /** Optional backend error code preserved from the main process (openclaw / gateway). */
  code?: string;
  onDismiss?: () => void;
  onRetry?: () => void;
  className?: string;
  testId?: string;
  dismissTestId?: string;
}

export function CollapsibleErrorNotice({
  error,
  code,
  onDismiss,
  onRetry,
  className,
  testId,
  dismissTestId,
}: CollapsibleErrorNoticeProps) {
  const { t } = useTranslation(['errors', 'common']);
  const fe = useMemo(() => presentError(error, { code }), [error, code]);
  const [expanded, setExpanded] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [copied, setCopied] = useState(false);

  if (fe.benign || (!fe.title && !fe.message)) return null;

  const hasDetail = Boolean(fe.detail) && fe.detail !== fe.message;

  const handleCopy = () => {
    void copyText(fe.detail).then((ok) => {
      if (ok) {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }
    });
  };

  return (
    <div className={cn('w-full', className)} data-testid={testId}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="inline-flex max-w-full items-center gap-2 rounded-full border border-border/50 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-black/5 dark:hover:bg-white/10"
      >
        <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
        <span className="truncate" title={fe.title}>{fe.title}</span>
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="mt-2 rounded-xl border border-border/50 bg-surface-input/40 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium text-foreground flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              {fe.title}
            </p>
            <div className="flex items-center gap-3 shrink-0">
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="text-xs text-muted-foreground hover:text-foreground underline"
                >
                  {t('errors:retry')}
                </button>
              )}
              {onDismiss && (
                <button
                  type="button"
                  onClick={onDismiss}
                  data-testid={dismissTestId}
                  className="text-xs text-muted-foreground hover:text-foreground underline"
                >
                  {t('common:actions.dismiss')}
                </button>
              )}
            </div>
          </div>

          {fe.message && (
            <p className="mt-1 text-sm text-foreground/90 break-words">{fe.message}</p>
          )}

          {fe.hint && (
            <p className="mt-1 text-xs text-muted-foreground flex items-start gap-1.5">
              <Lightbulb className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span className="break-words">{fe.hint}</span>
            </p>
          )}

          {hasDetail && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowDetail((v) => !v)}
                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              >
                {showDetail ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                {t('errors:detailLabel')}
              </button>
              {showDetail && (
                <div className="mt-1 relative">
                  <pre className="rounded-lg bg-surface-input p-3 pr-9 text-xs whitespace-pre-wrap break-words overflow-auto max-h-48 text-muted-foreground">
                    {fe.detail}
                  </pre>
                  <button
                    type="button"
                    onClick={handleCopy}
                    title={t('errors:copyDetail')}
                    className="absolute right-1.5 top-1.5 opacity-60 hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-black/10 dark:hover:bg-white/10"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  {copied && (
                    <span className="absolute right-9 top-2 text-xs text-muted-foreground">
                      {t('common:actions.copy')} ✔
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
