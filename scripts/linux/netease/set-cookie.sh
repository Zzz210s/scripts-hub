#!/usr/bin/env bash
# 换网易云音乐的 MUSIC_U:把新的 cookie 写进 .env、清掉当天的熔断标记,再用只读接口自证。
#
# 用法(在服务器上):
#   scripts/linux/netease/set-cookie.sh                 # 从 stdin 读:整条 cURL 或 MUSIC_U=... 都行
#   scripts/linux/netease/set-cookie.sh "<cookie 内容>"  # 直接给内容
#   scripts/linux/netease/set-cookie.sh -f /path/curl.txt
#
# 为什么不直接把 stdin 灌进容器:`docker compose run` 会吞掉 stdin(踩过),所以先把内容落到
# 宿主临时文件(600),再只读挂进容器交给 `login --file`。
set -uo pipefail

SUITE_DIR="${SUITE_DIR:-/srv/apps/automation}"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

case "${1:-}" in
    -f|--file)
        [ -n "${2:-}" ] && [ -f "$2" ] || { echo "找不到文件:${2:-}" >&2; exit 2; }
        cp "$2" "$TMP"
        ;;
    "")
        if [ -t 0 ]; then
            echo "从 stdin 读 cookie 或整条 cURL,粘贴后按 Ctrl-D:" >&2
        fi
        cat > "$TMP"
        ;;
    *)
        printf '%s\n' "$1" > "$TMP"
        ;;
esac

chmod 600 "$TMP"
if [ ! -s "$TMP" ]; then
    echo "没有内容可写 —— 整条 cURL 或 MUSIC_U=... 都行" >&2
    exit 2
fi

echo "== 写入并自证(容器内只读挂载临时文件)"
docker compose -f "$SUITE_DIR/compose.yaml" run --rm -T \
    -v "$TMP:/tmp/cookie.txt:ro" \
    netease-run login --file /tmp/cookie.txt
CODE=$?

if [ "$CODE" -ne 0 ]; then
    echo "换凭据失败(退出码 $CODE)—— .env 可能已更新,但自证没过;把上面的原因发出来" >&2
    exit "$CODE"
fi

echo
echo "== 顺带跑一次只读体检,确认凭据与今日状态"
docker compose -f "$SUITE_DIR/compose.yaml" run --rm -T netease-run check
exit 0
