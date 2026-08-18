#!/usr/bin/env bash
# 全平台发布构建（mac + linux + win）。
#
# 执行顺序（与下方命令一致）：
#   国内镜像与 ELECTRON_BUILDER_CACHE → CDN 预检（写入 .build-rel/win-eb-args）→
#   （可选）restore-node-modules → restore-resources（meta 命中时把 CI 镜像/tgz 落到 resources/bin、
#   resources/skills-bundled；build-cache 为镜像与 meta 目录）→ pnpm run init →（可选）save-node-modules →
#   ensure-resources（node "$ROOT/scripts/build-rel-cache.mjs" ensure-resources：校验 UV、Win Node、
#   Lark、skills 等；不足则 pnpm run bundle:resources-all-platforms）→
#   pnpm run package（前端 / 主进程 / OpenClaw / plugins / preinstalled skills 仅构建一次）→
#   electron-builder --mac、electron-builder --linux、patch-nsis-win、electron-builder --win →
#   打印 release/ 与耗时 → 收尾 save-resources。
#
# 可选环境变量：
#   YYCLAW_BUILD_REL_CACHE_NODE_MODULES  仅当值为 1 时启用 node_modules 缓存（restore/save 前由
#   build-rel-cache 校验 meta 与 electron/toolchain 钉版本、Node、平台等）。未设置时本脚本 export 为 1。
#   关闭：YYCLAW_BUILD_REL_CACHE_NODE_MODULES=0 ./build_rel.sh（非 1 均不启用缓存逻辑）
#
# resources/build-cache：默认 electron-builder 缓存为 "$ROOT/resources/build-cache/electron-builder"
#（export ELECTRON_BUILDER_CACHE，可被环境变量覆盖）；收尾 save-resources 将 resources 下 bin/skills
# 写回 build-cache 并更新 meta（遗留 *.tgz 仅作一次性迁移来源，见 scripts/build-rel-cache.mjs）。
#
# 发布用 Farm 基址：脚本开始后将 package.json 的 farmApiBaseUrl 临时改为
# http://claw-x.com:9001（供打入安装包），全脚本结束（含失败）时 EXIT trap 恢复原值。
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
cd "$ROOT"

eval "$(node "$ROOT/scripts/is-langgraph-enabled.mjs" --export-shell --mode=production)"

YYCLAW_BUILD_REL_FARM_API_BKP="${YYCLAW_BUILD_REL_FARM_API_BKP:-$ROOT/.build-rel/farmApiBaseUrl.bkp}"
YYCLAW_BUILD_REL_FARM_API_RELEASE="${YYCLAW_BUILD_REL_FARM_API_RELEASE:-http://claw-x.com:9001}"

build_rel_restore_farm_api_base_url() {
  if [[ ! -f "$YYCLAW_BUILD_REL_FARM_API_BKP" ]]; then
    return 0
  fi
  echo "[build_rel] 恢复 package.json 中的 farmApiBaseUrl（退出 trap）…"
  node -e "
const fs = require('fs');
const path = require('path');
const bkp = process.argv[1];
if (!bkp || !fs.existsSync(bkp)) process.exit(0);
const pkgPath = path.join(process.cwd(), 'package.json');
let j;
try {
  j = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
} catch {
  process.exit(0);
}
const orig = JSON.parse(fs.readFileSync(bkp, 'utf8'));
j.farmApiBaseUrl = orig;
fs.writeFileSync(pkgPath, JSON.stringify(j, null, 4) + '\n');
try { fs.unlinkSync(bkp); } catch (_) {}
" "$YYCLAW_BUILD_REL_FARM_API_BKP" || true
}

build_rel_apply_release_farm_api_base_url() {
  mkdir -p "$ROOT/.build-rel"
  echo "[build_rel] 发布构建：临时将 package.json 的 farmApiBaseUrl 设为 ${YYCLAW_BUILD_REL_FARM_API_RELEASE} …"
  node -e "
const fs = require('fs');
const path = require('path');
const pkgPath = path.join(process.cwd(), 'package.json');
const bkp = process.argv[1];
const releaseUrl = process.argv[2];
const j = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
fs.writeFileSync(bkp, JSON.stringify(j.farmApiBaseUrl ?? null));
j.farmApiBaseUrl = releaseUrl;
fs.writeFileSync(pkgPath, JSON.stringify(j, null, 4) + '\n');
" "$YYCLAW_BUILD_REL_FARM_API_BKP" "$YYCLAW_BUILD_REL_FARM_API_RELEASE"
}

trap build_rel_restore_farm_api_base_url EXIT
build_rel_apply_release_farm_api_base_url

# 未在外部设置时默认为 1（与下方「仅 == 1 才调用 restore/save」一致）；外部设为 0 等可关闭。
if [[ -z "${YYCLAW_BUILD_REL_CACHE_NODE_MODULES+x}" ]]; then
  export YYCLAW_BUILD_REL_CACHE_NODE_MODULES=1
