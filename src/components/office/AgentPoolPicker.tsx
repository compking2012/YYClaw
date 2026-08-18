import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { officeFormFieldClass } from '@/lib/office-form-field-styles';
import {
  formatAgentBindingLabel,
  isAgentBoundElsewhere,
} from '@/lib/office-agent-binding-label';
import {
  canonicalizeSelectedAgentIds,
  isAgentIdSelected,
  partitionAgentPoolLists,
  removeAgentFromSelection,
} from '@/lib/office-agent-pool';
import { agentDisplayName } from '@/lib/office-group-agents';
import {
  formatMissingAgentsLabelForIds,
  mergeAgentNameMaps,
  missingRosterAndCoordinatorIds,
  nameMapFromAgents,
} from '@/lib/office-missing-agents';
import { ensureCoordinatorInTeam } from '@/lib/office-workflow-roles';
import { cn } from '@/lib/utils';
import type { AgentSummary } from '@/types/agent';
import type { AgentBindingKind, AgentBindingRecord } from '@/types/office';

export interface AgentPoolPickerProps {
  agents: AgentSummary[];
  selectedAgentIds: string[];
  coordinatorAgentId: string;
  agentBindings?: Record<string, AgentBindingRecord>;
  /** When editing a group/project, agents already bound here remain toggleable. */
  bindingScope?: { kind: AgentBindingKind; entityId: string };
  /** Historical display names for deleted agents. */
  agentNameHints?: Record<string, string>;
  onChange: (patch: {
    agentIds: string[];
    coordinatorAgentId: string;
    /** Present when the user clicked X on one or more roster chips. */
    removedAgentIds?: string[];
  }) => void;
  disabled?: boolean;
  /**
   * full: bind/unbind + coordinator (default).
   * unbind-missing: show roster; only missing chips get X (spawned workflow active).
   * view: show roster including red missing chips; no edits.
   */
  interactionMode?: 'full' | 'unbind-missing' | 'view';
  /** split: 已绑定在左、可选在右（固定组/项目表单默认）；chips: 单行标签（遗留）。 */
  layout?: 'chips' | 'split';
}

const boundChipBodyClass = (isCoordinator: boolean) =>
  cn(
    'inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 pr-2.5 text-[10px]',
    isCoordinator
      ? 'border-primary bg-primary/15 text-primary shadow-[0_0_0_1px_rgba(var(--primary),0.25)]'
      : 'border-primary/60 bg-primary/10 text-foreground ring-1 ring-primary/20',
  );

function BoundAgentChip({
  agentId,
  agents,
  isCoordinator,
  disabled,
  title,
  onUnbind,
}: {
  agentId: string;
  agents: AgentSummary[];
  isCoordinator: boolean;
  disabled?: boolean;
  title: string;
  onUnbind: () => void;
}) {
  const { t } = useTranslation('office');
  return (
    <span
      className="relative inline-flex pt-1 pr-1"
      title={title}
      data-testid={`office-agent-bound-${agentId}`}
      data-bound="true"
    >
      <span className={boundChipBodyClass(isCoordinator)}>
        <span className="truncate font-medium leading-tight">{agentDisplayName(agentId, agents)}</span>
        {isCoordinator ? (
          <span className="shrink-0 text-[8px] leading-none text-primary/80">
            ·{t('agentPool.coordinatorShort')}
          </span>
        ) : null}
      </span>
      {!disabled ? (
        <button
          type="button"
          className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-border/60 bg-background text-muted-foreground shadow-sm transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
          title={t('agentPool.unbind')}
          aria-label={t('agentPool.unbind')}
          data-testid={`office-agent-unbind-${agentId}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onUnbind();
          }}
        >
          <X className="h-2.5 w-2.5" strokeWidth={2.5} />
        </button>
      ) : null}
    </span>
  );
}

function MissingAgentChip({
  agentId,
  label,
  disabled,
  onUnbind,
}: {
  agentId: string;
  label: string;
  disabled?: boolean;
  onUnbind: () => void;
}) {
  const { t } = useTranslation('office');
  return (
    <span
      className="relative inline-flex pt-1 pr-1"
      title={t('missingAgents.orphanChipHint')}
      data-testid={`office-agent-missing-${agentId}`}
    >
      <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-destructive/50 bg-destructive/10 px-2 py-0.5 pr-2.5 text-[10px] text-destructive">
        <span className="truncate font-medium leading-tight">{label}</span>
      </span>
      {!disabled ? (
        <button
          type="button"
          className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-border/60 bg-background text-muted-foreground shadow-sm transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
          title={t('agentPool.unbind')}
          aria-label={t('agentPool.unbind')}
          data-testid={`office-agent-unbind-missing-${agentId}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onUnbind();
          }}
        >
          <X className="h-2.5 w-2.5" strokeWidth={2.5} />
        </button>
      ) : null}
    </span>
  );
}

