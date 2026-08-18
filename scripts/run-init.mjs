#!/usr/bin/env node
/**
 * Install deps, optionally LangGraph packages when langgraph.env enables compile flag,
 * then download bundled uv + agent-browser.
 */
import { spawnSync } from 'node:child_process';
import { loadLangGraphEnvFiles, isLangGraphCompileEnabled } from './is-langgraph-enabled.mjs';

function cliMode() {
  const arg = process.argv.find((a) => a.startsWith('--mode='));
  return arg?.slice('--mode='.length) ?? 'development';
}

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const mode = cliMode();
loadLangGraphEnvFiles(mode);

run('pnpm', ['install']);

if (isLangGraphCompileEnabled()) {
  console.log('[init] langgraph.env enables LangGraph — installing LangGraph optional dependencies.');
  // ignoredOptionalDependencies skips these on plain `pnpm install`; install explicitly when enabled.
  run('pnpm', ['install', '@langchain/langgraph@^1.3.6', 'p-finally@^1.0.0']);
}

run('pnpm', ['run', 'uv:download']);
run('pnpm', ['run', 'agent-browser:download']);
run('pnpm', ['run', 'bundle:lark-cli']);
