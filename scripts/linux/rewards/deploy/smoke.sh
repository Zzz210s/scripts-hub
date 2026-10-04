#!/usr/bin/env bash
# 冒烟自检(不进编排;手动跑):账号 / 配置 / 登录态 / 浏览器 / 配置同步
set -uo pipefail
export PLAYWRIGHT_BROWSERS_PATH=0
cd /usr/src/microsoft-rewards-script
echo "账号数: $(env | grep -c '^ACCOUNT_[0-9]*_EMAIL=')"
echo "配置: $(stat -c%s config/config.json 2>/dev/null || echo 缺失) 字节"
echo "登录态: $(stat -c%s sessions/sessions.db 2>/dev/null || echo 缺失) 字节"
echo "浏览器目录: $(ls node_modules/patchright-core/.local-browsers/ 2>/dev/null | tr '\n' ' ')"
echo "配置同步:"
node dist/util/ConfigSync.js sync --config config/config.json --example config.example.json 2>&1 | tail -2
echo "浏览器启动:"
node -e 'const {chromium}=require("patchright");chromium.launch({headless:true}).then(async b=>{console.log("  launch ok, version="+b.version());await b.close()}).catch(e=>{console.log("  FAILED: "+e.message);process.exit(1)})'
