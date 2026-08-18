import { describe, expect, it } from 'vitest';
import { taskWorkflowEngine } from '../../src/lib/office-workflow-engine';
import { generateLangGraphWorkflowFromDescriptionHeuristic } from '../../src/lib/office-workflow-generate';
import { ENABLE_LANGGRAPH } from '../../src/lib/feature-langgraph';
import type { OfficeRole } from '../../src/types/office';
import { describeLangGraph } from '../helpers/langgraph-flag';

describe('office workflow engine selection', () => {
  it('defaults workflow tasks to the existing DAG engine', () => {
    expect(taskWorkflowEngine({ executionMode: 'workflow' })).toBe('dag');
    expect(taskWorkflowEngine({ executionMode: 'workflow', workflowEngine: 'dag' })).toBe('dag');
  });

  it('uses LangGraph only when a workflow task explicitly selects it', () => {
    if (ENABLE_LANGGRAPH) {
      expect(taskWorkflowEngine({ executionMode: 'workflow', workflowEngine: 'langgraph' })).toBe('langgraph');
    } else {
      expect(taskWorkflowEngine({ executionMode: 'workflow', workflowEngine: 'langgraph' })).toBe('dag');
    }
  });

  it('keeps Smart tasks off the LangGraph workflow engine', () => {
    expect(taskWorkflowEngine({ executionMode: 'smart', workflowEngine: 'langgraph' })).toBe('dag');
  });
});

describeLangGraph('office LangGraph workflow generation', () => {
  const roles: OfficeRole[] = [
    { id: 'pm', name: 'PM', agentId: 'pm', createdAt: 1, updatedAt: 1 },
    { id: 'dev', name: '开发', agentId: 'dev', createdAt: 1, updatedAt: 1 },
    { id: 'qa', name: '测试', agentId: 'qa', createdAt: 1, updatedAt: 1 },
  ];

  it('materializes a LangGraph orchestration plan instead of the legacy DAG generator shape', () => {
    const result = generateLangGraphWorkflowFromDescriptionHeuristic(
      '1.PM编写项目计划；2.开发实现；3.测试验收',
      roles,
    );

    expect(result?.source).toBe('langgraph_heuristic');
    expect(result?.workflow.orchestrationEngine).toBe('langgraph');
    expect(result?.workflow.orchestrationPlan?.kind).toBe('langgraph_native');
    expect(result?.workflow.nodes.every((node) => node.id.startsWith('lg-'))).toBe(true);
    expect(result?.workflow.edgesCustomized).toBe(true);
    if (result?.workflow.orchestrationPlan?.kind === 'langgraph_native') {
      expect(result.workflow.orchestrationPlan.nodes.some((node) => node.kind === 'execute')).toBe(true);
    }
  });

  it('marks every node in a LangGraph parallel layer with the same parallelGroup', () => {
    const result = generateLangGraphWorkflowFromDescriptionHeuristic(
      '1.PM编写项目计划；2.测试编写测试用例；3.开发实现，与2并行；4.测试验收',
      roles,
    );
    const testNode = result?.workflow.nodes.find((node) => node.title === '测试用例设计');
    const devNode = result?.workflow.nodes.find((node) => node.title === '开发实现');

    expect(testNode?.parallelGroup).toBeTruthy();
    expect(devNode?.parallelGroup).toBe(testNode?.parallelGroup);
  });
});
