import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const LOG_DIR = join(homedir(), '.openclaw', 'office', 'smart-watch');
const LOG_FILE = join(LOG_DIR, 'office.log');

/** Smart 模式 E2E 诊断（终端 grep: `[office] smart:`；文件 ~/.openclaw/office/smart-watch/office.log） */
export function smartDiagLog(
  tag: string,
  detail: Record<string, string | boolean | number | undefined>,
): void {
  const tail = Object.entries(detail)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  const line = `[office] smart:${tag}${tail ? ` ${tail}` : ''}`;
  console.info(line);
  void mkdir(LOG_DIR, { recursive: true })
    .then(() => appendFile(LOG_FILE, `${new Date().toISOString()} ${line}\n`))
    .catch(() => undefined);
}
