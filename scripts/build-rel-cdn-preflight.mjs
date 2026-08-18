#!/usr/bin/env node
/**
 * 检查 generic 更新源上是否存在 NSIS 差分所需的「上一版」安装包与 blockmap；
 * 若缺失则写入 .build-rel/win-eb-args，供 Windows 构建追加 -c.nsis.differentialPackage=false。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, '.build-rel');
const outFile = join(outDir, 'win-eb-args');

function readPublishUrl() {
  const yml = readFileSync(join(root, 'electron-builder.yml'), 'utf8');
  const m = yml.match(/^\s*url:\s*(https?:\/\/\S+)/m);
  return m ? m[1].replace(/\/$/, '') : '';
}

function readProductName() {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  return pkg.productName || 'YYClaw';
}

function releaseChannel(version) {
  const m = String(version).match(/-([a-zA-Z]+)/);
  return m ? m[1] : 'latest';
}

async function resourceExists(url) {
  try {
    let r = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    if (r.status === 405 || r.status === 501) {
      r = await fetch(url, { method: 'GET', redirect: 'follow', headers: { Range: 'bytes=0-0' } });
    }
    return r.ok;
  } catch {
    return false;
  }
}

async function fetchText(url) {
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) return null;
  return await r.text();
}

function parseYmlVersion(body) {
  const m = body.match(/^\s*version:\s*(\S+)/m);
  return m ? m[1].trim() : null;
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outFile, '', 'utf8');

  const publishUrl = readPublishUrl();
  if (!publishUrl) {
    console.warn('[build-rel] 未在 electron-builder.yml 中解析到 publish.url，跳过 CDN 差分预检。');
    return;
  }

  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const current = pkg.version;
  const channel = releaseChannel(current);
  const ymlUrl = `${publishUrl}/${channel}.yml`;
  const ymlBody = await fetchText(ymlUrl);

  if (!ymlBody) {
    console.warn(`[build-rel] 无法拉取 ${ymlUrl}（首次渠道或网络问题）。Windows 将使用非差分 NSIS 构建。`);
    writeFileSync(outFile, '-c.nsis.differentialPackage=false\n', 'utf8');
    return;
  }

  const prev = parseYmlVersion(ymlBody);
  if (!prev) {
    console.warn('[build-rel] latest.yml 中无 version 字段，Windows 将使用非差分 NSIS 构建。');
    writeFileSync(outFile, '-c.nsis.differentialPackage=false\n', 'utf8');
    return;
  }

  const productName = readProductName();
  const base = `${publishUrl}/${productName}-${prev}-win-x64.exe`;
  const exeOk = await resourceExists(base);
  const blockmapOk = await resourceExists(`${base}.blockmap`);

  if (!exeOk || !blockmapOk) {
    console.warn(
      `[build-rel] CDN 上缺少差分依赖（上一版 ${prev}）：exe=${exeOk} blockmap=${blockmapOk}。\n` +
        `        将自动降级为 **非差分** NSIS（与 electron-builder.yml 默认差分相比 installer 元数据不同，属预期）。`,
    );
    writeFileSync(outFile, '-c.nsis.differentialPackage=false\n', 'utf8');
  } else {
    console.log(`[build-rel] CDN 差分预检通过（上一版 ${prev}，当前构建 ${current}）。`);
  }
}

await main();
