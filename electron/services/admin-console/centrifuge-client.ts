import { Centrifuge, SubscriptionState, type ConnectedContext, type Subscription } from 'centrifuge';
import WebSocket from 'ws';
import { existsSync, watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { getOpenClawConfigDir } from '../../utils/paths';
import { getSetting, setSetting } from '../../utils/store';
import { machineIdSync } from 'node-machine-id';
import { logger } from '../../utils/logger';
import {
  buildHeartbeatPayload,
  managerFacingLifecycleStatus,
  type BuildHeartbeatPayloadOptions,
} from './protocol/publishers';
import type {
  SessionHistoryRemoteAck,
  SessionHistoryRemoteRequest,
  SessionListRemoteAck,
  SessionListRemoteRequest,
  SessionSendRemoteAck,
  SessionSendRemoteRequest,
  SessionStatusRemoteAck,
  SessionStatusRemoteRequest,
  SharedWorkspaceSyncAck,
  SharedWorkspaceSyncRequest,
} from './session-send-remote';
import { buildDashboardSnapshot } from './dashboard-snapshot';
import { AdminConsoleTopics } from './protocol/topics';
import { handleAdminConsoleCommand } from './protocol/handlers';
import type { AdminConsoleCommand } from './protocol/commands';
import type { GatewayManager } from '../../gateway/manager';
import { awaitApplySyncExclusiveIdle, runApplySyncExclusive } from './clawx-apply-gateway-queue';
import { applyClawxSyncAction } from './remote-sync/apply-sync';
import type { ClawHubService } from '../../gateway/clawhub';
import { getAllSkillConfigs } from '../../utils/skill-config';
import { getProviderService } from '../providers/provider-service';
import { broadcastToRenderer } from '../../utils/broadcast-renderer';
import { removeServerMarketplaceSkillLocalInstall } from '../skills-marketplace-client';
import { purgeSkillFromAgentAllowlists } from '../../utils/agent-config';
import { withGatewayHotSkillFilesystem } from '../skills/skill-gateway-fs-guard';
import {
  adminSyncLagLog,
  adminSyncLagMarkClawxRpcReceived,
  adminSyncLagResetClawxRpcAnchor,
  adminSyncLagSetCorrelation,
} from './remote-sync/admin-sync-lag-log';
import { logCentrifugeError, logCentrifugeInfo } from './admin-console-log';
import {
  decorateChatSendParamsWithAdminSharedWorkspace,
  handleOfficeSharedWorkspaceRpc,
} from './office-shared-workspace';
import { farmHttpBaseToWsBase, isFarmEnabled, resolveFarmApiBaseUrl } from '../../utils/farm-api-base';

/** Emitted on the Centrifuge client when the server initiates an RPC (see patchCentrifugeServerToClientRpc). */
export type AdminConsoleCentrifugeRpcEvent = {
  commandId: number;
  method: string;
  data: unknown;
};

type CentrifugeIncomingReply = {
  id?: number;
  rpc?: {
    method?: string;
    data?: unknown;
  };
};

type SkillPublishReviewResult = {
  type?: string;
  request_type?: string;
  request_id?: number;
  status?: string;
  comments?: string;
  skill_id?: string;
  display_name?: string;
};

type WorkspaceSkillUnlistedEvent = {
  type?: string;
  skill_id?: string;
  display_name?: string;
  reason?: string;
};

type WorkspaceSkillListedEvent = {
  type?: string;
  action?: string;
  skill_id?: string;
  display_name?: string;
  version?: string;
  version_base?: string;
  archive_hash?: string;
  listing_revision?: string;
};

type CentrifugePrivate = {
  _handleReply: (reply: CentrifugeIncomingReply, next: () => void) => void;
  _callbacks: Record<number, unknown>;
  _transport?: { send: (data: string, session?: string, node?: string) => void } | null;
  _ws?: { send: (data: string) => void } | null;
  _session?: string;
  _node?: string;
};

const HEARTBEAT_INTERVAL_MS = 30_000;
/** While gateway lifecycle is not `online`, uplink more often so Manager sees `online` soon after restart. */
const HEARTBEAT_BURST_INTERVAL_MS = 2_500;
/** After `clawx_apply_sync`, poll until gateway lifecycle is `online` (debounced reload/restart finished), then uplink for Manager wait UI. */
const APPLY_SYNC_STABLE_POLL_MS = 2_000;
const APPLY_SYNC_STABLE_MAX_MS = 180_000;
const DASHBOARD_SNAPSHOT_DEBOUNCE_MS = 2_000;
const DASHBOARD_SNAPSHOT_SCAN_MS = 10_000;

/** Manager/browser allow ~90s for config RPCs; a flat 12s here caused `RPC timeout: config.get` during gateway restarts. */
const OPENCLAW_GATEWAY_CONFIG_RPC_TIMEOUT_MS = 90_000;
const OPENCLAW_GATEWAY_DEFAULT_RPC_TIMEOUT_MS = 12_000;
const ADMIN_CONSOLE_REMOTE_SESSION_RPC_TIMEOUT_MS = 150_000;

function openClawRpcGatewayTimeoutMs(method: string): number {
  const m = method.trim();
  if (
    m === 'config.get'
    || m === 'config.set'
    || m === 'config.patch'
    || m === 'config.apply'
  ) {
    return OPENCLAW_GATEWAY_CONFIG_RPC_TIMEOUT_MS;
  }
  return OPENCLAW_GATEWAY_DEFAULT_RPC_TIMEOUT_MS;
}

function normalizeCentrifugeRpcData(data: unknown): unknown {
  if (data == null) {
    return undefined;
  }
  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as unknown;
    } catch {
      return data;
    }
  }
  if (data instanceof Uint8Array) {
    try {
      return JSON.parse(new TextDecoder().decode(data)) as unknown;
    } catch {
      return data;
    }
  }
  return data;
}

