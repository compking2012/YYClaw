import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Building2, GripVertical, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { sortFixedGroupsBySequence } from '@/lib/office-group-order';
import { OfficeProjectStatusDot } from '@/components/office/OfficeProjectStatusDot';
import { isOfficeProjectArchived } from '@/lib/office-room-sidebar';
import {
  officeFixedGroupStatusLight,
  officeProjectStatusLightCardRingClass,
} from '@/lib/office-project-status-light';
import {
  agentDisplayName,
  filterKnownAgentIds,
} from '@/lib/office-group-agents';
import { fixedGroupCardBorderClass, fixedGroupHasMissingAgents } from '@/lib/office-missing-agents';
import { OfficeMissingAgentBadge } from '@/components/office/OfficeMissingAgentBadge';
import type { OfficeFixedGroup, OfficeTempProject } from '@/types/office';
import type { AgentSummary } from '@/types/agent';

/** 固定组卡片：宽度基准，高度略大于宽度。 */
const TEAM_CARD_WIDTH_PX = 172;
const TEAM_CARD_HEIGHT_PX = 200;
const AGENT_CHIP_VISIBLE_MAX = 4;

type DragState = {
  id: string;
  fromIndex: number;
  pointerId: number;
  startX: number;
  deltaX: number;
};

function reorderIds(ids: string[], fromIndex: number, toIndex: number): string[] {
  if (fromIndex === toIndex) return ids;
  const next = [...ids];
  const [removed] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, removed!);
  return next;
}

function resolveHoverIndex(clientX: number, slots: HTMLElement[], draggingIndex: number): number {
  if (slots.length === 0) return draggingIndex;
  for (let i = 0; i < slots.length; i++) {
    const rect = slots[i]!.getBoundingClientRect();
    const midpoint = rect.left + rect.width / 2;
    if (clientX < midpoint) return i;
  }
  return slots.length - 1;
}

function agentChipLabel(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  if (trimmed.length <= 2) return trimmed;
  return trimmed.slice(0, 2);
}

