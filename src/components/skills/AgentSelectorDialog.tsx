import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { SkillPickerSearch } from '@/components/skills/SkillPickerSearch';
import { SkillPickerDialogShell } from '@/components/skills/SkillPickerDialogShell';
import { SkillPickerPageSectionHeader } from '@/components/skills/SkillPickerPageSectionHeader';
import {
  SKILL_PICKER_SEARCH_MIN_COUNT,
  skillPickerBulkButtonClasses,
  skillPickerListContainerBaseClasses,
  skillPickerListContainerClassesForCount,
  skillPickerPageSectionClasses,
  skillPickerSectionCardClasses,
} from '@/components/skills/skill-picker-styles';
import { cn } from '@/lib/utils';
import { toast } from '@/lib/toast';
import type { Skill } from '@/types/skill';
import type { AgentSummary } from '@/types/agent';
import {
  countSelectedCatalogAgents,
  agentIdsSelectionChanged,
  isCatalogAgentSelected,
  normalizeAgentId,
  normalizeAgentIdsForPersist,
  resolveAgentIdSelection,
} from '@/lib/agent-lookup';
import {
  applyAgentSelectorGlobalPromptChoice,
  detectAgentSelectorGlobalPrompt,
  resolveAgentSelectorDraftAgentIds,
  resolveAgentSelectorOpenAgentIds,
  shouldRehydrateAgentSelectorOnAgentsArrival,
  type AgentSelectorGlobalChoice,
  type AgentSelectorGlobalPromptKind,
} from '@/lib/agent-selector-draft';
import { AgentSelectorGlobalChoiceDialog } from '@/components/skills/AgentSelectorGlobalChoiceDialog';
import { usePickerSessionOrder } from '@/hooks/use-picker-session-order';
import { orderItemsBySessionKeys } from '@/lib/picker-session-order';

export interface AgentSelectorSavePayload {
  agentIds: string[];
  /** Draft all-agent default state; persisted only when user clicks Save. */
  draftIsGlobal: boolean;
}

export interface AgentSelectorDialogProps {
  skill: Skill | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (payload: AgentSelectorSavePayload) => Promise<void>;
  agents: AgentSummary[];
  loading?: boolean;
  /** Whether this skill is in agents.defaults.skills (server state when dialog opens). */
  isGlobal?: boolean;
  /** Show promote/demote global controls (single-skill dialog only). */
  showGlobalControls?: boolean;
}

