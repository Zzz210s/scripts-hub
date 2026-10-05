#!/usr/bin/env bash
# 服务器侧体检:漂移检查 / 隐私检查 / systemd unit 对比 / 备份盘点。
#
# 用法(宿主上):
#   suite-check              # 四项全跑
#   suite-check drift        # 只跑企业微信发送实现的一致性检查
#   suite-check privacy      # 只跑脱敏体检
#   suite-check units        # 只对比生成的 systemd unit 与 /etc/systemd/system 里现装的
#   suite-check backup       # 只做备份盘点(--dry-run,不推任何东西)
#
# 挂载约定(见 compose.yaml 的 suite-check 服务):
#   /repo     宿主上的 scripts-hub 克隆(只读)—— 工具本体
#   /private  ~/.config/automation-suite(只读)—— 个人标识清单与路径展开表
#   /data     /srv/apps/automation(只读)—— 备份盘点的对象
#   /etc/systemd/system(只读)—— unit 对比的基准
set -uo pipefail

REPO="${REPO_DIR:-/repo}"
PRIVATE="${PRIVATE_DIR:-/private}"
SUITE="${SUITE_DIR:-/data}"
which="${1:-all}"

if [ ! -f "$REPO/scripts/check-privacy.mjs" ]; then
    echo "[失败] 在 $REPO 找不到 scripts-hub 的内容 —— 检查 compose 里 /repo 的挂载" >&2
    exit 2
fi

failed=0
ok() { printf '  [通过] %s\n' "$1"; }
bad() { printf '  [失败] %s\n' "$1"; failed=1; }
head_() { printf '\n== %s ==\n' "$1"; }

run_drift() {
    head_ "企业微信发送实现一致性(check-wecom-drift)"
    if out=$(node "$REPO/scripts/check-wecom-drift.mjs" 2>&1); then
        echo "$out" | sed 's/^/  /'
        ok "三份实现的核心块一致"
    else
        echo "$out" | sed 's/^/  /'
        bad "三份实现已漂移(容器里的代码是从本机搬的,最容易在这里不一致)"
    fi
}

run_privacy() {
    head_ "脱敏体检(check-privacy)"
    export SENSITIVE_PATTERNS_FILE="${SENSITIVE_PATTERNS_FILE:-$PRIVATE/sensitive-patterns.txt}"
    [ -f "$SENSITIVE_PATTERNS_FILE" ] || echo "  [提示] 没有 $SENSITIVE_PATTERNS_FILE,只跑通用规则"
    if out=$(cd "$REPO" && node "$REPO/scripts/check-privacy.mjs" 2>&1); then
        echo "$out" | sed 's/^/  /'
        ok "没有命中敏感规则"
    else
        echo "$out" | sed 's/^/  /'
        bad "命中敏感内容(见上面的文件与规则)"
    fi
}

run_units() {
    head_ "systemd unit 漂移对比(apply-schedule --emit=systemd)"
    local dest=/tmp/units
    rm -rf "$dest"; mkdir -p "$dest"
    if ! node "$REPO/scripts/apply-schedule.mjs" --emit=systemd --dest="$dest" >/tmp/emit.log 2>&1; then
        sed 's/^/  /' /tmp/emit.log
        bad "生成 unit 失败"
        return
    fi
    # 生成物落在 <dest>/systemd/ 下(见 apply-schedule.mjs 的 --help)。
    # 比两件事:
    #   1) 仓库里的权威 unit(scripts/linux/systemd/)对比 /etc/systemd/system/ 里现装的 —— 这才是真漂移
    #   2) 仓库权威 unit 与 config/schedule.json 渲染出来的 —— 保证"约定"与"权威实现"没分叉
    for f in automation-suite.timer automation-suite.service; do
        authority="$REPO/scripts/linux/systemd/$f"
        generated="$dest/systemd/$f"
        installed="/etc/systemd/system/$f"

        if [ ! -f "$authority" ]; then
            bad "仓库里没有权威 unit:scripts/linux/systemd/$f"
            continue
        fi
        if [ ! -f "$installed" ]; then
            bad "$installed 不存在(还没安装?见 scripts/linux/README.md 第 5 步)"
        elif diff -q "$authority" "$installed" >/dev/null; then
            ok "$f:已安装的与仓库权威一致"
        else
            bad "$f:已安装的与仓库权威不一致(重装:sudo cp 仓库里的 scripts/linux/systemd/$f /etc/systemd/system/ 后 daemon-reload)"
            diff -u "$authority" "$installed" | sed 's/^/    /' | head -20
        fi

        # 只比功能性行:注释、Description、Documentation 是文档,不是行为 ——
        # 权威版手写了更具体的描述与文档链接,渲染器给的是通用文案,两者本就不该相等。
        if [ -f "$generated" ]; then
            strip() { grep -vE '^#|^Description=|^Documentation=' "$1"; }
            if ! diff -q <(strip "$authority") <(strip "$generated") >/dev/null; then
                bad "$f:仓库权威与 config/schedule.json 渲染出来的**行为**不一致(约定与实现分叉)"
                diff -u <(strip "$authority") <(strip "$generated") | sed 's/^/    /' | head -12
            else
                ok "$f:仓库权威与 config/schedule.json 渲染出来的行为一致"
            fi
        fi
    done
}

run_backup() {
    head_ "备份盘点(backup --dry-run)"
    local cfg="$REPO/config/backup.server.json"
    [ -f "$cfg" ] || { bad "找不到 $cfg"; return; }
    if out=$(node "$REPO/scripts/backup.mjs" --config="$cfg" --dry-run 2>&1); then
        echo "$out" | sed 's/^/  /'
        ok "盘点完成(没有推任何东西;真要推得先配 restic 仓库与密码)"
    else
        echo "$out" | sed 's/^/  /'
        bad "盘点失败"
    fi
}

case "$which" in
    all)     run_drift; run_privacy; run_units; run_backup ;;
    drift)   run_drift ;;
    privacy) run_privacy ;;
    units)   run_units ;;
    backup)  run_backup ;;
    *)       echo "用法:suite-check [all|drift|privacy|units|backup]" >&2; exit 2 ;;
esac

echo
if [ "$failed" -eq 0 ]; then
    echo "结论:全部通过"
else
    echo "结论:有失败项(见上面的 [失败] 行)"
fi
exit "$failed"