function patchCentrifugeServerToClientRpc(
  centrifuge: Centrifuge,
  onRpc: (event: AdminConsoleCentrifugeRpcEvent) => Promise<unknown>,
) {
  const internal = centrifuge as unknown as CentrifugePrivate;
  const original = internal._handleReply.bind(centrifuge);
  internal._handleReply = (reply, next) => {
    const id = reply.id;
    const rpc = reply.rpc;
    if (
      typeof id === 'number' &&
      id > 0 &&
      rpc &&
      typeof rpc === 'object' &&
      !(id in internal._callbacks)
    ) {
      const method = typeof rpc.method === 'string' ? rpc.method.trim() : '';
      if (method === '') {
        // A late reply for a client-originated RPC can arrive after centrifuge-js
        // has already removed its callback. Those frames may still carry an empty
        // `rpc` object; they are not server-initiated commands.
        next();
        return;
      }
      const data = normalizeCentrifugeRpcData(rpc.data);
      (centrifuge as Centrifuge & { emit(event: string, payload: AdminConsoleCentrifugeRpcEvent): boolean }).emit(
        'rpc',
        { commandId: id, method, data },
      );

      // Call next() immediately so we don't block the centrifuge-js read pipeline
      // waiting for our own reply to be sent.
      next();

      void (async () => {
        const isClawx = method === 'clawx_apply_sync';
        if (isClawx) {
          adminSyncLagMarkClawxRpcReceived();
          adminSyncLagLog('clawx_rpc_recv', { commandId: id });
        }
        try {
          const result =
            isClawx
              ? await runApplySyncExclusive(() => onRpc({ commandId: id, method, data }))
              : await onRpc({ commandId: id, method, data });
          await centrifuge.rpc('admin_proxy_client_rpc_reply', { id, result });
          if (isClawx) {
            adminSyncLagLog('clawx_rpc_reply_sent', { commandId: id });
          }
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          logger.error('Centrifuge server RPC handler failed', e);
          if (isClawx) {
            adminSyncLagLog('clawx_rpc_handler_error', { commandId: id, message });
          }
          try {
            await centrifuge.rpc('admin_proxy_client_rpc_reply', { id, error: message });
          } catch (replyErr) {
            logger.error('Failed to send RPC error reply', replyErr);
          }
        } finally {
          if (isClawx) {
            adminSyncLagSetCorrelation(null);
            adminSyncLagResetClawxRpcAnchor();
          }
        }
      })();
      return;
    }
    original(reply, next);
  };
}

/**
 * The admin-console channel carries privileged commands, so cleartext `ws://` is
 * only tolerated for loopback (local development against a dev Farm).
 */
function isAllowedControlChannelUrl(wsUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(wsUrl);
  } catch {
    return false;
  }
  if (parsed.protocol === 'wss:') return true;
  if (parsed.protocol !== 'ws:') return false;
  const host = parsed.hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

export class CentrifugeClient {
  private centrifuge: Centrifuge | null = null;
  /** Centrifuge keeps subscription objects across reconnects; must remove before newSubscription. */
  private commandSubscription: Subscription | null = null;
  private broadcastSubscription: Subscription | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private dashboardSnapshotScanTimer: NodeJS.Timeout | null = null;
  private dashboardSnapshotDebounceTimer: NodeJS.Timeout | null = null;
  private dashboardSnapshotWatchers: FSWatcher[] = [];
  private lastDashboardSnapshotSignature: string | null = null;
  private dashboardSnapshotInFlight = false;
  private machineId: string | null = null;
  private baseUrl = '';
  private gatewayManager: GatewayManager | null = null;
  private clawHubService: ClawHubService | null = null;
  private gatewayStatusHandler: (() => void) | null = null;
  /** Until gateway is `online` again after apply-sync, send one definitive heartbeat for Manager. */
  private applySyncStableUplinkTimer: ReturnType<typeof setInterval> | null = null;
  /** Centrifuge retries forever; log the first error of a cycle, then suppress. */
  private loggedConnectError = false;

