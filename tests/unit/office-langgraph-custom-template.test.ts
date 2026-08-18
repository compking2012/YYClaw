import { expect, it } from 'vitest';
import {
  formatLangGraphCustomWorkflowTemplateJson,
  isLangGraphCustomWorkflowJsonEmpty,
} from '@/lib/office-langgraph-custom-template';
import { emptyWorkflow } from '@/lib/office-workflow-roles';
import { describeLangGraph } from '../helpers/langgraph-flag';

describeLangGraph('office-langgraph-custom-template', () => {
  it('formatLangGraphCustomWorkflowTemplateJson includes langgraph_native plan', () => {
    const json = formatLangGraphCustomWorkflowTemplateJson([{ id: 'pm', name: 'PM' }]);
    const parsed = JSON.parse(json) as { orchestrationPlan?: { kind?: string } };
    expect(parsed.orchestrationPlan?.kind).toBe('langgraph_native');
    expect(json).toContain('"role": "PM"');
  });

  it('isLangGraphCustomWorkflowJsonEmpty detects empty draft', () => {
    expect(isLangGraphCustomWorkflowJsonEmpty('', emptyWorkflow('dag'))).toBe(true);
    expect(
      isLangGraphCustomWorkflowJsonEmpty(
        JSON.stringify({ ...emptyWorkflow('dag'), nodes: [{ id: 'n', role: 'PM', title: 'S', execution: 'serial' }] }),
        emptyWorkflow('dag'),
      ),
    ).toBe(false);
  });
});
