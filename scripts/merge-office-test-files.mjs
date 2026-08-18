#!/usr/bin/env node
/**
 * One-shot merge: consolidate office test files to ≤6 programs.
 *
 * Result:
 *   tests/unit/office-core.test.ts      ← + office-project
 *   tests/unit/office-room.test.ts      ← + office-task-mention
 *   tests/unit/office-workflow.test.ts  ← + office-store-persist
 *   tests/unit/office-smart.test.ts     (unchanged)
 *   tests/integration/office-workflow-resume.integration.test.ts (unchanged)
 *   tests/e2e/office.spec.ts            (unchanged)
 */
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const UNIT = join(ROOT, 'tests', 'unit');

function skipWsAndComments(src, pos) {
  while (pos < src.length) {
    if (/\s/.test(src[pos])) {
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

function peelImports(code) {
  const imports = [];
  let pos = 0;
  while (pos < code.length) {
    pos = skipWsAndComments(code, pos);
    if (!code.startsWith('import', pos)) break;
    const start = pos;
    const rest = code.slice(start);
    const fromRe = /\sfrom\s+(['"])(?:\\.|(?!\1).)*\1\s*;?/;
    const m = fromRe.exec(rest);
    if (!m) break;
    pos = start + m.index + m[0].length;
    let stmt = code.slice(start, pos).trim();
    if (!stmt.endsWith(';')) stmt += ';';
    imports.push(stmt);
  }
  return { imports, body: code.slice(pos).trim() };
}

function extractHoistedAndMocks(code) {
  const hoisted = [];
  const mocks = [];
  let rest = code;
  const hoistedRe = /^const\s+\w+\s*=\s*vi\.hoisted\([\s\S]*?\);\s*/m;
  const mockRe = /^vi\.mock\([\s\S]*?\)\);\s*/m;
  while (true) {
    rest = rest.replace(/^\/\/[^\n]*\n/, '');
    const hm = hoistedRe.exec(rest);
    if (hm) {
      hoisted.push(hm[0].trim());
      rest = rest.slice(hm.index + hm[0].length);
      continue;
    }
    const mm = mockRe.exec(rest);
    if (mm) {
      mocks.push(mm[0].trim());
      rest = rest.slice(mm.index + mm[0].length);
      continue;
    }
    break;
  }
  return { hoisted, mocks, body: rest.trim() };
}

function collectVitestSymbols(sources) {
  const symbols = new Set(['describe', 'it', 'expect']);
  const symRe = /import\s*\{([^}]+)\}\s*from\s*['"]vitest['"]/g;
  for (const src of sources) {
    let m;
    while ((m = symRe.exec(src)) !== null) {
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (name) symbols.add(name);
      }
    }
  }
  const order = ['describe', 'it', 'test', 'expect', 'vi', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll'];
  return [...symbols].sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.localeCompare(b);
  }).join(', ');
}

function importModuleKey(line) {
  const m = line.match(/from\s+(['"])(.+?)\1/);
  return m?.[2] ?? line.replace(/\s+/g, ' ').trim();
}

function dedupeImports(importLines) {
  const byModule = new Map();
  for (const line of importLines) {
    const key = line.replace(/\s+/g, ' ').trim();
    if (key.includes("from 'vitest'") || key.includes('from "vitest"')) continue;
    const mod = importModuleKey(line);
    const prev = byModule.get(mod);
    if (!prev || (mod.startsWith('.') && line.includes("'node:"))) {
      byModule.set(mod, line);
    } else if (!prev.includes("'node:") && line.includes("'node:")) {
      byModule.set(mod, line);
    }
  }
  return [...byModule.values()].sort((a, b) => a.localeCompare(b));
}

function stripMergedHeader(code) {
  return code.replace(/^\/\/ Merged office unit tests[^\n]*\n/, '');
}

function countMergedSources(code) {
  const m = code.match(/^\/\/ Merged office unit tests — (\d+) sources/m);
  return m ? Number(m[1]) : 0;
}

function mergeIntoTarget(targetFile, sourceFiles, { prependMocks = false } = {}) {
  const targetPath = join(UNIT, targetFile);
  const targetSrc = stripMergedHeader(readFileSync(targetPath, 'utf-8'));
  const { imports: targetImports, body: targetBody } = peelImports(targetSrc);

  let extraHoisted = [];
  let extraMocks = [];
  const allImports = [...targetImports];
  const extraBodies = [];
  let addedSources = 0;
  const targetAlreadyHasPersistMocks = /persistEnv\s*=\s*vi\.hoisted/.test(targetBody);

  for (const srcFile of sourceFiles) {
    const srcPath = join(UNIT, srcFile);
    if (!existsSync(srcPath)) {
      console.warn('Skip missing', srcFile);
      continue;
    }
    let raw = stripMergedHeader(readFileSync(srcPath, 'utf-8'));
    addedSources += countMergedSources(readFileSync(srcPath, 'utf-8')) || 1;

    const { hoisted, mocks, body: afterMocks } = extractHoistedAndMocks(raw);
    if (!targetAlreadyHasPersistMocks) {
      extraHoisted.push(...hoisted);
      extraMocks.push(...mocks);
    }

    const { imports, body } = peelImports(afterMocks);
    allImports.push(...imports);
    const suiteMarker = srcFile.replace(/\.test\.ts$/, '').replace(/^office-/, '');
    if (targetBody.includes(`describe('office ${suiteMarker}'`) || targetBody.includes(`describe("office ${suiteMarker}"`)) {
      console.warn(`Skip body merge for ${srcFile} — already present in ${targetFile}`);
      continue;
    }
    extraBodies.push(`\n// --- merged from ${srcFile} ---\n\n${body}`);
  }

  const baseCount = countMergedSources(readFileSync(targetPath, 'utf-8')) || 1;
  const totalSources = baseCount + addedSources;
  const vitestSyms = collectVitestSymbols([targetSrc, ...sourceFiles.map((f) => readFileSync(join(UNIT, f), 'utf-8'))]);

  let bodyOut = targetBody;
  if (prependMocks && (extraHoisted.length || extraMocks.length)) {
    const mockBlock = [...extraHoisted, ...extraMocks].join('\n\n');
    const insertAt = bodyOut.search(/^(?:vi\.mock|const\s+\w+\s*=\s*vi\.hoisted)/m);
    if (insertAt >= 0) {
      bodyOut = `${bodyOut.slice(0, insertAt).trimEnd()}\n\n${mockBlock}\n\n${bodyOut.slice(insertAt)}`;
    } else {
      bodyOut = `${mockBlock}\n\n${bodyOut}`;
    }
  } else if (extraHoisted.length || extraMocks.length) {
    bodyOut = `${[...extraHoisted, ...extraMocks].join('\n\n')}\n\n${bodyOut}`;
  }

  bodyOut += extraBodies.join('\n');

  const header = `// Merged office unit tests — ${totalSources} sources\n`;
  const out =
    header +
    `import { ${vitestSyms} } from 'vitest';\n` +
    dedupeImports(allImports).join('\n') +
    '\n\n' +
    bodyOut +
    '\n';

  writeFileSync(targetPath, out);
  console.log(`Merged into ${targetFile} (+${sourceFiles.join(', ')}) → ${totalSources} sources`);

  for (const srcFile of sourceFiles) {
    const srcPath = join(UNIT, srcFile);
    if (existsSync(srcPath)) {
      unlinkSync(srcPath);
      console.log('  deleted', srcFile);
    }
  }
}

const MERGE_PLAN = [
  { target: 'office-core.test.ts', sources: ['office-project.test.ts'] },
  { target: 'office-room.test.ts', sources: ['office-task-mention.test.ts'] },
  { target: 'office-workflow.test.ts', sources: ['office-store-persist.test.ts'], prependMocks: true },
];

for (const { target, sources, prependMocks = false } of MERGE_PLAN) {
  const available = sources.filter((s) => existsSync(join(UNIT, s)));
  if (!available.length) continue;
  mergeIntoTarget(target, available, { prependMocks });
}

console.log('\nOffice test files: 6 total');
console.log('  unit: office-core, office-room, office-smart, office-workflow');
console.log('  integration: office-workflow-resume.integration.test.ts');
console.log('  e2e: office.spec.ts');
