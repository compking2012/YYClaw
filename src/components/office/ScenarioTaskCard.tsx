import { Building2, ChevronDown, ChevronRight, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { memo, useCallback, useDeferredValue, useMemo, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { TooltipProvider } from '@/components/ui/tooltip';
import { LangGraphWorkflowVisualPreview } from '@/components/office/LangGraphWorkflowVisualPreview';
import { OfficeActionButtons, OfficeInlineIconTooltipButton } from '@/components/office/OfficeActionButtons';
import { TaskRunActions } from '@/components/office/TaskRunActions';
import { WorkflowReviewPanel } from '@/components/office/WorkflowReviewPanel';
import { WorkflowRuntimeStepList } from '@/components/office/WorkflowRuntimeStepList';
import type { WorkflowNodeRuntimeStatus } from '@/components/office/WorkflowVisualPreview';
import { ENABLE_LANGGRAPH } from '@/lib/feature-langgraph';
import { langGraphActiveSourceLabelKey } from '@/lib/office-langgraph-workflow-bundle';
import { isLangGraphNativePlan } from '@/lib/office-langgraph-plan-types';
import { ProjectSourceBadges } from '@/components/office/ProjectSourceBadges';
import { OfficeMissingAgentBadge } from '@/components/office/OfficeMissingAgentBadge';
import { OfficeProjectStatusDot } from '@/components/office/OfficeProjectStatusDot';
import { officeTaskStatusLight, isOfficeProjectArchived, isOfficeProjectExecuting } from '@/lib/office-room-sidebar';
import {
  canDeleteArchivedProject,
  canRestartArchivedProject,
  canUpgradeArchivedStandaloneProject,
} from '@/lib/office-archived-project-actions';
import { isOfficeStandaloneUpgradeEligible } from '@/lib/office-project-lifecycle';
import { isWorkflowResumeEligible, shouldPreserveArchivedWorkflowProgress } from '@/lib/office-project-archive';
import { formatOfficeTaskListTitle } from '@/lib/office-task-order';
import { deriveTaskProgressSync, EMPTY_TASK_PROGRESS_SYNC } from '@/lib/office-task-progress-sync';
import { isSmartTask } from '@/lib/office-task-execution-mode';
import { formatOfficeTaskCardStatusSummary } from '@/lib/office-task-card-summary';
import { taskWorkflowEngine } from '@/lib/office-workflow-engine';
import {
  formatMissingAgentsLabelForIds,
  mergeAgentNameMaps,
  missingAgentsForOfficeEntity,
  resolveProjectAgentRefEntity,
  tempProjectHasMissingAgents,
} from '@/lib/office-missing-agents';
import { orderedWorkflowNodes } from '@/lib/office-workflow-visual';
import type { OfficeFixedGroup, OfficeTempProject, RoomMessage, WorkflowDefinition } from '@/types/office';
import type { ProjectAgentRef } from '@/lib/office-workflow-node';
import { cn } from '@/lib/utils';
import { officeTaskCardActiveClass, officeTaskCardClass } from '@/lib/office-surface-styles';

const archivedIconBtnClass =
  'h-7 w-7 shrink-0 p-0 text-muted-foreground hover:bg-muted/80 hover:text-foreground';
const archivedDeleteIconBtnClass =
  'h-7 w-7 shrink-0 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive';

function ArchivedProjectIconActions({
  projectId,
  canUpgrade,
  canRestart,
  canDelete,
  onUpgrade,
  onRestart,
  onDeleteArchived,
  testIdSuffix = '',
}: {
  projectId: string;
  canUpgrade: boolean;
  canRestart: boolean;
  canDelete: boolean;
  onUpgrade?: (id: string) => void;
  onRestart?: (id: string) => void;
  onDeleteArchived?: (id: string) => void;
  /** Distinguish collapsed-card vs expanded-card test ids. */
  testIdSuffix?: string;
}) {
  const { t } = useTranslation('office');
  const stop = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    fn();
  };
  const suffix = testIdSuffix ? `-${testIdSuffix}` : '';

  return (
    <TooltipProvider delayDuration={0}>
      {canUpgrade && onUpgrade ? (
        <OfficeInlineIconTooltipButton
          label={t('upgradeToFixedGroup')}
          testId={`office-task-upgrade${suffix}-${projectId}`}
          className={archivedIconBtnClass}
          onClick={stop(() => onUpgrade(projectId))}
        >
          <Building2 className="h-3.5 w-3.5" />
        </OfficeInlineIconTooltipButton>
      ) : null}
      {canRestart && onRestart ? (
        <OfficeInlineIconTooltipButton
          label={t('restartProject')}
          testId={`office-task-restart${suffix}-${projectId}`}
          className={archivedIconBtnClass}
          onClick={stop(() => onRestart(projectId))}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </OfficeInlineIconTooltipButton>
      ) : null}
      {canDelete && onDeleteArchived ? (
        <OfficeInlineIconTooltipButton
          label={t('deleteProject')}
          testId={`office-task-delete-archived${suffix}-${projectId}`}
          className={archivedDeleteIconBtnClass}
          onClick={stop(() => {
            if (!confirm(t('deleteArchivedProjectConfirm'))) return;
            onDeleteArchived(projectId);
          })}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </OfficeInlineIconTooltipButton>
      ) : null}
    </TooltipProvider>
  );
}

type ScenarioTaskCardProps = {
  project: OfficeTempProject;
  workflow: WorkflowDefinition;
  projectRoomMessages: RoomMessage[];
  members: ProjectAgentRef[];
  expanded: boolean;
  /** 展开区卡片数据尚未就绪时显示加载态。 */
  cardLoading?: boolean;
  roomActive?: boolean;
  /** 仅活跃项目列表展示名称右侧来源/归档重启标签。 */
  showProjectSourceBadges?: boolean;
  catalogAgentIds?: string[];
  sourceGroup?: Pick<
    OfficeFixedGroup,
    | 'name'
    | 'agentIds'
    | 'coordinatorAgentId'
    | 'workflow'
    | 'workflowDescription'
    | 'workflowStepDrafts'
    | 'workflowOrchestrationMode'
    | 'agentNameHints'
  > | null;
  onSelectProject: () => void;
  onToggleExpanded: () => void;
  onRunProject: (
    id: string,
    opts?: { mode?: 'fresh' | 'continue' | 'single'; nodeId?: string },
  ) => void;
  onEditProject: (project: OfficeTempProject) => void;
  onAbortProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  onUpgradeProject?: (id: string) => void;
  onArchiveProject?: (id: string) => void;
  onRestartProject?: (id: string) => void;
  /** Delete an archived project: its directory + artifacts on disk, and unbind its agents. */
  onDeleteArchivedProject?: (id: string) => void;
};

export const ScenarioTaskCard = memo(function ScenarioTaskCard({
  project,
  workflow,
  projectRoomMessages,
  members,
  expanded,
  cardLoading = false,
  roomActive = false,
  showProjectSourceBadges = false,
  catalogAgentIds = [],
  sourceGroup = null,
  onSelectProject,
  onToggleExpanded,
  onRunProject,
  onEditProject,
  onAbortProject,
  onDeleteProject,
  onUpgradeProject,
  onArchiveProject,
  onRestartProject,
  onDeleteArchivedProject,
}: ScenarioTaskCardProps) {
  const { t } = useTranslation('office');
  const smart = isSmartTask(project);
  const projectMissingAgents = tempProjectHasMissingAgents(
    project,
    catalogAgentIds,
    sourceGroup,
  );
  const archivedRestartConfirmLabel = useMemo(() => {
    if (!projectMissingAgents) return '';
    const entity = resolveProjectAgentRefEntity(project, sourceGroup);
    const missingIds = missingAgentsForOfficeEntity(entity, catalogAgentIds);
    const nameById = mergeAgentNameMaps(sourceGroup?.agentNameHints, project.agentNameHints);
    return formatMissingAgentsLabelForIds(missingIds, nameById, (key, options) => t(key, options));
  }, [catalogAgentIds, project, projectMissingAgents, sourceGroup, t]);
  const handleRestartProject = useCallback(
    (projectId: string) => {
      if (!onRestartProject) return;
      if (projectMissingAgents) {
        if (!window.confirm(t('missingAgents.confirmRestart', { label: archivedRestartConfirmLabel }))) {
          return;
        }
      }
      onRestartProject(projectId);
    },
    [archivedRestartConfirmLabel, onRestartProject, projectMissingAgents, t],
  );
  const workflowNodes = useMemo(() => orderedWorkflowNodes(workflow), [workflow]);
  const langGraphNative =
    ENABLE_LANGGRAPH
    && taskWorkflowEngine(project) === 'langgraph'
    && isLangGraphNativePlan(workflow.orchestrationPlan);
  const langGraphSourceKey = ENABLE_LANGGRAPH
    ? langGraphActiveSourceLabelKey(project.langGraphWorkflowBundle)
    : null;
  const deferredRoomMessages = useDeferredValue(projectRoomMessages);
  const progressSync = useMemo(() => {
    if (!expanded) return EMPTY_TASK_PROGRESS_SYNC;
    return deriveTaskProgressSync(project, workflowNodes, deferredRoomMessages);
  }, [expanded, project, workflowNodes, deferredRoomMessages]);
  const nodeStatusById = useMemo(() => {
    const map: Record<string, WorkflowNodeRuntimeStatus> = {};
    for (const step of progressSync.steps) {
      map[step.nodeId] = step.status;
    }
    for (const wn of workflowNodes) {
      if (!map[wn.id]) map[wn.id] = 'pending';
    }
    return map;
  }, [workflowNodes, progressSync.steps]);

  const stepsByNodeId = useMemo(
    () => new Map(progressSync.steps.map((s) => [s.nodeId, s])),
    [progressSync.steps],
  );
  const projectRunning = isOfficeProjectExecuting(project);
  const statusLight = officeTaskStatusLight(project);
  const isArchived = isOfficeProjectArchived(project);
  const canUpgrade = isOfficeStandaloneUpgradeEligible(project) && Boolean(onUpgradeProject);
  const canUpgradeArchived = canUpgradeArchivedStandaloneProject(
    project,
    Boolean(onUpgradeProject),
  );
  const canArchiveTitle = !isArchived && Boolean(onArchiveProject);
  const canRestart = canRestartArchivedProject(project, Boolean(onRestartProject));
  const canDeleteArchived = canDeleteArchivedProject(project, Boolean(onDeleteArchivedProject));
  const showArchivedWorkflowProgress =
    isArchived
    && !smart
    && workflowNodes.length > 0
    && shouldPreserveArchivedWorkflowProgress(project);
  const showResumeWorkflowHint =
    !isArchived
    && !smart
    && workflowNodes.length > 0
    && isWorkflowResumeEligible(project);

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        officeTaskCardClass,
        roomActive && officeTaskCardActiveClass,
        expanded && 'shadow-md',
      )}
      data-testid={`office-task-card-${project.id}`}
      onClick={onSelectProject}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelectProject();
        }
      }}
    >
      <div
        className={cn(
          'flex items-center gap-1.5',
          expanded &&
          'sticky top-0 z-10 -mx-3 -mt-2.5 mb-1 rounded-t-xl border-b border-border/30 bg-card/95 px-3 pb-2 pt-2 backdrop-blur-md',
        )}
      >
        <button
          type="button"
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted/60"
          aria-expanded={expanded}
          aria-label={t('taskToggleStatus')}
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpanded();
          }}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
        <span title={t(`taskStatus.${project.status}`)}>
          <OfficeProjectStatusDot
            light={statusLight}
            data-testid={`office-task-status-light-${project.id}`}
          />
        </span>
        <span
          className="flex min-w-0 flex-1 items-center gap-0 text-[12px] font-medium leading-snug"
          data-testid="office-task-title"
        >
          <span className="min-w-0 truncate">{formatOfficeTaskListTitle(project)}</span>
          {showProjectSourceBadges ? (
            <ProjectSourceBadges project={project} group={sourceGroup} />
          ) : null}
          {projectMissingAgents ? (
            <OfficeMissingAgentBadge testId={`office-task-missing-agent-${project.id}`} />
          ) : null}
          {langGraphSourceKey ? (
            <span
              className="ml-1.5 inline-flex rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-normal text-primary"
              data-testid="office-task-langgraph-source-badge"
            >
              {t(langGraphSourceKey)}
            </span>
          ) : null}
        </span>
        <div
          className="flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          {isArchived && (canUpgradeArchived || canRestart || canDeleteArchived) ? (
            <ArchivedProjectIconActions
              projectId={project.id}
              canUpgrade={canUpgradeArchived}
              canRestart={canRestart}
              canDelete={canDeleteArchived}
              onUpgrade={onUpgradeProject}
              onRestart={handleRestartProject}
              onDeleteArchived={onDeleteArchivedProject}
            />
          ) : null}
          <OfficeActionButtons
            inline
            showArchive={canArchiveTitle}
            disableArchive={projectRunning}
            archiveDisabledTitle={t('archiveDisabledRunning')}
            disableDelete={projectRunning || isArchived}
            disableEdit={isArchived}
            showDelete={!isArchived}
            onArchive={canArchiveTitle ? () => onArchiveProject!(project.id) : undefined}
            onEdit={isArchived ? undefined : () => onEditProject(project)}
            onDelete={() => onDeleteProject(project.id)}
            archiveTestId="office-task-archive"
            editTestId="office-task-edit"
            deleteTestId="office-task-delete"
          />
        </div>
      </div>
      {expanded ? (
        cardLoading ? (
          <div
            className="mt-3 flex items-center justify-center gap-2 py-8 pl-5 text-xs text-muted-foreground"
            data-testid={`office-task-card-loading-${project.id}`}
          >
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            <span>{t('projectCardLoading')}</span>
          </div>
        ) : (
        <>
          <p className="mt-1 pl-5 text-muted-foreground">
            {smart
              ? t(`taskStatus.${project.status}`)
              : formatOfficeTaskCardStatusSummary(t, project, workflowNodes, progressSync)}
          </p>
          {/* Task description (featureDescription) and the live per-node result log are
              intentionally NOT rendered on the card: the card shows only the title + status
              summary (e.g. "执行中 X/N步"). Full description/results live in the room + detail. */}
          <div className="mt-2 pl-5" onClick={(e) => e.stopPropagation()}>
            {!isArchived ? (
              <TaskRunActions
                project={project}
                workflowNodes={workflowNodes}
                runBlocked={projectMissingAgents}
                className="justify-end gap-1 border-0 p-0 pt-0"
                onRunProject={onRunProject}
                onAbortProject={onAbortProject}
              />
            ) : null}
            <WorkflowReviewPanel project={project} workflow={workflow} disabled={isArchived} />
            {canUpgrade && !isArchived ? (
              <div className="mt-1.5 flex flex-wrap justify-end gap-1">
                <button
                  type="button"
                  className="rounded-md border border-primary/30 bg-primary/5 px-2 py-0.5 text-[10px] text-primary hover:bg-primary/10"
                  data-testid="office-task-upgrade"
                  onClick={() => onUpgradeProject!(project.id)}
                >
                  {t('upgradeToFixedGroup')}
                </button>
              </div>
            ) : null}
            {isArchived && (canRestart || canUpgradeArchived || canDeleteArchived) ? (
              <div
                className="mt-1.5 flex flex-wrap justify-end gap-0.5"
                data-testid={`office-task-archived-actions-${project.id}`}
              >
                <ArchivedProjectIconActions
                  projectId={project.id}
                  canUpgrade={canUpgradeArchived}
                  canRestart={canRestart}
                  canDelete={canDeleteArchived}
                  onUpgrade={onUpgradeProject}
                  onRestart={handleRestartProject}
                  onDeleteArchived={onDeleteArchivedProject}
                  testIdSuffix="expanded"
                />
              </div>
            ) : null}
            {isArchived ? (
              <p className="mt-1 text-right text-[10px] text-muted-foreground" data-testid="office-task-archived-label">
                {t(`projectLifecycle.${project.lifecycle}`)}
                {' · '}
                {t(`taskStatus.${project.status}`)}
                {' · '}
                {t('archivedReadOnly')}
              </p>
            ) : null}
            {showArchivedWorkflowProgress ? (
              <p
                className="mt-1 text-right text-[10px] text-muted-foreground"
                data-testid="office-task-archived-workflow-hint"
              >
                {t('archivedWorkflowProgressHint')}
              </p>
            ) : null}
            {showResumeWorkflowHint ? (
              <p
                className="mt-1 text-right text-[10px] text-muted-foreground"
                data-testid="office-task-resume-workflow-hint"
              >
                {t('archivedWorkflowProgressHint')}
              </p>
            ) : null}
          </div>
          {!smart && workflowNodes.length > 0 ? (
            <div
              className="mt-2 pl-5"
              onClick={(e) => e.stopPropagation()}
              data-testid="office-task-workflow-runtime"
            >
              {langGraphNative ? (
                <LangGraphWorkflowVisualPreview
                  workflow={workflow}
                  members={members}
                  runtime
                  nodeStatusById={nodeStatusById}
                  nodeRuns={project.nodeRuns}
                  stepsByNodeId={stepsByNodeId}
                  canRunNode={(nodeId) => {
                    if (isArchived || projectRunning || projectMissingAgents) return false;
                    const st = nodeStatusById[nodeId];
                    return st !== 'running' && st !== 'completed';
                  }}
                  onRunNode={(nodeId) => {
                    if (projectMissingAgents) return;
                    onRunProject(project.id, { mode: 'single', nodeId });
                  }}
                />
              ) : (
                <WorkflowRuntimeStepList
                  workflow={workflow}
                  members={members}
                  stepsByNodeId={stepsByNodeId}
                  nodeStatusById={nodeStatusById}
                  nodeRuns={project.nodeRuns}
                  canRunNode={(nodeId) => {
                    if (isArchived || projectRunning || projectMissingAgents) return false;
                    const st = nodeStatusById[nodeId];
                    return st !== 'running' && st !== 'completed';
                  }}
                  onRunNode={(nodeId) => {
                    if (projectMissingAgents) return;
                    onRunProject(project.id, { mode: 'single', nodeId });
                  }}
                />
              )}
            </div>
          ) : null}
        </>
        )
      ) : null}
    </div>
  );
});
