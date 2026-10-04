# shellcheck shell=bash
#
# reset-verify:wizard-public-reset 的备份镜像发现、删库前快照(旧 SHA / topics)与备份校验。
# 由 wizard-public-reset.sh source(在 reset-common.sh 之后),不要单独执行。
# 依赖 reset-common.sh 的 wsh_ok/wsh_bad/wsh_die 与 HAC_BACKUP_GLOBS 等变量。
#
# find_backups <glob>...:列出匹配的备份镜像目录,最新的排最前。
find_backups() {
  local pattern m i
  local -a found=() out=()
  for pattern in "$@"; do
    while IFS= read -r m; do found+=("$m"); done < <(compgen -G "$pattern" || true)
  done
  for m in "${found[@]}"; do
    i=${#out[@]}
    while (( i > 0 )) && [[ "$m" -nt "${out[i-1]}" ]]; do i=$((i - 1)); done
    out=("${out[@]:0:i}" "$m" "${out[@]:i}")
  done
  (( ${#out[@]} )) && printf '%s\n' "${out[@]}"
  return 0
}

# check_backup <label> <varname> <glob>...:备份必须存在且是可读、有提交的 git 仓库。
# 可传多个候选模式(新名在前、旧名在后),取最新的一份。
check_backup() {
  local label="$1" varname="$2" count dir
  shift 2
  local -a matches=()
  while IFS= read -r m; do matches+=("$m"); done < <(find_backups "$@")
  (( ${#matches[@]} )) || wsh_die "找不到 $label 的备份(已试模式:$*)。" \
    "重建前必须有镜像备份,否则拒绝继续 —— 一条命令都不会执行。" \
    "先做一份:git clone --mirror <仓库URL> <路径>.git"
  dir="${matches[0]}"
  [[ -d "$dir" ]] || wsh_die "$label 的备份路径不是目录:$dir" "删库前先修好备份。"
  count=$(git --git-dir="$dir" rev-list --count --all 2>/dev/null) \
    || wsh_die "$label 的备份不是可读的 git 仓库:$dir" "删库前先修好备份。"
  (( count > 0 )) || wsh_die "$label 的备份里没有提交:$dir" "删库前先修好备份。"
  printf -v "$varname" '%s' "$dir"
  wsh_ok "$label 备份可用:$dir($count 个提交)"
}

# gh_has_scope <scope>:从 x-oauth-scopes 响应头判断当前 token 的权限范围。
gh_has_scope() {
  local scopes
  scopes=$(gh api -i user 2>/dev/null | tr -d '\r' \
    | awk -F': ' 'tolower($1)=="x-oauth-scopes"{print $2}') || return 1
  [[ ",${scopes// /}," == *",$1,"* ]]
}

# capture_old_shas:删库前记录一批"重写前的旧 SHA",删完用来验证旧对象真的取不回。
# 两个来源:线上现有 ref(force push 后仍能取回的那些)+ 备份里重写前的提交(抽样 5 个)。
capture_old_shas() {
  local file="$SHA_FILE"
  mkdir -p "$SHA_DIR"
  : > "$file"
  git ls-remote "https://github.com/$OLD_SLUG.git" 2>/dev/null \
    | awk '{print $1}' >> "$file" || true
  # 新名与旧名镜像都算,每个抽 5 个提交(重写前的旧对象在旧名镜像里)
  local m
  while IFS= read -r m; do
    git --git-dir="$m" rev-list --all 2>/dev/null | head -n 5 >> "$file" || true
  done < <(find_backups "${HAC_BACKUP_GLOBS[@]}")
  sort -u -o "$file" "$file"
  note "$OLD_SLUG 记下 $(grep -c . "$file" || true) 个旧 SHA(线上 ref + 备份里的旧提交)"
}

# capture_topics:删库前把旧仓库的 topics 抄下来,重建后原样写到新仓库。
# 读不到(没网/权限不足)就用 HAC_TOPICS 备份清单;抄下来的顺手按 GitHub 规则清洗。
capture_topics() {
  mkdir -p "$SHA_DIR"
  if gh api "repos/$OLD_SLUG/topics" --jq '.names[]' > "$TOPIC_FILE" 2>/dev/null \
     && [[ -s "$TOPIC_FILE" ]]; then
    grep -E '^[a-z0-9][a-z0-9-]*$' "$TOPIC_FILE" > "$TOPIC_FILE.clean" || true
    mv "$TOPIC_FILE.clean" "$TOPIC_FILE"
    note "$OLD_SLUG 现读 topics $(grep -c . "$TOPIC_FILE" || true) 个,重建后照抄"
  else
    printf '%s\n' "${HAC_TOPICS[@]}" > "$TOPIC_FILE"
    warn "读不到旧仓库 topics,改用本地备份清单(${#HAC_TOPICS[@]} 个)"
  fi
}

# load_topics:把抄下来的 topics 读进 HAC_TOPICS(替换静态清单);文件为空则保留静态清单。
load_topics() {
  local -a t=()
  while IFS= read -r _t; do [[ -n "$_t" ]] && t+=("$_t"); done < "$TOPIC_FILE"
  (( ${#t[@]} )) && HAC_TOPICS=("${t[@]}")
  return 0
}

