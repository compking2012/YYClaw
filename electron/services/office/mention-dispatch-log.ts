/** 点名链路诊断（终端 grep: `[office] mention:`） */
export function mentionDispatchLog(
  tag: string,
  detail: Record<string, string | boolean | number | undefined>,
): void {
  const tail = Object.entries(detail)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  console.info(`[office] mention:${tag}${tail ? ` ${tail}` : ''}`);
}
