import { describe, expect, it } from 'vitest';
import {
  parseWorkflowJsonObjectDetailed,
  tryParseWorkflowJsonObject,
  workflowJsonDeliverablePathFromText,
} from '@/lib/office-workflow-json-parse';
import { parseWorkflowJsonOutputDetailed } from '@/lib/office-workflow-json-schema';
import { validateSmartRoomJsonStructure } from '@/lib/office-smart-json-validate';
import {
  buildSmartCoordinatorJsonSchemaLines,
  buildSmartMemberJsonSchemaLines,
} from '@/lib/office-smart-task-prompt-shared';
import { buildWorkflowMergedOutputSpecLines } from '@/lib/office-workflow-task-prompt-shared';

describe('office-workflow-json-parse', () => {
  describe('tryParseWorkflowJsonObject', () => {
    it('parses valid JSON', () => {
      const json = '{"role":"test","step":{"index":1,"total":2,"title":"step1"}}';
      const result = tryParseWorkflowJsonObject(json);
      expect(result).not.toBeNull();
      expect(result?.role).toBe('test');
    });

    it('parses JSON from markdown code block', () => {
      const json = '```json\n{"role":"test"}\n```';
      const result = tryParseWorkflowJsonObject(json);
      expect(result?.role).toBe('test');
    });

    it('fixes single-backslash lsResult paths (gen-2 style: \\Domain invalid JSON)', () => {
      const badJson = `{
  "role": "文档撰写师",
  "step": { "index": 2, "total": 3, "title": "撰写" },
  "inputValidation": { "targets": ["a.md"], "lsResult": ["-rw- a.md"] },
  "execution": "完成",
  "outputValidation": {
    "targets": ["out.md"],
    "lsResult": ["drwx------  YYCLAW-AI\\Domain Users  staff  64 Jul  6 14:00 out.md"]
  },
  "deliverable": { "path": "out.md", "summary": "摘要", "conclusion": "通过" },
  "rollback": "无"
}`;
      const detailed = parseWorkflowJsonObjectDetailed(badJson);
      expect(detailed.ok).toBe(true);
      if (detailed.ok) {
        expect(detailed.repaired).toBe(true);
        expect(detailed.object.outputValidation).toEqual({
          targets: ['out.md'],
          lsResult: ['drwx------  YYCLAW-AI\\Domain Users  staff  64 Jul  6 14:00 out.md'],
        });
      }
    });

    it('accepts double-backslash lsResult paths without repair (gen-0/1 style: \\\\Domain valid JSON)', () => {
      const goodJson = `{
  "role": "文档撰写师",
  "step": { "index": 2, "total": 3, "title": "撰写" },
  "inputValidation": { "targets": ["a.md"], "lsResult": ["-rw- a.md"] },
  "execution": "完成",
  "outputValidation": {
    "targets": ["out.md"],
    "lsResult": ["-rw-r--r--@ 1 u  YYCLAW-AI\\\\Domain Users  13623 Jul  6 15:18 out.md"]
  },
  "deliverable": { "path": "out.md", "summary": "摘要", "conclusion": "通过" },
  "rollback": "无"
}`;
      const detailed = parseWorkflowJsonObjectDetailed(goodJson);
      expect(detailed.ok).toBe(true);
      if (detailed.ok) {
        expect(detailed.repaired).toBe(false);
        expect(detailed.object.outputValidation).toEqual({
          targets: ['out.md'],
          lsResult: ['-rw-r--r--@ 1 u  YYCLAW-AI\\Domain Users  13623 Jul  6 15:18 out.md'],
        });
      }
    });

    it('fixes unescaped quotes in string values', () => {
      // 模拟 LLM 输出的非法 JSON：title 内双引号未转义
      const badJson = `{
  "role": "报告撰写师",
  "step": {
    "index": 3,
    "total": 5,
    "title": "撰写"国产GPGPU芯片发展前景"的报告"
  }
}`;
      const result = tryParseWorkflowJsonObject(badJson);
      expect(result).not.toBeNull();
      expect(result?.step).toEqual({
        index: 3,
        total: 5,
        title: '撰写"国产GPGPU芯片发展前景"的报告',
      });
      const detailed = parseWorkflowJsonObjectDetailed(badJson);
      expect(detailed.ok).toBe(true);
      if (detailed.ok) {
        expect(detailed.repaired).toBe(true);
        expect(detailed.raw).toBe(badJson);
      }
    });

    it('fixes multiple unescaped quotes in complex JSON', () => {
      const badJson = `{
  "role": "报告撰写师",
  "step": {
    "index": 3,
    "total": 5,
    "title": "撰写"国产GPGPU芯片发展前景"的报告"
  },
  "inputValidation": {
    "targets": ["a.md", "b.md"],
    "lsResult": ["-rw- a.md", "-rw- b.md"]
  },
  "execution": "已完成",
  "outputValidation": {
    "targets": ["out.md"],
    "lsResult": ["-rw- out.md"]
  },
  "deliverable": {
    "path": "out.md",
    "summary": "摘要",
    "conclusion": "通过"
  },
  "rollback": "无"
}`;
      const result = tryParseWorkflowJsonObject(badJson);
      expect(result).not.toBeNull();
      expect(result?.role).toBe('报告撰写师');
      expect(result?.step?.title).toBe('撰写"国产GPGPU芯片发展前景"的报告');
    });

    it('does not break properly escaped quotes', () => {
      const goodJson = `{
  "role": "test",
  "step": {
    "title": "say \\"hello\\" to user"
  }
}`;
      const result = tryParseWorkflowJsonObject(goodJson);
      expect(result).not.toBeNull();
      expect(result?.step?.title).toBe('say "hello" to user');
    });

    it('fixes trailing commas', () => {
      const jsonWithTrailing = '{"role":"test","step":{"index":1,},}';
      const result = tryParseWorkflowJsonObject(jsonWithTrailing);
      expect(result).not.toBeNull();
      expect(result?.role).toBe('test');
    });

    it('returns null for completely invalid JSON', () => {
      const invalid = 'not json at all';
      const result = tryParseWorkflowJsonObject(invalid);
      expect(result).toBeNull();
    });
  });

  describe('layered workflow JSON validation', () => {
    const validWorkflowJson = `{
  "role": "报告撰写师",
  "step": {
    "index": 3,
    "total": 5,
    "title": "撰写"国产GPGPU芯片发展前景"的报告"
  },
  "inputValidation": {
    "targets": ["a.md"],
    "lsResult": ["-rw-r--r-- 1 demo staff 100 May 28 10:00 a.md"]
  },
  "execution": "已完成报告撰写并落盘。",
  "outputValidation": {
    "targets": ["国产GPGPU芯片发展前景报告-报告撰写师.md"],
    "lsResult": ["-rw-r--r-- 1 demo staff 100 May 28 10:00 国产GPGPU芯片发展前景报告-报告撰写师.md"]
  },
  "deliverable": {
    "path": "国产GPGPU芯片发展前景报告-报告撰写师.md",
    "summary": "系统撰写国产GPGPU发展前景报告五章。",
    "conclusion": "通过"
  },
  "rollback": "无"
}`;

    it('repairs minor syntax and continues to schema parsing while preserving raw', () => {
      const parsed = parseWorkflowJsonOutputDetailed(validWorkflowJson);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.repaired).toBe(true);
        expect(parsed.raw).toBe(validWorkflowJson);
        expect(parsed.json.step.title).toBe('撰写"国产GPGPU芯片发展前景"的报告');
      }
    });

    it('reports missing fields separately from value errors', () => {
      const missing = parseWorkflowJsonOutputDetailed('{"role":"报告撰写师"}');
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.issues).toEqual(['invalid_json_missing_fields']);

      const value = parseWorkflowJsonOutputDetailed(validWorkflowJson.replace('"index": 3', '"index": "3"'));
      expect(value.ok).toBe(false);
      if (!value.ok) expect(value.issues).toEqual(['invalid_json_value']);
    });
  });

  describe('layered Smart JSON validation', () => {
    it('separates missing fields and value errors', () => {
      const missing = validateSmartRoomJsonStructure('{"role":"PM"}', {
        isCoordinator: true,
        actorRoleName: 'PM',
      });
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.issues).toEqual(['invalid_json_missing_fields']);

      const wrongRole = validateSmartRoomJsonStructure(
        '{"role":"其他","taskUnderstanding":"理解任务","inputValidation":"无","action":"review","deliverable":{"items":[],"outputValidation":"无"},"roomReply":"正文","dispatch":[]}',
        { isCoordinator: true, actorRoleName: 'PM' },
      );
      expect(wrongRole.ok).toBe(false);
      if (!wrongRole.ok) expect(wrongRole.issues).toEqual(['invalid_json_value']);
    });
  });

  describe('prompt JSON schema snippets', () => {
    it('escapes dynamic strings in Workflow and Smart schemas', () => {
      const role = '报告"撰写"师';
      const workflowLines = buildWorkflowMergedOutputSpecLines(role);
      const workflowBraceIdx = workflowLines.indexOf('{');
      const workflowSchema = workflowLines.slice(workflowBraceIdx).join('\n');
      expect(() => JSON.parse(workflowSchema)).not.toThrow();
      const smartCoordinatorSchema = buildSmartCoordinatorJsonSchemaLines(role).join('\n');
      expect(() => JSON.parse(smartCoordinatorSchema)).not.toThrow();
      const smartMemberSchema = buildSmartMemberJsonSchemaLines(role).join('\n');
      expect(() => JSON.parse(smartMemberSchema)).not.toThrow();
    });
  });

  describe('workflowJsonDeliverablePathFromText', () => {
    it('extracts path from valid JSON', () => {
      const text = '{"deliverable":{"path":"test.md"}}';
      const path = workflowJsonDeliverablePathFromText(text);
      expect(path).toBe('test.md');
    });

    it('extracts path from JSON with unescaped quotes', () => {
      const text = `{
  "deliverable": {
    "path": "国产GPGPU芯片发展前景报告-报告撰写师.md",
    "summary": "撰写"报告"完成",
    "conclusion": "通过"
  }
}`;
      const path = workflowJsonDeliverablePathFromText(text);
      expect(path).toBe('国产GPGPU芯片发展前景报告-报告撰写师.md');
    });
  });
});
