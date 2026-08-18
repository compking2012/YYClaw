import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { WorkflowNodeMaxRuntimeStepper } from '@/components/office/WorkflowNodeMaxRuntimeStepper';
import { isOfficeUserCheckpointFeatureEnabled } from '@/lib/office-user-checkpoint-feature';
import {
  DEFAULT_NODE_MAX_RUNTIME_MINUTES,
  nodeMaxRuntimeMinutes,
} from '@/lib/office-workflow-roles';
import { sortWorkflowNodesByProcessOrder } from '@/lib/office-workflow-sort';
import type { WorkflowDefinition } from '@/types/office';

type WorkflowStepRuntimeListProps = {
  workflow: WorkflowDefinition;
  disabled?: boolean;
  userCheckpointEditable?: boolean;
  onChange: (workflow: WorkflowDefinition) => void;
};

export function WorkflowStepRuntimeList({
  workflow,
  disabled = false,
  userCheckpointEditable = true,
  onChange,
}: WorkflowStepRuntimeListProps) {
  const { t } = useTranslation('office');
  const showUserCheckpoint = userCheckpointEditable && isOfficeUserCheckpointFeatureEnabled();
  const [open, setOpen] = useState(false);
  const ordered = useMemo(
    () => sortWorkflowNodesByProcessOrder(workflow).nodes,
    [workflow],
  );

  if (ordered.length === 0) return null;

  const patchNode = (nodeId: string, patch: { maxRuntimeMinutes?: number; userCheckpoint?: boolean }) => {
    onChange({
      ...workflow,
      nodes: workflow.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        const next = { ...n, ...patch };
        if (patch.userCheckpoint === false) {
          const { userCheckpoint: _removed, ...rest } = next;
          return rest;
        }
        return next;
      }),
    });
  };

  return (
    <div
      className="rounded-lg border bg-card/80"
      data-testid="office-workflow-step-runtime-list"
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-muted/30"
        aria-expanded={open}
        data-testid="office-workflow-step-runtime-toggle"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold">{t('workflow.stepRuntimeTitle')}</p>
          {!open ? (
            <p className="truncate text-[10px] text-muted-foreground">
              {t('workflow.stepRuntimeCollapsed', { count: ordered.length })}
            </p>
          ) : (
            <p className="text-[10px] text-muted-foreground">{t('workflow.stepRuntimeHint')}</p>
          )}
        </div>
      </button>
      {open ? (
        <ul className="max-h-40 space-y-1.5 overflow-y-auto border-t px-2 pb-2 pt-1">
          {ordered.map((node, index) => (
            <li
              key={node.id}
              className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/20 px-2 py-1"
              data-testid={`office-workflow-step-runtime-row-${index + 1}`}
            >
              <span className="w-5 shrink-0 text-center text-[10px] font-semibold text-muted-foreground">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
                {node.title?.trim() || t('workflow.unnamedStep')}
              </span>
              <label
                className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground"
                title={t('workflow.userCheckpoint')}
              >
                {showUserCheckpoint ? (
                <>
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 shrink-0 rounded border-border"
                  checked={node.userCheckpoint === true}
                  disabled={disabled}
                  data-testid={`office-workflow-step-user-checkpoint-${node.id}`}
                  onChange={(e) =>
                    patchNode(node.id, {
                      userCheckpoint: e.target.checked ? true : false,
                    })
                  }
                />
                <span className="hidden sm:inline">{t('workflow.userCheckpoint')}</span>
                </>
                ) : null}
              </label>
              <div className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
                <span className="sr-only">{t('workflow.maxRuntimeLabel')}</span>
                <WorkflowNodeMaxRuntimeStepper
                  value={nodeMaxRuntimeMinutes(node)}
                  disabled={disabled}
                  testId={`office-workflow-step-runtime-${node.id}`}
                  minutesUnitLabel={t('workflow.minutesUnit')}
                  ariaLabel={t('workflow.maxRuntimeMinutes')}
                  onChange={(maxRuntimeMinutes) =>
                    patchNode(node.id, {
                      maxRuntimeMinutes:
                        maxRuntimeMinutes > 0
                          ? maxRuntimeMinutes
                          : DEFAULT_NODE_MAX_RUNTIME_MINUTES,
                    })
                  }
                />
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
