import type { GatewayManager } from '../../gateway/manager';
import { sanitizeChatHistoryMessages } from '../../../src/lib/office-session-attachments';
import { OfficeSyncPollingInactiveError } from './office-sync-polling-error';

export type ChatHistoryMessage = Record<string, unknown>;

export type FetchChatHistoryScheduleOptions = {
  /** Bypass the unified poll tick and flush this session as soon as the prior flush wave completes. */
  urgent?: boolean;
};

type HistoryWaiter = {
  resolve: (value: { messages: ChatHistoryMessage[] }) => void;
  reject: (reason: unknown) => void;
};

type PendingHistoryBucket = {
  sessionKey: string;
  limit: number;
  gateway: GatewayManager;
  waiters: HistoryWaiter[];
};

function bucketKey(sessionKey: string, limit: number): string {
  return `${sessionKey}:${limit}`;
}

type HistoryParamStyle = 'sessionKey' | 'key';

/** Remember which Gateway param shape worked per session to avoid double chat.history RPCs. */
const historyParamStyleCache = new Map<string, HistoryParamStyle>();

function historyParamAttempts(
  sessionKey: string,
  limit: number,
): Array<{ method: string; params: Record<string, unknown>; style: HistoryParamStyle }> {
  const cached = historyParamStyleCache.get(sessionKey);
  if (cached === 'sessionKey') {
    return [{ method: 'chat.history', params: { sessionKey, limit }, style: 'sessionKey' }];
  }
  if (cached === 'key') {
    return [{ method: 'chat.history', params: { key: sessionKey, limit }, style: 'key' }];
  }
  return [
    { method: 'chat.history', params: { sessionKey, limit }, style: 'sessionKey' },
    { method: 'chat.history', params: { key: sessionKey, limit }, style: 'key' },
  ];
}

async function rpcChatHistory(
  gateway: GatewayManager,
  sessionKey: string,
  limit: number,
): Promise<{ messages: ChatHistoryMessage[] }> {
  let lastError: Error | null = null;
  for (const { method, params, style } of historyParamAttempts(sessionKey, limit)) {
    try {
      const result = await gateway.rpc(method, params, 60_000);
      historyParamStyleCache.set(sessionKey, style);
      if (result && typeof result === 'object') {
        const obj = result as Record<string, unknown>;
        const messages = Array.isArray(obj.messages) ? obj.messages : [];
        return {
          messages: sanitizeChatHistoryMessages(messages) as ChatHistoryMessage[],
        };
      }
      return { messages: [] };
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastError ?? new Error('RPC failed');
}

/**
 * Batches office `chat.history` reads on the Office-wide unified poll tick (3s while
 * projects run); per-session waiters in a wave share a single RPC. Urgent requests
 * flush their session immediately after any in-flight wave.
 */
class OfficeSessionHistorySync {
  private readonly pending = new Map<string, PendingHistoryBucket>();
  private readonly rpcInFlight = new Map<string, Promise<{ messages: ChatHistoryMessage[] }>>();
  private flushChain: Promise<void> = Promise.resolve();
  private pollingEnabled = false;

  setPollingEnabled(enabled: boolean): void {
    this.pollingEnabled = enabled;
    if (!enabled) {
      const keys = [...this.pending.keys()];
      if (keys.length > 0) {
        void this.flushKeys(keys);
      }
    }
  }

  schedule(
    gateway: GatewayManager,
    sessionKey: string,
    limit: number,
    options?: FetchChatHistoryScheduleOptions,
  ): Promise<{ messages: ChatHistoryMessage[] }> {
    const key = bucketKey(sessionKey, limit);
    const urgent = options?.urgent === true;
    if (!this.pollingEnabled && !urgent) {
      return Promise.reject(new OfficeSyncPollingInactiveError());
    }
    let bucket = this.pending.get(key);
    if (!bucket) {
      bucket = {
        sessionKey,
        limit,
        gateway,
        waiters: [],
      };
      this.pending.set(key, bucket);
    }
    bucket.gateway = gateway;

    const promise = new Promise<{ messages: ChatHistoryMessage[] }>((resolve, reject) => {
      bucket!.waiters.push({ resolve, reject });
    });

    if (urgent) {
      void this.flushKeys([key]);
    }
    return promise;
  }

  flushAllPending(): Promise<void> {
    const keys = [...this.pending.keys()];
    if (keys.length === 0) return Promise.resolve();
    return this.flushKeys(keys);
  }

  private rejectPendingWaiters(error: Error): void {
    for (const bucket of this.pending.values()) {
      for (const waiter of bucket.waiters) waiter.reject(error);
    }
    this.pending.clear();
  }

  private flushKeys(keys: string[]): Promise<void> {
    const unique = [...new Set(keys)].filter((key) => this.pending.has(key));
    if (unique.length === 0) return Promise.resolve();

    this.flushChain = this.flushChain
      .then(async () => {
        for (const key of unique) {
          const bucket = this.pending.get(key);
          if (!bucket) continue;

          const { sessionKey, limit, gateway, waiters } = bucket;
          this.pending.delete(key);

          let rpc = this.rpcInFlight.get(key);
          if (!rpc) {
            rpc = rpcChatHistory(gateway, sessionKey, limit).finally(() => {
              if (this.rpcInFlight.get(key) === rpc) {
                this.rpcInFlight.delete(key);
              }
            });
            this.rpcInFlight.set(key, rpc);
          }

          try {
            const result = await rpc;
            for (const waiter of waiters) waiter.resolve(result);
          } catch (error) {
            for (const waiter of waiters) waiter.reject(error);
          }
        }
      })
      .catch(() => {
        // flush wave errors are surfaced to individual waiters
      });

    return this.flushChain;
  }

  /** @internal */
  resetForTest(): void {
    this.pollingEnabled = false;
    this.pending.clear();
    this.rpcInFlight.clear();
    this.flushChain = Promise.resolve();
    historyParamStyleCache.clear();
  }
}

export function setOfficeSessionHistoryPollingEnabled(enabled: boolean): void {
  officeSessionHistorySync.setPollingEnabled(enabled);
}

const officeSessionHistorySync = new OfficeSessionHistorySync();

export function scheduleOfficeChatHistory(
  gateway: GatewayManager,
  sessionKey: string,
  limit: number,
  options?: FetchChatHistoryScheduleOptions,
): Promise<{ messages: ChatHistoryMessage[] }> {
  return officeSessionHistorySync.schedule(gateway, sessionKey, limit, options);
}

export function flushOfficeSessionHistoryPending(): Promise<void> {
  return officeSessionHistorySync.flushAllPending();
}

/** Immediate RPC (bypass batch tick); used when unified polling is off. */
export async function fetchOfficeChatHistoryDirect(
  gateway: GatewayManager,
  sessionKey: string,
  limit: number,
): Promise<{ messages: ChatHistoryMessage[] }> {
  return rpcChatHistory(gateway, sessionKey, limit);
}

export function resetOfficeSessionHistorySyncForTest(): void {
  officeSessionHistorySync.resetForTest();
}
