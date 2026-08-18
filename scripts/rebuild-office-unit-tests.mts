/**
 * Merge tests/unit/office-*.test.ts into 6 domain files:
 *   office-workflow | office-room | office-smart | office-project | office-task-mention | office-core
 *
 * Usage:
 *   node scripts/merge-office-test-files.mjs   # consolidate to 4 unit + integration + e2e
 *   node scripts/rebuild-office-unit-tests.mts # rebuild from granular office-*.test.ts sources
 *
 * Notes:
 * - Each source file is wrapped in describe('__merged__:<basename>', ...) to avoid top-level symbol clashes.
 * - Files with top-level vi.mock are not wrapped (mocks must stay at module scope; use vi.hoisted for mock fns).
 */
import { readFileSync, writeFileSync, unlinkSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = join(import.meta.dirname, '..');
const UNIT = join(ROOT, 'tests', 'unit');

const TARGETS = [
  'office-workflow.test.ts',
  'office-room.test.ts',
  'office-smart.test.ts',
  'office-project.test.ts',
  'office-task-mention.test.ts',
  'office-core.test.ts',
];

const GROUP_PREDICATES: Array<{ target: string; pred: (basename: string) => boolean }> = [
  {
    target: 'office-workflow.test.ts',
    pred: (b) => b.startsWith('office-workflow-') || b === 'office-task-workflow.test.ts',
  },
  { target: 'office-room.test.ts', pred: (b) => b.startsWith('office-room-') },
  { target: 'office-smart.test.ts', pred: (b) => b.startsWith('office-smart-') },
  { target: 'office-project.test.ts', pred: (b) => b.startsWith('office-project-') },
  {
    target: 'office-task-mention.test.ts',
    pred: (b) =>
      (b.startsWith('office-task-') && b !== 'office-task-workflow.test.ts') ||
      b.startsWith('office-mention') ||
      b === 'office-implicit-role-mention.test.ts' ||
      b === 'office-missing-mention-audit.test.ts' ||
      b === 'office-run-completion.test.ts',
  },
  { target: 'office-core.test.ts', pred: () => true },
];

function assignGroup(basename: string): string {
  if (basename.startsWith('office-recovered-')) {
    const m = basename.match(/^office-recovered-office-(\w+)-/);
    if (m) {
      const domain = m[1];
      const map: Record<string, string> = {
        workflow: 'office-workflow.test.ts',
        room: 'office-room.test.ts',
        smart: 'office-smart.test.ts',
        project: 'office-project.test.ts',
        task: 'office-task-mention.test.ts',
        mention: 'office-task-mention.test.ts',
        core: 'office-core.test.ts',
      };
      if (map[domain]) return map[domain]!;
    }
  }
  for (const { target, pred } of GROUP_PREDICATES) {
    if (target === 'office-core.test.ts') continue;
    if (pred(basename)) return target;
  }
  return 'office-core.test.ts';
}

function skipWsAndComments(src: string, pos: number): number {
  while (pos < src.length) {
    if (/\s/.test(src[pos]!)) {
      pos++;
      continue;
    }
    if (src.startsWith('//', pos)) {
      const nl = src.indexOf('\n', pos);
      pos = nl === -1 ? src.length : nl + 1;
      continue;
    }
    if (src.startsWith('/*', pos)) {
      const end = src.indexOf('*/', pos + 2);
      pos = end === -1 ? src.length : end + 2;
      continue;
    }
    break;
  }
  return pos;
}

function peelImports(code: string): { imports: string[]; body: string } {
  const imports: string[] = [];
  let pos = 0;
  while (pos < code.length) {
    pos = skipWsAndComments(code, pos);
    if (!code.startsWith('import', pos)) break;
    const start = pos;
    const rest = code.slice(start);
    const fromRe = /\sfrom\s+(['"])(?:\\.|(?!\1).)*\1\s*;?/;
    const m = fromRe.exec(rest);
    if (!m) break;
    pos = start + m.index! + m[0].length;
    let stmt = code.slice(start, pos).trim();
    if (!stmt.endsWith(';')) stmt += ';';
    imports.push(stmt);
  }
  return { imports, body: code.slice(pos).trim() };
}

function collectVitestSymbols(sources: string[]): string {
  const symbols = new Set<string>();
  const symRe = /import\s*\{([^}]+)\}\s*from\s*['"]vitest['"]/g;
  for (const src of sources) {
    let m: RegExpExecArray | null;
    while ((m = symRe.exec(src)) !== null) {
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (name) symbols.add(name);
      }
    }
  }
  const order = ['describe', 'it', 'test', 'expect', 'vi', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll'];
  return [...symbols]
    .sort((a, b) => {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      if (ai >= 0 && bi >= 0) return ai - bi;
      if (ai >= 0) return -1;
      if (bi >= 0) return 1;
      return a.localeCompare(b);
    })
    .join(', ');
}

function dedupeImports(importLines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of importLines) {
    const key = line.replace(/\s+/g, ' ').trim();
    if (key.includes("from 'vitest'") || key.includes('from "vitest"')) continue;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(line);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((l) => (l.trim() === '' ? l : pad + l))
    .join('\n');
}

function wrapSegment(body: string, suiteId: string): string {
  const trimmed = body.trim();
  if (!trimmed) return '';
  if (/^\s*vi\.mock\s*\(/m.test(trimmed)) return trimmed;
  return `describe(${JSON.stringify(suiteId)}, () => {\n${indent(trimmed, 2)}\n});`;
}

function extractTopLevelDescribes(src: string): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = [];
  let pos = 0;
  const { body } = peelImports(src.replace(/^\/\/ Merged[^\n]*\n/, ''));
  while (pos < body.length) {
    pos = skipWsAndComments(body, pos);
    const m = body.slice(pos).match(/^describe\s*\(\s*(['"])(.*?)\1\s*,\s*(?:async\s*)?\(\)\s*=>\s*\{/);
    if (!m) break;
    const name = m[2]!;
    const start = pos + m[0].length - 1;
    let depth = 0;
    let i = start;
    for (; i < body.length; i++) {
      const ch = body[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }
    const block = body.slice(pos, i).trim();
    out.push({ name, body: block });
    pos = i;
    while (pos < body.length && /\s/.test(body[pos]!)) pos++;
  }
  return out;
}

// 1) Extract segments from current office-core (includes wrongly merged recovered blocks)
const corePath = join(UNIT, 'office-core.test.ts');
const extractedDir = join(UNIT, '.office-extract-tmp');
if (existsSync(corePath)) {
  const segments = extractTopLevelDescribes(readFileSync(corePath, 'utf-8'));
  mkdirSync(extractedDir, { recursive: true });
  for (const seg of segments) {
    if (!seg.name.startsWith('__merged__:office-recovered-')) continue;
    const wrapped = seg.body.match(/^describe\s*\([^)]+\)\s*=>\s*\{([\s\S]*)\}\s*$/);
    const inner = (wrapped?.[1] ?? seg.body).trim();
    const file = `${seg.name.replace('__merged__:', '')}.test.ts`;
    const vitest = "import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';";
    writeFileSync(join(extractedDir, file), `${vitest}\n\n${inner}\n`);
    console.log('Extracted', file);
  }
}

// 2) Restore git-tracked office tests
const tracked = execSync('git ls-files "tests/unit/office-*.test.ts"', { cwd: ROOT, encoding: 'utf-8' })
  .trim()
  .split('\n')
  .filter(Boolean);
for (const rel of tracked) {
  if (TARGETS.some((t) => rel.endsWith(t))) continue;
  try {
    writeFileSync(join(ROOT, rel), execSync(`git show HEAD:${rel}`, { cwd: ROOT, encoding: 'utf-8' }));
  } catch {
    /* skip */
  }
}
console.log(`Restored ${tracked.length} files from HEAD`);

// 3) Delete merged targets and re-collect sources
for (const t of TARGETS) {
  const p = join(UNIT, t);
  if (existsSync(p)) unlinkSync(p);
}

const sources: string[] = [];
for (const f of readdirSync(UNIT)) {
  if (!f.startsWith('office-') || !f.endsWith('.test.ts')) continue;
  if (TARGETS.includes(f)) continue;
  sources.push(f);
}
if (existsSync(extractedDir)) {
  for (const f of readdirSync(extractedDir)) {
    if (f.endsWith('.test.ts')) {
      writeFileSync(join(UNIT, f), readFileSync(join(extractedDir, f)));
      sources.push(f);
    }
  }
}

const assigned = new Map<string, string[]>();
for (const f of sources.sort()) {
  const g = assignGroup(f);
  if (!assigned.has(g)) assigned.set(g, []);
  assigned.get(g)!.push(f);
}

for (const target of TARGETS) {
  const files = assigned.get(target) ?? [];
  if (!files.length) continue;
  const fileSources = files.map((f) => readFileSync(join(UNIT, f), 'utf-8'));
  const vitestSyms = collectVitestSymbols(fileSources);
  const allImports: string[] = [];
  const bodies: string[] = [];
  for (const f of files) {
    const src = readFileSync(join(UNIT, f), 'utf-8');
    const { imports, body } = peelImports(src);
    allImports.push(...imports);
    const suiteId = `__merged__:${f.replace(/\.test\.ts$/, '')}`;
    bodies.push(wrapSegment(body, suiteId));
  }
  const header = `// Merged office unit tests — ${files.length} sources\n`;
  const out =
    header +
    `import { ${vitestSyms} } from 'vitest';\n` +
    dedupeImports(allImports).join('\n') +
    '\n\n' +
    bodies.join('\n\n') +
    '\n';
  writeFileSync(join(UNIT, target), out);
  console.log(`Wrote ${target} (${files.length} files)`);
}

for (const f of sources) {
  unlinkSync(join(UNIT, f));
}
if (existsSync(extractedDir)) {
  execSync(`rm -rf "${extractedDir}"`);
}
console.log('Done. 6 merged files ready for import patch.');
