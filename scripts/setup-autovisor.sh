#!/usr/bin/env bash
#
# setup-autovisor:自检 autovisor 配置并打印「程序本体怎么来」的步骤。
# 本目录只有配置(configs.ini),没有自研代码 —— 所以这里没有构建、没有测试,只有检查与指引。
#
# 用法:bash scripts/setup-autovisor.sh
# 退出码:0 配置可用;1 配置缺必需项(看末尾结论)。
set -euo pipefail

REPO_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PROJ="$REPO_DIR/autovisor"
CONFIG="$PROJ/configs.ini"

FAILED=0
ok() { printf '[通过] %s\n' "$*"; }
info() { printf '[提示] %s\n' "$*"; }
bad() {
  printf '[阻塞] %s\n' "$*"
  FAILED=1
}

printf '== autovisor 自检(%s)==\n' "$PROJ"

# 1. 配置文件在不在
if [[ -f "$CONFIG" ]]; then
  ok 'configs.ini 已就位'
else
  bad '缺 configs.ini;从本仓库 autovisor/configs.ini 恢复'
  exit 1
fi

# 2. 课程链接:至少一条非注释 URL,且是受支持的共享课播放页
urls=$(grep -E '^[[:space:]]*URL[0-9]+[[:space:]]*=' "$CONFIG" | sed -E 's/^[^=]*=[[:space:]]*//' | grep -v '^[[:space:]]*$' || true)
count=$(printf '%s\n' "$urls" | grep -c . || true)
if ((count > 0)); then
  ok "已配置 $count 条课程链接"
  while IFS= read -r u; do
    [[ -z "$u" ]] && continue
    case "$u" in
      *studyvideoh5.zhihuishu.com/stuStudy*) info "受支持的共享课播放页:$u" ;;
      *studywisdomh5.zhihuishu.com*) bad "不支持的新版课程页(会永久卡在加载):$u" ;;
      *) info "非共享课播放页,请确认:$u" ;;
    esac
  done <<<"$urls"
else
  bad '没有有效课程链接 —— 启动即报「未检测到有效网址」并退出;在 [course-url] 下补 URL1'
fi

# 3. 账号密码应留空(留空则手动登录一次,登录态落 data/cookies.json)
if grep -E '^[[:space:]]*(username|password)[[:space:]]*=' "$CONFIG" | grep -qE '=[[:space:]]*[^[:space:]]'; then
  bad 'configs.ini 里写了 username/password —— 本仓库约定凭据不落盘,请清空后手动登录一次'
else
  ok 'username/password 已留空(符合「凭据不入库」约定)'
fi

# 4. 程序本体是否已解压到本机(%AUTOVISOR_DIR%)
if [[ -n "${AUTOVISOR_DIR:-}" && -f "$AUTOVISOR_DIR/app/Autovisor.exe" ]]; then
  ok "程序本体已就位:$AUTOVISOR_DIR/app/Autovisor.exe"
else
  info '程序本体(Autovisor.exe)不在版本控制里,需要手动装:'
  cat <<'EOF'
       1. 从上游 release 下载 v3.17.3 的 Windows zip:
          https://github.com/CXRunfree/Autovisor/releases
       2. 解压到 %AUTOVISOR_DIR%\app(原始 zip 备份留在 %AUTOVISOR_DIR%)
       3. 把本目录的 configs.ini 复制进 app\,覆盖同名文件
       4. 运行 app\Autovisor.exe,打开浏览器后手动登录一次
EOF
fi

printf '\n结论:'
if ((FAILED)); then
  printf '配置有阻塞项,先按上面的 [阻塞] 处理。\n'
  exit 1
fi
printf '配置可用。装好程序本体并复制 configs.ini 后即可手动运行(无计划任务)。\n'
