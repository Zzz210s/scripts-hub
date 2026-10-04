# 部署与真跑入口验证记录(2026-10-05)

一次性的验证记录:证明「从全新克隆能不能构建、能不能把入口跑到安全边界」,以及三条修复的效果。
命令与输出是当天实跑结果;以后要复现照这里跑。路径用占位符(真实本机路径见 `local-deployment.md`)。

## 1. 微软积分:隔离环境完整构建

在全新克隆里(不是权威工作区)做:

| 步骤 | 结果 | 耗时 |
| --- | --- | --- |
| `git clone <本仓库> <临时目录>` | 成功 | 秒级 |
| `npm ci --no-audit --no-fund` | 成功,168 个包,`node_modules` 约 122MB | 8s |
| `npx patchright install chromium` | 成功;复用本机已有 `chromium-1228`,没有新增下载 | 2s |
| `npm run build` | 成功,`dist/index.js` 41215 字节 | 4s |

结论:全新克隆可以完整走通「装依赖 → 浏览器 → 构建」。无原生依赖编译(没有 node-gyp 报错)。
临时克隆已删除(含 `node_modules`),没有新增浏览器。

## 2. 微信读书:拉底座(`--vendor`)

- `vendor/` 被 `.gitignore` 忽略(不进仓库),这是设计。
- 在 `%WEREAD_DIR%` 内 `git -C vendor/weread-bot fetch origin <固定 commit>` → 成功;本地 HEAD 与
  `VENDOR_COMMIT.txt` 记录的 `0cc9b5c…` 一致。
- 按 README 的命令做一次**全新克隆 + checkout 固定 commit** → HEAD 一致,仓库 3.2MB,7s;已清理。
- 拉取后跑离线测试:223 条全过。

结论:底座可以复现到固定 commit。

## 3. 真跑入口(只到安全边界)

**微软积分**

- 运行器自检 `node scripts/windows/run-state.js <cmd>`:
  `lock-status` → `NONE`;`lock-age` / `lock-mtime` → `-1`;`free-mem` → `4568`;`count` → `0`;
  `clock` → `2026-10-04 2026-10-04 18:24:18`。
- 通知干跑:`node wechat-bridge/notify-skip.js memory 900 --dry` 与 `notify-start.js --dry` 都只打印文案,
  `--dry` 不下发。
- 最小浏览器链路:用 `patchright` 启动 headless chromium → `chromium version: 149.0.7827.55`,
  打开 `about:blank`,`navigator.userAgent` 存在,正常关闭,1.4s。证明运行时与浏览器链路完好。

**微信读书**

- `node src/index.js run --dry` → 守卫判定「今天已达标(60 分钟)」并跳过,0s;`data/state.json` /
  `data/history.json` 修改时间未变。
- `node src/index.js verify`(只读官方统计)→ `今日 60 分钟 | 本周期 347 分钟 | 有效天数 4 天`;状态文件未变。

**故意没有越过的边界**

- 不刷积分:没有调用 `dist/index.js` 真跑,只验证到「运行时 + 浏览器可启动」。
- 不读时长:微信读书只跑到 `run --dry` 的守卫判定;没有不带 `--dry` 地真跑阅读。
- 不发企业微信:所有通知都带 `--dry`;隔离克隆本身也没有 webhook。
- 不动计划任务:只读查询任务名、状态与触发器,没有注册/停用/触发任何任务。

## 4. 微软积分完整 `npm ci`

见第 1 节:8s,168 个包,约 122MB,成功;无原生依赖编译。

## 附:部署脚本与三条修复的验证

- **部署脚本**:全新克隆里 `--dry-run` 退出码 0、克隆目录保持干净;`--apply --dest=<空临时目录>`
  分别写出 77 / 149 个文件;对权威工作区(与快照同源)`--apply` 报错退出 1,不写任何文件。
- **脱敏模板**:`SENSITIVE_PATTERNS_FILE=<不存在> bash scripts/sync-microsoft-rewards.sh --dry-run`
  → 退出 1,提示指向 `scripts/sensitive-patterns.txt.example`,拒绝同步的安全属性保持。
- **行尾**:两个源头仓库加 `.gitattributes`(`* text=auto eol=lf` + Windows 脚本 `eol=crlf`)并把
  本地 `core.autocrlf` 设为 `input`;模拟编辑器写 CRLF 再改一行 → `git diff --stat` 只有 1 insertion,
  不再整文件抖动;两侧测试 223 / 31 全过。
- **发送层**:微软 `sendWecom` 生产签名只留 `url` 覆盖,`fetch/sleep/retries/timeout` 注入移入测试专用
  `__deliverWecom`;26 条通知层测试全过,`check-wecom-drift.mjs` 通过。