function AvailableAgentChip({
  agentId,
  agents,
  boundElsewhere,
  disabled,
  title,
  onClick,
}: {
  agentId: string;
  agents: AgentSummary[];
  boundElsewhere: boolean;
  disabled?: boolean;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled || boundElsewhere}
      title={title}
      data-testid={`office-agent-pool-${agentId}`}
      data-bound="false"
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-colors',
        boundElsewhere
          ? 'cursor-not-allowed border-border/30 bg-muted/20 text-muted-foreground/60'
          : 'border-border/40 bg-background text-muted-foreground hover:border-border/70 hover:bg-muted/30',
        disabled && !boundElsewhere && 'pointer-events-none opacity-60',
      )}
      onClick={onClick}
    >
      <span className="truncate font-medium leading-tight">{agentDisplayName(agentId, agents)}</span>
    </button>
  );
}

export function AgentPoolPicker({
  agents,
  selectedAgentIds,
  coordinatorAgentId,
  agentBindings,
  bindingScope,
  agentNameHints,
  onChange,
  disabled,
  interactionMode = 'full',
  layout = 'split',
}: AgentPoolPickerProps) {
  const { t } = useTranslation('office');
  const catalogIds = agents.map((a) => a.id);
  const nameById = mergeAgentNameMaps(agentNameHints, nameMapFromAgents(agents));
  const missingIds = missingRosterAndCoordinatorIds(
    selectedAgentIds,
    coordinatorAgentId,
    catalogIds,
  );
  const selectedIds = canonicalizeSelectedAgentIds(selectedAgentIds, agents);
  const missingLabel = formatMissingAgentsLabelForIds(
    missingIds,
    nameById,
    (key, options) => t(key, options),
  );
  const allowBind = interactionMode === 'full' && !disabled;
  const allowUnbindKnown = interactionMode === 'full' && !disabled;
  const allowUnbindMissing =
    (interactionMode === 'full' || interactionMode === 'unbind-missing') && !disabled;
  // Unbind-missing still allows picking a known coordinator after clearing an orphan.
  const allowCoordinatorEdit =
    (interactionMode === 'full' || interactionMode === 'unbind-missing') && !disabled;
  const showAvailablePanel = interactionMode === 'full';

  const coordinatorTrimmed = coordinatorAgentId.trim();
  const coordinatorEmpty = !coordinatorTrimmed;
  const coordinatorMissing =
    Boolean(coordinatorTrimmed) && !catalogIds.some((id) => id === coordinatorTrimmed);
  // Keep missing coordinator as-is when still referenced; honor explicit empty after unbind.
  const coordinatorValue = coordinatorEmpty
    ? ''
    : coordinatorMissing && selectedAgentIds.includes(coordinatorTrimmed)
      ? coordinatorTrimmed
      : ensureCoordinatorInTeam(
        coordinatorAgentId,
        selectedIds,
        selectedIds[0] ?? '',
      );
  // Option A: never bind <select> to an orphan id. Empty coordinator stays selectable.
  const coordinatorSelectValue = coordinatorEmpty || coordinatorMissing
    ? ''
    : (selectedIds.includes(coordinatorValue) ? coordinatorValue : (selectedIds[0] ?? ''));
  const showCoordinatorRow = selectedIds.length > 0 || coordinatorMissing || missingIds.length > 0;

  const emitSelection = (
    nextIds: string[],
    nextCoordinatorId: string,
    removedAgentIds?: string[],
  ) => {
    const knownIds = canonicalizeSelectedAgentIds(nextIds, agents);
    const rosterMissing = nextIds
      .map((id) => id.trim())
      .filter((id) => id && !catalogIds.includes(id));
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const id of [...knownIds, ...rosterMissing]) {
      if (seen.has(id)) continue;
      seen.add(id);
      merged.push(id);
    }
    const nextCoord = nextCoordinatorId.trim();
    let nextCoordinator: string;
    if (!nextCoord) {
      // Explicit clear (unbind coordinator) — do not auto-pick a replacement.
      nextCoordinator = '';
    } else if (nextCoord && merged.includes(nextCoord)) {
      nextCoordinator = nextCoord;
    } else if (nextCoord && !catalogIds.includes(nextCoord)) {
      // Preserve orphan coordinator until user explicitly unbinds it.
      nextCoordinator = nextCoord;
      if (!merged.includes(nextCoord)) merged.push(nextCoord);
    } else {
      nextCoordinator = ensureCoordinatorInTeam(
        nextCoordinatorId,
        knownIds,
        knownIds[0] ?? '',
      );
    }
    onChange({
      agentIds: merged,
      coordinatorAgentId: nextCoordinator,
      ...(removedAgentIds && removedAgentIds.length > 0 ? { removedAgentIds } : {}),
    });
  };

  const unbindAgent = (agentId: string) => {
    const nextIds = removeAgentFromSelection(selectedAgentIds, agentId);
    const nextCoord =
      coordinatorAgentId.trim() === agentId
        ? ''
        : coordinatorAgentId;
    emitSelection(nextIds, nextCoord, [agentId]);
  };

  const bindAgent = (agentId: string) => {
    if (isAgentBoundElsewhere(agentId, agentBindings, bindingScope)) return;
    if (isAgentIdSelected(agentId, selectedIds)) return;
    const nextIds = [...selectedAgentIds, agentId];
    // Option A: while orphan coordinator stays in roster, do not auto-replace it
    // when binding additional known agents (select remains disabled until unbind).
    const nextCoordinator =
      coordinatorMissing && selectedAgentIds.includes(coordinatorTrimmed)
        ? coordinatorTrimmed
        : ensureCoordinatorInTeam(coordinatorAgentId, nextIds, nextIds[0] ?? '');
    emitSelection(nextIds, nextCoordinator);
  };

  const chipTitle = (agentId: string, selected: boolean, binding?: AgentBindingRecord) => {
    const boundElsewhere = isAgentBoundElsewhere(agentId, agentBindings, bindingScope);
    if (boundElsewhere && binding) {
      return t('agentPool.boundElsewhere', { label: formatAgentBindingLabel(binding, t) });
    }
    return selected ? t('agentPool.boundMember') : t('agentPool.unboundMember');
  };

  if (agents.length === 0 && missingIds.length === 0) {
    return (
      <p
        className="rounded-lg border border-amber-200/60 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300"
        data-testid="office-agent-pool-empty"
      >
        {t('agentPool.empty')}
      </p>
    );
  }

  const { boundIds, availableIds } = partitionAgentPoolLists({
    selectedAgentIds: selectedIds,
    coordinatorAgentId: coordinatorValue,
    agents,
    agentBindings,
    bindingScope,
  });

  return (
    <div
      className={cn(
        'space-y-3 rounded-lg',
        missingIds.length > 0 && 'border border-destructive/60 bg-destructive/5 p-2.5 ring-1 ring-destructive/20',
      )}
      data-testid="office-agent-pool-picker"
      data-missing-agents={missingIds.length > 0 ? 'true' : 'false'}
      data-interaction-mode={interactionMode}
    >
      <div className="space-y-1">
        <Label className="text-sm font-medium">{t('agentPool.members')}</Label>
        <p className="text-xs text-muted-foreground">{t('agentPool.membersHint')}</p>
        {missingLabel ? (
          <p
            className="text-[11px] font-medium text-destructive"
            data-testid="office-agent-pool-missing-label"
          >
            {missingLabel}
          </p>
        ) : null}
      </div>

      {layout === 'split' ? (
        <div
          className={cn(
            'grid grid-cols-1 gap-2',
            showAvailablePanel && 'sm:grid-cols-2',
          )}
          data-testid="office-agent-pool-split"
        >
          <div className="rounded-lg border border-border/40 bg-muted/10 p-2.5">
            <p className="mb-1.5 text-xs text-muted-foreground">{t('agentPool.boundPanel')}</p>
            <div className="flex min-h-[2.75rem] flex-wrap gap-1.5">
              {boundIds.length === 0 && missingIds.length === 0 ? (
                <span className="text-[10px] text-muted-foreground">{t('agentPool.boundEmpty')}</span>
              ) : (
                <>
                  {boundIds.map((agentId) => (
                    <BoundAgentChip
                      key={agentId}
                      agentId={agentId}
                      agents={agents}
                      isCoordinator={coordinatorValue === agentId}
                      disabled={!allowUnbindKnown}
                      title={chipTitle(agentId, true)}
                      onUnbind={() => unbindAgent(agentId)}
                    />
                  ))}
                  {missingIds.map((agentId) => (
                    <MissingAgentChip
                      key={`missing-${agentId}`}
                      agentId={agentId}
                      label={nameById.get(agentId) || agentId}
                      disabled={!allowUnbindMissing}
                      onUnbind={() => unbindAgent(agentId)}
                    />
                  ))}
                </>
              )}
            </div>
          </div>
          {showAvailablePanel ? (
            <div className="rounded-lg border border-border/40 bg-background p-2.5">
              <p className="mb-1.5 text-xs text-muted-foreground">{t('agentPool.availablePanel')}</p>
              <div className="flex min-h-[2.75rem] flex-wrap gap-1.5">
                {availableIds.length === 0 ? (
                  <span className="text-[10px] text-muted-foreground">{t('agentPool.availableEmpty')}</span>
                ) : (
                  availableIds.map((agentId) => (
                    <AvailableAgentChip
                      key={agentId}
                      agentId={agentId}
                      agents={agents}
                      boundElsewhere={false}
                      disabled={!allowBind}
                      title={chipTitle(agentId, false)}
                      onClick={() => bindAgent(agentId)}
                    />
                  ))
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {agents.map((agent) => {
            const agentId = agent.id;
            const selected = isAgentIdSelected(agentId, selectedIds);
            const isCoordinator = selected && coordinatorValue === agentId;
            const boundElsewhere = isAgentBoundElsewhere(agentId, agentBindings, bindingScope);
            const binding = agentBindings?.[agentId];
            if (selected) {
              return (
                <BoundAgentChip
                  key={agentId}
                  agentId={agentId}
                  agents={agents}
                  isCoordinator={isCoordinator}
                  disabled={!allowUnbindKnown}
                  title={chipTitle(agentId, true, binding)}
                  onUnbind={() => unbindAgent(agentId)}
                />
              );
            }
            if (!showAvailablePanel) return null;
            return (
              <AvailableAgentChip
                key={agentId}
                agentId={agentId}
                agents={agents}
                boundElsewhere={boundElsewhere}
                disabled={!allowBind || boundElsewhere}
                title={chipTitle(agentId, false, binding)}
                onClick={() => bindAgent(agentId)}
              />
            );
          })}
          {missingIds.map((agentId) => (
            <MissingAgentChip
              key={`missing-${agentId}`}
              agentId={agentId}
              label={nameById.get(agentId) || agentId}
              disabled={!allowUnbindMissing}
              onUnbind={() => unbindAgent(agentId)}
            />
          ))}
        </div>
      )}

      {showCoordinatorRow ? (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Label
              htmlFor="office-agent-coordinator"
              className="shrink-0 text-xs font-normal text-muted-foreground"
            >
              {t('agentPool.coordinator')}
            </Label>
            <select
              id="office-agent-coordinator"
              disabled={!allowCoordinatorEdit || coordinatorMissing || selectedIds.length === 0}
              className={officeFormFieldClass(
                'box-border h-8 min-h-8 max-h-8 min-w-0 flex-1 rounded-md px-2 text-xs leading-none ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
              value={coordinatorSelectValue}
              onChange={(e) => {
                const next = e.target.value.trim();
                if (!next || coordinatorMissing || !allowCoordinatorEdit) return;
                emitSelection(selectedAgentIds, next);
              }}
              data-testid="office-agent-coordinator-select"
              data-coordinator-missing={coordinatorMissing ? 'true' : 'false'}
              data-coordinator-empty={coordinatorEmpty ? 'true' : 'false'}
            >
              {coordinatorEmpty || coordinatorMissing || selectedIds.length === 0 ? (
                <option value="">
                  {coordinatorMissing
                    ? t('missingAgents.coordinatorSelectPlaceholder')
                    : t('missingAgents.coordinatorSelectEmptyPlaceholder')}
                </option>
              ) : null}
              {selectedIds.map((agentId) => (
                <option key={agentId} value={agentId}>
                  {agentDisplayName(agentId, agents)}
                </option>
              ))}
            </select>
          </div>
          {coordinatorMissing ? (
            <p
              className="text-[11px] text-destructive"
              data-testid="office-agent-coordinator-missing-hint"
            >
              {t('missingAgents.coordinatorMissingHint')}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
