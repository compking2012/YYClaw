/**
 * 基于真实 DAG 项目（scripts/office-run-projects.mts · 软件开发团队队列）的 Workflow 自测。
 * 覆盖：图结构推进、并行层、角色目录交付物校验、GPGPU/五子棋/象棋典型节点 JSON。
 */
import { describe, expect, it } from 'vitest';
import { validateWorkflowAgentStructuredReply } from '../../electron/services/office/workflow-agent-reply';
import { roleScopedDeliverableDirName } from '../../src/lib/office-project-file-naming';
import {
  generateWorkflowFromDescriptionHeuristic,
} from '../../src/lib/office-workflow-generate';
import {
  incomingReady,
  nextRunnableNodes,
  workflowEdgeList,
} from '../../src/lib/office-workflow-schedule';
import { orderedWorkflowNodes, workflowVisualLayers } from '../../src/lib/office-workflow-visual';
import { buildWorkflowOutputExampleJson } from '../../src/lib/office-workflow-node-task-prompt';
import {
  workflowProjectRelativeInputLsForTargets,
  workflowProjectRelativeLsDirLine,
  workflowProjectRelativeLsLine,
} from '../../src/lib/office-workflow-task-prompt-shared';
import type { NodeRunRecord, OfficeRole, WorkflowDefinition, WorkflowNode } from '../../src/types/office';

/** scripts/office-run-projects.mts · DEV_TEAM_TASK_QUEUE */
export const DEV_TEAM_DAG_PROJECTS = [
  { id: 'task-1780146759230-5asb4j', title: '五子棋游戏开发' },
  { id: 'task-1780146825928-mw04mq', title: '象棋游戏开发' },
  { id: 'task-1780387975691-ex3qsm', title: 'Coding Agent工具' },
] as const;

/** 五子棋 / 象棋 Workflow 任务描述（8 步 · 含并行开发+测试用例设计） */
const GAME_DEV_DESCRIPTION = `1.PM编写项目预算，项目计划，组织全员kickoff，交付物为项目计划书;
2.产品经理撰写需求说明书初稿，交付物为需求说明书初稿；
3.产品+软件开发+测试三方一起并行评审需求说明书初稿，提出意见，交付物为评审意见；
4.产品针对大家反馈的意见进行修改并发布正式产品需求说明书，交付物为产品需求说明书正式版；
5.测试根据需求说明书进行测试用例编写，交付物为测试用例；
6.软件开发根据正式的需求说明书进行需求实现，交付物为可执行的游戏软件，与5并行;
7.在6完成之后，测试对开发的交付物进行测试验证，交付物为测试验收报告；
8.PM收到测试验收报告后，对项目进行总结，梳理交付物，交付物为可执行的游戏软件和测试验收报告`;

const STANDARD_GAME_ROLES: OfficeRole[] = [
  { id: 'pm', name: 'PM', agentId: 'a-pm', createdAt: 0, updatedAt: 0 },
  { id: 'product', name: '产品', agentId: 'a-product', createdAt: 0, updatedAt: 0 },
  { id: 'dev', name: '软件开发', agentId: 'a-dev', createdAt: 0, updatedAt: 0 },
  { id: 'qa', name: '测试', agentId: 'a-qa', createdAt: 0, updatedAt: 0 },
];

function wfPath(role: string, file: string): string {
  return `${roleScopedDeliverableDirName(role)}/${file}`;
}

function runsMap(nodes: WorkflowNode[]): Map<string, NodeRunRecord> {
  return new Map(
    nodes.map((n) => [
      n.id,
      {
        nodeId: n.id,
        roleId: n.roleId ?? n.roleIds?.[0] ?? 'unknown',
        status: 'pending' as const,
      },
    ]),
  );
}

function validateJson(
  json: Record<string, unknown>,
  actorRoleName: string,
): void {
  const r = validateWorkflowAgentStructuredReply({
    raw: JSON.stringify(json),
    transportReason: 'empty',
    actorRoleName,
  });
  expect(r.ok, r.ok ? undefined : r.detail).toBe(true);
}

function docStepJson(params: {
  role: string;
  stepIndex: number;
  totalSteps: number;
  stepTitle: string;
  fileBase: string;
  inputTargets?: string[];
  conclusion?: '通过' | '不通过' | '已交付';
}): Record<string, unknown> {
  const path = wfPath(params.role, `${params.fileBase}-${params.role}.md`);
  const inputTargets = params.inputTargets ?? [];
  return {
    role: params.role,
    step: { index: params.stepIndex, total: params.totalSteps, title: params.stepTitle },
    inputValidation: {
      targets: inputTargets,
      lsResult: workflowProjectRelativeInputLsForTargets(inputTargets),
    },
    execution: '已完成本步工作并落盘交付物。',
    outputValidation: {
      targets: [path],
      lsResult: [workflowProjectRelativeLsLine(path.replace(/^.*[/\\]/, ''))],
    },
    deliverable: {
      path,
      summary: `${params.stepTitle}关键结论已写入交付物文件。`,
      conclusion: params.conclusion ?? '已交付',
    },
    rollback: '无',
  };
}

