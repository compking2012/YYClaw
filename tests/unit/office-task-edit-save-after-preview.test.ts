import { describe, expect, it } from 'vitest';
import { previewDagWorkflow } from '@/lib/office-workflow-preview';
import {
  buildTaskEditFormStateFromProject,
  computeTaskEditDirty,
  explainTaskEditDirty,
  explainTaskEditSaveDisabled,
  isTaskEditSaveDisabled,
  projectWorkflowForForm,
  taskEditDialogFlags,
  type TaskEditFormState,
} from '@/lib/office-task-edit-form';
import { displayAgentsForProject } from '@/lib/office-task-workflow';
import { projectMembersFromIds } from '@/lib/office-project-members';
import {
  emptyWorkflowStepDraftRow,
  normalizeWorkflowStepDraftRows,
  validateWorkflowStepDraftRows,
} from '@/lib/office-workflow-step-drafts';
import type { OfficeFixedGroup, OfficeTempProject, WorkflowStepDraftRow } from '@/types/office';

/** 软件开发组真实模板（6 行 rule 步骤 + 6 节点 DAG） */
const DEV_GROUP_STEP_DRAFTS: WorkflowStepDraftRow[] = [
  {
    input: '',
    agentIds: ['chan-pin-jing-li'],
    task: '做产品设计',
    output: '产品设计初稿',
    linkMode: 'serial',
    rollbackEnabled: false,
    rollbackCondition: '',
    maxRuntimeMinutes: 30,
    userCheckpoint: false,
  },
  {
    input: '',
    agentIds: ['ruan-jian-ce-shi', 'ruan-jian-kai-fa'],
    task: '对产品设计初稿进行评审',
    output: '评审记录',
    linkMode: 'serial',
    rollbackEnabled: false,
    rollbackCondition: '',
    maxRuntimeMinutes: 30,
    userCheckpoint: false,
  },
  {
    input: '',
    agentIds: ['chan-pin-jing-li'],
    task: '针对评审记录做产品设计终稿',
    output: '产品设计终稿',
    linkMode: 'serial',
    rollbackEnabled: false,
    rollbackCondition: '',
    maxRuntimeMinutes: 30,
    userCheckpoint: false,
  },
  {
    input: '',
    agentIds: ['ruan-jian-ce-shi'],
    task: '编写测试用例',
    output: '测试用例',
    linkMode: 'serial',
    rollbackEnabled: false,
    rollbackCondition: '',
    maxRuntimeMinutes: 30,
    userCheckpoint: false,
  },
  {
    input: '',
    agentIds: ['ruan-jian-kai-fa'],
    task: '开发实现',
    output: '可执行的软件',
    linkMode: 'parallel',
    rollbackEnabled: false,
    rollbackCondition: '',
    maxRuntimeMinutes: 30,
    userCheckpoint: false,
    parallelWithStep: 4,
  },
  {
    input: '',
    agentIds: ['chan-pin-jing-li'],
    task: '做项目总结',
    output: '项目总结文档',
    linkMode: 'serial',
    rollbackEnabled: false,
    rollbackCondition: '',
    maxRuntimeMinutes: 30,
    userCheckpoint: false,
  },
];

const DEV_GROUP_WORKFLOW = {
  mode: 'dag' as const,
  nodes: [
    { id: 'gen-0', agentId: 'chan-pin-jing-li', title: '做产品设计', execution: 'serial' as const, maxRuntimeMinutes: 30 },
    { id: 'gen-1', agentId: 'ruan-jian-ce-shi', agentIds: ['ruan-jian-ce-shi', 'ruan-jian-kai-fa'], title: '评审', execution: 'serial' as const, maxRuntimeMinutes: 30 },
    { id: 'gen-2', agentId: 'chan-pin-jing-li', title: '针对评审记录', execution: 'serial' as const, maxRuntimeMinutes: 30 },
    { id: 'gen-3', agentId: 'ruan-jian-ce-shi', title: '编写测试用例', execution: 'serial' as const, maxRuntimeMinutes: 30, parallelGroup: 'pg-3' },
    { id: 'gen-4', agentId: 'ruan-jian-kai-fa', title: '开发实现', execution: 'serial' as const, maxRuntimeMinutes: 30, parallelGroup: 'pg-3' },
    { id: 'gen-5', agentId: 'chan-pin-jing-li', title: '做项目总结', execution: 'serial' as const, maxRuntimeMinutes: 30 },
  ],
  edges: [
    { from: 'gen-0', to: 'gen-1', when: 'on_success' as const },
    { from: 'gen-1', to: 'gen-2', when: 'on_success' as const },
    { from: 'gen-2', to: 'gen-3', when: 'on_success' as const },
    { from: 'gen-2', to: 'gen-4', when: 'on_success' as const },
    { from: 'gen-3', to: 'gen-5', when: 'on_success' as const },
    { from: 'gen-4', to: 'gen-5', when: 'on_success' as const },
  ],
  edgesCustomized: true,
};

