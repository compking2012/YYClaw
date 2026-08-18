import { collectDeliverablePathHintsFromText } from '@/lib/office-workflow-project-deliverable';

function resolveHomeDir(): string {
  if (typeof process !== 'undefined') {
    const fromEnv = process.env?.HOME ?? process.env?.USERPROFILE;
    if (fromEnv?.trim()) return fromEnv.trim();
  }
  return '';
}

/** 将绝对路径压缩为 `~/.openclaw/...` 展示形式（群聊收尾交付物列表用）。 */
export function compressPathToTilde(absPath: string): string {
  const raw = absPath.trim();
  if (!raw) return raw;
  if (raw.startsWith('~/')) return raw;

  const home = resolveHomeDir();
  const expanded = raw.startsWith('~') && home
    ? raw.replace(/^~(?=$|\/)/u, home)
    : raw;
  if (!home) return expanded;
  if (expanded === home) return '~';
  if (expanded.startsWith(`${home}/`)) {
    return `~${expanded.slice(home.length)}`;
  }
  return expanded;
}

/** 协调者项目收尾：对外交付物绝对路径一行（示例：`交付物有：~/.openclaw/.../index.html；`）。 */
export function formatWorkflowClosureDeliverablePathsLine(paths: string[]): string {
  const display = paths.map((p) => compressPathToTilde(p)).filter(Boolean);
  if (display.length === 0) return '';
  return `交付物有：${display.map((p) => `${p}；`).join('')}`;
}

/** 交付物提示去路径，仅保留文件名或 `交付物-角色` 目录名。 */
export function deliverableDisplayNameFromHint(hint: string): string {
  let p = hint.trim().replace(/^[`'"]+|[`'"]+$/g, '');
  p = p.replace(/\\/g, '/').replace(/\/+$/u, '');
  if (!p) return '';
  if (p.includes('/')) {
    return (p.split('/').pop() ?? p).trim();
  }
  return p;
}

/** 从节点交付摘要提取对外展示用的交付物名（不含路径/摘要/校验段）。 */
export function extractWorkflowClosureDeliverableNames(summary: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const name = deliverableDisplayNameFromHint(raw);
    if (!name || name.length < 2) return;
    if (/^(无|暂无|N\/A)$/iu.test(name)) return;
    if (seen.has(name)) return;
    seen.add(name);
    names.push(name);
  };

  const text = summary.trim();
  if (!text) return [];

  // 优先本步【交付产物】声明的主路径，避免把输出校验里的上游路径一并列出。
  const pathLine = text.match(/(?:^|\n)路径[：:]\s*([^\n]+)/u);
  if (pathLine?.[1]) {
    for (const part of pathLine[1].split(/[、,；;]/u)) {
      push(part);
    }
  }

  if (names.length === 0) {
    const delLine = text.match(/(?:^|\n)交付物[：:]\s*([^\n]+)/u);
    if (delLine?.[1]) {
      for (const part of delLine[1].split(/[、,；;]/u)) {
        push(part);
      }
    }
  }

  if (names.length === 0) {
    for (const hint of collectDeliverablePathHintsFromText(text)) {
      push(hint);
    }
  }

  if (names.length === 0) {
    const titleMatch = text.match(/📦\s*交付产物\s*·\s*([^\n（]+)/u);
    if (titleMatch?.[1]) push(titleMatch[1]);
  }

  return names;
}

/** 项目收尾「内部归档」单行：`· 【步骤】-【角色】：交付物名`。 */
export function formatWorkflowClosureArchiveLine(
  stepTitle: string,
  roleName: string,
  summary: string,
): string {
  const step = stepTitle.trim() || '步骤';
  const role = roleName.trim() || '角色';
  const names = extractWorkflowClosureDeliverableNames(summary);
  const label = names.length > 0 ? names.join('；') : '（无）';
  return `· 【${step}】-【${role}】：${label}`;
}
