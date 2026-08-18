import { useCallback, useMemo, useState, type RefObject } from 'react';
import { Archive, FolderKanban, Plus, Users } from 'lucide-react';
import { useOfficeDisplayLists } from '@/hooks/use-office-display-lists';
import { useOfficeWorkspaceSplit } from '@/stores/office-workspace-split';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { OfficeProjectRoomsSidebar } from '@/components/office/OfficeProjectRoomsSidebar';
import { OfficeWorkspaceResizeDivider } from '@/components/office/OfficeWorkspaceResizeDivider';
import { OfficeTeamCardStrip } from '@/components/office/OfficeTeamCardStrip';
import { ScenarioTaskCard } from '@/components/office/ScenarioTaskCard';
import { OfficePanelSection } from '@/components/office/OfficePanelSection';
import { OfficeProjectSubsection } from '@/components/office/OfficeProjectSubsection';
import { sortOfficeProjectsBySequence } from '@/lib/office-task-order';
import {
  displayAgentsForProject,
  workflowForProject,
} from '@/lib/office-task-workflow';
import {
  projectMembersFromIds,
  resolveProjectRoomParticipants,
} from '@/lib/office-project-members';
import {
  isOfficeProjectArchived,
  isOfficeProjectCardExpanded,
  shouldShowOfficeProjectRoomsPanel,
} from '@/lib/office-room-sidebar';
import { useOfficeProjectPrefetch } from '@/hooks/use-office-project-prefetch';
import { shouldShowProjectCardPrefetchLoading, shouldShowProjectRoomPrefetchLoading } from '@/lib/office-project-prefetch';
import {
  officeInsetPanelClass,
  officeRoomPanelClass,
  officeZonePanelClass,
} from '@/lib/office-surface-styles';
import type { AgentSummary } from '@/types/agent';
import type { OfficeFixedGroup, OfficeTempProject, RoomMessage } from '@/types/office';
import type { OfficeMentionRole } from '@/components/office/OfficeRoleMentionInput';

export interface OfficeWorkspaceAreaProps {
  t: (key: string, opts?: Record<string, unknown>) => string;
  expandedProjectId: string | null;
  activeRoomProjectId: string | null;
  officeSplitContainerRef: RefObject<HTMLDivElement | null>;
  onNewGroup: () => void;
  onEditGroup: (group: OfficeFixedGroup) => void;
  onDeleteGroup: (id: string) => void;
  onReorderGroups: (orderedIds: string[]) => void | Promise<void>;
  onNewProject: () => void;
  onSpawnProject: (groupId: string) => void;
  onToggleProject: (projectId: string) => void;
  onRunProject: (
    id: string,
    opts?: { mode?: 'fresh' | 'continue' | 'single'; nodeId?: string },
  ) => void;
  onEditProject: (project: OfficeTempProject) => void;
  onAbortProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  onUpgradeProject: (id: string) => void;
  onArchiveProject: (id: string) => void;
  onRestartProject: (id: string) => void;
  onDeleteArchivedProject: (id: string) => void;
  onPostRoom: (
    projectId: string,
    content: string,
    opts?: { replyToId?: string },
  ) => Promise<void>;
}

