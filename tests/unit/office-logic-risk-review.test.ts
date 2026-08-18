/**
 * 潜在逻辑风险审查 — 回归/契约单测。
 * 每项用例对应 review 文档中的一条风险；已修复项断言正确行为，未修复项锁定当前语义便于后续改动。
 */
import { describe, expect, it } from 'vitest';
import { createFixedGroupDraft } from '../../electron/services/office/store';
import {
  resolveStepRollbackTargets,
} from '@/lib/office-workflow-generate';
import {
  workflowStepDraftRowToGenerationStep,
  generateWorkflowFromStepDraftRows,
} from '@/lib/office-workflow-step-drafts';
import {
  validateSmartCoordinatorRoomMentions,
  isSmartProjectEngineComplete,
} from '@/lib/office-smart-coordinator-dispatch';
import { validateWorkflowAgentStructuredReply } from '../../electron/services/office/workflow-agent-reply';
import { validateWorkflowRoomJsonForRunner } from '@/lib/office-workflow-room-json-validate';
import { workflowProjectRelativeLsLine } from '@/lib/office-workflow-task-prompt-shared';
import { nodeRunTriggersFailureEdge } from '@/lib/office-workflow-edge-outcome';
import { incomingReady, workflowEdgeList } from '@/lib/office-workflow-schedule';
import type { NodeRunRecord, ProjectAgentRef, WorkflowNode } from '@/types/office';

const members: ProjectAgentRef[] = [
  { agentId: 'a-dev', displayName: '软件开发' },
  { agentId: 'a-test', displayName: '软件测试' },
  { agentId: 'a-audit', displayName: '安全审计' },
];

function wfPath(role: string, file: string): string {
  return `交付物-${role}/${file}`;
}

describe('office logic risk review — 结构化编排 / 固定组', () => {
  it('rule 草稿回滚配置应生成 on_failure 边目标步号', () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({
      input: '',
      agentIds: ['a-dev'],
      task: `步骤${i + 1}`,
      output: '产出',
      linkMode: 'serial' as const,
    }));
    rows.push({
      input: '',
      agentIds: ['a-audit'],
      task: '安全审计',
      output: '审计报告',
      linkMode: 'serial' as const,
      rollbackEnabled: true,
      rollbackStep: 5,
      rollbackCondition: '结论不通过',
    });
    const step = workflowStepDraftRowToGenerationStep(rows[7]!, 8, members, rows);
    expect(step.rollbackToStepNumbers).toEqual([5]);
    expect(resolveStepRollbackTargets(step)).toEqual([5]);

    const wf = generateWorkflowFromStepDraftRows(rows, members);
    expect(wf).not.toBeNull();
    const failureEdges = wf!.workflow.edges.filter(
      (e) => (e.when ?? 'on_success') === 'on_failure',
    );
    expect(failureEdges).toEqual([{ from: 'gen-7', to: 'gen-4', when: 'on_failure' }]);
  });

  it('「回滚至第 N 步」文本可被 resolveStepRollbackTargets 解析', () => {
    expect(
      resolveStepRollbackTargets({
        title: '安全审计',
        roleNames: ['安全审计'],
        rawText: '回滚至第5步（结论不通过）',
      }),
    ).toEqual([5]);
  });

  it('createFixedGroupDraft 持久化 workflowOrchestrationMode', () => {
    const group = createFixedGroupDraft({
      name: 'G',
      agentIds: ['a-dev'],
      coordinatorAgentId: 'a-dev',
      workflowOrchestrationMode: 'rule',
    });
    expect(group.workflowOrchestrationMode).toBe('rule');
  });
});

describe('office logic risk review — Smart 派活 / 结项', () => {
  const team = members.map((m) => ({ agentId: m.agentId, displayName: m.displayName }));

  it('无下一执行者时带 @ 的 dispatch 当前仍放行（已知边界，待收紧）', () => {
    const result = validateSmartCoordinatorRoomMentions({
      teamRoles: team,
      coordinatorAgentId: 'a-pm',
      publishText: '请处理',
      dispatchText: '@软件开发 请修复',
      nextExecutorRoleIds: [],
      projectComplete: false,
    });
    expect(result).toBe('ok');
  });

  it('空工作顺序且无派活历史时引擎未完成（standalone 兜底未满足）', () => {
    expect(
      isSmartProjectEngineComplete({
        steps: [],
        roomMessages: [],
        projectId: 'p1',
        coordinatorAgentId: 'coord',
        teamRoles: [{ agentId: 'coord', displayName: 'PM' }],
      }),
    ).toBe(false);
  });
});

