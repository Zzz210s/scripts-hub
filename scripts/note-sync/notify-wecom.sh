#!/usr/bin/env bash
# 发送一条企业微信文本通知(本机侧统一从这里走)。
#
# 用法: WECOM_WEBHOOK_FILE=/path/wecom-server.txt bash notify-wecom.sh "正文"
# 退出码: 0 = 已送达(errcode=0);1 = 没送到,原因在 stdout(调用方写进自己的日志)。
#
# 为什么单独一个文件: note-sync.sh 已到 200 行上限,把通知这块抽出来既守住行数,
# 也让 Windows 侧的转发逻辑只有一份(与两个 Linux 侧实现共用同一段 python,见下)。
set -uo pipefail

FILE="${WECOM_WEBHOOK_FILE:-}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
    echo "未配置 webhook 文件(WECOM_WEBHOOK_FILE=${FILE:-<空>})"
    exit 1
fi

PY="$(command -v python3 || command -v python || true)"
if [ -z "$PY" ]; then
    echo "找不到 python,无法转义 JSON"
    exit 1
fi

# 与 scripts/linux/note-sync/note-sync.sh、scripts/linux/mem-guard/mem-guard.sh 内同一段逐字节一致,
# 由 scripts/check-wecom-drift.mjs 校验。正文走 argv:python 的 stdin 被 heredoc 占用(拿不到正文),
# 而 Windows 上 stdin 默认还是 cp936 —— 两个坑一起踩,所以一律不用 stdin。
"$PY" - "$FILE" "${1:-}" <<'PY'
# >>> wecom-notify begin
import json, sys, urllib.request

url = open(sys.argv[1], encoding="utf-8").read().strip()
text = sys.argv[2]
raw = text.encode("utf-8")
if len(raw) > 2000:                     # 企业微信 text 上限 2048 字节,留一点余量
    text = raw[:2000].decode("utf-8", "ignore") + "...(已截断)"
body = json.dumps({"msgtype": "text", "text": {"content": text}}).encode("utf-8")
req = urllib.request.Request(url, body, {"content-type": "application/json; charset=utf-8"})
try:
    resp = json.loads(urllib.request.urlopen(req, timeout=15).read().decode("utf-8", "replace"))
except Exception as exc:
    print("发送失败: %s" % exc)
    sys.exit(1)
if resp.get("errcode", 1) != 0:
    print("发送被拒 errcode=%s errmsg=%s" % (resp.get("errcode"), resp.get("errmsg")))
    sys.exit(1)
# <<< wecom-notify end
PY
