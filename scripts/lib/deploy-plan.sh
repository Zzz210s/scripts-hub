# shellcheck shell=bash
#
# deploy-plan:deploy-*.sh 的文件计划 —— 计算每个快照文件的目标状态、预览、备份、落盘。
# 由 deploy 脚本 source(在 deploy-common.sh 之后),不要单独执行。
#
# 调用方必须先定义:
#   REPO_DIR SNAP SNAP_REL TARGET
#   KEEP[]       —— 合集层维护、不部署的文件名(相对快照根)
#   PROTECT[]    —— 存在即保留、缺失才生成的目标名(可空)
#   GEN_FROM{}   —— PROTECT 中缺失时的生成源(快照内路径,可空)
#   RENAME_MAP{} —— 快照名 -> 目标名的改名(可空)
# 并 source deploy-common.sh(用到 in_list / info / ok / bad 与 APPLY 等变量)。

BACKUP_DIR=""
PLAN_NEW=0
PLAN_UPD=0
PLAN_REL=()
PLAN_SRC=()
PLAN_DST=()
PLAN_DSTREL=()
PLAN_STATUS=()

deploy_plan_build() {
  PLAN_REL=()
  PLAN_SRC=()
  PLAN_DST=()
  PLAN_DSTREL=()
  PLAN_STATUS=()
  local rel dst_rel dst
  while IFS= read -r rel; do
    in_list "$rel" "${KEEP[@]:-}" && continue
    dst_rel="${RENAME_MAP[$rel]:-$rel}"
    dst="$TARGET/$dst_rel"
    if in_list "$dst_rel" "${PROTECT[@]:-}"; then
      if [[ -e "$dst" ]]; then
        PLAN_STATUS+=(keep)
        PLAN_SRC+=("")
      else
        PLAN_STATUS+=(new)
        PLAN_SRC+=("${GEN_FROM[$dst_rel]}")
      fi
    elif [[ ! -e "$dst" ]]; then
      PLAN_STATUS+=(new)
      PLAN_SRC+=("$SNAP/$rel")
    elif cmp -s "$SNAP/$rel" "$dst"; then
      PLAN_STATUS+=(same)
      PLAN_SRC+=("$SNAP/$rel")
    else
      PLAN_STATUS+=(update)
      PLAN_SRC+=("$SNAP/$rel")
    fi
    PLAN_REL+=("$rel")
    PLAN_DST+=("$dst")
    PLAN_DSTREL+=("$dst_rel")
  done < <(git -C "$REPO_DIR" ls-files -- "$SNAP_REL" | sed "s|^$SNAP_REL/||")
}

# 逐文件打印新增/覆盖/跳过/保留,并汇总
deploy_plan_show() {
  local i status
  PLAN_NEW=0
  PLAN_UPD=0
  local n_same=0 n_keep=0
  for i in "${!PLAN_REL[@]}"; do
    status=${PLAN_STATUS[$i]}
    case "$status" in
      new)
        printf '  新增  %s\n' "${PLAN_DSTREL[$i]}"
        PLAN_NEW=$((PLAN_NEW + 1))
        ;;
      update)
        printf '  覆盖  %s\n' "${PLAN_DSTREL[$i]}"
        PLAN_UPD=$((PLAN_UPD + 1))
        ;;
      same)
        printf '  跳过  %s(内容一致)\n' "${PLAN_DSTREL[$i]}"
        n_same=$((n_same + 1))
        ;;
      keep)
        printf '  保留  %s(机器相关配置,不覆盖)\n' "${PLAN_DSTREL[$i]}"
        n_keep=$((n_keep + 1))
        ;;
    esac
  done
  info "共 ${#PLAN_REL[@]} 个快照文件:新增 $PLAN_NEW,覆盖 $PLAN_UPD,跳过 $n_same,保留 $n_keep"
}

# 执行前备份将被覆盖的文件到带时间戳目录,并打印恢复命令
deploy_backup() {
  local ts i rel
  ts=$(date +%Y%m%d-%H%M%S)
  BACKUP_DIR="${DEPLOY_BACKUP_DIR:-$HOME/.config/automation-suite/backups}/${SNAP_REL}-${ts}"
  for i in "${!PLAN_REL[@]}"; do
    [[ "${PLAN_STATUS[$i]}" == update ]] || continue
    rel="${PLAN_DSTREL[$i]}"
    mkdir -p "$BACKUP_DIR/$(dirname "$rel")"
    cp "${PLAN_DST[$i]}" "$BACKUP_DIR/$rel"
  done
  ok "已备份被覆盖文件到:$BACKUP_DIR"
  printf '  恢复命令:cp -r "%s/." "%s/"\n' "$BACKUP_DIR" "$TARGET"
}

# 授权覆盖前的二次确认:非交互环境必须 --yes,交互环境要输入 yes
# DEPLOY_CONFIRM_FORCE_TTY=1 是测试专用钩子:把管道输入当作交互终端(仍需真的输入 yes)
deploy_confirm() {
  if ((ASSUME_YES)); then
    ok '已用 --yes 确认(非交互)'
    return 0
  fi
  if [[ ! -t 0 && "${DEPLOY_CONFIRM_FORCE_TTY:-0}" != 1 ]]; then
    bad '非交互环境:授权覆盖必须再加 --yes(先核对上面的文件清单与警告)'
    return 1
  fi
  local ans
  printf '确认用脱敏快照覆盖上述文件,请输入 yes:'
  read -r ans
  if [[ "$ans" == yes ]]; then return 0; fi
  bad '未输入 yes,已中止(未写任何文件)'
  return 1
}

# 落盘:先备份被覆盖文件,再写新增/覆盖
deploy_plan_apply() {
  local i
  if ((PLAN_UPD > 0)); then deploy_backup; fi
  for i in "${!PLAN_REL[@]}"; do
    case "${PLAN_STATUS[$i]}" in
      new | update)
        mkdir -p "$(dirname "${PLAN_DST[$i]}")"
        cp "${PLAN_SRC[$i]}" "${PLAN_DST[$i]}"
        ;;
    esac
  done
  info '已写入目标'
}

deploy_finish() {
  printf '\n结论:'
  if ((APPLY)); then
    if ((BLOCK)); then
      printf '有阻塞项,见上方 [阻塞]。\n'
      exit 1
    fi
    printf '部署完成;上方 [缺] 项按提示补齐后即可真跑。\n'
  else
    printf 'dry-run 结束(退出码恒 0);要写入加 --apply。\n'
  fi
}
