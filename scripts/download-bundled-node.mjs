#!/usr/bin/env zx

import { spawnSync } from 'node:child_process';
import 'zx/globals';

const ROOT_DIR = path.resolve(__dirname, '..');
const NODE_VERSION = '22.22.3';
const BASE_URL = `https://nodejs.org/dist/v${NODE_VERSION}`;
const OUTPUT_BASE = path.join(ROOT_DIR, 'resources', 'bin');

const TARGETS = {
  'win32-x64': {
    filename: `node-v${NODE_VERSION}-win-x64.zip`,
    sourceDir: `node-v${NODE_VERSION}-win-x64`,
  },
  'win32-arm64': {
    filename: `node-v${NODE_VERSION}-win-arm64.zip`,
    sourceDir: `node-v${NODE_VERSION}-win-arm64`,
  },
};

const PLATFORM_GROUPS = {
  win: ['win32-x64'],
};

async function setupTarget(id) {
  const target = TARGETS[id];
  if (!target) {
    echo(chalk.yellow`⚠️ Target ${id} is not supported by this script.`);
    return;
  }

  const targetDir = path.join(OUTPUT_BASE, id);
  const tempDir = path.join(ROOT_DIR, 'temp_node_extract');
  const archivePath = path.join(ROOT_DIR, target.filename);
  const downloadUrl = `${BASE_URL}/${target.filename}`;
  const outputNode = path.join(targetDir, 'node.exe');

  echo(chalk.blue`\n📦 Setting up Node.js for ${id}...`);

  //await fs.remove(targetDir);
  await fs.remove(tempDir);
  await fs.ensureDir(targetDir);
  await fs.ensureDir(tempDir);

  try {
    echo`⬇️ Downloading: ${downloadUrl}`;
    const response = await fetch(downloadUrl);
    if (!response.ok) throw new Error(`Failed to download: ${response.statusText}`);
    const buffer = await response.arrayBuffer();
    await fs.writeFile(archivePath, Buffer.from(buffer));

    echo`📂 Extracting...`;
    if (os.platform() === 'win32') {
      const { execFileSync } = await import('child_process');
      const psCommand = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${archivePath.replace(/'/g, "''")}', '${tempDir.replace(/'/g, "''")}')`;
      execFileSync('powershell.exe', ['-NoProfile', '-Command', psCommand], { stdio: 'inherit' });
    } else {
      await $`unzip -q -o ${archivePath} -d ${tempDir}`;
    }

    const expectedNode = path.join(tempDir, target.sourceDir, 'node.exe');
    if (await fs.pathExists(expectedNode)) {
      await fs.move(expectedNode, outputNode, { overwrite: true });
    } else {
      echo(chalk.yellow`🔍 node.exe not found in expected directory, searching...`);
      const files = await glob('**/node.exe', { cwd: tempDir, absolute: true });
      if (files.length > 0) {
        await fs.move(files[0], outputNode, { overwrite: true });
      } else {
        throw new Error('Could not find node.exe in extracted files.');
      }
    }

    echo(chalk.green`✅ Success: ${outputNode}`);
  } finally {
    await fs.remove(archivePath);
    await fs.remove(tempDir);
  }
}

function syncMetaBinAfterNodeDownload() {
  const script = path.join(ROOT_DIR, 'scripts', 'build-rel-cache.mjs');
  const r = spawnSync(process.execPath, [script, 'sync-meta-bin'], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    echo(chalk.red`❌ sync-meta-bin 失败（exit ${r.status ?? '∅'}）`);
    process.exit(r.status ?? 1);
  }
}

const downloadAll = argv.all;
const platform = argv.platform;

if (downloadAll) {
  echo(chalk.cyan`🌐 Downloading Node.js binaries for all Windows targets...`);
  for (const id of Object.keys(TARGETS)) {
    await setupTarget(id);
  }
  syncMetaBinAfterNodeDownload();
} else if (platform) {
  const targets = PLATFORM_GROUPS[platform];
  if (!targets) {
    echo(chalk.red`❌ Unknown platform: ${platform}`);
    echo(`Available platforms: ${Object.keys(PLATFORM_GROUPS).join(', ')}`);
    process.exit(1);
  }
  echo(chalk.cyan`🎯 Downloading Node.js binaries for platform: ${platform}`);
  for (const id of targets) {
    await setupTarget(id);
  }
  syncMetaBinAfterNodeDownload();
} else {
  const currentId = `${os.platform()}-${os.arch()}`;
  if (TARGETS[currentId]) {
    echo(chalk.cyan`💻 Detected Windows system: ${currentId}`);
    await setupTarget(currentId);
  } else {
    echo(chalk.cyan`🎯 Defaulting to Windows multi-arch Node.js download`);
    for (const id of PLATFORM_GROUPS.win) {
      await setupTarget(id);
    }
  }
  syncMetaBinAfterNodeDownload();
}

echo(chalk.green`\n🎉 Done!`);