fi

build_rel_save_resources() {
  echo "[build_rel] 更新 resources/build-cache（meta + CI 镜像；发布资源以 resources/bin 等为准）…"
  node "$ROOT/scripts/build-rel-cache.mjs" save-resources || true
}

SECONDS=0
echo "[build_rel] 全平台构建开始: $(date '+%Y-%m-%d %H:%M:%S %z')"

# shellcheck disable=SC1091
source "$ROOT/scripts/source-cn-build-mirrors.sh"

unset ELECTRON_MIRROR NPM_CONFIG_ELECTRON_MIRROR npm_config_electron_mirror npm_package_config_electron_mirror 2>/dev/null || true

# dmg-builder 等与上游 electron-builder 共用缓存根；meta 在 save-resources 末尾更新，restore 时若不一致则清理。
export ELECTRON_BUILDER_CACHE="${ELECTRON_BUILDER_CACHE:-$ROOT/resources/build-cache/electron-builder}"
mkdir -p "$ELECTRON_BUILDER_CACHE"

mkdir -p "$ROOT/.build-rel"
node "$ROOT/scripts/build-rel-cdn-preflight.mjs"

if [[ "$YYCLAW_BUILD_REL_CACHE_NODE_MODULES" == "1" ]]; then
  node "$ROOT/scripts/build-rel-cache.mjs" restore-node-modules || true
fi

# restore-resources：校验 meta 后恢复 resources/bin、resources/skills-bundled（见 build-rel-cache）。
node "$ROOT/scripts/build-rel-cache.mjs" restore-resources || true

# pnpm 无法在仓库根 node_modules 为符号链接或非目录时安装（旧版曾链到 build-cache；restore 因 meta 缺失跳过时不清理）。
if [[ -L "$ROOT/node_modules" ]] || ([[ -e "$ROOT/node_modules" ]] && [[ ! -d "$ROOT/node_modules" ]]); then
  echo "[build_rel] 移除旧的 node_modules（符号链接或非目录），以便 pnpm install …"
  rm -rf "$ROOT/node_modules"
fi

pnpm run init -- --mode=production

if [[ "$YYCLAW_BUILD_REL_CACHE_NODE_MODULES" == "1" ]]; then
  node "$ROOT/scripts/build-rel-cache.mjs" save-node-modules || true
fi

echo "[build_rel] 检查 resources 是否完备（含资源包版本）；不完备则全量拉取 uv / lark-cli / skills / Windows node …"
node "$ROOT/scripts/build-rel-cache.mjs" ensure-resources

echo "[build_rel] 构建应用基础产物（Vite / Electron main / OpenClaw / plugins / preinstalled skills）…"
pnpm run package

echo "[build_rel] electron-builder --mac …"
node "$ROOT/scripts/electron-builder-env.mjs" --mac

echo "[build_rel] electron-builder --linux …"
node "$ROOT/scripts/electron-builder-env.mjs" --linux

WIN_ARGS=()
if [[ -f "$ROOT/.build-rel/win-eb-args" ]]; then
  while IFS= read -r line || [[ -n "${line:-}" ]]; do
    [[ -z "${line// }" ]] && continue
    [[ "$line" == \#* ]] && continue
    WIN_ARGS+=("$line")
  done <"$ROOT/.build-rel/win-eb-args"
fi

echo "[build_rel] patch-nsis-win …"
node "$ROOT/scripts/patch-nsis-win.mjs"

echo "[build_rel] electron-builder --win …"
if [[ ${#WIN_ARGS[@]} -gt 0 ]]; then
  node "$ROOT/scripts/electron-builder-env.mjs" --win "${WIN_ARGS[@]}"
else
  node "$ROOT/scripts/electron-builder-env.mjs" --win
fi

elapsed=$SECONDS
echo "[build_rel] 全平台生成物已就绪: $(date '+%Y-%m-%d %H:%M:%S %z')"
if [[ -d "$ROOT/release" ]]; then
  echo "[build_rel] 生成物（release/ 顶层）："
  ls -la "$ROOT/release" || true
else
  echo "[build_rel] 提示：未找到 release/ 目录（若构建失败或未产出安装包属预期）。"
fi

msg='[build_rel] 总耗时（脚本开始 -> mac/linux/win 安装包与归档产物生成完毕）'
if ((elapsed >= 3600)); then
  printf '%s: %d 小时 %d 分 %d 秒（合计 %d 秒）\n' "$msg" $((elapsed / 3600)) $(((elapsed % 3600) / 60)) $((elapsed % 60)) "$elapsed"
elif ((elapsed >= 60)); then
  printf '%s: %d 分 %d 秒（合计 %d 秒）\n' "$msg" $((elapsed / 60)) $((elapsed % 60)) "$elapsed"
else
  printf '%s: %d 秒\n' "$msg" "$elapsed"
fi

echo "✅ build_rel.sh：全平台构建已完成（产物目录 release/）。"
build_rel_save_resources