describe('office logic risk review — JSON 校验分裂', () => {
  const reviewFailWithoutRollback = JSON.stringify({
    role: '测试',
    step: { index: 3, total: 9, title: '需求评审' },
    inputValidation: {
      targets: ['需求初稿-产品.md'],
      lsResult: [workflowProjectRelativeLsLine('需求初稿-产品.md')],
    },
    execution: '评审发现关键缺口，结论不通过。',
    outputValidation: {
      targets: [wfPath('测试', '需求评审-测试.md')],
      lsResult: [workflowProjectRelativeLsLine('需求评审-测试.md')],
    },
    deliverable: {
      path: wfPath('测试', '需求评审-测试.md'),
      summary: '关键可测性标准缺失，不满足进入开发条件。',
      conclusion: '不通过',
    },
    rollback: '无',
  });

  it('StructuredReply 路径：评审不通过 + rollback 无 可通过（系统自动回滚）', () => {
    const r = validateWorkflowAgentStructuredReply({
      raw: reviewFailWithoutRollback,
      transportReason: 'empty',
      actorRoleName: '测试',
    });
    expect(r.ok).toBe(true);
  });

  it('ForRunner 路径：同 JSON 要求显式 rollback（两套校验不一致）', () => {
    const r = validateWorkflowRoomJsonForRunner(reviewFailWithoutRollback, {
      actorRoleName: '测试',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues).toContain('rollback_required');
    }
  });

  it('directPredecessorDeliverables 参数在 StructuredReply 中尚未参与校验', () => {
    const passJson = JSON.stringify({
      role: '测试',
      step: { index: 3, total: 9, title: '需求评审' },
      inputValidation: {
        targets: ['需求初稿-产品.md'],
        lsResult: [workflowProjectRelativeLsLine('需求初稿-产品.md')],
      },
      execution: '评审完成。',
      outputValidation: {
        targets: [wfPath('测试', '需求评审-测试.md')],
        lsResult: [workflowProjectRelativeLsLine('需求评审-测试.md')],
      },
      deliverable: {
        path: wfPath('测试', '需求评审-测试.md'),
        summary: '发现3项可测性缺口，已记录；整体可进入下一阶段。',
        conclusion: '通过',
      },
      rollback: '无',
    });
    const r = validateWorkflowAgentStructuredReply({
      raw: passJson,
      transportReason: 'empty',
      actorRoleName: '测试',
      directPredecessorDeliverables: '- 交付物-产品经理/需求终稿.md',
    });
    expect(r.ok).toBe(true);
    expect(r.issues ?? []).not.toContain('input_validation_targets_not_direct_predecessors');
  });
});

describe('office logic risk review — 工作流调度 / 回滚', () => {
  it('技术 failed 不得打开 on_failure；仅业务 completed+failure 打开', () => {
    const technical: Pick<NodeRunRecord, 'status' | 'edgeOutcome'> = {
      status: 'failed',
      edgeOutcome: 'failure',
    };
    const business: Pick<NodeRunRecord, 'status' | 'edgeOutcome'> = {
      status: 'completed',
      edgeOutcome: 'failure',
    };
    expect(nodeRunTriggersFailureEdge(technical)).toBe(false);
    expect(nodeRunTriggersFailureEdge(business)).toBe(true);
  });

  it('仅 on_failure 入边节点 pending+reworkGeneration 时 incomingReady 短路为 true', () => {
    const nodes: WorkflowNode[] = [
      { id: 'n-dev', roleId: 'dev', title: '开发', execution: 'serial' },
      { id: 'n-test', roleId: 'test', title: '测试', execution: 'serial' },
    ];
    const edges = [
      { from: 'n-test', to: 'n-dev', when: 'on_failure' as const },
    ];
    const runs = new Map<string, NodeRunRecord>([
      ['n-dev', { nodeId: 'n-dev', agentId: 'dev', status: 'pending', reworkGeneration: 1 }],
      ['n-test', { nodeId: 'n-test', agentId: 'test', status: 'completed', edgeOutcome: 'success' }],
    ]);
    const edgeList = workflowEdgeList(nodes, edges);
    expect(incomingReady('n-dev', edgeList, runs)).toBe(true);
  });
});
