import { Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { canContinueTask, canRerunFresh } from '@/lib/office-task-run';
import { isSmartTask } from '@/lib/office-task-execution-mode';
import { isOfficeProjectAbortQuiescing } from '@/lib/office-workflow-abort';
import { cn } from '@/lib/utils';
import type { OfficeTempProject, WorkflowNode } from '@/types/office';

const runBtnClass =
  'h-7 border-primary/25 bg-background text-primary hover:bg-primary/5 hover:text-primary';
const secondaryRunBtnClass =
  'h-7 border-border/60 bg-background text-foreground hover:bg-muted/60';

type TaskRunActionsProps = {
  project: OfficeTempProject;
  workflowNodes: WorkflowNode[];
  disabled?: boolean;
  /** When true, start/continue/rerun buttons are disabled (e.g. missing agents). */
  runBlocked?: boolean;
  runBlockedTitle?: string;
  className?: string;
  onRunProject: (
    id: string,
    opts?: {
      mode?: 'fresh' | 'continue' | 'single';
      nodeId?: string;
      clearProjectRoom?: boolean;
    },
  ) => void;
  onAbortProject: (id: string) => void;
};

export function TaskRunActions({
  project,
  workflowNodes,
  disabled = false,
  runBlocked = false,
  runBlockedTitle,
  className,
  onRunProject,
  onAbortProject,
}: TaskRunActionsProps) {
  const { t } = useTranslation('office');
  const abortQuiescing = isOfficeProjectAbortQuiescing(project);
  const isRunning =
    project.status === 'running' || project.nodeRuns.some((n) => n.status === 'running');
  const smart = isSmartTask(project);
  const canStart = smart || workflowNodes.length > 0;
  const runDisabled = disabled || runBlocked;
  const runTitle = runBlocked ? (runBlockedTitle ?? t('missingAgents.runBlocked')) : undefined;

  return (
    <div
      className={cn('flex flex-wrap items-center gap-1.5 border-t pt-3', className)}
      data-testid="office-task-run-actions"
    >
      {abortQuiescing ? (
        <Button
          size="sm"
          variant="outline"
          className={secondaryRunBtnClass}
          disabled
          data-testid="office-task-abort-quiescing"
          title={t('abortQuiescingHint')}
        >
          {t('abortQuiescing')}
        </Button>
      ) : !isRunning ? (
        <>
          {project.nodeRuns.length === 0 || project.nodeRuns.every((n) => n.status === 'pending') ? (
            <Button
              size="sm"
              variant="outline"
              className={runBtnClass}
              disabled={runDisabled || !canStart}
              title={runTitle}
              data-testid="office-task-run"
              onClick={() =>
                onRunProject(project.id, {
                  mode: 'fresh',
                  clearProjectRoom: smart,
                })
              }
            >
              <Play className="mr-1 h-3 w-3" />
              {t('startTask')}
            </Button>
          ) : null}
          {canRerunFresh(project) ? (
            <Button
              size="sm"
              variant="outline"
              className={secondaryRunBtnClass}
              disabled={runDisabled}
              title={runBlocked ? runTitle : t('rerunFreshHint')}
              onClick={() => {
                if (!confirm(t('rerunFreshConfirm'))) return;
                onRunProject(project.id, { mode: 'fresh', clearProjectRoom: true });
              }}
            >
              {t('rerunTask')}
            </Button>
          ) : null}
          {!smart && canContinueTask(project, workflowNodes) ? (
            <Button
              size="sm"
              variant="outline"
              className={runBtnClass}
              disabled={runDisabled}
              title={runBlocked ? runTitle : t('continueTaskHint')}
              data-testid="office-task-continue"
              onClick={() => onRunProject(project.id, { mode: 'continue' })}
            >
              {t('continueTask')}
            </Button>
          ) : null}
        </>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className={secondaryRunBtnClass}
          disabled={disabled}
          data-testid="office-task-abort"
          onClick={() => onAbortProject(project.id)}
        >
          {t('abortTask')}
        </Button>
      )}
    </div>
  );
}
