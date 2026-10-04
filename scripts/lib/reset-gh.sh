# shellcheck shell=bash
#
# reset-gh:wizard-public-reset 的 GitHub 动作(删库/建库/写 topics)与推送后校验
# (旧对象取不回、凭据路径、作者邮箱、剪掉本地不可达对象)。由向导主脚本 source。
# 依赖 reset-common.sh 的 wsh_* 与 SENSITIVE_PATTERN;阶段编排留在 wizard-public-reset.sh。
#
delete_repo() {
  local slug="$1" backup="$2" verify
  if ! gh api "repos/$slug" --jq .full_name >/dev/null 2>&1; then
    wsh_ok "$slug 已经不存在,跳过删除"
    return 0
  fi
  verify=$(git --git-dir="$backup" rev-list --count --all 2>/dev/null || echo 0)
  (( verify > 0 )) || wsh_die "备份 $backup 读不出提交,拒绝删除 $slug。" "先修好备份再重跑。"
  if ! confirm "确认删除远程 $slug?(回滚只能靠备份 $backup 的 $verify 个提交)"; then
    wsh_die "已取消,什么都没删。" \
      "想走网页删:$OLD_SLUG 的 Settings -> Danger Zone" \
      "删完重跑本脚本,它会跳过删除直接重建。"
  fi
  gh repo delete "$slug" --yes || wsh_die "删除 $slug 失败。" \
    "常见原因:token 缺 delete_repo 权限(回上一阶段授权)。" \
    "也可以去 https://github.com/$slug/settings 的 Danger Zone 手动删,再重跑本脚本。"
  if gh api "repos/$slug" --jq .full_name >/dev/null 2>&1; then
    wsh_die "$slug 删除命令返回成功,但仓库仍然存在。" \
      "去 https://github.com/$slug/settings 手动确认,再重跑。"
  fi
  wsh_ok "$slug 已删除"
}

create_repo() {
  local slug="$1" desc="$2"
  if gh api "repos/$slug" --jq .full_name >/dev/null 2>&1; then
    warn "$slug 已存在,跳过创建(确认它就是重建出来的空库,才继续下一步)"
    return 0
  fi
  gh repo create "$slug" --public --description "$desc" \
    || wsh_die "创建 $slug 失败。" \
         "若提示名字冲突:删库可能还没生效,等几秒重跑。" \
         "也可以去 https://github.com/new 手动建一个空的 PUBLIC 仓库,再重跑本脚本。"
  wsh_ok "已创建 $slug(PUBLIC)"
}

set_topics() {
  local slug="$1"; shift
  local json='{"names":[' first=1 t
  for t in "$@"; do
    (( first )) || json+=','
    json+="\"$t\""; first=0
  done
  json+=']}'
  if printf '%s' "$json" | gh api -X PUT "repos/$slug/topics" --input - >/dev/null 2>&1; then
    wsh_ok "$slug:topics 已设置($# 个)"
  else
    warn "$slug:topics 设置失败,稍后手动补"
    SKIPPED+=("$slug topics")
  fi
}

# check_no_old_objects <slug> <dir>:重写前的旧 SHA 必须在远程已取不回。
# 用一次性裸库去试,免得把旧对象又取回本地克隆。
check_no_old_objects() {
  local slug="$1" dir="$2" file="${3:-$SHA_FILE}" sha type bad=0 total=0
  local probe
  [[ -f "$file" ]] || { note "$slug:没有记录删除前的 SHA,跳过旧对象检查"; return 0; }
  probe="$(mktemp -d)/probe.git"
  git init --bare --quiet "$probe"
  while read -r sha; do
    [[ -n "$sha" ]] || continue
    if git -C "$dir" merge-base --is-ancestor "$sha" main 2>/dev/null; then continue; fi
    total=$(( total + 1 ))
    if git --git-dir="$probe" fetch --quiet --no-tags "https://github.com/$slug.git" "$sha" 2>/dev/null; then
      type=$(git --git-dir="$probe" cat-file -t "$sha" 2>/dev/null || echo unknown)
      if [[ "$type" == "commit" ]]; then
        wsh_bad "旧提交仍可取回:$sha"
        bad=$(( bad + 1 ))
      fi
    fi
  done < "$file"
  rm -rf "$(dirname "$probe")"
  if (( bad )); then
    warn "有 $bad 个重写前的提交还能按旧 SHA 取到:远程仍留着旧对象,查一下删的是不是同一个仓库"
  else
    wsh_ok "重写前的 $total 个提交都已取不到(旧历史确实没了)"
  fi
  return 0
}

