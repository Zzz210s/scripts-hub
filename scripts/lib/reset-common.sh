# shellcheck shell=bash
#
# reset-common:wizard-public-reset 的目标、机器私有路径与敏感模式配置,以及 wsh_* 输出辅助。
# 由 wizard-public-reset.sh source(在 wizard-common.sh 之后),不要单独执行。
# 机器相关路径不写死:默认读 ~/.config/automation-suite/local-paths.env,环境变量优先。
#
# shellcheck disable=SC2034  # 这些全局量供 source 本文件的向导与 reset-*.sh 读取

# ── 目标与本地路径(默认读机器私有文件,环境变量优先) ──────────────────
LOCAL_PATHS_FILE="${AUTOMATION_LOCAL_PATHS:-$HOME/.config/automation-suite/local-paths.env}"
# shellcheck source=/dev/null
[[ -f "$LOCAL_PATHS_FILE" ]] && . "$LOCAL_PATHS_FILE"

OWNER="${OWNER:-Zzz210s}"
OLD_SLUG="$OWNER/home-automation-configs"   # 待删除的旧名仓库
NEW_SLUG="$OWNER/scripts-hub"               # 重建后的新名仓库
WEREAD_DIR="${WEREAD_SIGNIN_DIR:-$HOME/weread-signin}"
HAC_DIR="${HOME_AUTOMATION_CONFIGS_DIR:-$HOME/home-automation-configs}"  # 本地目录名不改
# 备份镜像:新名优先(scripts-hub),旧名兼容(home-automation-configs)。
HAC_BACKUP_GLOB="${HAC_BACKUP_GLOB:-$HOME/scripts-hub-backup-*.git}"
HAC_BACKUP_OLD_GLOB="${HAC_BACKUP_OLD_GLOB:-$HOME/home-automation-configs-backup-*.git}"
HAC_BACKUP_GLOBS=("$HAC_BACKUP_GLOB" "$HAC_BACKUP_OLD_GLOB")
KEY_FILE="${WEREAD_API_KEY_FILE:-$WEREAD_DIR/secrets/weread-api-key.txt}"
SHA_DIR="${TMPDIR:-/tmp}/public-reset-old-shas"
SHA_FILE="$SHA_DIR/home-automation-configs.txt"          # 删除前记下的旧 SHA
TOPIC_FILE="$SHA_DIR/home-automation-configs-topics.txt" # 删除前抄下的旧 topics

# 本向导不写 .env:把库的 ENV_FILE 指到临时文件,免得误读工作目录里已有的 .env。
ENV_FILE="${TMPDIR:-/tmp}/wizard-public-reset.env"

# 新名仓库的一句英文简介:三个自动化程序的脚本、配置与文档汇总。
HAC_DESC="Runner scripts, configuration, and documentation for three Windows automation programs: Microsoft Rewards, WeRead check-in, and Zhihuishu course playback."
# topics 优先从旧仓库现读(改名后原样沿用);读不到时退回这份 2026-10-04 的清单。
# GitHub 不接受点号:topic 只能是小写字母数字与连字符。
HAC_TOPICS=(automation configuration docs microsoft-rewards operations playwright self-hosted wecom windows-task-scheduler weread windows zzz-automation autovisor backup-restore oracle-cloud systemd gplv3)

# 个人标识黑名单:默认只查通用 Key 形状;本机私有文件里一行一个额外模式,
# 真实姓名/邮箱/旧 handle 这些**绝不写进仓库**(文件默认在 ~/.config/automation-suite/ 下)。
SENSITIVE_PATTERN='wrk-[A-Za-z0-9_-]{12}'
SENSITIVE_FILE="${SENSITIVE_PATTERNS_FILE:-$HOME/.config/automation-suite/sensitive-patterns.txt}"
if [[ -f "$SENSITIVE_FILE" ]]; then
  while IFS= read -r _p; do
    [[ -n "$_p" ]] && SENSITIVE_PATTERN="$SENSITIVE_PATTERN|$_p"
  done < "$SENSITIVE_FILE"
fi

wsh_ok()   { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$1"; }
wsh_bad()  { printf '  %s✗%s %s\n' "$RED" "$RESET" "$1"; }
wsh_die()  { printf '\n%s[停止]%s %s\n' "$RED" "$RESET" "$1" >&2; shift || true
             for l in "$@"; do printf '       %s\n' "$l" >&2; done; exit 1; }

