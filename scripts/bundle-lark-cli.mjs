#!/usr/bin/env zx
import 'zx/globals';
import { fs, path, $ } from 'zx';
import os from 'os';
import AdmZip from 'adm-zip';
import tar from 'tar';

function getProxy() {
  const candidates = [
    process.env.HTTPS_PROXY,
    process.env.https_proxy,
    process.env.HTTP_PROXY,
    process.env.http_proxy,
    process.env.all_proxy,
    process.env.ALL_PROXY,
  ].filter(Boolean);
  const proxy = candidates.find((p) => p.startsWith('http:') || p.startsWith('https:'));
  return proxy || null;
}

async function fetchWithProxyAndTimeout(url, options = {}, timeoutMs = 600000) { // default 10 mins for large downloads
  const proxy = getProxy();
  const signal = AbortSignal.timeout(timeoutMs);
  
  if (proxy) {
    const { fetch, ProxyAgent } = await import('undici');
    const agent = new ProxyAgent(proxy);
    return await fetch(url, { dispatcher: agent, signal, ...options });
  }
  return await fetch(url, { signal, ...options });
}

async function downloadFile(url, dest) {
  console.log(`     Downloading ${url} -> ${dest}`);
  try {
    const res = await fetchWithProxyAndTimeout(url, { redirect: 'follow' }, 600000); // 10 minutes timeout
    if (!res.ok) throw new Error(`Failed to download ${url}: ${res.statusText}`);
    
    // Use streaming to write the file, which is more robust for large files
    if (res.body && typeof res.body.getReader === 'function') {
      const destStream = fs.createWriteStream(dest);
      for await (const chunk of res.body) {
        destStream.write(Buffer.from(chunk));
      }
      destStream.end();
      
      // Wait for stream to finish
      await new Promise((resolve, reject) => {
        destStream.on('finish', resolve);
        destStream.on('error', reject);
      });
    } else {
      // Fallback if not streamable
      const buffer = await res.arrayBuffer();
      fs.writeFileSync(dest, Buffer.from(buffer));
    }
  } catch (err) {
    throw new Error(`Download failed for ${url}: ${err.message}`);
  }
}

const BUILD_DIR = path.join(process.cwd(), 'build', 'lark-cli-tmp');
const RESOURCES_DIR = path.join(process.cwd(), 'resources');
const SKILLS_BUNDLED_DIR = path.join(RESOURCES_DIR, 'skills-bundled');

const ALL_TARGETS = [
  { os: 'darwin', arch: 'amd64', binName: 'lark-cli' },
  { os: 'darwin', arch: 'arm64', binName: 'lark-cli' },
  { os: 'linux', arch: 'amd64', binName: 'lark-cli' },
  { os: 'linux', arch: 'arm64', binName: 'lark-cli' },
  { os: 'windows', arch: 'amd64', binName: 'lark-cli.exe' },
];

function getTargetsForCurrentPlatform() {
  const platform = os.platform();
  const arch = os.arch();
  const goOs = platform === 'win32' ? 'windows' : platform;
  const goArch = arch === 'x64' ? 'amd64' : arch;
  const binName = platform === 'win32' ? 'lark-cli.exe' : 'lark-cli';
  return [{ os: goOs, arch: goArch, binName }];
}

async function fetchLatestRelease() {
  try {
    const res = await fetchWithProxyAndTimeout('https://api.github.com/repos/larksuite/cli/releases/latest', {}, 60000); // 60 seconds
    if (!res.ok) throw new Error(`Failed to fetch latest release: ${res.statusText}`);
    return await res.json();
  } catch (err) {
    throw new Error(`API fetch failed: ${err.message}`);
  }
}

function getTargetsForPlatform(platformArg) {
  if (platformArg === 'mac') {
    return ALL_TARGETS.filter(t => t.os === 'darwin');
  } else if (platformArg === 'win') {
    return ALL_TARGETS.filter(t => t.os === 'windows');
  } else if (platformArg === 'linux') {
    return ALL_TARGETS.filter(t => t.os === 'linux');
  }
  return [];
}

