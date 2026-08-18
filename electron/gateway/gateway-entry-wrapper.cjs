'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const { register } = require('node:module');

const wrapperDir = __dirname;

try {
  register(pathToFileURL(path.join(wrapperDir, 'gateway-esm-loader.mjs')), pathToFileURL(__filename));
  require(path.join(wrapperDir, 'gateway-fetch-preload.cjs'));
} catch (err) {
  console.warn('[ClawX] gateway preloads failed to load:', err);
}

const entry = process.env.CLAWX_OPENCLAW_ENTRY;
if (!entry) {
  console.error('[ClawX] CLAWX_OPENCLAW_ENTRY is not set; cannot start OpenClaw gateway');
  process.exit(1);
}

const entryUrl = path.isAbsolute(entry) ? pathToFileURL(entry).href : entry;

// OpenClaw entry.js only runs the CLI when argv[1] matches a known wrapper (openclaw.mjs).
process.argv[1] = entry;

import(entryUrl).catch((err) => {
  console.error('[ClawX] failed to import OpenClaw entry:', err);
  process.exit(1);
});
