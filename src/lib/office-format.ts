/** `YYYY-MM-DD HH:mm:ss` for office room / task timestamps. */
export function formatOfficeDateTime(timestampMs: number, locale?: string): string {
  const d = new Date(timestampMs);
  if (Number.isNaN(d.getTime())) return '';

  const loc = locale ?? (typeof navigator !== 'undefined' ? navigator.language : 'zh-CN');
  const parts = new Intl.DateTimeFormat(loc, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);

  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';

  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}:${pick('second')}`;
}