publish_repo() {
  local slug="$1" dir="$2" dirty local_sha remote_sha emails hits
  [[ -d "$dir/.git" ]] || wsh_die "找不到本地仓库:$dir" "先克隆出清洗后的历史再重跑。"
  dirty=$(git -C "$dir" status --porcelain)
  [[ -z "$dirty" ]] || wsh_die "$dir 有未提交改动,先处理干净再推。" "$dirty"
  git -C "$dir" remote set-url origin "https://github.com/$slug.git"
  git -C "$dir" push -u origin main \
    || wsh_die "$slug 推送失败。" "确认仓库已重建、且是空库(有内容会拒推)。"
  git -C "$dir" fetch --quiet origin main
  local_sha=$(git -C "$dir" rev-parse main)
  remote_sha=$(git -C "$dir" rev-parse origin/main)
  if [[ "$local_sha" == "$remote_sha" ]]; then
    wsh_ok "$slug main 已同步:$local_sha"
  else
    wsh_bad "$slug 本地与远程 main 不一致($local_sha / $remote_sha)"
  fi
  wsh_ok "$slug 提交 $(git -C "$dir" rev-list --count main) 个 · 入库文件 $(git -C "$dir" ls-files | wc -l) 个"
  emails=$(git -C "$dir" log --format='%ae' | sort -u)
  if [[ "$emails" == "zzz210s@qq.com" ]]; then
    wsh_ok "$slug 作者邮箱只剩 zzz210s@qq.com"
  else
    wsh_bad "$slug 作者邮箱还有:$emails"
  fi
  hits=$(git -C "$dir" ls-files \
    | grep -E '(^|/)(secrets?|credentials?)(/|$)|(^|/)\.env$|webhook|api-key|\.cookie$' || true)
  if [[ -z "$hits" ]]; then
    wsh_ok "$slug 入库文件里没有凭据类路径"
  else
    wsh_bad "$slug 入库文件疑似含凭据:$(printf '%s' "$hits" | tr '\n' ' ')"
  fi
  hits=$(git -C "$dir" grep -I -n -E "$SENSITIVE_PATTERN" main || true)
  if [[ -z "$hits" ]]; then
    wsh_ok "$slug 内容里没有真实 Key 与个人标识"
  else
    warn "$slug 内容里还有可疑字符串(自查后再决定是否改):"
    printf '%s\n' "$hits" | head -n 5 | while read -r l; do note "  $l"; done
  fi
  wsh_ok "$slug 可见性 $(gh api "repos/$slug" --jq .visibility) · 许可 $(gh api "repos/$slug" --jq '.license.spdx_id // "未识别"')"
}

# prune_local <dir>:重写前的旧对象还留在本地 pack 里当垃圾 —— 它们不会被 push,
# 但以后 git push --mirror / 打包时容易漏出去。推之前先剪掉,让本地与公开的版本对齐。
prune_local() {
  local dir="$1" before after
  before=$(git -C "$dir" count-objects -v | awk '/^size-pack/{print $2}')
  git -C "$dir" reflog expire --expire=now --all
  git -C "$dir" gc --prune=now --quiet
  after=$(git -C "$dir" count-objects -v | awk '/^size-pack/{print $2}')
  wsh_ok "$dir 已剪掉不可达对象(pack ${before}KiB -> ${after}KiB;main 仍是 $(git -C "$dir" rev-list --count main) 个提交)"
}

