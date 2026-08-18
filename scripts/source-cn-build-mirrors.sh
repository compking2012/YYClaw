#!/usr/bin/env bash
# 供 build_rel.sh source：为 pnpm / Electron / electron-builder 二进制拉取设置国内镜像（可被环境变量覆盖）。
# shellcheck disable=SC2034

export npm_config_registry="${npm_config_registry:-https://registry.npmmirror.com}"
export NPM_CONFIG_REGISTRY="${NPM_CONFIG_REGISTRY:-https://registry.npmmirror.com}"

export ELECTRON_BUILDER_BINARIES_MIRROR="${ELECTRON_BUILDER_BINARIES_MIRROR:-https://npmmirror.com/mirrors/electron-builder-binaries/}"
