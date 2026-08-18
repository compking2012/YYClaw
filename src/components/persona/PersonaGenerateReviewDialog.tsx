import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';

export interface GeneratedPersonaFile {
  name: string;
  content: string;
}

export interface PersonaGenerateReviewDialogProps {
  open: boolean;
  /** Editable drafts, owned by the parent (controlled). */
  files: GeneratedPersonaFile[];
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
  onFileChange: (index: number, content: string) => void;
}

/**
 * Review step for the "generate whole persona set" flow. Shows each generated
 * file as an editable draft (state owned by the parent); the user can tweak,
 * then Save all (writes to disk) or Cancel (discards everything). Nothing is
 * written until Save.
 */
export function PersonaGenerateReviewDialog({
  open,
  files,
  saving,
  onCancel,
  onSave,
  onFileChange,
}: PersonaGenerateReviewDialogProps) {
  const { t } = useTranslation('agents');

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !saving && onCancel()}>
      <DialogContent
        className="w-[min(820px,95vw)] h-[80vh] flex flex-col p-0 gap-0 bg-background rounded-2xl shadow-xl border border-black/10 dark:border-white/10"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="shrink-0 border-b border-black/5 dark:border-white/10 px-5 py-3">
          <DialogTitle className="text-lg font-semibold text-foreground">
            {t('persona.gen.reviewTitle', 'Review generated files')}
          </DialogTitle>
          <p className="text-[13px] text-foreground/60">
            {t('persona.gen.reviewSubtitle', 'Review and edit before saving. Nothing is written until you save.')}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {files.map((file, index) => (
            <div key={file.name} className="space-y-1.5">
              <label className="text-[13px] font-semibold text-foreground">{file.name}</label>
              <Textarea
                value={file.content}
                onChange={(e) => onFileChange(index, e.target.value)}
                className="min-h-[200px] font-mono text-[12px] leading-relaxed"
                spellCheck={false}
              />
            </div>
          ))}
        </div>

        <div className="shrink-0 flex items-center justify-end gap-2 border-t border-black/5 dark:border-white/10 px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
            {t('persona.gen.cancel', 'Cancel')}
          </Button>
          <Button size="sm" onClick={onSave} disabled={saving || files.length === 0}>
            {saving && <LoadingSpinner size="sm" className="mr-1.5" />}
            {saving
              ? t('persona.gen.saving', 'Saving...')
              : t('persona.gen.saveAll', 'Save all')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default PersonaGenerateReviewDialog;
