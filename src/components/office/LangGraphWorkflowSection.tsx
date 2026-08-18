import { LangGraphCustomWorkflowEditor } from '@/components/office/LangGraphCustomWorkflowEditor';
import { stashLangGraphTabDraft } from '@/lib/office-langgraph-workflow-bundle';
import type { ProjectAgentRef } from '@/lib/office-workflow-node';
import type {
  LangGraphWorkflowBundle,
  LangGraphWorkflowSource,
  WorkflowDefinition,
} from '@/types/office';

interface LangGraphWorkflowSectionProps {
  workflow: WorkflowDefinition;
  langGraphWorkflowBundle?: LangGraphWorkflowBundle;
  langGraphCustomJsonDraft?: string;
  /** @deprecated Use teamMembers */
  roles?: never[];
  teamMembers: ProjectAgentRef[];
  disabled?: boolean;
  editGateMissingBadgeByKey?: ReadonlyMap<string, boolean>;
  langGraphMissingKeySource?: LangGraphWorkflowSource;
  onChange: (patch: {
    workflow: WorkflowDefinition;
    langGraphTab: LangGraphWorkflowSource;
    langGraphWorkflowBundle?: LangGraphWorkflowBundle;
    langGraphCustomJsonDraft?: string;
  }) => void;
}

/** LangGraph 自编排工作流编辑区。 */
export function LangGraphWorkflowSection({
  workflow,
  langGraphWorkflowBundle,
  langGraphCustomJsonDraft = '',
  teamMembers,
  disabled = false,
  editGateMissingBadgeByKey,
  langGraphMissingKeySource = 'custom',
  onChange,
}: LangGraphWorkflowSectionProps) {
  return (
    <div className="space-y-2" data-testid="office-langgraph-workflow-section">
      <LangGraphCustomWorkflowEditor
        workflow={workflow}
        teamMembers={teamMembers}
        jsonDraft={langGraphCustomJsonDraft}
        disabled={disabled}
        editGateMissingBadgeByKey={editGateMissingBadgeByKey}
        langGraphMissingKeySource={langGraphMissingKeySource}
        onJsonDraftChange={(jsonText) =>
          onChange({
            workflow,
            langGraphTab: 'custom',
            langGraphWorkflowBundle,
            langGraphCustomJsonDraft: jsonText,
          })
        }
        onChange={(nextWorkflow) =>
          onChange({
            workflow: nextWorkflow,
            langGraphTab: 'custom',
            langGraphWorkflowBundle: stashLangGraphTabDraft(
              langGraphWorkflowBundle,
              'custom',
              nextWorkflow,
            ),
            langGraphCustomJsonDraft,
          })
        }
      />
    </div>
  );
}