export function OfficeWorkspaceArea({
  t,
  expandedProjectId,
  activeRoomProjectId,
  officeSplitContainerRef,
  onNewGroup,
  onEditGroup,
  onDeleteGroup,
  onReorderGroups,
  onNewProject,
  onSpawnProject,
  onToggleProject,
  onRunProject,
  onEditProject,
  onAbortProject,
  onDeleteProject,
  onUpgradeProject,
  onArchiveProject,
  onRestartProject,
  onDeleteArchivedProject,
  onPostRoom,
}: OfficeWorkspaceAreaProps) {
  const {
    fixedGroups,
    tempProjects,
    roomMessagesByProject,
    agents: clientAgents,
  } = useOfficeDisplayLists();
  const officeRoomWidthPct = useOfficeWorkspaceSplit((s) => s.roomWidthPct);

  const allActiveGroupProjects = useMemo(
    () =>
      sortOfficeProjectsBySequence(
        tempProjects.filter(
          (p) =>
            p.origin === 'fixed_group'
            && Boolean(p.parentGroupId)
            && !isOfficeProjectArchived(p),
        ),
      ),
    [tempProjects],
  );

  const archivedGroupProjects = useMemo(
    () =>
      sortOfficeProjectsBySequence(
        tempProjects.filter(
          (p) =>
            p.origin === 'fixed_group'
            && Boolean(p.parentGroupId)
            && isOfficeProjectArchived(p),
        ),
      ),
    [tempProjects],
  );

  const standaloneProjectsAll = useMemo(
    () =>
      sortOfficeProjectsBySequence(
        tempProjects.filter((p) => p.origin === 'standalone'),
      ),
    [tempProjects],
  );

  const standaloneProjects = useMemo(
    () => standaloneProjectsAll.filter((p) => !isOfficeProjectArchived(p)),
    [standaloneProjectsAll],
  );

  const archivedStandaloneProjects = useMemo(
    () => standaloneProjectsAll.filter((p) => isOfficeProjectArchived(p)),
    [standaloneProjectsAll],
  );

  const activeProjects = useMemo(
    () => sortOfficeProjectsBySequence([...standaloneProjects, ...allActiveGroupProjects]),
    [standaloneProjects, allActiveGroupProjects],
  );

  const archivedProjects = useMemo(
    () =>
      sortOfficeProjectsBySequence([...archivedStandaloneProjects, ...archivedGroupProjects]),
    [archivedStandaloneProjects, archivedGroupProjects],
  );

  const workspaceProjects = useMemo(
    () => sortOfficeProjectsBySequence([...activeProjects, ...archivedProjects]),
    [activeProjects, archivedProjects],
  );

  const agentLookup = useCallback(
    (id: string) => clientAgents.find((a) => a.id === id)?.name,
    [clientAgents],
  );

  const activeRoomProject = useMemo(
    () =>
      activeRoomProjectId
        ? workspaceProjects.find((p) => p.id === activeRoomProjectId) ?? null
        : null,
    [activeRoomProjectId, workspaceProjects],
  );

  const roomPanelProject = useMemo(() => {
    const panelId = expandedProjectId ?? activeRoomProjectId;
    if (!panelId) return null;
    return workspaceProjects.find((p) => p.id === panelId) ?? null;
  }, [activeRoomProjectId, expandedProjectId, workspaceProjects]);

  const roomChatActive =
    activeRoomProjectId !== null && activeRoomProjectId === expandedProjectId;

  useOfficeProjectPrefetch(activeRoomProjectId);
  const roomLoading = roomPanelProject
    ? shouldShowProjectRoomPrefetchLoading(
        roomPanelProject.id,
        isOfficeProjectArchived(roomPanelProject),
        roomPanelProject,
      )
    : false;

  /** Same roster as project edit page (incl. inherited fixed-group template). */
  const roomPanelParentGroup = useMemo(() => {
    const groupId = roomPanelProject?.parentGroupId?.trim();
    if (!groupId) return null;
    return fixedGroups.find((g) => g.id === groupId) ?? null;
  }, [fixedGroups, roomPanelProject]);

  /**
   * Member strip + @ picker share one source: current panel project only.
   * @all is injected by OfficeRoleMentionInput / buildRoomMentionPickerRoles.
   */
  const roomParticipants = useMemo(
    () => resolveProjectRoomParticipants(roomPanelProject, roomPanelParentGroup, agentLookup),
    [agentLookup, roomPanelParentGroup, roomPanelProject],
  );

  const mentionAgents = useMemo(
    () =>
      roomParticipants.map((m): OfficeMentionRole => ({
        agentId: m.agentId,
        displayName: m.displayName,
        emoji: '🤖',
      })),
    [roomParticipants],
  );

  const roomMembers = useMemo(
    () =>
      roomParticipants.map((m) => ({
        agentId: m.agentId,
        displayName: m.displayName,
      })),
    [roomParticipants],
  );

  const showProjectRoomsPanel = useMemo(
    () => shouldShowOfficeProjectRoomsPanel(activeProjects, activeRoomProject),
    [activeProjects, activeRoomProject],
  );

  const officeZoneWidthPct = showProjectRoomsPanel ? 100 - officeRoomWidthPct : 100;

  const handleCollapseRoom = useCallback(() => {
    const id = activeRoomProjectId ?? expandedProjectId;
    if (id) onToggleProject(id);
  }, [activeRoomProjectId, expandedProjectId, onToggleProject]);

  return (
    <div
      ref={officeSplitContainerRef}
      className={cn(
        'flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden',
        showProjectRoomsPanel && 'lg:flex-row',
      )}
      style={
        showProjectRoomsPanel
          ? ({
              '--office-zone-width': `${officeZoneWidthPct}%`,
              '--office-room-width': `${officeRoomWidthPct}%`,
            } as React.CSSProperties)
          : undefined
      }
      data-testid="office-workspace"
    >
      <div
        className={cn(
          officeZonePanelClass,
          showProjectRoomsPanel && 'w-full border-r lg:w-[var(--office-zone-width)] lg:shrink-0',
        )}
        data-testid="office-zone-panel"
      >
        <OfficeWorkspacePanel
          t={t}
          fixedGroups={fixedGroups}
          activeProjects={activeProjects}
          archivedGroupProjects={archivedGroupProjects}
          archivedStandaloneProjects={archivedStandaloneProjects}
          activeProjectCount={activeProjects.length}
          archivedProjectCount={archivedProjects.length}
          allProjects={tempProjects}
          clientAgents={clientAgents}
          agentLookup={agentLookup}
          roomMessagesByProject={roomMessagesByProject}
          expandedProjectId={expandedProjectId}
          activeRoomProjectId={activeRoomProjectId}
          onNewGroup={onNewGroup}
          onEditGroup={onEditGroup}
          onDeleteGroup={onDeleteGroup}
          onReorderGroups={onReorderGroups}
          onNewProject={onNewProject}
          onSpawnProject={onSpawnProject}
          onToggleProject={onToggleProject}
          onRunProject={onRunProject}
          onEditProject={onEditProject}
          onAbortProject={onAbortProject}
          onDeleteProject={onDeleteProject}
          onUpgradeProject={onUpgradeProject}
          onArchiveProject={onArchiveProject}
          onRestartProject={onRestartProject}
          onDeleteArchivedProject={onDeleteArchivedProject}
        />
      </div>

      {showProjectRoomsPanel ? (
        <>
          <OfficeWorkspaceResizeDivider containerRef={officeSplitContainerRef} />
          <div
            className={cn(
              officeRoomPanelClass,
              'lg:w-[var(--office-room-width)] lg:shrink-0',
            )}
            data-testid="office-project-rooms-panel"
          >
            <OfficeProjectRoomsSidebar
              activeRoomProject={roomPanelProject}
              roomChatActive={roomChatActive}
              roomLoading={roomLoading}
              roomMembers={roomMembers}
              mentionRoles={mentionAgents}
              roomMessagesByProject={roomMessagesByProject}
              onCollapseRoom={handleCollapseRoom}
              onPostRoom={onPostRoom}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

function OfficeWorkspacePanel(props: {
  t: (k: string, opts?: Record<string, unknown>) => string;
  fixedGroups: OfficeFixedGroup[];
  activeProjects: OfficeTempProject[];
  archivedGroupProjects: OfficeTempProject[];
  archivedStandaloneProjects: OfficeTempProject[];
  activeProjectCount: number;
  archivedProjectCount: number;
  allProjects: OfficeTempProject[];
  clientAgents: AgentSummary[];
  agentLookup: (id: string) => string | undefined;
  roomMessagesByProject: Record<string, RoomMessage[]>;
  expandedProjectId: string | null;
  activeRoomProjectId: string | null;
  onNewGroup: () => void;
  onEditGroup: (group: OfficeFixedGroup) => void;
  onDeleteGroup: (id: string) => void;
  onReorderGroups: (orderedIds: string[]) => void | Promise<void>;
  onNewProject: () => void;
  onSpawnProject: (groupId: string) => void;
  onToggleProject: (projectId: string) => void;
  onRunProject: (
    id: string,
    opts?: { mode?: 'fresh' | 'continue' | 'single'; nodeId?: string },
  ) => void;
  onEditProject: (project: OfficeTempProject) => void;
  onAbortProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  onUpgradeProject: (id: string) => void;
  onArchiveProject: (id: string) => void;
  onRestartProject: (id: string) => void;
  onDeleteArchivedProject: (id: string) => void;
}) {
  const {
    t,
    fixedGroups,
    activeProjects,
    archivedGroupProjects,
    archivedStandaloneProjects,
    activeProjectCount,
    archivedProjectCount,
    allProjects,
    clientAgents,
    agentLookup,
    roomMessagesByProject,
    expandedProjectId,
    activeRoomProjectId,
    onNewGroup,
    onEditGroup,
    onDeleteGroup,
    onReorderGroups,
    onNewProject,
    onSpawnProject,
    onToggleProject,
    onRunProject,
    onEditProject,
    onAbortProject,
    onDeleteProject,
    onUpgradeProject,
    onArchiveProject,
    onRestartProject,
    onDeleteArchivedProject,
  } = props;

  const catalogAgentIds = useMemo(
    () => clientAgents.map((a) => a.id),
    [clientAgents],
  );

  const [archivedExpanded, setArchivedExpanded] = useState(false);

  const archivedGroupSections = useMemo(() => {
    const byGroup = new Map<string, OfficeTempProject[]>();
    for (const project of archivedGroupProjects) {
      const groupId = project.parentGroupId?.trim();
      if (!groupId) continue;
      const list = byGroup.get(groupId) ?? [];
      list.push(project);
      byGroup.set(groupId, list);
    }
    const knownGroupIds = new Set(fixedGroups.map((g) => g.id));
    const ordered = fixedGroups
      .map((group) => ({
        group,
        projects: sortOfficeProjectsBySequence(byGroup.get(group.id) ?? []),
      }))
      .filter(({ projects }) => projects.length > 0);
    const orphans = [...byGroup.entries()]
      .filter(([groupId]) => !knownGroupIds.has(groupId))
      .map(([groupId, projects]) => ({
        group: null as OfficeFixedGroup | null,
        projects: sortOfficeProjectsBySequence(projects),
        key: groupId,
      }));
    return [
      ...ordered.map(({ group, projects }) => ({ group, projects, key: group.id })),
      ...orphans,
    ];
  }, [archivedGroupProjects, fixedGroups]);

  const handleArchivedSectionToggle = () => {
    setArchivedExpanded((v) => !v);
  };

  const handleToggleProject = useCallback(
    (projectId: string) => {
      const project = allProjects.find((p) => p.id === projectId);
      if (project && isOfficeProjectArchived(project)) {
        setArchivedExpanded(true);
      }
      onToggleProject(projectId);
    },
    [allProjects, onToggleProject],
  );

  const isProjectExpanded = useCallback(
    (projectId: string) =>
      isOfficeProjectCardExpanded({
        projectId,
        expandedProjectId,
      }),
    [expandedProjectId],
  );

  const renderProjectCard = (
    project: OfficeTempProject,
    groupForWorkflow: OfficeFixedGroup | null,
    options?: { showProjectSourceBadges?: boolean },
  ) => (
    <ScenarioTaskCardWithPrefetch
      key={project.id}
      project={project}
      groupForWorkflow={groupForWorkflow}
      showProjectSourceBadges={options?.showProjectSourceBadges ?? false}
      expanded={isProjectExpanded(project.id)}
      roomActive={activeRoomProjectId === project.id}
      roomMessagesByProject={roomMessagesByProject}
      agentLookup={agentLookup}
      catalogAgentIds={catalogAgentIds}
      onToggle={() => handleToggleProject(project.id)}
      onRunProject={onRunProject}
      onEditProject={onEditProject}
      onAbortProject={onAbortProject}
      onDeleteProject={onDeleteProject}
      onUpgradeProject={onUpgradeProject}
      onArchiveProject={onArchiveProject}
      onRestartProject={onRestartProject}
      onDeleteArchivedProject={onDeleteArchivedProject}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="office-scenario-panel">
      <div
        className="shrink-0 border-b border-border/30 bg-card/40 px-4 py-3"
        data-testid="office-fixed-groups-section"
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/10">
              <Users className="h-3.5 w-3.5" />
            </span>
            <span className="font-serif text-sm font-normal tracking-tight text-foreground">
              {t('fixedGroupsPanelWithCount', { count: fixedGroups.length })}
            </span>
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="h-8 shrink-0 px-2.5 text-xs shadow-sm"
            onClick={onNewGroup}
            data-testid="office-new-group"
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t('createFixedGroup')}
          </Button>
        </div>
        {fixedGroups.length === 0 ? (
          <div className="flex h-24 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/50 bg-muted/10 text-center">
            <Users className="h-5 w-5 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">{t('emptyFixedGroups')}</p>
          </div>
        ) : (
          <div className={officeInsetPanelClass}>
            <OfficeTeamCardStrip
              t={t}
              groups={fixedGroups}
              allProjects={allProjects}
              agents={clientAgents}
              onEditGroup={onEditGroup}
              onDeleteGroup={onDeleteGroup}
              onSpawnProject={onSpawnProject}
              onReorderGroups={onReorderGroups}
            />
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col" data-testid="office-temp-projects-section">
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <OfficePanelSection
            testId="office-active-projects-section"
            title={t('activeProjectsSectionCount', { count: activeProjectCount })}
            icon={<FolderKanban className="h-3.5 w-3.5" />}
            action={(
              <Button
                size="sm"
                variant="secondary"
                className="h-7 shrink-0 px-2 text-xs"
                onClick={onNewProject}
                data-testid="office-new-temp-project"
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                {t('createTempProject')}
              </Button>
            )}
          >
            {activeProjectCount === 0 ? (
              <p className="px-1 py-2 text-[11px] text-muted-foreground">{t('emptyTempProjects')}</p>
            ) : (
              <div className="space-y-2" data-testid="office-active-projects-flat">
                {activeProjects.map((project) => {
                  const groupId = project.parentGroupId?.trim();
                  const group =
                    groupId ? fixedGroups.find((g) => g.id === groupId) ?? null : null;
                  return renderProjectCard(project, group, { showProjectSourceBadges: true });
                })}
              </div>
            )}
          </OfficePanelSection>

          {archivedProjectCount > 0 ? (
            <OfficePanelSection
              testId="office-archived-projects-section"
              muted
              headerClickable
              headerExpanded={archivedExpanded}
              headerTestId="office-archived-projects-toggle"
              onHeaderClick={handleArchivedSectionToggle}
              title={t('archivedProjectsSectionCount', { count: archivedProjectCount })}
              icon={<Archive className="h-3.5 w-3.5" />}
            >
              {archivedExpanded ? (
                <div className="space-y-3">
                  {archivedStandaloneProjects.length > 0 ? (
                    <OfficeProjectSubsection
                      variant="standalone"
                      testId="office-archived-standalone-projects"
                      title={t('standaloneProjectsSectionCount', {
                        count: archivedStandaloneProjects.length,
                      })}
                    >
                      {archivedStandaloneProjects.map((project) => renderProjectCard(project, null))}
                    </OfficeProjectSubsection>
                  ) : null}
                  {archivedGroupSections.map(({ group, projects, key }) => (
                    <OfficeProjectSubsection
                      key={key}
                      variant="spawn"
                      testId={`office-archived-group-projects-${key}`}
                      title={
                        group
                          ? t('groupSpawnProjectsSectionCount', {
                              name: group.name,
                              count: projects.length,
                            })
                          : t('archivedProjectsSectionCount', { count: projects.length })
                      }
                    >
                      {projects.map((project) => renderProjectCard(project, group))}
                    </OfficeProjectSubsection>
                  ))}
                </div>
              ) : null}
            </OfficePanelSection>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ScenarioTaskCardWithPrefetch({
  project,
  groupForWorkflow,
  showProjectSourceBadges,
  expanded,
  roomActive,
  roomMessagesByProject,
  agentLookup,
  catalogAgentIds,
  onToggle,
  onRunProject,
  onEditProject,
  onAbortProject,
  onDeleteProject,
  onUpgradeProject,
  onArchiveProject,
  onRestartProject,
  onDeleteArchivedProject,
}: {
  project: OfficeTempProject;
  groupForWorkflow: OfficeFixedGroup | null;
  showProjectSourceBadges: boolean;
  expanded: boolean;
  roomActive: boolean;
  roomMessagesByProject: Record<string, RoomMessage[]>;
  agentLookup: (id: string) => string | undefined;
  catalogAgentIds: string[];
  onToggle: () => void;
  onRunProject: OfficeWorkspaceAreaProps['onRunProject'];
  onEditProject: OfficeWorkspaceAreaProps['onEditProject'];
  onAbortProject: OfficeWorkspaceAreaProps['onAbortProject'];
  onDeleteProject: OfficeWorkspaceAreaProps['onDeleteProject'];
  onUpgradeProject: OfficeWorkspaceAreaProps['onUpgradeProject'];
  onArchiveProject: OfficeWorkspaceAreaProps['onArchiveProject'];
  onRestartProject: OfficeWorkspaceAreaProps['onRestartProject'];
  onDeleteArchivedProject: OfficeWorkspaceAreaProps['onDeleteArchivedProject'];
}) {
  useOfficeProjectPrefetch(project.id);
  const workflow = workflowForProject(project, groupForWorkflow);
  const displayAgents = displayAgentsForProject(project, groupForWorkflow);
  const members = projectMembersFromIds(displayAgents.agentIds, agentLookup);
  const cardLoading = shouldShowProjectCardPrefetchLoading(
    project.id,
    expanded,
    isOfficeProjectArchived(project),
    project,
  );

  return (
    <ScenarioTaskCard
      project={project}
      workflow={workflow}
      projectRoomMessages={
        roomActive ? (roomMessagesByProject[project.id] ?? []) : []
      }
      members={members}
      expanded={expanded}
      cardLoading={cardLoading}
      roomActive={roomActive}
      showProjectSourceBadges={showProjectSourceBadges}
      catalogAgentIds={catalogAgentIds}
      sourceGroup={groupForWorkflow}
      onSelectProject={onToggle}
      onToggleExpanded={onToggle}
      onRunProject={onRunProject}
      onEditProject={onEditProject}
      onAbortProject={onAbortProject}
      onDeleteProject={onDeleteProject}
      onUpgradeProject={onUpgradeProject}
      onArchiveProject={onArchiveProject}
      onRestartProject={onRestartProject}
      onDeleteArchivedProject={onDeleteArchivedProject}
    />
  );
}
