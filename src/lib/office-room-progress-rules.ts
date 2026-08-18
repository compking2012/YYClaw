/** Workflow 模式 · 点名回复前须阅读的进展规则（嵌入进度上下文块）。 */
export const WORKFLOW_MENTION_PROGRESS_REPLY_RULE =
  '【Workflow·进展】推进以 DAG+runner 为准，群聊仅同步。先读步骤与镜像；开工前【输入校验】上游磁盘产物；交付前【输出校验】；须先完成本步再发【群聊回复】（禁口头承诺）。禁在群聊【分工】@指派下一节点（例外：【协作询问】@直接前驱补交付）。';

/** Smart 模式 · 点名回复前须阅读的进展规则。 */
export const SMART_MENTION_PROGRESS_REPLY_RULE =
  '【Smart·进展】以协调者本条点名为准；先读本任务群聊与已保存进展（笔记本无分工亦须执行点名要求）。仅当点名明确前置未就绪→@协调者说明阻塞；否则须完成交付并自测后再 @协调者汇报（禁进行中进度）。';

/** @deprecated 使用 {@link WORKFLOW_MENTION_PROGRESS_REPLY_RULE} */
export const ROOM_MENTION_PROGRESS_REPLY_RULE = WORKFLOW_MENTION_PROGRESS_REPLY_RULE;
