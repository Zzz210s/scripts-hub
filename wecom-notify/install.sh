#!/usr/bin/env sh
# 安装 wecom-notify:把 ./cli.js 注册成全局命令 wecom-notify。
# 可重复执行(幂等)。卸载:npm unlink -g wecom-notify
set -eu

cd "$(dirname "$0")"

log() { printf '%s\n' "$*"; }
fail() { printf '错误: %s\n' "$*" >&2; exit 1; }

check_node() {
    command -v node >/dev/null 2>&1 || fail "未找到 node,请先安装 Node.js 18 或更高版本"
    node -e 'const major = Number(process.versions.node.split(".")[0]); process.exit(major >= 18 ? 0 : 1)' \
        || fail "Node.js 版本过低($(node -v)),需要 18 或更高"
    log "Node.js $(node -v) 检查通过"
}

check_package() {
    [ -f ./package.json ] || fail "当前目录没有 package.json,请在本目录(wecom-notify/)执行本脚本"
    command -v npm >/dev/null 2>&1 || fail "未找到 npm"
}

link_global() {
    log "注册全局命令:npm link"
    npm link --no-fund --no-audit >/dev/null
}

verify() {
    if command -v wecom-notify >/dev/null 2>&1; then
        wecom-notify --help >/dev/null || fail "wecom-notify 命令无法运行"
        log "验证通过:wecom-notify 可用(路径 $(command -v wecom-notify))"
    else
        log "提示:npm 全局 bin 目录不在 PATH 中,可用 node cli.js 直接运行"
    fi
}

next_steps() {
    log ""
    log "下一步:配置企业微信群机器人 webhook"
    log "  1) 在群里依次点:右上角 ... -> 群机器人 -> 添加机器人"
    log "  2) 复制 Webhook 地址(官方说明:https://developer.work.weixin.qq.com/document/path/91770)"
    log "  3) cp wecom-webhook.txt.example wecom-webhook.txt 并把地址粘进去"
    log "  4) 自检:wecom-notify --check"
}

main() {
    log "=== wecom-notify 安装 ==="
    check_package
    check_node
    link_global
    verify
    next_steps
    log ""
    log "安装完成"
}

main "$@"
