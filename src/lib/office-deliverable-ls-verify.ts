import { collectDeliverablePathHintsFromText } from '@/lib/office-workflow-project-deliverable';

/** `ls -l` 结果行：以权限位开头（`-rw-r--r--` / `drwxr-xr-x` 等）。 */
const LS_STAT_OUTPUT_RE = /[-dlnpsbcS?][-rwxstT]{9,}\s+\d+/u;

/** `ls` 报错行（路径不存在等）。 */
const LS_ACCESS_ERROR_RE = /(?:^|\s)(?:ls:\s*)?cannot\s+access|^ls:\s+/iu;

export function collectValidationPathsFromSections(
  ...sections: Array<string | null | undefined>
): string[] {
  return collectDeliverablePathHintsFromText(...sections);
}

/** 单行是否含该路径的 ls -l 结果（stat 行或 cannot access 行）。 */
function lineDocumentsPathLsOutput(line: string, path: string): boolean {
  const t = line.trim();
  if (!t) return false;
  const norm = path.trim();
  const base = norm.split('/').pop() ?? norm;
  const mentionsPath = t.includes(norm) || (base.length > 2 && t.includes(base));
  if (!mentionsPath) return false;
  if (LS_STAT_OUTPUT_RE.test(t)) return true;
  if (LS_ACCESS_ERROR_RE.test(t)) return true;
  return false;
}

/**
 * 【输入校验】/【输出校验】是否已附 ls -l **结果行**（仅需 `-rw-r--r-- … /path` 一类输出；
 * 勿把 `ls -l <path>` 命令行与结果粘在同一行；命令+分行结果仍接受）。
 */
export function validationSectionDocumentsLsForPaths(
  sectionText: string,
  paths: string[],
): boolean {
  const body = sectionText.trim();
  if (paths.length === 0) return true;
  if (!body) return false;
  const lines = body.split('\n');
  return paths.every((p) => lines.some((line) => lineDocumentsPathLsOutput(line, p)));
}

export function formatMissingLsValidationDetail(
  sectionLabel: string,
  paths: string[],
): string {
  const cmds = paths.map((p) => `ls -l ${p}`).join('；');
  return (
    `【${sectionLabel}】须先在本机执行 ${cmds}，并将**结果行**写入该段` +
    '（如 `-rw-r--r-- 1 user staff 1234 … /绝对路径`；仅需结果行，勿重复粘贴 `ls -l` 命令）'
  );
}
