#!/usr/bin/env node
/**
 * LangGraph compile flag verification for dist-electron/main:
 * - OFF: no langgraph/langchain artifacts in output
 * - ON: LangChain/LangGraph deps inlined (no external require() to bundled packages)
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MAIN_PROCESS_BUNDLED_ROOT_PACKAGES,
  collectBundledPackageGraph,
} from './electron-main-bundled-packages.mjs';
import { isLangGraphCompileEnabled, loadLangGraphEnvFiles } from './is-langgraph-enabled.mjs';

loadLangGraphEnvFiles('production');

const ROOT = join(import.meta.dirname, '..');
const MAIN_OUT = join(ROOT, 'dist-electron', 'main');

const FORBIDDEN_REQUIRE_RE =
  /require\s*\(\s*['"]((?:@langchain\/[^'"]+|langsmith(?:\/[^'"]+)?|p-finally|p-timeout))['"]\s*\)/g;

const LANGGRAPH_PACKAGE_RE = /@langchain\/|require\s*\(\s*['"]@langchain|from\s+['"]@langchain|langsmith(?:\/[^'"]+)?['"]\s*\)/;
const LANGGRAPH_CHUNK_NAME_RE = /langgraph/i;

function listJsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function isLangGraphBundleArtifact(relPath, text) {
  const base = relPath.split('/').pop() ?? relPath;
  if (LANGGRAPH_CHUNK_NAME_RE.test(base) && !/^index(-.*)?\.js$/.test(base)) {
    return true;
  }
  return LANGGRAPH_PACKAGE_RE.test(text);
}

function verifyLangGraphDisabled() {
  const violations = [];
  for (const file of listJsFiles(MAIN_OUT)) {
    const rel = file.slice(ROOT.length + 1);
    const text = readFileSync(file, 'utf8');
    if (isLangGraphBundleArtifact(rel, text)) {
      violations.push(rel);
    }
  }
  if (violations.length > 0) {
    console.error('[verify-electron-main-bundle] LangGraph is off but main output still contains LangGraph artifacts:');
    for (const file of violations) {
      console.error(`  - ${file}`);
    }
    process.exit(1);
  }
  console.log('[verify-electron-main-bundle] OK — LangGraph off, no LangGraph artifacts in main bundle.');
}

function verifyLangGraphEnabled() {
  const bundled = collectBundledPackageGraph(ROOT, MAIN_PROCESS_BUNDLED_ROOT_PACKAGES);
  const violations = [];

  for (const file of listJsFiles(MAIN_OUT)) {
    const text = readFileSync(file, 'utf8');
    FORBIDDEN_REQUIRE_RE.lastIndex = 0;
    let match;
    while ((match = FORBIDDEN_REQUIRE_RE.exec(text)) !== null) {
      violations.push({
        file: file.slice(ROOT.length + 1),
        specifier: match[1],
      });
    }
  }

  if (violations.length > 0) {
    console.error('[verify-electron-main-bundle] Found unresolved runtime requires:');
    for (const v of violations) {
      console.error(`  - ${v.file}: require("${v.specifier}")`);
    }
    console.error('');
    console.error(
      'LangChain/LangGraph deps must be bundled into dist-electron/main (see vite.config.ts).',
    );
    console.error(`Expected bundled packages (${bundled.size}): ${[...bundled].sort().join(', ')}`);
    process.exit(1);
  }

  console.log(
    `[verify-electron-main-bundle] OK — LangGraph on, ${bundled.size} packages inlined, no external requires.`,
  );
}

function main() {
  if (!existsSync(MAIN_OUT)) {
    console.error(`[verify-electron-main-bundle] Missing output dir: ${MAIN_OUT}`);
    console.error('Run pnpm run build:vite first.');
    process.exit(1);
  }

  if (isLangGraphCompileEnabled()) {
    verifyLangGraphEnabled();
  } else {
    verifyLangGraphDisabled();
  }
}

main();
