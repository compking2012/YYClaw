import { expect, it, vi, beforeEach } from 'vitest';
import type { NodeRunRecord, WorkflowNode } from '../../src/types/office';
import { describeLangGraph } from '../helpers/langgraph-flag';

const nodes: WorkflowNode[] = [
  { id: 'lg-0', roleId: 'pm', title: '启动', execution: 'serial' },
  { id: 'lg-1', roleId: 'dev', title: '开发', execution: 'serial' },
];

function run(nodeId: string, status: NodeRunRecord['status']): NodeRunRecord {
  return { nodeId, roleId: nodeId === 'lg-0' ? 'pm' : 'dev', status };
}

describeLangGraph('langGraphWorkflowRunNeedsContinuation', () => {
  it('returns false when all nodes completed', async () => {
    const { langGraphWorkflowRunNeedsContinuation } = await import(
      '../../electron/services/office/workflow-langgraph-runner'
    );
    expect(
      langGraphWorkflowRunNeedsContinuation(
        [run('lg-0', 'completed'), run('lg-1', 'completed')],
        nodes,
      ),
    ).toBe(false);
  });

  it('returns true when a node is pending after invoke', async () => {
    const { langGraphWorkflowRunNeedsContinuation } = await import(
      '../../electron/services/office/workflow-langgraph-runner'
    );
    expect(
      langGraphWorkflowRunNeedsContinuation(
        [run('lg-0', 'pending'), run('lg-1', 'pending')],
        nodes,
      ),
    ).toBe(true);
  });

  it('returns true when a node is still running', async () => {
    const { langGraphWorkflowRunNeedsContinuation } = await import(
      '../../electron/services/office/workflow-langgraph-runner'
    );
    expect(
      langGraphWorkflowRunNeedsContinuation(
        [run('lg-0', 'running'), run('lg-1', 'pending')],
        nodes,
      ),
    ).toBe(true);
  });

  it('returns false when blocked (user interrupt)', async () => {
    const { langGraphWorkflowRunNeedsContinuation } = await import(
      '../../electron/services/office/workflow-langgraph-runner'
    );
    expect(
      langGraphWorkflowRunNeedsContinuation(
        [run('lg-0', 'pending'), run('lg-1', 'pending')],
        nodes,
        { blocked: true },
      ),
    ).toBe(false);
  });

  it('returns false when any node failed', async () => {
    const { langGraphWorkflowRunNeedsContinuation } = await import(
      '../../electron/services/office/workflow-langgraph-runner'
    );
    expect(
      langGraphWorkflowRunNeedsContinuation(
        [run('lg-0', 'failed'), run('lg-1', 'pending')],
        nodes,
      ),
    ).toBe(false);
  });
});

describeLangGraph('teardownLangGraphTaskResources', () => {
  const taskId = 'task-teardown-test';

  beforeEach(async () => {
    const { clearLangGraphWorkflowSession } = await import(
      '../../electron/services/office/workflow-langgraph-interrupt'
    );
    clearLangGraphWorkflowSession(taskId);
  });

  it('clears in-memory interrupt session', async () => {
    const {
      clearLangGraphWorkflowSession,
      getLangGraphWorkflowSession,
      registerLangGraphWorkflowSession,
      teardownLangGraphTaskResources,
    } = await import('../../electron/services/office/workflow-langgraph-interrupt');
    clearLangGraphWorkflowSession(taskId);
    registerLangGraphWorkflowSession({
      taskId,
      graph: { invoke: vi.fn(), getState: vi.fn() },
      config: {},
      gateway: {} as never,
      scenario: { id: 's1', roleIds: [], workflow: { mode: 'dag', nodes: [], edges: [] } } as never,
      workflow: { mode: 'dag', nodes: [], edges: [] },
    });
    expect(getLangGraphWorkflowSession(taskId)).toBeDefined();

    await teardownLangGraphTaskResources(taskId, { deleteCheckpoint: false });

    expect(getLangGraphWorkflowSession(taskId)).toBeUndefined();
  });

  it('uses office-task-{id} thread id format', async () => {
    const { langGraphThreadIdForTask } = await import(
      '../../electron/services/office/workflow-langgraph-interrupt'
    );
    expect(langGraphThreadIdForTask('abc')).toBe('office-task-abc');
  });
});

