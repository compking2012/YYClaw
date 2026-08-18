import { describe, expect, it } from 'vitest';
import {
  enrichWorkflowGenerationStepUserCheckpoint,
  inferUserCheckpointFromStepText,
  stripUserCheckpointCueClauses,
} from '@/lib/office-workflow-user-checkpoint-infer';
import {
  buildHeuristicWorkflowDraft,
  generateWorkflowFromDescriptionHeuristic,
  parseWorkflowGenerationDraft,
} from '@/lib/office-workflow-generate';

describe('office-workflow-user-checkpoint-infer', () => {
  it('detects explicit manual review cues', () => {
    expect(inferUserCheckpointFromStepText('PM编写PRD，此步需要人工审核')).toBe(true);
    expect(inferUserCheckpointFromStepText('测试验收；此步人工干预')).toBe(true);
    expect(inferUserCheckpointFromStepText('发布前需用户确认')).toBe(true);
    expect(inferUserCheckpointFromStepText('开发实现功能')).toBe(false);
  });

  it('strips checkpoint cue clauses from action text', () => {
    expect(stripUserCheckpointCueClauses('编写测试报告，此步需要人工审核')).toBe('编写测试报告');
  });

  it('buildHeuristicWorkflowDraft enables userCheckpoint for matching steps', () => {
    const roles = [{ agentId: 'pm', displayName: 'PM', id: 'pm', name: 'PM' }];
    const draft = buildHeuristicWorkflowDraft(
      '1.PM编写PRD\n2.测试验收，此步需要人工校验',
      roles,
    );
    expect(draft?.steps[1]?.userCheckpoint).toBe(true);
    expect(draft?.steps[0]?.userCheckpoint).toBeFalsy();

    const result = generateWorkflowFromDescriptionHeuristic(
      '1.PM编写PRD\n2.测试验收，此步需要人工校验',
      roles,
    );
    expect(result?.workflow.nodes[1]?.userCheckpoint).toBe(true);
    expect(result?.workflow.nodes[0]?.userCheckpoint).toBeFalsy();
  });

  it('parseWorkflowGenerationDraft infers userCheckpoint when model omits the flag', () => {
    const draft = parseWorkflowGenerationDraft({
      mode: 'dag',
      steps: [
        {
          who: 'PM',
          action: '编写PRD',
          output: null,
          roleNames: ['PM'],
        },
        {
          who: '测试',
          action: '验收发布，此步需要人工审核',
          output: null,
          roleNames: ['测试'],
        },
      ],
    });
    expect(draft?.steps[1]?.userCheckpoint).toBe(true);
    expect(draft?.steps[1]?.action).toBe('验收发布');
  });

  it('honors explicit userCheckpoint from AI JSON', () => {
    const step = enrichWorkflowGenerationStepUserCheckpoint({
      who: 'PM',
      action: '评审方案',
      roleNames: ['PM'],
      userCheckpoint: true,
      title: '评审',
    });
    expect(step.userCheckpoint).toBe(true);
  });
});