export function AgentSelectorDialog({
  skill,
  isOpen,
  onClose,
  onSave,
  agents,
  loading,
  isGlobal = false,
  showGlobalControls = false,
}: AgentSelectorDialogProps) {
  const { t } = useTranslation(['skills', 'agents', 'common']);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [draftIsGlobal, setDraftIsGlobal] = useState(false);
  const [initialIsGlobal, setInitialIsGlobal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [globalPromptKind, setGlobalPromptKind] = useState<AgentSelectorGlobalPromptKind | null>(null);
  const globalChoiceResolverRef = useRef<((choice: AgentSelectorGlobalChoice) => void) | null>(null);
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<string[]>([]);
  /** Per-agent assignments from server when the dialog opened (ignores global defaults). */
  const baselineAgentIdsRef = useRef<string[]>([]);
  const [initialEffectiveAgentIds, setInitialEffectiveAgentIds] = useState<string[]>([]);
  /** Prevent mid-session agent list refreshes from wiping unsaved draft edits. */
  const draftSessionKeyRef = useRef<string | null>(null);
  const draftIsGlobalRef = useRef(false);
  const selectedAgentIdsRef = useRef<string[]>([]);

  const allAgentIds = useMemo(
    () => normalizeAgentIdsForPersist(agents.map((agent) => agent.id), agents),
    [agents],
  );

  useEffect(() => {
    draftIsGlobalRef.current = draftIsGlobal;
  }, [draftIsGlobal]);

  useEffect(() => {
    selectedAgentIdsRef.current = selectedAgentIds;
  }, [selectedAgentIds]);

  const applyDraftGlobal = useCallback((nextGlobal: boolean) => {
    setDraftIsGlobal(nextGlobal);
    setSelectedAgentIds(resolveAgentSelectorDraftAgentIds({
      draftIsGlobal: nextGlobal,
      baselineAgentIds: baselineAgentIdsRef.current,
      allAgentIds,
      openedAsGlobal: initialIsGlobal,
    }));
  }, [allAgentIds, initialIsGlobal]);

  const resolveGlobalChoice = useCallback((choice: AgentSelectorGlobalChoice) => {
    const resolver = globalChoiceResolverRef.current;
    globalChoiceResolverRef.current = null;
    setGlobalPromptKind(null);
    resolver?.(choice);
  }, []);

  const dismissPendingGlobalPromptAsCancel = useCallback(() => {
    if (!globalChoiceResolverRef.current) return;
    resolveGlobalChoice('cancel');
  }, [resolveGlobalChoice]);

  useEffect(() => {
    if (!isOpen || !skill) {
      draftSessionKeyRef.current = null;
      dismissPendingGlobalPromptAsCancel();
      return;
    }

    const sessionKey = skill.id;
    const isNewSession = draftSessionKeyRef.current !== sessionKey;
    const lateAgentsArrival = !isNewSession && shouldRehydrateAgentSelectorOnAgentsArrival({
      skillAgentIds: skill.agents || [],
      availableAgentCount: agents.length,
      boundBaselineAgentIds: baselineAgentIdsRef.current,
      currentSelectedAgentIds: selectedAgentIdsRef.current,
    });

    if (!isNewSession && !lateAgentsArrival) {
      return;
    }
    draftSessionKeyRef.current = sessionKey;

    const baseline = resolveAgentIdSelection(skill?.agents || [], agents);
    baselineAgentIdsRef.current = baseline;
    // Open hydrate = actual assignments only. Do not expand to "all agents" for
    // already-global skills (that would wipe full opt-out on reopen).
    const effectiveInitial = resolveAgentSelectorOpenAgentIds({ baselineAgentIds: baseline });
    setInitialEffectiveAgentIds(effectiveInitial);
    setSelectedAgentIds(effectiveInitial);
    if (isNewSession) {
      setInitialIsGlobal(isGlobal);
      setDraftIsGlobal(isGlobal);
      setSearchQuery('');
      setBulkSelectedIds([]);
      setIsBulkMode(false);
      setGlobalPromptKind(null);
    }
  }, [isOpen, skill, agents, isGlobal, showGlobalControls, allAgentIds, dismissPendingGlobalPromptAsCancel]);

  const sessionKey = isOpen && skill ? skill.id : null;
  const getAgentKey = useCallback((agent: AgentSummary) => normalizeAgentId(agent.id), []);
  const getAgentName = useCallback((agent: AgentSummary) => agent.name, []);
  const sessionAgentOrder = usePickerSessionOrder({
    sessionKey,
    items: agents,
    getKey: getAgentKey,
    getName: getAgentName,
    getInitialSelectedKeys: useCallback(
      () => resolveAgentIdSelection(skill?.agents || [], agents),
      [skill?.agents, agents],
    ),
    isItemSelected: useCallback(
      (agent: AgentSummary, selectedKeys: readonly string[]) =>
        isCatalogAgentSelected(agent, [...selectedKeys], agents),
      [agents],
    ),
  });

  const filteredAgents = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    let filtered = agents;
    if (normalizedQuery) {
      filtered = agents.filter((agent) =>
        agent.name.toLowerCase().includes(normalizedQuery)
        || agent.id.toLowerCase().includes(normalizedQuery),
      );
    }
    if (sessionAgentOrder.length === 0) {
      return filtered;
    }
    return orderItemsBySessionKeys(
      filtered,
      sessionAgentOrder,
      (agent) => normalizeAgentId(agent.id),
      (agent) => agent.name,
    );
  }, [agents, searchQuery, sessionAgentOrder]);

  const requestGlobalChoice = useCallback((kind: AgentSelectorGlobalPromptKind) => (
    new Promise<AgentSelectorGlobalChoice>((resolve) => {
      globalChoiceResolverRef.current = resolve;
      setGlobalPromptKind(kind);
    })
  ), []);

  const maybePromptAfterSelectionChange = useCallback(async (
    previousAgentIds: string[],
    nextAgentIds: string[],
  ) => {
    if (!showGlobalControls || skill?.id === 'bulk') return;
    const kind = detectAgentSelectorGlobalPrompt({
      draftIsGlobal: draftIsGlobalRef.current,
      previousAgentIds,
      nextAgentIds,
      allAgentIds,
    });
    if (!kind) return;

    const choice = await requestGlobalChoice(kind);
    const result = applyAgentSelectorGlobalPromptChoice({ kind, choice });
    if (result.cancel) {
      setSelectedAgentIds(normalizeAgentIdsForPersist(previousAgentIds, agents));
      return;
    }
    setDraftIsGlobal(result.draftIsGlobal);
  }, [agents, allAgentIds, requestGlobalChoice, showGlobalControls, skill?.id]);

  const commitAgentSelection = useCallback((nextAgentIds: string[]) => {
    const previous = resolveAgentIdSelection(selectedAgentIdsRef.current, agents);
    const next = normalizeAgentIdsForPersist(nextAgentIds, agents);
    setSelectedAgentIds(next);
    void maybePromptAfterSelectionChange(previous, next);
  }, [agents, maybePromptAfterSelectionChange]);

  const toggleAgent = (agentId: string) => {
    const normalizedId = normalizeAgentId(agentId);
    const previous = resolveAgentIdSelection(selectedAgentIdsRef.current, agents);
    const next = previous.includes(normalizedId)
      ? previous.filter((id) => id !== normalizedId)
      : normalizeAgentIdsForPersist([...previous, normalizedId], agents);
    commitAgentSelection(next);
  };

  const toggleBulkSelect = (agentId: string) => {
    const normalizedId = normalizeAgentId(agentId);
    setBulkSelectedIds((prev) => {
      if (prev.includes(normalizedId)) {
        return prev.filter((id) => id !== normalizedId);
      }
      return [...prev, normalizedId];
    });
  };

  const selectAllVisible = () => {
    setBulkSelectedIds(filteredAgents.map((a) => normalizeAgentId(a.id)));
  };

  const bulkEnable = () => {
    const previous = resolveAgentIdSelection(selectedAgentIdsRef.current, agents);
    const next = normalizeAgentIdsForPersist([...previous, ...bulkSelectedIds], agents);
    setBulkSelectedIds([]);
    setIsBulkMode(false);
    commitAgentSelection(next);
  };

  const bulkDisable = () => {
    const ids = new Set(bulkSelectedIds.map(normalizeAgentId));
    const previous = resolveAgentIdSelection(selectedAgentIdsRef.current, agents);
    const next = previous.filter((id) => !ids.has(id));
    setBulkSelectedIds([]);
    setIsBulkMode(false);
    commitAgentSelection(next);
  };

  const handleSave = async () => {
    if (!skill) return;
    setSaving(true);
    try {
      await onSave({
        agentIds: normalizeAgentIdsForPersist(selectedAgentIds, agents),
        draftIsGlobal,
      });
      onClose();
    } catch (error) {
      console.error('Failed to save skill agent dialog:', error);
      toast.error(t('skills:toast.failedSaveSkillAgents', { defaultValue: 'Failed to save agent assignments' }));
    } finally {
      setSaving(false);
    }
  };

  const bulkSelectedSet = useMemo(
    () => new Set(bulkSelectedIds.map(normalizeAgentId)),
    [bulkSelectedIds],
  );
  const visibleAgentIds = useMemo(() => filteredAgents.map((a) => a.id), [filteredAgents]);
  const hasBulkSelection = bulkSelectedIds.length > 0;
  const showSearch = agents.length >= SKILL_PICKER_SEARCH_MIN_COUNT;
  const dialogOpen = Boolean(isOpen && skill);
  const promptOpen = globalPromptKind !== null;
  const busy = saving || Boolean(loading) || promptOpen;

  const isBulkSkill = skill?.id === 'bulk';
  const dialogTitle = skill
    ? (isBulkSkill
      ? t('skills:agentSelector.bulkTitle', {
        count: skill.name.includes('skills') ? skill.name.match(/\d+/)?.[0] || '' : '',
        defaultValue: skill.name,
      })
      : skill.name)
    : '';
  const selectedCount = skill ? countSelectedCatalogAgents(agents, selectedAgentIds) : 0;
  const hasAgentAssignmentChanges = skill
    ? agentIdsSelectionChanged(selectedAgentIds, initialEffectiveAgentIds, agents)
    : false;
  const hasGlobalDraftChanges = showGlobalControls && draftIsGlobal !== initialIsGlobal;
  const hasChanges = hasAgentAssignmentChanges || hasGlobalDraftChanges;

  const handleDialogClose = useCallback(() => {
    dismissPendingGlobalPromptAsCancel();
    onClose();
  }, [dismissPendingGlobalPromptAsCancel, onClose]);

  return (
    <>
    <SkillPickerDialogShell
      open={dialogOpen}
      onClose={handleDialogClose}
      title={dialogTitle}
      subtitle={skill ? t('skills:agentSelector.subtitle', {
        defaultValue: 'Save to apply. Exit discards unsaved changes.',
      }) : undefined}
      onSave={() => void handleSave()}
      saving={saving}
      saveDisabled={!skill || !hasChanges || busy}
      closeDisabled={busy}
      saveLabel={t('common:actions.save')}
      saveTestId="skill-agent-selector-save"
      closeTestId="skill-agent-selector-exit"
      testId="skill-agent-selector-dialog"
    >
      {skill ? (
      <div className={skillPickerPageSectionClasses}>
        {showGlobalControls && !isBulkSkill ? (
          <section
            className={cn(skillPickerSectionCardClasses, 'flex flex-col gap-2')}
            data-testid="skill-agent-selector-global-bar"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                  <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span>
                    {draftIsGlobal
                      ? t('skills:agentSelector.globalStatusInDefaults', {
                        defaultValue: 'Global default · new agents get this skill by default',
                      })
                      : t('skills:agentSelector.globalStatusNotInDefaults', {
                        defaultValue: 'Not in all-agent defaults',
                      })}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  {t('skills:agentSelector.globalBatchHint', {
                    defaultValue: 'Also editable in All-agent Skill Configuration.',
                  })}
                </p>
                {draftIsGlobal && initialIsGlobal ? (
                  <p className="text-[11px] text-amber-700 dark:text-amber-400 leading-snug">
                    {t('skills:agentSelector.removeFromGlobalHint', {
                      defaultValue: 'Remove from global clears assignments on save (same as top-bar).',
                    })}
                  </p>
                ) : null}
                {!draftIsGlobal ? (
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    {t('skills:agentSelector.setAsGlobalHint', {
                      defaultValue: 'Set as global will select all agents.',
                    })}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-col items-stretch gap-1.5">
                {draftIsGlobal ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => applyDraftGlobal(false)}
                    data-testid="skill-agent-selector-remove-global"
                    className={skillPickerBulkButtonClasses}
                  >
                    {t('skills:agentSelector.removeFromGlobal', { defaultValue: 'Remove from global' })}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => applyDraftGlobal(true)}
                    data-testid="skill-agent-selector-set-global"
                    className={skillPickerBulkButtonClasses}
                  >
                    {t('skills:agentSelector.setAsGlobal', { defaultValue: 'Set as global' })}
                  </Button>
                )}
              </div>
            </div>
          </section>
        ) : null}

        <SkillPickerPageSectionHeader
          title={t('skills:agentSelector.agentsLabel', { defaultValue: 'Agents' })}
          count={selectedCount}
        />
        <section className={skillPickerSectionCardClasses}>
          {showSearch ? (
            <SkillPickerSearch
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder={t('skills:agentSelector.searchPlaceholder', { defaultValue: 'Search agents by name or ID...' })}
              testId="skill-agent-selector-search"
            />
          ) : null}

          <div className="flex flex-wrap gap-2">
            {!isBulkMode ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsBulkMode(true)}
                disabled={visibleAgentIds.length === 0 || busy}
                data-testid="skill-agent-selector-bulk-enter"
                className={skillPickerBulkButtonClasses}
              >
                {t('agents:skills.bulkSelect', { defaultValue: 'Bulk Select' })}
              </Button>
            ) : (
              <>
                <Button type="button" variant="outline" size="sm" onClick={selectAllVisible} disabled={visibleAgentIds.length === 0 || busy} data-testid="skill-agent-selector-bulk-select-all" className={skillPickerBulkButtonClasses}>
                  {t('agents:skills.bulkSelectAll', { defaultValue: 'Select Visible' })}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setBulkSelectedIds([])} disabled={!hasBulkSelection || busy} data-testid="skill-agent-selector-bulk-clear" className={skillPickerBulkButtonClasses}>
                  {t('agents:skills.bulkClear', { defaultValue: 'Clear' })}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={bulkEnable} disabled={!hasBulkSelection || busy} data-testid="skill-agent-selector-bulk-enable" className={skillPickerBulkButtonClasses}>
                  {t('agents:skills.bulkEnable', { defaultValue: 'Enable' })}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={bulkDisable} disabled={!hasBulkSelection || busy} data-testid="skill-agent-selector-bulk-disable" className={skillPickerBulkButtonClasses}>
                  {t('agents:skills.bulkDisable', { defaultValue: 'Disable' })}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => { setIsBulkMode(false); setBulkSelectedIds([]); }} disabled={busy} data-testid="skill-agent-selector-bulk-exit" className={skillPickerBulkButtonClasses}>
                  {t('agents:skills.bulkExit', { defaultValue: 'Done' })}
                </Button>
              </>
            )}
          </div>

          <div className={cn(
            loading
              ? cn(skillPickerListContainerBaseClasses, 'min-h-40')
              : skillPickerListContainerClassesForCount(filteredAgents.length),
          )}>
            {loading ? (
              <div className="flex flex-col items-center justify-center py-10 gap-3">
                <LoadingSpinner size="md" />
                <span className="text-sm text-muted-foreground">
                  {t('skills:agentSelector.loadingAgents', { defaultValue: 'Loading agents...' })}
                </span>
              </div>
            ) : filteredAgents.length === 0 ? (
              <div className="text-[12px] text-muted-foreground px-2 py-3 text-center">
                {searchQuery
                  ? t('skills:agentSelector.noAgentsMatch', { query: searchQuery, defaultValue: `No agents match "${searchQuery}"` })
                  : t('skills:agentSelector.noAgents', { defaultValue: 'No agents available' })}
              </div>
            ) : (
              filteredAgents.map((agent) => {
                const normalizedAgentId = normalizeAgentId(agent.id);
                const isSelected = isCatalogAgentSelected(agent, selectedAgentIds, agents);
                const isBulkSelected = bulkSelectedSet.has(normalizedAgentId);
                return (
                  <div
                    key={agent.id}
                    className="flex items-center justify-between rounded-lg px-2 py-2 hover:bg-black/5 dark:hover:bg-white/5 gap-2 transition-colors"
                  >
                    {isBulkMode ? (
                      <button
                        type="button"
                        onClick={() => toggleBulkSelect(agent.id)}
                        disabled={busy}
                        className={cn(
                          'h-4 w-4 rounded border border-black/20 dark:border-white/20 flex items-center justify-center shrink-0',
                          isBulkSelected ? 'bg-black/80 text-white dark:bg-white/80 dark:text-black' : 'bg-transparent',
                        )}
                        aria-label={t('agents:skills.bulkToggleLabel', { skill: agent.name, defaultValue: `Toggle ${agent.name}` })}
                      >
                        {isBulkSelected ? <Check className="h-3 w-3" /> : null}
                      </button>
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium truncate flex items-center gap-1.5">
                        <span>{agent.name}</span>
                        {agent.isDefault ? (
                          <Badge variant="outline" className="h-4 rounded-full px-1.5 text-[10px] border-black/20 dark:border-white/20">
                            {t('agents:defaultBadge', { defaultValue: 'Default' })}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="text-[11px] text-muted-foreground font-mono truncate">{agent.id}</div>
                    </div>
                    {!isBulkMode ? (
                      <Switch checked={isSelected} disabled={busy} onCheckedChange={() => toggleAgent(agent.id)} />
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
      ) : null}
    </SkillPickerDialogShell>
    {skill ? (
      <AgentSelectorGlobalChoiceDialog
        open={promptOpen}
        skillName={skill.name}
        kind={globalPromptKind}
        onChoice={resolveGlobalChoice}
      />
    ) : null}
  </>
  );
}
