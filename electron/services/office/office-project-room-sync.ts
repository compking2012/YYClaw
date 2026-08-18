import type { RoomMessage } from './types';
import { getRoomMessages, listTasks } from './store';
import { reconcileScenarioTaskProgress } from './scenario-progress-reconcile';
import { OfficeSyncPollingInactiveError } from './office-sync-polling-error';

export type ScheduleOfficeRoomMessagesOptions = {
  /** Bypass the unified poll tick and flush this task as soon as the prior flush wave completes. */
  urgent?: boolean;
};

type RoomWaiter = {
  resolve: (value: RoomMessage[]) => void;
  reject: (reason: unknown) => void;
};

type PendingRoomBucket = {
  taskId: string;
  waiters: RoomWaiter[];
};

/**
 * Batches office project-room disk reads on the Office-wide unified poll tick (3s while
 * projects run); per-task waiters in a wave share a single read.
 */
class OfficeProjectRoomSync {
  private readonly pending = new Map<string, PendingRoomBucket>();
  private readonly readInFlight = new Map<string, Promise<RoomMessage[]>>();
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
    taskId: string,
    options?: ScheduleOfficeRoomMessagesOptions,
  ): Promise<RoomMessage[]> {
    const urgent = options?.urgent === true;
    if (!this.pollingEnabled && !urgent) {
      return Promise.reject(new OfficeSyncPollingInactiveError());
    }
    let bucket = this.pending.get(taskId);
    if (!bucket) {
      bucket = { taskId, waiters: [] };
      this.pending.set(taskId, bucket);
    }

    const promise = new Promise<RoomMessage[]>((resolve, reject) => {
      bucket!.waiters.push({ resolve, reject });
    });

    if (urgent) {
      void this.flushKeys([taskId]);
    }
    return promise;
  }

  flushAllPending(): Promise<void> {
    const keys = [...this.pending.keys()];
    if (keys.length === 0) return Promise.resolve();
    return this.flushKeys(keys);
  }

  private flushKeys(keys: string[]): Promise<void> {
    const unique = [...new Set(keys)].filter((key) => this.pending.has(key));
    if (unique.length === 0) return Promise.resolve();

    this.flushChain = this.flushChain
      .then(async () => {
        const flushedTaskIds: string[] = [];

        for (const taskId of unique) {
          const bucket = this.pending.get(taskId);
          if (!bucket) continue;

          const { waiters } = bucket;
          this.pending.delete(taskId);
          flushedTaskIds.push(taskId);

          let read = this.readInFlight.get(taskId);
          if (!read) {
            read = getRoomMessages(taskId).finally(() => {
              if (this.readInFlight.get(taskId) === read) {
                this.readInFlight.delete(taskId);
              }
            });
            this.readInFlight.set(taskId, read);
          }

          try {
            const messages = await read;
            for (const waiter of waiters) waiter.resolve(messages);
          } catch (error) {
            for (const waiter of waiters) waiter.reject(error);
          }
        }

        if (flushedTaskIds.length > 0) {
          await this.reconcileAfterRoomFlush(flushedTaskIds);
        }
      })
      .catch(() => {
        // flush wave errors are surfaced to individual waiters
      });

    return this.flushChain;
  }

  private async reconcileAfterRoomFlush(taskIds: string[]): Promise<void> {
    const tasks = await listTasks();
    const scenarioIds = new Set<string>();
    for (const taskId of taskIds) {
      const task = tasks.find((t) => t.id === taskId);
      if (task?.scenarioId) scenarioIds.add(task.scenarioId);
    }
    for (const scenarioId of scenarioIds) {
      try {
        await reconcileScenarioTaskProgress(scenarioId);
      } catch {
        // Reconcile is best-effort; room waiters already resolved.
      }
    }
  }

  /** @internal */
  resetForTest(): void {
    this.pollingEnabled = false;
    this.pending.clear();
    this.readInFlight.clear();
    this.flushChain = Promise.resolve();
  }
}

export function setOfficeProjectRoomPollingEnabled(enabled: boolean): void {
  officeProjectRoomSync.setPollingEnabled(enabled);
}

const officeProjectRoomSync = new OfficeProjectRoomSync();

export function scheduleOfficeRoomMessages(
  taskId: string,
  options?: ScheduleOfficeRoomMessagesOptions,
): Promise<RoomMessage[]> {
  return officeProjectRoomSync.schedule(taskId, options);
}

export function flushOfficeProjectRoomPending(): Promise<void> {
  return officeProjectRoomSync.flushAllPending();
}

/** Direct disk read (bypass batch tick); used when execution sync is off. */
export async function readOfficeProjectRoomMessages(taskId: string): Promise<RoomMessage[]> {
  return getRoomMessages(taskId);
}

export function resetOfficeProjectRoomSyncForTest(): void {
  officeProjectRoomSync.resetForTest();
}