  /**
   * Wire the local OpenClaw gateway manager so Centrifuge RPC method `openclaw_rpc` can proxy to
   * {@link GatewayManager.rpc} on this machine.
   */
  /**
   * 配置已落盘、网关 reload/restart 之前调用，强制带上 openclaw.json 快照（lifecycle 仍为 online 时）。
   */
  publishConfigSnapshotToManager(lagReason: string): Promise<void> {
    return this.publishHeartbeat({ forceConfigSnapshot: true }, lagReason);
  }

  setGatewayManager(manager: GatewayManager | null) {
    this.detachGatewayHeartbeatHooks();
    this.gatewayManager = manager;
    if (!manager) {
      this.clearApplySyncStableUplinkTimer();
      return;
    }
    this.gatewayStatusHandler = () => {
      const gw = manager.getStatus();
      const lifecycle = managerFacingLifecycleStatus(gw);
      const publish =
        lifecycle === 'online'
          ? this.publishHeartbeat(undefined, 'gateway_status_listener_online')
          : this.publishHeartbeat({ forceConfigSnapshot: true }, 'gateway_status_or_ready_listener');
      void publish.finally(() => {
        this.ensureHeartbeatInterval();
      });
    };
    manager.on('status', this.gatewayStatusHandler);
    manager.on('gateway:ready', this.gatewayStatusHandler);
  }

  private detachGatewayHeartbeatHooks() {
    if (this.gatewayManager && this.gatewayStatusHandler) {
      this.gatewayManager.off('status', this.gatewayStatusHandler);
      this.gatewayManager.off('gateway:ready', this.gatewayStatusHandler);
    }
    this.gatewayStatusHandler = null;
  }

  private nextHeartbeatIntervalMs(): number {
    const gw = this.gatewayManager?.getStatus() ?? null;
    return managerFacingLifecycleStatus(gw) === 'online'
      ? HEARTBEAT_INTERVAL_MS
      : HEARTBEAT_BURST_INTERVAL_MS;
  }

  /** (Re)start periodic heartbeat: 30s when gateway online, short burst while restarting / warming. */
  private ensureHeartbeatInterval(): void {
    this.clearHeartbeatTimer();
    if (!this.centrifuge || this.centrifuge.state !== 'connected') return;
    const ms = this.nextHeartbeatIntervalMs();
    this.heartbeatTimer = setInterval(() => {
      void this.publishHeartbeat(undefined, `heartbeat_timer_${ms}ms`);
    }, ms);
  }

  setClawHubService(service: ClawHubService | null) {
    this.clawHubService = service;
  }

  async sessionSendRemote(payload: SessionSendRemoteRequest): Promise<SessionSendRemoteAck | unknown> {
    const request: SessionSendRemoteRequest = {
      ...payload,
      schema_version: 1,
    };
    return await this.adminConsoleRpc('session_send_remote', request);
  }

  async sessionListRemote(payload: SessionListRemoteRequest): Promise<SessionListRemoteAck | unknown> {
    const request: SessionListRemoteRequest = {
      ...payload,
      schema_version: 1,
    };
    return await this.adminConsoleRpc('session_list_remote', request);
  }

  async sessionHistoryRemote(payload: SessionHistoryRemoteRequest): Promise<SessionHistoryRemoteAck | unknown> {
    const request: SessionHistoryRemoteRequest = {
      ...payload,
      schema_version: 1,
    };
    return await this.adminConsoleRpc('session_history_remote', request);
  }

  async sessionStatusRemote(payload: SessionStatusRemoteRequest): Promise<SessionStatusRemoteAck | unknown> {
    const request: SessionStatusRemoteRequest = {
      ...payload,
      schema_version: 1,
    };
    return await this.adminConsoleRpc('session_status_remote', request);
  }

  async sharedWorkspaceSync(payload: SharedWorkspaceSyncRequest): Promise<SharedWorkspaceSyncAck | unknown> {
    const request: SharedWorkspaceSyncRequest = {
      ...payload,
      schema_version: 1,
    };
    return await this.adminConsoleRpc('shared_workspace_sync', request);
  }

