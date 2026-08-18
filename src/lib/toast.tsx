import { toast as sonnerToast, ExternalToast } from 'sonner';
import { Copy } from 'lucide-react';
import React from 'react';
import i18n from '@/i18n';
import { copyText } from '@/lib/clipboard';
import { presentError } from '@/lib/error-present';

function handleCopy(textToCopy: string): void {
  void copyText(textToCopy).then((ok) => {
    if (ok) {
      sonnerToast.success(i18n.t('common:actions.copy') + ' ✔', { duration: 1500 });
    }
  });
}

function renderCopyButton(textToCopy: string) {
  return (
    <button
      onPointerDown={(e) => {
        // Prevent toast from intercepting the click or dismissing
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        handleCopy(textToCopy);
      }}
      className="absolute right-0 top-0 opacity-50 hover:opacity-100 transition-opacity p-0.5 cursor-pointer rounded-md hover:bg-black/10 dark:hover:bg-white/10"
      title={i18n.t('errors:copyDetail')}
    >
      <Copy className="h-4 w-4" />
    </button>
  );
}

const customToast = {
  ...sonnerToast,
  error: (message: string | React.ReactNode, data?: ExternalToast) => {
    const textToCopy = typeof message === 'string' ? message : '';

    if (!textToCopy) {
      return sonnerToast.error(message, data);
    }

    return sonnerToast.error(
      <div className="flex items-start justify-between w-full group relative pr-6">
        <span className="break-words">{message}</span>
        {renderCopyButton(textToCopy)}
      </div>,
      data,
    );
  },
  /**
   * Show a friendly, classified, localized error toast for any raw error.
   * Leads with a friendly title + message; the copy button copies the
   * original error text (detail) for troubleshooting. Benign gateway
   * lifecycle errors are silently ignored.
   */
  appError: (err: unknown, data?: ExternalToast & { code?: string }) => {
    const { code, ...toastData } = data ?? {};
    const fe = presentError(err, { code });
    if (fe.benign) return;

    return sonnerToast.error(
      <div className="flex items-start justify-between w-full group relative pr-6">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="font-medium break-words">{fe.title}</span>
          {fe.message && <span className="text-sm opacity-90 break-words">{fe.message}</span>}
          {fe.hint && <span className="text-xs opacity-70 break-words">{fe.hint}</span>}
        </div>
        {renderCopyButton(fe.detail)}
      </div>,
      toastData,
    );
  },
};

export { customToast as toast };
