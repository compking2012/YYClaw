import { describe, expect, it } from 'vitest';
import {
  isFilesystemListingLine,
  isInputValidationLsResultInvalid,
  workflowInputValidationNamesRole,
} from '../../src/lib/office-workflow-input-validation';
import {
  isOutputValidationLsResultInvalid,
  isWorkflowLsResultsArrayInvalid,
} from '../../src/lib/office-workflow-output-ls-result';
import { validateWorkflowRoomJsonForRunner } from '../../src/lib/office-workflow-room-json-validate';

const WIN_LS =
  '-a----         2026/7/14     17:51           3854 制定漫画ppt的策划方案-策划师.md';
const WIN_OUT_LS =
  '-a----         2026/7/14     17:53           6087 漫画ppt的剧情文本-编写师.md';
const WIN_LS_WITH_AT =
  '-a----         2026/7/14     17:51           3854 foo@host-策划方案-策划师.md';

function winWriterJson(inputLs: string): string {
  return `{
  "role": "编写师",
  "step": { "index": 2, "total": 3, "title": "负责漫画ppt的文字创作" },
  "inputValidation": {
    "targets": ["交付物-策划师/制定漫画ppt的策划方案-策划师.md"],
    "lsResult": [${JSON.stringify(inputLs)}]
  },
  "execution": "已根据策划方案完成漫画PPT剧情文本创作并落盘至交付物-编写师目录。",
  "outputValidation": {
    "targets": ["交付物-编写师/漫画ppt的剧情文本-编写师.md"],
    "lsResult": [${JSON.stringify(WIN_OUT_LS)}]
  },
  "deliverable": {
    "path": "交付物-编写师/漫画ppt的剧情文本-编写师.md",
    "summary": "完成安全教育漫画PPT剧情文本，含封面与分镜对白。",
    "conclusion": "已交付"
  },
  "rollback": "无"
}`;
}

/** Session 校验序列化后的 inputValidation 形态（与 parseStructuredAgentReply 一致）。 */
function serializedInputValidation(target: string, lsLine: string): string {
  return [
    `目标：${target}`,
    `ls：${target}：${lsLine}`,
  ].join('\n');
}

describe('workflow lsResult runtime validation disabled', () => {
  it('gate helpers always accept any lsResult shape', () => {
    expect(isInputValidationLsResultInvalid(['a.md'], ['ok'])).toBe(false);
    expect(isInputValidationLsResultInvalid([], [WIN_LS])).toBe(false);
    expect(isOutputValidationLsResultInvalid(['out.md'], [])).toBe(false);
    expect(isWorkflowLsResultsArrayInvalid(['a', 'b'], ['only-one'])).toBe(false);
  });

  it('room JSON structure accepts Windows PowerShell-style lsResult', () => {
    const r = validateWorkflowRoomJsonForRunner(winWriterJson(WIN_LS), {
      actorRoleName: '编写师',
    });
    expect(r.ok).toBe(true);
  });

  it('room JSON still rejects invalid target path (targets rules unchanged)', () => {
    const bad = winWriterJson(WIN_LS).replace(
      '"targets": ["交付物-策划师/制定漫画ppt的策划方案-策划师.md"]',
      '"targets": ["../escape.md"]',
    );
    const r = validateWorkflowRoomJsonForRunner(bad, { actorRoleName: '编写师' });
    expect(r.ok).toBe(false);
  });

  it('UT reproduce: Win lsResult with @ must not trip names_role after lsResult gate was opened', () => {
    // 放宽 lsResult 后，序列化「target：PowerShell ls」若未剥离，路径中的 `@` 会被当成点名。
    expect(
      workflowInputValidationNamesRole(
        serializedInputValidation(
          '交付物-策划师/制定漫画ppt的策划方案-策划师.md',
          WIN_LS_WITH_AT,
        ),
      ),
    ).toBe(false);
  });

  it('still flags real @ mention outside ls listing payload', () => {
    expect(workflowInputValidationNamesRole('目标：无\n请 @产品 补充\nls：无')).toBe(true);
  });

  it('UT reproduce: English dash-bullet with @ must not be stripped as PowerShell Mode', () => {
    // 过宽 `/^-[a-zA-Z-]{4,}\s+\S/` 会把 `-todos check @产品` 误判为 listing → names_role 漏检
    expect(isFilesystemListingLine('-todos check with @产品 please')).toBe(false);
    expect(isFilesystemListingLine('-cares about @产品 please')).toBe(false);
    expect(
      workflowInputValidationNamesRole('目标：无\n-todos check with @产品 please\nls：无'),
    ).toBe(true);
    expect(
      workflowInputValidationNamesRole('目标：无\n-cares about @产品 please\nls：无'),
    ).toBe(true);
  });

  it('PowerShell Mode line still classified as filesystem listing', () => {
    expect(isFilesystemListingLine(WIN_LS)).toBe(true);
    expect(isFilesystemListingLine(WIN_LS_WITH_AT)).toBe(true);
    expect(isFilesystemListingLine('-rw-r--r--@  1 u  staff  10 Mar 9 10:00 file.md')).toBe(true);
  });

  it('target path containing @ still trips names_role (known boundary, not listing)', () => {
    expect(
      workflowInputValidationNamesRole(
        '目标：交付物-策划师/foo@host-方案-策划师.md\nls：无',
      ),
    ).toBe(true);
  });

  it('empty targets with noise lsResult accepted by runtime gate', () => {
    expect(isInputValidationLsResultInvalid([], ['garbage', 'ok'])).toBe(false);
    expect(isOutputValidationLsResultInvalid([], ['x'])).toBe(false);
  });

  it('directory-style Mode line is listing; narrative dash without Mode dashes is not', () => {
    expect(isFilesystemListingLine('d-----         2026/7/14     17:51   <DIR> 交付物-策划师')).toBe(
      true,
    );
    expect(isFilesystemListingLine('-notes for @产品')).toBe(false);
  });
});