function engineeringStepJson(params: {
  role: string;
  stepIndex: number;
  totalSteps: number;
  stepTitle: string;
  inputTargets: string[];
}): Record<string, unknown> {
  const dir = roleScopedDeliverableDirName(params.role);
  return {
    role: params.role,
    step: { index: params.stepIndex, total: params.totalSteps, title: params.stepTitle },
    inputValidation: {
      targets: params.inputTargets,
      lsResult: params.inputTargets.map((t) =>
        t === dir || t.startsWith('交付物-')
          ? workflowProjectRelativeLsDirLine(t.replace(/^.*[/\\]/, '').replace(/\/+$/, '') || t)
          : workflowProjectRelativeLsLine(t.replace(/^.*[/\\]/, '')),
      ),
    },
    execution: '已完成工程实现并落盘至交付目录。',
    outputValidation: {
      targets: [dir],
      lsResult: [workflowProjectRelativeLsDirLine(dir)],
    },
    deliverable: {
      path: dir,
      summary: '工程目录含 index.html 与静态资源，可本地打开运行。',
      conclusion: '已交付',
    },
    rollback: '无',
  };
}

describe('office-workflow DAG 项目 · 五子棋/象棋 8 步图', () => {
  const generated = generateWorkflowFromDescriptionHeuristic(
    GAME_DEV_DESCRIPTION,
    STANDARD_GAME_ROLES,
  );

  it('materializes 8-step DAG for dev-team game projects', () => {
    expect(generated).not.toBeNull();
    expect(generated!.workflow.mode).toBe('dag');
    expect(generated!.workflow.nodes).toHaveLength(8);
    expect(generated!.workflow.nodes.map((n) => n.title)).toEqual([
      '编写项目预算',
      '撰写需求说明书',
      '评审需求说明书',
      '改并发布正式产品',
      '测试用例编写',
      '需求实现',
      '测试验证',
      '总结，梳理交付物',
    ]);
  });

  it('exposes parallel layer: 测试用例编写 ∥ 需求实现', () => {
    const wf = generated!.workflow;
    const layers = workflowVisualLayers(wf);
    const parallel = layers.find((l) => l.parallel && l.nodes.length === 2);
    expect(parallel).toBeDefined();
    expect(parallel!.nodes.map((n) => n.title).sort()).toEqual(['测试用例编写', '需求实现'].sort());
  });

  it('unlocks 测试验证 only after 需求实现 completes', () => {
    const wf = generated!.workflow;
    const runs = runsMap(wf.nodes);
    const edges = workflowEdgeList(wf.nodes, wf.edges);
    const devNode = wf.nodes.find((n) => n.title === '需求实现')!;
    const qaAcceptNode = wf.nodes.find((n) => n.title === '测试验证')!;
    const testDesignNode = wf.nodes.find((n) => n.title === '测试用例编写')!;

    runs.set(testDesignNode.id, { ...runs.get(testDesignNode.id)!, status: 'completed' });
    expect(incomingReady(qaAcceptNode.id, edges, runs)).toBe(false);

    runs.set(devNode.id, { ...runs.get(devNode.id)!, status: 'completed' });
    expect(incomingReady(qaAcceptNode.id, edges, runs)).toBe(true);
  });

  it('simulates kickoff → … → 测试验收 along DAG edges', () => {
    const wf = generated!.workflow;
    const runs = runsMap(wf.nodes);
    const order: string[] = [];
    const edges = workflowEdgeList(wf.nodes, wf.edges);

    for (let guard = 0; guard < 20; guard += 1) {
      const batch = nextRunnableNodes(wf.nodes, edges, runs);
      if (batch.length === 0) break;
      for (const node of batch) {
        order.push(node.title ?? node.id);
        runs.set(node.id, {
          ...runs.get(node.id)!,
          status: 'completed',
          completedAt: Date.now(),
          edgeOutcome: 'success',
        });
      }
    }

    expect(order[0]).toBe('编写项目预算');
    expect(order).toContain('撰写需求说明书');
    expect(order).toContain('需求实现');
    expect(order).toContain('测试用例编写');
    const devIdx = order.indexOf('需求实现');
    const qaIdx = order.indexOf('测试验证');
    expect(devIdx).toBeGreaterThan(-1);
    expect(qaIdx).toBeGreaterThan(devIdx);
  });
});