const DEV_GROUP: OfficeFixedGroup = {
  id: 'group-1782981131621-ezcr9v',
  name: '软件开发组',
  description: '',
  agentIds: ['chan-pin-jing-li', 'ruan-jian-ce-shi', 'ruan-jian-kai-fa', 'pm'],
  coordinatorAgentId: 'pm',
  executionMode: 'workflow',
  workflow: DEV_GROUP_WORKFLOW,
  workflowStepDrafts: DEV_GROUP_STEP_DRAFTS,
  workflowOrchestrationMode: 'rule',
  updatedAt: 1782981131622,
};

const SPAWNED_PROJECT: OfficeTempProject = {
  id: 'project-spawn-test',
  title: '五子棋开发',
  featureDescription: '开发一个五子棋游戏',
  description: '',
  origin: 'fixed_group',
  parentGroupId: DEV_GROUP.id,
  inheritsGroupTemplate: true,
  agentIds: [...DEV_GROUP.agentIds],
  coordinatorAgentId: DEV_GROUP.coordinatorAgentId,
  executionMode: 'workflow',
  workflowEngine: 'dag',
  workflowOrchestrationMode: 'rule',
  workflow: { mode: 'dag', nodes: [], edges: [] },
  workflowStepDrafts: structuredClone(DEV_GROUP_STEP_DRAFTS),
  status: 'draft',
  updatedAt: Date.now(),
};

const members = projectMembersFromIds(SPAWNED_PROJECT.agentIds, () => undefined);

function dirtyParams(form: TaskEditFormState) {
  const flags = taskEditDialogFlags(SPAWNED_PROJECT, DEV_GROUP);
  return {
    form,
    project: SPAWNED_PROJECT,
    group: DEV_GROUP,
    memberAgentIds: SPAWNED_PROJECT.agentIds,
    memberCoordinatorId: SPAWNED_PROJECT.coordinatorAgentId,
    lookup: () => undefined,
    ...flags,
  };
}

function saveDisabledParams(form: TaskEditFormState, previewBusy = false) {
  const displayAgents = displayAgentsForProject(SPAWNED_PROJECT, DEV_GROUP);
  return {
    ...dirtyParams(form),
    previewBusy,
    displayAgentIds: displayAgents.agentIds,
  };
}

/** 用户操作：添加第 7 行 → 复制第 6 行到第 7 行 → 修改第 6 行为测试验证 */
function simulateInsertTestStepBeforeSummary(
  baseRows: WorkflowStepDraftRow[],
  copyAgentIds: boolean,
): WorkflowStepDraftRow[] {
  const rows = structuredClone(baseRows);
  rows.push(emptyWorkflowStepDraftRow());
  const summaryRow = rows[5]!;
  rows[6] = {
    ...summaryRow,
    agentIds: copyAgentIds ? [...summaryRow.agentIds] : [],
  };
  rows[5] = {
    ...summaryRow,
    task: '测试验证',
    output: '测试报告',
    agentIds: ['ruan-jian-ce-shi'],
    linkMode: 'serial',
    parallelWithStep: undefined,
  };
  return normalizeWorkflowStepDraftRows(rows);
}

