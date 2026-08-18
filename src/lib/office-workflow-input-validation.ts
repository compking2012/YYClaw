import { extractWorkflowUpstreamTargetNames } from '@/lib/office-workflow-prior-context';
import {
  isLsLine,
} from '@/lib/office-workflow-output-ls-result';

const INPUT_OK_RE =
  /(?:已就绪|已存在|符合预期|完整可用|可核验|无问题|校验通过|确认无误)/u;

const INPUT_FAIL_RE =
  /不符合(?:预期|要求)?|不满足|不完整|不充分|有缺口|缺失|不存在|不可信|未就绪|无法(?:使用|开展)|需(?:补充|修订|返工)|返工|重新(?:编写|交付|提供|补充)|不合格|未通过|核对(?:不|未)|与.{0,12}不符/u;

/** 从直接前驱上下文解析 inputValidation.targets 期望值。 */
export function expectedDirectPredecessorInputTargets(
  directPredecessorContext?: string | null,
): string[] {
  return extractWorkflowUpstreamTargetNames(directPredecessorContext);
}

/** inputValidation.targets 是否恰好等于直接前驱（上一个任务）交付物。 */
export function inputValidationTargetsMatchDirectPredecessors(
  targets: string[],
  directPredecessorContext?: string | null,
): boolean {
  const expected = expectedDirectPredecessorInputTargets(directPredecessorContext);
  const actual = targets.map((t) => t.trim()).filter(Boolean);
  if (expected.length === 0) return actual.length === 0;
  if (actual.length !== expected.length) return false;
  const a = [...actual].sort();
  const b = [...expected].sort();
  return a.every((v, i) => v === b[i]);
}

/**
 * Runtime no longer validates lsResult content/alignment (Windows PowerShell listings
 * etc. previously failed Unix `ls -l` rules). Field must still be a string[] at parse time.
 * Targets path rules stay elsewhere; prompts unchanged by design.
 */
export function isInputValidationLsResultInvalid(
  _targets: string[],
  _lsResults: string[],
): boolean {
  return false;
}

/** Unix `ls -l` 或 Windows/PowerShell Mode 列表行（放宽 lsResult 后门禁仍会序列化进 inputValidation）。 */
export function isFilesystemListingLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (isLsLine(t)) return true;
  // PowerShell Mode≈6 字符（-a---- / d----- / la----）：
  // 属性段须落在 Mode 字符集且至少含一个 `-`，避免 `-todos` / `-cares @角色` 英文 bullet 被误剥。
  if (/^[-dl](?=[-acdehilnrs]{5}\s)(?=[-acdehilnrs]*-)[-acdehilnrs]{5}\s+\S/u.test(t)) return true;
  return false;
}

/** 剥离 `target：listing` 中的 listing 后缀（Unix 或 Windows）。 */
function stripTargetColonListingSuffix(line: string): string {
  const m = line.match(/^(.+?)[：:]\s*(.+)$/u);
  if (m?.[2] && isFilesystemListingLine(m[2])) {
    return m[1]!.trim();
  }
  return line;
}

/**
 * 剥离 listing 行后再检测 @ / 【】点名。
 * macOS `@` 扩展属性与 Windows lsResult 路径中的 `@` 均不得算角色点名。
 */
function stripLsLinesForRoleMentionCheck(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return '';
      let rest = trimmed.replace(/^ls[：:]\s*/iu, '');
      if (isFilesystemListingLine(rest)) return '';
      rest = stripTargetColonListingSuffix(rest);
      if (isFilesystemListingLine(rest)) return '';
      return rest;
    })
    .filter(Boolean)
    .join('\n');
}

/** 【输入校验】是否 @ 或显式点名角色（路径中含角色名片段不判为点名）。 */
export function workflowInputValidationNamesRole(inputValidation: string): boolean {
  const t = stripLsLinesForRoleMentionCheck(inputValidation.trim());
  if (!t) return false;
  if (/@/u.test(t)) return true;
  if (/【[^】]{1,12}】/u.test(t)) return true;
  return false;
}

/** 从结构化段落判断【输入校验】是否表明上游路径/产物不合格。 */
export function isWorkflowInputValidationFailure(inputValidation: string): boolean {
  const t = inputValidation.trim();
  if (!t || /^无$/iu.test(t)) return false;
  if (INPUT_FAIL_RE.test(t)) return true;
  if (INPUT_OK_RE.test(t) && !INPUT_FAIL_RE.test(t)) return false;
  return /(?:缺失|无法|不能|未(?:就绪|满足|通过)|缺少)/u.test(t) && !INPUT_OK_RE.test(t);
}

/** 合并全文内所有「输入校验/输入检查」段落（供 format-retry 交叉校验）。 */
export function collectAllInputValidationBodiesFromRaw(raw: string): string {
  const re =
    /(?:^|\n)【\s*(?:输入校验|输入检查)\s*】\s*([\s\S]*?)(?=\n【|$)/giu;
  const parts: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const body = m[1]?.trim();
    if (body) parts.push(body);
  }
  return parts.join('\n\n---\n\n');
}
