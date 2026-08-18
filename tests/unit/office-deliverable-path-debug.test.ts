import { describe, expect, it } from 'vitest';
import {
  validateSmartJsonDeliverableItems,
  validateSingleWorkflowRoleScopedPath,
  validateWorkflowRoleScopedDeliverablePaths,
} from '@/lib/office-deliverable-file-policy';
import {
  declaredDeliverablePathsFromWorkflowJson,
} from '@/lib/office-deliverable-disk-resolve';
import { collectDeliverablePathHintsFromText } from '@/lib/office-workflow-project-deliverable';
import { smartJsonToBracketText } from '@/lib/office-smart-json-schema';
import { validateSmartRoomJsonStructure } from '@/lib/office-smart-json-validate';
import { validateRoomMentionStructuredReply } from '../../electron/services/office/room-mention-structured-reply';

describe('role-scoped deliverable paths with spaces', () => {
  const role = 'AI-Agent工程专家';
  const item = '交付物-AI-Agent工程专家/AI Agent开发优秀方案与案例调研-AI-Agent工程专家.md';

  it('collects role-scoped paths with spaces in filename', () => {
    const deliverable = [
      '交付物-AI-Agent工程专家/AI Agent开发优秀方案与案例调研-AI-Agent工程专家.md',
      '关键摘要：见群聊回复',
    ].join('\n');
    const hints = collectDeliverablePathHintsFromText(deliverable);
    expect(hints).toContain(
      '交付物-AI-Agent工程专家/AI Agent开发优秀方案与案例调研-AI-Agent工程专家.md',
    );
  });

  it('accepts scoped deliverable path with spaces in filename', () => {
    expect(validateSingleWorkflowRoleScopedPath(item, role)).toBe(true);
    expect(validateSmartJsonDeliverableItems(role, [item])).toBe(true);
  });

  it('accepts full member end JSON when ls basename matches', () => {
    const json = {
      role,
      taskUnderstanding: '任务2：AI Agent开发优秀方案与案例调研，输出主流框架对比、5+成功案例、开发最佳实践，落盘至交付物-AI-Agent工程专家/',
      action: 'end',
      deliverable: {
        items: [item],
        outputValidation: [
          '-rw-r--r--  1 lixingwei  453037844  11640  6 23 18:20 AI Agent开发优秀方案与案例调研-AI-Agent工程专家.md',
        ],
      },
      roomReply:
        '**AI Agent开发优秀方案与案例调研-AI-Agent工程专家已完成**，文档已落盘至项目目录，覆盖LangChain、Microsoft Agent Framework等主流框架',
      dispatch: [{ role: 'AI-Agent开发专家', task: '请验收任务2交付。' }],
    };
    const raw = JSON.stringify(json);
    const r = validateSmartRoomJsonStructure(raw, {
      isCoordinator: false,
      actorRoleName: role,
    });
    expect(r.ok).toBe(true);

    const bracket = smartJsonToBracketText(json, false);
    const deliverableSection = bracket.match(/【交付产物】([\s\S]*?)(?=【|$)/)?.[1] ?? '';
    const outputSection = bracket.match(/【输出校验】([\s\S]*?)(?=【|$)/)?.[1] ?? '';
    const hints = collectDeliverablePathHintsFromText(deliverableSection, outputSection);
    expect(hints).toContain(item);
    for (const hint of hints) {
      expect(validateSingleWorkflowRoleScopedPath(hint, role), hint).toBe(true);
    }
    expect(validateWorkflowRoleScopedDeliverablePaths(role, deliverableSection, outputSection)).toBe(
      true,
    );

    const full = validateRoomMentionStructuredReply({
      raw,
      transportReason: 'empty',
      executionMode: 'smart',
      isCoordinator: false,
      actorRoleName: role,
      coordinatorRole: { id: 'ai-agent-kai-fa-zhuan-jia', name: 'AI-Agent开发专家' },
      teamRoles: [
        { agentId: 'ai-agent-kai-fa-zhuan-jia', displayName: 'AI-Agent开发专家' },
        { agentId: 'ai-agent-gong-cheng-zhuan-jia', displayName: 'AI-Agent工程专家' },
      ],
      smartMemberReadiness: 'ready',
    });
    expect(full.ok, !full.ok ? `${full.issues?.join(',')} ${full.detail}` : '').toBe(true);
  });

  it('ignores ls tail when mining paths from JSON-derived deliverable text', () => {
    const deliverable = [
      '路径：交付物-产品经理/需求设计-产品经理.md',
      '摘要：需求规格说明书初稿v0.1',
      '结论：已交付',
      '目标：交付物-产品经理/需求设计-产品经理.md',
      'ls：交付物-产品经理/需求设计-产品经理.md：-rw-r--r-- 1 lixingwei 453037844 9561 6 24 21:30 交付物-产品经理/需求设计-产品经理.md',
    ].join('\n');
    const hints = collectDeliverablePathHintsFromText(deliverable);
    expect(hints).toEqual(['交付物-产品经理/需求设计-产品经理.md']);
  });

  it('workflow json deliverable.path is the only disk verify path', () => {
    expect(
      declaredDeliverablePathsFromWorkflowJson({
        deliverable: { path: '交付物-产品经理/需求设计-产品经理.md' },
      }),
    ).toEqual(['交付物-产品经理/需求设计-产品经理.md']);
  });
});