describe('office-workflow DAG 项目 · 五子棋典型节点 JSON', () => {
  const total = 8;

  it('PM 项目启动 JSON 通过校验', () => {
    validateJson(
      docStepJson({
        role: 'PM',
        stepIndex: 1,
        totalSteps: total,
        stepTitle: '项目启动',
        fileBase: '项目启动',
        conclusion: '已交付',
      }),
      'PM',
    );
  });

  it('产品 需求初稿 JSON 通过校验', () => {
    validateJson(
      docStepJson({
        role: '产品',
        stepIndex: 2,
        totalSteps: total,
        stepTitle: '需求初稿',
        fileBase: '需求初稿',
        inputTargets: [wfPath('PM', '项目启动-PM.md')],
      }),
      '产品',
    );
  });

  it('软件开发 开发实现 JSON（交付物-开发/ 目录）通过校验', () => {
    validateJson(
      engineeringStepJson({
        role: '软件开发',
        stepIndex: 6,
        totalSteps: total,
        stepTitle: '开发实现',
        inputTargets: ['需求说明书-产品.md', roleScopedDeliverableDirName('测试')],
      }),
      '软件开发',
    );
  });

  it('测试 测试验收 JSON 通过校验', () => {
    validateJson(
      docStepJson({
        role: '测试',
        stepIndex: 7,
        totalSteps: total,
        stepTitle: '测试验收',
        fileBase: '测试验收',
        inputTargets: [roleScopedDeliverableDirName('软件开发')],
        conclusion: '通过',
      }),
      '测试',
    );
  });

  it('buildWorkflowOutputExampleJson 与五子棋开发实现步一致', () => {
    const json = buildWorkflowOutputExampleJson({
      roleName: '软件开发',
      stepTitle: '开发实现',
      stepIndex: 6,
      totalSteps: 8,
      sampleDeliverable: roleScopedDeliverableDirName('软件开发'),
      sampleTargets: ['需求评审-测试.md'],
      sampleConclusion: '已交付',
    });
    validateJson(json as unknown as Record<string, unknown>, '软件开发');
    expect(json.deliverable.path).toBe(roleScopedDeliverableDirName('软件开发'));
    expect(json.outputValidation.targets).toEqual([roleScopedDeliverableDirName('软件开发')]);
  });
});

