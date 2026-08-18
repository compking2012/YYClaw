import { collectValidationPathsFromSections } from '@/lib/office-deliverable-ls-verify';
import {
  declaredDeliverablePathsFromSmartItems,
  declaredDeliverablePathsFromSmartMemberJson,
} from '@/lib/office-deliverable-disk-resolve';
import { collectSmartRoleDoneDeliverablePathHints } from '@/lib/office-smart-input-validation';
import {
  isSmartJsonShapeText,
  parseSmartCoordinatorJsonOutput,
  parseSmartMemberJsonOutput,
} from '@/lib/office-smart-json-schema';
import {
  resolveSmartNextExecutorRoleIds,
  resolveSmartPriorStepProducerRoleIds,
  type SmartWorkOrderStep,
} from '@/lib/office-smart-work-order';
import type { RoomMessage } from '@/types/office';

/** 【交付产物】无路径时的明示写法（与 mirror 校验一致）。 */
const DELIVERABLE_EXEMPT_RE =
  /^(?:无|暂无|不涉及|无新(?:交付|产出|文件)|沿用上次|验收通知|依赖未就绪)/iu;

export type SmartValidationScope = {
  /** 【输入校验】须附 ls 结果行的路径：上一跳（或协调者验收时的汇报）交付物 */
  inputPaths: string[];
  /** 【输出校验】须附 ls 结果行的路径：本轮【交付产物】声明的路径 */
  outputPaths: string[];
};

export function isSmartValidationSectionExempt(sectionText: string): boolean {
  return DELIVERABLE_EXEMPT_RE.test(sectionText.trim());
}

/**
 * 推断 Smart 点名回复中【输入校验】/【输出校验】须核验的路径范围。
 * - 协调者【输入校验】：成员汇报路径或下一执行者的上一跳交付物。
 * - 成员不做【输入校验】（inputPaths 恒为空）。
 * - 【输出校验】：仅本轮【交付产物】路径（无产出则为空）。
 */
export function resolveSmartValidationScope(params: {
  raw: string;
  viewerRoleId: string;
  steps: SmartWorkOrderStep[];
  roomMessages: RoomMessage[];
  taskId: string;
  isCoordinator?: boolean;
  /** 协调者处理成员汇报时的触发消息原始 JSON */
  memberReportRaw?: string;
}): SmartValidationScope {
  const raw = params.raw.trim();
  let deliverable = '';
  if (isSmartJsonShapeText(raw)) {
    const member = parseSmartMemberJsonOutput(raw);
    if (member) {
      deliverable = member.deliverable.items.join('\n');
    } else {
      const coord = parseSmartCoordinatorJsonOutput(raw);
      if (coord) {
        deliverable = coord.deliverable.items.join('\n');
      }
    }
  }
  const deliverableExempt =
    !deliverable.trim() || DELIVERABLE_EXEMPT_RE.test(deliverable.trim());
  const outputPaths = deliverableExempt
    ? []
    : declaredDeliverablePathsFromSmartItems(
        deliverable.split('\n').map((line) => line.trim()).filter(Boolean),
      );

  let inputPaths: string[] = [];

  if (params.isCoordinator) {
    if (params.memberReportRaw?.trim()) {
      inputPaths = declaredDeliverablePathsFromSmartMemberJson(params.memberReportRaw.trim());
      return { inputPaths, outputPaths: [] };
    } else {
      const nextRoleIds = resolveSmartNextExecutorRoleIds({
        steps: params.steps,
        roomMessages: params.roomMessages,
        taskId: params.taskId,
      });
      const anchorRoleId = nextRoleIds[0];
      if (anchorRoleId) {
        const priorProducers = resolveSmartPriorStepProducerRoleIds(anchorRoleId, params.steps);
        const pathSet = new Set<string>();
        for (const producerId of priorProducers) {
          for (const p of collectSmartRoleDoneDeliverablePathHints({
            roomMessages: params.roomMessages,
            taskId: params.taskId,
            roleId: producerId,
          })) {
            pathSet.add(p);
          }
        }
        inputPaths = [...pathSet];
      }
    }
  }

  return { inputPaths, outputPaths };
}

/** 无引擎上下文时的段落内推断（单测/缺 room 时）：输出仅看【交付产物】。 */
export function resolveSmartValidationScopeFromSectionsOnly(
  raw: string,
  options?: { forMember?: boolean },
): SmartValidationScope {
  if (isSmartJsonShapeText(raw)) {
    const member = parseSmartMemberJsonOutput(raw);
    if (member) {
      const deliverableExempt =
        member.deliverable.items.length === 0
        || member.deliverable.items.every((item) => DELIVERABLE_EXEMPT_RE.test(item.trim()));
      return {
        inputPaths: [],
        outputPaths: deliverableExempt
          ? []
          : declaredDeliverablePathsFromSmartItems(member.deliverable.items),
      };
    }
    const coord = parseSmartCoordinatorJsonOutput(raw);
    if (coord) {
      const deliverableExempt =
        coord.deliverable.items.length === 0
        || coord.deliverable.items.every((item) => DELIVERABLE_EXEMPT_RE.test(item.trim()));
      return {
        inputPaths: options?.forMember
          ? []
          : collectValidationPathsFromSections(coord.inputValidation),
        outputPaths: deliverableExempt
          ? []
          : declaredDeliverablePathsFromSmartItems(coord.deliverable.items),
      };
    }
  }
  return { inputPaths: [], outputPaths: [] };
}
