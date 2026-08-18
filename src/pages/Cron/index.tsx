/**
 * Cron Page
 * Manage scheduled tasks
 */
import {
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import {
  Plus,
  Clock,
  Play,
  Trash2,
  RefreshCw,
  X,
  Calendar,
  AlertCircle,
  CheckCircle2,
  XCircle,
  MessageSquare,
  Loader2,
  Timer,
  History,
  Pause,
  ChevronDown,
  Bot,
  Search,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  hostApi,
  type ChannelTargetOption,
  type DeliveryChannelAccount,
  type DeliveryChannelGroup,
} from '@/lib/host-api';
import { useCronStore } from '@/stores/cron';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { formatRelativeTime, cn } from '@/lib/utils';
import { fetchQuickAccessSkills } from '@/lib/quick-access-skills';
import { toast } from '@/lib/toast';
import { buildEnhancePromptGenPrompt } from '@/lib/enhance-prompt';
import type { CronJob, CronJobCreateInput, CronSchedule, ScheduleType } from '@/types/cron';
import type { QuickAccessSkill } from '@/types/skill';
import { CHANNEL_ICONS, CHANNEL_NAMES, type ChannelType } from '@/types/channel';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { isGatewayStopped } from '@/lib/gateway-status';

// Common cron schedule presets
const schedulePresets: { key: string; value: string; type: ScheduleType }[] = [
  { key: 'everyMinute', value: '* * * * *', type: 'interval' },
  { key: 'every5Min', value: '*/5 * * * *', type: 'interval' },
  { key: 'every15Min', value: '*/15 * * * *', type: 'interval' },
  { key: 'everyHour', value: '0 * * * *', type: 'interval' },
  { key: 'daily9am', value: '0 9 * * *', type: 'daily' },
  { key: 'daily6pm', value: '0 18 * * *', type: 'daily' },
  { key: 'weeklyMon', value: '0 9 * * 1', type: 'weekly' },
  { key: 'monthly1st', value: '0 9 1 * *', type: 'monthly' },
];

// ── Inline skill token helpers ───────────────────────────────────
// Mirrors the chat composer skill-token logic in src/pages/Chat/ChatInput.tsx:
// skills are inserted as `/skillName  ` tokens (trailing double space) and the
// textarea renders a transparent caret on top of a highlighted overlay. Unlike
// the chat composer, the cron dialog intentionally does NOT expose a preview
// affordance — the tokens are rendered as non-interactive spans.

type SkillTokenRange = { start: number; end: number };

// The message textarea grows with its content up to this height, after which it
// scrolls internally and the highlight overlay is scroll-synced to match it.
const CRON_MESSAGE_MAX_HEIGHT = 200;

function getSkillPrefix(skillName: string): string {
  return `/${skillName}  `;
}

function needsLeadingSkillSpace(value: string, position: number): boolean {
  return position > 0 && !/\s/.test(value[position - 1] ?? '');
}

function findSkillTokenRanges(value: string): SkillTokenRange[] {
  const ranges: SkillTokenRange[] = [];
  const skillTokenPattern = /\/[^\s]+ {2}/g;
  let match: RegExpExecArray | null;
  while ((match = skillTokenPattern.exec(value)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return ranges;
}

const SKILL_TOKEN_HIGHLIGHT_CLASS =
  'rounded-md bg-skill-bg/14 text-skill-fg [-webkit-box-decoration-break:clone] [box-decoration-break:clone] [text-shadow:0_0_10px_rgba(47,107,255,0.38)] dark:bg-skill-bg/18 dark:text-skill-fg-dark dark:[text-shadow:0_0_12px_rgba(37,99,235,0.42)]';

function renderHighlightedCronMessage(value: string, tokenRanges: SkillTokenRange[]) {
  if (tokenRanges.length === 0) {
    return (
      <>
        {value}
        {value.endsWith('\n') ? '\n' : '\u200b'}
      </>
    );
  }

  const chunks: ReactNode[] = [];
  let cursor = 0;

  for (const tokenRange of tokenRanges) {
    const token = value.slice(tokenRange.start, tokenRange.end);
    const tokenLabel = token.trimEnd();
    const tokenTrailingSpace = token.slice(tokenLabel.length);

    if (tokenRange.start > cursor) {
      chunks.push(value.slice(cursor, tokenRange.start));
    }
    chunks.push(
      <span
        key={`skill-token-${tokenRange.start}`}
        data-testid="cron-skill-token"
        className={cn('align-baseline', SKILL_TOKEN_HIGHLIGHT_CLASS)}
      >
        {tokenLabel}
      </span>,
      tokenTrailingSpace,
    );
    cursor = tokenRange.end;
  }

  if (cursor < value.length) {
    chunks.push(value.slice(cursor));
  }
  chunks.push(value.endsWith('\n') ? '\n' : '\u200b');

  return <>{chunks}</>;
}

// Parse cron schedule to human-readable format
// Handles both plain cron strings and Gateway CronSchedule objects:
//   { kind: "cron", expr: "...", tz?: "..." }
//   { kind: "every", everyMs: number }
//   { kind: "at", at: "..." }
function parseCronSchedule(schedule: unknown, t: TFunction<'cron'>): string {
  // Handle Gateway CronSchedule object format
  if (schedule && typeof schedule === 'object') {
    const s = schedule as { kind?: string; expr?: string; tz?: string; everyMs?: number; at?: string };
    if (s.kind === 'cron' && typeof s.expr === 'string') {
      return parseCronExpr(s.expr, t);
    }
    if (s.kind === 'every' && typeof s.everyMs === 'number') {
      const ms = s.everyMs;
      if (ms < 60_000) return t('schedule.everySeconds', { count: Math.round(ms / 1000) });
      if (ms < 3_600_000) return t('schedule.everyMinutes', { count: Math.round(ms / 60_000) });
      if (ms < 86_400_000) return t('schedule.everyHours', { count: Math.round(ms / 3_600_000) });
      return t('schedule.everyDays', { count: Math.round(ms / 86_400_000) });
    }
    if (s.kind === 'at' && typeof s.at === 'string') {
      try {
        return t('schedule.onceAt', { time: new Date(s.at).toLocaleString() });
      } catch {
        return t('schedule.onceAt', { time: s.at });
      }
    }
    return String(schedule);
  }

  // Handle plain cron string
  if (typeof schedule === 'string') {
    return parseCronExpr(schedule, t);
  }

  return String(schedule ?? t('schedule.unknown'));
}

// Parse a plain cron expression string to human-readable text
function parseCronExpr(cron: string, t: TFunction<'cron'>): string {
  const preset = schedulePresets.find((p) => p.value === cron);
  if (preset) return t(`presets.${preset.key}` as const);

  const parts = cron.split(' ');
  if (parts.length !== 5) return cron;

  const [minute, hour, dayOfMonth, , dayOfWeek] = parts;

  const isNum = (value: string) => /^\d+$/.test(value);
  if (minute === '*' && hour === '*') return t('presets.everyMinute');
  if (minute.startsWith('*/')) return t('schedule.everyMinutes', { count: Number(minute.slice(2)) });
  if (hour === '*' && dayOfMonth === '*' && dayOfWeek === '*' && isNum(minute)) {
    return minute === '0' ? t('presets.everyHour') : t('schedule.hourlyAt', { minute: minute.padStart(2, '0') });
  }
  if (dayOfMonth === '*' && dayOfWeek === '1-5' && isNum(minute) && isNum(hour)) {
    return t('schedule.weekdaysAt', { time: `${hour}:${minute.padStart(2, '0')}` });
  }
  if (dayOfWeek !== '*' && dayOfMonth === '*') {
    const days = dayOfWeek.split(',').map((part) => part.trim());
    const allWeekdayNums = days.every((day) => isNum(day) && Number(day) <= 6);
    const dayLabel = allWeekdayNums
      ? days.map((day) => t(`weekdays.${WEEKDAY_KEYS[Number(day)]}` as const)).join('、')
      : dayOfWeek;
    return t('schedule.weeklyAt', { day: dayLabel, time: `${hour}:${minute.padStart(2, '0')}` });
  }
  if (dayOfMonth !== '*') {
    return t('schedule.monthlyAtDay', { day: dayOfMonth, time: `${hour}:${minute.padStart(2, '0')}` });
  }
  if (hour !== '*') {
    return t('schedule.dailyAt', { time: `${hour}:${minute.padStart(2, '0')}` });
  }

  return cron;
}

function estimateNextRun(scheduleExpr: string): string | null {
  const now = new Date();
  const next = new Date(now.getTime());

  if (scheduleExpr === '* * * * *') {
    next.setSeconds(0, 0);
    next.setMinutes(next.getMinutes() + 1);
    return next.toLocaleString();
  }

  if (scheduleExpr === '*/5 * * * *') {
    const delta = 5 - (next.getMinutes() % 5 || 5);
    next.setSeconds(0, 0);
    next.setMinutes(next.getMinutes() + delta);
    return next.toLocaleString();
  }

  if (scheduleExpr === '*/15 * * * *') {
    const delta = 15 - (next.getMinutes() % 15 || 15);
    next.setSeconds(0, 0);
    next.setMinutes(next.getMinutes() + delta);
    return next.toLocaleString();
  }

  if (scheduleExpr === '0 * * * *') {
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    return next.toLocaleString();
  }

  if (scheduleExpr === '0 9 * * *' || scheduleExpr === '0 18 * * *') {
    const targetHour = scheduleExpr === '0 9 * * *' ? 9 : 18;
    next.setSeconds(0, 0);
    next.setHours(targetHour, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.toLocaleString();
  }

  if (scheduleExpr === '0 9 * * 1') {
    next.setSeconds(0, 0);
    next.setHours(9, 0, 0, 0);
    const day = next.getDay();
    const daysUntilMonday = day === 1 ? 7 : (8 - day) % 7;
    next.setDate(next.getDate() + daysUntilMonday);
    return next.toLocaleString();
  }

  if (scheduleExpr === '0 9 1 * *') {
    next.setSeconds(0, 0);
    next.setDate(1);
    next.setHours(9, 0, 0, 0);
    if (next <= now) next.setMonth(next.getMonth() + 1);
    return next.toLocaleString();
  }

  return null;
}

function isKnownChannelType(value: string): value is ChannelType {
  return value in CHANNEL_NAMES;
}

function getChannelDisplayName(value: string): string {
  return isKnownChannelType(value) ? CHANNEL_NAMES[value] : value;
}

function getDeliveryAccountDisplayName(account: DeliveryChannelAccount, t: TFunction): string {
  return account.accountId === 'default' && account.name === account.accountId
    ? t('channels:account.mainAccount')
    : account.name;
}

const TESTED_CRON_DELIVERY_CHANNELS = new Set<string>(['feishu', 'telegram', 'qqbot', 'wecom', 'wechat']);

function isSupportedCronDeliveryChannel(channelType: string): boolean {
  return TESTED_CRON_DELIVERY_CHANNELS.has(channelType);
}

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  children: ReactNode;
}

function SelectField({ className, children, ...props }: SelectFieldProps) {
  return (
    <div className="relative">
      <Select
        className={cn(
          'h-[44px] rounded-xl border-black/10 dark:border-white/10 bg-background text-meta pr-10 [background-image:none] appearance-none',
          className,
        )}
        {...props}
      >
        {children}
      </Select>
      <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

// Create/Edit Task Dialog
interface TaskDialogProps {
  open: boolean;
  job?: CronJob;
  configuredChannels: DeliveryChannelGroup[];
  onClose: () => void;
  onSave: (input: CronJobCreateInput) => Promise<void>;
}

// ── Schedule builder (recurring / once tabs) ─────────────────────

type ScheduleMode = 'recurring' | 'once';
type RecurrenceKind = 'minutely' | 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'custom';

const RECURRENCE_KINDS: RecurrenceKind[] = ['minutely', 'hourly', 'daily', 'weekdays', 'weekly', 'monthly', 'custom'];
// cron day-of-week is 0-6 with 0 = Sunday
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

interface ScheduleFormState {
  mode: ScheduleMode;
  recurrence: RecurrenceKind;
  timeOfDay: string; // HH:MM for daily/weekdays/weekly/monthly
  weekdays: number[]; // 0-6 for weekly (multi-select)
  dayOfMonth: number; // 1-31 for monthly
  hourlyMinute: number; // 0-59 for hourly
  customCron: string;
  onceDate: string; // YYYY-MM-DD
  onceTime: string; // HH:MM
}

/** Parse a cron day-of-week field (single number or comma list, 0-6) into a sorted unique array, or null. */
function parseWeekdayList(dow: string): number[] | null {
  const parts = dow.split(',').map((part) => part.trim());
  const days: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const value = Number(part);
    if (value < 0 || value > 6) return null;
    if (!days.includes(value)) days.push(value);
  }
  return days.length > 0 ? days.sort((a, b) => a - b) : null;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function toDateInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function toTimeInputValue(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function defaultScheduleForm(): ScheduleFormState {
  const now = new Date();
  return {
    mode: 'recurring',
    recurrence: 'daily',
    timeOfDay: '09:00',
    weekdays: [1],
    dayOfMonth: 1,
    hourlyMinute: 0,
    customCron: '',
    onceDate: toDateInputValue(now),
    onceTime: '09:00',
  };
}

function parseCronExprToForm(expr: string, base: ScheduleFormState): ScheduleFormState {
  const trimmed = expr.trim();
  const parts = trimmed.split(/\s+/);
  const isNum = (value: string) => /^\d+$/.test(value);
  if (parts.length !== 5) {
    return { ...base, mode: 'recurring', recurrence: 'custom', customCron: trimmed };
  }
  const [minute, hour, dom, mon, dow] = parts;
  if (minute === '*' && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return { ...base, mode: 'recurring', recurrence: 'minutely' };
  }
  if (isNum(minute) && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return {
      ...base,
      mode: 'recurring',
      recurrence: 'hourly',
      hourlyMinute: Math.min(59, Math.max(0, Number(minute))),
    };
  }
  if (isNum(minute) && isNum(hour)) {
    const timeOfDay = `${pad2(Number(hour))}:${pad2(Number(minute))}`;
    if (isNum(dom) && mon === '*' && dow === '*') {
      return {
        ...base,
        mode: 'recurring',
        recurrence: 'monthly',
        dayOfMonth: Math.min(31, Math.max(1, Number(dom))),
        timeOfDay,
      };
    }
    if (dom === '*' && mon === '*') {
      if (dow === '*') return { ...base, mode: 'recurring', recurrence: 'daily', timeOfDay };
      if (dow === '1-5') return { ...base, mode: 'recurring', recurrence: 'weekdays', timeOfDay };
      const weekdays = parseWeekdayList(dow);
      if (weekdays) return { ...base, mode: 'recurring', recurrence: 'weekly', weekdays, timeOfDay };
    }
  }
  return { ...base, mode: 'recurring', recurrence: 'custom', customCron: trimmed };
}

function parseScheduleToForm(job?: CronJob): ScheduleFormState {
  const base = defaultScheduleForm();
  const schedule = job?.schedule;
  if (!schedule) return base;
  if (typeof schedule === 'string') {
    return schedule.trim() ? parseCronExprToForm(schedule, base) : base;
  }
  if (typeof schedule === 'object') {
    if (schedule.kind === 'at' && typeof schedule.at === 'string') {
      const date = new Date(schedule.at);
      if (!Number.isNaN(date.getTime())) {
        return { ...base, mode: 'once', onceDate: toDateInputValue(date), onceTime: toTimeInputValue(date) };
      }
      return { ...base, mode: 'once' };
    }
    if (schedule.kind === 'cron' && typeof schedule.expr === 'string') {
      return parseCronExprToForm(schedule.expr, base);
    }
    // 'every' (interval) schedules are not editable through this builder.
    return base;
  }
  return base;
}

function buildScheduleFromForm(form: ScheduleFormState): string | CronSchedule {
  if (form.mode === 'once') {
    const dateTime = new Date(`${form.onceDate}T${form.onceTime || '00:00'}`);
    return { kind: 'at', at: dateTime.toISOString() };
  }
  const [hourRaw, minuteRaw] = (form.timeOfDay || '09:00').split(':');
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  switch (form.recurrence) {
    case 'minutely':
      return '* * * * *';
    case 'hourly':
      return `${form.hourlyMinute} * * * *`;
    case 'daily':
      return `${minute} ${hour} * * *`;
    case 'weekdays':
      return `${minute} ${hour} * * 1-5`;
    case 'weekly':
      return `${minute} ${hour} * * ${[...form.weekdays].sort((a, b) => a - b).join(',')}`;
    case 'monthly':
      return `${minute} ${hour} ${form.dayOfMonth} * *`;
    case 'custom':
    default:
      return form.customCron.trim();
  }
}

function computeNextRunPreviewFromForm(form: ScheduleFormState): string | null {
  const now = new Date();
  if (form.mode === 'once') {
    const dateTime = new Date(`${form.onceDate}T${form.onceTime || '00:00'}`);
    return Number.isNaN(dateTime.getTime()) ? null : dateTime.toLocaleString();
  }
  const [hourRaw, minuteRaw] = (form.timeOfDay || '09:00').split(':');
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const next = new Date(now.getTime());
  next.setSeconds(0, 0);
  switch (form.recurrence) {
    case 'minutely': {
      next.setMinutes(next.getMinutes() + 1);
      return next.toLocaleString();
    }
    case 'hourly': {
      next.setMinutes(form.hourlyMinute);
      if (next <= now) next.setHours(next.getHours() + 1);
      return next.toLocaleString();
    }
    case 'daily': {
      next.setHours(hour, minute, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      return next.toLocaleString();
    }
    case 'weekdays': {
      next.setHours(hour, minute, 0, 0);
      while (next <= now || next.getDay() === 0 || next.getDay() === 6) {
        next.setDate(next.getDate() + 1);
        next.setHours(hour, minute, 0, 0);
      }
      return next.toLocaleString();
    }
    case 'weekly': {
      if (form.weekdays.length === 0) return null;
      let best: Date | null = null;
      for (const weekday of form.weekdays) {
        const candidate = new Date(now.getTime());
        candidate.setSeconds(0, 0);
        candidate.setHours(hour, minute, 0, 0);
        const dayDelta = (weekday - candidate.getDay() + 7) % 7;
        candidate.setDate(candidate.getDate() + dayDelta);
        if (candidate <= now) candidate.setDate(candidate.getDate() + 7);
        if (!best || candidate < best) best = candidate;
      }
      return best ? best.toLocaleString() : null;
    }
    case 'monthly': {
      for (let offset = 0; offset <= 12; offset += 1) {
        const candidate = new Date(now.getFullYear(), now.getMonth() + offset, form.dayOfMonth, hour, minute, 0, 0);
        // Skip months without this day-of-month (e.g. Feb 30 rolls over).
        if (candidate.getDate() === form.dayOfMonth && candidate > now) {
          return candidate.toLocaleString();
        }
      }
      return null;
    }
    case 'custom':
    default:
      return estimateNextRun(form.customCron.trim());
  }
}

interface ScheduleTimePickerProps {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  'data-testid'?: string;
}

/** Two-column 24h time picker (hours 0-23 / minutes 0-59) with a neutral grey selection. */
function ScheduleTimePicker({ id, value, onChange, 'data-testid': testId }: ScheduleTimePickerProps) {
  const { t } = useTranslation('cron');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const hourListRef = useRef<HTMLDivElement>(null);
  const minuteListRef = useRef<HTMLDivElement>(null);

  const [hourRaw, minuteRaw] = (value || '09:00').split(':');
  const selectedHour = Math.min(23, Math.max(0, Math.floor(Number(hourRaw) || 0)));
  const selectedMinute = Math.min(59, Math.max(0, Math.floor(Number(minuteRaw) || 0)));

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    hourListRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'center' });
    minuteListRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'center' });
  }, [open]);

  const cellClass = (active: boolean) =>
    cn(
      'block w-full rounded-md py-1.5 text-center font-mono text-meta transition-colors',
      active
        ? 'bg-black/5 dark:bg-white/10 text-foreground font-semibold'
        : 'text-foreground/70 hover:bg-black/5 dark:hover:bg-white/5',
    );

  return (
    <div ref={containerRef} className="relative">
      <button
        id={id}
        type="button"
        data-testid={testId}
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-[44px] w-full items-center justify-between rounded-xl border border-black/10 dark:border-white/10 bg-transparent px-3 font-mono text-meta text-foreground shadow-sm transition-colors hover:bg-black/5 dark:hover:bg-white/5"
      >
        <span>
          {pad2(selectedHour)}:{pad2(selectedMinute)}
        </span>
        <Clock className="h-4 w-4 opacity-50" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1.5 w-full overflow-hidden rounded-xl border border-black/10 dark:border-white/10 bg-background shadow-lg">
          <div className="grid grid-cols-2 text-center text-meta font-medium text-muted-foreground">
            <div className="border-r border-black/5 dark:border-white/5 py-1.5">{t('dialog.hourColumn')}</div>
            <div className="py-1.5">{t('dialog.minuteColumn')}</div>
          </div>
          <div className="grid grid-cols-2">
            <div
              ref={hourListRef}
              className="max-h-[200px] overflow-y-auto border-r border-black/5 dark:border-white/5 px-1 pb-1"
            >
              {Array.from({ length: 24 }, (_, hour) => (
                <button
                  key={hour}
                  type="button"
                  data-selected={hour === selectedHour}
                  onClick={() => onChange(`${pad2(hour)}:${pad2(selectedMinute)}`)}
                  className={cellClass(hour === selectedHour)}
                >
                  {pad2(hour)}
                </button>
              ))}
            </div>
            <div ref={minuteListRef} className="max-h-[200px] overflow-y-auto px-1 pb-1">
              {Array.from({ length: 60 }, (_, minute) => (
                <button
                  key={minute}
                  type="button"
                  data-selected={minute === selectedMinute}
                  onClick={() => onChange(`${pad2(selectedHour)}:${pad2(minute)}`)}
                  className={cellClass(minute === selectedMinute)}
                >
                  {pad2(minute)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TaskDialog({ open, job, configuredChannels, onClose, onSave }: TaskDialogProps) {
  const { t } = useTranslation('cron');
  const [saving, setSaving] = useState(false);
  const agents = useAgentsStore((s) => s.agents);

  const [name, setName] = useState(job?.name || '');
  const [message, setMessage] = useState(job?.message || '');
  const [enhancingPrompt, setEnhancingPrompt] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState(job?.agentId || useChatStore.getState().currentAgentId);
  const [scheduleForm, setScheduleForm] = useState<ScheduleFormState>(() => parseScheduleToForm(job));
  const [enabled, setEnabled] = useState(job?.window?.desiredEnabled ?? job?.enabled ?? true);
  const [windowStart, setWindowStart] = useState(job?.window?.start || '');
  const [windowEnd, setWindowEnd] = useState(job?.window?.end || '');
  const [deliveryMode, setDeliveryMode] = useState<'none' | 'announce'>(
    job?.delivery?.mode === 'announce' ? 'announce' : 'none',
  );
  const [deliveryChannel, setDeliveryChannel] = useState(job?.delivery?.channel || '');
  const [deliveryTarget, setDeliveryTarget] = useState(job?.delivery?.to || '');
  const [selectedDeliveryAccountId, setSelectedDeliveryAccountId] = useState(job?.delivery?.accountId || '');
  const [channelTargetOptions, setChannelTargetOptions] = useState<ChannelTargetOption[]>([]);
  const [loadingChannelTargets, setLoadingChannelTargets] = useState(false);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState('');
  const [quickSkills, setQuickSkills] = useState<QuickAccessSkill[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const messageOverlayRef = useRef<HTMLDivElement>(null);
  const skillPickerRef = useRef<HTMLDivElement>(null);
  const [prevOpen, setPrevOpen] = useState(open);

  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setSaving(false);
      setName(job?.name || '');
      setMessage(job?.message || '');
      setSelectedAgentId(job?.agentId || useChatStore.getState().currentAgentId);
      setScheduleForm(parseScheduleToForm(job));
      setEnabled(job?.window?.desiredEnabled ?? job?.enabled ?? true);
      setWindowStart(job?.window?.start || '');
      setWindowEnd(job?.window?.end || '');
      setDeliveryMode(job?.delivery?.mode === 'announce' ? 'announce' : 'none');
      setDeliveryChannel(job?.delivery?.channel || '');
      setDeliveryTarget(job?.delivery?.to || '');
      setSelectedDeliveryAccountId(job?.delivery?.accountId || '');
      setChannelTargetOptions([]);
      setLoadingChannelTargets(false);
      setSkillPickerOpen(false);
      setSkillQuery('');
      setQuickSkills([]);
      setSkillsError(null);
      setSkillsLoading(false);
    }
  }

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  );
  const skillTokenRanges = useMemo(() => findSkillTokenRanges(message), [message]);
  const filteredQuickSkills = useMemo(() => {
    const query = skillQuery.trim().toLowerCase();
    if (!query) return quickSkills;
    return quickSkills.filter(
      (skill) =>
        skill.name.toLowerCase().includes(query) ||
        skill.description.toLowerCase().includes(query) ||
        skill.sourceLabel.toLowerCase().includes(query),
    );
  }, [quickSkills, skillQuery]);

  const loadQuickSkills = useCallback(async () => {
    if (!selectedAgent) {
      setQuickSkills([]);
      setSkillsError(null);
      return;
    }
    setSkillsLoading(true);
    setSkillsError(null);
    try {
      const result = await fetchQuickAccessSkills({
        workspace: selectedAgent.workspace,
        agentDir: selectedAgent.agentDir,
      });
      if (!result.success) {
        throw new Error(result.error || 'Failed to load skills');
      }
      setQuickSkills(result.skills || []);
    } catch (error) {
      setQuickSkills([]);
      setSkillsError(String(error));
    } finally {
      setSkillsLoading(false);
    }
  }, [selectedAgent]);

  // Reset the skill list whenever the target agent changes so stale skills
  // from a previous agent are not offered for insertion.
  useEffect(() => {
    setSkillPickerOpen(false);
    setSkillQuery('');
    setQuickSkills([]);
    setSkillsError(null);
  }, [selectedAgentId]);

  useEffect(() => {
    if (!skillPickerOpen) return;
    void loadQuickSkills();
  }, [skillPickerOpen, loadQuickSkills]);

  useEffect(() => {
    if (!skillPickerOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!skillPickerRef.current?.contains(event.target as Node)) {
        setSkillPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [skillPickerOpen]);

  // The highlight overlay is absolutely positioned on top of the textarea and is
  // the only visible copy of the text once a skill token exists, so it has to
  // follow the textarea's scroll offset or edits below the fold become invisible.
  const syncMessageOverlayScroll = useCallback(() => {
    const textarea = messageRef.current;
    const overlay = messageOverlayRef.current;
    if (!textarea || !overlay) return;
    overlay.scrollTop = textarea.scrollTop;
    overlay.scrollLeft = textarea.scrollLeft;
  }, []);

  useLayoutEffect(() => {
    const textarea = messageRef.current;
    if (!textarea) return;
    const previousScrollTop = textarea.scrollTop;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, CRON_MESSAGE_MAX_HEIGHT)}px`;
    textarea.scrollTop = previousScrollTop;
    // On platforms with classic scrollbars the textarea's scrollbar gutter eats
    // into its content width; the overlay has to lose the same width or the two
    // copies of the text wrap at different columns.
    const overlay = messageOverlayRef.current;
    if (overlay) {
      overlay.style.paddingRight = `${Math.max(0, textarea.offsetWidth - textarea.clientWidth)}px`;
    }
    syncMessageOverlayScroll();
  }, [message, open, syncMessageOverlayScroll]);

  const moveMessageCaretTo = useCallback(
    (position: number) => {
      const textarea = messageRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(position, position);
      syncMessageOverlayScroll();
      requestAnimationFrame(() => {
        messageRef.current?.focus();
        messageRef.current?.setSelectionRange(position, position);
        syncMessageOverlayScroll();
      });
    },
    [syncMessageOverlayScroll],
  );

  const handleEnhancePrompt = useCallback(async () => {
    const draft = message.trim();
    if (!draft || enhancingPrompt) return;
    setEnhancingPrompt(true);
    try {
      const { system, input } = buildEnhancePromptGenPrompt(draft);
      const res = await hostApi.agents.generateText({ agentId: selectedAgentId, system, input }) as {
        success: boolean;
        text?: string;
        error?: string;
      };
      if (!res.success || !res.text) throw new Error(res.error || 'Generation failed');
      setMessage(res.text);
    } catch (error) {
      toast.error(t('dialog.enhancePromptFailed', { error: String(error) }));
    } finally {
      setEnhancingPrompt(false);
    }
  }, [enhancingPrompt, message, selectedAgentId, t]);

  const normalizeMessageSelection = useCallback(() => {
    if (skillTokenRanges.length === 0) return;
    const textarea = messageRef.current;
    if (!textarea) return;
    const selectionStart = textarea.selectionStart ?? 0;
    const selectionEnd = textarea.selectionEnd ?? 0;
    if (selectionStart !== selectionEnd) return;
    const tokenRange = skillTokenRanges.find((range) => selectionStart > range.start && selectionStart < range.end);
    if (tokenRange) {
      moveMessageCaretTo(tokenRange.end);
    }
  }, [moveMessageCaretTo, skillTokenRanges]);

  const handleMessageKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Backspace') {
        const textarea = messageRef.current;
        const selectionStart = textarea?.selectionStart ?? 0;
        const selectionEnd = textarea?.selectionEnd ?? 0;
        const tokenRange = skillTokenRanges.find(
          (range) => selectionStart === selectionEnd && selectionStart > range.start && selectionStart <= range.end,
        );
        if (tokenRange) {
          e.preventDefault();
          const nextValue = `${message.slice(0, tokenRange.start)}${message.slice(tokenRange.end)}`;
          setMessage(nextValue);
          moveMessageCaretTo(tokenRange.start);
          return;
        }
      }
      if (e.key === 'ArrowLeft' && skillTokenRanges.length > 0) {
        const textarea = messageRef.current;
        const selectionStart = textarea?.selectionStart ?? 0;
        const selectionEnd = textarea?.selectionEnd ?? 0;
        const tokenRange = skillTokenRanges.find(
          (range) => selectionStart === selectionEnd && selectionStart === range.end,
        );
        if (tokenRange) {
          e.preventDefault();
          moveMessageCaretTo(tokenRange.start);
          return;
        }
      }
      if (e.key === 'ArrowRight' && skillTokenRanges.length > 0) {
        const textarea = messageRef.current;
        const selectionStart = textarea?.selectionStart ?? 0;
        const selectionEnd = textarea?.selectionEnd ?? 0;
        const tokenRange = skillTokenRanges.find(
          (range) => selectionStart === selectionEnd && selectionStart === range.start,
        );
        if (tokenRange) {
          e.preventDefault();
          moveMessageCaretTo(tokenRange.end);
          return;
        }
      }
      if (e.key === 'Escape' && skillPickerOpen) {
        e.preventDefault();
        setSkillPickerOpen(false);
      }
    },
    [message, moveMessageCaretTo, skillPickerOpen, skillTokenRanges],
  );

  const handleInsertSkill = useCallback(
    (skill: QuickAccessSkill) => {
      const textarea = messageRef.current;
      const nextToken = getSkillPrefix(skill.name);
      const selectionStart = textarea?.selectionStart ?? message.length;
      const selectionEnd = textarea?.selectionEnd ?? message.length;
      const leadingSpace = needsLeadingSkillSpace(message, selectionStart) ? ' ' : '';
      const nextValue = `${message.slice(0, selectionStart)}${leadingSpace}${nextToken}${message.slice(selectionEnd)}`;
      setMessage(nextValue);
      setSkillPickerOpen(false);
      setSkillQuery('');
      requestAnimationFrame(() => {
        messageRef.current?.focus();
        const cursorPosition = selectionStart + leadingSpace.length + nextToken.length;
        messageRef.current?.setSelectionRange(cursorPosition, cursorPosition);
        syncMessageOverlayScroll();
      });
    },
    [message, syncMessageOverlayScroll],
  );
  const updateSchedule = useCallback(
    (patch: Partial<ScheduleFormState>) => setScheduleForm((prev) => ({ ...prev, ...patch })),
    [],
  );
  const schedulePreview = computeNextRunPreviewFromForm(scheduleForm);
  const onceWeekdayLabel = (() => {
    if (!scheduleForm.onceDate) return '';
    const date = new Date(`${scheduleForm.onceDate}T00:00`);
    return Number.isNaN(date.getTime()) ? '' : t(`weekdays.${WEEKDAY_KEYS[date.getDay()]}` as const);
  })();
  const selectableChannels = configuredChannels.filter((group) => isSupportedCronDeliveryChannel(group.channelType));
  const availableChannels = selectableChannels.some((group) => group.channelType === deliveryChannel)
    ? selectableChannels
    : deliveryChannel && isSupportedCronDeliveryChannel(deliveryChannel)
      ? [
          ...selectableChannels,
          configuredChannels.find((group) => group.channelType === deliveryChannel) || {
            channelType: deliveryChannel,
            defaultAccountId: 'default',
            accounts: [],
          },
        ]
      : selectableChannels;
  const effectiveDeliveryChannel =
    deliveryChannel || (deliveryMode === 'announce' ? availableChannels[0]?.channelType || '' : '');
  const unsupportedDeliveryChannel =
    !!effectiveDeliveryChannel && !isSupportedCronDeliveryChannel(effectiveDeliveryChannel);
  const selectedChannel = availableChannels.find((group) => group.channelType === effectiveDeliveryChannel);
  const deliveryAccountOptions = (selectedChannel?.accounts ?? []).map((account) => ({
    accountId: account.accountId,
    displayName: getDeliveryAccountDisplayName(account, t),
  }));
  // Prefer the fetched option's friendly label (user / group name) for the saved
  // target; only synthesize a fallback entry when the value isn't in the fetched
  // list, and even then avoid dumping the raw id into the label.
  const matchedTargetOption = deliveryTarget
    ? channelTargetOptions.find((option) => option.value === deliveryTarget)
    : undefined;
  const fallbackTargetOption = deliveryTarget && !matchedTargetOption
    ? { value: deliveryTarget, label: t('dialog.currentTarget'), kind: 'user' as const }
    : null;
  const effectiveDeliveryAccountId =
    selectedDeliveryAccountId || selectedChannel?.defaultAccountId || deliveryAccountOptions[0]?.accountId || '';
  const showsAccountSelector = (selectedChannel?.accounts.length ?? 0) > 0;
  const selectedResolvedAccountId = effectiveDeliveryAccountId || undefined;
  const availableTargetOptions = fallbackTargetOption
    ? [fallbackTargetOption, ...channelTargetOptions]
    : channelTargetOptions;

  useEffect(() => {
    if (deliveryMode !== 'announce') {
      setSelectedDeliveryAccountId('');
      return;
    }

    if (!selectedDeliveryAccountId && selectedChannel?.defaultAccountId) {
      setSelectedDeliveryAccountId(selectedChannel.defaultAccountId);
    }
  }, [deliveryMode, selectedChannel?.defaultAccountId, selectedDeliveryAccountId]);

  useEffect(() => {
    if (deliveryMode !== 'announce' || !effectiveDeliveryChannel || unsupportedDeliveryChannel) {
      setChannelTargetOptions([]);
      setLoadingChannelTargets(false);
      return;
    }

    if (showsAccountSelector && !selectedResolvedAccountId) {
      setChannelTargetOptions([]);
      setLoadingChannelTargets(false);
      return;
    }

    let cancelled = false;
    setLoadingChannelTargets(true);
    void hostApi.channels
      .targets({
        channelType: effectiveDeliveryChannel,
        accountId: selectedResolvedAccountId,
      })
      .then((result) => {
        if (cancelled) return;
        if (!result.success) {
          throw new Error(result.error || 'Failed to load channel targets');
        }
        setChannelTargetOptions(result.targets || []);
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn('Failed to load channel targets:', error);
          setChannelTargetOptions([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingChannelTargets(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    deliveryMode,
    effectiveDeliveryChannel,
    selectedResolvedAccountId,
    showsAccountSelector,
    unsupportedDeliveryChannel,
  ]);

  // Auto-select a sensible default recipient once targets load, so the user
  // doesn't have to pick one after choosing a sending account. Prefer the
  // account's recommended target (feishu "App Owner"), then any user, then the
  // first option. Skips when a target is already set (e.g. editing a job).
  useEffect(() => {
    if (deliveryMode !== 'announce' || deliveryTarget || loadingChannelTargets) return;
    if (channelTargetOptions.length === 0) return;
    const recommended =
      channelTargetOptions.find((option) => option.kind === 'user' && /app owner/i.test(option.label)) ??
      channelTargetOptions.find((option) => option.kind === 'user') ??
      channelTargetOptions[0];
    if (recommended) setDeliveryTarget(recommended.value);
  }, [deliveryMode, deliveryTarget, loadingChannelTargets, channelTargetOptions]);

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error(t('toast.nameRequired'));
      return;
    }
    if (!message.trim()) {
      toast.error(t('toast.messageRequired'));
      return;
    }

    if (scheduleForm.mode === 'once') {
      const onceDateTime = new Date(`${scheduleForm.onceDate}T${scheduleForm.onceTime || '00:00'}`);
      if (!scheduleForm.onceDate || Number.isNaN(onceDateTime.getTime())) {
        toast.error(t('toast.scheduleRequired'));
        return;
      }
      if (onceDateTime.getTime() <= Date.now()) {
        toast.error(t('toast.schedulePast'));
        return;
      }
    } else if (scheduleForm.recurrence === 'custom' && !scheduleForm.customCron.trim()) {
      toast.error(t('toast.scheduleRequired'));
      return;
    } else if (scheduleForm.recurrence === 'weekly' && scheduleForm.weekdays.length === 0) {
      toast.error(t('toast.weekdayRequired'));
      return;
    }
    // Validity window only applies to recurring tasks (one-time tasks self-delete).
    const hasWindow = scheduleForm.mode === 'recurring' && (!!windowStart || !!windowEnd);
    if (hasWindow && windowStart && windowEnd && windowEnd < windowStart) {
      toast.error(t('toast.windowEndBeforeStart'));
      return;
    }
    const finalSchedule = buildScheduleFromForm(scheduleForm);

    setSaving(true);
    try {
      const finalDelivery =
        deliveryMode === 'announce'
          ? {
              mode: 'announce' as const,
              channel: effectiveDeliveryChannel.trim(),
              ...(selectedResolvedAccountId ? { accountId: effectiveDeliveryAccountId } : {}),
              to: deliveryTarget.trim(),
            }
          : { mode: 'none' as const };

      if (finalDelivery.mode === 'announce') {
        if (!finalDelivery.channel) {
          toast.error(t('toast.channelRequired'));
          return;
        }
        if (!isSupportedCronDeliveryChannel(finalDelivery.channel)) {
          toast.error(t('toast.deliveryChannelUnsupported', { channel: getChannelDisplayName(finalDelivery.channel) }));
          return;
        }
        if (!finalDelivery.to) {
          toast.error(t('toast.deliveryTargetRequired'));
          return;
        }
      }

      await onSave({
        name: name.trim(),
        message: message.trim(),
        schedule: finalSchedule,
        delivery: finalDelivery,
        enabled,
        agentId: selectedAgentId,
        // Always send the window so the backend can persist OR clear it. Empty
        // start/end => no constraint (cleared). `desiredEnabled` mirrors intent.
        window:
          scheduleForm.mode === 'recurring'
            ? { start: windowStart || undefined, end: windowEnd || undefined, desiredEnabled: enabled }
            : { desiredEnabled: enabled },
      });
      onClose();
      toast.success(job ? t('toast.updated') : t('toast.created'));
    } catch (err) {
      toast.appError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        asChild
        className="w-[calc(100%-2rem)] max-w-lg max-h-[90vh] flex flex-col rounded-3xl border-0 shadow-2xl bg-surface-modal overflow-hidden"
      >
        <Card data-testid="cron-task-dialog">
          <CardHeader className="flex flex-row items-start justify-between pb-2 shrink-0">
            <div>
              <DialogTitle asChild>
                <CardTitle className="text-2xl font-serif font-normal">
                  {job ? t('dialog.editTitle') : t('dialog.createTitle')}
                </CardTitle>
              </DialogTitle>
              <DialogDescription asChild>
                <CardDescription className="text-sm mt-1 text-foreground/70">{t('dialog.description')}</CardDescription>
              </DialogDescription>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="rounded-full h-8 w-8 -mr-2 -mt-2 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5"
            >
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-6 pt-4 overflow-y-auto flex-1 p-6">
            {/* Name */}
            <div className="space-y-2.5">
              <Label htmlFor="name" className="text-sm text-foreground/80 font-bold">
                {t('dialog.taskName')}
              </Label>
              <Input
                id="name"
                placeholder={t('dialog.taskNamePlaceholder')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-[44px] rounded-xl font-mono text-meta bg-transparent border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary shadow-sm transition-all text-foreground placeholder:text-foreground/40"
              />
            </div>

            {/* Message */}
            <div className="space-y-2.5">
              <Label htmlFor="message" className="text-sm text-foreground/80 font-bold">
                {t('dialog.message')}
              </Label>
              <div className="relative rounded-xl border border-black/10 dark:border-white/10 bg-transparent px-3 pt-2.5 pb-1.5 shadow-sm transition-all focus-within:ring-2 focus-within:ring-primary/50 focus-within:border-primary">
                {/* Text Row */}
                <div className="relative">
                  {skillTokenRanges.length > 0 && (
                    <div
                      aria-hidden="true"
                      ref={messageOverlayRef}
                      data-testid="cron-message-highlight"
                      className="pointer-events-none absolute inset-0 z-20 overflow-hidden whitespace-pre-wrap break-words font-mono text-meta md:text-sm leading-[18px] text-foreground"
                    >
                      {renderHighlightedCronMessage(message, skillTokenRanges)}
                    </div>
                  )}
                  <Textarea
                    id="message"
                    ref={messageRef}
                    placeholder={t('dialog.messagePlaceholder')}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={handleMessageKeyDown}
                    onSelect={normalizeMessageSelection}
                    onClick={normalizeMessageSelection}
                    onScroll={syncMessageOverlayScroll}
                    rows={3}
                    style={{ maxHeight: CRON_MESSAGE_MAX_HEIGHT }}
                    className={cn(
                      'relative min-h-[60px] w-full resize-none border-0 bg-transparent p-0 font-mono text-meta md:text-sm leading-[18px] text-foreground placeholder:text-foreground/40 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 [scrollbar-gutter:stable]',
                      skillTokenRanges.length > 0
                        ? 'z-0 text-transparent caret-foreground selection:bg-primary/20'
                        : 'z-10',
                    )}
                  />
                </div>

                {/* Action Row */}
                <div className="mt-1.5 flex items-center gap-1">
                  <div ref={skillPickerRef} className="relative shrink-0">
                    <button
                      type="button"
                      data-testid="cron-skill-button"
                      onClick={() => setSkillPickerOpen((isOpen) => !isOpen)}
                      title={t('dialog.pickSkill')}
                      className={cn(
                        'inline-flex h-8 items-center gap-1 rounded-lg px-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground focus-visible:outline-none focus-visible:ring-0',
                        skillPickerOpen && 'text-foreground',
                      )}
                    >
                      <span>{t('dialog.skillButton')}</span>
                      <ChevronDown
                        className={cn('h-3 w-3 transition-transform', skillPickerOpen && 'rotate-180')}
                      />
                    </button>
                    {skillPickerOpen && (
                      <div className="absolute left-0 top-full z-30 mt-2 w-80 overflow-hidden rounded-2xl border border-black/10 bg-surface-modal p-1.5 shadow-xl dark:border-white/10">
                        <div className="flex items-center gap-2 rounded-xl border border-black/10 bg-black/[0.03] px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                          <Search className="h-3.5 w-3.5 text-muted-foreground" />
                          <input
                            value={skillQuery}
                            onChange={(event) => setSkillQuery(event.target.value)}
                            placeholder={t('dialog.skillSearchPlaceholder')}
                            className="w-full bg-transparent text-meta outline-none placeholder:text-muted-foreground/70"
                            autoFocus
                          />
                        </div>
                        <div className="px-3 py-2 text-tiny font-medium text-muted-foreground/80">
                          {t('dialog.skillPickerTitle', { agent: selectedAgent?.name ?? '' })}
                        </div>
                        <div className="max-h-64 overflow-y-auto">
                          {skillsLoading ? (
                            <div className="px-3 py-4 text-xs text-muted-foreground">{t('dialog.skillLoading')}</div>
                          ) : skillsError ? (
                            <div className="px-3 py-4 text-xs text-destructive">{skillsError}</div>
                          ) : filteredQuickSkills.length === 0 ? (
                            <div className="px-3 py-4 text-xs text-muted-foreground">{t('dialog.skillEmpty')}</div>
                          ) : (
                            filteredQuickSkills.map((skill) => (
                              <button
                                key={`${skill.source}:${skill.name}`}
                                type="button"
                                data-testid={`cron-skill-option-${skill.name}`}
                                onClick={() => handleInsertSkill(skill)}
                                title={skill.description}
                                className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                              >
                                <div className="min-w-0">
                                  <div className="truncate text-meta font-semibold text-foreground">
                                    <span className="font-mono">/{skill.name}</span>
                                  </div>
                                  <div className="truncate text-tiny text-muted-foreground">{skill.sourceLabel}</div>
                                </div>
                                <span className="rounded-full border border-black/10 bg-black/[0.03] px-2 py-0.5 text-2xs font-medium text-muted-foreground dark:border-white/10 dark:bg-white/[0.04]">
                                  {skill.sourceLabel}
                                </span>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    data-testid="cron-enhance-prompt-button"
                    onClick={() => void handleEnhancePrompt()}
                    disabled={enhancingPrompt || !message.trim()}
                    title={t('dialog.enhancePrompt')}
                    className="inline-flex h-8 items-center gap-1 rounded-lg px-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground focus-visible:outline-none focus-visible:ring-0 disabled:pointer-events-none disabled:opacity-50"
                  >
                    {enhancingPrompt ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Agent */}
            <div className="space-y-2.5">
              <Label htmlFor="agent" className="text-sm text-foreground/80 font-bold">
                {t('dialog.agent')}
              </Label>
              <SelectField
                id="agent"
                value={selectedAgentId}
                onChange={(e) => {
                  setSelectedAgentId(e.target.value);
                }}
                className="h-[44px] rounded-xl border-black/10 dark:border-white/10 bg-transparent text-meta"
              >
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </SelectField>
            </div>

            {/* Schedule */}
            <div className="space-y-2.5">
              <Label className="text-sm text-foreground/80 font-bold">{t('dialog.schedule')}</Label>

              {/* Mode tabs */}
              <div className="inline-flex w-full gap-1 rounded-xl bg-black/5 p-1 dark:bg-white/10">
                {(['recurring', 'once'] as ScheduleMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    data-testid={`cron-schedule-tab-${mode}`}
                    onClick={() => updateSchedule({ mode })}
                    className={cn(
                      'flex-1 h-8 rounded-lg text-sm font-medium transition-colors',
                      scheduleForm.mode === mode
                        ? 'bg-surface-modal text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {t(`dialog.scheduleMode.${mode}` as const)}
                  </button>
                ))}
              </div>

              {scheduleForm.mode === 'recurring' ? (
                <div className="space-y-2.5">
                  <SelectField
                    data-testid="cron-recurrence-select"
                    value={scheduleForm.recurrence}
                    onChange={(e) => updateSchedule({ recurrence: e.target.value as RecurrenceKind })}
                  >
                    {RECURRENCE_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {t(`dialog.recurrence.${kind}` as const)}
                      </option>
                    ))}
                  </SelectField>

                  {scheduleForm.recurrence === 'minutely' && (
                    <p className="text-meta text-muted-foreground">{t('dialog.minutelyHint')}</p>
                  )}

                  {scheduleForm.recurrence === 'hourly' && (
                    <div className="space-y-1.5">
                      <Label htmlFor="cron-hourly-minute" className="text-meta text-foreground/70 font-medium">
                        {t('dialog.minuteLabel')}
                      </Label>
                      <Input
                        id="cron-hourly-minute"
                        type="number"
                        min={0}
                        max={59}
                        value={scheduleForm.hourlyMinute}
                        onChange={(e) =>
                          updateSchedule({
                            hourlyMinute: Math.min(59, Math.max(0, Math.floor(Number(e.target.value) || 0))),
                          })
                        }
                        className="h-[44px] rounded-xl font-mono text-meta bg-transparent border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary shadow-sm transition-all text-foreground placeholder:text-foreground/40"
                      />
                    </div>
                  )}

                  {(scheduleForm.recurrence === 'daily' || scheduleForm.recurrence === 'weekdays') && (
                    <div className="space-y-1.5">
                      <Label htmlFor="cron-time" className="text-meta text-foreground/70 font-medium">
                        {t('dialog.timeLabel')}
                      </Label>
                      <ScheduleTimePicker
                        id="cron-time"
                        value={scheduleForm.timeOfDay}
                        onChange={(next) => updateSchedule({ timeOfDay: next })}
                      />
                    </div>
                  )}

                  {scheduleForm.recurrence === 'weekly' && (
                    <div className="space-y-2.5">
                      <div className="space-y-1.5">
                        <Label className="text-meta text-foreground/70 font-medium">{t('dialog.weekdaysLabel')}</Label>
                        <div data-testid="cron-weekday-select" className="flex flex-wrap gap-1.5">
                          {WEEKDAY_KEYS.map((key, index) => {
                            const active = scheduleForm.weekdays.includes(index);
                            return (
                              <button
                                key={key}
                                type="button"
                                aria-pressed={active}
                                data-testid={`cron-weekday-${index}`}
                                onClick={() =>
                                  updateSchedule({
                                    weekdays: active
                                      ? scheduleForm.weekdays.filter((day) => day !== index)
                                      : [...scheduleForm.weekdays, index].sort((a, b) => a - b),
                                  })
                                }
                                className={cn(
                                  'h-9 min-w-0 flex-1 rounded-lg border px-1 text-sm font-medium transition-colors',
                                  active
                                    ? 'bg-primary text-primary-foreground border-transparent shadow-sm'
                                    : 'bg-transparent border-black/10 dark:border-white/10 text-foreground/70 hover:bg-black/5 dark:hover:bg-white/5 hover:text-foreground',
                                )}
                              >
                                {t(`weekdays.${key}` as const)}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="cron-weekly-time" className="text-meta text-foreground/70 font-medium">
                          {t('dialog.timeLabel')}
                        </Label>
                        <ScheduleTimePicker
                          id="cron-weekly-time"
                          value={scheduleForm.timeOfDay}
                          onChange={(next) => updateSchedule({ timeOfDay: next })}
                        />
                      </div>
                    </div>
                  )}

                  {scheduleForm.recurrence === 'monthly' && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="cron-day-of-month" className="text-meta text-foreground/70 font-medium">
                          {t('dialog.dayOfMonthLabel')}
                        </Label>
                        <SelectField
                          id="cron-day-of-month"
                          data-testid="cron-day-of-month-select"
                          value={scheduleForm.dayOfMonth}
                          onChange={(e) => updateSchedule({ dayOfMonth: Number(e.target.value) })}
                        >
                          {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
                            <option key={day} value={day}>
                              {t('dialog.dayOfMonthOption', { day })}
                            </option>
                          ))}
                        </SelectField>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="cron-monthly-time" className="text-meta text-foreground/70 font-medium">
                          {t('dialog.timeLabel')}
                        </Label>
                        <ScheduleTimePicker
                          id="cron-monthly-time"
                          value={scheduleForm.timeOfDay}
                          onChange={(next) => updateSchedule({ timeOfDay: next })}
                        />
                      </div>
                    </div>
                  )}

                  {scheduleForm.recurrence === 'custom' && (
                    <div className="space-y-1.5">
                      <Input
                        data-testid="cron-custom-input"
                        placeholder={t('dialog.cronPlaceholder')}
                        value={scheduleForm.customCron}
                        onChange={(e) => updateSchedule({ customCron: e.target.value })}
                        className="h-[44px] rounded-xl font-mono text-meta bg-transparent border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary shadow-sm transition-all text-foreground placeholder:text-foreground/40"
                      />
                      <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">
                        {t('dialog.cronFieldsHelp')}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="cron-once-time" className="text-meta text-foreground/70 font-medium">
                      {t('dialog.timeLabel')}
                    </Label>
                    <ScheduleTimePicker
                      id="cron-once-time"
                      value={scheduleForm.onceTime}
                      onChange={(next) => updateSchedule({ onceTime: next })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cron-once-date" className="text-meta text-foreground/70 font-medium">
                      {t('dialog.dateLabel')}
                      {onceWeekdayLabel ? ` · ${onceWeekdayLabel}` : ''}
                    </Label>
                    <Input
                      id="cron-once-date"
                      type="date"
                      min={toDateInputValue(new Date())}
                      value={scheduleForm.onceDate}
                      onChange={(e) => updateSchedule({ onceDate: e.target.value })}
                      className="h-[44px] rounded-xl font-mono text-meta bg-transparent border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary shadow-sm transition-all text-foreground placeholder:text-foreground/40"
                    />
                  </div>
                </div>
              )}

              <p className="mt-2 text-xs text-muted-foreground/80 font-medium">
                {schedulePreview ? `${t('card.next')}: ${schedulePreview}` : t('dialog.cronPlaceholder')}
              </p>
            </div>

            {/* Validity window (app-side; recurring tasks only) */}
            {scheduleForm.mode === 'recurring' && (
              <div className="space-y-2.5">
                <div className="space-y-1">
                  <Label className="text-sm text-foreground/80 font-bold">{t('dialog.windowTitle')}</Label>
                  <p className="text-xs text-muted-foreground">{t('dialog.windowDesc')}</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="cron-window-start" className="text-sm text-foreground/70 font-medium">
                      {t('dialog.windowStartLabel')}
                    </Label>
                    <Input
                      id="cron-window-start"
                      data-testid="cron-window-start"
                      type="date"
                      value={windowStart}
                      max={windowEnd || undefined}
                      onChange={(e) => setWindowStart(e.target.value)}
                      className="h-[44px] rounded-xl font-mono text-tiny bg-transparent border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary shadow-sm transition-all text-foreground placeholder:text-foreground/40"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cron-window-end" className="text-sm text-foreground/70 font-medium">
                      {t('dialog.windowEndLabel')}
                    </Label>
                    <Input
                      id="cron-window-end"
                      data-testid="cron-window-end"
                      type="date"
                      value={windowEnd}
                      min={windowStart || undefined}
                      onChange={(e) => setWindowEnd(e.target.value)}
                      className="h-[44px] rounded-xl font-mono text-tiny bg-transparent border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary shadow-sm transition-all text-foreground placeholder:text-foreground/40"
                    />
                  </div>
                </div>
                {(windowStart || windowEnd) && (
                  <button
                    type="button"
                    onClick={() => {
                      setWindowStart('');
                      setWindowEnd('');
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {t('dialog.windowClear')}
                  </button>
                )}
              </div>
            )}

            {/* Delivery */}
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-sm text-foreground/80 font-bold">{t('dialog.deliveryTitle')}</Label>
                <p className="text-xs text-muted-foreground">{t('dialog.deliveryDescription')}</p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={deliveryMode === 'none' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setDeliveryMode('none')}
                  className={cn(
                    'justify-start h-auto min-h-12 rounded-xl px-4 py-3 text-left whitespace-normal',
                    deliveryMode === 'none'
                      ? 'bg-primary hover:bg-primary/90 text-primary-foreground border-transparent'
                      : 'bg-transparent border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 text-foreground/80 hover:text-foreground',
                  )}
                >
                  <div>
                    <div className="text-meta font-semibold">{t('dialog.deliveryModeNone')}</div>
                    <div className="text-tiny opacity-80">{t('dialog.deliveryModeNoneDesc')}</div>
                  </div>
                </Button>
                <Button
                  type="button"
                  variant={deliveryMode === 'announce' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setDeliveryMode('announce')}
                  className={cn(
                    'justify-start h-auto min-h-12 rounded-xl px-4 py-3 text-left whitespace-normal',
                    deliveryMode === 'announce'
                      ? 'bg-primary hover:bg-primary/90 text-primary-foreground border-transparent'
                      : 'bg-transparent border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 text-foreground/80 hover:text-foreground',
                  )}
                >
                  <div>
                    <div className="text-meta font-semibold">{t('dialog.deliveryModeAnnounce')}</div>
                    <div className="text-tiny opacity-80">{t('dialog.deliveryModeAnnounceDesc')}</div>
                  </div>
                </Button>
              </div>

              {deliveryMode === 'announce' && (
                <div className="space-y-3 rounded-2xl border border-black/5 dark:border-white/5 bg-transparent p-4 shadow-sm">
                  <div className="space-y-2">
                    <Label htmlFor="delivery-channel" className="text-meta text-foreground/80 font-bold">
                      {t('dialog.deliveryChannel')}
                    </Label>
                    <SelectField
                      id="delivery-channel"
                      value={effectiveDeliveryChannel}
                      onChange={(event) => {
                        setDeliveryChannel(event.target.value);
                        setSelectedDeliveryAccountId('');
                        setDeliveryTarget('');
                      }}
                    >
                      <option value="">{t('dialog.selectChannel')}</option>
                      {availableChannels.map((group) => (
                        <option key={group.channelType} value={group.channelType}>
                          {!isSupportedCronDeliveryChannel(group.channelType)
                            ? `${getChannelDisplayName(group.channelType)} (${t('dialog.channelUnsupportedTag')})`
                            : getChannelDisplayName(group.channelType)}
                        </option>
                      ))}
                    </SelectField>
                    {availableChannels.length === 0 && (
                      <p className="text-xs text-muted-foreground">{t('dialog.noChannels')}</p>
                    )}
                    {unsupportedDeliveryChannel && (
                      <p className="text-xs text-destructive">
                        {t('dialog.deliveryChannelUnsupported', {
                          channel: getChannelDisplayName(effectiveDeliveryChannel),
                        })}
                      </p>
                    )}
                    {selectedChannel && (
                      <p className="text-xs text-muted-foreground">
                        {t('dialog.deliveryDefaultAccountHint', { account: selectedChannel.defaultAccountId })}
                      </p>
                    )}
                  </div>

                  {showsAccountSelector && (
                    <div className="space-y-2">
                      <Label htmlFor="delivery-account" className="text-meta text-foreground/80 font-bold">
                        {t('dialog.deliveryAccount')}
                      </Label>
                      <SelectField
                        id="delivery-account"
                        value={effectiveDeliveryAccountId}
                        onChange={(event) => {
                          setSelectedDeliveryAccountId(event.target.value);
                          setDeliveryTarget('');
                        }}
                        disabled={deliveryAccountOptions.length === 0}
                      >
                        <option value="">{t('dialog.selectDeliveryAccount')}</option>
                        {deliveryAccountOptions.map((option) => (
                          <option key={option.accountId} value={option.accountId}>
                            {option.displayName}
                          </option>
                        ))}
                      </SelectField>
                      <p className="text-xs text-muted-foreground">{t('dialog.deliveryAccountDesc')}</p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="delivery-target-select" className="text-meta text-foreground/80 font-bold">
                      {t('dialog.deliveryTarget')}
                    </Label>
                    <SelectField
                      id="delivery-target-select"
                      value={deliveryTarget}
                      onChange={(event) => setDeliveryTarget(event.target.value)}
                      disabled={loadingChannelTargets || availableTargetOptions.length === 0}
                    >
                      <option value="">
                        {loadingChannelTargets ? t('dialog.loadingTargets') : t('dialog.selectDeliveryTarget')}
                      </option>
                      {availableTargetOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </SelectField>
                    <p className="text-xs text-muted-foreground">
                      {availableTargetOptions.length > 0
                        ? t('dialog.deliveryTargetDescAuto')
                        : t('dialog.noDeliveryTargets', { channel: getChannelDisplayName(effectiveDeliveryChannel) })}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Enabled */}
            <div className="flex items-center justify-between bg-transparent p-4 rounded-2xl shadow-sm border border-black/5 dark:border-white/5">
              <div>
                <Label className="text-sm text-foreground/80 font-bold">{t('dialog.enableImmediately')}</Label>
                <p className="text-meta text-muted-foreground mt-0.5">{t('dialog.enableImmediatelyDesc')}</p>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-4">
              <Button
                variant="outline"
                onClick={onClose}
                className="rounded-full px-6 h-[42px] text-meta font-semibold border-black/20 dark:border-white/20 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 text-foreground/80 hover:text-foreground shadow-sm"
              >
                {t('common:actions.cancel', 'Cancel')}
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={saving}
                className="rounded-full px-6 h-[42px] text-meta font-semibold shadow-sm border border-transparent transition-all text-white"
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {t('common:status.saving', 'Saving...')}
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    {job ? t('dialog.saveChanges') : t('dialog.createTitle')}
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </DialogContent>
    </Dialog>
  );
}

// Job Card Component
interface CronJobCardProps {
  job: CronJob;
  deliveryAccountName?: string;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onTrigger: () => Promise<void>;
}

function CronJobCard({ job, deliveryAccountName, onToggle, onEdit, onDelete, onTrigger }: CronJobCardProps) {
  const { t } = useTranslation('cron');
  const [triggering, setTriggering] = useState(false);
  const agents = useAgentsStore((s) => s.agents);
  const agentName = agents.find((a) => a.id === job.agentId)?.name ?? job.agentId;

  const handleTrigger = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setTriggering(true);
    try {
      await onTrigger();
      toast.success(t('toast.triggered'));
    } catch (error) {
      console.error('Failed to trigger cron job:', error);
      toast.error(t('toast.failedTrigger', { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setTriggering(false);
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete();
  };

  const deliveryChannel = typeof job.delivery?.channel === 'string' ? job.delivery.channel : '';
  const deliveryLabel = deliveryChannel ? getChannelDisplayName(deliveryChannel) : '';
  const deliveryIcon = deliveryChannel && isKnownChannelType(deliveryChannel) ? CHANNEL_ICONS[deliveryChannel] : null;

  const jobWindow = job.window && (job.window.start || job.window.end) ? job.window : null;
  const windowStatus: 'notStarted' | 'ended' | null = (() => {
    if (!jobWindow) return null;
    const today = toDateInputValue(new Date());
    if (jobWindow.start && today < jobWindow.start) return 'notStarted';
    if (jobWindow.end && today > jobWindow.end) return 'ended';
    return null;
  })();

  return (
    <div
      data-testid={`cron-job-card-${job.id}`}
      className="group flex flex-col p-5 rounded-2xl bg-transparent border border-transparent hover:bg-black/5 dark:hover:bg-white/5 transition-all relative overflow-hidden cursor-pointer"
      onClick={onEdit}
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-4 min-w-0 flex-1">
          <div className="h-[46px] w-[46px] shrink-0 flex items-center justify-center text-foreground bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-full shadow-sm group-hover:scale-105 transition-transform">
            <Clock className={cn('h-5 w-5', job.enabled ? 'text-foreground' : 'text-muted-foreground')} />
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1 min-w-0">
              <h3
                data-testid={`cron-job-card-title-${job.id}`}
                className="text-base font-semibold text-foreground truncate min-w-0"
              >
                {job.name}
              </h3>
              <div
                className={cn('w-2 h-2 rounded-full shrink-0', job.enabled ? 'bg-green-500' : 'bg-muted-foreground')}
                title={job.enabled ? t('stats.active') : t('stats.paused')}
              />
              {windowStatus && (
                <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-tiny font-medium text-amber-600 dark:text-amber-500">
                  {windowStatus === 'notStarted' ? t('schedule.windowNotStarted') : t('schedule.windowEnded')}
                </span>
              )}
            </div>
            <p className="text-meta text-muted-foreground flex items-center gap-1.5 min-w-0">
              <Timer className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{parseCronSchedule(job.schedule, t)}</span>
            </p>
          </div>
        </div>

        <div
          data-testid={`cron-job-card-switch-${job.id}`}
          className="flex items-center gap-2 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <Switch checked={job.enabled} onCheckedChange={onToggle} />
        </div>
      </div>

      <div className="flex-1 flex flex-col justify-end mt-2 pl-[62px] min-w-0">
        <div className="flex items-start gap-2 mb-3 min-w-0">
          <MessageSquare className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
          <p className="text-sm text-muted-foreground line-clamp-2 leading-[1.5] min-w-0 flex-1 break-all">
            {job.message}
          </p>
        </div>

        {/* Metadata */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground/80 font-medium mb-3">
          {job.delivery?.mode === 'announce' && deliveryChannel && (
            <span className="flex items-center gap-1.5">
              {deliveryIcon}
              <span>{deliveryLabel}</span>
              {deliveryAccountName ? (
                <span className="max-w-[220px] truncate">{deliveryAccountName}</span>
              ) : (
                job.delivery.to && <span className="max-w-[220px] truncate">{job.delivery.to}</span>
              )}
            </span>
          )}

          {job.lastRun && (
            <span className="flex items-center gap-1.5">
              <History className="h-3.5 w-3.5" />
              {t('card.last')}: {formatRelativeTime(job.lastRun.time)}
              {job.lastRun.success ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
              ) : (
                <XCircle className="h-3.5 w-3.5 text-red-500" />
              )}
            </span>
          )}

          {job.nextRun && job.enabled && (
            <span className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              {t('card.next')}: {new Date(job.nextRun).toLocaleString()}
            </span>
          )}

          <span className="flex items-center gap-1.5">
            <Bot className="h-3.5 w-3.5" />
            {agentName}
          </span>

          {jobWindow && (
            <span className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              {t('card.windowRange', { start: jobWindow.start || '…', end: jobWindow.end || '…' })}
            </span>
          )}
        </div>

        {/* Last Run Error */}
        {job.lastRun && !job.lastRun.success && job.lastRun.error && (
          <div className="flex items-start gap-2 p-2.5 mb-3 rounded-xl bg-destructive/10 border border-destructive/20 text-meta text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span className="line-clamp-2">{job.lastRun.error}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity mt-auto">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleTrigger}
            disabled={triggering}
            className="h-8 px-3 text-foreground/70 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 rounded-lg text-meta font-medium transition-colors"
          >
            {triggering ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : (
              <Play className="h-3.5 w-3.5 mr-1.5" />
            )}
            {t('card.runNow')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            className="h-8 px-3 text-destructive/70 hover:text-destructive hover:bg-destructive/10 rounded-lg text-meta font-medium transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            {t('common:actions.delete', 'Delete')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function Cron() {
  const { t } = useTranslation('cron');
  const { jobs, loading, error, fetchJobs, createJob, updateJob, toggleJob, deleteJob, triggerJob } = useCronStore();
  const gatewayStatus = useGatewayStore((state) => state.status);
  const [showDialog, setShowDialog] = useState(false);
  const [editingJob, setEditingJob] = useState<CronJob | undefined>();
  const [jobToDelete, setJobToDelete] = useState<{ id: string } | null>(null);
  const [configuredChannels, setConfiguredChannels] = useState<DeliveryChannelGroup[]>([]);

  const isGatewayRunning = gatewayStatus.state === 'running';
  const showGatewayUnavailableWarning = isGatewayStopped(gatewayStatus);

  const fetchConfiguredChannels = useCallback(async () => {
    try {
      const response = await hostApi.channels.accounts();
      if (!response.success) {
        throw new Error(response.error || 'Failed to load delivery channels');
      }
      setConfiguredChannels(response.channels || []);
    } catch (fetchError) {
      console.warn('Failed to load delivery channels:', fetchError);
      setConfiguredChannels([]);
    }
  }, []);

  // Fetch jobs on mount
  useEffect(() => {
    if (isGatewayRunning) {
      fetchJobs();
    }
  }, [fetchJobs, isGatewayRunning]);

  useEffect(() => {
    void fetchConfiguredChannels();
  }, [fetchConfiguredChannels]);

  // Statistics
  const safeJobs = Array.isArray(jobs) ? jobs : [];
  const activeJobs = safeJobs.filter((j) => j.enabled);
  const pausedJobs = safeJobs.filter((j) => !j.enabled);
  const failedJobs = safeJobs.filter((j) => j.lastRun && !j.lastRun.success);

  const handleSave = useCallback(
    async (input: CronJobCreateInput) => {
      if (editingJob) {
        await updateJob(editingJob.id, input);
      } else {
        await createJob(input);
      }
    },
    [editingJob, createJob, updateJob],
  );

  const handleToggle = useCallback(
    async (id: string, enabled: boolean) => {
      try {
        await toggleJob(id, enabled);
        toast.success(enabled ? t('toast.enabled') : t('toast.paused'));
      } catch {
        toast.error(t('toast.failedUpdate'));
      }
    },
    [toggleJob, t],
  );

  if (loading) {
    return (
      <div
        data-testid="cron-page"
        className="flex flex-col -m-6 dark:bg-background min-h-[calc(100vh-2.5rem)] items-center justify-center"
      >
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div
      data-testid="cron-page"
      className="flex flex-col -m-6 dark:bg-background h-[calc(100vh-2.5rem)] overflow-hidden"
    >
      <div className="w-full max-w-5xl mx-auto flex flex-col h-full p-10 pt-16 pb-0">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-start justify-between mb-12 shrink-0 gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-serif text-foreground mb-3 font-normal tracking-tight">
              {t('title')}
            </h1>
            <p className="text-subtitle text-foreground/70 font-medium">{t('subtitle')}</p>
          </div>
          <div className="flex items-center gap-3 md:mt-2">
            <Button
              variant="outline"
              onClick={() => {
                void fetchJobs();
                void fetchConfiguredChannels();
              }}
              disabled={!isGatewayRunning}
              className="h-9 text-meta font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-2" />
              {t('refresh')}
            </Button>
            <Button
              data-testid="cron-new-task-button"
              onClick={() => {
                setEditingJob(undefined);
                setShowDialog(true);
              }}
              disabled={!isGatewayRunning}
              className="h-9 text-[13px] font-medium rounded-full px-4 shadow-none"
            >
              <Plus className="h-3.5 w-3.5 mr-2" />
              {t('newTask')}
            </Button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto pr-2 pb-10 min-h-0 -mr-2">
          {/* Gateway Warning */}
          {showGatewayUnavailableWarning && (
            <div className="mb-8 p-4 rounded-xl border border-yellow-500/50 bg-yellow-500/10 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
              <span className="text-yellow-700 dark:text-yellow-400 text-sm font-medium">{t('gatewayWarning')}</span>
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="mb-8 p-4 rounded-xl border border-destructive/50 bg-destructive/10 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <span className="text-destructive text-sm font-medium">{error}</span>
            </div>
          )}

          {/* Statistics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="p-5 rounded-[24px] bg-black/5 dark:bg-white/5 border border-transparent flex flex-col justify-between min-h-[130px] relative overflow-hidden group hover:bg-black/10 dark:hover:bg-white/10 transition-colors">
              <div className="flex items-center justify-between">
                <div className="h-11 w-11 rounded-full bg-primary/10 flex items-center justify-center">
                  <Clock className="h-5 w-5 text-primary" />
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-3">
                <p className="text-stat font-serif text-foreground">{safeJobs.length}</p>
                <p className="text-sm font-medium text-muted-foreground">{t('stats.total')}</p>
              </div>
            </div>

            <div className="p-5 rounded-[24px] bg-black/5 dark:bg-white/5 border border-transparent flex flex-col justify-between min-h-[130px] relative overflow-hidden group hover:bg-black/10 dark:hover:bg-white/10 transition-colors">
              <div className="flex items-center justify-between">
                <div className="h-11 w-11 rounded-full bg-green-500/10 flex items-center justify-center">
                  <Play className="h-5 w-5 text-green-600 dark:text-green-500 ml-0.5" />
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-3">
                <p className="text-stat font-serif text-foreground">{activeJobs.length}</p>
                <p className="text-sm font-medium text-muted-foreground">{t('stats.active')}</p>
              </div>
            </div>

            <div className="p-5 rounded-[24px] bg-black/5 dark:bg-white/5 border border-transparent flex flex-col justify-between min-h-[130px] relative overflow-hidden group hover:bg-black/10 dark:hover:bg-white/10 transition-colors">
              <div className="flex items-center justify-between">
                <div className="h-11 w-11 rounded-full bg-yellow-500/10 flex items-center justify-center">
                  <Pause className="h-5 w-5 text-yellow-600 dark:text-yellow-500" />
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-3">
                <p className="text-stat font-serif text-foreground">{pausedJobs.length}</p>
                <p className="text-sm font-medium text-muted-foreground">{t('stats.paused')}</p>
              </div>
            </div>

            <div className="p-5 rounded-[24px] bg-black/5 dark:bg-white/5 border border-transparent flex flex-col justify-between min-h-[130px] relative overflow-hidden group hover:bg-black/10 dark:hover:bg-white/10 transition-colors">
              <div className="flex items-center justify-between">
                <div className="h-11 w-11 rounded-full bg-destructive/10 flex items-center justify-center">
                  <XCircle className="h-5 w-5 text-destructive" />
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-3">
                <p className="text-stat font-serif text-foreground">{failedJobs.length}</p>
                <p className="text-sm font-medium text-muted-foreground">{t('stats.failed')}</p>
              </div>
            </div>
          </div>

          {/* Jobs List */}
          {safeJobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground bg-black/5 dark:bg-white/5 rounded-3xl border border-transparent border-dashed">
              <Clock className="h-10 w-10 mb-4 opacity-50" />
              <h3 className="text-lg font-medium mb-2 text-foreground">{t('empty.title')}</h3>
              <p className="text-sm text-center mb-6 max-w-md">{t('empty.description')}</p>
              <Button
                onClick={() => {
                  setEditingJob(undefined);
                  setShowDialog(true);
                }}
                disabled={!isGatewayRunning}
                className="rounded-full px-6 h-10"
              >
                <Plus className="h-4 w-4 mr-2" />
                {t('empty.create')}
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
              {safeJobs.map((job) => {
                const channelGroup = configuredChannels.find((group) => group.channelType === job.delivery?.channel);
                const account = channelGroup?.accounts.find((item) => item.accountId === job.delivery?.accountId);
                const deliveryAccountName = account ? getDeliveryAccountDisplayName(account, t) : undefined;
                return (
                  <CronJobCard
                    key={job.id}
                    job={job}
                    deliveryAccountName={deliveryAccountName}
                    onToggle={(enabled) => handleToggle(job.id, enabled)}
                    onEdit={() => {
                      setEditingJob(job);
                      setShowDialog(true);
                    }}
                    onDelete={() => setJobToDelete({ id: job.id })}
                    onTrigger={() => triggerJob(job.id)}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Create/Edit Dialog */}
      <TaskDialog
        open={showDialog}
        job={editingJob}
        configuredChannels={configuredChannels}
        onClose={() => {
          setShowDialog(false);
        }}
        onSave={handleSave}
      />

      <ConfirmDialog
        open={!!jobToDelete}
        title={t('common:actions.confirm', 'Confirm')}
        message={t('card.deleteConfirm')}
        confirmLabel={t('common:actions.delete', 'Delete')}
        cancelLabel={t('common:actions.cancel', 'Cancel')}
        variant="destructive"
        onConfirm={async () => {
          if (jobToDelete) {
            await deleteJob(jobToDelete.id);
            setJobToDelete(null);
            toast.success(t('toast.deleted'));
          }
        }}
        onCancel={() => setJobToDelete(null)}
      />
    </div>
  );
}

export default Cron;
