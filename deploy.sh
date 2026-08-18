#!/bin/bash
set -e

CHANNEL=${1:-latest}
echo "🚀 开始发布新版本，渠道: $CHANNEL"

SERVER="root@claw-x.com"
REMOTE_DIR="/data/yyclaw-update-server-https/data/$CHANNEL/"

echo "🌐 确保服务器远程目录存在..."
ssh -p 22 $SERVER "mkdir -p $REMOTE_DIR"

echo "📤 正在上传发布产物到 $SERVER:$REMOTE_DIR..."
# 仅上传 release/ 下的文件，跳过其子目录和子目录中的文件
find release -maxdepth 1 -type f -exec scp -P 22 {} $SERVER:$REMOTE_DIR \;

echo "✅ 发布完成！请客户端验证更新。"
