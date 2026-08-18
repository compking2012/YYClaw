import { Download, FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { hostApi } from '@/lib/host-api';
import { compressPathToTilde } from '@/lib/office-workflow-closure-deliverables';
import type { RoomMessageAttachment } from '@/types/office';

async function saveAttachmentAs(attachment: RoomMessageAttachment): Promise<void> {
  const result = await hostApi.files.saveAs({
    filePath: attachment.absPath,
    defaultFileName: attachment.displayName,
  });
  if (!result?.success && result?.error) {
    console.warn('[office] save deliverables bundle failed:', result.error);
  }
}

export function OfficeRoomMessageAttachments({
  attachments,
}: {
  attachments: RoomMessageAttachment[];
}) {
  const { t } = useTranslation('office');
  if (!attachments.length) return null;

  return (
    <div className="mt-2 space-y-1.5" data-testid="office-room-attachments">
      {attachments.map((att) => (
        <div
          key={`${att.absPath}-${att.displayName}`}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-muted/20 px-2.5 py-2 text-xs"
        >
          <span className="min-w-0 flex-1 truncate font-medium text-foreground">{att.displayName}</span>
          {att.fileCount != null ? (
            <span className="text-muted-foreground">
              {t('deliverablesBundleFileCount', { count: att.fileCount })}
            </span>
          ) : null}
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background px-2 py-1 text-[11px] font-medium transition-colors hover:bg-muted/80"
              data-testid="office-deliverables-download"
              onClick={() => void saveAttachmentAs(att)}
            >
              <Download className="h-3 w-3" />
              {t('deliverablesBundleSaveAs')}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
              title={compressPathToTilde(att.absPath)}
              onClick={() => void hostApi.shell.showItemInFolder(att.absPath)}
            >
              <FolderOpen className="h-3 w-3" />
              {t('deliverablesBundleReveal')}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
