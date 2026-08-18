/**
 * Cron Job Type Definitions
 * Types for scheduled tasks
 */

import type { ChannelType } from './channel';

export type CronJobDeliveryMode = 'none' | 'announce';

/**
 * Client-side validity window for a cron job.
 *
 * The bundled OpenClaw Gateway has no notion of a start/end validity window, so
 * this is enforced entirely app-side: the window is persisted locally (see
 * `electron/services/cron-window-store.ts`) and a background reconciler
 * (`cron-window-manager.ts`) enables/disables the Gateway job when the current
 * local date crosses `start` / `end`. `desiredEnabled` records the user's
 * intended enabled state so it can be restored when the window becomes active.
 *
 * `start` / `end` are inclusive local calendar dates in `YYYY-MM-DD` form.
 */
export interface CronJobWindow {
  start?: string;
  end?: string;
  desiredEnabled?: boolean;
}

export interface CronJobDelivery {
  mode: CronJobDeliveryMode;
  channel?: ChannelType | string;
  to?: string;
  accountId?: string;
}

/**
 * Cron job target (where to send the result)
 */
export interface CronJobTarget {
  channelType: ChannelType | string;
  channelId: string;
  channelName: string;
  recipient?: string;
}

/**
 * Cron job last run info
 */
export interface CronJobLastRun {
  time: string;
  success: boolean;
  error?: string;
  duration?: number;
}

/**
 * Gateway CronSchedule object format
 */
export type CronSchedule =
  | { kind: 'at'; at: string }
  | { kind: 'every'; everyMs: number; anchorMs?: number }
  | { kind: 'cron'; expr: string; tz?: string };

/**
 * Cron job data structure
 * schedule can be a plain cron string or a Gateway CronSchedule object
 */
export interface CronJob {
  id: string;
  name: string;
  message: string;
  schedule: string | CronSchedule;
  delivery?: CronJobDelivery;
  target?: CronJobTarget;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRun?: CronJobLastRun;
  nextRun?: string;
  agentId: string;
  /** Client-side validity window (app-enforced; not part of the Gateway job). */
  window?: CronJobWindow;
}

/**
 * Input for creating a cron job from the UI.
 *
 * `schedule` accepts either a plain cron expression string (normalized to a
 * `{ kind: 'cron', expr }` schedule by the Main process) or a structured
 * Gateway CronSchedule object (e.g. `{ kind: 'at', at }` for one-time tasks).
 */
export interface CronJobCreateInput {
  name: string;
  message: string;
  schedule: string | CronSchedule;
  delivery?: CronJobDelivery;
  enabled?: boolean;
  agentId?: string;
  /** Client-side validity window (app-enforced; stripped before the Gateway call). */
  window?: CronJobWindow;
}

/**
 * Input for updating a cron job
 */
export interface CronJobUpdateInput {
  name?: string;
  message?: string;
  schedule?: string | CronSchedule;
  delivery?: CronJobDelivery;
  enabled?: boolean;
  agentId?: string;
  /** Client-side validity window (app-enforced; stripped before the Gateway call). */
  window?: CronJobWindow;
}

/**
 * Schedule type for UI picker
 */
export type ScheduleType = 'daily' | 'weekly' | 'monthly' | 'interval' | 'custom';
