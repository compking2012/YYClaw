import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { WorkflowStepExpandableInput } from '@/components/office/WorkflowStepExpandableInput';
import { WorkflowNodeMaxRuntimeStepper } from '@/components/office/WorkflowNodeMaxRuntimeStepper';
import { OfficeMissingAgentBadge } from '@/components/office/OfficeMissingAgentBadge';
import { isOfficeUserCheckpointFeatureEnabled } from '@/lib/office-user-checkpoint-feature';
import { officeFormFieldClass } from '@/lib/office-form-field-styles';
import { agentDisplayName } from '@/lib/office-group-agents';
import {
  officeMissingNodeFrameClass,
  stepDraftRowShowMissingBadge,
} from '@/lib/office-missing-agents';
import {
  emptyWorkflowStepDraftRow,
  isWorkflowStepDraftRowEmpty,
  normalizeWorkflowStepDraftRows,
  parallelStepOptions,
  removeWorkflowStepDraftRow,
  rollbackStepOptions,
  stepDraftMaxRuntimeMinutes,
  stepDraftUserCheckpoint,
} from '@/lib/office-workflow-step-drafts';
import { cn } from '@/lib/utils';
import type { AgentSummary } from '@/types/agent';
import type { WorkflowStepDraftRow } from '@/types/office';

interface WorkflowStepDraftsFieldProps {
  rows: WorkflowStepDraftRow[];
  memberAgentIds: string[];
  agents: AgentSummary[];
  disabled?: boolean;
  testId?: string;
  /** 嵌入结构化编排面板时隐藏区块标题并禁用自动滚动。 */
  embedded?: boolean;
  /** Legacy DAG only; LangGraph 运行时不支持 userCheckpoint。 */
  userCheckpointEditable?: boolean;
  /**
   * Per-step missing agent ids, computed fresh from persisted data whenever the
   * edit form is (re)built. This is the sole source for the step-row missing
   * badge: it is spliced in sync when a row is removed (unlike a badge map keyed
   * by open-time array index, which would misattribute after removal), and it is
   * cleared live via `onClearStepMissing` once the user touches a row's agent
   * assignment — while still being re-derived (and re-flagged) from persisted
   * data on every re-open if the fix was never saved.
   */
  stepMissingAgentIds?: string[][];
  /** Historical display names for deleted agents. */
  agentNameHints?: Record<string, string>;
  onClearStepMissing?: (index: number) => void;
  /** Called when a step row is removed so parent can splice stepMissingAgentIds. */
  onRemoveStepMissing?: (index: number) => void;
  onChange: (rows: WorkflowStepDraftRow[]) => void;
}

/** 与 WorkflowStepExpandableInput 内 Input 统一：h-8 + text-xs */
const FIELD_H = 'box-border h-8 min-h-8 max-h-8 text-xs leading-none';
const fieldSelectClass = cn(
  officeFormFieldClass(),
  FIELD_H,
  'w-[7.75rem] shrink-0 rounded-md px-2',
);
const fieldRowClass = 'grid grid-cols-[2.75rem_minmax(0,1fr)] items-start gap-x-2.5 gap-y-2';
const fieldRowLabelClass =
  'whitespace-pre self-center text-left text-[11px] leading-none text-muted-foreground';

function centerTitleInFormScroll(element: HTMLElement) {
  const scrollParent = element.closest('[data-office-task-form-scroll]');
  if (!(scrollParent instanceof HTMLElement)) return;
  const parentRect = scrollParent.getBoundingClientRect();
  const elRect = element.getBoundingClientRect();
  const offsetTop = scrollParent.scrollTop + (elRect.top - parentRect.top);
  const target = offsetTop - parentRect.height / 2 + elRect.height / 2;
  scrollParent.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
}

function FieldLabel({ label, hide = false }: { label: string; hide?: boolean }) {
  return (
    <span className={cn(fieldRowLabelClass, hide && 'invisible select-none')} aria-hidden={hide}>
      {label}
    </span>
  );
}