export function OfficeTeamCardStrip(props: {
  t: (k: string, opts?: Record<string, unknown>) => string;
  groups: OfficeFixedGroup[];
  allProjects: OfficeTempProject[];
  agents: AgentSummary[];
  onEditGroup: (group: OfficeFixedGroup) => void;
  onDeleteGroup: (id: string) => void;
  onSpawnProject: (groupId: string) => void;
  onReorderGroups: (orderedIds: string[]) => void | Promise<void>;
}) {
  const {
    t,
    groups,
    allProjects,
    agents,
    onEditGroup,
    onDeleteGroup,
    onSpawnProject,
    onReorderGroups,
  } = props;

  const scrollRef = useRef<HTMLDivElement>(null);
  const slotRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [localOrder, setLocalOrder] = useState<string[]>(() =>
    sortFixedGroupsBySequence(groups).map((g) => g.id),
  );
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [reordering, setReordering] = useState(false);

  useEffect(() => {
    setLocalOrder(sortFixedGroupsBySequence(groups).map((g) => g.id));
  }, [groups]);

  const orderedGroups = useMemo(() => {
    const byId = new Map(groups.map((g) => [g.id, g]));
    return localOrder.map((id) => byId.get(id)).filter((g): g is OfficeFixedGroup => g != null);
  }, [localOrder, groups]);

  const finishDrag = useCallback(
    async (state: DragState, nextHoverIndex: number | null) => {
      const toIndex = nextHoverIndex ?? state.fromIndex;
      if (toIndex === state.fromIndex) return;
      const nextOrder = reorderIds(localOrder, state.fromIndex, toIndex);
      const prevOrder = localOrder;
      setLocalOrder(nextOrder);
      setReordering(true);
      try {
        await onReorderGroups(nextOrder);
      } catch {
        setLocalOrder(prevOrder);
      } finally {
        setReordering(false);
      }
    },
    [localOrder, onReorderGroups],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!dragState || e.pointerId !== dragState.pointerId) return;
      const slots = slotRefs.current.filter(Boolean) as HTMLElement[];
      const nextHover = resolveHoverIndex(e.clientX, slots, dragState.fromIndex);
      setHoverIndex(nextHover);
      setDragState((prev) =>
        prev
          ? {
              ...prev,
              deltaX: e.clientX - prev.startX,
            }
          : null,
      );
    },
    [dragState],
  );

  const onPointerUp = useCallback(
    (e: PointerEvent) => {
      if (!dragState || e.pointerId !== dragState.pointerId) return;
      void finishDrag(dragState, hoverIndex);
      setDragState(null);
      setHoverIndex(null);
    },
    [dragState, finishDrag, hoverIndex],
  );

  useEffect(() => {
    if (!dragState) return;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [dragState, onPointerMove, onPointerUp]);

  const onDragHandlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>, scenarioId: string, index: number) => {
      if (e.button !== 0 || reordering || orderedGroups.length < 2) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragState({
        id: scenarioId,
        fromIndex: index,
        pointerId: e.pointerId,
        startX: e.clientX,
        deltaX: 0,
      });
      setHoverIndex(index);
    },
    [orderedGroups.length, reordering],
  );

  const openGroupEditor = useCallback(
    (group: OfficeFixedGroup) => {
      if (dragState) return;
      onEditGroup(group);
    },
    [dragState, onEditGroup],
  );

  return (
    <div
      ref={scrollRef}
      className="overflow-x-auto overflow-y-hidden overscroll-x-contain py-1"
      data-testid="office-team-scroll"
    >
      <div className="flex gap-3" data-testid="office-team-card-order">
        {orderedGroups.map((g, index) => {
          const visibleAgentIds = filterKnownAgentIds(g.agentIds, agents);
          const agentNames = visibleAgentIds.map((id) => agentDisplayName(id, agents));
          const visibleChips = agentNames.slice(0, AGENT_CHIP_VISIBLE_MAX);
          const overflowCount = Math.max(0, agentNames.length - AGENT_CHIP_VISIBLE_MAX);
          const hasActiveSpawnProject = allProjects.some(
            (p) =>
              p.origin === 'fixed_group'
              && p.parentGroupId === g.id
              && !isOfficeProjectArchived(p),
          );
          const groupStatusLight = hasActiveSpawnProject
            ? officeFixedGroupStatusLight(g.id, allProjects)
            : null;
          const groupRunning = groupStatusLight === 'running';
          const catalogIds = agents.map((a) => a.id);
          const groupMissingAgents = fixedGroupHasMissingAgents(g, catalogIds);
          const spawnDisabled = hasActiveSpawnProject || groupMissingAgents;
          const isDragging = dragState?.id === g.id;
          const shiftLeft =
            dragState != null &&
            hoverIndex != null &&
            !isDragging &&
            index >= hoverIndex &&
            index < dragState.fromIndex;
          const shiftRight =
            dragState != null &&
            hoverIndex != null &&
            !isDragging &&
            index <= hoverIndex &&
            index > dragState.fromIndex;

          return (
            <div
              key={g.id}
              ref={(el) => {
                slotRefs.current[index] = el;
              }}
              data-team-card-slot
              data-group-id={g.id}
              data-order-index={index}
              className={cn(
                'shrink-0 transition-transform duration-150',
                shiftLeft && 'translate-x-2',
                shiftRight && '-translate-x-2',
              )}
            >
              <div
                role="button"
                tabIndex={0}
                data-testid={`office-team-card-${g.id}`}
                aria-label={groupRunning ? t('viewOnlyRunning') : t('editGroup')}
                onClick={() => openGroupEditor(g)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openGroupEditor(g);
                  }
                }}
                className={cn(
                  'group/card relative flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-card text-left shadow-sm transition-all duration-200',
                  'border-border/50 hover:border-primary/35 hover:shadow-md',
                  groupStatusLight
                    ? officeProjectStatusLightCardRingClass(groupStatusLight)
                    : null,
                  // Missing red frame must win over status-light border/ring.
                  groupMissingAgents && fixedGroupCardBorderClass(true),
                  isDragging && 'z-20 scale-[1.02] border-primary/45 shadow-lg ring-2 ring-primary/20',
                  reordering && 'pointer-events-none opacity-80',
                )}
                style={{
                  width: TEAM_CARD_WIDTH_PX,
                  height: TEAM_CARD_HEIGHT_PX,
                  ...(isDragging && dragState
                    ? { transform: `translateX(${dragState.deltaX}px)` }
                    : {}),
                }}
              >
                <div className="flex h-8 shrink-0 items-center justify-between gap-1 border-b border-border/30 bg-gradient-to-r from-muted/40 via-muted/20 to-transparent px-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    {orderedGroups.length > 1 ? (
                      <button
                        type="button"
                        data-testid={`office-team-card-drag-${g.id}`}
                        aria-label={t('teamCardDragHandle')}
                        title={t('teamCardDragHandle')}
                        className={cn(
                          'flex h-6 w-5 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground/55 transition-colors hover:bg-background/80 hover:text-foreground active:cursor-grabbing',
                          isDragging && 'cursor-grabbing',
                        )}
                        onPointerDown={(e) => onDragHandlePointerDown(e, g.id, index)}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <GripVertical className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <span className="w-5 shrink-0" aria-hidden />
                    )}
                    {groupStatusLight ? (
                      <OfficeProjectStatusDot
                        light={groupStatusLight}
                        size="sm"
                        data-testid={`office-team-status-light-${g.id}`}
                      />
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {groupRunning ? (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700 dark:text-emerald-400"
                        data-testid={`office-team-running-dot-${g.id}`}
                      >
                        {t('taskStatus.running')}
                      </span>
                    ) : null}
                    {groupMissingAgents ? (
                      <OfficeMissingAgentBadge testId={`office-team-missing-agent-${g.id}`} />
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 shrink-0 p-0 text-muted-foreground/70 hover:bg-destructive/10 hover:text-destructive"
                      title={t('delete')}
                      aria-label={t('delete')}
                      disabled={groupRunning}
                      data-testid={`office-team-card-delete-${g.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(t('deleteGroupConfirm'))) onDeleteGroup(g.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="flex min-h-0 flex-1 flex-col px-3 pb-2 pt-2.5">
                  <div className="flex items-start gap-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary shadow-sm ring-1 ring-primary/15">
                      <Building2 className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="line-clamp-2 font-serif text-[13px] font-normal leading-snug tracking-tight text-foreground">
                        {g.name}
                      </h4>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {t('groupCardMemberCount', { count: visibleAgentIds.length })}
                      </p>
                    </div>
                  </div>

                  <div className="mt-auto pt-3">
                    {visibleChips.length > 0 ? (
                      <div className="flex flex-wrap gap-1" title={agentNames.join('、')}>
                        {visibleChips.map((name, chipIndex) => (
                          <span
                            key={`${g.id}-agent-${chipIndex}`}
                            className="inline-flex max-w-[4.5rem] truncate rounded-md border border-border/40 bg-muted/30 px-1.5 py-0.5 text-[9px] font-medium text-foreground/85"
                          >
                            {agentChipLabel(name)}
                          </span>
                        ))}
                        {overflowCount > 0 ? (
                          <span className="inline-flex rounded-md border border-dashed border-border/50 bg-background/60 px-1.5 py-0.5 text-[9px] text-muted-foreground">
                            +{overflowCount}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-[10px] text-muted-foreground/80">—</p>
                    )}
                  </div>
                </div>

                <div
                  className="shrink-0 border-t border-border/35 bg-muted/10 p-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={spawnDisabled}
                    className={cn(
                      'h-8 w-full gap-1.5 rounded-lg px-2 text-[11px] font-medium shadow-none',
                      spawnDisabled
                        ? 'cursor-not-allowed border border-border/40 bg-muted/30 text-muted-foreground opacity-70'
                        : 'border border-primary/25 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
                    )}
                    title={
                      groupMissingAgents
                        ? t('missingAgents.spawnBlocked')
                        : spawnDisabled
                          ? t('spawnProjectDisabled')
                          : t('spawnProject')
                    }
                    aria-label={
                      groupMissingAgents
                        ? t('missingAgents.spawnBlocked')
                        : spawnDisabled
                          ? t('spawnProjectDisabled')
                          : t('spawnProject')
                    }
                    data-testid={`office-team-card-spawn-${g.id}`}
                    data-spawn-disabled={spawnDisabled ? 'true' : 'false'}
                    onClick={() => {
                      if (spawnDisabled) return;
                      onSpawnProject(g.id);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{t('spawnProject')}</span>
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