  private async adminConsoleRpc(method: string, request: object): Promise<unknown> {
    if (!this.centrifuge || this.centrifuge.state !== 'connected') {
      throw new Error('Manager realtime connection is not connected');
    }

    const payload = request as Record<string, unknown>;
    delete payload.source_client_id;
    const rpcWithTimeout = this.centrifuge.rpc.bind(this.centrifuge) as (
      method: string,
      data?: unknown,
      options?: { timeout?: number },
    ) => Promise<unknown>;
    return await rpcWithTimeout(method, payload, { timeout: ADMIN_CONSOLE_REMOTE_SESSION_RPC_TIMEOUT_MS });
  }

  private removeAdminConsoleSubscriptions(): void {
    const c = this.centrifuge;
    if (!c) {
      this.commandSubscription = null;
      this.broadcastSubscription = null;
      return;
    }

    const drop = (sub: Subscription | null) => {
      if (!sub) return;
      try {
        sub.unsubscribe();
      } catch (e) {
        logger.debug('Centrifuge subscription unsubscribe', e);
      }
      try {
        c.removeSubscription(sub);
      } catch (e) {
        logger.debug('Centrifuge removeSubscription', e);
      }
    };

    drop(this.commandSubscription);
    this.commandSubscription = null;

    drop(this.broadcastSubscription);
    this.broadcastSubscription = null;

    if (this.machineId) {
      const commandChannel = AdminConsoleTopics.command(this.machineId);
      const orphanCmd = c.getSubscription(commandChannel);
      if (orphanCmd) drop(orphanCmd);
    }

    const orphanBc = c.getSubscription(AdminConsoleTopics.broadcast);
    if (orphanBc) drop(orphanBc);
  }

  async start() {
    this.stop();

    if (!isFarmEnabled()) return;

    const baseUrl = this.getBaseUrl();
    if (!baseUrl) return;
    this.baseUrl = baseUrl;

    // This channel is a remote CONTROL plane: `clawx_apply_sync` can create and
    // delete agents, change models/tools, install skills and restart the Gateway
    // (see remote-sync/clawxApplySyncOps). Refuse to open it unauthenticated or
    // in cleartext to a remote host, regardless of how it was configured.
    const token = process.env.CLIENT_INGEST_TOKEN || '';
    if (!token) {
      logCentrifugeInfo(
        'Admin Console realtime disabled: CLIENT_INGEST_TOKEN is not set '
        + '(refusing to open an unauthenticated remote control channel).',
      );
      return;
    }

    let wsUrl = farmHttpBaseToWsBase(this.baseUrl);
    if (!isAllowedControlChannelUrl(wsUrl)) {
      logCentrifugeInfo(
        `Admin Console realtime disabled: refusing cleartext ws:// to a non-loopback host (${this.baseUrl}). `
        + 'Use https:// / wss:// for the Farm base URL.',
      );
      return;
    }
    // Typical centrifuge connection endpoint
    wsUrl = `${wsUrl}/api/v1/realtime/connection`;

    this.machineId = await this.getMachineId();

    const centrifuge = new Centrifuge(wsUrl, {
      websocket: WebSocket as any,
      token,
      data: {
        client_id: this.machineId,
      }
    });
    this.centrifuge = centrifuge;

    patchCentrifugeServerToClientRpc(centrifuge, (evt) => this.handleServerInitiatedRpc(evt));

    centrifuge.on('connecting', (ctx) => {
      logCentrifugeInfo('Centrifuge connecting...', ctx);
    });

    centrifuge.on('connected', (ctx) => {
      this.loggedConnectError = false;
      void this.handleConnected(centrifuge, ctx);
    });

    centrifuge.on('disconnected', (ctx) => {
      logCentrifugeInfo('Centrifuge disconnected', ctx);
      this.clearHeartbeatTimer();
      this.clearApplySyncStableUplinkTimer();
      this.stopDashboardSnapshotProducer();
      this.removeAdminConsoleSubscriptions();
    });

    centrifuge.on('error', (ctx) => {
      // Centrifuge retries forever; logging every attempt at error level floods
      // the log. Report the first failure, then stay quiet until we reconnect.
      if (this.loggedConnectError) {
        logCentrifugeInfo('Centrifuge error (repeat, suppressed)', ctx);
        return;
      }
      this.loggedConnectError = true;
      logCentrifugeError('Centrifuge error', ctx);
    });

    centrifuge.connect();
  }

  /** Tear down Centrifuge only; gateway hooks stay until {@link setGatewayManager}(null) or app quit. */
  stop() {
    this.clearHeartbeatTimer();
    this.clearApplySyncStableUplinkTimer();
    this.stopDashboardSnapshotProducer();
    if (this.centrifuge) {
      this.removeAdminConsoleSubscriptions();
      this.centrifuge.disconnect();
      this.centrifuge = null;
    }
    this.commandSubscription = null;
    this.broadcastSubscription = null;
    this.loggedConnectError = false;
  }