export function WorkflowStepDraftsField({
  rows,
  memberAgentIds,
  agents = [],
  disabled = false,
  testId = 'office-workflow-step-drafts',
  embedded = false,
  userCheckpointEditable = true,
  stepMissingAgentIds,
  agentNameHints: _agentNameHints,
  onClearStepMissing,
  onRemoveStepMissing,
  onChange,
}: WorkflowStepDraftsFieldProps) {
  const { t } = useTranslation('office');
  const checkpointFeatureOn = isOfficeUserCheckpointFeatureEnabled();
  const showUserCheckpoint = userCheckpointEditable && checkpointFeatureOn;
  const [expandedInputId, setExpandedInputId] = useState<string | null>(null);
  const titleAnchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (embedded) return;
    const anchor = titleAnchorRef.current;
    if (!anchor) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => centerTitleInFormScroll(anchor));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [embedded]);

  const commitRows = (next: WorkflowStepDraftRow[]) => {
    onChange(normalizeWorkflowStepDraftRows(next));
  };

  const patchRow = (index: number, patch: Partial<WorkflowStepDraftRow>) => {
    const next = rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
    commitRows(next);
  };

  const setLinkMode = (index: number, mode: 'serial' | 'parallel') => {
    const stepNumber = index + 1;
    // 首节点只能串行。
    if (stepNumber <= 1 || mode === 'serial') {
      patchRow(index, { linkMode: 'serial', parallelWithStep: undefined });
      return;
    }
    const next = rows.map((row, i) => (i === index ? { ...row, linkMode: mode } : row));
    const options = parallelStepOptions(next, stepNumber);
    patchRow(index, {
      linkMode: 'parallel',
      parallelWithStep: options[options.length - 1],
    });
  };

  const setRollbackEnabled = (index: number, enabled: boolean) => {
    const stepNumber = index + 1;
    if (!enabled) {
      patchRow(index, {
        rollbackEnabled: false,
        rollbackCondition: '',
        rollbackStep: undefined,
      });
      return;
    }
    const options = rollbackStepOptions(stepNumber);
    patchRow(index, {
      rollbackEnabled: true,
      rollbackStep: options[options.length - 1],
    });
  };

  const addRow = () => {
    commitRows([...rows, emptyWorkflowStepDraftRow()]);
  };

  const removeRow = (index: number) => {
    if (rows.length <= 1) return;
    const stepNumber = index + 1;
    if (!window.confirm(t('workflowStepDrafts.removeRowConfirm', { n: stepNumber }))) return;
    if (expandedInputId?.endsWith(`-${stepNumber}`)) {
      setExpandedInputId(null);
    }
    onRemoveStepMissing?.(index);
    commitRows(removeWorkflowStepDraftRow(rows, index));
  };

  const memberAgents = memberAgentIds
    .map((id) => agents.find((a) => a.id === id))
    .filter((a): a is AgentSummary => !!a);

  const toggleAgent = (index: number, agentId: string) => {
    if (!agentId) return;
    const row = rows[index]!;
    const set = new Set(row.agentIds);
    if (set.has(agentId)) set.delete(agentId);
    else set.add(agentId);
    patchRow(index, { agentIds: [...set] });
    onClearStepMissing?.(index);
  };

  const agentSelectSummary = (agentIds: string[]) => {
    const known = agentIds.filter((id) => memberAgents.some((a) => a.id === id));
    if (known.length === 0) return t('workflowStepDrafts.whoSelectPlaceholder');
    return known.map((id) => agentDisplayName(id, agents)).join('、');
  };

  return (
    <div className={cn('space-y-3', embedded && 'space-y-2.5')} data-testid={testId}>
      {embedded ? null : (
        <div ref={titleAnchorRef} className="space-y-1">
          <Label>{t('workflowStepDrafts.title')}</Label>
          <p className="text-[10px] text-muted-foreground">{t('workflowStepDrafts.hint')}</p>
        </div>
      )}

      <div ref={embedded ? titleAnchorRef : undefined} className={cn('space-y-2.5', embedded && 'space-y-2')}>
      {rows.map((row, index) => {
        const stepNumber = index + 1;
        const parallelOptions = parallelStepOptions(rows, stepNumber);
        const rollbackOptions = rollbackStepOptions(stepNumber);
        const rollbackOn = row.rollbackEnabled === true && stepNumber > 1;
        const taskInputId = `${testId}-task-${stepNumber}`;
        const outputInputId = `${testId}-output-${stepNumber}`;
        const rollbackConditionId = `${testId}-rollback-condition-${stepNumber}`;
        const taskExpanded = expandedInputId === taskInputId;
        const outputExpanded = expandedInputId === outputInputId;
        const rollbackExpanded = expandedInputId === rollbackConditionId;
        const showMetaRows = !outputExpanded && !rollbackExpanded;
        const showMissingBadge = stepDraftRowShowMissingBadge(stepMissingAgentIds, index);
        // Contentful row with no assignee (e.g. after member unbind) — same red
        // frame as empty_node save block / visual preview empty badge.
        const showEmptyNodeBadge =
          !showMissingBadge
          && !isWorkflowStepDraftRowEmpty(row)
          && (row.agentIds?.length ?? 0) === 0;
        const showAnyBadge = showMissingBadge || showEmptyNodeBadge;

        return (
          <div
            key={`step-draft-${index}`}
            className={cn(
              'office-form-scroll-row overflow-hidden rounded-lg border bg-card/80',
              showAnyBadge
                ? officeMissingNodeFrameClass(true)
                : 'border-border/45',
            )}
            data-testid={`${testId}-row-${stepNumber}`}
            data-missing-agents={showAnyBadge ? 'true' : 'false'}
          >
            <div className="flex items-center justify-between gap-2 border-b border-border/30 bg-muted/15 px-3 py-1.5">
              <span className="inline-flex min-w-0 items-center gap-2 text-xs font-medium tracking-tight text-foreground">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                  {stepNumber}
                </span>
                <span className="truncate">{t('workflowStepDrafts.nodeLabel', { n: stepNumber })}</span>
                {showMissingBadge ? (
                  <OfficeMissingAgentBadge
                    className="ml-0"
                    testId={`${testId}-missing-${stepNumber}`}
                  />
                ) : null}
                {showEmptyNodeBadge ? (
                  <OfficeMissingAgentBadge
                    className="ml-0"
                    testId={`${testId}-empty-${stepNumber}`}
                    labelKey="missingAgents.emptyNodeBadge"
                  />
                ) : null}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                {showUserCheckpoint ? (
                <label
                  className="flex items-center gap-1 text-[10px] text-muted-foreground"
                  title={t('workflow.userCheckpoint')}
                >
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 shrink-0 rounded border-border"
                    checked={stepDraftUserCheckpoint(row)}
                    disabled={disabled}
                    data-testid={`${testId}-user-checkpoint-${stepNumber}`}
                    onChange={(e) => patchRow(index, { userCheckpoint: e.target.checked })}
                  />
                  <span className="hidden sm:inline">{t('workflow.userCheckpoint')}</span>
                </label>
                ) : null}
                <div
                  className="flex items-center gap-1 text-[10px] text-muted-foreground"
                  title={t('workflow.maxRuntimeLabel')}
                >
                  <span className="hidden sm:inline">{t('workflow.maxRuntimeLabel')}</span>
                  <WorkflowNodeMaxRuntimeStepper
                    value={stepDraftMaxRuntimeMinutes(row)}
                    disabled={disabled}
                    testId={`${testId}-runtime-${stepNumber}`}
                    minutesUnitLabel={t('workflow.minutesUnit')}
                    ariaLabel={t('workflow.maxRuntimeMinutes')}
                    onChange={(maxRuntimeMinutes) => patchRow(index, { maxRuntimeMinutes })}
                  />
                </div>
                {rows.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                    disabled={disabled}
                    data-testid={`${testId}-remove-${stepNumber}`}
                    onClick={() => removeRow(index)}
                    aria-label={t('workflowStepDrafts.removeRow')}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </div>
            </div>

            <div className={cn(fieldRowClass, 'px-3 py-2')}>
              <FieldLabel label={t('workflowStepDrafts.rowWho')} hide={taskExpanded} />
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  {!taskExpanded ? (
                    memberAgents.length > 0 ? (
                      <select
                        disabled={disabled}
                        value=""
                        className={fieldSelectClass}
                        aria-label={t('workflowStepDrafts.whoSelectAria')}
                        data-testid={`${testId}-who-select-${stepNumber}`}
                        onChange={(e) => toggleAgent(index, e.target.value)}
                      >
                        <option value="" disabled>
                          {agentSelectSummary(row.agentIds)}
                        </option>
                        {memberAgents.map((agent) => {
                          const selected = row.agentIds.includes(agent.id);
                          return (
                            <option key={agent.id} value={agent.id}>
                              {selected
                                ? `✓ ${agentDisplayName(agent.id, agents)}`
                                : agentDisplayName(agent.id, agents)}
                            </option>
                          );
                        })}
                      </select>
                    ) : (
                      <select
                        disabled
                        className={fieldSelectClass}
                        data-testid={`${testId}-who-select-${stepNumber}`}
                        aria-label={t('workflowStepDrafts.whoSelectAria')}
                      >
                        <option>{t('workflowStepDrafts.whoEmptyMembers')}</option>
                      </select>
                    )
                  ) : null}
                  <WorkflowStepExpandableInput
                    inputId={taskInputId}
                    expandedId={expandedInputId}
                    onExpandChange={setExpandedInputId}
                    value={row.task}
                    disabled={disabled}
                    placeholder={t('workflowStepDrafts.taskPlaceholder')}
                    testId={taskInputId}
                    compactClassName="min-w-0 flex-1"
                    onChange={(task) => patchRow(index, { task })}
                  />
                </div>
              </div>

              <FieldLabel label={t('workflowStepDrafts.rowOutput')} hide={outputExpanded} />
              <div className="min-w-0">
                <WorkflowStepExpandableInput
                  inputId={outputInputId}
                  expandedId={expandedInputId}
                  onExpandChange={setExpandedInputId}
                  value={row.output}
                  disabled={disabled}
                  placeholder={t('workflowStepDrafts.outputPlaceholder')}
                  testId={outputInputId}
                  compactClassName="min-w-0 w-full"
                  compactFullWidth
                  onChange={(output) => patchRow(index, { output })}
                />
              </div>

              {showMetaRows ? (
                <>
                  {/* 首节点只能串行，无可并行对象，不展示「编排」。 */}
                  {stepNumber > 1 ? (
                    <>
                      <FieldLabel label={t('workflowStepDrafts.rowFlow')} />
                      <div className="min-w-0">
                        <div
                          className="flex min-w-0 flex-wrap items-center gap-2"
                          data-testid={`${testId}-flow-${stepNumber}`}
                        >
                          <select
                            className={fieldSelectClass}
                            disabled={disabled}
                            value={row.linkMode}
                            data-testid={`${testId}-link-${stepNumber}`}
                            onChange={(e) => {
                              const mode = e.target.value === 'parallel' ? 'parallel' : 'serial';
                              setLinkMode(index, mode);
                            }}
                          >
                            <option value="serial">{t('workflowStepDrafts.linkMode_serial')}</option>
                            <option value="parallel">
                              {t('workflowStepDrafts.linkMode_parallel')}
                            </option>
                          </select>

                          {row.linkMode === 'parallel' && parallelOptions.length > 0 ? (
                            <select
                              className={fieldSelectClass}
                              disabled={disabled}
                              value={row.parallelWithStep ?? ''}
                              data-testid={`${testId}-parallel-with-${stepNumber}`}
                              onChange={(e) => {
                                const v = Number.parseInt(e.target.value, 10);
                                patchRow(index, {
                                  parallelWithStep: Number.isFinite(v) ? v : undefined,
                                });
                              }}
                            >
                              <option value="">{t('workflowStepDrafts.parallelWithStepPlaceholder')}</option>
                              {parallelOptions.map((n) => (
                                <option key={n} value={n}>
                                  {t('workflowStepDrafts.parallelWithStepOption', { n })}
                                </option>
                              ))}
                            </select>
                          ) : null}
                        </div>
                      </div>

                      <FieldLabel label={t('workflowStepDrafts.rowRollback')} />
                      <div className="min-w-0">
                        <div
                          className="flex min-w-0 flex-wrap items-center gap-2"
                          data-testid={`${testId}-rollback-${stepNumber}`}
                        >
                        <select
                          className={fieldSelectClass}
                          disabled={disabled}
                          value={rollbackOn ? 'yes' : 'no'}
                          data-testid={`${testId}-rollback-toggle-${stepNumber}`}
                          onChange={(e) => setRollbackEnabled(index, e.target.value === 'yes')}
                        >
                          <option value="no">{t('workflowStepDrafts.rollback_no')}</option>
                          <option value="yes">{t('workflowStepDrafts.rollback_yes')}</option>
                        </select>

                        {rollbackOn ? (
                          <>
                            <WorkflowStepExpandableInput
                              inputId={rollbackConditionId}
                              expandedId={expandedInputId}
                              onExpandChange={setExpandedInputId}
                              value={row.rollbackCondition ?? ''}
                              disabled={disabled}
                              placeholder={t('workflowStepDrafts.rollbackConditionPlaceholder')}
                              testId={rollbackConditionId}
                              compactClassName="min-w-[8rem] flex-1"
                              onChange={(rollbackCondition) => patchRow(index, { rollbackCondition })}
                            />
                            <select
                              className={fieldSelectClass}
                              disabled={disabled}
                              value={row.rollbackStep ?? ''}
                              data-testid={`${testId}-rollback-step-${stepNumber}`}
                              onChange={(e) => {
                                const v = Number.parseInt(e.target.value, 10);
                                patchRow(index, {
                                  rollbackStep: Number.isFinite(v) ? v : undefined,
                                });
                              }}
                            >
                              <option value="">{t('workflowStepDrafts.rollbackStepPlaceholder')}</option>
                              {rollbackOptions.map((n) => (
                                <option key={n} value={n}>
                                  {t('workflowStepDrafts.rollbackStepOption', { n })}
                                </option>
                              ))}
                            </select>
                          </>
                        ) : null}
                        </div>
                      </div>
                    </>
                  ) : null}
                </>
              ) : rollbackExpanded ? (
                <>
                  <FieldLabel label={t('workflowStepDrafts.rowRollback')} />
                  <div className="min-w-0">
                    <WorkflowStepExpandableInput
                      inputId={rollbackConditionId}
                      expandedId={expandedInputId}
                      onExpandChange={setExpandedInputId}
                      value={row.rollbackCondition ?? ''}
                      disabled={disabled}
                      placeholder={t('workflowStepDrafts.rollbackConditionPlaceholder')}
                      testId={rollbackConditionId}
                      compactClassName="min-w-0 w-full"
                      compactFullWidth
                      onChange={(rollbackCondition) => patchRow(index, { rollbackCondition })}
                    />
                  </div>
                </>
              ) : null}
            </div>
          </div>
        );
      })}

      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 w-full gap-1.5 border-dashed text-xs sm:w-auto"
        disabled={disabled}
        data-testid={`${testId}-add-row`}
        onClick={addRow}
      >
        <Plus className="h-3.5 w-3.5" />
        {t('workflowStepDrafts.addRow')}
      </Button>
    </div>
  );
}