describe('office-task-edit save after preview (软件开发组派出项目)', () => {
  it('打开编辑对话框时 dirty=false，保存应禁用', () => {
    const form = buildTaskEditFormStateFromProject(SPAWNED_PROJECT, DEV_GROUP);
    expect(computeTaskEditDirty(dirtyParams(form))).toBe(false);
    expect(isTaskEditSaveDisabled(saveDisabledParams(form))).toBe(true);
  });

  it('插入测试步骤后 dirty=true，预览前保存应可用', () => {
    const form = buildTaskEditFormStateFromProject(SPAWNED_PROJECT, DEV_GROUP);
    form.workflowStepDrafts = simulateInsertTestStepBeforeSummary(
      form.workflowStepDrafts,
      true,
    );
    expect(computeTaskEditDirty(dirtyParams(form))).toBe(true);
    expect(isTaskEditSaveDisabled(saveDisabledParams(form))).toBe(false);
  });

  it('预览成功后 dirty 仍为 true，保存应可用（完整复制含 agentIds）', async () => {
    const form = buildTaskEditFormStateFromProject(SPAWNED_PROJECT, DEV_GROUP);
    form.workflowStepDrafts = simulateInsertTestStepBeforeSummary(
      form.workflowStepDrafts,
      true,
    );

    const validation = validateWorkflowStepDraftRows(
      form.workflowStepDrafts,
      SPAWNED_PROJECT.agentIds,
      { minValidRows: 1 },
    );
    expect(validation.ok).toBe(true);

    const preview = await previewDagWorkflow({
      orchestrationMode: 'rule',
      workflowStepDrafts: form.workflowStepDrafts,
      heuristicDescription: form.heuristicWorkflowDescription,
      workflow: form.workflow,
      members,
      agentIds: SPAWNED_PROJECT.agentIds,
      coordinatorAgentId: SPAWNED_PROJECT.coordinatorAgentId,
      taskTitle: form.title,
      featureDescription: form.featureDescription,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const afterPreview: TaskEditFormState = {
      ...form,
      workflow: preview.workflow,
    };

    expect(afterPreview.workflow.nodes.length).toBe(7);
    const dirtyBreakdown = explainTaskEditDirty(dirtyParams(afterPreview));
    expect(dirtyBreakdown.stepDrafts).toBe(true);
    expect(dirtyBreakdown.workflow).toBe(true);
    expect(computeTaskEditDirty(dirtyParams(afterPreview))).toBe(true);
    expect(explainTaskEditSaveDisabled(saveDisabledParams(afterPreview)).reasons).toEqual([]);
    expect(isTaskEditSaveDisabled(saveDisabledParams(afterPreview))).toBe(false);
  });

  it('预览成功后 workflow JSON 与组模板 6 节点不同', async () => {
    const form = buildTaskEditFormStateFromProject(SPAWNED_PROJECT, DEV_GROUP);
    form.workflowStepDrafts = simulateInsertTestStepBeforeSummary(
      form.workflowStepDrafts,
      true,
    );
    const preview = await previewDagWorkflow({
      orchestrationMode: 'rule',
      workflowStepDrafts: form.workflowStepDrafts,
      heuristicDescription: form.heuristicWorkflowDescription,
      workflow: form.workflow,
      members,
      agentIds: SPAWNED_PROJECT.agentIds,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const baseline = projectWorkflowForForm(SPAWNED_PROJECT, DEV_GROUP);
    expect(JSON.stringify(preview.workflow)).not.toBe(JSON.stringify(baseline));
    expect(preview.workflow.nodes.length).toBe(7);
    expect(baseline.nodes.length).toBe(6);
  });

  it('整表回滚到打开对话框时的初始状态时 dirty=false（保存禁用）', async () => {
    const initialForm = buildTaskEditFormStateFromProject(SPAWNED_PROJECT, DEV_GROUP);
    let form = {
      ...initialForm,
      workflowStepDrafts: simulateInsertTestStepBeforeSummary(
        initialForm.workflowStepDrafts,
        true,
      ),
    };
    const preview = await previewDagWorkflow({
      orchestrationMode: 'rule',
      workflowStepDrafts: form.workflowStepDrafts,
      heuristicDescription: form.heuristicWorkflowDescription,
      workflow: form.workflow,
      members,
      agentIds: SPAWNED_PROJECT.agentIds,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    // 模拟整表被 reset 为 initForm（步骤表 + workflow 均回到组模板）
    form = { ...initialForm };

    expect(computeTaskEditDirty(dirtyParams(form))).toBe(false);
    expect(explainTaskEditSaveDisabled(saveDisabledParams(form)).reasons).toContain('notDirty');
  });

  it('stale onChange 只回滚步骤表、保留预览 workflow 时 dirty 仍为 true', async () => {
    const initialForm = buildTaskEditFormStateFromProject(SPAWNED_PROJECT, DEV_GROUP);
    const staleClosureForm = initialForm;

    let form = {
      ...initialForm,
      workflowStepDrafts: simulateInsertTestStepBeforeSummary(
        initialForm.workflowStepDrafts,
        true,
      ),
    };

    const preview = await previewDagWorkflow({
      orchestrationMode: 'rule',
      workflowStepDrafts: form.workflowStepDrafts,
      heuristicDescription: form.heuristicWorkflowDescription,
      workflow: form.workflow,
      members,
      agentIds: SPAWNED_PROJECT.agentIds,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    form = { ...staleClosureForm, workflow: preview.workflow };

    expect(explainTaskEditDirty(dirtyParams(form)).stepDrafts).toBe(false);
    expect(explainTaskEditDirty(dirtyParams(form)).workflow).toBe(true);
    expect(computeTaskEditDirty(dirtyParams(form))).toBe(true);
    expect(isTaskEditSaveDisabled(saveDisabledParams(form))).toBe(false);
  });

  it('featureDescription 为空时即使 dirty=true 保存仍禁用', () => {
    const form = buildTaskEditFormStateFromProject(SPAWNED_PROJECT, DEV_GROUP);
    form.workflowStepDrafts = simulateInsertTestStepBeforeSummary(
      form.workflowStepDrafts,
      true,
    );
    form.featureDescription = '';
    expect(computeTaskEditDirty(dirtyParams(form))).toBe(true);
    expect(explainTaskEditSaveDisabled(saveDisabledParams(form)).reasons).toContain(
      'emptyFeatureDescription',
    );
  });

  it('legacy stale closure case: 步骤表与 workflow 均回滚才禁用保存', async () => {
    const initialForm = buildTaskEditFormStateFromProject(SPAWNED_PROJECT, DEV_GROUP);
    const staleClosureForm = initialForm;

    let form = {
      ...initialForm,
      workflowStepDrafts: simulateInsertTestStepBeforeSummary(
        initialForm.workflowStepDrafts,
        true,
      ),
    };

    const preview = await previewDagWorkflow({
      orchestrationMode: 'rule',
      workflowStepDrafts: form.workflowStepDrafts,
      heuristicDescription: form.heuristicWorkflowDescription,
      workflow: form.workflow,
      members,
      agentIds: SPAWNED_PROJECT.agentIds,
      coordinatorAgentId: SPAWNED_PROJECT.coordinatorAgentId,
      taskTitle: form.title,
      featureDescription: form.featureDescription,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    // 预览成功后本应 functional update（{ ...form, workflow: preview.workflow }），
    // 但 onChange={({ workflow }) => setForm({ ...form, workflow })} 的 stale closure
    // 会用打开对话框时的组模板整体覆盖，步骤表与 workflow 均回退。
    form = { ...staleClosureForm };

    expect(computeTaskEditDirty(dirtyParams(form))).toBe(false);
    expect(isTaskEditSaveDisabled(saveDisabledParams(form))).toBe(true);
  });

  it('第 7 行缺 agentIds 时预览失败；补齐后预览成功且 dirty=true', async () => {
    let form = buildTaskEditFormStateFromProject(SPAWNED_PROJECT, DEV_GROUP);
    form.workflowStepDrafts = simulateInsertTestStepBeforeSummary(
      form.workflowStepDrafts,
      false,
    );

    const failPreview = await previewDagWorkflow({
      orchestrationMode: 'rule',
      workflowStepDrafts: form.workflowStepDrafts,
      heuristicDescription: form.heuristicWorkflowDescription,
      workflow: form.workflow,
      members,
      agentIds: SPAWNED_PROJECT.agentIds,
    });
    expect(failPreview.ok).toBe(false);

    form = {
      ...form,
      workflowStepDrafts: simulateInsertTestStepBeforeSummary(
        buildTaskEditFormStateFromProject(SPAWNED_PROJECT, DEV_GROUP).workflowStepDrafts,
        true,
      ),
    };

    const okPreview = await previewDagWorkflow({
      orchestrationMode: 'rule',
      workflowStepDrafts: form.workflowStepDrafts,
      heuristicDescription: form.heuristicWorkflowDescription,
      workflow: form.workflow,
      members,
      agentIds: SPAWNED_PROJECT.agentIds,
    });
    expect(okPreview.ok).toBe(true);
    if (!okPreview.ok) return;

    form = { ...form, workflow: okPreview.workflow };
    expect(isTaskEditSaveDisabled(saveDisabledParams(form))).toBe(false);
  });

  it('固定组步骤表同步更新为与表单一致后 stepDrafts dirty 消失，但 preview workflow 仍使 dirty=true', async () => {
    const form = buildTaskEditFormStateFromProject(SPAWNED_PROJECT, DEV_GROUP);
    form.workflowStepDrafts = simulateInsertTestStepBeforeSummary(
      form.workflowStepDrafts,
      true,
    );
    const preview = await previewDagWorkflow({
      orchestrationMode: 'rule',
      workflowStepDrafts: form.workflowStepDrafts,
      heuristicDescription: form.heuristicWorkflowDescription,
      workflow: form.workflow,
      members,
      agentIds: SPAWNED_PROJECT.agentIds,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const afterPreview = { ...form, workflow: preview.workflow };
    const syncedGroup = {
      ...DEV_GROUP,
      workflowStepDrafts: simulateInsertTestStepBeforeSummary(
        DEV_GROUP_STEP_DRAFTS,
        true,
      ),
    };
    const params = {
      ...dirtyParams(afterPreview),
      group: syncedGroup,
    };
    expect(explainTaskEditDirty(params).stepDrafts).toBe(false);
    expect(explainTaskEditDirty(params).workflow).toBe(true);
    expect(computeTaskEditDirty(params)).toBe(true);
  });
});
