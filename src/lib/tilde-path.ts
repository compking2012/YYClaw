function resolveHomeDir(): string {
  if (typeof process !== 'undefined') {
    const fromEnv = process.env?.HOME ?? process.env?.USERPROFILE;
    if (fromEnv?.trim()) return fromEnv.trim();
  }
  return '';
}

/** 将绝对路径压缩为 `~/.openclaw/...` 展示形式。 */
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