  private async handleConnected(centrifuge: Centrifuge, ctx: ConnectedContext) {
    try {
      if (this.centrifuge !== centrifuge) return;

      logCentrifugeInfo('Centrifuge connected', ctx);
      broadcastToRenderer('skill:review-sync-needed', { reason: 'manager-reconnected' });
      this.clearHeartbeatTimer();
      this.clearApplySyncStableUplinkTimer();
      this.stopDashboardSnapshotProducer();
      this.removeAdminConsoleSubscriptions();

      this.machineId = await this.getMachineId();
      if (this.centrifuge !== centrifuge) return;

      this.ensureCommandSubscriptions(centrifuge, this.machineId);

      // On connected, immediately publish startup signal and config snapshot.
      await this.publishHeartbeat(undefined, 'centrifuge_connected');
      await this.publishDashboardSnapshot({ force: true });
      if (this.centrifuge !== centrifuge) return;

      this.startDashboardSnapshotWatcher();
      this.startDashboardSnapshotScan();

      this.ensureHeartbeatInterval();
    } catch (error) {
      logger.error('Centrifuge connected handler failed', error);
    }
  }

  private ensureCommandSubscriptions(centrifuge: Centrifuge, machineId: string) {
    const channel = AdminConsoleTopics.command(machineId);
    this.commandSubscription = this.ensureSubscription(
      centrifuge,
      this.commandSubscription,
      channel,
      async (pubCtx) => {
        logCentrifugeInfo(`Received command on ${channel}`, pubCtx.data);
        if (await this.handleSkillMarketplaceEvent(pubCtx.data)) {
          return;
        }
        await this.handleCommand(pubCtx.data as AdminConsoleCommand);
      },
    );

    const broadcastChannel = AdminConsoleTopics.broadcast;
    this.broadcastSubscription = this.ensureSubscription(
      centrifuge,
      this.broadcastSubscription,
      broadcastChannel,
      async (pubCtx) => {
        logCentrifugeInfo(`Received broadcast on ${broadcastChannel}`, pubCtx.data);
        if (await this.handleSkillMarketplaceEvent(pubCtx.data)) {
          return;
        }
        await this.handleCommand(pubCtx.data as AdminConsoleCommand);
      },
    );
  }

  private ensureSubscription(
    centrifuge: Centrifuge,
    current: Subscription | null,
    channel: string,
    onPublication: (pubCtx: { data: unknown }) => Promise<void>,
  ) {
    const existing = current?.channel === channel ? current : centrifuge.getSubscription(channel);
    if (existing) {
      if (existing.state === SubscriptionState.Unsubscribed) {
        existing.subscribe();
      }
      return existing;
    }

    const sub = centrifuge.newSubscription(channel);
    sub.on('publication', (pubCtx) => {
      void onPublication(pubCtx).catch((error) => {
        logger.error(`Failed to handle Centrifuge publication on ${channel}`, error);
      });
    });
    sub.subscribe();
    return sub;
  }