describe('office-workflow DAG 项目 · GPGPU 材料撰写', () => {
  const gpgpuRoles: OfficeRole[] = [
    { id: 'collector', name: '数据收集师', agentId: 'a-col', createdAt: 0, updatedAt: 0 },
    { id: 'writer', name: '报告撰写师', agentId: 'a-wri', createdAt: 0, updatedAt: 0 },
  ];

  const gpgpuWorkflow: WorkflowDefinition = {
    mode: 'dag',
    nodes: [
      { id: 'n-collect', roleId: 'collector', title: '数据搜集', execution: 'serial' },
      { id: 'n-write', roleId: 'writer', title: '撰写报告', execution: 'serial' },
    ],
    edges: [{ from: 'n-collect', to: 'n-write', when: 'on_success' }],
  };

  const GPGPU_FILE = 'GPGPU相关信息-数据收集师.md';

  it('GPGPU 线性 DAG：数据收集 → 报告撰写', () => {
    expect(orderedWorkflowNodes(gpgpuWorkflow).map((n) => n.title)).toEqual([
      '数据搜集',
      '撰写报告',
    ]);
    const runs = runsMap(gpgpuWorkflow.nodes);
    const edges = workflowEdgeList(gpgpuWorkflow.nodes, gpgpuWorkflow.edges);
    expect(nextRunnableNodes(gpgpuWorkflow.nodes, edges, runs)).toHaveLength(1);
    expect(nextRunnableNodes(gpgpuWorkflow.nodes, edges, runs)[0]?.roleId).toBe('collector');
    runs.set('n-collect', { ...runs.get('n-collect')!, status: 'completed' });
    expect(nextRunnableNodes(gpgpuWorkflow.nodes, edges, runs)[0]?.roleId).toBe('writer');
  });

  it('数据收集师节点 JSON（交付物-数据收集师/）通过校验', () => {
    const target = wfPath('数据收集师', GPGPU_FILE);
    const abs =
      `/Users/demo/.openclaw/workspace-pm/office/projects/国产GPGPU-task-demo/${target}`;
    validateJson(
      {
        role: '数据收集师',
        step: { index: 1, total: 6, title: '数据搜集' },
        inputValidation: { targets: [], lsResult: [] },
        execution: '已完成 GPGPU 权威资料搜集并落盘。',
        outputValidation: {
          targets: [target],
          lsResult: [`-rw-r--r-- 1 demo staff 12165 Jun 13 10:23 ${abs}`],
        },
        deliverable: {
          path: target,
          summary: '涵盖 GPGPU 发展史、国产挑战与行业数据，已写入 md 文件。',
          conclusion: '已交付',
        },
        rollback: '无',
      },
      '数据收集师',
    );
  });

  it('报告撰写师节点 JSON 引用上游 交付物-数据收集师/', () => {
    const upstream = wfPath('数据收集师', GPGPU_FILE);
    validateJson(
      docStepJson({
        role: '报告撰写师',
        stepIndex: 2,
        totalSteps: 6,
        stepTitle: '撰写报告',
        fileBase: '国产GPGPU芯片发展前景报告',
        inputTargets: [upstream],
        conclusion: '已交付',
      }),
      '报告撰写师',
    );
  });

  it('拒绝 GPGPU 场景下 target/ 与项目根路径', () => {
    const badRoot = validateWorkflowAgentStructuredReply({
      raw: JSON.stringify({
        role: '数据收集师',
        step: { index: 1, total: 6, title: '数据搜集' },
        inputValidation: { targets: [], lsResult: [] },
        execution: '已落盘。',
        outputValidation: {
          targets: [GPGPU_FILE],
          lsResult: [workflowProjectRelativeLsLine(GPGPU_FILE)],
        },
        deliverable: {
          path: GPGPU_FILE,
          summary: '错误：文件写在项目根而非 交付物-角色/ 目录。',
          conclusion: '已交付',
        },
        rollback: '无',
      }),
      transportReason: 'empty',
      actorRoleName: '数据收集师',
    });
    expect(badRoot.ok).toBe(false);

    const badTarget = validateWorkflowAgentStructuredReply({
      raw: JSON.stringify({
        role: '数据收集师',
        step: { index: 1, total: 6, title: '数据搜集' },
        inputValidation: { targets: [], lsResult: [] },
        execution: '已落盘。',
        outputValidation: {
          targets: [`target/${GPGPU_FILE}`],
          lsResult: [workflowProjectRelativeLsLine(GPGPU_FILE)],
        },
        deliverable: {
          path: `target/${GPGPU_FILE}`,
          summary: '错误：使用了 target/ 目录。',
          conclusion: '已交付',
        },
        rollback: '无',
      }),
      transportReason: 'empty',
      actorRoleName: '数据收集师',
    });
    expect(badTarget.ok).toBe(false);
    if (!badTarget.ok) {
      expect(badTarget.issues).toContain('deliverable_filename_missing_role_suffix');
    }
  });

  it('DEV_TEAM 项目 ID 与标题可用于 E2E 脚本对照', () => {
    expect(DEV_TEAM_DAG_PROJECTS.map((p) => p.title)).toContain('五子棋游戏开发');
    expect(DEV_TEAM_DAG_PROJECTS.map((p) => p.title)).toContain('象棋游戏开发');
    expect(gpgpuRoles.map((r) => r.name)).toEqual(['数据收集师', '报告撰写师']);
  });
});

describe('office-workflow DAG 项目 · 象棋 dev→qa→audit 回滚边', () => {
  const wf: WorkflowDefinition = {
    mode: 'dag',
    nodes: [
      { id: 'n-dev', roleId: 'dev', title: '开发实现', execution: 'serial' },
      { id: 'n-qa', roleId: 'qa', title: '测试验收', execution: 'serial' },
      { id: 'n-audit', roleId: 'audit', title: '安全审计', execution: 'serial' },
    ],
    edges: [
      { from: 'n-dev', to: 'n-qa', when: 'on_success' },
      { from: 'n-qa', to: 'n-audit', when: 'on_success' },
      { from: 'n-audit', to: 'n-dev', when: 'on_failure' },
    ],
  };

  it('审计不通过时 on_failure 边指向开发实现', () => {
    const auditFail = wf.edges.filter((e) => e.from === 'n-audit' && e.when === 'on_failure');
    expect(auditFail).toEqual([{ from: 'n-audit', to: 'n-dev', when: 'on_failure' }]);
  });

  it('审计步 JSON 校验上游 交付物-开发/ 与自身交付物路径', () => {
    validateJson(
      docStepJson({
        role: '审计',
        stepIndex: 3,
        totalSteps: 3,
        stepTitle: '安全审计',
        fileBase: '安全审计',
        inputTargets: [roleScopedDeliverableDirName('开发')],
        conclusion: '通过',
      }),
      '审计',
    );
  });
});
