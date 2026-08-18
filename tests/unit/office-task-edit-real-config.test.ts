import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildTaskEditFormStateFromProject,
  computeTaskEditDirty,
  explainTaskEditDirty,
  explainTaskEditSaveDisabled,
} from '@/lib/office-task-edit-form';
import { taskCreateFormFromGroup } from '@/components/office/TaskCreateDialog';
import { previewDagWorkflow } from '@/lib/office-workflow-preview';
import { orchestrationChangedFromBaseline } from '@/lib/office-workflow-preview-state';
import { orchestrationBaselineSnapshot } from '@/lib/office-orchestration-baseline';
import { isFixedGroupSpawnedProject } from '@/lib/office-fixed-group';
import { projectShowsArchivedRestartBadge } from '@/lib/office-project-source-badge';
import {
  emptyWorkflowStepDraftRow,
  normalizeWorkflowStepDraftRows,
} from '@/lib/office-workflow-step-drafts';
import { projectMembersFromIds } from '@/lib/office-project-members';
import type { OfficeFixedGroup, OfficeTempProject } from '@/types/office';

// Developer-local diagnostic fixture: reads a real machine-specific data store.
// On CI / other machines the file (or the specific group) is absent, so the whole
// suite self-skips instead of crashing at import time.
type RealConfigData = {
  fixedGroups: OfficeFixedGroup[];
  tempProjects: OfficeTempProject[];
};

const dataOpt: RealConfigData | null = (() => {
  try {
    return JSON.parse(
      readFileSync('/Users/lixingwei/.openclaw/office/data.json', 'utf8'),
    ) as RealConfigData;
  } catch {
    return null;
  }
})();

const DEV_GROUP_OPT = dataOpt?.fixedGroups.find(
  (g) => g.id === 'group-1782981131621-ezcr9v',
);
const hasRealConfig = Boolean(dataOpt && DEV_GROUP_OPT);

function simulateInsertTestStepBeforeSummary(
  baseRows: ReturnType<typeof normalizeWorkflowStepDraftRows>,
) {
  const rows = structuredClone(baseRows);
  rows.push(emptyWorkflowStepDraftRow());
  const summaryRow = rows[5]!;
  rows[6] = { ...summaryRow, agentIds: [...summaryRow.agentIds] };
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

import { canEditProjectMembers } from '../../src/lib/office-task-edit-form';

function editFlags(
  project: OfficeTempProject,
  group: { id: string } | null = null,
) {
  return {
    archivedRestartLocked: projectShowsArchivedRestartBadge(project),
    canEditMembers: canEditProjectMembers(project, { parentGroup: group }),
    executionModeLocked: isFixedGroupSpawnedProject(project, group),
    orchestrationModeLocked: true,
  };
}

describe.skipIf(!hasRealConfig)('office-task-edit with real ~/.openclaw/office/data.json', () => {
  // Safe fallbacks so test collection never crashes when the fixture is absent
  // (the suite is skipped via skipIf, but describe callbacks still run at collection).
  const data: RealConfigData = dataOpt ?? { fixedGroups: [], tempProjects: [] };
  const DEV_GROUP =
    DEV_GROUP_OPT ?? ({ id: '', agentIds: [], coordinatorAgentId: '' } as OfficeFixedGroup);
  const agents = DEV_GROUP.agentIds.map((id) => ({ id, name: id }));

  it('软件开发组派出项目（模拟）预览后 save 应可用', async () => {
    const spawnProject: OfficeTempProject = {
      id: 'project-real-spawn-sim',
      title: '测试派出',
      origin: 'fixed_group',
      parentGroupId: DEV_GROUP.id,
      inheritsGroupTemplate: true,
      agentIds: [...DEV_GROUP.agentIds],
      coordinatorAgentId: DEV_GROUP.coordinatorAgentId,
      executionMode: 'workflow',
      workflowEngine: 'dag',
      workflowOrchestrationMode: 'rule',
      workflow: { mode: 'dag', nodes: [], edges: [] },
      featureDescription: '功能描述',
      description: '',
      status: 'draft',
    };

    const members = projectMembersFromIds(spawnProject.agentIds, () => undefined);
    let form = buildTaskEditFormStateFromProject(spawnProject, DEV_GROUP);
    form.workflowStepDrafts = simulateInsertTestStepBeforeSummary(form.workflowStepDrafts);

    const orchestrationBaseline = orchestrationBaselineSnapshot({
      orchestrationMode: form.workflowOrchestrationMode,
      heuristicDescription: form.heuristicWorkflowDescription,
      workflowStepDrafts: buildTaskEditFormStateFromProject(spawnProject, DEV_GROUP).workflowStepDrafts,
    });

    const preview = await previewDagWorkflow({
      orchestrationMode: 'rule',
      workflowStepDrafts: form.workflowStepDrafts,
      heuristicDescription: form.heuristicWorkflowDescription,
      workflow: form.workflow,
      members,
      agentIds: spawnProject.agentIds,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    form = { ...form, workflow: preview.workflow };

    const params = {
      form,
      project: spawnProject,
      group: DEV_GROUP,
      memberAgentIds: spawnProject.agentIds,
      memberCoordinatorId: spawnProject.coordinatorAgentId,
      lookup: () => undefined,
      ...editFlags(spawnProject, DEV_GROUP),
    };

    expect(explainTaskEditDirty(params)).toMatchObject({
      stepDrafts: true,
      workflow: true,
    });
    expect(computeTaskEditDirty(params)).toBe(true);
    expect(
      orchestrationChangedFromBaseline(
        {
          orchestrationMode: form.workflowOrchestrationMode,
          workflowStepDrafts: form.workflowStepDrafts,
          heuristicDescription: form.heuristicWorkflowDescription,
        },
        orchestrationBaseline,
      ),
    ).toBe(true);
    expect(
      explainTaskEditSaveDisabled({
        ...params,
        previewBusy: false,
        displayAgentIds: DEV_GROUP.agentIds,
      }).reasons,
    ).toEqual([]);
  });

  it('TaskCreate 派出表单：预览后创建按钮不应因 dirty 阻塞（无 dirty 检查）', async () => {
    const createForm = taskCreateFormFromGroup(DEV_GROUP, agents, {
      title: '派出测试',
      featureDescription: '功能描述',
    });
    const members = projectMembersFromIds(createForm.agentIds, () => undefined);
    let form = {
      ...createForm,
      workflowStepDrafts: simulateInsertTestStepBeforeSummary(createForm.workflowStepDrafts),
    };

    const preview = await previewDagWorkflow({
      orchestrationMode: 'rule',
      workflowStepDrafts: form.workflowStepDrafts,
      heuristicDescription: form.heuristicWorkflowDescription,
      workflow: form.workflow,
      members,
      agentIds: form.agentIds,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    form = { ...form, workflow: preview.workflow };

    const createBlocked =
      !form.title.trim()
      || !form.featureDescription.trim()
      || form.agentIds.length === 0;
    expect(createBlocked).toBe(false);
  });

  it('data.json 中尚无软件开发组派出项目', () => {
    const spawned = data.tempProjects.filter((p) => p.parentGroupId === DEV_GROUP.id);
    expect(spawned).toHaveLength(0);
  });
});
