import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { OfficeTempProject } from '@/types/office';
import { ModalPortal } from '@/components/ui/modal-portal';

interface ProjectCompletionDialogProps {
  project: OfficeTempProject;
  onArchive: () => void;
  onUpgrade?: () => void;
  onLater: () => void;
}

export function ProjectCompletionDialog({
  project,
  onArchive,
  onUpgrade,
  onLater,
}: ProjectCompletionDialogProps) {
  const { t } = useTranslation('office');
  const spawned = project.origin === 'fixed_group';

  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      data-testid="office-project-completion-dialog"
    >
      <div className="w-full max-w-md rounded-xl border border-border/50 bg-background p-5 shadow-xl">
        <h3 className="font-serif text-base font-normal tracking-tight">
          {t('projectCompletion.title')}
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          {spawned
            ? t('projectCompletion.spawnedHint', { name: project.title })
            : t('projectCompletion.standaloneHint', { name: project.title })}
        </p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onLater} data-testid="office-project-completion-later">
            {t('projectCompletion.later')}
          </Button>
          {!spawned && onUpgrade ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={onUpgrade}
              data-testid="office-project-completion-upgrade"
            >
              {t('upgradeToFixedGroup')}
            </Button>
          ) : null}
          <Button size="sm" onClick={onArchive} data-testid="office-project-completion-archive">
            {t('projectCompletion.archive')}
          </Button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
