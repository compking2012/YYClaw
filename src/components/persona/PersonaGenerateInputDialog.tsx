import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';

export type PersonaGenerateMode = 'single' | 'set';

export interface PersonaGenerateInputDialogProps {
  open: boolean;
  mode: PersonaGenerateMode;
  /** Target file name, shown in the title for single-file mode. */
  targetName?: string | null;
  description: string;
  generating: boolean;
  onDescriptionChange: (value: string) => void;
  onCancel: () => void;
  onGenerate: () => void;
}

/**
 * Natural-language input popup for persona generation. Reused by both the
 * whole-persona entry (mode='set') and the per-file editor toolbar entry
 * (mode='single'); each entry opens its own titled window.
 */
export function PersonaGenerateInputDialog({
  open,
  mode,
  targetName,
  description,
  generating,
  onDescriptionChange,
  onCancel,
  onGenerate,
}: PersonaGenerateInputDialogProps) {
  const { t } = useTranslation('agents');

  const title = mode === 'single'
    ? t('persona.gen.singleTitle', { name: targetName ?? '', defaultValue: 'Generate / edit {{name}} with AI' })
    : t('persona.gen.setTitle', 'Generate the whole persona');
  const subtitle = mode === 'single'
    ? t('persona.gen.singleSubtitle', 'The agent\'s other persona files are used as context. Make a small tweak or a full rewrite — it\'s up to your description.')
    : t('persona.gen.setSubtitle', 'Generates the core persona files together, using existing files as context. A small tweak or a full rewrite is up to your description.');

  const canGenerate = !generating && description.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !generating && onCancel()}>
      <DialogContent
        className="w-[min(560px,95vw)] flex flex-col p-0 gap-0 bg-background rounded-2xl shadow-xl border border-black/10 dark:border-white/10"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="shrink-0 border-b border-black/5 dark:border-white/10 px-5 py-3">
          <DialogTitle className="text-base font-semibold text-foreground truncate">{title}</DialogTitle>
          <p className="text-[13px] text-foreground/60">{subtitle}</p>
        </div>

        <div className="px-5 py-4">
          <Textarea
            autoFocus
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder={t('persona.gen.placeholder', 'Describe the persona you want (e.g. a calm, witty research assistant who loves detail)...')}
            className="min-h-[120px] text-[13px]"
            disabled={generating}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canGenerate) {
                e.preventDefault();
                onGenerate();
              }
            }}
          />
        </div>

        <div className="shrink-0 flex items-center justify-end gap-2 border-t border-black/5 dark:border-white/10 px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={generating}>
            {t('persona.gen.cancel', 'Cancel')}
          </Button>
          <Button size="sm" onClick={onGenerate} disabled={!canGenerate}>
            {generating ? (
              <>
                <LoadingSpinner size="sm" className="mr-1.5" />
                {t('persona.gen.generating', 'Generating...')}
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                {t('persona.gen.generate', 'Generate')}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default PersonaGenerateInputDialog;
