#!/usr/bin/env node
/**
 * electron-builder only writes builder-effective-config.yaml outside CI TTY runs.
 * Generate the same release metadata explicitly so CI uploads can include it.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { getElectronVersion } = require('app-builder-lib/out/electron/electronVersion');
const { loadEnv } = require('app-builder-lib/out/util/config/load');
const { getConfig } = require('app-builder-lib/out/util/config/config');
const { safeStringifyJson, serializeToYaml } = require('builder-util');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const commonPath = join(root, 'shared/i18n/locales/en/common.json');
const outDir = join(root, 'release');
const outFile = join(outDir, 'builder-effective-config.yaml');

function toSafeEffectiveConfig(configuration) {
  const safeConfig = JSON.parse(safeStringifyJson(configuration));
  if (safeConfig.cscLink != null) {
    safeConfig.cscLink = '<hidden by builder>';
  }
  return serializeToYaml(safeConfig, true);
}

const common = JSON.parse(await readFile(commonPath, 'utf8'));
process.env.APP_NAME = common.appName;
process.env.APP_COPYRIGHT = common.copyright;

await loadEnv(join(root, 'electron-builder.env'));

const config = await getConfig(root, null, null);
if (config.electronVersion == null) {
  config.electronVersion = await getElectronVersion(root);
}

await mkdir(outDir, { recursive: true });
await writeFile(outFile, toSafeEffectiveConfig(config), 'utf8');
console.log(`[builder-effective-config] wrote ${outFile}`);
