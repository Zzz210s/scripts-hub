# shellcheck shell=bash
#
# deploy-common:deploy-*.sh 共用的输出、参数解析、同源检测与授权闸门。
# 由 deploy 脚本 source,不要单独执行;文件计划的构建/落盘见同目录 deploy-plan.sh。
#
# 调用方必须先定义:REPO_DIR SNAP SNAP_REL TARGET,以及 usage()
# 脚本行为:「快照是脱敏发布件,不能回灌权威工作区」——同源时默认拒绝,--allow-authoritative
# 才放行,且必须走「预览 -> 警告 -> 二次确认 -> 自动备份」。

# shellcheck disable=SC2034  # 这些全局量由 source 本文件的 deploy-*.sh 读取
BLOCK=0
SAME_SOURCE=0
APPLY=0
ALLOW_AUTH=0
ASSUME_YES=0
FORCE=0
DEST=""

ok() { printf '[通过] %s\n' "$*"; }
info() { printf '[提示] %s\n' "$*"; }
warn() { printf '[警告] %s\n' "$*"; }
miss() { printf '[缺]   %s\n' "$*"; }
bad() {
  printf '[阻塞] %s\n' "$*"
  BLOCK=1
}
step() { printf '\n== %s ==\n' "$*"; }

in_list() {
  local needle="$1" item
  shift
  for item in "$@"; do [[ "$item" == "$needle" ]] && return 0; done
  return 1
}

deploy_parse_args() {
  for arg in "$@"; do
    case "$arg" in
      --dry-run) APPLY=0 ;;
      --apply) APPLY=1 ;;
      --allow-authoritative) ALLOW_AUTH=1 ;;
      --force)
        FORCE=1
        ALLOW_AUTH=1
        ;;
      --yes | -y) ASSUME_YES=1 ;;
      --dest=*) DEST="${arg#*=}" ;;
      -h | --help)
        usage
        exit 0
        ;;
      *)
        printf '未知参数:%s\n' "$arg" >&2
        exit 2
        ;;
    esac
  done
  if ((FORCE)); then info '--force 现在等同 --allow-authoritative(会先预览差异、再二次确认并自动备份)'; fi
}

# "Ready MSFT_TaskLogonTrigger,MSFT_TaskDailyTrigger" 或空(不存在/不可查)
task_line() {
  command -v powershell.exe >/dev/null 2>&1 || return 1
  powershell.exe -NoProfile -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; \$t=Get-ScheduledTask -TaskName '$1' -ErrorAction SilentlyContinue; if(-not \$t){exit 3}; \$tr=(\$t.Triggers|ForEach-Object{\$_.CimClass.CimClassName}) -join ','; Write-Output (\$t.State.ToString()+' '+\$tr)" 2>/dev/null
}

# 判定 TARGET 是否与快照同源(HEAD == SNAPSHOT.txt 的 source commit);设置 SAME_SOURCE
deploy_same_source() {
  SAME_SOURCE=0
  if [[ ! -d "$TARGET/.git" ]]; then
    info '目标不是 git 仓库(工作区可以是普通目录;从上游装的本体通常带 .git)'
    return 0
  fi
  ok '目标是一个 git 仓库'
  local snap_commit have_commit sync_name
  sync_name="sync-${SNAP_REL#proj-}.sh"
  snap_commit=$(sed -n 's/^source commit: //p' "$SNAP/SNAPSHOT.txt" 2>/dev/null | head -1)
  have_commit=$(git -C "$TARGET" rev-parse HEAD 2>/dev/null || echo '')
  if [[ -n "$snap_commit" && -n "$have_commit" && "$snap_commit" == "$have_commit" ]]; then
    SAME_SOURCE=1
    info "工作区与快照同源($have_commit)—— 它是权威工作区,快照里的占位符不应写回去"
    info "要更新仓库请用 scripts/$sync_name;确要用快照覆盖加 --allow-authoritative"
    return 0
  fi
  if [[ -n "$snap_commit" && -n "$have_commit" ]]; then
    info "工作区在 $have_commit,快照源提交 $snap_commit —— 按恢复流程刷新"
  fi
}

# 同源工作区的放行闸门:默认拒绝,只有 --allow-authoritative 才放行
deploy_authoritative_gate() {
  ((SAME_SOURCE)) || return 0
  if ((APPLY)) && ((!ALLOW_AUTH)); then
    bad '拒绝覆盖与快照同源的工作区(要覆盖加 --allow-authoritative:先预览差异、再输入 yes 确认、自动备份)'
  fi
}

deploy_authoritative_warn() {
  ((SAME_SOURCE && ALLOW_AUTH)) || return 0
  warn '快照是脱敏发布件:覆盖会把真实账号名/邮箱替换成 sample、把本机绝对路径替换成占位符'
  warn '这是一次有损覆盖;执行前会自动备份被覆盖的文件,结束时会给出恢复命令'
}
