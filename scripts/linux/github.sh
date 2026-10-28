#!/usr/bin/env bash
# 无代理环境里跟 GitHub 打交道的四条通路,外加一条自检。
#
# 为什么需要它:2026-10-29 本机 sing-box 的上游中转失联(45.43.58.176:37777 超时),
# 而 `github.com:443` 直连本身也不通(实测 TLS 被中断 / 连接超时)。但三条边路是通的:
#
#   api.github.com        443  通   → gh api(已认证)读文件、issue、PR、CI
#   codeload.github.com   443  通   → 取整仓 tar.gz(构建期取源码就用这条)
#   github.com            22   通   → SSH 走 git(需要账号级 SSH key 才能通用)
#   raw.githubusercontent 443  不通 → 用 gh api 或镜像替代
#
# 用法(在服务器上):
#   scripts/linux/github.sh status                          # 四条通路逐条探测
#   scripts/linux/github.sh file <owner/repo> <path> [ref]   # 读一个文件(gh api)
#   scripts/linux/github.sh tarball <owner/repo> [ref] [dir] # 取整仓源码(codeload,构建用)
#   scripts/linux/github.sh clone <owner/repo> [dir]         # 克隆(镜像,读操作)
#   scripts/linux/github.sh pull <仓库目录>                  # 用 mirror remote 快进
#   scripts/linux/github.sh raw <owner/repo> <path> [ref]    # raw 内容(镜像转发)
#
# 约定:镜像(ghfast.top)只用于**读**;推送仍走 https 的 origin 或 SSH,不在本脚本里。
set -uo pipefail

MIRROR_PREFIX="${GITHUB_MIRROR:-https://ghfast.top}"

ok()   { printf '  OK    %s\n' "$*"; }
bad()  { printf '  FAIL  %s\n' "$*"; }

need() {
    command -v "$1" >/dev/null 2>&1 || { echo "缺命令:$1" >&2; exit 2; }
}

cmd_status() {
    echo "== GitHub 通路探测(无代理)"
    need curl
    probe() {  # host port 说明
        if timeout 8 bash -c "exec 3<>/dev/tcp/$1/$2" 2>/dev/null; then ok "$1:$2 可连 · $3"; else bad "$1:$2 不通 · $3"; fi
    }
    probe api.github.com 443 "gh api 读接口"
    probe codeload.github.com 443 "取源码 tar.gz"
    probe github.com 22 "git over SSH"
    # TCP 能连不等于能用:github.com:443 的 TLS 握手会被打断(实测 2026-10-29),所以查完整握手
    if curl -sS -m 10 -o /dev/null "https://github.com/" 2>/dev/null; then
        ok "github.com:443 TLS 正常 · git over HTTPS 可用"
    else
        bad "github.com:443 TLS 握手失败 · 别用 https clone/pull,用 clone/pull 子命令走镜像"
    fi
    printf '  --    raw.githubusercontent.com:443 通常不通,用 file/raw 子命令替代\n'
    echo "== 认证"
    if command -v gh >/dev/null 2>&1; then
        if gh auth status >/dev/null 2>&1; then ok "gh 已登录"; else bad "gh 未登录(gh auth login)"; fi
    else bad "没装 gh CLI"; fi
}

cmd_file() {
    need gh
    local repo="${1:?用法: file <owner/repo> <path> [ref]}"
    local path="${2:?缺 path}" ref="${3:-}"
    local args=(api "repos/$repo/contents/$path" -H "Accept: application/vnd.github.raw")
    [ -n "$ref" ] && args+=(-f "ref=$ref")
    gh "${args[@]}"
}

cmd_raw() {
    need curl
    local repo="${1:?用法: raw <owner/repo> <path> [ref]}"
    local path="${2:?缺 path}" ref="${3:-main}"
    curl -fsSL "$MIRROR_PREFIX/https://raw.githubusercontent.com/$repo/$ref/$path"
}

cmd_tarball() {
    need curl; need tar
    local repo="${1:?用法: tarball <owner/repo> [ref] [dest]}"
    local ref="${2:-HEAD}"
    local dest="${3:-${repo##*/}-${ref}}"
    mkdir -p "$dest"
    echo "取 $repo@$ref -> $dest(codeload 直连)"
    curl -fsSL "https://codeload.github.com/$repo/tar.gz/$ref" | tar xz --strip-components=1 -C "$dest"
    echo "完成:$dest"
}

cmd_clone() {
    need git
    local repo="${1:?用法: clone <owner/repo> [dir]}"
    local dir="${2:-${repo##*/}}"
    echo "经镜像克隆 $repo -> $dir(只读用途;要推送请用 SSH 或 https origin)"
    git clone --depth 1 "$MIRROR_PREFIX/https://github.com/$repo.git" "$dir"
}

# 拉取:公开仓走镜像(快且无需认证);私有仓镜像拿不到(会要用户名),只能走 SSH。
# SSH 需要把 ~/.ssh/id_ed25519_gh.pub 加到 GitHub 账号(2026-10-29 生成的)。
cmd_pull() {
    need git
    local dir="${1:?用法: pull <仓库目录>}"
    [ -d "$dir/.git" ] || { echo "不是 git 仓库:$dir" >&2; exit 2; }
    local branch
    branch="$(git -C "$dir" rev-parse --abbrev-ref HEAD)"

    # 1) 公开仓:mirror remote
    if ! git -C "$dir" remote get-url mirror >/dev/null 2>&1; then
        local url mirror
        url="$(git -C "$dir" remote get-url origin)"
        mirror="$MIRROR_PREFIX/$url"
        git -C "$dir" remote add mirror "$mirror" >/dev/null 2>&1
    fi
    if git -C "$dir" fetch --quiet mirror "$branch" 2>/dev/null; then
        git -C "$dir" merge --ff-only FETCH_HEAD || { echo "不能快进,先自己看 diff" >&2; exit 1; }
        git -C "$dir" log --oneline -1
        return 0
    fi
    echo "镜像取不到(多半是私有仓),改用 SSH"

    # 2) 私有仓:SSH(origin 是 https 就先临时用 SSH 地址拉)
    local url ssh
    url="$(git -C "$dir" remote get-url origin)"
    ssh="$(printf '%s' "$url" | sed -E 's#https://github.com/#git@github.com:#')"
    if git -C "$dir" fetch --quiet "$ssh" "$branch" 2>/dev/null; then
        git -C "$dir" merge --ff-only FETCH_HEAD || { echo "不能快进,先自己看 diff" >&2; exit 1; }
        git -C "$dir" log --oneline -1
        return 0
    fi
    echo "SSH 也失败 —— 八成是公钥还没加到 GitHub:" >&2
    echo "  把 ~/.ssh/id_ed25519_gh.pub 的内容加到 https://github.com/settings/keys" >&2
    exit 1
}

case "${1:-}" in
    status)  cmd_status ;;
    file)    shift; cmd_file "$@" ;;
    raw)     shift; cmd_raw "$@" ;;
    tarball) shift; cmd_tarball "$@" ;;
    clone)   shift; cmd_clone "$@" ;;
    pull)    shift; cmd_pull "$@" ;;
    *) echo "用法: $(basename "$0") status|file|raw|tarball|clone|pull ..." >&2; exit 2 ;;
esac
