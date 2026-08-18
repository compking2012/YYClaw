import { Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { cn } from '@/lib/utils';
import { SKILL_CATEGORY_IDS } from '@/lib/skill-categories';
import {
  SKILL_PICKER_MODAL_CONTENT_CLASS,
  SKILL_PICKER_MODAL_OVERLAY_CLASS,
  skillPickerDialogShellClasses,
  skillPickerDialogSubtitleClasses,
  skillPickerDialogTitleClasses,
  skillPickerFooterButtonClasses,
  skillPickerInputClasses,
  skillPickerLabelClasses,
} from '@/components/skills/skill-picker-styles';

type PublishSkillMetaDialogProps = {
  open: boolean;
  author: string;
  version: string;
  category: string;
  fileName?: string;
  authorPlaceholder?: string;
  remoteVersion?: string;
  error?: string;
  busy?: boolean;
  onPickFile: () => void;
  onAuthorChange: (value: string) => void;
  onVersionChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
};

export function PublishSkillMetaDialog({
  open,
  author,
  version,
  category,
  fileName,
  authorPlaceholder,
  remoteVersion,
  error,
  busy = false,
  onPickFile,
  onAuthorChange,
  onVersionChange,
  onCategoryChange,
  onSubmit,
  onCancel,
}: PublishSkillMetaDialogProps) {
  const { t } = useTranslation('skills');

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onCancel(); }}>
      <DialogContent
        overlayClassName={SKILL_PICKER_MODAL_OVERLAY_CLASS}
        className={cn(
          SKILL_PICKER_MODAL_CONTENT_CLASS,
          skillPickerDialogShellClasses,
          'w-[calc(100%-2rem)] max-w-md p-6',
        )}
      >
        <DialogTitle className={skillPickerDialogTitleClasses}>{t('publishMeta.title')}</DialogTitle>
        <DialogDescription className={skillPickerDialogSubtitleClasses}>
          {t('publishMeta.description')}
        </DialogDescription>

        <form
          className="mt-5 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) onSubmit();
          }}
        >
          <div className="flex flex-col gap-2">
            <Label className={cn(skillPickerLabelClasses, 'block')}>
              {t('publishMeta.fileSectionLabel')}
            </Label>
            <Button
              type="button"
              variant="outline"
              onClick={onPickFile}
              disabled={busy}
              className={cn(skillPickerFooterButtonClasses, 'h-[38px] w-full justify-center gap-2')}
            >
              <Upload className="h-4 w-4 shrink-0" />
              {t('publishMeta.pickFileButton')}
            </Button>
            {fileName ? (
              <p className="truncate text-[13px] text-foreground/55" title={fileName}>
                {t('publishMeta.fileLabel', { name: fileName })}
              </p>
            ) : (
              <p className="text-[12px] leading-5 text-foreground/45">{t('publishMeta.noFileSelected')}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="publish-author" className={skillPickerLabelClasses}>
              {t('publishMeta.authorLabel')}
            </Label>
            <Input
              id="publish-author"
              value={author}
              onChange={(e) => onAuthorChange(e.target.value)}
              placeholder={authorPlaceholder || t('publishMeta.authorPlaceholder')}
              className={skillPickerInputClasses}
              disabled={busy}
            />
            {authorPlaceholder && (
              <p className="text-[12px] leading-5 text-foreground/55">
                {t('publishMeta.authorDefaultHint', { username: authorPlaceholder })}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="publish-version" className={skillPickerLabelClasses}>
              {t('publishMeta.versionLabel')}
            </Label>
            <Input
              id="publish-version"
              value={version}
              onChange={(e) => onVersionChange(e.target.value)}
              placeholder={t('publishMeta.versionPlaceholder')}
              className={skillPickerInputClasses}
              disabled={busy}
            />
            <p className="text-[12px] leading-5 text-foreground/55">{t('publishMeta.versionHint')}</p>
            {remoteVersion && (
              <p className="text-[12px] leading-5 text-amber-600">
                {t('publishMeta.remoteVersionHint', { version: remoteVersion })}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="publish-category" className={cn(skillPickerLabelClasses, 'block')}>
              {t('publishMeta.categoryLabel')}
            </Label>
            <select
              id="publish-category"
              value={category}
              onChange={(e) => onCategoryChange(e.target.value)}
              disabled={busy}
              className={cn(skillPickerInputClasses, 'w-full cursor-pointer')}
            >
              {SKILL_CATEGORY_IDS.map((id) => (
                <option key={id} value={id}>
                  {t(`publishMeta.categoryOptions.${id}`)}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <p className="rounded-xl bg-destructive/10 px-3 py-2 text-[13px] leading-5 text-destructive">{error}</p>
          )}

          <div className="mt-1 flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={busy}
              className={skillPickerFooterButtonClasses}
            >
              {t('publishMeta.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={busy}
              className="h-9 gap-1.5 rounded-full px-4 text-[13px] font-medium"
            >
              {busy ? <LoadingSpinner size="sm" /> : null}
              {t('publishMeta.submit')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
