import { adminConsoleClient } from './centrifuge-client';

/**
 * 本地配置已写入磁盘、网关尚未 reload/restart 时，把完整 agents/models 快照推给 Manager，
 * 便于管理端在 C 端重启期间就展示最终 UI（不必等 gateway 再次 online 后的周期心跳）。
 */
export function notifyManagerConfigSnapshotBeforeGatewayReload(reason: string): void {
  void adminConsoleClient.publishConfigSnapshotToManager(reason);
}
