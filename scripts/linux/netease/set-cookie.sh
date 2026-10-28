#!/usr/bin/env bash
# 换网易云音乐的 MUSIC_U:写进 .env、清掉当天的熔断标记,再用只读接口自证。
#
# 用法(在服务器上):
#   scripts/linux/netease/set-cookie.sh                 # 从 stdin 读:整条 cURL 或 MUSIC_U=... 都行
#   scripts/linux/netease/set-cookie.sh "<cookie 内容>"  # 直接给内容
#   scripts/linux/netease/set-cookie.sh -f /path/curl.txt
#
# 写 .env 这一步**在宿主上做**,不在容器里:compose 有意把 .env 挂成只读
# (`./netease/.env:/opt/netease/.env:ro`),容器写不了;自证才进容器跑 check。
set -uo pipefail

SUITE_DIR="${SUITE_DIR:-/srv/apps/automation}"
ROOT="$SUITE_DIR/netease"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

case "${1:-}" in
    -f|--file)
        [ -n "${2:-}" ] && [ -f "$2" ] || { echo "找不到文件:${2:-}" >&2; exit 2; }
        cp "$2" "$TMP"
        ;;
    "")
        [ -t 0 ] && echo "从 stdin 读 cookie 或整条 cURL,粘贴后按 Ctrl-D:" >&2
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

cd "$ROOT" || exit 1
echo "== 写入 .env 并清掉当天的熔断标记"
# 用宿主上的 node 跑项目自己的 login 实现(与容器里同一份源码),避免两套解析逻辑。
node src/login.js --file "$TMP" --account 1
if [ $? -ne 0 ]; then
    echo "写入失败 —— 上面的原因就是原因,不要继续" >&2
    exit 1
fi

echo
echo "== 只读自证(容器内 check,不会调签到接口)"
docker compose -f "$SUITE_DIR/compose.yaml" run --rm -T netease-run check </dev/null
CODE=$?
if [ "$CODE" -ne 0 ]; then
    echo "自证没过(退出码 $CODE)—— 凭据可能还是旧的,或者这个账号需要重新登录" >&2
    exit "$CODE"
fi
echo
echo "完成。下次触发(08:00 / 12:00)会自动用新凭据;想立刻跑一次:"
echo "  SUITE_SCHEDULE=\$SUITE_DIR/schedule.json $SUITE_DIR/run-all.sh"