async function bundleLarkCli() {
  if (process.env.SKIP_BUNDLE_LARK_CLI === '1') {
    console.log('⏭️  SKIP_BUNDLE_LARK_CLI=1, skipping lark-cli bundle.');
    return;
  }

  const buildAll = argv.all === true || argv.all === 'true';
  const platformArg = argv.platform;
  
  let targets;
  if (buildAll) {
    targets = ALL_TARGETS;
  } else if (platformArg) {
    targets = getTargetsForPlatform(platformArg);
    if (targets.length === 0) {
      console.error(`❌ Unknown platform: ${platformArg}`);
      process.exit(1);
    }
  } else {
    targets = getTargetsForCurrentPlatform();
  }

  console.log('📦 Bundling lark-cli from GitHub Releases...');
  if (buildAll) {
    console.log('   Downloading for all platforms (--all)');
  } else if (platformArg) {
    console.log(`   Downloading for platform: ${platformArg}`);
  } else {
    console.log(`   Downloading for current platform only (${os.platform()}-${os.arch()})`);
  }

  let release;
  try {
    release = await fetchLatestRelease();
  } catch (err) {
    console.warn(`⚠️ Could not fetch latest release for lark-cli (likely rate limit or network issue: ${err.message}). Skipping bundle.`);
    return;
  }
  const version = release.tag_name;
  console.log(`   Latest version: ${version}`);

  const hashFile = path.join(RESOURCES_DIR, 'bin', '.lark-cli-build-hash');
  let currentHash = version + (buildAll ? '-all' : (platformArg ? `-${platformArg}` : '-local'));
  
  if (currentHash && fs.existsSync(hashFile)) {
    const previousHash = fs.readFileSync(hashFile, 'utf8').trim();
    let allBinariesExist = true;
    for (const target of targets) {
      const { os: targetOs, arch, binName } = target;
      let destDir;
      if (targetOs === 'darwin') {
        destDir = path.join(RESOURCES_DIR, 'bin', `darwin-${arch === 'amd64' ? 'x64' : arch}`);
      } else if (targetOs === 'linux') {
        destDir = path.join(RESOURCES_DIR, 'bin', `linux-${arch === 'amd64' ? 'x64' : arch}`);
      } else if (targetOs === 'windows') {
        destDir = path.join(RESOURCES_DIR, 'bin', `win32-${arch === 'amd64' ? 'x64' : arch}`);
      }
      if (!fs.existsSync(path.join(destDir, binName))) {
        allBinariesExist = false;
        break;
      }
    }
    
    if (previousHash === currentHash && allBinariesExist && fs.existsSync(SKILLS_BUNDLED_DIR)) {
      console.log('⚡️ lark-cli has not changed, skipping download.');
      return;
    }
  }

  if (fs.existsSync(BUILD_DIR)) {
    fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(BUILD_DIR, { recursive: true });

  console.log('🔨 Downloading binaries...');
  for (const target of targets) {
    const { os: targetOs, arch, binName } = target;
    console.log(`   Downloading for ${targetOs}/${arch}...`);
    
    const ext = targetOs === 'windows' ? 'zip' : 'tar.gz';
    const assetName = `lark-cli-${version.replace(/^v/, '')}-${targetOs}-${arch}.${ext}`;
    const asset = release.assets.find(a => a.name === assetName);
    
    if (!asset) {
      console.error(`❌ Asset not found for ${targetOs}-${arch}: ${assetName}`);
      continue;
    }

    let destDir;
    if (targetOs === 'darwin') {
      destDir = path.join(RESOURCES_DIR, 'bin', `darwin-${arch === 'amd64' ? 'x64' : arch}`);
    } else if (targetOs === 'linux') {
      destDir = path.join(RESOURCES_DIR, 'bin', `linux-${arch === 'amd64' ? 'x64' : arch}`);
    } else if (targetOs === 'windows') {
      destDir = path.join(RESOURCES_DIR, 'bin', `win32-${arch === 'amd64' ? 'x64' : arch}`);
    }

    fs.mkdirSync(destDir, { recursive: true });
    const destPath = path.join(destDir, binName);
    const archivePath = path.join(BUILD_DIR, assetName);

    await downloadFile(asset.browser_download_url, archivePath);
    
    if (ext === 'zip') {
      const zip = new AdmZip(archivePath);
      zip.extractAllTo(BUILD_DIR, true);
      // The executable is named lark-cli.exe in the zip
      fs.renameSync(path.join(BUILD_DIR, 'lark-cli.exe'), destPath);
    } else {
      await tar.x({ file: archivePath, cwd: BUILD_DIR });
      // The executable is named lark-cli in the tarball
      fs.renameSync(path.join(BUILD_DIR, 'lark-cli'), destPath);
      // Ensure executable permissions
      fs.chmodSync(destPath, 0o755);
    }
  }

  console.log('📁 Downloading skills...');
  const sourceArchive = path.join(BUILD_DIR, 'source.tar.gz');
  await downloadFile(`https://github.com/larksuite/cli/archive/refs/tags/${version}.tar.gz`, sourceArchive);
  await tar.x({ file: sourceArchive, cwd: BUILD_DIR });

  const sourceDirName = `cli-${version.replace(/^v/, '')}`;
  const sourceSkillsDir = path.join(BUILD_DIR, sourceDirName, 'skills');

  if (fs.existsSync(sourceSkillsDir)) {
    // We want to copy all skills to resources/skills-bundled/
    // But first, clear the old lark-cli skill if it exists
    if (fs.existsSync(path.join(SKILLS_BUNDLED_DIR, 'lark-cli'))) {
      fs.rmSync(path.join(SKILLS_BUNDLED_DIR, 'lark-cli'), { recursive: true, force: true });
    }
    
    fs.mkdirSync(SKILLS_BUNDLED_DIR, { recursive: true });
    
    const skills = fs.readdirSync(sourceSkillsDir);
    for (const skill of skills) {
      const skillPath = path.join(sourceSkillsDir, skill);
      if (fs.statSync(skillPath).isDirectory() && fs.existsSync(path.join(skillPath, 'SKILL.md'))) {
        const destSkillPath = path.join(SKILLS_BUNDLED_DIR, skill);
        if (fs.existsSync(destSkillPath)) {
          fs.rmSync(destSkillPath, { recursive: true, force: true });
        }
        fs.cpSync(skillPath, destSkillPath, { recursive: true, dereference: true });
        console.log(`   Copied skill: ${skill}`);
      }
    }
  } else {
    console.error(`❌ Source skills directory not found: ${sourceSkillsDir}`);
    process.exit(1);
  }

  console.log('🧹 Cleaning up temporary build directory...');
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });

  if (currentHash) {
    fs.writeFileSync(hashFile, currentHash, 'utf8');
  }

  console.log('✅ lark-cli bundled successfully!');
}

bundleLarkCli().catch((err) => {
  console.error('❌ Failed to bundle lark-cli:', err);
  process.exit(1);
});