describeLangGraph('routeAfterExecute failure routing', () => {
  it('does not route technical failed without edgeOutcome to on_failure targets', async () => {
    const { routeAfterExecute } = await import(
      '../../electron/services/office/workflow-langgraph-native-routes'
    );
    const plan = {
      kind: 'langgraph_native' as const,
      version: 2 as const,
      checkpointer: 'langgraph_memory' as const,
      entry: 'exec-test',
      nodes: [
        { id: 'exec-test', kind: 'execute' as const, label: 'Test', officeNodeId: 'lg-test' },
        { id: 'exec-fix', kind: 'execute' as const, label: 'Fix', officeNodeId: 'lg-fix' },
      ],
      edges: [],
      conditionalRoutes: [
        {
          from: 'exec-test',
          branches: [
            { key: 'failure', when: 'failure' as const, targets: ['exec-fix'] },
          ],
        },
      ],
      subgraphs: [],
      visualLayers: [],
    };
    const route = routeAfterExecute(plan, 'exec-test', {
      runs: [{ nodeId: 'lg-test', status: 'failed' }],
    }, 'lg-test', false);
    expect(route).not.toBe('exec-fix');
  });

  it('does not route technical failed even when edgeOutcome is stamped failure', async () => {
    const { routeAfterExecute } = await import(
      '../../electron/services/office/workflow-langgraph-native-routes'
    );
    const plan = {
      kind: 'langgraph_native' as const,
      version: 2 as const,
      checkpointer: 'langgraph_memory' as const,
      entry: 'exec-test',
      nodes: [
        { id: 'exec-test', kind: 'execute' as const, label: 'Test', officeNodeId: 'lg-test' },
        { id: 'exec-fix', kind: 'execute' as const, label: 'Fix', officeNodeId: 'lg-fix' },
        { id: 'exec-next', kind: 'execute' as const, label: 'Next', officeNodeId: 'lg-next' },
      ],
      edges: [],
      conditionalRoutes: [
        {
          from: 'exec-test',
          branches: [
            { key: 'failure', when: 'failure' as const, targets: ['exec-fix'] },
            { key: 'success', when: 'success' as const, targets: ['exec-next'] },
          ],
        },
      ],
      subgraphs: [],
      visualLayers: [],
    };
    const route = routeAfterExecute(plan, 'exec-test', {
      runs: [{ nodeId: 'lg-test', status: 'failed', edgeOutcome: 'failure' }],
    }, 'lg-test', false);
    expect(route).not.toBe('exec-fix');
    expect(route).not.toBe('exec-next');
  });

  it('routes business failure (edgeOutcome=failure) to on_failure targets', async () => {
    const { routeAfterExecute } = await import(
      '../../electron/services/office/workflow-langgraph-native-routes'
    );
    const plan = {
      kind: 'langgraph_native' as const,
      version: 2 as const,
      checkpointer: 'langgraph_memory' as const,
      entry: 'exec-test',
      nodes: [
        { id: 'exec-test', kind: 'execute' as const, label: 'Test', officeNodeId: 'lg-test' },
        { id: 'exec-fix', kind: 'execute' as const, label: 'Fix', officeNodeId: 'lg-fix' },
      ],
      edges: [],
      conditionalRoutes: [
        {
          from: 'exec-test',
          branches: [
            { key: 'failure', when: 'failure' as const, targets: ['exec-fix'] },
          ],
        },
      ],
      subgraphs: [],
      visualLayers: [],
    };
    const route = routeAfterExecute(plan, 'exec-test', {
      runs: [{ nodeId: 'lg-test', status: 'completed', edgeOutcome: 'failure' }],
    }, 'lg-test', false);
    expect(route).toBe('exec-fix');
  });
});
