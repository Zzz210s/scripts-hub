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
