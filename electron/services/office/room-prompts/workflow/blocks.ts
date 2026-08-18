/** Workflow 模式 · 项目群聊规则（工作流步骤、依赖、交接）。 */

export const WORKFLOW_MODE_IDENTITY =
  '【模式边界·Workflow】任务推进=预置 DAG + runner 自动执行/回流子任务；群聊=信息同步，非必需不 @。用户在项目群发言（无论是否 @、@ 谁）统一由协调者 LLM 判定并回复；成员不直接响应用户，需续跑时由 runner 接续。与 Smart（群聊点名唯一驱动）严格不同。';

export const WORKFLOW_FAST_ACK_RULE =
  '【极速确认】系统已发「收到，待我思考下」；本条须按步骤/依赖实质答复，禁止占位 ack。';

export const WORKFLOW_DISCUSSION_RULES =
  '【群聊·辅助】任务推进以工作流 DAG 为准：依赖满足后 runner 自动指派下一批节点并在节点会话执行；群聊仅公示进度与用户介入，不靠 Agent 群 @ 派活。';

export const WORKFLOW_COORDINATION_RULE =
  '【协调者·监督】按 nodeRuns/步骤掌握全局；runner 自动派下一批节点，群聊勿重复 @ 派活。';

export const WORKFLOW_COORDINATOR_MENTION_AUDIT_RULE =
  '【监督】成员需某角色参与却未正确 @ 时，协调者可在群聊说明，勿替代 runner 指派节点。';

export const WORKFLOW_MENTION_AT_FORMAT_RULE =
  '【@格式】@ 须与成员显示名完全一致（如 @测试）；禁止 @测试角色。';

export const WORKFLOW_MENTION_CHINESE_RULE =
  '【中文】群聊回复须中文，禁止英文思考过程、NO_REPLY、optional 等内部推理泄漏。';

export const WORKFLOW_MENTION_COMPLETE_BEFORE_PUBLISH_RULE =
  '【先完成后发群】须完成本步骤交付后再写【群聊回复】；详情写入文件；【交付产物】写绝对路径+关键信息（本段≤200字含路径）；群聊信息正文仅关键摘要（去路径≤500字）。';

import { WORKFLOW_MENTION_PROGRESS_REPLY_RULE } from '../../../../../src/lib/office-room-progress-rules';

export { WORKFLOW_MENTION_PROGRESS_REPLY_RULE };

export const WORKFLOW_MENTION_RULES_BLOCK = [
  WORKFLOW_MODE_IDENTITY,
  WORKFLOW_DISCUSSION_RULES,
  WORKFLOW_FAST_ACK_RULE,
  WORKFLOW_MENTION_PROGRESS_REPLY_RULE,
  WORKFLOW_MENTION_CHINESE_RULE,
  WORKFLOW_MENTION_COMPLETE_BEFORE_PUBLISH_RULE,
  WORKFLOW_COORDINATION_RULE,
  WORKFLOW_MENTION_AT_FORMAT_RULE,
].join('\n');

/** Workflow 节点执行（非群 @ 点名）须实质输出。 */
export const WORKFLOW_AGENT_NO_FAST_ACK_RULE =
  '【节点执行】禁止仅占位 ack；须按步骤交付或说明阻塞。';