  private async handleSkillMarketplaceEvent(data: unknown): Promise<boolean> {
    const payload = normalizeCentrifugeRpcData(data);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return false;
    }
    const event = payload as SkillPublishReviewResult | WorkspaceSkillUnlistedEvent | WorkspaceSkillListedEvent;
    if (event.type === 'workspace_skill_publish_review_result') {
      broadcastToRenderer('skill:review-status', event);
      return true;
    }
    if (event.type === 'workspace_skill_listed') {
      broadcastToRenderer('skill:review-status', event);
      return true;
    }
    if (event.type === 'workspace_skill_unlisted') {
      const unlisted = event as WorkspaceSkillUnlistedEvent;
      if (unlisted.reason === 'overwrite same-name skill') {
        if (unlisted.skill_id) {
          await purgeSkillFromAgentAllowlists(unlisted.skill_id);
        }
        const removeParams = {
          skillId: unlisted.skill_id,
          displayName: unlisted.display_name,
        };
        const result = this.gatewayManager
          ? await withGatewayHotSkillFilesystem(this.gatewayManager, async () =>
            removeServerMarketplaceSkillLocalInstall(removeParams),
          )
          : await removeServerMarketplaceSkillLocalInstall(removeParams);
        broadcastToRenderer('skill:review-status', { ...unlisted, ...result });
      } else {
        broadcastToRenderer('skill:review-status', unlisted);
      }
      return true;
    }
    return false;
  }

  private async getMachineId() {
    let id = await getSetting('machineId');
    if (!id) {
      id = machineIdSync();
      await setSetting('machineId', id);
    }
    return id;
  }

  private getBaseUrl(): string | null {
    return resolveFarmApiBaseUrl();
  }

  private async publishHeartbeat(options?: BuildHeartbeatPayloadOptions, lagReason?: string) {
    if (!this.centrifuge || this.centrifuge.state !== 'connected' || !this.machineId) return;

    try {
      const gw = this.gatewayManager?.getStatus() ?? null;
      const lifecycle = managerFacingLifecycleStatus(gw);
      adminSyncLagLog('heartbeat_uplink_begin', {
        lagReason: lagReason ?? 'unspecified',
        lifecycle,
        gatewayState: gw?.state,
        gatewayReady: gw?.gatewayReady,
      });
      const payload = await buildHeartbeatPayload(this.machineId, gw, options);
      const tRpc = performance.now();
      const ack = await this.centrifuge.rpc('heartbeat', payload);
      adminSyncLagLog('heartbeat_uplink_ack', {
        lagReason: lagReason ?? 'unspecified',
        lifecycle,
        rpcMs: Math.round(performance.now() - tRpc),
      });
      logCentrifugeInfo('Centrifuge heartbeat ack', ack);
    } catch (e) {
      const gw = this.gatewayManager?.getStatus() ?? null;
      adminSyncLagLog('heartbeat_uplink_err', {
        lagReason: lagReason ?? 'unspecified',
        lifecycle: managerFacingLifecycleStatus(gw),
        gatewayState: gw?.state,
        gatewayReady: gw?.gatewayReady,
        err: e instanceof Error ? e.message : String(e),
      });
      logger.error('Centrifuge heartbeat error', e);
    }
  }

  private clearHeartbeatTimer() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearApplySyncStableUplinkTimer() {
    if (this.applySyncStableUplinkTimer) {
      clearInterval(this.applySyncStableUplinkTimer);
      this.applySyncStableUplinkTimer = null;
    }
  }

  /**
   * Manager may keep a "waiting for client gateway" state after `clawx_apply_sync` returns while a
   * debounced reload/restart is still in flight. Poll until lifecycle is `online`, then uplink one
   * heartbeat with full config snapshot (best-effort after timeout).
   */
  private scheduleApplySyncStableGatewayNotify(baseReason: string): void {
    this.clearApplySyncStableUplinkTimer();
    const startedAt = Date.now();

    const runTick = () => {
      if (!this.centrifuge || this.centrifuge.state !== 'connected' || !this.gatewayManager || !this.machineId) {
        this.clearApplySyncStableUplinkTimer();
        return;
      }
      const gw = this.gatewayManager.getStatus();
      const lifecycle = managerFacingLifecycleStatus(gw);
      const elapsed = Date.now() - startedAt;
      const timedOut = elapsed >= APPLY_SYNC_STABLE_MAX_MS;
      if (lifecycle !== 'online' && !timedOut) {
        return;
      }

      this.clearApplySyncStableUplinkTimer();
      const reason =
        lifecycle === 'online'
          ? `${baseReason}_stable_gateway_online`
          : `${baseReason}_stable_watch_timeout`;
      adminSyncLagLog('apply_sync_stable_uplink', {
        lifecycle,
        timedOut,
        elapsedMs: elapsed,
        gatewayState: gw.state,
        gatewayReady: gw.gatewayReady,
      });
      void this.publishHeartbeat({ forceConfigSnapshot: true }, reason).finally(() => {
        this.ensureHeartbeatInterval();
      });
    };

    this.applySyncStableUplinkTimer = setInterval(runTick, APPLY_SYNC_STABLE_POLL_MS);
    queueMicrotask(runTick);
  }

  private startDashboardSnapshotScan() {
    this.stopDashboardSnapshotScan();
    this.dashboardSnapshotScanTimer = setInterval(() => {
      this.scheduleDashboardSnapshotPublish();
    }, DASHBOARD_SNAPSHOT_SCAN_MS);
  }

  private stopDashboardSnapshotScan() {
    if (this.dashboardSnapshotScanTimer) {
      clearInterval(this.dashboardSnapshotScanTimer);
      this.dashboardSnapshotScanTimer = null;
    }
  }

  private startDashboardSnapshotWatcher() {
    this.stopDashboardSnapshotWatcher();
    const openclawDir = getOpenClawConfigDir();
    const onChange = () => {
      this.scheduleDashboardSnapshotPublish();
    };

    // Watch ONLY what buildDashboardSnapshot actually reads — the agent
    // session transcripts, openclaw.json, and cron jobs. A previous
    // `watch(openclawDir, { recursive: true })` watched the entire ~/.openclaw
    // tree (tens of thousands of files incl. logs/, llm_dump/, extensions/,
    // browser/), so high-churn writes there (llm dumps, sqlite WALs, logs)
    // fired a full transcript-scanning snapshot rebuild on the main process
    // over and over — the dominant cause of app-wide idle lag that worsened as
    // those dirs grew. Scope the watch narrowly instead:
    //  - agents/ recursively (small; where transcripts live), and
    //  - the config dir non-recursively (catches top-level openclaw.json
    //    without descending into the heavy sibling subtrees).
    const watchTargets: Array<{ path: string; recursive: boolean }> = [
      { path: join(openclawDir, 'agents'), recursive: true },
      { path: join(openclawDir, 'cron'), recursive: false },
      { path: openclawDir, recursive: false },
    ];

    for (const target of watchTargets) {
      if (!existsSync(target.path)) {
        continue;
      }
      try {
        this.dashboardSnapshotWatchers.push(
          watch(target.path, { recursive: target.recursive }, onChange),
        );
      } catch (error) {
        logger.debug(`Failed to watch dashboard snapshot source: ${target.path}`, error);
      }
    }
  }

  private stopDashboardSnapshotWatcher() {
    for (const watcher of this.dashboardSnapshotWatchers) {
      try {
        watcher.close();
      } catch {
        // best-effort
      }
    }
    this.dashboardSnapshotWatchers = [];
  }

  private stopDashboardSnapshotProducer() {
    this.stopDashboardSnapshotScan();
    this.stopDashboardSnapshotWatcher();
    if (this.dashboardSnapshotDebounceTimer) {
      clearTimeout(this.dashboardSnapshotDebounceTimer);
      this.dashboardSnapshotDebounceTimer = null;
    }
  }

  private scheduleDashboardSnapshotPublish() {
    if (this.dashboardSnapshotDebounceTimer) {
      clearTimeout(this.dashboardSnapshotDebounceTimer);
    }
    this.dashboardSnapshotDebounceTimer = setTimeout(() => {
      this.dashboardSnapshotDebounceTimer = null;
      void this.publishDashboardSnapshot({ force: false });
    }, DASHBOARD_SNAPSHOT_DEBOUNCE_MS);
  }

  private async publishDashboardSnapshot({ force }: { force: boolean }) {
    if (
      !this.centrifuge ||
      this.centrifuge.state !== 'connected' ||
      !this.machineId ||
      this.dashboardSnapshotInFlight
    ) {
      return;
    }

    this.dashboardSnapshotInFlight = true;
    try {
      const snapshot = await buildDashboardSnapshot(this.machineId);
      const signature = JSON.stringify(snapshot.data);
      if (!force && signature === this.lastDashboardSnapshotSignature) {
        return;
      }
      const ack = await this.centrifuge.rpc('dashboard_snapshot', snapshot);
      this.lastDashboardSnapshotSignature = signature;
      logCentrifugeInfo('Centrifuge dashboard snapshot ack', ack);
    } catch (e) {
      logger.error('Centrifuge dashboard snapshot error', e);
    } finally {
      this.dashboardSnapshotInFlight = false;
    }
  }

  private async handleCommand(cmd: AdminConsoleCommand) {
    if (!this.centrifuge || !this.machineId) return;
    logCentrifugeInfo(`Received Farm command via Centrifuge: ${cmd.command}`, cmd.payload);
    await handleAdminConsoleCommand({
      centrifuge: this.centrifuge,
      machineId: this.machineId,
      command: cmd,
      baseUrl: this.baseUrl,
      gatewayManager: this.gatewayManager,
      clawHubService: this.clawHubService,
    });
  }

  /**
   * Handles RPC commands initiated by the Centrifuge server (e.g. YYClawManager).
   * Method `openclaw_rpc` expects payload `{ method: string, params?: unknown }` and forwards to the gateway.
   */
  private async handleServerInitiatedRpc(evt: AdminConsoleCentrifugeRpcEvent): Promise<unknown> {
    if (evt.method === 'clawx_apply_sync') {
      const result = await applyClawxSyncAction(this.gatewayManager, evt.data);
      void this.publishHeartbeat({ forceConfigSnapshot: true }, 'clawx_apply_sync_handler_return').finally(() => {
        this.ensureHeartbeatInterval();
      });
      this.scheduleApplySyncStableGatewayNotify('clawx_apply_sync');
      return result;
    }
    if (evt.method === 'office_workspace_rpc') {
      return await handleOfficeSharedWorkspaceRpc(evt.data);
    }
    if (evt.method !== 'openclaw_rpc') {
      throw new Error(`Unsupported server RPC method: ${evt.method || '(empty)'}`);
    }

    await awaitApplySyncExclusiveIdle();

    const payload = evt.data;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('openclaw_rpc expects a JSON object body with method (and optional params)');
    }
    const rec = payload as Record<string, unknown>;
    const method = rec.method;
    if (typeof method !== 'string' || !method.trim()) {
      throw new Error('openclaw_rpc payload missing string "method"');
    }
    let params = rec.params;

    /** Manager proxy client maps `/api/providers` → `api.providers`; must hit Electron Host API like the desktop app, not gateway RPC. */
    if (method === 'api.providers') {
      return await getProviderService().listLegacyProvidersWithKeyInfo();
    }
    if (method === 'api.provider-accounts') {
      return await getProviderService().listAccounts();
    }

    if (!this.gatewayManager) {
      throw new Error('Gateway manager is not configured for admin console RPC');
    }
    const gatewayManager = this.gatewayManager;

    if (method === 'skills.configs.list') {
      return await getAllSkillConfigs();
    }

    if (method === 'skills.install' && params && typeof params === 'object' && (params as any).source === 'clawhub') {
      if (!this.clawHubService) {
        throw new Error('ClawHub service is not available');
      }
      logCentrifugeInfo('Centrifuge openclaw_rpc intercepting clawhub install', params);
      const clawhubParams = params as { slug?: string; overwriteSameName?: boolean };
      const slug = typeof clawhubParams.slug === 'string' ? clawhubParams.slug.trim() : '';
      const { runManagedSameNameInstall, SAME_NAME_EXISTS_CODE } = await import(
        '../skills/skill-same-name-overwrite'
      );
      const { withGatewayHotSkillFilesystem } = await import(
        '../skills/skill-gateway-fs-guard'
      );
      const { reconcileManagedSkillWinnersWhileLocked } = await import(
        '../skills/managed-skill-winner'
      );
      const installResult = await runManagedSameNameInstall({
        skillName: slug,
        overwriteSameName: !!clawhubParams.overwriteSameName,
        withFilesystemGuard: async (operation) => (
          withGatewayHotSkillFilesystem(gatewayManager, operation)
        ),
        install: async () => this.clawHubService!.install(params as any),
        afterCommit: async () => {
          await reconcileManagedSkillWinnersWhileLocked();
        },
      });
      if (!installResult.ok) {
        return {
          ok: false,
          error: SAME_NAME_EXISTS_CODE,
          code: installResult.code,
          displayName: installResult.displayName,
          existingIds: installResult.existingIds,
        };
      }
      try {
        const { syncSkillsEntriesEnabledFromAgents } = await import('../../utils/skill-entries-sync');
        const { runPostInstallWorkspaceAgentSkillSyncFromPayload, scheduleWorkspaceAgentSkillsReconcile } = await import('../../utils/workspace-agent-skills-sync');
        await syncSkillsEntriesEnabledFromAgents();
        await runPostInstallWorkspaceAgentSkillSyncFromPayload(params);
        scheduleWorkspaceAgentSkillsReconcile('skills.install:clawhub');
      } catch (e) {
        logger.error('Failed to sync skill entries after clawhub install', e);
      }
      const p = params as any;
      return { ok: true, slug: p.slug, version: p.version };
    }

    if (method === 'skills.update' && params && typeof params === 'object' && (params as any).source === 'clawhub') {
      if (!this.clawHubService) {
        throw new Error('ClawHub service is not available');
      }
      logCentrifugeInfo('Centrifuge openclaw_rpc intercepting clawhub update', params);
      await this.clawHubService.update(params as any);
      return { ok: true };
    }

    if (method === 'chat.send') {
      params = decorateChatSendParamsWithAdminSharedWorkspace(params);
    }

    logCentrifugeInfo(`Centrifuge openclaw_rpc -> gateway: ${method}`);
    const result = await this.gatewayManager.rpc(method, params, openClawRpcGatewayTimeoutMs(method));

    if (method === 'skills.install' && params && typeof params === 'object') {
      try {
        const { syncSkillsEntriesEnabledFromAgents } = await import('../../utils/skill-entries-sync');
        const { runPostInstallWorkspaceAgentSkillSyncFromPayload, scheduleWorkspaceAgentSkillsReconcile } = await import('../../utils/workspace-agent-skills-sync');
        await syncSkillsEntriesEnabledFromAgents();
        await runPostInstallWorkspaceAgentSkillSyncFromPayload(params);
        scheduleWorkspaceAgentSkillsReconcile('skills.install:gateway-rpc');
      } catch (e) {
        logger.error('Failed to sync skill entries after skills.install', e);
      }
    }

    return result;
  }
}

export const adminConsoleClient = new CentrifugeClient();
