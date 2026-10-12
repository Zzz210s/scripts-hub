#!/usr/bin/env bash
# 轮换 note-app 的 GitHub 写入令牌 —— 让应用不再依赖服务器上的 gh 会话。
#
# 背景:2026-10-12 发现 note-app/.env 的 GITHUB_TOKEN 与服务器 gh 的 OAuth 令牌是同一把,
# 而且那把令牌还被明文嵌在几个 git remote URL 里(已清理)。解耦后:应用用一把**只对
# Zzz210s/note 有 Contents 写权限**的 fine-grained PAT,gh 的令牌可以单独轮换而不影响发布。
#
# 用法(在你自己的终端里跑,令牌用隐藏输入,不进聊天记录也不落盘):
#   bash ~/home-automation-configs/scripts/set-note-app-token.sh
#
# 干的事:
#   1. 本机校验新令牌:仓库可达 + permissions.push + 读 ref + 写一个 blob 探针(悬空对象,无副作用)
#   2. 校验通过才送上服务器,替换 .env 里 GITHUB_TOKEN 那一行(先备份 600)
#   3. 顺手清掉内容仓 .git/config 里嵌的旧凭据(应用走 GitHub API 推送,不需要它)
#   4. 重启 note-app 等它健康,并复核启动行 push=github
#
# 全程只打印 sha256 前 12 位指纹,不打印令牌本身。
set -uo pipefail

# Windows 上 python 默认按 cp936 输出,管道回来就是乱码 —— 统一钉成 UTF-8。
export PYTHONIOENCODING=utf-8
export PYTHONUTF8=1

HOST="${NOTE_HOST:-62.234.211.51}"
SLUG="${NOTE_SLUG:-Zzz210s/note}"
BRANCH="${NOTE_BRANCH:-master}"
APP_DIR=/srv/apps/note-app
ENV_FILE="$APP_DIR/.env"
VOLUME=note-repo

fp() { printf '%s' "$1" | sha256sum | cut -c1-12; }

die() { printf '错误: %s\n' "$1" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "本机缺少 $1"; }
need sha256sum
need ssh
need curl

if [ -n "${NOTE_TOKEN_FILE:-}" ]; then
    TOKEN="$(tr -d ' \t\r\n' < "$NOTE_TOKEN_FILE")"
else
    printf '粘贴新的 fine-grained PAT(只授 %s 的 Contents: Read and write;输入不回显): ' "$SLUG"
    read -r -s TOKEN
    printf '\n'
fi
[ -n "${TOKEN:-}" ] || die "没有拿到令牌"
printf '新令牌指纹: %s(长度 %d)\n' "$(fp "$TOKEN")" "${#TOKEN}"

api() {
    curl -sS -m 20 -H "Authorization: Bearer $TOKEN" \
        -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' "$@"
}

echo "1/4 校验令牌 …"
info="$(api "https://api.github.com/repos/$SLUG")"
printf '%s' "$info" | python3 -c '
import json, sys
d = json.load(sys.stdin)
if d.get("message"):
    print("   仓库读失败:", d["message"]); sys.exit(1)
push = (d.get("permissions") or {}).get("push")
print("   仓库:", d.get("full_name"), "| push 权限:", push, "| 默认分支:", d.get("default_branch"))
sys.exit(0 if push else 1)
' || die "这把令牌对 $SLUG 没有写权限(需要 Contents: Read and write)"
ref="$(api "https://api.github.com/repos/$SLUG/git/ref/heads/$BRANCH")"
printf '%s' "$ref" | python3 -c '
import json, sys
d = json.load(sys.stdin)
if d.get("message") or not d.get("object", {}).get("sha"):
    print("   读分支失败:", d.get("message")); sys.exit(1)
print("   分支", d.get("ref"), "->", d["object"]["sha"][:12])
' || die "读不到分支 $BRANCH(令牌少了 Contents 读权限?)"
blob="$(api -X POST -d '{"content":"token-probe","encoding":"utf-8"}' \
    "https://api.github.com/repos/$SLUG/git/blobs")"
printf '%s' "$blob" | python3 -c '
import json, sys
d = json.load(sys.stdin)
if not d.get("sha"):
    print("   写探针失败:", d.get("message")); sys.exit(1)
print("   写探针 OK(悬空 blob", d["sha"][:12], ",不会被任何提交引用)")
' || die "写不进去(令牌缺 Contents 写权限?)"

echo "2/4 送上服务器并替换 .env …"
printf '%s' "$TOKEN" | ssh "$HOST" "python3 - '$ENV_FILE' <<'PY'
import hashlib, os, shutil, sys, datetime

path = sys.argv[1]
token = sys.stdin.read().strip()
if not token:
    print('   服务器侧没收到令牌'); sys.exit(2)
lines = open(path, encoding='utf-8').read().split(chr(10))
out, replaced = [], False
for line in lines:
    if line.startswith('GITHUB_TOKEN='):
        out.append('GITHUB_TOKEN=' + token)
        replaced = True
    else:
        out.append(line)
if not replaced:
    print('   .env 里没有 GITHUB_TOKEN 这一行'); sys.exit(3)
bak = path + '.bak-' + datetime.date.today().strftime('%Y%m%d')
if not os.path.exists(bak):
    shutil.copy2(path, bak)
    os.chmod(bak, 0o600)
tmp = path + '.tmp-write'
open(tmp, 'w', encoding='utf-8').write(chr(10).join(out))
os.chmod(tmp, 0o600)
os.replace(tmp, path)
fp = hashlib.sha256(open(path, encoding='utf-8').read().split('GITHUB_TOKEN=')[1].split(chr(10))[0].encode()).hexdigest()[:12]
print('   .env 已更新,写入后指纹:', fp, '| 备份:', os.path.basename(bak))
PY" || die "服务器侧替换失败"

echo "3/4 清掉内容仓 .git/config 里嵌的旧凭据 …"
ssh "$HOST" "sudo python3 - <<'PY'
import os, re, shutil, subprocess
data = subprocess.run(['docker', 'volume', 'inspect', '-f', '{{.Mountpoint}}', '$VOLUME'],
                      capture_output=True, text=True, check=True).stdout.strip()
cfg = os.path.join(data, '.git', 'config')
text = open(cfg, encoding='utf-8', errors='replace').read()
new = re.sub(r'https://[^/@\\s]+@', 'https://', text)
if new != text:
    bak = cfg + '.bak-credstrip'
    if not os.path.exists(bak):
        shutil.copy2(cfg, bak)
    open(cfg, 'w', encoding='utf-8').write(new)
    print('   已移除内嵌凭据;remote =', [l.strip() for l in new.split(chr(10)) if 'url =' in l][0])
else:
    print('   没有内嵌凭据,跳过')
PY" || die "清理 content 仓 .git/config 失败"

echo "4/4 重启 note-app 并复核 …"
ssh "$HOST" "sudo docker restart note-app >/dev/null; sleep 12; docker ps --format '{{.Names}} | {{.Status}}' | grep note-app; docker logs --tail 200 note-app 2>&1 | grep -m1 'note_repo=' | cut -c1-140" \
    || die "重启或复核失败"

echo "完成。旧令牌现在只剩在服务器 gh 的 hosts.yml 里,可以在 GitHub 上吊销它,然后跑 gh auth refresh 轮换 gh。"
