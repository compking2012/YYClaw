import { logger } from '../../utils/logger';

type OfficeWorkflowLogDetail = Record<string, string | number | boolean | null | undefined>;

function formatDetail(detail?: OfficeWorkflowLogDetail): string {
  if (!detail) return '';
  const parts = Object.entries(detail)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`);
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

/** Workflow / settle diagnostics — written to clawx-*.log (grep: `[office][workflow`). */
export function officeWorkflowLog(
  level: 'debug' | 'info' | 'warn',
  tag: string,
  detail?: OfficeWorkflowLogDetail,
): void {
  logger[level](`${tag}${formatDetail(detail)}`);
}
